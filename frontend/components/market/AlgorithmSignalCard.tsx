"use client";

import type { ProphetForecastResult } from "@/lib/server/prophet-forecast";
import type { TftResult } from "@/app/api/analysis/tft/route";

type Signal = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell" | "loading" | "no_data";

interface AlgoSignal {
  name: string;
  signal: Signal;
  detail: string;
  description?: string;
}

// ── 각 알고리즘 → Signal 변환 ────────────────────────────────────────────────

function fromProphet(r: ProphetForecastResult | null | undefined): AlgoSignal {
  if (!r || r.insufficient_data) return { name: "Prophet", signal: "no_data", detail: "데이터 부족" };
  const map: Record<string, Signal> = {
    strong_buy: "strong_buy", buy: "buy", hold: "hold", sell: "sell", strong_sell: "strong_sell",
  };
  const ret = r.predicted_return_30d;
  return {
    name:        "Prophet",
    signal:      map[r.recommendation] ?? "hold",
    detail:      `30일 예측 ${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%`,
    description: "시계열 분해(추세·계절성·잔차) 기반 30일 가격 예측. Base 시나리오 수익률과 R² 적합도로 판단.",
  };
}

function fromTft(r: TftResult | null | undefined): AlgoSignal {
  if (!r || r.insufficient_data) return { name: "TFT", signal: "no_data", detail: "데이터 부족" };
  const map: Record<string, Signal> = {
    strong_buy: "strong_buy", buy: "buy", hold: "hold", sell: "sell", strong_sell: "strong_sell",
  };
  const score = r.composite_score;

  // 주요 기여 팩터 추출 (상위 2개)
  const topFactors = r.factors
    .slice(0, 2)
    .map(f => `${f.label}(${f.score >= 0 ? "+" : ""}${f.score.toFixed(1)})`)
    .join(", ");

  return {
    name:        "TFT",
    signal:      map[r.signal] ?? "hold",
    detail:      `종합점수 ${score >= 0 ? "+" : ""}${score}점`,
    description: `RSI·MACD·볼린저밴드·거래량·MA교차·모멘텀·변동성 7개 팩터 가중합. -100(강매도)~+100(강매수). 주요: ${topFactors || "분석 중"}`,
  };
}

// ── 신호 메타 ─────────────────────────────────────────────────────────────────

const SIGNAL_META: Record<Signal, { label: string; color: string; bg: string; border: string }> = {
  strong_buy:  { label: "강력 매수", color: "text-emerald-400", bg: "bg-emerald-500/12", border: "border-emerald-500/30" },
  buy:         { label: "매수",      color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/25"   },
  hold:        { label: "보유",      color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/25"  },
  sell:        { label: "매도",      color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/25"  },
  strong_sell: { label: "강력 매도", color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/25"     },
  loading:     { label: "분석 중",   color: "text-muted-foreground", bg: "bg-muted/30",  border: "border-transparent"    },
  no_data:     { label: "-",         color: "text-muted-foreground/50", bg: "bg-muted/20", border: "border-transparent"  },
};

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
  prophet:    ProphetForecastResult | null;
  tft:        TftResult             | null;
  loadingMap: Partial<Record<"prophet" | "tft", boolean>>;
}

export function AlgorithmSignalCard({ prophet, tft, loadingMap }: Props) {
  const algo: AlgoSignal[] = [
    loadingMap.prophet ? { name: "Prophet", signal: "loading", detail: "" } : fromProphet(prophet),
    loadingMap.tft     ? { name: "TFT",     signal: "loading", detail: "" } : fromTft(tft),
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
        <div className="flex items-center gap-3 text-xs">
          <span className="text-green-400 font-medium">{buyCount} 매수</span>
          <span className="text-yellow-400 font-medium">{holdCount} 보유</span>
          <span className="text-red-400 font-medium">{sellCount} 매도</span>
        </div>
      </div>

      {/* 알고리즘별 신호 */}
      <div className="grid grid-cols-2 divide-x" style={{ borderColor: "var(--border)" }}>
        {algo.map((a) => {
          const m = SIGNAL_META[a.signal];
          return (
            <div key={a.name} className="px-4 py-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{a.name}</span>
                <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border whitespace-nowrap ${m.bg} ${m.color} ${m.border} ${a.signal === "loading" ? "animate-pulse" : ""}`}>
                  {m.label}
                </span>
              </div>
              {a.detail && (
                <span className={`text-sm font-medium tabular-nums ${
                  a.signal === "strong_buy" || a.signal === "buy" ? "text-green-400" :
                  a.signal === "sell" || a.signal === "strong_sell" ? "text-red-400" :
                  "text-muted-foreground"
                }`}>
                  {a.detail}
                </span>
              )}
              {a.description && (
                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                  {a.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
