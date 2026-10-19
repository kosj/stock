import { api } from "@/lib/api";
import type { BrokerHolding } from "@/lib/server/providers";

/** DTOs returned by the owned portfolio routes; keep names aligned with SQL/API. */
export interface PortfolioRecord {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortfolioPosition {
  position_id: number;
  ticker: string;
  name: string;
  quantity: number;
  avg_price: number;
  stop_loss: number | null;
  take_profit: number | null;
  strategy: string | null;
  notes: string | null;
  current_price: number;
  price_available: boolean;
  cost_basis: number;
  total_value: number;
  pnl_amount: number;
  pnl_percent: number;
  is_near_stop: boolean;
  is_near_target: boolean;
}

export interface PortfolioSummary {
  portfolio_id: number;
  name: string;
  total_invested: number;
  total_value: number;
  total_pnl: number;
  total_pnl_percent: number;
  positions: PortfolioPosition[];
}

export interface BrokerHoldingsResponse {
  holdings?: BrokerHolding[];
  brokerType?: string;
  error?: string;
  hint?: string;
}

export type PortfolioPositionInput = Pick<PortfolioPosition,
  "ticker" | "name" | "quantity" | "avg_price" | "stop_loss" | "take_profit" | "strategy" | "notes">;

interface SavedPortfolioPosition extends PortfolioPositionInput {
  id: number;
  portfolio_id: number;
  created_at: string;
  updated_at: string;
}

// The shared API client returns unknown. Contain the existing trusted same-app
// JSON contracts at this boundary rather than propagating untyped component state.
export const portfolioClient = {
  ...api.portfolio,
  list: () => api.portfolio.list() as Promise<PortfolioRecord[]>,
  create: (body: Parameters<typeof api.portfolio.create>[0]) =>
    api.portfolio.create(body) as Promise<PortfolioRecord>,
  summary: (...args: Parameters<typeof api.portfolio.summary>) =>
    api.portfolio.summary(...args) as Promise<PortfolioSummary>,
  addPosition: (...args: Parameters<typeof api.portfolio.addPosition>) =>
    api.portfolio.addPosition(...args) as Promise<{ id: number }>,
  replacePositions: async (id: number, positions: PortfolioPositionInput[]): Promise<SavedPortfolioPosition[]> => {
    const response = await fetch(`/api/portfolio/${id}/positions/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions }),
    });
    const result: { positions?: SavedPortfolioPosition[]; error?: string } = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (!Array.isArray(result.positions)) throw new Error("저장 결과를 확인하지 못했습니다. 새로고침 후 확인해주세요.");
    return result.positions;
  },
};

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
