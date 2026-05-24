import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 샘플 포지션 데이터
    const positions = [
      {
        id: 1,
        portfolio_id: parseInt(id),
        ticker: "000660",
        name: "SK하이닉스",
        quantity: 10,
        price: 62500,
        value: 625000,
        gain: 25000,
        gain_rate: 4.17,
        buy_date: "2024-01-15T00:00:00Z"
      },
      {
        id: 2,
        portfolio_id: parseInt(id),
        ticker: "005930",
        name: "삼성전자",
        quantity: 5,
        price: 70000,
        value: 350000,
        gain: 10000,
        gain_rate: 2.94,
        buy_date: "2024-02-01T00:00:00Z"
      }
    ];

    return NextResponse.json(positions);
  } catch (error) {
    console.error("Portfolio positions API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    return NextResponse.json({
      id: Math.floor(Math.random() * 1000),
      portfolio_id: parseInt(id),
      ...body,
      buy_date: new Date().toISOString()
    }, { status: 201 });
  } catch (error) {
    console.error("Portfolio add position API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
