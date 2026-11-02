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
  db.exec('DROP INDEX watch_rows_report_summary_v1;DROP INDEX watch_rows_report_page_v1');
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
