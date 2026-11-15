import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/server/require-user";
import { managedTargetFailure } from "@/lib/server/admin-target";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Ctx) {
  // 관리자 권한 확인
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  // 자기 자신·다른 관리자 삭제 방지 (마지막 관리자 잠금 방지)
  const { id } = await params;
  const admin = createSupabaseAdminClient();
  const denied = await managedTargetFailure(admin, auth.userId, id);
  if (denied) return denied;

  // Supabase Auth에서 계정 삭제
  // → auth.users 삭제 시 user_profiles는 ON DELETE CASCADE로 자동 삭제
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: "계정 삭제 실패" }, { status: 500 });

  return NextResponse.json({ success: true });
}
