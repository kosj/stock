import { NextRequest, NextResponse } from "next/server";

// 임시: Macro API는 미구현 상태
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { message: "Macro API not implemented" },
    { status: 501 }
  );
}
