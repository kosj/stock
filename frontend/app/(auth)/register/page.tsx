"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, Loader2 } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    if (password.length < 6)  { setError("비밀번호는 최소 6자 이상이어야 합니다."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName }),
      });
      let data: { success?: boolean; error?: string } = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        setError(data.error ?? `서버 오류 (${res.status})`);
        return;
      }
      router.push("/pending");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl border p-8 space-y-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
            <TrendingUp size={22} className="text-blue-400" />
          </div>
          <h1 className="text-lg font-bold">접근 요청</h1>
          <p className="text-xs text-muted-foreground text-center">
            관리자 승인 후 StockBoard를 이용할 수 있습니다
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">이름</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="홍길동"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-transparent outline-none focus:border-blue-500 transition-colors"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
              placeholder="••••••••"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-transparent outline-none focus:border-blue-500 transition-colors"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">비밀번호 확인</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full px-3 py-2 text-sm rounded-lg border bg-transparent outline-none focus:border-blue-500 transition-colors"
              style={{ borderColor: "var(--border)" }}
            />
          </div>

          {error && (
            <p className="text-xs text-red px-3 py-2 rounded-lg bg-red-500/10">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 transition-colors"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            접근 요청 보내기
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="text-blue-400 hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
