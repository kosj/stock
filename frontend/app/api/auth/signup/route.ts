import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { ApiInputError, readBoundedJson } from "@/lib/server/api-security-policy";

export const dynamic = "force-dynamic";

/** Keyed hash of the client address: the throttle never stores raw IP addresses. */
function clientKey(req: Request): string {
  const address = req.headers.get("x-real-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update(address).digest("hex");
}

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
    // Throttle before any account is created; fail closed if the limiter is unavailable.
    const quota = await admin.rpc("consume_signup_quota", { p_client: clientKey(req) });
    if (quota.error || typeof quota.data !== "boolean") {
      return NextResponse.json({ error: "가입 요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요." }, { status: 503 });
    }
    if (!quota.data) {
      return NextResponse.json({ error: "가입 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429, headers: { "Retry-After": "3600" } });
    }

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
      console.error("[signup] auth.admin.createUser 실패:", authError.status ?? "", authError.code ?? "");
      const msg = authError.message ?? "";
      if (msg.includes("already registered") || msg.includes("already been registered") || msg.includes("already exists")) {
        return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
      }
      return NextResponse.json({ error: "가입 요청을 처리할 수 없습니다. 입력값을 확인해주세요." }, { status: 400 });
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
    console.error("[signup] 예상치 못한 오류:", e instanceof Error ? e.name : typeof e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
