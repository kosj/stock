import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") || "";

    if (!q) {
      return NextResponse.json([]);
    }

    // 샘플 주식 데이터
    const stocks = [
      { ticker: "000660", name: "SK하이닉스", price: 62500, change_rate: 2.04 },
      { ticker: "005930", name: "삼성전자", price: 70000, change_rate: 1.45 },
      { ticker: "051910", name: "LG화학", price: 600000, change_rate: 0.84 },
      { ticker: "000270", name: "기아", price: 95000, change_rate: -0.53 },
      { ticker: "068270", name: "셀트리온", price: 156000, change_rate: 1.96 },
      { ticker: "096770", name: "SK이노베이션", price: 195500, change_rate: -1.27 },
      { ticker: "035900", name: "LG", price: 95500, change_rate: 0.53 },
      { ticker: "010950", name: "S-Oil", price: 87000, change_rate: 2.35 }
    ];

    // 검색어로 필터링
    const searchTerm = q.toLowerCase();
    const results = stocks.filter(
      stock =>
        stock.ticker.includes(searchTerm) ||
        stock.name.toLowerCase().includes(searchTerm)
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error("Market search API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
