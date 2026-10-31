import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry,type RegistryMetricSummary,type RegistryParameter} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const AT=1800000000000;
function fixture(){const registry=new MarketRegistry(':memory:',{now:()=>AT}),watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT,record:()=>{}});return {registry,watch,db:(registry as unknown as {db:{prepare:(sql:string)=>{get:(...args:RegistryParameter[])=>any}}}).db};}
function legacySummary(db:ReturnType<typeof fixture>['db'],query:{expression:string;where:string;params:RegistryParameter[]}):RegistryMetricSummary {
 const source=`SELECT (${query.expression}) value FROM watch_rows w WHERE w.archived=0 AND (${query.where})`,row=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(value),0) sum,AVG(value) mean,MAX(value) max FROM (${source})`).get(...query.params);
 const quantile=(p:number)=>row.count?Number(db.prepare(`SELECT value FROM (${source}) ORDER BY value LIMIT 1 OFFSET ?`).get(...query.params,Math.max(0,Math.ceil(row.count*p)-1)).value):null;
 return {...row,p50:quantile(.5),p95:quantile(.95)};
}

test('single fresh summary preserves exact legacy whole-population values, nulls, bindings and nearest-rank percentiles',()=>{
 const f=fixture();try{
  const base=f.watch.discover({signature:'base',receivedAt:AT})!;
  const values:Array<Array<number|null>>=[[],[null],[3],[-2],Array.from({length:20},()=>null),[null,null,-4,0,5,5,null,1.25],[.1,.2,.3,.4,.5],[10,10,10,11,11,12],Array.from({length:201},(_,i)=>i*1000),Array.from({length:100},(_,i)=>i%3===0?null:i%7-3)];
  for(const [caseIndex,sample]of values.entries()){
   for(let i=0;i<sample.length;i++)f.registry.put({...base,signature:`case-${caseIndex}-${i}`});
   const expression=sample.length?'CASE w.signature '+sample.map((_,i)=>`WHEN 'case-${caseIndex}-${i}' THEN ?`).join(' ')+' ELSE NULL END':'NULL';
   const query={expression,where:'w.signature LIKE ?',params:[...sample,`case-${caseIndex}-%`]};
   assert.deepEqual(f.registry.valueSummary(query),legacySummary(f.db,query),`case${caseIndex}`);
  }
  const query={expression:'?',where:'w.signature=?',params:[1,'case-2-0'] as RegistryParameter[]};assert.equal(f.registry.valueSummary(query).mean,1);query.params[0]=9;assert.equal(f.registry.valueSummary(query).mean,9,'each call must read current bindings, never a cached older report');
  const before=f.registry.health().transactions.writeCommits;f.registry.readTransaction(()=>f.registry.valueSummary(query));assert.equal(f.registry.health().transactions.writeCommits,before);
 }finally{f.registry.close();}
});

test('equivalent eligible and capacity populations share only the same transaction result and keep independent aliases',()=>{
 const f=fixture();try{
  for(const mint of ['first','second']){const signature='origin-'+mint;f.watch.discover({signature,feedMint:mint,receivedAt:AT});f.watch.verify(signature,{mint,pool:'pool-'+mint,migrationAt:AT-600000,verifiedAt:AT});}
  let calls=0;const original=f.registry.valueSummary.bind(f.registry);f.registry.valueSummary=(query)=>{calls++;return original(query);};
  const current=f.watch.serviceableBacklog(AT,{requireOrigin:false});assert.equal(calls,1);assert.equal(current.population.eligibleNow,2);assert.equal(current.population.serviceableNow,2);assert.deepEqual(current.waits.eligibleQueue,current.waits.capacityQueue);assert.notEqual(current.waits.eligibleQueue,current.waits.capacityQueue);
  current.waits.capacityQueue.mean=123;assert.notEqual(current.waits.eligibleQueue.mean,123,'report aliases must not share mutable summaries');
  calls=0;const origins=f.watch.serviceableBacklog(AT,{requireOrigin:true});assert.equal(calls,2,'different origin prerequisites require their own current population');assert.equal(origins.population.eligibleNow,2);assert.equal(origins.population.serviceableNow,0);assert.equal(origins.waits.capacityQueue.count,0);
  f.watch.transition('first','DEFERRED','OFFLINE new prerequisite',AT,{deferUntil:AT+1000});calls=0;const refreshed=f.watch.serviceableBacklog(AT,{requireOrigin:false});assert.equal(calls,1);assert.equal(refreshed.population.eligibleNow,1,'later publications must reflect newly changed prerequisites');assert.equal(refreshed.waits.eligibleQueue.count,1);
 }finally{f.registry.close();}
});
