import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

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

    const res = await fetch(`${BACKEND}/api/broker/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey, appSecret, accountNumber, isDemo: !!isDemo }),
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data?.detail ?? data?.error ?? `Railway HTTP ${res.status}`;
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[broker/holdings] 오류:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
