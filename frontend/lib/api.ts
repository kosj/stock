// API 기본 경로 설정
// Vercel 배포: 자동으로 현재 도메인 사용
// 로컬 개발: localhost:8000 또는 환경변수
const getBase = () => {
  if (typeof window === 'undefined') {
    // 서버 사이드: 환경 변수 사용
    return process.env.NEXT_PUBLIC_BACKEND_URL || '';
  }

  // 클라이언트 사이드: 현재 도메인 사용
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }

  // 개발 환경에서는 localhost:8000 사용
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:8000';
  }

  // Vercel 배포: 상대 경로 사용 (같은 도메인의 /api 사용)
  return '';
};

const BASE = getBase();

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
    get: (ticker: string, anthropicKey?: string) => {
      const key = anthropicKey || (typeof window !== 'undefined'
        ? localStorage.getItem('api-key-anthropic') ?? ''
        : '');
      return request(`/api/analysis/${ticker}`, {
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
