"use client";
import { useState } from "react";
import { ShieldAlert, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { StopLossResult } from "@/lib/server/stop-loss-signal";

interface Props {
  result: StopLossResult;
}

const REC_CONFIG = {
  hold:          { label: "정상",     bg: "bg-muted",          text: "text-muted-foreground", border: "border-transparent"     },
  caution:       { label: "경계",     bg: "bg-yellow-500/15",  text: "text-yellow-400",       border: "border-yellow-500/30"   },
  consider_stop: { label: "손절검토", bg: "bg-orange-500/15",  text: "text-orange-400",       border: "border-orange-500/30"   },
  stop:          { label: "즉각손절", bg: "bg-red-500/15",     text: "text-red-400",          border: "border-red-500/30"      },
};

export function StopLossBadge({ result }: Props) {
  const [open, setOpen] = useState(false);

  if (result.insufficient_data) {
    return <span className="text-xs text-muted-foreground/40 whitespace-nowrap">데이터 부족</span>;
  }

  const cfg = REC_CONFIG[result.recommendation];

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium transition-colors ${cfg.bg} ${cfg.text} ${cfg.border}`}
      >
        <ShieldAlert size={11} />
        <span className="whitespace-nowrap">{cfg.label}</span>
        <span className="tabular-nums opacity-70">{result.triggered_count}/3</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 min-w-[280px] rounded-lg border shadow-xl p-3 space-y-2 text-xs whitespace-normal"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">{result.ticker} 손절 시그널</span>
            <span className={`font-bold ${cfg.text}`}>{result.triggered_count}/3</span>
          </div>

          {/* 핵심 수치 */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
              <div className="text-muted-foreground text-[10px]">20일선</div>
              <div className={`font-bold tabular-nums ${result.ma20_distance_pct != null && result.ma20_distance_pct <= -2 ? "text-red-400" : result.ma20_distance_pct != null && result.ma20_distance_pct <= 0 ? "text-yellow-400" : "text-emerald-400"}`}>
                {result.ma20_distance_pct != null ? `${result.ma20_distance_pct > 0 ? "+" : ""}${result.ma20_distance_pct.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
              <div className="text-muted-foreground text-[10px]">음봉거래량</div>
              <div className={`font-bold tabular-nums ${result.max_volume_ratio != null && result.max_volume_ratio >= 2 ? "text-red-400" : "text-muted-foreground"}`}>
                {result.max_volume_ratio != null ? `${result.max_volume_ratio.toFixed(1)}배` : "—"}
              </div>
            </div>
            <div className="bg-muted/40 rounded px-2 py-1.5 text-center">
              <div className="text-muted-foreground text-[10px]">연속하락</div>
              <div className={`font-bold tabular-nums ${result.consecutive_down_days >= 3 ? "text-red-400" : result.consecutive_down_days >= 2 ? "text-yellow-400" : "text-muted-foreground"}`}>
                {result.consecutive_down_days > 0 ? `${result.consecutive_down_days}일` : "—"}
              </div>
            </div>
          </div>

          {/* 시그널 목록 */}
          <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            {result.signals.map((sig) => (
              <div key={sig.type} className="flex items-start gap-2">
                {sig.triggered
                  ? <AlertTriangle size={12} className={`shrink-0 mt-0.5 ${sig.severity === "high" ? "text-red-400" : "text-orange-400"}`} />
                  : <CheckCircle2  size={12} className="shrink-0 mt-0.5 text-muted-foreground/30" />
                }
                <div>
                  <span className={`font-medium ${sig.triggered ? cfg.text : "text-muted-foreground"}`}>
                    {sig.label}
                  </span>
                  {sig.triggered && sig.value !== "-" && (
                    <span className="ml-1 opacity-70 tabular-nums">{sig.value}</span>
                  )}
                  <div className="text-[10px] text-muted-foreground leading-snug">{sig.description}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t pt-1.5 text-[10px] text-muted-foreground" style={{ borderColor: "var(--border)" }}>
            {result.summary}
          </div>
        </div>
      )}
    </div>
  );
}
