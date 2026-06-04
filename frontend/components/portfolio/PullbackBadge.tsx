"use client";
import { useState } from "react";
import { TrendingDown, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";
import type { PullbackResult } from "@/lib/server/pullback-analysis";

interface Props {
  result: PullbackResult;
}

const SIGNAL_CONFIG = {
  strong:   { label: "강한 눌림목", bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  moderate: { label: "눌림목 탐지", bg: "bg-blue-500/15",    text: "text-blue-400",    border: "border-blue-500/30"    },
  weak:     { label: "약한 신호",   bg: "bg-yellow-500/15",  text: "text-yellow-400",  border: "border-yellow-500/30"  },
  none:     { label: "신호 없음",   bg: "bg-muted",           text: "text-muted-foreground", border: "border-transparent" },
};

export function PullbackBadge({ result }: Props) {
  const [open, setOpen] = useState(false);
  const cfg = SIGNAL_CONFIG[result.signal];

  if (result.insufficient_data) {
    return (
      <span className="text-xs text-muted-foreground/40 whitespace-nowrap">데이터 부족</span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium transition-colors ${cfg.bg} ${cfg.text} ${cfg.border}`}
      >
        <TrendingDown size={11} />
        <span className="whitespace-nowrap">{cfg.label}</span>
        <span className="tabular-nums opacity-70">{result.score}</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 min-w-[280px] rounded-lg border shadow-xl p-3 space-y-2.5 text-xs whitespace-normal"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">{result.ticker} 눌림목 분석</span>
            <span className={`font-bold ${cfg.text}`}>{result.score}점</span>
          </div>

          {/* 핵심 지표 */}
          <div className="grid grid-cols-2 gap-1.5">
            {result.ma20 != null && (
              <div className="bg-muted/40 rounded px-2 py-1">
                <div className="text-muted-foreground">20일선 이격</div>
                <div className={`font-bold ${result.ma20_distance_pct != null && result.ma20_distance_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {result.ma20_distance_pct != null ? `${result.ma20_distance_pct > 0 ? "+" : ""}${result.ma20_distance_pct.toFixed(1)}%` : "—"}
                </div>
              </div>
            )}
            {result.rsi != null && (
              <div className="bg-muted/40 rounded px-2 py-1">
                <div className="text-muted-foreground">RSI</div>
                <div className={`font-bold ${result.rsi >= 35 && result.rsi <= 60 ? "text-blue-400" : result.rsi < 35 ? "text-emerald-400" : "text-yellow-400"}`}>
                  {result.rsi.toFixed(1)}
                </div>
              </div>
            )}
            {result.volume_surge_ratio != null && (
              <div className="bg-muted/40 rounded px-2 py-1">
                <div className="text-muted-foreground">기준봉 거래량</div>
                <div className="font-bold text-yellow-400">{result.volume_surge_ratio.toFixed(1)}배</div>
              </div>
            )}
            {result.volume_decline_ratio != null && (
              <div className="bg-muted/40 rounded px-2 py-1">
                <div className="text-muted-foreground">현재 거래량</div>
                <div className={`font-bold ${result.volume_decline_ratio <= 30 ? "text-emerald-400" : "text-yellow-400"}`}>
                  {result.volume_decline_ratio.toFixed(0)}%
                </div>
              </div>
            )}
          </div>

          {/* 4단계 필터 */}
          <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            {result.stages.map((s) => (
              <div key={s.stage} className="flex items-start gap-2">
                {s.pass
                  ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <XCircle     size={13} className="text-muted-foreground/40 shrink-0 mt-0.5" />
                }
                <div className="min-w-0">
                  <span className={`font-medium ${s.pass ? "" : "text-muted-foreground"}`}>
                    {s.stage}단계 {s.label}
                  </span>
                  <div className="text-muted-foreground text-[10px] leading-snug mt-0.5">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>

          {result.obv_divergence && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1 text-emerald-400">
              OBV 다이버전스 감지 — 매집 가능성
            </div>
          )}
        </div>
      )}
    </div>
  );
}
