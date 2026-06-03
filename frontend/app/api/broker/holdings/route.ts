import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFirstBrokerConfig } from "@/lib/server/broker-config";
import { createBrokerProvider } from "@/lib/server/providers";
import type { BrokerType } from "@/lib/server/providers";

export const dynamic     = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    // 1. 인증된 사용자 확인
    const serverClient = await createSupabaseServerClient();
    const { data: { user } } = await serverClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    // 2. DB에서 가장 최근에 설정된 증권사 자격증명 조회
    const config = await getFirstBrokerConfig(user.id);
    if (!config) {
      return NextResponse.json(
        { error: "등록된 증권사 API 키가 없습니다. 설정 → API 설정에서 증권사 키와 계좌번호를 먼저 등록해주세요." },
        { status: 400 },
      );
    }

    if (!config.accountNumber) {
      return NextResponse.json(
        { error: "계좌번호가 등록되지 않았습니다. 설정 → API 설정에서 계좌번호를 입력해주세요." },
        { status: 400 },
      );
    }

    // 3. isDemo 플래그 (KIS 모의투자 전용)
    let isDemo = false;
    try {
      const body = await request.json();
      isDemo = !!body?.isDemo;
    } catch { /* body 없어도 진행 */ }

    // 4. 증권사 프로바이더 생성 및 잔고 조회
    const provider = createBrokerProvider(config.type as BrokerType, {
      appKey:        config.appKey.trim(),
      appSecret:     config.appSecret.trim(),
      accountNumber: config.accountNumber.replace(/[\s]/g, ""),
      isDemo,
    });

    const holdings = await provider.getPositions();
    return NextResponse.json({ holdings, brokerType: config.type });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[broker/holdings] 오류:", msg);

    // 에러 메시지에서 힌트 자동 감지
    const hint =
      msg.includes("IP") || msg.includes("화이트리스트")
        ? "개발자 포털 → 앱 관리 → IP 설정에서 0.0.0.0(전체 허용)으로 설정되어 있는지 확인하세요."
        : msg.includes("AppKey") || msg.includes("인증") || msg.includes("토큰")
        ? "설정 페이지에서 AppKey·AppSecret을 다시 저장하거나, 증권사 개발자 포털에서 앱 활성화 상태를 확인하세요."
        : undefined;

    return NextResponse.json(
      { error: msg, ...(hint ? { hint } : {}) },
      { status: 502 },
    );
  }
}
