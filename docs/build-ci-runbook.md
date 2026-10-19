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

## Reconciled migration history

The user-selected project has eleven unique history versions. Six manual-era
changes were adopted as an observed schema baseline after read-only comparison
against isolated historical replay; their original execution dates are unknown.
Five new migrations were actually applied transactionally. All eleven stored SQL
bodies match the local files. Details and old/new filename mapping are in
`migration-reconciliation-20261020.md`.

`npm run audit:migrations` is now strict: no duplicate-version exception remains.
Historical SQL bytes and every attested applied file are immutable. New files use
unique increasing `YYYYMMDDHHMM[SS]` versions; use forward migrations for changes.

For subsequent rollouts, test new SQL, back up the intended DB, inspect its actual
history/schema, apply only missing migrations, then verify stored statements and
runtime privileges. Update `supabase/verified-rollout.json` only from that evidence.
It is a checked-in operator attestation, not an automatic live DB check. Never add
unapplied SQL hashes merely to satisfy deployment. The baseline verifier command is:

```sh
# Export with CLI db query --linked --file supabase/verify-legacy-baseline.sql
node scripts/verify_migration_baseline.mjs /path/to/CLI-export.json
```

Never reapply `supabase/schema.sql` over an upgraded database: its historical RLS
settings are superseded by security migrations. These migrations still assume the
original base application tables exist; a fresh project needs a separate bootstrap
plan. Direct PostgreSQL/pooler access from this environment was unavailable;
`db push --dry-run` was not verified. History was checked via CLI linked SQL.

## Production deployment gate

Deployment runs the reusable verification workflow on the same commit before
uploading that checkout. Required secrets are `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
and `VERCEL_PROJECT_ID`. The upload CLI is pinned to 41.7.8; its compatibility
with the connected Vercel project must be verified during deployment.

The production job runs `node scripts/audit_migrations.mjs --require-rollout`.
Every SQL file must match the exact applied hash in the verified rollout manifest.
New, missing or changed SQL blocks deployment. This replaces the unscoped
`MIGRATION_HISTORY_RECONCILED` variable and remains closed for future unapplied
migrations. Configure environment reviewers/branch protection as needed.

Both Vercel config files disable independent Git auto-deployment using
`git.deploymentEnabled=false`; only the checked Actions path should publish.
Confirm the effective Root Directory and observed status after pushing, especially
for a legacy project rooted at `frontend`. A prior Vercel success while Actions
failed demonstrated the bypass. Public health proves liveness only, not deployment
SHA, environment configuration or database access.
