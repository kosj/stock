/** Isolated API integration, not browser/staging E2E. Actual handlers, authorization,
 * account control and RPC SQL run here; identity issuer, clock and quotes are fixtures.
 * The Supabase transport below translates only used query operations into local SQL.
 * No production client, credentials, network, database or order endpoint is used.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import assert from "node:assert/strict";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const {NextRequest}=nativeRequire("next/server");
const userA="00000000-0000-4000-8000-000000000001";
const userB="00000000-0000-4000-8000-000000000002";
const ident=s=>{assert.match(s,/^[a-z_][a-z0-9_]*$/i);return `"${s}"`;};

async function fixture(){
 const db=new PGlite();
 await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
 const schema=readFileSync(resolve(root,"supabase/schema.sql"),"utf8");
 for(const table of ["mock_accounts","mock_positions","mock_trades","mock_auto_trade_logs","prophet_recommendations"]){
  const sql=schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(sql,table);await db.exec(sql[0]);
 }
 await db.exec("ALTER TABLE mock_trades ADD COLUMN realized_pnl NUMERIC; CREATE UNIQUE INDEX ON mock_trades(user_id,client_order_id) WHERE client_order_id IS NOT NULL;");
 for(const name of ["202610190001_mock_order_guards.sql","202610190002_trading_safety.sql","202610200002_mock_ledger.sql"])
  await db.exec(readFileSync(resolve(root,"supabase/migrations",name),"utf8"));
 // Same role as production server, with table grants equivalent to Supabase defaults.
 await db.exec("GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role; SET ROLE service_role;");
 const state={identity:null,open:true,price:1000,dbCalls:0,queryFailure:null};
 const query=async(sql,params=[])=>{state.dbCalls++;return db.query(sql,params);};
 class Query {
  constructor(table){this.table=table;this.columns="*";this.filters=[];this.orders=[];this.mode="select";}
  select(columns="*"){this.columns=columns;return this;}
  eq(key,value){this.filters.push([key,value]);return this;}
  order(key,opts){this.orders.push(`${ident(key)} ${opts.ascending?"ASC":"DESC"}`);return this;}
  range(first,last){this.offset=first;this.limit=last-first+1;return this;}
  upsert(row,opts){this.mode="upsert";this.row=row;this.opts=opts;return this;}
  async run(single=false){
   if(state.queryFailure===this.table)return {data:null,error:{message:"fixture database failure"}};
   try{
    if(this.mode==="upsert"){
     const keys=Object.keys(this.row);
     await query(`INSERT INTO ${ident(this.table)}(${keys.map(ident)}) VALUES(${keys.map((_,i)=>`$${i+1}`)}) ON CONFLICT(${ident(this.opts.onConflict)}) DO NOTHING`,Object.values(this.row));
     return {data:null,error:null};
    }
    const columns=this.columns==="*"?"*":this.columns.split(",").map(s=>ident(s.trim())).join(",");
    const where=this.filters.length?` WHERE ${this.filters.map(([key],i)=>`${ident(key)}=$${i+1}`).join(" AND ")}`:"";
    const order=this.orders.length?` ORDER BY ${this.orders.join(",")}`:"";
    const page=this.limit===undefined?"":` LIMIT ${this.limit} OFFSET ${this.offset}`;
    const {rows}=await query(`SELECT ${columns} FROM ${ident(this.table)}${where}${order}${page}`,this.filters.map(([,v])=>v));
    return {data:single?(rows[0]??null):rows,error:null};
   }catch(error){return {data:null,error:{message:error.message}};}
  }
  single(){return this.run(true);}
  maybeSingle(){return this.run(true);}
  then(ok,fail){return this.run().then(ok,fail);}
 }
 const supabase={from:table=>new Query(table),rpc:async(name,args)=>{
  try{
   const keys=Object.keys(args);
   const {rows}=await query(`SELECT ${ident(name)}(${keys.map((k,i)=>`${ident(k)}=>$${i+1}`).join(",")}) AS result`,Object.values(args));
   return {data:rows[0].result,error:null};
  }catch(error){return {data:null,error:{message:error.message}};}
 }};
 const stubs=new Map([
  [resolve(root,"frontend/lib/server/supabase.ts"),{supabase}],
  [resolve(root,"frontend/lib/supabase/server.ts"),{createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:state.identity}})}})}],
  [resolve(root,"frontend/lib/server/adapters/kr-market-clock.ts"),{KrMarketClock:class{isMarketOpen(){return state.open;}}}],
  [resolve(root,"frontend/lib/server/adapters/yahoo-market-data-adapter.ts"),{YahooMarketDataAdapter:class{async getQuote(){return state.price===null?null:{price:state.price};}}}],
  [resolve(root,"frontend/lib/server/yahoo-finance.ts"),{getQuote:async()=>state.price===null?null:{price:state.price}}],
 ]);
 const cache=new Map();
 function load(file){
  if(stubs.has(file))return stubs.get(file);
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  const compiled=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const localRequire=name=>{
   if(name.startsWith("@/"))return load(resolve(root,"frontend",`${name.slice(2)}.ts`));
   if(name.startsWith("."))return load(resolve(dirname(file),name.endsWith(".ts")?name:`${name}.ts`));
   assert.ok(["next/server","node:crypto"].includes(name),`unexpected module ${name}`);
   return nativeRequire(name);
  };
  // Host Error makes instanceof Error behavior equivalent across VM boundaries.
  vm.runInNewContext(compiled,{exports,require:localRequire,Error,Date,Number,console,process:{env:{}}},{filename:file});
  return exports;
 }
 const handlers=Object.fromEntries(["account","account/reset","trade","auto-trade/logs"].map(path=>[path,load(resolve(root,"frontend/app/api/mock",path,"route.ts"))]));
 const call=async(path,method="GET",body,search="")=>{
  const req=new NextRequest(`http://isolated.test/api/mock/${path}${search}`,{method,...(body===undefined?{}:{headers:{"content-type":"application/json"},body:JSON.stringify(body)})});
  const response=await handlers[path][method](req);
  return {status:response.status,body:await response.json()};
 };
 const approve=id=>{state.identity={id,app_metadata:{role:"user"},user_metadata:{role:"admin"}};};
 return {db,state,call,approve};
}

test("isolated mock API workflows use real authorization, routes and PostgreSQL RPCs",async t=>{
 const f=await fixture();
 const {db,state,call,approve}=f;
 const order={ticker:"005930",name:"삼성전자",trade_type:"BUY",quantity:2,client_order_id:randomUUID(),account_epoch:0};
 try{
  await t.test("anonymous, pending and rejected identities cannot enter any mock handler",async()=>{
   for(const [role,status] of [[null,401],["pending",403],["rejected",403]]){
    state.identity=role===null?null:{id:userA,app_metadata:{role},user_metadata:{role:"admin"}};
    const before=state.dbCalls;
    for(const [path,method,body] of [["account","GET"],["account","PUT",{cash:1}],["account/reset","POST"],["trade","POST",order],["trade","GET"],["auto-trade/logs","GET"]])
     assert.equal((await call(path,method,body)).status,status,`${role} ${path} ${method}`);
    assert.equal(state.dbCalls,before,"unapproved identities must not access DB");
   }
  });
  await t.test("approved users are isolated and cash adjustments are external capital",async()=>{
   approve(userB);assert.equal((await call("account")).status,200);
   approve(userA);const before=await call("account");assert.equal(before.status,200);
   assert.equal((await call("account","PUT",{user_id:userB,cash:12000000})).status,200);
   const a=await call("account");assert.equal(a.body.cash,12000000);assert.equal(a.body.net_cash_adjustments,2000000);assert.equal(a.body.total_pnl,0);
   const b=(await db.query("SELECT cash FROM mock_accounts WHERE user_id=$1",[userB])).rows[0];assert.equal(b.cash,10000000);
   const forged=await call("account","GET",undefined,`?user_id=${userB}`);assert.equal(forged.body.cash,12000000);
  });
  let receipt;
  await t.test("stable UUID retry returns the original receipt after close and never duplicates",async()=>{
   const estimated=await call("trade","GET",undefined,"?ticker=005930&side=BUY");assert.equal(estimated.status,200);assert.ok(estimated.body.effective_price>1000);
   const result=await call("trade","POST",{...order,user_id:userB});assert.equal(result.status,200);receipt=result.body;
   assert.equal(receipt.quantity,2);assert.equal(receipt.total_amount,receipt.price*2);
   assert.equal((await db.query("SELECT count(*)::int n FROM mock_trades WHERE user_id=$1",[userB])).rows[0].n,0);
   state.open=false;state.price=9000;
   const retried=await call("trade","POST",order);assert.equal(retried.status,200);assert.equal(retried.body.duplicate,true);
   for(const key of ["price","quantity","total_amount","execution_cost"])assert.equal(retried.body[key],receipt[key],key);
   assert.equal((await db.query("SELECT count(*)::int n FROM mock_trades WHERE user_id=$1",[userA])).rows[0].n,1);
   assert.equal((await call("trade","POST",{...order,quantity:3})).status,409);
   state.open=true;state.price=null;
   assert.equal((await call("trade","POST",{...order,client_order_id:randomUUID()})).status,502);
   state.price=1000;
  });
  await t.test("a busy shared lease blocks settings, reset and manual orders without mutation",async()=>{
   const owner=randomUUID();await db.query("SELECT acquire_auto_trade_lease($1,$2)",[userA,owner]);
   const cash=(await call("account")).body.cash;
   assert.equal((await call("account","PUT",{cash:1})).status,409);
   assert.equal((await call("account/reset","POST")).status,409);
   assert.equal((await call("trade","POST",{...order,client_order_id:randomUUID()})).status,409);
   assert.equal((await call("account")).body.cash,cash);
   await db.query("SELECT release_auto_trade_lease($1,$2)",[userA,owner]);
  });
  await t.test("atomic reset advances epoch and fences stale client orders",async()=>{
   const reset=await call("account/reset","POST",{user_id:userB});assert.equal(reset.status,200);assert.equal(reset.body.account_epoch,1);
   const a=await call("account");assert.equal(a.body.cash,10000000);assert.equal(a.body.positions.length,0);assert.equal(a.body.total_pnl,0);assert.equal(a.body.net_cash_adjustments,0);
   assert.equal((await call("trade","POST",order)).status,409);
   const fresh=await call("trade","POST",{...order,account_epoch:1});assert.equal(fresh.status,200);assert.equal(fresh.body.duplicate,false);
   assert.equal((await db.query("SELECT account_epoch FROM mock_accounts WHERE user_id=$1",[userB])).rows[0].account_epoch,0);
  });
  await t.test("logs pagination is user scoped and separates empty, invalid and failed queries",async()=>{
   for(let i=0;i<4;i++)await db.query("INSERT INTO mock_auto_trade_logs(user_id,error) VALUES($1,$2)",[userA,`A-${i}`]);
   await db.query("INSERT INTO mock_auto_trade_logs(user_id,error) VALUES($1,'PRIVATE-B')",[userB]);
   const first=await call("auto-trade/logs","GET",undefined,`?limit=2&offset=0&user_id=${userB}`);
   assert.equal(first.status,200);assert.equal(first.body.items.length,2);assert.equal(first.body.nextOffset,2);
   const second=await call("auto-trade/logs","GET",undefined,"?limit=2&offset=2");assert.equal(second.body.nextOffset,null);
   assert.equal(new Set([...first.body.items,...second.body.items].map(x=>x.id)).size,4);
   assert.ok([...first.body.items,...second.body.items].every(x=>x.error.startsWith("A-")));
   const empty=await call("auto-trade/logs","GET",undefined,"?limit=2&offset=100");assert.equal(empty.status,200);assert.equal(empty.body.items.length,0);
   assert.equal((await call("auto-trade/logs","GET",undefined,"?limit=101")).status,400);
   state.queryFailure="mock_auto_trade_logs";assert.equal((await call("auto-trade/logs")).status,503);state.queryFailure=null;
  });
 }finally{await db.close();}
});
