/** Actual parsers, provider/router, engine and performance math; HTTP is fake. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { kisMinuteQuote, QuoteUnavailable } from '../frontend/lib/core/quote-evidence.ts';
import { hasFreshTradeTime } from '../frontend/lib/core/execution-policy.ts';
import { TradingEngineService } from '../frontend/lib/core/trading-engine.ts';
import { ReplayBroker, replayClock } from '../frontend/lib/core/replay.ts';
import { periodPerformance } from '../frontend/lib/core/performance.ts';
import { entryBudget } from '../frontend/lib/core/exposure-policy.ts';

const at='2026-10-30T14:40:30+09:00', now=Date.parse(at);
class Clock extends Date { constructor(value){super(value??now);} static now(){return now;} }
const row=(fields={})=>({stck_bsop_date:'20261030',stck_cntg_hour:'144000',stck_prpr:'1000',...fields});
function moduleFrom(path, require, globals={}){
 const code=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};
 vm.runInNewContext(code,{exports,require,Date:Clock,Map,Promise,Number,Error,console,
   setTimeout:callback=>{callback();return 1;},...globals},{filename:path});
 return exports;
}

test('KIS uses the newest returned business-date observation, not HTTP time or row order',()=>{
 const quote=kisMinuteQuote('005930',[row({stck_cntg_hour:'143900',stck_prpr:'900'}),row()],now);
 assert.equal(quote.price,1000);assert.equal(quote.tradedAt,'2026-10-30T05:40:00.000Z');
 assert.equal(quote.source,'KIS-minute');
 const benchmark=kisMinuteQuote('^KS11',[row({bstp_nmix_prpr:'5730.74'})],now);
 assert.equal(benchmark.price,5730.74);
});
test('KIS rejects stale, previous-day, future, fabricated dates, missing time and invalid prices',()=>{
 for(const update of [{stck_bsop_date:'20261029'},{stck_cntg_hour:'142000'},{stck_cntg_hour:'145000'},
   {stck_bsop_date:'20260231'},{stck_cntg_hour:undefined},{stck_cntg_hour:'250000'},
   {stck_prpr:'0'},{stck_prpr:'NaN'},{stck_prpr:'Infinity'}]){
  assert.throws(()=>kisMinuteQuote('005930',[row(update)],now),QuoteUnavailable);
 }
 assert.throws(()=>kisMinuteQuote('005930',null,now),QuoteUnavailable);
});
test('actual KIS provider uses only read-only quote endpoints and sanitizes credential-bearing HTTP failures',async()=>{
 const requests=[];
 const axios={post:async()=>({data:{access_token:'fixture-token',expires_in:3600}}),
   get:async(url,config)=>{requests.push({url,config});return {data:{rt_cd:'0',output2:[row({bstp_nmix_prpr:'5730'})]}};},isAxiosError:()=>false};
 const {KISProvider}=moduleFrom('../frontend/lib/server/providers.ts',name=>{
  if(name==='axios')return {default:axios};
  if(name.includes('kis-session'))return {kisBaseUrl:demo=>demo?'https://demo.invalid':'https://real.invalid',
    kisTokenCache:{get:async(_,issue)=>(await issue()).token},collectKisBalance:()=>{throw Error('not a balance request');}};
  if(name.includes('quote-evidence'))return {kisMinuteQuote,QuoteUnavailable};
  throw Error(name);
 });
 const provider=new KISProvider({appKey:'fixture-key',appSecret:'fixture-secret',isDemo:true,cacheScope:'A'});
 assert.equal((await provider.getExecutableQuote('005930')).price,1000);
 assert.equal((await provider.getExecutableQuote('^KS11')).price,5730);
 assert.match(requests[0].url,/demo.invalid.*inquire-time-itemchartprice$/);
 assert.equal(requests[0].config.headers.tr_id,'FHKST03010200');
 assert.equal(requests[0].config.params.FID_PW_DATA_INCU_YN,'N');
 assert.equal(requests[1].config.headers.tr_id,'FHKUP03500200');
 axios.get=async()=>{throw Error('Bearer fixture-secret must never escape');};
 await assert.rejects(provider.getExecutableQuote('005930'),error=>error.message==='KIS_REQUEST_FAILED');
});
test('execution router isolates users, coalesces quotes and never accepts an unverified fallback',async()=>{
 const configs=[],calls=[];
 let fallback=null, configured=true, fail=false;
 const {ExecutionMarketDataAdapter}=moduleFrom('../frontend/lib/server/adapters/execution-market-data-adapter.ts',name=>{
  if(name.includes('broker-config'))return {getBrokerConfig:async user=>{configs.push(user);return configured?{appKey:`${user}-key`,appSecret:'fixture'}:null;}};
  if(name.includes('providers'))return {KISProvider:class{constructor(c){this.c=c;}async getExecutableQuote(ticker){calls.push(this.c.cacheScope);if(fail)throw new QuoteUnavailable('KIS_PROVIDER_REJECTED');return {ticker,price:100,tradedAt:at,source:'KIS-minute'};}}};
  if(name.includes('yahoo-market'))return {YahooMarketDataAdapter:class{async getQuote(){return fallback;}async getCandles(){return [];}}};
  if(name.includes('execution-policy'))return {hasFreshTradeTime:(date)=>hasFreshTradeTime(date,now)};
  if(name.includes('quote-evidence'))return {QuoteUnavailable};
  throw Error(name);
 });
 const a=new ExecutionMarketDataAdapter('A'),b=new ExecutionMarketDataAdapter('B');
 await Promise.all([a.getQuote('005930'),a.getQuote('005930'),b.getQuote('005930')]);
 assert.deepEqual(configs.sort(),['A','B']);assert.deepEqual(calls.sort(),['A','B']);
 await a.getQuote('005930');assert.equal(calls.length,2);
 fail=true;fallback={ticker:'000660',price:999,tradedAt:'2026-10-30T14:20:00+09:00'};
 await assert.rejects(a.getQuote('000660'),/KIS_PROVIDER_REJECTED:NO_FRESH_FALLBACK/);
 configured=false;fallback=null;
 await assert.rejects(new ExecutionMarketDataAdapter('C').getQuote('005930'),/KIS_NOT_CONFIGURED/);
});

const recommendations=()=>Array.from({length:20},(_,i)=>({runDate:'2026-10-23',rank:i+1,ticker:String(i+1),
 name:'fixture',recommendation:'buy',currentPrice:100,baseReturn30d:0,sector:`sector-${i}`}));
function fixture(rows=recommendations()){
 const prices=Object.fromEntries(rows.map(r=>[r.ticker,100]));
 const broker=new ReplayBroker(10000,{at,prices});
 const deps={clock:replayClock(at),marketData:{getQuote:async ticker=>prices[ticker]?{ticker,price:prices[ticker]}:null,getCandles:async()=>[]},
   recommendations:{getTopRecommendations:async()=>rows},execution:{acquire:async()=>true,release:async()=>{},record:async()=>{}}};
 return {rows,prices,broker,deps,engine:new TradingEngineService(broker,deps)};
}
test('all stale holdings are degraded and risk checks are incomplete, not job success',async()=>{
 const {broker,engine}=fixture();
 broker.positions.set('unknown',{ticker:'unknown',name:'fixture',quantity:1,avgPrice:100});
 const result=await engine.executeTrading('fixture');
 assert.equal(result.status,'degraded');assert.equal(result.risk_checks_complete,false);
 assert.match(result.error,/시세 장애/);assert.ok(result.details.some(d=>d.code==='QUOTE_UNAVAILABLE'&&d.error));
 assert.equal(broker.fills.length,0);
});
test('risk-only execution sells stops but never buys or performs rank-out liquidation',async()=>{
 const {broker,deps}=fixture();
 broker.positions.set('1',{ticker:'1',name:'loser',quantity:10,avgPrice:120});
 broker.positions.set('2',{ticker:'2',name:'winner',quantity:10,avgPrice:80});
 deps.recommendations.getTopRecommendations=async()=>{throw Error('risk must not read recommendation ranks');};
 const engine=new TradingEngineService(broker,deps);
 const first=await engine.executeTrading('fixture',{riskOnly:true});
 const second=await engine.executeTrading('fixture',{riskOnly:true});
 assert.equal(first.mode,'risk');assert.equal(first.trades_sell,1);assert.equal(first.trades_buy,0);
 assert.equal(first.risk_checks_complete,true);assert.equal(second.trades_sell,0);
 assert.equal(broker.fills.length,1);assert.ok(broker.positions.has('2'));
});
test('a stop order without a confirmed fill is never a successful risk check',async()=>{
 const {broker,deps}=fixture();
 broker.positions.set('1',{ticker:'1',name:'fixture',quantity:10,avgPrice:120});
 broker.placeOrder=async()=>({status:'REJECTED',filledQuantity:0,avgFillPrice:0,filledAmount:0});
 const result=await new TradingEngineService(broker,deps).executeTrading('fixture',{riskOnly:true});
 assert.equal(result.risk_checks_complete,false);assert.equal(result.status,'degraded');
 assert.ok(result.error);
 assert.ok(result.details.some(d=>d.error==='ORDER_NOT_FILLED'));
});
test('new performance observations preserve the executed strategy, batch and policy context',async()=>{
 const {broker,deps}=fixture();const observations=[];
 const balance=broker.getBalance.bind(broker);
 broker.getBalance=async()=>({...await balance(),accountEpoch:3});
 deps.execution.snapshot=async(_,observation)=>observations.push(observation);
 await new TradingEngineService(broker,deps).executeTrading('fixture');
 assert.equal(observations.length,1);assert.equal(observations[0].accountEpoch,3);
 assert.equal(observations[0].context.strategyVersion,'mock-risk-v3');
 assert.equal(observations[0].context.recommendationDate,'2026-10-23');
 assert.equal(observations[0].context.exposureLimits.maxSectorWeight,.5);
});
test('new purchases obey actual sector and position value caps without forced liquidation',async()=>{
 const rows=recommendations();rows.forEach(r=>r.sector='finance');
 const {broker,engine}=fixture(rows);await engine.executeTrading('fixture');
 const invested=(await broker.getPositions()).reduce((s,p)=>s+p.currentPrice*p.quantity,0);
 assert.ok(invested<=5000);assert.ok(invested>0);
 assert.ok((await broker.getPositions()).every(p=>p.currentPrice*p.quantity<=2500));
 const f=fixture();f.broker.positions.set('6',{ticker:'6',name:'legacy',quantity:40,avgPrice:100});
 f.rows.forEach(r=>r.sector='finance');
 await f.engine.executeTrading('fixture');
 assert.equal(f.broker.positions.get('6').quantity,40,'legacy overweight is not force-sold');
 const sectorValue=(await f.broker.getPositions()).reduce((s,p)=>s+p.currentPrice*p.quantity,0);
 assert.ok(sectorValue<=7000,'50% of cash+existing 4000 equity, not 50% of remaining cash');
});
test('unknown sector and invalid risk limits cannot authorize new exposure',async()=>{
 const f=fixture();f.rows.forEach(r=>delete r.sector);
 const result=await f.engine.executeTrading('fixture');assert.equal(f.broker.fills.length,0);assert.match(result.error,/섹터/);
 assert.throws(()=>entryBudget(100,100,100,0,{maxPositionWeight:NaN,maxSectorWeight:.5}));
 assert.equal(entryBudget(500,500,1000,500,{maxPositionWeight:.25,maxSectorWeight:.5}),0);
});

test('actual cron risk route authenticates, paginates approved users and reports degraded checks',async()=>{
 const {NextRequest,NextResponse}=createRequire(import.meta.url)('next/server');
 const users=Array.from({length:4},(_,i)=>({user_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}));
 const queries=[],executions=[];let degraded=false,open=true;
 const route=moduleFrom('../frontend/app/api/cron/auto-trade/route.ts',name=>{
  if(name==='node:crypto')return {randomUUID:()=> 'unused'};
  if(name==='next/server')return {NextResponse};
  if(name.includes('server/supabase'))return {supabase:{rpc:async(name,args)=>{
    assert.equal(name,'list_mock_risk_accounts','risk scans must not enqueue/claim daily rebalance jobs');
    queries.push(args);return {data:users.filter(u=>!args.p_after||u.user_id>args.p_after).slice(0,args.p_limit)};
  }}};
  if(name.includes('trading-engine-service'))return {TradingEngineService:class{async executeTrading(user,options){
    executions.push({user,options});return {details:[],risk_checks_complete:!degraded,...(degraded?{error:'QUOTE_UNAVAILABLE'}:{})};
  }}};
  if(name.includes('broker-factory'))return {getBrokerForUser:async()=>({})};
  if(name.includes('kr-market-clock'))return {KrMarketClock:class{now(){return new Clock();}isMarketOpen(){return open;}}};
  throw Error(name);
 },{process:{env:{CRON_SECRET:'fixture-cron'}}});
 const call=(suffix='',token='fixture-cron')=>route.POST(new NextRequest(`http://isolated.test/api/cron/auto-trade?mode=risk${suffix}`,{method:'POST',headers:{Authorization:`Bearer ${token}`}}));
 assert.equal((await call('','wrong')).status,401);assert.equal(queries.length,0);
 const first=await call();assert.equal(first.status,202);const body=await first.json();
 assert.equal(body.processed,3);assert.equal(body.next_cursor,users[2].user_id);
 assert.ok(executions.every(x=>x.options.riskOnly===true));
 const last=await call(`&after=${body.next_cursor}`);assert.equal(last.status,200);assert.equal((await last.json()).processed,1);
 degraded=true;assert.equal((await call()).status,503);
 assert.equal((await call('&after=hostile')).status,400);
 open=false;const n=queries.length;assert.equal((await call()).status,409);assert.equal(queries.length,n);
});

test('risk workflow is five-minute, authenticated, bounded and cannot request rebalance mode',()=>{
 const workflow=fs.readFileSync(new URL('../.github/workflows/intraday-mock-risk.yml',import.meta.url),'utf8');
 assert.match(workflow,/2-59\/5 0-6 \* \* 1-5/);
 assert.match(workflow,/mode=risk/);assert.match(workflow,/CRON_SECRET/);
 assert.match(workflow,/range\(20\)/);assert.match(workflow,/timeout-minutes: 5/);
 assert.doesNotMatch(workflow,/actions: write|issues: write|workflow_run/);
});

const mark=(at,equity,benchmark=100)=>({observed_at:at,equity,complete:true,benchmark_price:benchmark,benchmark_aligned:true});
test('period returns use actual NAV endpoints and aligned benchmark rather than legacy book baseline',()=>{
 const result=periodPerformance({first:mark('2026-10-20T09:00:00+09:00',100),last:mark('2026-10-30T15:00:00+09:00',110,105),samples:2,flows:[]});
 assert.equal(result.available,true);assert.equal(result.returnPct,10);assert.ok(Math.abs(result.benchmarkPct-5)<1e-10);
 assert.ok(Math.abs(result.excessPct-5)<1e-10);
});
test('Modified Dietz neutralizes timed deposits; offset flows do not create spurious benchmark alpha',()=>{
 const history={first:mark('2026-10-20T09:00:00+09:00',100),last:mark('2026-10-20T11:00:00+09:00',160),samples:2,
  flows:[{created_at:'2026-10-20T10:00:00+09:00',amount:50}]};
 const result=periodPerformance(history);assert.equal(result.pnl,10);assert.equal(result.returnPct,8);assert.equal(result.excessPct,null);
 history.flows.push({created_at:'2026-10-20T10:30:00+09:00',amount:-50});
 assert.equal(periodPerformance(history).excessPct,null);
});
test('missing, incomplete, invalid or unaligned observations never fabricate performance',()=>{
 assert.equal(periodPerformance(null).available,false);
 const history={first:mark('2026-10-20T09:00:00+09:00',100),last:mark('2026-10-20T11:00:00+09:00',110),samples:2,flows:[]};
 history.last.complete=false;assert.equal(periodPerformance(history).available,false);
 history.last.complete=true;history.last.benchmark_aligned=false;
 assert.equal(periodPerformance(history).benchmarkPct,null);
 history.last.equity=NaN;assert.equal(periodPerformance(history).available,false);
});
