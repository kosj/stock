import { DEFAULT_COSTS, type ExecutionCosts } from "../core/execution-policy";

/** Rates are explicit simulation assumptions. Supply instrument-specific tax rates
 * as JSON: MOCK_SELL_TAX_RATES={"005930":0.002,...}. No guessed statutory default.
 */
export function mockCosts(ticker: string): ExecutionCosts {
  const taxes = JSON.parse(process.env.MOCK_SELL_TAX_RATES || "{}") as Record<string, number>;
  return {
    feeRate: Number(process.env.MOCK_FEE_RATE ?? DEFAULT_COSTS.feeRate),
    slippageRate: Number(process.env.MOCK_SLIPPAGE_RATE ?? DEFAULT_COSTS.slippageRate),
    sellTaxRate: Number(taxes[ticker] ?? DEFAULT_COSTS.sellTaxRate),
  };
}
