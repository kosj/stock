import { NextRequest, NextResponse } from "next/server";

// 임시: Analysis API는 미구현 상태
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { message: "Analysis API not implemented" },
    { status: 501 }
  );
}
