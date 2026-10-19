import { randomUUID } from "node:crypto";
import { supabase } from "../supabase";
import type { TradingResult } from "../../core/trading-engine";

/** DB lease outlives the 60s HTTP handler; a crashed invocation expires after 120s.
 * Never fall back to process-local locks on serverless instances.
 */
export class SupabaseExecutionControl {
  private readonly owner = randomUUID();
  async acquire(userId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc("acquire_auto_trade_lease", { p_user_id: userId, p_owner: this.owner });
    if (error) throw new Error(`자동매매 잠금 실패(마이그레이션 확인): ${error.message}`);
    return data === true;
  }
  async release(userId: string): Promise<void> {
    const { error } = await supabase.rpc("release_auto_trade_lease", { p_user_id: userId, p_owner: this.owner });
    if (error) throw new Error(error.message);
  }
  async record(userId: string, result: TradingResult): Promise<void> {
    const { details, ...summary } = result;
    const { error } = await supabase.from("mock_auto_trade_logs").insert({
      user_id: userId, ...summary, details: details.slice(0, 50),
    });
    if (error) throw new Error(`매매 로그 저장 실패: ${error.message}`);
  }
}
