/**
 * ETF 유니버스 & 계좌(퇴직연금·IRP·ISA) 적합성 규칙
 * ============================================================================
 * 데이터 전략:
 *   - 전체 ETF "목록"의 1차 소스는 Supabase `etf_universe` 테이블이다.
 *     이 테이블은 KIS(한국투자증권) Open API로 ETF 마스터를 받아 적재한다.
 *     단, KIS는 클라우드(Vercel) IP를 차단하므로(providers.ts 참고) 적재 작업은
 *     KR/Action 환경에서 수행하고 cloud 앱은 읽기만 한다(krx_cache와 동일 패턴).
 *   - 테이블이 비어 있으면 아래 SEED_ETFS(검증된 대표 ETF)로 graceful degrade.
 *   - 각 ETF의 "수익률"은 목록과 무관하게 Yahoo getChart로 계산한다(cloud 가용).
 *
 * 계좌 적합성(제도 규칙 요약):
 *   - 퇴직연금(DC)/IRP: 레버리지·인버스 등 파생형 위험 ETF 편입 불가.
 *   - ISA: 국내 상장 ETF 전반 편입 가능(레버리지·인버스 포함).
 *   ※ 본 모듈은 종목 "적합성"만 판정한다. 위험자산 70% 한도 같은 포트폴리오
 *     레벨 제약은 계좌 잔고 맥락이 필요하므로 여기서 다루지 않는다.
 *   ※ 정보 제공 목적의 정량 분류이며 개인 투자자문이 아니다.
 */

import { supabase } from "./supabase";
import { fetchNaverEtfList } from "./naver-etf";

/**
 * ETF 분류.
 * 앞의 7개는 시드/Supabase 적재분, 뒤의 4개는 네이버 탭 코드에서 오는 라벨이다
 * (해외주식·원자재·채권·기타는 양쪽이 공유).
 */
export type EtfCategory =
  | "대표지수" | "섹터" | "해외주식" | "채권" | "원자재" | "테마" | "기타"
  | "국내시장지수" | "국내업종테마" | "국내파생";

export interface EtfMeta {
  ticker:     string;
  name:       string;
  category:   EtfCategory;
  /** 레버리지(2X 등) — 연금/IRP 편입 불가 사유 */
  leveraged?: boolean;
  /** 인버스 — 연금/IRP 편입 불가 사유 */
  inverse?:   boolean;
  /** 국내 상장 해외자산 추종(연금/ISA 편입은 가능) */
  overseas?:  boolean;
}

export type AccountType = "pension" | "irp" | "isa";

export const ACCOUNT_LABEL: Record<AccountType, string> = {
  pension: "퇴직연금(DC)",
  irp:     "IRP",
  isa:     "ISA",
};

/**
 * 적합성 판정에 실제로 필요한 최소 형태.
 * (EtfMeta·NaverEtf 등 출처가 다른 타입을 캐스팅 없이 함께 받기 위함)
 */
export interface EtfRiskFlags {
  leveraged?: boolean;
  inverse?:   boolean;
}

/**
 * 계좌 유형별 ETF 편입 가능 여부.
 * 퇴직연금/IRP는 레버리지·인버스(파생형 위험 ETF) 불가, ISA는 전반 허용.
 */
export function isEligible(etf: EtfRiskFlags, account: AccountType): boolean {
  if (account === "isa") return true;            // 국내 상장 ETF 전반 가능
  return !etf.leveraged && !etf.inverse;          // pension/irp: 파생형 위험 ETF 제외
}

/** 편입 불가 사유 텍스트(UI 표기용). 가능하면 null. */
export function ineligibleReason(etf: EtfRiskFlags, account: AccountType): string | null {
  if (isEligible(etf, account)) return null;
  if (etf.leveraged && etf.inverse) return "레버리지·인버스 파생형 — 연금계좌 편입 불가";
  if (etf.leveraged) return "레버리지 ETF — 연금계좌 편입 불가";
  if (etf.inverse)   return "인버스 ETF — 연금계좌 편입 불가";
  return "연금계좌 편입 불가";
}

/**
 * 검증된 대표 ETF 시드 목록(전체 ETF 마스터 미적재 시 폴백).
 * 전체 ~900개 커버리지는 KIS 적재(etf_universe 테이블)로 확보한다.
 */
export const SEED_ETFS: EtfMeta[] = [
  // 대표지수
  { ticker: "069500", name: "KODEX 200",            category: "대표지수" },
  { ticker: "102110", name: "TIGER 200",            category: "대표지수" },
  { ticker: "229200", name: "KODEX 코스닥150",       category: "대표지수" },
  // 레버리지·인버스 (연금/IRP 편입 불가)
  { ticker: "122630", name: "KODEX 레버리지",        category: "대표지수", leveraged: true },
  { ticker: "233740", name: "KODEX 코스닥150레버리지", category: "대표지수", leveraged: true },
  { ticker: "114800", name: "KODEX 인버스",          category: "대표지수", inverse: true },
  { ticker: "252670", name: "KODEX 200선물인버스2X",  category: "대표지수", inverse: true, leveraged: true },
  // 섹터 (sector_etfs와 일치)
  { ticker: "091160", name: "KODEX 반도체",          category: "섹터" },
  { ticker: "305720", name: "KODEX 2차전지산업",      category: "섹터" },
  { ticker: "244580", name: "KODEX 바이오",          category: "섹터" },
  { ticker: "139260", name: "KODEX 인터넷",          category: "섹터" },
  { ticker: "091180", name: "KODEX 자동차",          category: "섹터" },
  { ticker: "139270", name: "KODEX 은행",            category: "섹터" },
  { ticker: "117460", name: "KODEX 에너지화학",       category: "섹터" },
  { ticker: "139220", name: "KODEX 건설",            category: "섹터" },
  { ticker: "139230", name: "KODEX 철강",            category: "섹터" },
  { ticker: "364980", name: "KODEX K-로봇액티브",     category: "테마" },
  // 해외주식(국내 상장)
  { ticker: "360750", name: "TIGER 미국S&P500",      category: "해외주식", overseas: true },
  { ticker: "133690", name: "TIGER 미국나스닥100",    category: "해외주식", overseas: true },
  // 원자재·채권
  { ticker: "132030", name: "KODEX 골드선물(H)",      category: "원자재", overseas: true },
  { ticker: "273130", name: "KODEX 종합채권(AA-이상)액티브", category: "채권" },
];

interface EtfUniverseRow {
  ticker:    string;
  name:      string;
  category:  string | null;
  leveraged: boolean | null;
  inverse:   boolean | null;
  overseas:  boolean | null;
}

/**
 * 전체 ETF 유니버스 반환.
 *
 * 우선순위:
 *   1) 네이버 ETF 목록 API — 국내 상장 ETF "전체"(약 1,150종목). 단일 요청이며
 *      클라우드(Vercel/Actions)에서 접근 가능함을 실측 확인했다.
 *   2) Supabase `etf_universe` — KR 환경에서 적재한 캐시(네이버 장애 시 대비).
 *   3) SEED_ETFS — 위 둘 다 실패했을 때의 최소 동작 보장.
 */
export async function getEtfUniverse(): Promise<EtfMeta[]> {
  const naver = await fetchNaverEtfList();
  if (naver.length > 0) {
    return naver.map((e) => ({
      ticker:    e.ticker,
      name:      e.name,
      category:  e.category as EtfCategory,
      leveraged: e.leveraged,
      inverse:   e.inverse,
      overseas:  e.overseas,
    }));
  }

  try {
    const { data, error } = await supabase
      .from("etf_universe")
      .select("ticker, name, category, leveraged, inverse, overseas");

    if (!error && data && data.length > 0) {
      return (data as EtfUniverseRow[]).map((r) => ({
        ticker:    r.ticker,
        name:      r.name,
        category:  (r.category as EtfCategory) ?? "기타",
        leveraged: r.leveraged ?? false,
        inverse:   r.inverse ?? false,
        overseas:  r.overseas ?? false,
      }));
    }
  } catch {
    /* 테이블 부재/네트워크 오류 → 시드 폴백 */
  }
  return SEED_ETFS;
}
