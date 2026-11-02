import type { Recommendation } from "./domain/recommendation";

export interface RecommendationReadiness {
  state: "ready" | "waiting" | "invalid";
  reason: string | null;
}

/** Only complete, structurally valid batches can wait on age. Missing publication
 * is normal; partial/corrupt/future batches remain operational errors. */
export function assessRecommendations(rows: Recommendation[], now: Date): RecommendationReadiness {
  if (!rows.length) return { state: "waiting", reason: "완전한 Top20 추천 없음" };
  const invalid = (reason: string): RecommendationReadiness => ({ state: "invalid", reason });
  if (rows.length !== 20) return invalid("완전한 Top20 추천 없음");
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const runDate = rows[0].runDate;
  if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return invalid("추천 기준일 없음");
  const parsed = Date.parse(runDate);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== runDate)
    return invalid("추천 기준일 없음");
  const tickers = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.runDate !== runDate || r.rank !== i + 1 || !r.ticker || tickers.has(r.ticker)
        || !Number.isFinite(r.currentPrice) || r.currentPrice <= 0) return invalid("추천 순위·종목·가격 검증 실패");
    tickers.add(r.ticker);
  }
  const age = (Date.parse(today) - parsed) / 86400_000;
  if (age < 0) return invalid("추천 기준일이 미래임");
  if (age === 0 || age > 7) return { state: "waiting", reason: "추천 기준일이 미도래 또는 만료됨" };
  return { state: "ready", reason: null };
}

/** Friday-close signals are eligible next session, for at most 7 calendar days. */
export function validateRecommendations(rows: Recommendation[], now: Date): string | null {
  return assessRecommendations(rows, now).reason;
}
