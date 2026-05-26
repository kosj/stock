import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // VAPID_PUBLIC_KEY 환경변수가 없으면 null 반환
  // AlertsPage에서 null 체크 후 브라우저 알림만 활성화
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return NextResponse.json({ public_key: publicKey });
}
