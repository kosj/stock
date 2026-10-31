/** Durable, bounded paper-trading worker. Repeated calls drain today's queue. */
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/server/supabase";
import { TradingEngineService } from "@/lib/server/trading-engine-service";
import { getBrokerForUser } from "@/lib/server/broker-factory";
import { KrMarketClock } from "@/lib/server/adapters/kr-market-clock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function scanRisk(request: NextRequest, started: number) {
  const after = request.nextUrl.searchParams.get("after");
  if (after && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(after))
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  // Read-only service-role RPC rechecks approval and mock mode on EACH page.
  const users = await supabase.rpc("list_mock_risk_accounts", { p_after: after, p_limit: 3 });
  if (users.error || !Array.isArray(users.data))
    return NextResponse.json({ error: "Risk account enumeration failed" }, { status: 503 });
  let processed = 0, failed = 0;
  let cursor = after;
  const clock = new KrMarketClock();
  for (const user of users.data as { user_id: string }[]) {
    if (Date.now() - started >= 20_000 || !clock.isMarketOpen()) break;
    try {
      const broker = await getBrokerForUser(user.user_id);
      const result = await new TradingEngineService(broker).executeTrading(user.user_id, { riskOnly: true });
      if (result.error || result.risk_checks_complete !== true || result.details.some(detail => detail.error)) failed++;
    } catch { failed++; }
    processed++;
    cursor = user.user_id;
  }
  const more = processed < users.data.length || users.data.length === 3;
  return NextResponse.json({ success: failed === 0, mode: "risk", processed, failed,
    next_cursor: more ? cursor : null }, { status: failed ? 503 : more ? 202 : 200 });
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clock = new KrMarketClock();
  if (!clock.isMarketOpen()) return NextResponse.json({ error: "정규장 외 작업은 실행하지 않습니다." }, { status: 409 });
  if (request.nextUrl.searchParams.get("mode") === "risk") return scanRisk(request, Date.now());
  const runDate = new Date(clock.now().getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const results: { user_id: string; success: boolean }[] = [];
  const started = Date.now();
  try {
    const enqueued = await supabase.rpc("enqueue_auto_trade_jobs", { p_date: runDate });
    if (enqueued.error) throw new Error(enqueued.error.message);
    async function worker() {
      while (Date.now() - started < 20_000 && clock.isMarketOpen()) {
        const owner = randomUUID();
        const claimed = await supabase.rpc("claim_auto_trade_job", { p_date: runDate, p_owner: owner });
        if (claimed.error) throw new Error(claimed.error.message);
        const job = claimed.data?.[0] as { user_id: string } | undefined;
        if (!job) return;
        let result: object;
        let success = false;
        try {
          const broker = await getBrokerForUser(job.user_id);
          const receipt = await new TradingEngineService(broker).executeTrading(job.user_id);
          success = !receipt.error && !receipt.details.some(detail => detail.error);
          result = receipt;
        } catch (error) { result = { error: error instanceof Error ? error.message : "Execution failed" }; }
        const finished = await supabase.rpc("finish_auto_trade_job", {
          p_date: runDate, p_user: job.user_id, p_owner: owner, p_result: result, p_success: success,
        });
        if (finished.error || finished.data !== true) throw new Error("Job receipt could not be persisted");
        results.push({ user_id: job.user_id, success });
      }
    }
    const workers = await Promise.allSettled(Array.from({ length: 3 }, worker));
    const failure = workers.find(r => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const count = async (statuses: string[]) => {
      const query = await supabase.from("auto_trade_jobs").select("user_id", { count: "exact", head: true })
        .eq("run_date", runDate).in("status", statuses);
      if (query.error) throw new Error(query.error.message);
      return query.count ?? 0;
    };
    const [pending, failed] = await Promise.all([count(["pending", "running"]), count(["failed"])]);
    return NextResponse.json({ success: !pending && !failed, pending, failed, users: results.length, results },
      { status: pending ? 202 : failed ? 503 : 200 });
  } catch (error) {
    console.error("[auto-trade queue]", error);
    return NextResponse.json({ error: "자동매매 작업 저장/처리 실패", retryable: true }, { status: 503 });
  }
}
