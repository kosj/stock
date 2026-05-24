import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export async function GET(request: NextRequest) {
  try {
    const data = await KrxService.getDashboard();
    return NextResponse.json(data);
  } catch (error) {
    console.error("KRX API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 502 }
    );
  }
}
