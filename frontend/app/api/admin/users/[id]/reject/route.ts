import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const admin  = createSupabaseAdminClient();

  const { error } = await admin.auth.admin.updateUserById(id, { app_metadata: { role: "rejected" } });
  if (error) return NextResponse.json({ error: "계정 권한 변경 실패" }, { status: 500 });
  await admin.from("user_profiles").update({ role: "rejected" }).eq("id", id);

  return NextResponse.json({ success: true });
}
