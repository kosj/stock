import { hasFreshTradeTime } from "./execution-policy.ts";
import type { MarketQuote } from "./ports/market-data-port";

export class QuoteUnavailable extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "QuoteUnavailable"; this.code = code; }
}

/** KIS minute observations carry THEIR OWN business date and trade time.
 * Never combine a returned time with today's date or use HTTP time as trade time.
 * Official field contract: koreainvestment/open-trading-api examples_llm/
 * domestic_stock/inquire_time_{item,index}chartprice/chk_*.py.
 */
export function kisMinuteQuote(ticker: string, rows: unknown, now = Date.now()): MarketQuote {
  if (!Array.isArray(rows)) throw new QuoteUnavailable("KIS_INVALID_RESPONSE");
  const candidates: MarketQuote[] = [];
  for (const row of rows) {
    const day = row?.stck_bsop_date, hour = row?.stck_cntg_hour;
    if (typeof day !== "string" || !/^\d{8}$/.test(day) || typeof hour !== "string" || !/^\d{6}$/.test(hour)) continue;
    const at = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${hour.slice(0, 2)}:${hour.slice(2, 4)}:${hour.slice(4, 6)}+09:00`;
    const parsed = new Date(at);
    if (!Number.isFinite(parsed.getTime()) || new Date(parsed.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replaceAll("-", "") !== day) continue;
    const local = new Date(parsed.getTime() + 9 * 3600_000);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    if (local.getUTCDay() === 0 || local.getUTCDay() === 6 || minutes < 540 || minutes > 930) continue;
    const price = Number(ticker === "^KS11" ? row.bstp_nmix_prpr : row.stck_prpr);
    if (Number.isFinite(price) && price > 0 && hasFreshTradeTime(at, now))
      candidates.push({ ticker, price, tradedAt: parsed.toISOString(), source: "KIS-minute" });
  }
  candidates.sort((a, b) => Date.parse(b.tradedAt!) - Date.parse(a.tradedAt!));
  if (!candidates[0]) throw new QuoteUnavailable("KIS_NO_FRESH_OBSERVATION");
  return candidates[0];
}
