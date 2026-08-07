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
import { TrendingUp, RefreshCw, Info, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { EtfDetailModal } from "./EtfDetailModal";
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

/**
 * 자산군 탭.
 * 안전자산 = 채권·현금성(CD/KOFR 등)·금. 연금계좌의 위험자산 70% 한도 밖
 * (나머지 30%)에 배분할 후보를 따로 보기 위한 탭이다.
 */
const ASSETS = [
  { key: "all",  label: "전체 자산" },
  { key: "safe", label: "안전자산" },
] as const;
type AssetKey = (typeof ASSETS)[number]["key"];

const ENTRY_STATE: Record<string, { label: string; cls: string }> = {
  buy_zone:   { label: "분할매수권", cls: "text-green-400" },
  watch:      { label: "눌림 대기",  cls: "text-blue-400" },
  overbought: { label: "과열·관망",  cls: "text-amber-400" },
  weak:       { label: "진입 보류",  cls: "text-red-400" },
};

interface EtfRow {
  rank: number; ticker: string; name: string; category: string;
  price: number; sortReturn: number; marketCapEok?: number | null;
  safeType?: string | null;
  returns: Partial<Record<Period, number | null>>;
}
interface EntryPoint {
  currentPrice: number; entryLow: number | null; entryHigh: number | null;
  stopLoss: number | null; state: string; note: string; rsi: number | null;
}
interface Pick extends EtfRow { entry: EntryPoint | null; drawdownPct?: number | null }

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const won = (v: number | null | undefined) => (v != null ? v.toLocaleString() + "원" : "—");

export function EtfRankingPage() {
  // 기본값 3M — 네이버가 3개월 수익률을 직접 제공해 "전체 종목"이 즉시 반영된다.
  const [period, setPeriod]   = useState<Period>("3M");
  const [account, setAccount] = useState<AccountKey>("all");
  const [asset, setAsset]     = useState<AssetKey>("all");
  // 종목 터치 시 상세 시트로 열 티커
  const [openTicker, setOpenTicker] = useState<string | null>(null);

  const isAccount = account !== "all";
  const isSafe    = asset === "safe";
  const rankUrl = `/api/etfs/ranking?period=${period}`
    + (isAccount ? `&account=${account}` : "")
    + (isSafe ? "&asset=safe" : "");
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
            국내 상장 ETF 전체{rankData?.total ? ` ${rankData.total.toLocaleString()}종목` : ""}
            {" "}· 수익률 내림차순 · 연금/IRP/ISA 편입 가능 종목 선별
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

        {/* 자산군 탭 — 안전자산(채권·현금성·금) 순위 */}
        <div className="flex gap-1">
          {ASSETS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAsset(a.key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                asset === a.key ? "bg-sky-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {a.key === "safe" && <ShieldCheck size={12} />}
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {isSafe && (
        <p className="text-xs text-muted-foreground -mt-1">
          안전자산 = 채권 · 현금성(CD/KOFR 등 초단기) · 금 · 채권혼합.
          연금계좌의 위험자산 70% 한도 밖(나머지 30%) 배분 후보입니다.
          레버리지·인버스·파생형은 제외됩니다.
          <span className="text-amber-400/90">
            {" "}단, <b>채권혼합</b>은 주식이 섞여 있어 수익·손실 변동이 순수 채권보다 큽니다.
          </span>
        </p>
      )}

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
                      {p.drawdownPct != null && (
                        <span
                          className={`text-xs tabular-nums ${
                            p.drawdownPct >= -0.5 ? "text-green-400"
                            : p.drawdownPct <= -10 ? "text-red-400" : "text-muted-foreground"
                          }`}
                          title="52주 전고점 대비"
                        >
                          고점比 {p.drawdownPct >= -0.5 ? "신고가권" : `${p.drawdownPct.toFixed(1)}%`}
                        </span>
                      )}
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
          <span className="text-xs text-muted-foreground">
            {rankData?.total && rankData.covered < rankData.total
              ? `${rankData.covered.toLocaleString()} / ${rankData.total.toLocaleString()}종목`
              : `${ranking.length.toLocaleString()}종목`}
          </span>
        </div>

        {/* 부분 커버리지 안내 — 어떤 구간이 전체 반영인지 사용자가 알 수 있게 */}
        {rankData?.note && (
          <div className="flex items-start gap-1.5 px-4 py-2 text-xs text-amber-400/90 border-b"
               style={{ borderColor: "var(--border)" }}>
            <Info size={12} className="mt-0.5 shrink-0" />
            {rankData.note}
          </div>
        )}

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
                  <tr
                    key={r.ticker}
                    onClick={() => setOpenTicker(r.ticker)}
                    className="border-b hover:bg-white/5 cursor-pointer active:bg-white/10"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="text-right py-2 px-3 tabular-nums text-muted-foreground">{r.rank}</td>
                    <td className="py-2 px-2">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.ticker}
                        {r.safeType && <span className="ml-1 text-sky-400">· {r.safeType}</span>}
                      </div>
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
        ETF 목록·1D·3M 수익률: 네이버 금융(상장 전체) · 그 외 구간: Yahoo Finance 일봉 계산 ·
        종목을 누르면 차트·진입타점 상세를 볼 수 있습니다 · 투자 손익 보장 불가
      </p>

      {openTicker && (
        <EtfDetailModal ticker={openTicker} onClose={() => setOpenTicker(null)} />
      )}
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
