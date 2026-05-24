import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 간단한 의사난수: 현재 시간 기반 (밀리초 단위로 변동)
function getRandomVariation(seed: string): number {
  const now = Date.now();
  const seedHash = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const combined = (seedHash * 12345 + now) % 1000;
  return (combined / 1000) - 0.5; // -0.5 ~ 0.5
}

// 가격 변동 생성
function generatePrice(basePrice: number, seed: string): number {
  const variation = getRandomVariation(seed) * 6; // -3% ~ +3%
  return Math.round(basePrice * (1 + variation / 100) * 100) / 100;
}

export async function GET(request: NextRequest) {
  const basePrices = {
    KOSPI: 2700,
    KOSDAQ: 900,
    "S&P500": 5100,
    NASDAQ: 16200,
    "달러/원": 1280
  };

  const now = new Date();
  const indices: Record<string, any> = {};

  for (const [key, basePrice] of Object.entries(basePrices)) {
    const currentPrice = generatePrice(basePrice, `${key}-price`);
    const changeAmount = currentPrice - basePrice;
    const changePct = (changeAmount / basePrice) * 100;

    indices[key] = {
      price: currentPrice,
      change: Math.round(changeAmount * 100) / 100,
      change_pct: Math.round(changePct * 100) / 100
    };
  }

  return NextResponse.json(
    {
      ...indices,
      _timestamp: now.toISOString(),
      _requestId: `${now.getTime()}-${Math.random()}`
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    }
  );
}
