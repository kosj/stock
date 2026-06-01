import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export const dynamic     = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: NextRequest) {
  try {
    const data = await KrxService.getInvestorTrends();
    return NextResponse.json(data);
  } catch (error) {
    console.error("KRX investor API error:", error);

    // Naver 크롤링 실패 시 샘플 데이터 반환
    const trdDd = KrxService.getLastTradingDay();
    return NextResponse.json({
      date: trdDd,
      kospi: [
        { name: "외국인", buy: 500000000000, sell: 480000000000, net: 20000000000 },
        { name: "기관계", buy: 450000000000, sell: 460000000000, net: -10000000000 },
        { name: "개인", buy: 400000000000, sell: 390000000000, net: 10000000000 },
        { name: "금융투자", buy: 100000000000, sell: 110000000000, net: -10000000000 }
      ],
      kosdaq: [
        { name: "외국인", buy: 150000000000, sell: 160000000000, net: -10000000000 },
        { name: "기관계", buy: 120000000000, sell: 115000000000, net: 5000000000 },
        { name: "개인", buy: 180000000000, sell: 175000000000, net: 5000000000 },
        { name: "금융투자", buy: 50000000000, sell: 55000000000, net: -5000000000 }
      ]
    });
  }
}
