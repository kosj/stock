import { NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const data = await SectorService.getRotation();
  return NextResponse.json(data);
}
