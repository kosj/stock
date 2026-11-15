import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/server/require-user";
import { managedTargetFailure } from "@/lib/server/admin-target";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  // 관리자 권한 확인
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin  = createSupabaseAdminClient();
  const denied = await managedTargetFailure(admin, auth.userId, id);
  if (denied) return denied;

  // app_metadata 업데이트 → JWT 갱신 시 즉시 반영
  const { error: authErr } = await admin.auth.admin.updateUserById(id, {
    app_metadata: { role: "user" },
  });
  if (authErr) return NextResponse.json({ error: "계정 권한 변경 실패" }, { status: 500 });

  // user_profiles 업데이트 (표시용; 권한은 app_metadata가 결정)
  const { error: profileErr } = await admin.from("user_profiles").update({
    role:        "user",
    approved_at: new Date().toISOString(),
    approved_by: auth.email,
  }).eq("id", id);
  if (profileErr) return NextResponse.json({ success: true, profile_updated: false });

  return NextResponse.json({ success: true });
}
