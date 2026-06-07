import { z } from "zod";
import { supabase } from "@/lib/server/supabase";

// ── 타입 정의 ─────────────────────────────────────────────────────────────────

/** 일별 투자자별 순매수 데이터 */
export interface InvestorDayData {
  /** YYYY-MM-DD 형식 날짜 */
  date: string;
  /** 외국인 순매수 금액 (억원, 음수=순매도) */
  foreign_net: number;
  /** 기관 순매수 금액 (억원, 음수=순매도) */
  institution_net: number;
}

export interface InvestorTrendResult {
  ticker: string;
  /** 최근 5영업일 투자자별 순매수 */
  days: InvestorDayData[];
}

// ── Zod 스키마 ────────────────────────────────────────────────────────────────

// Naver Finance 모바일 API 응답이 버전마다 필드명이 다를 수 있어
// passthrough() + 개별 필드 다중 선택 방식으로 유연하게 파싱한다.
const NaverItemSchema = z
  .object({
    tradeDate:               z.string().optional(),
    date:                    z.string().optional(),
    // 외국인 매수 (여러 필드명 시도)
    foreignPurchaseAmount:   z.number().optional(),
    foreignBuyAmount:        z.number().optional(),
    foreignBuy:              z.number().optional(),
    // 외국인 매도
    foreignSaleAmount:       z.number().optional(),
    foreignSellAmount:       z.number().optional(),
    foreignSell:             z.number().optional(),
    // 기관 매수
    institutionPurchaseAmount: z.number().optional(),
    institutionBuyAmount:    z.number().optional(),
    institutionBuy:          z.number().optional(),
    orgBuy:                  z.number().optional(),
    // 기관 매도
    institutionSaleAmount:   z.number().optional(),
    institutionSellAmount:   z.number().optional(),
    institutionSell:         z.number().optional(),
    orgSell:                 z.number().optional(),
    // 직접 순매수 값이 있는 경우
    foreignNetBuyAmount:     z.number().optional(),
    institutionNetBuyAmount: z.number().optional(),
    foreignNetBuy:           z.number().optional(),
    institutionNetBuy:       z.number().optional(),
  })
  .passthrough();

type NaverItem = z.infer<typeof NaverItemSchema>;

// ── 유틸리티 ──────────────────────────────────────────────────────────────────

const KR_CODE = /^\d{6}$/;
const KR_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

/**
 * KRW → 억원 변환
 * Naver Finance API는 원 단위로 반환하므로 1억(1e8)으로 나눈다.
 */
function toEokWon(krw: number): number {
  return Math.round((krw / 1e8) * 10) / 10; // 소수점 1자리
}

/**
 * NaverItem에서 외국인 순매수(억원)를 추출한다.
 * 순매수 직접 필드 → 매수-매도 계산 순으로 시도한다.
 */
function extractForeignNet(item: NaverItem): number {
  if (item.foreignNetBuyAmount != null) return toEokWon(item.foreignNetBuyAmount);
  if (item.foreignNetBuy != null)       return toEokWon(item.foreignNetBuy);
  const buy  = item.foreignPurchaseAmount ?? item.foreignBuyAmount ?? item.foreignBuy ?? 0;
  const sell = item.foreignSaleAmount     ?? item.foreignSellAmount ?? item.foreignSell ?? 0;
  return toEokWon(buy - sell);
}

/**
 * NaverItem에서 기관 순매수(억원)를 추출한다.
 */
function extractInstitutionNet(item: NaverItem): number {
  if (item.institutionNetBuyAmount != null) return toEokWon(item.institutionNetBuyAmount);
  if (item.institutionNetBuy != null)       return toEokWon(item.institutionNetBuy);
  const buy  = item.institutionPurchaseAmount ?? item.institutionBuyAmount
             ?? item.institutionBuy ?? item.orgBuy ?? 0;
  const sell = item.institutionSaleAmount     ?? item.institutionSellAmount
             ?? item.institutionSell ?? item.orgSell ?? 0;
  return toEokWon(buy - sell);
}

/**
 * NaverItem 날짜 필드를 YYYY-MM-DD 형식으로 정규화한다.
 * Naver는 "20250106" 또는 "2025-01-06" 형식을 혼용한다.
 */
function normalizeDate(raw: string | undefined): string {
  if (!raw) return "";
  const s = raw.replace(/-/g, "");
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return raw;
}

// ── L1 메모리 캐시 (1시간 TTL) ───────────────────────────────────────────────

const _l1 = new Map<string, { data: InvestorTrendResult; exp: number }>();
const TTL_MS = 3_600_000; // 1시간

// ── InvestorTrendService ──────────────────────────────────────────────────────

/**
 * 외국인/기관 투자자 순매수 트렌드 서비스
 *
 * 데이터 소스: Naver Finance 모바일 API (국내 6자리 종목코드 전용)
 * 캐시: L1 메모리(1h) + L2 Supabase quote_cache(1h)
 *
 * @remarks
 * 실전 활용 주의사항:
 * - 외국인 순매수 연속 3일 이상 + 거래량 증가 조합이 가장 신뢰도 높은 수급 신호다.
 * - 기관은 단기 매매가 잦으므로 단일일 순매수보다 5일 누적 방향성을 봐야 한다.
 * - 프로그램 매매 비중이 높은 날(선물만기일 등)은 수급 신호가 왜곡될 수 있다.
 */
export class InvestorTrendService {
  /** Naver Finance 모바일 API에서 투자자별 매매 데이터를 가져온다 */
  private static async fetchFromNaver(code: string): Promise<InvestorDayData[]> {
    const urls = [
      `https://m.stock.naver.com/api/stock/${code}/investor`,
      `https://m.stock.naver.com/api/stock/${code}/investorTrend`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": KR_UA,
            "Referer":    "https://m.stock.naver.com/",
            "Accept":     "application/json",
          },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) continue;

        const raw: unknown = await res.json();

        // 응답이 배열이거나 tradeList / items 배열을 갖는 객체일 수 있다
        let items: unknown[] = [];
        if (Array.isArray(raw)) {
          items = raw;
        } else if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          items = Array.isArray(obj.tradeList) ? obj.tradeList
                : Array.isArray(obj.items)     ? obj.items
                : Array.isArray(obj.data)      ? obj.data
                : [];
        }

        if (items.length === 0) continue;

        const parsed = items
          .map((item) => NaverItemSchema.safeParse(item))
          .filter((r) => r.success)
          .map((r) => r.data as NaverItem);

        if (parsed.length === 0) continue;

        const days: InvestorDayData[] = parsed
          .slice(0, 5) // 최근 5영업일만
          .map((item) => ({
            date:             normalizeDate(item.tradeDate ?? item.date),
            foreign_net:      extractForeignNet(item),
            institution_net:  extractInstitutionNet(item),
          }))
          .filter((d) => d.date !== "")
          .reverse(); // 오래된 날짜 → 최신 순으로 정렬 (차트 왼쪽→오른쪽)

        return days;
      } catch {
        // 다음 URL 시도
      }
    }
    return [];
  }

  /** L2 Supabase 캐시 조회 */
  private static async l2Get(key: string): Promise<InvestorTrendResult | null> {
    try {
      const { data } = await supabase
        .from("quote_cache")
        .select("data, expires_at")
        .eq("key", key)
        .single();
      if (!data) return null;
      if (new Date(data.expires_at) <= new Date()) return null;
      return data.data as InvestorTrendResult;
    } catch {
      return null;
    }
  }

  /** L2 Supabase 캐시 저장 */
  private static async l2Set(key: string, value: InvestorTrendResult): Promise<void> {
    try {
      const expires_at = new Date(Date.now() + TTL_MS).toISOString();
      await supabase.from("quote_cache").upsert({ key, data: value, expires_at });
    } catch { /* 캐시 쓰기 실패 무시 */ }
  }

  /**
   * 종목의 최근 5영업일 투자자별 순매수 데이터를 반환한다.
   * 국내 6자리 코드만 지원하며, 해외 종목은 null 반환.
   */
  static async getTrend(ticker: string): Promise<InvestorTrendResult | null> {
    if (!KR_CODE.test(ticker)) return null;

    const key = `investor-trend:${ticker}`;

    // L1 캐시 확인
    const l1 = _l1.get(key);
    if (l1 && Date.now() < l1.exp) return l1.data;

    // L2 캐시 확인
    const l2 = await InvestorTrendService.l2Get(key);
    if (l2) {
      _l1.set(key, { data: l2, exp: Date.now() + TTL_MS });
      return l2;
    }

    // 실데이터 조회
    const days = await InvestorTrendService.fetchFromNaver(ticker);
    const result: InvestorTrendResult = { ticker, days };

    // 캐시 저장
    _l1.set(key, { data: result, exp: Date.now() + TTL_MS });
    void InvestorTrendService.l2Set(key, result);

    return result;
  }
}
