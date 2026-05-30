"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Cpu } from "lucide-react";
import type { TftResult, TftFactor } from "@/app/api/analysis/tft/route";

interface Props {
  result: TftResult | null;
  loading: boolean;
}

const SIGNAL_META = {
  strong_buy:  { label: "강력 매수", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  buy:         { label: "매수",      color: "text-green-400",   bg: "bg-green-500/10 border-green-500/30"   },
  hold:        { label: "관망",      color: "text-yellow-400",  bg: "bg-yellow-500/10 border-yellow-500/30" },
  sell:        { label: "매도",      color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/30" },
  strong_sell: { label: "강력 매도", color: "text-red-400",     bg: "bg-red-500/10 border-red-500/30"       },
} as const;

const CATEGORY_LABEL: Record<TftFactor["category"], string> = {
  past_dynamic: "과거 동적 변수 (Observed Inputs)",
  static:       "정적 변수 (Static Covariates)",
};

function ScoreBar({ score, weight }: { score: number; weight: number }) {
  const pct = Math.abs(score) * 100;
  const isPos = score >= 0;
  return (
    <div className="flex items-center gap-2 flex-1">
      {/* 음수 쪽 (왼쪽) */}
      <div className="flex-1 flex justify-end">
        {!isPos && (
          <div
            className="h-2 rounded-l bg-red-400/70"
            style={{ width: `${pct * weight * 200}%`, maxWidth: "100%" }}
          />
        )}
      </div>
      {/* 중심선 */}
      <div className="w-px h-3 bg-white/20 shrink-0" />
      {/* 양수 쪽 (오른쪽) */}
      <div className="flex-1">
        {isPos && (
          <div
            className="h-2 rounded-r bg-green-400/70"
            style={{ width: `${pct * weight * 200}%`, maxWidth: "100%" }}
          />
        )}
      </div>
    </div>
  );
}

function CompositeGauge({ score }: { score: number }) {
  const clamped = Math.max(-100, Math.min(100, score));
  const pct     = ((clamped + 100) / 200) * 100;
  const color   = clamped >= 30 ? "#34d399" : clamped >= 0 ? "#a3e635" : clamped >= -30 ? "#facc15" : "#f87171";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>매도</span><span>관망</span><span>매수</span>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
        {/* 그라데이션 배경 */}
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(to right, #f87171, #facc15, #34d399)" }}
        />
        {/* 포인터 */}
        <div
          className="absolute top-0 h-full w-1 rounded-full shadow-lg"
          style={{ left: `calc(${pct}% - 2px)`, background: "white" }}
        />
      </div>
      <div className="text-center">
        <span className="text-lg font-bold tabular-nums" style={{ color }}>
          {clamped >= 0 ? "+" : ""}{clamped}
        </span>
        <span className="text-xs text-muted-foreground ml-1">/ 100</span>
      </div>
    </div>
  );
}

export function TftAnalysisCard({ result, loading }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (loading) {
    return (
      <div className="rounded-xl border p-4 space-y-3 animate-pulse"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="h-4 bg-white/5 rounded w-56" />
        <div className="h-32 bg-white/3 rounded" />
      </div>
    );
  }

  if (!result || result.insufficient_data) {
    return (
      <div className="rounded-xl border p-4 text-sm text-muted-foreground"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        TFT 멀티팩터 분석: 데이터 부족 (최소 40거래일 필요)
      </div>
    );
  }

  const meta = SIGNAL_META[result.signal];

  // 카테고리별 그룹화
  const byCategory = (cat: TftFactor["category"]) =>
    result.factors.filter(f => f.category === cat);

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}>

      {/* 헤더 */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3">
          <Cpu size={15} className="text-blue-400" />
          <span className="text-sm font-semibold">TFT 멀티팩터 분석</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${meta.bg} ${meta.color}`}>
            {meta.label}
          </span>
        </div>
        {expanded
          ? <ChevronUp  size={15} className="text-muted-foreground" />
          : <ChevronDown size={15} className="text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">

          {/* 종합 점수 게이지 */}
          <CompositeGauge score={result.composite_score} />

          {/* 변수 중요도 시각화 */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground font-medium mb-2">
              변수 중요도 (Variable Importance)
            </div>

            {(["past_dynamic", "static"] as const).map(cat => {
              const fs = byCategory(cat);
              if (!fs.length) return null;
              return (
                <div key={cat} className="space-y-1 mb-3">
                  <div className="text-xs text-muted-foreground/60 mb-1.5">
                    {CATEGORY_LABEL[cat]}
                  </div>
                  {fs.map(f => (
                    <div key={f.key} className="group">
                      <div className="flex items-center gap-2">
                        {/* 라벨 */}
                        <span className="text-xs w-36 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
                          {f.label}
                        </span>
                        {/* 바 차트 */}
                        <ScoreBar score={f.score} weight={f.weight} />
                        {/* 값 */}
                        <span className={`text-xs tabular-nums w-14 text-right shrink-0 font-medium ${
                          f.score > 0.15 ? "text-green-400" :
                          f.score < -0.15 ? "text-red-400" : "text-muted-foreground"
                        }`}>
                          {f.value}
                        </span>
                      </div>
                      {/* 설명 (hover) */}
                      <div className="text-xs text-muted-foreground/50 ml-36 leading-none mt-0.5 hidden group-hover:block">
                        {f.description}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* 팩터 상세 테이블 */}
          <div className="rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ background: "var(--muted)", borderColor: "var(--border)" }}>
                  {["변수", "현재값", "스코어", "가중치", "기여도"].map(h => (
                    <th key={h} className="text-left text-muted-foreground py-1.5 px-2.5 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.factors.map(f => (
                  <tr key={f.key} className="border-b last:border-0 hover:bg-white/2"
                    style={{ borderColor: "var(--border)" }}>
                    <td className="py-1.5 px-2.5 text-muted-foreground">{f.label}</td>
                    <td className="py-1.5 px-2.5 tabular-nums">{f.value}</td>
                    <td className={`py-1.5 px-2.5 tabular-nums font-medium ${
                      f.score > 0.15 ? "text-green-400" : f.score < -0.15 ? "text-red-400" : "text-muted-foreground"
                    }`}>
                      {f.score >= 0 ? "+" : ""}{f.score.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-2.5 tabular-nums text-muted-foreground">
                      {(f.weight * 100).toFixed(0)}%
                    </td>
                    <td className={`py-1.5 px-2.5 tabular-nums font-medium ${
                      f.contribution > 0.03 ? "text-green-400" : f.contribution < -0.03 ? "text-red-400" : "text-muted-foreground"
                    }`}>
                      {f.contribution >= 0 ? "+" : ""}{(f.contribution * 100).toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground/40">
            TFT 영감 멀티팩터 분석: RSI·MACD·볼린저밴드·거래량·이동평균·모멘텀·변동성의 가중합.
            7개 변수를 과거 동적(Observed) / 정적(Static) 입력으로 분류. 투자 손익 보장 불가.
          </p>
        </div>
      )}
    </div>
  );
}
