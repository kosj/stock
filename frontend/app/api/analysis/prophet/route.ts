import { NextRequest, NextResponse } from "next/server";
import { prophetForecast } from "@/lib/server/prophet-forecast";

export const dynamic    = "force-dynamic";
export const maxDuration = 45;

export async function POST(request: NextRequest) {
  try {
    const { tickers } = await request.json();

    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: "tickers 배열 필요" }, { status: 400 });
    }

    // Cap to 10 tickers per request (each takes ~300-600ms)
    const targets = (tickers as string[]).slice(0, 10).map(t => t.toUpperCase());

    const settled = await Promise.allSettled(targets.map(t => prophetForecast(t)));

    const results = settled.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { ticker: targets[i], insufficient_data: true, error: (r.reason as Error)?.message },
    );

    return NextResponse.json(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
