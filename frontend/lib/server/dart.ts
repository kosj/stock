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
 */

const DART_BASE = "https://opendart.fss.or.kr/api";
const KR_CODE   = /^\d{6}$/;

// ── 인메모리 캐시 ─────────────────────────────────────────────────────────────
const _corpCache:    Map<string, { code: string; ts: number }> = new Map();
const _companyCache: Map<string, { info: DartCompanyInfo; ts: number }> = new Map();

const CORP_CODE_TTL = 7  * 86_400_000; // 7일
const COMPANY_TTL   = 24 * 3_600_000;  // 24시간

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface DartCompanyInfo {
  corp_code:   string;
  corp_name:   string;
  ceo_nm:      string;
  corp_cls:    "Y" | "K" | "N" | "E" | string;
  adres:       string;
  hm_url:      string | null;
  phn_no:      string | null;
  fax_no:      string | null;
  est_dt:      string | null;
  acc_mt:      string | null;
  induty_code: string | null;
}

export interface DartResult {
  info:  DartCompanyInfo | null;
  error?: string;   // 실패 시 원인 (디버깅용)
}

// ── corp_code 조회 ─────────────────────────────────────────────────────────────

async function getCorpCode(stockCode: string, apiKey: string): Promise<{ code: string | null; error?: string }> {
  const cached = _corpCache.get(stockCode);
  if (cached && Date.now() - cached.ts < CORP_CODE_TTL) return { code: cached.code };

  // DART 제약: corp_code 없이 조회 시 최대 3개월 (status=100 방지)
  const end   = new Date();
  const start = new Date(end.getTime() - 89 * 86_400_000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

  const url =
    `${DART_BASE}/list.json?crtfc_key=${apiKey}` +
    `&stock_code=${stockCode}&bgn_de=${fmt(start)}&end_de=${fmt(end)}&page_count=1`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });

    if (!res.ok) {
      return { code: null, error: `list.json HTTP ${res.status}` };
    }

    const data = await res.json();

    if (data.status !== "000") {
      return {
        code:  null,
        error: `list.json status=${data.status} message="${data.message}" (stock_code=${stockCode}, bgn_de=${fmt(start)})`,
      };
    }
    if (!data.list?.length) {
      return {
        code:  null,
        error: `list.json 결과 없음 (status=000 이지만 list 비어있음, total_count=${data.total_count})`,
      };
    }

    const code: string = data.list[0].corp_code;
    _corpCache.set(stockCode, { code, ts: Date.now() });
    return { code };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: null, error: `list.json fetch 오류: ${msg}` };
  }
}

// ── 기업 기본 정보 조회 ───────────────────────────────────────────────────────

export async function getDartCompanyInfo(stockCode: string): Promise<DartResult> {
  if (!KR_CODE.test(stockCode)) {
    return { info: null, error: "국내 6자리 종목코드만 지원" };
  }

  const apiKey = process.env.DART_API_KEY?.trim();
  if (!apiKey) {
    return { info: null, error: "DART_API_KEY 환경변수 미설정" };
  }

  // 캐시 확인
  const cached = _companyCache.get(stockCode);
  if (cached && Date.now() - cached.ts < COMPANY_TTL) return { info: cached.info };

  // corp_code 취득
  const { code: corpCode, error: corpError } = await getCorpCode(stockCode, apiKey);
  if (!corpCode) {
    return { info: null, error: `corp_code 조회 실패: ${corpError}` };
  }

  try {
    const url = `${DART_BASE}/company.json?crtfc_key=${apiKey}&corp_code=${corpCode}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });

    if (!res.ok) {
      return { info: null, error: `company.json HTTP ${res.status}` };
    }

    const d = await res.json();
    if (d.status !== "000") {
      return { info: null, error: `company.json status=${d.status} message="${d.message}"` };
    }

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
    return { info };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { info: null, error: `company.json fetch 오류: ${msg}` };
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
