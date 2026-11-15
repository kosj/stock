import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Bearer check for cron routes. Fails closed when CRON_SECRET is unset and compares
 * fixed-length digests so response timing does not reveal how much of the secret matched.
 */
export function cronAuthFailure(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  const presented = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(presented), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
