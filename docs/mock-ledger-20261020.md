# Mock account ledger and execution fencing

Implemented TRD-01/02/03, UI-01, and KRW-only portion of TRD-05. No production DB changes or live trade requests were made.

## Deployment order

Apply `supabase/migrations/202610200002_mock_ledger.sql` after the trading-safety and guarded-order migrations, before deploying the new server. It intentionally revokes service-role access to the old buy/sell RPCs; mixed old/new app versions will fail closed. New entry point: `execute_mock_order` (service role only).

Reset/settings/manual and automatic trades share `auto_trade_leases`. All mutation RPCs lock the lease row before the account row and verify owner, expiry and account epoch. Reset is one transaction, increments epoch, removes positions/trades/run logs, and starts a new baseline. Old in-flight orders cannot trade against the reset account; daily automatic order keys are internally namespaced by epoch. Do not remove these checks or restore legacy RPC fallback.

## Accounting

Existing accounts start a new disclosed performance baseline equal to cash plus position book cost. Historical cash adjustments and fee details cannot be reconstructed and are not invented. New cash adjustments are external capital flows recorded in `mock_cash_ledger`; resets have their own epoch. Account total P&L is current account value minus baseline minus net cash flows. Realized and unrealized P&L and recorded execution costs are shown separately. Costs are already embedded in effective trade prices, so they must not be subtracted again. Displayed return uses baseline plus net flows, is not time-weighted, and is null when the denominator is nonpositive. Quote failure marks valuation provisional; average-cost fallback is not presented as a reliable valuation.

`mock_account_snapshot` gives a consistent account/positions/ledger snapshot in one SQL statement. Historical pre-baseline realized P&L is excluded. Cost history completeness applies to baseline-period trades.

## Manual orders and logs

Manual POST requires a v4 UUID and `account_epoch`; UI persists the same UUID in tab session storage for identical retries and displays the actual returned receipt. Reconciliation happens before market-open checks, allowing a lost response to be recovered after close. The executable estimate includes configured fees/slippage/tax. Execution still fetches and verifies a fresh actual exchange timestamp. Both manual route and broker reject non-six-digit domestic tickers because the account is KRW and has no FX contract.

`GET /api/mock/auto-trade/logs?offset=0&limit=20` returns `{items,nextOffset}`, scopes by authenticated approved user, caps page size at 100 and offset at 100000, and exposes database failures separately from empty data. UI pages five records at a time.

## Validation

`node --test scripts/test_mock_ledger.mjs` uses isolated PGlite and covers lease ownership, epoch fencing, duplicate/conflicting order keys, cash flows, realized P&L, recorded costs, atomic reset and revoked legacy/anonymous execution. Existing core trading tests remain required. Never run these checks against a production database.
