import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('migration audit enforces unique immutable history and exact rollout evidence', () => {
  const repo = path.resolve(import.meta.dirname, '..');
  const root = mkdtempSync(path.join(tmpdir(), 'migration-audit-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true });
    copyFileSync(path.join(repo, 'scripts/audit_migrations.mjs'), path.join(root, 'scripts/audit_migrations.mjs'));
    copyFileSync(path.join(repo, 'supabase/historical-migrations.json'), path.join(root, 'supabase/historical-migrations.json'));
    copyFileSync(path.join(repo, 'supabase/verified-rollout.json'), path.join(root, 'supabase/verified-rollout.json'));
    const manifest = JSON.parse(readFileSync(path.join(repo, 'supabase/historical-migrations.json')));
    const rollout = JSON.parse(readFileSync(path.join(repo, 'supabase/verified-rollout.json')));
    for (const file of Object.keys(rollout.files)) copyFileSync(path.join(repo, 'supabase/migrations', file), path.join(root, 'supabase/migrations', file));
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/audit_migrations.mjs'), ...args], { encoding: 'utf8' }).status;
    assert.equal(run(), 0, 'reconciled unique history passes strict audit');
    assert.equal(run('--require-rollout'), 0);
    assert.equal(run('--allow-known-duplicates'), 1, 'old bypass flag is no longer accepted');
    const newFile = path.join(root, 'supabase/migrations/202610210001_test.sql');
    writeFileSync(newFile, 'select 1;');
    assert.equal(run(), 0, 'unapplied new SQL can be tested in a PR');
    assert.equal(run('--require-rollout'), 1, 'unapplied SQL cannot deploy');
    const collision = path.join(root, 'supabase/migrations/202610210001_collision.sql');
    writeFileSync(collision, 'select 2;');
    assert.equal(run(), 1);
    rmSync(collision);
    const stale = path.join(root, 'supabase/migrations/202501010001_old.sql');
    writeFileSync(stale, 'select 1;');
    assert.equal(run(), 1);
    rmSync(stale);
    writeFileSync(path.join(root, 'supabase/migrations', Object.keys(manifest.files)[0]), '-- changed historical file');
    assert.equal(run(), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
