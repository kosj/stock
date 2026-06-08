"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Briefcase, TrendingUp,
  Globe, BarChart2, Bell, Building2, Settings, Star,
  Menu, X, LogOut, Shield, Sparkles, Gamepad2, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const NAV = [
  { href: "/",              label: "대시보드",     icon: LayoutDashboard },
  { href: "/portfolio",     label: "포트폴리오",    icon: Briefcase },
  { href: "/mock",          label: "모의 투자",     icon: Gamepad2 },
  { href: "/watchlist",     label: "관심 종목",     icon: Star },
  { href: "/market",        label: "시세 분석",     icon: TrendingUp },
  { href: "/recommendations", label: "추천 종목",  icon: Sparkles },
  { href: "/macro",         label: "거시경제",      icon: Globe },
  { href: "/sectors",       label: "섹터 로테이션", icon: BarChart2 },
  { href: "/krx",           label: "국내증시 통계", icon: Building2 },
  { href: "/alerts",        label: "알림 설정",     icon: Bell },
  { href: "/glossary",      label: "용어 사전",     icon: BookOpen },
  { href: "/settings",      label: "API 설정",      icon: Settings },
];

const BOTTOM_NAV = NAV.slice(0, 4);
const MORE_NAV   = NAV.slice(4);

export function Sidebar() {
  const path     = usePathname();
  const router   = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userRole,  setUserRole]  = useState("");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? "");
      setUserRole(data.user?.app_metadata?.role ?? "");
    });
  }, []);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

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

          {/* 관리자 전용 메뉴 */}
          {userRole === "admin" && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors mt-1 border-t pt-3",
                path.startsWith("/admin")
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
              style={{ borderColor: "var(--border)", color: path.startsWith("/admin") ? "var(--primary)" : undefined }}
            >
              <Shield size={16} />
              사용자 관리
            </Link>
          )}
        </nav>

        {/* 사용자 정보 + 로그아웃 */}
        <div
          className="p-3 border-t shrink-0 space-y-1"
          style={{ borderColor: "var(--border)" }}
        >
          {userEmail && (
            <p className="px-2 text-xs text-muted-foreground truncate">{userEmail}</p>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 rounded-md transition-colors"
          >
            <LogOut size={13} />
            로그아웃
          </button>
        </div>
      </aside>

      {/* ── 모바일 하단 내비게이션 (md: 미만) ─────────────────────────────── */}

      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/40"
          onClick={() => setMoreOpen(false)}
        />
      )}

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
                    active ? "bg-blue-600/20 text-blue-400" : "text-muted-foreground hover:bg-white/5"
                  )}
                >
                  <Icon size={22} />
                  <span className="text-xs text-center leading-tight">{label}</span>
                </Link>
              );
            })}

            {/* 관리자 메뉴 */}
            {userRole === "admin" && (
              <Link
                href="/admin"
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors",
                  path.startsWith("/admin") ? "bg-blue-600/20 text-blue-400" : "text-muted-foreground hover:bg-white/5"
                )}
              >
                <Shield size={22} />
                <span className="text-xs text-center leading-tight">사용자 관리</span>
              </Link>
            )}

            {/* 로그아웃 */}
            <button
              onClick={() => { setMoreOpen(false); handleLogout(); }}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-muted-foreground hover:bg-white/5 transition-colors"
            >
              <LogOut size={22} />
              <span className="text-xs text-center leading-tight">로그아웃</span>
            </button>
          </div>

          {userEmail && (
            <p className="px-4 pb-3 text-xs text-muted-foreground text-center truncate">{userEmail}</p>
          )}
        </div>
      )}

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
