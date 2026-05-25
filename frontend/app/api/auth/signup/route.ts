import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "godkosj@gmail.com";

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "이메일과 비밀번호를 입력해주세요." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Supabase Auth로 사용자 생성
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: fullName ?? "" },
      app_metadata:  { role: email === ADMIN_EMAIL ? "admin" : "pending" },
      email_confirm: true, // 이메일 확인 없이 바로 생성
    });

    if (error) {
      if (error.message.includes("already registered") || error.message.includes("already been registered")) {
        return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // user_profiles 삽입 (트리거가 없는 경우 대비)
    await admin.from("user_profiles").upsert({
      id:           data.user!.id,
      email,
      full_name:    fullName ?? null,
      role:         email === ADMIN_EMAIL ? "admin" : "pending",
      requested_at: new Date().toISOString(),
    }, { onConflict: "id" });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[signup]", e);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
