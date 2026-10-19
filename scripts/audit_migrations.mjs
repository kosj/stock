import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'supabase/migrations');
const manifest = JSON.parse(readFileSync(path.join(root, 'supabase/historical-migrations.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--require-rollout')) throw new Error('Unsupported migration audit flag');
const rollout = JSON.parse(readFileSync(path.join(root, 'supabase/verified-rollout.json'), 'utf8'));
const files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
const lastHistoricalVersion = Object.keys(manifest.files)
  .map(file => file.split('_')[0].padEnd(14, '0')).sort().at(-1);
let failed = false;
const versions = new Map();
for (const file of files) {
  const match = /^(\d{8}|\d{12}|\d{14})_[a-z0-9_]+\.sql$/.exec(file);
  if (!match) { console.error(`Invalid migration filename: ${file}`); failed = true; continue; }
  const version = match[1];
  versions.set(version, [...(versions.get(version) ?? []), file]);
  const hash = createHash('sha256').update(readFileSync(path.join(directory, file))).digest('hex');
  if (manifest.files[file] && manifest.files[file] !== hash) {
    console.error(`Historical migration changed: ${file}`); failed = true;
  }
  if (rollout.files[file] && rollout.files[file] !== hash) {
    console.error(`Applied migration changed: ${file}`); failed = true;
  }
  if (args.includes('--require-rollout') && rollout.files[file] !== hash) {
    console.error(`Migration lacks verified rollout evidence: ${file}`); failed = true;
  }
  if (!manifest.files[file] && version.length < 12) {
    console.error(`New migration must use a unique YYYYMMDDHHMM[SS] version: ${file}`); failed = true;
  }
  if (!manifest.files[file] && version.padEnd(14, '0') <= lastHistoricalVersion) {
    console.error(`New migration precedes historical baseline: ${file}`); failed = true;
  }
}
for (const file of Object.keys(manifest.files)) if (!files.includes(file)) {
  console.error(`Historical migration missing: ${file}`); failed = true;
}
for (const file of Object.keys(rollout.files)) if (!files.includes(file)) {
  console.error(`Applied migration missing: ${file}`); failed = true;
}
for (const [version, names] of versions) if (names.length > 1) {
  failed = true;
  console.warn(`Duplicate migration version ${version}: ${names.join(', ')}`);
}
console.log(`Audited ${files.length} migrations. This does not inspect remote migration history.`);
if (failed) process.exitCode = 1;
