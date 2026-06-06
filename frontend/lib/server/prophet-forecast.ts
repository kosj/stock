/**
 * Hybrid Stacking Ensemble — time series forecasting (TypeScript)
 *
 * 2-Layer 스태킹 앙상블 아키텍처:
 *
 *   Layer 1 — 베이스 모델 3종 (이질적 귀납 편향으로 상호 보완):
 *     A. LinearTrend : OLS 선형 회귀       — 장기 방향성 드리프트 포착
 *     B. Holt's DES  : 이중 지수 평활법    — 레벨 + 추세 적응적 학습
 *     C. MultiEMA    : 10/20/50일 EMA 블렌드 — 단·중기 모멘텀 포착
 *
 *   Layer 2 — Ridge 메타 모델:
 *     워크-포워드 OOF(Out-of-Fold) 예측값으로 메타 Ridge 학습
 *     → 베이스 모델의 과적합 예측이 메타 학습에 사용되는 데이터 누수 방지
 *
 * 공개 인터페이스 하위 호환 유지:
 *   ProphetForecastResult, prophetForecast() 시그니처 동일
 *   → ProphetForecastCard, AlgorithmSignalCard, ProphetBadge 등 무변경
 */

import { getChart } from "./yahoo-finance";
import type { CandleData } from "./yahoo-finance";

// ── Public types (하위 호환 유지 — 변경 금지) ────────────────────────────────

export interface ProphetPoint {
  date: string;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
  trend: number;
}

export interface ScenarioPoint {
  date: string;
  price: number;
}

export interface ProphetScenarios {
  bull: ScenarioPoint[];
  base: ScenarioPoint[];
  bear: ScenarioPoint[];
  /** % return vs current price at day 30 */
  bull_return_30d: number;
  base_return_30d: number;
  bear_return_30d: number;
  /** Absolute price at day 30 */
  bull_price_30d: number;
  base_price_30d: number;
  bear_price_30d: number;
}

export interface ProphetForecastResult {
  ticker: string;
  current_price: number;
  /** Next 30 trading-day predictions */
  predictions: ProphetPoint[];
  /** Model fit over last 60 historical days (for chart overlay) */
  history_fit: ProphetPoint[];
  /** Actual close prices for last 60 days (for accuracy comparison) */
  history_actual: { date: string; price: number }[];
  /** Bull / Base / Bear scenario fan */
  scenarios: ProphetScenarios;
  recommendation: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  /** Predicted price change over next 7 trading days (%) */
  predicted_return_7d: number;
  /** Predicted price change over next 30 trading days (%) */
  predicted_return_30d: number;
  trend_direction: "up" | "down" | "flat";
  /** Annualized trend slope (%) */
  trend_slope_annual_pct: number;
  /** Coefficient of determination for in-sample fit */
  r_squared: number;
  /** Dates where a significant EMA regime shift was detected */
  changepoint_dates: string[];
  insufficient_data: boolean;
}

// ── Hyperparameters ──────────────────────────────────────────────────────────

const FORECAST_DAYS = 30;
const MIN_SAMPLES   = 40;
/**
 * EMA 스팬 3종 — 단기(10d)/중기(20d)/장기(50d):
 * 서로 다른 스팬의 EMA를 블렌드하면 개별 EMA보다 노이즈에 강함
 */
const EMA_SPANS    = [10, 20, 50] as const;
/**
 * Holt α (레벨 평활): 클수록 최근 관측에 민감하게 반응
 * Holt β (추세 평활): 작을수록 추세가 부드럽고 안정적
 */
const HOLT_ALPHA   = 0.3;
const HOLT_BETA    = 0.1;
/**
 * Ridge L2: OOF 행렬이 소규모일 때 역행렬 불안정 방지
 */
const RIDGE_LAMBDA = 1e-4;
/**
 * 워크-포워드 OOF 분할 수: 4 → 각 폴드가 전체의 ~20%
 * 너무 크면 초기 폴드 훈련 셋이 너무 작아 모델 품질 저하
 */
const N_FOLDS      = 4;

// ── Linear algebra utilities (Prophet 구현에서 유지) ─────────────────────────

type Vec = number[];
type Mat = number[][];

/** A × B  (m×k) × (k×n) → m×n */
function mm(A: Mat, B: Mat): Mat {
  const m = A.length, k = A[0].length, n = B[0].length;
  const C: Mat = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let l = 0; l < k; l++) {
      if (A[i][l] === 0) continue;
      for (let j = 0; j < n; j++) C[i][j] += A[i][l] * B[l][j];
    }
  return C;
}

function tr(A: Mat): Mat {
  return A[0].map((_, j) => A.map(r => r[j]));
}

/** A × v  (m×n) × (n) → m */
function mv(A: Mat, v: Vec): Vec {
  return A.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
}

/** Gauss-Jordan with partial pivoting — small dense systems only */
function solve(A: Mat, b: Vec): Vec {
  const n = A.length;
  const M: number[][] = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    const p = M[c][c];
    if (Math.abs(p) < 1e-14) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / p;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-14 ? 0 : r[n] / r[i]));
}

/** Ridge-OLS: β = (XᵀX + λI)⁻¹ Xᵀy */
function fitRidge(X: Mat, y: Vec): Vec {
  const Xt  = tr(X);
  const XtX = mm(Xt, X);
  for (let i = 0; i < XtX.length; i++) XtX[i][i] += RIDGE_LAMBDA;
  return solve(XtX, mv(Xt, y));
}

function r2(y: Vec, yhat: Vec): number {
  const mu    = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - mu) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0);
  return ssTot < 1e-10 ? 0 : Math.max(0, 1 - ssRes / ssTot);
}

function stddev(arr: Vec): number {
  const mu = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length);
}

// ── Layer 1 — Base Model A: OLS Linear Trend ─────────────────────────────────
//
// 설계 이유: 주가에는 장기적으로 선형 드리프트(drift)가 존재함
//   단순하지만 추세 방향을 안정적으로 잡아내는 기저(baseline) 역할
//   다른 두 모델의 비선형 보정이 이 선형 기저 위에 얹히는 구조

function fitLinear(ts: Vec, y: Vec): [number, number] {
  const n    = ts.length;
  const sumT = ts.reduce((s, t) => s + t, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumT2 = ts.reduce((s, t) => s + t * t, 0);
  const sumTY = ts.reduce((s, t, i) => s + t * y[i], 0);
  const det  = n * sumT2 - sumT * sumT;
  const b    = Math.abs(det) < 1e-10 ? 0 : (n * sumTY - sumT * sumY) / det;
  const a    = (sumY - b * sumT) / n;
  return [a, b];
}

function predictLinear(coef: [number, number], ts: Vec): Vec {
  return ts.map(t => coef[0] + coef[1] * t);
}

// ── Layer 1 — Base Model B: Holt's Double Exponential Smoothing ───────────────
//
// 설계 이유: 선형 추세 모델과 달리 최근 데이터에 더 높은 가중치 부여
//   주가의 레짐 변화(급등·급락 후 방향 전환)를 빠르게 추적
//   Level(L) + Trend(T) 두 성분을 분리 추정 → Prophet의 추세 분해와 유사
//
// L_t = α·y_t + (1-α)·(L_{t-1} + T_{t-1})   ← 레벨 갱신
// T_t = β·(L_t - L_{t-1}) + (1-β)·T_{t-1}   ← 추세 갱신
// ŷ_{t+h} = L_t + h·T_t                       ← h-스텝 예측

interface HoltState { L: number; T: number }

function holtFit(
  prices: Vec,
  alpha: number,
  beta: number,
): HoltState & { fitted: Vec } {
  let L = prices[0];
  let T = prices.length > 1 ? prices[1] - prices[0] : 0;
  const fitted: Vec = [prices[0]];

  for (let i = 1; i < prices.length; i++) {
    const Lp = L, Tp = T;
    L = alpha * prices[i] + (1 - alpha) * (Lp + Tp);
    T = beta  * (L - Lp)  + (1 - beta)  * Tp;
    fitted.push(L + T);
  }
  return { L, T, fitted };
}

function holtForecast({ L, T }: HoltState, steps: number): Vec {
  return Array.from({ length: steps }, (_, h) => L + (h + 1) * T);
}

// ── Layer 1 — Base Model C: Multi-EMA Blend ───────────────────────────────────
//
// 설계 이유: 단일 EMA는 스팬 선택에 민감 → 여러 스팬 평균으로 안정화
//   EMA10(단기)-EMA50(장기) 스프레드: 골든/데스크로스를 모멘텀 방향으로 활용
//   배깅(bagging) 효과: 스팬이 다른 모델들의 평균 → 분산 감소

function computeEma(prices: Vec, span: number): Vec {
  const alpha = 2 / (span + 1);
  const ema: Vec = [prices[0]];
  for (let i = 1; i < prices.length; i++)
    ema.push(alpha * prices[i] + (1 - alpha) * ema[i - 1]);
  return ema;
}

function multiEmaFit(prices: Vec): Vec {
  const emas = EMA_SPANS.map(s => computeEma(prices, s));
  return prices.map((_, i) => emas.reduce((s, e) => s + e[i], 0) / EMA_SPANS.length);
}

function multiEmaForecast(prices: Vec, steps: number): Vec {
  const lastEmas = EMA_SPANS.map(span => {
    const alpha = 2 / (span + 1);
    let e = prices[0];
    for (let i = 1; i < prices.length; i++) e = alpha * prices[i] + (1 - alpha) * e;
    return e;
  });

  // EMA10-EMA50 스프레드: 상승 모멘텀(양수) vs 하락 모멘텀(음수)
  const spreadMomentum =
    (lastEmas[0] - lastEmas[lastEmas.length - 1]) /
    (EMA_SPANS[EMA_SPANS.length - 1] - EMA_SPANS[0]);
  const baseLevel = lastEmas.reduce((s, e) => s + e, 0) / lastEmas.length;

  return Array.from({ length: steps }, (_, h) => baseLevel + spreadMomentum * (h + 1));
}

// ── Layer 2 — Walk-forward OOF 예측 행렬 생성 ─────────────────────────────────
//
// 핵심 원칙: 베이스 모델이 "본 적 없는" 구간만 OOF 예측에 포함
//   → 메타 모델이 베이스 모델의 실제 일반화 성능을 학습
//   → 동일 데이터로 학습 후 예측 시 발생하는 낙관적 편향 제거
//
// 워크-포워드 분할 (시계열 특성상 shuffle 없음):
//   Fold 0: train [0, 1×step), predict [1×step, 2×step)
//   Fold 1: train [0, 2×step), predict [2×step, 3×step)
//   ...
//   Fold k: train [0, (k+1)×step), predict [(k+1)×step, (k+2)×step)

interface OofResult { oofMat: Mat; oofTargets: Vec }

function buildOofPredictions(prices: Vec, ts: Vec): OofResult {
  const n    = prices.length;
  const step = Math.max(Math.floor(n / (N_FOLDS + 1)), 10);

  const oofRows: number[][] = [];
  const oofY: number[]      = [];

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const trEnd = (fold + 1) * step;
    const vaEnd = Math.min(trEnd + step, n);
    if (trEnd >= n) break;

    const trP   = prices.slice(0, trEnd);
    const trT   = ts.slice(0, trEnd);
    const vaLen = vaEnd - trEnd;
    const vaT   = ts.slice(trEnd, vaEnd);
    const vaP   = prices.slice(trEnd, vaEnd);

    // Model A: Linear Trend
    const coefA = fitLinear(trT, trP);
    const predA = predictLinear(coefA, vaT);

    // Model B: Holt DES
    const stateB = holtFit(trP, HOLT_ALPHA, HOLT_BETA);
    const predB  = holtForecast(stateB, vaLen);

    // Model C: Multi-EMA
    const predC = multiEmaForecast(trP, vaLen);

    for (let i = 0; i < vaLen; i++) {
      oofRows.push([predA[i], predB[i], predC[i]]);
      oofY.push(vaP[i]);
    }
  }

  return { oofMat: oofRows, oofTargets: oofY };
}

// ── 레짐 전환 감지 (EMA 골든/데스크로스) ─────────────────────────────────────
//
// 기존 changepoint_dates 필드 하위 호환:
//   Prophet changepoint 대신 EMA10/EMA50 교차 날짜를 레짐 전환 시점으로 활용
//   골든크로스(EMA10 > EMA50): 강세 레짐 전환
//   데스크로스(EMA10 < EMA50): 약세 레짐 전환

function detectRegimeShifts(prices: Vec, dates: Date[]): string[] {
  const e10 = computeEma(prices, 10);
  const e50 = computeEma(prices, 50);
  const shifts: string[] = [];

  for (let i = 50; i < prices.length; i++) {
    const prev = e10[i - 1] - e50[i - 1];
    const curr = e10[i]     - e50[i];
    if (prev * curr < 0) {
      shifts.push(dates[i].toISOString().slice(0, 10));
    }
  }
  return shifts.slice(-5);
}

// ── 다음 거래일 생성 (원본에서 유지) ─────────────────────────────────────────

function nextTradingDates(lastDate: Date, n: number): Date[] {
  const out: Date[] = [];
  let d = new Date(lastDate);
  while (out.length < n) {
    d = new Date(d.getTime() + 86_400_000);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
  }
  return out;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function prophetForecast(
  tickerOrCandles: string | CandleData[],
): Promise<ProphetForecastResult> {
  const candles: CandleData[] =
    typeof tickerOrCandles === "string"
      ? await getChart(tickerOrCandles, "1y")
      : tickerOrCandles;

  const ticker =
    typeof tickerOrCandles === "string" ? tickerOrCandles : "UNKNOWN";

  const EMPTY: ProphetForecastResult = {
    ticker,
    current_price:          0,
    predictions:            [],
    history_fit:            [],
    history_actual:         [],
    scenarios: {
      bull: [], base: [], bear: [],
      bull_return_30d: 0, base_return_30d: 0, bear_return_30d: 0,
      bull_price_30d: 0,  base_price_30d: 0,  bear_price_30d: 0,
    },
    recommendation:         "hold",
    predicted_return_7d:    0,
    predicted_return_30d:   0,
    trend_direction:        "flat",
    trend_slope_annual_pct: 0,
    r_squared:              0,
    changepoint_dates:      [],
    insufficient_data:      true,
  };

  if (candles.length < MIN_SAMPLES) return EMPTY;

  // ── 데이터 준비 ──────────────────────────────────────────────────────────────
  const dates  = candles.map(c => new Date(c.time));
  const prices = candles.map(c => c.close);
  const n      = prices.length;

  // 정규화된 시간축 [0, 1]: Ridge 수치 안정성 확보
  const tMin  = dates[0].getTime();
  const tSpan = dates[n - 1].getTime() - tMin;
  const ts    = dates.map(d => (d.getTime() - tMin) / tSpan);

  // ── Layer 1: 베이스 모델 3종 전체 학습 (추론 + in-sample fit용) ─────────────
  const coefA  = fitLinear(ts, prices);
  const stateB = holtFit(prices, HOLT_ALPHA, HOLT_BETA);

  const fittedA = predictLinear(coefA, ts);   // Model A in-sample
  const fittedB = stateB.fitted;               // Model B in-sample
  const fittedC = multiEmaFit(prices);         // Model C in-sample

  // ── Layer 2: OOF 예측으로 Ridge 메타 모델 학습 ──────────────────────────────
  const { oofMat, oofTargets } = buildOofPredictions(prices, ts);
  const metaBeta = fitRidge(oofMat, oofTargets);

  // ── In-sample 메타 예측 (R², σ 계산용) ─────────────────────────────────────
  const inSampleMat: Mat = fittedA.map((a, i) => [a, fittedB[i], fittedC[i]]);
  const y_fit  = mv(inSampleMat, metaBeta);
  const resids = prices.map((p, i) => p - y_fit[i]);
  const sigma  = stddev(resids);
  const R2     = r2(prices, y_fit);

  // ── 미래 30 거래일 예측 ─────────────────────────────────────────────────────
  const futureDates = nextTradingDates(dates[n - 1], FORECAST_DAYS);
  const futureTs    = futureDates.map(d => (d.getTime() - tMin) / tSpan);

  const futureA = predictLinear(coefA, futureTs);
  const futureB = holtForecast(stateB, FORECAST_DAYS);
  const futureC = multiEmaForecast(prices, FORECAST_DAYS);

  const futureMat: Mat = futureA.map((a, i) => [a, futureB[i], futureC[i]]);
  const y_future = mv(futureMat, metaBeta);

  // ProphetPoint.trend: 하위 호환을 위해 선형 추세 성분(Model A)으로 채움
  const predictions: ProphetPoint[] = futureDates.map((d, i) => {
    const sigScale = 1 + (i / FORECAST_DAYS) * 1.5;
    return {
      date:       d.toISOString().slice(0, 10),
      yhat:       Math.max(0, y_future[i]),
      yhat_lower: Math.max(0, y_future[i] - 1.96 * sigma * sigScale),
      yhat_upper: y_future[i] + 1.96 * sigma * sigScale,
      trend:      futureA[i],
    };
  });

  // ── 과거 60일 적합도 ─────────────────────────────────────────────────────────
  const histStart = Math.max(0, n - 60);
  const history_fit: ProphetPoint[] = dates.slice(histStart).map((d, i) => {
    const idx = histStart + i;
    return {
      date:       d.toISOString().slice(0, 10),
      yhat:       Math.max(0, y_fit[idx]),
      yhat_lower: Math.max(0, y_fit[idx] - 1.96 * sigma),
      yhat_upper: y_fit[idx] + 1.96 * sigma,
      trend:      fittedA[idx],
    };
  });

  const history_actual = dates.slice(histStart).map((d, i) => ({
    date:  d.toISOString().slice(0, 10),
    price: prices[histStart + i],
  }));

  // ── 레짐 전환 감지 (EMA 크로스오버 → changepoint_dates 필드 재활용) ─────────
  const regimeShifts = detectRegimeShifts(prices, dates);

  // ── 추천 신호 생성 ───────────────────────────────────────────────────────────
  const currentPrice = prices[n - 1];
  const pred7d       = predictions[Math.min(6,  predictions.length - 1)]?.yhat ?? currentPrice;
  const pred30d      = predictions[Math.min(29, predictions.length - 1)]?.yhat ?? currentPrice;
  const return7d     = ((pred7d  - currentPrice) / currentPrice) * 100;
  const return30d    = ((pred30d - currentPrice) / currentPrice) * 100;

  // 연간화 추세 기울기: 정규화된 시간축에서 1단위 = 학습 기간 전체
  //   → 1년 = 252 거래일 / 학습 기간 거래일 수 × tSpan
  const tNow    = ts[n - 1];
  const tNext1y = tNow + (252 / n);
  const slopeAnnPct =
    Math.abs(currentPrice) > 1
      ? ((coefA[0] + coefA[1] * tNext1y - currentPrice) / currentPrice) * 100
      : 0;

  const trendDir: "up" | "down" | "flat" =
    slopeAnnPct > 5 ? "up" : slopeAnnPct < -5 ? "down" : "flat";

  const confidence    = Math.max(0.3, R2);
  const adjReturn     = return30d * confidence;

  const recommendation: ProphetForecastResult["recommendation"] =
    adjReturn >  8 ? "strong_buy"  :
    adjReturn >  3 ? "buy"         :
    adjReturn > -3 ? "hold"        :
    adjReturn > -8 ? "sell"        : "strong_sell";

  // ── Bull / Base / Bear 시나리오 팬 ─────────────────────────────────────────
  //
  // 스프레드 설계 (원본과 동일 방법론 유지):
  //   trend_part : 30일 절대 기울기에 비례 → 방향성 불확실성
  //   noise_part : σ × √(horizon) → 모델 적합 불확실성
  //   bear는 bull 대비 1.15배 비대칭 (실제 시장: 하락 변동성 > 상승 변동성)

  const dailyAbsSlope = Math.abs(pred30d - currentPrice) / FORECAST_DAYS;

  function scenarioSpread(i: number): number {
    const horizonFrac = (i + 1) / FORECAST_DAYS;
    const trendPart   = dailyAbsSlope * (i + 1) * 0.55;
    const noisePart   = sigma * Math.sqrt(horizonFrac) * 0.80;
    return trendPart + noisePart;
  }

  const scenarioBull: ScenarioPoint[] = predictions.map((p, i) => ({
    date:  p.date,
    price: Math.max(0, p.yhat + scenarioSpread(i)),
  }));
  const scenarioBase: ScenarioPoint[] = predictions.map(p => ({
    date:  p.date,
    price: Math.max(0, p.yhat),
  }));
  const scenarioBear: ScenarioPoint[] = predictions.map((p, i) => ({
    date:  p.date,
    price: Math.max(0, p.yhat - scenarioSpread(i) * 1.15),
  }));

  const bull30 = scenarioBull[FORECAST_DAYS - 1]?.price ?? currentPrice;
  const base30 = scenarioBase[FORECAST_DAYS - 1]?.price ?? currentPrice;
  const bear30 = scenarioBear[FORECAST_DAYS - 1]?.price ?? currentPrice;

  const scenarios: ProphetScenarios = {
    bull: scenarioBull,
    base: scenarioBase,
    bear: scenarioBear,
    bull_return_30d: ((bull30 - currentPrice) / currentPrice) * 100,
    base_return_30d: return30d,
    bear_return_30d: ((bear30 - currentPrice) / currentPrice) * 100,
    bull_price_30d:  bull30,
    base_price_30d:  base30,
    bear_price_30d:  bear30,
  };

  return {
    ticker,
    current_price:          currentPrice,
    predictions,
    history_fit,
    history_actual,
    scenarios,
    recommendation,
    predicted_return_7d:    return7d,
    predicted_return_30d:   return30d,
    trend_direction:        trendDir,
    trend_slope_annual_pct: slopeAnnPct,
    r_squared:              R2,
    changepoint_dates:      regimeShifts,
    insufficient_data:      false,
  };
}
