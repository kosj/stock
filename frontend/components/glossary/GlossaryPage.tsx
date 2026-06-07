"use client";

import { useState, useMemo } from "react";
import { Search, BookOpen, X } from "lucide-react";
import {
  MarketTerms,
  QuantTerms,
  TradingTerms,
  searchTerms,
  getTermsByCategory,
  CATEGORY_LABEL,
  type TermCategory,
  type TermEntry,
  type TermEntryWithKey,
} from "@/lib/terminology";

// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_TABS: { key: TermCategory | "all"; label: string; count: number }[] = [
  { key: "all",     label: "전체",     count: Object.keys(MarketTerms).length + Object.keys(QuantTerms).length + Object.keys(TradingTerms).length },
  { key: "market",  label: "시장 기본", count: Object.keys(MarketTerms).length },
  { key: "quant",   label: "퀀트 분석", count: Object.keys(QuantTerms).length },
  { key: "trading", label: "매매 전략", count: Object.keys(TradingTerms).length },
];

const CATEGORY_COLORS: Record<TermCategory, { badge: string; ring: string }> = {
  market:  { badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",   ring: "border-blue-500/20" },
  quant:   { badge: "bg-purple-500/15 text-purple-400 border-purple-500/30", ring: "border-purple-500/20" },
  trading: { badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",  ring: "border-amber-500/20" },
};

// ─────────────────────────────────────────────────────────────────────────────

export function GlossaryPage() {
  const [query,    setQuery]    = useState("");
  const [category, setCategory] = useState<TermCategory | "all">("all");
  const [selected, setSelected] = useState<(TermEntryWithKey) | null>(null);

  const results = useMemo(() => {
    const base = query.trim()
      ? searchTerms(query)
      : getTermsByCategory(category === "all" ? undefined : category);

    const filtered = query.trim() && category !== "all"
      ? base.filter((e) => e.category === category)
      : base;

    return filtered.sort((a, b) => a.ko.localeCompare(b.ko, "ko"));
  }, [query, category]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── 헤더 ────────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={18} className="text-muted-foreground" />
          <h1 className="text-base font-semibold">용어 사전</h1>
          <span className="text-xs text-muted-foreground ml-auto">
            주식 · 퀀트 · 매매 전략 {CATEGORY_TABS[0].count}개 용어
          </span>
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="용어 검색 (한국어, 영어, 설명 포함)"
            className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border bg-muted/30 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            style={{ borderColor: "var(--border)" }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* 카테고리 탭 */}
        <div className="flex gap-1.5 mt-2.5">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setCategory(tab.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                category === tab.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 opacity-70">{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 본문 ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* 용어 목록 */}
        <div
          className={`overflow-y-auto ${selected ? "hidden md:flex md:flex-col md:w-72 lg:w-80 shrink-0" : "flex-1 flex flex-col"}`}
        >
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Search size={32} className="opacity-30" />
              <p className="text-sm">검색 결과가 없습니다</p>
              <p className="text-xs opacity-60">다른 키워드로 검색해 보세요</p>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {results.map((entry) => {
                const isActive = selected?.key === entry.key && selected?.category === entry.category;
                const colors   = CATEGORY_COLORS[entry.category];
                return (
                  <li key={`${entry.category}.${entry.key}`}>
                    <button
                      onClick={() => setSelected(isActive ? null : entry)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-muted/40 ${isActive ? "bg-muted/60" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold leading-tight">{entry.ko}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${colors.badge}`}>
                            {CATEGORY_LABEL[entry.category]}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug truncate">
                          {entry.en}
                        </p>
                      </div>
                      <span className="text-muted-foreground/40 text-[10px] shrink-0 mt-0.5">▶</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 용어 상세 패널 */}
        {selected && (
          <div
            className="flex-1 overflow-y-auto border-l"
            style={{ borderColor: "var(--border)" }}
          >
            <TermDetail entry={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TermDetail({
  entry,
  onClose,
}: {
  entry: TermEntryWithKey;
  onClose: () => void;
}) {
  const colors = CATEGORY_COLORS[entry.category];

  return (
    <div className="p-5 space-y-5 max-w-2xl">
      {/* 상단 닫기 + 배지 */}
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${colors.badge}`}>
          {CATEGORY_LABEL[entry.category]}
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors md:hidden"
        >
          <X size={16} />
        </button>
      </div>

      {/* 한국어 용어명 */}
      <div>
        <h2 className="text-xl font-bold leading-tight">{entry.ko}</h2>
        <p className="text-sm text-muted-foreground mt-1">{entry.en}</p>
      </div>

      {/* 설명 */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
          설명
        </h3>
        <p className="text-sm leading-relaxed">{entry.description}</p>
      </section>

      {/* 계산 공식 */}
      {entry.formula && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
            계산 공식
          </h3>
          <div
            className={`rounded-lg border px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap ${colors.ring} bg-muted/30`}
          >
            {entry.formula}
          </div>
        </section>
      )}

      {/* 실전 팁 */}
      {entry.tip && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
            실전 활용 팁
          </h3>
          <div
            className="rounded-lg border-l-2 pl-4 py-2 text-sm leading-relaxed text-muted-foreground"
            style={{ borderColor: "var(--primary)" }}
          >
            {entry.tip}
          </div>
        </section>
      )}
    </div>
  );
}
