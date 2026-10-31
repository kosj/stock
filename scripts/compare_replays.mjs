/** Offline paired replay. Input provenance is a declaration, not proof of authenticity. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { replayTrading } from '../frontend/lib/core/replay.ts';

const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? Date.parse(value) : NaN;
};
const text = x => typeof x === 'string' && x.trim().length > 0;
function assertKnown(observedAt, availableAt, cutoff, context) {
  const observed = timestamp(observedAt), available = timestamp(availableAt), end = timestamp(cutoff);
  if (![observed, available, end].every(Number.isFinite) || observed > available || available > end)
    throw new Error(`${context}: invalid or future provenance timestamp`);
}

/** Require a provenance entry for every price used, with no silent default cost assumptions. */
export function validateEvidence(input, evidence) {
  if (!input || !Array.isArray(input.sessions) || !Array.isArray(input.batches) || !evidence ||
      !Array.isArray(evidence.sessions) || !Array.isArray(evidence.batches) || !text(evidence.sourceDescription))
    throw new Error('Replay input and evidence manifest required');
  const costs = input.costs;
  if (!costs || !['feeRate', 'sellTaxRate', 'slippageRate'].every(k => Object.hasOwn(costs, k) && Number.isFinite(costs[k])))
    throw new Error('All cost assumptions must be explicitly supplied');
  if (evidence.sessions.length !== input.sessions.length || evidence.batches.length !== input.batches.length)
    throw new Error('Evidence must cover every session and batch');
  input.sessions.forEach((session, i) => {
    const proof = evidence.sessions[i];
    if (!proof || proof.at !== session.at || !proof.prices || typeof proof.prices !== 'object' || Array.isArray(proof.prices))
      throw new Error(`Session ${i}: evidence mismatch`);
    if (!session.prices || !isDeepStrictEqual(Object.keys(proof.prices).sort(), Object.keys(session.prices).sort()))
      throw new Error(`Session ${i}: every observed price needs evidence`);
    for (const [ticker, value] of Object.entries(session.prices)) {
      const p = proof.prices[ticker];
      if (!Number.isFinite(value) || value <= 0 || !p || !text(p.sourceId)) throw new Error(`Session ${i}: invalid price evidence for ${ticker}`);
      assertKnown(p.observedAt, p.availableAt, session.at, `Session ${i} ${ticker}`);
    }
    if (session.benchmark !== undefined) {
      if (!Number.isFinite(session.benchmark) || session.benchmark <= 0 || !proof.benchmark || !text(proof.benchmark.sourceId))
        throw new Error(`Session ${i}: invalid benchmark evidence`);
      assertKnown(proof.benchmark.observedAt, proof.benchmark.availableAt, session.at, `Session ${i} benchmark`);
    } else if (proof.benchmark) throw new Error(`Session ${i}: benchmark evidence without value`);
  });
  input.batches.forEach((batch, i) => {
    const proof = evidence.batches[i];
    if (!proof || proof.completedAt !== batch.completedAt || !text(proof.universeSnapshotId) || !Array.isArray(proof.universeTickers))
      throw new Error(`Batch ${i}: dated universe evidence required`);
    assertKnown(proof.universeObservedAt, proof.universeAvailableAt, batch.completedAt, `Batch ${i} universe`);
    const universe = new Set(proof.universeTickers);
    if (universe.size !== proof.universeTickers.length || !proof.universeTickers.every(text) || !Array.isArray(batch.rows) ||
        batch.rows.some(row => !universe.has(row.ticker))) throw new Error(`Batch ${i}: recommendations must belong to declared universe`);
  });
}

export async function compareReplays(spec) {
  if (!spec || !text(spec.researchQuestion) || !text(spec.predeclaredDecisionRule) || !Array.isArray(spec.variants) || spec.variants.length < 2)
    throw new Error('Research question, predeclared decision rule, and at least two variants required');
  const ids = new Set();
  const first = spec.variants[0];
  for (const variant of spec.variants) {
    if (!text(variant.id) || ids.has(variant.id)) throw new Error('Unique variant identifiers required');
    ids.add(variant.id);
    validateEvidence(variant.input, variant.evidence);
    for (const key of ['initialCash', 'capital', 'costs', 'sessions', 'exposureLimits'])
      if (!isDeepStrictEqual(variant.input[key], first.input[key])) throw new Error(`Variants must share identical ${key}`);
    if (!isDeepStrictEqual(variant.evidence.sessions, first.evidence.sessions)) throw new Error('Variants must share price and benchmark evidence');
    if (variant.evidence.sourceDescription !== first.evidence.sourceDescription || !isDeepStrictEqual(variant.evidence.batches, first.evidence.batches))
      throw new Error('Variants must share dated universe evidence and batch availability');
  }
  const variants = [];
  for (const variant of spec.variants) {
    const result = await replayTrading(variant.input);
    variants.push({ id: variant.id, result });
  }
  return { kind: 'offline_paired_replay_exploratory', researchQuestion: spec.researchQuestion,
    predeclaredDecisionRule: spec.predeclaredDecisionRule, evidenceStatus: 'declared_not_independently_verified',
    decision: 'not_automatically_determined', variants,
    limitations: ['Provenance is self-declared; archive and independently audit source snapshots.',
      'Declared universe membership does not establish complete historical coverage or eliminate survivorship bias.',
      'Scores and model training inputs are not reconstructed or proven point-in-time.',
      'Single realized path is not a confidence interval; no claim of statistical significance or automatic promotion.',
      'Same observed snapshots do not model order-book capacity, unobserved intraday stops, or market holidays.',
      'Tax is an explicit input assumption, not a determination of applicable tax.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/compare_replays.mjs comparison.json');
  const spec = JSON.parse(await readFile(process.argv[2], 'utf8'));
  console.log = (...args) => console.error(...args);
  process.stdout.write(JSON.stringify(await compareReplays(spec), null, 2) + '\n');
}
