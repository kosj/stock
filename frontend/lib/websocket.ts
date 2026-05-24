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

export function useRealtimePrices(tickers: string[]) {
  // WebSocket 비활성화: Vercel 환경에서는 localhost:8000이 없으므로
  // 아무 데이터도 반환하지 않음 (하지만 에러 없이 작동)
  const [prices] = useState<Record<string, PriceUpdate>>({});

  // 개발 환경에서만 WebSocket 시도 (필요시 활성화)
  // if (process.env.NODE_ENV === "development") { ... }

  return prices;
}
