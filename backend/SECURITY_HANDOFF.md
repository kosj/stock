# Legacy backend safety changes — 2026-10-20

The maintained application uses the Next.js API. This separate FastAPI service
has no verified end-user identity boundary and its user tables lack ownership
columns. Treat it as an optional **trusted internal service**.

- Every route except exact `/` and `/health` requires
  `Authorization: Bearer <LEGACY_INTERNAL_API_SECRET>`. An unset secret or one
  shorter than 32 characters disables access (HTTP 503); invalid credentials
  return 401. WebSocket requests are rejected before acceptance.
- Generate a high-entropy secret and configure it only on trusted servers.
  Never put it in browser environment variables, storage, query strings or
  client WebSocket code. A shared secret authorizes access to all legacy data;
  it does not replace per-user authorization. No existing deployment was
  inspected, reconfigured or tested.
- The old push API now returns 503 even for internally authenticated requests,
  and the alert scheduler is removed. Existing alerts are not marked triggered
  or broadcast. Restore only after verified user ownership, migrations,
  authorization and recipient-scoping tests exist.
- The heavily corrupted sector/ETF catalog and KRX parser now import safely,
  but return explicit 503 errors. Recover a trusted catalog/parser before
  enabling them. The old short-selling implementation treated investor-page
  prices as short-selling statistics; it is intentionally disabled. No guessed
  names, ETF mappings or fabricated financial values were substituted.
- Quotes share one producer per Python process, four concurrent fetches, at
  most 64 connections, 20 tickers per connection and 128 distinct tickers.
  Fetch/send timeouts bound resource use. Multiple workers still have separate
  producers; use a central quote service for a deployment-wide fetch budget.

Offline checks:

```sh
python3 -m compileall -q backend/app
python3 -m unittest discover -s backend -p 'test_*.py'
```

The regression tests stub FastAPI and the quote provider to test authorization,
fanout and fail-closed behavior without dependencies, network, DB writes or
broker access. They do not constitute a full FastAPI startup/integration test.
