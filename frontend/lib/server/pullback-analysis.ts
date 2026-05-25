import type { CandleData } from "./yahoo-finance";

// ── 내부 유틸 (indicators.ts의 sma 재사용을 위해 인라인) ─────────────────────

function sma(arr: number[], w: number): (number | null)[] {
  return arr.map((_, i) => {
    if (i < w - 1) return null;
    return arr.slice(i - w + 1, i + 1).reduce((a, b) => a + b, 0) / w;
  });
}

function rsi14(closes: number[]): (number | null)[] {
  const diffs = closes.map((c, i) => (i === 0 ? 0 : c - closes[i - 1]));
  const gains  = diffs.map((d) => Math.max(d, 0));
  const losses = diffs.map((d) => Math.max(-d, 0));
  const avgG = sma(gains,  14);
  const avgL = sma(losses, 14);
  return avgG.map((g, i) => {
    const l = avgL[i];
    if (g == null || l == null) return null;
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  });
}

function obv(closes: number[], volumes: number[]): number[] {
  const result = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1])      result.push(result[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) result.push(result[i - 1] - volumes[i]);
    else                                 result.push(result[i - 1]);
  }
  return result;
}

// ── 결과 타입 ────────────────────────────────────────────────────────────────

export interface PullbackStage {
  stage: 1 | 2 | 3 | 4;
  label: string;
  pass: boolean;
  detail: string;
}

export interface PullbackResult {
  ticker: string;
  analysisDate: string;

  // 4단계 필터
  stage1_pass: boolean;
  stage2_pass: boolean;
  stage3_pass: boolean;
  stage4_pass: boolean;

  // 지표값
  current_price: number;
  ma20: number | null;
  ma60: number | null;
  ma20_distance_pct: number | null;   // 양수 = 20선 위
  ma20_trending_up: boolean | null;

  base_candle_date: string | null;
  base_candle_days_ago: number | null;
  volume_surge_ratio: number | null;  // 기준봉 일 거래량 / 20일 평균 거래량
  base_candle_return: number | null;  // 기준봉 당일 등락률 (%)

  volume_decline_ratio: number | null; // 기준봉 후 평균 거래량 / 기준봉 거래량
  rsi: number | null;
  obv_divergence: boolean;            // 가격↓ 이나 OBV 유지·상승

  score: number;
  signal: "strong" | "moderate" | "weak" | "none";
  stages: PullbackStage[];
  insufficient_data: boolean;
}

// ── 핵심 분석 함수 ────────────────────────────────────────────────────────────

export function analyzePullback(ticker: string, candles: CandleData[]): PullbackResult {
  const empty = (reason = "데이터 부족"): PullbackResult => ({
    ticker, analysisDate: new Date().toISOString(),
    stage1_pass: false, stage2_pass: false, stage3_pass: false, stage4_pass: false,
    current_price: 0, ma20: null, ma60: null,
    ma20_distance_pct: null, ma20_trending_up: null,
    base_candle_date: null, base_candle_days_ago: null,
    volume_surge_ratio: null, base_candle_return: null,
    volume_decline_ratio: null, rsi: null, obv_divergence: false,
    score: 0, signal: "none",
    stages: [
      { stage: 1, label: "추세 기반", pass: false, detail: reason },
      { stage: 2, label: "기준봉",   pass: false, detail: reason },
      { stage: 3, label: "눌림목",   pass: false, detail: reason },
      { stage: 4, label: "보조지표", pass: false, detail: reason },
    ],
    insufficient_data: true,
  });

  if (candles.length < 30) return empty();

  const closes  = candles.map((c) => c.close);
  const opens   = candles.map((c) => c.open);
  const highs   = candles.map((c) => c.high);
  const lows    = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const times   = candles.map((c) => c.time);
  const n       = closes.length;

  // ── 지표 계산 ──────────────────────────────────────────────────────────────
  const ma20arr = sma(closes, 20);
  const ma60arr = sma(closes, 60);
  const rsiArr  = rsi14(closes);
  const obvArr  = obv(closes, volumes);

  const lastMa20 = ma20arr[n - 1];
  const lastMa60 = ma60arr[n - 1];
  const lastRsi  = rsiArr[n - 1];
  const curPrice = closes[n - 1];

  // 20일선 우상향: 5거래일 전 대비 현재값
  const prevMa20Idx = Math.max(0, n - 6);
  const prevMa20    = ma20arr[prevMa20Idx];
  const ma20TrendUp = lastMa20 != null && prevMa20 != null ? lastMa20 > prevMa20 : null;

  const ma20Dist = lastMa20 != null
    ? ((curPrice - lastMa20) / lastMa20) * 100
    : null;

  // ── 1단계: 추세 기반 (20일선 우상향 + 현재가 > 20일선) ───────────────────
  const s1 = ma20TrendUp === true && ma20Dist != null && ma20Dist > 0;

  // ── 2단계: 기준봉 탐색 (최근 5거래일 이내) ───────────────────────────────
  // 20일 평균 거래량 (기준봉 탐색 기준 시점 기준)
  let baseCandleIdx: number | null = null;
  let volumeSurgeRatio: number | null = null;
  let baseCandleReturn: number | null = null;

  for (let lookback = 1; lookback <= 5; lookback++) {
    const i = n - lookback;        // 오늘 = n-1, 1일 전 = n-2, ...
    if (i < 20) break;

    const avgVol20 = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    if (avgVol20 <= 0) continue;

    const surgeRatio = volumes[i] / avgVol20;
    const ret        = closes[i - 1] > 0
      ? ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100
      : 0;
    const range      = highs[i] - lows[i];
    const body       = closes[i] - opens[i];
    // 장대양봉 조건: 거래량 300%+, 등락률 7%+, 양봉 몸통 > 캔들 범위 50%
    const isLargeBullish =
      surgeRatio >= 3.0 &&
      ret >= 7.0 &&
      closes[i] > opens[i] &&
      (range > 0 ? body / range >= 0.5 : false);

    if (isLargeBullish) {
      baseCandleIdx    = i;
      volumeSurgeRatio = surgeRatio;
      baseCandleReturn = ret;
      break;
    }
  }

  const s2 = baseCandleIdx !== null;
  const baseCandleDaysAgo = s2 ? n - 1 - baseCandleIdx! : null;
  const baseCandleDate    = s2 ? times[baseCandleIdx!] : null;

  // ── 3단계: 눌림목 확인 ─────────────────────────────────────────────────────
  // 기준봉 이후 거래량 감소 + MA20 부근(-2%~+3%) 지지
  let volumeDeclineRatio: number | null = null;
  let s3 = false;

  if (s2 && baseCandleIdx !== null && baseCandleIdx < n - 1) {
    const baseVolume = volumes[baseCandleIdx];
    const postCandles = volumes.slice(baseCandleIdx + 1);
    if (postCandles.length > 0) {
      const avgPostVol = postCandles.reduce((a, b) => a + b, 0) / postCandles.length;
      volumeDeclineRatio = baseVolume > 0 ? (avgPostVol / baseVolume) * 100 : null;
    }

    // 현재가가 20일선 -2% ~ +3% 구간 안에 있는지
    const ma20InRange = ma20Dist != null && ma20Dist >= -2 && ma20Dist <= 5;
    const volDeclined = volumeDeclineRatio != null && volumeDeclineRatio <= 40;

    s3 = s1 && ma20InRange && volDeclined;
  }

  // ── 4단계: 보조지표 (RSI + OBV 다이버전스) ───────────────────────────────
  // RSI: 눌림목 구간 35~60
  const rsiInRange = lastRsi != null && lastRsi >= 35 && lastRsi <= 60;

  // OBV 다이버전스: 기준봉 이후 가격이 소폭 내렸으나 OBV가 유지·상승
  let obvDivergence = false;
  if (s2 && baseCandleIdx !== null) {
    const priceAfter = closes[n - 1];
    const priceBase  = closes[baseCandleIdx];
    const obvAfter   = obvArr[n - 1];
    const obvBase    = obvArr[baseCandleIdx];
    // 가격은 기준봉 대비 소폭 하락(-10% 이내), OBV는 유지 또는 상승
    if (priceAfter <= priceBase && (priceBase - priceAfter) / priceBase < 0.1) {
      obvDivergence = obvAfter >= obvBase * 0.95;
    }
  }

  const s4 = rsiInRange || obvDivergence;

  // ── 점수 계산 (0~100) ─────────────────────────────────────────────────────
  let score = 0;

  // Stage 1: 추세 (15점)
  if (s1) score += 15;

  // Stage 2: 기준봉 강도 (최대 40점)
  if (s2) {
    // 거래량 급증 비율 (10~20점)
    const surgeScore = Math.min(20, Math.round(((volumeSurgeRatio! - 3) / 7) * 10 + 10));
    score += Math.max(10, surgeScore);

    // 등락률 (5~15점)
    const retScore = Math.min(15, Math.round(((baseCandleReturn! - 7) / 8) * 5 + 5));
    score += Math.max(5, retScore);

    // 최신성: 기준봉이 최근일수록 가중치 (5~15점)
    const recencyScore = baseCandleDaysAgo === 1 ? 15
      : baseCandleDaysAgo === 2 ? 12
      : baseCandleDaysAgo === 3 ? 9
      : baseCandleDaysAgo === 4 ? 6 : 3;
    score += recencyScore;
  }

  // Stage 3: 눌림목 품질 (최대 30점)
  if (s3) {
    // MA20 이격도 0~3%일수록 고점수 (5~15점)
    const distScore = ma20Dist != null
      ? Math.round(15 - Math.min(15, (Math.abs(ma20Dist) / 3) * 10))
      : 0;
    score += Math.max(0, distScore);

    // 거래량 감소 (0~15점)
    const volScore = volumeDeclineRatio != null
      ? Math.round(15 - Math.min(15, (volumeDeclineRatio / 40) * 15))
      : 0;
    score += Math.max(0, volScore);
  } else if (s2 && ma20Dist != null && ma20Dist >= -2 && ma20Dist <= 5) {
    score += 5; // 부분 점수
  }

  // Stage 4: 보조지표 (최대 15점)
  if (rsiInRange) score += 8;
  if (obvDivergence) score += 7;

  score = Math.min(100, Math.round(score));

  const signal: PullbackResult["signal"] =
    score >= 70 ? "strong" :
    score >= 50 ? "moderate" :
    score >= 30 ? "weak" : "none";

  // ── 단계별 상세 설명 ──────────────────────────────────────────────────────
  const stages: PullbackStage[] = [
    {
      stage: 1,
      label: "추세 기반",
      pass: s1,
      detail: s1
        ? `20일선 우상향 + 현재가 ${ma20Dist != null ? `+${ma20Dist.toFixed(1)}%` : ""} 위 위치`
        : `20일선 ${ma20TrendUp ? "우상향" : "하락/횡보"}${ma20Dist != null ? `, 현재가 ${ma20Dist.toFixed(1)}%` : ""}`,
    },
    {
      stage: 2,
      label: "기준봉",
      pass: s2,
      detail: s2
        ? `${baseCandleDate} (${baseCandleDaysAgo}일 전) | 거래량 ${volumeSurgeRatio!.toFixed(1)}배 | +${baseCandleReturn!.toFixed(1)}%`
        : "최근 5거래일 내 장대양봉(거래량 300%↑, +7%↑) 미발생",
    },
    {
      stage: 3,
      label: "눌림목",
      pass: s3,
      detail: s3
        ? `20일선 이격 ${ma20Dist!.toFixed(1)}% | 거래량 ${volumeDeclineRatio!.toFixed(0)}% 수준으로 감소`
        : s2
          ? `이격 ${ma20Dist != null ? ma20Dist.toFixed(1) + "%" : "N/A"} | 거래량 감소 ${volumeDeclineRatio != null ? volumeDeclineRatio.toFixed(0) + "%" : "N/A"}`
          : "기준봉 미포착",
    },
    {
      stage: 4,
      label: "보조지표",
      pass: s4,
      detail: `RSI ${lastRsi != null ? lastRsi.toFixed(1) : "N/A"}${rsiInRange ? " (적정 구간)" : ""} | OBV ${obvDivergence ? "다이버전스 감지" : "분석 정상"}`,
    },
  ];

  return {
    ticker,
    analysisDate: new Date().toISOString(),
    stage1_pass: s1,
    stage2_pass: s2,
    stage3_pass: s3,
    stage4_pass: s4,
    current_price: curPrice,
    ma20: lastMa20,
    ma60: lastMa60,
    ma20_distance_pct: ma20Dist,
    ma20_trending_up: ma20TrendUp,
    base_candle_date: baseCandleDate,
    base_candle_days_ago: baseCandleDaysAgo,
    volume_surge_ratio: volumeSurgeRatio,
    base_candle_return: baseCandleReturn,
    volume_decline_ratio: volumeDeclineRatio,
    rsi: lastRsi,
    obv_divergence: obvDivergence,
    score,
    signal,
    stages,
    insufficient_data: false,
  };
}
