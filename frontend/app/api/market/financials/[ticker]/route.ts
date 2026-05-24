import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    // 샘플 재무 데이터 (StockDetailPage가 기대하는 형식)
    const financialsData: Record<string, any> = {
      "000660": {
        ticker: "000660",
        name: "SK하이닉스",
        market_cap: 380000000000000,
        per: 8.5,
        pbr: 1.2,
        psr: 2.1,
        roe: 14.2,
        roa: 8.5,
        operating_margin: 22.5,
        revenue_growth: 15.3,
        earnings_growth: 18.7,
        eps: 7350,
        bps: 52083,
        dividend_yield: 3.2,
        beta: 0.95,
        week_52_high: 72000,
        week_52_low: 48000,
        debt_ratio: 45.2,
        debt_to_equity: 0.82,
        current_ratio: 1.85
      },
      "005930": {
        ticker: "005930",
        name: "삼성전자",
        market_cap: 4500000000000000,
        per: 9.2,
        pbr: 1.1,
        psr: 1.8,
        roe: 12.5,
        roa: 7.8,
        operating_margin: 18.2,
        revenue_growth: 12.5,
        earnings_growth: 14.2,
        eps: 7609,
        bps: 64044,
        dividend_yield: 2.9,
        beta: 1.05,
        week_52_high: 78500,
        week_52_low: 58000,
        debt_ratio: 42.1,
        debt_to_equity: 0.72,
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
      market_cap: Math.floor(Math.random() * 500000000000000),
      per: parseFloat((Math.random() * 20 + 5).toFixed(2)),
      pbr: parseFloat((Math.random() * 2 + 0.5).toFixed(2)),
      psr: parseFloat((Math.random() * 3 + 0.5).toFixed(2)),
      roe: parseFloat((Math.random() * 20 + 5).toFixed(2)),
      roa: parseFloat((Math.random() * 15 + 2).toFixed(2)),
      operating_margin: parseFloat((Math.random() * 30 + 5).toFixed(1)),
      revenue_growth: parseFloat((Math.random() * 40 - 10).toFixed(1)),
      earnings_growth: parseFloat((Math.random() * 50 - 10).toFixed(1)),
      eps: Math.floor(Math.random() * 10000),
      bps: Math.floor(Math.random() * 100000),
      dividend_yield: parseFloat((Math.random() * 5).toFixed(2)),
      beta: parseFloat((Math.random() * 2).toFixed(2)),
      week_52_high: Math.floor(Math.random() * 200000) + 50000,
      week_52_low: Math.floor(Math.random() * 100000) + 20000,
      debt_ratio: parseFloat((Math.random() * 80 + 10).toFixed(2)),
      debt_to_equity: parseFloat((Math.random() * 1.5).toFixed(2)),
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
