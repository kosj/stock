import { NextRequest, NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (
      pathname === "/api/sectors" ||
      pathname === "/api/sectors/"
    ) {
      const data = await SectorService.getPerformance();
      return NextResponse.json(data);
    }

    if (pathname === "/api/sectors/rotation") {
      const data = await SectorService.getRotation();
      return NextResponse.json(data);
    }

    if (pathname === "/api/sectors/etfs") {
      const sector = url.searchParams.get("sector");
      const sortBy = url.searchParams.get("sort_by") || "1m";

      if (!sector) {
        return NextResponse.json(
          { error: "sector parameter required" },
          { status: 400 }
        );
      }

      const data = await SectorService.getSectorEtfs(sector, sortBy);
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("Sectors API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
