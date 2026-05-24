import { NextRequest, NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export async function GET(request: NextRequest) {
  try {
    const sector = request.nextUrl.searchParams.get("sector");
    const sortBy = request.nextUrl.searchParams.get("sort_by") || "1m";

    if (!sector) {
      return NextResponse.json(
        { error: "sector parameter required" },
        { status: 400 }
      );
    }

    const data = await SectorService.getSectorEtfs(sector, sortBy);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Sectors ETFs API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
