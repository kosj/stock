import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    // 샘플 재무 데이터
    const financialsData: Record<string, any> = {
      "000660": {
        ticker: "000660",
        name: "SK하이닉스",
        per: 8.5,
        pbr: 1.2,
        psr: 2.1,
        roe: 14.2,
        roa: 8.5,
        eps: 7350,
        bps: 52083,
        dividend_yield: 3.2,
        debt_ratio: 45.2,
        current_ratio: 1.85
      },
      "005930": {
        ticker: "005930",
        name: "삼성전자",
        per: 9.2,
        pbr: 1.1,
        psr: 1.8,
        roe: 12.5,
        roa: 7.8,
        eps: 7609,
        bps: 64044,
        dividend_yield: 2.9,
        debt_ratio: 42.1,
        current_ratio: 1.72
      }
    };

    const data = financialsData[ticker];
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
      per: parseFloat((Math.random() * 20 + 5).toFixed(2)),
      pbr: parseFloat((Math.random() * 2 + 0.5).toFixed(2)),
      psr: parseFloat((Math.random() * 3 + 0.5).toFixed(2)),
      roe: parseFloat((Math.random() * 20 + 5).toFixed(2)),
      roa: parseFloat((Math.random() * 15 + 2).toFixed(2)),
      eps: Math.floor(Math.random() * 10000),
      bps: Math.floor(Math.random() * 100000),
      dividend_yield: parseFloat((Math.random() * 5).toFixed(2)),
      debt_ratio: parseFloat((Math.random() * 80 + 10).toFixed(2)),
      current_ratio: parseFloat((Math.random() * 2 + 1).toFixed(2)),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Market financials API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
