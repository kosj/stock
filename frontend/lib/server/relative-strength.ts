import type { CandleData } from "./yahoo-finance";

// ── 상대 강도(Relative Strength) 계산 ────────────────────────────────────────

/** RS 시계열 데이터 포인트 (차트 오버레이용) */
export interface RSPoint {
  time: string;
  value: number; // 기준=100 정규화 상대 강도
}

export interface RelativeStrengthResult {
  /** 종목 1개월 누적 수익률 (%) */
  stock_return_1m: number;
  /** 벤치마크(KOSPI) 1개월 누적 수익률 (%) */
  index_return_1m: number;
  /** 상대 강도 비율 (종목 / 지수 × 100, 기준=100) */
  rs_ratio: number;
  /** 시장 초과 수익 여부 */
  is_outperformer: boolean;
  /** 기준=100 정규화 RS 시계열 — 차트 오버레이에서 종목이 KOSPI 대비 얼마나 강한지 표시 */
  rs_series: RSPoint[];
}

/**
 * 종목 vs 벤치마크 지수 상대 강도 계산 (순수 함수)
 *
 * 계산 방식:
 * - 누적 수익률: (P[t] / P[0] - 1) × 100
 * - RS 비율: (1 + 종목수익률/100) / (1 + 지수수익률/100) × 100
 * - RS > 100 → 시장 초과 수익 (Outperformer)
 *
 * @remarks
 * 실전 활용 주의사항:
 * - RS가 100을 막 넘었다고 즉시 진입하지 말 것. 거래량 필터링으로
 *   수급을 확인 후 진입해야 슬리피지와 허위 신호를 방어할 수 있다.
 * - KOSPI 대비 +3% 이상 초과 수익이 5거래일 이상 지속될 때 추세가
 *   확인된 Outperformer로 본다 (단기 변동성 노이즈 제거).
 * - 거래량이 평균의 50% 미만인 날의 RS 상승은 신뢰도가 낮다.
 *
 * @param stockCandles - 종목 일봉 데이터 (시간순 정렬)
 * @param indexCandles - 지수 일봉 데이터 (^KS11 KOSPI, 시간순 정렬)
 * @returns RS 계산 결과 또는 데이터 부족 시 null
 */
export function calculateRelativeStrength(
  stockCandles: CandleData[],
  indexCandles: CandleData[],
): RelativeStrengthResult | null {
  if (stockCandles.length < 5 || indexCandles.length < 5) return null;

  // 지수 날짜 맵 — 두 시계열의 거래일이 완전히 일치하지 않을 수 있음
  const indexMap = new Map(indexCandles.map((c) => [c.time, c.close]));

  // 공통 거래일만 사용 (거래정지·공휴일 차이 방어)
  const matched = stockCandles
    .filter((c) => indexMap.has(c.time))
    .map((c) => ({ time: c.time, stock: c.close, index: indexMap.get(c.time)! }));

  if (matched.length < 5) return null;

  const base = matched[0];

  // 1개월(약 21 거래일) 구간 추출 — 최근 21개 봉 기준
  const oneMonthStart = Math.max(0, matched.length - 21);
  const window = matched.slice(oneMonthStart);

  if (window.length < 2) return null;

  const winBase = window[0];
  const winLast = window[window.length - 1];

  const stock_return_1m = ((winLast.stock - winBase.stock) / winBase.stock) * 100;
  const index_return_1m = ((winLast.index - winBase.index) / winBase.index) * 100;

  // 상대 강도 비율: 종목 누적 수익이 지수 대비 어느 정도인지
  // 종목 +10% / 지수 +5% → RS = (1.10 / 1.05) × 100 ≈ 104.8
  const rs_ratio = ((1 + stock_return_1m / 100) / (1 + index_return_1m / 100)) * 100;
  const is_outperformer = stock_return_1m > index_return_1m;

  // 전체 기간 RS 시계열 — 차트 오버레이용 (기준=100)
  const rs_series: RSPoint[] = matched.map((d) => ({
    time: d.time,
    value:
      ((d.stock / base.stock) /
        (d.index / base.index)) *
      100,
  }));

  return { stock_return_1m, index_return_1m, rs_ratio, is_outperformer, rs_series };
}
