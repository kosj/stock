import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ticker, alert_type, direction, threshold, position_id, message } = body ?? {};

  if (!ticker || !alert_type || !direction || threshold == null) {
    return NextResponse.json({ error: "필수 필드가 누락되었습니다." }, { status: 400 });
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
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
