// 섹터 서비스 - Vercel Serverless에서 실행
// 주의: Vercel의 메모리/시간 제한으로 인해 제한된 기능

interface SectorETF {
  sector: string;
  ticker: string;
  name: string;
}

interface ETFData {
  sector?: string;
  ticker: string;
  name: string;
  price: number;
  change_1d: number;
  change_1w: number;
  change_1m: number;
  change_3m: number;
  change_ytd: number;
  series?: Array<{ date: string; value: number }>;
}

const SECTOR_ETFS: SectorETF[] = [
  { sector: "반도체", ticker: "091160", name: "KODEX 반도체" },
  { sector: "2차전지", ticker: "305720", name: "KODEX 2차전지산업" },
  { sector: "바이오", ticker: "244580", name: "KODEX 바이오" },
  { sector: "인터넷/IT", ticker: "139260", name: "KODEX 인터넷" },
  { sector: "자동차", ticker: "091180", name: "KODEX 자동차" },
  { sector: "금융", ticker: "139270", name: "KODEX 은행" },
  { sector: "에너지", ticker: "117460", name: "KODEX 에너지화학" },
  { sector: "건설", ticker: "139220", name: "KODEX 건설" },
  { sector: "철강/소재", ticker: "139230", name: "KODEX 철강" },
  { sector: "AI/로봇", ticker: "364980", name: "KODEX K-로봇액티브" },
];

const SECTOR_ETF_MAP: Record<string, Array<{ ticker: string; name: string }>> = {
  "반도체": [
    { ticker: "091160", name: "KODEX 반도체" },
    { ticker: "091230", name: "TIGER 반도체" },
    { ticker: "091170", name: "KBSTAR 반도체" },
    { ticker: "396510", name: "SOL 반도체소부장" },
  ],
  "2차전지": [
    { ticker: "305720", name: "KODEX 2차전지산업" },
    { ticker: "305540", name: "TIGER 2차전지테마" },
    { ticker: "381180", name: "KBSTAR 2차전지&미래차" },
  ],
  "바이오": [
    { ticker: "244580", name: "KODEX 바이오" },
    { ticker: "143850", name: "TIGER 헬스케어" },
    { ticker: "227550", name: "KBSTAR 헬스케어" },
    { ticker: "266410", name: "KODEX 바이오플러스헬스케어" },
  ],
  "인터넷/IT": [
    { ticker: "139260", name: "KODEX 인터넷" },
    { ticker: "157490", name: "TIGER 소프트웨어" },
    { ticker: "381175", name: "KBSTAR IT플러스" },
    { ticker: "371460", name: "TIGER KRX IT" },
  ],
  "자동차": [
    { ticker: "091180", name: "KODEX 자동차" },
    { ticker: "140710", name: "TIGER 자동차" },
  ],
  "금융": [
    { ticker: "139270", name: "KODEX 은행" },
    { ticker: "091220", name: "TIGER 은행" },
    { ticker: "139290", name: "KODEX 증권" },
  ],
  "에너지": [
    { ticker: "117460", name: "KODEX 에너지화학" },
    { ticker: "140700", name: "TIGER 에너지화학" },
  ],
  "건설": [
    { ticker: "139220", name: "KODEX 건설" },
    { ticker: "140720", name: "TIGER 건설기계" },
  ],
  "철강/소재": [
    { ticker: "139230", name: "KODEX 철강" },
    { ticker: "140690", name: "TIGER 화학" },
  ],
  "AI/로봇": [
    { ticker: "364980", name: "KODEX K-로봇액티브" },
    { ticker: "462870", name: "KODEX AI반도체핵심장비" },
    { ticker: "445090", name: "TIGER AI코리아그로스액티브" },
    { ticker: "411600", name: "TIGER 글로벌AI&로봇" },
  ],
};

const SORT_FIELDS: Record<string, keyof ETFData> = {
  "1d": "change_1d",
  "1w": "change_1w",
  "1m": "change_1m",
  "3m": "change_3m",
  ytd: "change_ytd",
};

const ETF_CACHE_TTL = 3600; // 1시간
let etfCache: Record<string, { ts: number; data: ETFData[] }> = {};

// Yahoo Finance에서 가격 데이터 가져오기
async function fetchPriceFromYahoo(ticker: string): Promise<number | null> {
  try {
    // 한국 티커를 Yahoo 형식으로 변환 (예: 091160 -> 091160.KS)
    const yahooTicker = `${ticker}.KS`;
    const response = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${yahooTicker}?modules=price`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data?.quoteSummary?.result?.[0]?.price?.regularMarketPrice?.raw || null;
  } catch (error) {
    console.warn(`Yahoo Finance price fetch failed for ${ticker}:`, error);
    return null;
  }
}

// 샘플 데이터 생성 (데모용)
function generateMockData(etf: SectorETF | { ticker: string; name: string }): ETFData {
  const basePrice = Math.random() * 50000 + 20000;
  return {
    sector: "sector" in etf ? etf.sector : undefined,
    ticker: etf.ticker,
    name: etf.name,
    price: Math.round(basePrice),
    change_1d: (Math.random() - 0.5) * 4,
    change_1w: (Math.random() - 0.5) * 8,
    change_1m: (Math.random() - 0.5) * 12,
    change_3m: (Math.random() - 0.5) * 20,
    change_ytd: (Math.random() - 0.4) * 30,
  };
}

async function getPerformanceData(): Promise<ETFData[]> {
  // 현재는 샘플 데이터 반환
  // 프로덕션에서는 실제 데이터 소스 필요
  return SECTOR_ETFS.map(generateMockData).sort((a, b) => b.change_1m - a.change_1m);
}

async function getSectorEtfsData(
  sector: string,
  sortBy: string = "1m"
): Promise<ETFData[]> {
  const now = Date.now();
  if (
    sector in etfCache &&
    now - etfCache[sector].ts < ETF_CACHE_TTL * 1000
  ) {
    const field = SORT_FIELDS[sortBy] || "change_1m";
    return [...etfCache[sector].data].sort(
      (a, b) => (b[field] as number) - (a[field] as number)
    );
  }

  const etfList = SECTOR_ETF_MAP[sector] || [];
  const results: ETFData[] = etfList.map(generateMockData);

  etfCache[sector] = { ts: now, data: results };
  const field = SORT_FIELDS[sortBy] || "change_1m";
  return [...results].sort(
    (a, b) => (b[field] as number) - (a[field] as number)
  );
}

export class SectorService {
  static async getPerformance(): Promise<ETFData[]> {
    return getPerformanceData();
  }

  static async getSectorEtfs(
    sector: string,
    sortBy: string = "1m"
  ): Promise<ETFData[]> {
    return getSectorEtfsData(sector, sortBy);
  }

  static async getRotation() {
    const sectors = await this.getPerformance();
    const sorted1m = [...sectors].sort((a, b) => b.change_1m - a.change_1m);
    const leading = sorted1m.slice(0, 3).map((s) => s.name);
    const lagging = sorted1m.slice(-3).map((s) => s.name);

    const topSectors = new Set(leading);
    let theme = "기타";

    if (topSectors.has("KODEX 반도체") || topSectors.has("KODEX K-로봇액티브")) {
      theme = "기술 성장주 주도장 - AI/반도체 사이클 상승 국면";
    } else if (topSectors.has("KODEX 바이오")) {
      theme = "헬스케어/바이오 주도장 - 방어주 선호 구간";
    } else if (topSectors.has("KODEX 은행") || topSectors.has("KODEX 건설")) {
      theme = "경기민감/가치주 주도장 - 금리 환경 개선 기대";
    } else if (topSectors.has("KODEX 2차전지산업") || topSectors.has("KODEX 에너지화학")) {
      theme = "친환경/에너지 전환 주도장";
    } else {
      theme = `${leading.slice(0, 2).join(", ")} 주도 순환매 진행 중`;
    }

    return {
      date: new Date().toISOString().split("T")[0],
      sectors,
      leading,
      lagging,
      theme,
    };
  }
}
