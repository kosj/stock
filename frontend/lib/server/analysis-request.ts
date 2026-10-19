import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "./require-user";
import { ApiInputError, parseTicker, parseTickerBatch, readBoundedJson } from "./api-security-policy";

/** Durable shared quota, not a per-instance Map that resets on every cold start. */
async function quota(userId: string, cost: number): Promise<NextResponse | null> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("consume_api_quota", {
      p_user_id: userId, p_scope: "analysis", p_cost: cost,
    });
    if (error || typeof data !== "boolean") throw new Error("quota unavailable");
    if (!data) return NextResponse.json({ error: "분석 요청 한도를 초과했습니다." }, { status: 429, headers: { "Retry-After": "60" } });
    return null;
  } catch {
    return NextResponse.json({ error: "분석 요청 제한 서비스를 사용할 수 없습니다." }, { status: 503 });
  }
}

export async function analysisBatchRequest(request: Request, max = 20) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  try {
    const batch = parseTickerBatch(await readBoundedJson(request), max);
    const denied = await quota(auth.userId, batch.tickers.length);
    if (denied) return { ok: false as const, response: denied };
    return { ok: true as const, ...batch };
  } catch (error) {
    return { ok: false as const, response: NextResponse.json({ error: error instanceof ApiInputError ? error.message : "잘못된 요청입니다." }, { status: error instanceof ApiInputError ? error.status : 400 }) };
  }
}

export async function analysisTickerRequest(value: unknown) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  try {
    const ticker = parseTicker(value);
    const denied = await quota(auth.userId, 1);
    if (denied) return { ok: false as const, response: denied };
    return { ok: true as const, ticker };
  } catch {
    return { ok: false as const, response: NextResponse.json({ error: "유효하지 않은 티커입니다." }, { status: 400 }) };
  }
}
