import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayBroker, replayTrading } from '../frontend/lib/core/replay.ts';
import { effectivePrice } from '../frontend/lib/core/execution-policy.ts';
const at='2026-10-19T09:12:00+09:00';
const costs={ feeRate:0, sellTaxRate:0, slippageRate:0 };
test('missing replay mark carries actual observation instead of resetting profit to cost',async()=>{
  const broker=new ReplayBroker(1000,{at,prices:{'005930':100}},null,costs);
  await broker.placeOrder({clientOrderId:'one',ticker:'005930',name:'test',side:'BUY',quantity:2,type:'MARKET',referencePrice:100});
  broker.session={at:'2026-10-19T10:00:00+09:00',prices:{'005930':150}};
  assert.equal((await broker.getPositions())[0].currentPrice,150);
  broker.session={at:'2026-10-19T11:00:00+09:00',prices:{}};
  const held=(await broker.getPositions())[0];
  assert.equal(held.currentPrice,150);assert.equal(held.priceStale,true);
  broker.session={at:'2026-10-19T12:00:00+09:00',prices:{'005930':90}};
  assert.equal((await broker.getPositions())[0].currentPrice,90);
});
test('replay rejects ambiguous/duplicate times, missing price maps and partial costs',async()=>{
  const base={initialCash:1000,batches:[],sessions:[{at,prices:{}}]};
  for(const invalid of [
    {...base,sessions:[{at:'2026-10-19T09:12:00',prices:{}}]},
    {...base,sessions:[{at:'2026-10-19Z',prices:{}}]},
    {...base,sessions:[{at:'2026-02-30T09:12:00+09:00',prices:{}}]},
    {...base,sessions:[base.sessions[0],base.sessions[0]]},
    {...base,sessions:[{at}]},
    {...base,costs:{}},
    {...base,batches:[{completedAt:'2026-10-16T16:12:00',rows:[]}]},
  ]) await assert.rejects(replayTrading(invalid));
  assert.throws(()=>effectivePrice(100,'BUY',{}));
});
test('replay exposes incomplete valuation separately from provisional performance',async()=>{
  const rows=Array.from({length:20},(_,i)=>({runDate:'2026-10-16',rank:i+1,ticker:String(i+1),name:'test',recommendation:'buy',currentPrice:100,baseReturn30d:0}));
  const prices=Object.fromEntries(rows.map(r=>[r.ticker,100]));
  const marked=Object.fromEntries(rows.map(r=>[r.ticker,110]));
  const result=await replayTrading({initialCash:10000,costs,batches:[{completedAt:'2026-10-16T16:12:00+09:00',rows}],sessions:[
    {at,prices}, {at:'2026-10-19T10:00:00+09:00',prices:marked}, {at:'2026-10-19T11:00:00+09:00',prices:{}},
  ]});
  assert.equal(result.equity[1].value,11000);assert.equal(result.equity[2].value,11000);
  assert.equal(result.valuationComplete,false);assert.equal(result.finalValuationComplete,false);
  assert.equal(result.equity[2].stale,true);
});
