import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {NextRequest,NextResponse} from 'next/server.js';

function fixture({batches=[],rows=[],fail=null}={}) {
  const calls=[];
  class Query {
    constructor(table){this.table=table;this.filters=[];this.max=Infinity;}
    select(){return this;}
    eq(k,v){this.filters.push(r=>r[k]===v);return this;}
    gte(k,v){this.filters.push(r=>r[k]>=v);return this;}
    lte(k,v){this.filters.push(r=>r[k]<=v);return this;}
    order(k,{ascending}){this.sort=[k,ascending];return this;}
    limit(n){this.max=n;return this;}
    run(single=false){
      calls.push(this.table);
      if(fail===this.table)return {data:null,error:{message:'private database detail'}};
      let data=(this.table==='recommendation_batches'?batches:rows).filter(r=>this.filters.every(f=>f(r)));
      if(this.sort){const [k,asc]=this.sort;data=[...data].sort((a,b)=>(a[k]<b[k]?-1:a[k]>b[k]?1:0)*(asc?1:-1));}
      data=data.slice(0,this.max);
      return {data:single?(data[0]??null):data,error:null};
    }
    maybeSingle(){return Promise.resolve(this.run(true));}
    then(ok,bad){return Promise.resolve(this.run()).then(ok,bad);}
  }
  const exports={};
  const source=ts.transpileModule(readFileSync('frontend/app/api/recommendations/prophet/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(source,{exports,require:n=>{
    if(n==='next/server')return {NextResponse};
    assert.equal(n,'@/lib/server/supabase');return {supabase:{from:t=>new Query(t)}};
  }});
  return {calls,get:async(query='')=>{
    const res=await exports.GET(new NextRequest(`https://example.test/api/recommendations/prophet${query}`));
    return {status:res.status,body:await res.json()};
  }};
}
const history=Array.from({length:20},(_,i)=>({run_date:'2026-10-16',rank:i+1,ticker:String(i+1).padStart(6,'0'),name:`Stock ${i}`,current_price:1000}));

test('no completed metadata preserves historical display without promotion',async()=>{
 const {get}=fixture({rows:history});const {status,body}=await get();
 assert.equal(status,200);assert.equal(body.rows.length,20);assert.equal(body.status,'legacy_unverified');assert.equal(body.verified_batch,false);assert.equal(body.return_calibrated,false);
});
test('completed batch has priority over newer unverified history',async()=>{
 const {get}=fixture({batches:[{run_date:'2026-10-09'}],rows:[...history,...history.map(r=>({...r,run_date:'2026-10-09'}))]});
 const {body}=await get();assert.equal(body.run_date,'2026-10-09');assert.equal(body.status,'complete');assert.equal(body.verified_batch,true);
});
test('empty database is a normal empty result, not a single-row error',async()=>{
 const {status,body}=await fixture().get();assert.equal(status,200);assert.equal(body.status,'no_complete_batch');assert.deepEqual(body.rows,[]);
});
test('database error does not silently fall back or disclose internal messages',async()=>{
 const f=fixture({rows:history,fail:'recommendation_batches'});const r=await f.get();assert.equal(r.status,503);assert.equal(f.calls.length,1);assert.ok(!JSON.stringify(r).includes('private'));
 for(const batches of [[],[{run_date:'2026-10-16'}]])assert.equal((await fixture({batches,fail:'prophet_recommendations'}).get()).status,503);
});
test('date filter is respected for historical and completed results',async()=>{
 const f=fixture({rows:history});assert.equal((await f.get('?date=2026-10-16')).body.rows.length,20);assert.equal((await f.get('?date=2026-10-15')).body.status,'no_complete_batch');
 for(const date of ['2026-02-30','2026-13-01','bad'])assert.equal((await f.get(`?date=${date}`)).status,400);
});
test('partial, duplicate and invalid-price history is not presented as Top20',async()=>{
 for(const rows of [history.slice(0,19),history.map((r,i)=>({...r,rank:i===19?19:r.rank})),history.map(r=>({...r,ticker:'005930'})),history.map((r,i)=>({...r,current_price:i===0?null:r.current_price}))]){
 const r=await fixture({rows}).get();assert.equal(r.body.status,'incomplete_batch');assert.deepEqual(r.body.rows,[]);
 }
});
