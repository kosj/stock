/**
 * SupabaseRecommendationAdapter — RecommendationPort 구현
 *
 * prophet_recommendations 테이블에서 가장 최근 run_date의 Top-N을 조회.
 * (기존 trading-engine-service.ts의 SupabaseRepository를 포트 계약으로 이관)
 *
 * 쿼리 전략:
 *   1단계 — LIMIT 1로 최신 run_date만 조회 (풀스캔 방지)
 *   2단계 — 해당 날짜의 rank 1~N 레코드를 rank ASC로 조회
 */

import { supabase } from "../supabase";
import type { RecommendationPort } from "@/lib/core/ports/recommendation-port";
import type { Recommendation } from "@/lib/core/domain/recommendation";

interface RecRow {
  run_date: string;
  rank:            number;
  ticker:          string;
  name:            string;
  recommendation:  string;
  current_price:   number;
  base_return_30d: number;
  sector?: string;
}

export class SupabaseRecommendationAdapter implements RecommendationPort {
  private batchDate?: string;
  async getTopRecommendations(limit = 20): Promise<Recommendation[]> {
    this.batchDate = undefined;
    // 1단계: 가장 최신 분석 날짜
    const { data: latest } = await supabase
      .from("recommendation_batches")
      .select("run_date,model_version")
      .order("run_date", { ascending: false })
      .limit(1)
      .single();

    if (!latest?.run_date) return [];
    this.batchDate = latest.run_date;

    // 2단계: 해당 날짜의 Top-N
    const { data, error } = await supabase
      .from("prophet_recommendations")
      .select("run_date, rank, ticker, name, recommendation, current_price, base_return_30d, sector")
      .eq("run_date", latest.run_date)
      .not("rank", "is", null)
      .gte("rank", 1)
      .lte("rank", limit)
      .order("rank", { ascending: true })
      .limit(limit);

    if (error || !data) return [];

    return (data as RecRow[]).map((r) => ({
      runDate: r.run_date,
      rank:           r.rank,
      ticker:         r.ticker,
      name:           r.name,
      recommendation: r.recommendation,
      currentPrice:   r.current_price,
      baseReturn30d:  r.base_return_30d,
      sector: r.sector,
      modelVersion: latest.model_version,
    }));
  }
  async getSectors(tickers: string[]): Promise<Record<string, string>> {
    // Pin sector metadata to the batch actually used for ranking. A concurrent
    // new publication must not mix a different batch into this execution.
    if (!this.batchDate || !tickers.length) return {};
    const { data, error } = await supabase.from("prophet_recommendations").select("ticker,sector")
      .eq("run_date", this.batchDate).in("ticker", [...new Set(tickers)]);
    if (error || !data) throw new Error("보유·후보 섹터 조회 실패");
    return Object.fromEntries(data.filter(r => typeof r.sector === "string" && r.sector.trim())
      .map(r => [r.ticker, r.sector.trim()]));
  }
}
