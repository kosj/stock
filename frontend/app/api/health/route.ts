import { NextRequest, NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { status: "ok", version: "1.0.0" },
    { status: 200 }
  );
}
