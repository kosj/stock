"use client";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertCircle } from "lucide-react";

// 한국 주식 컨벤션: 상승=빨간, 하락=파란
function krxColor(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  if (n > 0) return "text-red-400";
  if (n < 0) return "text-blue-400";
  return "text-muted-foreground";
}

function krxChangePct(n: number | null | undefined): string {
  if (n == null) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function fmtAmt(v: number): string {
  if (!v) return "-";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "+";
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(1)}조`;
  if (abs >= 100_000_000)       return `${sign}${(abs / 100_000_000).toFixed(0)}억`;
  if (abs >= 10_000)            return `${sign}${(abs / 10_000).toFixed(0)}만`;
  return `${sign}${abs.toLocaleString()}`;
}

function fmtVal(v: number): string {
  if (!v) return "-";
  if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  if (v >= 100_000_000)       return `${(v / 100_000_000).toFixed(0)}억`;
  return v.toLocaleString();
}

function NetBadge({ v }: { v: number }) {
  const cls = v > 0 ? "text-red-400" : v < 0 ? "text-blue-400" : "text-muted-foreground";
  const Icon = v > 0 ? TrendingUp : v < 0 ? TrendingDown : Minus;
  return (
    <span className={`flex items-center justify-end gap-0.5 font-semibold tabular-nums ${cls}`}>
      <Icon size={12} />
      {fmtAmt(v)}
    </span>
  );
}

type Tab = "flow" | "investor" | "sector" | "short";

// ── 섹션: 자금 흐름 요약 ────────────────────────────────────────────────────

function MoneyFlowSection({ data }: { data: any }) {
  const flows: any[] = data?.money_flow?.flows ?? [];
  const maxAbs = Math.max(...flows.map((f) => Math.abs(f.total_net)), 1);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {data?.date ? `기준일: ${data.date.slice(0,4)}-${data.date.slice(4,6)}-${data.date.slice(6,8)}` : ""}
        {"  "}외국인 순매수(+)는 빨간색, 순매도(-)는 파란색으로 표시
      </p>

      {/* 순매수 바 차트 */}
      <Card>
        <CardHeader><CardTitle>투자자별 순매수 (KOSPI + KOSDAQ 합산)</CardTitle></CardHeader>
        <div className="space-y-3">
          {flows.map((f) => {
            const v = f.total_net;
            const pct = (Math.abs(v) / maxAbs) * 45;
            const color = v > 0 ? "bg-red-500" : v < 0 ? "bg-blue-500" : "bg-muted";
            return (
              <div key={f.investor} className="flex items-center gap-3">
                <span className="text-sm w-16 shrink-0 text-right">{f.investor}</span>
                <div className="flex-1 h-5 relative bg-muted rounded overflow-hidden">
                  <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border z-10" />
                  <div
                    className={`absolute top-0 h-full rounded transition-all ${color}`}
                    style={{
                      width: `${pct}%`,
                      left:  v >= 0 ? "50%" : undefined,
                      right: v < 0  ? "50%" : undefined,
                    }}
                  />
                </div>
                <div className="w-28 text-right">
                  <NetBadge v={v} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* KOSPI / KOSDAQ 분리 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: "KOSPI", key: "kospi_net" },
          { label: "KOSDAQ", key: "kosdaq_net" },
        ].map(({ label, key }) => (
          <Card key={label}>
            <CardHeader><CardTitle>{label} 투자자별 순매수</CardTitle></CardHeader>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {flows.map((f) => (
                <div key={f.investor} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted-foreground">{f.investor}</span>
                  <NetBadge v={f[key]} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── 섹션: 투자자별 매매동향 ──────────────────────────────────────────────────

function InvestorSection({ data }: { data: any }) {
  const [market, setMarket] = useState<"kospi" | "kosdaq">("kospi");
  const rows: any[] = data?.investor?.[market] ?? [];

  return (
    <div className="space-y-4">
      {/* 시장 탭 */}
      <div className="flex gap-1">
        {(["kospi", "kosdaq"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMarket(m)}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              market === m
                ? "bg-blue-600/30 text-blue-400 font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        {/* 헤더 */}
        <div
          className="grid grid-cols-4 px-4 py-2 text-xs font-semibold text-muted-foreground border-b"
          style={{ borderColor: "var(--border)", background: "var(--muted)" }}
        >
          <span>투자자</span>
          <span className="text-right">매수</span>
          <span className="text-right">매도</span>
          <span className="text-right">순매수</span>
        </div>
        {rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">데이터 없음</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.name}
              className="grid grid-cols-4 px-4 py-2.5 text-sm border-b last:border-0 hover:bg-white/3 transition-colors"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="font-medium">{r.name}</span>
              <span className="text-right text-muted-foreground tabular-nums">{fmtVal(r.buy)}</span>
              <span className="text-right text-muted-foreground tabular-nums">{fmtVal(r.sell)}</span>
              <NetBadge v={r.net} />
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

// ── 섹션: 업종별 수익률 ──────────────────────────────────────────────────────

type Period = "change_1d" | "change_1w" | "change_1m" | "change_3m" | "change_ytd";

const PERIOD_LABELS: { key: Period; label: string }[] = [
  { key: "change_1d",  label: "1일" },
  { key: "change_1w",  label: "1주" },
  { key: "change_1m",  label: "1개월" },
  { key: "change_3m",  label: "3개월" },
  { key: "change_ytd", label: "YTD" },
];

function SectorSection({ data }: { data: any }) {
  const [period, setPeriod] = useState<Period>("change_1d");
  const raw: any[] = data?.sector_index?.kospi ?? [];
  const rows = [...raw].sort((a, b) => (b[period] ?? 0) - (a[period] ?? 0));

  const maxAbsPct = Math.max(...rows.map((r) => Math.abs(r[period] ?? 0)), 0.1);

  return (
    <div className="space-y-4">
      {/* 기간 선택 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">기간:</span>
        <div className="flex gap-1">
          {PERIOD_LABELS.map(({ key, label }) => (
            <button key={key} onClick={() => setPeriod(key)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                period === key ? "bg-blue-600/30 text-blue-400 font-semibold" : "text-muted-foreground hover:bg-white/5"
              }`}>{label}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div
          className="grid grid-cols-[1fr_100px_80px] px-4 py-2 text-xs font-semibold text-muted-foreground border-b hidden md:grid"
          style={{ borderColor: "var(--border)", background: "var(--muted)" }}
        >
          <span>업종 (KODEX ETF 기준)</span>
          <span className="text-right">현재가</span>
          <span className="text-right">수익률</span>
        </div>
        {rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">데이터 없음</div>
        ) : (
          rows.map((r) => {
            const pct = r[period] ?? 0;
            const barPct = (Math.abs(pct) / maxAbsPct) * 40;
            const barColor = pct >= 0 ? "bg-red-500/60" : "bg-blue-500/60";
            return (
              <div
                key={r.name}
                className="flex md:grid md:grid-cols-[1fr_100px_80px] items-center gap-2 md:gap-0 px-4 py-2.5 border-b last:border-0 hover:bg-white/3 transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                {/* 업종명 + 바 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="mt-1 h-1.5 w-full bg-muted rounded overflow-hidden relative hidden md:block">
                    <div
                      className={`absolute top-0 h-full rounded ${barColor}`}
                      style={{
                        width: `${barPct}%`,
                        left: pct >= 0 ? "50%" : undefined,
                        right: pct < 0 ? "50%" : undefined,
                      }}
                    />
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                  </div>
                </div>
                <span className="text-right text-sm tabular-nums text-muted-foreground hidden md:block">
                  {r.index ? r.index.toLocaleString() : "-"}
                </span>
                <span className={`text-right text-sm tabular-nums font-semibold ${krxColor(pct)}`}>
                  {krxChangePct(pct)}
                </span>
              </div>
            );
          })
        )}
      </Card>
      <p className="text-xs text-muted-foreground">* KODEX 대표 ETF 가격 기준 수익률 (실시간 아님)</p>
    </div>
  );
}

// ── 섹션: 공매도 현황 ────────────────────────────────────────────────────────

function ShortSellingSection({ data }: { data: any }) {
  const [stockMarket, setStockMarket] = useState<"top_kospi" | "top_kosdaq">("top_kospi");
  const byMarket: any[] = data?.short_selling?.by_market ?? [];
  const topStocks: any[] = data?.short_selling?.[stockMarket] ?? [];

  return (
    <div className="space-y-4">
      {/* 시장별 공매도 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {byMarket.length === 0 ? (
          <Card className="col-span-2 py-8 text-center text-xs text-muted-foreground">공매도 데이터 없음</Card>
        ) : (
          byMarket.map((m) => {
            const ratio = m.ratio ?? 0;
            return (
              <Card key={m.market}>
                <div className="flex items-center justify-between mb-3">
                  <CardTitle>{m.market}</CardTitle>
                  <span className={`text-lg font-bold tabular-nums ${ratio > 1 ? "text-red-400" : "text-muted-foreground"}`}>
                    {ratio.toFixed(2)}%
                  </span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">공매도 거래대금</span>
                    <span className="font-medium tabular-nums">{fmtVal(m.short_val)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">전체 거래대금</span>
                    <span className="tabular-nums text-muted-foreground">{fmtVal(m.total_val)}</span>
                  </div>
                  {/* 공매도 비중 바 */}
                  <div className="mt-2 h-2 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full rounded bg-orange-500/70"
                      style={{ width: `${Math.min(ratio * 10, 100)}%` }}
                    />
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* 공매도 상위 종목 */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b" style={{ borderColor: "var(--border)" }}>
          <CardTitle className="mb-0">공매도 상위 종목</CardTitle>
          <div className="flex gap-1">
            {([
              { key: "top_kospi",  label: "KOSPI" },
              { key: "top_kosdaq", label: "KOSDAQ" },
            ] as const).map(({ key, label }) => (
              <button key={key} onClick={() => setStockMarket(key)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  stockMarket === key ? "bg-blue-600/30 text-blue-400 font-semibold" : "text-muted-foreground hover:bg-white/5"
                }`}>{label}
              </button>
            ))}
          </div>
        </div>

        {/* 헤더 */}
        <div
          className="grid grid-cols-[2rem_1fr_80px_80px_80px] px-4 py-2 text-xs font-semibold text-muted-foreground border-b hidden md:grid"
          style={{ borderColor: "var(--border)", background: "var(--muted)" }}
        >
          <span>#</span><span>종목</span>
          <span className="text-right">공매도량</span>
          <span className="text-right">거래대금</span>
          <span className="text-right">비중</span>
        </div>

        {topStocks.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">데이터 없음</div>
        ) : (
          topStocks.slice(0, 15).map((s, i) => (
            <div
              key={s.ticker || i}
              className="grid grid-cols-[2rem_1fr_80px_80px_80px] items-center px-4 py-2.5 border-b last:border-0 hover:bg-white/3 transition-colors"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-xs text-muted-foreground">{i + 1}</span>
              <div>
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.ticker}</div>
              </div>
              <span className="text-right text-xs tabular-nums text-muted-foreground">{s.short_vol?.toLocaleString()}</span>
              <span className="text-right text-xs tabular-nums text-muted-foreground">{fmtVal(s.short_val)}</span>
              <span className={`text-right text-sm tabular-nums font-semibold ${s.ratio > 5 ? "text-red-400" : s.ratio > 2 ? "text-orange-400" : "text-muted-foreground"}`}>
                {s.ratio?.toFixed(2)}%
              </span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "flow",     label: "시장 자금 흐름" },
  { key: "investor", label: "투자자별 동향" },
  { key: "sector",   label: "업종별 수익률" },
  { key: "short",    label: "공매도 현황" },
];

export function KrxPage() {
  const [activeTab, setActiveTab] = useState<Tab>("flow");

  const { data, isLoading, error, mutate } = useSWR(
    "krx-dashboard",
    () => api.krx.dashboard(),
    { refreshInterval: 10_000, revalidateOnFocus: true, dedupingInterval: 0 },
  );

  const d = data as any;

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">국내 증시 통계</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            KRX 정보데이터시스템 기반 · 시장 자금흐름, 투자자동향, 업종수익률, 공매도
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

      {/* 에러 */}
      {error && (
        <Card className="border-red-500/30">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle size={15} />
            KRX API 연결 실패. 장 마감 시간 이후 또는 공휴일에는 데이터가 제공되지 않을 수 있습니다.
          </div>
          <div className="text-xs text-muted-foreground mt-1">{error?.message}</div>
        </Card>
      )}

      {/* 로딩 스켈레톤 */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Card key={i} className="h-24 animate-pulse" />)}
        </div>
      )}

      {/* 탭 */}
      {!isLoading && (
        <>
          <div
            className="flex gap-0 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                  activeTab === key
                    ? "border-blue-400 text-blue-400 font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            {activeTab === "flow"     && <MoneyFlowSection   data={d} />}
            {activeTab === "investor" && <InvestorSection    data={d} />}
            {activeTab === "sector"   && <SectorSection      data={d} />}
            {activeTab === "short"    && <ShortSellingSection data={d} />}
          </div>
        </>
      )}
    </div>
  );
}
