import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export async function GET(request: NextRequest) {
  try {
    const data = await KrxService.getInvestorTrends();
    return NextResponse.json(data);
  } catch (error) {
    console.error("KRX investor API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 502 }
    );
  }
}
