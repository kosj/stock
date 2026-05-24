import { NextRequest, NextResponse } from "next/server";
import { getNaveIndicies, getExchangeRate } from "@/lib/server/scraper";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const now = new Date();
  const indices: Record<string, any> = {};

  try {
    // Naver Finance에서 실제 데이터 가져오기
    const naverData = await getNaveIndicies();
    indices['KOSPI'] = naverData.KOSPI;
    indices['KOSDAQ'] = naverData.KOSDAQ;

    // 환율 데이터
    const exchangeRate = await getExchangeRate();
    indices['달러/원'] = exchangeRate;

    // S&P500, NASDAQ는 샘플 데이터 (실시간 API가 필요하면 추가 가능)
    indices['S&P500'] = { price: 5300, change: 42, change_pct: 0.80 };
    indices['NASDAQ'] = { price: 16800, change: 125, change_pct: 0.75 };

  } catch (error) {
    console.error('Error fetching indices:', error);
    // 실패 시 기본값
    indices['KOSPI'] = { price: 2850, change: 15, change_pct: 0.53 };
    indices['KOSDAQ'] = { price: 950, change: 5, change_pct: 0.53 };
    indices['S&P500'] = { price: 5300, change: 42, change_pct: 0.80 };
    indices['NASDAQ'] = { price: 16800, change: 125, change_pct: 0.75 };
    indices['달러/원'] = { price: 1310, change: 30, change_pct: 2.34 };
  }

  return NextResponse.json(indices, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
}
