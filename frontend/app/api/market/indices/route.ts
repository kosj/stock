import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // 임시 샘플 데이터
  return NextResponse.json({
    date: new Date().toISOString().split('T')[0],
    indices: [
      {
        name: "KOSPI",
        value: 2720.45,
        change: 15.32,
        change_rate: 0.57
      },
      {
        name: "KOSDAQ",
        value: 891.23,
        change: -8.45,
        change_rate: -0.94
      },
      {
        name: "KOSPI 200",
        value: 380.12,
        change: 2.34,
        change_rate: 0.62
      }
    ]
  });
}
