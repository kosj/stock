import { NextRequest, NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

// /api/sectors
export async function GET(request: NextRequest) {
  try {
    const data = await SectorService.getPerformance();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Sectors API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
