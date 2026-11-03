import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MarketRegistry,type RegistryParameter} from '../src/market-registry.js';
import {PilotWatch,type WatchRow} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {readWatchRegistrySnapshot,readWatchRegistryBacklog} from '../src/watch-registry-reporting.js';
import {legacyDurableSnapshot,legacyServiceableBacklog} from './fixtures/native-watch-reporting-before-repair.js';

const AT=Date.parse('2026-11-02T04:00:00Z');
const watchFor=(registry:MarketRegistry)=>new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT,record:()=>{}});
type Internals={db:Database.Database;statement(sql:string):Database.Statement};
const internals=(registry:MarketRegistry)=>registry as unknown as Internals;
const contents=(db:Database.Database)=>Object.fromEntries(['market_tokens','watch_rows','watch_history','registry_metadata'].map(table=>[table,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())).digest('hex')]));

test('legacy durable rows and histories survive index construction and reopening byte for byte',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-report-index-upgrade-')),path=join(directory,'market.sqlite');
 let registry=new MarketRegistry(path,{now:()=>AT});
 try {
  const watch=watchFor(registry),base=watch.discover({signature:'legacy-base',feedMint:'legacy-base',receivedAt:AT})!;
  registry.transaction(()=>{for(let i=0;i<96;i++)registry.put({...base,signature:'legacy-'+i,mint:'legacy-mint-'+i,pool:'legacy-pool-'+i,state:i%2?'WATCH':'DEFERRED',migrationAt:i%3?AT-1000:null,verifiedAt:i%3?AT:null,observationIdentity:{basis:'canonical-pool-hint',availableAt:AT,evidence:'retained scalar identity'},history:[{at:AT,state:'WATCH',reason:'original history '+i}]});});
  const db=internals(registry).db;
  db.exec('DROP INDEX watch_rows_report_summary_v1;DROP INDEX watch_rows_report_page_v1;DROP INDEX watch_rows_report_population_v2;DROP INDEX watch_rows_report_entry_age_v2;DROP INDEX watch_rows_report_waiting_v2');
  const before=contents(db),expected=legacyDurableSnapshot.call(watch,AT,'liquidity-resilient-momentum-v3.1');
  registry.close();registry=new MarketRegistry(path,{now:()=>AT});
  assert.deepEqual(contents(internals(registry).db),before,'derived indexes cannot rewrite source rows, history or metadata');
  const reopened=watchFor(registry);
  assert.deepEqual(reopened.snapshot(AT,'liquidity-resilient-momentum-v3.1'),expected);
  assert.equal(registry.health().transactions.writeCommits,0,'opening existing index state does not create a registry data write');
 }finally{registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('large full-population reports preserve exact values and use indexed display order without sorting every retained body',t=>{
 const registry=new MarketRegistry(':memory:',{now:()=>AT}),watch=watchFor(registry);
 try {
  const base=watch.discover({signature:'large-base',feedMint:'large-base',receivedAt:AT})!;
  registry.transaction(()=>{for(let i=0;i<6200;i++)registry.put({...base,signature:'large-'+String(i).padStart(5,'0'),mint:'large-mint-'+i,pool:'large-pool-'+i,state:i%701===0?'HELD':i%17===0?'DEFERRED':'WATCH',migrationAt:i%10?null:AT-600000,verifiedAt:i%10?null:AT-500000,firstSeenAt:AT-86400000,lastActivityAt:AT-(i%200)*1000,waitingSince:AT-10000-i,observationIdentity:i%3?undefined:{basis:'canonical-pool-hint',availableAt:AT-1000,evidence:'OFFLINE report identity'}});});
  const internal=watch as any,expected=internal.readOperation(()=>legacyDurableSnapshot.call(watch,AT,'liquidity-resilient-momentum-v3.1')),expectedBacklog=legacyServiceableBacklog.call(watch,AT);
  const db=internals(registry).db,original=internals(registry).statement.bind(registry),plans:Array<{sql:string;steps:string[]}>=[];
  t.mock.method(internals(registry),'statement',(sql:string)=>{
   const statement=original(sql);if(!sql.includes('INDEXED BY watch_rows_report_'))return statement;
   return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get'&&key!=='all')return value.bind(target);return (...args:RegistryParameter[])=>{plans.push({sql,steps:(db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args) as {detail:string}[]).map(row=>row.detail)});return value.apply(target,args);};}});
  });
  const writesBefore=registry.health().transactions.writeCommits,actual=watch.snapshot(AT,'liquidity-resilient-momentum-v3.1');
  assert.deepEqual(actual,expected);assert.deepEqual(watch.serviceableBacklog(AT),expectedBacklog);
  const checkpoint=watch.export(),scope={observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY,maximumDeep:4};
  assert.deepEqual(readWatchRegistrySnapshot(registry,scope,{counters:checkpoint.counters,entryAgePromotionCount:checkpoint.entryAgePromotionCount??0},AT,'liquidity-resilient-momentum-v3.1'),actual,'detached pure reader preserves exact SQL semantics without constructing or recovering a watch');
  assert.deepEqual(readWatchRegistryBacklog(registry,scope,AT),expectedBacklog);
  assert.equal(actual.summary.known,6201);assert.equal(actual.rows.length,64);assert.ok('projection' in actual.summary);assert.equal(actual.summary.projection.complete,false);
  const page=plans.find(plan=>plan.sql.startsWith('SELECT w.body'));
  assert.ok(page?.steps.some(step=>step.includes('watch_rows_report_page_v1')));
  assert.ok(page?.steps.every(step=>!step.includes('TEMP B-TREE')),'the bounded display page must seek its ordered index, not sort the entire retained population');
  assert.ok(plans.some(plan=>plan.sql.startsWith('WITH sample')&&plan.steps.some(step=>step.includes('watch_rows_report_summary_v1'))));
  assert.equal(registry.health().transactions.writeCommits,writesBefore);
 }finally{registry.close();}
});

test('coverage counts share one current WAL snapshot and ignore orphan or archived origin proofs',t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-report-wal-')),path=join(directory,'market.sqlite');
 const registry=new MarketRegistry(path,{now:()=>AT}),writer=new MarketRegistry(path,{now:()=>AT});
 try {
  writer.observeIdentity({mint:'before',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'});
  writer.putOrigin('not-a-retained-token',{fixture:'orphan must not subtract'});
  writer.recordFeed({source:'pumpportal-new-token',connected:true,at:AT,scope:'CREATION_HINTS'});
  const original=internals(registry).statement.bind(registry);let injected=false;
  t.mock.method(internals(registry),'statement',(sql:string)=>{
   const statement=original(sql);if(!sql.startsWith('SELECT (SELECT COUNT(*) FROM market_tokens)'))return statement;
   return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return (...args:RegistryParameter[])=>{const result=value.apply(target,args);if(!injected){injected=true;writer.observeIdentity({mint:'after',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'});writer.putOrigin('before',{fixture:'newly available'});writer.recordFeed({source:'pumpportal-new-token',connected:false,at:AT,scope:'CREATION_HINTS'});}return result;};}});
  });
  const before=registry.coverageSnapshot(AT);
  assert.equal(before.lifetime.uniqueTokensDiscovered,1);assert.equal(before.active.awaitingOrigin,1);assert.equal(before.feeds[0]?.connected,true);
  const after=registry.coverageSnapshot(AT);
  assert.equal(after.lifetime.uniqueTokensDiscovered,2);assert.equal(after.active.awaitingOrigin,1);assert.equal(after.feeds[0]?.connected,false);
  writer.archiveOrigin('before','OFFLINE unavailable proof');
  assert.equal(registry.coverageSnapshot(AT).active.awaitingOrigin,2);
 }finally{writer.close();registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('indexed report predicates immediately follow committed row changes and rollback with the source row',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>AT}),watch=watchFor(registry);
 try {
  const base=watch.discover({signature:'changing',receivedAt:AT})!,row:WatchRow={...base,mint:'changing-mint',pool:'changing-pool',state:'WATCH',observationIdentity:{basis:'canonical-pool-hint',availableAt:AT-100,evidence:'OFFLINE identity'}};
  registry.put(row);const before=watch.serviceableBacklog(AT);assert.equal(before.population.eligibleNow,1);
  const deferred={...row,deferUntil:AT+1000};
  assert.throws(()=>registry.transaction(()=>{registry.put(deferred);assert.equal(watch.serviceableBacklog(AT).population.eligibleNow,0);throw Error('OFFLINE_ROLLBACK');}),/OFFLINE_ROLLBACK/);
  assert.deepEqual(watch.serviceableBacklog(AT),before,'a rolled-back source row cannot leave a changed report index');
  registry.put(deferred);assert.equal(watch.serviceableBacklog(AT).population.eligibleNow,0);
  assert.equal(watch.serviceableBacklog(AT+1000).population.eligibleNow,1,'current time changes are evaluated on every report');
 }finally{registry.close();}
});

test('narrow population counts preserve every state, null assignment, dormant reason and archived exclusion',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>AT}),watch=watchFor(registry);
 try{
  const base=watch.discover({signature:'population-base',receivedAt:AT})!;
  const states:WatchRow['state'][]=['DISCOVERED','VERIFYING','WATCH','DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD','DEFERRED','EXPIRED','PERMANENTLY_UNSUPPORTED'];
  const rows:WatchRow[]=[base];
  registry.transaction(()=>{
   for(const state of states)for(let i=0;i<8;i++){
    const signature=state+'-'+i,row:WatchRow={...base,signature,mint:signature,pool:signature+'-pool',state,migrationAt:AT-600000,verifiedAt:i&1?AT:null,deepSince:i&2?AT-1000:null,
     ...(i%3?{reobservation:{kind:i%3===1?'economic-rejection':'technical-unavailable',decisionAt:AT-1000,windowEndAt:null,evidence:'OFFLINE population parity',minimumEconomicChangeLamports:null,baseline:null,ready:i&4?{at:AT,reason:'new evidence',evidence:'OFFLINE'}:null}}:{})};
    registry.put(row);rows.push(row);
   }
   registry.put({...rows.at(-1)!,signature:'archived-population'});registry.delete('archived-population');
  });
  const actual=registry.watchReportingPopulation(),expected:Record<string,number>={known:rows.length,watch:0,unverified:0,deep:0,unchangedEconomic:0,unchangedTechnical:0,tracked:0,awaitingDeep:0,deepObserving:0};
  for(const state of states)expected['state_'+state]=rows.filter(row=>row.state===state).length;
  expected.watch=rows.filter(row=>['WATCH','DEFERRED'].includes(row.state)).length;
  expected.unverified=rows.filter(row=>row.verifiedAt===null).length;
  expected.deep=rows.filter(row=>['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(row.state)&&row.deepSince!==null).length;
  expected.deepObserving=rows.filter(row=>['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(row.state)).length;
  expected.tracked=rows.filter(row=>!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state)).length;
  expected.awaitingDeep=rows.filter(row=>['WATCH','DEFERRED'].includes(row.state)&&row.verifiedAt!==null).length;
  expected.unchangedEconomic=rows.filter(row=>['WATCH','DEFERRED'].includes(row.state)&&row.reobservation?.kind==='economic-rejection'&&row.reobservation.ready===null).length;
  expected.unchangedTechnical=rows.filter(row=>['WATCH','DEFERRED'].includes(row.state)&&row.reobservation?.kind==='technical-unavailable'&&row.reobservation.ready===null).length;
  assert.deepEqual(actual,expected);
  const internal=watch as any;
  assert.deepEqual(watch.snapshot(AT,'liquidity-resilient-momentum-v3.1'),internal.readOperation(()=>legacyDurableSnapshot.call(watch,AT,'liquidity-resilient-momentum-v3.1')));
  const db=internals(registry).db,plan=(sql:string)=>(db.prepare('EXPLAIN QUERY PLAN '+sql).all() as {detail:string}[]).map(row=>row.detail);
  assert.ok(plan('SELECT state,COUNT(*),COUNT(verified_at) FROM watch_rows INDEXED BY watch_rows_report_population_v2 WHERE archived=0 GROUP BY state').some(step=>step.includes('COVERING INDEX watch_rows_report_population_v2')));
  assert.ok(plan("SELECT state,last_decision_kind,COUNT(*) FROM watch_rows INDEXED BY watch_rows_report_population_v2 WHERE archived=0 AND state IN ('WATCH','DEFERRED') AND reobserve_ready=0 AND last_decision_kind IN ('economic-rejection','technical-unavailable') GROUP BY state,last_decision_kind").some(step=>step.includes('state=? AND last_decision_kind=? AND reobserve_ready=?')));
 }finally{registry.close();}
});

test('report range indexes preserve migration cohort boundaries and strict creation-age availability',t=>{
 const registry=new MarketRegistry(':memory:',{now:()=>AT+1}),watch=new PilotWatch({registry,maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT+1,record:()=>{}});
 try{
  const base=watch.discover({signature:'range-base',receivedAt:AT-1000})!;
  const put=(id:string,age:number|null,extra:Partial<WatchRow>={})=>registry.put({...base,signature:id,mint:id,pool:id+'-pool',state:'WATCH',migrationAt:age===null?null:AT-age,verifiedAt:age===null?null:AT-1000,...extra});
  const canonical={basis:'canonical-pool-hint' as const,availableAt:AT-1000,evidence:'OFFLINE report range scope'};
  registry.transaction(()=>{
   for(const [id,age] of [['min-before',299999],['min-at',300000],['min-after',300001],['max-before',7199999],['max-at',7200000],['max-after',7200001],['future',-1]] as const)put(id,age);
   put('min-at-second',300000);
   put('canonical-ready',null,{observationIdentity:canonical});put('canonical-unknown',null,{observationIdentity:canonical});put('canonical-old',null,{observationIdentity:canonical});
   put('missing-migration',null,{verifiedAt:AT});put('missing-verification',300000,{verifiedAt:null});put('missing-pool',300000,{pool:null});put('missing-mint',300000,{mint:null});
   put('expired',300000,{state:'EXPIRED'});put('unsupported',300000,{state:'PERMANENTLY_UNSUPPORTED'});put('archived',300000);registry.delete('archived');
   // Reporting fixtures supply the persisted creation/availability columns;
   // proof validation itself is exercised by the token-creation tests.
   const age=internals(registry).db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)');
   for(const [mint,createdAt,availableAt] of [['min-before',AT+1,AT+1],['min-at',AT-86400000,AT],['min-after',AT-86400001,AT],['max-before',AT-1,AT+1],['future',AT-1,AT],['canonical-ready',AT-1,AT],['canonical-old',AT-86400001,AT]] as const)age.run(mint,createdAt,availableAt,'{}');
  });
  const db=internals(registry).db,original=internals(registry).statement.bind(registry),plans:Array<{sql:string;steps:string[]}>=[];
  t.mock.method(internals(registry),'statement',(sql:string)=>{
   const statement=original(sql);if(!sql.includes('INDEXED BY watch_rows_report_entry_age_v2')&&!sql.includes('INDEXED BY watch_rows_report_waiting_v2'))return statement;
   return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get'&&key!=='all')return value.bind(target);return (...args:RegistryParameter[])=>{plans.push({sql,steps:(db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args) as {detail:string}[]).map(row=>row.detail)});return value.apply(target,args);};}});
  });
  const internal=watch as any;
  for(const at of [AT-1,AT,AT+1]){
   const expected=internal.readOperation(()=>legacyDurableSnapshot.call(watch,at,'liquidity-resilient-momentum-v3.1'));
   const actual=watch.snapshot(at,'liquidity-resilient-momentum-v3.1');assert.deepEqual(actual,expected);
   assert.equal(actual.summary.ageCohorts.entryEligible,at===AT-1?3:4,'minimum migration age is inclusive and maximum migration age is exclusive');
   assert.deepEqual(watch.serviceableBacklog(at),legacyServiceableBacklog.call(watch,at));
   if(at===AT)assert.equal(actual.summary.eligibleKnown,2,'24h is inclusive; missing, too-old and future-available creation evidence cannot qualify');
   if(at===AT+1)assert.equal(actual.summary.eligibleKnown,4,'the 24h boundary expires on the next millisecond while newly available evidence becomes usable');
  }
  assert.ok(plans.some(plan=>plan.sql.includes('AS baseline')&&plan.steps.some(step=>step.includes('watch_rows_report_entry_age_v2 (migration_at>? AND migration_at<?)'))));
  assert.ok(plans.some(plan=>plan.sql.includes('AS waiting')&&plan.steps.some(step=>step.includes('watch_rows_report_waiting_v2 (<expr><?)'))));
 }finally{registry.close();}
});
