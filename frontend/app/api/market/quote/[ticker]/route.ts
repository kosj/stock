import { NextRequest, NextResponse } from "next/server";

// 시간 기반 의사난수 생성 (같은 시간대에는 같은 값)
function timeBasedRandom(seed: string): number {
  const now = new Date();
  const minutes = Math.floor(now.getTime() / (1000 * 60)); // 1분 단위
  const hash = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const combined = (hash * 9301 + 49297 * minutes) % 233280;
  return (combined / 233280);
}

// 가격 변동 생성
function generatePrice(basePrice: number, seed: string): number {
  const variation = (timeBasedRandom(seed) - 0.5) * 4; // -2% ~ +2%
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

      return NextResponse.json({
        ticker,
        name: data.name,
        price: Math.round(price),
        change: Math.round(change * 100) / 100,
        change_rate: Math.round(change_rate * 100) / 100,
        volume: Math.floor(timeBasedRandom(`${ticker}-volume`) * 50000000) + 5000000,
        market_cap: data.market_cap,
        timestamp: new Date().toISOString()
      });
    }

    // 요청된 티커가 없으면 동적 데이터 반환
    const basePrice = Math.floor(timeBasedRandom(`${ticker}-base`) * 100000) + 10000;
    const price = generatePrice(basePrice, `${ticker}-price`);
    const change = price - basePrice;
    const change_rate = (change / basePrice) * 100;

    return NextResponse.json({
      ticker,
      name: `주식 ${ticker}`,
      price: Math.round(price),
      change: Math.round(change * 100) / 100,
      change_rate: Math.round(change_rate * 100) / 100,
      volume: Math.floor(timeBasedRandom(`${ticker}-volume`) * 50000000) + 5000000,
      market_cap: Math.floor(timeBasedRandom(`${ticker}-cap`) * 5000000000000) + 1000000000000,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Market quote API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
