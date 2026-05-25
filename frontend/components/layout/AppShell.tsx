"use client";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

const AUTH_PATHS = ["/login", "/register", "/pending"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const isAuthPage = AUTH_PATHS.includes(path);

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
