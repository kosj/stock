"use client";

/**
 * SubscriptionPage — 신규 아파트 분양(청약) 공고
 *
 * 데이터: GET /api/realestate/subscription (공공데이터포털 청약홈 분양정보)
 * API 키가 없으면 표본 공고를 만들어 보여주지 않고 설정 안내를 표시한다 —
 * 가짜 일정은 사용자가 실제 청약을 놓치게 만들 수 있다.
 */

import useSWR from "swr";
import { Building, RefreshCw, ExternalLink, Info, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { WealthTabs } from "./WealthTabs";
import { jsonFetcher, ApiError } from "@/lib/fetcher";

interface Notice {
  id: string; name: string; address: string; region: string;
  houseType: string; saleType: string; totalUnits: number | null;
  noticeDate: string | null; specialStart: string | null;
  applyStart: string | null; applyEnd: string | null;
  winnerDate: string | null; contractStart: string | null; contractEnd: string | null;
  url: string | null; dDayApply: number | null;
}

interface SetupInfo { steps: string[]; docUrl: string }

const fmt = (d: string | null) => (d ? d.replace(/-/g, ".") : "—");

function DdayBadge({ d }: { d: number | null }) {
  if (d == null) return null;
  if (d < 0)  return <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">접수 종료</span>;
  if (d === 0) return <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-semibold">오늘 접수</span>;
  if (d <= 7)  return <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold">D-{d}</span>;
  return <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">D-{d}</span>;
}

export function SubscriptionPage() {
  const { data, error, isLoading, mutate } = useSWR<{ notices: Notice[]; count: number }>(
    "/api/realestate/subscription?perPage=30",
    jsonFetcher,
    { revalidateOnFocus: false, dedupingInterval: 1_800_000, shouldRetryOnError: false },
  );

  // 키 미설정(503)일 때 서버가 내려준 설정 안내
  const setup: SetupInfo | null =
    error instanceof ApiError && error.status === 503
      ? ((error as ApiError & { setup?: SetupInfo }).setup ?? null)
      : null;

  const notices = data?.notices ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <header>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Building size={20} className="text-blue-400" /> 신규 청약 정보
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          청약홈(한국부동산원) 분양 공고를 접수 임박 순으로 보여줍니다.
        </p>
      </header>

      <WealthTabs />

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {data?.count ? `공고 ${data.count}건` : ""}
        </p>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} /> 새로고침
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl animate-pulse bg-muted" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <div className="flex items-start gap-2">
            <KeyRound size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">청약 데이터를 불러오지 못했습니다</p>
              <p className="text-xs text-muted-foreground mt-1">
                {error instanceof Error ? error.message : "알 수 없는 오류"}
              </p>

              {setup && (
                <div className="mt-3">
                  <p className="text-xs font-medium mb-1.5">설정 방법</p>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    {setup.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                  <a
                    href={setup.docUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline mt-2"
                  >
                    공공데이터포털에서 신청 <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : notices.length === 0 ? (
        <Card><p className="text-sm text-muted-foreground">현재 조회된 분양 공고가 없습니다.</p></Card>
      ) : (
        <div className="space-y-2">
          {notices.map((n) => (
            <Card key={n.id || n.name} className={n.dDayApply != null && n.dDayApply < 0 ? "opacity-60" : ""}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold">{n.name}</span>
                    <DdayBadge d={n.dDayApply} />
                    {n.saleType && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{n.saleType}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 break-words">
                    {n.address || n.region}
                    {n.totalUnits ? ` · 총 ${n.totalUnits.toLocaleString()}세대` : ""}
                    {n.houseType ? ` · ${n.houseType}` : ""}
                  </p>
                </div>
                {n.url && (
                  <a
                    href={n.url} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-blue-400 hover:underline flex items-center gap-1 shrink-0"
                  >
                    공고 <ExternalLink size={11} />
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2.5">
                <Field label="모집공고" value={fmt(n.noticeDate)} />
                <Field label="특별공급" value={fmt(n.specialStart)} />
                <Field
                  label="일반접수"
                  value={n.applyStart ? `${fmt(n.applyStart)}~${fmt(n.applyEnd).slice(5)}` : "—"}
                  highlight
                />
                <Field label="당첨발표" value={fmt(n.winnerDate)} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground/60 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        공고 일정은 변경될 수 있습니다. 청약 전 반드시 청약홈(applyhome.co.kr)의 원문 공고문에서
        자격 요건·전매제한·실거주 의무를 확인하세요. 본 화면은 정보 제공용입니다.
      </p>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded p-1.5" style={{ background: "var(--background)" }}>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-[11px] font-medium tabular-nums ${highlight ? "text-blue-400" : ""}`}>{value}</div>
    </div>
  );
}
