import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 샘플 포트폴리오 상세 데이터
    const portfolio = {
      id: parseInt(id),
      name: id === "1" ? "메인 포트폴리오" : "ETF 포트폴리오",
      description: id === "1" ? "주식 투자 포트폴리오" : "ETF 투자 포트폴리오",
      total_value: id === "1" ? 5000000 : 3000000,
      total_gain: id === "1" ? 250000 : 150000,
      gain_rate: id === "1" ? 5.3 : 5.0,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: new Date().toISOString()
    };

    return NextResponse.json(portfolio);
  } catch (error) {
    console.error("Portfolio get API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    return NextResponse.json({
      id: parseInt(id),
      ...body,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Portfolio update API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json({ success: true, deleted_id: parseInt(id) });
  } catch (error) {
    console.error("Portfolio delete API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
