import { ProphetRecommendations } from "@/components/market/ProphetRecommendations";

export const dynamic = "force-dynamic";

export default function RecommendationsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">추천 종목</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hybrid Stacking Ensemble 알고리즘이 매일 장 마감 후 주요 종목을 분석해 KOSPI 대비 10일 기대초과수익(알파) 상위 종목을 추천합니다.
        </p>
      </div>
      <ProphetRecommendations />
    </div>
  );
}
