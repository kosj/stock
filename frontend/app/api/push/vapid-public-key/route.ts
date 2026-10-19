import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // A public key alone does not mean a user-scoped sender is deployed.
  return NextResponse.json({ public_key: null, available: false, reason: "웹 푸시 발송 기능 준비 중" });
}
