import { NextResponse } from "next/server";
import { SectorService } from "@/lib/server/sector-service";

export const maxDuration = 30;
export const revalidate  = 1800; // 30분

export async function GET() {
  const data = await SectorService.getPerformance();
  return NextResponse.json(data);
}
