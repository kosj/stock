/**
 * ETF 당일 종가 수집 모듈
 *
 * 현재: Yahoo Finance(getChart) 기반 가상 구현
 * 교체 방법: 이 파일의 fetchTodayPrice() 내부만 증권사 API 호출로 교체
 *           → Cron Job(update-etf/route.ts)은 수정 불필요
 *
 * 반환값:
 *   number  - 정상 종가
 *   null    - 데이터 없음 / 오류 (Cron이 해당 종목 skip)
 */

import { getChart } from "./yahoo-finance";

/**
 * 특정 종목의 오늘자 종가를 가져온다.
 *
 * @param ticker  종목 코드 (예: "091160")
 * @returns       종가(원) 또는 null
 */
export async function fetchTodayPrice(ticker: string): Promise<number | null> {
  try {
    // ── Yahoo Finance로 최근 5일 캔들 조회 ───────────────────────────────────
    // "5d" range로 최소 데이터만 가져와 비용(latency) 절감
    // 실제 증권사 API 연결 시 이 블록을 교체:
    //   예) KIS: const res = await fetch(`https://openapi.koreainvestment.com/...`)
    //   예) eBest: const res = await axios.post('https://openapi.ebestsec.co.kr/...')
    const candles = await getChart(ticker, "5d");

    if (!candles || candles.length === 0) return null;

    // 가장 최근 거래일 종가
    const latest = candles[candles.length - 1];
    return latest.close ?? null;

  } catch (err) {
    console.error(`[fetchTodayPrice] ${ticker} 오류:`, err);
    return null;
  }
}
