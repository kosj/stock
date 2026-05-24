import { NextRequest, NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export async function GET(request: NextRequest) {
  try {
    const data = await SectorService.getRotation();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Sectors rotation API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
