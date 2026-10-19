import { supabase } from "./supabase";
import { SupabaseExecutionControl } from "./adapters/supabase-execution-control";

export async function accountEpoch(userId: string): Promise<number> {
  const { error: initError } = await supabase.from("mock_accounts").upsert(
    { user_id: userId, cash: 10_000_000, performance_baseline: 10_000_000, baseline_at: new Date().toISOString() },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (initError) throw new Error(initError.message);
  const { data, error } = await supabase.from("mock_accounts").select("account_epoch").eq("user_id", userId).single();
  if (error || !data || !Number.isSafeInteger(data.account_epoch)) throw new Error(error?.message ?? "계좌 세대 조회 실패");
  return data.account_epoch;
}

export async function updateAccount(userId: string, body: { cash?: number; auto_trade_capital?: number | null }, reset = false) {
  const lock = new SupabaseExecutionControl();
  if (!await lock.acquire(userId)) throw new Error("account_busy_or_lease_expired");
  try {
    const epoch = await accountEpoch(userId);
    const { data, error } = await supabase.rpc("update_mock_account", {
      p_user_id: userId, p_owner: lock.owner, p_epoch: epoch,
      p_cash: body.cash ?? null, p_set_cash: "cash" in body,
      p_capital: body.auto_trade_capital ?? null, p_set_capital: "auto_trade_capital" in body,
      p_reset: reset,
    });
    if (error) throw new Error(error.message);
    return data;
  } finally { await lock.release(userId); }
}
