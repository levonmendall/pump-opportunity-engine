import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {MarketRegistry,isMarketRegistryContention} from '../src/market-registry.js';
const makeWorker=(path:string,writerTurn?:SharedArrayBuffer,maximumComputeMs=10)=>{
 const code=`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();const {startMarketRegistryIntakeWorker}=await import(${JSON.stringify(new URL('../src/market-registry-intake-worker.ts',import.meta.url).href)});const {workerData}=await import('node:worker_threads');startMarketRegistryIntakeWorker(workerData);`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{path,maximumComputeMs,pendingBytesBudget:1024*1024,writerYieldMs:3,...(writerTurn?{writerTurn}:{})}});const messages:any[]=[];let fatal:unknown;worker.on('message',m=>messages.push(m));worker.on('error',e=>{fatal=e;});
 const until=(predicate:()=>boolean)=>new Promise<void>((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(fatal||Date.now()-start>5000){clearInterval(timer);reject(fatal??Error('worker timeout'));}else if(predicate()){clearInterval(timer);resolve();}},2);});
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
  await w.until(()=>w.messages.some(m=>m.kind==='ready'));lock.exec('BEGIN IMMEDIATE');assert.throws(()=>main.setMetadata('must-not-run',true),isMarketRegistryContention);lock.exec('ROLLBACK');
  for(let i=0;i<1000;i++)w.worker.postMessage({kind:'intake',id:i,operation:'identity',value:{mint:'progress-'+i,receivedAt:Date.now(),source:'test'}});
  let workerCommitted=0;for(let round=0;round<8;round++){
   if(round){lock.exec('BEGIN IMMEDIATE');assert.throws(()=>main.setMetadata('must-not-run',true),isMarketRegistryContention);lock.exec('ROLLBACK');}
   await w.until(()=>Atomics.load(turn,0)===2);main.setMetadata('main-turn-'+round,round);assert.equal(Atomics.load(turn,0),0);
   await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)>workerCommitted);workerCommitted=w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0);
  }
  await w.until(()=>w.messages.filter(m=>m.kind==='committed').reduce((n,m)=>n+m.ids.length,0)===1000);const ids=w.messages.filter(m=>m.kind==='committed').flatMap(m=>m.ids);assert.equal(ids.length,1000);assert.equal(new Set(ids).size,1000);assert.equal(main.coverageSnapshot(Date.now()).lifetime.uniqueTokensDiscovered,1000);assert.equal(main.getMetadata('must-not-run'),undefined);assert.equal(main.health().writerCoordination.mainTurns,8);for(let round=0;round<8;round++)assert.equal(main.getMetadata('main-turn-'+round),round);assert.equal(w.messages.some(m=>m.kind==='failure'),false);
  w.worker.postMessage({kind:'stop'});await w.until(()=>w.messages.some(m=>m.kind==='closed'));
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');await w.worker.terminate();lock.close();main.close();rmSync(dir,{recursive:true,force:true});}
});
