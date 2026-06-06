"use client";

import type { ProphetForecastResult } from "@/lib/server/prophet-forecast";

type Signal = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell" | "loading" | "no_data";

const SIGNAL_META: Record<Signal, { label: string; color: string; bg: string; border: string }> = {
  strong_buy:  { label: "강력 매수", color: "text-emerald-400", bg: "bg-emerald-500/12", border: "border-emerald-500/30" },
  buy:         { label: "매수",      color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/25"   },
  hold:        { label: "보유",      color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/25"  },
  sell:        { label: "매도",      color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/25"  },
  strong_sell: { label: "강력 매도", color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/25"     },
  loading:     { label: "분석 중",   color: "text-muted-foreground", bg: "bg-muted/30",  border: "border-transparent"    },
  no_data:     { label: "-",         color: "text-muted-foreground/50", bg: "bg-muted/20", border: "border-transparent"  },
};

interface Props {
  prophet:    ProphetForecastResult | null;
  loading?:   boolean;
}

export function AlgorithmSignalCard({ prophet, loading }: Props) {
  const signal: Signal = loading
    ? "loading"
    : !prophet || prophet.insufficient_data
      ? "no_data"
      : (({
          strong_buy: "strong_buy", buy: "buy", hold: "hold",
          sell: "sell", strong_sell: "strong_sell",
        } as Record<string, Signal>)[prophet.recommendation] ?? "hold");

  const m = SIGNAL_META[signal];

  const ret5d  = prophet?.predicted_return_5d  ?? null;
  const ret30d = prophet?.predicted_return_30d ?? null;
  const r2     = prophet?.r_squared            ?? null;
  const atrPct = prophet?.atr_pct              ?? null;
  const trend  = prophet?.trend_direction      ?? null;

  const TREND_LABEL: Record<string, string> = { up: "▲ 상승", down: "▼ 하락", flat: "→ 횡보" };
  const TREND_COLOR: Record<string, string> = { up: "text-green-400", down: "text-red-400", flat: "text-muted-foreground" };

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* 헤더 */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-y-2 border-b"
        style={{ borderColor: "var(--border)" }}>
        <span className="text-sm font-semibold">하이브리드 스태킹 앙상블 신호</span>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${m.bg} ${m.color} ${m.border} ${loading ? "animate-pulse" : ""}`}>
          {m.label}
        </span>
      </div>

      {/* 바디 */}
      <div className="px-4 py-4 space-y-3">
        {/* 예측 수익률 */}
        <div className="flex flex-wrap gap-4">
          {ret5d !== null && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">5일 예측</div>
              <div className={`text-lg font-bold tabular-nums ${ret5d >= 0 ? "text-green-400" : "text-red-400"}`}>
                {ret5d >= 0 ? "+" : ""}{ret5d.toFixed(2)}%
              </div>
            </div>
          )}
          {ret30d !== null && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">30일 예측 (Base)</div>
              <div className={`text-lg font-bold tabular-nums ${ret30d >= 0 ? "text-green-400" : "text-red-400"}`}>
                {ret30d >= 0 ? "+" : ""}{ret30d.toFixed(2)}%
              </div>
            </div>
          )}
          {trend && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">추세 방향</div>
              <div className={`text-lg font-bold ${TREND_COLOR[trend] ?? "text-muted-foreground"}`}>
                {TREND_LABEL[trend] ?? trend}
              </div>
            </div>
          )}
        </div>

        {/* 보조 지표 */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {r2 !== null && (
            <span>모델 적합도(R²) <span className="text-foreground font-medium">{(r2 * 100).toFixed(1)}%</span></span>
          )}
          {atrPct !== null && (
            <span>ATR 변동성 <span className="text-foreground font-medium">{atrPct.toFixed(2)}%</span></span>
          )}
        </div>

        {/* 설명 */}
        <p className="text-xs text-muted-foreground/60 leading-relaxed">
          LinearTrend · Holt DES · MultiEMA 3종 베이스 모델을 OOF 워크-포워드로 Ridge 메타 학습.
          MinMaxScaler 정규화 후 리스크 조정 스코어(수익률÷ATR%)로 최종 신호 산출.
        </p>
      </div>
    </div>
  );
}
