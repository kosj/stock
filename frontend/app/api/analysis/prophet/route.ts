import { NextRequest, NextResponse } from "next/server";
import { prophetForecast } from "@/lib/server/prophet-forecast";
import { analysisBatchRequest } from "@/lib/server/analysis-request";
import { boundedSettled } from "@/lib/server/api-security-policy";

export const dynamic    = "force-dynamic";
export const maxDuration = 45;

export async function POST(request: NextRequest) {
  try {
    const input = await analysisBatchRequest(request, 10);
    if (!input.ok) return input.response;
    const { tickers } = input;

    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({ error: "tickers 배열 필요" }, { status: 400 });
    }

    // Cap to 10 tickers per request (each takes ~300-600ms)
    const targets = tickers;

    const settled = await boundedSettled(targets, prophetForecast);

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
