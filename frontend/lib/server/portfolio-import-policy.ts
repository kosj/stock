import { ApiInputError } from "./api-security-policy";

export interface ImportedPosition {
  ticker: string; name: string; quantity: number; avg_price: number;
  stop_loss?: number | null; take_profit?: number | null;
  strategy?: string | null; notes?: string | null;
}

/** Reject the full import on any invalid row; never drop malformed broker rows. */
export function parsePortfolioImport(body: unknown): ImportedPosition[] {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => key !== "positions")) throw new ApiInputError("positions 객체가 필요합니다.");
  const rows = (body as Record<string, unknown>).positions;
  if (!Array.isArray(rows) || rows.length > 200) throw new ApiInputError("포지션은 최대 200개 배열이어야 합니다.");
  const seen = new Set<string>();
  return rows.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || Object.keys(row).some(key => !["ticker", "name", "quantity", "avg_price", "stop_loss", "take_profit", "strategy", "notes"].includes(key)))
      throw new ApiInputError("허용되지 않은 포지션 필드입니다.");
    const r = row as Record<string, unknown>;
    if (typeof r.ticker !== "string" || typeof r.name !== "string") throw new ApiInputError("종목코드·이름이 필요합니다.");
    const ticker = r.ticker.trim().toUpperCase(), name = r.name.trim();
    if (!/^[A-Z0-9^][A-Z0-9.^-]{0,19}$/.test(ticker) || !name || [...name].length > 100
      || typeof r.quantity !== "number" || !Number.isSafeInteger(r.quantity) || r.quantity < 1 || r.quantity > 2_147_483_647
      || typeof r.avg_price !== "number" || !Number.isFinite(r.avg_price) || r.avg_price <= 0)
      throw new ApiInputError("유효하지 않은 종목·수량·평균단가입니다.");
    if (seen.has(ticker)) throw new ApiInputError("중복 종목코드는 가져올 수 없습니다.");
    seen.add(ticker);
    for (const key of ["stop_loss", "take_profit"]) {
      if (r[key] !== undefined && r[key] !== null && (typeof r[key] !== "number" || !Number.isFinite(r[key]) || r[key] <= 0))
        throw new ApiInputError("목표가·손절가는 양수 또는 null이어야 합니다.");
    }
    for (const key of ["strategy", "notes"]) {
      if (r[key] !== undefined && r[key] !== null
        && (typeof r[key] !== "string" || [...r[key]].length > (key === "strategy" ? 2000 : 10000)))
        throw new ApiInputError("전략·메모의 형식 또는 길이가 잘못되었습니다.");
    }
    return { ...r, ticker, name } as unknown as ImportedPosition;
  });
}
