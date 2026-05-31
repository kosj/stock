/**
 * POST /api/mock/auto-trade/run
 * UI에서 수동으로 자동매매를 실행 — 현재 로그인 사용자만 대상
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAutoTrade } from "@/lib/server/auto-trade-engine";

export const dynamic    = "force-dynamic";
export const maxDuration = 45;

export async function POST() {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const result = await runAutoTrade(user.id);
  return NextResponse.json(result);
}
