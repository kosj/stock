"use client";

/**
 * ApartmentGuidePage — 아파트 선택 체크리스트
 * 정적 가이드. "무엇을 볼지"와 "어디서 확인하는지"를 함께 제시한다.
 */

import { useState } from "react";
import { ClipboardCheck, ChevronDown, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { WealthTabs } from "./WealthTabs";
import { APT_CHECKLIST } from "@/lib/realestate-guide";

export function ApartmentGuidePage() {
  const [open, setOpen] = useState<string | null>(APT_CHECKLIST[0]?.key ?? null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const total = APT_CHECKLIST.reduce((n, s) => n + s.items.length, 0);
  const done = Object.values(checked).filter(Boolean).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <header>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ClipboardCheck size={20} className="text-blue-400" /> 아파트 선택 방법
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          입지 → 단지 → 세대 → 자금 순으로 확인합니다. 앞쪽일수록 나중에 바꿀 수 없는 조건입니다.
        </p>
      </header>

      <WealthTabs />

      {/* 진행률 */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">확인 진행률</span>
          <span className="text-sm tabular-nums text-muted-foreground">{done} / {total}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          체크 상태는 이 화면에서만 유지됩니다(저장되지 않음).
        </p>
      </Card>

      {APT_CHECKLIST.map((sec) => {
        const isOpen = open === sec.key;
        const secDone = sec.items.filter((_, i) => checked[`${sec.key}-${i}`]).length;
        return (
          <Card key={sec.key} className="p-0 overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : sec.key)}
              className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-white/5 transition-colors"
            >
              <div className="min-w-0">
                <h2 className="text-sm font-bold">{sec.title}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{sec.weightHint}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs tabular-nums text-muted-foreground">{secDone}/{sec.items.length}</span>
                <ChevronDown size={16} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-2">
                {sec.items.map((it, i) => {
                  const key = `${sec.key}-${i}`;
                  return (
                    <div key={key} className="rounded-lg p-3" style={{ background: "var(--background)" }}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!checked[key]}
                          onChange={(e) => setChecked((c) => ({ ...c, [key]: e.target.checked }))}
                          className="mt-1 shrink-0 accent-blue-500 w-4 h-4"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{it.title}</div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{it.detail}</p>
                          <p className="text-[11px] text-blue-400/80 mt-1.5">확인 방법 · {it.how}</p>
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground/60 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        일반적인 판단 기준을 정리한 참고 자료이며 특정 매물에 대한 투자 권유가 아닙니다.
        제도·세율은 변경될 수 있으니 계약 전 반드시 원문(국토교통부·지자체 고시)을 확인하세요.
      </p>
    </div>
  );
}
