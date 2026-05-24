import type { NextConfig } from "next";
import path from "path";

// 백엔드 URL: 로컬 개발은 localhost:8000, 배포는 BACKEND_URL 환경변수
// Vercel 환경변수에 BACKEND_URL=https://your-app.railway.app 설정 필요
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },

  // Vercel → Railway 프록시 (CORS 우회, Railway URL 숨김)
  // 브라우저: /api/* → Vercel Edge → BACKEND_URL/api/* (서버 사이드 프록시)
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
      { source: "/ws/:path*",  destination: `${BACKEND_URL}/ws/:path*` },
      { source: "/health",     destination: `${BACKEND_URL}/health` },
    ];
  },

  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
