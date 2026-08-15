/* eslint-disable @typescript-eslint/no-require-imports */
import axios from "axios";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { supabase } from "@/lib/server/supabase";

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

/** 일별 투자자별 순매수 데이터 */
export interface InvestorDayData {
  /** YYYY-MM-DD 형식 날짜 */
  date: string;
  /** 외국인 순매수 (천주, 음수=순매도) */
  foreign_net: number;
  /** 기관 순매수 (천주, 음수=순매도) */
  institution_net: number;
}

export interface InvestorTrendResult {
  ticker: string;
  /** 최근 5영업일 투자자별 순매수 (단위: 천주) */
  days: InvestorDayData[];
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

const KR_CODE = /^\d{6}$/;
const DATE_RE = /^\d{4}\.\d{2}\.\d{2}$/;

// 브라우저 User-Agent — 누락 시 Naver가 403 반환
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── 파싱 유틸리티 ─────────────────────────────────────────────────────────────

/**
 * Naver Finance 숫자 문자열 파싱
 * "+1,234", "-567", "1,234,567", "0" 모두 처리
 * 천주 단위로 반환하기 위해 1000으로 나눔 (원본 값은 주 단위)
 */
function parseNaverNum(text: string): number {
  const clean = text.trim().replace(/,/g, "").replace(/[▲▼+]/g, "");
  const num = parseFloat(clean);
  if (isNaN(num) || num === 0) return 0;
  // Naver Finance 순매수는 주(株) 단위 → 천주로 환산
  return Math.round(num / 1000);
}

/** "2025.01.07" → "2025-01-07" */
function parseNaverDate(text: string): string {
  return text.trim().replace(/\./g, "-");
}

// ── HTML 파싱 ─────────────────────────────────────────────────────────────────

/**
 * frgn.naver 헤더를 분석해 외국인/기관합계 순매수 열 인덱스를 반환한다.
 *
 * thead의 첫 번째 tr이 그룹 헤더(colspan 포함),
 * 두 번째 tr이 서브 헤더(매수/매도/순매수 등)를 가진다.
 * colspan을 누적해 실제 열 번호를 추적한다.
 */
function detectColumnIndices(
  $: cheerio.CheerioAPI,
): { foreignNetIdx: number; institutionNetIdx: number } {
  // 기본값 (실증적으로 확인된 frgn.naver 레이아웃)
  // 날짜(0) | 종가(1) | 전일비(2) | 등락률(3) |
  // 외국인합계: 순매수(4) 보유비율(5) |
  // 기관합계: 순매수(6) 보유비율(7) | ...
  let foreignNetIdx   = 4;
  let institutionNetIdx = 6;

  try {
    const firstHeaderRow = $("table.type2 thead tr").first();
    if (!firstHeaderRow.length) return { foreignNetIdx, institutionNetIdx };

    let colOffset = 0;
    let foreignStart   = -1;
    let institutionStart = -1;

    firstHeaderRow.find("th").each((_i, th) => {
      const text    = $(th).text().replace(/\s+/g, "");
      const colspan = parseInt($(th).attr("colspan") ?? "1", 10);

      if (foreignStart === -1 && (text.includes("외국인합계") || text.includes("외국인"))) {
        foreignStart = colOffset;
      } else if (
        foreignStart !== -1 &&
        institutionStart === -1 &&
        (text.includes("기관합계") || text.includes("기관"))
      ) {
        institutionStart = colOffset;
      }

      colOffset += colspan;
    });

    // 그룹 시작 열이 확인되면 서브헤더에서 "순매수" 위치를 찾는다
    // 서브헤더 없는 경우: 그룹 첫 열이 순매수
    if (foreignStart !== -1)     foreignNetIdx   = foreignStart;
    if (institutionStart !== -1) institutionNetIdx = institutionStart;

    // 두 번째 tr에서 각 그룹의 "순매수" 서브열 오프셋 확인
    const secondHeaderRow = $("table.type2 thead tr").eq(1);
    if (secondHeaderRow.length) {
      // 두 번째 헤더의 th 순서는 첫 번째의 colspan이 적용되지 않는다.
      // → 서브열들의 텍스트를 firstHeaderRow의 colspan 순서대로 매핑
      let subCol = 0;
      let firstHeaderColOffset = 0;

      firstHeaderRow.find("th").each((_i, th) => {
        const colspan = parseInt($(th).attr("colspan") ?? "1", 10);
        const mainText = $(th).text().replace(/\s+/g, "");

        // 이 그룹의 서브헤더 목록
        const subHeaders: string[] = [];
        for (let j = 0; j < colspan; j++) {
          const subTh = secondHeaderRow.find("th").eq(subCol + j);
          subHeaders.push(subTh.text().trim());
        }

        // 순매수 서브열 찾기
        const netBuySubIdx = subHeaders.findIndex((t) => t.includes("순매수"));
        if (netBuySubIdx !== -1) {
          if (mainText.includes("외국인합계") || mainText.includes("외국인")) {
            foreignNetIdx = firstHeaderColOffset + netBuySubIdx;
          } else if (mainText.includes("기관합계") || mainText.includes("기관")) {
            institutionNetIdx = firstHeaderColOffset + netBuySubIdx;
          }
        }

        subCol += colspan;
        firstHeaderColOffset += colspan;
      });
    }
  } catch {
    // 헤더 파싱 실패 → 기본값 사용
  }

  return { foreignNetIdx, institutionNetIdx };
}

// ── 데이터 페치 ───────────────────────────────────────────────────────────────

/**
 * Naver Finance 투자자별 매매동향 HTML 파싱
 *
 * 데이터 소스: https://finance.naver.com/item/frgn.naver?code={code}
 * 인코딩: EUC-KR → iconv-lite로 UTF-8 변환
 *
 * @remarks
 * 실전 활용 주의사항:
 * - 외국인 순매수 연속 3일 이상 + 거래량 증가 조합이 가장 신뢰도 높은 수급 신호다.
 * - 기관은 단기 매매가 잦으므로 5일 누적 방향성으로 판단해야 한다.
 * - 프로그램 매매 비중이 높은 선물만기일 전후에는 수급 신호가 왜곡될 수 있다.
 * - 슬리피지 방어: 수급 신호가 확인된 직후 시장가 매수는 피하고, 호가창으로 스프레드 확인 후 지정가 사용.
 */
async function fetchFromNaverHtml(code: string): Promise<InvestorDayData[]> {
  const url = `https://finance.naver.com/item/frgn.naver?code=${code}`;

  const res = await axios.get<ArrayBuffer>(url, {
    headers: {
      "User-Agent":      DESKTOP_UA,
      "Referer":         "https://finance.naver.com/",
      "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    },
    responseType: "arraybuffer",
    timeout: 8000,
  });

  // Naver Finance 페이지는 EUC-KR 인코딩 — iconv-lite로 UTF-8 변환
  const html = iconv.decode(Buffer.from(res.data), "EUC-KR");
  const $    = cheerio.load(html);

  // 헤더에서 외국인/기관 순매수 열 인덱스 동적 탐지
  const { foreignNetIdx, institutionNetIdx } = detectColumnIndices($);

  const days: InvestorDayData[] = [];

  $("table.type2 tbody tr").each((_i, row) => {
    const tds = $(row).find("td");
    if (tds.length < Math.max(foreignNetIdx, institutionNetIdx) + 1) return;

    const dateText = $(tds[0]).text().trim();
    if (!DATE_RE.test(dateText)) return; // 날짜 형식이 아닌 행(구분선 등) 스킵

    const date           = parseNaverDate(dateText);
    const foreign_net    = parseNaverNum($(tds[foreignNetIdx]).text());
    const institution_net = parseNaverNum($(tds[institutionNetIdx]).text());

    days.push({ date, foreign_net, institution_net });

    if (days.length >= 5) return false; // cheerio: false를 반환하면 each 중단
  });

  // Naver Finance 테이블은 최신→오래된 순이므로 역순으로 정렬
  return days.reverse();
}

// ── L1 메모리 캐시 (1시간 TTL) ───────────────────────────────────────────────

const _l1 = new Map<string, { data: InvestorTrendResult; exp: number }>();
const TTL_MS = 3_600_000;

// ── InvestorTrendService ──────────────────────────────────────────────────────

export class InvestorTrendService {
  private static async l2Get(key: string): Promise<InvestorTrendResult | null> {
    try {
      const { data } = await supabase
        .from("quote_cache")
        .select("data, expires_at")
        .eq("key", key)
        .single();
      if (!data) return null;
      if (new Date(data.expires_at) <= new Date()) return null;
      return data.data as InvestorTrendResult;
    } catch {
      return null;
    }
  }

  private static async l2Set(key: string, value: InvestorTrendResult): Promise<void> {
    try {
      const expires_at = new Date(Date.now() + TTL_MS).toISOString();
      await supabase.from("quote_cache").upsert({ key, data: value, expires_at });
    } catch { /* 캐시 쓰기 실패 무시 */ }
  }

  /**
   * 종목의 최근 5영업일 투자자별 순매수 데이터 반환 (국내 6자리 코드 전용)
   * 단위: 천주 (shares ÷ 1000)
   */
  static async getTrend(ticker: string): Promise<InvestorTrendResult | null> {
    if (!KR_CODE.test(ticker)) return null;

    const key = `investor-trend-v2:${ticker}`;

    // L1 캐시
    const l1 = _l1.get(key);
    if (l1 && Date.now() < l1.exp) return l1.data;

    // L2 캐시
    const l2 = await InvestorTrendService.l2Get(key);
    if (l2) {
      _l1.set(key, { data: l2, exp: Date.now() + TTL_MS });
      return l2;
    }

    // 실데이터 조회
    let days: InvestorDayData[] = [];
    try {
      days = await fetchFromNaverHtml(ticker);
    } catch (e) {
      console.error(`[InvestorTrend] frgn.naver 파싱 실패 [${ticker}]:`, e);
    }

    const result: InvestorTrendResult = { ticker, days };
    // 실패(빈 결과)는 캐싱하지 않는다 — 일시 장애를 1시간 동안 "수급 없음"으로
    // 고착시켜, 다음 요청이 정상 복구돼도 캐시가 빈 값을 계속 돌려줬다.
    if (days.length > 0) {
      _l1.set(key, { data: result, exp: Date.now() + TTL_MS });
      void InvestorTrendService.l2Set(key, result);
    }

    return result;
  }
}
