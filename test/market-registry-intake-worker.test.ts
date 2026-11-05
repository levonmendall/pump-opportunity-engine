import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {MarketRegistry,isMarketRegistryContention} from '../src/market-registry.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import {NativeMarketIntakeSpool} from '../src/native-market-intake-spool.js';
import {MIGRATION_AGE_POLICY} from '../src/migration-age-policy.js';
import {canonicalObservationPool} from '../src/native-observation-identity.js';
const makeWorker=(path:string,writerTurn?:SharedArrayBuffer,maximumComputeMs=10,scope:{enforceTokenAge24h?:true;enforceMigrationAge?:true;testClock?:SharedArrayBuffer}={})=>{
 const code=`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();const {startMarketRegistryIntakeWorker}=await import(${JSON.stringify(new URL('../src/market-registry-intake-worker.ts',import.meta.url).href)});const {workerData}=await import('node:worker_threads');if(workerData.testClock){const clock=new BigInt64Array(workerData.testClock);Date.now=()=>Number(Atomics.load(clock,0));}startMarketRegistryIntakeWorker(workerData);`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{path,maximumComputeMs,pendingBytesBudget:1024*1024,writerYieldMs:3,...(writerTurn?{writerTurn}:{}),...scope}});const messages:any[]=[];let fatal:unknown;worker.on('message',m=>messages.push(m));worker.on('error',e=>{fatal=e;});
 const until=(predicate:()=>boolean,label='condition')=>new Promise<void>((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(fatal||Date.now()-start>5000){clearInterval(timer);reject(fatal??Error('worker timeout: '+label+' '+JSON.stringify({lastKind:messages.at(-1)?.kind,lastStats:messages.at(-1)?.stats,acknowledged:messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)})));}else if(predicate()){clearInterval(timer);resolve();}},2);});
 return {worker,messages,until};
};

test('concurrent main market transactions refuse before callback and preserve healthy storage on ordinary contention',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-concurrent-'));const path=join(dir,'market-registry.sqlite');const main=new MarketRegistry(path,{concurrentIntake:true});const lock=new Database(path);try{
  lock.exec('BEGIN IMMEDIATE');let ran=false;assert.throws(()=>main.transaction(()=>{ran=true;main.observeIdentity({mint:'must-not-run',receivedAt:Date.now(),source:'pumpportal-new-token',kind:'creation'});}),isMarketRegistryContention);assert.equal(ran,false);assert.equal(main.health().available,true);assert.equal(main.health().storageFailures,0);assert.equal(main.health().transactions.contentionBeforeCallback,1);
  lock.exec('ROLLBACK');main.observeIdentity({mint:'committed',receivedAt:Date.now(),source:'pumpportal-new-token',kind:'creation'});assert.equal(main.coverageSnapshot(Date.now()).lifetime.uniqueTokensDiscovered,1);
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('real worker batches normalized intake, ACKs only committed rows, tolerates writer contention and drains on stop',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-worker-'));const path=join(dir,'market-registry.sqlite');const main=new MarketRegistry(path,{concurrentIntake:true});const lock=new Database(path);const w=makeWorker(path);try{
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));lock.exec('BEGIN IMMEDIATE');const at=Date.now();
  for(let i=0;i<100;i++)w.worker.postMessage({kind:'intake',id:i,operation:'activity',value:{mint:'worker-mint-'+i,signature:'worker-signature-'+i,receivedAt:at,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000000000',evidence:'unverified-provider-activity-hint'}});
  await new Promise(resolve=>setTimeout(resolve,45));assert.equal(w.messages.filter(m=>m.kind==='committed').length,0,'FULL commit cannot ACK while another writer owns WAL lease');lock.exec('ROLLBACK');
  await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===100);const acks=w.messages.filter(m=>m.kind==='committed');assert.equal(new Set(acks.flatMap(m=>m.ids)).size,100);assert.equal(main.coverageSnapshot(Date.now()).lifetime.uniqueTokensDiscovered,100);assert.ok(acks.at(-1)!.stats.contentions>=1);assert.ok(acks.at(-1)!.stats.batches<100,'shared intake must amortize commits');assert.equal(acks.flatMap(m=>m.activities).length,100);
  w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));assert.equal(w.messages.some(m=>m.kind==='failure'),false);
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');await w.worker.terminate();lock.close();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('worker rejects financial or aliased database paths before creating any database',async()=>{
 const {startMarketRegistryIntakeWorker}=await import('../src/market-registry-intake-worker.js');const {existsSync,symlinkSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'poe-market-path-'));const {port1:port,port2}=new MessageChannel();try{
  const financial=join(dir,'ledger.sqlite');assert.throws(()=>startMarketRegistryIntakeWorker({path:financial},port),/NONFINANCIAL_PATH_REQUIRED/);assert.equal(existsSync(financial),false);
  const named=join(dir,'market-registry.sqlite');symlinkSync(financial,named);assert.throws(()=>startMarketRegistryIntakeWorker({path:named},port),/PRIVATE_FILE_REQUIRED/);assert.equal(existsSync(financial),false);
 }finally{port.close();port2.close();rmSync(dir,{recursive:true,force:true});}
});


test('cooperative writer turns grant bounded local work between worker commits and release after rollback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-turns-')),path=join(dir,'market-registry.sqlite');const main=new MarketRegistry(path,{concurrentIntake:true}),lock=new Database(path),buffer=main.writerTurnBuffer()!,turn=new Int32Array(buffer),w=makeWorker(path,buffer);try{
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));lock.exec('BEGIN IMMEDIATE');let callbackRuns=0;
  assert.throws(()=>main.transaction(()=>{callbackRuns++;}),isMarketRegistryContention);assert.equal(callbackRuns,0);assert.equal(Atomics.load(turn,0),1);
  lock.exec('ROLLBACK');for(let i=0;i<500;i++)w.worker.postMessage({kind:'intake',id:i,operation:'identity',value:{mint:'turn-worker-'+i,receivedAt:Date.now(),source:'pumpportal-new-token',kind:'creation',evidence:'unverified-provider-discovery-hint'}});
  await w.until(()=>Atomics.load(turn,0)===2);assert.equal(w.messages.filter(m=>m.kind==='committed').length,0,'worker must yield before its next transaction, never ACK reserved rows');
  assert.throws(()=>main.transaction(()=>{callbackRuns++;main.observeIdentity({mint:'rolled-back-turn',receivedAt:Date.now(),source:'test'});throw Error('fixture rollback');}),/fixture rollback/);assert.equal(Atomics.load(turn,0),0,'a callback refusal must release the turn after SQLite rollback');
  await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===500);assert.equal(main.coverageSnapshot(Date.now()).lifetime.uniqueTokensDiscovered,500);assert.equal(callbackRuns,1);assert.equal(w.messages.some(m=>m.kind==='failure'),false);assert.equal(main.health().writerCoordination.mainTurns,1);
  w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');await w.worker.terminate();lock.close();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('expired or abandoned cooperative turns cannot indefinitely stop queued discovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-turn-expiry-')),path=join(dir,'market-registry.sqlite');const main=new MarketRegistry(path,{concurrentIntake:true}),buffer=main.writerTurnBuffer()!,turn=new Int32Array(buffer),w=makeWorker(path,buffer);try{
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));const {performance}=await import('node:perf_hooks');Atomics.store(turn,1,(performance.timeOrigin+performance.now()+30)|0);Atomics.store(turn,0,1);
  for(let i=0;i<50;i++)w.worker.postMessage({kind:'intake',id:i,operation:'identity',value:{mint:'expiry-'+i,receivedAt:Date.now(),source:'test'}});
  await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===50);assert.equal(Atomics.load(turn,0),0);assert.ok(w.messages.filter(m=>m.kind==='committed').at(-1)!.stats.registry.writerCoordination.expired>=1);assert.equal(w.messages.some(m=>m.kind==='failure'),false);
  w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));
 }finally{await w.worker.terminate();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('migration delivery ACK is durable, ordered, replay-safe and atomically retained after a failed scheduler callback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-migration-delivery-')),path=join(dir,'market-registry.sqlite');let main=new MarketRegistry(path,{concurrentIntake:true});const w=makeWorker(path,main.writerTurnBuffer());try{
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));const first={signature:'migration-first',feedMint:'mint-first',receivedAt:1000},second={signature:'migration-second',feedMint:'mint-second',receivedAt:1001};
  w.worker.postMessage({kind:'intake',id:1,operation:'migration',value:second});w.worker.postMessage({kind:'intake',id:2,operation:'migration',value:first});w.worker.postMessage({kind:'intake',id:3,operation:'migration',value:first});
  await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===3);assert.deepEqual(main.nextMigrationDelivery(),first);
  assert.throws(()=>main.transaction(()=>{main.completeMigrationDelivery(first.signature);throw Error('fixture delivery rollback');}),/fixture delivery rollback/);assert.deepEqual(main.nextMigrationDelivery(),first);
  main.close();main=new MarketRegistry(path,{concurrentIntake:true});assert.deepEqual(main.nextMigrationDelivery(),first,'a process restart must not erase ACKed migration handoff');main.transaction(()=>main.completeMigrationDelivery(first.signature));assert.equal(main.enqueueMigrationDelivery(first),false,'an ACK replay cannot requeue a completed migration');assert.deepEqual(main.nextMigrationDelivery(),second);main.completeMigrationDelivery(second.signature);assert.equal(main.nextMigrationDelivery(),undefined);
  w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));
 }finally{await w.worker.terminate();main.close();rmSync(dir,{recursive:true,force:true});}
});


test('sustained queued intake and repeated main writer turns both make committed progress without dropped ACKs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-turn-progress-')),path=join(dir,'market-registry.sqlite');const main=new MarketRegistry(path,{concurrentIntake:true}),lock=new Database(path),buffer=main.writerTurnBuffer()!,turn=new Int32Array(buffer),w=makeWorker(path,buffer,.05);lock.pragma('busy_timeout = 25');try{
  const fixtureWriter=()=>w.until(()=>{try{lock.exec('BEGIN IMMEDIATE');return true;}catch(error){if((error as {code?:unknown}).code==='SQLITE_BUSY')return false;throw error;}},'fixture writer lease');
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));await fixtureWriter();assert.throws(()=>main.setMetadata('must-not-run',true),isMarketRegistryContention);lock.exec('ROLLBACK');
  for(let i=0;i<1000;i++)w.worker.postMessage({kind:'intake',id:i,operation:'identity',value:{mint:'progress-'+i,receivedAt:Date.now(),source:'test'}});
  let workerCommitted=0;for(let round=0;round<8;round++){
   if(round){await fixtureWriter();assert.throws(()=>main.setMetadata('must-not-run',true),isMarketRegistryContention);lock.exec('ROLLBACK');}
   await w.until(()=>Atomics.load(turn,0)===2,'main turn '+round);main.setMetadata('main-turn-'+round,round);assert.equal(Atomics.load(turn,0),0);
   await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)>workerCommitted,'worker progress '+round);workerCommitted=w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0);
  }
  await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===1000,'final drain');const ids=w.messages.filter(m=>m.kind==='committed').flatMap(m=>m.ids);assert.equal(ids.length,1000);assert.equal(new Set(ids).size,1000);assert.equal(main.coverageSnapshot(Date.now()).lifetime.uniqueTokensDiscovered,1000);assert.equal(main.getMetadata('must-not-run'),undefined);assert.equal(main.health().writerCoordination.mainTurns,8);for(let round=0;round<8;round++)assert.equal(main.getMetadata('main-turn-'+round),round);assert.equal(w.messages.some(m=>m.kind==='failure'),false);
  w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');await w.worker.terminate();lock.close();main.close();rmSync(dir,{recursive:true,force:true});}
});

const SCOPE_AT=Date.parse('2026-11-01T12:00:00Z'),DAY=86_400_000;
const scopedMint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58(),scopedSignature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
function scopedProof(n:number,createdAt=SCOPE_AT-3_600_000,availableAt=SCOPE_AT-1000):TokenCreationProof{return {version:TOKEN_AGE_POLICY.version,mint:scopedMint(n),signature:scopedSignature(n),slot:n,createdAt,availableAt,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)};}
function scopedClock(){const buffer=new SharedArrayBuffer(8),value=new BigInt64Array(buffer);Atomics.store(value,0,BigInt(SCOPE_AT));return {buffer,set:(at:number)=>Atomics.store(value,0,BigInt(at)),now:()=>Number(Atomics.load(value,0))};}

for(const migrationAge of [false,true])test('real worker revalidates restored shutdown receipts at current '+(migrationAge?'migration':'creation')+' age without manufacturing activity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-tail-age-replay-')),path=join(dir,'market-registry.sqlite'),clock=scopedClock(),main=new MarketRegistry(path,{concurrentIntake:true,now:clock.now,...(migrationAge?{migrationAge:true as const}:{})}),spoolPath=join(dir,'market-intake-tail.json');let w:ReturnType<typeof makeWorker>|undefined;const callbacks:unknown[]=[];
 if(migrationAge)main.putMigrationAgeProof({version:MIGRATION_AGE_POLICY.version,mint:scopedMint(1),pool:canonicalObservationPool(scopedMint(1)),signature:scopedSignature(1),slot:1,migrationAt:SCOPE_AT-DAY+1000,availableAt:SCOPE_AT-2000,confirmedTransactionSha256:'a'.repeat(64),finalizedTransactionSha256:'b'.repeat(64)});else main.putTokenCreationProof(scopedProof(1,SCOPE_AT-DAY+1000,SCOPE_AT-2000));
 await new NativeMarketIntakeSpool(spoolPath).save([{message:{kind:'intake',id:17,operation:'activity',value:{mint:scopedMint(1),signature:scopedSignature(10),receivedAt:SCOPE_AT,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',evidence:'unverified-provider-activity-hint'}},queuedAt:SCOPE_AT}]);clock.set(SCOPE_AT+2000);
 const intake=new NativeMarketIntake({spoolPath,now:clock.now,createWorker:()=>{w=makeWorker(path,main.writerTurnBuffer(),10,{...(migrationAge?{enforceMigrationAge:true as const}:{enforceTokenAge24h:true as const}),testClock:clock.buffer});return w.worker;},onCommitted:rows=>callbacks.push(...rows),onPressure:()=>{}});
 try{for(let i=0;i<1000&&!w;i++)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(w);await w.until(()=>intake.usage().processedAcknowledged===1);assert.equal(intake.usage().shutdownTail.replayed,1);assert.equal(intake.usage().ageExcluded,1);assert.equal(intake.usage().durableCommitted,0);assert.equal(main.coverageSnapshot(clock.now()).lifetime.uniqueTokensDiscovered,0);assert.deepEqual(callbacks,[]);await intake.close();}finally{await w?.worker.terminate();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('unknown PumpSwap qualification is durable and replay-safe without market identities, activity, migration delivery or watch rows',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-qualification-intake-')),path=join(dir,'market-registry.sqlite'),clock=scopedClock(),main=new MarketRegistry(path,{concurrentIntake:true,now:clock.now});let w=makeWorker(path,undefined,10,{enforceTokenAge24h:true,testClock:clock.buffer});try{
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));const hint={mint:scopedMint(1),receivedAt:SCOPE_AT-3000,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',signature:scopedSignature(1)};
  w.worker.postMessage({kind:'intake',id:1,operation:'qualification',value:hint});w.worker.postMessage({kind:'intake',id:2,operation:'qualification',value:{...hint,receivedAt:SCOPE_AT-1000}});w.worker.postMessage({kind:'intake',id:3,operation:'qualification',value:hint});
  await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===3);assert.equal(main.pumpSwapQualificationHint(hint.mint)?.firstSeenAt,SCOPE_AT-3000);assert.equal(main.pumpSwapQualificationHint(hint.mint)?.lastSeenAt,SCOPE_AT-1000);assert.equal(main.coverageSnapshot(SCOPE_AT).lifetime.uniqueTokensDiscovered,0);assert.equal(main.queryRows().length,0);assert.equal(main.nextMigrationDelivery(),undefined);assert.deepEqual(w.messages.filter(m=>m.kind==='committed').flatMap(m=>m.activities),[]);assert.equal(w.messages.filter(m=>m.kind==='committed').at(-1)!.stats.qualificationCommitted,3);
  w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));await w.worker.terminate();
  w=makeWorker(path,undefined,10,{enforceTokenAge24h:true,testClock:clock.buffer});await w.until(()=>w.messages.some(m=>m.kind==='ready'));w.worker.postMessage({kind:'intake',id:2,operation:'qualification',value:{...hint,receivedAt:SCOPE_AT-1000}});await w.until(()=>w.messages.some(m=>m.kind==='committed'));
  assert.equal(main.pumpSwapQualificationHint(hint.mint)?.firstSeenAt,SCOPE_AT-3000);assert.equal(main.pumpSwapQualificationHint(hint.mint)?.lastSeenAt,SCOPE_AT-1000);assert.equal(main.coverageSnapshot(SCOPE_AT).lifetime.uniqueTokensDiscovered,0);assert.deepEqual(w.messages.filter(m=>m.kind==='committed').flatMap(m=>m.activities),[]);
  const read=new Database(path,{readonly:true});try{for(const table of ['market_tokens','market_activity_seen','identity_provenance','watch_rows','pumpswap_hint_tokens'])assert.equal((read.prepare('SELECT COUNT(*) count FROM '+table).get() as {count:number}).count,0,table+' must remain empty for qualification-only intake');}finally{read.close();}
 }finally{await w.worker.terminate();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('enforced normal intake admits only PumpSwap proofs valid at both receipt and persistence time and ACKs excluded work separately',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-age-scoped-intake-')),path=join(dir,'market-registry.sqlite'),clock=scopedClock(),main=new MarketRegistry(path,{concurrentIntake:true,now:clock.now});main.putTokenCreationProof(scopedProof(1));main.putTokenCreationProof(scopedProof(2,SCOPE_AT-DAY-1000));const w=makeWorker(path,undefined,10,{enforceTokenAge24h:true,testClock:clock.buffer});try{
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));const young={mint:scopedMint(1),signature:scopedSignature(10),receivedAt:SCOPE_AT,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',evidence:'unverified-provider-discovery-hint'},activity={...young,side:'buy',quoteLamports:'1000000000',evidence:'unverified-provider-activity-hint'},unknown=scopedMint(3);
  const rows=[{operation:'identity',value:young},{operation:'activity',value:activity},{operation:'migration',value:{feedMint:young.mint,signature:scopedSignature(11),receivedAt:SCOPE_AT}},
   {operation:'identity',value:{...young,mint:unknown}},{operation:'activity',value:{...activity,mint:unknown}},{operation:'migration',value:{feedMint:unknown,signature:scopedSignature(12),receivedAt:SCOPE_AT}},
   {operation:'activity',value:{...activity,mint:scopedMint(2)}},{operation:'activity',value:{...activity,receivedAt:SCOPE_AT-2000}},{operation:'activity',value:{...activity,receivedAt:SCOPE_AT+1}},{operation:'activity',value:{...activity,venue:'pump-fun'}},
   {operation:'feed',value:{source:'pumpapi-broad',at:SCOPE_AT,connected:true,scope:'SHARED_ACTIVITY_HINTS'}},{operation:'migration',value:{signature:scopedSignature(13),receivedAt:SCOPE_AT}}];
  rows.forEach((row,index)=>w.worker.postMessage({kind:'intake',id:index+1,...row}));await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===rows.length);
  const acks=w.messages.filter(m=>m.kind==='committed'),last=acks.at(-1)!;assert.equal(last.stats.processedAcknowledged,12);assert.equal(last.stats.committed,4);assert.equal(last.stats.ageExcluded,7);assert.equal(last.stats.venueExcluded,1);assert.equal(acks.flatMap(m=>m.excluded).length,8);assert.equal(new Set(acks.flatMap(m=>m.ids)).size,12);assert.deepEqual(acks.flatMap(m=>m.activities),[{mint:young.mint,at:SCOPE_AT,evidence:'unverified-provider-activity-hint'}]);assert.equal(main.coverageSnapshot(SCOPE_AT).lifetime.uniqueTokensDiscovered,1);assert.equal(main.nextMigrationDelivery()?.feedMint,young.mint);assert.equal(main.queryRows().length,0);assert.equal(main.pumpSwapQualificationHint(unknown),undefined,'excluded normal intake cannot silently start qualification work');assert.equal(w.messages.some(m=>m.kind==='failure'),false);
 }finally{await w.worker.terminate();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('a proof expiring behind a busy writer is excluded at drain without persisting or acknowledging market activity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-age-expired-queue-')),path=join(dir,'market-registry.sqlite'),clock=scopedClock(),main=new MarketRegistry(path,{concurrentIntake:true,now:clock.now}),lock=new Database(path);main.putTokenCreationProof(scopedProof(1,SCOPE_AT-DAY+1000,SCOPE_AT-1000));const w=makeWorker(path,undefined,10,{enforceTokenAge24h:true,testClock:clock.buffer});try{
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));assert.equal(main.tokenAgeEligibility(scopedMint(1),SCOPE_AT).allowed,true);lock.exec('BEGIN IMMEDIATE');w.worker.postMessage({kind:'intake',id:1,operation:'activity',value:{mint:scopedMint(1),signature:scopedSignature(10),receivedAt:SCOPE_AT,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',side:'buy',evidence:'unverified-provider-activity-hint'}});
  await new Promise(resolve=>setTimeout(resolve,45));assert.equal(w.messages.some(m=>m.kind==='committed'),false);clock.set(SCOPE_AT+1001);lock.exec('ROLLBACK');await w.until(()=>w.messages.some(m=>m.kind==='committed'));const ack=w.messages.find(m=>m.kind==='committed');assert.deepEqual(ack.ids,[1]);assert.deepEqual(ack.excluded,[{id:1,reason:'TOKEN_AGE_EXCEEDS_24H'}]);assert.deepEqual(ack.activities,[]);assert.equal(ack.stats.committed,0);assert.equal(ack.stats.processedAcknowledged,1);assert.equal(ack.stats.ageExcluded,1);assert.equal(main.coverageSnapshot(clock.now()).lifetime.uniqueTokensDiscovered,0);assert.equal(main.queryRows().length,0);
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');await w.worker.terminate();lock.close();main.close();rmSync(dir,{recursive:true,force:true});}
});

test('ACK-lost feed replay preserves newer state and counts each original gap once including same-clock transitions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-feed-replay-')),path=join(dir,'market-registry.sqlite'),main=new MarketRegistry(path,{concurrentIntake:true});const w=makeWorker(path),at=Date.now();let id=0;
 const send=async(rows:Array<{at:number;connected:boolean}>)=>{const last=id+rows.length;for(const row of rows)w.worker.postMessage({kind:'intake',id:++id,operation:'feed',value:{source:'pumpapi-broad',scope:'SHARED_ACTIVITY_HINTS',...row}});await w.until(()=>w.messages.filter(m=>m.kind==='committed').some(m=>m.ids.includes(last)));};
 try{await w.until(()=>w.messages.some(m=>m.kind==='ready'));const read=new Database(path,{readonly:true});try{
  const snapshot=()=>read.prepare("SELECT connected,last_observed_at,coverage_gaps,last_gap_at FROM market_feeds WHERE source='pumpapi-broad'").get();
  await send([{at,connected:true},{at:at+1,connected:false},{at:at+2,connected:true}]);const original=snapshot();assert.deepEqual(original,{connected:1,last_observed_at:at+2,coverage_gaps:1,last_gap_at:at+1});await send([{at:at+1,connected:false}]);assert.deepEqual(snapshot(),original,'replayed older disconnect must not regress live state');await send([{at:at+2,connected:true}]);assert.deepEqual(snapshot(),original);
  const sameClock=[{at:at+3,connected:false},{at:at+3,connected:true}];await send(sameClock);const same=snapshot();assert.deepEqual(same,{connected:1,last_observed_at:at+3,coverage_gaps:2,last_gap_at:at+3});await send(sameClock);assert.deepEqual(snapshot(),same,'same-clock original receipt pair is applied only once');await send([{at:at+4,connected:false}]);assert.deepEqual(snapshot(),{connected:0,last_observed_at:at+4,coverage_gaps:3,last_gap_at:at+4});assert.equal((read.prepare('SELECT COUNT(*) n FROM market_feed_receipts_v1').get() as {n:number}).n,1,'only current-clock dedup state remains');
 }finally{read.close();}w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));}finally{await w.worker.terminate();main.close();rmSync(dir,{recursive:true,force:true});}
});
