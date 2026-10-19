import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // There is no user-scoped sender/worker in the Next.js deployment yet.
  // Accepting a subscription here would promise delivery that cannot occur.
  return NextResponse.json({ error: "웹 푸시 발송 기능은 준비 중입니다. 구독이 저장되지 않았습니다." },
    { status: 501, headers: { "Cache-Control": "no-store" } });
}
