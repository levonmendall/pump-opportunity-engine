import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry,MarketRegistryContention,SHARED_ACTIVITY_HORIZON_MS,type PumpSwapQualificationHint,type RegistryParameter} from '../src/market-registry.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';
import {TOKEN_CREATION_HISTORY_POLICY} from '../src/token-creation-history.js';
import {PilotWatch} from '../src/pilot-watch.js';

const AT=Date.parse('2026-11-03T01:05:31Z'),DAY=TOKEN_AGE_POLICY.maximumAgeMs;
const mint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58(),signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
const proof=(n:number,createdAt=AT-3600000,availableAt=AT):TokenCreationProof=>({version:TOKEN_AGE_POLICY.version,mint:mint(n),signature:signature(n),slot:n+1,createdAt,availableAt,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)});
type Internals={db:Database.Database;statement(sql:string):Database.Statement};
const internal=(r:MarketRegistry)=>r as unknown as Internals;
function fixture(path=':memory:'){
 const registry=new MarketRegistry(path,{now:()=>AT+1000,concurrentIntake:true}),db=internal(registry).db;
 const hint=(n:number,at=AT,change:Partial<PumpSwapQualificationHint>={})=>registry.observePumpSwapQualificationHint({mint:mint(n),receivedAt:at,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',signature:signature(n+50),...change});
 const prepare=(n:number,at=AT,state:Parameters<MarketRegistry['putObservationPreparation']>[0]['state']='pool-ready')=>registry.putObservationPreparation({mint:mint(n),pool:mint(n+100),checkedAt:at,state,reason:'OFFLINE_QUALIFICATION_ACCOUNT_RESULT'});
 const general=()=>Object.fromEntries(['market_tokens','identity_provenance','watch_rows','watch_history','market_activity_seen','migration_deliveries','verification_queue','market_venue_hints'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
 return {registry,db,hint,prepare,general};
}

test('unknown PumpSwap qualification stores only one minimal identity and never ordinary market observation',()=>{
 const f=fixture();try{
  const before=f.general();assert.equal(f.hint(1),true);
  assert.deepEqual(f.registry.pumpSwapQualificationHint(mint(1)),{mint:mint(1),firstSeenAt:AT,lastSeenAt:AT,source:'pumpapi-broad',kind:'activity',signature:signature(51)});
  assert.equal(f.hint(1),false);assert.equal(f.hint(1,AT-1000),false);
  assert.equal(f.hint(1,AT+1,{source:'pumpportal-migration',kind:'migration',venue:undefined,signature:signature(52)}),true);
  assert.deepEqual(f.registry.pumpSwapQualificationHint(mint(1)),{mint:mint(1),firstSeenAt:AT,lastSeenAt:AT+1,source:'pumpportal-migration',kind:'migration',signature:signature(52)});
  assert.equal(f.registry.nextPumpSwapQualification(AT),undefined,'future receipt cannot be scheduled early');
  assert.equal(f.registry.nextPumpSwapQualification(AT+1)?.mint,mint(1));assert.deepEqual(f.general(),before);
  for(const bad of [{source:'pumpportal-new-token',kind:'creation'},{source:'pumpapi-broad',venue:'pump-fun'},{source:'pumpportal-migration',kind:'activity'},{receivedAt:-1}])assert.throws(()=>f.hint(2,AT,bad as Partial<PumpSwapQualificationHint>),/PUMPSWAP_QUALIFICATION_HINT_INVALID/);
  assert.equal(f.registry.pumpSwapQualificationHint(mint(2)),undefined);assert.deepEqual(f.general(),before);
 }finally{f.registry.close();}
});

test('known actual birth proofs avoid redundant qualification for both young and expired tokens',()=>{
 const f=fixture();try{
  for(const [n,createdAt]of [[1,AT-3600000],[2,AT-DAY-1000]]){f.registry.putTokenCreationProof(proof(n!,createdAt));const before=f.registry.health().transactions.writeCommits;assert.equal(f.hint(n!),false);assert.equal(f.registry.pumpSwapQualificationHint(mint(n!)),undefined);assert.equal(f.registry.health().transactions.writeCommits,before);}
  assert.equal(f.registry.nextPumpSwapQualification(AT),undefined);assert.equal(f.registry.nextTokenCreationHistoryRequest(AT,true),undefined);
 }finally{f.registry.close();}
});

test('birth cache notifications follow only the outer durable commit and carry an immutable exact proof',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-qualification-commit-')),path=join(directory,'market.sqlite'),f=fixture(path),seen:Readonly<TokenCreationProof>[]=[];
 const other=new Database(path);try{
  const remove=f.registry.onTokenCreationProofCommitted(p=>{assert.ok(Object.isFrozen(p));assert.equal((other.prepare('SELECT proof FROM token_creations WHERE mint=?').get(p.mint) as {proof:string}).proof,JSON.stringify(p),'another WAL reader sees the durable row before the cache notification');seen.push(p);});
  const input=proof(1);f.registry.transaction(()=>{f.registry.transaction(()=>f.registry.putTokenCreationProof(input));assert.equal(seen.length,0);input.signature=signature(99);});
  assert.equal(seen.length,1);assert.equal(seen[0]!.signature,signature(1));assert.equal(f.registry.tokenCreationProof(mint(1))!.signature,signature(1));
  f.registry.putTokenCreationProof(proof(1));assert.equal(seen.length,1,'idempotent proof does not send a false new generation');
  assert.throws(()=>f.registry.transaction(()=>{f.registry.putTokenCreationProof(proof(2));throw Error('OFFLINE_ABORT');}),/OFFLINE_ABORT/);assert.equal(seen.length,1);assert.equal(f.registry.tokenCreationProof(mint(2)),null);
  other.exec('BEGIN IMMEDIATE');assert.throws(()=>f.registry.putTokenCreationProof(proof(3)),MarketRegistryContention);assert.equal(seen.length,1);other.exec('ROLLBACK');f.registry.putTokenCreationProof(proof(3));assert.equal(seen.length,2);
  remove();f.registry.putTokenCreationProof(proof(4));assert.equal(seen.length,2);
 }finally{other.close();f.registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('the feed age snapshot validates immutable birth proof and exact inclusive age and availability boundaries',()=>{
 const f=fixture();try{
  for(const p of [proof(1,AT-DAY),proof(2,AT-DAY-1000),proof(3,AT-1000,AT+1),proof(4,AT+1000,AT+1000),proof(5)])f.registry.putTokenCreationProof(p);
  const snapshot=f.registry.tokenCreationScopeSnapshot(AT);assert.ok(Object.isFrozen(snapshot));assert.ok(snapshot.every(Object.isFrozen));assert.deepEqual(snapshot.map(p=>p.mint),[mint(1),mint(5)]);
  assert.deepEqual(snapshot[0],{mint:mint(1),createdAt:AT-DAY,availableAt:AT,expiresAt:AT});
  assert.deepEqual(f.registry.tokenCreationScopeSnapshot(AT,true).map(p=>p.mint),[mint(2),mint(1),mint(5)],'expired actual proofs may fill the negative cache once; future proofs cannot');
  assert.deepEqual(f.registry.tokenCreationScopeSnapshot(AT+1).map(p=>p.mint),[mint(5),mint(3)]);
  f.db.prepare('UPDATE token_creations SET verified_at=? WHERE mint=?').run(AT-1,mint(5));assert.throws(()=>f.registry.tokenCreationScopeSnapshot(AT),/TOKEN_CREATION_STORED_PROOF_INVALID/);
  f.db.prepare('UPDATE token_creations SET verified_at=? WHERE mint=?').run(AT,mint(5));f.db.prepare('UPDATE token_creations SET proof=? WHERE mint=?').run(JSON.stringify({...proof(1),createdAt:AT-DAY,transactionSha256:'not-a-proof'}),mint(1));assert.throws(()=>f.registry.tokenCreationScopeSnapshot(AT),/TOKEN_CREATION_STORED_PROOF_INVALID/);
  assert.throws(()=>f.registry.tokenCreationScopeSnapshot(-1),/TOKEN_CREATION_SCOPE_TIME/);
 }finally{f.registry.close();}
});

test('pending activity starts from the young birth index and excludes unknown, expired, future and other-venue rows',t=>{
 const f=fixture();try{
  const watch=new PilotWatch({registry:f.registry,maximumDeep:4,now:()=>AT,record:()=>{}}),base=watch.discover({signature:'OFFLINE-base',receivedAt:AT-100000})!;
  for(let n=1;n<=6;n++){f.registry.put({...base,signature:'OFFLINE-watch-'+n,mint:mint(n),pool:mint(n+100),state:'WATCH',lastActivityAt:null});f.registry.observeActivity({mint:mint(n),signature:signature(n+50),at:AT,source:'pumpapi-broad',kind:'activity',venue:n===5?'raydium':'pump-amm',side:'buy'});}
  for(const p of [proof(1,AT-DAY),proof(2,AT-DAY-1000),proof(4),proof(5),proof(6,AT-1000,AT+1)])f.registry.putTokenCreationProof(p);
  assert.deepEqual(f.registry.nextWatchActivities(16,true,AT).map(r=>r.mint),[mint(1),mint(4)]);
  assert.deepEqual(f.registry.nextWatchActivities(16,true,AT+1).map(r=>r.mint),[mint(4),mint(6)]);
  assert.deepEqual(f.registry.nextWatchActivities(16,true,AT-1),[]);
  const original=internal(f.registry).statement.bind(f.registry);let plan:string[]=[];
  t.mock.method(internal(f.registry),'statement',(sql:string)=>{const statement=original(sql);if(!sql.startsWith('SELECT pending.mint'))return statement;return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='all')return value.bind(target);return(...args:RegistryParameter[])=>{plan=(f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args) as {detail:string}[]).map(r=>r.detail);return value.apply(target,args);};}});});
  f.registry.nextWatchActivities(16,true,AT);assert.ok(plan.some(p=>p.includes('SEARCH age USING INDEX token_creations_age (created_at>? AND created_at<?)')));assert.ok(plan.some(p=>p.includes('SEARCH pending USING INDEX sqlite_autoindex_watch_activity_pending_v1_1 (mint=?)')));assert.ok(!plan.some(p=>p.includes('watch_rows')));
 }finally{f.registry.close();}
});

test('qualification pool state is transactional and respects new evidence, retry and freshness boundaries',()=>{
 const f=fixture();try{
  f.prepare(1,AT-100000);f.hint(1,AT-1);assert.equal(f.registry.nextPumpSwapQualification(AT)?.mint,mint(1),'an old pre-existing pool check does not qualify new ingress');
  f.prepare(1,AT,'pool-absent');assert.equal(f.registry.nextPumpSwapQualification(AT),undefined);f.hint(1,AT+1);assert.equal(f.registry.nextPumpSwapQualification(AT+1)?.mint,mint(1));
  f.prepare(1,AT+1,'provider-unavailable');f.hint(1,AT+2);assert.equal(f.registry.nextPumpSwapQualification(AT+60000),undefined);assert.equal(f.registry.nextPumpSwapQualification(AT+60001)?.mint,mint(1));
  assert.throws(()=>f.registry.transaction(()=>{f.prepare(1,AT+60001);assert.equal(f.registry.nextPumpSwapQualification(AT+60001),undefined);throw Error('OFFLINE_ROLLBACK');}),/OFFLINE_ROLLBACK/);assert.equal(f.registry.nextPumpSwapQualification(AT+60001)?.mint,mint(1));
  assert.equal(f.registry.nextPumpSwapQualification(AT+60003),undefined,'pool readiness or retry cannot refresh the actual venue receipt');
  f.hint(1,AT+60003);f.prepare(1,AT+60003);assert.equal(f.registry.nextPumpSwapQualification(AT+60003),undefined);assert.equal(f.registry.nextTokenCreationHistoryRequest(AT+60003,true)?.mint,mint(1));
  assert.equal(f.registry.pumpSwapQualificationHint(mint(1))!.firstSeenAt,AT-1);
 }finally{f.registry.close();}
});

test('qualification obtains a finalized birth through history without creating general market activity or watch rows',()=>{
 const f=fixture();try{
  const before=f.general();f.hint(1);f.prepare(1);const request=f.registry.nextTokenCreationHistoryRequest(AT,true)!;assert.ok(request);assert.equal(request.mint,mint(1));assert.equal(f.registry.nextTokenCreationRequest(AT,true,true),undefined);
  f.registry.deferTokenCreationHistory(request,AT,'TOKEN_CREATION_HISTORY_PENDING');assert.equal(f.registry.tokenCreationHistoryPending(request,AT),true);assert.equal(f.registry.tokenCreationHistoryPending({...request,before:'OFFLINE-changed'},AT),false);
  assert.equal(f.registry.applyTokenCreationHistoryPage(request,{kind:'candidate',signature:signature(1),slot:10},AT+1),true);
  assert.equal(f.registry.tokenCreationHistoryPending(request,AT),false);assert.deepEqual(f.general(),before,'the finalized-history hint remains in preliminary qualification');
  const direct=f.registry.nextTokenCreationRequest(AT+1,true,true)!;assert.deepEqual(direct,{mint:mint(1),signature:signature(1)});assert.equal(f.registry.nextTokenCreationHistoryRequest(AT+1,true),undefined);
  f.registry.deferTokenCreationRequest(direct,AT+1,'TOKEN_CREATION_REQUEST_PENDING');assert.equal(f.registry.tokenCreationRequestPending(direct,AT+1),true);assert.equal(f.registry.tokenCreationRequestPending(direct,AT+2),false);
  assert.equal(f.registry.nextTokenCreationRequest(AT+2,true,true),undefined);assert.equal(f.registry.nextTokenCreationHistoryRequest(AT+2,true),undefined,'direct retry cooldown cannot trigger a competing history request');
  f.registry.deferTokenCreationRequest(direct,AT+2,'TOKEN_CREATION_PROOF_INVALID',true);assert.equal(f.registry.advanceTokenCreationHistory(direct,AT+2),true);
  const resumed=f.registry.nextTokenCreationHistoryRequest(AT+2,true)!;assert.ok(resumed);assert.equal(resumed.until,signature(1));assert.equal(resumed.untilSlot,10);
  f.registry.deferTokenCreationHistory(resumed,AT+2,'TOKEN_CREATION_HISTORY_PENDING');assert.equal(f.registry.applyTokenCreationHistoryPage(resumed,{kind:'candidate',signature:signature(2),slot:20},AT+3),true);
  assert.deepEqual(f.registry.nextTokenCreationRequest(AT+3,true,true),{mint:mint(1),signature:signature(2)});assert.deepEqual(f.general(),before);
  f.registry.putTokenCreationProof({...proof(1),signature:signature(2)});assert.equal(f.registry.nextTokenCreationRequest(AT+3,true,true),undefined);assert.equal(f.registry.nextTokenCreationHistoryRequest(AT+3,true),undefined);
  const qualified=f.registry.nextQualifiedPumpSwapIdentity(AT+3)!;assert.equal(qualified.lastSeenAt,AT);assert.equal(qualified.firstSeenAt,AT);assert.deepEqual(f.general(),before,'qualification itself cannot admit activity or a slot');
  assert.throws(()=>f.registry.transaction(()=>{assert.equal(f.registry.markPumpSwapQualificationPromoted(mint(1),AT+3),true);throw Error('OFFLINE_ROLLBACK');}),/OFFLINE_ROLLBACK/);assert.ok(f.registry.nextQualifiedPumpSwapIdentity(AT+3));
  assert.equal(f.registry.markPumpSwapQualificationPromoted(mint(1),AT+3),true);assert.equal(f.registry.nextQualifiedPumpSwapIdentity(AT+3),undefined);assert.equal(f.registry.markPumpSwapQualificationPromoted(mint(1),AT+3),false);
 }finally{f.registry.close();}
});

test('qualification can reuse genuine retained birth hints without any WatchRow, but stale/future hints cannot block history',()=>{
 for(const offset of [-DAY-1,-DAY,0,1]){
  const f=fixture();try{
   f.registry.observeIdentity({mint:mint(1),source:'pumpportal-new-token',kind:'creation',at:AT+offset,signature:signature(1)});const before=f.general();f.hint(1);f.prepare(1);
   const inWindow=offset>=-DAY&&offset<=0;assert.equal(f.registry.nextTokenCreationRequest(AT,true,true)?.mint,inWindow?mint(1):undefined);assert.equal(f.registry.nextTokenCreationHistoryRequest(AT,true)?.mint,inWindow?undefined:mint(1));assert.deepEqual(f.general(),before);
   f.registry.deferTokenCreationRequest({mint:mint(1),signature:signature(1)},AT,'OFFLINE_TERMINAL',true);assert.equal(f.registry.nextTokenCreationHistoryRequest(AT,true)?.mint,mint(1));
  }finally{f.registry.close();}
 }
});

test('identity promotion requires a still-young actual proof and a still-fresh real receipt',()=>{
 const f=fixture();try{
  for(const n of [1,2,3]){f.hint(n);f.prepare(n);}
  f.registry.putTokenCreationProof(proof(1,AT-DAY));f.registry.putTokenCreationProof(proof(2,AT-DAY-1000));f.registry.putTokenCreationProof(proof(3));
  assert.equal(f.registry.nextQualifiedPumpSwapIdentity(AT)?.mint,mint(1));assert.equal(f.registry.markPumpSwapQualificationPromoted(mint(1),AT+1),false);assert.equal(f.registry.markPumpSwapQualificationPromoted(mint(2),AT),false);
  assert.equal(f.registry.nextQualifiedPumpSwapIdentity(AT+1)?.mint,mint(3));assert.equal(f.registry.nextQualifiedPumpSwapIdentity(AT+SHARED_ACTIVITY_HORIZON_MS)?.mint,mint(3));assert.equal(f.registry.nextQualifiedPumpSwapIdentity(AT+SHARED_ACTIVITY_HORIZON_MS+1),undefined);
  assert.equal(f.registry.markPumpSwapQualificationPromoted(mint(3),AT+SHARED_ACTIVITY_HORIZON_MS+1),false);
  assert.equal(f.registry.pumpSwapQualificationHint(mint(3))!.lastSeenAt,AT,'proof verification never becomes a new market receipt');
 }finally{f.registry.close();}
});

test('qualification state and pending history guards survive restart without reconstructing general observation',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-qualification-restart-')),path=join(directory,'market.sqlite');let f=fixture(path);
 try{
  f.hint(1);f.prepare(1);const request=f.registry.nextTokenCreationHistoryRequest(AT,true)!;f.registry.deferTokenCreationHistory(request,AT,'TOKEN_CREATION_HISTORY_PENDING');const before=f.general();f.registry.close();f=fixture(path);
  assert.equal(f.registry.tokenCreationHistoryPending(request,AT),true);assert.equal(f.registry.nextTokenCreationHistoryRequest(AT,true),undefined);assert.equal(f.registry.nextPumpSwapQualification(AT),undefined);assert.deepEqual(f.general(),before);
  assert.equal(f.registry.nextTokenCreationHistoryRequest(AT+TOKEN_CREATION_HISTORY_POLICY.retryMs,true)?.mint,mint(1));assert.equal(f.registry.nextTokenCreationHistoryRequest(AT+TOKEN_CREATION_HISTORY_POLICY.retryMs+1,true),undefined,'retry permission does not make the original receipt younger');
 }finally{f.registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('qualification selectors seek current queue states, never the legacy prepared or WatchRow population',t=>{
 const f=fixture();try{
  const put=f.db.prepare('INSERT INTO observation_preparations(mint,pool,checked_at,state,reason) VALUES(?,?,?,?,?)');f.registry.transaction(()=>{for(let n=0;n<10000;n++)put.run('OFFLINE-retained-'+n,'OFFLINE-pool-'+n,AT-1000,'pool-ready','OFFLINE_LEGACY');});
  f.hint(1);f.hint(2);f.prepare(2);const original=internal(f.registry).statement.bind(f.registry),plans:Array<{sql:string;steps:string[]}>=[];
  t.mock.method(internal(f.registry),'statement',(sql:string)=>{const statement=original(sql);if(!sql.includes('pumpswap_qualification_recent_v1'))return statement;return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return(...args:RegistryParameter[])=>{plans.push({sql,steps:(f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args) as {detail:string}[]).map(r=>r.detail)});return value.apply(target,args);};}});});
  assert.equal(f.registry.nextPumpSwapQualification(AT)?.mint,mint(1));assert.equal(f.registry.nextTokenCreationHistoryRequest(AT,true)?.mint,mint(2));assert.equal(f.registry.nextTokenCreationRequest(AT,true,true),undefined);
  assert.equal(plans.length,3);for(const plan of plans){assert.ok(plan.steps.some(s=>s.includes('SEARCH q USING INDEX pumpswap_qualification_recent_v1 (pool_state=? AND last_seen_at>? AND last_seen_at<?)')));assert.ok(!plan.steps.some(s=>s.includes('SCAN p')||s.includes('watch_rows')||s.includes('market_tokens')));}
  assert.equal((f.db.prepare('SELECT COUNT(*) n FROM observation_preparations').get() as {n:number}).n,10001,'retained evidence remains intact');
 }finally{f.registry.close();}
});
