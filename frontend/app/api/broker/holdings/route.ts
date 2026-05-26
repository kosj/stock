import { NextRequest, NextResponse } from "next/server";
import { KISProvider } from "@/lib/server/providers";
import type { BrokerCredentials } from "@/lib/server/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

    const credentials: BrokerCredentials = { appKey, appSecret, accountNumber, isDemo: !!isDemo };
    const provider = new KISProvider(credentials);
    const holdings = await provider.getPositions();

    return NextResponse.json({ holdings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[broker/holdings] 오류:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
