/** Forward migrations against isolated PostgreSQL/WASM; never production SQL. */
import { PGlite } from '@electric-sql/pglite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const user=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=user(90);
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb);
 CREATE TABLE mock_accounts(user_id uuid UNIQUE,cash float NOT NULL,account_epoch bigint NOT NULL DEFAULT 0,trading_mode text DEFAULT 'mock');
 CREATE TABLE mock_positions(user_id uuid,ticker text,quantity integer);
 CREATE TABLE auto_trade_leases(user_id uuid UNIQUE,owner uuid,expires_at timestamptz);
 CREATE TABLE mock_cash_ledger(user_id uuid,account_epoch bigint,amount float,created_at timestamptz,kind text);
 -- Actual production table has no serial id.
 CREATE TABLE news_sentiment(run_date date,ticker text,sentiment_score float,headline_count integer);
 INSERT INTO news_sentiment VALUES('2026-10-30','005930',0.1,2);
 GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role,anon,authenticated;
 `);
 for(const file of ['20261031000529_mock_performance_and_input_security.sql','20261031000539_mock_risk_scan.sql'])
  await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
 await db.query("INSERT INTO mock_accounts(user_id,cash) VALUES($1,1000)",[user(1)]);
 await db.query("INSERT INTO mock_positions VALUES($1,'005930',2)",[user(1)]);
 await db.query("INSERT INTO auto_trade_leases VALUES($1,$2,clock_timestamp()+interval '10 minutes')",[user(1),owner]);
 return db;
}
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];

test('equity observations verify ownership, epoch, actual inventory and source times atomically',async()=>{
 const db=await fixture();
 try{
  const now=Date.parse(await scalar(db,'SELECT clock_timestamp()::text'));
  const at=offset=>new Date(now+offset).toISOString();
  const marks=(fields={})=>[{ticker:'005930',quantity:2,price:100,traded_at:at(-100000),source:'KIS-minute',...fields}];
  const save=(when,data=marks(),lease=owner,epoch=0,benchmark={price:1000,traded_at:at(-100000)})=>db.query(
   'SELECT record_mock_equity_snapshot($1,$2,$3,$4,$5,$6)',[user(1),lease,epoch,when,JSON.stringify(data),JSON.stringify(benchmark)]);
  await db.exec('SET ROLE service_role');
  await save(at(-90000));
  let row=(await db.query('SELECT * FROM mock_equity_snapshots')).rows[0];
  assert.equal(row.equity,1200);assert.equal(row.cash,1000);assert.equal(row.complete,true);assert.equal(row.benchmark_aligned,true);
  await save(at(-90000),marks({price:999}));
  assert.equal(await scalar(db,'SELECT equity FROM mock_equity_snapshots'),1200,'same observation is immutable');
  await assert.rejects(save(at(-10000),marks(),user(91)),/lease/);
  await assert.rejects(save(at(-10000),marks(),owner,1),/epoch/);
  await assert.rejects(save(at(-10000),marks({quantity:99})),/inventory/);
  await assert.rejects(save(at(-10000),[...marks(),...marks()]),/inventory/);
  await assert.rejects(save(at(-300000)),/invalid_observation/);
  assert.equal(await scalar(db,'SELECT count(*)::int FROM mock_equity_snapshots'),1);
  await save(at(-10000),marks({price:null,traded_at:null}));
  row=(await db.query('SELECT * FROM mock_equity_snapshots ORDER BY observed_at DESC LIMIT 1')).rows[0];
  assert.equal(row.complete,false);assert.equal(row.equity,null);assert.equal(row.benchmark_aligned,false);
  let history=await scalar(db,'SELECT mock_performance_history($1)',[user(1)]);
  assert.equal(history.samples,1);assert.equal(history.last.complete,false);
  await save(at(-5000),marks({price:110,traded_at:at(-6000)}),owner,0,{price:1100,traded_at:at(-6000)});
  history=await scalar(db,'SELECT mock_performance_history($1)',[user(1)]);
  assert.equal(history.samples,2);assert.equal(history.first.equity,1200);assert.equal(history.last.equity,1220);
  assert.equal(await scalar(db,'SELECT mock_performance_history($1)',[user(2)]),null,'no cross-account history');
  await db.exec('RESET ROLE');
  await db.query('UPDATE mock_accounts SET account_epoch=1 WHERE user_id=$1',[user(1)]);
  history=await scalar(db,'SELECT mock_performance_history($1)',[user(1)]);
  assert.equal(history.samples,0);assert.equal(history.first,null);
  assert.equal(await scalar(db,'SELECT count(*)::int FROM mock_equity_snapshots'),3,'old epoch history is preserved');
 }finally{await db.close();}
});

test('snapshots and sentiment inputs deny public roles while preserving service access and data',async()=>{
 const db=await fixture();
 try{
  assert.equal(await scalar(db,"SELECT relrowsecurity FROM pg_class WHERE oid='news_sentiment'::regclass"),true);
  for(const role of ['anon','authenticated']){
   for(const table of ['news_sentiment','mock_equity_snapshots'])
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])
     assert.equal(await scalar(db,'SELECT has_table_privilege($1,$2,$3)',[role,table,privilege]),false);
   assert.equal(await scalar(db,"SELECT has_function_privilege($1,'mock_performance_history(uuid)','EXECUTE')",[role]),false);
   assert.equal(await scalar(db,"SELECT has_function_privilege($1,'list_mock_risk_accounts(uuid,integer)','EXECUTE')",[role]),false);
  }
  assert.equal(await scalar(db,"SELECT has_table_privilege('service_role','news_sentiment','INSERT')"),true);
  await db.exec('SET ROLE service_role');
  assert.equal(await scalar(db,'SELECT count(*)::int FROM news_sentiment'),1);
  assert.equal(await scalar(db,'SELECT sentiment_score FROM news_sentiment'),.1);
 }finally{await db.close();}
});

test('risk account enumeration is read-only, paginated and rechecks current approval and mock mode',async()=>{
 const db=await fixture();
 try{
  for(let n=1;n<=5;n++){
   await db.query('INSERT INTO auth.users VALUES($1,$2)',[user(n),JSON.stringify({role:n===3?'pending':'user'})]);
   if(n!==1)await db.query('INSERT INTO mock_accounts(user_id,cash,trading_mode) VALUES($1,1000,$2)',[user(n),n===4?'real':'mock']);
  }
  let rows=(await db.query('SELECT * FROM list_mock_risk_accounts(NULL,2)')).rows;
  assert.deepEqual(rows.map(x=>x.user_id),[user(1),user(2)]);
  rows=(await db.query('SELECT * FROM list_mock_risk_accounts($1,2)',[user(2)])).rows;
  assert.deepEqual(rows.map(x=>x.user_id),[user(5)]);
  await db.query("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1",[user(5)]);
  assert.equal((await db.query('SELECT * FROM list_mock_risk_accounts($1,2)',[user(2)])).rows.length,0);
  await assert.rejects(db.query('SELECT * FROM list_mock_risk_accounts(NULL,0)'),/invalid_page_size/);
  assert.equal(await scalar(db,'SELECT count(*)::int FROM mock_equity_snapshots'),0);
  assert.equal(await scalar(db,'SELECT sum(cash) FROM mock_accounts'),5000);
 }finally{await db.close();}
});
