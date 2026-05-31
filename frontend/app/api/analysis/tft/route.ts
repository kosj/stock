import { NextRequest, NextResponse } from "next/server";
import { analyzeTft } from "@/lib/server/tft-analysis";
import type { TftFactor, TftResult } from "@/lib/server/tft-analysis";

export type { TftFactor, TftResult };

export const dynamic    = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker") ?? "";
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const result = await analyzeTft(ticker);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const { tickers } = await req.json().catch(() => ({ tickers: [] }));
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return NextResponse.json({ error: "tickers 배열이 필요합니다." }, { status: 400 });
  }

  const results = await Promise.allSettled(
    tickers.map((t: string) => analyzeTft(t)),
  );

  const data = results
    .filter((r): r is PromiseFulfilledResult<TftResult> => r.status === "fulfilled")
    .map(r => r.value);

  return NextResponse.json(data);
}
