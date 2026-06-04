/**
 * GET /api/sectors/etfs
 * 섹터별 ETF 목록 (sector_etfs 테이블 기반)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sector = req.nextUrl.searchParams.get("sector") ?? "";

  try {
    const query = supabase
      .from("sector_etfs")
      .select("id, ticker, sector_name, etf_name")
      .order("id");

    if (sector) query.eq("sector_name", sector);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
