import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "주식 대시보드",
  description: "한국투자증권 포트폴리오 관리, AI 분석, 거시경제 모니터링",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#080f1a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="flex h-full">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  );
}
