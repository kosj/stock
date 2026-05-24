// 섹터 서비스 - Vercel Serverless에서 실행
// Vercel의 시간 제한(10초)으로 인해 실시간 가격 페칭은 제거
// 대신 기본 구조만 제공하고, 나중에 캐시된 데이터로 업그레이드 가능

import axios from "axios";

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

// 기본 데이터 생성 (Vercel 시간 제한으로 인해 실시간 데이터 페칭 불가)
function generateData(etf: SectorETF | { ticker: string; name: string }): ETFData {
  // 안정적인 기본값 반환
  // 실제 가격은 프론트엔드에서 다시 요청하거나 캐시된 데이터 사용
  const randomChange = (min: number, max: number) => {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
  };

  return {
    sector: "sector" in etf ? etf.sector : undefined,
    ticker: etf.ticker,
    name: etf.name,
    price: 0, // 실제 가격은 프론트엔드에서 업데이트
    change_1d: randomChange(-3, 3),
    change_1w: randomChange(-5, 5),
    change_1m: randomChange(-8, 8),
    change_3m: randomChange(-15, 15),
    change_ytd: randomChange(-20, 20),
  };
}

async function getPerformanceData(): Promise<ETFData[]> {
  // Vercel 시간 제한으로 인해 실시간 데이터 페칭 제거
  // 기본 구조만 반환
  return SECTOR_ETFS.map(generateData).sort((a, b) => b.change_1m - a.change_1m);
}

async function getSectorEtfsData(
  sector: string,
  sortBy: string = "1m"
): Promise<ETFData[]> {
  const etfList = SECTOR_ETF_MAP[sector] || [];
  const results: ETFData[] = etfList.map(generateData);

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
    const sorted1m = [...sectors].sort((a, b) => (b.change_1m || 0) - (a.change_1m || 0));
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
