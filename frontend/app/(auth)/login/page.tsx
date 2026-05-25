"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); return; }

      const role = data.user?.app_metadata?.role ?? "pending";
      if (role === "admin")   router.push("/admin");
      else if (role === "user") router.push("/");
      else router.push("/pending");

      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl border p-8 space-y-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {/* 로고 */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
            <TrendingUp size={22} className="text-blue-400" />
          </div>
          <h1 className="text-lg font-bold">StockBoard</h1>
          <p className="text-xs text-muted-foreground">로그인하여 대시보드 접근</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="name@example.com"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-transparent outline-none focus:border-blue-500 transition-colors"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-transparent outline-none focus:border-blue-500 transition-colors"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          {error && (
            <p className="text-xs text-red px-3 py-2 rounded-lg bg-red-500/10">
              {error === "Invalid login credentials"
                ? "이메일 또는 비밀번호가 올바르지 않습니다."
                : error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 transition-colors"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            로그인
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          계정이 없으신가요?{" "}
          <Link href="/register" className="text-blue-400 hover:underline">
            접근 요청
          </Link>
        </p>
      </div>
    </div>
  );
}
