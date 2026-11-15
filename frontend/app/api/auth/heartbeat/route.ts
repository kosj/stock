import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

// 인증된 사용자의 last_seen_at을 현재 시각으로 갱신한다.
// AppShell에서 1시간에 한 번 호출 (localStorage throttle).
// user_profiles is server-only (anon/authenticated grants revoked), so the session client
// could not write it. The service role updates exactly one column of the caller's row.
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { error } = await createSupabaseAdminClient()
    .from("user_profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", user.id);

  return NextResponse.json({ ok: !error });
}
