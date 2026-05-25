import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const supabase = await createSupabaseServerClient();
  const { data: { user: me } } = await supabase.auth.getUser();
  if (!me || me.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const { id } = await params;
  const admin  = createSupabaseAdminClient();

  await admin.auth.admin.updateUserById(id, { app_metadata: { role: "rejected" } });
  await admin.from("user_profiles").update({ role: "rejected" }).eq("id", id);

  return NextResponse.json({ success: true });
}
