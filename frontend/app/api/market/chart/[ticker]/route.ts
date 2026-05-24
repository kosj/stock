import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  try {
    const { ticker } = params;
    const period = request.nextUrl.searchParams.get("period") || "1y";

    if (!ticker) {
      return NextResponse.json(
        { error: "ticker parameter required" },
        { status: 400 }
      );
    }

    // 임시: Market chart API는 미구현 상태
    return NextResponse.json(
      { message: "Market chart API not implemented" },
      { status: 501 }
    );
  } catch (error) {
    console.error("Market chart API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
