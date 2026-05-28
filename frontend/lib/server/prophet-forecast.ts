/**
 * Prophet-inspired time series forecasting (TypeScript implementation)
 *
 * Core model: y(t) = trend(t) + seasonality(t) + ε
 *   trend       – piecewise linear with N_CP changepoints
 *   seasonality – Fourier series (weekly + yearly)
 *   fit method  – Ridge-OLS (approximates Prophet MAP estimate)
 *
 * Reference: Taylor & Letham (2018) "Forecasting at Scale" (The American Statistician)
 */

import { getChart } from "./yahoo-finance";
import type { CandleData } from "./yahoo-finance";

// ── Public types ──────────────────────────────────────────────────────────────

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
  /** Dates where a significant slope change was detected */
  changepoint_dates: string[];
  insufficient_data: boolean;
}

// ── Model hyperparameters ────────────────────────────────────────────────────

const N_CP           = 14;    // number of changepoints
const WEEKLY_ORDER   = 3;     // weekly Fourier order (3 sin/cos pairs)
const YEARLY_ORDER   = 5;     // yearly Fourier order (5 sin/cos pairs)
const RIDGE_LAMBDA   = 5e-5;  // L2 regularization (stabilises near-collinear changepoints)
const FORECAST_DAYS  = 30;    // trading days to forecast
const N_FEATURES     = 2 + N_CP + 2 * (WEEKLY_ORDER + YEARLY_ORDER);

// ── Linear algebra utilities ─────────────────────────────────────────────────

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

/**
 * Solve Ax = b via Gauss-Jordan with partial pivoting.
 * Suitable for small dense systems (< 100 equations).
 */
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

// ── Design matrix ─────────────────────────────────────────────────────────────

/**
 * Build one row of the feature matrix for a given date.
 * @param t        Normalised time in [0, ∞)  (0 = first training day)
 * @param date     Calendar date (for seasonality)
 * @param cps      Changepoint positions in normalised-t space
 */
function featureRow(t: number, date: Date, cps: number[]): Vec {
  const row: Vec = [];

  // ── Piecewise-linear trend ──────────────────────────────────────────────────
  row.push(1);   // intercept
  row.push(t);   // global slope

  // Hinge functions: max(0, t − s_j) contribute slope changes
  for (const s of cps) row.push(t > s ? t - s : 0);

  // ── Weekly seasonality (period P = 7 days) ──────────────────────────────────
  const dow = date.getDay(); // 0 = Sun
  for (let n = 1; n <= WEEKLY_ORDER; n++) {
    row.push(Math.cos(2 * Math.PI * n * dow / 7));
    row.push(Math.sin(2 * Math.PI * n * dow / 7));
  }

  // ── Yearly seasonality (period P = 365.25 days) ─────────────────────────────
  const jan1 = new Date(date.getFullYear(), 0, 1).getTime();
  const doy  = (date.getTime() - jan1) / 86_400_000; // fractional day of year
  for (let n = 1; n <= YEARLY_ORDER; n++) {
    row.push(Math.cos(2 * Math.PI * n * doy / 365.25));
    row.push(Math.sin(2 * Math.PI * n * doy / 365.25));
  }

  return row;
}

function buildX(ts: Vec, dates: Date[], cps: number[]): Mat {
  return ts.map((t, i) => featureRow(t, dates[i], cps));
}

// ── Ridge-OLS fit ─────────────────────────────────────────────────────────────

function fitRidge(X: Mat, y: Vec): Vec {
  const Xt  = tr(X);
  const XtX = mm(Xt, X);
  for (let i = 0; i < XtX.length; i++) XtX[i][i] += RIDGE_LAMBDA; // L2 penalty
  return solve(XtX, mv(Xt, y));
}

// ── Metrics ───────────────────────────────────────────────────────────────────

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

// ── Trend evaluation ──────────────────────────────────────────────────────────

function evalTrend(t: number, beta: Vec, cps: number[]): number {
  let g = beta[0] + beta[1] * t;
  for (let j = 0; j < N_CP; j++) g += (t > cps[j] ? t - cps[j] : 0) * beta[2 + j];
  return g;
}

// ── Changepoint detection ─────────────────────────────────────────────────────

/** Return dates of changepoints with slope change large enough to be meaningful */
function significantChangepoints(beta: Vec, cps: number[], ts: Vec, dates: Date[]): string[] {
  const baseMagnitude = Math.abs(beta[1]) || 1;
  const threshold     = baseMagnitude * 0.25;
  const result: string[] = [];
  for (let j = 0; j < N_CP; j++) {
    if (Math.abs(beta[2 + j]) > threshold) {
      const idx = ts.findIndex(t => t >= cps[j]);
      if (idx >= 0) result.push(dates[idx].toISOString().slice(0, 10));
    }
  }
  return result;
}

// ── Next trading days ─────────────────────────────────────────────────────────

/** Generate the next `n` calendar dates, skipping weekends */
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

  if (candles.length < N_FEATURES + 5) return EMPTY;

  // ── Prepare data ────────────────────────────────────────────────────────────
  const dates  = candles.map(c => new Date(c.time));
  const prices = candles.map(c => c.close);
  const n      = prices.length;

  // Normalise t so that training span = [0, 1].
  // This keeps numeric values manageable regardless of absolute price level.
  const tMin  = dates[0].getTime();
  const tSpan = dates[n - 1].getTime() - tMin;
  const ts    = dates.map(d => (d.getTime() - tMin) / tSpan);

  // ── Changepoints at uniform quantiles across 80% of training data ───────────
  const cpN  = Math.floor(n * 0.8);
  const cps  = Array.from({ length: N_CP }, (_, i) =>
    ts[Math.floor((i + 1) * cpN / (N_CP + 1))],
  );

  // ── Fit model ────────────────────────────────────────────────────────────────
  const X_train = buildX(ts, dates, cps);
  const beta    = fitRidge(X_train, prices);

  const y_fit  = mv(X_train, beta);
  const resids = prices.map((p, i) => p - y_fit[i]);
  const sigma  = stddev(resids);
  const R2     = r2(prices, y_fit);

  // ── Significant changepoints ─────────────────────────────────────────────────
  const cpDates = significantChangepoints(beta, cps, ts, dates);

  // ── Future prediction ────────────────────────────────────────────────────────
  const futureDates = nextTradingDates(dates[n - 1], FORECAST_DAYS);
  const futureTs    = futureDates.map(d => (d.getTime() - tMin) / tSpan);
  const X_future    = buildX(futureTs, futureDates, cps);
  const y_future    = mv(X_future, beta);

  const predictions: ProphetPoint[] = futureDates.map((d, i) => {
    // Uncertainty grows with forecast horizon
    const sigScale  = 1 + (i / FORECAST_DAYS) * 1.5;
    const trend_val = evalTrend(futureTs[i], beta, cps);
    return {
      date:        d.toISOString().slice(0, 10),
      yhat:        Math.max(0, y_future[i]),
      yhat_lower:  Math.max(0, y_future[i] - 1.96 * sigma * sigScale),
      yhat_upper:  y_future[i] + 1.96 * sigma * sigScale,
      trend:       trend_val,
    };
  });

  // ── Historical fit + actual prices (last 60 days) ────────────────────────────
  const histStart  = Math.max(0, n - 60);
  const history_fit: ProphetPoint[] = dates.slice(histStart).map((d, i) => {
    const idx = histStart + i;
    return {
      date:        d.toISOString().slice(0, 10),
      yhat:        Math.max(0, y_fit[idx]),
      yhat_lower:  Math.max(0, y_fit[idx] - 1.96 * sigma),
      yhat_upper:  y_fit[idx] + 1.96 * sigma,
      trend:       evalTrend(ts[idx], beta, cps),
    };
  });

  const history_actual = dates.slice(histStart).map((d, i) => ({
    date:  d.toISOString().slice(0, 10),
    price: prices[histStart + i],
  }));

  // ── Recommendation ────────────────────────────────────────────────────────────
  const currentPrice   = prices[n - 1];
  const pred7d         = predictions[Math.min(6,  predictions.length - 1)]?.yhat ?? currentPrice;
  const pred30d        = predictions[Math.min(29, predictions.length - 1)]?.yhat ?? currentPrice;
  const return7d       = ((pred7d  - currentPrice) / currentPrice) * 100;
  const return30d      = ((pred30d - currentPrice) / currentPrice) * 100;

  // Annualised trend slope from the last training point
  const trendNow    = evalTrend(ts[n - 1],        beta, cps);
  const trendFuture = evalTrend(ts[n - 1] + 1.0,  beta, cps); // +1 normalised year
  const slopeAnnPct = Math.abs(trendNow) > 1
    ? ((trendFuture - trendNow) / Math.abs(trendNow)) * 100
    : 0;

  const trendDir: "up" | "down" | "flat" =
    slopeAnnPct > 5 ? "up" : slopeAnnPct < -5 ? "down" : "flat";

  // Scale return by model confidence (low R² → conservative)
  const confidence     = Math.max(0.3, R2);
  const adjReturn      = return30d * confidence;

  const recommendation: ProphetForecastResult["recommendation"] =
    adjReturn >  8 ? "strong_buy"  :
    adjReturn >  3 ? "buy"         :
    adjReturn > -3 ? "hold"        :
    adjReturn > -8 ? "sell"        : "strong_sell";

  // ── Bull / Base / Bear scenarios ─────────────────────────────────────────────
  //
  // Methodology:
  //   Base  = Prophet MAP prediction (yhat)
  //   Bull  = Base + scenario_spread (optimistic: trend accelerates or reverses)
  //   Bear  = Base - scenario_spread × 1.15 (pessimistic, slightly asymmetric)
  //
  // spread(i) = trend_component(i) + noise_component(i)
  //   trend_component : proportional to |30d base slope| → captures directional uncertainty
  //   noise_component : σ × √(i/30)                     → captures model fit uncertainty
  //
  // Both components grow with forecast horizon so the fan widens naturally.

  const dailyAbsSlope = Math.abs(pred30d - currentPrice) / FORECAST_DAYS;

  function scenarioSpread(i: number): number {
    const horizonFrac  = (i + 1) / FORECAST_DAYS;
    const trendPart    = dailyAbsSlope * (i + 1) * 0.55;
    const noisePart    = sigma * Math.sqrt(horizonFrac) * 0.80;
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
    changepoint_dates:      cpDates,
    insufficient_data:      false,
  };
}
