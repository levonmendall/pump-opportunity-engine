import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry,type RegistryMetricSummary,type RegistryParameter} from '../src/market-registry.js';
import {PilotWatch,type WatchRow,type WatchState} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY,OBSERVATION_AGE_POLICY} from '../src/observation-age.js';
import {legacyDurableSnapshot,legacyServiceableBacklog} from './fixtures/native-watch-reporting-before-repair.js';

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

test('grouped population report matches original full-population SQL for all states, policies, ages, missing facts and report page boundaries',()=>{
 for(const policy of [PERSISTENT_OBSERVABLE_MARKET_POLICY,OBSERVATION_AGE_POLICY])for(const tokenAge of [false,true]){
  let at=AT;const registry=new MarketRegistry(':memory:',{now:()=>at}),watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:policy.version,...(tokenAge?{enforceTokenAge24h:true as const}:{}),now:()=>at,record:()=>{}}),internal=watch as any,db=(registry as any).db;
  try {
   const base=watch.discover({signature:'OFFLINE-report-base',receivedAt:AT-86400000})!,states:WatchState[]=['DISCOVERED','VERIFYING','WATCH','DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD','DEFERRED','EXPIRED','PERMANENTLY_UNSUPPORTED'];
   const ages=[-1,0,299999,300000,7199999,7200000,86399999,86400000,86400001];
   registry.transaction(()=>{for(let i=0;i<180;i++){
    const state=states[i%states.length]!,mint=i%13===0?null:'OFFLINE-report-mint-'+i,migrationAt=i%4===0?null:AT-ages[i%ages.length]!,verifiedAt=migrationAt===null?null:Math.max(AT-10000,migrationAt);
    const row:WatchRow={...base,signature:'OFFLINE-report-'+i,mint,pool:mint===null?null:'OFFLINE-report-pool-'+i,migrationAt,verifiedAt,state,firstSeenAt:AT-86400000,waitingSince:AT-(i%11)*1000,deferUntil:AT+(i%7===0?1000:-1000),lastActivityAt:i%3===0?null:AT-i*100,deepSince:['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(state)?AT-2000:null,everHadWindow:i%2===0,lastWindowAt:i%4===0?null:AT-(i%6)*100000};
    if(i%3===0)row.observationIdentity={basis:'canonical-pool-hint',availableAt:AT-5000,evidence:'OFFLINE scalar reporting fixture'};
    if(i%5===0)row.olderResearch={selectedAt:AT-2000,activityAt:AT-1000,evidence:'OFFLINE older research fixture'};
    if(i%6===0)row.capacityCoverage={status:i%12===0?'AWAITING_CAPACITY':'PROBE_READY',reason:'OFFLINE capacity fixture',lostAt:AT-1000,lastDemand:null,reassessAt:AT+1000,probeAdmissions:[]};
    if(i%8===0)row.reobservation={kind:i%16===0?'economic-rejection':'technical-unavailable',decisionAt:AT-1000,windowEndAt:AT-2000,evidence:'OFFLINE reporting gate',minimumEconomicChangeLamports:null,baseline:null,ready:i%24===0?{at:AT-500,reason:'OFFLINE new evidence',evidence:'OFFLINE reporting fixture'}:null};
    registry.put(row);if(mint!==null){if(i%3!==0)db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)').run(mint,AT-ages[(i+3)%ages.length]!,AT+(i%9===0?1:-1000),'{}');if(i%4===0)registry.putOrigin(mint,{fixture:true});}
   }});
   const before=registry.health().transactions.writeCommits;
   for(const delta of [0,1,1001,300001]){at=AT+delta;
    for(const strategy of ['baseline','adaptive-momentum-v2','liquidity-resilient-momentum-v3','liquidity-resilient-momentum-v3.1']as const){
     const expected=internal.readOperation(()=>legacyDurableSnapshot.call(watch,at,strategy)),actual=internal.readOperation(()=>internal.durableSnapshot(at,strategy));assert.deepEqual(actual,expected,`${policy.version} tokenAge=${tokenAge} ${strategy} at+${delta}`);assert.equal(actual.summary.known,181);assert.equal(actual.rows.length,64);assert.equal(actual.summary.projection.complete,false);
    }
    for(const requireOrigin of [false,true])assert.deepEqual(watch.serviceableBacklog(at,{requireOrigin}),legacyServiceableBacklog.call(watch,at,{requireOrigin}),`backlog ${policy.version} tokenAge=${tokenAge} origin=${requireOrigin} at+${delta}`);
   }
   assert.equal(registry.health().transactions.writeCommits,before,'report queries never acquire a financial or market writer');
   const previous=watch.serviceableBacklog(at);registry.put({...base,signature:'OFFLINE-new-row',firstSeenAt:at});assert.equal(watch.serviceableBacklog(at).population.retained,previous.population.retained+1,'the next report includes new rows without caching an older population');
  }finally{registry.close();}
 }
});
