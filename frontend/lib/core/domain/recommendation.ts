/**
 * 추천 종목 도메인 모델 — 순수 타입
 *
 * 일일 추천 엔진(Python hybrid_ensemble)이 산출한 Top-N 결과 한 줄.
 * 전략 코어의 진입(매수) 후보 소스.
 */
export interface Recommendation {
  rank:           number;
  ticker:         string;
  name:           string;
  /** buy | strong_buy | hold | ... */
  recommendation: string;
  /** 산출 시점 현재가 (원) */
  currentPrice:   number;
  /** 30일 기대수익률 (%) */
  baseReturn30d:  number;
}
