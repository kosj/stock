/**
 * TFT (Technical Factor Trading) 분석 — 서버 공용 모듈
 * app/api/analysis/tft/route.ts 와 lib/server/auto-trade-engine.ts 양쪽에서 사용
 */

import { getChart } from "@/lib/server/yahoo-finance";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface TftFactor {
  key:          string;
  label:        string;
  category:     "past_dynamic" | "static";
  score:        number;
  weight:       number;
  contribution: number;
  value:        string;
  description:  string;
}

export interface TftResult {
  ticker:            string;
  signal:            "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  composite_score:   number;
  factors:           TftFactor[];
  insufficient_data: boolean;
}

// ── 지표 계산 헬퍼 ───────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = gains / (losses || 1e-9);
  return 100 - 100 / (1 + rs);
}

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function calcMACD(closes: number[]): { hist: number; histPrev: number } {
  if (closes.length < 35) return { hist: 0, histPrev: 0 };
  const ema12  = calcEMA(closes, 12);
  const ema26  = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macdLine.slice(-20), 9);
  const n = signal.length;
  return {
    hist:     macdLine[macdLine.length - 1] - signal[n - 1],
    histPrev: macdLine[macdLine.length - 2] - signal[n - 2],
  };
}

function calcBB(closes: number[], period = 20): number {
  if (closes.length < period) return 0.5;
  const recent = closes.slice(-period);
  const mean   = recent.reduce((a, b) => a + b, 0) / period;
  const std    = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  const upper  = mean + 2 * std;
  const lower  = mean - 2 * std;
  const cur    = closes[closes.length - 1];
  return (cur - lower) / ((upper - lower) || 1);
}

function calcVolumeSignal(candles: { close: number; volume: number }[]): number {
  if (candles.length < 21) return 0;
  const recent = candles.slice(-21, -1);
  const avgVol = recent.reduce((a, c) => a + c.volume, 0) / recent.length;
  const last   = candles[candles.length - 1];
  const ratio  = last.volume / (avgVol || 1);
  const isUp   = last.close > candles[candles.length - 2].close;
  return isUp ? Math.min(ratio - 1, 1) : Math.max(-(ratio - 1), -1);
}

function calcMACross(closes: number[], fast: number, slow: number): number {
  if (closes.length < slow) return 0;
  const fastMA = closes.slice(-fast).reduce((a, b) => a + b, 0) / fast;
  const slowMA = closes.slice(-slow).reduce((a, b) => a + b, 0) / slow;
  return (fastMA / slowMA - 1) * 100;
}

function calcMomentum(closes: number[], days: number): number {
  if (closes.length < days + 1) return 0;
  return (closes[closes.length - 1] / closes[closes.length - 1 - days] - 1) * 100;
}

function calcVolatility(closes: number[], period = 20): number {
  if (closes.length < period + 1) return 0;
  const returns = closes.slice(-period - 1).map((c, i, a) => i > 0 ? Math.log(c / a[i - 1]) : 0).slice(1);
  const mean = returns.reduce((a, b) => a + b, 0) / period;
  return Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / period) * Math.sqrt(252) * 100;
}

// ── 스코어 변환 ───────────────────────────────────────────────────────────────

function scoreRSI(rsi: number): number {
  if (rsi < 25) return  1.0; if (rsi < 35) return  0.7;
  if (rsi < 45) return  0.3; if (rsi < 55) return  0.0;
  if (rsi < 65) return -0.3; if (rsi < 75) return -0.6;
  return -1.0;
}
function scoreMACD(hist: number, histPrev: number, price: number): number {
  const norm  = hist / (price * 0.01 || 1);
  const trend = hist > histPrev ? 0.3 : hist < histPrev ? -0.3 : 0;
  return Math.max(-1, Math.min(1, norm * 10 + trend));
}
function scoreBB(pos: number): number {
  if (pos < 0.1) return  1.0; if (pos < 0.25) return  0.6;
  if (pos < 0.4) return  0.2; if (pos < 0.6)  return  0.0;
  if (pos < 0.75) return -0.3; if (pos < 0.9) return -0.7;
  return -1.0;
}
function scoreMACross(pct: number): number { return Math.max(-1, Math.min(1, pct / 5)); }
function scoreMomentum(ret: number): number { return Math.max(-1, Math.min(1, ret / 15)); }
function scoreVolatility(vol: number): number {
  if (vol < 20) return 0.3; if (vol < 35) return 0.0; if (vol < 50) return -0.3;
  return -0.7;
}

// ── 신호 변환 ─────────────────────────────────────────────────────────────────

export function toSignal(score: number): TftResult["signal"] {
  if (score >= 40)  return "strong_buy";
  if (score >= 15)  return "buy";
  if (score >= -15) return "hold";
  if (score >= -40) return "sell";
  return "strong_sell";
}

// ── 메인 분석 함수 ───────────────────────────────────────────────────────────

export async function analyzeTft(ticker: string): Promise<TftResult> {
  const candles = await getChart(ticker, "1y").catch(() => []);

  if (candles.length < 40) {
    return { ticker, signal: "hold", composite_score: 0, factors: [], insufficient_data: true };
  }

  const closes     = candles.map(c => c.close);
  const price      = closes[closes.length - 1];
  const rawCandles = candles.map(c => ({ close: c.close, volume: c.volume }));

  const rsi      = calcRSI(closes);
  const macd     = calcMACD(closes);
  const bbPos    = calcBB(closes);
  const volSig   = calcVolumeSignal(rawCandles);
  const cross520 = calcMACross(closes, 5, 20);
  const mom20    = calcMomentum(closes, 20);
  const vol      = calcVolatility(closes);

  const factors: TftFactor[] = [
    { key: "rsi",        label: "RSI (모멘텀)",          category: "past_dynamic", score: scoreRSI(rsi),                          weight: 0.20, contribution: 0, value: rsi.toFixed(1),                            description: rsi < 30 ? "과매도" : rsi > 70 ? "과매수" : "중립" },
    { key: "macd",       label: "MACD (추세)",           category: "past_dynamic", score: scoreMACD(macd.hist, macd.histPrev, price), weight: 0.18, contribution: 0, value: `${macd.hist >= 0 ? "+" : ""}${macd.hist.toFixed(2)}`, description: macd.hist > 0 ? "상승 모멘텀" : "하락 추세" },
    { key: "bb",         label: "볼린저밴드 위치",        category: "past_dynamic", score: scoreBB(bbPos),                         weight: 0.15, contribution: 0, value: `${(bbPos * 100).toFixed(0)}%`,           description: bbPos < 0.2 ? "과매도" : bbPos > 0.8 ? "과열" : "중간" },
    { key: "volume",     label: "거래량 신호",            category: "past_dynamic", score: Math.max(-1, Math.min(1, volSig)),       weight: 0.15, contribution: 0, value: `${volSig >= 0 ? "+" : ""}${(volSig * 100).toFixed(0)}%`, description: volSig > 0.3 ? "매수세" : volSig < -0.3 ? "매도세" : "보통" },
    { key: "ma_cross",   label: "이동평균 교차 (5/20)",   category: "past_dynamic", score: scoreMACross(cross520),                 weight: 0.12, contribution: 0, value: `${cross520 >= 0 ? "+" : ""}${cross520.toFixed(2)}%`, description: cross520 > 2 ? "골든크로스" : cross520 < -2 ? "데드크로스" : "임박" },
    { key: "mom20",      label: "20일 가격 모멘텀",       category: "past_dynamic", score: scoreMomentum(mom20),                   weight: 0.12, contribution: 0, value: `${mom20 >= 0 ? "+" : ""}${mom20.toFixed(1)}%`,   description: mom20 > 10 ? "강한 상승" : mom20 < -10 ? "강한 하락" : "보합" },
    { key: "volatility", label: "연환산 변동성",          category: "static",       score: scoreVolatility(vol),                   weight: 0.08, contribution: 0, value: `${vol.toFixed(1)}%`,                        description: vol < 20 ? "저변동성" : vol > 50 ? "고변동성" : "보통" },
  ];

  factors.forEach(f => { f.contribution = f.score * f.weight; });
  const raw  = factors.reduce((s, f) => s + f.contribution, 0);
  const wsum = factors.reduce((s, f) => s + f.weight, 0);
  const composite_score = Math.round((raw / wsum) * 100);

  return {
    ticker,
    signal: toSignal(composite_score),
    composite_score,
    factors: factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
    insufficient_data: false,
  };
}
