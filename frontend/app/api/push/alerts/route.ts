import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

// 이전에는 인증이 없어 누구나 전 사용자의 알림을 읽고/만들고/지울 수 있었다.
// 인증 + user_id 스코프를 적용한다(마이그레이션 20260810 적용 완료).
// 소유자 불명(user_id NULL)인 레거시 행은 노출하지 않는다.
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("price_alerts")
    .select("id, ticker, position_id, alert_type, direction, threshold, message, is_active, last_triggered, created_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const { ticker, alert_type, direction, threshold, position_id, message } = body ?? {};

  if (!ticker || !alert_type || !direction || threshold == null) {
    return NextResponse.json({ error: "필수 필드가 누락되었습니다." }, { status: 400 });
  }
  if (!Number.isFinite(Number(threshold))) {
    return NextResponse.json({ error: "threshold는 숫자여야 합니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("price_alerts")
    .insert({
      ticker:      String(ticker).toUpperCase(),
      alert_type:  String(alert_type),
      direction:   String(direction),
      threshold:   Number(threshold),
      position_id: position_id ?? null,
      message:     message ?? null,
      is_active:   true,
      user_id:     auth.userId,
    })
    .select("id, ticker, position_id, alert_type, direction, threshold, message, is_active, last_triggered, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
