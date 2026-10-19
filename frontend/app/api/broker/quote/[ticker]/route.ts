import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { getFirstBrokerConfig } from "@/lib/server/broker-config";
import { createBrokerProvider, type BrokerType } from "@/lib/server/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { ticker } = await params;
  if (!/^\d{6}$/.test(ticker)) return NextResponse.json({ error: "KIS 국내 종목코드는 6자리 숫자입니다." }, { status: 400 });
  try {
    const config = await getFirstBrokerConfig(auth.userId);
    if (!config) return NextResponse.json({ error: "설정 → API 설정에서 증권사 키를 등록해주세요." }, { status: 400 });
    const provider = createBrokerProvider(config.type as BrokerType, { ...config, cacheScope: auth.userId });
    return NextResponse.json(await provider.getQuote(ticker), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "증권사 시세 조회 실패" }, { status: 502 }); }
}
