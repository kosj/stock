import { ProphetRecommendations } from "@/components/market/ProphetRecommendations";

export const dynamic = "force-dynamic";

export default function RecommendationsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">주간 추천 종목</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prophet 알고리즘이 매주 금요일 장 마감 후 50개 주요 종목을 분석하여 30일 예측 수익률 상위 10종목을 추천합니다.
        </p>
      </div>
      <ProphetRecommendations />
    </div>
  );
}
