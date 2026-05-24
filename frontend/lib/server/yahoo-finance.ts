/* eslint-disable @typescript-eslint/no-explicit-any */
import yahooFinance from "yahoo-finance2";

// yahoo-finance2는 복잡한 오버로드 타입을 사용하므로 any 캐스팅으로 처리
const yf = yahooFinance as any;

// ── 티커 변환 ─────────────────────────────────────────────────────────────────

const KR_CODE = /^\d{6}$/;

const TICKER_MAP: Record<string, string> = {
  KS11:      "^KS11",
  KQ11:      "^KQ11",
  "USD/KRW": "KRW=X",
  "EUR/USD":  "EURUSD=X",
  "USD/JPY":  "JPY=X",
  "USD/CNY":  "CNY=X",
  "S&P500":   "^GSPC",
  SPY:        "SPY",
  IXIC:       "^IXIC",
  QQQ:        "QQQ",
};

export function toYahooTicker(ticker: string): string {
  if (TICKER_MAP[ticker]) return TICKER_MAP[ticker];
  if (KR_CODE.test(ticker)) return `${ticker}.KS`;
  return ticker.toUpperCase();
}

// ── 메모리 캐시 ───────────────────────────────────────────────────────────────

const _cache = new Map<string, { data: unknown; exp: number }>();

function cacheGet<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() > e.exp) return null;
  return e.data as T;
}
function cacheSet<T>(key: string, data: T, ttlMs: number) {
  _cache.set(key, { data, exp: Date.now() + ttlMs });
}

const TTL = { QUOTE: 60_000, CHART: 300_000, FINANCIALS: 3_600_000, SEARCH: 600_000 };

// ── 시세 조회 ─────────────────────────────────────────────────────────────────

export interface QuoteData {
  ticker: string;
  name: string | null;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  prev_close: number;
  timestamp: string;
}

export async function getQuote(ticker: string): Promise<QuoteData | null> {
  const yt = toYahooTicker(ticker);
  const key = `quote:${yt}`;
  const hit = cacheGet<QuoteData>(key);
  if (hit) return hit;

  async function tryQuote(symbol: string): Promise<any> {
    try { return await yf.quote(symbol); }
    catch { return null; }
  }

  let q = await tryQuote(yt);
  if (!q && KR_CODE.test(ticker)) q = await tryQuote(`${ticker}.KQ`);
  if (!q || q.regularMarketPrice == null) return null;

  const data: QuoteData = {
    ticker,
    name:       q.shortName || q.longName || null,
    price:      q.regularMarketPrice,
    change:     q.regularMarketChange ?? 0,
    change_pct: q.regularMarketChangePercent ?? 0,
    volume:     q.regularMarketVolume ?? 0,
    high:       q.regularMarketDayHigh ?? q.regularMarketPrice,
    low:        q.regularMarketDayLow  ?? q.regularMarketPrice,
    open:       q.regularMarketOpen    ?? q.regularMarketPrice,
    prev_close: q.regularMarketPreviousClose ?? q.regularMarketPrice,
    timestamp:  new Date().toISOString(),
  };
  cacheSet(key, data, TTL.QUOTE);
  return data;
}

// ── 차트 데이터 ───────────────────────────────────────────────────────────────

export interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const PERIOD_DAYS: Record<string, number> = {
  "1d": 1, "5d": 5, "1m": 30, "3m": 90,
  "6m": 180, "1y": 365, "2y": 730, "5y": 1825,
};

export async function getChart(ticker: string, period = "1y"): Promise<CandleData[]> {
  const yt = toYahooTicker(ticker);
  const key = `chart:${yt}:${period}`;
  const hit = cacheGet<CandleData[]>(key);
  if (hit) return hit;

  const days = PERIOD_DAYS[period] ?? 365;
  const period2 = new Date();
  const period1 = new Date(period2);
  period1.setDate(period1.getDate() - days);

  async function tryHist(symbol: string): Promise<any[] | null> {
    try { return await yf.historical(symbol, { period1, period2, interval: "1d" }); }
    catch { return null; }
  }

  let hist = await tryHist(yt);
  if ((!hist || hist.length === 0) && KR_CODE.test(ticker)) {
    hist = await tryHist(`${ticker}.KQ`);
  }
  if (!hist || hist.length === 0) return [];

  const data: CandleData[] = hist.map((r: any) => ({
    time:   r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    open:   r.open   ?? r.close,
    high:   r.high   ?? r.close,
    low:    r.low    ?? r.close,
    close:  r.close,
    volume: r.volume ?? 0,
  }));
  cacheSet(key, data, TTL.CHART);
  return data;
}

// ── 재무 지표 ─────────────────────────────────────────────────────────────────

export interface FinancialsData {
  ticker: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  market_cap: number | null;
  per: number | null;
  forward_per: number | null;
  pbr: number | null;
  psr: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  revenue_growth: number | null;
  earnings_growth: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  net_margin: number | null;
  dividend_yield: number | null;
  beta: number | null;
  week_52_high: number | null;
  week_52_low: number | null;
  employees: number | null;
  summary: string | null;
}

export async function getFinancials(ticker: string): Promise<FinancialsData> {
  const yt = toYahooTicker(ticker);
  const key = `financials:${yt}`;
  const hit = cacheGet<FinancialsData>(key);
  if (hit) return hit;

  const empty: FinancialsData = {
    ticker, name: null, sector: null, industry: null, market_cap: null,
    per: null, forward_per: null, pbr: null, psr: null,
    roe: null, roa: null, debt_to_equity: null, current_ratio: null,
    revenue_growth: null, earnings_growth: null, gross_margin: null,
    operating_margin: null, net_margin: null, dividend_yield: null,
    beta: null, week_52_high: null, week_52_low: null,
    employees: null, summary: null,
  };

  try {
    const s = await yf.quoteSummary(yt, {
      modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile"],
    });
    if (!s) return empty;

    const sd = s.summaryDetail ?? {};
    const ks = s.defaultKeyStatistics ?? {};
    const fd = s.financialData ?? {};
    const ap = s.assetProfile ?? {};

    const n = (v: unknown): number | null => {
      if (v == null || typeof v === "object") return null;
      const x = Number(v);
      return isFinite(x) ? x : null;
    };
    const pct = (v: unknown) => { const x = n(v); return x != null ? x * 100 : null; };

    const data: FinancialsData = {
      ticker,
      name:             ap.name ?? null,
      sector:           ap.sector ?? null,
      industry:         ap.industry ?? null,
      market_cap:       n(sd.marketCap),
      per:              n(sd.trailingPE),
      forward_per:      n(sd.forwardPE),
      pbr:              n(ks.priceToBook),
      psr:              n(sd.priceToSalesTrailing12Months),
      roe:              pct(fd.returnOnEquity),
      roa:              pct(fd.returnOnAssets),
      debt_to_equity:   n(fd.debtToEquity),
      current_ratio:    n(fd.currentRatio),
      revenue_growth:   pct(fd.revenueGrowth),
      earnings_growth:  pct(fd.earningsGrowth),
      gross_margin:     pct(fd.grossMargins),
      operating_margin: pct(fd.operatingMargins),
      net_margin:       pct(fd.profitMargins),
      dividend_yield:   pct(sd.dividendYield),
      beta:             n(ks.beta),
      week_52_high:     n(sd.fiftyTwoWeekHigh),
      week_52_low:      n(sd.fiftyTwoWeekLow),
      employees:        ap.fullTimeEmployees ?? null,
      summary:          (ap.longBusinessSummary as string | undefined)?.slice(0, 600) ?? null,
    };
    cacheSet(key, data, TTL.FINANCIALS);
    return data;
  } catch (e) {
    console.error(`[Yahoo] financials error [${yt}]:`, e);
    return empty;
  }
}

// ── 검색 ──────────────────────────────────────────────────────────────────────

export interface SearchResult {
  ticker: string;
  name: string;
  market: string;
  sector: string;
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const key = `search:${query}`;
  const hit = cacheGet<SearchResult[]>(key);
  if (hit) return hit;

  try {
    const res = await yf.search(query, { newsCount: 0 });
    const results: SearchResult[] = (res.quotes ?? [])
      .filter((q: any) => ["EQUITY", "INDEX", "ETF"].includes(q.quoteType))
      .slice(0, 20)
      .map((q: any) => ({
        ticker: q.symbol ?? "",
        name:   q.shortname || q.longname || q.symbol || "",
        market: q.exchange ?? "",
        sector: q.sector ?? "",
      }))
      .filter((r: SearchResult) => r.ticker);
    cacheSet(key, results, TTL.SEARCH);
    return results;
  } catch (e) {
    console.error(`[Yahoo] search error [${query}]:`, e);
    return [];
  }
}
