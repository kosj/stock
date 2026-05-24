import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api/krx" || pathname === "/api/krx/") {
      const data = await KrxService.getDashboard();
      return NextResponse.json(data);
    }

    if (pathname === "/api/krx/investor") {
      const data = await KrxService.getInvestorTrends();
      return NextResponse.json(data);
    }

    if (pathname === "/api/krx/sector") {
      const data = await KrxService.getSectorIndex();
      return NextResponse.json(data);
    }

    if (pathname === "/api/krx/short-selling") {
      const data = await KrxService.getShortSelling();
      return NextResponse.json(data);
    }

    if (pathname === "/api/krx/debug") {
      const bld =
        url.searchParams.get("bld") ||
        "dbms/MDC/STAT/standard/MDCSTAT02301";
      const trdDd = url.searchParams.get("trd_dd");

      const extra: Record<string, string> = {};
      if (trdDd) {
        extra.trdDd = trdDd;
      } else {
        extra.trdDd = KrxService.getLastTradingDay();
        extra.mktId = "STK";
      }

      const data = await KrxService.getRaw(bld, extra);
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("KRX API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 502 }
    );
  }
}
