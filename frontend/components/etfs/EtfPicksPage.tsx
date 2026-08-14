"use client";

/**
 * EtfPicksPage — 계좌 유형별 추천 ETF + 매매 정보
 *
 * 퇴직연금(제도상 편입 가능 종목만) / 일반 주식계좌(전체 유니버스) 탭으로
 * 수익률 상위 ETF를 보여주고, 각 종목의 매매에 필요한 정보(진입 밴드·손절·
 * 익절·손익비·변동성·전고점 낙폭)를 함께 표시한다.
 * 데이터: GET /api/etfs/account-picks?account=pension|stock (ATR 진입타점 포함)
 * 종목 터치 → EtfDetailModal(차트·계좌별 편입 가부).
 *
 * ※ 수익률 모멘텀 기반 정량 선별이며 투자 권유가 아니다.
 */

import { useState } from "react";
import useSWR from "swr";
import { Target, RefreshCw, Info, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EtfDetailModal } from "./EtfDetailModal";
import { colorByChange, formatPercent } from "@/lib/utils";

const TABS = [
  { key: "pension", label: "퇴직연금(DC·IRP)" },
  { key: "stock",   label: "일반 주식계좌" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const PERIODS = ["1M", "3M", "6M"] as const;
type Period = (typeof PERIODS)[number];

const STATE_BADGE: Record<string, { text: string; cls: string }> = {
  buy_zone:   { text: "분할매수권", cls: "bg-green-500/15 text-green-400" },
  watch:      { text: "눌림 대기",  cls: "bg-blue-500/15 text-blue-400" },
  overbought: { text: "과열·관망",  cls: "bg-amber-500/15 text-amber-400" },
  weak:       { text: "진입 보류",  cls: "bg-red-500/15 text-red-400" },
};

interface Entry {
  currentPrice: number;
  entryLow: number | null; entryHigh: number | null;
  stopLoss: number | null; stopLossPct: number | null;
  takeProfit: number | null; riskReward: number | null;
  atrPct: number | null; trailingStop: number | null;
  rsi: number | null; state: string; note: string;
  insufficient_data?: boolean;
}

interface PickRow {
  rank: number; ticker: string; name: string; category: string;
  price: number; sortReturn: number;
  safeType?: string | null;
  annVolPct?: number; blendScore?: number;
  leveraged?: boolean; inverse?: boolean; derivative?: boolean;
  drawdownPct?: number | null;
  entry: Entry | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const won = (v: number | null | undefined) => (v != null ? v.toLocaleString() + "원" : "—");

export function EtfPicksPage() {
  const [tab, setTab]       = useState<TabKey>("pension");
  const [period, setPeriod] = useState<Period>("3M");
  const [openTicker, setOpenTicker] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR(
    `/api/etfs/account-picks?account=${tab}&period=${period}&limit=10`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1_800_000 },
  );
  const picks: PickRow[] = data?.picks ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Target size={18} className="text-blue-400" /> ETF 추천
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            모멘텀 + 변동성 조정 혼합 순위 · 매매 참고 정보(진입·손절·익절)
            {data?.universe_total ? ` · 유니버스 ${data.universe_total.toLocaleString()}종목` : ""}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} /> 새로고침
        </button>
      </div>

      {/* 계좌 탭 + 기간 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                period === p ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {tab === "pension" && (
        <p className="text-xs text-muted-foreground">
          레버리지·인버스·파생형이 제외된 <b className="text-foreground">편입 가능 종목만</b> 순위에
          포함됩니다. 실제 매수 가능 여부는 증권사 연금 화면에서 최종 확인하세요.
        </p>
      )}
      {tab === "stock" && (
        <p className="text-xs text-amber-400/90 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          제한 없는 전체 순위라 레버리지·인버스가 포함될 수 있습니다. 해당 상품은 음의 복리
          효과로 장기 보유에 부적합한 단기 상품입니다(배지로 표시).
        </p>
      )}

      {/* 추천 카드 */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl animate-pulse bg-muted" />
          ))}
        </div>
      ) : picks.length === 0 ? (
        <Card><p className="text-sm text-muted-foreground">추천 데이터를 불러오지 못했습니다.</p></Card>
      ) : (
        <div className="space-y-2">
          {picks.map((p) => {
            const st = STATE_BADGE[p.entry?.state ?? "weak"] ?? STATE_BADGE.weak;
            const risky = p.leveraged || p.inverse || p.derivative;
            return (
              <Card
                key={p.ticker}
                className="cursor-pointer hover:bg-white/5 active:bg-white/10 transition-colors"
                onClick={() => setOpenTicker(p.ticker)}
              >
                {/* 헤더 행 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold">{p.rank}. {p.name}</span>
                      {risky && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold">
                          {p.leveraged ? "레버리지" : p.inverse ? "인버스" : "파생형"} · 장기보유 부적합
                        </span>
                      )}
                      {p.safeType && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">
                          안전자산({p.safeType})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {p.ticker} · {p.category}
                      {p.drawdownPct != null && (
                        <span className={p.drawdownPct >= -0.5 ? "text-green-400" : p.drawdownPct <= -10 ? "text-red-400" : ""}>
                          {" "}· 고점比 {p.drawdownPct >= -0.5 ? "신고가권" : `${p.drawdownPct.toFixed(1)}%`}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-sm font-bold tabular-nums ${colorByChange(p.sortReturn)}`}>
                      {formatPercent(p.sortReturn)}
                    </span>
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${st.cls}`}>{st.text}</span>
                  </div>
                </div>

                {/* 매매 정보 그리드 */}
                {p.entry && !p.entry.insufficient_data && (
                  <>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-2.5 text-xs">
                      <Field label="현재가" value={won(p.entry.currentPrice)} />
                      <Field
                        label="분할매수 밴드"
                        value={p.entry.entryLow != null && p.entry.entryHigh != null
                          ? `${p.entry.entryLow.toLocaleString()}~${p.entry.entryHigh.toLocaleString()}`
                          : "—"}
                      />
                      <Field
                        label="손절"
                        value={won(p.entry.stopLoss)}
                        sub={p.entry.stopLossPct != null ? `${p.entry.stopLossPct.toFixed(1)}%` : undefined}
                        cls="text-red-400"
                      />
                      <Field label="익절 목표" value={won(p.entry.takeProfit)} cls="text-green-400" />
                      <Field
                        label="손익비"
                        value={p.entry.riskReward != null ? `${p.entry.riskReward.toFixed(1)}:1` : "—"}
                        sub={p.entry.riskReward != null && p.entry.riskReward >= 2 ? "양호" : undefined}
                      />
                      <Field
                        label="변동성(연·ATR)"
                        value={`${p.annVolPct != null ? p.annVolPct + "%" : "—"} · ${p.entry.atrPct != null ? p.entry.atrPct + "%" : "—"}`}
                        sub={p.entry.rsi != null ? `RSI ${p.entry.rsi.toFixed(0)}` : undefined}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">{p.entry.note}</p>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground/50 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        모멘텀(수익률)과 위험조정수익(수익률/변동성)을 혼합한 정량 순위이며 투자 권유가 아닙니다. 유동성 하한·동일지수 중복 제거·파생형 후순위가 적용됩니다. 진입·손절 수치는 과거
        가격과 변동성(ATR)으로 계산한 기술적 레벨입니다. 종목을 누르면 차트 상세를 볼 수 있습니다.
      </p>

      {openTicker && <EtfDetailModal ticker={openTicker} onClose={() => setOpenTicker(null)} />}
    </div>
  );
}

function Field({ label, value, sub, cls = "" }: {
  label: string; value: string; sub?: string; cls?: string;
}) {
  return (
    <div className="rounded p-1.5" style={{ background: "var(--background)" }}>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`font-medium tabular-nums text-[11px] leading-tight ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}
