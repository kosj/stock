import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .order("added_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ticker, name, sector } = body ?? {};

  if (!ticker) {
    return NextResponse.json({ error: "ticker 필드가 필요합니다." }, { status: 400 });
  }

  // 이미 존재하면 기존 항목 반환 (중복 추가 방지)
  const { data: existing } = await supabase
    .from("watchlist")
    .select("*")
    .eq("ticker", String(ticker).toUpperCase())
    .maybeSingle();

  if (existing) {
    return NextResponse.json(existing, { status: 200 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .insert({
      ticker: String(ticker).toUpperCase(),
      name:   String(name ?? ticker),
      sector: sector ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
