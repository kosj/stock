// Vercel 배포: NEXT_PUBLIC_API_URL 또는 BACKEND_URL 사용
// 로컬 개발: http://localhost:8000 (backend 서버 필요)
const BASE = process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
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
    search: (q: string) => request(`/api/market/search?q=${encodeURIComponent(q)}`),
    quote: (ticker: string) => request(`/api/market/quote/${ticker}`),
    chart: (ticker: string, period = "1y") =>
      request(`/api/market/chart/${ticker}?period=${period}`),
    financials: (ticker: string) => request(`/api/market/financials/${ticker}`),
    indices: () => request("/api/market/indices"),
  },

  analysis: {
    get: (ticker: string) => request(`/api/analysis/${ticker}`),
  },

  macro: {
    dashboard: () => request("/api/macro/"),
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
