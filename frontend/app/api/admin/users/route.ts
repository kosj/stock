import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // 관리자 권한 확인
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();

  // user_profiles: 기본 프로필 정보 + last_seen_at (앱 접속 시 자체 갱신)
  const { data: profiles, error } = await admin
    .from("user_profiles")
    .select("id, email, full_name, role, requested_at, approved_at, last_seen_at")
    .order("requested_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // auth.admin.listUsers: Supabase 인증 레벨의 last_sign_in_at (이전 세션 값) fallback용
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const lastSignInMap = new Map(
    (authData?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])
  );

  const result = (profiles ?? []).map((p) => ({
    ...p,
    // last_seen_at(앱 접속 자체 추적)을 우선하고, 없으면 Supabase Auth 값 fallback
    last_seen_at:    p.last_seen_at ?? lastSignInMap.get(p.id) ?? null,
    last_sign_in_at: lastSignInMap.get(p.id) ?? null,
  }));

  return NextResponse.json(result);
}
