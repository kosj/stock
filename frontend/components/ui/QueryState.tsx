"use client";

/**
 * QueryState — 로딩·실패·빈 데이터를 화면 단위로 구분해 표시
 * ============================================================================
 * 기존에는 대부분의 화면이 로딩만 처리하고 실패는 다루지 않아, 요청이 실패하면
 * 빈 화면이나 영구 스켈레톤이 남았다. 사용자는 "데이터가 없다"고 오해한다.
 * 이 컴포넌트로 세 상태를 강제 구분한다:
 *   loading  → 스켈레톤
 *   error    → 원인 문구 + 재시도
 *   empty    → "데이터 없음"(실패가 아님을 명시)
 */

import { AlertTriangle, RefreshCw, Inbox } from "lucide-react";
import { errorMessage } from "@/lib/fetcher";

export function QueryState({
  loading,
  error,
  isEmpty,
  onRetry,
  emptyText = "표시할 데이터가 없습니다.",
  skeletonRows = 3,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  emptyText?: string;
  skeletonRows?: number;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-busy="true">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg animate-pulse bg-muted" />
        ))}
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
        <Inbox size={20} />
        <p className="text-sm">{emptyText}</p>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * ErrorState — 실패 표시 단독 컴포넌트.
 *
 * 기존 화면은 저마다 스켈레톤·빈 상태 디자인이 있어 QueryState 로 통째로
 * 감싸면 모양이 바뀐다. 그런 화면은 기존 삼항 분기에 이것만 끼워 넣는다:
 *   isLoading ? <스켈레톤/> : error ? <ErrorState/> : rows.length === 0 ? <빈상태/> : <목록/>
 * 핵심은 "실패"와 "0건"을 다른 문구로 보여주는 것이다.
 *
 * title 로 무엇을 못 불러왔는지 밝힌다(한 화면에 패널이 여럿일 때 필요).
 */
export function ErrorState({
  error,
  onRetry,
  title = "데이터를 불러오지 못했습니다",
  className = "",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-4 text-sm ${className}`}
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
      role="alert"
    >
      <div className="flex items-start gap-2 text-red-400">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">{errorMessage(error)}</p>
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-muted hover:bg-white/10 transition-colors"
        >
          <RefreshCw size={12} /> 다시 시도
        </button>
      )}
    </div>
  );
}
