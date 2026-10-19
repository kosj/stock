import { NextRequest, NextResponse } from "next/server";
import { analyzeTft } from "@/lib/server/tft-analysis";
import type { TftFactor, TftResult } from "@/lib/server/tft-analysis";
import { analysisBatchRequest, analysisTickerRequest } from "@/lib/server/analysis-request";
import { boundedSettled } from "@/lib/server/api-security-policy";

export type { TftFactor, TftResult };

export const dynamic    = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const input = await analysisTickerRequest(req.nextUrl.searchParams.get("ticker"));
  if (!input.ok) return input.response;
  const { ticker } = input;

  const result = await analyzeTft(ticker);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const input = await analysisBatchRequest(req);
  if (!input.ok) return input.response;
  const { tickers } = input;
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return NextResponse.json({ error: "tickers 배열이 필요합니다." }, { status: 400 });
  }

  const results = await boundedSettled(tickers, analyzeTft);

  const data = results
    .filter((r): r is PromiseFulfilledResult<TftResult> => r.status === "fulfilled")
    .map(r => r.value);

  return NextResponse.json(data);
}
