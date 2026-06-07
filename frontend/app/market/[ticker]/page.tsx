import { notFound } from "next/navigation";
import { StockDetailPage } from "@/components/market/StockDetailPage";
import { InvestorTrendService } from "@/lib/server/investor-trend";

type Props = {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ avg_price?: string; quantity?: string; portfolio_id?: string; position_id?: string }>;
};

export default async function StockDetail({ params, searchParams }: Props) {
  const { ticker } = await params;
  if (!ticker) notFound();
  const sp = await searchParams;
  const avgPrice    = parseFloat(sp.avg_price    ?? "") || null;
  const quantity    = parseInt(sp.quantity       ?? "", 10) || null;
  const portfolioId = parseInt(sp.portfolio_id  ?? "", 10) || null;
  const positionId  = parseInt(sp.position_id   ?? "", 10) || null;

  // 수급 분석: 서버 컴포넌트에서 직접 fetch → 클라이언트 컴포넌트로 props 전달
  // 국내 종목(6자리)만 데이터가 있음. 해외 종목은 null 반환 → 카드 숨김.
  const investorTrend = await InvestorTrendService.getTrend(ticker.toUpperCase()).catch(() => null);

  return (
    <StockDetailPage
      ticker={ticker.toUpperCase()}
      avgPrice={avgPrice}
      quantity={quantity}
      portfolioId={portfolioId}
      positionId={positionId}
      investorTrend={investorTrend}
    />
  );
}
