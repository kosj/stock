import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  return NextResponse.json(
    { message: "Market financials API not implemented" },
    { status: 501 }
  );
}
