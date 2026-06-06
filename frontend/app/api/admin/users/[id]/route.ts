import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Ctx) {
  // 관리자 권한 확인
  const supabase = await createSupabaseServerClient();
  const { data: { user: me } } = await supabase.auth.getUser();
  if (!me || me.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  // 자기 자신 삭제 방지
  const { id } = await params;
  if (id === me.id) {
    return NextResponse.json({ error: "본인 계정은 삭제할 수 없습니다." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Supabase Auth에서 계정 삭제
  // → auth.users 삭제 시 user_profiles는 ON DELETE CASCADE로 자동 삭제
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
