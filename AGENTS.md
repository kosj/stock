# Stock repository continuity

Before changing recommendation generation or mock trading, read
`docs/trading-safety-handoff.md`. It records the 2026-10-19 safety changes,
required DB migrations, tests, execution assumptions and incomplete deployment work.
Also read `docs/parallel-implementation-handoff-20261019.md` for subsequent
parallel implementation, five new migrations, rollout gates and remaining work.
Read `docs/migration-reconciliation-20261020.md` for the adopted unique historical
versions and exact-file rollout gate. Never modify already attested SQL bodies.
Latest follow-up: `docs/validation-followup-20261020.md` records atomic portfolio
import migration006, isolated workflow tests, real-data diagnostic limits and
the replay stale-valuation contract. Read it before continuing these areas.

- Preserve unrelated existing changes. The existing modification of
  `ml/hybrid_stacking_ensemble.py` was NOT part of the 2026-10-19 task.
- Production wiring: `frontend/lib/server/trading-engine-service.ts`.
- Shared production/replay engine: `frontend/lib/core/trading-engine.ts`.
- Do not restore non-idempotent RPC fallbacks or trade from unverified batches.
- Never call live trading endpoints or mutate a production database to run tests.
- Run `npm run test:trading`, `npm run test:trading-db`,
  `python3 scripts/test_model_safety.py`, and
  `npx tsc --noEmit --project frontend/tsconfig.json` before handoff.
- `frontend/AGENTS.md` contains additional mandatory framework guidance.
