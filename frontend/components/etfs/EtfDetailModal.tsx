"use client";

/**
 * EtfDetailModal — ETF 종목 터치 시 표시되는 상세 시트
 *
 * 구성: 시세 요약 → 캔들 차트(손절/익절 라인 표시) → ATR 기반 진입·리스크 레벨
 *       → 계좌별(연금/IRP/ISA) 편입 가능 여부
 * 데이터: /api/etfs/[ticker] (메타+진입타점), /api/market/chart/[ticker] (캔들·지표)
 *
 * ※ 표시되는 진입/손절 수치는 과거 가격 기반 기술적 레벨이며 투자 권유가 아님.
 */

import { useState } from "react";
import useSWR from "swr";
import { X, Info, TrendingUp, TrendingDown } from "lucide-react";
import { StockChart } from "@/components/charts/StockChart";
import { colorByChange, formatPercent } from "@/lib/utils";

const PERIODS = ["3m", "6m", "1y"] as const;
type ChartPeriod = (typeof PERIODS)[number];
const PERIOD_LABEL: Record<ChartPeriod, string> = { "3m": "3개월", "6m": "6개월", "1y": "1년" };

const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  buy_zone:   { text: "분할매수권", cls: "bg-green-500/15 text-green-400" },
  watch:      { text: "눌림 대기",  cls: "bg-blue-500/15 text-blue-400" },
  overbought: { text: "과열·관망",  cls: "bg-amber-500/15 text-amber-400" },
  weak:       { text: "진입 보류",  cls: "bg-red-500/15 text-red-400" },
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const won = (v: number | null | undefined) => (v != null ? v.toLocaleString() + "원" : "—");

export function EtfDetailModal({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [period, setPeriod] = useState<ChartPeriod>("6m");

  const { data: detail, isLoading } = useSWR(`/api/etfs/${ticker}`, fetcher, {
    revalidateOnFocus: false,
  });
  const { data: chart, isLoading: chartLoading } = useSWR(
    `/api/market/chart/${ticker}?period=${period}`, fetcher, { revalidateOnFocus: false },
  );

  const meta  = detail?.meta;
  const entry = detail?.entry;
  const st    = STATE_LABEL[entry?.state ?? "weak"] ?? STATE_LABEL.weak;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* 배경 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* 시트 */}
      <div
        className="relative w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        {/* 헤더 */}
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 border-b"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="min-w-0">
            <h2 className="text-base font-bold truncate">{meta?.name ?? ticker}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ticker}
              {meta?.category ? ` · ${meta.category}` : ""}
              {meta?.safeType ? ` · 안전자산(${meta.safeType})` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 shrink-0" aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 시세 요약 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="현재가" value={won(meta?.price ?? entry?.currentPrice)} />
            <Stat
              label="1일 등락"
              value={meta?.return1D != null ? formatPercent(meta.return1D) : "—"}
              cls={meta?.return1D != null ? colorByChange(meta.return1D) : ""}
            />
            <Stat
              label="3개월 수익률"
              value={meta?.return3M != null ? formatPercent(meta.return3M) : "—"}
              cls={meta?.return3M != null ? colorByChange(meta.return3M) : ""}
            />
            <Stat
              label="시가총액"
              value={meta?.marketCapEok ? `${meta.marketCapEok.toLocaleString()}억` : "—"}
            />
          </div>

          {/* 차트 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">가격 차트</span>
              <div className="flex gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      period === p ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-white/5"
                    }`}
                  >
                    {PERIOD_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>

            {chartLoading ? (
              <div className="h-[320px] rounded animate-pulse bg-muted" />
            ) : chart?.candles?.length ? (
              <StockChart
                candles={chart.candles}
                indicators={chart.indicators}
                stopLoss={entry?.stopLoss ?? undefined}
                takeProfit={entry?.takeProfit ?? undefined}
                height={320}
              />
            ) : (
              <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
                차트 데이터 없음
              </div>
            )}
          </div>

          {/* 진입·리스크 레벨 */}
          <div className="rounded-lg p-3" style={{ background: "var(--background)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">진입·리스크 레벨 (ATR 적응형)</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${st.cls}`}>{st.text}</span>
            </div>

            {isLoading ? (
              <div className="h-20 rounded animate-pulse bg-muted" />
            ) : entry && !entry.insufficient_data ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Stat
                    label="분할매수 밴드"
                    value={entry.entryLow != null && entry.entryHigh != null
                      ? `${entry.entryLow.toLocaleString()}~${entry.entryHigh.toLocaleString()}`
                      : "—"}
                  />
                  <Stat
                    label="손절"
                    value={won(entry.stopLoss)}
                    sub={entry.stopLossPct != null ? `${entry.stopLossPct.toFixed(1)}%` : undefined}
                    cls="text-red-400"
                  />
                  <Stat label="익절 목표" value={won(entry.takeProfit)} cls="text-green-400" />
                  <Stat
                    label="손익비"
                    value={entry.riskReward != null ? `${entry.riskReward.toFixed(1)} : 1` : "—"}
                    sub={entry.riskReward != null && entry.riskReward >= 2 ? "양호" : undefined}
                  />
                  <Stat label="변동성(ATR)" value={entry.atrPct != null ? `${entry.atrPct}%` : "—"} />
                  <Stat label="트레일링 스탑" value={won(entry.trailingStop)} />
                  <Stat label="1차 지지" value={won(entry.supportPrimary)} />
                  <Stat label="RSI" value={entry.rsi != null ? entry.rsi.toFixed(0) : "—"} />
                </div>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{entry.note}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">분석에 필요한 시세 데이터가 부족합니다.</p>
            )}
          </div>

          {/* 계좌별 편입 가능 여부 */}
          {detail?.accounts?.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: "var(--background)" }}>
              <span className="text-sm font-medium">계좌별 편입 가능</span>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {detail.accounts.map((a: { account: string; label: string; eligible: boolean; reason: string | null }) => (
                  <div key={a.account} className="rounded p-2 text-center" style={{ background: "var(--card)" }}>
                    <div className="text-xs text-muted-foreground mb-1">{a.label}</div>
                    <div className={`text-xs font-semibold flex items-center justify-center gap-1 ${
                      a.eligible ? "text-green-400" : "text-red-400"}`}>
                      {a.eligible ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {a.eligible ? "가능" : "불가"}
                    </div>
                    {a.reason && (
                      <div className="text-[10px] text-muted-foreground/70 mt-1 leading-tight">{a.reason}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-start gap-1.5 text-xs text-muted-foreground/70">
            <Info size={12} className="mt-0.5 shrink-0" />
            진입·손절 수치는 과거 가격과 변동성(ATR)으로 계산한 기술적 레벨이며,
            미래 수익을 보장하거나 매매를 권유하지 않습니다.
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, cls = "" }: {
  label: string; value: string; sub?: string; cls?: string;
}) {
  return (
    <div className="rounded p-2" style={{ background: "var(--card)" }}>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}
