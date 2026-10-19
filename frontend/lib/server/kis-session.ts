import { createHash } from "node:crypto";

export interface KisSessionCredentials {
  appKey: string;
  appSecret: string;
  accountNumber?: string;
  isDemo?: boolean;
  cacheScope?: string;
}

export function kisBaseUrl(isDemo = false): string {
  return isDemo ? "https://openapivts.koreainvestment.com:29443" : "https://openapi.koreainvestment.com:9443";
}

/** No secret fragments are used as identifiers. User, account, rotated secret
 * and environment are isolated. This is a warm-instance cache, not durable state. */
export class KisTokenCache {
  private entries = new Map<string, { token: string; expiresAt: number }>();
  private pending = new Map<string, Promise<string>>();
  private maxEntries: number;
  private now: () => number;
  constructor(maxEntries = 256, now: () => number = Date.now) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError("invalid KIS cache bound");
    this.maxEntries = maxEntries; this.now = now;
  }

  async get(credentials: KisSessionCredentials, issue: () => Promise<{ token: string; expiresIn: number }>): Promise<string> {
    const key = createHash("sha256").update(JSON.stringify([
      credentials.cacheScope ?? "credential-scope", kisBaseUrl(credentials.isDemo),
      credentials.appKey, credentials.appSecret, credentials.accountNumber ?? "",
    ])).digest("hex");
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now() + 300_000) {
      this.entries.delete(key); this.entries.set(key, cached);
      return cached.token;
    }
    this.entries.delete(key);
    const running = this.pending.get(key);
    if (running) return running;
    // Bound concurrent distinct credentials too; never evict an in-flight request
    // and allow another request to issue a duplicate token for the same key.
    if (this.pending.size >= this.maxEntries) throw new Error("KIS 인증 요청이 많습니다. 잠시 후 다시 시도해주세요.");
    const promise = Promise.resolve().then(issue).then(({ token, expiresIn }) => {
      if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error("KIS 토큰 응답이 유효하지 않습니다.");
      for (const [k, value] of this.entries) if (value.expiresAt <= this.now()) this.entries.delete(k);
      while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
      this.entries.set(key, { token, expiresAt: this.now() + Math.min(expiresIn, 86400) * 1000 });
      return token;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, promise);
    return promise;
  }
}

export const kisTokenCache = new KisTokenCache();

/** Official KIS sample continues F/M responses with tr_cont=N and both cursors.
 * Reject absent/repeated cursors instead of returning a silently truncated account.
 * https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_balance/inquire_balance.py */
export async function collectKisBalance<T>(fetchPage: (cursor: { fk: string; nk: string; continuation: string }) => Promise<{
  items: T[]; continuation: string; fk: string; nk: string;
}>, maxPages = 20): Promise<T[]> {
  let cursor = { fk: "", nk: "", continuation: "" };
  const seen = new Set<string>();
  const items: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!["F", "M"].includes(result.continuation.trim())) return items;
    const key = JSON.stringify([result.fk, result.nk]);
    if ((!result.fk.trim() && !result.nk.trim()) || seen.has(key)) throw new Error("KIS 잔고 연속조회 커서 오류. 부분 잔고는 표시하지 않습니다.");
    seen.add(key);
    cursor = { fk: result.fk, nk: result.nk, continuation: "N" };
  }
  throw new Error("KIS 잔고 조회 페이지 한도를 초과했습니다. 부분 잔고는 표시하지 않습니다.");
}
