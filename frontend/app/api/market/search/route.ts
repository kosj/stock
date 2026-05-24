import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q");

    if (!q) {
      return NextResponse.json(
        { error: "q parameter required" },
        { status: 400 }
      );
    }

    // 임시: Market search API는 미구현 상태
    return NextResponse.json(
      { message: "Market search API not implemented" },
      { status: 501 }
    );
  } catch (error) {
    console.error("Market search API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
