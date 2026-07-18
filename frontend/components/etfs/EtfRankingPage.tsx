"use client";

/**
 * EtfRankingPage — 국내 상장 ETF 수익률 랭킹 + 연금계좌(퇴직연금·IRP·ISA) 추천·진입타점
 *
 * - 수익률 랭킹: GET /api/etfs/ranking?period=&account=
 * - 계좌 추천+진입타점: GET /api/etfs/account-picks?account=&period=&limit=
 * 데이터: ETF 목록 = Supabase etf_universe(KIS/pykrx 적재) → 시드 폴백, 수익률 = Yahoo.
 * ※ 정보 제공용 정량 신호이며 투자 권유가 아닙니다.
 */

import { useState } from "react";
import useSWR from "swr";
import { TrendingUp, RefreshCw, Info } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { colorByChange, formatPercent } from "@/lib/utils";

const PERIODS = ["1D", "1W", "1M", "3M", "6M", "1Y"] as const;
type Period = (typeof PERIODS)[number];

const ACCOUNTS = [
  { key: "all",     label: "전체" },
  { key: "pension", label: "퇴직연금" },
  { key: "irp",     label: "IRP" },
  { key: "isa",     label: "ISA" },
] as const;
type AccountKey = (typeof ACCOUNTS)[number]["key"];

const ENTRY_STATE: Record<string, { label: string; cls: string }> = {
  buy_zone:   { label: "분할매수권", cls: "text-green-400" },
  watch:      { label: "눌림 대기",  cls: "text-blue-400" },
  overbought: { label: "과열·관망",  cls: "text-amber-400" },
  weak:       { label: "진입 보류",  cls: "text-red-400" },
};

interface EtfRow {
  rank: number; ticker: string; name: string; category: string;
  price: number; sortReturn: number;
  returns: Record<Period, number | null>;
}
interface EntryPoint {
  currentPrice: number; entryLow: number | null; entryHigh: number | null;
  stopLoss: number | null; state: string; note: string; rsi: number | null;
}
interface Pick extends EtfRow { entry: EntryPoint | null }

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const won = (v: number | null | undefined) => (v != null ? v.toLocaleString() + "원" : "—");

export function EtfRankingPage() {
  const [period, setPeriod]   = useState<Period>("1M");
  const [account, setAccount] = useState<AccountKey>("all");

  const isAccount = account !== "all";
  const rankUrl = `/api/etfs/ranking?period=${period}${isAccount ? `&account=${account}` : ""}`;
  const picksUrl = isAccount ? `/api/etfs/account-picks?account=${account}&period=${period}&limit=10` : null;

  const { data: rankData, isLoading, mutate } = useSWR(rankUrl, fetcher, {
    revalidateOnFocus: false, dedupingInterval: 3_600_000,
  });
  const { data: picksData } = useSWR(picksUrl, fetcher, {
    revalidateOnFocus: false, dedupingInterval: 3_600_000,
  });

  const ranking: EtfRow[] = rankData?.ranking ?? [];
  const picks: Pick[] = picksData?.picks ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">ETF 수익률 랭킹</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            국내 상장 ETF · 수익률 내림차순 · 연금/IRP/ISA 편입 가능 종목 선별
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      {/* 컨트롤 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                period === p ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {ACCOUNTS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAccount(a.key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                account === a.key ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* 계좌 선택 시: 추천 + 진입타점 */}
      {isAccount && picks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {picksData?.account_label ?? account} 편입 가능 ETF 추천 · 진입타점 ({period} 수익률 상위)
            </CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {picks.map((p) => {
              const st = ENTRY_STATE[p.entry?.state ?? "weak"] ?? ENTRY_STATE.weak;
              return (
                <div key={p.ticker} className="rounded-lg p-3" style={{ background: "var(--background)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{p.rank}. {p.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{p.ticker} · {p.category}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-sm font-bold tabular-nums ${colorByChange(p.sortReturn)}`}>
                        {formatPercent(p.sortReturn)}
                      </span>
                      <span className={`text-xs font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                  </div>
                  {p.entry && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                      <Field label="현재가" value={won(p.entry.currentPrice)} />
                      <Field label="진입 밴드"
                        value={p.entry.entryLow != null && p.entry.entryHigh != null
                          ? `${p.entry.entryLow.toLocaleString()}~${p.entry.entryHigh.toLocaleString()}`
                          : "—"} />
                      <Field label="손절 참고" value={won(p.entry.stopLoss)} />
                      <Field label="RSI" value={p.entry.rsi != null ? p.entry.rsi.toFixed(0) : "—"} />
                    </div>
                  )}
                  {p.entry?.note && (
                    <div className="text-xs text-muted-foreground mt-1.5">{p.entry.note}</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-start gap-1.5 mt-3 text-xs text-muted-foreground/70">
            <Info size={12} className="mt-0.5 shrink-0" />
            진입타점은 과거 가격 기반 기술적 레벨(지지선·이평·밴드)이며 미래 예측·투자 권유가 아닙니다.
          </div>
        </Card>
      )}

      {/* 전체 수익률 랭킹 테이블 */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b" style={{ borderColor: "var(--border)" }}>
          <CardTitle className="mb-0 flex items-center gap-1.5">
            <TrendingUp size={15} /> {isAccount ? `${picksData?.account_label ?? account} 편입가능 ` : ""}ETF · {period} 수익률순
          </CardTitle>
          <span className="text-xs text-muted-foreground">{ranking.length}종목</span>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 rounded animate-pulse bg-muted" />)}
          </div>
        ) : ranking.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">데이터가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="text-right py-2 px-3 w-10">#</th>
                  <th className="text-left py-2 px-2">종목</th>
                  <th className="text-left py-2 px-2 hidden sm:table-cell">분류</th>
                  <th className="text-right py-2 px-2 hidden sm:table-cell">현재가</th>
                  <th className="text-right py-2 px-3">{period} 수익률</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r) => (
                  <tr key={r.ticker} className="border-b hover:bg-white/5" style={{ borderColor: "var(--border)" }}>
                    <td className="text-right py-2 px-3 tabular-nums text-muted-foreground">{r.rank}</td>
                    <td className="py-2 px-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.ticker}</div>
                    </td>
                    <td className="py-2 px-2 hidden sm:table-cell text-muted-foreground text-xs">{r.category}</td>
                    <td className="py-2 px-2 hidden sm:table-cell text-right tabular-nums">{won(r.price)}</td>
                    <td className={`text-right py-2 px-3 tabular-nums font-semibold ${colorByChange(r.sortReturn)}`}>
                      {formatPercent(r.sortReturn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground/40 text-center pb-2">
        ETF 목록: KIS/pykrx 적재(미적재 시 대표 ETF 폴백) · 수익률: Yahoo Finance · 투자 손익 보장 불가
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded p-2" style={{ background: "var(--card)" }}>
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
