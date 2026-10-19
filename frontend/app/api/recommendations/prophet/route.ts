import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // ?date=YYYY-MM-DD 지정 시 해당 날짜, 없으면 가장 최근 run_date 조회
  const dateParam = request.nextUrl.searchParams.get("date");
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  let runDate = dateParam;

  {
    // 최근 run_date 조회
    let query = supabase
      .from("recommendation_batches")
      .select("run_date");
    if (dateParam) query = query.eq("run_date", dateParam);
    const { data: latest, error } = await query
      .order("run_date", { ascending: false })
      .limit(1)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    if (!latest) return NextResponse.json({ run_date: null, rows: [], status: "no_complete_batch" });
    runDate = latest.run_date;
  }

  const { data, error } = await supabase
    .from("prophet_recommendations")
    .select("rank, ticker, name, market, sector, current_price, predicted_return_7d, predicted_return_30d, bull_return_30d, base_return_30d, bear_return_30d, recommendation, r_squared, trend_direction, accuracy_json")
    .eq("run_date", runDate)
    .not("rank", "is", null)          // Top20만 반환 (rank IS NOT NULL)
    .order("rank", { ascending: true })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ run_date: runDate, rows: data ?? [], return_calibrated: false,
    return_notice: "수익률 필드는 보정 전 휴리스틱 값이며 매력도 순위와 구분해야 합니다." });
}
