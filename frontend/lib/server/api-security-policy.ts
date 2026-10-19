/** Pure authorization/input policy; never trust user_metadata for privileges. */
export function isApprovedRole(role: unknown): role is "user" | "admin" {
  return role === "user" || role === "admin";
}

export function apiAccessPolicy(pathname: string): "public" | "approved" | "admin" {
  if (["/api/auth/signup", "/api/auth/logout", "/api/auth/heartbeat", "/api/health"].includes(pathname)
    || pathname.startsWith("/api/cron/")) return "public";
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/") ? "admin" : "approved";
}

export class ApiInputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function parseTicker(value: unknown): string {
  if (typeof value !== "string") throw new ApiInputError("ticker must be a string");
  const ticker = value.trim().toUpperCase();
  // Existing dashboard aliases only; never accept arbitrary slash/query syntax.
  if (["USD/KRW", "EUR/USD", "USD/JPY", "USD/CNY", "S&P500"].includes(ticker)) return ticker;
  if (!/^(?:\^?[A-Z][A-Z0-9.-]{0,14}|[0-9]{6}(?:\.(?:KS|KQ))?)$/.test(ticker)) {
    throw new ApiInputError("invalid ticker");
  }
  return ticker;
}

export const ANALYSIS_MAX_TICKERS = 20;
export function parseTickerBatch(body: unknown, max = ANALYSIS_MAX_TICKERS): { tickers: string[]; basket: boolean } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiInputError("JSON object required");
  const { tickers, basket } = body as Record<string, unknown>;
  if (!Array.isArray(tickers) || tickers.length < 1 || tickers.length > max) {
    throw new ApiInputError(`tickers must contain 1–${max} entries`);
  }
  if (basket !== undefined && typeof basket !== "boolean") throw new ApiInputError("basket must be boolean");
  return { tickers: [...new Set(tickers.map(parseTicker))], basket: basket === true };
}

/** Stream limit applies even without Content-Length and with multibyte input. */
export async function readBoundedJson(request: Request, maxBytes = 8192): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ApiInputError("request body too large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiInputError("JSON body required");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiInputError("request body too large", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiInputError("invalid JSON"); }
}

/** Preserve input order and allSettled semantics with at most `concurrency` tasks. */
export async function boundedSettled<T, R>(items: readonly T[], task: (item: T) => Promise<R>, concurrency = 3): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) throw new RangeError("invalid concurrency");
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await task(items[index]) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}
