import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {performance} from 'node:perf_hooks';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry,type RegistryParameter} from '../src/market-registry.js';
import {PilotWatch,type WatchRow} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const AT=Date.parse('2026-11-03T15:00:00Z'),DAY=86400000;
type Internals={db:Database.Database;statement(sql:string):Database.Statement};
const internal=(registry:MarketRegistry)=>registry as unknown as Internals;
function fixture(path=':memory:'){
 const registry=new MarketRegistry(path,{now:()=>AT+1,migrationAge:true}),db=internal(registry).db;
 const watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,enforceTokenAge24h:true,pumpswapOnly:true,now:()=>AT+1,record:()=>{}}),base=watch.discover({signature:'OFFLINE-base',receivedAt:AT-100000})!;
 const put=(signature:string,patch:Partial<WatchRow>={})=>{const row:WatchRow={...base,signature,mint:'mint-'+signature,pool:'pool-'+signature,state:'DEFERRED',migrationAt:AT-300000,verifiedAt:AT-100000,reobservation:{kind:'technical-unavailable',decisionAt:AT-1000,windowEndAt:null,evidence:'OFFLINE unavailable pool',minimumEconomicChangeLamports:null,baseline:null,ready:null},...patch};registry.put(row);return row;};
 const evidence=(row:WatchRow,at=AT,source='OFFLINE-pool')=>registry.observeIdentity({mint:row.mint!,pool:row.pool!,at,source,kind:'market-identity',signature:'receipt-'+row.signature});
 const age=(row:WatchRow,migratedAt=AT-300000,verifiedAt=AT-100000)=>db.prepare('INSERT INTO pumpswap_migration_ages_v1 VALUES(?,?,?,?)').run(row.mint,migratedAt,verifiedAt,'{}');
 return {registry,db,watch,put,evidence,age};
}
/** Frozen original predicate, including alias ordering and strict first-receipt
 * semantics. Age qualification is a separate existing upstream requirement. */
function previous(db:Database.Database,at:number,limit=16,qualifiedAge=false){
 return db.prepare(`SELECT w.mint FROM watch_rows w WHERE w.archived=0 AND w.state IN ('WATCH','DEFERRED') AND w.reobserve_ready=0 AND w.last_decision_kind='technical-unavailable' AND json_extract(w.body,'$.reobservation.windowEndAt') IS NULL AND w.mint IS NOT NULL AND w.pool IS NOT NULL AND (EXISTS(SELECT 1 FROM identity_provenance p WHERE p.mint=w.mint AND p.pool=w.pool AND p.first_seen_at>w.last_decision_at AND p.first_seen_at<=?) OR EXISTS(SELECT 1 FROM market_activity_seen a WHERE a.mint=w.mint AND a.pool=w.pool AND a.first_seen_at>w.last_decision_at AND a.first_seen_at<=?)) ${qualifiedAge?'AND EXISTS(SELECT 1 FROM pumpswap_migration_ages_v1 age WHERE age.mint=w.mint AND age.migrated_at>=? AND age.migrated_at<=? AND age.verified_at<=?)':''} ORDER BY w.last_decision_at,w.signature LIMIT ?`).all(at,at,...(qualifiedAge?[at-DAY,at-60000,at]:[]),limit);
}

test('pool progress preserves exact dormant predicates, alias order and original receipt timestamps',()=>{
 const f=fixture();try{
  const rows=['a','b','c','d','e','f','g','h','i'].map(name=>f.put(name));
  f.evidence(rows[0]!,AT-1000);f.evidence(rows[0]!,AT,'OFFLINE-pool'); // Replay changes last_seen only.
  f.evidence(rows[1]!,AT-999);f.evidence(rows[2]!,AT);f.evidence(rows[3]!,AT+1);
  f.registry.observeIdentity({mint:rows[4]!.mint!,pool:'other-pool',at:AT,source:'OFFLINE-other',kind:'market-identity'});
  f.db.prepare('INSERT INTO market_activity_seen(mint,signature,side,first_seen_at,pool) VALUES(?,?,?,?,?)').run(rows[5]!.mint,'activity','buy',AT,rows[5]!.pool);
  f.put('g',{reobservation:{...rows[6]!.reobservation!,windowEndAt:AT-1000}});f.evidence(rows[6]!);
  f.put('h',{reobservation:{...rows[7]!.reobservation!,kind:'economic-rejection'}});f.evidence(rows[7]!);
  f.evidence(rows[8]!);f.registry.delete(rows[8]!.signature);
  for(const state of ['HELD','ENTRY_PENDING','DEEP_OBSERVATION','QUALIFIED','EXPIRED','PERMANENTLY_UNSUPPORTED'] as const){const r=f.put(state,{state});f.evidence(r);}
  const alias=f.put('alias',{mint:rows[1]!.mint,pool:rows[1]!.pool});f.evidence(alias);
  for(const at of [AT-1000,AT-999,AT,AT+1])for(const limit of [1,2,16,100])assert.deepEqual(f.registry.nextPoolSourceProgress(at,limit),previous(f.db,at,limit));
  assert.deepEqual(f.registry.nextPoolSourceProgress(AT).map(row=>row.mint),[rows[1]!.mint,rows[1]!.mint,rows[2]!.mint,rows[5]!.mint]);
 }finally{f.registry.close();}
});

test('qualified progress includes exact one-minute and 24-hour migration boundaries and waits for proof availability',()=>{
 const f=fixture();try{
  for(const [name,age,verified] of [['young',59999,AT],['minimum',60000,AT],['middle',300000,AT],['maximum',DAY,AT],['old',DAY+1,AT],['future-proof',300000,AT+1],['unknown',null,AT]] as const){const row=f.put(name);f.evidence(row);if(age!==null)f.age(row,AT-age,verified);}
  for(const at of [AT-1,AT,AT+1])for(const limit of [1,2,16])assert.deepEqual(f.registry.nextPoolSourceProgress(at,limit,true),previous(f.db,at,limit,true));
  assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true).map(r=>r.mint),['mint-maximum','mint-middle','mint-minimum']);
  assert.equal(f.registry.nextPoolSourceProgress(AT).length,7,'legacy unqualified callers retain the complete scope');
 }finally{f.registry.close();}
});

test('progress index follows rollback and separate WAL commits without a stale in-memory readiness cache',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-pool-progress-')),path=join(dir,'market.sqlite'),f=fixture(path),writer=new MarketRegistry(path,{now:()=>AT+1,migrationAge:true});
 try{
  const row=f.put('current');f.age(row);assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true),[]);
  f.registry.readTransaction(()=>{assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true),[]);writer.observeIdentity({mint:row.mint!,pool:row.pool!,at:AT,source:'OFFLINE-worker',kind:'market-identity'});assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true),[]);});
  assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true),[{mint:row.mint}]);
  assert.throws(()=>f.registry.transaction(()=>{f.registry.put({...row,state:'HELD'});assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true),[]);throw Error('OFFLINE_ROLLBACK');}),/OFFLINE_ROLLBACK/);
  assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true),[{mint:row.mint}]);
 }finally{writer.close();f.registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('10k retained histories do not enter qualified per-turn progress or block current full-population reports',t=>{
 const f=fixture();try{
  f.registry.transaction(()=>{for(let i=0;i<10000;i++)f.put('retained-'+String(i).padStart(5,'0'),{migrationAt:AT-3*DAY,history:Array.from({length:16},(_,n)=>({at:AT-2*DAY+n,state:'DEFERRED',reason:'OFFLINE historical detail '+'.'.repeat(200)}))});});
  const tail=f.put('zz-current');f.age(tail);f.evidence(tail);
  const original=internal(f.registry).statement.bind(f.registry),plans:string[][]=[];
  t.mock.method(internal(f.registry),'statement',(sql:string)=>{const statement=original(sql);if(!sql.startsWith('SELECT w.mint FROM '))return statement;return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='all')return value.bind(target);return (...args:RegistryParameter[])=>{plans.push((f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args) as {detail:string}[]).map(row=>row.detail));return value.apply(target,args);};}});});
  assert.deepEqual(f.registry.nextPoolSourceProgress(AT,16,true),[{mint:tail.mint}]);
  assert.ok(plans[0]!.some(row=>row.includes('pumpswap_migration_ages_time_v1 (migrated_at>? AND migrated_at<?)')));
  assert.ok(plans[0]!.some(row=>row.includes('watch_rows_pool_progress_v1 (mint=?)')));
  assert.ok(plans[0]!.every(row=>!/^SCAN w\b/.test(row)),'retained watch histories cannot be a scan input');
  const before=f.registry.health().transactions.writeCommits,measured:number[]=[];
  for(let i=0;i<3;i++){const start=performance.now();f.registry.readTransaction(()=>{const snapshot=f.watch.snapshot(AT,'liquidity-resilient-momentum-v3.1'),backlog=f.watch.serviceableBacklog(AT),coverage=f.registry.coverageSnapshot(AT);assert.equal(snapshot.summary.known,10002);assert.equal(snapshot.rows.length,64);assert.equal(backlog.population.retained,10002);assert.equal(coverage.lifetime.uniqueTokensDiscovered,10001);f.registry.nextPoolSourceProgress(AT,16,true);});measured.push(performance.now()-start);}
  assert.equal(f.registry.health().transactions.writeCommits,before);
  t.diagnostic('10k retained rows: current watch/backlog/coverage publication plus qualified progress, ms '+measured.map(n=>n.toFixed(2)).join(', '));
 }finally{f.registry.close();}
});
