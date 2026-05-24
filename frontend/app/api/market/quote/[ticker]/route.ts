import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  return NextResponse.json(
    { message: "Market quote API not implemented" },
    { status: 501 }
  );
}
