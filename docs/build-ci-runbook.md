# Build, CI and migration rollout

## Reproducible local checks

Use Node 24 and npm 11 (the recorded package manager is npm 11.9.0).
Run `npm ci` from the repository root, then `npm run typecheck`,
`npm run lint:baseline`, `node --test scripts/test_*.mjs`,
`node --experimental-strip-types scripts/test_news_curation.mts`,
`python3 scripts/test_model_safety.py`, `python3 scripts/test_data_quality.py`,
`python3 -m unittest discover -s backend -p 'test_*.py'`, and `npm run build`.
The Python offline checks use `scripts/requirements-ci.txt`; this is not a
complete lock for the networked training pipeline.

The checked-in root lockfile controls the frontend workspace. Next's explicit
Turbopack/output tracing root includes hoisted packages. Vercel deployments must
use the repository root as their dashboard Root Directory; `vercel.json` runs
the root npm build and collects `frontend/.next`. The existing frontend-local
config is only for a project intentionally rooted at `frontend`; do not combine
the two layouts. Existing Vercel project settings need operator verification.

## Existing lint debt

`npm run lint:baseline` runs the real full ESLint rules and rejects increased
violation counts per file/rule/severity relative to the pre-change review.
This keeps the existing debt visible without disabling rules. It does not prove
an individual diagnostic was fixed: replacing one violation with another in the
same bucket is not detected. Reduce `scripts/lint-baseline.json` as debt is fixed;
do not increase it merely to make CI green. Full frontend lint remains a cleanup
item until the baseline is empty.

## Historical migration conflict: do not run a blind db push

2026-10-19 KST: the five new `202610200001`–`202610200005` migrations were applied
to the user-selected project using CLI linked SQL execution and recorded atomically.
Historical migrations had no CLI history and were not retroactively marked applied.
See `parallel-implementation-handoff-20261019.md` for verified invariants and the
remaining baseline reconciliation. The guidance below still applies to future db push.

`npm run audit:migrations` intentionally fails while the two duplicate historical
versions remain unresolved. CI uses `--allow-known-duplicates` to accept only the
six exact historical file hashes in `supabase/historical-migrations.json`.
It rejects changed/deleted historical files, new duplicate versions, and new
date-only versions. New files use unique monotonically increasing
`YYYYMMDDHHMM[SS]` prefixes. No filename changes or remote history repairs were
performed by this implementation.

Before a production rollout:

1. Back up the database and retrieve the applied migration history and schema
   from the intended Supabase project. Confirm the project ID independently.
2. Compare `supabase migration list --linked` and a schema dump to **both SQL
   bodies** for each duplicate prefix (`20260810`, `20261019`). A matching version
   alone cannot establish which body ran. Do not infer this from filenames.
3. In a disposable staging project with the same schema/history, agree a canonical
   migration sequence. Assign distinct versions to duplicate bodies only after
   determining which changes are present. Review `supabase migration repair`
   against that evidence; repair changes history, not schema.
4. Test the reconciled sequence on an empty database and an upgraded staging copy.
   Apply missing SQL once and verify the new RPCs, RLS and grants. Never reapply
   `supabase/schema.sql` over an upgraded database: its historical baseline
   includes grants/RLS state superseded by security migrations.
5. Record the project, observed history, canonical mapping, backups and applied
   versions in the handoff. Update the historical manifest in the same reviewed
   reconciliation change, then require strict migration audit in CI.

## Production deployment gate

Deployment runs the reusable verification workflow on the same commit before
uploading that checkout. The unchecked deploy-hook fallback was removed because
it can build a different branch head. Required secrets are `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. The upload CLI is pinned to 41.7.8;
its compatibility with the connected Vercel project must be verified at staging.

The production job also requires the repository/environment variable
`MIGRATION_HISTORY_RECONCILED=true` after the reconciliation and required new
migrations are actually applied. This is an operator acknowledgement, not a live
schema check. Keep it unset until that work is complete; clear it for subsequent
schema rollouts until their prerequisites are applied. Configure production
environment reviewers and branch protection in GitHub if required.

Disable Vercel's independent Git auto-deploy (or require the same CI checks in
Vercel project settings); otherwise it can bypass this GitHub Actions gate.
Those external settings and live deployments were not changed here.
