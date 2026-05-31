import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveBrokerConfig, listBrokerTypes } from "@/lib/server/broker-config";

export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

/** 설정된 증권사 목록 조회 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const configured = await listBrokerTypes(userId);
  return NextResponse.json({ configured });
}

/** 증권사 자격증명 저장 */
export async function POST(req: NextRequest) {
  const [userId, body] = await Promise.all([getUserId(), req.json()]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { type, appKey, appSecret, accountNumber } = body ?? {};
  if (!type || !appKey || !appSecret) {
    return NextResponse.json({ error: "type, appKey, appSecret 필드가 필요합니다." }, { status: 400 });
  }

  try {
    await saveBrokerConfig(userId, String(type), { appKey, appSecret, accountNumber: accountNumber || undefined });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
