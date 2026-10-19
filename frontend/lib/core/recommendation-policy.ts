import type { Recommendation } from "./domain/recommendation";

/** Weekly batches remain usable for at most 7 calendar days; same-day analysis is
 * deliberately ineligible (Friday close analysis -> next trading session).
 */
export function validateRecommendations(rows: Recommendation[], now: Date): string | null {
  if (rows.length !== 20) return "완전한 Top20 추천 없음";
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const runDate = rows[0].runDate;
  if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return "추천 기준일 없음";
  const age = (Date.parse(today) - Date.parse(runDate)) / 86400_000;
  if (!Number.isFinite(age) || age <= 0 || age > 7) return "추천 기준일이 미도래 또는 만료됨";
  const tickers = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.runDate !== runDate || r.rank !== i + 1 || !r.ticker || tickers.has(r.ticker)
        || !Number.isFinite(r.currentPrice) || r.currentPrice <= 0) return "추천 순위·종목·가격 검증 실패";
    tickers.add(r.ticker);
  }
  return null;
}
