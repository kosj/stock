/**
 * GET /api/sectors/rotation
 * 섹터 로테이션 테마 분석 (DB 기반)
 */
import { NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [sectors, { theme, leading, lagging }] = await Promise.all([
      SectorService.getMomentum(),
      SectorService.getRotationTheme(),
    ]);
    return NextResponse.json(
      { date: new Date().toISOString().slice(0, 10), sectors, theme, leading, lagging },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
