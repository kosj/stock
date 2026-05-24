import { NextRequest, NextResponse } from "next/server";
import { searchStocks } from "@/lib/server/yahoo-finance";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json([]);
  const results = await searchStocks(q);
  return NextResponse.json(results);
}
