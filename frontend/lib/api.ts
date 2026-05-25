// API 기본 경로 설정
// 브라우저: 항상 상대 경로('') → next.config.ts rewrites가 BACKEND_URL로 프록시
// SSR:     BACKEND_URL 환경변수로 직접 백엔드 호출 (Vercel 서버 사이드)
// 로컬 개발: BACKEND_URL 미설정 시 next.config.ts 기본값 localhost:8000 사용
const BASE = typeof window === 'undefined'
  ? (process.env.BACKEND_URL || '')  // SSR
  : '';                               // 브라우저: rewrites 경유

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  // 501은 Not Implemented - 빈 배열 반환 (대부분의 API가 배열을 반환함)
  if (res.status === 501) {
    return [] as any as T;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  // 204 No Content 등 본문 없는 응답은 res.json() 불가
  if (res.status === 204 || res.status === 205) {
    return undefined as unknown as T;
  }
  return res.json();
}

// ── 포트폴리오 ───────────────────────────────────────────────────────────────
export const api = {
  portfolio: {
    list: () => request("/api/portfolio/"),
    create: (body: { name: string; description?: string }) =>
      request("/api/portfolio/", { method: "POST", body: JSON.stringify(body) }),
    get: (id: number) => request(`/api/portfolio/${id}`),
    update: (id: number, body: object) =>
      request(`/api/portfolio/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    delete: (id: number) =>
      request(`/api/portfolio/${id}`, { method: "DELETE" }),
    summary: (id: number) => request(`/api/portfolio/${id}/summary`),
    positions: (id: number) => request(`/api/portfolio/${id}/positions`),
    addPosition: (id: number, body: object) =>
      request(`/api/portfolio/${id}/positions`, { method: "POST", body: JSON.stringify(body) }),
    updatePosition: (posId: number, body: object) =>
      request(`/api/portfolio/positions/${posId}`, { method: "PUT", body: JSON.stringify(body) }),
    deletePosition: (posId: number) =>
      request(`/api/portfolio/positions/${posId}`, { method: "DELETE" }),
    autoFill: (id: number) =>
      request(`/api/portfolio/${id}/auto-fill`, { method: "POST" }),
    kisPositions: () => request("/api/portfolio/kis/positions"),
    kisBalance: () => request("/api/portfolio/kis/balance"),
    watchlist: () => request("/api/portfolio/watchlist/"),
    addWatchlist: (body: object) =>
      request("/api/portfolio/watchlist/", { method: "POST", body: JSON.stringify(body) }),
    removeWatchlist: (id: number) =>
      request(`/api/portfolio/watchlist/${id}`, { method: "DELETE" }),
  },

  market: {
    search: (
      q: string,
      brokerCreds?: { type: string; appKey: string; appSecret: string } | null,
    ) =>
      request(`/api/market/search?q=${encodeURIComponent(q)}`, {
        headers: brokerCreds
          ? {
              "X-Broker-Type": brokerCreds.type,
              "X-App-Key":     brokerCreds.appKey,
              "X-App-Secret":  brokerCreds.appSecret,
            }
          : {},
      }),
    quote: (
      ticker: string,
      brokerCreds?: { type: string; appKey: string; appSecret: string } | null,
    ) =>
      request(`/api/market/quote/${ticker}`, {
        headers: brokerCreds
          ? {
              "X-Broker-Type": brokerCreds.type,
              "X-App-Key":     brokerCreds.appKey,
              "X-App-Secret":  brokerCreds.appSecret,
            }
          : {},
      }),
    chart: (ticker: string, period = "1y") =>
      request(`/api/market/chart/${ticker}?period=${period}`),
    financials: (ticker: string) => request(`/api/market/financials/${ticker}`),
    indices: (
      brokerCreds?: { type: string; appKey: string; appSecret: string } | null,
    ) =>
      request("/api/market/indices", {
        headers: brokerCreds
          ? {
              "X-Broker-Type": brokerCreds.type,
              "X-App-Key":     brokerCreds.appKey,
              "X-App-Secret":  brokerCreds.appSecret,
            }
          : {},
      }),
  },

  analysis: {
    get: (
      ticker: string,
      anthropicKey?: string,
      avgPrice?: number,
      quantity?: number,
    ) => {
      const key = anthropicKey || (typeof window !== 'undefined'
        ? localStorage.getItem('api-key-anthropic') ?? ''
        : '');
      const params = new URLSearchParams();
      if (avgPrice) params.set("avg_price", String(avgPrice));
      if (quantity) params.set("quantity", String(quantity));
      const qs = params.toString() ? `?${params.toString()}` : "";
      return request(`/api/analysis/${ticker}${qs}`, {
        headers: key ? { 'X-Anthropic-Key': key } : {},
      });
    },
  },

  macro: {
    dashboard: (fredKey?: string) => {
      const key = fredKey || (typeof window !== 'undefined'
        ? localStorage.getItem('api-key-fred') ?? ''
        : '');
      return request("/api/macro/", {
        headers: key ? { 'X-Fred-Key': key } : {},
      });
    },
  },

  sectors: {
    list: () => request("/api/sectors/"),
    rotation: () => request("/api/sectors/rotation"),
    etfs: (sector: string, sortBy = "1m") =>
      request(`/api/sectors/etfs?sector=${encodeURIComponent(sector)}&sort_by=${sortBy}`),
  },

  krx: {
    dashboard:    () => request("/api/krx/"),
    investor:     () => request("/api/krx/investor"),
    sector:       () => request("/api/krx/sector"),
    shortSelling: () => request("/api/krx/short-selling"),
  },

  broker: {
    quote: (ticker: string, broker: string, appKey: string, appSecret: string) =>
      request(`/api/broker/quote/${ticker}`, {
        method: "POST",
        body: JSON.stringify({ broker, appKey, appSecret })
      }),
    indices: (broker: string, appKey: string, appSecret: string) =>
      request("/api/broker/indices", {
        method: "POST",
        body: JSON.stringify({ broker, appKey, appSecret })
      }),
  },

  push: {
    vapidKey: () => request<{ public_key: string }>("/api/push/vapid-public-key"),
    subscribe: (body: object) =>
      request("/api/push/subscribe", { method: "POST", body: JSON.stringify(body) }),
    alerts: () => request("/api/push/alerts"),
    createAlert: (body: object) =>
      request("/api/push/alerts", { method: "POST", body: JSON.stringify(body) }),
    deleteAlert: (id: number) =>
      request(`/api/push/alerts/${id}`, { method: "DELETE" }),
  },
};
