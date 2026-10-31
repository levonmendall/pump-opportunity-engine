import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {Worker} from 'node:worker_threads';
import bs58 from 'bs58';
import {NativeActivityHintQueue} from '../src/native-activity-hint-queue.js';
import {MarketRegistry,MarketRegistryContention} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {setup,scope} from './native-flow-fixture.js';

test('queued native activity keeps original availability, coalesces only scheduling hints and does not acknowledge a newer item',()=>{
 const q=new NativeActivityHintQueue<object>(),g={},current=(mint:string,gen:object)=>mint==='a'&&gen===g;
 q.enqueue({mint:'a',at:10,evidence:'first scheduling hint'},g,current);q.enqueue({mint:'a',at:9,evidence:'older duplicate'},g,current);
 const first=q.next(current)!;assert.equal(first.row.at,10);
 q.enqueue({mint:'a',at:11,evidence:'new scheduling hint'},g,current);q.complete(first);
 assert.equal(q.usage().pending,1);const last=q.next(current)!;assert.equal(last.row.at,11);q.complete(last);assert.equal(q.usage().pending,0);
 assert.deepEqual(q.usage(),{pending:0,received:3,coalesced:2,applied:1,stale:0,discarded:0,meaning:'Coalesced scheduling hints only; independent native trade/audit evidence is not queued or backdated.'});
});

test('discarding an after-callback failure never claims application or erases a newer scheduling hint',()=>{
 const q=new NativeActivityHintQueue<object>(),g={},current=()=>true;
 q.enqueue({mint:'a',at:1,evidence:'first hint'},g,current);const first=q.next(current)!;
 q.enqueue({mint:'a',at:2,evidence:'second hint'},g,current);q.discard(first);assert.equal(q.usage().pending,1);
 q.discard(q.next(current)!);assert.equal(q.usage().pending,0);assert.equal(q.usage().applied,0);assert.equal(q.usage().discarded,1);
});

test('only current physical generations remain queued and a stale scope cannot replace a current hint',()=>{
 const q=new NativeActivityHintQueue<object>();let generation={},mint='a';const current=(name:string,g:object)=>name===mint&&g===generation;
 const stale=generation;q.enqueue({mint,at:1,evidence:'native activity hint'},generation,current);
 for(let i=0;i<2000;i++){mint='new-'+i;generation={};q.enqueue({mint,at:i+2,evidence:'native activity hint'},generation,current);assert.equal(q.usage().pending,1);}
 assert.equal(q.enqueue({mint,at:999999,evidence:'retired generation'},stale,current),false);assert.equal(q.next(current)!.row.at,2001);
 mint='none';assert.equal(q.next(current),undefined);assert.equal(q.usage().pending,0);
});

test('invalid availability is refused without changing a valid pending scheduling hint',()=>{
 const q=new NativeActivityHintQueue<object>(),g={},current=()=>true;
 q.enqueue({mint:'a',at:1,evidence:'valid hint'},g,current);
 for(const at of [-1,NaN,Infinity,1.5])assert.throws(()=>q.enqueue({mint:'a',at,evidence:'invalid hint'},g,current),/NATIVE_ACTIVITY_HINT_INVALID/);
 assert.equal(q.next(current)!.row.at,1);
});

test('native packet callbacks remain independent of a real 250ms SQLite writer lock; original-time watch hints apply after release',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-native-activity-')),path=join(dir,'market.sqlite');const q=new NativeActivityHintQueue<object>(),g={},current=(mint:string,gen:object)=>mint===scope.mint&&gen===g;
 const f=setup({persistent:true,retainRecords:true,onActivity:row=>{q.enqueue(row,g,current);}});const registry=new MarketRegistry(path,{now:()=>f.now,concurrentIntake:true});
 const watch=new PilotWatch({registry,now:()=>f.now,maximumDeep:1,record:()=>{}});watch.discover({signature:'retained-native-activity-fixture',feedMint:scope.mint,receivedAt:f.now});watch.verify('retained-native-activity-fixture',{mint:scope.mint,pool:scope.pool,migrationAt:f.now-300000,verifiedAt:f.now});
 const sqlite=createRequire(import.meta.url).resolve('better-sqlite3');const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const Database=require(workerData.sqlite);const db=new Database(workerData.path);db.pragma('busy_timeout=25');db.exec('BEGIN IMMEDIATE');const started=performance.now();parentPort.postMessage('locked');parentPort.once('message',()=>setTimeout(()=>{db.exec('ROLLBACK');db.close();parentPort.postMessage({released:true,heldMs:performance.now()-started});},Math.max(0,250-(performance.now()-started))));`,{eval:true,workerData:{sqlite,path}});
 let release!:(value:{released:true;heldMs:number})=>void,rejectRelease!:(error:Error)=>void;const released=new Promise<{released:true;heldMs:number}>((resolve,reject)=>{release=resolve;rejectRelease=reject;});
 const locked=new Promise<void>((resolve,reject)=>{worker.on('message',value=>{if(value==='locked')resolve();else if(value?.released)release(value);});worker.on('error',error=>{reject(error);rejectRelease(error);});});
 try{
  const socket=await f.open();await locked;const attempts=registry.health().transactions.attempted;
  for(let i=1;i<=8;i++){const bytes=Buffer.alloc(64);bytes.writeUInt32LE(i+600000);f.notice(socket,{signature:bs58.encode(bytes)});}
  assert.equal(registry.health().transactions.attempted,attempts,'no registry transaction starts on the WebSocket activity callback');
  assert.equal(f.trades.length,8,'actual native trade evidence remains synchronous and complete');assert.equal(f.gaps.length,0);assert.equal(f.flow.notificationLedger(scope.mint).length,8);
  assert.equal(q.usage().received,8);assert.equal(q.usage().coalesced,7);const pending=q.next(current)!;const originalAt=pending.row.at;
  let callbackStarted=false;assert.throws(()=>registry.transaction(()=>{callbackStarted=true;watch.noteActivity(pending.row.mint,pending.row.at,pending.row.evidence);}),MarketRegistryContention);
  assert.equal(callbackStarted,false);assert.equal(q.usage().pending,1);assert.equal(registry.lookup(scope.mint)?.lastActivityAt,null);
  worker.postMessage('release');const finished=await released;assert.ok(finished.heldMs>=249);
  registry.transaction(()=>watch.noteActivity(pending.row.mint,pending.row.at,pending.row.evidence));q.complete(pending);
  assert.equal(watch.lookupIdentity(scope.mint,f.now)?.lastActivityAt,originalAt);assert.equal(q.usage().pending,0);assert.equal(q.usage().applied,1);
 }finally{await f.flow.stop();await worker.terminate();registry.close();rmSync(dir,{recursive:true,force:true});}
});
