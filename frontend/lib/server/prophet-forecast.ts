/**
 * Hybrid Stacking Ensemble — time series forecasting (TypeScript)
 *
 * 2-Layer 스태킹 앙상블 아키텍처:
 *
 *   Layer 1 — 베이스 모델 4종 (이질적 귀납 편향으로 상호 보완):
 *     A. LinearTrend : OLS 선형 회귀           — 장기 방향성 드리프트 포착
 *     B. Holt's DES  : 이중 지수 평활법        — 레벨 + 추세 적응적 학습
 *     C. MultiEMA    : 10/20/50일 EMA 블렌드  — 단·중기 모멘텀 포착
 *     D. TFT         : 어텐션 기반 패턴 매칭   — 유사 역사 패턴 + 섹터 컨텍스트
 *
 *   Layer 2 — Ridge 메타 모델:
 *     ① StandardScaler로 OOF 예측값 z-score 정규화 (4-모델 스케일 편향 제거)
 *     ② 워크-포워드 OOF(Out-of-Fold) 예측값으로 메타 Ridge 학습
 *        → 베이스 모델의 과적합 예측이 메타 학습에 사용되는 데이터 누수 방지
 *
 *   리스크 지표:
 *     ATR(14) 기반 atr_pct + 앙상블 다양성 스코어 (모델 간 상관관계 패널티)
 *
 * TFT 구현 원칙:
 *   정통 TFT(PyTorch)는 역전파 학습이 필요하여 TypeScript 서버리스 환경에서 불가.
 *   대신 TFT의 핵심 아이디어(어텐션 기반 유사 패턴 검색)를 해석적으로 구현:
 *     - 쿼리/키/밸류: 수익률 z-score 임베딩 (20일 × 2 = 40차원)
 *     - 4헤드 스케일드 닷프로덕트 어텐션 (헤드당 10차원)
 *     - Static covariate(섹터·PER·PBR·ROE) → 어텐션 바이어스 + GRN 게이트
 *
 * 공개 인터페이스 하위 호환 유지:
 *   ProphetForecastResult 기존 필드 유지, 신규 필드 추가:
 *     tft_return_30d, linear_return_5d, diversity_score
 */

import { supabase } from "./supabase";
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
  bull_return_30d: number;
  base_return_30d: number;
  bear_return_30d: number;
  bull_price_30d: number;
  base_price_30d: number;
  bear_price_30d: number;
}

/**
 * TFT Layer 1에 전달할 정적 공변량.
 * 섹터·재무지표 → 어텐션 바이어스 + GRN 게이트 강도로 변환.
 */
export interface StaticCovariates {
  sector?: string;
  per?:    number | null;
  pbr?:    number | null;
  roe?:    number | null;
}

export interface ProphetForecastResult {
  ticker: string;
  current_price: number;
  predictions: ProphetPoint[];
  history_fit: ProphetPoint[];
  history_actual: { date: string; price: number }[];
  scenarios: ProphetScenarios;
  recommendation: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  predicted_return_5d: number;
  predicted_return_7d: number;
  predicted_return_30d: number;
  trend_direction: "up" | "down" | "flat";
  trend_slope_annual_pct: number;
  r_squared: number;
  changepoint_dates: string[];
  atr_pct: number;
  /** TFT 모델(Model D)의 독립적 30일 예측 수익률 (크론 복합 스코어용) */
  tft_return_30d: number;
  /** LinearTrend 모델(Model A)의 독립적 5일 예측 수익률 (크론 복합 스코어용) */
  linear_return_5d: number;
  /** 4개 베이스 모델 OOF 상관관계 기반 다양성 팩터 [0.88, 1.0] */
  diversity_score: number;
  insufficient_data: boolean;
}

// ── Hyperparameters ───────────────────────────────────────────────────────────

const FORECAST_DAYS = 30;
const MIN_SAMPLES   = 40;
const EMA_SPANS     = [10, 20, 50] as const;
const HOLT_ALPHA    = 0.3;
const HOLT_BETA     = 0.1;
const RIDGE_LAMBDA  = 1e-4;
const N_FOLDS       = 4;
const ATR_PERIOD    = 14;
const ATR_PCT_FLOOR = 0.5;
const ATR_PCT_CEIL  = 12.0;

// TFT 하이퍼파라미터
const TFT_HEADS = 4;
const TFT_WIN   = 20;   // 임베딩 윈도우 (일)
const TFT_TEMP  = 0.3;  // 소프트맥스 온도 (낮을수록 어텐션 집중)

// ── Linear algebra utilities ──────────────────────────────────────────────────

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

function fitRidge(X: Mat, y: Vec, hasIntercept = false): Vec {
  const Xt  = tr(X);
  const XtX = mm(Xt, X);
  // intercept 컬럼(i=0)은 L2 페널티 제외: 절편 수축 시 주가 레벨 예측값 붕괴
  for (let i = hasIntercept ? 1 : 0; i < XtX.length; i++) XtX[i][i] += RIDGE_LAMBDA;
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

// ── StandardScaler ────────────────────────────────────────────────────────────
//
// Layer 2 Ridge 입력 정규화 전용. MinMaxScaler 대체.
//
// StandardScaler vs MinMaxScaler:
//   StandardScaler: z = (x-μ)/σ  → 이상치에 강인, 모델 간 분산 정규화
//   MinMaxScaler:   x' = (x-min)/(max-min) → 이상치에 민감, [0,1] 고정
//   → 4개 이질 모델(Linear·Holt·MultiEMA·TFT)은 같은 주가 스케일이지만
//     단기 레짐에서 편차가 상이 → 분산 기준 정규화(StandardScaler)가 더 적합
//
// 핵심 원칙: fit()은 반드시 OOF 행렬에서만 호출. 미래·인샘플은 transform()만.

class StandardScaler {
  private means: number[] = [];
  private stds:  number[] = [];

  fit(X: Mat): this {
    const nCols = X[0]?.length ?? 0;
    for (let j = 0; j < nCols; j++) {
      const col  = X.map(row => row[j]);
      const mean = col.reduce((s, v) => s + v, 0) / col.length;
      const std  = Math.sqrt(col.reduce((s, v) => s + (v - mean) ** 2, 0) / col.length);
      this.means[j] = mean;
      this.stds[j]  = std < 1e-10 ? 1 : std;
    }
    return this;
  }

  transform(X: Mat): Mat {
    return X.map(row =>
      row.map((v, j) => (v - this.means[j]) / this.stds[j]),
    );
  }

  fitTransform(X: Mat): Mat { return this.fit(X).transform(X); }
}

// ── ATR(14) ───────────────────────────────────────────────────────────────────

function calcAtrPct(candles: CandleData[], currentPrice: number): number {
  if (candles.length < 2 || currentPrice <= 0) return 3.0;

  const recent = candles.slice(-(ATR_PERIOD + 1));
  const trs: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const high      = recent[i].high  ?? recent[i].close;
    const low       = recent[i].low   ?? recent[i].close;
    const prevClose = recent[i - 1].close;
    trs.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low  - prevClose),
    ));
  }
  if (trs.length === 0) return 3.0;

  const atrWindow = Math.min(ATR_PERIOD, trs.length);
  const atr       = trs.slice(-atrWindow).reduce((s, v) => s + v, 0) / atrWindow;
  return Math.min(ATR_PCT_CEIL, Math.max(ATR_PCT_FLOOR, (atr / currentPrice) * 100));
}

// ── Layer 1 — Model D: TFT (Temporal Fusion Transformer 근사) ─────────────────
//
// 구현 방식: 어텐션 기반 역사적 패턴 매칭
//
//   정통 TFT와 차이점:
//     - 파라미터 학습(역전파) 없음 → 분석적 어텐션 계산
//     - 쿼리/키 프로젝션: z-score 임베딩 (학습된 선형 변환 대신)
//     - GRN: sigmoid 게이트 근사 (학습된 MLP 대신)
//
//   보존된 TFT 원리:
//     - Multi-head scaled dot-product attention (4헤드 × 10차원 = 40 hidden)
//     - Static covariate 통합 (섹터 바이어스 + 재무지표 품질/가치 팩터)
//     - 멀티스텝 출력 (각 호라이즌 h마다 독립 attention 계산)
//     - Variable Selection: 암묵적으로 임베딩 내 분산 높은 방향이 선택됨
//
//   핵심 아이디어:
//     현재 20일 가격 패턴(쿼리)과 유사한 역사적 패턴(키)을 찾아
//     그 이후 h일에 실제로 어떻게 됐는지(값)의 가중 평균으로 예측.
//     Static covariates는 강세/약세 패턴에 바이어스를 추가.

/** 섹터별 성장 기대 바이어스 (어텐션 스코어에 가산) */
const SECTOR_BIAS: Record<string, number> = {
  "반도체":   0.12,  "디스플레이": 0.05,  "2차전지":  0.10,  "배터리":   0.10,
  "방산":     0.08,  "항공":       0.06,  "바이오":   0.05,  "헬스케어": 0.04,
  "IT서비스": 0.04,  "게임":       0.03,  "엔터":     0.03,  "콘텐츠":   0.02,
  "자동차":   0.00,  "부품":       0.01,  "조선":     0.06,  "해운":     0.05,
  "화학":    -0.02,  "정유":      -0.03,  "에너지":  -0.02,  "유틸리티": -0.04,
  "금융":    -0.02,  "보험":      -0.03,  "증권":    -0.01,  "은행":    -0.03,
  "유통":    -0.03,  "소비재":    -0.01,  "통신":    -0.04,  "철강":    -0.02,
  "건설":    -0.03,  "부동산":    -0.04,  "소재":    -0.01,  "물류":     0.01,
  "소부장":   0.08,  "이차전지":   0.10,
};

interface StaticContext { bias: number; grnScale: number }

/**
 * Static covariates → 어텐션 바이어스 + GRN 게이트 강도 변환.
 *   bias     : 역사적 상승 패턴 쪽으로 어텐션 가중 (-0.3 ~ +0.3)
 *   grnScale : 예측 수익률 스케일 팩터 (0.7 ~ 1.3)
 */
function computeStaticContext(cov: StaticCovariates): StaticContext {
  const sectorBias = SECTOR_BIAS[cov.sector ?? ""] ?? 0;

  let valueBias = 0;
  if (cov.per != null && cov.per > 0) {
    if      (cov.per < 12)  valueBias += 0.05;
    else if (cov.per < 20)  valueBias += 0.02;
    else if (cov.per > 35)  valueBias -= 0.04;
  }
  if (cov.pbr != null && cov.pbr > 0) {
    if      (cov.pbr < 0.8)  valueBias += 0.04;
    else if (cov.pbr < 1.5)  valueBias += 0.01;
    else if (cov.pbr > 3.0)  valueBias -= 0.03;
  }

  let qualityBias = 0;
  if (cov.roe != null) {
    if      (cov.roe > 20)  qualityBias += 0.05;
    else if (cov.roe > 12)  qualityBias += 0.02;
    else if (cov.roe < 0)   qualityBias -= 0.04;
    else if (cov.roe < 5)   qualityBias -= 0.02;
  }

  const totalBias = sectorBias + valueBias + qualityBias;
  // sigmoid(totalBias × 5) ∈ [0, 1]; totalBias=0 → 0.5 → grnScale=1.0
  const sigmoid   = 1 / (1 + Math.exp(-totalBias * 5));
  const grnScale  = 0.7 + sigmoid * 0.6; // [0.7, 1.3]

  return { bias: totalBias, grnScale };
}

/**
 * 20일 가격 윈도우 → 40차원 임베딩 벡터.
 *   [0..19]  : z-score 정규화 가격 시퀀스 (패턴 형태)
 *   [20..39] : z-score 정규화 일간 수익률 (0 패딩 선두)
 *
 * 4헤드 분리:
 *   Head 0: dims [0..9]   — 윈도우 전반부 가격 패턴
 *   Head 1: dims [10..19] — 윈도우 후반부 가격 패턴
 *   Head 2: dims [20..29] — 전반부 모멘텀
 *   Head 3: dims [30..39] — 후반부 모멘텀
 */
function embedPriceWindow(prices: Vec, endIdx: number, winSize: number): Vec {
  const start = Math.max(0, endIdx - winSize + 1);
  const raw: Vec = prices.slice(start, endIdx + 1);
  while (raw.length < winSize) raw.unshift(raw[0] ?? 0);

  const sum  = raw.reduce((s, v) => s + v, 0);
  const mean = sum / raw.length;
  const std  = Math.sqrt(raw.reduce((s, v) => s + (v - mean) ** 2, 0) / raw.length) || 1;
  const norm = raw.map(v => (v - mean) / std);

  const rets: Vec = raw.slice(1).map((p, i) => (p - raw[i]) / (raw[i] || 1));
  const retsMu  = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
  const retsSig = Math.sqrt(rets.reduce((s, v) => s + (v - retsMu) ** 2, 0) / (rets.length || 1)) || 1;
  const normedRets = rets.map(r => (r - retsMu) / retsSig);
  const retsPad = [0, ...normedRets]; // winSize 개로 맞춤

  return [...norm, ...retsPad];
}

/** 4-헤드 스케일드 닷프로덕트 어텐션 스코어 (scalar) */
function multiHeadDot(q: Vec, k: Vec): number {
  const headDim = Math.floor(q.length / TFT_HEADS);
  let total = 0;
  for (let h = 0; h < TFT_HEADS; h++) {
    const s = h * headDim;
    const e = Math.min(s + headDim, q.length);
    let dot = 0;
    for (let j = s; j < e; j++) dot += q[j] * k[j];
    total += dot / Math.sqrt(e - s);
  }
  return total / TFT_HEADS;
}

/** 수치 안정 소프트맥스 (max-subtract + temperature 스케일링) */
function softmaxT(logits: Vec, temperature: number): Vec {
  const scaled = logits.map(v => v / Math.max(temperature, 1e-6));
  const maxV   = Math.max(...scaled);
  const exp    = scaled.map(v => Math.exp(Math.min(v - maxV, 500)));
  const sum    = exp.reduce((s, v) => s + v, 0) || 1;
  return exp.map(v => v / sum);
}

/**
 * TFT 멀티스텝 예측.
 * 각 호라이즌 h에 대해 독립적인 어텐션 계산:
 *   Q = 현재 20일 임베딩
 *   K[i] = 역사적 위치 i의 20일 임베딩
 *   V[i] = prices[i + h] (i에서 h일 후 실제 가격)
 *   output[h-1] = sum(softmax(Q·K^T/sqrt(d) + static_bias) × V)
 */
function tftForecastMultiStep(
  prices:        Vec,
  forecastSteps: number,
  cov:           StaticCovariates,
): Vec {
  const winSize = Math.min(TFT_WIN, prices.length);
  if (prices.length < winSize + 1) {
    return new Array(forecastSteps).fill(prices[prices.length - 1] ?? 0);
  }

  const lastPrice        = prices[prices.length - 1];
  const query            = embedPriceWindow(prices, prices.length - 1, winSize);
  const { bias, grnScale } = computeStaticContext(cov);

  return Array.from({ length: forecastSteps }, (_, hIdx) => {
    const h = hIdx + 1;

    const scores: number[] = [];
    const vals:   number[] = [];
    const futRets: number[] = [];

    for (let endI = winSize - 1; endI + h < prices.length; endI++) {
      scores.push(multiHeadDot(query, embedPriceWindow(prices, endI, winSize)));
      vals.push(prices[endI + h]);
      futRets.push((prices[endI + h] - prices[endI]) / (prices[endI] || 1));
    }

    if (scores.length === 0) return lastPrice;

    // 섹터 바이어스: 강세 섹터는 역사적 상승 패턴에 더 높은 어텐션
    const biased  = scores.map((s, i) => s + bias * 0.15 * Math.sign(futRets[i]));
    const weights = softmaxT(biased, TFT_TEMP);

    const rawPred  = weights.reduce((sum, w, i) => sum + w * vals[i], 0);

    // GRN 게이트: 예측 수익률을 섹터/재무 컨텍스트로 스케일
    // grnScale=1.0(중립) → 변동 없음, >1(강세) → 상방 확대, <1(약세) → 하방 확대
    const rawRet   = (rawPred - lastPrice) / (lastPrice || 1);
    return Math.max(0, lastPrice * (1 + rawRet * grnScale));
  });
}

/**
 * TFT 인샘플 적합값 (history_fit 시각화 + R² 계산용).
 * 전체 가격 히스토리를 키/밸류 DB로 구축 후
 * 각 시점 t에서 t-1까지 패턴으로 t를 예측.
 * 주의: 미래 데이터 키 포함 → lookahead bias 있음.
 *   LinearTrend fittedA도 동일 bias 있음 (인샘플 용도는 display 전용).
 */
function computeTftFittedValues(prices: Vec, cov: StaticCovariates): Vec {
  const n       = prices.length;
  const winSize = Math.min(TFT_WIN, n);
  const { bias, grnScale } = computeStaticContext(cov);

  const fitted: Vec = [...prices];

  for (let t = winSize; t < n; t++) {
    const query   = embedPriceWindow(prices, t - 1, winSize);
    const scores: number[] = [];
    const vals:   number[] = [];

    // endI+1 ≤ t-1 → endI ≤ t-2: 시점 t 이전 데이터만 키/밸류로 한정 (인과성 보장)
    // 기존: allKeys 전체 빌드 → 미래 키 포함 → R² 과대 추정 + sigma 과소 추정
    for (let endI = winSize - 1; endI <= t - 2; endI++) {
      const futRet = (prices[endI + 1] - prices[endI]) / (prices[endI] || 1);
      scores.push(
        multiHeadDot(query, embedPriceWindow(prices, endI, winSize)) +
        bias * 0.15 * Math.sign(futRet),
      );
      vals.push(prices[endI + 1]);
    }

    if (scores.length === 0) { fitted[t] = prices[t - 1]; continue; }

    const weights = softmaxT(scores, TFT_TEMP);
    const rawPred = weights.reduce((sum, w, i) => sum + w * vals[i], 0);
    const rawRet  = (rawPred - prices[t - 1]) / (prices[t - 1] || 1);
    fitted[t]     = Math.max(0, prices[t - 1] * (1 + rawRet * grnScale));
  }

  return fitted;
}

// ── Layer 1 — Model A: OLS Linear Trend ──────────────────────────────────────

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

// ── Layer 1 — Model B: Holt's Double Exponential Smoothing ───────────────────

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

// ── Layer 1 — Model C: Multi-EMA Blend ───────────────────────────────────────

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

// ── 모델 간 상관관계 패널티 ───────────────────────────────────────────────────

function pearsonCorr(a: Vec, b: Vec): number {
  const n = a.length;
  if (n < 2) return 0;
  const muA = a.reduce((s, v) => s + v, 0) / n;
  const muB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - muA, dB = b[i] - muB;
    cov  += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }
  const denom = Math.sqrt(varA * varB);
  return denom < 1e-10 ? 0 : cov / denom;
}

/**
 * 4개 베이스 모델 OOF 예측의 6쌍 피어슨 상관계수 기반 다양성 팩터.
 *
 * 평균 절대 상관 ≤ 0.80 → 패널티 없음 (factor = 1.0)
 * 평균 절대 상관 = 1.00 → 최대 12% 패널티 (factor = 0.88)
 *
 * 직관: 4개 모델이 모두 같은 방향을 예측하면 앙상블 다양성이 없음.
 *        TFT가 다른 3개 모델과 독립적 신호를 제공할수록 factor가 높음.
 */
function computeDiversityScore(oofA: Vec, oofB: Vec, oofC: Vec, oofD: Vec): number {
  if (oofA.length < 4) return 1.0;

  const corrs = [
    Math.abs(pearsonCorr(oofA, oofB)),
    Math.abs(pearsonCorr(oofA, oofC)),
    Math.abs(pearsonCorr(oofA, oofD)),
    Math.abs(pearsonCorr(oofB, oofC)),
    Math.abs(pearsonCorr(oofB, oofD)),
    Math.abs(pearsonCorr(oofC, oofD)),
  ];

  const avgCorr = corrs.reduce((s, v) => s + v, 0) / corrs.length;
  // 0.80부터 패널티 시작, 1.00에서 최대 0.12 패널티
  const penalty = Math.max(0, avgCorr - 0.80) * 0.6;
  return Math.max(0.88, 1.0 - penalty);
}

// ── Walk-forward OOF (4-model) ────────────────────────────────────────────────

interface OofResult {
  oofMat:     Mat;
  oofTargets: Vec;
  oofA:       Vec;
  oofB:       Vec;
  oofC:       Vec;
  oofD:       Vec;
}

function buildOofPredictions(
  prices: Vec,
  ts:     Vec,
  cov:    StaticCovariates,
): OofResult {
  const n    = prices.length;
  const step = Math.max(Math.floor(n / (N_FOLDS + 1)), 10);

  const oofRows: number[][] = [];
  const oofY:    number[]   = [];
  const oofA:    Vec        = [];
  const oofB:    Vec        = [];
  const oofC:    Vec        = [];
  const oofD:    Vec        = [];

  for (let fold = 0; fold < N_FOLDS; fold++) {
    const trEnd = (fold + 1) * step;
    const vaEnd = Math.min(trEnd + step, n);
    if (trEnd >= n) break;

    const trP   = prices.slice(0, trEnd);
    const trT   = ts.slice(0, trEnd);
    const vaLen = vaEnd - trEnd;
    const vaT   = ts.slice(trEnd, vaEnd);
    const vaP   = prices.slice(trEnd, vaEnd);

    const coefA  = fitLinear(trT, trP);
    const predA  = predictLinear(coefA, vaT);

    const stateB = holtFit(trP, HOLT_ALPHA, HOLT_BETA);
    const predB  = holtForecast(stateB, vaLen);

    const predC  = multiEmaForecast(trP, vaLen);

    // TFT: 훈련 데이터만 사용 → 데이터 누수 없음
    const predD  = tftForecastMultiStep(trP, vaLen, cov);

    for (let i = 0; i < vaLen; i++) {
      oofRows.push([predA[i], predB[i], predC[i], predD[i]]);
      oofY.push(vaP[i]);
      oofA.push(predA[i]);
      oofB.push(predB[i]);
      oofC.push(predC[i]);
      oofD.push(predD[i]);
    }
  }

  return { oofMat: oofRows, oofTargets: oofY, oofA, oofB, oofC, oofD };
}

// ── 레짐 전환 감지 ────────────────────────────────────────────────────────────

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

// ── 다음 거래일 생성 ──────────────────────────────────────────────────────────

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

// ── Supabase row type (Python hybrid_ensemble.py 저장 스키마) ─────────────────

interface SupabaseRow {
  run_date:             string;
  rank:                 number | null;
  ticker:               string;
  name:                 string;
  current_price:        number;
  predicted_return_7d:  number;    // = alpha_5d × 100
  predicted_return_30d: number;
  bull_return_30d:      number;
  base_return_30d:      number;
  bear_return_30d:      number;
  recommendation:       string;
  r_squared:            number;
  trend_direction:      string;
  accuracy_json:        string | null;
}

function buildResultFromSupabase(
  row: SupabaseRow,
  candles: CandleData[],
  ticker: string,
): ProphetForecastResult {
  const acc = row.accuracy_json ? (JSON.parse(row.accuracy_json) as Record<string, number | boolean>) : {};
  const cp  = row.current_price;

  // 역사 적합 (최근 90봉 선형 OLS — 차트 표시용)
  const hist = candles.slice(-90);
  const hp   = hist.map(c => c.close);
  const hn   = hp.length;
  const sumX  = (hn * (hn - 1)) / 2;
  const sumX2 = (hn * (hn - 1) * (2 * hn - 1)) / 6;
  const sumY  = hp.reduce((s, v) => s + v, 0);
  const sumXY = hp.reduce((s, v, i) => s + i * v, 0);
  const denom = hn * sumX2 - sumX * sumX || 1;
  const hSlope = (hn * sumXY - sumX * sumY) / denom;
  const hInt   = (sumY - hSlope * sumX) / hn;

  const history_fit: ProphetPoint[] = hist.map((c, i) => {
    const yhat = hSlope * i + hInt;
    return { date: typeof c.time === "string" ? c.time : new Date(c.time).toISOString().slice(0, 10), yhat, yhat_lower: yhat * 0.97, yhat_upper: yhat * 1.03, trend: yhat };
  });
  const history_actual = hist.map(c => ({
    date:  typeof c.time === "string" ? c.time : new Date(c.time).toISOString().slice(0, 10),
    price: c.close,
  }));

  // 미래 30 거래일 시나리오
  const lastDate   = new Date(candles[candles.length - 1].time);
  const futureDts  = nextTradingDates(lastDate, FORECAST_DAYS);
  const base30     = cp * (1 + row.predicted_return_30d / 100);
  const bull30     = cp * (1 + row.bull_return_30d       / 100);
  const bear30     = cp * (1 + row.bear_return_30d       / 100);

  const mkScenario = (target: number): ScenarioPoint[] =>
    futureDts.map((d, i) => ({
      date:  d.toISOString().slice(0, 10),
      price: cp + (target - cp) * ((i + 1) / FORECAST_DAYS),
    }));

  const predictions: ProphetPoint[] = futureDts.map((d, i) => {
    const yhat = cp + (base30 - cp) * ((i + 1) / FORECAST_DAYS);
    return { date: d.toISOString().slice(0, 10), yhat, yhat_lower: yhat * 0.97, yhat_upper: yhat * 1.03, trend: yhat };
  });

  return {
    ticker,
    current_price:          cp,
    predictions,
    history_fit,
    history_actual,
    scenarios: {
      bull: mkScenario(bull30),
      base: mkScenario(base30),
      bear: mkScenario(bear30),
      bull_return_30d: row.bull_return_30d,
      base_return_30d: row.base_return_30d,
      bear_return_30d: row.bear_return_30d,
      bull_price_30d:  bull30,
      base_price_30d:  base30,
      bear_price_30d:  bear30,
    },
    recommendation:         (row.recommendation ?? "hold") as ProphetForecastResult["recommendation"],
    predicted_return_5d:    typeof acc.predicted_return_10d === "number" ? acc.predicted_return_10d
                          : typeof acc.predicted_return_5d  === "number" ? acc.predicted_return_5d
                          : row.predicted_return_7d,
    predicted_return_7d:    row.predicted_return_7d,
    predicted_return_30d:   row.predicted_return_30d,
    trend_direction:        (row.trend_direction ?? "flat") as ProphetForecastResult["trend_direction"],
    trend_slope_annual_pct: typeof acc.trend_slope_annual_pct === "number" ? acc.trend_slope_annual_pct : 0,
    r_squared:              row.r_squared ?? 0,
    changepoint_dates:      [],
    atr_pct:                typeof acc.atr_pct === "number" ? acc.atr_pct : ATR_PCT_FLOOR,
    tft_return_30d:         row.predicted_return_30d,
    linear_return_5d:       typeof acc.predicted_return_10d === "number" ? acc.predicted_return_10d
                          : typeof acc.predicted_return_5d  === "number" ? acc.predicted_return_5d
                          : row.predicted_return_7d,
    diversity_score:        1.0,
    insufficient_data:      false,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function prophetForecast(
  tickerOrCandles: string | CandleData[],
  covariates: StaticCovariates = {},
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
    tft_return_30d:         0,
    linear_return_5d:       0,
    diversity_score:        1.0,
    insufficient_data:      true,
  };

  if (candles.length < MIN_SAMPLES) return EMPTY;

  // ── Supabase 우선 조회 (Python LightGBM 앙상블 — 3거래일 이내 신선도) ────────
  if (typeof tickerOrCandles === "string") {
    try {
      const { data: row } = await supabase
        .from("prophet_recommendations")
        .select("*")
        .eq("ticker", ticker)
        .order("run_date", { ascending: false })
        .limit(1)
        .single();

      if (row) {
        const diffDays = (Date.now() - new Date((row as SupabaseRow).run_date).getTime()) / 86_400_000;
        if (diffDays <= 3) {
          return buildResultFromSupabase(row as SupabaseRow, candles, ticker);
        }
      }
    } catch {
      // Supabase 미스 → TypeScript 앙상블 폴백
    }
  }

  // ── 데이터 준비 ──────────────────────────────────────────────────────────────
  const dates  = candles.map(c => new Date(c.time));
  const prices = candles.map(c => c.close);
  const n      = prices.length;

  // 정수 인덱스: 전체 tSpan을 사전에 알아야 하는 미래 참조 차단
  const ts = dates.map((_, i) => i);

  // ── Layer 1: 베이스 모델 4종 전체 인샘플 적합 ───────────────────────────────
  const coefA  = fitLinear(ts, prices);
  const stateB = holtFit(prices, HOLT_ALPHA, HOLT_BETA);

  const fittedA = predictLinear(coefA, ts);
  const fittedB = stateB.fitted;
  const fittedC = multiEmaFit(prices);
  const fittedD = computeTftFittedValues(prices, covariates); // TFT in-sample

  // ── Layer 2: OOF → StandardScaler → Ridge ────────────────────────────────────
  const { oofMat, oofTargets, oofA, oofB, oofC, oofD } =
    buildOofPredictions(prices, ts, covariates);

  // OOF → StandardScaler(모델별 예측 분산 정규화) → 인터셉트 추가 → Ridge(절편 미페널티)
  // StandardScaler: LinearTrend·TFT 등 모델별 예측 분산 차이 → 공정한 가중치 배분
  // hasIntercept=true: 절편(i=0)을 L2 페널티에서 제외 (주가 기본 레벨 수축 방지)
  const xScaler     = new StandardScaler();
  const scaledOof   = xScaler.fitTransform(oofMat);
  const oofWithBias = scaledOof.map(row => [1, ...row]);
  const metaBeta    = fitRidge(oofWithBias, oofTargets, true);

  // 다양성 스코어 (6쌍 상관관계 패널티)
  const diversity_score = computeDiversityScore(oofA, oofB, oofC, oofD);

  // ── 인샘플 메타 예측 (R², σ 계산용) ─────────────────────────────────────────
  const inSampleMat    = fittedA.map((a, i) => [a, fittedB[i], fittedC[i], fittedD[i]]);
  const scaledInSample = xScaler.transform(inSampleMat);
  const y_fit          = mv(scaledInSample.map(row => [1, ...row]), metaBeta);
  const resids         = prices.map((p, i) => p - y_fit[i]);
  const sigma          = stddev(resids);
  const R2             = r2(prices, y_fit);

  // ── 미래 30 거래일 예측 ─────────────────────────────────────────────────────
  const futureDates = nextTradingDates(dates[n - 1], FORECAST_DAYS);
  const futureTs    = Array.from({ length: FORECAST_DAYS }, (_, i) => n + i);

  const futureA = predictLinear(coefA, futureTs);
  const futureB = holtForecast(stateB, FORECAST_DAYS);
  const futureC = multiEmaForecast(prices, FORECAST_DAYS);
  const futureD = tftForecastMultiStep(prices, FORECAST_DAYS, covariates);

  const futureMat    = futureA.map((a, i) => [a, futureB[i], futureC[i], futureD[i]]);
  const scaledFuture = xScaler.transform(futureMat);
  // Ridge 외삽이 음수 가격을 생성하는 것을 물리 하한으로 차단 (주가 ≥ 0)
  const y_future     = mv(scaledFuture.map(row => [1, ...row]), metaBeta)
                         .map(p => Math.max(0, p));

  // ── 개별 모델 수익률 (크론 복합 스코어용) ────────────────────────────────────
  const currentPrice   = prices[n - 1];
  const linear_return_5d = ((futureA[Math.min(4, futureA.length - 1)] - currentPrice) / currentPrice) * 100;
  const tft_return_30d   = ((futureD[Math.min(29, futureD.length - 1)] - currentPrice) / currentPrice) * 100;

  // ── Ridge 앙상블 예측 수익률 ─────────────────────────────────────────────────
  // 수익률 물리 상한: KOSPI 개별주 30일 기준 -75% ~ +150% (급등주 포함 충분한 여유)
  // 이 범위를 벗어나는 예측은 앙상블 발산 신호 — 클리핑으로 UI 노이즈 방지
  const CLIP_30D_MIN = -75;
  const CLIP_30D_MAX = 150;
  const pred5d  = y_future[Math.min(4,  y_future.length - 1)] ?? currentPrice;
  const pred7d  = y_future[Math.min(6,  y_future.length - 1)] ?? currentPrice;
  const pred30d = y_future[Math.min(29, y_future.length - 1)] ?? currentPrice;

  const return5d  = ((pred5d  - currentPrice) / currentPrice) * 100;
  const return7d  = ((pred7d  - currentPrice) / currentPrice) * 100;
  const return30d = Math.max(CLIP_30D_MIN, Math.min(CLIP_30D_MAX,
    ((pred30d - currentPrice) / currentPrice) * 100,
  ));

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

  // ── 추세 + 추천 신호 ─────────────────────────────────────────────────────────
  const tNow      = ts[n - 1];  // = n - 1 (정수 인덱스)
  const tNext1y   = tNow + 252; // 252 거래일(≈ 1년) 선행
  const slopeAnnPct =
    Math.abs(currentPrice) > 1
      ? ((coefA[0] + coefA[1] * tNext1y - currentPrice) / currentPrice) * 100
      : 0;

  const trendDir: "up" | "down" | "flat" =
    slopeAnnPct > 5 ? "up" : slopeAnnPct < -5 ? "down" : "flat";

  const confidence = Math.max(0.3, R2) * diversity_score;
  const adjReturn  = return30d * confidence;

  const recommendation: ProphetForecastResult["recommendation"] =
    adjReturn >  8 ? "strong_buy"  :
    adjReturn >  3 ? "buy"         :
    adjReturn > -3 ? "hold"        :
    adjReturn > -8 ? "sell"        : "strong_sell";

  // ── ATR(14) ───────────────────────────────────────────────────────────────
  const atrPct = calcAtrPct(candles, currentPrice);

  // ── Bull / Base / Bear 시나리오 팬 ─────────────────────────────────────────
  const dailyAbsSlope = Math.abs(pred30d - currentPrice) / FORECAST_DAYS;

  function scenarioSpread(i: number): number {
    const horizonFrac = (i + 1) / FORECAST_DAYS;
    return dailyAbsSlope * (i + 1) * 0.55 + sigma * Math.sqrt(horizonFrac) * 0.80;
  }

  const scenarioBull: ScenarioPoint[] = predictions.map((p, i) => ({
    date: p.date, price: Math.max(0, p.yhat + scenarioSpread(i)),
  }));
  const scenarioBase: ScenarioPoint[] = predictions.map(p => ({
    date: p.date, price: Math.max(0, p.yhat),
  }));
  const scenarioBear: ScenarioPoint[] = predictions.map((p, i) => ({
    date: p.date, price: Math.max(0, p.yhat - scenarioSpread(i) * 1.15),
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
    tft_return_30d,
    linear_return_5d,
    diversity_score,
    insufficient_data:      false,
  };
}
