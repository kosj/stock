/**
 * @file terminology.ts
 * @description 주식 자동매매 및 퀀트 분석 공통 용어 사전 (Terminology Dictionary)
 *
 * 3가지 도메인으로 분류:
 *   - MarketTerms  : 시장 및 기본 지표 (OHLCV, 시가총액, 보통주/우선주 등)
 *   - QuantTerms   : 가치 및 기술적 분석 지표 (PER, RSI, MACD, ATR 등)
 *   - TradingTerms : 매매 및 시스템 용어 (손절, 익절, 트레일링 스탑 등)
 *
 * 사용 예시:
 *   import { MarketTerms, findTerm, searchTerms } from "@/lib/terminology";
 *   const term = MarketTerms.PER;  // TermEntry 타입 자동 추론
 *   const results = searchTerms("RSI");
 */

// ─────────────────────────────────────────────────────────────────────────────
// § 0. 공통 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

/** 용어가 속하는 카테고리 식별자 */
export type TermCategory = "market" | "quant" | "trading";

/** 단일 용어 엔트리의 구조 */
export interface TermEntry {
  /** 한국어 용어명 (예: "주가수익비율") */
  readonly ko: string;
  /** 영어 원문 또는 약자 풀이 (예: "Price-to-Earnings Ratio") */
  readonly en: string;
  /** 초보자도 이해할 수 있는 의미 및 해석 */
  readonly description: string;
  /** 계산 공식 (해당 용어에 공식이 있을 때만 존재) */
  readonly formula?: string;
  /** 실전 해석 기준 또는 활용 팁 */
  readonly tip?: string;
  /** 도메인 카테고리 */
  readonly category: TermCategory;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 1. MarketTerms — 시장 및 기본 지표
// ─────────────────────────────────────────────────────────────────────────────

export const MarketTerms = {

  /**
   * Open, High, Low, Close, Volume
   *
   * 주식 시장에서 하루 동안의 가격 움직임을 표현하는 5가지 핵심 캔들 데이터.
   *   - Open  (시가): 당일 첫 번째 체결 가격
   *   - High  (고가): 당일 최고 체결 가격
   *   - Low   (저가): 당일 최저 체결 가격
   *   - Close (종가): 당일 마지막 체결 가격 (익일 기준가)
   *   - Volume (거래량): 당일 체결된 총 주식 수
   *
   * 모든 기술적 지표(MA, RSI, MACD, ATR 등)의 원재료이며,
   * 캔들스틱 차트는 이 5가지 값으로 완전히 표현된다.
   */
  OHLCV: {
    ko: "OHLCV",
    en: "Open · High · Low · Close · Volume",
    description:
      "하루의 주가 움직임을 완전히 표현하는 5가지 핵심 데이터. 시가(O)·고가(H)·저가(L)·종가(C)·거래량(V)으로 구성되며, 모든 기술적 분석의 원재료다.",
    tip: "캔들스틱 차트 한 개 = OHLCV 데이터 한 세트. 종가는 익일 기준가가 되어 상·하한가 결정에 쓰인다.",
    category: "market",
  },

  /**
   * Market Capitalization (시가총액)
   *
   * 기업의 시장 총 가치를 나타내는 지표.
   *
   * 공식: 시가총액 = 현재 주가 × 발행 주식 수
   *
   * 대형주(Large-cap): 시가총액 1조 원 이상
   * 중형주(Mid-cap)  : 3천억 ~ 1조 원
   * 소형주(Small-cap): 3천억 원 미만
   */
  MARKET_CAP: {
    ko: "시가총액",
    en: "Market Capitalization",
    description:
      "주식 시장이 평가하는 기업의 총 가치. 주가와 발행 주식 수를 곱해 구하며, 기업 규모를 비교하는 가장 기본적인 척도다.",
    formula: "시가총액 = 현재 주가 × 발행 주식 수",
    tip: "코스피200 편입 기준, ETF 비중 결정, 인덱스 펀드 운용의 핵심 기준값이다.",
    category: "market",
  },

  /**
   * Par Value (액면가)
   *
   * 주식 발행 시 정관에 표시된 주당 법정 기준 금액.
   * 한국 상법상 액면가는 100원 이상이어야 하며, 일반적으로 500원·1,000원·5,000원이 많다.
   * 주가와 다르게 변동하지 않으며, 배당금 계산 시 기준으로 사용된다.
   */
  PAR_VALUE: {
    ko: "액면가",
    en: "Par Value (Face Value)",
    description:
      "주식 발행 시 정관에 기재된 주당 법정 기준 금액. 시장 주가와 무관하며, 배당률 계산의 기준이 된다. (예: 액면가 500원 × 배당률 10% = 주당 50원 배당)",
    formula: "배당금 = 액면가 × 배당률(%)",
    tip: "삼성전자처럼 주가가 수만 원이어도 액면가는 100원이다. '무액면주식'은 액면가 개념이 없다.",
    category: "market",
  },

  /**
   * Common Stock (보통주)
   *
   * 일반적으로 거래되는 표준 주식으로, 의결권과 이익 배당권을 모두 가진다.
   * 기업 청산 시 채권자·우선주 주주 이후 잔여재산을 분배받는다.
   * 한국 종목 코드는 끝자리 '0'(예: 삼성전자 005930).
   */
  COMMON_STOCK: {
    ko: "보통주",
    en: "Common Stock",
    description:
      "가장 일반적인 주식 형태. 주주총회에서 의결권을 행사할 수 있고 배당도 받는다. 청산 시 채권자·우선주 다음 순위로 잔여재산을 수령한다.",
    tip: "코스피·코스닥에서 거래되는 대부분의 종목이 보통주. 종목 코드 끝자리 '0' = 보통주.",
    category: "market",
  },

  /**
   * Preferred Stock (우선주)
   *
   * 배당을 보통주보다 우선하여 받는 주식.
   * 일반적으로 의결권이 없거나 제한되지만, 고정 배당 또는 누적 배당을 보장받는다.
   * 한국 종목 코드는 끝자리 '5'(예: 삼성전자우 005935).
   * 보통주 대비 할인(디스카운트)되어 거래되는 경우가 많아 배당 투자자에게 유리하다.
   */
  PREFERRED_STOCK: {
    ko: "우선주",
    en: "Preferred Stock",
    description:
      "보통주보다 배당·청산 우선권을 가지는 주식. 대부분 의결권이 없고, 보통주 대비 주가가 낮아 배당수익률이 높다.",
    tip: "보통주-우선주 괴리율이 클 때 차익거래 기회가 생기기도 한다. 종목 코드 끝자리 '5' = 우선주.",
    category: "market",
  },

  /**
   * KOSPI (Korea Composite Stock Price Index)
   *
   * 한국거래소(KRX)에 상장된 모든 보통주의 시가총액 가중 지수.
   * 1980년 1월 4일 기준값 100으로 시작했으며, 대형 우량 기업 중심이다.
   */
  KOSPI: {
    ko: "코스피",
    en: "Korea Composite Stock Price Index (KOSPI)",
    description:
      "한국 유가증권시장에 상장된 전체 종목의 시가총액을 기반으로 산출하는 종합 주가지수. 기준 시점(1980.01.04) = 100.",
    formula: "KOSPI = (비교 시점 시가총액 합계 / 기준 시점 시가총액 합계) × 100",
    tip: "코스피 대장주 삼성전자 한 종목이 전체 지수에 약 20%의 영향을 미칠 정도로 시가총액 집중도가 높다.",
    category: "market",
  },

  /**
   * KOSDAQ (Korea Securities Dealers Automated Quotations)
   *
   * 중소·벤처 기업 중심의 장외 기반으로 시작한 한국 주식 시장.
   * 코스피에 비해 상장 요건이 낮고, 기술·바이오·게임 업종이 강세다.
   * 변동성이 코스피보다 크다.
   */
  KOSDAQ: {
    ko: "코스닥",
    en: "Korea Securities Dealers Automated Quotations (KOSDAQ)",
    description:
      "중소·성장형 기업 중심의 한국 주식 시장. 코스피보다 상장 기준이 낮고, IT·바이오 업종 비중이 높으며 변동성이 크다.",
    tip: "코스닥150 지수는 코스닥 시총 상위 150개 종목으로 구성되는 대표 벤치마크다.",
    category: "market",
  },

  /**
   * Circuit Breaker (서킷브레이커)
   *
   * 주가 폭락 시 시장 전체 또는 개별 종목 거래를 일시 정지하는 제도.
   * 코스피·코스닥 지수가 전일 대비 8% 이상 하락 → 1단계: 20분 거래 중단
   * 15% 이상 하락하고 1단계 발동 후 1% 이상 추가 하락 → 2단계: 20분 추가 중단
   * 20% 이상 하락 → 3단계: 당일 거래 전면 중단
   */
  CIRCUIT_BREAKER: {
    ko: "서킷브레이커",
    en: "Circuit Breaker",
    description:
      "지수 급락 시 투자자 패닉을 방지하고 냉각 시간을 확보하기 위해 거래를 일시 중단하는 안전 장치. 1987년 블랙먼데이 이후 미국에서 도입되었다.",
    tip: "발동 단계: 8% 하락→20분 중단 / 15% 하락→20분 추가 중단 / 20% 하락→당일 거래 종료.",
    category: "market",
  },

  /**
   * Limit Up / Limit Down (상한가 / 하한가)
   *
   * 한국 주식 시장에서 당일 주가 등락 폭의 최대 허용 한계.
   * 전일 종가(기준가) 대비 ±30%가 상·하한가다.
   * 해당 가격 이상/이하로는 당일 거래가 불가능하다.
   */
  LIMIT_UP_DOWN: {
    ko: "상한가 / 하한가",
    en: "Limit Up / Limit Down",
    description:
      "당일 주가가 오를 수 있는 최대치(상한가)와 내릴 수 있는 최저치(하한가). 한국은 기준가 ±30%. 급등락에 따른 시장 충격 완화 목적이다.",
    formula: "상한가 = 전일 종가 × 1.30  /  하한가 = 전일 종가 × 0.70",
    tip: "상한가로 마감하면 다음 날 강한 갭 상승 or 차익 매물 출현 두 가지 시나리오가 나온다.",
    category: "market",
  },

  /**
   * Ex-Dividend Date (배당락일)
   *
   * 배당 기준일 다음 날로, 이 날 이후에 매수한 주주는 해당 회계연도 배당을 받지 못한다.
   * 한국은 대부분 12월 결산 법인의 배당 기준일이 12월 31일이므로,
   * 12월 31일 이후 매수하면 배당을 받지 못한다.
   * 배당락일 당일에는 배당 지급 예정액만큼 주가가 하락하는 경향이 있다.
   */
  EX_DIVIDEND: {
    ko: "배당락 / 배당락일",
    en: "Ex-Dividend Date",
    description:
      "이 날 이후 주식을 매수하면 직전 배당을 받지 못하는 기준일. 배당락일 당일 주가는 이론적으로 배당금 예정액만큼 하락한다.",
    tip: "배당 투자자는 배당락 전날(기준일)까지 주식을 보유해야 배당을 수령할 수 있다.",
    category: "market",
  },

} as const satisfies Record<string, TermEntry>;

/** 시장 및 기본 지표 용어 유니온 타입 */
export type MarketTermType = (typeof MarketTerms)[keyof typeof MarketTerms];

// ─────────────────────────────────────────────────────────────────────────────
// § 2. QuantTerms — 가치 및 기술적 분석 지표
// ─────────────────────────────────────────────────────────────────────────────

export const QuantTerms = {

  /**
   * Earnings Per Share (주당순이익, EPS)
   *
   * 기업이 1주당 얼마의 순이익을 창출했는지 나타내는 지표.
   * PER 계산의 분모가 되며, EPS가 높을수록 수익성이 우수하다.
   * 희석 EPS(Diluted EPS): 스톡옵션·전환사채 등 잠재 주식을 반영한 보수적 수치.
   *
   * 공식: EPS = 당기순이익 / 평균 발행 주식 수
   */
  EPS: {
    ko: "주당순이익",
    en: "Earnings Per Share",
    description:
      "기업이 1주당 창출한 순이익. PER 계산의 핵심 분모이며 분기·연간 실적 발표에서 '어닝 서프라이즈/쇼크'의 기준이 된다.",
    formula: "EPS = 당기순이익 ÷ 평균 발행 주식 수",
    tip: "EPS 증가율(EPS Growth)이 지속적으로 높은 기업이 성장주의 핵심 조건이다.",
    category: "quant",
  },

  /**
   * Price-to-Earnings Ratio (주가수익비율, PER)
   *
   * 현재 주가가 1주당 순이익(EPS)의 몇 배인지 나타내는 밸류에이션 지표.
   * 즉, 투자 원금 회수에 몇 년이 걸리는지를 나타낸다.
   * 업종마다 평균 PER이 다르므로 동종 업계 비교가 필수다.
   *
   * 공식: PER = 주가 / EPS
   */
  PER: {
    ko: "주가수익비율",
    en: "Price-to-Earnings Ratio",
    description:
      "주가가 EPS의 몇 배인지 나타내는 밸류에이션 지표. 낮을수록 저평가, 높을수록 고평가 신호이지만 업종별 평균과 비교해야 한다.",
    formula: "PER = 주가 ÷ EPS  (또는 시가총액 ÷ 당기순이익)",
    tip: "코스피 평균 PER ≈ 10~15배. 동일 업종 PER보다 낮으면 저평가 후보. PER이 음수이면 적자 기업이다.",
    category: "quant",
  },

  /**
   * Price-to-Book Ratio (주가순자산비율, PBR)
   *
   * 현재 주가가 1주당 순자산(장부 가치)의 몇 배인지 나타내는 지표.
   * PBR 1.0 = 주가가 청산 가치와 동일. PBR < 1.0 = 이론상 청산 가치 이하에서 거래 중.
   *
   * 공식: PBR = 주가 / BPS  (BPS: Book Value Per Share)
   */
  PBR: {
    ko: "주가순자산비율",
    en: "Price-to-Book Ratio",
    description:
      "주가가 주당 순자산(장부가치)의 몇 배로 거래되는지 나타내는 지표. PBR < 1이면 시장이 기업의 장부 가치보다 낮게 평가하고 있다는 의미다.",
    formula: "PBR = 주가 ÷ BPS  (BPS = 자기자본 ÷ 발행 주식 수)",
    tip: "금융주·제조업 등 자산 집약 업종에서 유효하다. IT·바이오처럼 무형자산 비중이 높은 업종은 PBR만으로 판단하기 어렵다.",
    category: "quant",
  },

  /**
   * Return on Equity (자기자본이익률, ROE)
   *
   * 주주가 투자한 자기자본으로 얼마나 효율적으로 이익을 창출했는지 나타내는 지표.
   * 워런 버핏이 가장 중시하는 지표 중 하나로, 15% 이상이면 우량 기업으로 간주.
   *
   * 공식: ROE = 당기순이익 / 평균 자기자본 × 100
   * 듀폰 분해: ROE = 순이익률 × 자산회전율 × 재무레버리지
   */
  ROE: {
    ko: "자기자본이익률",
    en: "Return on Equity",
    description:
      "주주가 투자한 자본 대비 순이익 창출 능력. '주주 돈을 얼마나 잘 굴렸나'를 측정하는 지표다. 지속적으로 15% 이상이면 우량 기업의 신호다.",
    formula: "ROE = (당기순이익 ÷ 평균 자기자본) × 100 (%)",
    tip: "ROE가 높아도 과도한 부채(레버리지)로 부풀려진 경우가 있다. 항상 부채비율과 함께 확인할 것.",
    category: "quant",
  },

  /**
   * Return on Assets (총자산이익률, ROA)
   *
   * 기업이 보유한 모든 자산(부채 포함)을 활용해 얼마나 이익을 냈는지 나타내는 지표.
   * ROE가 주주 관점이라면, ROA는 경영진 관점의 자산 활용 효율성 지표다.
   *
   * 공식: ROA = 당기순이익 / 평균 총자산 × 100
   */
  ROA: {
    ko: "총자산이익률",
    en: "Return on Assets",
    description:
      "기업의 총자산(자기자본 + 부채) 대비 순이익 창출 능력. ROE보다 레버리지 효과가 배제되어 순수 자산 활용 효율을 측정한다.",
    formula: "ROA = (당기순이익 ÷ 평균 총자산) × 100 (%)",
    tip: "은행·금융주는 레버리지가 매우 높아 ROA가 낮지만 정상이다. 업종별 평균 ROA와 비교해야 한다.",
    category: "quant",
  },

  /**
   * Relative Strength Index (상대강도지수, RSI)
   *
   * 특정 기간(보통 14일) 동안 상승 폭과 하락 폭의 비율로 매수·매도 과열 여부를 판단.
   * 0~100 사이 값으로 표시되며, 70 이상은 과매수, 30 이하는 과매도 신호.
   *
   * 공식: RSI = 100 - 100 / (1 + RS)
   *       RS = 14일 평균 상승폭 / 14일 평균 하락폭
   */
  RSI: {
    ko: "상대강도지수",
    en: "Relative Strength Index",
    description:
      "최근 14거래일간 상승 평균과 하락 평균의 비율로 과매수·과매도를 측정하는 모멘텀 오실레이터. 0~100 사이 값을 가진다.",
    formula: "RSI = 100 − [100 ÷ (1 + 평균 상승폭 ÷ 평균 하락폭)]",
    tip: "RSI > 70 → 과매수(단기 조정 경계) / RSI < 30 → 과매도(반등 기대). 다이버전스(가격 신고점인데 RSI는 낮을 때)가 강력한 반전 신호다.",
    category: "quant",
  },

  /**
   * Moving Average Convergence Divergence (이동평균 수렴·확산, MACD)
   *
   * 단기(12일) EMA와 장기(26일) EMA의 차이로 추세의 방향과 모멘텀을 포착하는 지표.
   * Signal선(MACD 9일 EMA)과의 교차점이 매매 신호로 사용된다.
   *
   * 구성 요소:
   *   MACD선   = EMA(12) - EMA(26)
   *   Signal선 = MACD선의 EMA(9)
   *   히스토그램 = MACD선 - Signal선
   */
  MACD: {
    ko: "이동평균 수렴·확산",
    en: "Moving Average Convergence Divergence",
    description:
      "단기(12일) EMA와 장기(26일) EMA의 차이(MACD선)와 이의 9일 이평(Signal선) 교차로 추세 전환을 포착하는 모멘텀 지표.",
    formula: "MACD = EMA(12) − EMA(26)  /  Signal = EMA(MACD, 9)  /  히스토그램 = MACD − Signal",
    tip: "MACD선이 Signal선을 아래에서 위로 돌파(골든크로스) → 매수 신호. 반대는 매도 신호. 히스토그램의 방향 전환이 더 선행한다.",
    category: "quant",
  },

  /**
   * Bollinger Bands (볼린저밴드)
   *
   * 이동평균선(중간 밴드)을 중심으로 ±2 표준편차 범위의 상단·하단 밴드를 그린 변동성 지표.
   * 가격이 상단 밴드에 닿으면 과매수, 하단 밴드에 닿으면 과매도 가능성.
   * 밴드 폭이 좁아지는 '스퀴즈(Squeeze)'는 급변동 직전 신호다.
   *
   * 공식:
   *   중간 밴드 = SMA(20)
   *   상단 밴드 = SMA(20) + 2 × σ(20)
   *   하단 밴드 = SMA(20) - 2 × σ(20)
   */
  BOLLINGER_BANDS: {
    ko: "볼린저밴드",
    en: "Bollinger Bands",
    description:
      "20일 이동평균을 중심으로 ±2 표준편차 구간의 밴드를 그린 변동성 지표. 밴드 폭이 변동성을 나타내며, 폭이 좁아지면(스퀴즈) 큰 추세 변동이 임박한 신호다.",
    formula: "중간: SMA(20)  /  상단: SMA(20) + 2σ  /  하단: SMA(20) − 2σ",
    tip: "밴드 터치≠반드시 반전. 강한 추세장에서는 가격이 밴드 바깥에서 계속 움직이는 'Band Walk' 현상이 발생한다.",
    category: "quant",
  },

  /**
   * Moving Average (이동평균선, MA)
   *
   * 일정 기간의 종가 평균을 연결한 선으로, 추세 방향과 지지·저항을 파악하는 기본 지표.
   * 단순이동평균(SMA), 지수이동평균(EMA), 가중이동평균(WMA) 등 종류가 있다.
   *
   * 주요 기간:
   *   5일(1주), 20일(1개월), 60일(분기), 120일(반기), 240일(연간)
   */
  MA: {
    ko: "이동평균선",
    en: "Moving Average",
    description:
      "일정 기간 종가의 평균값을 연결한 선. 추세 방향 확인, 지지·저항 역할을 한다. 단기(5·20일)와 장기(120·240일) 이평선의 교차로 골든크로스·데드크로스를 판별한다.",
    formula: "SMA(N) = 최근 N일 종가 합계 ÷ N  /  EMA(N) = 전일 EMA × (1 − α) + 오늘 종가 × α, α = 2/(N+1)",
    tip: "220일(연간 거래일) 이평선은 기관·외국인이 중요하게 보는 장기 추세선이다.",
    category: "quant",
  },

  /**
   * Average True Range (평균 진폭 범위, ATR)
   *
   * 가장 일반적인 변동성 측정 지표로, N일간의 True Range(TR) 평균값.
   * TR은 당일 고-저 폭뿐 아니라 전일 종가와의 갭까지 포함하므로 갭 상승·하락을 반영한다.
   *
   * 공식:
   *   TR = max(고가-저가, |고가-전일종가|, |저가-전일종가|)
   *   ATR(14) = TR의 14일 이동 평균
   *   ATR% = ATR / 현재가 × 100
   *
   * 손절·익절 가격 설정 및 포지션 사이징에 핵심적으로 활용된다.
   */
  ATR: {
    ko: "평균 진폭 범위 (변동성)",
    en: "Average True Range",
    description:
      "전일 종가와의 갭을 포함한 실질 변동폭(True Range)의 14일 평균. 절대 원화 금액으로 표시되며, 종목별 변동성을 수치화하는 손절·익절 설계의 핵심 지표다.",
    formula: "TR = max(H−L, |H−C₋₁|, |L−C₋₁|)  /  ATR(14) = SMA(TR, 14)  /  ATR% = ATR ÷ 현재가 × 100",
    tip: "손절 설계 원칙: '2 ATR 손절' = 정상 노이즈(1 ATR)를 넘어선 통계적 유의미한 하락 신호. ATR이 클수록 포지션 크기는 줄여야 한다.",
    category: "quant",
  },

  /**
   * Golden Cross (골든크로스)
   *
   * 단기 이동평균선이 장기 이동평균선을 아래에서 위로 돌파하는 현상.
   * 상승 추세 전환의 중요한 기술적 신호로 사용된다.
   * 가장 많이 사용하는 조합: 50일 MA vs 200일 MA (코스피에서는 60일 vs 120일).
   */
  GOLDEN_CROSS: {
    ko: "골든크로스",
    en: "Golden Cross",
    description:
      "단기 이평선이 장기 이평선을 아래→위로 돌파하는 패턴. 중기 상승 추세 전환을 시사하는 강세 신호다.",
    tip: "후행성 지표이므로 발생 후 이미 주가가 많이 오른 경우가 있다. 거래량 급증이 동반될 때 신뢰도가 높아진다.",
    category: "quant",
  },

  /**
   * Dead Cross (데드크로스)
   *
   * 단기 이동평균선이 장기 이동평균선을 위에서 아래로 돌파하는 현상.
   * 하락 추세 전환의 기술적 신호로, 골든크로스의 반대 개념이다.
   */
  DEAD_CROSS: {
    ko: "데드크로스",
    en: "Dead Cross",
    description:
      "단기 이평선이 장기 이평선을 위→아래로 돌파하는 패턴. 중기 하락 추세 전환을 시사하는 약세 신호다.",
    tip: "추세 후행성이 강하므로 실제 손절 결정은 데드크로스 발생 이전에 ATR 기반 손절선에서 먼저 대응하는 것이 유리하다.",
    category: "quant",
  },

  /**
   * Beta (베타, β)
   *
   * 시장(벤치마크 지수) 대비 개별 주식의 가격 민감도(변동성 비율).
   * β = 1: 시장과 동일하게 움직임
   * β > 1: 시장보다 더 크게 움직임 (고위험·고수익 가능성)
   * β < 1: 시장보다 덜 움직임 (방어주 성격)
   * β < 0: 시장과 반대로 움직임 (역상관)
   *
   * 공식: β = Cov(개별 주식 수익률, 시장 수익률) / Var(시장 수익률)
   */
  BETA: {
    ko: "베타",
    en: "Beta (β)",
    description:
      "KOSPI 등 시장 지수 대비 개별 종목의 가격 민감도. β=1.5이면 시장이 1% 오를 때 해당 주식은 평균 1.5% 오른다는 의미다.",
    formula: "β = Cov(종목 수익률, 시장 수익률) ÷ Var(시장 수익률)",
    tip: "하락장 방어: β < 1 (유틸리티·소비재), 상승장 레버리지: β > 1 (반도체·바이오). 포트폴리오 베타 = 각 종목 베타의 가중 평균.",
    category: "quant",
  },

  /**
   * Sharpe Ratio (샤프 비율)
   *
   * 리스크(변동성) 한 단위당 초과 수익률. 즉, 리스크 대비 수익 효율성 지표.
   * 두 포트폴리오의 수익률이 같아도 변동성이 낮은 쪽의 샤프 비율이 더 높다.
   *
   * 공식: Sharpe = (포트폴리오 수익률 - 무위험 수익률) / 포트폴리오 표준편차
   * 1.0 이상이면 양호, 2.0 이상이면 우수한 포트폴리오로 간주.
   */
  SHARPE_RATIO: {
    ko: "샤프 비율",
    en: "Sharpe Ratio",
    description:
      "위험(표준편차) 한 단위당 무위험이자율을 초과한 수익률. 숫자가 클수록 같은 리스크 대비 수익이 효율적이다.",
    formula: "Sharpe = (포트폴리오 수익률 − 무위험 수익률) ÷ 포트폴리오 수익률 표준편차",
    tip: "1.0 이상: 양호 / 2.0 이상: 우수 / 3.0 이상: 매우 우수. 퀀트 전략 성과 비교의 표준 지표다.",
    category: "quant",
  },

} as const satisfies Record<string, TermEntry>;

/** 가치 및 기술적 분석 지표 용어 유니온 타입 */
export type QuantTermType = (typeof QuantTerms)[keyof typeof QuantTerms];

// ─────────────────────────────────────────────────────────────────────────────
// § 3. TradingTerms — 매매 및 시스템 용어
// ─────────────────────────────────────────────────────────────────────────────

export const TradingTerms = {

  /**
   * Take-Profit (익절)
   *
   * 보유 중인 주식이 목표 수익률에 도달했을 때 매도하여 이익을 확정짓는 행위.
   * ATR 기반 익절 설계: avgPrice × (1 + 3 × ATR%)
   * R:R(리스크-리워드) 비율 최소 1.5:1을 목표로 설계하는 것이 일반적이다.
   */
  TAKE_PROFIT: {
    ko: "익절 (이익 실현)",
    en: "Take-Profit",
    description:
      "보유 주식이 목표 수익 구간에 도달했을 때 매도하여 이익을 확정하는 행위. ATR 기반 원칙: 손절(2 ATR)의 1.5배 이상 수익(3 ATR)을 목표로 설정한다.",
    formula: "익절가 = 평균단가 × (1 + take_profit_pct/100)  /  take_profit_pct = 3 × ATR%",
    tip: "목표가에 분할 익절(50% → 30% → 20%)하면 추가 상승을 놓치지 않으면서 이익을 확보할 수 있다.",
    category: "trading",
  },

  /**
   * Stop-Loss (손절)
   *
   * 주가가 허용 범위 이하로 하락했을 때 추가 손실을 막기 위해 강제 매도하는 행위.
   * 가장 중요한 리스크 관리 도구로, 반드시 매수 전에 손절선을 정해야 한다.
   *
   * ATR 기반 손절 설계: avgPrice × (1 - 2 × ATR%)
   * 2 ATR은 정상 시장 노이즈(1 ATR)를 넘어선 통계적으로 유의미한 하락 신호다.
   */
  STOP_LOSS: {
    ko: "손절 (손실 제한)",
    en: "Stop-Loss",
    description:
      "주가가 사전에 정한 하락 한계선에 도달했을 때 추가 손실을 차단하기 위해 강제로 매도하는 행위. 매수보다 먼저 설정해야 하는 리스크 관리의 핵심이다.",
    formula: "손절가 = 평균단가 × (1 − stop_loss_pct/100)  /  stop_loss_pct = 2 × ATR%",
    tip: "손절 없이 버티는 것이 가장 큰 실수. '손절가를 미리 정하지 않으면 시장이 대신 정해준다'는 원칙을 지킬 것.",
    category: "trading",
  },

  /**
   * Trailing Stop (트레일링 스탑)
   *
   * 주가가 오르면 손절선도 함께 올라가지만 주가가 내리면 손절선은 그 자리에 고정되는 동적 손절 방식.
   * 상승 이익을 보호하면서 추세를 따라가는 스마트 손절 기법이다.
   *
   * ATR 기반 설계: 고점에서 2.5 ATR 하락 시 트레일링 스탑 발동.
   * 트레일링 스탑가 = 고점 × (1 - 2.5 × ATR%)
   */
  TRAILING_STOP: {
    ko: "트레일링 스탑 (추적 손절)",
    en: "Trailing Stop",
    description:
      "주가 상승에 따라 손절선도 함께 상향되는 동적 손절 방식. 주가가 최고점에서 일정 폭(ATR 기준) 하락하면 자동 매도되어 이익을 보호한다.",
    formula: "트레일링 손절가 = 고점(Peak) × (1 − trailing_stop_pct/100)  /  trailing_stop_pct = 2.5 × ATR%",
    tip: "추세 추종(Trend Following) 전략의 핵심 기법. 고점에서 멀어질수록 손절선이 안전 구간에 위치해 이익을 자동으로 수호한다.",
    category: "trading",
  },

  /**
   * Pyramiding / Scale-In (피라미딩, 불타기)
   *
   * 이미 수익이 나고 있는 포지션에 추가 매수하여 포지션을 늘리는 전략.
   * 이익이 검증된 방향으로만 추가 매수한다는 원칙으로, 물타기와 반대 개념이다.
   * 추가 매수 시 전체 평균 단가가 상승하므로, 추세가 반전되면 손실이 빠르게 커질 수 있다.
   *
   * ATR 기반 피라미딩 진입: avgPrice × (1 + 1 × ATR%)
   */
  PYRAMIDING: {
    ko: "피라미딩 (불타기)",
    en: "Pyramiding (Scale-In)",
    description:
      "이익 중인 포지션에 추가 매수하여 수익을 극대화하는 전략. '물타기'가 손실 포지션 확대라면 '불타기'는 수익 포지션 확대다. 거래량 급증이 동반될 때 진입 신뢰도가 높아진다.",
    formula: "피라미딩 진입가 = 평균단가 × (1 + 1 × ATR%)  (1 ATR 수익 시 추가 매수)",
    tip: "추가 매수 후 전체 손절선을 반드시 재계산·상향 조정해야 한다. 무분별한 추가 매수는 금물.",
    category: "trading",
  },

  /**
   * Averaging Down (물타기)
   *
   * 손실 중인 포지션의 주가가 하락했을 때 추가 매수하여 평균 매수 단가를 낮추는 행위.
   * 기업의 펀더멘털이 훼손되지 않았다면 유효하지만, 하락 추세 중에 무분별하게 반복하면
   * 손실이 눈덩이처럼 커지는 최악의 실수로 이어질 수 있다.
   */
  AVERAGING_DOWN: {
    ko: "물타기 (평균단가 낮추기)",
    en: "Averaging Down",
    description:
      "주가 하락 시 추가 매수하여 평균 취득 단가를 낮추는 전략. 장기 투자에서 펀더멘털이 견고하다면 유효하지만, 추세 하락 종목에 반복 적용하면 손실이 급격히 확대된다.",
    tip: "시스템 트레이딩에서는 '물타기'를 금지하는 것이 기본 원칙이다. 하락이 이미 손절선을 넘었다면 추가 매수 대신 전량 손절이 원칙.",
    category: "trading",
  },

  /**
   * Limit Order (지정가 주문)
   *
   * 투자자가 원하는 특정 가격을 지정하여 매수 또는 매도를 주문하는 방식.
   * 지정한 가격 이하(매수) 또는 이상(매도)에서만 체결된다.
   * 체결이 보장되지 않지만 원하는 가격을 확보할 수 있다.
   */
  LIMIT_ORDER: {
    ko: "지정가 주문",
    en: "Limit Order",
    description:
      "원하는 가격을 지정하여 그 가격 이하(매수)나 이상(매도)에서만 체결되도록 하는 주문 방식. 가격 통제가 가능하지만 체결이 보장되지 않는다.",
    tip: "급등·급락 시에는 체결이 안 될 수 있다. 슬리피지 방지에는 지정가가 유리하지만 속도가 중요한 경우 시장가를 사용한다.",
    category: "trading",
  },

  /**
   * Market Order (시장가 주문)
   *
   * 현재 시장에서 즉시 체결되도록 하는 주문 방식.
   * 가격보다 체결 속도를 우선할 때 사용하며, 최우선 호가로 즉시 체결된다.
   * 유동성이 낮은 종목에서는 예상보다 불리한 가격에 체결될 위험(슬리피지)이 있다.
   */
  MARKET_ORDER: {
    ko: "시장가 주문",
    en: "Market Order",
    description:
      "가격에 관계없이 현재 시장에서 즉시 체결되는 주문 방식. 체결이 확실하지만 유동성이 낮은 종목에서는 불리한 가격에 체결될 수 있다.",
    tip: "자동 매매에서 손절 주문은 반드시 시장가로 설정해야 한다. 손절 지정가는 급락 시 체결이 안 되는 최악의 상황이 발생한다.",
    category: "trading",
  },

  /**
   * Slippage (슬리피지)
   *
   * 주문을 낸 가격과 실제 체결된 가격의 차이. 시장 충격(Market Impact)이라고도 한다.
   * 유동성이 낮은 종목이나 대량 주문에서 크게 발생한다.
   * 알고리즘 트레이딩에서 백테스트 수익과 실제 운용 수익이 다른 주요 원인 중 하나다.
   *
   * 슬리피지 비용 = (실제 체결가 - 목표 체결가) × 수량
   */
  SLIPPAGE: {
    ko: "슬리피지 (체결가 미끄러짐)",
    en: "Slippage",
    description:
      "주문 시점의 예상 가격과 실제 체결 가격의 차이. 유동성이 낮거나 주문 규모가 클 때 크게 발생하며, 자동 매매 실전 성과를 갉아먹는 숨은 비용이다.",
    formula: "슬리피지 비용 = (실제 체결가 − 목표가) × 수량",
    tip: "백테스트에 슬리피지(0.05~0.1%)와 거래 수수료를 반드시 포함해야 현실적인 성과를 측정할 수 있다.",
    category: "trading",
  },

  /**
   * Position Sizing (포지션 사이징)
   *
   * 단일 종목에 투자할 자본 비율 또는 주식 수를 결정하는 리스크 관리 기법.
   * 켈리 기준(Kelly Criterion), 고정 비율법, ATR 기반 법 등 다양한 방법이 있다.
   *
   * ATR 기반 공식: 투자 주식 수 = (계좌 총자산 × 리스크%) / (ATR × 계수)
   * 예: 계좌 1억, 리스크 1%, ATR 2,000원 → 100,000,000 × 0.01 / 2,000 = 500주
   */
  POSITION_SIZING: {
    ko: "포지션 사이징 (투자 비중 결정)",
    en: "Position Sizing",
    description:
      "단일 거래에서 감수할 최대 리스크를 기반으로 투자 수량을 결정하는 기법. ATR 기반 사이징이 변동성에 비례하여 자동으로 리스크를 조절하는 표준이다.",
    formula: "투자 수량 = (계좌 총자산 × 허용 리스크%) ÷ (ATR × 손절 계수)",
    tip: "단일 종목 리스크는 총자산의 1~2%를 넘지 않는 것이 헤지펀드의 기본 원칙이다. ATR이 큰 종목은 자동으로 소량 매수하게 된다.",
    category: "trading",
  },

  /**
   * Drawdown (낙폭 / 최대 낙폭)
   *
   * 특정 기간 중 고점 대비 저점까지의 하락률.
   * 최대 낙폭(Max Drawdown, MDD)은 전략의 최악 시나리오를 나타내며,
   * 투자자가 심리적으로 버틸 수 있는지 판단하는 기준이 된다.
   *
   * 공식: Drawdown = (현재가 - 고점) / 고점 × 100
   */
  DRAWDOWN: {
    ko: "낙폭 / 최대 낙폭 (MDD)",
    en: "Drawdown / Maximum Drawdown",
    description:
      "고점 대비 현재 또는 저점까지의 하락률. 전략의 최대 낙폭(MDD)은 투자자가 감내해야 할 최악의 손실 구간을 보여주는 핵심 리스크 지표다.",
    formula: "Drawdown(%) = (현재가 − 고점) ÷ 고점 × 100",
    tip: "MDD -30%이면 원금 회복에 +43%가 필요하다. MDD와 회복 기간은 전략의 현실적 사용 가능 여부를 결정한다.",
    category: "trading",
  },

  /**
   * Alpha (알파, α)
   *
   * 시장(벤치마크 지수) 대비 초과 수익률. 투자자의 실력 또는 전략의 엣지를 나타낸다.
   * CAPM 모델 기준: α = 포트폴리오 수익률 - [무위험 수익률 + β × (시장 수익률 - 무위험 수익률)]
   * α > 0: 시장을 이긴 초과 수익 (긍정적 알파)
   * α < 0: 시장에 진 수익 (부정적 알파)
   */
  ALPHA: {
    ko: "알파 (초과 수익률)",
    en: "Alpha (α)",
    description:
      "시장 지수(벤치마크) 대비 초과 수익률. '이 전략이 단순히 시장에 투자하는 것보다 얼마나 더 잘했는가'를 나타낸다.",
    formula: "α = 전략 수익률 − [무위험 수익률 + β × (시장 수익률 − 무위험 수익률)]",
    tip: "장기적으로 일관된 양의 알파를 창출하는 전략은 매우 드물다. 시장 평균을 이기는 것이 퀀트의 궁극적 목표다.",
    category: "trading",
  },

  /**
   * Risk-Reward Ratio (리스크-리워드 비율, R:R)
   *
   * 단일 거래에서 감수하는 손실(리스크) 대비 기대하는 이익(리워드)의 비율.
   * 기본 원칙: 최소 1:1.5 이상(손절 1 ATR : 익절 1.5 ATR) 의 R:R을 유지해야
   * 승률이 50% 이하여도 장기적으로 이익이 가능하다.
   *
   * 공식: R:R = 목표 수익 / 최대 허용 손실
   */
  RISK_REWARD: {
    ko: "리스크-리워드 비율",
    en: "Risk-Reward Ratio (R:R)",
    description:
      "한 번의 거래에서 예상 손실 대비 예상 이익의 비율. R:R=1:2이면 손절 100만원 대비 익절 200만원 목표. 승률이 낮아도 R:R이 높으면 장기 수익이 가능하다.",
    formula: "R:R = 목표 익절폭 ÷ 최대 손절폭  (예: 3 ATR 익절 ÷ 2 ATR 손절 = 1.5)",
    tip: "R:R=1:1.5(손절 2 ATR, 익절 3 ATR)을 기준으로 승률 40%만 유지해도 기대값은 양수다. (0.4×1.5 − 0.6×1 = 0)",
    category: "trading",
  },

  /**
   * ATR 포지션 관리 시스템 (4단계 변동성 비례 체계)
   *
   * ATR 배수를 이용해 손절·트레일링·익절·피라미딩 4개 임계값을 종목의 변동성에
   * 비례하여 자동 산출하는 시스템 매매 프레임워크.
   *
   *   ① 손절     : 평단가 − 2 × ATR%    (월스트리트 표준 노이즈 필터)
   *   ② 트레일링 : 고점   − 2.5 × ATR%  (수익 구간 추세 보호)
   *   ③ 익절     : 평단가 + 3 × ATR%    (R:R = 3:2 = 1.5:1)
   *   ④ 피라미딩 : 평단가 + 1 × ATR%    (수익 검증 후 추가 매수)
   *
   * 4개 기준값이 모두 동일한 ATR에서 파생되므로 종목 변동성이 달라져도
   * 리스크-리워드 구조가 자동으로 유지된다.
   */
  ATR_POSITION_SYSTEM: {
    ko: "ATR 포지션 관리 시스템",
    en: "ATR-Based Position Management System",
    description:
      "종목별 ATR(14일 평균 진폭)에 고정 배수를 곱해 손절·트레일링·익절·피라미딩 가격을 자동 산출하는 통합 리스크 관리 프레임워크. 배수: 손절 2× · 트레일링 2.5× · 익절 3× · 피라미딩 1×.",
    formula:
      "손절가 = 평단 × (1 − 2×ATR%)  /  트레일링 = 고점 × (1 − 2.5×ATR%)  /  익절가 = 평단 × (1 + 3×ATR%)  /  피라미딩 = 평단 × (1 + 1×ATR%)",
    tip: "ATR 배수가 고정되므로 변동성이 2배인 종목은 손절폭도 2배가 된다 — 포지션 크기(Position Sizing)를 함께 줄여야 계좌 전체 리스크가 일정하게 유지된다.",
    category: "trading",
  },

  /**
   * ATR 클램핑 (변동성 극단값 제한)
   *
   * 실제 시장에는 ATR%가 비정상적으로 작거나 큰 종목이 존재한다.
   *   - 초저변동성 (ATR% < 0.5%): 공모 직후 거래 정지 상태나 유동성 극히 낮은 종목
   *   - 초고변동성 (ATR% > 12%): 상·하한가 직전이나 정치적 이슈로 급등락 중인 종목
   *
   * 클램핑 적용: ATR% = max(0.5%, min(ATR%, 12.0%))
   * → 극단 종목에서 손절가가 현재가와 동일하거나 음수가 되는 오류를 방지한다.
   */
  ATR_CLAMPING: {
    ko: "ATR 클램핑 (변동성 범위 제한)",
    en: "ATR Clamping (Volatility Floor-Ceil)",
    description:
      "ATR%가 비정상 극단값(초저·초고 변동성)일 때 하한 0.5% ~ 상한 12.0% 범위로 강제 보정하는 기법. 손절가 음수화·익절가 비현실적 폭발 등 엣지케이스 오류를 방지한다.",
    formula: "ATR%_정규화 = max(0.5%,  min(ATR%,  12.0%))",
    tip: "클램핑 없이 ATR% = 0.01%인 종목에 2× 손절을 적용하면 손절폭이 0.02%로 정상 호가 스프레드보다 작아져 즉시 손절이 발동한다. 클램핑은 이런 비정상 동작을 막는 안전망이다.",
    category: "trading",
  },

  /**
   * Backtest (백테스트)
   *
   * 과거 데이터를 사용하여 매매 전략이 실제 시장에서 어떻게 작동했을지 시뮬레이션하는 과정.
   * 전략 검증의 첫 단계이지만, 과최적화(Overfitting) 문제를 항상 경계해야 한다.
   * Walk-Forward Test: 백테스트를 시계열로 분할하여 과최적화를 방지하는 고급 방법.
   */
  BACKTEST: {
    ko: "백테스트 (과거 검증)",
    en: "Backtest",
    description:
      "과거 시장 데이터로 매매 전략을 시뮬레이션하여 성과를 측정하는 과정. MDD·샤프 비율·연 수익률 등 핵심 지표를 산출해 전략의 실행 가능성을 검증한다.",
    tip: "슬리피지·수수료 미반영, 생존 편향(상장 폐지 종목 제외), 과최적화가 백테스트 결과를 실제보다 좋게 만드는 3대 함정이다.",
    category: "trading",
  },

} as const satisfies Record<string, TermEntry>;

/** 매매 및 시스템 용어 유니온 타입 */
export type TradingTermType = (typeof TradingTerms)[keyof typeof TradingTerms];

// ─────────────────────────────────────────────────────────────────────────────
// § 4. 통합 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

/** 전체 용어 유니온 타입 */
export type AnyTermType = MarketTermType | QuantTermType | TradingTermType;

/** 카테고리별 레이블 */
export const CATEGORY_LABEL: Record<TermCategory, string> = {
  market:  "시장 기본",
  quant:   "퀀트 분석",
  trading: "매매 전략",
} as const;

export type TermEntryWithKey = TermEntry & { key: string };

/** 전체 용어 사전 (키: "DOMAIN.KEY" 형태) */
const ALL_TERMS = new Map<string, TermEntryWithKey>([
  ...Object.entries(MarketTerms).map(([k, v]): [string, TermEntryWithKey] => [`market.${k}`,  { ...v, key: k }]),
  ...Object.entries(QuantTerms).map(([k, v]):  [string, TermEntryWithKey] => [`quant.${k}`,   { ...v, key: k }]),
  ...Object.entries(TradingTerms).map(([k, v]): [string, TermEntryWithKey] => [`trading.${k}`, { ...v, key: k }]),
]);

/**
 * 키와 카테고리로 용어를 조회한다.
 * @param category - "market" | "quant" | "trading"
 * @param key      - 각 도메인 객체의 키 (예: "PER", "ATR", "STOP_LOSS")
 * @returns TermEntry 또는 undefined
 */
export function findTerm(category: TermCategory, key: string): TermEntry | undefined {
  return ALL_TERMS.get(`${category}.${key}`);
}

/**
 * 키워드로 전체 용어를 검색한다 (한국어명·영어명·설명 대상).
 * @param query - 검색어 (공백 기준으로 AND 검색)
 * @returns 매칭된 TermEntry 배열 (카테고리 → 가나다 순)
 */
export function searchTerms(query: string): TermEntryWithKey[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...ALL_TERMS.values()];

  return [...ALL_TERMS.values()].filter((entry) => {
    const haystack = [entry.ko, entry.en, entry.description, entry.tip ?? "", entry.formula ?? ""]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * 카테고리별 전체 용어 목록을 반환한다.
 * @param category - 필터링할 카테고리. undefined이면 전체 반환.
 */
export function getTermsByCategory(
  category?: TermCategory,
): TermEntryWithKey[] {
  const all = [...ALL_TERMS.values()];
  return category ? all.filter((e) => e.category === category) : all;
}
