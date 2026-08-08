// 기술적 지표 계산 (RSI, MACD, Bollinger Band, MA)

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type Series = { time: string; value: number }[];

function toSeries(times: string[], values: (number | null)[]): Series {
  const out: Series = [];
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v != null && isFinite(v)) out.push({ time: times[i], value: round(v, 4) });
  }
  return out;
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function sma(prices: number[], window: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < window - 1) return null;
    const sum = prices.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0);
    return sum / window;
  });
}

function ema(prices: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) { result.push(prices[0]); continue; }
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function calcIndicators(candles: Candle[]): Record<string, Series> {
  // 지표별 최소 봉 수는 각 계산부에서 null 처리한다 — 일괄 26봉 컷은
  // 1개월(≈20봉) 차트에서 RSI(15봉이면 충분)까지 통째로 사라지게 했다.
  if (candles.length < 2) return {};

  const times = candles.map((c) => c.time);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  // MA
  const ma5   = sma(closes, 5);
  const ma20  = sma(closes, 20);
  const ma60  = sma(closes, 60);
  const ma120 = sma(closes, 120);

  // Bollinger Band (20, 2σ)
  const bbMid = sma(closes, 20);
  const bbStd = closes.map((_, i) => {
    if (i < 19) return null;
    const slice = closes.slice(i - 19, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / 20;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20;
    return Math.sqrt(variance);
  });
  const bbUpper = bbMid.map((m, i) => (m != null && bbStd[i] != null ? m + 2 * bbStd[i]! : null));
  const bbLower = bbMid.map((m, i) => (m != null && bbStd[i] != null ? m - 2 * bbStd[i]! : null));

  // RSI (14) — Wilder 표준식. 기존 단순이동평균(Cutler)식 + 인덱스0의 인위적
  // 0 diff 포함은 HTS/네이버 수치와 불일치했다. 초기값 = 첫 14개 diff의 단순평균,
  // 이후 avg = (prev*13 + cur)/14 (Wilder smoothing).
  const P = 14;
  const rsi: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length >= P + 1) {
    let avgG = 0, avgL = 0;
    for (let i = 1; i <= P; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) avgG += d; else avgL -= d;
    }
    avgG /= P; avgL /= P;
    rsi[P] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for (let i = P + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      avgG = (avgG * (P - 1) + Math.max(d, 0)) / P;
      avgL = (avgL * (P - 1) + Math.max(-d, 0)) / P;
      rsi[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
  }

  // MACD (12, 26, 9) — 워밍업 절단: EMA가 수렴하기 전(첫값 시드 구간)의 값은
  // 조회 기간에 따라 같은 날짜의 값이 달라지므로 null 처리한다.
  // 26봉(느린 EMA) + 9봉(시그널) 수렴 전 구간을 표시하지 않는 표준 관행.
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdRaw = ema12.map((v, i) => v - ema26[i]);
  const signalRaw = ema(macdRaw, 9);
  const MACD_WARMUP = 26 - 1;            // 느린 EMA 수렴 시작
  const SIGNAL_WARMUP = MACD_WARMUP + 8; // + 시그널 EMA(9)
  const macdLine   = macdRaw.map((v, i) => (i >= MACD_WARMUP ? v : null));
  const macdSignal = signalRaw.map((v, i) => (i >= SIGNAL_WARMUP ? v : null));
  const macdHist   = macdRaw.map((v, i) =>
    i >= SIGNAL_WARMUP ? v - signalRaw[i] : null);

  // Volume MA5
  const volMa5 = sma(volumes, 5);

  return {
    ma5:         toSeries(times, ma5),
    ma20:        toSeries(times, ma20),
    ma60:        toSeries(times, ma60),
    ma120:       toSeries(times, ma120),
    bb_upper:    toSeries(times, bbUpper),
    bb_mid:      toSeries(times, bbMid),
    bb_lower:    toSeries(times, bbLower),
    rsi:         toSeries(times, rsi),
    macd:        toSeries(times, macdLine),
    macd_signal: toSeries(times, macdSignal),
    macd_hist:   toSeries(times, macdHist),
    vol_ma5:     toSeries(times, volMa5),
  };
}

export function calcSignals(candles: Candle[]): Record<string, unknown> {
  if (candles.length < 30) return {};

  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const current = closes[n - 1];

  // RSI
  const diffs = closes.map((c, i) => (i === 0 ? 0 : c - closes[i - 1]));
  const gains = diffs.map((d) => Math.max(d, 0));
  const losses = diffs.map((d) => Math.max(-d, 0));
  const avgGain14 = sma(gains, 14);
  const avgLoss14 = sma(losses, 14);
  const lastGain = avgGain14[n - 1];
  const lastLoss = avgLoss14[n - 1];
  const rsi =
    lastGain != null && lastLoss != null
      ? lastLoss === 0 ? 100 : 100 - 100 / (1 + lastGain / lastLoss)
      : null;

  // MACD
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = ema(macdLine, 9);
  const macdBullish = macdLine[n - 1] > macdSignal[n - 1];
  const macdGoldenCross =
    macdLine[n - 2] <= macdSignal[n - 2] && macdBullish;

  // MA
  const [ma20, ma60, ma120] = [sma(closes, 20), sma(closes, 60), sma(closes, 120)];
  const lastMa20  = ma20[n - 1];
  const lastMa60  = ma60[n - 1];
  const lastMa120 = ma120[n - 1];

  // Bollinger Band position
  const bbMidV = lastMa20;
  const slice20 = closes.slice(-20);
  const mean = slice20.reduce((a, b) => a + b, 0) / 20;
  const variance = slice20.reduce((a, b) => a + (b - mean) ** 2, 0) / 20;
  const std = Math.sqrt(variance);
  const bbPos = std > 0 ? ((current - (mean - 2 * std)) / (4 * std)) * 100 : 50;

  // 52주 위치
  const tail252 = closes.slice(-252);
  const high52 = Math.max(...tail252);
  const low52  = Math.min(...tail252);
  const pos52w = high52 > low52 ? ((current - low52) / (high52 - low52)) * 100 : 50;

  return {
    rsi:               rsi != null ? round(rsi, 2) : null,
    macd_bullish:      macdBullish,
    macd_golden_cross: macdGoldenCross,
    above_ma20:        lastMa20  != null ? current > lastMa20  : null,
    above_ma60:        lastMa60  != null ? current > lastMa60  : null,
    above_ma120:       lastMa120 != null ? current > lastMa120 : null,
    bb_position_pct:   round(bbPos, 1),
    pos_52w_pct:       round(pos52w, 1),
    current_price:     current,
    ma20:              lastMa20  != null ? round(lastMa20,  2) : null,
    ma60:              lastMa60  != null ? round(lastMa60,  2) : null,
  };
}
