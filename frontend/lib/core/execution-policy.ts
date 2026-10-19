import type { OrderSide } from "./domain/order";

/** Simulation assumptions, not current statutory rates. Override in server configuration.
 * Default tax=0 deliberately: asset type/date must be verified before supplying a rate.
 * Fees and adverse slippage apply to ALL simulation entry points, including replay.
 */
export interface ExecutionCosts { feeRate: number; sellTaxRate: number; slippageRate: number }
export const DEFAULT_COSTS: ExecutionCosts = { feeRate: 0.00015, sellTaxRate: 0, slippageRate: 0.001 };
export function hasFreshTradeTime(tradedAt: string | undefined, now = Date.now()): boolean {
  const age = tradedAt ? now - Date.parse(tradedAt) : NaN;
  return Number.isFinite(age) && age >= -60_000 && age <= 10 * 60_000;
}
export function effectivePrice(price: number, side: OrderSide, costs = DEFAULT_COSTS): number {
  if (!Number.isFinite(price) || price <= 0) throw new Error("유효하지 않은 기준가");
  for (const value of Object.values(costs)) {
    if (!Number.isFinite(value) || value < 0 || value >= 0.5) throw new Error("유효하지 않은 거래 비용");
  }
  const multiplier = side === "BUY"
    ? (1 + costs.slippageRate) * (1 + costs.feeRate)
    : (1 - costs.slippageRate) * (1 - costs.feeRate - costs.sellTaxRate);
  return Math.round(price * multiplier * 100) / 100;
}
