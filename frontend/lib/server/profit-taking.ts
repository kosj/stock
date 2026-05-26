import type { CandleData } from "./yahoo-finance";

// ── 내부 유틸 ────────────────────────────────────────────────────────────────

function sma(arr: number[], w: number): (number | null)[] {
  return arr.map((_, i) => {
    if (i < w - 1) return null;
    return arr.slice(i - w + 1, i + 1).reduce((a, b) => a + b, 0) / w;
  });
}

function ema(prices: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const result: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calcRsiArr(closes: number[]): (number | null)[] {
  const diffs = closes.map((c, i) => (i === 0 ? 0 : c - closes[i - 1]));
  const gains = diffs.map((d) => Math.max(d, 0));
  const losses = diffs.map((d) => Math.max(-d, 0));
  const avgG = sma(gains, 14);
  const avgL = sma(losses, 14);
  return avgG.map((g, i) => {
    const l = avgL[i];
    if (g == null || l == null) return null;
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  });
}

function calcMacdHist(closes: number[]): number[] {
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const line = e12.map((v, i) => v - e26[i]);
  const sig = ema(line, 9);
  return line.map((v, i) => v - sig[i]);
}

function calcBbUpper(closes: number[]): (number | null)[] {
  return closes.map((_, i) => {
    if (i < 19) return null;
    const slice = closes.slice(i - 19, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / 20;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
    return mean + 2 * std;
  });
}

// ── 타입 정의 ────────────────────────────────────────────────────────────────

export type SignalType = "resistance_proximity" | "overbought" | "divergence" | "upper_wick";

export interface ProfitTakingSignal {
  type: SignalType;
  triggered: boolean;
  label: string;
  value: string;
  description: string;
  severity: "high" | "medium" | "low";
}

export interface ProfitTakingResult {
  ticker: string;
  triggered_count: number;
  signals: ProfitTakingSignal[];
  recommendation: "hold" | "watch" | "partial_sell" | "sell";
  summary: string;
  resistance_level: number | null;
  resistance_distance_pct: number | null;
  insufficient_data: boolean;
}

// ── Signal 1: 전고점 저항선 이격도 ──────────────────────────────────────────

function checkResistanceProximity(
  candles: CandleData[],
  current: number,
): Pick<ProfitTakingResult, "resistance_level" | "resistance_distance_pct"> & ProfitTakingSignal {
  const n = candles.length;
  const WINDOW = 5;
  // 최소 10개 이후 ~ n-WINDOW 범위에서 피크 탐색
  const candidates: { level: number }[] = [];

  for (let i = WINDOW; i < n - WINDOW; i++) {
    const high = candles[i].high;
    let isPeak = true;
    for (let j = i - WINDOW; j <= i + WINDOW; j++) {
      if (j !== i && candles[j].high >= high) { isPeak = false; break; }
    }
    if (!isPeak) continue;

    // 피크 이후 최소 5% 하락 확인 → 진짜 저항 역할을 했던 고점
    const endIdx = Math.min(n, i + 21);
    const minAfter = Math.min(...candles.slice(i + 1, endIdx).map((c) => c.close));
    if (high - minAfter < high * 0.05) continue;

    candidates.push({ level: high });
  }

  // 현재가 위에 있는 저항선 중 가장 가까운 것
  const above = candidates
    .filter((c) => c.level > current * 1.001) // 현재가보다 최소 0.1% 위
    .sort((a, b) => a.level - b.level);

  if (above.length === 0) {
    return {
      type: "resistance_proximity",
      triggered: false,
      label: "전고점 저항선",
      value: "-",
      description: "유효한 저항선 없음",
      severity: "low",
      resistance_level: null,
      resistance_distance_pct: null,
    };
  }

  const nearest = above[0];
  const distPct = ((nearest.level - current) / current) * 100;
  const triggered = distPct <= 2.0;

  return {
    type: "resistance_proximity",
    triggered,
    label: "전고점 저항선",
    value: `${distPct.toFixed(1)}% 이내`,
    description: triggered
      ? `전고점 저항선(${Math.round(nearest.level).toLocaleString()}원)에 ${distPct.toFixed(1)}% 이내로 근접 — 1차 매도 타점`
      : `저항선까지 ${distPct.toFixed(1)}% 여유`,
    severity: distPct <= 1 ? "high" : "medium",
    resistance_level: nearest.level,
    resistance_distance_pct: Math.round(distPct * 10) / 10,
  };
}

// ── Signal 2: RSI & 볼린저밴드 과매수 ──────────────────────────────────────

function checkOverbought(candles: CandleData[]): ProfitTakingSignal {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const n = closes.length;

  const rsiArr = calcRsiArr(closes);
  const currentRsi = rsiArr[n - 1];
  const bbUpper = calcBbUpper(closes);

  const rsiOverbought = currentRsi != null && currentRsi > 70;

  // BB 역전: 최근 5캔들 중 high가 BB 상단 돌파 후, 최근 종가가 BB 상단 이하로 복귀
  let bbReversal = false;
  const recentWindow = 5;
  const lastBb = bbUpper[n - 1];
  const lastClose = closes[n - 1];
  if (lastBb != null && lastClose < lastBb) {
    for (let j = n - recentWindow; j < n - 1; j++) {
      const bb = bbUpper[j];
      if (bb != null && highs[j] > bb) { bbReversal = true; break; }
    }
  }

  const triggered = rsiOverbought || bbReversal;
  const parts: string[] = [];
  if (rsiOverbought && currentRsi != null) parts.push(`RSI ${currentRsi.toFixed(1)}`);
  if (bbReversal) parts.push("BB 상단 역전");

  return {
    type: "overbought",
    triggered,
    label: "과매수",
    value: parts.join(" · ") || "-",
    description: rsiOverbought
      ? `RSI ${currentRsi!.toFixed(1)} — 과매수 구간 진입${bbReversal ? " + BB 상단 역전" : ""}`
      : bbReversal
      ? "볼린저밴드 상단 돌파 후 내부 복귀 — 매물 소화 시작"
      : `RSI ${currentRsi?.toFixed(1) ?? "-"} — 정상 범위`,
    severity: rsiOverbought && currentRsi != null && currentRsi > 80 ? "high" : "medium",
  };
}

// ── Signal 3: 베어리쉬 다이버전스 ──────────────────────────────────────────

function checkDivergence(candles: CandleData[]): ProfitTakingSignal {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;

  // 최근 40캔들에서 피크(고점) 탐색
  const WINDOW = 3;
  const LOOKBACK = Math.min(40, n - 5);
  const start = n - LOOKBACK;
  const peaks: number[] = [];

  for (let i = start + WINDOW; i < n - WINDOW; i++) {
    const h = highs[i];
    let isPeak = true;
    for (let j = i - WINDOW; j <= i + WINDOW; j++) {
      if (j !== i && highs[j] >= h) { isPeak = false; break; }
    }
    if (isPeak) peaks.push(i);
  }

  if (peaks.length < 2) {
    return {
      type: "divergence",
      triggered: false,
      label: "다이버전스",
      value: "-",
      description: "최근 피크 부족으로 다이버전스 분석 불가",
      severity: "low",
    };
  }

  // 마지막 2개 피크 비교
  const p1 = peaks[peaks.length - 2];
  const p2 = peaks[peaks.length - 1];
  const priceHigher = highs[p2] > highs[p1]; // 가격 고점 상승

  if (!priceHigher) {
    return {
      type: "divergence",
      triggered: false,
      label: "다이버전스",
      value: "-",
      description: "가격 하락 고점 — 다이버전스 미해당",
      severity: "low",
    };
  }

  const macdHist = calcMacdHist(closes);

  // MACD 다이버전스: 가격 고점 상승 but MACD hist 고점 하락
  const macdDivergence = macdHist[p2] < macdHist[p1];

  // 거래량 다이버전스: 가격 고점 상승 but 피크 거래량 감소
  const volDivergence = volumes[p2] < volumes[p1] * 0.85;

  const triggered = macdDivergence || volDivergence;
  const types: string[] = [];
  if (macdDivergence) types.push("MACD");
  if (volDivergence) types.push("거래량");

  return {
    type: "divergence",
    triggered,
    label: "베어리쉬 다이버전스",
    value: types.join(" · ") || "-",
    description: triggered
      ? `${types.join("/")} 베어리쉬 다이버전스 — 상승 연료 고갈 시그널`
      : "다이버전스 없음 — 상승 추세 유효",
    severity: macdDivergence && volDivergence ? "high" : "medium",
  };
}

// ── Signal 4: 윗꼬리 캔들 비율 ─────────────────────────────────────────────

function checkUpperWick(candles: CandleData[]): ProfitTakingSignal {
  const n = candles.length;
  const CHECK_LAST = 3;

  let maxWickRatio = 0;
  let triggerIdx = -1;

  for (let i = n - CHECK_LAST; i < n; i++) {
    const { high, low, open, close } = candles[i];
    const range = high - low;
    if (range < 1e-9) continue;
    const bodyTop = Math.max(open, close);
    const upperWick = high - bodyTop;
    const ratio = upperWick / range;
    if (ratio > maxWickRatio) {
      maxWickRatio = ratio;
      triggerIdx = i;
    }
  }

  const triggered = maxWickRatio >= 0.5 && triggerIdx >= 0;
  const wickPct = Math.round(maxWickRatio * 100);

  return {
    type: "upper_wick",
    triggered,
    label: "윗꼬리 캔들",
    value: maxWickRatio > 0 ? `${wickPct}%` : "-",
    description: triggered
      ? `최근 캔들 윗꼬리 ${wickPct}% — 차익실현 매물 출현`
      : maxWickRatio > 0
      ? `윗꼬리 비율 ${wickPct}% — 미미한 수준`
      : "윗꼬리 데이터 없음",
    severity: maxWickRatio >= 0.7 ? "high" : "medium",
  };
}

// ── 메인 분석 함수 ───────────────────────────────────────────────────────────

export function analyzeProfitTaking(
  ticker: string,
  candles: CandleData[],
): ProfitTakingResult {
  if (candles.length < 30) {
    return {
      ticker,
      triggered_count: 0,
      signals: [],
      recommendation: "hold",
      summary: "데이터 부족",
      resistance_level: null,
      resistance_distance_pct: null,
      insufficient_data: true,
    };
  }

  const current = candles[candles.length - 1].close;

  const resistanceResult = checkResistanceProximity(candles, current);
  const overboughtResult = checkOverbought(candles);
  const divergenceResult = checkDivergence(candles);
  const upperWickResult = checkUpperWick(candles);

  // 타입별 별도 보관
  const { resistance_level, resistance_distance_pct, ...resistanceSignal } = resistanceResult;

  const signals: ProfitTakingSignal[] = [
    resistanceSignal,
    overboughtResult,
    divergenceResult,
    upperWickResult,
  ];

  const triggeredCount = signals.filter((s) => s.triggered).length;

  let recommendation: ProfitTakingResult["recommendation"];
  if (triggeredCount === 0)      recommendation = "hold";
  else if (triggeredCount === 1) recommendation = "watch";
  else if (triggeredCount === 2) recommendation = "partial_sell";
  else                            recommendation = "sell";

  const triggeredLabels = signals.filter((s) => s.triggered).map((s) => s.label);

  const summary =
    triggeredCount === 0
      ? "현재 익절 시그널 없음 — 추세 유지"
      : triggeredCount === 1
      ? `경미한 익절 시그널: ${triggeredLabels[0]}`
      : `${triggeredCount}개 익절 시그널 동시 발생 — 부분/전체 익절 검토 권고 (${triggeredLabels.join(", ")})`;

  return {
    ticker,
    triggered_count: triggeredCount,
    signals,
    recommendation,
    summary,
    resistance_level,
    resistance_distance_pct,
    insufficient_data: false,
  };
}
