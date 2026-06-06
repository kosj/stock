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

  // user_profiles: 기본 프로필 정보
  const { data: profiles, error } = await admin
    .from("user_profiles")
    .select("id, email, full_name, role, requested_at, approved_at")
    .order("requested_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // auth.admin.listUsers: last_sign_in_at 포함 인증 메타데이터
  // listUsers()는 최대 1000명까지 반환 (페이지네이션 생략)
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const lastSignInMap = new Map(
    (authData?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])
  );

  const result = (profiles ?? []).map((p) => ({
    ...p,
    last_sign_in_at: lastSignInMap.get(p.id) ?? null,
  }));

  return NextResponse.json(result);
}
