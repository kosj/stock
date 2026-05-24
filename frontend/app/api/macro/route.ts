import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  // 거시경제 지표 샘플 데이터
  const generateSeries = (baseValue: number, volatility: number = 0.5) => {
    const series = [];
    let value = baseValue;
    for (let i = 0; i < 30; i++) {
      const change = (Math.random() - 0.5) * volatility;
      value += change;
      series.push({
        date: new Date(Date.now() - (30 - i) * 86400000).toISOString().split('T')[0],
        value: parseFloat(value.toFixed(3))
      });
    }
    return series;
  };

  return NextResponse.json({
    us_fed_rate: {
      value: 5.33,
      unit: "%",
      change: 0.25,
      date: "2024-04-24",
      series: generateSeries(5.25, 0.1)
    },
    us_10y_yield: {
      value: 4.21,
      unit: "%",
      change: -0.15,
      date: "2024-04-24",
      series: generateSeries(4.35, 0.15)
    },
    kr_base_rate: {
      value: 3.25,
      unit: "%",
      change: 0.0,
      date: "2024-04-24",
      series: generateSeries(3.25, 0.05)
    },
    usd_krw: {
      value: 1285.50,
      unit: "원",
      change: 15.50,
      date: "2024-04-24",
      series: generateSeries(1270, 2.5)
    },
    eur_usd: {
      value: 1.084,
      unit: "USD",
      change: 0.008,
      date: "2024-04-24",
      series: generateSeries(1.076, 0.01)
    },
    us_cpi: {
      value: 3.4,
      unit: "%",
      change: -0.3,
      date: "2024-04-24",
      series: generateSeries(3.5, 0.2)
    },
    kr_cpi: {
      value: 2.9,
      unit: "%",
      change: -0.1,
      date: "2024-04-24",
      series: generateSeries(3.0, 0.15)
    },
    kospi: {
      value: 2720.45,
      unit: "포인트",
      change: 15.32,
      date: "2024-04-24",
      series: generateSeries(2705, 5)
    },
    kosdaq: {
      value: 891.23,
      unit: "포인트",
      change: -8.45,
      date: "2024-04-24",
      series: generateSeries(900, 4)
    },
    sp500: {
      value: 5105.33,
      unit: "포인트",
      change: 42.15,
      date: "2024-04-24",
      series: generateSeries(5063, 15)
    },
    nasdaq: {
      value: 16195.65,
      unit: "포인트",
      change: 125.45,
      date: "2024-04-24",
      series: generateSeries(16070, 30)
    }
  });
}
