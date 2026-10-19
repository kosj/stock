/** Isolated handler + PostgreSQL integration; never calls production APIs/DB. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import assert from "node:assert/strict";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const nativeRequire=createRequire(import.meta.url);
const {NextRequest}=nativeRequire("next/server");
const userA="00000000-0000-4000-8000-000000000001",userB="00000000-0000-4000-8000-000000000002";
const position={ticker:"005930",name:"삼성전자",quantity:10,avg_price:70000};

test("atomic portfolio import preserves existing rows on every failure",async t=>{
 const db=new PGlite();
 try{
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  const schema=readFileSync(resolve(root,"supabase/schema.sql"),"utf8");
  for(const table of ["portfolios","positions","price_alerts"]){
   const sql=schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));assert.ok(sql,table);await db.exec(sql[0]);
  }
  await db.exec(readFileSync(resolve(root,"supabase/migrations/202610200006_portfolio_import.sql"),"utf8"));
  await db.query("INSERT INTO portfolios(user_id,name) VALUES($1,'A'),($2,'B')",[userA,userB]);
  await db.exec("INSERT INTO positions(portfolio_id,ticker,name,quantity,avg_price) VALUES(1,'OLD','keep me',2,100),(2,'PRIVATE','private B',3,200);");
  await db.exec("INSERT INTO price_alerts(ticker,position_id,alert_type,direction,threshold) SELECT ticker,id,'custom','above',150 FROM positions WHERE portfolio_id=1;");
  const snapshot=async()=>JSON.stringify((await db.query("SELECT to_jsonb(p) AS row FROM positions p ORDER BY id")).rows);
  const before=await snapshot();
  const rpc=async(user,id,rows)=>(await db.query("SELECT replace_portfolio_positions($1,$2,$3::jsonb) AS result",[user,id,JSON.stringify(rows)])).rows[0].result;
  await t.test("owner is checked inside SQL and anonymous callers cannot execute",async()=>{
   await assert.rejects(rpc(userB,1,[position]),/permission_denied/);
   await assert.rejects(rpc(userA,999,[position]),/permission_denied/);
   await db.exec("SET ROLE anon");await assert.rejects(rpc(userA,1,[position]),/permission denied/);await db.exec("RESET ROLE");
   assert.equal(await snapshot(),before);
  });
  await t.test("DB validates complete payload before deletion, including canonical duplicates",async()=>{
   const invalid=[null,{},[null],[position,{...position,ticker:"aapl",name:"one"},{...position,ticker:" AAPL ",name:"two"}],
    [{...position,quantity:0}],[{...position,quantity:1.5}],[{...position,quantity:2147483648}],
    [{...position,quantity:"10"}],[{...position,avg_price:0}],[{...position,avg_price:"Infinity"}],
    [{...position,stop_loss:-1}],[{...position,take_profit:"100"}],[{...position,name:" "}],
    [{...position,ticker:"BAD/INPUT"}],[{...position,user_id:userB}],[{...position,notes:1}],
    [{...position,strategy:"a".repeat(2001)}],Array.from({length:201},(_,i)=>({...position,ticker:`T${i}`}))];
   for(const rows of invalid){await assert.rejects(rpc(userA,1,rows));assert.equal(await snapshot(),before);}
   // A valid first row followed by an invalid last row must not partially replace.
   await assert.rejects(rpc(userA,1,[position,{...position,ticker:"AAPL",avg_price:-1}]));assert.equal(await snapshot(),before);
  });
  await t.test("an insertion failure after DELETE rolls back positions and related alert links",async()=>{
   await db.exec(`CREATE FUNCTION fixture_reject_position() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.name='INJECT-FAIL' THEN RAISE EXCEPTION 'fixture_insert_failure'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER fixture_failure AFTER INSERT ON positions FOR EACH ROW EXECUTE FUNCTION fixture_reject_position();`);
   const alertBefore=JSON.stringify((await db.query("SELECT * FROM price_alerts ORDER BY id")).rows);
   await assert.rejects(rpc(userA,1,[position,{...position,ticker:"AAPL",name:"INJECT-FAIL"}]),/fixture_insert_failure/);
   assert.equal(await snapshot(),before);assert.equal(JSON.stringify((await db.query("SELECT * FROM price_alerts ORDER BY id")).rows),alertBefore);
  });

  let identity={id:userA,app_metadata:{role:"user"}},rpcCalls=0,loseResponseAfterCommit=false;
  const stubs=new Map([
   [resolve(root,"frontend/lib/server/supabase.ts"),{supabase:{rpc:async(name,args)=>{
    assert.equal(name,"replace_portfolio_positions");rpcCalls++;
    try{
     const data=await rpc(args.p_user_id,args.p_portfolio_id,args.p_positions);
     if(loseResponseAfterCommit)throw new Error("fixture_transport_response_lost");
     return {data,error:null};
    }
    catch(error){return {data:null,error:{message:error.message}};}
   }}}],
   [resolve(root,"frontend/lib/supabase/server.ts"),{createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:identity}})}})}],
  ]);
  const cache=new Map();
  function load(file){
   if(stubs.has(file))return stubs.get(file);if(cache.has(file))return cache.get(file);
   const exports={};cache.set(file,exports);
   const js=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   const require=name=>{
    if(name.startsWith("@/"))return load(resolve(root,"frontend",`${name.slice(2)}.ts`));
    if(name.startsWith("."))return load(resolve(dirname(file),`${name}.ts`));
    assert.equal(name,"next/server");return nativeRequire(name);
   };
   vm.runInNewContext(js,{exports,require,Error,TextDecoder,Uint8Array,console},{filename:file});return exports;
  }
  const route=load(resolve(root,"frontend/app/api/portfolio/[id]/positions/replace/route.ts"));
  const post=async(body,id="1",headers={})=>{
   const req=new NextRequest(`http://isolated.test/api/portfolio/${id}/positions/replace`,{method:"POST",headers:{"content-type":"application/json",...headers},body:typeof body==="string"?body:JSON.stringify(body)});
   const res=await route.POST(req,{params:Promise.resolve({id})});return {status:res.status,body:await res.json()};
  };
  await db.exec("GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role; SET ROLE service_role;");
  await t.test("actual route requires approval, valid portfolio ID and bounded complete body",async()=>{
   for(const [role,status] of [[null,401],["pending",403],["rejected",403]]){
    identity=role===null?null:{id:userA,app_metadata:{role},user_metadata:{role:"admin"}};
    assert.equal((await post({positions:[position]})).status,status);
   }
   identity={id:userA,app_metadata:{role:"user"}};
   const count=rpcCalls;
   for(const body of ["{bad",{}, {positions:[position,{...position,quantity:1.5}]},{positions:[position,position]},{positions:[{...position,id:999}]},{positions:Array(201).fill(position)}])
    assert.equal((await post(body)).status,400);
   assert.equal((await post({positions:[position]},"1;delete")).status,400);
   assert.equal((await post({positions:[position]},"9223372036854775808")).status,400);
   assert.equal((await post({positions:[position]},"1",{"content-length":"65537"})).status,413);
   assert.equal((await post({positions:[{...position,notes:"😀".repeat(20000)}]})).status,413);
   assert.equal(rpcCalls,count,"invalid body must not reach SQL transport");assert.equal(await snapshot(),before);
  });
  await t.test("route rejects cross-user ownership and rolls back DB insertion failure",async()=>{
   assert.equal((await post({positions:[position]},"2")).status,403);
   const failed=await post({positions:[position,{...position,ticker:"AAPL",name:"INJECT-FAIL"}]});
   assert.equal(failed.status,503);assert.equal(await snapshot(),before);
  });
  await t.test("successful replacement returns committed canonical rows and optional fields",async()=>{
   const result=await post({positions:[{...position,ticker:" aapl ",name:" Apple ",stop_loss:90,take_profit:150,strategy:"hold",notes:"imported"},position]});
   assert.equal(result.status,200);assert.equal(result.body.positions.length,2);
   const apple=result.body.positions.find(p=>p.ticker==="AAPL");assert.ok(apple.id);assert.equal(apple.portfolio_id,1);assert.equal(apple.name,"Apple");assert.equal(apple.stop_loss,90);assert.equal(apple.notes,"imported");
   const actual=(await db.query("SELECT * FROM positions WHERE portfolio_id=1 ORDER BY id")).rows;
   assert.equal(actual.length,2);assert.deepEqual(result.body.positions.map(p=>p.id),actual.map(p=>p.id));
   assert.equal((await db.query("SELECT ticker FROM positions WHERE portfolio_id=2")).rows[0].ticker,"PRIVATE");
   const cleared=await post({positions:[]});assert.equal(cleared.status,200);assert.equal(cleared.body.positions.length,0);
   assert.equal((await db.query("SELECT count(*)::int n FROM positions WHERE portfolio_id=1")).rows[0].n,0);
  });
  await t.test("a lost response after commit does not promise that old positions were preserved",async()=>{
   loseResponseAfterCommit=true;
   const ambiguous=await post({positions:[{...position,ticker:"COMMITTED"}]});
   assert.equal(ambiguous.status,503);assert.match(ambiguous.body.error,/새로고침/);assert.doesNotMatch(ambiguous.body.error,/기존 포지션은 유지/);
   assert.equal((await db.query("SELECT ticker FROM positions WHERE portfolio_id=1")).rows[0].ticker,"COMMITTED");
  });
 }finally{await db.close();}
});
