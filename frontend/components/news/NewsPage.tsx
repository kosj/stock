"use client";

/**
 * NewsPage — 국내외 주요 금융 뉴스 모아보기
 *
 * 데이터: GET /api/news (언론사 RSS 통합)
 * 원칙: 기사를 지어내지 않는다. 일부 소스가 끊기면 남은 기사를 보여주되
 *       "몇 개 소스가 실패했다"를 화면에 명시한다 — 조용히 줄어든 목록을
 *       정상처럼 보여주면 사용자가 시황을 잘못 읽는다.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Newspaper, RefreshCw, ExternalLink, Search, AlertTriangle, Clock,
} from "lucide-react";
import { QueryState } from "@/components/ui/QueryState";
import { jsonFetcher } from "@/lib/fetcher";

interface NewsItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
  outlet: string;
  sourceId: string;
  region: "domestic" | "global";
  summary: string;
}
interface FeedFailure { id: string; name: string; reason: string }
interface NewsResponse {
  count: number;
  items: NewsItem[];
  failures: FeedFailure[];
  fetchedAt: string;
}

type Tab = "all" | "domestic" | "global";

const TABS: { key: Tab; label: string }[] = [
  { key: "all",      label: "전체" },
  { key: "domestic", label: "국내" },
  { key: "global",   label: "해외" },
];

/** 발행 시각 → "12분 전" 형태. 시각을 모르는 기사는 숨기지 않고 명시한다. */
function timeAgo(iso: string | null): string {
  if (!iso) return "시간 미상";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

export function NewsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [outlet, setOutlet] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const { data, error, isLoading, mutate, isValidating } = useSWR<NewsResponse>(
    "/api/news",
    jsonFetcher,
    { revalidateOnFocus: false, dedupingInterval: 300_000, shouldRetryOnError: false },
  );

  const all = useMemo(() => data?.items ?? [], [data]);

  // 탭 안에 실제로 기사가 있는 매체만 필터 칩으로 노출한다
  const outlets = useMemo(() => {
    const pool = tab === "all" ? all : all.filter((i) => i.region === tab);
    const counts = new Map<string, number>();
    for (const i of pool) counts.set(i.outlet, (counts.get(i.outlet) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [all, tab]);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((i) => {
      if (tab !== "all" && i.region !== tab) return false;
      if (outlet && i.outlet !== outlet) return false;
      if (needle && !`${i.title} ${i.summary}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [all, tab, outlet, q]);

  function switchTab(next: Tab) {
    setTab(next);
    setOutlet(null);   // 탭이 바뀌면 이전 탭의 매체 필터는 의미가 없다
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <header>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Newspaper size={20} className="text-blue-400" /> 주요 뉴스
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          국내외 경제·증권 매체의 최신 기사를 한곳에서 봅니다. 제목을 누르면 원문으로 이동합니다.
        </p>
      </header>

      {/* 지역 탭 */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 검색 + 새로고침 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제목·요약 검색"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg text-sm border bg-transparent outline-none focus:border-blue-500 transition-colors"
            style={{ borderColor: "var(--border)" }}
          />
        </div>
        <button
          onClick={() => mutate()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 px-2 py-1.5"
        >
          <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} /> 새로고침
        </button>
      </div>

      {/* 매체 필터 */}
      {outlets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setOutlet(null)}
            className={`px-2 py-1 rounded-md text-xs transition-colors ${
              outlet === null ? "bg-blue-500/15 text-blue-400" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            전체 매체
          </button>
          {outlets.map(([name, n]) => (
            <button
              key={name}
              onClick={() => setOutlet(outlet === name ? null : name)}
              className={`px-2 py-1 rounded-md text-xs transition-colors ${
                outlet === name ? "bg-blue-500/15 text-blue-400" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {name} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      {/* 일부 소스 실패 — 목록이 조용히 줄어든 것을 숨기지 않는다 */}
      {data && data.failures.length > 0 && (
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--card)", borderColor: "rgb(245 158 11 / 0.35)" }}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="text-amber-400 font-medium">{data.failures.length}개 소스</span>를 불러오지 못했습니다 —{" "}
              {data.failures.map((f) => `${f.name}(${f.reason})`).join(", ")}. 나머지 매체 기사만 표시됩니다.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{items.length}건</span>
        {data?.fetchedAt && (
          <span className="flex items-center gap-1">
            <Clock size={11} /> {new Date(data.fetchedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준
          </span>
        )}
      </div>

      <QueryState
        loading={isLoading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={() => mutate()}
        emptyText={q || outlet ? "조건에 맞는 기사가 없습니다." : "표시할 기사가 없습니다."}
        skeletonRows={6}
      >
        <div className="space-y-2">
          {items.map((n) => (
            <a
              key={n.id}
              href={n.link}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border p-3 transition-colors hover:bg-white/5"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug break-words">{n.title}</p>
                  {n.summary && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 break-words">{n.summary}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                    <span className={`px-1.5 py-0.5 rounded ${
                      n.region === "domestic"
                        ? "bg-purple-500/15 text-purple-300"
                        : "bg-blue-500/15 text-blue-300"
                    }`}>
                      {n.outlet}
                    </span>
                    <span className="text-muted-foreground">{timeAgo(n.publishedAt)}</span>
                  </div>
                </div>
                <ExternalLink size={13} className="text-muted-foreground shrink-0 mt-0.5" />
              </div>
            </a>
          ))}
        </div>
      </QueryState>

      <p className="text-xs text-muted-foreground/60">
        각 매체의 RSS를 그대로 모아 보여줍니다. 기사 내용과 저작권은 해당 매체에 있으며,
        본 화면은 제목·요약과 원문 링크만 제공합니다.
      </p>
    </div>
  );
}
