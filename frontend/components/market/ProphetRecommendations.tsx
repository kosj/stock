"use client";

import useSWR from "swr";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, RefreshCw, Calendar } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatNumber } from "@/lib/utils";

interface RecommendationRow {
  id: number;
  run_date: string;
  rank: number;
  ticker: string;
  name: string;
  current_price: number;
  predicted_return_7d: number;
  predicted_return_30d: number;
  bull_return_30d: number;
  base_return_30d: number;
  bear_return_30d: number;
  recommendation: string;
  r_squared: number;
  trend_direction: string;
}

const REC_LABEL: Record<string, string> = {
  strong_buy:  "강력매수",
  buy:         "매수",
  hold:        "관망",
  sell:        "매도",
  strong_sell: "강력매도",
};
const REC_COLOR: Record<string, string> = {
  strong_buy:  "text-emerald-400 bg-emerald-500/10",
  buy:         "text-green-400   bg-green-500/10",
  hold:        "text-yellow-400  bg-yellow-500/10",
  sell:        "text-orange-400  bg-orange-500/10",
  strong_sell: "text-red-400     bg-red-500/10",
};

function RetCell({ value }: { value: number }) {
  const color = value >= 3 ? "text-green-400" : value <= -3 ? "text-red-400" : "text-muted-foreground";
  return (
    <span className={`tabular-nums font-medium ${color}`}>
      {value >= 0 ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

function ScenarioBar({ bull, base, bear }: { bull: number; base: number; bear: number }) {
  // 퍼센트 범위를 -20~+20에 매핑
  const MIN = -20, MAX = 20, RANGE = MAX - MIN;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - MIN) / RANGE) * 100));

  const bearPct = pct(bear);
  const basePct = pct(base);
  const bullPct = pct(bull);
  const zeroPct = pct(0);

  return (
    <div className="relative w-28 h-2 bg-white/5 rounded-full overflow-hidden">
      {/* Bear ~ Bull 범위 */}
      <div
        className="absolute top-0 h-full bg-blue-500/20 rounded-full"
        style={{ left: `${bearPct}%`, width: `${bullPct - bearPct}%` }}
      />
      {/* Base 마커 */}
      <div
        className={`absolute top-0 h-full w-0.5 ${base >= 0 ? "bg-green-400" : "bg-red-400"}`}
        style={{ left: `${basePct}%` }}
      />
      {/* Zero 기준선 */}
      <div className="absolute top-0 h-full w-px bg-white/20" style={{ left: `${zeroPct}%` }} />
    </div>
  );
}

export function ProphetRecommendations() {
  const { data, isLoading, mutate, isValidating } = useSWR<{
    run_date: string | null;
    rows: RecommendationRow[];
  }>(
    "prophet-recommendations",
    () => fetch("/api/recommendations/prophet").then(r => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  );

  const runDate  = data?.run_date;
  const rows     = data?.rows ?? [];
  const hasData  = rows.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Prophet 주간 추천 TOP 10</CardTitle>
          {runDate && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar size={11} />
              {runDate} 기준
            </span>
          )}
        </div>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="p-1.5 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
          title="새로고침"
        >
          <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} />
        </button>
      </CardHeader>

      {isLoading && (
        <div className="px-4 pb-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-white/3 rounded animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && !hasData && (
        <div className="px-4 pb-8 text-center text-sm text-muted-foreground">
          아직 분석 결과가 없습니다.
          <br />
          <span className="text-xs opacity-70">매주 금요일 장 마감 후 자동 업데이트됩니다.</span>
        </div>
      )}

      {hasData && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                {["#", "종목", "현재가", "7일", "30일(Base)", "시나리오 범위", "추천", "R²", "추세"].map(h => (
                  <th key={h} className="text-left text-xs text-muted-foreground py-2 px-3 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const TrendIcon =
                  row.trend_direction === "up"   ? TrendingUp   :
                  row.trend_direction === "down" ? TrendingDown  : Minus;
                const trendColor =
                  row.trend_direction === "up"   ? "text-green-400" :
                  row.trend_direction === "down" ? "text-red-400"   : "text-muted-foreground";
                const r2Pct = Math.round((row.r_squared ?? 0) * 100);

                return (
                  <tr
                    key={row.id}
                    className="border-b hover:bg-white/2 transition-colors"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {/* 순위 */}
                    <td className="py-3 px-3">
                      <span className={`text-sm font-bold tabular-nums ${
                        row.rank === 1 ? "text-yellow-400" :
                        row.rank === 2 ? "text-slate-300"  :
                        row.rank === 3 ? "text-amber-600"  : "text-muted-foreground"
                      }`}>
                        {row.rank}
                      </span>
                    </td>

                    {/* 종목 */}
                    <td className="py-3 px-3">
                      <Link
                        href={`/market/${row.ticker}`}
                        className="hover:text-blue-400 transition-colors"
                      >
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-muted-foreground">{row.ticker}</div>
                      </Link>
                    </td>

                    {/* 현재가 */}
                    <td className="py-3 px-3 tabular-nums">
                      {formatNumber(Math.round(row.current_price))}
                    </td>

                    {/* 7일 예측 */}
                    <td className="py-3 px-3">
                      <RetCell value={row.predicted_return_7d} />
                    </td>

                    {/* 30일 Base */}
                    <td className="py-3 px-3">
                      <RetCell value={row.base_return_30d} />
                    </td>

                    {/* 시나리오 범위 (시각 바 + Bear~Bull) */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <ScenarioBar bull={row.bull_return_30d} base={row.base_return_30d} bear={row.bear_return_30d} />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          <span className="text-red-400">{row.bear_return_30d.toFixed(1)}%</span>
                          {" ~ "}
                          <span className="text-green-400">+{row.bull_return_30d.toFixed(1)}%</span>
                        </span>
                      </div>
                    </td>

                    {/* 추천 */}
                    <td className="py-3 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${REC_COLOR[row.recommendation] ?? ""}`}>
                        {REC_LABEL[row.recommendation] ?? row.recommendation}
                      </span>
                    </td>

                    {/* R² */}
                    <td className="py-3 px-3">
                      <span className={`text-xs tabular-nums ${r2Pct >= 60 ? "text-blue-400" : "text-yellow-400"}`}>
                        {r2Pct}%
                      </span>
                    </td>

                    {/* 추세 */}
                    <td className="py-3 px-3">
                      <TrendIcon size={14} className={trendColor} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-2 text-xs text-muted-foreground/40 border-t" style={{ borderColor: "var(--border)" }}>
        Prophet 통계 예측 기반 — 투자 손익 보장 불가 · 매주 금요일 15:30 KST 자동 갱신
      </div>
    </Card>
  );
}
