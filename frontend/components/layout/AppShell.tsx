"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

const AUTH_PATHS = ["/login", "/register", "/pending"];
const HB_KEY = "_hb_ts";
const HB_INTERVAL = 60 * 60 * 1000; // 1시간 throttle

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isAuthPage = AUTH_PATHS.includes(path);

  // 보호된 페이지 접속 시 last_seen_at 갱신 (1시간에 1회 제한)
  useEffect(() => {
    if (isAuthPage) return;
    try {
      const last = Number(localStorage.getItem(HB_KEY) ?? 0);
      if (Date.now() - last < HB_INTERVAL) return;
      fetch("/api/auth/heartbeat", { method: "POST" }).then(() => {
        localStorage.setItem(HB_KEY, String(Date.now()));
      }).catch(() => {});
    } catch {
      // localStorage 접근 불가(예: Safari 시크릿 모드) 시 매번 호출
      fetch("/api/auth/heartbeat", { method: "POST" }).catch(() => {});
    }
  }, [isAuthPage]);

  if (isAuthPage) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--background)" }}>
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0 app-main">
        {children}
      </main>
    </div>
  );
}
