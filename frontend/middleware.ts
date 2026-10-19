import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { apiAccessPolicy, isApprovedRole } from "./lib/server/api-security-policy";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;

  const isApi = pathname.startsWith("/api/");
  const policy = isApi ? apiAccessPolicy(pathname) : null;
  // Public auth endpoints self-authenticate where needed; cron uses its own secret.
  if (
    pathname.startsWith("/_next/") ||
    policy === "public" ||
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
    return NextResponse.json({ error: "인증 서비스 설정이 필요합니다." }, { status: 503 });
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
    return NextResponse.json({ error: "인증 서비스를 사용할 수 없습니다." }, { status: 503 });
  }

  if (isApi) {
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
    const role: unknown = user.app_metadata?.role;
    if (!isApprovedRole(role) || (policy === "admin" && role !== "admin")) {
      return NextResponse.json({ error: "권한 없음" }, { status: 403 });
    }
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
  if (!isApprovedRole(role) && pathname !== "/pending") {
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
