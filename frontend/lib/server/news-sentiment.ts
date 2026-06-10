/**
 * NewsSentimentService — 서버리스 전용 이벤트 드리븐 뉴스 감성 분석
 *
 * ┌ 아키텍처 (Vercel 서버리스 제약 정면 대응) ─────────────────────────────────┐
 * │  ✗ 로컬에서 transformers 모델을 로드하지 않는다.                            │
 * │    (PyTorch/onnx 번들 = 수백 MB → 람다 용량 초과·콜드스타트 폭증·OOM)        │
 * │  ✓ 추론은 전적으로 Hugging Face Inference API에 위임(fetch)한다.            │
 * │    함수는 "크롤링 + 경량 후처리"만 담당 → 메모리·번들 가볍게 유지.          │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 파이프라인:
 *   1) Naver Finance 종목 뉴스 헤드라인 크롤링 (axios + cheerio, EUC-KR 디코딩)
 *   2) Hugging Face Inference API 호출 → snunlp/KR-FinBert-SC
 *      (한국어 금융 도메인 특화 긍정/중립/부정 3-class 분류기)
 *   3) 헤드라인별 극성(polarity) = P(긍정) − P(부정) ∈ [-1, +1]
 *   4) 헤드라인 평균 → 당일 sentimentScore
 *   5) Supabase `news_sentiment` 영속화 → 최근 3거래일 이동평균 sentiment_3d_ma
 *
 * 신뢰성 원칙:
 *   모든 외부 호출은 실패해도 절대 throw하지 않고 0(중립)으로 graceful degrade.
 *   뉴스 신호는 "보조 팩터"이므로, 크롤링·HF·DB 중 하나가 죽어도
 *   메인 앙상블 파이프라인은 정상 동작해야 한다(가용성 > 완전성).
 */

import axios from "axios";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { supabase } from "./supabase";
import { mapWithConcurrency, withTimeout } from "./async-pool";

// ── 설정 상수 ─────────────────────────────────────────────────────────────────

/**
 * Hugging Face Inference API 모델 엔드포인트 베이스.
 * ⚠ HF가 레거시(api-inference)에서 라우터(router.huggingface.co/hf-inference)로
 *   이전 중이므로, 배포 환경에 따라 env HF_INFERENCE_ENDPOINT로 전체 URL을
 *   오버라이드할 수 있게 한다(아래 resolveEndpoint 참조).
 *   라우터 형식 예: https://router.huggingface.co/hf-inference/models/{model}
 */
const HF_API_BASE = "https://api-inference.huggingface.co/models/";

/** 한국어 금융 감성 분류 모델 (긍정/중립/부정 3-class) */
const DEFAULT_MODEL = "snunlp/KR-FinBert-SC";

/** Naver 데스크톱 User-Agent (크롤링 차단 회피) */
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 종목당 분석에 사용할 최대 헤드라인 수 (HF 토큰 비용·지연 제어) */
const MAX_HEADLINES = 12;

/** 외부 호출별 하드 타임아웃(ms) — fail-fast로 함수 전체 타임아웃 방어 */
const CRAWL_TIMEOUT_MS = 5_000;
const HF_TIMEOUT_MS    = 8_000;

/** HF 모델이 콜드 상태(503 "model is loading")일 때 재시도 횟수 */
const HF_MAX_RETRIES = 2;

/** sentiment_3d_ma 계산에 사용할 직전 거래일 수(당일 포함) */
const SENTIMENT_MA_WINDOW = 3;

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

/**
 * 종목별 뉴스 감성 분석 결과.
 *   sentimentScore : 당일 헤드라인 평균 극성 ∈ [-1.0(악재), +1.0(호재)]
 *   sentiment3dMa  : 최근 3거래일 sentimentScore 이동평균 (단기 노이즈 평활)
 *   headlineCount  : 실제 분석에 사용된 헤드라인 수 (0이면 데이터 없음)
 *   ok             : 외부 호출이 모두 성공했는지 (false면 중립 fallback 값)
 */
export interface NewsSentimentResult {
  ticker:         string;
  sentimentScore: number;
  sentiment3dMa:  number;
  headlineCount:  number;
  headlines:      string[];
  ok:             boolean;
}

/** HF text-classification 응답의 단일 라벨-확률 쌍 */
interface HfLabelScore {
  label: string;
  score: number;
}

/** NewsSentimentService 생성자 옵션 */
export interface NewsSentimentOptions {
  /** HF API 토큰. 미지정 시 env HUGGINGFACE_API_KEY / HF_API_TOKEN 순으로 조회 */
  apiKey?: string;
  /** 사용할 HF 모델 id (기본 snunlp/KR-FinBert-SC) */
  model?: string;
  /**
   * 추론 엔드포인트 전체 URL 직접 지정(고급).
   * 미지정 시 env HF_INFERENCE_ENDPOINT → 레거시 베이스+model 순으로 결정.
   */
  endpoint?: string;
}

// ── 극성 라벨 → 부호 매핑 ──────────────────────────────────────────────────────

/**
 * HF 분류 라벨을 금융 극성 부호(+1 호재 / 0 중립 / -1 악재)로 변환한다.
 *
 * snunlp/KR-FinBert-SC는 보통 "positive"/"neutral"/"negative" 문자열 라벨을
 * 반환하지만, 일부 배포본은 "LABEL_0/1/2" 형태로 줄 수 있어 둘 다 처리한다.
 *
 * @param label - HF가 반환한 라벨 문자열
 * @returns 극성 부호: 호재 +1, 중립 0, 악재 -1
 *
 * @remarks
 * LABEL_n 순서는 KR-FinBert-SC config 기준 0=부정, 1=중립, 2=긍정을 가정한다.
 * 배포본마다 순서가 다를 수 있으므로, 운영 전 실제 응답 라벨을 1회 검증 권장.
 */
function labelToSign(label: string): -1 | 0 | 1 {
  const l = label.toLowerCase().trim();
  if (l.includes("pos") || l.includes("긍정") || l.includes("호재")) return 1;
  if (l.includes("neg") || l.includes("부정") || l.includes("악재")) return -1;
  if (l.includes("neu") || l.includes("중립")) return 0;
  if (l === "label_2") return 1;   // 긍정 (가정)
  if (l === "label_0") return -1;  // 부정 (가정)
  if (l === "label_1") return 0;   // 중립 (가정)
  return 0;
}

/**
 * 단일 헤드라인의 라벨-확률 분포 → 극성 점수 ∈ [-1, +1].
 *
 * 수식:  score = Σ_label  sign(label) × P(label)
 *             = P(긍정)·(+1) + P(중립)·0 + P(부정)·(-1)
 *             = P(긍정) − P(부정)
 *
 * 확률 가중이므로 결과는 항상 [-1, +1]에 수렴한다. 확신도가 낮은(분포가
 * 평평한) 헤드라인은 자연히 0 근처로 수축되어 과잉 신호를 억제한다.
 *
 * @param dist - 한 헤드라인에 대한 라벨-확률 배열
 * @returns 극성 점수 ∈ [-1, +1]
 */
function distToPolarity(dist: HfLabelScore[]): number {
  let s = 0;
  for (const { label, score } of dist) {
    if (Number.isFinite(score)) s += labelToSign(label) * score;
  }
  return Math.max(-1, Math.min(1, s));
}

// ── 서비스 본체 ────────────────────────────────────────────────────────────────

export class NewsSentimentService {
  private readonly apiKey:   string | undefined;
  private readonly model:    string;
  private readonly endpoint: string;

  constructor(opts: NewsSentimentOptions = {}) {
    this.apiKey =
      opts.apiKey ?? process.env.HUGGINGFACE_API_KEY ?? process.env.HF_API_TOKEN;
    this.model = opts.model ?? DEFAULT_MODEL;
    // 우선순위: 명시 옵션 > env 오버라이드 > 레거시 베이스+model
    this.endpoint =
      opts.endpoint ?? process.env.HF_INFERENCE_ENDPOINT ?? `${HF_API_BASE}${this.model}`;
  }

  /**
   * Naver Finance 종목 뉴스에서 최신 헤드라인을 크롤링한다.
   *
   * 데이터 소스: https://finance.naver.com/item/news_news.naver?code={code}
   * 인코딩: EUC-KR → iconv-lite로 UTF-8 변환 (한글 깨짐 방지 → 추론 정확도 직결)
   *
   * @param ticker - 6자리 종목코드 (예: "005930")
   * @param limit  - 가져올 최대 헤드라인 수
   * @returns 중복 제거된 헤드라인 문자열 배열 (실패 시 빈 배열)
   */
  private async crawlHeadlines(ticker: string, limit: number): Promise<string[]> {
    const url = `https://finance.naver.com/item/news_news.naver?code=${ticker}&page=1`;

    const res = await withTimeout(
      axios.get<ArrayBuffer>(url, {
        headers: {
          "User-Agent":      DESKTOP_UA,
          "Referer":         `https://finance.naver.com/item/news.naver?code=${ticker}`,
          "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
        },
        responseType: "arraybuffer",
        timeout: CRAWL_TIMEOUT_MS,
      }),
      CRAWL_TIMEOUT_MS,
      `crawl:${ticker}`,
    );

    // Naver Finance는 EUC-KR — UTF-8로 변환해야 한글 헤드라인이 보존된다.
    const html = iconv.decode(Buffer.from(res.data), "EUC-KR");
    const $    = cheerio.load(html);

    const seen = new Set<string>();
    const headlines: string[] = [];

    // 뉴스 목록 테이블의 제목 셀(.title) 앵커 텍스트를 수집
    $("td.title a, .title a.tit, dd.articleSubject a").each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text.length < 4) return;          // 빈/너무 짧은 항목 스킵
      if (text.includes("연관기사")) return; // 클러스터 더보기 링크 스킵
      if (seen.has(text)) return;            // 동일 제목 중복 제거
      seen.add(text);
      headlines.push(text);
      if (headlines.length >= limit) return false; // cheerio: false 반환 시 중단
    });

    return headlines;
  }

  /**
   * Hugging Face Inference API로 헤드라인 배치를 분류한다.
   *
   * 요청: POST {HF_API_BASE}{model}
   *   body = { inputs: string[], options: { wait_for_model: true } }
   *   - wait_for_model: 모델이 콜드 상태면 로딩까지 대기(503 즉시 실패 방지)
   *
   * 응답(text-classification, 배치): HfLabelScore[][]
   *   inputs와 동일 순서로, 각 입력의 라벨-확률 분포 배열.
   *   (배포에 따라 단일 입력이 평탄화될 수 있어 normalize에서 양쪽 형태 처리)
   *
   * @param headlines - 분류할 헤드라인 배열
   * @returns 헤드라인별 극성 점수 배열 ∈ [-1, +1] (입력과 동일 순서/길이)
   * @throws API 키 부재 / HF 오류 응답 시 (상위 getSentiment에서 catch)
   */
  private async classify(headlines: string[]): Promise<number[]> {
    if (headlines.length === 0) return [];
    if (!this.apiKey) {
      throw new Error("HUGGINGFACE_API_KEY 미설정 — 뉴스 감성 분석 비활성화");
    }

    const endpoint = this.endpoint;
    const payload  = JSON.stringify({
      inputs:  headlines,
      options: { wait_for_model: true },
    });

    let lastErr: unknown;
    for (let attempt = 0; attempt <= HF_MAX_RETRIES; attempt++) {
      try {
        const resp = await withTimeout(
          fetch(endpoint, {
            method:  "POST",
            headers: {
              "Authorization": `Bearer ${this.apiKey}`,
              "Content-Type":  "application/json",
            },
            body: payload,
          }),
          HF_TIMEOUT_MS,
          `hf:${this.model}`,
        );

        // 503 = 모델 로딩 중 → 짧게 백오프 후 재시도
        if (resp.status === 503 && attempt < HF_MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1_500 * (attempt + 1)));
          continue;
        }
        if (!resp.ok) {
          throw new Error(`HF ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        }

        const raw = (await resp.json()) as HfLabelScore[] | HfLabelScore[][];
        return this.normalizeHfResponse(raw, headlines.length);
      } catch (err) {
        lastErr = err;
        // 네트워크/타임아웃은 마지막 시도가 아니면 한 번 더
        if (attempt < HF_MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * HF 응답을 헤드라인별 극성 점수 배열로 정규화한다.
   * 배치 응답(HfLabelScore[][])과 단일 평탄 응답(HfLabelScore[])을 모두 수용.
   *
   * @param raw         - HF 원시 응답
   * @param expectedLen - 기대 헤드라인 수 (길이 불일치 시 0 패딩)
   */
  private normalizeHfResponse(
    raw: HfLabelScore[] | HfLabelScore[][],
    expectedLen: number,
  ): number[] {
    // 배치 형태: 각 원소가 라벨 배열
    if (Array.isArray(raw) && Array.isArray(raw[0])) {
      const scores = (raw as HfLabelScore[][]).map(distToPolarity);
      while (scores.length < expectedLen) scores.push(0);
      return scores.slice(0, expectedLen);
    }
    // 단일 입력이 평탄화된 형태: 전체를 한 분포로 간주
    if (Array.isArray(raw) && raw.length > 0 && "label" in (raw[0] as HfLabelScore)) {
      return [distToPolarity(raw as HfLabelScore[])];
    }
    return new Array(expectedLen).fill(0);
  }

  /**
   * 당일 감성 점수를 Supabase에 upsert하고 최근 3거래일 이동평균을 계산한다.
   *
   * sentiment_3d_ma 정의:
   *   당일 포함 직전 SENTIMENT_MA_WINDOW(3) 거래일의 sentimentScore 단순 평균.
   *   단일 헤드라인 급등락/오보로 인한 점프를 평활(smoothing)하여
   *   TFT 어텐션 바이어스가 일일 노이즈에 과민 반응하지 않도록 한다.
   *
   * @param ticker     - 종목코드
   * @param runDate    - 기준일(YYYY-MM-DD)
   * @param todayScore - 당일 sentimentScore
   * @param count      - 당일 헤드라인 수
   * @returns 3일 이동평균. DB 접근 실패 시 당일 점수로 graceful degrade.
   */
  private async persistAndComputeMa(
    ticker: string,
    runDate: string,
    todayScore: number,
    count: number,
  ): Promise<number> {
    try {
      // 당일 값 upsert (같은 날 재실행 시 덮어쓰기)
      await supabase.from("news_sentiment").upsert(
        {
          run_date:        runDate,
          ticker,
          sentiment_score: todayScore,
          headline_count:  count,
        },
        { onConflict: "run_date,ticker" },
      );

      // 최근 N거래일(당일 포함) 조회 → 평균
      const { data } = await supabase
        .from("news_sentiment")
        .select("sentiment_score")
        .eq("ticker", ticker)
        .order("run_date", { ascending: false })
        .limit(SENTIMENT_MA_WINDOW);

      if (data && data.length > 0) {
        const sum = data.reduce(
          (s, r) => s + (r as { sentiment_score: number }).sentiment_score,
          0,
        );
        return sum / data.length;
      }
    } catch {
      // 테이블 부재/권한 오류 등 → 당일 점수로 폴백 (파이프라인 비중단)
    }
    return todayScore;
  }

  /**
   * 단일 종목의 뉴스 감성을 분석한다. (크롤링 → HF 분류 → 집계 → 영속화)
   *
   * @param ticker  - 6자리 종목코드
   * @param runDate - 기준일(YYYY-MM-DD). 기본값: 오늘(UTC)
   * @returns NewsSentimentResult. 어떤 단계가 실패해도 throw하지 않고
   *          중립(0) 값을 담은 결과(ok=false)를 반환한다.
   */
  async getSentiment(
    ticker: string,
    runDate: string = new Date().toISOString().slice(0, 10),
  ): Promise<NewsSentimentResult> {
    const neutral: NewsSentimentResult = {
      ticker, sentimentScore: 0, sentiment3dMa: 0,
      headlineCount: 0, headlines: [], ok: false,
    };

    try {
      const headlines = await this.crawlHeadlines(ticker, MAX_HEADLINES);
      if (headlines.length === 0) return neutral;

      const polarities = await this.classify(headlines);
      if (polarities.length === 0) return { ...neutral, headlines };

      // 당일 점수 = 헤드라인 극성의 산술 평균 ∈ [-1, +1]
      const sentimentScore =
        polarities.reduce((s, v) => s + v, 0) / polarities.length;

      const sentiment3dMa = await this.persistAndComputeMa(
        ticker, runDate, sentimentScore, headlines.length,
      );

      return {
        ticker,
        sentimentScore,
        sentiment3dMa,
        headlineCount: headlines.length,
        headlines,
        ok: true,
      };
    } catch (err) {
      console.warn(`[news-sentiment] ${ticker} 분석 실패:`,
        err instanceof Error ? err.message : err);
      return neutral;
    }
  }

  /**
   * 여러 종목의 뉴스 감성을 동시성 제어하에 배치 분석한다.
   *
   * Naver/HF가 동시 폭주를 차단(429/503)하지 않도록 `mapWithConcurrency`로
   * in-flight 요청 수를 `concurrency`로 제한한다. 개별 실패는 무시되고
   * 해당 종목은 중립값으로 채워진다(부분 실패 허용).
   *
   * @param tickers     - 종목코드 배열
   * @param concurrency - 동시 실행 상한 (권장 6~10)
   * @param runDate     - 기준일(YYYY-MM-DD)
   * @returns ticker → NewsSentimentResult 매핑
   */
  async getSentimentBatch(
    tickers: readonly string[],
    concurrency = 8,
    runDate: string = new Date().toISOString().slice(0, 10),
  ): Promise<Map<string, NewsSentimentResult>> {
    const settled = await mapWithConcurrency(tickers, concurrency, t =>
      this.getSentiment(t, runDate),
    );

    const map = new Map<string, NewsSentimentResult>();
    settled.forEach((r, i) => {
      map.set(
        tickers[i],
        r.status === "fulfilled"
          ? r.value
          : { ticker: tickers[i], sentimentScore: 0, sentiment3dMa: 0,
              headlineCount: 0, headlines: [], ok: false },
      );
    });
    return map;
  }
}

/** 공용 싱글턴 인스턴스 (env 기반 설정으로 즉시 사용) */
export const newsSentimentService = new NewsSentimentService();
