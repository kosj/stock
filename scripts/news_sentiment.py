#!/usr/bin/env python3
"""
news_sentiment.py — 이벤트 드리븐 뉴스 감성 분석 (Hugging Face Inference API)
============================================================================
hybrid_ensemble.py(일간 추천 엔진)에 결합되는 보조 알파 신호.

설계 원칙 (frontend/lib/server/news-sentiment.ts 와 동일 사양):
  ✗ 로컬에서 transformers 모델을 로드하지 않는다(CI/서버리스 용량·메모리 보호).
  ✓ 추론은 Hugging Face Inference API에 위임(requests.post)한다.
  - 모델: snunlp/KR-FinBert-SC (한국어 금융 도메인 긍정/중립/부정 3-class)

파이프라인 (종목별):
  1) Naver Finance 종목 뉴스 헤드라인 크롤링 (EUC-KR 디코딩)
  2) HF Inference API → 헤드라인별 라벨-확률 분포
  3) 극성(polarity) = P(긍정) − P(부정) ∈ [-1, +1], 헤드라인 평균 = 당일 점수
  4) Supabase news_sentiment 테이블 영속화 → 최근 3거래일 이동평균(sentiment_3d_ma)

신뢰성:
  뉴스는 보조 팩터이므로 어떤 단계가 실패해도 예외를 전파하지 않고
  중립(0.0)으로 graceful degrade 한다(메인 추천 파이프라인 가용성 우선).

동시성:
  ThreadPoolExecutor로 종목별 I/O(크롤링·HF·DB)를 병렬화하되 max_workers로
  동시 요청 수를 제한한다(Naver/HF rate-limit 회피). TS의 mapWithConcurrency 대응.
"""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import requests

try:
    from bs4 import BeautifulSoup  # requirements.txt: beautifulsoup4
except ImportError:  # bs4 미설치 시에도 import 자체는 실패하지 않도록(감성=중립으로 비활성화)
    BeautifulSoup = None  # type: ignore

# ── 설정 상수 ─────────────────────────────────────────────────────────────────

# HF Inference 엔드포인트 베이스.
# 레거시 api-inference.huggingface.co는 폐기(410/DNS 소멸) → router로 이전됨.
# 형식: https://router.huggingface.co/hf-inference/models/{model}
# env HF_INFERENCE_ENDPOINT로 전체 URL 오버라이드 가능(아래 __init__ 참조).
HF_API_BASE   = "https://router.huggingface.co/hf-inference/models/"
DEFAULT_MODEL = "snunlp/KR-FinBert-SC"

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

MAX_HEADLINES  = 12      # 종목당 분석 헤드라인 수(HF 비용·지연 제어)
CRAWL_TIMEOUT  = 5       # 크롤링 타임아웃(초)
# HF 추론 타임아웃: (connect, read) 튜플.
# read를 충분히 길게(25s) 잡는 이유 — wait_for_model=True로 서버가 모델 콜드스타트
# (로딩)을 기다리는 동안 응답을 보류하므로, 8s 같은 짧은 read timeout은 로딩 완료
# 전에 클라이언트가 먼저 끊어 ReadTimeout을 유발한다(router.huggingface.co Read
# timed out 의 근본 원인). connect는 빠른 실패를 위해 짧게 유지.
HF_CONNECT_TIMEOUT = 5
HF_READ_TIMEOUT    = 25
HF_TIMEOUT         = (HF_CONNECT_TIMEOUT, HF_READ_TIMEOUT)
HF_RETRIES         = 2   # 503(모델 로딩)/타임아웃 등 재시도 횟수
MA_WINDOW          = 3   # sentiment_3d_ma 윈도우(당일 포함 거래일)


# ── 극성 라벨 → 부호 매핑 ──────────────────────────────────────────────────────

def _label_sign(label: str) -> int:
    """
    HF 분류 라벨을 금융 극성 부호(+1 호재 / 0 중립 / -1 악재)로 변환.

    snunlp/KR-FinBert-SC는 보통 positive/neutral/negative 문자열을 반환하나
    일부 배포본은 LABEL_0/1/2 형태를 줄 수 있어 둘 다 처리한다.
    (LABEL_n 순서는 0=부정, 1=중립, 2=긍정 가정 — 운영 전 실제 응답 1회 검증 권장)
    """
    l = label.lower().strip()
    if "pos" in l or "긍정" in l or "호재" in l:
        return 1
    if "neg" in l or "부정" in l or "악재" in l:
        return -1
    if "neu" in l or "중립" in l:
        return 0
    if l == "label_2":
        return 1
    if l == "label_0":
        return -1
    return 0


def _dist_to_polarity(dist: list) -> float:
    """
    단일 헤드라인의 라벨-확률 분포 → 극성 점수 ∈ [-1, +1].

    수식:  score = Σ_label sign(label) × P(label) = P(긍정) − P(부정)
    확률 가중이므로 결과는 항상 [-1, +1]에 수렴하며, 확신도가 낮은(분포가 평평한)
    헤드라인은 0 근처로 수축되어 과잉 신호를 억제한다.
    """
    s = 0.0
    for item in dist:
        try:
            s += _label_sign(str(item["label"])) * float(item["score"])
        except (KeyError, TypeError, ValueError):
            continue
    return max(-1.0, min(1.0, s))


# ── 서비스 본체 ────────────────────────────────────────────────────────────────

class NewsSentimentService:
    """뉴스 감성 분석 서비스. Supabase PostgREST + HF Inference API 사용."""

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        endpoint: Optional[str] = None,
    ) -> None:
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_key = supabase_key
        self.api_key = api_key or os.environ.get("HUGGINGFACE_API_KEY") or os.environ.get("HF_API_TOKEN")
        self.model = model or DEFAULT_MODEL
        # 우선순위: 명시 옵션 > env 오버라이드 > 레거시 베이스+model
        self.endpoint = endpoint or os.environ.get("HF_INFERENCE_ENDPOINT") or f"{HF_API_BASE}{self.model}"
        self.enabled = bool(self.api_key) and BeautifulSoup is not None

    # ── 크롤링 ──────────────────────────────────────────────────────────────
    def _crawl_headlines(self, ticker: str, limit: int) -> list:
        """
        Naver Finance 종목 뉴스 헤드라인 크롤링.
        소스: https://finance.naver.com/item/news_news.naver?code={code}
        인코딩: EUC-KR → 한글 보존(추론 정확도 직결).
        """
        url = f"https://finance.naver.com/item/news_news.naver?code={ticker}&page=1"
        resp = requests.get(
            url,
            headers={
                "User-Agent":      DESKTOP_UA,
                "Referer":         f"https://finance.naver.com/item/news.naver?code={ticker}",
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
            },
            timeout=CRAWL_TIMEOUT,
        )
        resp.encoding = "euc-kr"  # Naver Finance 역사적 인코딩
        soup = BeautifulSoup(resp.text, "html.parser")

        seen, headlines = set(), []
        for a in soup.select("td.title a, .title a, dd.articleSubject a"):
            text = " ".join(a.get_text().split()).strip()
            if len(text) < 4 or "연관기사" in text or text in seen:
                continue
            seen.add(text)
            headlines.append(text)
            if len(headlines) >= limit:
                break
        return headlines

    # ── HF 추론 ─────────────────────────────────────────────────────────────
    def _classify(self, headlines: list) -> list:
        """
        HF Inference API로 헤드라인 배치 분류 → 헤드라인별 극성 점수 리스트.
        요청 body: {"inputs": [...], "options": {"wait_for_model": true}}
        응답: 배치 text-classification → list[list[{label, score}]]
        """
        if not headlines:
            return []
        if not self.api_key:
            raise RuntimeError("HUGGINGFACE_API_KEY 미설정")

        payload = {"inputs": headlines, "options": {"wait_for_model": True}}
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        last_err: Optional[Exception] = None
        for attempt in range(HF_RETRIES + 1):
            try:
                r = requests.post(self.endpoint, headers=headers, json=payload, timeout=HF_TIMEOUT)
                if r.status_code == 503 and attempt < HF_RETRIES:
                    time.sleep(1.5 * (attempt + 1))  # 모델 로딩 대기 백오프
                    continue
                r.raise_for_status()
                return self._normalize(r.json(), len(headlines))
            except requests.exceptions.Timeout as exc:
                # 콜드스타트로 read timeout 시: 지수 백오프 후 재시도(다음 시도엔
                # 모델이 warm 되어 있을 가능성 ↑). connect/read 양쪽 모두 포괄.
                last_err = exc
                if attempt < HF_RETRIES:
                    time.sleep(2.0 * (2 ** attempt))  # 2s, 4s
            except Exception as exc:  # noqa: BLE001 — 그 외 오류도 마지막 시도까지 재시도
                last_err = exc
                if attempt < HF_RETRIES:
                    time.sleep(0.8 * (attempt + 1))
        raise last_err if last_err else RuntimeError("HF 분류 실패")

    @staticmethod
    def _normalize(raw, expected_len: int) -> list:
        """HF 응답을 헤드라인별 극성 점수 리스트로 정규화(배치/단일 형태 모두 수용)."""
        if isinstance(raw, list) and raw and isinstance(raw[0], list):
            scores = [_dist_to_polarity(d) for d in raw]
            scores += [0.0] * (expected_len - len(scores))
            return scores[:expected_len]
        if isinstance(raw, list) and raw and isinstance(raw[0], dict) and "label" in raw[0]:
            return [_dist_to_polarity(raw)]
        return [0.0] * expected_len

    # ── Supabase 영속화 + 이동평균 ───────────────────────────────────────────
    def _persist_and_ma(self, ticker: str, run_date: str, today_score: float, count: int) -> float:
        """
        당일 점수를 news_sentiment에 upsert 후 최근 MA_WINDOW 거래일 평균을 반환.

        sentiment_3d_ma: 당일 포함 직전 3거래일 sentiment_score 단순 평균.
        단일 헤드라인 급등락/오보로 인한 점프를 평활(smoothing)하여
        스코어 틸트가 일일 노이즈에 과민 반응하지 않게 한다.
        DB 접근 실패 시 당일 점수로 graceful degrade.
        """
        base = f"{self.supabase_url}/rest/v1/news_sentiment"
        headers = {
            "apikey":        self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type":  "application/json",
        }
        try:
            # upsert (PK: run_date,ticker)
            requests.post(
                f"{base}?on_conflict=run_date,ticker",
                headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                json=[{
                    "run_date":        run_date,
                    "ticker":          ticker,
                    "sentiment_score": round(today_score, 4),
                    "headline_count":  count,
                }],
                timeout=10,
            )
            # 최근 N거래일(당일 포함) 조회 → 평균
            g = requests.get(
                f"{base}?ticker=eq.{ticker}&select=sentiment_score"
                f"&order=run_date.desc&limit={MA_WINDOW}",
                headers=headers,
                timeout=10,
            )
            if g.ok:
                vals = [float(row["sentiment_score"]) for row in g.json()]
                if vals:
                    return sum(vals) / len(vals)
        except Exception:  # noqa: BLE001 — 테이블 부재/네트워크 오류 → 폴백
            pass
        return today_score

    # ── 단일/배치 진입점 ─────────────────────────────────────────────────────
    def get_sentiment(self, ticker: str, run_date: str) -> dict:
        """단일 종목 감성 분석. 실패해도 예외 없이 중립(0.0) 결과 반환."""
        neutral = {"ticker": ticker, "score": 0.0, "ma3": 0.0, "count": 0, "ok": False}
        if not self.enabled:
            return neutral
        try:
            headlines = self._crawl_headlines(ticker, MAX_HEADLINES)
            if not headlines:
                return neutral
            polarities = self._classify(headlines)
            if not polarities:
                return neutral
            score = sum(polarities) / len(polarities)
            ma3 = self._persist_and_ma(ticker, run_date, score, len(headlines))
            return {"ticker": ticker, "score": score, "ma3": ma3, "count": len(headlines), "ok": True}
        except Exception as exc:  # noqa: BLE001
            print(f"  [news] {ticker} 감성 분석 실패: {exc}")
            return neutral

    def get_sentiment_batch(self, tickers: list, run_date: str, concurrency: int = 8) -> dict:
        """
        여러 종목을 동시성 제어하에 배치 분석 → {ticker: result} 매핑.
        HF 키 미설정/bs4 미설치 시 즉시 전 종목 중립 반환(불필요한 크롤링 생략).
        """
        if not self.enabled:
            why = "HUGGINGFACE_API_KEY 미설정" if not self.api_key else "beautifulsoup4 미설치"
            print(f"  [news] 감성 분석 비활성화({why}) → 전 종목 중립(0.0)")
            return {t: {"ticker": t, "score": 0.0, "ma3": 0.0, "count": 0, "ok": False} for t in tickers}

        results: dict = {}
        with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
            futs = {ex.submit(self.get_sentiment, t, run_date): t for t in tickers}
            for fut in as_completed(futs):
                t = futs[fut]
                try:
                    results[t] = fut.result()
                except Exception:  # noqa: BLE001
                    results[t] = {"ticker": t, "score": 0.0, "ma3": 0.0, "count": 0, "ok": False}
        return results
