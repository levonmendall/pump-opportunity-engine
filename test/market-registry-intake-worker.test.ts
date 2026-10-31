import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {MarketRegistry,isMarketRegistryContention} from '../src/market-registry.js';
const makeWorker=(path:string)=>{
 const code=`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();const {startMarketRegistryIntakeWorker}=await import(${JSON.stringify(new URL('../src/market-registry-intake-worker.ts',import.meta.url).href)});const {workerData}=await import('node:worker_threads');startMarketRegistryIntakeWorker(workerData);`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{path,maximumComputeMs:10,pendingBytesBudget:1024*1024,writerYieldMs:3}});const messages:any[]=[];let fatal:unknown;worker.on('message',m=>messages.push(m));worker.on('error',e=>{fatal=e;});
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
