"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { ProphetForecastResult, ProphetPoint } from "@/lib/server/prophet-forecast";

interface Props {
  result: ProphetForecastResult | null;
  loading: boolean;
}

const REC_META = {
  strong_buy:  { label: "강력 매수", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  buy:         { label: "매수",      color: "text-green-400",   bg: "bg-green-500/10  border-green-500/30"  },
  hold:        { label: "관망",      color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/30" },
  sell:        { label: "매도",      color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30" },
  strong_sell: { label: "강력 매도", color: "text-red-400",     bg: "bg-red-500/10    border-red-500/30"    },
} as const;

// ── 정확도 비교 차트 (실제 vs 예측) ─────────────────────────────────────────────

function AccuracyChart({
  actual,
  fit,
  predictions,
  isUp,
}: {
  actual:      { date: string; price: number }[];
  fit:         ProphetPoint[];
  predictions: ProphetPoint[];
  isUp:        boolean;
}) {
  const W = 540, H = 160;
  const PAD = { t: 12, r: 12, b: 28, l: 52 };
  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const totalN = actual.length + predictions.length;
  if (totalN === 0 || actual.length === 0) return null;

  // 전체 가격 범위 (실제 + 예측 + 신뢰구간)
  const allVals = [
    ...actual.map(p => p.price),
    ...fit.map(p => p.yhat),
    ...predictions.map(p => p.yhat_upper),
    ...predictions.map(p => p.yhat_lower),
  ].filter(isFinite);
  const minP = Math.min(...allVals) * 0.997;
  const maxP = Math.max(...allVals) * 1.003;
  const range = maxP - minP || 1;

  function cx(i: number, total: number) {
    return PAD.l + (i / (total - 1)) * chartW;
  }
  function cy(v: number) {
    return PAD.t + chartH - ((v - minP) / range) * chartH;
  }

  const histN = actual.length;
  const predN = predictions.length;

  // 실제가 폴리라인
  const actualLine = actual.map((p, i) => `${cx(i, totalN)},${cy(p.price)}`).join(" ");
  // 모델 fit 폴리라인 (점선)
  const fitLine    = fit.map((p, i) => `${cx(i, totalN)},${cy(p.yhat)}`).join(" ");
  // 예측 폴리라인
  const predLine   = predictions.map((p, i) => `${cx(histN + i, totalN)},${cy(p.yhat)}`).join(" ");

  // 신뢰구간 밴드 (예측 구간)
  const bandUp  = predictions.map((p, i) => `${cx(histN + i, totalN)},${cy(p.yhat_upper)}`).join(" ");
  const bandDn  = [...predictions].reverse().map((p, i) => `${cx(histN + predN - 1 - i, totalN)},${cy(p.yhat_lower)}`).join(" ");

  // MAPE 계산 (실제 vs fit)
  const mape = fit.length > 0
    ? fit.reduce((sum, fp, i) => sum + Math.abs((fp.yhat - actual[i].price) / actual[i].price), 0) / fit.length * 100
    : null;

  // Y축 틱
  const yTicks = [minP, (minP + maxP) / 2, maxP];
  // X축 레이블
  const startDate  = actual[0]?.date?.slice(5) ?? "";
  const nowDate    = actual[actual.length - 1]?.date?.slice(5) ?? "";
  const endDate    = predictions[predictions.length - 1]?.date?.slice(5) ?? "";

  const accentColor = isUp ? "#34d399" : "#f87171";
  const bandFill    = isUp ? "#34d39922" : "#f8717122";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 h-0.5 bg-white/70" />
            <span className="text-muted-foreground">실제가</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 h-0.5 bg-blue-400 opacity-70" style={{ borderTop: "2px dashed" }} />
            <span className="text-muted-foreground">모델 적합</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 h-0.5" style={{ background: accentColor }} />
            <span className="text-muted-foreground">예측</span>
          </span>
        </div>
        {mape !== null && (
          <span className="text-xs text-muted-foreground">
            과거 오차 <span className={mape < 3 ? "text-green-400" : mape < 7 ? "text-yellow-400" : "text-red-400"}>
              {mape.toFixed(1)}%
            </span>
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "160px" }}>
        {/* 그리드 */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={cy(v)} x2={PAD.l + chartW} y2={cy(v)}
              stroke="#ffffff0e" strokeWidth="1" />
            <text x={PAD.l - 6} y={cy(v) + 4} textAnchor="end" fontSize="9" fill="#666">
              {formatNumber(Math.round(v))}
            </text>
          </g>
        ))}

        {/* 현재 시점 구분선 */}
        <line
          x1={cx(histN - 1, totalN)} y1={PAD.t}
          x2={cx(histN - 1, totalN)} y2={PAD.t + chartH}
          stroke="#ffffff40" strokeWidth="1" strokeDasharray="4,3"
        />

        {/* 예측 신뢰구간 */}
        <polygon points={`${bandUp} ${bandDn}`} fill={bandFill} />

        {/* 모델 fit (파란 점선) */}
        <polyline points={fitLine} fill="none" stroke="#60a5fa" strokeWidth="1.5"
          strokeDasharray="5,3" opacity="0.75" />

        {/* 실제 가격 (흰색 실선) */}
        <polyline points={actualLine} fill="none" stroke="#ffffffb0" strokeWidth="2" />

        {/* 예측 선 */}
        {predLine && (
          <polyline points={predLine} fill="none" stroke={accentColor} strokeWidth="2" />
        )}

        {/* X축 레이블 */}
        <text x={cx(0, totalN)}           y={H - 6} textAnchor="start"  fontSize="9" fill="#555">{startDate}</text>
        <text x={cx(histN - 1, totalN)}   y={H - 6} textAnchor="middle" fontSize="9" fill="#999">현재</text>
        <text x={cx(totalN - 1, totalN)}  y={H - 6} textAnchor="end"    fontSize="9" fill="#555">{endDate}</text>
      </svg>
    </div>
  );
}

// ── 메인 카드 ─────────────────────────────────────────────────────────────────

export function ProphetForecastCard({ result, loading }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (loading) {
    return (
      <div className="rounded-xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="h-4 bg-white/5 rounded w-40" />
        <div className="h-40 bg-white/3 rounded" />
      </div>
    );
  }

  if (!result || result.insufficient_data) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        Prophet 예측: 데이터 부족 (최소 30거래일 필요)
      </div>
    );
  }

  const meta   = REC_META[result.recommendation];
  const isUp   = result.predicted_return_30d >= 0;
  const r2Pct  = Math.round(result.r_squared * 100);

  const TrendIcon =
    result.trend_direction === "up"   ? TrendingUp   :
    result.trend_direction === "down" ? TrendingDown  : Minus;

  const trendColor =
    result.trend_direction === "up"   ? "text-green-400"  :
    result.trend_direction === "down" ? "text-red-400"    : "text-muted-foreground";

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* 헤더 */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Prophet 가격 예측</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${meta.bg} ${meta.color}`}>
            {meta.label}
          </span>
          <span className={`text-xs tabular-nums font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
            {result.predicted_return_30d >= 0 ? "+" : ""}{result.predicted_return_30d.toFixed(1)}%
            <span className="text-muted-foreground font-normal ml-1">(30일)</span>
          </span>
        </div>
        {expanded ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">

          {/* 과거 실제 vs 예측 비교 차트 */}
          <AccuracyChart
            actual={result.history_actual}
            fit={result.history_fit}
            predictions={result.predictions}
            isUp={isUp}
          />

          {/* 통계 그리드 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "7일 예측",   value: `${result.predicted_return_7d  >= 0 ? "+" : ""}${result.predicted_return_7d.toFixed(1)}%`,  color: result.predicted_return_7d  >= 0 ? "text-green-400" : "text-red-400" },
              { label: "30일 예측",  value: `${result.predicted_return_30d >= 0 ? "+" : ""}${result.predicted_return_30d.toFixed(1)}%`, color: result.predicted_return_30d >= 0 ? "text-green-400" : "text-red-400" },
              { label: "연간 추세",  value: `${result.trend_slope_annual_pct.toFixed(1)}%`, color: trendColor },
              { label: "모델 적합도", value: `R² ${r2Pct}%`, color: r2Pct >= 60 ? "text-blue-400" : "text-yellow-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg p-2.5" style={{ background: "var(--background)" }}>
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                <div className={`text-sm font-semibold tabular-nums ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* 추세 방향 + 변화점 */}
          <div className="flex items-center gap-2 text-sm">
            <TrendIcon size={14} className={trendColor} />
            <span className={`text-xs font-medium ${trendColor}`}>
              {result.trend_direction === "up" ? "장기 상승 추세" : result.trend_direction === "down" ? "장기 하락 추세" : "추세 불명확"}
            </span>
            {result.changepoint_dates.length > 0 && (
              <span className="text-xs text-muted-foreground ml-2">
                추세 변화점: {result.changepoint_dates.slice(0, 3).join(", ")}
              </span>
            )}
          </div>

          {/* 7거래일 예측 테이블 */}
          {result.predictions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                    {["날짜", "예측가", "하단", "상단"].map(h => (
                      <th key={h} className="text-left text-muted-foreground py-1.5 px-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.predictions.slice(0, 7).map(p => {
                    const ret = ((p.yhat - result.current_price) / result.current_price) * 100;
                    return (
                      <tr key={p.date} className="border-b hover:bg-white/2"
                        style={{ borderColor: "var(--border)" }}>
                        <td className="py-1.5 px-2 text-muted-foreground">{p.date}</td>
                        <td className={`py-1.5 px-2 font-medium tabular-nums ${ret >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {formatNumber(Math.round(p.yhat))}
                          <span className="ml-1 opacity-70">
                            ({ret >= 0 ? "+" : ""}{ret.toFixed(1)}%)
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-muted-foreground tabular-nums">{formatNumber(Math.round(p.yhat_lower))}</td>
                        <td className="py-1.5 px-2 text-muted-foreground tabular-nums">{formatNumber(Math.round(p.yhat_upper))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground/50">
            Prophet 모델은 통계적 예측이며 실제 수익을 보장하지 않습니다.
          </p>
        </div>
      )}
    </div>
  );
}
