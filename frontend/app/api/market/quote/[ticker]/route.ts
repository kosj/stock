import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    // 샘플 주식 데이터
    const stockData: Record<string, any> = {
      "000660": {
        ticker: "000660",
        name: "SK하이닉스",
        price: 62500,
        change: 1250,
        change_rate: 2.04,
        volume: 15234567,
        market_cap: 3210000000000
      },
      "005930": {
        ticker: "005930",
        name: "삼성전자",
        price: 70000,
        change: 1000,
        change_rate: 1.45,
        volume: 45234567,
        market_cap: 4560000000000
      },
      "051910": {
        ticker: "051910",
        name: "LG화학",
        price: 600000,
        change: 5000,
        change_rate: 0.84,
        volume: 523456,
        market_cap: 450000000000
      }
    };

    const data = stockData[ticker];
    if (data) {
      return NextResponse.json({
        ...data,
        timestamp: new Date().toISOString()
      });
    }

    // 요청된 티커가 없으면 샘플 데이터 반환
    return NextResponse.json({
      ticker,
      name: `주식 ${ticker}`,
      price: Math.floor(Math.random() * 100000) + 10000,
      change: Math.floor(Math.random() * 5000) - 2500,
      change_rate: parseFloat((Math.random() * 5 - 2.5).toFixed(2)),
      volume: Math.floor(Math.random() * 50000000),
      market_cap: Math.floor(Math.random() * 5000000000000),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Market quote API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
