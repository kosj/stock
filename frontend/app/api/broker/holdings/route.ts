import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Supabase Edge Function URL: ${SUPABASE_URL}/functions/v1/kis-holdings
// SUPABASE_URL은 이미 Vercel에 설정된 환경변수
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { appKey, appSecret, accountNumber, isDemo } = body;

    if (!appKey || !appSecret) {
      return NextResponse.json({ error: "appKey와 appSecret이 필요합니다" }, { status: 400 });
    }
    if (!accountNumber) {
      return NextResponse.json(
        { error: "계좌번호가 필요합니다. 설정 → API 설정에서 계좌번호(8자리+상품코드 2자리, 예: 12345678-01)를 입력해주세요." },
        { status: 400 },
      );
    }

    if (!SUPABASE_URL) {
      return NextResponse.json(
        { error: "SUPABASE_URL 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const edgeFnUrl = `${SUPABASE_URL}/functions/v1/kis-holdings`;

    const res = await fetch(edgeFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SUPABASE_ANON_KEY ? { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } : {}),
      },
      body: JSON.stringify({ appKey, appSecret, accountNumber, isDemo: !!isDemo }),
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error ?? `Supabase Edge Function HTTP ${res.status}`;
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[broker/holdings] 오류:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
