/** Hybrid Stacking Ensemble 일간 추천 분석 대상 종목 풀 — 시총 5000억 이상 기준 */

export interface StockInfo {
  ticker: string;
  name: string;
  sector: string;
  market: "KOSPI" | "KOSDAQ";
}

export const STOCK_UNIVERSE: StockInfo[] = [
  // ── 반도체 ──────────────────────────────────────────────────────────────────
  { ticker: "005930", name: "삼성전자",         sector: "반도체",  market: "KOSPI"  },
  { ticker: "000660", name: "SK하이닉스",       sector: "반도체",  market: "KOSPI"  },
  { ticker: "042700", name: "한미반도체",       sector: "반도체",  market: "KOSDAQ" },
  { ticker: "240810", name: "원익IPS",          sector: "반도체",  market: "KOSDAQ" },

  // ── 2차전지 ─────────────────────────────────────────────────────────────────
  { ticker: "373220", name: "LG에너지솔루션",   sector: "2차전지", market: "KOSPI"  },
  { ticker: "051910", name: "LG화학",           sector: "2차전지", market: "KOSPI"  },
  { ticker: "003670", name: "포스코퓨처엠",     sector: "2차전지", market: "KOSPI"  },
  { ticker: "247540", name: "에코프로비엠",     sector: "2차전지", market: "KOSDAQ" },
  { ticker: "086520", name: "에코프로",         sector: "2차전지", market: "KOSDAQ" },

  // ── 자동차 ──────────────────────────────────────────────────────────────────
  { ticker: "005380", name: "현대차",           sector: "자동차",  market: "KOSPI"  },
  { ticker: "000270", name: "기아",             sector: "자동차",  market: "KOSPI"  },
  { ticker: "012330", name: "현대모비스",       sector: "자동차",  market: "KOSPI"  },

  // ── IT/플랫폼 ────────────────────────────────────────────────────────────────
  { ticker: "035420", name: "NAVER",            sector: "IT",      market: "KOSPI"  },
  { ticker: "035720", name: "카카오",           sector: "IT",      market: "KOSPI"  },
  { ticker: "323410", name: "카카오뱅크",       sector: "IT",      market: "KOSPI"  },

  // ── 게임 ────────────────────────────────────────────────────────────────────
  { ticker: "036570", name: "NC소프트",         sector: "게임",    market: "KOSDAQ" },
  { ticker: "259960", name: "크래프톤",         sector: "게임",    market: "KOSPI"  },
  { ticker: "263750", name: "펄어비스",         sector: "게임",    market: "KOSDAQ" },
  { ticker: "293490", name: "카카오게임즈",     sector: "게임",    market: "KOSDAQ" },

  // ── 엔터 ────────────────────────────────────────────────────────────────────
  { ticker: "041510", name: "에스엠",           sector: "엔터",    market: "KOSDAQ" },
  { ticker: "035900", name: "JYP Ent.",         sector: "엔터",    market: "KOSDAQ" },
  { ticker: "122870", name: "와이지엔터테인먼트", sector: "엔터",  market: "KOSDAQ" },
  { ticker: "352820", name: "하이브",           sector: "엔터",    market: "KOSPI"  },

  // ── 바이오/제약 ─────────────────────────────────────────────────────────────
  { ticker: "207940", name: "삼성바이오로직스", sector: "바이오",  market: "KOSPI"  },
  { ticker: "068270", name: "셀트리온",         sector: "바이오",  market: "KOSPI"  },
  { ticker: "128940", name: "한미약품",         sector: "바이오",  market: "KOSDAQ" },
  { ticker: "145020", name: "휴젤",             sector: "바이오",  market: "KOSDAQ" },

  // ── 금융 ────────────────────────────────────────────────────────────────────
  { ticker: "105560", name: "KB금융",           sector: "금융",    market: "KOSPI"  },
  { ticker: "055550", name: "신한지주",         sector: "금융",    market: "KOSPI"  },
  { ticker: "086790", name: "하나금융지주",     sector: "금융",    market: "KOSPI"  },
  { ticker: "032830", name: "삼성생명",         sector: "금융",    market: "KOSPI"  },
  { ticker: "316140", name: "우리금융지주",     sector: "금융",    market: "KOSPI"  },

  // ── 철강/소재 ───────────────────────────────────────────────────────────────
  { ticker: "005490", name: "POSCO홀딩스",      sector: "소재",    market: "KOSPI"  },
  { ticker: "010130", name: "고려아연",         sector: "소재",    market: "KOSPI"  },

  // ── 화학/에너지 ─────────────────────────────────────────────────────────────
  { ticker: "096770", name: "SK이노베이션",     sector: "에너지",  market: "KOSPI"  },
  { ticker: "010950", name: "S-Oil",            sector: "에너지",  market: "KOSPI"  },
  { ticker: "011170", name: "롯데케미칼",       sector: "화학",    market: "KOSPI"  },

  // ── 방산 ────────────────────────────────────────────────────────────────────
  { ticker: "012450", name: "한화에어로스페이스", sector: "방산",  market: "KOSPI"  },
  { ticker: "047810", name: "한국항공우주",     sector: "방산",    market: "KOSPI"  },
  { ticker: "064350", name: "현대로템",         sector: "방산",    market: "KOSPI"  },
  { ticker: "000880", name: "한화",             sector: "방산",    market: "KOSPI"  },

  // ── 건설 ────────────────────────────────────────────────────────────────────
  { ticker: "028260", name: "삼성물산",         sector: "건설",    market: "KOSPI"  },
  { ticker: "000720", name: "현대건설",         sector: "건설",    market: "KOSPI"  },

  // ── 소비재/유통 ─────────────────────────────────────────────────────────────
  { ticker: "139480", name: "이마트",           sector: "유통",    market: "KOSPI"  },
  { ticker: "282330", name: "BGF리테일",        sector: "유통",    market: "KOSPI"  },

  // ── 통신 ────────────────────────────────────────────────────────────────────
  { ticker: "017670", name: "SK텔레콤",         sector: "통신",    market: "KOSPI"  },
  { ticker: "030200", name: "KT",               sector: "통신",    market: "KOSPI"  },

  // ── 해운/물류 ───────────────────────────────────────────────────────────────
  { ticker: "011200", name: "HMM",              sector: "해운",    market: "KOSPI"  },
  { ticker: "000120", name: "CJ대한통운",       sector: "물류",    market: "KOSPI"  },

  // ── 소부장 ──────────────────────────────────────────────────────────────────
  { ticker: "357780", name: "솔브레인",         sector: "소부장",  market: "KOSDAQ" },
  { ticker: "166090", name: "하나머티리얼즈",   sector: "소부장",  market: "KOSDAQ" },
];

/** 시총 필터 기준 (KRW): 5000억 */
export const MIN_MARKET_CAP_KRW = 500_000_000_000;
