/**
 * OpenDART API 서비스
 * https://opendart.fss.or.kr/
 *
 * 흐름:
 *   1. list.json (공시목록) → stock_code로 corp_code 조회   [7일 캐시]
 *   2. company.json          → corp_code로 기업 기본 정보 조회 [24시간 캐시]
 *
 * 환경변수:
 *   DART_API_KEY  (Vercel Environment Variables에 등록 필요)
 *   → https://opendart.fss.or.kr/ 무료 가입 후 API Key 발급
 */

const DART_BASE = "https://opendart.fss.or.kr/api";
const KR_CODE   = /^\d{6}$/;

// ── 인메모리 캐시 ─────────────────────────────────────────────────────────────
const _corpCache:    Map<string, { code: string; ts: number }> = new Map();
const _companyCache: Map<string, { info: DartCompanyInfo; ts: number }> = new Map();

const CORP_CODE_TTL  = 7  * 86_400_000; // 7일 (corp_code는 거의 안 바뀜)
const COMPANY_TTL    = 24 * 3_600_000;  // 24시간

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface DartCompanyInfo {
  corp_code:   string;
  corp_name:   string;         // 법인명
  ceo_nm:      string;         // 대표이사명 (쉼표 구분 가능)
  corp_cls:    "Y" | "K" | "N" | "E" | string; // Y=KOSPI, K=코스닥
  adres:       string;         // 주소
  hm_url:      string | null;  // 홈페이지
  phn_no:      string | null;  // 전화번호
  fax_no:      string | null;  // 팩스
  est_dt:      string | null;  // 설립일 YYYYMMDD
  acc_mt:      string | null;  // 결산월 MM
  induty_code: string | null;  // 업종코드
}

// ── corp_code 조회 ─────────────────────────────────────────────────────────────

async function getCorpCode(stockCode: string): Promise<string | null> {
  const cached = _corpCache.get(stockCode);
  if (cached && Date.now() - cached.ts < CORP_CODE_TTL) return cached.code;

  const apiKey = process.env.DART_API_KEY;
  if (!apiKey || !KR_CODE.test(stockCode)) return null;

  // DART list.json — 공시 1건만 조회해 corp_code 추출
  const end   = new Date();
  const start = new Date(end.getTime() - 2 * 365 * 86_400_000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

  try {
    const url =
      `${DART_BASE}/list.json?crtfc_key=${apiKey}` +
      `&stock_code=${stockCode}&bgn_de=${fmt(start)}&end_de=${fmt(end)}&page_count=1`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== "000" || !data.list?.length) return null;

    const code: string = data.list[0].corp_code;
    _corpCache.set(stockCode, { code, ts: Date.now() });
    return code;
  } catch {
    return null;
  }
}

// ── 기업 기본 정보 조회 ───────────────────────────────────────────────────────

export async function getDartCompanyInfo(
  stockCode: string,
): Promise<DartCompanyInfo | null> {
  if (!KR_CODE.test(stockCode)) return null;
  if (!process.env.DART_API_KEY) return null;

  // 캐시 확인
  const cached = _companyCache.get(stockCode);
  if (cached && Date.now() - cached.ts < COMPANY_TTL) return cached.info;

  // corp_code 취득
  const corpCode = await getCorpCode(stockCode);
  if (!corpCode) return null;

  try {
    const url  = `${DART_BASE}/company.json?crtfc_key=${process.env.DART_API_KEY}&corp_code=${corpCode}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const d = await res.json();
    if (d.status !== "000") return null;

    const info: DartCompanyInfo = {
      corp_code:   corpCode,
      corp_name:   d.corp_name   ?? "",
      ceo_nm:      d.ceo_nm      ?? "",
      corp_cls:    d.corp_cls    ?? "",
      adres:       d.adres       ?? "",
      hm_url:      d.hm_url      || null,
      phn_no:      d.phn_no      || null,
      fax_no:      d.fax_no      || null,
      est_dt:      d.est_dt      || null,
      acc_mt:      d.acc_mt      || null,
      induty_code: d.induty_code || null,
    };

    _companyCache.set(stockCode, { info, ts: Date.now() });
    return info;
  } catch {
    return null;
  }
}

// ── 유틸: 설립일 포매팅 ───────────────────────────────────────────────────────

export function formatEstDate(yyyymmdd: string | null): string | null {
  if (!yyyymmdd || yyyymmdd.length < 8) return null;
  return `${yyyymmdd.slice(0, 4)}. ${yyyymmdd.slice(4, 6)}. ${yyyymmdd.slice(6, 8)}.`;
}

export function formatCorpCls(cls: string | null): string {
  if (!cls) return "";
  return (
    cls === "Y" ? "KOSPI (유가증권)" :
    cls === "K" ? "KOSDAQ (코스닥)" :
    cls === "N" ? "KONEX (코넥스)"  :
    cls === "E" ? "기타"             : cls
  );
}
