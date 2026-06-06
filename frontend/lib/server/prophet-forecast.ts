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
 *     ① MinMaxScaler로 OOF 예측값 [0,1] 정규화 → 한 모델이 Ridge를 지배하는 scale 편향 제거
 *     ② 워크-포워드 OOF(Out-of-Fold) 예측값으로 메타 Ridge 학습
 *        → 베이스 모델의 과적합 예측이 메타 학습에 사용되는 데이터 누수 방지
 *
 *   리스크 지표:
 *     ATR(14) 기반 atr_pct — 크론 파이프라인의 리스크 조정 스코어 계산에 사용
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
  /** Predicted price change over next 5 trading days (%) */
  predicted_return_5d: number;
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
  /**
   * ATR(14) / currentPrice × 100 (%)
   * 크론 파이프라인의 리스크 조정 스코어 계산에 사용됨.
   * 클램핑: [0.5, 12.0]
   */
  atr_pct: number;
  insufficient_data: boolean;
}

// ── Hyperparameters ──────────────────────────────────────────────────────────

const FORECAST_DAYS = 30;
const MIN_SAMPLES   = 40;
const EMA_SPANS    = [10, 20, 50] as const;
const HOLT_ALPHA   = 0.3;
const HOLT_BETA    = 0.1;
const RIDGE_LAMBDA = 1e-4;
const N_FOLDS      = 4;

/** ATR% 클램핑 범위 (position-manager-service.ts와 동일 기준 유지) */
const ATR_PCT_FLOOR = 0.5;
const ATR_PCT_CEIL  = 12.0;

// ── Linear algebra utilities ─────────────────────────────────────────────────

type Vec = number[];
type Mat = number[][];

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

function mv(A: Mat, v: Vec): Vec {
  return A.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
}

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

// ── MinMaxScaler ─────────────────────────────────────────────────────────────
//
// Layer 2 Ridge 입력 정규화 전용.
//
// 설계 이유:
//   베이스 모델 3종(Linear, Holt, MultiEMA)의 예측값은 모두 원주가(원 단위)이지만
//   단기 레짐에서 Holt 예측이 선형 추세보다 현저히 높거나 낮을 수 있음.
//   이 경우 Ridge의 L2 패널티가 큰 절댓값 열에 더 강하게 작용하여
//   Ridge 가중치가 scale에 편향(scale bias)됨.
//
// MinMaxScaler vs StandardScaler:
//   StandardScaler: z = (x-μ)/σ  → 이상치에 민감, 출력 범위 미고정
//   MinMaxScaler:   x' = (x-min)/(max-min)  → 출력 [0,1] 고정, 이상치 영향 제한적
//   → 주가 예측값은 이상치보다 스케일 차이가 문제이므로 MinMaxScaler 적합
//
// 핵심 원칙: fit()은 반드시 OOF 행렬(훈련 데이터)에서만 호출.
//   미래 예측값(테스트 데이터)에는 fit() 없이 transform()만 적용.
//   → "훈련 셋 통계로 테스트 셋을 변환" — 데이터 누수 방지

class MinMaxScaler {
  private mins:  number[] = [];
  private maxes: number[] = [];

  /**
   * OOF 행렬에서 각 열(모델)의 min/max 추정.
   * 오직 훈련 셋(OOF predictions)에서만 호출해야 함.
   */
  fit(X: Mat): this {
    const nCols = X[0]?.length ?? 0;
    for (let j = 0; j < nCols; j++) {
      const col    = X.map(row => row[j]);
      this.mins[j]  = Math.min(...col);
      this.maxes[j] = Math.max(...col);
    }
    return this;
  }

  /**
   * fit()으로 추정된 min/max로 행렬 정규화.
   * OOF 행렬 + 미래 예측 행렬 모두에 적용.
   *
   * 엣지 케이스: max-min ≈ 0 (모든 예측값이 동일) → 0.5로 고정
   *   → 정규화 불능 시 중립값 부여하여 Ridge 수치 안정성 유지
   */
  transform(X: Mat): Mat {
    return X.map(row =>
      row.map((v, j) => {
        const range = this.maxes[j] - this.mins[j];
        return range < 1e-10 ? 0.5 : (v - this.mins[j]) / range;
      }),
    );
  }

  /** fit → transform 1-step 헬퍼 (OOF 행렬 전용) */
  fitTransform(X: Mat): Mat { return this.fit(X).transform(X); }
}

// ── ATR(14) 계산 ─────────────────────────────────────────────────────────────
//
// 랭킹 파이프라인의 리스크 가중치(위험 조정 수익률) 계산에 사용됨.
// 계산 로직은 position-manager-service.ts의 VolatilityCalculator와 동일한 공식.
// 단, CandleData는 high/low가 optional이므로 null 처리 포함.

function calcAtrPct(candles: CandleData[], currentPrice: number): number {
  // 캔들 2개 미만 또는 현재가 0 → 중립 기본값 반환
  if (candles.length < 2 || currentPrice <= 0) return 3.0;

  // ATR(14): 14개 TR값에 15개 캔들 필요 → 마지막 15개만 사용
  const recent = candles.slice(-(ATR_PERIOD + 1));

  const trs: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    // high/low가 null이면 close로 대체 (일봉 데이터 불완전 방어)
    const high     = recent[i].high  ?? recent[i].close;
    const low      = recent[i].low   ?? recent[i].close;
    const prevClose = recent[i - 1].close;

    /**
     * TR = max(H-L, |H-PrevC|, |L-PrevC|)
     * 갭 상승/하락 시 단순 고저폭보다 더 정확히 실제 변동폭을 포착.
     */
    trs.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low  - prevClose),
    ));
  }

  if (trs.length === 0) return 3.0;

  const atrWindow = Math.min(ATR_PERIOD, trs.length);
  const atr       = trs.slice(-atrWindow).reduce((s, v) => s + v, 0) / atrWindow;
  const rawAtrPct = (atr / currentPrice) * 100;

  // 클램핑: 초저변동성(국채 ETF 등) 및 초고변동성(테마주) 극단값 차단
  return Math.min(ATR_PCT_CEIL, Math.max(ATR_PCT_FLOOR, rawAtrPct));
}

// ATR 기간 상수 (calcAtrPct 내부에서 참조)
const ATR_PERIOD = 14;

// ── Layer 1 — Base Model A: OLS Linear Trend ─────────────────────────────────

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

  const spreadMomentum =
    (lastEmas[0] - lastEmas[lastEmas.length - 1]) /
    (EMA_SPANS[EMA_SPANS.length - 1] - EMA_SPANS[0]);
  const baseLevel = lastEmas.reduce((s, e) => s + e, 0) / lastEmas.length;

  return Array.from({ length: steps }, (_, h) => baseLevel + spreadMomentum * (h + 1));
}

// ── Layer 2 — Walk-forward OOF 예측 행렬 생성 ─────────────────────────────────

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

    const coefA = fitLinear(trT, trP);
    const predA = predictLinear(coefA, vaT);

    const stateB = holtFit(trP, HOLT_ALPHA, HOLT_BETA);
    const predB  = holtForecast(stateB, vaLen);

    const predC = multiEmaForecast(trP, vaLen);

    for (let i = 0; i < vaLen; i++) {
      oofRows.push([predA[i], predB[i], predC[i]]);
      oofY.push(vaP[i]);
    }
  }

  return { oofMat: oofRows, oofTargets: oofY };
}

// ── 레짐 전환 감지 (EMA 골든/데스크로스) ─────────────────────────────────────

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

// ── 다음 거래일 생성 ─────────────────────────────────────────────────────────

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
    predicted_return_5d:    0,
    predicted_return_7d:    0,
    predicted_return_30d:   0,
    trend_direction:        "flat",
    trend_slope_annual_pct: 0,
    r_squared:              0,
    changepoint_dates:      [],
    atr_pct:                ATR_PCT_FLOOR,
    insufficient_data:      true,
  };

  if (candles.length < MIN_SAMPLES) return EMPTY;

  // ── 데이터 준비 ──────────────────────────────────────────────────────────────
  const dates  = candles.map(c => new Date(c.time));
  const prices = candles.map(c => c.close);
  const n      = prices.length;

  const tMin  = dates[0].getTime();
  const tSpan = dates[n - 1].getTime() - tMin;
  const ts    = dates.map(d => (d.getTime() - tMin) / tSpan);

  // ── Layer 1: 베이스 모델 3종 전체 학습 ──────────────────────────────────────
  const coefA  = fitLinear(ts, prices);
  const stateB = holtFit(prices, HOLT_ALPHA, HOLT_BETA);

  const fittedA = predictLinear(coefA, ts);
  const fittedB = stateB.fitted;
  const fittedC = multiEmaFit(prices);

  // ── Layer 2: OOF 수집 → MinMaxScaler 정규화 → Ridge 메타 학습 ────────────────
  //
  // 정규화 파이프라인:
  //   1. buildOofPredictions(): 베이스 모델 3종의 워크-포워드 OOF 예측값 수집
  //   2. xScaler.fitTransform(oofMat): OOF 행렬을 열(모델)별 [0,1] 정규화
  //      → fit()은 여기서만 호출 (훈련 통계 추정)
  //   3. fitRidge(scaledOof, oofTargets): 정규화된 특징으로 Ridge 가중치 학습
  //      → 이후 transform()만 적용하여 테스트 데이터에 동일 변환 적용
  const { oofMat, oofTargets } = buildOofPredictions(prices, ts);

  const xScaler   = new MinMaxScaler();
  const scaledOof = xScaler.fitTransform(oofMat);  // fit + transform (훈련 셋)
  const metaBeta  = fitRidge(scaledOof, oofTargets);

  // ── In-sample 메타 예측 (R², σ 계산용) ─────────────────────────────────────
  //
  // 중요: in-sample 행렬에도 반드시 xScaler.transform()만 사용 (fit 재호출 금지)
  // → 동일한 [min,max] 기준으로 변환해야 메타 가중치(metaBeta)가 의미 있음
  const inSampleMat    = fittedA.map((a, i) => [a, fittedB[i], fittedC[i]]);
  const scaledInSample = xScaler.transform(inSampleMat);
  const y_fit          = mv(scaledInSample, metaBeta);
  const resids         = prices.map((p, i) => p - y_fit[i]);
  const sigma          = stddev(resids);
  const R2             = r2(prices, y_fit);

  // ── 미래 30 거래일 예측 ─────────────────────────────────────────────────────
  const futureDates = nextTradingDates(dates[n - 1], FORECAST_DAYS);
  const futureTs    = futureDates.map(d => (d.getTime() - tMin) / tSpan);

  const futureA = predictLinear(coefA, futureTs);
  const futureB = holtForecast(stateB, FORECAST_DAYS);
  const futureC = multiEmaForecast(prices, FORECAST_DAYS);

  // 미래 행렬도 훈련 통계(xScaler)로 transform만 적용
  const futureMat      = futureA.map((a, i) => [a, futureB[i], futureC[i]]);
  const scaledFuture   = xScaler.transform(futureMat);
  const y_future       = mv(scaledFuture, metaBeta);

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

  const regimeShifts = detectRegimeShifts(prices, dates);

  // ── 추천 신호 생성 ───────────────────────────────────────────────────────────
  const currentPrice = prices[n - 1];

  // 5일 / 7일 / 30일 예측 수익률
  // Math.min으로 predictions 배열 범위 초과 방지 (충분한 데이터 없을 경우)
  const pred5d  = predictions[Math.min(4,  predictions.length - 1)]?.yhat ?? currentPrice;
  const pred7d  = predictions[Math.min(6,  predictions.length - 1)]?.yhat ?? currentPrice;
  const pred30d = predictions[Math.min(29, predictions.length - 1)]?.yhat ?? currentPrice;

  const return5d  = ((pred5d  - currentPrice) / currentPrice) * 100;
  const return7d  = ((pred7d  - currentPrice) / currentPrice) * 100;
  const return30d = ((pred30d - currentPrice) / currentPrice) * 100;

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

  // ── ATR(14) 계산 — 리스크 조정 수익률용 ─────────────────────────────────────
  const atrPct = calcAtrPct(candles, currentPrice);

  // ── Bull / Base / Bear 시나리오 팬 ─────────────────────────────────────────
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
    predicted_return_5d:    return5d,
    predicted_return_7d:    return7d,
    predicted_return_30d:   return30d,
    trend_direction:        trendDir,
    trend_slope_annual_pct: slopeAnnPct,
    r_squared:              R2,
    changepoint_dates:      regimeShifts,
    atr_pct:                atrPct,
    insufficient_data:      false,
  };
}
