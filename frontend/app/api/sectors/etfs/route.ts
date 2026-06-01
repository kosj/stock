import { NextRequest, NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export const maxDuration = 30;
export const revalidate  = 1800;

export async function GET(req: NextRequest) {
  const sector = req.nextUrl.searchParams.get("sector") ?? "";
  const sortBy = req.nextUrl.searchParams.get("sort_by") ?? "1m";
  const data = await SectorService.getSectorEtfs(sector, sortBy);
  return NextResponse.json(data);
}
