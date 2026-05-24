import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // AI 분석 결과 샘플
    return NextResponse.json({
      id: parseInt(id),
      message: "AI 분석 완료",
      updated_positions: [
        {
          id: 1,
          ticker: "000660",
          name: "SK하이닉스",
          stop_loss: 55000,
          target_price: 75000,
          strategy: "상승 추세 진행 중, 지지선 $55,000 설정"
        },
        {
          id: 2,
          ticker: "005930",
          name: "삼성전자",
          stop_loss: 65000,
          target_price: 85000,
          strategy: "강한 지지선 확보, 목표가 상향"
        },
        {
          id: 3,
          ticker: "051910",
          name: "LG화학",
          stop_loss: 570000,
          target_price: 700000,
          strategy: "박스권 이탈 대기, 주가 모멘텀 강함"
        }
      ],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Portfolio auto-fill API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
