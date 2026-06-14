/**
 * RecommendationPort — 진입 후보(추천 종목) 소스 포트
 *
 * 일일 추천 엔진 결과를 전략 코어에 공급한다. 백테스트에서는 과거 시점의
 * 추천 스냅샷으로 대체된다.
 */

import type { Recommendation } from "../domain/recommendation";

export interface RecommendationPort {
  /**
   * 가장 최근 산출분의 상위 추천 종목을 rank 오름차순으로 반환.
   * @param limit 최대 개수 (기본 30)
   */
  getTopRecommendations(limit?: number): Promise<Recommendation[]>;
}
