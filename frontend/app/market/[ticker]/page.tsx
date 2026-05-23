import { notFound } from "next/navigation";
import { StockDetailPage } from "@/components/market/StockDetailPage";

export default async function StockDetail(props: PageProps<"/market/[ticker]">) {
  const { ticker } = await props.params;
  if (!ticker) notFound();
  return <StockDetailPage ticker={ticker.toUpperCase()} />;
}
