import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // 샘플 알림 데이터
    return NextResponse.json([
      {
        id: 1,
        ticker: "000660",
        name: "SK하이닉스",
        alert_type: "custom",
        direction: "above",
        threshold: 65000,
        created_at: "2024-04-20T10:30:00Z"
      },
      {
        id: 2,
        ticker: "005930",
        name: "삼성전자",
        alert_type: "change_rate",
        direction: "below",
        threshold: 2.5,
        created_at: "2024-04-21T14:15:00Z"
      }
    ]);
  } catch (error) {
    console.error("Push alerts API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    return NextResponse.json({
      id: Math.floor(Math.random() * 1000),
      ...body,
      created_at: new Date().toISOString()
    }, { status: 201 });
  } catch (error) {
    console.error("Push alerts create API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
