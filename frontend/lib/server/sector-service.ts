import { DateTime } from "luxon";

interface SectorETF {
  sector: string;
  ticker: string;
  name: string;
}

interface ETFData {
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

const SECTOR_ETF_MAP: Record<string, Array<{ ticker: string; name: string }>> =
  {
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

const ETF_CACHE_TTL = 300; // 5분
let etfCache: Record<string, { ts: number; data: ETFData[] }> = {};

function calcReturn(prices: number[], window: number): number | null {
  if (prices.length < window + 1) return null;
  const end = prices[prices.length - 1];
  const start = prices[prices.length - window - 1];
  return start ? parseFloat(((((end - start) / start) * 100).toFixed(2))) : null;
}

async function fetchSectorPerformanceSync(): Promise<ETFData[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 400 * 24 * 60 * 60 * 1000);
  const results: ETFData[] = [];
  const yearStart = `${end.getFullYear()}-01-01`;

  for (const s of SECTOR_ETFS) {
    try {
      const response = await fetch(
        `https://api.example.com/price/${s.ticker}?start=${start.toISOString().split("T")[0]}&end=${end.toISOString().split("T")[0]}`
      );

      if (!response.ok) continue;

      const priceData = await response.json();
      const prices = priceData.prices || [];
      const dates = priceData.dates || [];

      if (!prices.length || prices.length < 2) continue;

      const currentPrice = prices[prices.length - 1];
      const ytdPrices = prices.filter(
        (_: number, i: number) => new Date(dates[i]) >= new Date(yearStart)
      );
      const ytdStart = ytdPrices.length > 0 ? ytdPrices[0] : prices[0];
      const ytdReturn = ytdStart
        ? parseFloat(((((currentPrice - ytdStart) / ytdStart) * 100).toFixed(2)))
        : 0;

      results.push({
        ticker: s.ticker,
        name: s.name,
        price: Math.round(currentPrice),
        change_1d: calcReturn(prices, 1) || 0,
        change_1w: calcReturn(prices, 5) || 0,
        change_1m: calcReturn(prices, 20) || 0,
        change_3m: calcReturn(prices, 60) || 0,
        change_ytd: ytdReturn,
        series: dates
          .slice(-60)
          .map((date: string, i: number) => ({ date, value: prices[prices.length - 60 + i] })),
      });
    } catch (error) {
      console.warn(`sector [${s.ticker}] error:`, error);
    }
  }

  return results.sort((a, b) => b.change_1m - a.change_1m);
}

async function fetchSectorEtfsSync(
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
      (a, b) =>
        (b[field] as number) - (a[field] as number)
    );
  }

  const etfList = SECTOR_ETF_MAP[sector] || [];
  const end = new Date();
  const start = new Date(end.getTime() - 400 * 24 * 60 * 60 * 1000);
  const yearStart = `${end.getFullYear()}-01-01`;
  const results: ETFData[] = [];

  for (const etf of etfList) {
    try {
      const response = await fetch(
        `https://api.example.com/price/${etf.ticker}?start=${start.toISOString().split("T")[0]}&end=${end.toISOString().split("T")[0]}`
      );

      if (!response.ok) continue;

      const priceData = await response.json();
      const prices = priceData.prices || [];
      const dates = priceData.dates || [];

      if (!prices.length || prices.length < 2) continue;

      const currentPrice = prices[prices.length - 1];
      const ytdPrices = prices.filter(
        (_: number, i: number) => new Date(dates[i]) >= new Date(yearStart)
      );
      const ytdStart = ytdPrices.length > 0 ? ytdPrices[0] : prices[0];
      const ytdReturn = ytdStart
        ? parseFloat(((((currentPrice - ytdStart) / ytdStart) * 100).toFixed(2)))
        : 0;

      results.push({
        ticker: etf.ticker,
        name: etf.name,
        price: Math.round(currentPrice),
        change_1d: calcReturn(prices, 1) || 0,
        change_1w: calcReturn(prices, 5) || 0,
        change_1m: calcReturn(prices, 20) || 0,
        change_3m: calcReturn(prices, 60) || 0,
        change_ytd: ytdReturn,
      });
    } catch (error) {
      console.info(
        `ETF [${etf.ticker} ${etf.name}] 스킵:`,
        error
      );
    }
  }

  etfCache[sector] = { ts: now, data: results };
  const field = SORT_FIELDS[sortBy] || "change_1m";
  return [...results].sort(
    (a, b) =>
      (b[field] as number) - (a[field] as number)
  );
}

function getRotationAnalysis(sectors: ETFData[]) {
  if (!sectors.length) {
    return { leading: [], lagging: [], theme: "데이터 없음" };
  }

  const sorted1m = [...sectors].sort((a, b) => b.change_1m - a.change_1m);
  const leading = sorted1m.slice(0, 3).map((s) => s.name);
  const lagging = sorted1m.slice(-3).map((s) => s.name);

  const topSectors = new Set(leading);
  let theme = "기타";

  if (topSectors.has("반도체") || topSectors.has("AI/로봇")) {
    theme = "기술 성장주 주도장 - AI/반도체 사이클 상승 국면";
  } else if (topSectors.has("바이오")) {
    theme = "헬스케어/바이오 주도장 - 방어주 선호 구간";
  } else if (topSectors.has("금융") || topSectors.has("건설")) {
    theme = "경기민감/가치주 주도장 - 금리 환경 개선 기대";
  } else if (topSectors.has("2차전지") || topSectors.has("에너지")) {
    theme = "친환경/에너지 전환 주도장";
  } else {
    theme = `${leading.slice(0, 2).join(", ")} 주도 순환매 진행 중`;
  }

  return { leading, lagging, theme };
}

export class SectorService {
  static async getPerformance() {
    return fetchSectorPerformanceSync();
  }

  static async getSectorEtfs(sector: string, sortBy: string = "1m") {
    return fetchSectorEtfsSync(sector, sortBy);
  }

  static async getRotation() {
    const sectors = await this.getPerformance();
    const analysis = getRotationAnalysis(sectors);
    return {
      date: new Date().toISOString().split("T")[0],
      sectors,
      ...analysis,
    };
  }
}
