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
    .select("id, ticker, name, sector, added_at")   // user_id 등 불필요 컬럼 제외
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  // userId·body를 병렬로 읽어 순차 대기 제거
  const [userId, body] = await Promise.all([
    getCurrentUserId(),
    req.json(),
  ]);
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { ticker, name, sector } = body ?? {};
  if (!ticker) {
    return NextResponse.json({ error: "ticker 필드가 필요합니다." }, { status: 400 });
  }

  const normalizedTicker = String(ticker).toUpperCase();

  // INSERT 먼저 시도 → conflict(중복) 시에만 기존 행 조회
  // SELECT → INSERT 2번 쿼리 → 1번 쿼리로 단축
  const { data: inserted, error: insertError } = await supabase
    .from("watchlist")
    .insert({
      ticker:  normalizedTicker,
      name:    String(name ?? ticker),
      sector:  sector ?? null,
      user_id: userId,
    })
    .select()
    .single();

  if (!insertError) {
    return NextResponse.json(inserted, { status: 201 });
  }

  // 유니크 제약 위반(중복) → 기존 행 반환
  if (insertError.code === "23505") {
    const { data: existing } = await supabase
      .from("watchlist")
      .select("*")
      .eq("ticker", normalizedTicker)
      .eq("user_id", userId)
      .single();
    return NextResponse.json(existing, { status: 200 });
  }

  return NextResponse.json({ error: insertError.message }, { status: 500 });
}
