/**
 * ATR(Average True Range) — 단일 구현.
 *
 * 예전엔 position-manager-service(VolatilityCalculator)와 prophet-forecast 가 TR 계산과
 * 클램프 상수를 각자 들고 있었다. 값은 같았지만, 한쪽만 바뀌면 포지션 화면의 손절선과
 * 종목 예측 화면의 시나리오 폭이 서로 다른 변동성을 쓰게 된다. 여기 하나로 모은다.
 *
 * 정의: ATR = 최근 period 개 True Range 의 단순평균.
 *   TR[i] = max(High−Low, |High−PrevClose|, |Low−PrevClose|)
 * Wilder 평활이 아니라 단순평균이다(기존 두 구현이 모두 그랬다 — 값을 바꾸지 않는다).
 *
 * 데이터 부족 시 폴백 값은 호출부마다 다르며 여기서 정하지 않는다:
 *   VolatilityCalculator  → ATR_PCT_FLOOR(0.5%)   손절 계산
 *   prophet-forecast      → 3.0%                  예측 시나리오 폭
 * 의도된 차이인지 기록이 없어 각자 유지하고 이름 붙은 상수로 드러내 둔다.
 */

/**
 * ATR 계산 윈도우 (거래일 수)
 * Wilder의 원조 정의와 업계 표준을 따라 14일로 설정.
 * 14거래일 ≈ 약 3주 = 단기 변동성의 통계적 대표 구간.
 */
export const ATR_PERIOD = 14;

/**
 * ATR% 하한 클램핑 (%)
 * 초저변동성 종목(국채·우선주 등)에서 ATR%가 0.1% 수준으로 나오면
 * stopLoss가 -0.2%가 되어 장중 노이즈에도 즉시 발동되는 문제 방지.
 * 한국 대형 KOSPI 우량주의 최소 일평균 변동폭 ≈ 0.5%.
 */
export const ATR_PCT_FLOOR = 0.5;

/**
 * ATR% 상한 클램핑 (%)
 * 초고변동성 종목(코스닥 소형주·테마주)에서 ATR%가 15% 이상 나오면
 * stopLoss가 -30%가 되어 사실상 손절 불가 포지션이 되는 문제 방지.
 * 합리적 리스크 관리 가능한 최대 변동성 상한선.
 */
export const ATR_PCT_CEIL = 12.0;

export interface TrueRangeCandle {
  high?: number | null;
  low?: number | null;
  close: number;
}

/**
 * 최근 period 개 True Range 의 단순평균. 캔들이 2개 미만이면 TR 을 만들 수 없어 null.
 *
 * 캔들이 period+1 개보다 적으면 가용한 TR 전부(= 캔들 수 − 1)를 평균한다.
 * 합산 순서는 오래된 것 → 최근 것으로, 기존 두 구현과 같다(부동소수점 결과 동일).
 *
 * high/low 가 비어 있으면 종가로 대신한다. 기존 prophet 구현의 방식이며,
 * VolatilityCalculator 는 이 경우 NaN 이 되어 손절선이 깨졌다(타입상 숫자라
 * 정상 데이터에서는 두 방식의 결과가 같다).
 */
export function averageTrueRange(
  candles: readonly TrueRangeCandle[],
  period: number = ATR_PERIOD,
): number | null {
  if (candles.length < 2) return null;
  const recent = candles.slice(-(period + 1));
  let sum = 0;
  let count = 0;
  for (let i = 1; i < recent.length; i++) {
    const high = recent[i].high ?? recent[i].close;
    const low = recent[i].low ?? recent[i].close;
    const prevClose = recent[i - 1].close;
    sum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    count++;
  }
  return sum / count;
}

/** ATR% 를 [ATR_PCT_FLOOR, ATR_PCT_CEIL] 로 묶는다. */
export function clampAtrPct(rawPct: number): number {
  return Math.min(ATR_PCT_CEIL, Math.max(ATR_PCT_FLOOR, rawPct));
}
