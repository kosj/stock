import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { message: "Macro API not implemented" },
    { status: 501 }
  );
}
