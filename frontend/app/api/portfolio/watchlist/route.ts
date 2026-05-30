import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getCurrentUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data, error } = await supabase
    .from("watchlist")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const body = await req.json();
  const { ticker, name, sector } = body ?? {};

  if (!ticker) {
    return NextResponse.json({ error: "ticker 필드가 필요합니다." }, { status: 400 });
  }

  const normalizedTicker = String(ticker).toUpperCase();

  // 현재 사용자의 동일 ticker 중복 방지
  const { data: existing } = await supabase
    .from("watchlist")
    .select("*")
    .eq("ticker", normalizedTicker)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(existing, { status: 200 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .insert({
      ticker:  normalizedTicker,
      name:    String(name ?? ticker),
      sector:  sector ?? null,
      user_id: userId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
