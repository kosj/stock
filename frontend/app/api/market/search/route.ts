import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { message: "Market search API not implemented" },
    { status: 501 }
  );
}
