import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import {NativeMarketIntakeSpool} from '../src/native-market-intake-spool.js';
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(condition:()=>boolean){const deadline=Date.now()+5000;while(!condition()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(condition());}
class Worker extends EventEmitter{sent:any[]=[];postMessage(row:any){this.sent.push(row);if(row.kind==='stop')queueMicrotask(()=>this.emit('message',{kind:'closed'}));}async terminate(){return 0;}ack(ids:number[]){this.emit('message',{kind:'committed',ids,committedAt:Date.now()});}}

for(const nonclosing of [false,true])test('supervisor kill retains the fsynced '+(nonclosing?'nonclosing checkpoint and real late terminal state':'initial closing tail')+' before the thirty-second deadline',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-kill-boundary-')),path=join(dir,'market-intake-tail.json'),receivedAt=Date.now();
 const child=`import {EventEmitter}from'node:events';import{NativeMarketIntake}from ${JSON.stringify(new URL('../src/native-market-intake.ts',import.meta.url).href)};class Worker extends EventEmitter{postMessage(){}async terminate(){return 0;}}const worker=new Worker();const intake=new NativeMarketIntake({spoolPath:process.argv[1],createWorker:()=>{queueMicrotask(()=>worker.emit('message',{kind:'ready'}));return worker;},onCommitted:()=>{},onPressure:()=>{},record:(kind,data)=>{if(kind==='native-market-intake-shutdown-tail-persisted'&&data.pending===${nonclosing?2:1})process.stdout.write('PERSISTED\\n');}});intake.observeMigration({signature:'original-accepted-receipt',feedMint:'original-mint',receivedAt:${receivedAt}});${nonclosing?"void intake.preserveAcceptedTail().then(()=>intake.observeFeed({source:'pumpapi-broad',at:"+(receivedAt+1)+",connected:false,scope:'SHARED_ACTIVITY_HINTS'}));setTimeout(()=>{},30000);":'void intake.close();'}`;
 const started=Date.now(),processChild=spawn(process.execPath,['--import','tsx','--input-type=module','-e',child,path],{stdio:['ignore','pipe','pipe']});let stderr='';processChild.stderr.on('data',chunk=>{stderr+=chunk.toString();});t.after(()=>{processChild.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});});
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('early handoff did not settle: '+stderr)),10000);processChild.stdout.on('data',chunk=>{if(chunk.toString().includes('PERSISTED')){clearTimeout(timer);resolve();}});processChild.once('error',reject);});
 assert.ok(Date.now()-started<30000);const exited=once(processChild,'exit');processChild.kill('SIGKILL');await exited;
 const rows=await new NativeMarketIntakeSpool(path).load();assert.equal(rows.length,nonclosing?2:1);if(nonclosing)assert.deepEqual(rows[1]!.message.value,{source:'pumpapi-broad',at:receivedAt+1,connected:false,scope:'SHARED_ACTIVITY_HINTS'});assert.deepEqual(rows[0]!.message,{kind:'intake',id:1,operation:'migration',value:{signature:'original-accepted-receipt',feedMint:'original-mint',receivedAt}});assert.ok(rows[0]!.queuedAt>=receivedAt);
});

test('ACK cleanup waits for the initial durable stop snapshot and cannot leave an already-ACKed stale file',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-stop-serialization-')),path=join(dir,'market-intake-tail.json'),worker=new Worker();let entered=false,release!:()=>void,clearCalls=0;const gate=new Promise<void>(resolve=>{release=resolve;}),save=NativeMarketIntakeSpool.prototype.save,clear=NativeMarketIntakeSpool.prototype.clear;
 t.mock.method(NativeMarketIntakeSpool.prototype,'save',async function(this:NativeMarketIntakeSpool,rows:Parameters<typeof save>[0]){entered=true;await gate;return save.call(this,rows);});
 t.mock.method(NativeMarketIntakeSpool.prototype,'clear',async function(this:NativeMarketIntakeSpool){clearCalls++;return clear.call(this);});
 const intake=new NativeMarketIntake({spoolPath:path,createWorker:()=>{queueMicrotask(()=>worker.emit('message',{kind:'ready'}));return worker;},onCommitted:()=>{},onPressure:()=>{}});
 try{intake.observeMigration({signature:'original-serial-tail',receivedAt:Date.now()});await until(()=>worker.sent.some(row=>row.kind==='intake'));const closing=intake.close();await until(()=>entered);worker.ack([worker.sent.find(row=>row.kind==='intake').id]);await flush();assert.equal(clearCalls,0,'ACK cannot remove a file before its initial write physically settles');release();await closing;assert.equal(existsSync(path),false);assert.equal(intake.usage().pending,0);assert.equal(intake.usage().durableCommitted,1);assert.equal(intake.usage().shutdownTail.durablySpooledOnClose,0);}finally{release();rmSync(dir,{recursive:true,force:true});}
});

test('partial ACKs during early persistence retain the unresolved original receipt through worker failure',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-stop-partial-')),path=join(dir,'market-intake-tail.json'),worker=new Worker();let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),save=NativeMarketIntakeSpool.prototype.save;
 t.mock.method(NativeMarketIntakeSpool.prototype,'save',async function(this:NativeMarketIntakeSpool,rows:Parameters<typeof save>[0]){if(!entered){entered=true;await gate;}return save.call(this,rows);});
 const intake=new NativeMarketIntake({spoolPath:path,createWorker:()=>{queueMicrotask(()=>worker.emit('message',{kind:'ready'}));return worker;},onCommitted:()=>{},onPressure:()=>{}});
 try{const at=Date.now();intake.observeMigration({signature:'ACKed-tail',receivedAt:at});intake.observeMigration({signature:'unresolved-original-tail',receivedAt:at-1});await until(()=>worker.sent.filter(row=>row.kind==='intake').length===2);const sent=worker.sent.filter(row=>row.kind==='intake'),closing=intake.close();await until(()=>entered);worker.ack([sent[0].id]);worker.emit('error',Error('OFFLINE failed while initial tail write unsettled'));release();await closing;const rows=await new NativeMarketIntakeSpool(path).load();assert.equal(rows.length,1);assert.deepEqual(rows[0]!.message,sent[1]);assert.equal(intake.usage().durableCommitted,1);assert.equal(intake.usage().pending,1);assert.equal(intake.usage().shutdownTail.durablySpooledOnClose,1);}finally{release();rmSync(dir,{recursive:true,force:true});}
});

test('the nonclosing checkpoint accepts and persists an actual later terminal feed state without claiming a registry commit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-open-checkpoint-')),path=join(dir,'market-intake-tail.json'),worker=new Worker(),intake=new NativeMarketIntake({spoolPath:path,createWorker:()=>{queueMicrotask(()=>worker.emit('message',{kind:'ready'}));return worker;},onCommitted:()=>{},onPressure:()=>{}});
 try{const at=Date.now();intake.observeMigration({signature:'accepted-before-stop',receivedAt:at});await until(()=>worker.sent.some(row=>row.kind==='intake'));await intake.preserveAcceptedTail();assert.equal(intake.available(),true);const first=await new NativeMarketIntakeSpool(path).load();assert.equal(first.length,1);
  await flush();intake.observeFeed({source:'pumpapi-broad',at:at+1,connected:false,scope:'SHARED_ACTIVITY_HINTS'});await until(()=>intake.usage().shutdownTail.durablySpooledOnClose===2);const later=await new NativeMarketIntakeSpool(path).load();assert.equal(later.length,2);assert.deepEqual(later[0],first[0]);assert.deepEqual(later[1]!.message.value,{source:'pumpapi-broad',at:at+1,connected:false,scope:'SHARED_ACTIVITY_HINTS'});assert.equal(intake.usage().durableCommitted,0);assert.equal(intake.usage().shutdownTail.replayed,0);assert.equal(intake.usage().shutdownTail.awaitingAcknowledgment,0);
  await until(()=>worker.sent.filter(row=>row.kind==='intake').length===2);worker.ack(worker.sent.filter(row=>row.kind==='intake').map(row=>row.id));await intake.close();assert.equal(existsSync(path),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('queued checkpoint prefixes are immutable and later accepted records are not counted saved before their own fsync',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-checkpoint-prefixes-')),path=join(dir,'market-intake-tail.json'),worker=new Worker();let firstEntered=false,secondEntered=false,releaseFirst!:()=>void,releaseSecond!:()=>void,calls=0;const firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;}),secondGate=new Promise<void>(resolve=>{releaseSecond=resolve;}),save=NativeMarketIntakeSpool.prototype.save;
 t.mock.method(NativeMarketIntakeSpool.prototype,'save',async function(this:NativeMarketIntakeSpool,rows:Parameters<typeof save>[0]){calls++;if(calls===1){firstEntered=true;await firstGate;}else if(calls===2){secondEntered=true;await secondGate;}return save.call(this,rows);});
 const intake=new NativeMarketIntake({spoolPath:path,createWorker:()=>{queueMicrotask(()=>worker.emit('message',{kind:'ready'}));return worker;},onCommitted:()=>{},onPressure:()=>{}});
 try{const at=Date.now();intake.observeMigration({signature:'immutable-prefix',receivedAt:at});await until(()=>worker.sent.some(row=>row.kind==='intake'));const checkpoint=intake.preserveAcceptedTail();await until(()=>firstEntered);intake.observeFeed({source:'pumpapi-broad',at:at+1,connected:false,scope:'SHARED_ACTIVITY_HINTS'});await flush();releaseFirst();await checkpoint;await until(()=>secondEntered);assert.equal(intake.usage().shutdownTail.durablySpooledOnClose,1,'a queued future prefix is not already durable');const first=await new NativeMarketIntakeSpool(path).load();assert.equal(first.length,1);const message=first[0]!.message;assert.ok(message.operation==='migration');assert.equal(message.value.receivedAt,at);
  releaseSecond();await until(()=>intake.usage().shutdownTail.durablySpooledOnClose===2);await until(()=>worker.sent.filter(row=>row.kind==='intake').length===2);worker.ack(worker.sent.filter(row=>row.kind==='intake').map(row=>row.id));await intake.close();assert.equal(existsSync(path),false);
 }finally{releaseFirst();releaseSecond();rmSync(dir,{recursive:true,force:true});}
});
