import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 간단한 의사난수: 현재 시간 기반
function getRandomVariation(seed: string): number {
  const now = Date.now();
  const seedHash = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const combined = (seedHash * 12345 + now) % 1000;
  return (combined / 1000) - 0.5; // -0.5 ~ 0.5
}

export async function GET(request: NextRequest) {
  const now = new Date();

  // 동적으로 생성된 포트폴리오 데이터
  const generatePortfolio = (id: number, name: string, baseValue: number) => {
    const variation = getRandomVariation(`portfolio-${id}-pnl`) * 12; // -6% ~ +6%
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
      timestamp: now.toISOString()
    };
  };

  return NextResponse.json([
    generatePortfolio(1, "메인 포트폴리오", 4750000),
    generatePortfolio(2, "ETF 포트폴리오", 2850000)
  ], {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
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
