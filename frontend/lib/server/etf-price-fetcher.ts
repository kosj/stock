/**
 * ETF 종가 수집 모듈
 *
 * 현재: Yahoo Finance(getChart) 기반 구현
 * 교체 방법: 이 파일의 fetch 함수 내부만 증권사 API 호출로 교체
 *           → Cron Job(update-etf/route.ts)은 수정 불필요
 *
 * 반환값:
 *   fetchTodayPrice    number | null   - 당일 종가(없으면 null)
 *   fetchRecentCloses  {date, close}[] - 최근 영업일별 종가(없으면 [])
 */

import { getChart } from "./yahoo-finance";

export interface DailyClose {
  date:  string;   // "YYYY-MM-DD"
  close: number;
}

/**
 * 특정 종목의 최근 영업일별 종가를 가져온다.
 *
 * 섹터 1개월(20영업일) 수익률 계산에는 20일+ 히스토리가 필요하므로,
 * 당일 1건만 적재하면 데이터가 쌓이기 전까지 "1일 수익률"로 degrade된다.
 * 따라서 매 수집 시 최근 구간(기본 3개월 ≈ 60영업일)을 통째로 가져와
 * etf_daily_prices에 백필(upsert)한다. upsert는 (etf_id, date) 멱등이라 안전.
 *
 * @param ticker  종목 코드 (예: "091160")
 * @param period  조회 구간 (getChart 지원: "5d","1m","3m","6m","1y" ...)
 * @returns       날짜 오름차순 종가 배열 또는 []
 */
export async function fetchRecentCloses(
  ticker: string,
  period = "3m",
): Promise<DailyClose[]> {
  try {
    const candles = await getChart(ticker, period);
    if (!candles || candles.length === 0) return [];

    return candles
      .filter((c) => c.close != null && c.time)
      .map((c) => ({ date: c.time.slice(0, 10), close: c.close }));
  } catch (err) {
    console.error(`[fetchRecentCloses] ${ticker} 오류:`, err);
    return [];
  }
}

/**
 * 특정 종목의 당일(최근 거래일) 종가를 가져온다.
 *
 * @param ticker  종목 코드 (예: "091160")
 * @returns       종가(원) 또는 null
 */
export async function fetchTodayPrice(ticker: string): Promise<number | null> {
  const closes = await fetchRecentCloses(ticker, "5d");
  if (closes.length === 0) return null;
  return closes[closes.length - 1].close ?? null;
}
