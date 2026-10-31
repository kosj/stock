import { NextRequest } from "next/server";
import { POST as execute } from "../auto-trade/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Dedicated path fails closed (404) on older deployments. Never send risk
 * requests to a legacy endpoint that could ignore the mode and rebalance. */
export async function POST(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.searchParams.set("mode", "risk");
  return execute(new NextRequest(url, { method: "POST", headers: request.headers }));
}
