/** Compare read-only CLI export to isolated replay; never connects to production. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
if (!process.argv[2]) throw new Error('Usage: node scripts/verify_migration_baseline.mjs <CLI-JSON-export>');
const remote = JSON.parse(readFileSync(process.argv[2], 'utf8')).rows[0].evidence;
const manifest = JSON.parse(readFileSync(path.join(root, 'supabase/historical-migrations.json'), 'utf8'));
const db = new PGlite();
try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  for (const file of Object.keys(manifest.files).sort()) {
    await db.exec(readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
  }
  const expected = (await db.query(readFileSync(path.join(root, 'supabase/verify-legacy-baseline.sql'), 'utf8'))).rows[0].evidence;
  const normalized = value => value.replace(/\s+/g, ' ').trim();
  for (const column of expected.columns) {
    const actual = remote.columns.find(c => c.table === column.table && c.column === column.column);
    assert.ok(actual, `Missing ${column.table}.${column.column}`);
    assert.equal(actual.type, column.type, `Column type ${column.table}.${column.column}`);
    assert.equal(actual.nullable, column.nullable, `Column nullability ${column.table}.${column.column}`);
  }
  for (const kind of ['indexes', 'constraints', 'functions']) {
    for (const object of expected[kind]) {
      const actual = remote[kind].find(o => o.name === object.name && o.table === object.table);
      assert.ok(actual, `Missing ${kind}: ${object.name}`);
      assert.equal(normalized(actual.definition), normalized(object.definition), `Definition mismatch ${object.name}`);
    }
  }
  console.log(`Baseline verified: ${expected.columns.length} columns, ${expected.indexes.length} indexes, ${expected.constraints.length} constraints, ${expected.functions.length} functions. Later security/RLS overrides intentionally retained.`);
} finally { await db.close(); }
