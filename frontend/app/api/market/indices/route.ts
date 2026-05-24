import { NextRequest, NextResponse } from "next/server";

// 초 단위 기반 의사난수 생성 (매 요청마다 다른 값 반환 - 10초 단위)
function timeBasedRandom(seed: string): number {
  const now = new Date();
  const seconds = Math.floor(now.getTime() / (1000 * 10)); // 10초 단위
  const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const combined = (hash * 9301 + 49297 * seconds) % 233280;
  return (combined / 233280);
}

// 가격 변동 생성 (기본 가격 기준으로 ±3% 범위)
function generatePrice(basePrice: number, seed: string): number {
  const variation = (timeBasedRandom(seed) - 0.5) * 6; // -3% ~ +3%
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

  return NextResponse.json(indices, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
    }
  });
}
