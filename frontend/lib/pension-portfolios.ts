/**
 * 연금·절세계좌 투자 가이드 데이터 & 계산 로직
 * ─────────────────────────────────────────────────────────────────────────────
 * ISA / 연금저축펀드(개인연금) / IRP / 퇴직연금(DC)별로 절세 효율을 극대화하는
 * 모델 ETF 포트폴리오, 장기 수익률 시뮬레이션, 세제혜택 계산 유틸을 제공한다.
 *
 * ⚠ 본 데이터는 교육·참고용 일반 정보이며 특정 종목 매수 권유가 아니다.
 *   ETF 종목코드·보수·구성은 변경될 수 있으므로 매수 전 반드시 최신 정보를 확인할 것.
 *   기대수익률은 과거 장기 평균에 기반한 가정치이며 미래 수익을 보장하지 않는다.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export type AccountType = "pension" | "irp" | "dc" | "isa";
export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type AssetClass = "equity" | "dividend" | "bond" | "cash" | "gold";

export interface Etf {
  ticker: string;
  name: string;
  assetClass: AssetClass;
  /** 연금계좌 안전자산(위험자산 한도 규정상) 해당 여부 */
  safeAsset: boolean;
  /** 장기(연) 기대수익률 가정치 (명목, %) */
  assumedReturn: number;
  /** 총보수 참고치 (%) */
  expense: number;
  /** 포트폴리오 내 역할 설명 */
  role: string;
}

export interface Holding {
  etf: string; // ETF_UNIVERSE 키
  weight: number; // % (합계 100)
}

export interface Portfolio {
  holdings: Holding[];
  /** 한 줄 콘셉트 설명 */
  note: string;
}

export interface AccountMeta {
  key: AccountType;
  label: string;
  shortLabel: string;
  taxBenefit: string;
  contributionLimit: string;
  /** 위험자산 투자 한도 (0~1). null = 제한 없음 */
  riskAssetCap: number | null;
  /** 세액공제 대상 연 납입 한도 (원). null = 세액공제 없음(비과세형) */
  taxDeductLimit: number | null;
  restrictions: string[];
  bestFor: string;
  color: string; // tailwind text color class
}

// ─────────────────────────────────────────────────────────────────────────────
// ETF 유니버스 (전 종목 국내 상장·원화 — 연금/ISA 계좌 매수 가능)
// ─────────────────────────────────────────────────────────────────────────────

export const ETF_UNIVERSE: Record<string, Etf> = {
  sp500: {
    ticker: "360750",
    name: "TIGER 미국S&P500",
    assetClass: "equity",
    safeAsset: false,
    assumedReturn: 8.0,
    expense: 0.07,
    role: "미국 대형주 핵심(코어). 장기 성장의 중심 축",
  },
  nasdaq: {
    ticker: "133690",
    name: "TIGER 미국나스닥100",
    assetClass: "equity",
    safeAsset: false,
    assumedReturn: 9.5,
    expense: 0.07,
    role: "미국 기술 성장주. 수익률 상단을 높이는 위성(새틀라이트)",
  },
  schd: {
    ticker: "458730",
    name: "TIGER 미국배당다우존스",
    assetClass: "dividend",
    safeAsset: false,
    assumedReturn: 7.0,
    expense: 0.01,
    role: "배당성장(SCHD 계열). 계좌 내 배당 재투자로 복리 가속·변동성 완충",
  },
  kospi: {
    ticker: "069500",
    name: "KODEX 200",
    assetClass: "equity",
    safeAsset: false,
    assumedReturn: 6.0,
    expense: 0.15,
    role: "국내 대형주. 지역 분산 및 원화 자산 비중",
  },
  bondAgg: {
    ticker: "273130",
    name: "KODEX 종합채권(AA-이상)액티브",
    assetClass: "bond",
    safeAsset: true,
    assumedReturn: 3.5,
    expense: 0.05,
    role: "국내 우량 채권. 안전자산 요건 충족·주식 하락기 방어",
  },
  ustBond: {
    ticker: "305080",
    name: "TIGER 미국채10년선물",
    assetClass: "bond",
    safeAsset: true,
    assumedReturn: 3.5,
    expense: 0.29,
    role: "미국 국채. 위기 시 주식과 반대로 움직이는 완충재",
  },
  cdRate: {
    ticker: "459580",
    name: "KODEX CD금리액티브(합성)",
    assetClass: "cash",
    safeAsset: true,
    assumedReturn: 3.3,
    expense: 0.02,
    role: "초단기 금리(파킹). 안전자산 요건 충족·원금 안정성 최상",
  },
  gold: {
    ticker: "411060",
    name: "ACE KRX금현물",
    assetClass: "gold",
    safeAsset: false,
    assumedReturn: 5.0,
    expense: 0.5,
    role: "금 현물. 인플레이션·통화 위험 헤지 및 분산",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 위험성향 메타
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_PROFILES: Record<
  RiskProfile,
  { label: string; desc: string; horizon: string; color: string }
> = {
  conservative: {
    label: "안정형",
    desc: "변동성을 최대한 낮추고 원금 방어를 우선. 은퇴가 가깝거나 손실에 민감한 투자자.",
    horizon: "3년 이상",
    color: "text-emerald-400",
  },
  balanced: {
    label: "균형형",
    desc: "성장과 방어의 균형. 대부분의 장기 적립 투자자에게 적합한 표준 배분.",
    horizon: "7년 이상",
    color: "text-blue-400",
  },
  aggressive: {
    label: "성장형",
    desc: "장기 복리 극대화를 목표로 주식 비중을 높임. 투자기간이 길고 변동성을 감내 가능한 투자자.",
    horizon: "10년 이상",
    color: "text-amber-400",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 계좌 메타
// ─────────────────────────────────────────────────────────────────────────────

export const ACCOUNTS: Record<AccountType, AccountMeta> = {
  pension: {
    key: "pension",
    label: "연금저축펀드",
    shortLabel: "개인연금",
    taxBenefit: "연 최대 600만원 납입액에 대해 13.2~16.5% 세액공제 + 운용수익 과세이연",
    contributionLimit: "연 1,800만원 (세액공제는 600만원 한도)",
    riskAssetCap: null,
    taxDeductLimit: 6_000_000,
    restrictions: [
      "국내 상장 ETF만 매수 가능 (해외 상장 ETF 불가)",
      "만 55세 이후·가입 5년 경과 후 연금 수령 시 3.3~5.5% 저율 연금소득세",
      "중도 해지 시 세액공제분+수익에 16.5% 기타소득세",
    ],
    bestFor: "세액공제를 받으며 가장 공격적으로(주식 100%까지) 굴릴 수 있는 노후 핵심 계좌",
    color: "text-blue-400",
  },
  irp: {
    key: "irp",
    label: "IRP (개인형퇴직연금)",
    shortLabel: "IRP",
    taxBenefit: "연금저축과 합산 최대 900만원까지 13.2~16.5% 세액공제 + 과세이연",
    contributionLimit: "연 1,800만원 (연금저축 합산 세액공제 900만원 한도)",
    riskAssetCap: 0.7,
    taxDeductLimit: 9_000_000,
    restrictions: [
      "위험자산(주식·금 등) 투자는 적립금의 70%까지, 안전자산 30% 의무",
      "국내 상장 ETF만 매수 가능",
      "만 55세 이후 연금 수령 시 저율과세, 중도 해지 시 16.5% 기타소득세",
    ],
    bestFor: "연금저축 600만원을 채운 뒤 세액공제 한도를 900만원까지 늘리는 추가 계좌",
    color: "text-violet-400",
  },
  dc: {
    key: "dc",
    label: "퇴직연금 DC형",
    shortLabel: "퇴직연금",
    taxBenefit: "회사 부담금 운용수익 과세이연 + 근로자 추가납입분 세액공제(IRP와 합산 900만원)",
    contributionLimit: "회사 부담금 + 근로자 추가납입 (추가납입 세액공제 900만원 한도)",
    riskAssetCap: 0.7,
    taxDeductLimit: 9_000_000,
    restrictions: [
      "위험자산 투자는 적립금의 70%까지, 안전자산 30% 의무 (IRP와 동일)",
      "상품 라인업은 가입 사업장(운용사)이 제공하는 범위로 제한될 수 있음",
      "퇴직·이직 시 IRP로 이전하여 과세이연 유지 권장",
    ],
    bestFor: "회사가 적립해주는 퇴직금을 예금에 방치하지 않고 직접 ETF로 운용하려는 근로자",
    color: "text-teal-400",
  },
  isa: {
    key: "isa",
    label: "ISA (개인종합자산관리계좌)",
    shortLabel: "ISA",
    taxBenefit: "순이익 200만원(서민형 400만원) 비과세, 초과분 9.9% 분리과세",
    contributionLimit: "연 2,000만원 (최대 1억원), 3년 의무가입",
    riskAssetCap: null,
    taxDeductLimit: null,
    restrictions: [
      "국내 상장 ETF·국내주식·리츠 등 매수 가능 (해외 상장 ETF 불가)",
      "의무가입 3년 — 중도 해지 시 비과세 혜택 소멸",
      "만기 자금을 연금계좌로 이전하면 이전액의 10%(300만원 한도) 추가 세액공제",
    ],
    bestFor: "연금처럼 55세까지 묶기 부담스러운, 중기(3년+) 절세 목적 자금",
    color: "text-cyan-400",
  },
};

export const ACCOUNT_ORDER: AccountType[] = ["pension", "irp", "dc", "isa"];

// ─────────────────────────────────────────────────────────────────────────────
// 모델 포트폴리오
//   · 연금저축/ISA : 위험자산 한도 없음 → 주식 비중 자유
//   · IRP/DC       : 위험자산 70% 한도 → 안전자산(채권·CD) 30% 이상 편입
// ─────────────────────────────────────────────────────────────────────────────

// 위험자산 한도가 없는 계좌(연금저축·ISA)용 공통 템플릿
const UNCAPPED: Record<RiskProfile, Portfolio> = {
  conservative: {
    note: "주식 45% / 채권·금 55% — 변동성을 낮춘 방어형",
    holdings: [
      { etf: "sp500", weight: 25 },
      { etf: "schd", weight: 20 },
      { etf: "bondAgg", weight: 40 },
      { etf: "gold", weight: 15 },
    ],
  },
  balanced: {
    note: "주식 70% / 채권·금 30% — 성장과 방어의 표준 균형",
    holdings: [
      { etf: "sp500", weight: 40 },
      { etf: "nasdaq", weight: 15 },
      { etf: "schd", weight: 15 },
      { etf: "bondAgg", weight: 20 },
      { etf: "gold", weight: 10 },
    ],
  },
  aggressive: {
    note: "주식 90% / 금 10% — 장기 복리 극대화",
    holdings: [
      { etf: "sp500", weight: 45 },
      { etf: "nasdaq", weight: 30 },
      { etf: "schd", weight: 15 },
      { etf: "gold", weight: 10 },
    ],
  },
};

// 위험자산 70% 한도가 있는 계좌(IRP·DC)용 공통 템플릿 (안전자산 ≥ 30%)
const CAPPED: Record<RiskProfile, Portfolio> = {
  conservative: {
    note: "위험자산 35% / 안전자산 65% — 규정 한도보다 보수적으로 방어",
    holdings: [
      { etf: "sp500", weight: 20 },
      { etf: "schd", weight: 15 },
      { etf: "bondAgg", weight: 35 },
      { etf: "cdRate", weight: 30 },
    ],
  },
  balanced: {
    note: "위험자산 60% / 안전자산 40% — 한도 내 균형 배분",
    holdings: [
      { etf: "sp500", weight: 30 },
      { etf: "nasdaq", weight: 15 },
      { etf: "schd", weight: 15 },
      { etf: "bondAgg", weight: 25 },
      { etf: "cdRate", weight: 15 },
    ],
  },
  aggressive: {
    note: "위험자산 70%(규정 최대) / 안전자산 30% — 한도를 꽉 채운 성장형",
    holdings: [
      { etf: "sp500", weight: 35 },
      { etf: "nasdaq", weight: 25 },
      { etf: "schd", weight: 10 },
      { etf: "bondAgg", weight: 20 },
      { etf: "cdRate", weight: 10 },
    ],
  },
};

export const PORTFOLIOS: Record<AccountType, Record<RiskProfile, Portfolio>> = {
  pension: UNCAPPED,
  isa: UNCAPPED,
  irp: CAPPED,
  dc: CAPPED,
};

// ─────────────────────────────────────────────────────────────────────────────
// 계산 유틸
// ─────────────────────────────────────────────────────────────────────────────

/** 포트폴리오 가중 기대수익률 (연 %) */
export function computeExpectedReturn(holdings: Holding[]): number {
  const total = holdings.reduce((s, h) => s + h.weight, 0);
  if (total === 0) return 0;
  const weighted = holdings.reduce(
    (s, h) => s + h.weight * (ETF_UNIVERSE[h.etf]?.assumedReturn ?? 0),
    0,
  );
  return weighted / total;
}

/** 위험자산 비중 (%) — 연금계좌 70% 한도 검증용 */
export function riskAssetWeight(holdings: Holding[]): number {
  return holdings
    .filter((h) => !ETF_UNIVERSE[h.etf]?.safeAsset)
    .reduce((s, h) => s + h.weight, 0);
}

/** 자산군별 비중 집계 */
export function assetBreakdown(holdings: Holding[]): Record<AssetClass, number> {
  const acc = { equity: 0, dividend: 0, bond: 0, cash: 0, gold: 0 } as Record<
    AssetClass,
    number
  >;
  for (const h of holdings) {
    const cls = ETF_UNIVERSE[h.etf]?.assetClass;
    if (cls) acc[cls] += h.weight;
  }
  return acc;
}

export interface GrowthPoint {
  year: number;
  /** 누적 납입 원금 */
  principal: number;
  /** 복리 평가금액 */
  value: number;
}

export interface GrowthInput {
  initialAmount: number; // 초기 투자금 (원)
  monthlyContribution: number; // 월 적립액 (원)
  years: number;
  annualReturnPct: number; // 연 기대수익률 (%)
}

/**
 * 매월 말 정액 적립 + 월복리 성장 시뮬레이션.
 * 연 단위 스냅샷(year 0 = 초기 시점)을 반환한다.
 */
export function projectGrowth(input: GrowthInput): GrowthPoint[] {
  const { initialAmount, monthlyContribution, years, annualReturnPct } = input;
  const monthlyRate = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;

  let value = initialAmount;
  let principal = initialAmount;
  const series: GrowthPoint[] = [{ year: 0, principal, value }];

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      value = value * (1 + monthlyRate) + monthlyContribution;
      principal += monthlyContribution;
    }
    series.push({ year: y, principal, value });
  }
  return series;
}

export interface TaxBenefit {
  /** "세액공제" | "비과세·분리과세" */
  kind: string;
  /** 누적 절세/환급 예상액 (원) */
  amount: number;
  label: string;
  detail: string;
}

/**
 * 계좌별 세제혜택 근사 계산.
 *  · 연금저축/IRP/DC : 연 납입액(한도 내)에 세액공제율을 적용한 누적 환급액.
 *  · ISA           : 일반계좌(15.4%) 대비 절세액(비과세 200만 + 초과분 9.9% 분리과세) 근사.
 */
export function computeTaxBenefit(params: {
  account: AccountType;
  annualContribution: number; // 연 납입액 (원)
  years: number;
  totalGain: number; // 누적 투자수익 (원)
  incomeUnder5500: boolean; // 총급여 5,500만원 이하 여부(세액공제율 결정)
  seniorType?: boolean; // ISA 서민형 여부
}): TaxBenefit {
  const { account, annualContribution, years, totalGain, incomeUnder5500 } = params;
  const meta = ACCOUNTS[account];

  if (meta.taxDeductLimit != null) {
    const rate = incomeUnder5500 ? 0.165 : 0.132;
    const eligible = Math.min(annualContribution, meta.taxDeductLimit);
    const perYear = eligible * rate;
    const amount = perYear * years;
    return {
      kind: "세액공제",
      amount,
      label: "누적 세액공제 환급 예상액",
      detail: `연 ${(eligible / 10_000).toLocaleString("ko-KR")}만원 × ${(rate * 100).toFixed(
        1,
      )}% = 매년 약 ${Math.round(perYear / 10_000).toLocaleString(
        "ko-KR",
      )}만원씩 ${years}년간 환급 (연말정산 시 환급)`,
    };
  }

  // ISA: 일반계좌 대비 절세 근사 (비과세 한도까지는 과세 0, 초과분은 9.9% 분리과세)
  const exemptLimit = params.seniorType ? 4_000_000 : 2_000_000;
  const gain = Math.max(totalGain, 0);
  const generalTax = gain * 0.154; // 일반계좌 과세 가정
  const taxablePortion = Math.max(gain - exemptLimit, 0);
  const isaTax = taxablePortion * 0.099;
  const saved = generalTax - isaTax;
  return {
    kind: "비과세·분리과세",
    amount: Math.max(saved, 0),
    label: "일반계좌 대비 절세 예상액",
    detail: `순이익 ${(exemptLimit / 10_000).toLocaleString(
      "ko-KR",
    )}만원까지 비과세, 초과분 9.9% 분리과세 적용(일반계좌 15.4% 대비)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 분할매수(적립식) 가이드 데이터
// ─────────────────────────────────────────────────────────────────────────────

export interface DcaPlan {
  goal: string;
  annual: number;
  monthly: number;
  note: string;
}

/** 세제혜택 한도를 채우기 위한 권장 적립 스케줄 */
export const DCA_PLANS: DcaPlan[] = [
  {
    goal: "연금저축 세액공제 최대화",
    annual: 6_000_000,
    monthly: 500_000,
    note: "세액공제 한도(600만원)를 12개월로 나눠 매월 자동이체",
  },
  {
    goal: "연금저축+IRP 세액공제 최대화",
    annual: 9_000_000,
    monthly: 750_000,
    note: "합산 한도(900만원)까지 채우면 최대 148.5만원 환급(16.5% 기준)",
  },
  {
    goal: "ISA 납입한도 활용",
    annual: 20_000_000,
    monthly: 1_666_000,
    note: "연 2,000만원 한도. 여유 자금 범위에서 비과세 한도를 채움",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 매수 타점 가이드 데이터
// ─────────────────────────────────────────────────────────────────────────────

export interface TimingRule {
  /** 정기 매수 타점 (기본) */
  regular: string;
  /** 추가 매수 타점 (기회 구간) */
  addOn: string;
  /** 피해야 할 타점 */
  avoid: string;
}

/** 자산군별 매수 타점 규칙 */
export const TIMING_BY_ASSET: Record<AssetClass, TimingRule> = {
  equity: {
    regular: "매월 정기 매수일(급여일 직후)에 시장 상황과 무관하게 기계적 매수",
    addOn: "전고점 대비 -10% 이상 조정 시 예비현금을 단계별 투입 (아래 하락장 트리거 표)",
    avoid: "단기 급등 후 추격 매수(FOMO), 시장 예측으로 정기 매수를 미루는 것",
  },
  dividend: {
    regular: "매월 정기 매수 + 분배금은 받은 달에 재투자해 복리 가속",
    addOn: "주가 하락으로 배당수익률이 평소 수준보다 높아진 구간은 장기 매집 기회",
    avoid: "분배락 직전 단기 매수(분배금만큼 가격이 빠져 실익 없음)",
  },
  bond: {
    regular: "매월 정기 매수로 목표 비중 유지 (주식 하락기 완충재 역할)",
    addOn: "기준금리 인상 사이클 후반~고점권(채권 가격 바닥권)에서 비중 확대 유리",
    avoid: "금리 급등 구간의 공포 매도, 금리 인하가 이미 반영된 뒤의 추격 매수",
  },
  cash: {
    regular: "신규 납입 시 자동 배분 (IRP·DC 안전자산 30% 요건 충족용)",
    addOn: "주식 추가매수용 예비현금(드라이파우더) 대기 장소로 활용",
    avoid: "필요 이상 장기 보유 (인플레이션에 실질가치 잠식)",
  },
  gold: {
    regular: "리밸런싱 시점에만 목표 비중에 맞춰 기계적 매수",
    addOn: "비중 미달이면서 주식과 동반 하락한 구간은 분할 매수 기회",
    avoid: "전쟁·위기 뉴스에 반응한 고점 추격 매수",
  },
};

export interface DipStep {
  drop: string; // 전고점 대비 하락률
  label: string; // 국면 명칭
  action: string; // 행동 지침
  freq: string; // 역사적 발생 빈도
}

/**
 * 하락장 단계별 추가매수 트리거 (전고점 대비 하락률 기준).
 * 예비현금은 월 정기 적립과 별도로 모아둔 현금성 자산(CD금리 ETF 등)을 말한다.
 */
export const DIP_LADDER: DipStep[] = [
  {
    drop: "-10%",
    label: "조정",
    action: "예비현금의 30% 추가 매수",
    freq: "대략 연 1회 수준으로 흔함",
  },
  {
    drop: "-20%",
    label: "약세장",
    action: "예비현금의 40% 추가 매수",
    freq: "수년에 한 번",
  },
  {
    drop: "-30% 이상",
    label: "급락·위기",
    action: "잔여 예비현금을 2~3회 분할 투입",
    freq: "10년에 1~2회 (금융위기·팬데믹급)",
  },
];

export interface CalendarItem {
  period: string;
  title: string;
  desc: string;
}

/** 연간 매수 캘린더 */
export const BUY_CALENDAR: CalendarItem[] = [
  {
    period: "매월",
    title: "정기 자동매수 — 제1 타점",
    desc: "급여일 직후 자동이체로 기계적 매수. 시장 상황을 보지 않는 것이 핵심",
  },
  {
    period: "분기",
    title: "비중 점검",
    desc: "목표 비중 ±5%p 이탈 확인. 신규 납입금으로 부족한 자산을 우선 매수하면 매도 없이 비중 조정 가능",
  },
  {
    period: "1월",
    title: "세액공제 한도 리셋",
    desc: "연초부터 적립을 시작해야 과세이연·복리 기간이 최대화됨",
  },
  {
    period: "11~12월",
    title: "한도 소진 + 연 1회 리밸런싱",
    desc: "연금저축 600만·IRP 합산 900만 미달분을 일괄 납입하고, 목표 비중으로 리밸런싱",
  },
  {
    period: "수시",
    title: "하락장 추가 매수",
    desc: "전고점 대비 하락률 트리거 충족 시에만 예비현금 투입 (정기 적립은 그대로 유지)",
  },
];

