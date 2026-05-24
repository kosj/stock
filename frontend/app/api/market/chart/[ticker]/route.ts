import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const period = request.nextUrl.searchParams.get("period") || "1y";

    // 차트 데이터 생성
    const generateChartData = (days: number, basePrice: number) => {
      const candles = [];
      const rsi = [];
      const macd = [];
      const macd_signal = [];
      const macd_hist = [];

      let price = basePrice;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        // 캔들 데이터
        const change = (Math.random() - 0.5) * basePrice * 0.03;
        price += change;

        const open = price - (Math.random() - 0.5) * basePrice * 0.01;
        const high = Math.max(price, open) + Math.random() * basePrice * 0.01;
        const low = Math.min(price, open) - Math.random() * basePrice * 0.01;
        const volume = Math.floor(Math.random() * 50000000) + 1000000;

        candles.push({
          time: dateStr,
          open: Math.round(open),
          high: Math.round(high),
          low: Math.round(low),
          close: Math.round(price),
          volume: volume
        });

        // 기술 지표
        const rsiValue = 50 + Math.sin(i / 10) * 30;
        rsi.push({ time: dateStr, value: parseFloat(rsiValue.toFixed(1)) });

        const macdValue = Math.sin(i / 20) * 100;
        macd.push({ time: dateStr, value: parseFloat(macdValue.toFixed(2)) });

        const signalValue = Math.sin(i / 25) * 80;
        macd_signal.push({ time: dateStr, value: parseFloat(signalValue.toFixed(2)) });

        const histValue = macdValue - signalValue;
        macd_hist.push({ time: dateStr, value: parseFloat(histValue.toFixed(2)) });
      }

      return { candles, rsi, macd, macd_signal, macd_hist };
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

    const { candles, rsi, macd, macd_signal, macd_hist } = generateChartData(days, basePrice);

    return NextResponse.json({
      ticker,
      period,
      candles,
      indicators: {
        rsi,
        macd,
        macd_signal,
        macd_hist
      }
    });
  } catch (error) {
    console.error("Market chart API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
