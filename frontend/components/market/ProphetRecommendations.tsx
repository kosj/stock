"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Minus,
  RefreshCw, Calendar, ChevronDown, ChevronRight,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatNumber } from "@/lib/utils";
import type { StockInvestorDay } from "@/lib/server/krx-service";

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface AccuracyPoint {
  date: string;
  actual: number;
  predicted: number | null;
  diff: number;
  diff_pct: number;
}

interface RecommendationRow {
  id: number;
  run_date: string;
  rank: number;
  ticker: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  sector: string;
  current_price: number;
  predicted_return_7d: number;
  predicted_return_30d: number;
  bull_return_30d: number;
  base_return_30d: number;
  bear_return_30d: number;
  recommendation: string;
  r_squared: number;
  trend_direction: string;
  accuracy_json: string | null;
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

const REC_LABEL: Record<string, string> = {
  strong_buy: "강력매수", buy: "매수", hold: "관망", sell: "매도", strong_sell: "강력매도",
};
const REC_COLOR: Record<string, string> = {
  strong_buy: "text-emerald-400 bg-emerald-500/10",
  buy:        "text-green-400   bg-green-500/10",
  hold:       "text-yellow-400  bg-yellow-500/10",
  sell:       "text-orange-400  bg-orange-500/10",
  strong_sell:"text-red-400     bg-red-500/10",
};

// ── 유틸 컴포넌트 ─────────────────────────────────────────────────────────────

function RetCell({ v, small }: { v: number; small?: boolean }) {
  const c = v >= 3 ? "text-green-400" : v <= -3 ? "text-red-400" : "text-muted-foreground";
  return (
    <span className={`tabular-nums font-medium ${c} ${small ? "text-xs" : ""}`}>
      {v >= 0 ? "+" : ""}{v.toFixed(1)}%
    </span>
  );
}


// ── 투자자 추이 차트 ──────────────────────────────────────────────────────────

function InvestorChart({ data }: { data: StockInvestorDay[] }) {
  if (!data.length) return (
    <p className="text-xs text-muted-foreground/50 py-4 text-center">투자자 데이터 없음</p>
  );

  const entries: { label: string; key: keyof StockInvestorDay; color: string }[] = [
    { label: "외국인", key: "foreign_net",     color: "#34d399" },
    { label: "기관",   key: "institution_net", color: "#60a5fa" },
    { label: "개인",   key: "individual_net",  color: "#f87171" },
  ];

  const allVals = data.flatMap(d =>
    [d.foreign_net, d.institution_net, d.individual_net],
  ).filter(v => isFinite(v));
  const maxAbs = Math.max(1, ...allVals.map(Math.abs));

  const W = 400, H = 120, PAD = { t: 8, r: 8, b: 28, l: 4 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;
  const midY   = PAD.t + chartH / 2;

  const days = data.length;
  const barW  = chartW / days / entries.length * 0.85;
  const group = chartW / days;

  return (
    <div className="space-y-1">
      <div className="flex gap-3 text-xs px-1">
        {entries.map(e => (
          <span key={e.key} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: e.color }} />
            <span className="text-muted-foreground">{e.label} 순매수</span>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: `${H}px` }}>
        {/* 제로 선 */}
        <line x1={PAD.l} y1={midY} x2={PAD.l + chartW} y2={midY}
          stroke="#ffffff20" strokeWidth="1" />
        {/* 바 */}
        {data.map((d, di) => (
          entries.map((e, ei) => {
            const val   = d[e.key] as number;
            const x     = PAD.l + di * group + ei * (barW + 1);
            const barH  = Math.abs(val) / maxAbs * (chartH / 2 - 4);
            const y     = val >= 0 ? midY - barH : midY;
            return (
              <g key={`${di}-${ei}`}>
                <rect x={x} y={val >= 0 ? y : midY} width={barW} height={barH}
                  fill={e.color} opacity="0.8" rx="1" />
                {/* 툴팁 hover 영역 */}
                <title>{e.label} {val >= 0 ? "+" : ""}{val.toLocaleString()}주</title>
              </g>
            );
          })
        ))}
        {/* X 날짜 레이블 */}
        {data.map((d, di) => (
          <text key={di}
            x={PAD.l + di * group + group / 2}
            y={H - 8}
            textAnchor="middle" fontSize="8" fill="#555">
            {d.date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── Prophet 정확도 표 ─────────────────────────────────────────────────────────

function AccuracyTable({ json }: { json: string | null }) {
  if (!json) return <p className="text-xs text-muted-foreground/50">정확도 데이터 없음</p>;

  let points: AccuracyPoint[] = [];
  try { points = JSON.parse(json); } catch { return null; }

  const avgAbsErr = points.length
    ? points.reduce((s, p) => s + Math.abs(p.diff_pct), 0) / points.length
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">5일 예측 vs 실제가</span>
        {avgAbsErr !== null && (
          <span className="text-xs text-muted-foreground">
            평균 오차{" "}
            <span className={avgAbsErr < 2 ? "text-green-400" : avgAbsErr < 5 ? "text-yellow-400" : "text-red-400"}>
              {avgAbsErr.toFixed(1)}%
            </span>
          </span>
        )}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b" style={{ borderColor: "var(--border)" }}>
            {["날짜", "실제가", "예측가", "차이", "오차율"].map(h => (
              <th key={h} className="text-left text-muted-foreground py-1 px-2 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map(p => (
            <tr key={p.date} className="border-b hover:bg-white/2" style={{ borderColor: "var(--border)" }}>
              <td className="py-1.5 px-2 text-muted-foreground">{p.date}</td>
              <td className="py-1.5 px-2 tabular-nums font-medium">{formatNumber(Math.round(p.actual))}</td>
              <td className="py-1.5 px-2 tabular-nums text-blue-400/80">
                {p.predicted !== null ? formatNumber(Math.round(p.predicted)) : "-"}
              </td>
              <td className={`py-1.5 px-2 tabular-nums ${p.diff >= 0 ? "text-green-400" : "text-red-400"}`}>
                {p.diff >= 0 ? "+" : ""}{formatNumber(Math.round(p.diff))}
              </td>
              <td className={`py-1.5 px-2 tabular-nums ${Math.abs(p.diff_pct) < 2 ? "text-green-400" : Math.abs(p.diff_pct) < 5 ? "text-yellow-400" : "text-red-400"}`}>
                {p.diff_pct >= 0 ? "+" : ""}{p.diff_pct.toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 행 상세 패널 (투자자 차트 + 예측 정확도) ──────────────────────────────────

function ExpandedRow({ ticker, accuracyJson }: { ticker: string; accuracyJson: string | null }) {
  const { data: invData, isLoading: invLoading } = useSWR<{ data: StockInvestorDay[] }>(
    `investor-trend-${ticker}`,
    () => fetch(`/api/analysis/investor-trend/${ticker}`).then(r => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 1_800_000 },
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 py-4"
      style={{ background: "var(--background)" }}>
      {/* 투자자 거래량 차트 */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground">5거래일 투자자별 순매수 (주)</div>
        {invLoading ? (
          <div className="h-28 bg-white/3 rounded animate-pulse" />
        ) : (
          <InvestorChart data={invData?.data ?? []} />
        )}
      </div>

      {/* Prophet 5일 예측 정확도 */}
      <div className="space-y-1.5">
        <AccuracyTable json={accuracyJson} />
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function ProphetRecommendations() {
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading, mutate, isValidating } = useSWR<{
    run_date: string | null;
    rows: RecommendationRow[];
  }>(
    "prophet-recommendations",
    () => fetch("/api/recommendations/prophet").then(r => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 300_000 },
  );

  const runDate = data?.run_date;
  const rows    = data?.rows ?? [];
  const hasData = rows.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <CardTitle>
            Prophet 추천 종목{hasData ? ` TOP ${rows.length}` : ""}
          </CardTitle>
          {runDate && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar size={11} />
              {runDate} 기준 · 시총 5000억 이상
            </span>
          )}
        </div>
        <button onClick={() => mutate()} disabled={isValidating}
          className="p-1.5 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} />
        </button>
      </CardHeader>

      {isLoading && (
        <div className="px-4 pb-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 bg-white/3 rounded animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && !hasData && (
        <div className="px-4 pb-10 text-center text-sm text-muted-foreground">
          아직 분석 결과가 없습니다.<br />
          <span className="text-xs opacity-60">매일 오후 4:00 KST 자동 업데이트</span>
        </div>
      )}

      {hasData && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                {["#", "종목", "시장", "현재가", "7일", "30일(Base)", "추천", "R²", "추세", ""].map(h => (
                  <th key={h} className="text-left text-xs text-muted-foreground py-2 px-3 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isExpanded = expanded === row.rank;
                const TrendIcon =
                  row.trend_direction === "up"   ? TrendingUp   :
                  row.trend_direction === "down" ? TrendingDown  : Minus;
                const trendColor =
                  row.trend_direction === "up"   ? "text-green-400" :
                  row.trend_direction === "down" ? "text-red-400"   : "text-muted-foreground";
                const r2 = Math.round((row.r_squared ?? 0) * 100);
                const isKosdaq = row.market === "KOSDAQ";

                return (
                  <>
                    <tr
                      key={row.rank}
                      onClick={() => setExpanded(isExpanded ? null : row.rank)}
                      className={`border-b cursor-pointer transition-colors hover:bg-white/2 ${isExpanded ? "bg-white/3" : ""}`}
                      style={{ borderColor: "var(--border)" }}
                    >
                      {/* 순위 */}
                      <td className="py-3 px-3">
                        <span className={`text-sm font-bold tabular-nums ${
                          row.rank === 1 ? "text-yellow-400" :
                          row.rank === 2 ? "text-slate-300"  :
                          row.rank === 3 ? "text-amber-600"  : "text-muted-foreground"
                        }`}>{row.rank}</span>
                      </td>

                      {/* 종목 */}
                      <td className="py-3 px-3">
                        <Link href={`/market/${row.ticker}`}
                          onClick={e => e.stopPropagation()}
                          className="hover:text-blue-400 transition-colors">
                          <div className="font-medium">{row.name}</div>
                          <div className="text-xs text-muted-foreground">{row.ticker}</div>
                        </Link>
                      </td>

                      {/* 시장 흐름 */}
                      <td className="py-3 px-3">
                        <div className="flex flex-col gap-0.5">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded w-fit ${
                            isKosdaq ? "bg-blue-500/15 text-blue-300" : "bg-purple-500/15 text-purple-300"
                          }`}>
                            {row.market}
                          </span>
                          <span className="text-xs text-muted-foreground">{row.sector}</span>
                        </div>
                      </td>

                      {/* 현재가 */}
                      <td className="py-3 px-3 tabular-nums font-medium">
                        {formatNumber(Math.round(row.current_price))}
                      </td>

                      {/* 7일 / 30일 */}
                      <td className="py-3 px-3"><RetCell v={row.predicted_return_7d} /></td>
                      <td className="py-3 px-3"><RetCell v={row.base_return_30d} /></td>

                      {/* 추천 */}
                      <td className="py-3 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${REC_COLOR[row.recommendation] ?? ""}`}>
                          {REC_LABEL[row.recommendation] ?? row.recommendation}
                        </span>
                      </td>

                      {/* R² */}
                      <td className="py-3 px-3">
                        <span className={`text-xs tabular-nums ${r2 >= 60 ? "text-blue-400" : "text-yellow-400"}`}>{r2}%</span>
                      </td>

                      {/* 추세 */}
                      <td className="py-3 px-3"><TrendIcon size={14} className={trendColor} /></td>

                      {/* 확장 아이콘 */}
                      <td className="py-3 px-2 text-muted-foreground">
                        {isExpanded
                          ? <ChevronDown size={13} />
                          : <ChevronRight size={13} />
                        }
                      </td>
                    </tr>

                    {/* 확장 패널 */}
                    {isExpanded && (
                      <tr key={`exp-${row.rank}`} className="border-b"
                        style={{ borderColor: "var(--border)" }}>
                        <td colSpan={11} className="p-0">
                          <ExpandedRow
                            ticker={row.ticker}
                            accuracyJson={row.accuracy_json}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-2 text-xs text-muted-foreground/40 border-t" style={{ borderColor: "var(--border)" }}>
        시총 5000억 이상 · Prophet 통계 예측 기반 — 투자 손익 보장 불가 · 매일 오후 4:00 KST 자동 갱신
      </div>
    </Card>
  );
}
