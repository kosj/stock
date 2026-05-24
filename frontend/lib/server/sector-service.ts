// 섹터 서비스 - Vercel Serverless에서 실행
// Naver Finance에서 ETF 가격 데이터 실시간 수집

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

const NAVER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://finance.naver.com/",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

const CACHE_TTL = 300; // 5분 (주가는 실시간성 중요)
let etfCache: Record<string, { ts: number; data: ETFData[] }> = {};

// Naver Finance에서 ETF 가격 데이터 가져오기
async function fetchPriceFromNaver(
  ticker: string
): Promise<{ price: number; change1d: number; change1w: number; change1m: number; change3m: number; changeYtd: number } | null> {
  try {
    // Naver Finance API (비공개이지만 작동함)
    const response = await axios.get(
      `https://query.naver.com/svc/chartnews/get.naver?symbol=${ticker}&requestType=1&responseType=json`,
      {
        headers: NAVER_HEADERS,
        timeout: 10000,
      }
    );

    // 최신 가격 데이터
    const data = response.data?.result?.candle || [];
    if (!data.length) {
      console.warn(`No price data for ${ticker}`);
      return null;
    }

    // 가장 최근 데이터부터 정렬
    const sorted = [...data].sort((a: any, b: any) =>
      new Date(b.dt).getTime() - new Date(a.dt).getTime()
    );

    if (sorted.length < 2) return null;

    const latest = sorted[0];
    const current = parseFloat(latest.close);
    const yesterday = parseFloat(sorted[1]?.close || latest.close);

    // 1일 변화율
    const change1d = ((current - yesterday) / yesterday) * 100;

    // 더 오래된 데이터로 주간/월간 계산
    const week = sorted[Math.min(4, sorted.length - 1)]?.close || latest.close;
    const month = sorted[Math.min(20, sorted.length - 1)]?.close || latest.close;
    const threeMonth = sorted[Math.min(60, sorted.length - 1)]?.close || latest.close;
    const ytdStart = sorted[sorted.length - 1]?.close || latest.close;

    return {
      price: Math.round(current),
      change1d: parseFloat(change1d.toFixed(2)),
      change1w: parseFloat((((current - parseFloat(week)) / parseFloat(week)) * 100).toFixed(2)),
      change1m: parseFloat((((current - parseFloat(month)) / parseFloat(month)) * 100).toFixed(2)),
      change3m: parseFloat((((current - parseFloat(threeMonth)) / parseFloat(threeMonth)) * 100).toFixed(2)),
      changeYtd: parseFloat((((current - parseFloat(ytdStart)) / parseFloat(ytdStart)) * 100).toFixed(2)),
    };
  } catch (error) {
    console.warn(`Naver price fetch failed for ${ticker}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

// Naver 주식 API로 가격 정보 가져오기 (대체 방법)
async function fetchPriceFromNaverItem(
  ticker: string
): Promise<{ price: number; change1d: number; change1w: number; change1m: number; change3m: number; changeYtd: number } | null> {
  try {
    // Naver 주식 페이지에서 가격 정보 추출
    const response = await axios.get(
      `https://finance.naver.com/item/main.naver?code=${ticker}`,
      {
        headers: NAVER_HEADERS,
        timeout: 10000,
      }
    );

    // 정규식으로 현재가 추출
    const priceMatch = response.data.match(/<span class="price"[^>]*>([0-9,]+)<\/span>/);
    const changeMatch = response.data.match(/<span class="change[^"]*"[^>]*>([\d\.\-,]+)<\/span>/);

    if (!priceMatch || !priceMatch[1]) return null;

    const price = parseInt(priceMatch[1].replace(/,/g, ""));
    const changeStr = changeMatch ? changeMatch[1].replace(/,/g, "") : "0";
    const change1d = parseFloat(changeStr);

    return {
      price,
      change1d,
      change1w: 0,
      change1m: 0,
      change3m: 0,
      changeYtd: 0,
    };
  } catch (error) {
    console.warn(`Naver item fetch failed for ${ticker}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function getPerformanceData(): Promise<ETFData[]> {
  const results: ETFData[] = [];

  for (const sector of SECTOR_ETFS) {
    try {
      const priceData =
        (await fetchPriceFromNaver(sector.ticker)) ||
        (await fetchPriceFromNaverItem(sector.ticker));

      if (!priceData) {
        console.warn(`Failed to get price for ${sector.name}, using fallback`);
        // 폴백: 기본값 사용
        results.push({
          sector: sector.sector,
          ticker: sector.ticker,
          name: sector.name,
          price: 0,
          change_1d: 0,
          change_1w: 0,
          change_1m: 0,
          change_3m: 0,
          change_ytd: 0,
        });
        continue;
      }

      results.push({
        sector: sector.sector,
        ticker: sector.ticker,
        name: sector.name,
        price: priceData.price,
        change_1d: priceData.change1d || 0,
        change_1w: priceData.change1w || 0,
        change_1m: priceData.change1m || 0,
        change_3m: priceData.change3m || 0,
        change_ytd: priceData.changeYtd || 0,
      });
    } catch (error) {
      console.error(`Error fetching sector ${sector.sector}:`, error);
      results.push({
        sector: sector.sector,
        ticker: sector.ticker,
        name: sector.name,
        price: 0,
        change_1d: 0,
        change_1w: 0,
        change_1m: 0,
        change_3m: 0,
        change_ytd: 0,
      });
    }
  }

  return results.sort((a, b) => (b.change_1m || 0) - (a.change_1m || 0));
}

async function getSectorEtfsData(
  sector: string,
  sortBy: string = "1m"
): Promise<ETFData[]> {
  const now = Date.now();
  if (
    sector in etfCache &&
    now - etfCache[sector].ts < CACHE_TTL * 1000
  ) {
    const field = SORT_FIELDS[sortBy] || "change_1m";
    return [...etfCache[sector].data].sort(
      (a, b) => (b[field] as number) - (a[field] as number)
    );
  }

  const etfList = SECTOR_ETF_MAP[sector] || [];
  const results: ETFData[] = [];

  for (const etf of etfList) {
    try {
      const priceData =
        (await fetchPriceFromNaver(etf.ticker)) ||
        (await fetchPriceFromNaverItem(etf.ticker));

      if (!priceData) {
        console.warn(`Failed to get price for ${etf.name}`);
        results.push({
          ticker: etf.ticker,
          name: etf.name,
          price: 0,
          change_1d: 0,
          change_1w: 0,
          change_1m: 0,
          change_3m: 0,
          change_ytd: 0,
        });
        continue;
      }

      results.push({
        ticker: etf.ticker,
        name: etf.name,
        price: priceData.price,
        change_1d: priceData.change1d || 0,
        change_1w: priceData.change1w || 0,
        change_1m: priceData.change1m || 0,
        change_3m: priceData.change3m || 0,
        change_ytd: priceData.changeYtd || 0,
      });
    } catch (error) {
      console.error(`Error fetching ETF ${etf.ticker}:`, error);
      results.push({
        ticker: etf.ticker,
        name: etf.name,
        price: 0,
        change_1d: 0,
        change_1w: 0,
        change_1m: 0,
        change_3m: 0,
        change_ytd: 0,
      });
    }
  }

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
