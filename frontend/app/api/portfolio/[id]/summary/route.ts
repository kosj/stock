import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 샘플 포트폴리오 요약 데이터
    const summaryData = {
      id: parseInt(id),
      name: id === "1" ? "메인 포트폴리오" : "ETF 포트폴리오",
      total_value: id === "1" ? 5000000 : 3000000,
      total_gain: id === "1" ? 250000 : 150000,
      gain_rate: id === "1" ? 5.3 : 5.0,
      cash: id === "1" ? 500000 : 300000,
      positions: [
        {
          id: 1,
          ticker: "000660",
          name: "SK하이닉스",
          quantity: 10,
          price: 62500,
          value: 625000,
          gain: 25000,
          gain_rate: 4.17
        },
        {
          id: 2,
          ticker: "005930",
          name: "삼성전자",
          quantity: 5,
          price: 70000,
          value: 350000,
          gain: 10000,
          gain_rate: 2.94
        },
        {
          id: 3,
          ticker: "051910",
          name: "LG화학",
          quantity: 3,
          price: 600000,
          value: 1800000,
          gain: 100000,
          gain_rate: 5.88
        }
      ]
    };

    return NextResponse.json(summaryData);
  } catch (error) {
    console.error("Portfolio summary API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
