import { NextRequest, NextResponse } from "next/server";

// 시간 기반 의사난수 생성 (같은 시간대에는 같은 값)
function timeBasedRandom(seed: string): number {
  const now = new Date();
  const minutes = Math.floor(now.getTime() / (1000 * 60)); // 1분 단위
  const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const combined = (hash * 9301 + 49297 * minutes) % 233280;
  return (combined / 233280);
}

export async function GET(request: NextRequest) {
  // 동적으로 생성된 포트폴리오 데이터
  const generatePortfolio = (id: number, name: string, baseValue: number) => {
    const variation = (timeBasedRandom(`portfolio-${id}-pnl`) - 0.5) * 10; // -5% ~ +5%
    const total_invested = baseValue;
    const total_pnl = Math.round(baseValue * (variation / 100));
    const total_value = total_invested + total_pnl;
    const total_pnl_percent = (total_pnl / total_invested) * 100;

    return {
      id,
      name,
      description: id === 1 ? "주식 투자 포트폴리오" : "ETF 투자 포트폴리오",
      total_invested,
      total_value,
      total_pnl,
      total_pnl_percent: Math.round(total_pnl_percent * 100) / 100,
      timestamp: new Date().toISOString()
    };
  };

  return NextResponse.json([
    generatePortfolio(1, "메인 포트폴리오", 4750000),
    generatePortfolio(2, "ETF 포트폴리오", 2850000)
  ]);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  return NextResponse.json({
    id: 3,
    name: body.name,
    description: body.description,
    total_invested: 0,
    total_value: 0,
    total_pnl: 0,
    total_pnl_percent: 0,
    timestamp: new Date().toISOString()
  }, { status: 201 });
}
