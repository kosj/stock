import { NextRequest, NextResponse } from "next/server";
import { getQuote } from "@/lib/server/yahoo-finance";

export const dynamic = "force-dynamic";

const INDEX_MAP = [
  { name: "KOSPI",   ticker: "KS11" },
  { name: "KOSDAQ",  ticker: "KQ11" },
  { name: "S&P500",  ticker: "S&P500" },
  { name: "NASDAQ",  ticker: "IXIC" },
  { name: "달러/원", ticker: "USD/KRW" },
] as const;

export async function GET(_: NextRequest) {
  const results = await Promise.allSettled(
    INDEX_MAP.map(({ ticker }) => getQuote(ticker))
  );

  const indices: Record<string, unknown> = {};
  INDEX_MAP.forEach(({ name }, i) => {
    const r = results[i];
    if (r.status === "fulfilled" && r.value) {
      const q = r.value;
      indices[name] = {
        price:      q.price,
        change:     q.change,
        change_pct: q.change_pct,
      };
    } else {
      indices[name] = null;
    }
  });

  return NextResponse.json(indices);
}
