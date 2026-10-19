import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('migration audit distinguishes acknowledged conflicts from unsafe edits and new collisions', () => {
  const repo = path.resolve(import.meta.dirname, '..');
  const root = mkdtempSync(path.join(tmpdir(), 'migration-audit-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true });
    copyFileSync(path.join(repo, 'scripts/audit_migrations.mjs'), path.join(root, 'scripts/audit_migrations.mjs'));
    copyFileSync(path.join(repo, 'supabase/historical-migrations.json'), path.join(root, 'supabase/historical-migrations.json'));
    const manifest = JSON.parse(readFileSync(path.join(repo, 'supabase/historical-migrations.json')));
    for (const file of Object.keys(manifest.files)) copyFileSync(path.join(repo, 'supabase/migrations', file), path.join(root, 'supabase/migrations', file));
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/audit_migrations.mjs'), ...args], { encoding: 'utf8' }).status;
    assert.equal(run(), 1, 'strict audit must flag unreconciled history');
    assert.equal(run('--allow-known-duplicates'), 0);
    const newFile = path.join(root, 'supabase/migrations/202610200001_test.sql');
    writeFileSync(newFile, 'select 1;');
    assert.equal(run('--allow-known-duplicates'), 0);
    const collision = path.join(root, 'supabase/migrations/202610200001_collision.sql');
    writeFileSync(collision, 'select 2;');
    assert.equal(run('--allow-known-duplicates'), 1);
    rmSync(collision);
    const stale = path.join(root, 'supabase/migrations/202501010001_old.sql');
    writeFileSync(stale, 'select 1;');
    assert.equal(run('--allow-known-duplicates'), 1);
    rmSync(stale);
    writeFileSync(path.join(root, 'supabase/migrations', Object.keys(manifest.files)[0]), '-- changed historical file');
    assert.equal(run('--allow-known-duplicates'), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
