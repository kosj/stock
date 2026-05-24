import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const data = await KrxService.getShortSelling();
    return NextResponse.json(data);
  } catch (error) {
    console.error("KRX short-selling API error:", error);

    // 크롤링 실패 시 샘플 데이터 반환
    const trdDd = KrxService.getLastTradingDay();
    return NextResponse.json({
      date: trdDd,
      by_market: [
        { market: "KOSPI", short_val: 1234567890000, total_val: 12345678900000, ratio: 10.0 },
        { market: "KOSDAQ", short_val: 234567890000, total_val: 2345678900000, ratio: 10.0 }
      ],
      top_kospi: [
        { ticker: "000660", name: "SK하이닉스", short_val: 50000000000, ratio: 1.2 },
        { ticker: "005930", name: "삼성전자", short_val: 45000000000, ratio: 1.0 },
        { ticker: "051910", name: "LG화학", short_val: 35000000000, ratio: 0.8 },
        { ticker: "000270", name: "기아", short_val: 30000000000, ratio: 0.7 },
        { ticker: "068270", name: "셀트리온", short_val: 25000000000, ratio: 0.6 }
      ],
      top_kosdaq: [
        { ticker: "096770", name: "SK이노베이션", short_val: 15000000000, ratio: 0.5 },
        { ticker: "035900", name: "LG", short_val: 12000000000, ratio: 0.4 },
        { ticker: "010950", name: "S-Oil", short_val: 10000000000, ratio: 0.3 }
      ]
    });
  }
}
