import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteBrokerConfig } from "@/lib/server/broker-config";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ type: string }> };

async function getUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

/** 증권사 자격증명 삭제 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const [userId, { type }] = await Promise.all([getUserId(), params]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  await deleteBrokerConfig(userId, type);
  return NextResponse.json({ ok: true });
}
