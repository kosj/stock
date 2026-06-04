"use client";

import { useState, useRef, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ProphetForecastResult } from "@/lib/server/prophet-forecast";

interface Props {
  result: ProphetForecastResult;
}

const REC_META = {
  strong_buy:  { label: "강력매수", color: "text-emerald-400", dot: "bg-emerald-400" },
  buy:         { label: "매수",     color: "text-green-400",   dot: "bg-green-400"   },
  hold:        { label: "관망",     color: "text-yellow-400",  dot: "bg-yellow-400"  },
  sell:        { label: "매도",     color: "text-orange-400",  dot: "bg-orange-400"  },
  strong_sell: { label: "강력매도", color: "text-red-400",     dot: "bg-red-400"     },
} as const;

export function ProphetBadge({ result }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (result.insufficient_data) {
    return <span className="text-xs text-muted-foreground/30">데이터부족</span>;
  }

  const meta    = REC_META[result.recommendation];
  const ret30   = result.predicted_return_30d;
  const retColor = ret30 >= 0 ? "text-green-400" : "text-red-400";
  const TrendIcon =
    result.trend_direction === "up"   ? TrendingUp  :
    result.trend_direction === "down" ? TrendingDown : Minus;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
        <span className={`text-xs tabular-nums ${retColor}`}>
          {ret30 >= 0 ? "+" : ""}{ret30.toFixed(1)}%
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 left-0 top-full mt-1 w-64 rounded-xl border p-3 space-y-2.5 shadow-xl"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">앙상블 30일 예측</span>
            <div className="flex items-center gap-1">
              <TrendIcon size={11} className={result.trend_direction === "up" ? "text-green-400" : result.trend_direction === "down" ? "text-red-400" : "text-muted-foreground"} />
              <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {[
              { label: "7일 예측",    value: `${result.predicted_return_7d  >= 0 ? "+" : ""}${result.predicted_return_7d.toFixed(1)}%`,  color: result.predicted_return_7d  >= 0 ? "text-green-400" : "text-red-400" },
              { label: "30일 예측",   value: `${ret30 >= 0 ? "+" : ""}${ret30.toFixed(1)}%`, color: retColor },
              { label: "연간 추세",   value: `${result.trend_slope_annual_pct.toFixed(1)}%`, color: result.trend_direction === "up" ? "text-green-400" : result.trend_direction === "down" ? "text-red-400" : "text-muted-foreground" },
              { label: "적합도 R²",  value: `${Math.round(result.r_squared * 100)}%`, color: result.r_squared >= 0.6 ? "text-blue-400" : "text-yellow-400" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-md p-1.5" style={{ background: "var(--background)" }}>
                <div className="text-muted-foreground mb-0.5">{label}</div>
                <div className={`font-semibold tabular-nums ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {result.predictions.slice(0, 5).length > 0 && (
            <div className="border-t pt-2 space-y-1" style={{ borderColor: "var(--border)" }}>
              <div className="text-xs text-muted-foreground mb-1">예측가 (거래일)</div>
              {result.predictions.slice(0, 5).map((p, i) => {
                const dayRet = ((p.yhat - result.current_price) / result.current_price) * 100;
                return (
                  <div key={p.date} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">+{i + 1}일 ({p.date.slice(5)})</span>
                    <span className={dayRet >= 0 ? "text-green-400" : "text-red-400"}>
                      {Math.round(p.yhat).toLocaleString()}
                      <span className="ml-1 opacity-70">({dayRet >= 0 ? "+" : ""}{dayRet.toFixed(1)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-muted-foreground/40 pt-1">통계 예측 — 투자 손익 보장 불가</p>
        </div>
      )}
    </div>
  );
}
