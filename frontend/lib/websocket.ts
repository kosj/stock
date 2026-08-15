"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

export interface PriceUpdate {
  type: "price" | "heartbeat";
  ticker?: string;
  price?: number;
  change?: number;
  change_pct?: number;
  volume?: number;
}

/**
 * 실시간 시세 훅 — 현재 비활성 상태다(항상 빈 객체 반환).
 *
 * Vercel 서버리스에는 WebSocket 서버(localhost:8000)가 없어 연결하지 않는다.
 * 호출부는 반드시 폴백(SWR로 받은 current_price)을 함께 써야 하며, 이 값이
 * 채워질 것이라고 가정하면 안 된다. 실시간이 필요하면 별도 상시가동 서버
 * (backend/ FastAPI) 연결이 선행돼야 한다.
 */
export function useRealtimePrices(tickers: string[]) {
  const [prices] = useState<Record<string, PriceUpdate>>({});

  // 개발 환경에서만 WebSocket 시도 (필요시 활성화)
  // if (process.env.NODE_ENV === "development") { ... }

  return prices;
}
