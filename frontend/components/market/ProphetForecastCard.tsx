"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import type { ProphetForecastResult, ProphetPoint } from "@/lib/server/prophet-forecast";

interface Props {
  result: ProphetForecastResult | null;
  loading: boolean;
}

// ── Recommendation meta ───────────────────────────────────────────────────────

const REC_META = {
  strong_buy:  { label: "강력 매수", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  buy:         { label: "매수",     color: "text-green-400",   bg: "bg-green-500/10  border-green-500/30"  },
  hold:        { label: "관망",     color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/30" },
  sell:        { label: "매도",     color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30" },
  strong_sell: { label: "강력 매도", color: "text-red-400",    bg: "bg-red-500/10    border-red-500/30"    },
} as const;

// ── Mini prediction chart (SVG) ───────────────────────────────────────────────

function PredictionChart({ history, predictions, isUp }: {
  history: ProphetPoint[];
  predictions: ProphetPoint[];
  isUp: boolean;
}) {
  const W = 520, H = 130, PAD = { t: 10, r: 12, b: 24, l: 50 };
  const all = [...history, ...predictions];
  if (all.length === 0) return null;

  const prices = all.flatMap(p => [p.yhat, p.yhat_lower, p.yhat_upper]).filter(isFinite);
  const minP = Math.min(...prices) * 0.998;
  const maxP = Math.max(...prices) * 1.002;
  const range = maxP - minP || 1;

  const chartW = W - PAD.l - PAD.r;
  const chartH = H - PAD.t - PAD.b;

  const totalPoints = all.length;
  function cx(i: number) { return PAD.l + (i / (totalPoints - 1)) * chartW; }
  function cy(v: number) { return PAD.t + chartH - ((v - minP) / range) * chartH; }

  const histN = history.length;
  const predN = predictions.length;

  // Polyline points
  const histLine = history.map((p, i) => `${cx(i)},${cy(p.yhat)}`).join(" ");
  const predLine = predictions.map((p, i) => `${cx(histN + i)},${cy(p.yhat)}`).join(" ");

  // Confidence band polygon (future only)
  const bandUpper = predictions.map((p, i) => `${cx(histN + i)},${cy(p.yhat_upper)}`).join(" ");
  const bandLower = [...predictions].reverse().map((p, i) => `${cx(histN + predN - 1 - i)},${cy(p.yhat_lower)}`).join(" ");
  const bandPoly  = bandUpper + " " + bandLower;

  // Y-axis ticks (3)
  const yTicks = [minP, (minP + maxP) / 2, maxP];

  // X-axis labels
  const firstDate    = history[0]?.date?.slice(5)  ?? "";
  const splitDate    = history[history.length - 1]?.date?.slice(5) ?? "";
  const lastPredDate = predictions[predictions.length - 1]?.date?.slice(5) ?? "";

  const accentColor = isUp ? "#34d399" : "#f87171"; // green or red
  const bandColor   = isUp ? "#34d39930" : "#f8717130";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "130px" }}>
      {/* Y-axis ticks */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l - 4} y1={cy(v)} x2={PAD.l + chartW} y2={cy(v)}
            stroke="#ffffff12" strokeWidth="1" />
          <text x={PAD.l - 6} y={cy(v) + 4} textAnchor="end" fontSize="9" fill="#888">
            {formatNumber(Math.round(v))}
          </text>
        </g>
      ))}

      {/* Divider between history and forecast */}
      <line
        x1={cx(histN - 1)} y1={PAD.t}
        x2={cx(histN - 1)} y2={PAD.t + chartH}
        stroke="#ffffff30" strokeWidth="1" strokeDasharray="3,3"
      />

      {/* Confidence band */}
      <polygon points={bandPoly} fill={bandColor} />

      {/* Historical fit line */}
      <polyline points={histLine} fill="none" stroke="#60a5fa" strokeWidth="1.5"
        strokeDasharray="4,2" opacity="0.7" />

      {/* Forecast line */}
      {predLine && (
        <polyline points={predLine} fill="none" stroke={accentColor} strokeWidth="2" />
      )}

      {/* X-axis labels */}
      <text x={cx(0)}            y={H - 6} textAnchor="start"  fontSize="9" fill="#666">{firstDate}</text>
      <text x={cx(histN - 1)}    y={H - 6} textAnchor="middle" fontSize="9" fill="#aaa">현재</text>
      <text x={cx(totalPoints-1)}y={H - 6} textAnchor="end"    fontSize="9" fill="#666">{lastPredDate}</text>

      {/* "예측" label */}
      <text x={cx(histN + predN / 2)} y={PAD.t + 12} textAnchor="middle" fontSize="9"
        fill={accentColor} opacity="0.7">예측 ({predN}거래일)</text>
    </svg>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

export function ProphetForecastCard({ result, loading }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (loading) {
    return (
      <div className="rounded-xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="h-4 bg-white/5 rounded w-40" />
        <div className="h-32 bg-white/3 rounded" />
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

      {/* Header */}
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
            {result.predicted_return_30d >= 0 ? "+" : ""}{result.predicted_return_30d.toFixed(1)}% <span className="text-muted-foreground font-normal">(30일)</span>
          </span>
        </div>
        {expanded ? <ChevronUp size={15} className="text-muted-foreground" /> : <ChevronDown size={15} className="text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">

          {/* Prediction chart */}
          <PredictionChart
            history={result.history_fit}
            predictions={result.predictions}
            isUp={isUp}
          />

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "7일 예측",  value: `${result.predicted_return_7d  >= 0 ? "+" : ""}${result.predicted_return_7d.toFixed(1)}%`,  color: result.predicted_return_7d  >= 0 ? "text-green-400" : "text-red-400" },
              { label: "30일 예측", value: `${result.predicted_return_30d >= 0 ? "+" : ""}${result.predicted_return_30d.toFixed(1)}%`, color: result.predicted_return_30d >= 0 ? "text-green-400" : "text-red-400" },
              { label: "연간 추세", value: `${result.trend_slope_annual_pct.toFixed(1)}%`, color: trendColor },
              { label: "모델 적합도", value: `R² ${r2Pct}%`, color: r2Pct >= 60 ? "text-blue-400" : "text-yellow-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg p-2.5"
                style={{ background: "var(--background)" }}>
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                <div className={`text-sm font-semibold tabular-nums ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Trend direction */}
          <div className="flex items-center gap-2 text-sm">
            <TrendIcon size={14} className={trendColor} />
            <span className={`text-xs font-medium ${trendColor}`}>
              {result.trend_direction === "up" ? "장기 상승 추세" : result.trend_direction === "down" ? "장기 하락 추세" : "추세 불명확"}
            </span>
            {result.changepoint_dates.length > 0 && (
              <span className="text-xs text-muted-foreground ml-2">
                추세 변화: {result.changepoint_dates.slice(0, 3).join(", ")}
              </span>
            )}
          </div>

          {/* Prediction table (first 7 days) */}
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
                          <span className="ml-1 text-xs opacity-70">
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
