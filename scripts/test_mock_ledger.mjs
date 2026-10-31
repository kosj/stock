import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import vm from "node:vm";

test("production constructor binds the same execution lease to factory-created mock brokers", async () => {
 const source=await readFile(new URL("../frontend/lib/server/trading-engine-service.ts",import.meta.url),"utf8");
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 class Core { constructor(broker,deps){this.broker=broker;this.deps=deps;} }
 class Mock { bindExecutionOwner(owner){this.owner=owner;} }
 class Control { owner="lease-owner"; }
 class Adapter {}
 const modules={
  "../core/trading-engine":{TradingEngineService:Core},
  "./adapters/mock-broker-adapter":{MockBrokerAdapter:Mock},
  "./adapters/yahoo-market-data-adapter":{YahooMarketDataAdapter:Adapter},
  "./adapters/supabase-recommendation-adapter":{SupabaseRecommendationAdapter:Adapter},
  "./adapters/kr-market-clock":{KrMarketClock:Adapter},
  "./adapters/supabase-execution-control":{SupabaseExecutionControl:Control},
  "./mock-execution":{mockCosts:()=>({})},
 };
 const exports={};
 vm.runInNewContext(compiled,{exports,process:{env:{}},require:name=>{assert.ok(modules[name],name);return modules[name];}});
 const broker=new Mock(), engine=new exports.TradingEngineService(broker);
 assert.equal(broker.owner,engine.deps.execution.owner);
 const control=new Control(); control.owner="injected-owner";
 const injectedBroker=new Mock(), injected=new exports.TradingEngineService(injectedBroker,{execution:control});
 assert.equal(injectedBroker.owner,injected.deps.execution.owner);
});

test("mock ledger: shared lease, epoch fencing, cash flows, realized pnl, reset and RPC privileges", async () => {
 const db=new PGlite();
 try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  const schema=await readFile(new URL("../supabase/schema.sql",import.meta.url),"utf8");
  for(const table of ["mock_accounts","mock_positions","mock_trades","mock_auto_trade_logs","prophet_recommendations"]){
   const sql=schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));
   assert.ok(sql,table); await db.exec(sql[0]);
  }
  await db.exec("ALTER TABLE mock_trades ADD COLUMN realized_pnl NUMERIC; CREATE UNIQUE INDEX ON mock_trades(user_id,client_order_id) WHERE client_order_id IS NOT NULL;");
  for(const file of ["202610190002_trading_safety.sql","202610190001_mock_order_guards.sql","202610200002_mock_ledger.sql"])
   await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8"));
  const user="00000000-0000-0000-0000-000000000001", owner="00000000-0000-0000-0000-000000000002", other="00000000-0000-0000-0000-000000000003";
  await db.query("SELECT acquire_auto_trade_lease($1,$2)",[user,owner]);
  const order=(side,epoch,id,who=owner,quantity=10,price=side==='BUY'?101:110)=>db.query("SELECT execute_mock_order($1,'005930','test',$2,$3,$4,$5,$6,$7,100) AS r",[user,quantity,price,id,side,epoch,who]);
  assert.equal((await order('BUY',0,'buy')).rows[0].r.quantity,10);
  assert.equal((await order('BUY',0,'buy')).rows[0].r.duplicate,true);
  await assert.rejects(order('BUY',0,'buy',owner,11),/order_key_conflict/);
  await assert.rejects(order('BUY',0,'other',other),/account_busy/);
  await assert.rejects(order('BUY',1,'epoch'),/stale_account_epoch/);
  await order('SELL',0,'sell');
  const snap=async()=>(await db.query("SELECT mock_account_snapshot($1) AS a",[user])).rows[0].a;
  assert.equal((await snap()).realized_pnl,90);
  assert.equal((await snap()).cash,10000090);
  assert.equal((await snap()).recorded_costs,110);
  // A manual deposit changes capital, not P&L.
  await db.query("SELECT update_mock_account($1,$2,0,12000090,true,NULL,false,false)",[user,owner]);
  const a=await snap(); assert.equal(a.net_cash_adjustments,2000000); assert.equal(a.cash-a.performance_baseline-a.net_cash_adjustments,90);
  await db.query("SELECT update_mock_account($1,$2,0,NULL,false,NULL,false,true)",[user,owner]);
  assert.equal((await snap()).account_epoch,1); assert.equal((await snap()).cash,10000000);
  assert.equal((await snap()).net_cash_adjustments,0);
  await assert.rejects(order('BUY',0,'late'),/stale_account_epoch/);
  await order('BUY',1,'buy'); // same logical daily key works in the new epoch
  assert.equal((await snap()).positions[0].quantity,10);
  await db.exec("SET ROLE service_role");
  await assert.rejects(db.query("SELECT execute_mock_buy($1,'x','x',1,1,'bypass')",[user]),/permission denied/);
  await db.exec("RESET ROLE; SET ROLE anon");
  await assert.rejects(order('BUY',1,'anon'),/permission denied/);
 } finally { await db.close(); }
});
