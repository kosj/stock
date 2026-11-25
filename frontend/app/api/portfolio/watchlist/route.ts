import { NextRequest, NextResponse } from "next/server";
import { dbErrorResponse } from "@/lib/server/db-error";
import { supabase } from "@/lib/server/supabase";
import { requireUser } from "@/lib/server/require-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  const { data, error } = await supabase
    .from("watchlist")
    .select("id, ticker, name, sector, added_at")   // user_id 등 불필요 컬럼 제외
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (error) return dbErrorResponse(error, "watchlist GET", "관심 종목을 불러오지 못했습니다.");
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  // userId·body를 병렬로 읽어 순차 대기 제거
  const [auth, body] = await Promise.all([
    requireUser(),
    req.json(),
  ]);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

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
    .select("id, ticker, name, sector, added_at")
    .single();

  if (!insertError) {
    return NextResponse.json(inserted, { status: 201 });
  }

  // 유니크 제약 위반(중복) → 기존 행 반환
  if (insertError.code === "23505") {
    const { data: existing } = await supabase
      .from("watchlist")
      .select("id, ticker, name, sector, added_at")
      .eq("ticker", normalizedTicker)
      .eq("user_id", userId)
      .single();
    return NextResponse.json(existing, { status: 200 });
  }

  return NextResponse.json({ error: insertError.message }, { status: 500 });
}
