import { NextRequest, NextResponse } from "next/server";
import { dbErrorResponse } from "@/lib/server/db-error";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Ctx) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const alertId = Number(id);
  if (!Number.isInteger(alertId)) {
    return NextResponse.json({ error: "잘못된 id입니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("price_alerts")
    .delete()
    .eq("id", alertId)
    .eq("user_id", auth.userId);   // 남의 알림 삭제 차단

  if (error) return dbErrorResponse(error, "push/alerts/[id] DELETE", "가격 알림을 삭제하지 못했습니다.");
  return new NextResponse(null, { status: 204 });
}
