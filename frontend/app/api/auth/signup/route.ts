import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { ApiInputError, readBoundedJson } from "@/lib/server/api-security-policy";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await readBoundedJson(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const { email, password, fullName } = body as {
      email?: string;
      password?: string;
      fullName?: string;
    };

    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || typeof password !== "string" || password.length < 8 || password.length > 128
      || (fullName !== undefined && (typeof fullName !== "string" || fullName.length > 100))) {
      return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
    }

    // 서비스 롤 키 확인
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("[signup] SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
      return NextResponse.json({ error: "서버 설정 오류 (서비스 키 미설정)" }, { status: 500 });
    }

    const admin = createSupabaseAdminClient();
    // Roles are assigned by an existing administrator; supplied email is never authority.
    const role = "pending";

    // ── Supabase Auth 사용자 생성 ──────────────────────────────────────────────
    const { data, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: fullName ?? "" },
      app_metadata:  { role },
      email_confirm: true,
    });

    if (authError) {
      console.error("[signup] auth.admin.createUser 실패:", authError);
      const msg = authError.message;
      if (msg.includes("already registered") || msg.includes("already been registered") || msg.includes("already exists")) {
        return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (!data.user) {
      return NextResponse.json({ error: "사용자 생성에 실패했습니다." }, { status: 500 });
    }

    // ── user_profiles 삽입 (마이그레이션 실행 후 동작, 없으면 건너뜀) ──────────
    try {
      const { error: profileError } = await admin.from("user_profiles").upsert(
        {
          id:           data.user.id,
          email,
          full_name:    fullName ?? null,
          role,
          requested_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (profileError) {
        // 테이블 미존재 등 — 치명적이지 않으므로 경고만 남김
        console.warn("[signup] user_profiles 삽입 실패 (마이그레이션 확인 필요):", profileError.message);
      }
    } catch (profileEx) {
      console.warn("[signup] user_profiles 예외 (무시):", profileEx);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof ApiInputError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[signup] 예상치 못한 오류:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
