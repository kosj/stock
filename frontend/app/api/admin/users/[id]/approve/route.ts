import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  // 관리자 권한 확인
  const supabase = await createSupabaseServerClient();
  const { data: { user: me } } = await supabase.auth.getUser();
  if (!me || me.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const { id } = await params;
  const admin  = createSupabaseAdminClient();

  // app_metadata 업데이트 → JWT 갱신 시 즉시 반영
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    app_metadata: { role: "user" },
  });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });

  // user_profiles 업데이트
  await admin.from("user_profiles").update({
    role:        "user",
    approved_at: new Date().toISOString(),
    approved_by: me.email,
  }).eq("id", id);

  return NextResponse.json({ success: true });
}
