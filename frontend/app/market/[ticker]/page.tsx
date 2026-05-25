import { notFound } from "next/navigation";
import { StockDetailPage } from "@/components/market/StockDetailPage";

type Props = {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ avg_price?: string; quantity?: string }>;
};

export default async function StockDetail({ params, searchParams }: Props) {
  const { ticker } = await params;
  if (!ticker) notFound();
  const sp = await searchParams;
  const avgPrice  = parseFloat(sp.avg_price  ?? "") || null;
  const quantity  = parseInt(sp.quantity     ?? "", 10) || null;
  return (
    <StockDetailPage
      ticker={ticker.toUpperCase()}
      avgPrice={avgPrice}
      quantity={quantity}
    />
  );
}
