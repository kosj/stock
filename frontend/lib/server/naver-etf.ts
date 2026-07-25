/**
 * 네이버 금융 ETF 전체 목록 수집
 * ============================================================================
 * 국내 상장 ETF "전체"(2026-07 기준 1,150종목)를 단일 요청으로 가져온다.
 *
 * 왜 이 소스인가:
 *   - KRX(data.krx.co.kr)·pykrx는 클라우드 IP를 차단해 Vercel/Actions에서 불가.
 *   - 네이버 금융은 이 앱이 이미 프로덕션에서 쓰는 소스이며(getIndexFromNaver,
 *     polling.finance.naver.com), GitHub Actions(해외 IP)에서도 응답을 확인했다.
 *   - 응답에 1일 등락률(changeRate)과 3개월 수익률(threeMonthEarnRate)이 포함돼
 *     종목별 추가 조회 없이 전체 유니버스 랭킹을 만들 수 있다.
 *
 * 주의: 응답 인코딩은 EUC-KR이다. UTF-8로 읽으면 종목명이 깨진다
 *       (기존 getQuoteFromNaverPolling과 동일한 처리).
 */

const NAVER_ETF_LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn";

/** 네이버 ETF 탭 코드 → 분류명 */
const TAB_CATEGORY: Record<number, string> = {
  1: "국내시장지수",
  2: "국내업종테마",
  3: "국내파생",
  4: "해외주식",
  5: "원자재",
  6: "채권",
  7: "기타",
};

interface NaverEtfItem {
  itemcode:           string;  // 6자리 종목코드
  itemname:           string;  // 종목명
  etfTabCode:         number;  // 분류 탭
  nowVal:             number;  // 현재가(원)
  changeRate:         number;  // 1일 등락률(%) — 부호 포함
  changeVal:          number;  // 전일대비(원)
  nav:                number;  // 순자산가치
  threeMonthEarnRate: number;  // 3개월 수익률(%)
  quant:              number;  // 거래량
  amonut:             number;  // 거래대금(백만원, 네이버 필드 철자 그대로)
  marketSum:          number;  // 시가총액(억원)
  risefall:           string;  // 등락구분 (2=상승, 5=하락)
}

export interface NaverEtf {
  ticker:      string;
  name:        string;
  category:    string;
  price:       number;
  /** 1일 등락률(%) */
  return1D:    number | null;
  /** 3개월 수익률(%) */
  return3M:    number | null;
  /** 시가총액(억원) — 유동성/커버리지 정렬 기준 */
  marketCapEok: number;
  /** 거래대금(백만원) */
  tradingValue: number;
  leveraged:   boolean;
  inverse:     boolean;
  /** 파생형(국내파생 탭 또는 롱숏 구조) — 연금·IRP 편입 불가 */
  derivative:  boolean;
  overseas:    boolean;
}

/**
 * 연금·IRP 편입 가부 판정 근거가 되는 위험 플래그.
 *
 * 레버리지·인버스만으로는 부족하다: "KODEX 200롱코스닥150숏선물"처럼 이름에
 * 레버리지/인버스가 없는 파생형 롱숏 ETF도 퇴직연금·IRP에는 담을 수 없다.
 * 네이버가 이미 분류해 둔 국내파생 탭(etfTabCode=3)을 1차 근거로 삼고,
 * 롱숏 구조를 이름으로 보강한다.
 *
 * 주의: 이름의 "선물"만으로 자르지 않는다 — KODEX 골드선물(H) 같은 원자재
 * ETF(탭 5)는 연금계좌 편입이 가능하므로 과잉 차단이 된다.
 */
function classifyName(name: string, tabCode: number) {
  const n = name.replace(/\s/g, "").toUpperCase();
  const leveraged = name.includes("레버리지") || n.includes("2X") || name.includes("2배");
  const inverse   = name.includes("인버스") || name.includes("곱버스");
  const longShort = name.includes("롱") && name.includes("숏");
  return {
    leveraged,
    inverse,
    derivative: tabCode === 3 || longShort || leveraged || inverse,
    overseas:   tabCode === 4 || tabCode === 5,
  };
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 모듈 레벨 캐시 — 서버리스 인스턴스 재사용 시 네이버 호출 억제
let cache: { at: number; data: NaverEtf[] } | null = null;
const TTL_MS = 10 * 60_000;

/**
 * 국내 상장 ETF 전체 목록을 반환한다.
 * 실패 시 빈 배열(호출측에서 Supabase/시드로 폴백).
 */
export async function fetchNaverEtfList(nocache = false): Promise<NaverEtf[]> {
  if (!nocache && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    const res = await fetch(NAVER_ETF_LIST_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; stock-dashboard/1.0)",
        Referer: "https://finance.naver.com/sise/etf.naver",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return cache?.data ?? [];

    // EUC-KR → UTF-8 (UTF-8로 직접 읽으면 종목명이 깨진다)
    const buf = await res.arrayBuffer();
    let json: { result?: { etfItemList?: NaverEtfItem[] } };
    try {
      json = JSON.parse(new TextDecoder("euc-kr").decode(buf));
    } catch {
      json = JSON.parse(new TextDecoder("utf-8").decode(buf));
    }

    const items = json?.result?.etfItemList;
    if (!Array.isArray(items) || items.length === 0) return cache?.data ?? [];

    const data: NaverEtf[] = items
      .filter((it) => it?.itemcode && it?.itemname)
      .map((it) => {
        const tab = toNum(it.etfTabCode);
        const flags = classifyName(it.itemname, tab);
        return {
          ticker:       String(it.itemcode).padStart(6, "0"),
          name:         it.itemname.trim(),
          category:     TAB_CATEGORY[tab] ?? "기타",
          price:        toNum(it.nowVal),
          // changeRate·threeMonthEarnRate는 부호를 포함해 내려온다(보정 불필요).
          return1D:     Number.isFinite(Number(it.changeRate)) ? Number(it.changeRate) : null,
          return3M:     Number.isFinite(Number(it.threeMonthEarnRate))
                          ? Number(it.threeMonthEarnRate) : null,
          marketCapEok: toNum(it.marketSum),
          tradingValue: toNum(it.amonut),
          ...flags,
        };
      });

    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error("[naver-etf] 목록 조회 실패:", err);
    return cache?.data ?? [];
  }
}
