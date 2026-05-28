"use client";
import { useState } from "react";
import { TrendingUp, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import type { ProfitTakingResult, ProfitTakingSignal } from "@/lib/server/profit-taking";

interface Props {
  result: ProfitTakingResult | null;
  loading?: boolean;
}

const RECOMMENDATION_CONFIG = {
  hold:         { label: "익절 불필요",     bg: "bg-muted",             text: "text-muted-foreground", border: "border-transparent" },
  watch:        { label: "모니터링",        bg: "bg-yellow-500/10",     text: "text-yellow-400",       border: "border-yellow-500/30" },
  partial_sell: { label: "부분 익절 검토",  bg: "bg-orange-500/10",     text: "text-orange-400",       border: "border-orange-500/30" },
  sell:         { label: "익절 타점",       bg: "bg-red-500/10",        text: "text-red-400",          border: "border-red-500/30" },
};

const SEVERITY_COLOR = {
  high:   "text-red-400",
  medium: "text-orange-400",
  low:    "text-muted-foreground",
};

const SIGNAL_LABELS: Record<string, { icon: string; desc: string }> = {
  resistance_proximity: { icon: "①", desc: "전고점 이격도" },
  overbought:          { icon: "②", desc: "과매수 지표" },
  divergence:          { icon: "③", desc: "베어리쉬 다이버전스" },
  upper_wick:          { icon: "④", desc: "윗꼬리 캔들" },
};

function SignalRow({ signal }: { signal: ProfitTakingSignal }) {
  const meta = SIGNAL_LABELS[signal.type] ?? { icon: "·", desc: signal.label };
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
      {signal.triggered
        ? <AlertTriangle size={13} className={`shrink-0 mt-0.5 ${SEVERITY_COLOR[signal.severity]}`} />
        : <CheckCircle2  size={13} className="shrink-0 mt-0.5 text-emerald-400/50" />
      }
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs font-medium ${signal.triggered ? SEVERITY_COLOR[signal.severity] : "text-muted-foreground"}`}>
            {meta.icon} {meta.desc}
          </span>
          {signal.triggered && signal.value !== "-" && (
            <span className={`text-xs tabular-nums font-semibold ${SEVERITY_COLOR[signal.severity]}`}>
              {signal.value}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
          {signal.description}
        </div>
      </div>
    </div>
  );
}

export function ProfitTakingCard({ result, loading }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp size={15} className="text-orange-400" />
            익절 시그널 분석
          </CardTitle>
        </CardHeader>
        <div className="py-4 text-center text-muted-foreground text-sm animate-pulse">
          분석 중…
        </div>
      </Card>
    );
  }

  if (!result || result.insufficient_data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp size={15} className="text-orange-400" />
            익절 시그널 분석
          </CardTitle>
        </CardHeader>
        <div className="py-4 text-center text-muted-foreground text-sm">
          {result?.insufficient_data ? "데이터 부족 — 분석 불가" : "데이터 없음"}
        </div>
      </Card>
    );
  }

  const cfg = RECOMMENDATION_CONFIG[result.recommendation];
  const triggeredSignals = result.signals.filter((s) => s.triggered);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp size={15} className="text-orange-400" />
          익절 시그널 분석
        </CardTitle>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "접기" : "상세"}
        </button>
      </CardHeader>

      {/* 상단 요약 */}
      <div className="flex items-center justify-between gap-4 mb-3">
        {/* 추천 배지 */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${cfg.bg} ${cfg.border}`}>
          <span className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</span>
          <span className="text-xs text-muted-foreground">
            {result.triggered_count}/4 시그널
          </span>
        </div>

        {/* 저항선 표시 */}
        {result.resistance_level != null && result.resistance_distance_pct != null && (
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">저항선</div>
            <div className="text-sm font-semibold tabular-nums">
              {Math.round(result.resistance_level).toLocaleString()}
            </div>
            <div className={`text-[10px] tabular-nums ${result.resistance_distance_pct <= 2 ? "text-orange-400 font-semibold" : "text-muted-foreground"}`}>
              {result.resistance_distance_pct <= 2 ? "⚠ " : ""}{result.resistance_distance_pct.toFixed(1)}% 이내
            </div>
          </div>
        )}
      </div>

      {/* 시그널 점수 바 */}
      <div className="mb-3">
        <div className="flex gap-1">
          {result.signals.map((sig) => (
            <div
              key={sig.type}
              className={`flex-1 h-2 rounded-full transition-all ${
                sig.triggered
                  ? sig.severity === "high"   ? "bg-red-500"
                  : sig.severity === "medium" ? "bg-orange-400"
                  : "bg-yellow-400"
                  : "bg-muted"
              }`}
              title={sig.label}
            />
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">{result.summary}</div>
      </div>

      {/* 트리거된 시그널 요약 (접힌 상태에서도 표시) */}
      {triggeredSignals.length > 0 && !expanded && (
        <div className="space-y-1 mb-1">
          {triggeredSignals.map((sig) => (
            <div
              key={sig.type}
              className={`text-xs px-2 py-1 rounded flex items-center gap-1.5 ${
                sig.severity === "high"   ? "bg-red-500/10 text-red-400" :
                sig.severity === "medium" ? "bg-orange-500/10 text-orange-400" :
                "bg-yellow-500/10 text-yellow-400"
              }`}
            >
              <AlertTriangle size={11} />
              <span className="font-medium">{sig.label}</span>
              {sig.value !== "-" && <span className="opacity-70 tabular-nums">{sig.value}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 상세 신호 목록 (펼침 시) */}
      {expanded && (
        <div className="border-t pt-3 space-y-0" style={{ borderColor: "var(--border)" }}>
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-2">
            4개 조건 체크
          </div>
          {result.signals.map((sig) => (
            <SignalRow key={sig.type} signal={sig} />
          ))}
        </div>
      )}
    </Card>
  );
}
