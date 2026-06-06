/**
 * GET /api/sectors
 * 섹터별 1개월 수익률 목록 (DB 기반)
 */
import { NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sectors = await SectorService.getMomentum();
    return NextResponse.json(
      { sectors },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
