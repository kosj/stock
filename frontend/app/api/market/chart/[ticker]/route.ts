import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const period = request.nextUrl.searchParams.get("period") || "1y";

    // 차트 데이터 생성
    const generateChartData = (days: number, basePrice: number) => {
      const data = [];
      let price = basePrice;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);

        const change = (Math.random() - 0.5) * basePrice * 0.03;
        price += change;

        const open = price - (Math.random() - 0.5) * basePrice * 0.01;
        const high = Math.max(price, open) + Math.random() * basePrice * 0.01;
        const low = Math.min(price, open) - Math.random() * basePrice * 0.01;

        data.push({
          date: date.toISOString().split('T')[0],
          open: parseFloat(open.toFixed(0)),
          high: parseFloat(high.toFixed(0)),
          low: parseFloat(low.toFixed(0)),
          close: parseFloat(price.toFixed(0)),
          volume: Math.floor(Math.random() * 50000000) + 1000000
        });
      }

      return data;
    };

    // 기간별 데이터 크기
    const periodDays: Record<string, number> = {
      "1m": 21,
      "3m": 63,
      "6m": 126,
      "1y": 252,
      "2y": 504,
      "5y": 1260
    };

    const days = periodDays[period] || 252;
    const basePrice = ticker === "000660" ? 62500 : ticker === "005930" ? 70000 : 60000;

    return NextResponse.json({
      ticker,
      period,
      data: generateChartData(days, basePrice)
    });
  } catch (error) {
    console.error("Market chart API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
