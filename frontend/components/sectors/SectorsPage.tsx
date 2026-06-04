"use client";

/**
 * SectorsPage — 섹터 로테이션 대시보드
 *
 * 데이터 소스: Supabase etf_daily_prices (매일 16:00 KST Cron 수집)
 * 핵심 지표:  1개월(20 영업일) 수익률
 *
 * 구성:
 *   1. 로테이션 테마 배너
 *   2. 섹터 모멘텀 바 차트 (수익률 순 정렬)
 *   3. ETF 상세 카드 (클릭 토글)
 *   4. 히트맵
 *   5. 데이터 갱신 일자 표시
 */

import { useState } from "react";
import useSWR from "swr";
import {
  TrendingUp, TrendingDown, Minus,
  RefreshCw, ChevronDown, Database, Clock,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { colorByChange, formatPercent } from "@/lib/utils";

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface SectorMomentum {
  sector_name:  string;
  etf_name:     string;
  ticker:       string;
  return_1m:    number;
  close_today:  number | null;
  close_1m_ago: number | null;
  data_date:    string | null;
}

interface RotationData {
  date:     string;
  theme:    string;
  leading:  string[];
  lagging:  string[];
  sectors:  SectorMomentum[];
}

// ── fetcher ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ── 바 색상 ──────────────────────────────────────────────────────────────────

function barColor(pct: number) {
  if (pct >  5) return "bg-green-500";
  if (pct >  0) return "bg-green-400/60";
  if (pct < -5) return "bg-red-500";
  return "bg-red-400/60";
}

// ── 개별 섹터 상세 카드 ───────────────────────────────────────────────────────

function SectorDetailCard({ sector }: { sector: SectorMomentum }) {
  const isUp   = sector.return_1m >= 0;
  const Icon   = isUp ? TrendingUp : sector.return_1m === 0 ? Minus : TrendingDown;
  const color  = colorByChange(sector.return_1m);

  return (
    <div className="px-4 py-3 space-y-2" style={{ background: "var(--background)" }}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="rounded-lg p-2.5" style={{ background: "var(--card)" }}>
          <div className="text-muted-foreground mb-1">ETF 코드</div>
          <div className="font-medium tabular-nums">{sector.ticker}</div>
        </div>
        <div className="rounded-lg p-2.5" style={{ background: "var(--card)" }}>
          <div className="text-muted-foreground mb-1">현재 종가</div>
          <div className="font-medium tabular-nums">
            {sector.close_today != null
              ? sector.close_today.toLocaleString() + "원"
              : "—"}
          </div>
        </div>
        <div className="rounded-lg p-2.5" style={{ background: "var(--card)" }}>
          <div className="text-muted-foreground mb-1">20일 전 종가</div>
          <div className="font-medium tabular-nums">
            {sector.close_1m_ago != null
              ? sector.close_1m_ago.toLocaleString() + "원"
              : "—"}
          </div>
        </div>
        <div className="rounded-lg p-2.5" style={{ background: "var(--card)" }}>
          <div className="text-muted-foreground mb-1">1개월 수익률</div>
          <div className={`text-sm font-bold tabular-nums flex items-center gap-1 ${color}`}>
            <Icon size={13} />
            {formatPercent(sector.return_1m)}
          </div>
        </div>
      </div>
      {sector.data_date && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          <Clock size={10} />
          기준일: {sector.data_date}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function SectorsPage() {
  const { data, isLoading, mutate } = useSWR<RotationData>(
    "/api/sectors/rotation",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  const [selected, setSelected] = useState<string | null>(null);

  const sectors = data?.sectors ?? [];
  // 1M 수익률 내림차순 정렬 (API에서 이미 정렬되지만 클라이언트 재정렬 보장)
  const sorted  = [...sectors].sort((a, b) => b.return_1m - a.return_1m);
  const maxAbs  = Math.max(...sorted.map((s) => Math.abs(s.return_1m)), 1);

  // 데이터가 있는지 (수집된 종가가 하나라도 존재)
  const hasData = sorted.some((s) => s.close_today !== null);

  function toggle(name: string) {
    setSelected((prev) => (prev === name ? null : name));
  }

  return (
    <div className="p-6 space-y-6">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">섹터 로테이션</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            국내 대표 ETF 기반 섹터 모멘텀 추적 · 매일 16:00 KST 자동 갱신
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

      {/* 데이터 없음 안내 */}
      {!isLoading && !hasData && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Database size={32} className="text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium">아직 수집된 ETF 종가 데이터가 없습니다.</p>
              <p className="text-xs text-muted-foreground mt-1">
                매일 오후 4:00 KST에 자동 수집됩니다.
                <br />
                수동 수집: <code className="bg-muted px-1 rounded">POST /api/cron/update-etf</code>
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* 로테이션 테마 배너 */}
      {data?.theme && hasData && (
        <Card className="border-blue-500/30">
          <div className="text-xs text-blue-400 font-semibold mb-1">현재 로테이션 테마</div>
          <div className="text-sm font-medium">{data.theme}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
            <span>
              <span className="text-green-400 font-semibold">주도 섹터: </span>
              {data.leading.join(", ")}
            </span>
            <span>
              <span className="text-red-400 font-semibold">부진 섹터: </span>
              {data.lagging.join(", ")}
            </span>
          </div>
        </Card>
      )}

      {/* 스켈레톤 */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-14 animate-pulse" />
          ))}
        </div>
      )}

      {/* 섹터 모멘텀 바 차트 */}
      {!isLoading && sorted.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div
            className="px-4 pt-4 pb-3 flex items-center justify-between border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <CardTitle className="mb-0">섹터별 1개월 수익률</CardTitle>
            <span className="text-xs text-muted-foreground">
              기준: 최근 20 영업일 종가 비교
            </span>
          </div>

          <div>
            {sorted.map((s, i) => (
              <div key={s.sector_name}>
                {/* 섹터 행 */}
                <button
                  className={`w-full flex items-center gap-3 py-3 px-4 border-b text-left
                    cursor-pointer hover:bg-white/5 transition-colors
                    ${selected === s.sector_name ? "bg-white/5" : ""}`}
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => toggle(s.sector_name)}
                >
                  {/* 순위 */}
                  <span className="text-xs text-muted-foreground w-5 text-right shrink-0">
                    {i + 1}
                  </span>

                  {/* 섹터명 + ETF명 */}
                  <div className="w-28 shrink-0 text-left">
                    <div className="text-sm font-medium">{s.sector_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{s.etf_name}</div>
                  </div>

                  {/* 바 차트 */}
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <div className="flex-1 h-4 rounded relative overflow-hidden"
                      style={{ background: "var(--muted)" }}>
                      {s.close_today !== null ? (
                        <>
                          <div
                            className={`absolute top-0 h-full rounded transition-all ${barColor(s.return_1m)}`}
                            style={{
                              width:  `${(Math.abs(s.return_1m) / maxAbs) * 50}%`,
                              left:   s.return_1m >= 0 ? "50%" : undefined,
                              right:  s.return_1m  < 0 ? "50%" : undefined,
                            }}
                          />
                          {/* 중앙선 */}
                          <div className="absolute top-0 bottom-0 left-1/2 w-px"
                            style={{ background: "var(--border)" }} />
                        </>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[10px] text-muted-foreground/50">데이터 수집 전</span>
                        </div>
                      )}
                    </div>
                    <span className={`text-sm tabular-nums w-16 text-right font-semibold shrink-0 ${
                      s.close_today !== null ? colorByChange(s.return_1m) : "text-muted-foreground/40"
                    }`}>
                      {s.close_today !== null ? formatPercent(s.return_1m) : "—"}
                    </span>
                  </div>

                  {/* 토글 화살표 */}
                  <ChevronDown
                    size={14}
                    className={`shrink-0 text-muted-foreground transition-transform duration-200
                      ${selected === s.sector_name ? "rotate-180 text-blue-400" : ""}`}
                  />
                </button>

                {/* 상세 카드 (토글) */}
                {selected === s.sector_name && (
                  <div className="border-b" style={{ borderColor: "var(--border)" }}>
                    <SectorDetailCard sector={s} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 히트맵 */}
      {!isLoading && sorted.length > 0 && hasData && (
        <Card>
          <CardHeader>
            <CardTitle>1개월 수익률 히트맵</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pb-2">
            {sorted.map((s) => {
              const v = s.return_1m;
              const intensity = Math.min(Math.abs(v) / 15, 1);
              const bg =
                s.close_today === null
                  ? "rgba(100,100,100,0.1)"
                  : v >= 0
                  ? `rgba(34,197,94,${0.1 + intensity * 0.45})`
                  : `rgba(239,68,68,${0.1 + intensity * 0.45})`;
              return (
                <button
                  key={s.sector_name}
                  className="rounded-lg p-3 text-center hover:ring-1 hover:ring-white/20 transition-all"
                  style={{ background: bg }}
                  onClick={() => {
                    toggle(s.sector_name);
                    document
                      .getElementById(`sector-${s.sector_name}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <div className="text-xs font-medium">{s.sector_name}</div>
                  <div
                    className={`text-base font-bold mt-0.5 tabular-nums ${
                      s.close_today !== null
                        ? colorByChange(v)
                        : "text-muted-foreground/40"
                    }`}
                  >
                    {s.close_today !== null ? formatPercent(v, 1) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* 푸터 */}
      <p className="text-xs text-muted-foreground/40 text-center pb-2">
        Supabase DB 기반 · ETF 종가 매일 16:00 KST 자동 수집 · 투자 손익 보장 불가
      </p>
    </div>
  );
}
