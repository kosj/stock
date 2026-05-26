import * as cheerio from "cheerio";

const NAVER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://finance.naver.com/sise/",
  "Accept-Language": "ko-KR,ko;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// 네이버 investorDealTrendTime 단위: 백만원
const MILLION = 1_000_000;

// KOSPI 대표 섹터 KODEX ETF 코드 → 업종명
const SECTOR_ETFS = [
  { code: "102110", name: "IT" },
  { code: "091230", name: "반도체" },
  { code: "091160", name: "화학" },
  { code: "266410", name: "바이오" },
  { code: "091180", name: "철강소재" },
  { code: "117700", name: "건설" },
  { code: "117710", name: "조선운송" },
  { code: "130730", name: "음식료" },
  { code: "130720", name: "미디어통신" },
  { code: "091170", name: "에너지화학" },
] as const;

// 네이버 TH 텍스트 → 내부 투자자 키
// "_기관"으로 시작하는 그룹헤더는 서브헤더로 덮어씌워짐
const COL_NAME_MAP: Record<string, string> = {
  개인:           "개인",
  외국인:         "외국인",
  기관계:         "기관계",
  기관:           "_기관",
  금융투자:       "금융투자",
  보험:           "보험",
  "투신(사모)":   "투신",
  "투신 (사모)":  "투신",
  투신:           "투신",
  은행:           "은행",
  기타금융기관:   "기타금융",
  기타금융:       "기타금융",
  연기금등:       "연기금등",
  기타법인:       "기타법인",
};

const INVESTOR_ORDER = [
  "금융투자", "보험", "투신", "은행", "기타금융", "연기금등",
  "기관계", "외국인", "개인", "기타법인",
];
const ORDER_MAP: Record<string, number> = Object.fromEntries(
  INVESTOR_ORDER.map((n, i) => [n, i]),
);

// 인메모리 캐시 (서버리스 환경에서는 요청 단위로 리셋될 수 있음)
const cache = new Map<string, { ts: number; data: unknown }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function getLastTradingDay(): string {
  const d = new Date();
  if (d.getHours() < 16) d.setDate(d.getDate() - 1);
  // 주말 건너뜀
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0].replace(/-/g, "");
}

async function fetchEucKrHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: NAVER_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export type InvestorRow = { name: string; buy: number; sell: number; net: number };

async function fetchInvestorSync(
  bizdate: string,
  sosok: string,
): Promise<InvestorRow[]> {
  const url =
    `https://finance.naver.com/sise/investorDealTrendTime.naver` +
    `?bizdate=${bizdate}&sosok=${sosok}`;

  try {
    const html = await fetchEucKrHtml(url);
    const $ = cheerio.load(html);

    // "시간" + "개인" + "외국인" 헤더를 포함한 테이블 탐색
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let $table: any = null;
    $("table").each((_, el) => {
      const thTexts = $(el)
        .find("th")
        .map((__, th) => $(th).text().trim())
        .get();
      if (
        thTexts.includes("시간") &&
        thTexts.includes("개인") &&
        thTexts.includes("외국인")
      ) {
        $table = $(el);
        return false; // break
      }
    });

    if (!$table) {
      console.warn(`[KRX] 테이블 없음 sosok=${sosok}`);
      return [];
    }

    // colspan/rowspan을 고려한 가상 컬럼 인덱스 → 투자자명 매핑
    const MAX_COLS = 15;
    // occupied[row][col]: 이전 행의 rowspan으로 이미 채워진 셀
    const occupied: boolean[][] = Array.from(
      { length: 4 },
      () => new Array(MAX_COLS).fill(false),
    );
    const colNames: (string | null)[] = new Array(MAX_COLS).fill(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $table.find("tr").each((rowIdx: number, tr: any) => {
      if (rowIdx >= 4) return false;
      const $ths = $(tr).find("th");
      if (!$ths.length) return;

      let col = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $ths.each((_: number, th: any) => {
        // rowspan으로 점유된 컬럼 건너뜀
        while (col < MAX_COLS && occupied[rowIdx][col]) col++;
        if (col >= MAX_COLS) return false;

        const $th = $(th);
        const text = $th.text().trim().replace(/\s+/g, " ");
        const colspan = Math.max(1, parseInt($th.attr("colspan") || "1", 10));
        const rowspan = Math.max(1, parseInt($th.attr("rowspan") || "1", 10));
        const mapped = COL_NAME_MAP[text] ?? null;

        for (let c = col; c < Math.min(col + colspan, MAX_COLS); c++) {
          // 이후 행 점유 표시
          for (let r = rowIdx + 1; r < Math.min(rowIdx + rowspan, 4); r++) {
            occupied[r][c] = true;
          }
          // 서브헤더(rowIdx > 0)가 그룹헤더를 덮어씌움
          // "_"로 시작하는 그룹헤더는 최종 컬럼에 사용하지 않음
          if (mapped && !mapped.startsWith("_")) {
            if (!colNames[c] || rowIdx > 0) {
              colNames[c] = mapped;
            }
          }
        }
        col += colspan;
      });
    });

    console.log(
      `[KRX] sosok=${sosok} colMap:`,
      JSON.stringify(colNames.slice(0, 12)),
    );

    // 가장 최신 시간대 데이터 행 (HH:mm 형식으로 시작하는 첫 번째 tr)
    let dataRow: string[] | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $table.find("tr").each((_: number, tr: any) => {
      if (dataRow) return false;
      const $tds = $(tr).find("td");
      if (!$tds.length) return;
      const firstText = $tds.first().text().trim();
      if (/^\d{2}:\d{2}/.test(firstText)) {
        dataRow = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $tds.each((_2: number, td: any) => {
          dataRow!.push($(td).text().trim().replace(/,/g, ""));
        });
      }
    });

    if (!dataRow) {
      console.warn(
        `[KRX] 데이터 행 없음 sosok=${sosok} bizdate=${bizdate}`,
      );
      return [];
    }

    console.log(`[KRX] sosok=${sosok} row:`, dataRow);

    const result: InvestorRow[] = [];
    const seen = new Set<string>();

    // col 0 = 시간, col 1부터 투자자 데이터
    for (let c = 1; c < (dataRow as string[]).length && c < MAX_COLS; c++) {
      const name = colNames[c];
      if (!name || seen.has(name)) continue;
      seen.add(name);

      const val = parseFloat((dataRow as string[])[c]) || 0;
      const net = Math.round(val * MILLION);
      result.push({
        name,
        buy:  Math.max(0, net),
        sell: Math.max(0, -net),
        net,
      });
    }

    result.sort(
      (a, b) => (ORDER_MAP[a.name] ?? 99) - (ORDER_MAP[b.name] ?? 99),
    );
    return result;
  } catch (err) {
    console.error(
      `[KRX] 투자자 스크래핑 실패 sosok=${sosok}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

// 네이버 폴링 API로 KODEX ETF 현재가 + 등락률 조회
async function fetchEtfPrice(code: string): Promise<{
  price: number;
  change: number;
  change_pct: number;
}> {
  const url =
    `https://polling.finance.naver.com/api/realtime` +
    `?category=stock&includeAllInfo=Y&query=SERVICE_ITEM:${code}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": NAVER_HEADERS["User-Agent"],
      Referer: "https://finance.naver.com/",
    },
    signal: AbortSignal.timeout(6000),
  });
  const buf = await res.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("euc-kr").decode(buf);
  } catch {
    text = new TextDecoder("utf-8").decode(buf);
  }

  const json = JSON.parse(text);
  const d = json?.result?.areas?.[0]?.datas?.[0];
  if (!d) throw new Error(`no data for ETF ${code}`);
  return {
    price:      Number(d.nv),
    change:     Number(d.cv),
    change_pct: Number(d.cr),
  };
}

export class KrxService {
  static getLastTradingDay = getLastTradingDay;

  static async getInvestorTrends() {
    const bizdate = getLastTradingDay();
    const key = `investor_${bizdate}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchInvestorSync(bizdate, "01"),
      fetchInvestorSync(bizdate, "02"),
    ]);

    const data = { date: bizdate, kospi: kospiRows, kosdaq: kosdaqRows };
    cache.set(key, { ts: Date.now(), data });
    return data;
  }

  static async getSectorIndex() {
    const bizdate = getLastTradingDay();
    const key = `sector_${bizdate}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

    const results = await Promise.allSettled(
      SECTOR_ETFS.map(e => fetchEtfPrice(e.code)),
    );

    const sectors = results
      .map((r, i) => ({
        name:       SECTOR_ETFS[i].name,
        index:      r.status === "fulfilled" ? r.value.price      : 0,
        change:     r.status === "fulfilled" ? r.value.change     : 0,
        change_pct: r.status === "fulfilled" ? r.value.change_pct : 0,
        // 당일 등락률만 제공 (나머지 기간은 미지원)
        change_1d:  r.status === "fulfilled" ? r.value.change_pct : null,
        change_1w:  null as number | null,
        change_1m:  null as number | null,
        change_3m:  null as number | null,
        change_ytd: null as number | null,
      }))
      .filter(s => s.index > 0);

    const data = { date: bizdate, kospi: sectors, kosdaq: [] };
    cache.set(key, { ts: Date.now(), data });
    return data;
  }

  static async getShortSelling() {
    const bizdate = getLastTradingDay();
    return { date: bizdate, by_market: [], top_kospi: [], top_kosdaq: [] };
  }

  static async getDashboard() {
    const [investor, sector, short] = await Promise.allSettled([
      this.getInvestorTrends(),
      this.getSectorIndex(),
      this.getShortSelling(),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inv = investor.status === "fulfilled" ? (investor.value as any) : { date: "", kospi: [], kosdaq: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sec = sector.status === "fulfilled"   ? (sector.value   as any) : { date: "", kospi: [], kosdaq: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sht = short.status === "fulfilled"    ? (short.value    as any) : { date: "", by_market: [], top_kospi: [], top_kosdaq: [] };

    const moneyFlow = {
      flows: [
        { investor: "외국인",   key: "외국인" },
        { investor: "기관",     key: "기관계" },
        { investor: "개인",     key: "개인" },
        { investor: "기타법인", key: "기타법인" },
      ].map(({ investor, key }) => ({
        investor,
        kospi_net:
          inv.kospi.find((x: InvestorRow) => x.name === key)?.net ?? 0,
        kosdaq_net:
          inv.kosdaq.find((x: InvestorRow) => x.name === key)?.net ?? 0,
        total_net:
          (inv.kospi.find((x: InvestorRow)  => x.name === key)?.net ?? 0) +
          (inv.kosdaq.find((x: InvestorRow) => x.name === key)?.net ?? 0),
      })),
    };

    return {
      date: inv.date,
      money_flow: moneyFlow,
      investor: inv,
      sector_index: sec,
      short_selling: sht,
    };
  }

  static async getRaw(_bld: string, extra: Record<string, string>) {
    const bizdate = extra.trdDd || getLastTradingDay();
    const rows = await fetchInvestorSync(bizdate, "01");
    return { date: bizdate, source: "naver_investorDealTrendTime", rows };
  }
}
