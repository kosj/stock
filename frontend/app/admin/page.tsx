"use client";
import { useEffect, useState } from "react";
import {
  CheckCircle, XCircle, Clock, Users,
  RefreshCw, Loader2, Trash2, AlertTriangle,
} from "lucide-react";

type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "pending" | "user" | "admin" | "rejected";
  requested_at: string;
  approved_at: string | null;
  last_sign_in_at: string | null;
};

type FilterTab = "pending" | "all";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "없음";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7)  return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

// ── 삭제 확인 다이얼로그 ─────────────────────────────────────────────────────

function DeleteConfirmDialog({
  user,
  onConfirm,
  onCancel,
  loading,
}: {
  user: UserProfile;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-sm mx-4 rounded-xl border p-6 space-y-4 shadow-2xl"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-red-500/15">
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <h2 className="text-base font-semibold">계정 삭제</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">{user.full_name || user.email}</span> 계정을 영구 삭제합니다.
          <br />포트폴리오·거래내역 등 모든 데이터가 삭제되며 복구할 수 없습니다.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 text-sm rounded-lg border transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 text-sm rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            영구 삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [users, setUsers]           = useState<UserProfile[]>([]);
  const [filter, setFilter]         = useState<FilterTab>("pending");
  const [loading, setLoading]       = useState(true);
  const [actionId, setActionId]     = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

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
      const res = await fetch(`/api/admin/users/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`${action === "approve" ? "승인" : "거절"} 실패: ${err.error ?? res.status}`);
        return;
      }
      await fetchUsers();
    } catch (e) {
      alert(`요청 중 오류: ${e}`);
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`삭제 실패: ${err.error ?? res.status}`);
        return;
      }
      setDeleteTarget(null);
      await fetchUsers();
    } catch (e) {
      alert(`삭제 중 오류: ${e}`);
    } finally {
      setDeleteLoading(false);
    }
  }

  const displayed    = filter === "pending" ? users.filter((u) => u.role === "pending") : users;
  const pendingCount = users.filter((u) => u.role === "pending").length;

  const roleLabel: Record<string, { text: string; cls: string }> = {
    pending:  { text: "대기중",  cls: "text-yellow-400 bg-yellow-500/10" },
    user:     { text: "승인됨",  cls: "text-green-400  bg-green-500/10"  },
    admin:    { text: "관리자",  cls: "text-blue-400   bg-blue-500/10"   },
    rejected: { text: "거절됨",  cls: "text-red-400    bg-red-500/10"    },
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* 삭제 확인 다이얼로그 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          user={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteLoading}
        />
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">사용자 관리</h1>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-400">
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
            <CheckCircle size={32} className="text-green-400 opacity-40" />
            <p className="text-sm">
              {filter === "pending" ? "대기중인 사용자가 없습니다" : "등록된 사용자가 없습니다"}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {/* 테이블 헤더 */}
            <div
              className="hidden md:grid px-4 py-2.5 text-xs font-medium text-muted-foreground"
              style={{
                background: "var(--muted)",
                gridTemplateColumns: "1fr 1fr 90px 110px 110px 36px",
              }}
            >
              <span>사용자</span>
              <span>이메일</span>
              <span>상태</span>
              <span>가입일</span>
              <span className="flex items-center gap-1">
                <Clock size={11} /> 마지막 접속
              </span>
              <span />
            </div>

            {displayed.map((user) => {
              const rl = roleLabel[user.role] ?? roleLabel.pending;
              const isProcessing = actionId === user.id;
              return (
                <div
                  key={user.id}
                  className="grid grid-cols-1 md:grid-cols-[auto] items-center gap-3 px-4 py-4"
                  style={{
                    background: "var(--card)",
                    gridTemplateColumns: "1fr 1fr 90px 110px 110px 36px",
                  }}
                >
                  {/* 이름 */}
                  <div>
                    <p className="text-sm font-medium">{user.full_name || "—"}</p>
                    <p className="text-xs text-muted-foreground md:hidden">{user.email}</p>
                  </div>

                  {/* 이메일 */}
                  <p className="hidden md:block text-sm text-muted-foreground truncate">
                    {user.email}
                  </p>

                  {/* 상태 */}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium w-fit ${rl.cls}`}>
                    {rl.text}
                  </span>

                  {/* 가입일 + 액션 */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(user.requested_at)}
                    </span>
                    {user.role === "pending" && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleAction(user.id, "approve")}
                          disabled={isProcessing}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md bg-green-600/20 text-green-400 hover:bg-green-600/30 disabled:opacity-50 transition-colors"
                        >
                          {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                          승인
                        </button>
                        <button
                          onClick={() => handleAction(user.id, "reject")}
                          disabled={isProcessing}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md bg-red-600/20 text-red-400 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
                        >
                          {isProcessing ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
                          거절
                        </button>
                      </div>
                    )}
                    {user.role === "user" && user.approved_at && (
                      <span className="text-xs text-muted-foreground">
                        승인: {formatDate(user.approved_at)}
                      </span>
                    )}
                  </div>

                  {/* 마지막 접속 */}
                  <div className="hidden md:block text-xs text-muted-foreground">
                    <div>{formatRelative(user.last_sign_in_at)}</div>
                    <div className="text-muted-foreground/50 text-[10px]">
                      {formatDate(user.last_sign_in_at)}
                    </div>
                  </div>

                  {/* 삭제 버튼 */}
                  <button
                    onClick={() => setDeleteTarget(user)}
                    title="계정 삭제"
                    className="hidden md:flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
