import type { CandleData } from "./yahoo-finance";

// ── 내부 유틸 ────────────────────────────────────────────────────────────────

function sma(arr: number[], w: number): (number | null)[] {
  return arr.map((_, i) => {
    if (i < w - 1) return null;
    return arr.slice(i - w + 1, i + 1).reduce((a, b) => a + b, 0) / w;
  });
}

// ── 타입 정의 ────────────────────────────────────────────────────────────────

export type StopSignalType = "ma20_breakdown" | "bear_volume_spike" | "sustained_selling";

export interface StopLossSignal {
  type: StopSignalType;
  triggered: boolean;
  label: string;
  value: string;
  description: string;
  severity: "high" | "medium" | "low";
  /** 상세 수치 (카드 표시용) */
  detail?: Record<string, string | number>;
}

export interface StopLossResult {
  ticker: string;
  triggered_count: number;
  signals: StopLossSignal[];
  recommendation: "hold" | "caution" | "consider_stop" | "stop";
  summary: string;
  /** 20일선 현재값 */
  ma20: number | null;
  /** 현재가의 20일선 대비 위치 (%) — 음수면 하향 이탈 */
  ma20_distance_pct: number | null;
  /** 최근 최대 거래량/평균 비율 */
  max_volume_ratio: number | null;
  /** 연속 하락일 수 */
  consecutive_down_days: number;
  insufficient_data: boolean;
}

// ── Signal 1: 20일 이동평균선 하향 이탈 ────────────────────────────────────

function checkMa20Breakdown(candles: CandleData[]): StopLossSignal & {
  ma20: number | null;
  ma20_distance_pct: number | null;
} {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const ma20Arr = sma(closes, 20);

  const currentMa20 = ma20Arr[n - 1];
  const prevMa20    = ma20Arr[n - 2];
  const current     = closes[n - 1];
  const prev        = closes[n - 2];

  if (currentMa20 == null) {
    return {
      type: "ma20_breakdown",
      triggered: false,
      label: "20일선 하향 이탈",
      value: "-",
      description: "데이터 부족",
      severity: "low",
      ma20: null,
      ma20_distance_pct: null,
    };
  }

  const distPct = ((current - currentMa20) / currentMa20) * 100;
  const triggered = distPct <= -2.0;

  // 당일 이탈 여부: 전일 종가가 20일선 위 또는 근접(±1%)에 있었는지
  const freshBreak =
    prevMa20 != null && prev >= prevMa20 * 0.99 && triggered;

  return {
    type: "ma20_breakdown",
    triggered,
    label: "20일선 하향 이탈",
    value: `${distPct.toFixed(1)}%`,
    description: triggered
      ? `20일선(${Math.round(currentMa20).toLocaleString()}원) 대비 ${distPct.toFixed(1)}% 이탈${freshBreak ? " — 당일 신규 이탈" : " — 이탈 지속 중"}`
      : distPct <= 0
      ? `20일선 근접 (${distPct.toFixed(1)}%) — 이탈 기준(-2%) 미도달`
      : `20일선 위 +${distPct.toFixed(1)}% — 정상 구간`,
    severity: distPct <= -4 ? "high" : "medium",
    detail: {
      "20일선": Math.round(currentMa20),
      "현재가": Math.round(current),
      "이격도": `${distPct.toFixed(1)}%`,
    },
    ma20: Math.round(currentMa20 * 10) / 10,
    ma20_distance_pct: Math.round(distPct * 10) / 10,
  };
}

// ── Signal 2: 음봉 거래량 급증 ──────────────────────────────────────────────

function checkBearVolumeSpike(candles: CandleData[]): StopLossSignal & {
  max_volume_ratio: number | null;
} {
  const n = candles.length;
  const volumes = candles.map((c) => c.volume);
  const volMa20 = sma(volumes, 20);

  let maxRatio = 0;
  let maxRatioIdx = -1;

  // 최근 5봉 중 음봉 거래량 폭증 탐색
  for (let i = Math.max(0, n - 5); i < n; i++) {
    const c = candles[i];
    const isBear = c.close < c.open;           // 음봉
    const avgVol = volMa20[i];
    if (!isBear || avgVol == null || avgVol <= 0) continue;

    const ratio = c.volume / avgVol;
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxRatioIdx = i;
    }
  }

  const triggered = maxRatio >= 2.0 && maxRatioIdx >= 0;
  const daysAgo = maxRatioIdx >= 0 ? n - 1 - maxRatioIdx : null;

  return {
    type: "bear_volume_spike",
    triggered,
    label: "음봉 거래량 급증",
    value: maxRatio > 0 ? `${maxRatio.toFixed(1)}배` : "-",
    description: triggered
      ? `하락 캔들에서 평균 거래량 ${maxRatio.toFixed(1)}배 폭증${daysAgo === 0 ? " (당일)" : daysAgo != null ? ` (${daysAgo}일 전)` : ""} — 대량 매도 발생`
      : "비정상적 음봉 거래량 없음",
    severity: maxRatio >= 3.0 ? "high" : "medium",
    detail: {
      "최대 비율": maxRatio > 0 ? `${maxRatio.toFixed(1)}배` : "-",
      "기준": "20일 평균 대비",
    },
    max_volume_ratio: maxRatio > 0 ? Math.round(maxRatio * 10) / 10 : null,
  };
}

// ── Signal 3: 연속 대량 매도 (메이저 수급 이탈 근사) ───────────────────────
//
// 실제 외국인/기관 데이터가 없으므로 price+volume 패턴으로 근사:
// - 종가 하락 + 음봉 + 거래량 ≥ MA20 * 1.5 → "기관성 매도일"
// - 이 조건을 3일 연속 충족하면 트리거

function checkSustainedSelling(candles: CandleData[]): StopLossSignal & {
  consecutive_down_days: number;
} {
  const closes  = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const n = closes.length;

  const volMa20 = sma(volumes, 20);

  // 연속 하락 + 고거래량 일수 계산 (최근부터 역방향)
  let consecutiveDown = 0;
  let heavyVolumeCount = 0;

  for (let i = n - 1; i >= Math.max(1, n - 7); i--) {
    const c = candles[i];
    const isDown  = c.close < closes[i - 1];    // 전일 대비 하락
    const isBear  = c.close < c.open;           // 음봉
    const avgVol  = volMa20[i];
    const isHeavy = avgVol != null && c.volume >= avgVol * 1.5;

    if (isDown && isBear) {
      consecutiveDown++;
      if (isHeavy) heavyVolumeCount++;
    } else {
      break; // 연속 끊기면 중단
    }
  }

  // 3일 이상 연속 + 그 중 2일 이상 고거래량
  const triggered = consecutiveDown >= 3 && heavyVolumeCount >= 2;

  return {
    type: "sustained_selling",
    triggered,
    label: "연속 대량 매도",
    value: consecutiveDown > 0 ? `${consecutiveDown}일 연속` : "-",
    description: triggered
      ? `${consecutiveDown}일 연속 하락 (고거래량 ${heavyVolumeCount}일) — 메이저 수급 이탈 패턴`
      : consecutiveDown >= 2
      ? `${consecutiveDown}일 연속 하락 중 — 추이 주시 필요`
      : "연속 매도 압력 없음",
    severity: consecutiveDown >= 4 ? "high" : "medium",
    detail: {
      "연속 하락": `${consecutiveDown}일`,
      "고거래량 하락": `${heavyVolumeCount}일`,
    },
    consecutive_down_days: consecutiveDown,
  };
}

// ── 메인 분석 함수 ───────────────────────────────────────────────────────────

export function analyzeStopLoss(
  ticker: string,
  candles: CandleData[],
): StopLossResult {
  if (candles.length < 25) {
    return {
      ticker,
      triggered_count: 0,
      signals: [],
      recommendation: "hold",
      summary: "데이터 부족",
      ma20: null,
      ma20_distance_pct: null,
      max_volume_ratio: null,
      consecutive_down_days: 0,
      insufficient_data: true,
    };
  }

  const { ma20, ma20_distance_pct, ...ma20Signal }      = checkMa20Breakdown(candles);
  const { max_volume_ratio, ...volSpikeSignal }         = checkBearVolumeSpike(candles);
  const { consecutive_down_days, ...sustainedSignal }   = checkSustainedSelling(candles);

  const signals: StopLossSignal[] = [ma20Signal, volSpikeSignal, sustainedSignal];
  const triggeredCount = signals.filter((s) => s.triggered).length;

  let recommendation: StopLossResult["recommendation"];
  if (triggeredCount === 0)      recommendation = "hold";
  else if (triggeredCount === 1) recommendation = "caution";
  else if (triggeredCount === 2) recommendation = "consider_stop";
  else                            recommendation = "stop";

  const triggeredLabels = signals.filter((s) => s.triggered).map((s) => s.label);

  const summary =
    triggeredCount === 0
      ? "손절 시그널 없음 — 정상 추세 유지 중"
      : triggeredCount === 1
      ? `경계 시그널: ${triggeredLabels[0]}`
      : `${triggeredCount}개 손절 시그널 동시 발생 — 즉각 손절 검토 권고 (${triggeredLabels.join(", ")})`;

  return {
    ticker,
    triggered_count: triggeredCount,
    signals,
    recommendation,
    summary,
    ma20,
    ma20_distance_pct,
    max_volume_ratio,
    consecutive_down_days,
    insufficient_data: false,
  };
}
