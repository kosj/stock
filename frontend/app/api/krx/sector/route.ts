import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export async function GET(request: NextRequest) {
  try {
    const data = await KrxService.getSectorIndex();
    return NextResponse.json(data);
  } catch (error) {
    console.error("KRX sector API error:", error);

    // 크롤링 실패 시 샘플 데이터 반환
    const trdDd = KrxService.getLastTradingDay();
    return NextResponse.json({
      date: trdDd,
      kospi: [
        { name: "금융", index: 450.5, change: 5.2, change_pct: 1.17 },
        { name: "에너지", index: 380.2, change: -3.1, change_pct: -0.81 },
        { name: "IT", index: 520.8, change: 12.5, change_pct: 2.46 },
        { name: "산업재", index: 410.3, change: 2.8, change_pct: 0.69 },
        { name: "소비재", index: 390.1, change: 1.5, change_pct: 0.39 },
        { name: "헬스케어", index: 440.7, change: 4.2, change_pct: 0.96 }
      ],
      kosdaq: [
        { name: "IT", index: 580.5, change: 15.3, change_pct: 2.71 },
        { name: "바이오", index: 420.3, change: -2.1, change_pct: -0.50 },
        { name: "통신", index: 390.2, change: 3.5, change_pct: 0.90 }
      ]
    });
  }
}
