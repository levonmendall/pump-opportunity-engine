/** Offline continuation/ownership regression. Replayed transaction bytes do
 * not claim a new live finality observation or complete provider coverage. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import Database from 'better-sqlite3';
import {MarketRegistry,MarketRegistryContention} from '../src/market-registry.js';
import {resolvePumpSwapMigrationAge,type PilotMigrationSeed,type PilotMigrationRpc,type PilotMigrationResult} from '../src/pilot-discovery.js';
import {MIGRATION_RECOVERY_CONTINUES,PUMPSWAP_MIGRATION_RECOVERY_POLICY,validPumpSwapMigrationRecovery,type PumpSwapMigrationRecovery} from '../src/pumpswap-migration-recovery.js';
import {decodeMigrationAgeProof,migrationAgeDecision} from '../src/migration-age-policy.js';
import {decodeMigrationIdentity} from '../src/migration-identity.js';

const AT=Date.parse('2026-11-03T15:00:00Z');
const original=JSON.parse(readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').find(line=>JSON.parse(line).kind==='migration-transaction')!).data;
function signature(n:number){const bytes=Buffer.alloc(64,7);bytes.writeUInt32LE(n);return bs58.encode(bytes);}
function fixture(){
 const origin=structuredClone(original);origin.blockTime=AT/1000-120;
 const decoded=decodeMigrationIdentity(origin,{signature:origin.transaction.signatures[0],commitment:'finalized',availableAt:AT});assert.ok(decoded.ok);
 const mint=decoded.identity.baseMint,pool=decoded.identity.pool,seed={signature:signature(900000),feedMint:mint,receivedAt:AT-1};
 const nonOrigin=(sig:string,slot:number,blockTime=origin.blockTime)=>{const tx=structuredClone(origin);tx.transaction.signatures[0]=sig;tx.slot=slot;tx.blockTime=blockTime;tx.meta.innerInstructions=[];return tx;};
 const initial=nonOrigin(seed.signature,origin.slot+3000,origin.blockTime+30);
 const first=Array.from({length:1000},(_,i)=>({signature:signature(10000+i),slot:origin.slot+2000-i,err:null,blockTime:origin.blockTime+10}));
 const originRow={signature:decoded.identity.signature,slot:origin.slot,err:null,blockTime:origin.blockTime};
 let history:(params:any)=>unknown=params=>params.before?[originRow]:first;
 let transaction:(sig:string,commitment:string)=>unknown=(sig)=>sig===seed.signature?initial:sig===originRow.signature?origin:null;
 const calls:Array<{method:string;params:any[]}>=[];
 const rpc:PilotMigrationRpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push({method,params:structuredClone(params)});if(method==='getSignaturesForAddress'){assert.equal(params[0],pool,'only canonical pool history is permitted');return structuredClone(history(params[1])) as T;}assert.equal(method,'getTransaction');return structuredClone(transaction(String(params[0]),(params[1] as any).commitment)) as T;}};
 return {origin,mint,pool,seed,first,originRow,initial,nonOrigin,rpc,calls,setHistory:(fn:typeof history)=>{history=fn;},setTransaction:(fn:typeof transaction)=>{transaction=fn;}};
}
const signal=()=>new AbortController().signal;
function progress(result:PilotMigrationResult):PumpSwapMigrationRecovery{assert.equal(result.ok,false);if(result.ok)throw Error('expected progress');assert.ok(result.recovery,result.reason);return result.recovery;}
function observe(registry:MarketRegistry,seed:PilotMigrationSeed,direct=false){registry.observePumpSwapQualificationHint({mint:seed.feedMint!,signature:seed.signature,receivedAt:seed.receivedAt,source:direct?'pumpportal-migration':'pumpapi-broad',kind:direct?'migration':'activity',...(direct?{}:{venue:'pump-amm' as const})});}
async function turn(registry:MarketRegistry,f:ReturnType<typeof fixture>,at:number){const result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),registry.migrationAgeRecovery(f.seed));if(!result.ok&&result.recovery)assert.equal(registry.commitMigrationAgeRecovery(f.seed,result.recovery,at,result.reason),true);if(result.ok){const proof=decodeMigrationAgeProof(result.proof,at);assert.ok(proof);registry.putMigrationAgeProof(proof);}return result;}

test('busy pool continues beyond 1000 after a database restart and retains the original verified 24-hour boundary',async t=>{
 const f=fixture(),directory=mkdtempSync(join(tmpdir(),'poe-migration-pages-')),path=join(directory,'market.sqlite');let at=AT,r=new MarketRegistry(path,{now:()=>at,migrationAge:true});t.mock.method(Date,'now',()=>at);
 try{
  observe(r,f.seed);const first=await turn(r,f,at),checkpoint=progress(first);assert.equal(checkpoint.phase,'history');assert.deepEqual(checkpoint.before,{signature:f.first.at(-1)!.signature,slot:f.first.at(-1)!.slot});assert.equal(checkpoint.historyPages,1);assert.equal(f.calls.length,2);assert.equal(r.count(),0);assert.equal(r.migrationAgeProof(f.mint),null);
  r.close();at+=10;r=new MarketRegistry(path,{now:()=>at,migrationAge:true});assert.deepEqual(r.migrationAgeRecovery(f.seed),checkpoint);assert.deepEqual(r.nextMigrationAgeRequest(at),f.seed);
  const second=await turn(r,f,at);assert.equal(progress(second).phase,'candidate');assert.equal(f.calls.length,3);assert.equal(f.calls.at(-1)!.params[1].before,checkpoint.before!.signature);assert.equal(r.migrationAgeProof(f.mint),null,'a discovered signature is still not age proof');
  at+=10;const done=await turn(r,f,at);assert.ok(done.ok);assert.equal(done.proof.source,'resumable-canonical-SOL-history');assert.equal(done.proof.initialConfirmed,null,'a discarded seed body is not reconstructed as evidence');assert.equal(done.proof.recovery!.historyPages,2);assert.equal(done.identity.chainBlockTime,f.origin.blockTime);
  assert.deepEqual(f.calls.map(c=>c.method),['getTransaction','getSignaturesForAddress','getSignaturesForAddress','getTransaction','getTransaction']);assert.equal(f.calls.filter(c=>c.method==='getTransaction'&&c.params[0]===f.seed.signature).length,1);assert.equal(r.migrationAgeRecovery(f.seed),null);
  const stored=r.migrationAgeProof(f.mint)!;r.close();at=stored.migrationAt+86_400_000;r=new MarketRegistry(path,{now:()=>at,migrationAge:true});assert.deepEqual(r.migrationAgeProof(f.mint),stored);assert.equal(r.marketAgeEligibility(f.mint,at).allowed,true);assert.equal(r.marketAgeEligibility(f.mint,at+1).allowed,false);assert.equal(r.migrationAgeSummary(at).recovery.checkpoints,0);
 }finally{r.close();rmSync(directory,{recursive:true,force:true});}
});

test('a full final page followed by an empty page retains its oldest genuine origin candidate',async t=>{
 let at=AT;const f=fixture();t.mock.method(Date,'now',()=>at);f.setHistory(params=>params.before?[]:[...f.first.slice(0,999),f.originRow]);
 let result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal());assert.equal(progress(result).phase,'history');at++;result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),progress(result));assert.equal(progress(result).phase,'candidate');at++;result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),progress(result));assert.ok(result.ok);assert.equal(result.identity.signature,f.originRow.signature);
});

test('the retained candidate window is not a permanent origin-search cap',async t=>{
 let at=AT;const f=fixture();t.mock.method(Date,'now',()=>at);
 const earlier=Array.from({length:PUMPSWAP_MIGRATION_RECOVERY_POLICY.retainedCandidates},(_,i)=>({signature:signature(80000+i),slot:f.origin.slot-i-1,blockTime:f.origin.blockTime-1,err:null}));
 f.setHistory(params=>params.until?[f.originRow]:[f.originRow,...earlier]);
 f.setTransaction((sig)=>sig===f.seed.signature?f.initial:sig===f.originRow.signature?f.origin:f.nonOrigin(sig,earlier.find(row=>row.signature===sig)!.slot,f.origin.blockTime-1));
 let result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal());assert.equal(progress(result).candidates.length,8);
 for(let i=0;i<8;i++){at++;result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),progress(result));assert.equal(result.ok,false);}
 const checkpoint=progress(result);assert.equal(checkpoint.phase,'history');assert.equal(checkpoint.candidateReads,8);assert.equal(checkpoint.until!.signature,earlier[0]!.signature);
 at++;result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),checkpoint);assert.equal(f.calls.at(-1)!.params[1].until,earlier[0]!.signature);at++;result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),progress(result));assert.ok(result.ok);assert.equal(result.proof.recovery!.candidateReads,9);assert.equal(result.identity.signature,f.originRow.signature);
});

test('malformed and non-advancing pages cannot move a durable cursor or supply age',async t=>{
 let at=AT;const f=fixture();t.mock.method(Date,'now',()=>at);const saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal()));
 for(const rows of [[f.first.at(-1)],[{...f.originRow,slot:f.first.at(-1)!.slot+1}],[f.originRow,f.originRow],[{...f.originRow,blockTime:AT/1000+1}]]){
  at++;f.setHistory(()=>rows);const result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);assert.equal(result.ok,false);if(result.ok)throw Error('unexpected proof');assert.equal(result.reason,'PILOT_MIGRATION_HISTORY_MALFORMED');assert.deepEqual(progress(result).before,saved.before);assert.equal(progress(result).historyPages,saved.historyPages);assert.equal(progress(result).historyRows,saved.historyRows);
 }
 assert.equal(f.calls.filter(c=>c.method==='getTransaction').length,1);
});

test('provider failure preserves the cursor; independent finality failure preserves confirmed origin bytes and original time',async t=>{
 let at=AT;const f=fixture();t.mock.method(Date,'now',()=>at);let saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal()));
 f.setHistory(()=>{throw Error('RPC_PROVIDER_UNAVAILABLE');});at++;let result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);assert.equal(result.ok,false);if(result.ok)throw Error('unexpected proof');assert.equal(result.reason,'RPC_PROVIDER_UNAVAILABLE');assert.deepEqual(progress(result).before,saved.before);saved=progress(result);
 at++;f.setHistory(()=>[f.originRow]);result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);saved=progress(result);
 at++;f.setTransaction((sig,commitment)=>commitment==='finalized'?null:f.origin);result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);saved=progress(result);assert.equal(saved.phase,'finalized');const confirmed=structuredClone(saved.originConfirmed);assert.equal(saved.originConfirmed!.availableAt,at);
 at+=60_000;const count=f.calls.length;f.setTransaction(()=>f.origin);result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);assert.ok(result.ok);assert.equal(f.calls.length,count+1);assert.equal(f.calls.at(-1)!.params[1].commitment,'finalized');assert.deepEqual(result.proof.originConfirmed,confirmed);const proof=decodeMigrationAgeProof(result.proof,at)!;assert.equal(proof.migrationAt,f.origin.blockTime*1000);assert.equal(proof.availableAt,at);
});

test('tied-slot pagination progresses while a multi-page cursor cycle is refused',async t=>{
 let at=AT;const f=fixture();t.mock.method(Date,'now',()=>at);const pages=[1,2,3].map(n=>Array.from({length:1000},(_,i)=>({signature:signature(n*100000+i),slot:f.origin.slot+1,err:{InstructionError:[0,'Custom']},blockTime:f.origin.blockTime+1})));
 f.setHistory(()=>pages[0]);let saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal()));
 for(const page of pages.slice(1)){at++;f.setHistory(()=>page);saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved));}
 assert.equal(saved.historyPages,3);assert.equal(saved.sameSlotCursors.length,3);at++;f.setHistory(()=>pages[0]);const repeated=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);assert.equal(repeated.ok,false);if(repeated.ok)throw Error('unexpected proof');assert.equal(repeated.reason,'PILOT_MIGRATION_HISTORY_MALFORMED');assert.equal(progress(repeated).historyPages,3);assert.deepEqual(progress(repeated).before,saved.before);
});

test('an initially unavailable genuine migration seed is not discarded from later canonical pool history',async t=>{
 const f=fixture();t.mock.method(Date,'now',()=>AT);f.seed.signature=f.originRow.signature;f.setTransaction(()=>null);f.setHistory(()=>[f.originRow]);const first=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal());assert.equal(progress(first).seedNonOrigin,false);assert.equal(progress(first).candidates[0]!.signature,f.originRow.signature);
 f.setTransaction(()=>f.origin);const done=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),progress(first));assert.ok(done.ok);assert.equal(done.identity.signature,f.originRow.signature);
});

test('history horizon is inclusive, while missing and older history never invent a migration age',async t=>{
 const f=fixture();t.mock.method(Date,'now',()=>AT);f.origin.blockTime=(AT-86_400_000)/1000;f.originRow.blockTime=f.origin.blockTime;f.setHistory(()=>[f.originRow]);let result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal());assert.equal(progress(result).candidates[0]!.signature,f.originRow.signature);result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),progress(result));assert.ok(result.ok);assert.equal(migrationAgeDecision(f.mint,AT,decodeMigrationAgeProof(result.proof,AT)).allowed,true);
 for(const history of [[],[{...f.originRow,blockTime:f.originRow.blockTime-1}]]){f.setHistory(()=>history);const missing=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal());assert.equal(missing.ok,false);if(missing.ok)throw Error('unexpected proof');assert.equal(missing.reason,'PILOT_MIGRATION_ORIGIN_NOT_FOUND_IN_AVAILABLE_HISTORY');assert.equal(progress(missing).candidates.length,0);}
});

test('unavailable candidate bytes do not advance the rejected-signature lower bound, and corrupt cached origin bytes cannot establish proof',async t=>{
 const f=fixture();t.mock.method(Date,'now',()=>AT);f.setHistory(()=>[f.originRow]);let saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal()));f.setTransaction(()=>null);const missing=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);assert.deepEqual(progress(missing).candidates,saved.candidates);assert.equal(progress(missing).until,null);
 f.setTransaction((_sig,commitment)=>commitment==='finalized'?null:f.origin);saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved));saved.originConfirmed!.transaction={not:'migration bytes'};const calls=f.calls.length;const corrupt=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal(),saved);assert.equal(corrupt.ok,false);if(corrupt.ok)throw Error('unexpected proof');assert.equal(corrupt.reason,'PILOT_MIGRATION_RECOVERY_ORIGIN_INVALID');assert.equal(f.calls.length,calls);
});

test('checkpoint CAS rejects stale revisions and direct seed supersession without overwriting proof',async t=>{
 let at=AT;const f=fixture(),r=new MarketRegistry(':memory:',{now:()=>at,migrationAge:true});t.mock.method(Date,'now',()=>at);
 try{
  observe(r,f.seed);const saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal()));assert.equal(validPumpSwapMigrationRecovery(saved,f.seed,at),true);assert.equal(r.commitMigrationAgeRecovery(f.seed,saved,at,MIGRATION_RECOVERY_CONTINUES),true);assert.equal(r.commitMigrationAgeRecovery(f.seed,saved,at,MIGRATION_RECOVERY_CONTINUES),false);
  const changed={...f.seed,signature:f.originRow.signature,receivedAt:++at};observe(r,changed,true);assert.equal(r.isCurrentMigrationAgeRequest(f.seed),false);assert.equal(r.isCurrentMigrationAgeRequest(changed),true);assert.equal(r.migrationAgeRecovery(f.seed),null);assert.equal(r.commitMigrationAgeRecovery(f.seed,{...saved,revision:2,updatedAt:at},at,MIGRATION_RECOVERY_CONTINUES),false);
  const done=await resolvePumpSwapMigrationAge(changed,f.rpc,signal());assert.ok(done.ok);const proof=decodeMigrationAgeProof(done.proof,at)!;r.putMigrationAgeProof(proof);assert.equal(r.commitMigrationAgeRecovery(changed,{...saved,seed:changed,startedAt:at,updatedAt:at},at,MIGRATION_RECOVERY_CONTINUES),false);assert.deepEqual(r.migrationAgeProof(f.mint),proof);
 }finally{r.close();}
});

test('the same signature with a newer direct receipt cannot inherit an old seed cooldown',()=>{
 const f=fixture();let at=AT;const r=new MarketRegistry(':memory:',{now:()=>at,migrationAge:true});try{
  observe(r,f.seed);at++;const direct={...f.seed,receivedAt:at};observe(r,direct,true);r.deferMigrationAgeRequest(f.seed,at,'STALE_OLD_REQUEST');assert.deepEqual(r.nextMigrationAgeRequest(at),direct);assert.equal(r.isCurrentMigrationAgeRequest(f.seed),false);
 }finally{r.close();}
});

test('a verified custom-quote migration cannot open canonical SOL recovery from the hint',async t=>{
 const f=fixture();t.mock.method(Date,'now',()=>AT);const custom=JSON.parse(readFileSync('evidence/overnight-20261027/04-active/observations.ndjson','utf8').trim().split('\n').find(line=>JSON.parse(line).kind==='migration-transaction')!).data;
 f.seed.signature=custom.transaction.signatures[0];f.setTransaction(()=>custom);const result=await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal());assert.deepEqual(result,{ok:false,reason:'PILOT_MIGRATION_CUSTOM_QUOTE_OUTSIDE_SCOPE'});assert.equal(f.calls.length,1);
});

test('old waiting cursors keep a due-time turn ahead of later direct hints and unrelated eligible mints are untouched',async t=>{
 let at=AT;const f=fixture(),r=new MarketRegistry(':memory:',{now:()=>at,migrationAge:true});t.mock.method(Date,'now',()=>at);
 try{
  observe(r,f.seed);const first=await turn(r,f,at);assert.equal(first.ok,false);at+=2;const newer={signature:signature(999998),feedMint:'A4CSsC9DPkKRnbcX3U3zQZnC9oV4JFieu7pu8oFWpump',receivedAt:at};observe(r,newer,true);assert.deepEqual(r.nextMigrationAgeRequest(at),f.seed,'direct does not unconditionally leapfrog an older due cursor');
  r.deferMigrationAgeRequest(f.seed,at,'MIGRATION_AGE_REQUEST_PENDING');assert.deepEqual(r.nextMigrationAgeRequest(at),newer);assert.equal(r.migrationAgeProof(f.mint),null);assert.equal(r.count(),0);
 }finally{r.close();}
});

test('pre-callback writer contention retains a completed page for one later atomic commit without repeating RPC',async t=>{
 let at=AT;const f=fixture(),directory=mkdtempSync(join(tmpdir(),'poe-migration-lease-')),path=join(directory,'market.sqlite'),r=new MarketRegistry(path,{now:()=>at,migrationAge:true,concurrentIntake:true}),other=new Database(path);t.mock.method(Date,'now',()=>at);
 try{
  observe(r,f.seed);const saved=progress(await resolvePumpSwapMigrationAge(f.seed,f.rpc,signal()));other.exec('BEGIN IMMEDIATE');assert.throws(()=>r.commitMigrationAgeRecovery(f.seed,saved,at,MIGRATION_RECOVERY_CONTINUES),MarketRegistryContention);assert.equal(r.migrationAgeRecovery(f.seed),null);other.exec('ROLLBACK');at++;const reads=f.calls.length;assert.equal(r.commitMigrationAgeRecovery(f.seed,saved,at,MIGRATION_RECOVERY_CONTINUES),true);assert.deepEqual(r.migrationAgeRecovery(f.seed),saved);assert.equal(f.calls.length,reads);
 }finally{if(other.inTransaction)other.exec('ROLLBACK');other.close();r.close();rmSync(directory,{recursive:true,force:true});}
});

// These are queue scheduling fixtures, not claims about the full live backlog.
// The compact checkpoint retains its exact original bytes/hash. The two live
// snapshots were taken at different times; replay joins them only synthetically.
const queueRecorded=JSON.parse(readFileSync('test/fixtures/migration-queue-checkpoint.json','utf8'));
const queueAt:number=queueRecorded.queueCapture.at;
const checkpoint=queueRecorded.checkpoint as PumpSwapMigrationRecovery;
const checkpointHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type QueueRow={mint:string;signature:string;received_at:number;direct:number;next_attempt_at:number;attempts:number;last_reason:string};
const queueDb=(r:MarketRegistry)=>(r as unknown as {db:Database.Database}).db;
const queueRow=(r:MarketRegistry,mint:string)=>queueDb(r).prepare('SELECT * FROM pumpswap_migration_requests_v1 WHERE mint=?').get(mint) as QueueRow;
function queueMint(n:number){const bytes=Buffer.alloc(32,3);bytes.writeUInt32LE(n);return bs58.encode(bytes);}
function coldQueue(r:MarketRegistry,n:number,at:number,legacy=true){
 const seed={signature:signature(1000000+n),feedMint:queueMint(1000000+n),receivedAt:at-8*3600000-n};observe(r,seed);
 if(legacy)queueDb(r).prepare('UPDATE pumpswap_migration_requests_v1 SET next_attempt_at=0 WHERE mint=?').run(seed.feedMint);
 return seed;
}
function activity(r:MarketRegistry,seed:PilotMigrationSeed,at:number,withSignature=true){return r.observePumpSwapQualificationHint({mint:seed.feedMint!,...(withSignature?{signature:seed.signature}:{}),receivedAt:at,source:'pumpapi-broad',kind:'activity',venue:'pump-amm'});}
function restoreRecorded(r:MarketRegistry){
 assert.equal(checkpointHash(checkpoint),queueRecorded.cursorCapture.bodySha256);
 assert.equal(Buffer.byteLength(JSON.stringify(checkpoint)),queueRecorded.cursorCapture.bodyBytes);
 assert.equal(validPumpSwapMigrationRecovery(checkpoint,checkpoint.seed,queueAt),true);
 const q=queueRecorded.qualification,s=checkpoint.seed;
 observe(r,{...s,receivedAt:q.firstSeenAt});observe(r,s,true);activity(r,s,q.lastSeenAt);
 r.deferMigrationAgeRequest(s,checkpoint.startedAt,'MIGRATION_AGE_REQUEST_PENDING');
 assert.equal(r.commitMigrationAgeRecovery(s,checkpoint,queueRecorded.request.nextAttemptAt-1,MIGRATION_RECOVERY_CONTINUES),true);
 assert.equal(queueRow(r,s.feedMint!).attempts,queueRecorded.request.attempts);assert.equal(checkpointHash(r.migrationAgeRecovery(s)),queueRecorded.cursorCapture.bodySha256);
}

for(const legacy of [true,false])test('new activity cannot backdate '+(legacy?'a legacy-zero':'an ordinary old')+' request ahead of an already-due saved cursor',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>queueAt,migrationAge:true});try{
  restoreRecorded(r);const head=queueRecorded.queueCapture.head,seed={signature:head.seed.signature,feedMint:head.seed.feedMint,receivedAt:head.seed.receivedAt};observe(r,seed);
  if(legacy)queueDb(r).prepare('UPDATE pumpswap_migration_requests_v1 SET next_attempt_at=0 WHERE mint=?').run(seed.feedMint);
  assert.deepEqual(r.nextMigrationAgeRequest(queueAt),checkpoint.seed);
  const before=queueRow(r,seed.feedMint),priorCommits=r.health().transactions.writeCommits;
  assert.equal(activity(r,seed,head.qualificationLastSeenAt),true);
  assert.equal(queueRow(r,seed.feedMint).next_attempt_at,head.qualificationLastSeenAt);assert.equal(r.health().transactions.writeCommits,priorCommits+1,'re-entry shares the existing receipt transaction');
  assert.deepEqual({...queueRow(r,seed.feedMint),next_attempt_at:before.next_attempt_at},before,'only scheduling time may change');
  assert.deepEqual(r.nextMigrationAgeRequest(queueAt),checkpoint.seed);assert.equal(checkpointHash(r.migrationAgeRecovery(checkpoint.seed)),queueRecorded.cursorCapture.bodySha256);assert.equal(r.migrationAgeProof(seed.feedMint),null);
 }finally{r.close();}
});

test('continuously eligible activity keeps priority at the inclusive one-minute boundary and duplicate/out-of-order receipts cannot move it',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT,migrationAge:true});try{
  const seed=coldQueue(r,10,AT);activity(r,seed,AT-60_000);queueDb(r).prepare('UPDATE pumpswap_migration_requests_v1 SET next_attempt_at=0 WHERE mint=?').run(seed.feedMint);
  activity(r,seed,AT);assert.equal(queueRow(r,seed.feedMint).next_attempt_at,0);
  const before=queueRow(r,seed.feedMint);assert.equal(activity(r,seed,AT),false);assert.equal(activity(r,seed,AT-1),false);assert.deepEqual(queueRow(r,seed.feedMint),before);
  activity(r,seed,AT+1);assert.equal(queueRow(r,seed.feedMint).next_attempt_at,0);assert.equal(r.pumpSwapQualificationHint(seed.feedMint)!.lastSeenAt,AT+1);
  const stale=coldQueue(r,11,AT);activity(r,stale,AT-60_001);queueDb(r).prepare('UPDATE pumpswap_migration_requests_v1 SET next_attempt_at=0 WHERE mint=?').run(stale.feedMint);activity(r,stale,AT);assert.equal(queueRow(r,stale.feedMint).next_attempt_at,AT);
 }finally{r.close();}
});

test('a current direct hint preserves priority through its exact 24-hour boundary without becoming a migration age proof',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT,migrationAge:true});try{
  for(const extra of [0,1]){const seed={signature:signature(9001000+extra),feedMint:queueMint(9001000+extra),receivedAt:AT-86_400_000-extra};observe(r,seed,true);activity(r,seed,AT);
   assert.equal(queueRow(r,seed.feedMint).next_attempt_at,extra?AT:seed.receivedAt);assert.equal(queueRow(r,seed.feedMint).received_at,seed.receivedAt);assert.equal(queueRow(r,seed.feedMint).direct,1);assert.equal(r.migrationAgeProof(seed.feedMint),null);assert.equal(r.marketAgeEligibility(seed.feedMint,AT).allowed,false);
  }
 }finally{r.close();}
});

test('a signature-free fresh activity receipt requeues only the existing immutable request; duplicate signature-free receipts add no write',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT,migrationAge:true});try{
  const seed=coldQueue(r,20,AT),before=queueRow(r,seed.feedMint);assert.equal(activity(r,seed,AT,false),true);
  assert.deepEqual(queueRow(r,seed.feedMint),{...before,next_attempt_at:AT});assert.equal(r.pumpSwapQualificationHint(seed.feedMint)!.signature,null);
  const writes=r.health().transactions.writeCommits,changes=Number((queueDb(r).prepare('SELECT total_changes() n').get() as {n:number}).n);
  assert.equal(activity(r,seed,AT,false),false);assert.equal(activity(r,seed,AT-1,false),false);assert.equal(r.health().transactions.writeCommits,writes);assert.equal(Number((queueDb(r).prepare('SELECT total_changes() n').get() as {n:number}).n),changes);
  const unknown={signature:signature(900999),feedMint:queueMint(900999),receivedAt:AT};activity(r,unknown,AT,false);assert.equal(queueRow(r,unknown.feedMint),undefined,'activity without a seed must not invent a history request');
 }finally{r.close();}
});

test('unchanged request upserts coalesce without losing a new activity receipt or a genuine direct seed upgrade',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT,migrationAge:true});try{
  const seed={signature:signature(9100000),feedMint:queueMint(9100000),receivedAt:AT-1000};observe(r,seed);const original=queueRow(r,seed.feedMint),writes=r.health().transactions.writeCommits;
  observe(r,seed);activity(r,seed,seed.receivedAt-1);assert.equal(r.health().transactions.writeCommits,writes);assert.deepEqual(queueRow(r,seed.feedMint),original);
  const newActivitySignature=signature(9100001);activity(r,{...seed,signature:newActivitySignature},AT);assert.equal(r.pumpSwapQualificationHint(seed.feedMint)!.signature,newActivitySignature);assert.deepEqual(queueRow(r,seed.feedMint),original);
  const direct={...seed,signature:signature(9100002),receivedAt:AT+1};observe(r,direct,true);assert.equal(r.isCurrentMigrationAgeRequest(seed),false);assert.equal(r.isCurrentMigrationAgeRequest(direct),true);assert.equal(queueRow(r,seed.feedMint).next_attempt_at,direct.receivedAt);assert.equal(queueRow(r,seed.feedMint).direct,1);
  const after=queueRow(r,seed.feedMint),commits=r.health().transactions.writeCommits;observe(r,direct,true);activity(r,seed,AT);assert.deepEqual(queueRow(r,seed.feedMint),after);assert.equal(r.health().transactions.writeCommits,commits);
 }finally{r.close();}
});

test('reactivation does not shorten a future retry, create an attempt, change its reason, or bypass caller exclusion',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT,migrationAge:true});try{
  const seed=coldQueue(r,30,AT);r.deferMigrationAgeRequest(seed,AT-1000,'PILOT_MIGRATION_LOOKUP_UNAVAILABLE');const before=queueRow(r,seed.feedMint);
  activity(r,seed,AT);assert.deepEqual(queueRow(r,seed.feedMint),before);assert.equal(r.nextMigrationAgeRequest(AT),undefined);
  assert.deepEqual(r.nextMigrationAgeRequest(before.next_attempt_at),seed);assert.equal(r.nextMigrationAgeRequest(before.next_attempt_at,new Set([seed.feedMint])),undefined);
 }finally{r.close();}
});

test('inactive partial recovery retains exact seed, cursor, revision and original timestamps through re-entry and database restart',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-migration-reentry-')),path=join(directory,'market.sqlite');let r=new MarketRegistry(path,{now:()=>queueAt,migrationAge:true});
 try{
  restoreRecorded(r);const seed=checkpoint.seed;queueDb(r).prepare('UPDATE pumpswap_migration_requests_v1 SET direct=0 WHERE mint=?').run(seed.feedMint!);const before=queueRow(r,seed.feedMint!);
  activity(r,seed,queueAt,false);assert.deepEqual(queueRow(r,seed.feedMint!),{...before,next_attempt_at:queueAt});assert.equal(checkpointHash(r.migrationAgeRecovery(seed)),queueRecorded.cursorCapture.bodySha256);
  r.close();r=new MarketRegistry(path,{now:()=>queueAt,migrationAge:true});assert.deepEqual(r.migrationAgeRecovery(seed),checkpoint);assert.deepEqual(r.nextMigrationAgeRequest(queueAt),seed);assert.equal(r.migrationAgeProof(seed.feedMint!),null);
  assert.equal(r.commitMigrationAgeRecovery(seed,checkpoint,queueAt,MIGRATION_RECOVERY_CONTINUES),false,'re-entry cannot make an old revision current');
  const direct={...seed,signature:signature(990001),receivedAt:queueAt+1};observe(r,direct,true);assert.equal(r.isCurrentMigrationAgeRequest(seed),false);assert.equal(r.migrationAgeRecovery(seed),null);assert.deepEqual(r.nextMigrationAgeRequest(queueAt+1),direct);
 }finally{r.close();rmSync(directory,{recursive:true,force:true});}
});

test('re-entry rank and qualification receipt roll back together if the receipt write fails',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT,migrationAge:true});try{
  const seed=coldQueue(r,40,AT),request=queueRow(r,seed.feedMint),prior=r.pumpSwapQualificationHint(seed.feedMint);
  queueDb(r).exec("CREATE TEMP TRIGGER fixture_receipt_failure BEFORE UPDATE ON pumpswap_qualification_hints_v1 BEGIN SELECT RAISE(ABORT,'FIXTURE_RECEIPT_WRITE_FAILURE'); END");
  assert.throws(()=>activity(r,seed,AT),/FIXTURE_RECEIPT_WRITE_FAILURE/);assert.deepEqual(queueRow(r,seed.feedMint),request);assert.deepEqual(r.pumpSwapQualificationHint(seed.feedMint),prior);
  queueDb(r).exec('DROP TRIGGER fixture_receipt_failure');assert.equal(activity(r,seed,AT),true);assert.equal(queueRow(r,seed.feedMint).next_attempt_at,AT);
 }finally{r.close();}
});

test('writer contention defers the complete activity transition and preserves its recoverable request',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-reentry-contention-')),path=join(directory,'market.sqlite'),r=new MarketRegistry(path,{now:()=>AT,migrationAge:true,concurrentIntake:true}),other=new Database(path);
 try{
  const seed=coldQueue(r,50,AT),before=queueRow(r,seed.feedMint);other.exec('BEGIN IMMEDIATE');assert.throws(()=>activity(r,seed,AT),MarketRegistryContention);assert.deepEqual(queueRow(r,seed.feedMint),before);other.exec('ROLLBACK');
  assert.equal(activity(r,seed,AT),true);assert.equal(queueRow(r,seed.feedMint).next_attempt_at,AT);assert.deepEqual(r.nextMigrationAgeRequest(AT),seed);
 }finally{if(other.inTransaction)other.exec('ROLLBACK');other.close();r.close();rmSync(directory,{recursive:true,force:true});}
});

for(const fullPages of [1,4])test('bounded '+fullPages+'-page recovery interleaves reactivated cold requests and a fresh direct hint without losing its original page',async t=>{
 let at=AT;const f=fixture(),directory=mkdtempSync(join(tmpdir(),'poe-reentry-pages-')),path=join(directory,'market.sqlite');let r=new MarketRegistry(path,{now:()=>at,migrationAge:true});t.mock.method(Date,'now',()=>at);
 try{
  const pages=Array.from({length:fullPages},(_,page)=>Array.from({length:1000},(_,i)=>({signature:signature(2000000+page*1000+i),slot:f.origin.slot+10000-page*1000-i,err:null,blockTime:f.origin.blockTime+10})));
  f.setHistory(params=>{const index=params.before?pages.findIndex(p=>p.at(-1)!.signature===params.before)+1:0;assert.ok(index>=0);return index<pages.length?pages[index]:[f.originRow];});
  const cold=Array.from({length:24},(_,i)=>coldQueue(r,100+i,AT)),fresh={signature:signature(8000001),feedMint:queueMint(8000001),receivedAt:AT+2000};observe(r,f.seed);
  const seenCold=new Set<string>(),targetTurns:number[]=[];let directTurn:number|null=null,proofTurn:number|null=null;
  for(let n=0;n<120;n++){
   at=AT+n*2000;if(n>=1&&n<=cold.length)activity(r,cold[n-1]!,at);if(n===1)observe(r,fresh,true);
   const selected=r.nextMigrationAgeRequest(at);assert.ok(selected);
   r.deferMigrationAgeRequest(selected,at,'MIGRATION_AGE_REQUEST_PENDING');
   if(selected.feedMint===f.mint){
    targetTurns.push(n);const reads=f.calls.length,result=await turn(r,f,at);assert.ok(f.calls.length-reads<=PUMPSWAP_MIGRATION_RECOVERY_POLICY.maximumReadsPerTurn);
    if(result.ok){proofTurn=n;assert.equal(result.proof.recovery!.historyPages,fullPages+1);assert.equal(result.proof.currentPoolSupportVerified,false);assert.equal(result.proof.entryEligibilityVerified,false);assert.equal(r.migrationAgeProof(f.mint)!.migrationAt,f.origin.blockTime*1000);}
    if(n===0){const saved=r.migrationAgeRecovery(f.seed)!;assert.equal(saved.historyRows,1000);r.close();r=new MarketRegistry(path,{now:()=>at,migrationAge:true});assert.deepEqual(r.migrationAgeRecovery(f.seed),saved);}
   }else if(selected.feedMint===fresh.feedMint){directTurn??=n;}else{seenCold.add(selected.feedMint!);}
   if(proofTurn!==null&&directTurn!==null&&seenCold.size===cold.length)break;
  }
  assert.ok(proofTurn!==null);assert.ok(directTurn!==null);assert.equal(seenCold.size,24);assert.equal(targetTurns[1],1,'new activity must not backdate cold work ahead of the existing cursor');assert.ok(directTurn<=4,'bounded continuation may not monopolize a fresh direct hint');assert.ok(proofTurn<24,'reactivated cold stream must not repeatedly overtake this already-waiting work');
  assert.ok(targetTurns.some((n,i)=>i>0&&n-targetTurns[i-1]!>1),'other requests receive real turns between continuation turns');
  assert.equal(f.calls.filter(c=>c.method==='getTransaction'&&c.params[0]===f.seed.signature).length,1);assert.equal(f.calls.filter(c=>c.method==='getSignaturesForAddress').length,fullPages+1);assert.equal(f.calls.at(-2)!.params[1].commitment,'confirmed');assert.equal(f.calls.at(-1)!.params[1].commitment,'finalized');assert.equal(r.migrationAgeRecovery(f.seed),null);assert.ok(r.migrationAgeProof(f.mint));
 }finally{r.close();rmSync(directory,{recursive:true,force:true});}
});
