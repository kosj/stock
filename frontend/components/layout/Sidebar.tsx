"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Briefcase, TrendingUp,
  Globe, BarChart2, Bell, Building2, Settings, Star,
  Menu, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/",          label: "대시보드",     icon: LayoutDashboard },
  { href: "/portfolio", label: "포트폴리오",    icon: Briefcase },
  { href: "/watchlist", label: "관심 종목",     icon: Star },
  { href: "/market",    label: "시세 분석",     icon: TrendingUp },
  { href: "/macro",     label: "거시경제",      icon: Globe },
  { href: "/sectors",   label: "섹터 로테이션", icon: BarChart2 },
  { href: "/krx",       label: "국내증시 통계", icon: Building2 },
  { href: "/alerts",    label: "알림 설정",     icon: Bell },
  { href: "/settings",  label: "API 설정",      icon: Settings },
];

// 하단 탭 바 4개 + 더보기
const BOTTOM_NAV = NAV.slice(0, 4);
const MORE_NAV   = NAV.slice(4);

export function Sidebar() {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  const isMoreActive = MORE_NAV.some(({ href }) => isActive(href));

  return (
    <>
      {/* ── 데스크톱 사이드바 (md: 이상) ──────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col w-56 shrink-0 border-r"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center gap-2 px-4 py-5 border-b shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <TrendingUp size={20} className="text-blue-400" />
          <span className="font-bold text-sm tracking-wide">StockBoard</span>
        </div>

        {/* 네비게이션 — 가로 모드에서 높이 부족 시 스크롤 */}
        <nav className="flex flex-col gap-0.5 p-2 flex-1 overflow-y-auto min-h-0">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                  active
                    ? "bg-blue-600/20 text-blue-400 font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
                style={{ color: active ? "var(--primary)" : undefined }}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div
          className="p-4 text-xs text-muted-foreground border-t shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          v1.0.0 · Mock 모드
        </div>
      </aside>

      {/* ── 모바일 하단 내비게이션 (md: 미만) ─────────────────────────────── */}

      {/* 더보기 열림 시 배경 오버레이 */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* 더보기 드로어 — 하단 탭 바 바로 위 */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-x-0 z-40 border-t rounded-t-2xl"
          style={{
            bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))",
            background: "var(--card)",
            borderColor: "var(--border)",
          }}
        >
          <div className="p-3 grid grid-cols-3 gap-2">
            {MORE_NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors",
                    active
                      ? "bg-blue-600/20 text-blue-400"
                      : "text-muted-foreground hover:bg-white/5"
                  )}
                >
                  <Icon size={22} />
                  <span className="text-xs text-center leading-tight">{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 하단 탭 바 */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-50 flex border-t"
        style={{
          background: "var(--card)",
          borderColor: "var(--border)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {BOTTOM_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMoreOpen(false)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors",
                active ? "text-blue-400" : "text-muted-foreground"
              )}
            >
              <Icon size={20} />
              <span className="text-[10px] leading-none">{label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors",
            moreOpen || isMoreActive ? "text-blue-400" : "text-muted-foreground"
          )}
        >
          {moreOpen ? <X size={20} /> : <Menu size={20} />}
          <span className="text-[10px] leading-none">더보기</span>
        </button>
      </nav>
    </>
  );
}
