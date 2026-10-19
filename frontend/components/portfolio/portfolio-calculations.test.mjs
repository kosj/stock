import test from 'node:test';
import assert from 'node:assert/strict';
import { recalculatePosition, recalculateSummary } from './portfolio-calculations.ts';

const holding = {
  position_id: 7, ticker: '005930', name: 'Samsung', quantity: 10, avg_price: 100,
  current_price: 120, price_available: true, stop_loss: null, take_profit: null,
  strategy: null, notes: null, cost_basis: 1000, total_value: 1200,
  pnl_amount: 200, pnl_percent: 20, is_near_stop: false, is_near_target: false,
};

test('quantity and average-cost edits invalidate every cached valuation and aggregate', () => {
  const edited = { ...holding, quantity: 20, avg_price: 110 };
  const summary = recalculateSummary({ portfolio_id: 1, name: 'Test', positions: [edited],
    total_invested: 1000, total_value: 1200, total_pnl: 200, total_pnl_percent: 20 });
  assert.equal(summary.total_invested, 2200);
  assert.equal(summary.total_value, 2400);
  assert.equal(summary.total_pnl, 200);
  assert.equal(summary.positions[0].cost_basis, 2200);
  assert.equal(summary.positions[0].total_value, 2400);
  assert.equal(summary.positions[0].pnl_percent, 200 / 2200 * 100);
  assert.equal(edited.cost_basis, 1000, 'calculations must not mutate the SWR snapshot');
});

test('unavailable quote follows the edited cost fallback and never invents a loss', () => {
  const updated = recalculatePosition({ ...holding, avg_price: 150, price_available: false });
  assert.equal(updated.current_price, 150);
  assert.equal(updated.total_value, 1500);
  assert.equal(updated.pnl_amount, 0);
  assert.equal(updated.pnl_percent, 0);
});

test('stop/target indicators follow edits and empty portfolios have zero totals', () => {
  const updated = recalculatePosition({ ...holding, stop_loss: 115, take_profit: 125 });
  assert.equal(updated.is_near_stop, true);
  assert.equal(updated.is_near_target, true);
  const empty = recalculateSummary({ portfolio_id: 1, name: 'Test', positions: [],
    total_invested: 1000, total_value: 1200, total_pnl: 200, total_pnl_percent: 20 });
  assert.deepEqual([empty.total_invested, empty.total_value, empty.total_pnl, empty.total_pnl_percent], [0, 0, 0, 0]);
});
