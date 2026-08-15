import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

// 이전에는 인증이 없어 누구나 전 사용자의 알림을 읽고/만들고/지울 수 있었다.
// 우선 인증을 강제한다. 사용자별 스코프는 price_alerts.user_id 컬럼 추가
// (supabase/migrations/20260810_price_alerts_user_scope.sql) 적용 후 활성화한다.
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("price_alerts")
    .select("id, ticker, position_id, alert_type, direction, threshold, message, is_active, last_triggered, created_at")
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
    })
    .select("id, ticker, position_id, alert_type, direction, threshold, message, is_active, last_triggered, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
