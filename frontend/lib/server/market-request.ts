import { NextResponse } from "next/server";
import { requireApprovedUser } from "./require-user";
import { parseTicker } from "./api-security-policy";

export async function marketTickerRequest(value: unknown) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  try { return { ok: true as const, ticker: parseTicker(value) }; }
  catch { return { ok: false as const, response: NextResponse.json({ error: "유효하지 않은 티커입니다." }, { status: 400 }) }; }
}
