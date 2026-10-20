import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date");
  if (dateParam && (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    || !Number.isFinite(Date.parse(`${dateParam}T00:00:00Z`))
    || new Date(`${dateParam}T00:00:00Z`).toISOString().slice(0, 10) !== dateParam)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // Trading continues to read only recommendation_batches. Historical results
  // are exposed here for display, without creating or promoting a completed batch.
  let batches = supabase.from("recommendation_batches").select("run_date");
  if (dateParam) batches = batches.eq("run_date", dateParam);
  const { data: batch, error: batchError } = await batches
    .order("run_date", { ascending: false }).limit(1).maybeSingle();
  if (batchError) return NextResponse.json({ error: "추천 검증 상태를 조회하지 못했습니다." }, { status: 503 });

  let runDate: string | null = batch?.run_date ?? null;
  if (!runDate) {
    let history = supabase.from("prophet_recommendations").select("run_date")
      .gte("rank", 1).lte("rank", 20);
    if (dateParam) history = history.eq("run_date", dateParam);
    const { data: latest, error } = await history
      .order("run_date", { ascending: false }).limit(1).maybeSingle();
    if (error) return NextResponse.json({ error: "기존 추천 이력을 조회하지 못했습니다." }, { status: 503 });
    runDate = latest?.run_date ?? null;
  }
  if (!runDate) return NextResponse.json({ run_date: null, rows: [], status: "no_complete_batch", verified_batch: false });

  const { data, error } = await supabase.from("prophet_recommendations")
    .select("rank, ticker, name, market, sector, current_price, predicted_return_7d, predicted_return_30d, bull_return_30d, base_return_30d, bear_return_30d, recommendation, r_squared, trend_direction, accuracy_json")
    .eq("run_date", runDate).gte("rank", 1).lte("rank", 20)
    .order("rank", { ascending: true }).limit(20);
  if (error) return NextResponse.json({ error: "추천 종목을 조회하지 못했습니다." }, { status: 503 });

  const rows = data ?? [];
  // Never display a partial or malformed saved list as a complete Top20.
  if (rows.length !== 20 || rows.some((row, i) => row.rank !== i + 1
      || !row.ticker || !row.name || !Number.isFinite(Number(row.current_price)) || Number(row.current_price) <= 0)
      || new Set(rows.map(row => row.ticker)).size !== 20) {
    return NextResponse.json({ run_date: runDate, rows: [], status: "incomplete_batch", verified_batch: false });
  }
  return NextResponse.json({ run_date: runDate, rows,
    status: batch ? "complete" : "legacy_unverified", verified_batch: Boolean(batch),
    return_calibrated: false,
    return_notice: "수익률 필드는 보정 전 휴리스틱 값이며 매력도 순위와 구분해야 합니다." });
}
