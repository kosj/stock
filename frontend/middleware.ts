import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

  // 정적 자산 및 API 제외
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js"
  ) {
    return response;
  }

  // NEXT_PUBLIC_ 변수가 없으면 서버 전용 변수로 폴백 (Vercel 환경변수 미설정 대비)
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL     ?? process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // 환경변수 미설정 시 미들웨어 무력화 (500 방지) — Vercel에 NEXT_PUBLIC_ 변수를 추가하세요
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    }
  );

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Supabase 연결 실패 시 인증 없이 통과 (503 방지)
    return response;
  }

  const isAuthPage = pathname === "/login" || pathname === "/register" || pathname === "/pending";

  // 미인증 → 로그인 페이지로
  if (!user) {
    if (!isAuthPage) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return response;
  }

  // 인증된 사용자의 역할 확인 (app_metadata에서 읽음)
  const role = (user.app_metadata?.role as string) ?? "pending";

  // 이미 로그인된 상태에서 로그인/회원가입 페이지 접근 → 역할에 따라 리다이렉트
  if (pathname === "/login" || pathname === "/register") {
    if (role === "admin") return NextResponse.redirect(new URL("/admin", request.url));
    if (role === "user")  return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.redirect(new URL("/pending", request.url));
  }

  // 대기중/거절된 사용자 → pending 페이지만 허용
  if ((role === "pending" || role === "rejected") && pathname !== "/pending") {
    return NextResponse.redirect(new URL("/pending", request.url));
  }

  // 승인된 사용자가 pending 페이지 접근 → 홈으로
  if (pathname === "/pending" && (role === "user" || role === "admin")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // 어드민 페이지 → admin role만 허용
  if (pathname.startsWith("/admin") && role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js).*)"],
};
