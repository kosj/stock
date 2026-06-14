/**
 * MarketDataPort — 시세/캔들 조회 포트
 *
 * 브로커(주문)와 분리한다: 시세 소스(Yahoo 등)와 체결 브로커(KIS 등)는
 * 서로 다른 공급자일 수 있고, 백테스트에서는 과거 데이터로 대체되어야 한다.
 */

export interface MarketQuote {
  ticker: string;
  /** 현재가 (원). 조회 실패 시 null 반환(아래 getQuote)로 표현 */
  price:  number;
  name?:  string | null;
}

export interface MarketCandle {
  /** 거래일 (YYYY-MM-DD 등) */
  time:   string;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface MarketDataPort {
  /** 현재가 조회. 조회 불가 시 null */
  getQuote(ticker: string): Promise<MarketQuote | null>;

  /** 일봉 캔들 조회 (오래된 것 → 최신 순). period 예: "1y", "3m" */
  getCandles(ticker: string, period?: string): Promise<MarketCandle[]>;
}
