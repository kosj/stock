/**
 * YahooMarketDataAdapter — MarketDataPort 구현 (Yahoo Finance 래핑)
 *
 * 기존 lib/server/yahoo-finance.ts의 getQuote/getChart를 포트 계약으로 어댑팅.
 */

import { getQuote, getChart } from "../yahoo-finance";
import type { MarketDataPort, MarketQuote, MarketCandle } from "@/lib/core/ports/market-data-port";

export class YahooMarketDataAdapter implements MarketDataPort {
  async getQuote(ticker: string): Promise<MarketQuote | null> {
    const q = await getQuote(ticker);
    if (!q || !q.price || q.price <= 0) return null;
    return { ticker, price: q.price, name: q.name };
  }

  async getCandles(ticker: string, period = "1y"): Promise<MarketCandle[]> {
    const candles = await getChart(ticker, period);
    return candles.map((c) => ({
      time:   c.time,
      open:   c.open,
      high:   c.high,
      low:    c.low,
      close:  c.close,
      volume: c.volume,
    }));
  }
}
