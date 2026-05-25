"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function PendingPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [role, setRole]         = useState("pending");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setRole(data.user?.app_metadata?.role ?? "pending");
    });
  }, []);

  async function checkApproval() {
    setChecking(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.refreshSession();
      const newRole = data.user?.app_metadata?.role ?? "pending";
      setRole(newRole);
      if (newRole === "user")  router.push("/");
      if (newRole === "admin") router.push("/admin");
    } finally {
      setChecking(false);
    }
  }

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // 30초마다 자동 확인
  useEffect(() => {
    const id = setInterval(checkApproval, 30_000);
    return () => clearInterval(id);
  }, []);

  const isRejected = role === "rejected";

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border p-8 space-y-6 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex justify-center">
          {isRejected ? (
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <XCircle size={36} className="text-red" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-full bg-yellow-500/10 flex items-center justify-center">
              <Clock size={36} className="text-yellow" />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-bold">
            {isRejected ? "접근이 거절되었습니다" : "승인 대기 중"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRejected
              ? "관리자에 의해 접근 요청이 거절되었습니다.\n다른 이메일로 다시 요청하거나 관리자에게 문의하세요."
              : `${email ? `${email} 계정으로 ` : ""}접근 요청이 전송되었습니다.\n관리자(godkosj@gmail.com)가 승인하면 자동으로 접근이 허용됩니다.`}
          </p>
        </div>

        {!isRejected && (
          <div className="rounded-xl p-4 text-left space-y-2 text-sm" style={{ background: "var(--muted)" }}>
            <div className="flex items-center gap-2">
              <CheckCircle size={14} className="text-green shrink-0" />
              <span>가입 요청 완료</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-yellow shrink-0" />
              <span className="text-muted-foreground">관리자 승인 대기 중…</span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {!isRejected && (
            <button
              onClick={checkApproval}
              disabled={checking}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg border hover:bg-white/5 disabled:opacity-60 transition-colors"
              style={{ borderColor: "var(--border)" }}
            >
              <RefreshCw size={14} className={checking ? "animate-spin" : ""} />
              승인 여부 확인
            </button>
          )}
          <button
            onClick={handleLogout}
            className="w-full py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
