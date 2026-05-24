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

// 가격 변동 생성
function generatePrice(basePrice: number, seed: string): number {
  const variation = getRandomVariation(seed) * 6; // -3% ~ +3%
  return Math.round(basePrice * (1 + variation / 100) * 100) / 100;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    // 기본 주식 데이터 (기본 가격 기준)
    const stockData: Record<string, any> = {
      "000660": { name: "SK하이닉스", basePrice: 62500, market_cap: 3210000000000 },
      "005930": { name: "삼성전자", basePrice: 70000, market_cap: 4560000000000 },
      "051910": { name: "LG화학", basePrice: 600000, market_cap: 450000000000 }
    };

    const data = stockData[ticker];
    if (data) {
      const price = generatePrice(data.basePrice, `${ticker}-price`);
      const change = price - data.basePrice;
      const change_rate = (change / data.basePrice) * 100;

      const now = new Date();
      return NextResponse.json({
        ticker,
        name: data.name,
        price: Math.round(price),
        change: Math.round(change * 100) / 100,
        change_rate: Math.round(change_rate * 100) / 100,
        volume: Math.floor((getRandomVariation(`${ticker}-volume`) + 0.5) * 50000000) + 5000000,
        market_cap: data.market_cap,
        timestamp: now.toISOString(),
        _requestId: `${now.getTime()}-${Math.random()}`
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    // 요청된 티커가 없으면 동적 데이터 반환
    const basePrice = Math.floor((getRandomVariation(`${ticker}-base`) + 0.5) * 100000) + 10000;
    const price = generatePrice(basePrice, `${ticker}-price`);
    const change = price - basePrice;
    const change_rate = (change / basePrice) * 100;
    const now = new Date();

    return NextResponse.json({
      ticker,
      name: `주식 ${ticker}`,
      price: Math.round(price),
      change: Math.round(change * 100) / 100,
      change_rate: Math.round(change_rate * 100) / 100,
      volume: Math.floor((getRandomVariation(`${ticker}-volume`) + 0.5) * 50000000) + 5000000,
      market_cap: Math.floor((getRandomVariation(`${ticker}-cap`) + 0.5) * 5000000000000) + 1000000000000,
      timestamp: now.toISOString(),
      _requestId: `${now.getTime()}-${Math.random()}`
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error("Market quote API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
