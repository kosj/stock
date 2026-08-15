"use client";

/**
 * RealEstateTermsPage — 부동산 용어 설명 (용적률·건폐율 등)
 * 계산식과 숫자 예시, "왜 중요한가"를 함께 제시한다.
 */

import { useState, useMemo } from "react";
import { BookOpen, Search, Info, Calculator } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { WealthTabs } from "./WealthTabs";
import { RE_TERMS, type TermCategory } from "@/lib/realestate-guide";

const CATEGORIES: (TermCategory | "전체")[] = [
  "전체", "밀도·규모", "면적", "청약", "자금·규제", "권리·기타",
];

export function RealEstateTermsPage() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<TermCategory | "전체">("전체");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return RE_TERMS.filter((t) => {
      if (cat !== "전체" && t.category !== cat) return false;
      if (!q) return true;
      return (
        t.term.toLowerCase().includes(q) ||
        t.short.toLowerCase().includes(q) ||
        t.why.toLowerCase().includes(q)
      );
    });
  }, [query, cat]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <header>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BookOpen size={20} className="text-blue-400" /> 부동산 용어 설명
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          용적률·건폐율·전용면적 등 계약 전 알아야 할 용어를 계산식과 예시로 정리했습니다.
        </p>
      </header>

      <WealthTabs />

      {/* 검색 + 분류 */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="용어 검색 (예: 용적률, 전용면적, DSR)"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border bg-transparent outline-none focus:border-blue-500 transition-colors"
            style={{ borderColor: "var(--border)" }}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                cat === c ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><p className="text-sm text-muted-foreground">검색 결과가 없습니다.</p></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Card key={t.term}>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold">{t.term}</h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {t.category}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t.short}</p>

              {t.formula && (
                <div className="mt-2 rounded-lg p-2.5 flex items-start gap-2" style={{ background: "var(--background)" }}>
                  <Calculator size={13} className="text-blue-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <code className="text-xs text-blue-400 break-words">{t.formula}</code>
                    {t.example && (
                      <p className="text-[11px] text-muted-foreground mt-1 break-words">예) {t.example}</p>
                    )}
                  </div>
                </div>
              )}
              {!t.formula && t.example && (
                <p className="text-[11px] text-muted-foreground mt-1.5">예) {t.example}</p>
              )}

              <div className="mt-2 flex items-start gap-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium shrink-0 mt-0.5">
                  왜 중요한가
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">{t.why}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground/60 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        제도 수치(청약가점 배점, LTV·DSR 규제 등)는 정책에 따라 변경됩니다.
        실제 적용 기준은 청약홈·국토교통부 공고와 금융기관 안내를 확인하세요.
      </p>
    </div>
  );
}
