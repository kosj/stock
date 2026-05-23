"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Briefcase, TrendingUp,
  Globe, BarChart2, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/",         label: "대시보드",      icon: LayoutDashboard },
  { href: "/portfolio",label: "포트폴리오",     icon: Briefcase },
  { href: "/market",   label: "시세 분석",     icon: TrendingUp },
  { href: "/macro",    label: "거시경제",       icon: Globe },
  { href: "/sectors",  label: "섹터 로테이션",  icon: BarChart2 },
  { href: "/alerts",   label: "알림 설정",      icon: Bell },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside
      className="hidden md:flex flex-col w-56 shrink-0 border-r"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {/* 로고 */}
      <div className="flex items-center gap-2 px-4 py-5 border-b" style={{ borderColor: "var(--border)" }}>
        <TrendingUp size={20} className="text-blue-400" />
        <span className="font-bold text-sm tracking-wide">StockBoard</span>
      </div>

      {/* 네비게이션 */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
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

      <div className="p-4 text-xs text-muted-foreground border-t" style={{ borderColor: "var(--border)" }}>
        v1.0.0 · Mock 모드
      </div>
    </aside>
  );
}
