import axios from "axios";

const NAVER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://finance.naver.com/sise/",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

const EOK = 100_000_000;

const INVESTOR_ORDER = [
  "금융투자",
  "보험",
  "투신",
  "은행",
  "기타금융",
  "연기금등",
  "기관계",
  "외국인",
  "개인",
  "기타법인",
];

const COL_MAP: Record<string, string> = {
  개인: "개인",
  외국인: "외국인",
  기관계: "기관계",
  금융투자: "금융투자",
  보험: "보험",
  "투신(사모)": "투신",
  "투신 (사모)": "투신",
  은행: "은행",
  기타금융기관: "기타금융",
  기타금융: "기타금융",
  연기금등: "연기금등",
  기타법인: "기타법인",
};

let cache: Record<string, { ts: number; data: any }> = {};
const CACHE_TTL = 1800; // 30분

function getLastTradingDay(): string {
  const d = new Date();
  if (d.getHours() < 16) {
    d.setDate(d.getDate() - 1);
  }
  while (d.getDay() >= 5) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().split("T")[0].replace(/-/g, "");
}

async function fetchInvestorSync(
  bizdate: string,
  sosok: string
): Promise<Array<{ name: string; buy: number; sell: number; net: number }>> {
  const url = new URL("https://finance.naver.com/sise/investorDealTrendTime.naver");
  url.searchParams.set("bizdate", bizdate);
  url.searchParams.set("sosok", sosok);

  try {
    const response = await axios.get(url.toString(), {
      headers: NAVER_HEADERS,
      timeout: 15000,
      responseType: "arraybuffer",
    });

    // EUC-KR 디코딩
    const iconv = require("iconv-lite");
    const text = iconv.decode(Buffer.from(response.data), "euc-kr");

    // 테이블 파싱 (간단한 정규식 기반)
    const rows: Array<{ name: string; buy: number; sell: number; net: number }> = [];
    const tableMatch = text.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];

    for (const row of tableMatch) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
      if (cells.length < 2) continue;

      const getCellText = (cell: string) => {
        const match = cell.match(/>([^<]+)</);
        return match ? match[1].trim().replace(/[,]/g, "") : "";
      };

      for (const [colRaw, colMapped] of Object.entries(COL_MAP)) {
        const cellIndex = cells.findIndex((cell) => {
          const text = getCellText(cell);
          return text === colRaw || text === colRaw.replace(/\s/g, "");
        });

        if (cellIndex !== -1 && cells[cellIndex + 1]) {
          const valText = getCellText(cells[cellIndex + 1]);
          try {
            const netEok = parseFloat(valText);
            const net = Math.round(netEok * EOK);
            rows.push({
              name: colMapped,
              buy: Math.max(0, net),
              sell: Math.max(0, -net),
              net,
            });
          } catch {}
        }
      }
    }

    // 정렬
    const orderMap: Record<string, number> = {};
    INVESTOR_ORDER.forEach((n, i) => {
      orderMap[n] = i;
    });
    rows.sort((a, b) => (orderMap[a.name] || 99) - (orderMap[b.name] || 99));

    // 중복 제거
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.name)) return false;
      seen.add(r.name);
      return true;
    });
  } catch (error) {
    console.error(`네이버 투자자 스크래핑 실패 sosok=${sosok}:`, error);
    return [];
  }
}

export class KrxService {
  static getLastTradingDay(): string {
    return getLastTradingDay();
  }

  static async getInvestorTrends() {
    const trdDd = getLastTradingDay();
    const cacheKey = `investor_${trdDd}`;

    if (cacheKey in cache) {
      const { ts, data } = cache[cacheKey];
      if (Date.now() - ts < CACHE_TTL * 1000) {
        return data;
      }
    }

    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchInvestorSync(trdDd, "01"),
      fetchInvestorSync(trdDd, "02"),
    ]);

    const data = {
      date: trdDd,
      kospi: kospiRows,
      kosdaq: kosdaqRows,
    };

    cache[cacheKey] = { ts: Date.now(), data };
    return data;
  }

  static async getSectorIndex() {
    // 섹터 데이터는 SectorService에서 가져옴
    return {
      date: getLastTradingDay(),
      kospi: [],
      kosdaq: [],
    };
  }

  static async getShortSelling() {
    const trdDd = getLastTradingDay();
    const cacheKey = `short_${trdDd}`;

    if (cacheKey in cache) {
      const { ts, data } = cache[cacheKey];
      if (Date.now() - ts < CACHE_TTL * 1000) {
        return data;
      }
    }

    const data = {
      date: trdDd,
      by_market: [],
      top_kospi: [],
      top_kosdaq: [],
    };

    cache[cacheKey] = { ts: Date.now(), data };
    return data;
  }

  static async getDashboard() {
    const [investor, sector, short] = await Promise.allSettled([
      this.getInvestorTrends(),
      this.getSectorIndex(),
      this.getShortSelling(),
    ]);

    const getResult = (result: PromiseSettledResult<any>, defaults: any) =>
      result.status === "fulfilled" ? result.value : defaults;

    const inv = getResult(investor, {
      date: "",
      kospi: [],
      kosdaq: [],
    });
    const sec = getResult(sector, {
      date: "",
      kospi: [],
      kosdaq: [],
    });
    const sht = getResult(short, {
      date: "",
      by_market: [],
      top_kospi: [],
      top_kosdaq: [],
    });

    const moneyFlow = {
      flows: [
        {
          investor: "외국인",
          kospi_net: inv.kospi.find((x: any) => x.name === "외국인")?.net || 0,
          kosdaq_net:
            inv.kosdaq.find((x: any) => x.name === "외국인")?.net || 0,
          total_net:
            (inv.kospi.find((x: any) => x.name === "외국인")?.net || 0) +
            (inv.kosdaq.find((x: any) => x.name === "외국인")?.net || 0),
        },
        {
          investor: "기관",
          kospi_net: inv.kospi.find((x: any) => x.name === "기관계")?.net || 0,
          kosdaq_net:
            inv.kosdaq.find((x: any) => x.name === "기관계")?.net || 0,
          total_net:
            (inv.kospi.find((x: any) => x.name === "기관계")?.net || 0) +
            (inv.kosdaq.find((x: any) => x.name === "기관계")?.net || 0),
        },
        {
          investor: "개인",
          kospi_net: inv.kospi.find((x: any) => x.name === "개인")?.net || 0,
          kosdaq_net:
            inv.kosdaq.find((x: any) => x.name === "개인")?.net || 0,
          total_net:
            (inv.kospi.find((x: any) => x.name === "개인")?.net || 0) +
            (inv.kosdaq.find((x: any) => x.name === "개인")?.net || 0),
        },
        {
          investor: "기타법인",
          kospi_net: inv.kospi.find((x: any) => x.name === "기타법인")?.net || 0,
          kosdaq_net:
            inv.kosdaq.find((x: any) => x.name === "기타법인")?.net || 0,
          total_net:
            (inv.kospi.find((x: any) => x.name === "기타법인")?.net || 0) +
            (inv.kosdaq.find((x: any) => x.name === "기타법인")?.net || 0),
        },
      ],
    };

    return {
      date: inv.date,
      money_flow: moneyFlow,
      investor: inv,
      sector_index: sec,
      short_selling: sht,
    };
  }

  static async getRaw(bld: string, extra: Record<string, string>) {
    const trdDd = extra.trdDd || getLastTradingDay();
    const rows = await fetchInvestorSync(trdDd, "01");
    return {
      date: trdDd,
      source: "naver_investorDealTrendTime",
      rows,
    };
  }
}
