import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReplays, validateEvidence } from './compare_replays.mjs';
const at = '2026-10-19T09:12:00+09:00';
const completedAt = '2026-10-16T16:30:00+09:00';
const observedAt = '2026-10-19T09:11:00+09:00';
const rows = Array.from({length:20}, (_,i) => ({runDate:'2026-10-16', rank:i+1, ticker:String(i+1), name:'test', recommendation:'buy', currentPrice:100, baseReturn30d:0, sector:`sector-${i}`}));
const prices = Object.fromEntries(rows.map(r => [r.ticker,100]));
const priceProof = Object.fromEntries(rows.map(r => [r.ticker,{sourceId:'archived', observedAt, availableAt:observedAt}]));
const input = {initialCash:10000,costs:{feeRate:0.00015,sellTaxRate:0,slippageRate:0.001},batches:[{completedAt,rows}],sessions:[{at,prices,benchmark:3000}]};
const evidence = {sourceDescription:'synthetic fixture',sessions:[{at,prices:priceProof,benchmark:{sourceId:'index',observedAt,availableAt:observedAt}}],batches:[{completedAt,universeSnapshotId:'universe',universeObservedAt:completedAt,universeAvailableAt:completedAt,universeTickers:rows.map(r => r.ticker)}]};
const spec = () => ({researchQuestion:'comparison',predeclaredDecisionRule:'no promotion without independent evidence',variants:[{id:'a',input:structuredClone(input),evidence:structuredClone(evidence)},{id:'b',input:structuredClone(input),evidence:structuredClone(evidence)}]});
test('paired replay uses shared snapshots and returns provisional cost-adjusted results',async()=>{
  const result=await compareReplays(spec());
  assert.equal(result.evidenceStatus,'declared_not_independently_verified');
  assert.equal(result.decision,'not_automatically_determined');
  assert.equal(result.variants[0].result.totalReturn,result.variants[1].result.totalReturn);
  assert.ok(result.variants[0].result.fills.length>0);
  assert.ok(result.variants[0].result.totalReturn<0);
});
test('future or missing price, benchmark and universe evidence fails closed',()=>{
  for (const mutate of [
    e=>delete e.sessions[0].prices['1'],
    e=>e.sessions[0].prices['1'].availableAt='2026-10-19T15:30:00+09:00',
    e=>e.sessions[0].benchmark.observedAt='2026-10-19T15:30:00+09:00',
    e=>e.batches[0].universeAvailableAt='2026-10-17T00:00:00+09:00',
    e=>e.batches[0].universeTickers.shift(),
    e=>e.sessions[0].prices['1'].observedAt='2026-02-30T09:00:00+09:00',
  ]) { const e=structuredClone(evidence); mutate(e); assert.throws(()=>validateEvidence(input,e)); }
  const partial=structuredClone(input); delete partial.costs.sellTaxRate;
  assert.throws(()=>validateEvidence(partial,evidence));
});
test('comparison rejects different market data, universe, and duplicate ids',async()=>{
  for (const mutate of [
    s=>s.variants[1].input.sessions[0].prices['1']=101,
    s=>s.variants[1].input.costs.feeRate=0.01,
    s=>s.variants[1].evidence.batches[0].universeSnapshotId='other',
    s=>s.variants[1].id='a',
  ]) { const s=spec(); mutate(s); await assert.rejects(compareReplays(s)); }
});
test('different recommendation rankings produce different fills under identical market evidence',async()=>{
  const s=spec();
  const other=s.variants[1].input.batches[0].rows;
  [other[0].ticker,other[10].ticker]=[other[10].ticker,other[0].ticker];
  [other[0].sector,other[10].sector]=[other[10].sector,other[0].sector];
  const result=await compareReplays(s);
  const a=result.variants[0].result.fills.map(f=>f.ticker);
  const b=result.variants[1].result.fills.map(f=>f.ticker);
  assert.ok(a.includes('1')); assert.ok(!b.includes('1')); assert.ok(b.includes('11'));
});
test('future completed batches cannot influence earlier sessions',async()=>{
  const s=spec();
  for (const v of s.variants) {
    v.input.batches[0].completedAt='2026-10-19T16:12:00+09:00';
    v.evidence.batches[0].completedAt='2026-10-19T16:12:00+09:00';
  }
  const result=await compareReplays(s);
  assert.equal(result.variants[0].result.fills.length,0);
  assert.equal(result.variants[1].result.fills.length,0);
});
