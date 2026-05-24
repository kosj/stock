import { getChart, getQuote } from "./yahoo-finance";

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
  series?: { date: string; value: number }[];
}

const SECTOR_ETFS = [
  { sector: "반도체",    ticker: "091160", name: "KODEX 반도체" },
  { sector: "2차전지",   ticker: "305720", name: "KODEX 2차전지산업" },
  { sector: "바이오",    ticker: "244580", name: "KODEX 바이오" },
  { sector: "인터넷/IT", ticker: "139260", name: "KODEX 인터넷" },
  { sector: "자동차",    ticker: "091180", name: "KODEX 자동차" },
  { sector: "금융",      ticker: "139270", name: "KODEX 은행" },
  { sector: "에너지",    ticker: "117460", name: "KODEX 에너지화학" },
  { sector: "건설",      ticker: "139220", name: "KODEX 건설" },
  { sector: "철강/소재", ticker: "139230", name: "KODEX 철강" },
  { sector: "AI/로봇",   ticker: "364980", name: "KODEX K-로봇액티브" },
] as const;

export const SECTOR_ETF_MAP: Record<string, Array<{ ticker: string; name: string }>> = {
  "반도체":    [{ ticker: "091160", name: "KODEX 반도체" }, { ticker: "091230", name: "TIGER 반도체" }, { ticker: "396510", name: "SOL 반도체소부장" }],
  "2차전지":   [{ ticker: "305720", name: "KODEX 2차전지산업" }, { ticker: "305540", name: "TIGER 2차전지테마" }],
  "바이오":    [{ ticker: "244580", name: "KODEX 바이오" }, { ticker: "143850", name: "TIGER 헬스케어" }, { ticker: "266410", name: "KODEX 바이오플러스헬스케어" }],
  "인터넷/IT": [{ ticker: "139260", name: "KODEX 인터넷" }, { ticker: "157490", name: "TIGER 소프트웨어" }, { ticker: "371460", name: "TIGER KRX IT" }],
  "자동차":    [{ ticker: "091180", name: "KODEX 자동차" }, { ticker: "140710", name: "TIGER 자동차" }],
  "금융":      [{ ticker: "139270", name: "KODEX 은행" }, { ticker: "091220", name: "TIGER 은행" }, { ticker: "139290", name: "KODEX 증권" }],
  "에너지":    [{ ticker: "117460", name: "KODEX 에너지화학" }, { ticker: "140700", name: "TIGER 에너지화학" }],
  "건설":      [{ ticker: "139220", name: "KODEX 건설" }, { ticker: "140720", name: "TIGER 건설기계" }],
  "철강/소재": [{ ticker: "139230", name: "KODEX 철강" }, { ticker: "140690", name: "TIGER 화학" }],
  "AI/로봇":   [{ ticker: "364980", name: "KODEX K-로봇액티브" }, { ticker: "462870", name: "KODEX AI반도체핵심장비" }, { ticker: "411600", name: "TIGER 글로벌AI&로봇" }],
};

function calcReturn(prices: number[], windowDays: number): number {
  if (prices.length < windowDays + 1) return 0;
  const end   = prices[prices.length - 1];
  const start = prices[prices.length - 1 - windowDays];
  return start ? Math.round(((end - start) / start) * 10000) / 100 : 0;
}

async function fetchETFData(ticker: string, name: string, sector?: string): Promise<ETFData | null> {
  try {
    const candles = await getChart(ticker, "1y");
    if (candles.length < 2) return null;

    const prices = candles.map((c) => c.close);
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const ytdPrices = candles.filter((c) => c.time >= yearStart).map((c) => c.close);
    const ytdReturn = ytdPrices.length > 1
      ? Math.round(((ytdPrices[ytdPrices.length - 1] - ytdPrices[0]) / ytdPrices[0]) * 10000) / 100
      : 0;

    return {
      sector,
      ticker,
      name,
      price:       Math.round(prices[prices.length - 1]),
      change_1d:   calcReturn(prices, 1),
      change_1w:   calcReturn(prices, 5),
      change_1m:   calcReturn(prices, 20),
      change_3m:   calcReturn(prices, 60),
      change_ytd:  ytdReturn,
      series:      candles.slice(-60).map((c) => ({ date: c.time, value: c.close })),
    };
  } catch {
    return null;
  }
}

export class SectorService {
  static async getPerformance(): Promise<ETFData[]> {
    const results = await Promise.allSettled(
      SECTOR_ETFS.map(({ ticker, name, sector }) => fetchETFData(ticker, name, sector))
    );
    const data = results
      .filter((r) => r.status === "fulfilled" && r.value != null)
      .map((r) => (r as PromiseFulfilledResult<ETFData>).value);

    return data.sort((a, b) => (b.change_1m ?? 0) - (a.change_1m ?? 0));
  }

  static async getSectorEtfs(sector: string, sortBy = "1m"): Promise<ETFData[]> {
    const list = SECTOR_ETF_MAP[sector] ?? [];
    const results = await Promise.allSettled(
      list.map(({ ticker, name }) => fetchETFData(ticker, name))
    );
    const data = results
      .filter((r) => r.status === "fulfilled" && r.value != null)
      .map((r) => (r as PromiseFulfilledResult<ETFData>).value);

    const field = ({ "1d": "change_1d", "1w": "change_1w", "1m": "change_1m", "3m": "change_3m", ytd: "change_ytd" } as Record<string, keyof ETFData>)[sortBy] ?? "change_1m";
    return data.sort((a, b) => ((b[field] as number) ?? 0) - ((a[field] as number) ?? 0));
  }

  static async getRotation() {
    const sectors = await this.getPerformance();
    const sorted  = [...sectors].sort((a, b) => (b.change_1m ?? 0) - (a.change_1m ?? 0));
    const leading = sorted.slice(0, 3).map((s) => s.sector ?? s.name);
    const lagging = sorted.slice(-3).map((s) => s.sector ?? s.name);
    const topSet  = new Set(leading);

    let theme: string;
    if (topSet.has("반도체") || topSet.has("AI/로봇"))         theme = "기술 성장주 주도장 - AI/반도체 사이클 상승 국면";
    else if (topSet.has("바이오"))                              theme = "헬스케어/바이오 주도장 - 방어주 선호 구간";
    else if (topSet.has("금융") || topSet.has("건설"))          theme = "경기민감/가치주 주도장 - 금리 환경 개선 기대";
    else if (topSet.has("2차전지") || topSet.has("에너지"))     theme = "친환경/에너지 전환 주도장";
    else                                                        theme = `${leading.slice(0, 2).join(", ")} 주도 순환매 진행 중`;

    return {
      date: new Date().toISOString().slice(0, 10),
      sectors,
      leading,
      lagging,
      theme,
    };
  }
}
