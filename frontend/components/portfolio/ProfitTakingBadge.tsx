"use client";
import { useState } from "react";
import { TrendingUp, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ProfitTakingResult } from "@/lib/server/profit-taking";

interface Props {
  result: ProfitTakingResult;
}

const REC_CONFIG = {
  hold:         { label: "익절불요",   bg: "bg-muted",          text: "text-muted-foreground", border: "border-transparent" },
  watch:        { label: "모니터링",   bg: "bg-yellow-500/15",  text: "text-yellow-400",       border: "border-yellow-500/30" },
  partial_sell: { label: "부분익절",   bg: "bg-orange-500/15",  text: "text-orange-400",       border: "border-orange-500/30" },
  sell:         { label: "익절타점",   bg: "bg-red-500/15",     text: "text-red-400",          border: "border-red-500/30" },
};

export function ProfitTakingBadge({ result }: Props) {
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
        <TrendingUp size={11} />
        <span className="whitespace-nowrap">{cfg.label}</span>
        <span className="tabular-nums opacity-70">{result.triggered_count}/4</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 min-w-[260px] rounded-lg border shadow-xl p-3 space-y-2 text-xs"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">{result.ticker} 익절 시그널</span>
            <span className={`font-bold ${cfg.text}`}>{result.triggered_count}/4</span>
          </div>

          {result.resistance_level != null && (
            <div className="bg-muted/40 rounded px-2 py-1 flex justify-between">
              <span className="text-muted-foreground">저항선</span>
              <span className={`font-semibold tabular-nums ${result.resistance_distance_pct != null && result.resistance_distance_pct <= 2 ? "text-orange-400" : ""}`}>
                {Math.round(result.resistance_level).toLocaleString()}
                {result.resistance_distance_pct != null && ` (${result.resistance_distance_pct.toFixed(1)}%)`}
              </span>
            </div>
          )}

          <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--border)" }}>
            {result.signals.map((sig) => (
              <div key={sig.type} className="flex items-start gap-2">
                {sig.triggered
                  ? <AlertTriangle size={12} className={`shrink-0 mt-0.5 ${sig.severity === "high" ? "text-red-400" : sig.severity === "medium" ? "text-orange-400" : "text-yellow-400"}`} />
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
