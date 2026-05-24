import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    // 기술 분석 데이터
    const analysisData: Record<string, any> = {
      "000660": {
        ticker: "000660",
        name: "SK하이닉스",
        recommendation: "STRONG_BUY",
        score: 8.2,
        rsi: 65.4,
        macd: 2.34,
        macd_signal: 2.18,
        bb_upper: 65000,
        bb_middle: 62500,
        bb_lower: 60000,
        support: 61000,
        resistance: 65000
      },
      "005930": {
        ticker: "005930",
        name: "삼성전자",
        recommendation: "BUY",
        score: 7.5,
        rsi: 58.2,
        macd: 1.45,
        macd_signal: 1.32,
        bb_upper: 72000,
        bb_middle: 70000,
        bb_lower: 68000,
        support: 68500,
        resistance: 72000
      }
    };

    const data = analysisData[ticker];
    if (data) {
      return NextResponse.json({
        ...data,
        timestamp: new Date().toISOString()
      });
    }

    // 요청된 티커가 없으면 샘플 데이터 반환
    return NextResponse.json({
      ticker,
      name: `주식 ${ticker}`,
      recommendation: ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"][Math.floor(Math.random() * 5)],
      score: parseFloat((Math.random() * 10).toFixed(1)),
      rsi: parseFloat((Math.random() * 100).toFixed(1)),
      macd: parseFloat((Math.random() * 5 - 2.5).toFixed(2)),
      macd_signal: parseFloat((Math.random() * 5 - 2.5).toFixed(2)),
      bb_upper: Math.floor(Math.random() * 100000) + 50000,
      bb_middle: Math.floor(Math.random() * 100000) + 50000,
      bb_lower: Math.floor(Math.random() * 100000) + 50000,
      support: Math.floor(Math.random() * 100000) + 40000,
      resistance: Math.floor(Math.random() * 100000) + 60000,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Analysis API error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
