import { ProphetRecommendations } from "@/components/market/ProphetRecommendations";

export const dynamic = "force-dynamic";

export default function RecommendationsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">추천 종목</h1>
        <p className="text-sm text-muted-foreground mt-1">
          하이브리드 스태킹 앙상블이 매일 오후 4:00 KST 장 마감 후 주요 종목을 분석하여 30일 예측 수익률 상위 종목을 추천합니다.
        </p>
      </div>
      <ProphetRecommendations />
    </div>
  );
}
