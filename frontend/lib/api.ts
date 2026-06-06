// 모든 API 호출은 Next.js API 라우트(/api/...)를 통해 처리됨
// 포트폴리오 CRUD → Supabase 직접, 시세/분석 → Yahoo/Claude 직접, 거시경제 → FRED 직접

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (res.status === 501) return [] as unknown as T;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  if (res.status === 204 || res.status === 205) return undefined as unknown as T;
  return res.json();
}

// 증권사 자격증명 → 요청 헤더 변환 헬퍼
type BrokerCreds = { type: string; appKey: string; appSecret: string } | null | undefined;

function brokerHeaders(creds?: BrokerCreds): Record<string, string> {
  if (!creds) return {};
  return {
    "X-Broker-Type": creds.type,
    "X-App-Key":     creds.appKey,
    "X-App-Secret":  creds.appSecret,
  };
}

// ── 포트폴리오 ───────────────────────────────────────────────────────────────
export const api = {
  portfolio: {
    list:   () => request("/api/portfolio/"),
    create: (body: { name: string; description?: string }) =>
      request("/api/portfolio/", { method: "POST", body: JSON.stringify(body) }),
    get:    (id: number) => request(`/api/portfolio/${id}`),
    update: (id: number, body: object) =>
      request(`/api/portfolio/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    delete: (id: number) =>
      request(`/api/portfolio/${id}`, { method: "DELETE" }),
    summary: (id: number, creds?: BrokerCreds) =>
      request(`/api/portfolio/${id}/summary`, { headers: brokerHeaders(creds) }),
    positions:      (id: number) => request(`/api/portfolio/${id}/positions`),
    clearPositions: (id: number) =>
      request(`/api/portfolio/${id}/positions`, { method: "DELETE" }),
    addPosition: (id: number, body: object) =>
      request(`/api/portfolio/${id}/positions`, { method: "POST", body: JSON.stringify(body) }),
    updatePosition: (posId: number, body: object) =>
      request(`/api/portfolio/positions/${posId}`, { method: "PUT", body: JSON.stringify(body) }),
    deletePosition: (posId: number) =>
      request(`/api/portfolio/positions/${posId}`, { method: "DELETE" }),
    autoFill: (id: number) =>
      request(`/api/portfolio/${id}/auto-fill`, { method: "POST" }),
    allPositionsWithTargets: () => request("/api/portfolio/positions"),
    watchlist:      () => request("/api/portfolio/watchlist/"),
    addWatchlist:   (body: object) =>
      request("/api/portfolio/watchlist/", { method: "POST", body: JSON.stringify(body) }),
    removeWatchlist: (id: number) =>
      request(`/api/portfolio/watchlist/${id}`, { method: "DELETE" }),
  },

  market: {
    search:    (q: string, creds?: BrokerCreds) =>
      request(`/api/market/search?q=${encodeURIComponent(q)}`, { headers: brokerHeaders(creds) }),
    quote:     (ticker: string, creds?: BrokerCreds, nocache?: boolean) =>
      request(`/api/market/quote/${ticker}${nocache ? "?nocache=1" : ""}`, { headers: brokerHeaders(creds) }),
    chart:     (ticker: string, period = "1y") =>
      request(`/api/market/chart/${ticker}?period=${period}`),
    financials: (ticker: string) => request(`/api/market/financials/${ticker}`),
    indices:   (creds?: BrokerCreds) =>
      request("/api/market/indices", { headers: brokerHeaders(creds) }),
  },

  analysis: {
    get: (ticker: string, anthropicKey?: string, avgPrice?: number, quantity?: number) => {
      const params = new URLSearchParams();
      if (avgPrice)  params.set("avg_price", String(avgPrice));
      if (quantity)  params.set("quantity",  String(quantity));
      const qs = params.size ? `?${params}` : "";
      return request(`/api/analysis/${ticker}${qs}`, {
        headers: anthropicKey ? { "X-Anthropic-Key": anthropicKey } : {},
      });
    },
  },

  mock: {
    account:       () => request("/api/mock/account"),
    setCash:       (cash: number) =>
      request("/api/mock/account", { method: "PUT", body: JSON.stringify({ cash }) }),
    setCapital:    (capital: number | null) =>
      request("/api/mock/account", { method: "PUT", body: JSON.stringify({ auto_trade_capital: capital }) }),
    reset:         () => request("/api/mock/account/reset", { method: "POST" }),
    trade:         (body: { ticker: string; name: string; trade_type: "BUY" | "SELL"; quantity: number }) =>
      request("/api/mock/trade", { method: "POST", body: JSON.stringify(body) }),
    trades:        () => request("/api/mock/trades"),
    autoTrade:     () => request("/api/mock/auto-trade/run", { method: "POST" }),
    autoTradeLogs: () => request("/api/mock/auto-trade/logs"),
  },

  macro: {
    dashboard: (fredKey?: string) =>
      request("/api/macro/", {
        headers: fredKey ? { "X-Fred-Key": fredKey } : {},
      }),
  },

  sectors: {
    list:     () => request("/api/sectors/"),
    rotation: () => request("/api/sectors/rotation"),
    etfs:     (sector: string, sortBy = "1m") =>
      request(`/api/sectors/etfs?sector=${encodeURIComponent(sector)}&sort_by=${sortBy}`),
  },

  krx: {
    dashboard:    () => request("/api/krx/"),
    investor:     () => request("/api/krx/investor"),
    sector:       () => request("/api/krx/sector"),
    shortSelling: () => request("/api/krx/short-selling"),
  },

  broker: {
    quote:   (ticker: string, broker: string, appKey: string, appSecret: string) =>
      request(`/api/broker/quote/${ticker}`, {
        method: "POST", body: JSON.stringify({ broker, appKey, appSecret }),
      }),
    indices: (broker: string, appKey: string, appSecret: string) =>
      request("/api/broker/indices", {
        method: "POST", body: JSON.stringify({ broker, appKey, appSecret }),
      }),
  },

  push: {
    vapidKey:     () => request<{ public_key: string }>("/api/push/vapid-public-key"),
    subscribe:    (body: object) =>
      request("/api/push/subscribe", { method: "POST", body: JSON.stringify(body) }),
    alerts:       () => request("/api/push/alerts"),
    createAlert:  (body: object) =>
      request("/api/push/alerts", { method: "POST", body: JSON.stringify(body) }),
    deleteAlert:  (id: number) =>
      request(`/api/push/alerts/${id}`, { method: "DELETE" }),
  },
};
