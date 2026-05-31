"use client";
import { Fragment, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatPercent, colorByChange } from "@/lib/utils";
import { RefreshCw, ChevronDown, Loader2 } from "lucide-react";

type Period = "1d" | "1w" | "1m" | "3m" | "ytd";

const PERIODS: { key: Period; label: string; field: string }[] = [
  { key: "1d",  label: "1D",  field: "change_1d"  },
  { key: "1w",  label: "1W",  field: "change_1w"  },
  { key: "1m",  label: "1M",  field: "change_1m"  },
  { key: "3m",  label: "3M",  field: "change_3m"  },
  { key: "ytd", label: "YTD", field: "change_ytd" },
];

function SectorEtfPanel({ sector, activePeriod }: { sector: string; activePeriod: Period }) {
  const { data, isLoading } = useSWR(
    `sector-etfs-${sector}`,
    () => api.sectors.etfs(sector),
    { revalidateOnFocus: false },
  );

  const activeField = PERIODS.find((p) => p.key === activePeriod)?.field ?? "change_1m";
  const etfs = [...((data as any[]) ?? [])].sort(
    (a, b) => (b[activeField] ?? 0) - (a[activeField] ?? 0),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        ETF 데이터 로딩 중…
      </div>
    );
  }

  if (!etfs.length) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        ETF 데이터를 가져올 수 없습니다.
      </div>
    );
  }

  return (
    <div>
      {/* 헤더 */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b"
        style={{ borderColor: "var(--border)", background: "var(--muted)" }}
      >
        <span className="text-xs font-semibold text-blue-400 w-5 shrink-0" />
        <div className="flex-1 min-w-0 text-xs font-semibold text-muted-foreground">ETF</div>
        <span className="text-xs text-muted-foreground w-20 text-right hidden md:block shrink-0">현재가</span>
        <div className="hidden md:flex gap-3 shrink-0">
          {PERIODS.map((p) => (
            <div
              key={p.key}
              className={`text-xs text-right w-12 ${
                p.key === activePeriod ? "text-blue-400 font-semibold" : "text-muted-foreground"
              }`}
            >
              {p.label}
            </div>
          ))}
        </div>
        <div className="w-16 text-right text-xs text-muted-foreground md:hidden shrink-0">수익률</div>
      </div>

      {/* ETF 행 */}
      {etfs.map((etf, i) => (
        <div
          key={etf.ticker}
          className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-white/3 transition-colors"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-tight truncate">{etf.name}</div>
            <div className="text-xs text-muted-foreground">{etf.ticker}</div>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums w-20 text-right hidden md:block shrink-0">
            {etf.price?.toLocaleString()}
          </span>
          <div className="hidden md:flex gap-3 shrink-0">
            {PERIODS.map((p) => (
              <div
                key={p.key}
                className={`text-xs tabular-nums text-right w-12 ${
                  p.key === activePeriod ? "font-semibold" : ""
                } ${colorByChange(etf[p.field])}`}
              >
                {formatPercent(etf[p.field])}
              </div>
            ))}
          </div>
          <span className={`text-sm tabular-nums w-16 text-right font-semibold md:hidden shrink-0 ${colorByChange(etf[activeField])}`}>
            {formatPercent(etf[activeField])}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SectorsPage() {
  const { data: rotation, isLoading, mutate } = useSWR(
    "sector-rotation",
    () => api.sectors.rotation(),
    { revalidateOnFocus: false },
  );

  const [activePeriod, setActivePeriod] = useState<Period>("1m");
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  const r = rotation as any;
  const rawSectors: any[] = r?.sectors ?? [];

  // 선택된 기간 기준으로 정렬
  const activeField = PERIODS.find((p) => p.key === activePeriod)?.field ?? "change_1m";
  const sectors = [...rawSectors].sort((a, b) => (b[activeField] ?? 0) - (a[activeField] ?? 0));

  function barColor(pct: number) {
    if (pct > 5) return "bg-green-500";
    if (pct > 0) return "bg-green-400/60";
    if (pct < -5) return "bg-red-500";
    return "bg-red-400/60";
  }

  const maxAbsVal = Math.max(...sectors.map((s) => Math.abs(s[activeField] ?? 0)), 1);

  function toggleSector(sectorName: string) {
    setSelectedSector((prev) => (prev === sectorName ? null : sectorName));
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">섹터 로테이션</h1>
          <p className="text-sm text-muted-foreground mt-0.5">KODEX ETF 기반 섹터 성과 추적</p>
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      {/* 로테이션 테마 */}
      {r?.theme && (
        <Card className="border-blue-500/30">
          <div className="text-xs text-blue-400 font-semibold mb-1">현재 로테이션 테마</div>
          <div className="text-sm font-medium">{r.theme}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
            <div className="min-w-0">
              <span className="text-green-400 font-semibold">주도 섹터:</span>{" "}
              {r.leading?.join(", ")}
            </div>
            <div className="min-w-0">
              <span className="text-red-400 font-semibold">부진 섹터:</span>{" "}
              {r.lagging?.join(", ")}
            </div>
          </div>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-2">
          {Array(8).fill(0).map((_, i) => (
            <Card key={i} className="h-14 animate-pulse" />
          ))}
        </div>
      )}

      {/* 섹터 성과 테이블 */}
      {sectors.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b" style={{ borderColor: "var(--border)" }}>
            <CardTitle className="mb-0">섹터별 수익률</CardTitle>
            {/* 기간 선택 버튼 */}
            <div className="flex gap-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setActivePeriod(p.key)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${
                    activePeriod === p.key
                      ? "bg-blue-600/30 text-blue-400 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            {sectors.map((s, i) => (
              <Fragment key={s.ticker}>
                {/* 섹터 행 — 클릭 시 ETF 패널 토글 */}
                <div
                  className={`flex items-center gap-3 py-3 px-4 border-b cursor-pointer hover:bg-white/5 transition-colors ${
                    selectedSector === s.sector ? "bg-white/5" : ""
                  }`}
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => toggleSector(s.sector)}
                >
                  {/* 순위 */}
                  <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>

                  {/* 섹터명 */}
                  <div className="w-24 shrink-0">
                    <div className="text-sm font-medium">{s.sector}</div>
                    <div className="text-xs text-muted-foreground">{s.name}</div>
                  </div>

                  {/* 활성 기간 바 차트 */}
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-4 rounded relative bg-muted overflow-hidden">
                      <div
                        className={`absolute top-0 h-full rounded transition-all ${barColor(s[activeField])}`}
                        style={{
                          width: `${(Math.abs(s[activeField]) / maxAbsVal) * 50}%`,
                          left: s[activeField] >= 0 ? "50%" : undefined,
                          right: s[activeField] < 0 ? "50%" : undefined,
                        }}
                      />
                      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                    </div>
                    <span className={`text-xs tabular-nums w-14 text-right font-medium ${colorByChange(s[activeField])}`}>
                      {formatPercent(s[activeField])}
                    </span>
                  </div>

                  {/* 기간별 수익률 */}
                  <div className="hidden md:flex gap-4 text-xs tabular-nums">
                    {PERIODS.filter((p) => p.key !== activePeriod).map(({ label, field }) => (
                      <div key={label} className="text-right w-14">
                        <div className="text-muted-foreground text-[10px]">{label}</div>
                        <div className={colorByChange(s[field])}>{formatPercent(s[field], 1)}</div>
                      </div>
                    ))}
                  </div>

                  {/* 토글 아이콘 */}
                  <ChevronDown
                    size={15}
                    className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
                      selectedSector === s.sector ? "rotate-180 text-blue-400" : ""
                    }`}
                  />
                </div>

                {/* ETF 랭킹 패널 (펼쳐짐) */}
                {selectedSector === s.sector && (
                  <div
                    className="border-b"
                    style={{ borderColor: "var(--border)", background: "var(--card)" }}
                  >
                    <SectorEtfPanel sector={s.sector} activePeriod={activePeriod} />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </Card>
      )}

      {/* 성과 히트맵 */}
      {sectors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{PERIODS.find((p) => p.key === activePeriod)?.label} 성과 히트맵</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {sectors.map((s) => {
              const v = s[activeField] ?? 0;
              const intensity = Math.min(Math.abs(v) / 15, 1);
              const bg = v >= 0
                ? `rgba(34,197,94,${0.1 + intensity * 0.4})`
                : `rgba(239,68,68,${0.1 + intensity * 0.4})`;
              return (
                <button
                  key={s.ticker}
                  className="rounded-lg p-3 text-center hover:ring-1 hover:ring-white/20 transition-all"
                  style={{ background: bg }}
                  onClick={() => {
                    toggleSector(s.sector);
                    document.querySelector(`[data-sector="${s.sector}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <div className="text-xs font-medium">{s.sector}</div>
                  <div className={`text-base font-bold mt-0.5 tabular-nums ${colorByChange(v)}`}>
                    {formatPercent(v, 1)}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
