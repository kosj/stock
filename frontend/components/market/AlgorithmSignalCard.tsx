"use client";

import type { PullbackResult } from "@/lib/server/pullback-analysis";
import type { StopLossResult } from "@/lib/server/stop-loss-signal";
import type { ProfitTakingResult } from "@/lib/server/profit-taking";
import type { ProphetForecastResult } from "@/lib/server/prophet-forecast";
import type { TftResult } from "@/app/api/analysis/tft/route";

type Signal = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell" | "loading" | "no_data";

interface AlgoSignal {
  name: string;
  signal: Signal;
  detail: string;
}

// ── 각 알고리즘 → Signal 변환 ────────────────────────────────────────────────

function fromPullback(r: PullbackResult | null | undefined): AlgoSignal {
  if (!r || r.insufficient_data) return { name: "눌림목", signal: "no_data", detail: "데이터 부족" };
  const map: Record<string, Signal> = { strong: "buy", moderate: "buy", weak: "hold", none: "hold" };
  const detail: Record<string, string> = {
    strong: "강한 눌림목 패턴", moderate: "눌림목 탐지", weak: "약한 신호", none: "패턴 없음",
  };
  return { name: "눌림목", signal: map[r.signal] ?? "hold", detail: detail[r.signal] ?? "" };
}

function fromStopLoss(r: StopLossResult | null | undefined): AlgoSignal {
  if (!r) return { name: "손절신호", signal: "no_data", detail: "데이터 부족" };
  const map: Record<string, Signal> = { hold: "hold", caution: "hold", consider_stop: "sell", stop: "strong_sell" };
  return { name: "손절신호", signal: map[r.recommendation] ?? "hold", detail: r.summary ?? "" };
}

function fromProfitTaking(r: ProfitTakingResult | null | undefined): AlgoSignal {
  if (!r) return { name: "익절신호", signal: "no_data", detail: "데이터 부족" };
  const map: Record<string, Signal> = { hold: "hold", watch: "hold", partial_sell: "sell", sell: "strong_sell" };
  return { name: "익절신호", signal: map[r.recommendation] ?? "hold", detail: r.summary ?? "" };
}

function fromProphet(r: ProphetForecastResult | null | undefined): AlgoSignal {
  if (!r || r.insufficient_data) return { name: "Prophet", signal: "no_data", detail: "데이터 부족" };
  const map: Record<string, Signal> = {
    strong_buy: "strong_buy", buy: "buy", hold: "hold", sell: "sell", strong_sell: "strong_sell",
  };
  const ret = r.predicted_return_30d;
  return {
    name:   "Prophet",
    signal: map[r.recommendation] ?? "hold",
    detail: `30일 예측 ${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%`,
  };
}

function fromTft(r: TftResult | null | undefined): AlgoSignal {
  if (!r || r.insufficient_data) return { name: "TFT", signal: "no_data", detail: "데이터 부족" };
  const map: Record<string, Signal> = {
    strong_buy: "strong_buy", buy: "buy", hold: "hold", sell: "sell", strong_sell: "strong_sell",
  };
  return {
    name:   "TFT",
    signal: map[r.signal] ?? "hold",
    detail: `종합점수 ${r.composite_score >= 0 ? "+" : ""}${r.composite_score}`,
  };
}

// ── 신호 메타 ─────────────────────────────────────────────────────────────────

const SIGNAL_META: Record<Signal, { label: string; short: string; color: string; bg: string; border: string }> = {
  strong_buy:  { label: "강력 매수", short: "강력 매수", color: "text-emerald-400", bg: "bg-emerald-500/12", border: "border-emerald-500/30" },
  buy:         { label: "매수",      short: "매수",     color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/25"   },
  hold:        { label: "보유",      short: "보유",     color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/25"  },
  sell:        { label: "매도",      short: "매도",     color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/25"  },
  strong_sell: { label: "강력 매도", short: "강력 매도",color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/25"     },
  loading:     { label: "분석 중",   short: "분석 중",  color: "text-muted-foreground", bg: "bg-muted/30", border: "border-transparent"    },
  no_data:     { label: "데이터 없음",short: "-",        color: "text-muted-foreground/50", bg: "bg-muted/20", border: "border-transparent" },
};

// ── 종합 판단 ─────────────────────────────────────────────────────────────────

const SCORE: Record<Signal, number> = {
  strong_buy: 2, buy: 1, hold: 0, sell: -1, strong_sell: -2, loading: 0, no_data: 0,
};

function calcOverall(signals: AlgoSignal[]): Signal {
  const valid = signals.filter(s => s.signal !== "loading" && s.signal !== "no_data");
  if (!valid.length) return "no_data";
  const avg = valid.reduce((s, a) => s + SCORE[a.signal], 0) / valid.length;
  if (avg >= 1.2)  return "strong_buy";
  if (avg >= 0.4)  return "buy";
  if (avg >= -0.4) return "hold";
  if (avg >= -1.2) return "sell";
  return "strong_sell";
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

interface Props {
  pullback:     PullbackResult     | null;
  stopLoss:     StopLossResult     | null;
  profitTaking: ProfitTakingResult | null;
  prophet:      ProphetForecastResult | null;
  tft:          TftResult          | null;
  loadingMap:   Partial<Record<"pullback" | "stopLoss" | "profitTaking" | "prophet" | "tft", boolean>>;
}

export function AlgorithmSignalCard({ pullback, stopLoss, profitTaking, prophet, tft, loadingMap }: Props) {
  const algo: AlgoSignal[] = [
    loadingMap.prophet     ? { name: "Prophet",  signal: "loading", detail: "" } : fromProphet(prophet),
    loadingMap.tft         ? { name: "TFT",       signal: "loading", detail: "" } : fromTft(tft),
    loadingMap.pullback    ? { name: "눌림목",    signal: "loading", detail: "" } : fromPullback(pullback),
    loadingMap.stopLoss    ? { name: "손절신호",  signal: "loading", detail: "" } : fromStopLoss(stopLoss),
    loadingMap.profitTaking? { name: "익절신호",  signal: "loading", detail: "" } : fromProfitTaking(profitTaking),
  ];

  const overall = calcOverall(algo);
  const om      = SIGNAL_META[overall];

  const buyCount  = algo.filter(a => a.signal === "buy" || a.signal === "strong_buy").length;
  const holdCount = algo.filter(a => a.signal === "hold").length;
  const sellCount = algo.filter(a => a.signal === "sell" || a.signal === "strong_sell").length;

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* 헤더 — 종합 판단 */}
      <div className="px-4 py-3 flex items-center justify-between border-b"
        style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">알고리즘 종합 신호</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${om.bg} ${om.color} ${om.border}`}>
            {om.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="text-green-400 font-medium">{buyCount} 매수</span>
          <span className="text-yellow-400 font-medium">{holdCount} 보유</span>
          <span className="text-red-400 font-medium">{sellCount} 매도</span>
        </div>
      </div>

      {/* 알고리즘별 신호 그리드 */}
      <div className="grid grid-cols-5 divide-x" style={{ borderColor: "var(--border)" }}>
        {algo.map((a) => {
          const m = SIGNAL_META[a.signal];
          return (
            <div key={a.name} className="px-3 py-3 flex flex-col items-center gap-1.5 text-center">
              <span className="text-xs text-muted-foreground font-medium">{a.name}</span>
              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap ${m.bg} ${m.color} ${m.border} ${a.signal === "loading" ? "animate-pulse" : ""}`}>
                {m.short}
              </span>
              {a.detail && (
                <span className="text-[10px] text-muted-foreground/60 leading-tight">{a.detail}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
