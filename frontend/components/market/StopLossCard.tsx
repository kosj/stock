"use client";
import { useState } from "react";
import { ShieldAlert, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatNumber } from "@/lib/utils";
import type { StopLossResult, StopLossSignal } from "@/lib/server/stop-loss-signal";

interface Props {
  result: StopLossResult | null;
  loading?: boolean;
  avgPrice?: number | null;
}

const REC_CONFIG = {
  hold:          { label: "손절 불요",      bar: "bg-emerald-500", bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  caution:       { label: "경계 — 주시",    bar: "bg-yellow-400",  bg: "bg-yellow-500/10",  text: "text-yellow-400",  border: "border-yellow-500/30"  },
  consider_stop: { label: "손절 검토",      bar: "bg-orange-500",  bg: "bg-orange-500/10",  text: "text-orange-400", border: "border-orange-500/30"  },
  stop:          { label: "즉각 손절",      bar: "bg-red-500",     bg: "bg-red-500/10",     text: "text-red-400",    border: "border-red-500/30"     },
};

const SEVERITY_COLOR = {
  high:   "text-red-400",
  medium: "text-orange-400",
  low:    "text-muted-foreground",
};

const SIGNAL_META: Record<string, { icon: string; short: string }> = {
  ma20_breakdown:    { icon: "①", short: "20일선 이탈" },
  bear_volume_spike: { icon: "②", short: "음봉 거래량" },
  sustained_selling: { icon: "③", short: "연속 매도" },
};

function Gauge({ count }: { count: number }) {
  const colors = ["bg-emerald-500", "bg-yellow-400", "bg-orange-500", "bg-red-500"];
  const color = colors[count] ?? "bg-red-600";
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-full ${i < count ? color : "bg-muted"}`}
        />
      ))}
    </div>
  );
}

function SignalRow({ signal }: { signal: StopLossSignal }) {
  const meta = SIGNAL_META[signal.type] ?? { icon: "·", short: signal.label };
  return (
    <div
      className={`rounded-lg border p-3 space-y-1 transition-colors ${
        signal.triggered
          ? signal.severity === "high"
            ? "bg-red-500/8 border-red-500/25"
            : "bg-orange-500/8 border-orange-500/25"
          : "bg-transparent border-transparent"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {signal.triggered
            ? <AlertTriangle size={13} className={`shrink-0 ${SEVERITY_COLOR[signal.severity]}`} />
            : <CheckCircle2  size={13} className="shrink-0 text-emerald-400/50" />
          }
          <span className={`text-xs font-semibold ${signal.triggered ? SEVERITY_COLOR[signal.severity] : "text-muted-foreground"}`}>
            {meta.icon} {signal.label}
          </span>
        </div>
        {signal.triggered && signal.value !== "-" && (
          <span className={`text-xs font-bold tabular-nums ${SEVERITY_COLOR[signal.severity]}`}>
            {signal.value}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug pl-5">{signal.description}</p>

      {/* 상세 수치 */}
      {signal.triggered && signal.detail && (
        <div className="pl-5 flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
          {Object.entries(signal.detail).map(([k, v]) => (
            <span key={k} className="text-[10px] text-muted-foreground">
              <span className="opacity-70">{k}</span>{" "}
              <span className="font-medium tabular-nums">{v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function StopLossCard({ result, loading, avgPrice }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-red-400" />
            손절 시그널 분석
          </CardTitle>
        </CardHeader>
        <div className="py-4 text-center text-muted-foreground text-sm animate-pulse">분석 중…</div>
      </Card>
    );
  }

  if (!result || result.insufficient_data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-red-400" />
            손절 시그널 분석
          </CardTitle>
        </CardHeader>
        <div className="py-4 text-center text-muted-foreground text-sm">
          {result?.insufficient_data ? "데이터 부족" : "데이터 없음"}
        </div>
      </Card>
    );
  }

  const cfg = REC_CONFIG[result.recommendation];
  const triggered = result.signals.filter((s) => s.triggered);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert size={15} className="text-red-400" />
          손절 시그널 분석
        </CardTitle>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? "접기" : "상세 보기"}
        </button>
      </CardHeader>

      {/* 요약 헤더 */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border flex-1 ${cfg.bg} ${cfg.border}`}>
          <div>
            <div className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{result.triggered_count}/3 시그널 발동</div>
          </div>
          <div className="flex-1 min-w-[80px]">
            <Gauge count={result.triggered_count} />
          </div>
        </div>

        {/* MA20 수치 패널 */}
        {result.ma20 != null && result.ma20_distance_pct != null && (
          <div className="text-right shrink-0">
            <div className="text-[10px] text-muted-foreground">20일선</div>
            <div className="text-sm font-semibold tabular-nums">{formatNumber(result.ma20)}</div>
            <div
              className={`text-[11px] font-semibold tabular-nums ${
                result.ma20_distance_pct <= -2
                  ? "text-red-400"
                  : result.ma20_distance_pct <= 0
                  ? "text-yellow-400"
                  : "text-emerald-400"
              }`}
            >
              {result.ma20_distance_pct > 0 ? "+" : ""}{result.ma20_distance_pct.toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {/* 핵심 지표 그리드 */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {/* MA20 이격 */}
        <div className="bg-muted/40 rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground mb-0.5">20일선 이격</div>
          <div
            className={`text-sm font-bold tabular-nums ${
              result.ma20_distance_pct != null && result.ma20_distance_pct <= -2
                ? "text-red-400"
                : result.ma20_distance_pct != null && result.ma20_distance_pct <= 0
                ? "text-yellow-400"
                : "text-emerald-400"
            }`}
          >
            {result.ma20_distance_pct != null
              ? `${result.ma20_distance_pct > 0 ? "+" : ""}${result.ma20_distance_pct.toFixed(1)}%`
              : "—"}
          </div>
        </div>

        {/* 음봉 거래량 비율 */}
        <div className="bg-muted/40 rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground mb-0.5">음봉 거래량</div>
          <div
            className={`text-sm font-bold tabular-nums ${
              result.max_volume_ratio != null && result.max_volume_ratio >= 2
                ? "text-red-400"
                : result.max_volume_ratio != null && result.max_volume_ratio >= 1.5
                ? "text-yellow-400"
                : "text-muted-foreground"
            }`}
          >
            {result.max_volume_ratio != null ? `${result.max_volume_ratio.toFixed(1)}배` : "—"}
          </div>
        </div>

        {/* 연속 하락일 */}
        <div className="bg-muted/40 rounded-lg p-2 text-center">
          <div className="text-[10px] text-muted-foreground mb-0.5">연속 하락</div>
          <div
            className={`text-sm font-bold tabular-nums ${
              result.consecutive_down_days >= 3
                ? "text-red-400"
                : result.consecutive_down_days >= 2
                ? "text-yellow-400"
                : "text-muted-foreground"
            }`}
          >
            {result.consecutive_down_days > 0 ? `${result.consecutive_down_days}일` : "—"}
          </div>
        </div>
      </div>

      {/* 평균단가 대비 MA20 위치 (보유 포지션 있을 때) */}
      {avgPrice != null && result.ma20 != null && (
        <div
          className="mb-4 px-3 py-2 rounded-lg text-xs flex items-center justify-between"
          style={{ background: "var(--muted)", opacity: 0.85 }}
        >
          <span className="text-muted-foreground">
            평단({formatNumber(avgPrice)}) 대비 20일선
          </span>
          <span
            className={`font-semibold tabular-nums ${
              result.ma20 < avgPrice ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {result.ma20 >= avgPrice ? "+" : ""}
            {(((result.ma20 - avgPrice) / avgPrice) * 100).toFixed(1)}%
            {result.ma20 < avgPrice && " — 20일선이 평단 하향"}
          </span>
        </div>
      )}

      {/* 트리거된 시그널 (접힌 상태 빠른 요약) */}
      {triggered.length > 0 && !expanded && (
        <div className="space-y-1.5 mb-1">
          {triggered.map((sig) => (
            <div
              key={sig.type}
              className={`text-xs px-2.5 py-1.5 rounded flex items-center gap-1.5 ${
                sig.severity === "high"
                  ? "bg-red-500/10 text-red-400"
                  : "bg-orange-500/10 text-orange-400"
              }`}
            >
              <AlertTriangle size={11} />
              <span className="font-medium">{sig.label}</span>
              {sig.value !== "-" && <span className="opacity-70 tabular-nums ml-auto">{sig.value}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 비트리거 요약 (접힌 상태, 이상 없을 때) */}
      {triggered.length === 0 && !expanded && (
        <div className="text-xs text-muted-foreground text-center py-1">{result.summary}</div>
      )}

      {/* 상세 조건 목록 (펼침) */}
      {expanded && (
        <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-2">
            3개 조건 상세
          </div>
          {result.signals.map((sig) => (
            <SignalRow key={sig.type} signal={sig} />
          ))}
          <div
            className="text-[10px] text-muted-foreground/50 pt-2 border-t"
            style={{ borderColor: "var(--border)" }}
          >
            ※ 연속 매도 시그널은 가격·거래량 패턴 기반 — 실제 외국인/기관 데이터 반영 아님
          </div>
        </div>
      )}
    </Card>
  );
}
