import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry,SHARED_ACTIVITY_HORIZON_MS,type RegistryParameter} from '../src/market-registry.js';
import {PilotWatch,type WatchRow} from '../src/pilot-watch.js';
import {TOKEN_AGE_POLICY} from '../src/token-age-policy.js';

const AT=Date.parse('2026-11-03T01:05:31Z');
type Internals={db:Database.Database;statement(sql:string):Database.Statement;initializeActivityProjection():void};
const internal=(registry:MarketRegistry)=>registry as unknown as Internals;
function fixture(path=':memory:'){
 const registry=new MarketRegistry(path,{now:()=>AT+1000,concurrentIntake:true}),db=internal(registry).db;
 const watch=new PilotWatch({registry,maximumDeep:4,now:()=>AT+1000,record:()=>{}}),base=watch.discover({signature:'OFFLINE-base',receivedAt:AT-100000})!;
 const seed=(signature:string,mint:string,lastActivityAt:number|null,patch:Partial<WatchRow>={})=>{
  const row:WatchRow={...base,signature,mint,pool:'OFFLINE-pool-'+mint,state:'WATCH',lastActivityAt,firstSeenAt:AT-100000,waitingSince:AT-60000,history:[{at:AT-100000,state:'WATCH',reason:'OFFLINE retained source'}],...patch};registry.put(row);return row;
 };
 const activity=(mint:string,at:number|null,score=1)=>{
  registry.observeIdentity({mint,source:'OFFLINE-shared',kind:'market-identity',at:AT-100000});
  db.prepare('UPDATE market_tokens SET last_activity_at=?,activity_score=?,activity_hints=1,last_signature=?,last_activity_source=? WHERE mint=?').run(at,score,'OFFLINE-last-'+mint,'OFFLINE-shared',mint);
 };
 const venue=(mint:string)=>db.prepare('INSERT OR IGNORE INTO pumpswap_hint_tokens(mint,first_seen_at) VALUES(?,?)').run(mint,AT-1000);
 return {registry,db,watch,base,seed,activity,venue};
}
/** The old query's full eligible alias set, with its formerly ambiguous
 * DISTINCT ordering made explicit: first pending alias in scalar order wins. */
function expectedActivities(db:Database.Database,limit:number,pumpswapOnly=false){
 const rows=db.prepare(`SELECT w.mint,t.last_activity_at at FROM watch_rows w JOIN market_tokens t ON t.mint=w.mint
  WHERE w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED') AND t.last_activity_at>COALESCE(w.last_activity_at,-1)
  ${pumpswapOnly?'AND EXISTS(SELECT 1 FROM pumpswap_hint_tokens swap WHERE swap.mint=w.mint)':''}
  ORDER BY COALESCE(w.last_activity_at,0),w.signature`).all() as {mint:string;at:number}[];
 const seen=new Set<string>(),result:Array<{mint:string;at:number;evidence:'unverified-provider-activity-hint'}>=[];
 for(const row of rows){if(seen.has(row.mint))continue;seen.add(row.mint);result.push({...row,evidence:'unverified-provider-activity-hint'});if(result.length===limit)break;}
 return result;
}
function assertActivities(f:ReturnType<typeof fixture>){for(const scope of [false,true])for(const limit of [1,2,16,10000])assert.deepEqual(f.registry.nextWatchActivities(limit,scope),expectedActivities(f.db,limit,scope));}
function removeProjection(db:Database.Database){
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'watch_activity_%_v1'").all() as {name:string}[]){assert.match(name,/^watch_activity_[a-z_]+_v1$/);db.exec('DROP TRIGGER '+name);}
 db.exec('DROP TABLE watch_activity_pending_v1;DROP INDEX watch_rows_activity_mint_v1');
}
const sourceContents=(db:Database.Database)=>Object.fromEntries(['watch_rows','watch_history','watch_aliases','market_tokens','identity_provenance','pumpswap_hint_tokens','registry_metadata','token_creation_history'].map(table=>[table,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())).digest('hex')]));

test('activity selection preserves every eligible alias and explicitly chooses the oldest pending one per mint',()=>{
 const f=fixture();try{
  f.seed('a-later','a',5);f.seed('a-oldest','a',1);f.seed('b','b',3);f.activity('a',10);f.activity('b',10);
  f.seed('null','null',null);f.activity('null',0);f.seed('zero','zero',0);f.activity('zero',1);
  f.seed('caught-up','caught-up',10);f.activity('caught-up',10);f.seed('future-watch','future-watch',11);f.activity('future-watch',10);
  f.seed('no-activity','no-activity',null);f.activity('no-activity',null);f.seed('no-market','no-market',null);f.db.prepare('DELETE FROM market_tokens WHERE mint=?').run('no-market');
  for(const state of ['HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED'] as const){f.seed(state,state,null,{state});f.activity(state,10);}
  f.seed('archived','archived',null);f.activity('archived',10);f.registry.delete('archived');
  f.seed('expired-still-retained','expired',null,{state:'EXPIRED'});f.activity('expired',1);
  for(const mint of ['a','null','caught-up','HELD'])f.venue(mint);
  assertActivities(f);
  assert.deepEqual(f.registry.nextWatchActivities(100).map(r=>r.mint),['expired','null','zero','a','b']);
  assert.deepEqual(f.registry.nextWatchActivities(100,true).map(r=>r.mint),['null','a']);
  assert.equal(f.registry.nextWatchActivities(100).filter(r=>r.mint==='a').length,1);
  assert.equal(f.registry.nextWatchActivities(100).find(r=>r.mint==='a')?.at,10,'provider timestamp is not replaced by lookup time');
 }finally{f.registry.close();}
});

test('source inserts, updates, removals, alias merges and venue transitions update the same pending predicate atomically',()=>{
 const f=fixture();try{
  f.activity('a',10);const a=f.seed('a','a',1);f.seed('alias','a',2);f.seed('b','b',3);f.activity('b',12);assertActivities(f);
  f.registry.put({...a,lastActivityAt:10});assertActivities(f);assert.equal(f.registry.nextWatchActivities(1)[0]?.mint,'a','pending second alias remains eligible');
  f.registry.mergeWatchAlias('alias','a');assertActivities(f);assert.equal(f.registry.nextWatchActivities(1)[0]?.mint,'b');
  f.registry.put({...a,lastActivityAt:null,state:'HELD'});assertActivities(f);
  f.registry.put({...a,lastActivityAt:null,state:'WATCH'});assertActivities(f);
  f.db.prepare('UPDATE watch_rows SET signature=? WHERE signature=?').run('z-renamed','a');assertActivities(f);
  f.activity('moved',20);f.db.prepare('UPDATE watch_rows SET mint=? WHERE signature=?').run('moved','z-renamed');assertActivities(f);
  f.venue('moved');assertActivities(f);f.db.prepare('UPDATE pumpswap_hint_tokens SET mint=? WHERE mint=?').run('b','moved');assertActivities(f);
  f.db.prepare('DELETE FROM pumpswap_hint_tokens WHERE mint=?').run('b');assertActivities(f);
  f.db.prepare('UPDATE market_tokens SET mint=? WHERE mint=?').run('other','moved');assertActivities(f);
  f.activity('moved',30);assertActivities(f);f.db.prepare('DELETE FROM market_tokens WHERE mint=?').run('moved');assertActivities(f);
  f.activity('moved',40);assertActivities(f);f.db.prepare('DELETE FROM watch_rows WHERE signature=?').run('z-renamed');assertActivities(f);
  const before=f.registry.nextWatchActivities(100),contents=sourceContents(f.db);
  assert.throws(()=>f.registry.transaction(()=>{f.activity('b',100);f.venue('b');f.seed('rollback','rollback',null);f.activity('rollback',200);assertActivities(f);throw Error('OFFLINE_ROLLBACK');}),/OFFLINE_ROLLBACK/);
  assert.deepEqual(f.registry.nextWatchActivities(100),before);assert.deepEqual(sourceContents(f.db),contents);assertActivities(f);
 }finally{f.registry.close();}
});

test('retained histories survive atomic backfill, reopen and a separately committed intake connection',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-activity-projection-')),path=join(directory,'market.sqlite');let f=fixture(path);
 try{
  f.seed('older-alias','a',1);f.seed('newer-alias','a',9);f.seed('b','b',3);f.activity('a',10);f.activity('b',10);f.venue('a');
  const expected=f.registry.nextWatchActivities(100),contents=sourceContents(f.db);removeProjection(f.db);f.registry.close();
  const registry=new MarketRegistry(path,{now:()=>AT+1000,concurrentIntake:true});f={...f,registry,db:internal(registry).db};
  assert.deepEqual(registry.nextWatchActivities(100),expected);assert.deepEqual(sourceContents(f.db),contents,'only derived schema may change during backfill');
  const changes=()=>Number((f.db.prepare('SELECT total_changes() n').get() as {n:number}).n),before=changes();internal(registry).initializeActivityProjection();assert.equal(changes(),before,'reopening an existing projection never replays the universe');
  const worker=new MarketRegistry(path,{now:()=>AT+1000,concurrentIntake:true,writerRole:'intake'});try{
   registry.readTransaction(()=>{assert.deepEqual(registry.nextWatchActivities(100),expected);worker.observeActivity({mint:'a',source:'OFFLINE-worker',kind:'activity',signature:'OFFLINE-new-commit',at:AT,side:'buy',venue:'pump-amm'});assert.deepEqual(registry.nextWatchActivities(100),expected,'one read snapshot cannot mix a new worker commit');});
   assert.equal(registry.nextWatchActivities(100).find(r=>r.mint==='a')?.at,AT,'a committed intake update is visible without an ACK');
  }finally{worker.close();}
  const after=registry.nextWatchActivities(100);registry.close();f.registry=new MarketRegistry(path,{now:()=>AT+1000,concurrentIntake:true});assert.deepEqual(f.registry.nextWatchActivities(100),after,'restart retains pending work without an in-memory identity queue');
 }finally{f.registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('failed initial backfill leaves no committed table marker or maintenance triggers',t=>{
 const f=fixture();try{
  f.seed('pending','pending',null);f.activity('pending',10);const contents=sourceContents(f.db);removeProjection(f.db);
  const exec=f.db.exec.bind(f.db),mock=t.mock.method(f.db,'exec',(sql:string)=>{if(sql.startsWith('INSERT OR IGNORE INTO watch_activity_pending_v1'))throw Error('OFFLINE_BACKFILL_INTERRUPTED');return exec(sql);});
  assert.throws(()=>internal(f.registry).initializeActivityProjection(),/OFFLINE_BACKFILL_INTERRUPTED/);mock.mock.restore();
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='watch_activity_pending_v1' OR type='trigger' AND name LIKE 'watch_activity_%_v1'").get(),undefined);
  assert.deepEqual(sourceContents(f.db),contents);internal(f.registry).initializeActivityProjection();assertActivities(f);
 }finally{f.registry.close();}
});

test('large pending, empty, tail-only and inactive lookups seek only a bounded covering projection',t=>{
 const f=fixture();try{
  f.registry.transaction(()=>{for(let i=0;i<6200;i++){const mint='OFFLINE-large-'+String(i).padStart(5,'0');f.seed(mint,mint,i,{history:Array.from({length:12},(_,n)=>({at:AT-100000+n,state:'WATCH',reason:'OFFLINE retained history '+'.'.repeat(96)}))});f.activity(mint,i);if(i%2===0)f.venue(mint);}});
  const original=internal(f.registry).statement.bind(f.registry),plans:string[][]=[];
  t.mock.method(internal(f.registry),'statement',(sql:string)=>{const statement=original(sql);if(!sql.startsWith('SELECT mint,activity_at at'))return statement;return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='all')return value.bind(target);return (...args:RegistryParameter[])=>{plans.push((f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args) as {detail:string}[]).map(r=>r.detail));return value.apply(target,args);};}});});
  assert.deepEqual(f.registry.nextWatchActivities(16),[]);assert.deepEqual(f.registry.nextWatchActivities(16,true),[]);
  f.activity('OFFLINE-large-06198',AT);assert.equal(f.registry.nextWatchActivities(16)[0]?.mint,'OFFLINE-large-06198');assert.equal(f.registry.nextWatchActivities(16,true)[0]?.mint,'OFFLINE-large-06198');
  f.db.exec('UPDATE market_tokens SET last_activity_at=0');assert.deepEqual(f.registry.nextWatchActivities(16),[]);assert.deepEqual(f.registry.nextWatchActivities(16,true),[]);
  f.db.exec('UPDATE market_tokens SET last_activity_at='+AT);assert.equal(f.registry.nextWatchActivities(16).length,16);assert.equal(f.registry.nextWatchActivities(16,true).length,16);
  assert.equal(plans.length,8);for(const plan of plans){assert.equal(plan.length,1);assert.match(plan[0]!,/USING COVERING INDEX watch_activity_pending_(?:swap_)?order_v1/);assert.ok(!plan[0]!.includes('TEMP B-TREE'));}
  const perMint=f.db.prepare("EXPLAIN QUERY PLAN SELECT w.signature FROM watch_rows w INDEXED BY watch_rows_activity_mint_v1 JOIN market_tokens t ON t.mint=w.mint WHERE w.mint=? AND w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED') AND t.last_activity_at>COALESCE(w.last_activity_at,-1) ORDER BY COALESCE(w.last_activity_at,0),w.signature LIMIT 1").all('OFFLINE-large-06198') as {detail:string}[];
  assert.ok(perMint.some(r=>r.detail.includes('watch_rows_activity_mint_v1 (mint=?)')));assert.ok(perMint.every(r=>!r.detail.startsWith('SCAN ')&&!r.detail.includes('TEMP B-TREE')),'one feed mutation probes only its mint');
 }finally{f.registry.close();}
});

/** Frozen pre-repair query: compare full selected values, not just mint sets. */
function previousObservation(db:Database.Database,at:number,enforceTokenAge24h:boolean,pumpswapOnly:boolean){
 return db.prepare(`WITH hints AS (
  SELECT mint,last_activity_at received_at FROM market_tokens WHERE last_activity_at>=? AND last_activity_at<=? AND activity_hints>0
  UNION SELECT mint,MAX(last_seen_at) received_at FROM identity_provenance WHERE kind='migration' AND last_seen_at>=? AND last_seen_at<=? GROUP BY mint
 ) SELECT t.mint,
  COALESCE((SELECT w.signature FROM watch_rows w WHERE w.archived=0 AND w.mint=t.mint ORDER BY w.first_seen_at,w.signature LIMIT 1),(SELECT w.signature FROM verification_queue q JOIN watch_rows w ON w.signature=q.signature WHERE q.feed_mint=t.mint AND w.archived=0 ORDER BY q.received_at,q.signature LIMIT 1),t.last_signature,'current-pool:'||t.mint) signature,
  hints.received_at receivedAt,t.last_activity_at activityAt,COALESCE(t.last_activity_source,'retained-market-identity') source,t.activity_score priority FROM hints JOIN market_tokens t ON t.mint=hints.mint
  WHERE (t.last_activity_at IS NULL OR t.last_activity_at<=?) ${pumpswapOnly?'AND EXISTS(SELECT 1 FROM pumpswap_hint_tokens swap WHERE swap.mint=t.mint)':''}
  AND NOT EXISTS(SELECT 1 FROM watch_rows w WHERE w.mint=t.mint AND w.archived=0 AND (w.verified_at IS NOT NULL OR json_extract(w.body,'$.observationIdentity.basis')='canonical-pool-hint' OR w.state IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED')))
  AND NOT EXISTS(SELECT 1 FROM distinct_events d WHERE d.kind='native-current-hint-invalid' AND d.key=t.mint)
  ${enforceTokenAge24h?'AND EXISTS(SELECT 1 FROM token_creations c WHERE c.mint=t.mint AND c.created_at<=? AND c.created_at>=? AND c.verified_at<=?)':''}
  ORDER BY t.activity_score DESC,hints.received_at DESC,t.mint LIMIT 1`).get(at-SHARED_ACTIVITY_HORIZON_MS,at,at-SHARED_ACTIVITY_HORIZON_MS,at,at,...(enforceTokenAge24h?[at,at-TOKEN_AGE_POLICY.maximumAgeMs,at]:[]));
}

test('early observation-scope exclusion preserves every boundary, alias fallback and economic ordering value',()=>{
 const f=fixture();let state=0x27984362;const random=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
 try{
  f.registry.transaction(()=>{for(let i=0;i<180;i++){
   const mint='OFFLINE-observe-'+String(i).padStart(4,'0'),times=[AT-SHARED_ACTIVITY_HORIZON_MS-1,AT-SHARED_ACTIVITY_HORIZON_MS,AT-1,AT,AT+1,null],when=times[i%times.length]!;
   f.activity(mint,when,random()%5);if(i%2===0)f.venue(mint);
   if(i%3===0)f.registry.observeIdentity({mint,source:'OFFLINE-migration',kind:'migration',at:AT-(i%4)*1000});
   if(i%4!==0){f.seed('OFFLINE-watch-'+i,mint,null,{state:i%13===0?'HELD':'WATCH',verifiedAt:i%17===0?AT-1000:null,observationIdentity:i%7===0?{basis:'canonical-pool-hint',availableAt:AT-1000,evidence:'OFFLINE scope'}:undefined});if(i%11===0)f.registry.delete('OFFLINE-watch-'+i);}
   if(i%9===0)f.seed('OFFLINE-alias-'+i,mint,null,{firstSeenAt:AT-200000});
   if(i%5===0)f.db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)').run(mint,AT-TOKEN_AGE_POLICY.maximumAgeMs+(i%3-1),i%10===0?AT+1:AT-1,'{}');
   if(i%19===0)f.registry.markDistinct('native-current-hint-invalid',mint,AT);
  }});
  let comparisons=0;
  for(const at of [AT-1,AT,AT+1,AT+SHARED_ACTIVITY_HORIZON_MS])for(const age of [false,true])for(const venue of [false,true]){
   const removed:string[]=[];for(let round=0;round<12;round++){
    const expected=previousObservation(f.db,at,age,venue),actual=f.registry.nextObservationCandidate(at,age,venue);assert.deepEqual(actual,expected);comparisons++;
    if(!actual)break;removed.push(actual.mint);f.registry.markDistinct('native-current-hint-invalid',actual.mint,AT);
   }
   for(const mint of removed)f.db.prepare("DELETE FROM distinct_events WHERE kind='native-current-hint-invalid' AND key=?").run(mint);
  }
  assert.ok(comparisons>=40);
 }finally{f.registry.close();}
});

test('observation hints reject already identified mints through scalar indexes before UNION sorting',t=>{
 const f=fixture();try{
  for(let i=0;i<32;i++){const mint='OFFLINE-known-'+i;f.seed(mint,mint,null,{observationIdentity:{basis:'canonical-pool-hint',availableAt:AT-1000,evidence:'OFFLINE known scope'}});f.activity(mint,AT-1);f.venue(mint);}
  const original=internal(f.registry).statement.bind(f.registry),plans:Array<{sql:string;steps:string[]}>=[];
  t.mock.method(internal(f.registry),'statement',(sql:string)=>{const statement=original(sql);if(!sql.startsWith('WITH hints AS'))return statement;return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return (...args:RegistryParameter[])=>{plans.push({sql,steps:(f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args) as {detail:string}[]).map(r=>r.detail)});return value.apply(target,args);};}});});
  assert.equal(f.registry.nextObservationCandidate(AT,false,true),undefined);const plan=plans[0]!;
  assert.ok(plan.steps.some(r=>r.includes('market_tokens_activity_hints_v1')));assert.ok(plan.steps.filter(r=>r.includes('watch_rows_current_scope_v1')).length>=3);
  assert.ok(!plan.steps.some(r=>r.includes('USING INDEX watch_rows_mint ')),'repeated current-scope checks do not fetch retained JSON bodies');
 }finally{f.registry.close();}
});
