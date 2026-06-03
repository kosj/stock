import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // ?date=YYYY-MM-DD 지정 시 해당 날짜, 없으면 가장 최근 run_date 조회
  const dateParam = request.nextUrl.searchParams.get("date");

  let runDate = dateParam;

  if (!runDate) {
    // 최근 run_date 조회
    const { data: latest } = await supabase
      .from("prophet_recommendations")
      .select("run_date")
      .order("run_date", { ascending: false })
      .limit(1)
      .single();

    if (!latest) return NextResponse.json({ run_date: null, rows: [] });
    runDate = latest.run_date;
  }

  const { data, error } = await supabase
    .from("prophet_recommendations")
    .select("rank, ticker, name, market, sector, current_price, predicted_return_7d, predicted_return_30d, bull_return_30d, base_return_30d, bear_return_30d, recommendation, r_squared, trend_direction, accuracy_json")
    .eq("run_date", runDate)
    .order("rank", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ run_date: runDate, rows: data ?? [] });
}
