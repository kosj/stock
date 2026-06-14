/**
 * ClockPort — 시간/장운영 포트
 *
 * 실행 시각·영업일·장 개장 여부를 추상화한다. 백테스트에서는 가상 시계로
 * 대체되어 과거 시점을 재현할 수 있다. clientOrderId의 일자 기준도 여기서 얻는다.
 */
export interface ClockPort {
  /** 현재 시각 */
  now(): Date;

  /** 거래 영업일 여부 (주말 제외 — 공휴일은 미반영, 추후 캘린더 연동) */
  isTradingDay(d?: Date): boolean;

  /** 정규장 개장 여부 (KST 09:00~15:30) */
  isMarketOpen(d?: Date): boolean;

  /** 거래일 문자열 (KST 기준 YYYYMMDD) — 멱등성 키 등에 사용 */
  tradingDateKst(d?: Date): string;
}
