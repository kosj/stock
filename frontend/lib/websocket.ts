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
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!tickers.length) return;
    const url = `${WS_BASE}/ws/prices?tickers=${tickers.join(",")}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const data: PriceUpdate = JSON.parse(e.data);
        if (data.type === "price" && data.ticker) {
          setPrices((prev) => ({ ...prev, [data.ticker!]: data }));
        }
      } catch {}
    };

    ws.onclose = () => {
      // 5초 후 자동 재연결
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [tickers.join(",")]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return prices;
}
