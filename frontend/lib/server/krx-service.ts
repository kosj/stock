import * as cheerio from "cheerio";

// ─── 공통 상수 ────────────────────────────────────────────────────────────────

const MILLION = 1_000_000; // 백만원 → 원 변환 (Naver·KRX 단위: 백만원)

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

const INVESTOR_ORDER = [
  "금융투자", "보험", "투신", "은행", "기타금융", "연기금등",
  "기관계", "외국인", "개인", "기타법인",
];
const ORDER_MAP: Record<string, number> = Object.fromEntries(
  INVESTOR_ORDER.map((n, i) => [n, i]),
);

const cache = new Map<string, { ts: number; data: unknown }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

// ─── 날짜 유틸 (KST 기준) ─────────────────────────────────────────────────────

// Vercel 서버는 UTC이므로 반드시 KST(+9) 오프셋 적용
function getLastTradingDay(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000); // UTC → KST

  // 16:00 KST 이전이면 당일 장마감 데이터 미확정 → 전일 사용
  if (kst.getUTCHours() < 16) kst.setUTCDate(kst.getUTCDate() - 1);

  // 주말(토=6, 일=0) 건너뜀
  while (kst.getUTCDay() === 0 || kst.getUTCDay() === 6) {
    kst.setUTCDate(kst.getUTCDate() - 1);
  }

  const y  = kst.getUTCFullYear();
  const m  = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type InvestorRow = { name: string; buy: number; sell: number; net: number };

// ─── 소스 1: KRX 공식 JSON API ────────────────────────────────────────────────

// KRX 투자자명 → 내부 키 매핑
const KRX_NAME_MAP: Record<string, string> = {
  개인:     "개인",
  외국인:   "외국인",
  기관계:   "기관계",
  금융투자: "금융투자",
  보험:     "보험",
  투신:     "투신",
  사모:     "_사모",  // 투신과 별도이므로 표시 제외
  은행:     "은행",
  기타금융: "기타금융",
  연기금등: "연기금등",
  기타법인: "기타법인",
};

async function fetchInvestorFromKrx(
  bizdate: string,
  market: "KOSPI" | "KOSDAQ",
): Promise<InvestorRow[]> {
  const bld =
    market === "KOSPI"
      ? "dbms/MDC/STAT/standard/MDCSTAT01701"
      : "dbms/MDC/STAT/standard/MDCSTAT01801";

  const body = new URLSearchParams({
    bld,
    locale:       "ko_KR",
    trdDd:        bizdate,
    share:        "1",
    money:        "1",  // 단위: 백만원
    csvxls_isNo:  "false",
  });

  const res = await fetch(
    "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
    {
      method:  "POST",
      headers: {
        "Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer":          "https://data.krx.co.kr/",
        "User-Agent":       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":           "application/json, text/javascript, */*; q=0.01",
        "Accept-Language":  "ko-KR,ko;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
      },
      body:   body.toString(),
      signal: AbortSignal.timeout(12000),
    },
  );

  if (!res.ok) throw new Error(`KRX HTTP ${res.status}`);
  const json = await res.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = json?.OutBlock_1 ?? [];
  if (!items.length) throw new Error(`KRX 데이터 없음 (${bizdate} ${market})`);

  const result: InvestorRow[] = [];
  const seen = new Set<string>();

  const parse = (v: unknown) =>
    parseInt(String(v ?? "0").replace(/[,\s]/g, ""), 10) || 0;

  for (const item of items) {
    const rawName = (item.INVST_TP_NM ?? "").trim();
    const name = KRX_NAME_MAP[rawName];
    if (!name || name.startsWith("_") || seen.has(name)) continue;
    seen.add(name);

    const net  = parse(item.NETBID_TRDVAL ?? item.NET_TRDVAL);
    const buy  = parse(item.BUY_TRDVAL);
    const sell = parse(item.SELL_TRDVAL);

    result.push({ name, buy: buy * MILLION, sell: sell * MILLION, net: net * MILLION });
  }

  if (!result.length) throw new Error("KRX 매핑 실패 — INVST_TP_NM 형식 확인 필요");

  result.sort((a, b) => (ORDER_MAP[a.name] ?? 99) - (ORDER_MAP[b.name] ?? 99));
  return result;
}

// ─── 소스 2: Naver Finance HTML 스크래핑 (폴백) ───────────────────────────────

const NAVER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer:          "https://finance.naver.com/sise/",
  "Accept-Language": "ko-KR,ko;q=0.9",
  Accept:           "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const NAVER_COL_MAP: Record<string, string> = {
  개인:         "개인",
  외국인:       "외국인",
  기관계:       "기관계",
  기관:         "_기관",
  금융투자:     "금융투자",
  보험:         "보험",
  "투신(사모)": "투신",
  "투신 (사모)": "투신",
  투신:         "투신",
  은행:         "은행",
  기타금융기관: "기타금융",
  기타금융:     "기타금융",
  연기금등:     "연기금등",
  기타법인:     "기타법인",
};

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: NAVER_HEADERS,
    signal:  AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
  const buf = await res.arrayBuffer();

  // Content-Type 헤더에서 인코딩 감지, 기본값은 EUC-KR (Naver Finance 역사적 인코딩)
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("utf-8") || ct.includes("utf8")) {
    return new TextDecoder("utf-8").decode(buf);
  }

  // EUC-KR 시도 후 UTF-8 fallback (TextDecoder는 예외 없이 대체문자 사용)
  const eucDecoded = new TextDecoder("euc-kr").decode(buf);
  // meta charset=utf-8 이 보이면 다시 UTF-8로 디코딩
  if (/charset[\s=]*utf-?8/i.test(eucDecoded.slice(0, 2000))) {
    return new TextDecoder("utf-8").decode(buf);
  }
  return eucDecoded;
}

async function fetchInvestorFromNaver(
  bizdate: string,
  sosok: string,
): Promise<InvestorRow[]> {
  const url =
    `https://finance.naver.com/sise/investorDealTrendTime.naver` +
    `?bizdate=${bizdate}&sosok=${sosok}`;

  const html = await fetchHtml(url);
  const $    = cheerio.load(html);

  // "시간" + "개인" + "외국인" 헤더를 포함한 테이블 탐색
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let $table: any = null;
  $("table").each((_, el) => {
    const thTexts = $(el)
      .find("th")
      .map((_2, th) => $(th).text().trim())
      .get();
    if (thTexts.includes("시간") && thTexts.includes("개인") && thTexts.includes("외국인")) {
      $table = $(el);
      return false;
    }
  });

  if (!$table) {
    const preview = html.slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`Naver 테이블 없음 (preview: ${preview})`);
  }

  // colspan/rowspan 인식 가상 컬럼 인덱스 → 투자자명 매핑
  const MAX_COLS = 15;
  const occupied: boolean[][] = Array.from({ length: 4 }, () => new Array(MAX_COLS).fill(false));
  const colNames: (string | null)[] = new Array(MAX_COLS).fill(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $table.find("tr").each((rowIdx: number, tr: any) => {
    if (rowIdx >= 4) return false;
    const $ths = $(tr).find("th");
    if (!$ths.length) return;

    let col = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $ths.each((_: number, th: any) => {
      while (col < MAX_COLS && occupied[rowIdx][col]) col++;
      if (col >= MAX_COLS) return false;

      const $th     = $(th);
      const text    = $th.text().trim().replace(/\s+/g, " ");
      const colspan = Math.max(1, parseInt($th.attr("colspan") || "1", 10));
      const rowspan = Math.max(1, parseInt($th.attr("rowspan") || "1", 10));
      const mapped  = NAVER_COL_MAP[text] ?? null;

      for (let c = col; c < Math.min(col + colspan, MAX_COLS); c++) {
        for (let r = rowIdx + 1; r < Math.min(rowIdx + rowspan, 4); r++) {
          occupied[r][c] = true;
        }
        if (mapped && !mapped.startsWith("_") && (!colNames[c] || rowIdx > 0)) {
          colNames[c] = mapped;
        }
      }
      col += colspan;
    });
  });

  // 가장 최신 시간대 데이터 행 (HH:mm 형식)
  let dataRow: string[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $table.find("tr").each((_: number, tr: any) => {
    if (dataRow) return false;
    const $tds = $(tr).find("td");
    if (!$tds.length) return;
    if (/^\d{2}:\d{2}/.test($tds.first().text().trim())) {
      dataRow = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $tds.each((_2: number, td: any) => {
        dataRow!.push($(td).text().trim().replace(/,/g, ""));
      });
    }
  });

  if (!dataRow) {
    throw new Error(`Naver 데이터 행 없음 (sosok=${sosok} bizdate=${bizdate})`);
  }

  const result: InvestorRow[] = [];
  const seen = new Set<string>();

  for (let c = 1; c < (dataRow as string[]).length && c < MAX_COLS; c++) {
    const name = colNames[c];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const val = parseFloat((dataRow as string[])[c]) || 0;
    const net = Math.round(val * MILLION);
    result.push({ name, buy: Math.max(0, net), sell: Math.max(0, -net), net });
  }

  result.sort((a, b) => (ORDER_MAP[a.name] ?? 99) - (ORDER_MAP[b.name] ?? 99));
  return result;
}

// ─── 통합 투자자 조회 (KRX 우선, Naver 폴백) ──────────────────────────────────

async function fetchInvestorSync(
  bizdate: string,
  sosok: string, // "01"=KOSPI, "02"=KOSDAQ
): Promise<InvestorRow[]> {
  const market = sosok === "01" ? "KOSPI" : "KOSDAQ";

  // 1차: KRX 공식 JSON API
  try {
    const rows = await fetchInvestorFromKrx(bizdate, market);
    console.log(`[KRX] ${market} KRX API 성공 (${rows.length}건)`);
    return rows;
  } catch (e) {
    console.warn(`[KRX] ${market} KRX API 실패 → Naver fallback:`, e instanceof Error ? e.message : e);
  }

  // 2차: Naver Finance HTML 스크래핑
  try {
    const rows = await fetchInvestorFromNaver(bizdate, sosok);
    console.log(`[KRX] ${market} Naver scraping 성공 (${rows.length}건)`);
    return rows;
  } catch (e) {
    console.error(`[KRX] ${market} Naver scraping도 실패:`, e instanceof Error ? e.message : e);
    return [];
  }
}

// ─── 섹터 ETF (Naver 폴링 API) ────────────────────────────────────────────────

async function fetchEtfPrice(code: string): Promise<{
  price: number; change: number; change_pct: number;
}> {
  const url =
    `https://polling.finance.naver.com/api/realtime` +
    `?category=stock&includeAllInfo=Y&query=SERVICE_ITEM:${code}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer:      "https://finance.naver.com/",
    },
    signal: AbortSignal.timeout(6000),
  });
  const buf = await res.arrayBuffer();
  let text: string;
  try { text = new TextDecoder("euc-kr").decode(buf); }
  catch { text = new TextDecoder("utf-8").decode(buf); }

  const json = JSON.parse(text);
  const d    = json?.result?.areas?.[0]?.datas?.[0];
  if (!d) throw new Error(`no data for ETF ${code}`);
  return { price: Number(d.nv), change: Number(d.cv), change_pct: Number(d.cr) };
}

// ─── KrxService ───────────────────────────────────────────────────────────────

export class KrxService {
  static getLastTradingDay = getLastTradingDay;

  static async getInvestorTrends() {
    const bizdate = getLastTradingDay();
    const key     = `investor_${bizdate}`;
    const cached  = cache.get(key);
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
    const key     = `sector_${bizdate}`;
    const cached  = cache.get(key);
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
    const sec = sector.status   === "fulfilled" ? (sector.value   as any) : { date: "", kospi: [], kosdaq: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sht = short.status    === "fulfilled" ? (short.value    as any) : { date: "", by_market: [], top_kospi: [], top_kosdaq: [] };

    const moneyFlow = {
      flows: [
        { investor: "외국인",   key: "외국인" },
        { investor: "기관",     key: "기관계" },
        { investor: "개인",     key: "개인" },
        { investor: "기타법인", key: "기타법인" },
      ].map(({ investor, key }) => ({
        investor,
        kospi_net:
          inv.kospi.find((x: InvestorRow) => x.name === key)?.net  ?? 0,
        kosdaq_net:
          inv.kosdaq.find((x: InvestorRow) => x.name === key)?.net ?? 0,
        total_net:
          (inv.kospi.find((x: InvestorRow)  => x.name === key)?.net ?? 0) +
          (inv.kosdaq.find((x: InvestorRow) => x.name === key)?.net ?? 0),
      })),
    };

    return {
      date:         inv.date,
      money_flow:   moneyFlow,
      investor:     inv,
      sector_index: sec,
      short_selling: sht,
    };
  }

  static async getRaw(_bld: string, extra: Record<string, string>) {
    const bizdate = extra.trdDd || getLastTradingDay();
    const rows    = await fetchInvestorSync(bizdate, "01");
    return { date: bizdate, source: "krx+naver", rows };
  }
}
