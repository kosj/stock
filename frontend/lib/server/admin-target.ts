import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Approve/reject/delete may only target other non-admin accounts. Without this an admin
 * could demote or reject themselves (approve sets role=user) or remove the other admins,
 * and recovering an admin then needs direct database access. Admin roles are managed
 * in Supabase itself, not through this UI.
 */
export async function managedTargetFailure(admin: AdminClient, actorId: string, targetId: string): Promise<NextResponse | null> {
  if (!UUID.test(targetId)) return NextResponse.json({ error: "잘못된 사용자 ID입니다." }, { status: 400 });
  if (targetId === actorId) return NextResponse.json({ error: "본인 계정은 변경할 수 없습니다." }, { status: 400 });
  const { data, error } = await admin.auth.admin.getUserById(targetId);
  if (error || !data.user) return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  if (data.user.app_metadata?.role === "admin") {
    return NextResponse.json({ error: "관리자 계정은 이 화면에서 변경할 수 없습니다." }, { status: 409 });
  }
  return null;
}
