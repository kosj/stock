// Preserve existing debt without allowing new violations or disabling rules.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
let output;
try {
  output = execFileSync(process.execPath, [path.join(root, 'node_modules/eslint/bin/eslint.js'), '.', '-f', 'json'], { cwd: path.join(root, 'frontend'), encoding: 'utf8', maxBuffer: 10_000_000 });
} catch (error) {
  if (error.status !== 1 || !error.stdout) throw error;
  output = error.stdout;
}
const baseline = JSON.parse(readFileSync(path.join(root, 'scripts/lint-baseline.json'), 'utf8'));
const counts = {};
for (const file of JSON.parse(output)) for (const message of file.messages) {
  const key = `${path.relative(root, file.filePath).replaceAll(path.sep, '/')}|${message.ruleId ?? 'parse-error'}|${message.severity}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
const regressions = Object.entries(counts).filter(([key, count]) => count > (baseline[key] ?? 0));
for (const [key, count] of regressions) console.error(`${key}: ${count} (baseline ${baseline[key] ?? 0})`);
console.log(`Lint: ${Object.values(counts).reduce((a, b) => a + b, 0)} existing violations; ${regressions.length} regressions.`);
if (regressions.length) process.exitCode = 1;
