import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  try {
    const { ticker } = params;

    if (!ticker) {
      return NextResponse.json(
        { error: "ticker parameter required" },
        { status: 400 }
      );
    }

    // 임시: Analysis API는 미구현 상태
    return NextResponse.json(
      { message: "Analysis API not implemented" },
      { status: 501 }
    );
  } catch (error) {
    console.error("Analysis API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
