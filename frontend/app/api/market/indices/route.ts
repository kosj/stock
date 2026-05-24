import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // DashboardPage가 기대하는 형식
  return NextResponse.json({
    KOSPI: {
      price: 2720.45,
      change: 15.32,
      change_pct: 0.57
    },
    KOSDAQ: {
      price: 891.23,
      change: -8.45,
      change_pct: -0.94
    },
    "S&P500": {
      price: 5105.33,
      change: 42.15,
      change_pct: 0.83
    },
    NASDAQ: {
      price: 16195.65,
      change: 125.45,
      change_pct: 0.78
    },
    "달러/원": {
      price: 1285.50,
      change: 15.50,
      change_pct: 1.22
    }
  });
}
