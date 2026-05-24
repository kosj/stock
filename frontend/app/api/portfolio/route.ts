import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // 임시 샘플 데이터
  return NextResponse.json([
    {
      id: 1,
      name: "메인 포트폴리오",
      description: "주식 투자 포트폴리오",
      total_value: 5000000,
      total_gain: 250000,
      gain_rate: 5.3
    },
    {
      id: 2,
      name: "ETF 포트폴리오",
      description: "ETF 투자 포트폴리오",
      total_value: 3000000,
      total_gain: 150000,
      gain_rate: 5.0
    }
  ]);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({
    id: 3,
    name: body.name,
    description: body.description,
    total_value: 0,
    total_gain: 0,
    gain_rate: 0
  }, { status: 201 });
}
