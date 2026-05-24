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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 기본 설정
    const isMainPortfolio = id === "1";
    const portfolioConfig = {
      total_invested: isMainPortfolio ? 4750000 : 2850000,
      cash: isMainPortfolio ? 500000 : 300000,
      positions: [
        { position_id: 1, ticker: "000660", name: "SK하이닉스", quantity: 10, avg_price: 61250, stop_loss: 55000, take_profit: 75000, target_price: 75000 },
        { position_id: 2, ticker: "005930", name: "삼성전자", quantity: 5, avg_price: 69000, stop_loss: 65000, take_profit: 85000, target_price: 85000 },
        { position_id: 3, ticker: "051910", name: "LG화학", quantity: 3, avg_price: 570000, stop_loss: 570000, take_profit: 700000, target_price: 700000 }
      ]
    };

    // 동적 가격으로 포지션 계산
    const positions = portfolioConfig.positions.map((pos) => {
      const current_price = generatePrice(pos.avg_price, `${pos.ticker}-price`);
      const value = Math.round(current_price * pos.quantity);
      const pnl = value - (pos.avg_price * pos.quantity);
      const pnl_percent = (pnl / (pos.avg_price * pos.quantity)) * 100;
      const is_near_stop = current_price <= pos.stop_loss * 1.05;
      const is_near_target = current_price >= pos.take_profit * 0.95;

      return {
        ...pos,
        buy_price: pos.avg_price,
        current_price: Math.round(current_price),
        price: Math.round(current_price),
        value,
        pnl,
        pnl_percent: Math.round(pnl_percent * 100) / 100,
        strategy: pnl > 0 ? "수익 실현 검토" : "추가 매수 기회 모니터링",
        is_near_stop,
        is_near_target
      };
    });

    // 포트폴리오 전체 손익 계산
    const total_stock_value = positions.reduce((sum, p) => sum + p.value, 0);
    const total_value = total_stock_value + portfolioConfig.cash;
    const total_pnl = total_value - portfolioConfig.total_invested;
    const total_pnl_percent = (total_pnl / portfolioConfig.total_invested) * 100;

    const summaryData = {
      id: parseInt(id),
      name: isMainPortfolio ? "메인 포트폴리오" : "ETF 포트폴리오",
      total_invested: portfolioConfig.total_invested,
      total_value: Math.round(total_value),
      total_pnl: Math.round(total_pnl),
      total_pnl_percent: Math.round(total_pnl_percent * 100) / 100,
      cash: portfolioConfig.cash,
      positions,
      timestamp: new Date().toISOString()
    };

    const now = new Date();
    return NextResponse.json({
      ...summaryData,
      _requestId: `${now.getTime()}-${Math.random()}`
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error("Portfolio summary API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
