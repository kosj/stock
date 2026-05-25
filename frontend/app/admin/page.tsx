"use client";
import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Clock, Users, RefreshCw, Loader2 } from "lucide-react";

type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "pending" | "user" | "admin" | "rejected";
  requested_at: string;
  approved_at: string | null;
};

type FilterTab = "pending" | "all";

export default function AdminPage() {
  const [users, setUsers]       = useState<UserProfile[]>([]);
  const [filter, setFilter]     = useState<FilterTab>("pending");
  const [loading, setLoading]   = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  async function fetchUsers() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) setUsers(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  async function handleAction(id: string, action: "approve" | "reject") {
    setActionId(id);
    try {
      await fetch(`/api/admin/users/${id}/${action}`, { method: "POST" });
      await fetchUsers();
    } finally {
      setActionId(null);
    }
  }

  const displayed = filter === "pending"
    ? users.filter((u) => u.role === "pending")
    : users;

  const pendingCount = users.filter((u) => u.role === "pending").length;

  const roleLabel: Record<string, { text: string; cls: string }> = {
    pending:  { text: "대기중",  cls: "text-yellow bg-yellow-500/10" },
    user:     { text: "승인됨",  cls: "text-green bg-green-500/10" },
    admin:    { text: "관리자",  cls: "text-blue-400 bg-blue-500/10" },
    rejected: { text: "거절됨",  cls: "text-red bg-red-500/10" },
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">사용자 관리</h1>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow">
              {pendingCount}명 대기중
            </span>
          )}
        </div>
        <button
          onClick={fetchUsers}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          새로고침
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: "var(--muted)" }}>
        {(["pending", "all"] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              filter === tab
                ? "bg-blue-600 text-white font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "pending" ? `대기중 (${pendingCount})` : `전체 (${users.length})`}
          </button>
        ))}
      </div>

      {/* 사용자 목록 */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">불러오는 중…</span>
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <CheckCircle size={32} className="text-green opacity-40" />
            <p className="text-sm">
              {filter === "pending" ? "대기중인 사용자가 없습니다" : "등록된 사용자가 없습니다"}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {/* 테이블 헤더 */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_120px_160px] px-4 py-2.5 text-xs font-medium text-muted-foreground"
                 style={{ background: "var(--muted)" }}>
              <span>사용자</span>
              <span>이메일</span>
              <span>상태</span>
              <span>가입일</span>
            </div>

            {displayed.map((user) => {
              const rl = roleLabel[user.role] ?? roleLabel.pending;
              const isProcessing = actionId === user.id;
              return (
                <div
                  key={user.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_160px] items-center gap-3 px-4 py-4"
                  style={{ background: "var(--card)" }}
                >
                  {/* 이름 + 이메일 (모바일 통합) */}
                  <div>
                    <p className="text-sm font-medium">{user.full_name || "—"}</p>
                    <p className="text-xs text-muted-foreground md:hidden">{user.email}</p>
                  </div>
                  <p className="hidden md:block text-sm text-muted-foreground">{user.email}</p>

                  {/* 상태 */}
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium w-fit ${rl.cls}`}>
                    {rl.text}
                  </span>

                  {/* 날짜 + 액션 */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {new Date(user.requested_at).toLocaleDateString("ko-KR")}
                    </span>

                    {user.role === "pending" && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleAction(user.id, "approve")}
                          disabled={isProcessing}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1 text-xs rounded-md bg-green-600/20 text-green hover:bg-green-600/30 disabled:opacity-50 transition-colors"
                        >
                          {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                          승인
                        </button>
                        <button
                          onClick={() => handleAction(user.id, "reject")}
                          disabled={isProcessing}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-600/20 text-red hover:bg-red-600/30 disabled:opacity-50 transition-colors"
                        >
                          {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
                          거절
                        </button>
                      </div>
                    )}
                    {user.role === "user" && user.approved_at && (
                      <span className="text-xs text-muted-foreground">
                        승인: {new Date(user.approved_at).toLocaleDateString("ko-KR")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
