/**
 * requireUser — API 라우트 인증 게이트
 * ============================================================================
 * 왜 필요한가:
 *   미들웨어의 공통 API 검사에 더해 각 API 라우트에서도 승인 역할을 검사한다.
 *   이전에는 같은 getUserId() 코드가 11개 라우트에
 *   복붙돼 있었고 누락된 라우트(portfolio/positions, portfolio/[id]/auto-fill,
 *   push/alerts)에서 "인증 없이 남의 데이터 조회·수정" 취약점이 발생했다.
 *   또한 이 라우트들은 service-role 클라이언트를 쓰므로 RLS로도 막히지 않는다.
 *
 * 사용:
 *   const auth = await requireUser();
 *   if (!auth.ok) return auth.response;      // 401/403 반환
 *   auth.userId 로 사용자 스코프 질의
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isApprovedRole } from "./api-security-policy";

export type AuthResult =
  | { ok: true;  userId: string; role: "user" | "admin"; email?: string }
  | { ok: false; response: NextResponse };

export async function requireUser(adminOnly = false): Promise<AuthResult> {
  try {
    const client = await createSupabaseServerClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user?.id) {
      return { ok: false, response: NextResponse.json({ error: "인증 필요" }, { status: 401 }) };
    }
    const role: unknown = user.app_metadata?.role;
    if (!isApprovedRole(role) || (adminOnly && role !== "admin")) {
      return { ok: false, response: NextResponse.json({ error: "승인된 계정 권한이 필요합니다." }, { status: 403 }) };
    }
    return { ok: true, userId: user.id, role, email: user.email };
  } catch {
    // 인증 확인 자체가 실패하면 통과시키지 않는다(fail-closed).
    return { ok: false, response: NextResponse.json({ error: "인증 확인 실패" }, { status: 401 }) };
  }
}

export const requireApprovedUser = requireUser;
export const requireAdmin = () => requireUser(true);

/** 로그인 사용자가 해당 포트폴리오의 소유자인지 검증 */
export async function assertPortfolioOwner(
  supabase: { from: (t: string) => any },   // eslint-disable-line @typescript-eslint/no-explicit-any
  portfolioId: number | string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
