import { NextRequest, NextResponse } from "next/server";
import { KrxService } from "@/lib/server/krx-service";

export const dynamic     = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: NextRequest) {
  try {
    const data = await KrxService.getDashboard();
    return NextResponse.json(data);
  } catch (error) {
    // 조회 실패 시 하드코딩 표본값을 200으로 반환하던 것을 제거한다.
    // 가짜 수급/지수 값이 실측처럼 화면과 스코어링에 쓰이는 것이 더 위험하다.
    const message = error instanceof Error ? error.message : "KRX 데이터 조회 실패";
    console.error(`[krx] ${message}`);
    return NextResponse.json(
      { error: "KRX 데이터를 불러오지 못했습니다.", detail: message, stale: true },
      { status: 503 },
    );
  }
}
