/* eslint-disable @typescript-eslint/no-explicit-any */
import YahooFinance from "yahoo-finance2";
import { supabase } from "@/lib/server/supabase";

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

// ── L1(메모리) + L2(Supabase) 2단 캐시 ─────────────────────────────────────
// L1: cold start 이후 같은 인스턴스 내 재사용 (서버리스 재시작 시 소멸)
// L2: Supabase quote_cache 테이블 — 인스턴스 재시작 후에도 캐시 유지
//
// TTL 전략:
//   QUOTE(1분): 빠른 갱신 필요 → L1만 사용 (DB 왕복 비용 > 캐시 효과)
//   CHART(5분) / SEARCH(10분): L1+L2 병행
//   FINANCIALS(1시간): L2 우선 (cold start 이후 재사용 효과 큼)

const _l1 = new Map<string, { data: unknown; exp: number }>();

const TTL = { QUOTE: 60_000, CHART: 300_000, FINANCIALS: 3_600_000, SEARCH: 600_000, CALENDAR: 3_600_000 };

// L2 사용 여부: QUOTE도 포함 — 콜드 스타트 후 Supabase 캐시(~50ms)로 Naver 재호출(~500ms) 절감
const L2_KEYS = new Set(["quote:", "chart:", "financials:", "financials-v2:", "search:"]);

// L2→L1 워밍업 시 키 접두사에 맞는 TTL 반환
const L2_TTL_MAP: Record<string, number> = {
  "quote:":      TTL.QUOTE,
  "chart:":      TTL.CHART,
  "financials:": TTL.FINANCIALS,
  "search:":     TTL.SEARCH,
};
function l2Ttl(key: string): number {
  return Object.entries(L2_TTL_MAP).find(([p]) => key.startsWith(p))?.[1] ?? TTL.CHART;
}

function l1Get<T>(key: string): T | null {
  const e = _l1.get(key);
  if (!e || Date.now() > e.exp) return null;
  return e.data as T;
}
function l1Set<T>(key: string, data: T, ttlMs: number) {
  _l1.set(key, { data, exp: Date.now() + ttlMs });
}

async function l2Get<T>(key: string): Promise<T | null> {
  try {
    const { data } = await supabase
      .from("quote_cache")
      .select("data, expires_at")
      .eq("key", key)
      .single();
    if (!data) return null;
    if (new Date(data.expires_at) <= new Date()) return null;
    return data.data as T;
  } catch {
    return null;
  }
}

async function l2Set<T>(key: string, value: T, ttlMs: number): Promise<void> {
  try {
    const expires_at = new Date(Date.now() + ttlMs).toISOString();
    await supabase.from("quote_cache").upsert({ key, data: value, expires_at });
  } catch { /* 캐시 쓰기 실패는 무시 — 기능에는 영향 없음 */ }
}

function usesL2(key: string): boolean {
  return [...L2_KEYS].some((prefix) => key.startsWith(prefix));
}

async function cacheGet<T>(key: string): Promise<T | null> {
  // L1 hit
  const l1 = l1Get<T>(key);
  if (l1 !== null) return l1;

  // L2 hit (QUOTE는 L2 스킵)
  if (usesL2(key)) {
    const l2 = await l2Get<T>(key);
    if (l2 !== null) {
      // L2 → L1 워밍업 (키 타입에 맞는 TTL 적용)
      l1Set(key, l2, l2Ttl(key));
      return l2;
    }
  }
  return null;
}

async function cacheSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  l1Set(key, data, ttlMs);
  if (usesL2(key)) {
    void l2Set(key, data, ttlMs); // 응답 차단 없이 백그라운드 기록
  }
}

// ── Yahoo Finance 차단 감지 (인스턴스별 circuit breaker) ──────────────────────
// Vercel IP 차단 시 tryYahooLib() 타임아웃(2s×2 + 6s)이 매 요청마다 누적되는 것을 방지
// 3회 연속 실패 → 5분간 Yahoo 건너뛰고 Naver 직행
let _yahooFailCount = 0;
let _yahooBlockedUntil = 0;
function _isYahooBlocked(): boolean {
  return _yahooFailCount >= 3 && Date.now() < _yahooBlockedUntil;
}
function _markYahooFail(): void {
  _yahooFailCount++;
  if (_yahooFailCount >= 3) _yahooBlockedUntil = Date.now() + 300_000;
}
function _markYahooOk(): void {
  _yahooFailCount = 0;
  _yahooBlockedUntil = 0;
}

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
      market_cap: null,
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
      market_cap: null,
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
      market_cap: null,
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
      prev_close:  prev,
      timestamp:   new Date().toISOString(),
      market_cap:  null,
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
  market_cap: number | null;
}

export async function getQuote(ticker: string): Promise<QuoteData | null> {
  const yt  = toYahooTicker(ticker);
  const key = `quote:${yt}`;
  const hit = await cacheGet<QuoteData>(key);
  if (hit) return hit;

  // Yahoo Finance v3 라이브러리 래퍼 — 타임아웃 2s (4s→2s: 어차피 Naver와 경쟁이므로 짧게)
  async function tryYahooLib(symbol: string): Promise<any> {
    try {
      return await Promise.race([
        yf.quote(symbol),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2000)),
      ]);
    } catch { return null; }
  }

  // Yahoo raw 응답 → QuoteData 변환 (ticker는 외부 스코프에서 캡처)
  function buildFromYahoo(q: any): QuoteData {
    return {
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
      market_cap: q.marketCap ?? null,
    };
  }

  if (KR_CODE.test(ticker)) {
    // 국내 종목: Naver 폴링(~0.5s, 안정)과 Yahoo(Vercel IP 차단 가능, 최대 10s)를 동시 시작
    // Promise.any → 먼저 성공하는 쪽을 즉시 반환 (직렬 폴백 대비 최대 18s 절감)
    const naverSource = getQuoteFromNaverPolling(ticker)
      .then(v => (v != null ? v : Promise.reject(new Error("naver null"))));

    const yahooSource: Promise<QuoteData> = _isYahooBlocked()
      ? Promise.reject(new Error("yahoo blocked"))
      : (async (): Promise<QuoteData> => {
          let q = await tryYahooLib(yt) ?? await tryYahooLib(`${ticker}.KQ`);
          if (!q) q = await getQuoteDirect(yt);
          if (!q?.regularMarketPrice) {
            _markYahooFail();
            throw new Error("yahoo null");
          }
          _markYahooOk();
          return buildFromYahoo(q);
        })();

    const result = await Promise.any([naverSource, yahooSource]).catch(() => null);
    if (result) {
      await cacheSet(key, result, TTL.QUOTE);
      return result;
    }

    // 두 소스 모두 실패 → Naver basic 폴백
    const naver = await getQuoteFromNaver(ticker);
    if (naver) {
      await cacheSet(key, naver, TTL.QUOTE);
      return naver;
    }
    return null;
  }

  // 해외 종목 — Yahoo 라이브러리 → v8 직접 API 순차 시도
  let q = await tryYahooLib(yt);
  if (q?.regularMarketPrice != null) {
    const data = buildFromYahoo(q);
    await cacheSet(key, data, TTL.QUOTE);
    return data;
  }

  const direct = await getQuoteDirect(yt);
  if (direct) {
    direct.ticker = ticker;
    await cacheSet(key, direct, TTL.QUOTE);
    return direct;
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
  const hit = await cacheGet<CandleData[]>(key);
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
  await cacheSet(key, data, TTL.CHART);
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

// ── 한국어 사업내용 — 다단계 폴백 ────────────────────────────────────────────
// 1단계: Yahoo Finance v10/v11 ko-KR 로케일 (.KS / .KQ 각각 시도)
// 2단계: Naver Finance 회사 개요 API
// Vercel IP 차단 대비 다중 소스 시도

const KR_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchYahooKoreanSummary(sym: string): Promise<string | null> {
  for (const ver of ["v10", "v11"] as const) {
    try {
      const url =
        `https://query1.finance.yahoo.com/${ver}/finance/quoteSummary/${encodeURIComponent(sym)}` +
        `?modules=assetProfile&lang=ko-KR&region=KR`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":      KR_BROWSER_UA,
          "Accept":          "application/json",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          "Referer":         "https://finance.yahoo.com/",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const text: unknown = json?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary;
      if (typeof text === "string" && text.length >= 10 && /[가-힣]/.test(text)) {
        return text.slice(0, 800);
      }
    } catch { /* 다음 시도 */ }
  }
  return null;
}

async function fetchNaverKoreanSummary(ticker6: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${ticker6}/summary`,
      {
        headers: {
          "User-Agent": KR_BROWSER_UA,
          "Referer":    "https://m.stock.naver.com/",
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    // 응답 필드 이름은 버전마다 다를 수 있어 여러 필드 확인
    const text =
      (json?.summary         as string | undefined) ??
      (json?.companySummary  as string | undefined) ??
      (json?.description     as string | undefined) ??
      null;
    if (typeof text === "string" && text.length >= 10 && /[가-힣]/.test(text)) {
      return text.slice(0, 800);
    }
  } catch { /* 무시 */ }
  return null;
}

// 6자리 한국 종목코드를 받아 한국어 사업내용 반환
// .KS / .KQ 병렬 시도 → 둘 다 실패 시 Naver 폴백 (순차 대비 최대 5s 절감)
async function getKoreanBusinessSummary(ticker6: string): Promise<string | null> {
  const [ks, kq] = await Promise.allSettled([
    fetchYahooKoreanSummary(`${ticker6}.KS`),
    fetchYahooKoreanSummary(`${ticker6}.KQ`),
  ]);
  const hit = (ks.status === "fulfilled" && ks.value) || (kq.status === "fulfilled" && kq.value);
  if (hit) return hit;
  return fetchNaverKoreanSummary(ticker6);
}

export async function getFinancials(ticker: string): Promise<FinancialsData> {
  const yt  = toYahooTicker(ticker);
  // v2: 캐시 키 버전 올림 → 기존 영문 캐시 자동 무효화
  const key = `financials-v2:${yt}`;
  const hit = await cacheGet<FinancialsData>(key);
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
    // KOSDAQ 종목은 .KS 실패 시 .KQ로 재시도
    let s = await yf.quoteSummary(yt, {
      modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile", "calendarEvents"],
    }).catch(() => null);
    if (!s && KR_CODE.test(ticker)) {
      s = await yf.quoteSummary(`${ticker}.KQ`, {
        modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile", "calendarEvents"],
      }).catch(() => null);
    }
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

    let data: FinancialsData = {
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
      summary:          (ap.longBusinessSummary as string | undefined)?.slice(0, 800) ?? null,
      next_earnings_date: toDateStr(ce.earnings?.earningsDate),
      ex_dividend_date:   toDateStr(ce.exDividendDate),
      dividend_date:      toDateStr(ce.dividendDate),
    };
    // 한국 종목 — 사업내용이 없거나 영문이면 한국어로 대체 시도
    if (KR_CODE.test(ticker) && (!data.summary || !/[가-힣]/.test(data.summary))) {
      const korSummary = await getKoreanBusinessSummary(ticker); // 6자리 코드 전달
      if (korSummary) data = { ...data, summary: korSummary };
    }

    await cacheSet(key, data, TTL.FINANCIALS);
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
  const hit = await cacheGet<SearchResult[]>(key);
  if (hit) return hit;

  // 6자리 한국 종목 코드 → 직접 시세 조회로 폴백
  if (KR_CODE.test(q)) {
    const quote = await getQuote(q);
    if (quote) {
      const results: SearchResult[] = [{ ticker: q, name: quote.name ?? q, market: "KSE", sector: "" }];
      await cacheSet(key, results, TTL.SEARCH);
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
          await cacheSet(key, results, TTL.SEARCH);
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
