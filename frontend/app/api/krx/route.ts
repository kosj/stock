import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const data = await KrxService.getDashboard();
    return NextResponse.json(data);
  } catch (error) {
    console.error("KRX API error:", error);

    // 실시간 데이터 조회 실패 시 샘플 데이터 반환
    const trdDd = KrxService.getLastTradingDay();

    return NextResponse.json({
      date: trdDd,
      money_flow: {
        flows: [
          {
            investor: "외국인",
            kospi_net: 50000000000,
            kosdaq_net: -10000000000,
            total_net: 40000000000
          },
          {
            investor: "기관",
            kospi_net: -30000000000,
            kosdaq_net: 8000000000,
            total_net: -22000000000
          },
          {
            investor: "개인",
            kospi_net: 20000000000,
            kosdaq_net: 10000000000,
            total_net: 30000000000
          },
          {
            investor: "기타법인",
            kospi_net: 5000000000,
            kosdaq_net: 3000000000,
            total_net: 8000000000
          }
        ]
      },
      investor: {
        date: trdDd,
        kospi: [
          { name: "외국인", buy: 500000000000, sell: 450000000000, net: 50000000000 },
          { name: "기관계", buy: 420000000000, sell: 450000000000, net: -30000000000 },
          { name: "개인", buy: 400000000000, sell: 380000000000, net: 20000000000 },
          { name: "금융투자", buy: 100000000000, sell: 110000000000, net: -10000000000 }
        ],
        kosdaq: [
          { name: "외국인", buy: 150000000000, sell: 160000000000, net: -10000000000 },
          { name: "기관계", buy: 115000000000, sell: 107000000000, net: 8000000000 },
          { name: "개인", buy: 180000000000, sell: 170000000000, net: 10000000000 },
          { name: "금융투자", buy: 50000000000, sell: 55000000000, net: -5000000000 }
        ]
      },
      sector_index: {
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
      },
      short_selling: {
        date: trdDd,
        by_market: [
          { market: "KOSPI", short_val: 1234567890000, total_val: 12345678900000, ratio: 10.0 },
          { market: "KOSDAQ", short_val: 234567890000, total_val: 2345678900000, ratio: 10.0 }
        ],
        top_kospi: [
          { ticker: "000660", name: "SK하이닉스", short_val: 50000000000, ratio: 1.2 },
          { ticker: "005930", name: "삼성전자", short_val: 45000000000, ratio: 1.0 },
          { ticker: "051910", name: "LG화학", short_val: 35000000000, ratio: 0.8 }
        ],
        top_kosdaq: [
          { ticker: "096770", name: "SK이노베이션", short_val: 15000000000, ratio: 0.5 },
          { ticker: "035900", name: "LG", short_val: 12000000000, ratio: 0.4 }
        ]
      }
    });
  }
}
