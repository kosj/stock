import type { PortfolioPosition, PortfolioSummary } from "./portfolio-data";

/** Reprice cached holdings after quantity/cost edits without another market fetch. */
export function recalculatePosition(position: PortfolioPosition): PortfolioPosition {
  const price = position.price_available ? position.current_price : position.avg_price;
  const cost = position.avg_price * position.quantity;
  const value = price * position.quantity;
  const pnl = value - cost;
  return {
    ...position,
    current_price: price,
    cost_basis: cost,
    total_value: value,
    pnl_amount: pnl,
    pnl_percent: cost > 0 ? pnl / cost * 100 : 0,
    is_near_stop: position.stop_loss !== null && price <= position.stop_loss * 1.05,
    is_near_target: position.take_profit !== null && price >= position.take_profit * 0.95,
  };
}

export function recalculateSummary(summary: PortfolioSummary): PortfolioSummary {
  const positions = summary.positions.map(recalculatePosition);
  const invested = positions.reduce((sum, position) => sum + position.cost_basis, 0);
  const value = positions.reduce((sum, position) => sum + position.total_value, 0);
  const pnl = value - invested;
  return { ...summary, positions, total_invested: invested, total_value: value,
    total_pnl: pnl, total_pnl_percent: invested > 0 ? pnl / invested * 100 : 0 };
}
