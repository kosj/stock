/* eslint-disable @typescript-eslint/no-explicit-any */
import YahooFinance from "yahoo-finance2";

// v3.x: 반드시 new YahooFinance()로 인스턴스 생성 (v2의 default export 직접 사용 불가)
const yf = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

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

const TTL = { QUOTE: 60_000, CHART: 300_000, FINANCIALS: 3_600_000, SEARCH: 600_000, CALENDAR: 3_600_000 };

// ── 네이버 파이낸스 국내 지수 조회 ───────────────────────────────────────────

const NAVER_INDEX_CODE: Record<string, string> = {
  "^KS11": "KOSPI",
  "^KQ11": "KOSDAQ",
};

export async function getIndexFromNaver(yahooSymbol: string): Promise<QuoteData | null> {
  const naverCode = NAVER_INDEX_CODE[yahooSymbol];
  if (!naverCode) return null;
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/index/${naverCode}/basic`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const toNum = (v: unknown) =>
      parseFloat(String(v ?? "0").replace(/[,+%\s]/g, "")) || 0;
    const price      = toNum(j.closePrice ?? j.currentPrice);
    const change     = toNum(j.compareToPreviousClosePrice);
    const change_pct = toNum(j.fluctuationsRatio);
    if (price <= 0) return null;
    return {
      ticker:     yahooSymbol,
      name:       naverCode,
      price,
      change,
      change_pct,
      volume:     0,
      high:       toNum(j.highPrice) || price,
      low:        toNum(j.lowPrice)  || price,
      open:       toNum(j.openPrice) || price,
      prev_close: price - change,
      timestamp:  new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── 네이버 폴링 API 종목 시세 조회 ──────────────────────────────────────────
// polling.finance.naver.com — 숫자값 직접 반환, m.stock.naver.com 차단 시 대체

async function getQuoteFromNaverPolling(ticker: string): Promise<QuoteData | null> {
  if (!KR_CODE.test(ticker)) return null;
  try {
    const url = `https://polling.finance.naver.com/api/realtime?category=stock&includeAllInfo=Y&query=SERVICE_ITEM:${ticker}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)",
        "Referer":    "https://finance.naver.com/",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    // 응답이 EUC-KR일 수 있으므로 ArrayBuffer로 먼저 받아 디코딩
    const buf = await res.arrayBuffer();
    let json: any;
    try {
      // EUC-KR 우선 시도
      const text = new TextDecoder("euc-kr").decode(buf);
      json = JSON.parse(text);
    } catch {
      // 폴백: UTF-8 (이름 필드 깨질 수 있으나 숫자값은 정상)
      try {
        const text = new TextDecoder("utf-8").decode(buf);
        json = JSON.parse(text);
      } catch {
        return null;
      }
    }

    const datas = json?.result?.areas?.[0]?.datas;
    if (!Array.isArray(datas) || datas.length === 0) return null;
    const d = datas[0];
    const price = Number(d.nv);
    if (!price || price <= 0) return null;

    return {
      ticker,
      name:       d.nm ? String(d.nm) : ticker,
      price,
      change:     Number(d.cv) || 0,
      change_pct: Number(d.cr) || 0,
      volume:     Number(d.aq) || 0,
      high:       Number(d.hv) || price,
      low:        Number(d.lv) || price,
      open:       Number(d.ov) || price,
      prev_close: Number(d.sv) || price,
      timestamp:  new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── 네이버 파이낸스 개별 종목 시세 조회 (폴백) ───────────────────────────────

async function getQuoteFromNaver(ticker: string): Promise<QuoteData | null> {
  if (!KR_CODE.test(ticker)) return null;
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${ticker}/basic`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const d = j.stockItemTotal ?? j;
    const toNum = (v: unknown) =>
      parseFloat(String(v ?? "0").replace(/[,+%\s]/g, "")) || 0;
    const price = toNum(d.closePrice ?? d.currentPrice);
    if (price <= 0) return null;
    const change     = toNum(d.compareToPreviousClosePrice);
    const change_pct = toNum(d.fluctuationsRatio);
    return {
      ticker,
      name:       String(d.stockName || d.reutersCode || ticker),
      price,
      change,
      change_pct,
      volume:     toNum(d.accumulatedTradingVolume),
      high:       toNum(d.highPrice)  || price,
      low:        toNum(d.lowPrice)   || price,
      open:       toNum(d.openPrice)  || price,
      prev_close: price - change,
      timestamp:  new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── 직접 Yahoo Finance v8 HTTP 폴백 ──────────────────────────────────────────
// yahoo-finance2 라이브러리가 클라우드 서버에서 실패할 때 사용

async function getQuoteDirect(yahooSymbol: string): Promise<QuoteData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const price    = meta.regularMarketPrice as number;
    const prev     = (meta.previousClose ?? meta.chartPreviousClose ?? price) as number;
    const change   = price - prev;

    return {
      ticker:     yahooSymbol,
      name:       (meta.shortName || meta.symbol || yahooSymbol) as string,
      price,
      change,
      change_pct: prev ? (change / prev) * 100 : 0,
      volume:     (meta.regularMarketVolume ?? 0) as number,
      high:       (meta.regularMarketDayHigh ?? price) as number,
      low:        (meta.regularMarketDayLow  ?? price) as number,
      open:       (meta.regularMarketOpen    ?? price) as number,
      prev_close: prev,
      timestamp:  new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

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
    try {
      return await Promise.race([
        yf.quote(symbol),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
      ]);
    } catch { return null; }
  }

  let q = await tryQuote(yt);
  if (!q && KR_CODE.test(ticker)) q = await tryQuote(`${ticker}.KQ`);

  if (q?.regularMarketPrice != null) {
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

  // yahoo-finance2 라이브러리 실패 → 직접 Yahoo Finance v8 API 재시도
  const direct = await getQuoteDirect(yt);
  if (direct) {
    direct.ticker = ticker;
    cacheSet(key, direct, TTL.QUOTE);
    return direct;
  }

  // Yahoo v8도 실패 (Vercel IP 차단) → 국내 종목은 네이버 폴링 → 기본 API 순으로 폴백
  if (KR_CODE.test(ticker)) {
    const naverPolling = await getQuoteFromNaverPolling(ticker);
    if (naverPolling) {
      cacheSet(key, naverPolling, TTL.QUOTE);
      return naverPolling;
    }
    const naver = await getQuoteFromNaver(ticker);
    if (naver) {
      cacheSet(key, naver, TTL.QUOTE);
      return naver;
    }
  }

  return null;
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
  // 주요 일정
  next_earnings_date: string | null;
  ex_dividend_date: string | null;
  dividend_date: string | null;
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
    next_earnings_date: null, ex_dividend_date: null, dividend_date: null,
  };

  try {
    const s = await yf.quoteSummary(yt, {
      modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile", "calendarEvents"],
    });
    if (!s) return empty;

    const sd = s.summaryDetail ?? {};
    const ks = s.defaultKeyStatistics ?? {};
    const fd = s.financialData ?? {};
    const ap = s.assetProfile ?? {};
    const ce = (s as any).calendarEvents ?? {};

    // Date → "YYYY-MM-DD" 변환 헬퍼
    const toDateStr = (v: unknown): string | null => {
      if (!v) return null;
      const arr = Array.isArray(v) ? v : [v];
      const d = arr[0];
      if (!d) return null;
      return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
    };

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
      next_earnings_date: toDateStr(ce.earnings?.earningsDate),
      ex_dividend_date:   toDateStr(ce.exDividendDate),
      dividend_date:      toDateStr(ce.dividendDate),
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

// 네이버 증권 자동완성 API — Vercel에서도 차단 없이 동작
// 응답 형식 (2024~): items: [{code, name, typeCode, typeName, ...}, ...]
export async function searchStocksNaver(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)",
        "Referer":    "https://finance.naver.com/",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items: any[] = Array.isArray(data.items) ? data.items : [];
    return items
      .filter((item) => item?.code)
      .slice(0, 20)
      .map((item) => ({
        ticker: String(item.code),
        name:   String(item.name || item.code),
        market: String(item.typeCode || item.typeName || ""),
        sector: "",
      }));
  } catch {
    return [];
  }
}

// Yahoo Finance 검색 결과를 SearchResult[]로 파싱하는 공통 헬퍼
function parseYahooQuotes(quotes: any[]): SearchResult[] {
  return quotes
    .filter((r) => ["EQUITY", "INDEX", "ETF"].includes(r.quoteType))
    .slice(0, 20)
    .map((r) => ({
      ticker: r.symbol ?? "",
      name:   r.shortname || r.longname || r.symbol || "",
      market: r.exchange ?? "",
      sector: r.sector ?? "",
    }))
    .filter((r) => r.ticker);
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  const key = `search:${q}`;
  const hit = cacheGet<SearchResult[]>(key);
  if (hit) return hit;

  // 6자리 한국 종목 코드 → 직접 시세 조회로 폴백
  if (KR_CODE.test(q)) {
    const quote = await getQuote(q);
    if (quote) {
      const results: SearchResult[] = [{ ticker: q, name: quote.name ?? q, market: "KSE", sector: "" }];
      cacheSet(key, results, TTL.SEARCH);
      return results;
    }
    return [];
  }

  // 한글 포함 → yahoo-finance2가 지원하지 않으므로 Yahoo Finance API 직접 호출
  const hasKorean = /[가-힣]/.test(q);
  if (hasKorean) {
    try {
      const url =
        `https://query1.finance.yahoo.com/v1/finance/search` +
        `?q=${encodeURIComponent(q)}&lang=ko-KR&region=KR` +
        `&quotesCount=20&newsCount=0&enableFuzzyQuery=false`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const results = parseYahooQuotes(data.quotes ?? []);
        if (results.length > 0) {
          cacheSet(key, results, TTL.SEARCH);
          return results;
        }
      }
    } catch (e) {
      console.error(`[Yahoo] Korean search error [${q}]:`, e);
    }
    return [];
  }

  try {
    // v3.x: newsCount 옵션 제거 (invalid option으로 검색 실패)
    const res = await yf.search(q);
    const results = parseYahooQuotes(res.quotes ?? []);
    cacheSet(key, results, TTL.SEARCH);
    return results;
  } catch (e) {
    console.error(`[Yahoo] search error [${q}]:`, e);
    return [];
  }
}
