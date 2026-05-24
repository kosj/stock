import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 샘플 포트폴리오 요약 데이터 (PortfolioPage가 기대하는 형식)
    const total_invested = id === "1" ? 4750000 : 2850000;
    const total_value = id === "1" ? 5000000 : 3000000;
    const total_pnl = total_value - total_invested;
    const total_pnl_percent = (total_pnl / total_invested) * 100;
    const cash = id === "1" ? 500000 : 300000;

    const summaryData = {
      id: parseInt(id),
      name: id === "1" ? "메인 포트폴리오" : "ETF 포트폴리오",
      total_invested: total_invested,
      total_value: total_value,
      total_pnl: total_pnl,
      total_pnl_percent: total_pnl_percent,
      cash: cash,
      positions: [
        {
          position_id: 1,
          id: 1,
          ticker: "000660",
          name: "SK하이닉스",
          quantity: 10,
          avg_price: 61250,
          buy_price: 61250,
          current_price: 62500,
          price: 62500,
          value: 625000,
          pnl: 25000,
          pnl_percent: 4.17,
          stop_loss: 55000,
          take_profit: 75000,
          target_price: 75000,
          strategy: "상승 추세 진행 중",
          is_near_stop: false,
          is_near_target: false
        },
        {
          position_id: 2,
          id: 2,
          ticker: "005930",
          name: "삼성전자",
          quantity: 5,
          avg_price: 69000,
          buy_price: 69000,
          current_price: 70000,
          price: 70000,
          value: 350000,
          pnl: 5000,
          pnl_percent: 1.45,
          stop_loss: 65000,
          take_profit: 85000,
          target_price: 85000,
          strategy: "강한 지지선 확보",
          is_near_stop: false,
          is_near_target: false
        },
        {
          position_id: 3,
          id: 3,
          ticker: "051910",
          name: "LG화학",
          quantity: 3,
          avg_price: 570000,
          buy_price: 570000,
          current_price: 600000,
          price: 600000,
          value: 1800000,
          pnl: 90000,
          pnl_percent: 5.26,
          stop_loss: 570000,
          take_profit: 700000,
          target_price: 700000,
          strategy: "박스권 이탈 대기",
          is_near_stop: false,
          is_near_target: false
        }
      ]
    };

    return NextResponse.json(summaryData);
  } catch (error) {
    console.error("Portfolio summary API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
