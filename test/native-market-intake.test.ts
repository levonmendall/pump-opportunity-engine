import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import type {MarketIdentityHint,MarketActivityHint} from '../src/market-discovery.js';

class MockWorker extends EventEmitter {
 readonly sent:any[]=[];terminations=0;
 postMessage(value:unknown){this.sent.push(structuredClone(value));}
 async terminate(){this.terminations++;return 0;}
 ready(){this.emit('message',{kind:'ready',stats:{fixture:true}});}
 ack(ids:number[],activities:unknown[]=[]){this.emit('message',{kind:'committed',ids,activities,committedAt:1001,stats:{fixture:true}});}
 intake(){return this.sent.filter(row=>row.kind==='intake');}
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(condition:()=>boolean){for(let i=0;i<30&&!condition();i++)await flush();assert.equal(condition(),true,'mock worker did not receive queued intake');}
const identity=(i:number):MarketIdentityHint=>({mint:'mint-'+i,signature:'signature-'+i,receivedAt:1000,source:'pumpportal-new-token',kind:'creation',evidence:'unverified-provider-discovery-hint'});
const activity=(i:number):MarketActivityHint=>({mint:'mint-'+i,signature:'trade-'+i,receivedAt:1000,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000000000',evidence:'unverified-provider-activity-hint'});
function fixture(budgetBytes=1024){
 const workers:MockWorker[]=[],pressure:Array<{paused:boolean;pendingBytes:number;budgetBytes:number}>=[],committed:unknown[][]=[],records:Array<{kind:string;data:any}>=[];
 const intake=new NativeMarketIntake({budgetBytes,now:()=>1000,createWorker:()=>{const worker=new MockWorker();workers.push(worker);return worker;},onPressure:value=>pressure.push(value),onCommitted:rows=>committed.push(rows),record:(kind,data)=>records.push({kind,data})});
 const current=()=>workers.at(-1)!;
 const close=async()=>{if(intake.usage().state==='closed')return;const worker=current();worker.ready();await flush();const closing=intake.close();worker.ack(worker.intake().map(row=>row.id));worker.emit('message',{kind:'closed'});await closing;};
 return {intake,workers,current,pressure,committed,records,close};
}

test('byte pressure pauses intake transport while retaining every identity beyond former registry and queue capacities',async()=>{
 const f=fixture();try{
  assert.deepEqual(f.pressure[0],{paused:true,pendingBytes:0,budgetBytes:1024});
  for(let i=0;i<300;i++)f.intake.observeIdentity(identity(i));
  const queued=f.intake.usage();assert.equal(queued.received,300);assert.equal(queued.pending,300);assert.equal(queued.durableCommitted,0);assert.ok(queued.pendingBytes>queued.pendingBytesBudget);assert.equal(f.pressure.at(-1)!.paused,true);
  f.current().ready();await until(()=>f.current().intake().length===300);
  assert.equal(f.intake.usage().pending,300,'sending to a worker does not establish durable discovery');
  const sent=f.current().intake();assert.equal(new Set(sent.map(row=>row.value.mint)).size,300);assert.equal(new Set(sent.map(row=>row.id)).size,300);
  f.current().ack(sent.slice(0,-1).map(row=>row.id));assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().durableCommitted,299);assert.equal(f.pressure.at(-1)!.paused,false,'transport resumes below byte pressure without requiring arbitrary identity eviction');
  f.current().ack([sent.at(-1)!.id]);assert.equal(f.intake.usage().pendingBytes,0);assert.equal(f.intake.usage().durableCommitted,300);assert.equal(f.intake.usage().financialWriterOpened,false);
 }finally{await f.close();}
});

test('only recognized commit ACKs release pending ownership; duplicate and unrelated ACKs do not manufacture commits or activity',async()=>{
 const f=fixture(100000);try{
  const original=identity(1);f.intake.observeIdentity(original);original.mint='external-mutation';f.intake.observeActivity(activity(2));f.intake.observeFeed({source:'pumpapi-broad',at:1000,connected:true,scope:'SHARED_ACTIVITY_HINTS'});
  f.current().ready();await until(()=>f.current().intake().length===3);const sent=f.current().intake();assert.deepEqual(sent.map(row=>row.operation),['identity','activity','feed']);assert.equal(sent[0]!.value.mint,'mint-1');
  f.current().emit('message',{kind:'unknown',ids:sent.map(row=>row.id)});f.current().ack([999999]);assert.equal(f.intake.usage().pending,3);assert.equal(f.intake.usage().durableCommitted,0);assert.equal(f.committed.length,0);
  const rows=[{mint:'mint-2',at:1000,evidence:'unverified-provider-activity-hint'}];f.current().ack([sent[1]!.id],rows);assert.equal(f.intake.usage().pending,2);assert.equal(f.intake.usage().durableCommitted,1);assert.deepEqual(f.committed,[rows]);
  f.current().ack([sent[1]!.id],rows);assert.equal(f.intake.usage().pending,2);assert.equal(f.intake.usage().durableCommitted,1);assert.equal(f.committed.length,1);
 }finally{await f.close();}
});

test('ordinary worker errors retain unacknowledged messages and resend their exact IDs after recovery while ignoring stale worker ACKs',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(100000);try{
  for(let i=0;i<3;i++)f.intake.observeIdentity(identity(i));const first=f.current();first.ready();await until(()=>first.intake().length===3);const initial=first.intake();first.ack([initial[0]!.id]);
  first.emit('error',Error('ordinary unavailable worker'));assert.equal(f.intake.usage().state,'recovering');assert.equal(f.intake.usage().pending,2);assert.equal(f.intake.usage().durableCommitted,1);assert.equal(f.pressure.at(-1)!.paused,true);assert.equal(first.terminations,1);
  first.ack([initial[1]!.id]);assert.equal(f.intake.usage().pending,2,'an obsolete worker cannot release current parent ownership');
  t.mock.timers.tick(500);assert.equal(f.workers.length,2);const replacement=f.current();replacement.ready();await until(()=>replacement.intake().length===2);
  assert.deepEqual(replacement.intake(),initial.slice(1));assert.equal(f.intake.usage().restarts,1);assert.equal(f.intake.usage().failures,1);
  replacement.ack(replacement.intake().map(row=>row.id));assert.equal(f.intake.usage().pending,0);assert.equal(f.intake.usage().durableCommitted,3);assert.equal(f.pressure.at(-1)!.paused,false);
 }finally{if(f.workers.length===1)t.mock.timers.tick(500);await f.close();t.mock.timers.reset();}
});

test('a worker error before its queued send turn produces one failure and preserves the pending message for recovery',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  f.intake.observeIdentity(identity(8));const first=f.current();first.ready();first.emit('error',Error('worker failed before send turn'));await flush();
  assert.equal(f.intake.usage().failures,1,'a stale scheduled send must not report a second failure against a missing worker');assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().durableCommitted,0);
  t.mock.timers.tick(500);f.current().ready();await until(()=>f.current().intake().length===1);assert.equal(f.current().intake()[0]!.value.mint,'mint-8');f.current().ack([f.current().intake()[0]!.id]);
 }finally{if(f.workers.length===1)t.mock.timers.tick(500);await f.close();t.mock.timers.reset();}
});

test('premature worker closure cannot count an unacknowledged tail as durable and the replacement receives retained records',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  f.intake.observeActivity(activity(5));f.current().ready();await until(()=>f.current().intake().length===1);const message=f.current().intake()[0];f.current().emit('message',{kind:'closed'});
  assert.equal(f.intake.usage().reasonCode,'WORKER_CLOSED_WITH_UNACKNOWLEDGED_INTAKE');assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().durableCommitted,0);
  t.mock.timers.tick(500);f.current().ready();await until(()=>f.current().intake().length===1);assert.deepEqual(f.current().intake()[0],message);f.current().ack([message.id]);
  assert.equal(f.intake.usage().durableCommitted,1);assert.equal(f.records.some(row=>row.kind==='native-market-intake-worker-unavailable'&&row.data.unacknowledgedTailRetained),true);
 }finally{if(f.workers.length===1)t.mock.timers.tick(500);await f.close();t.mock.timers.reset();}
});

test('shutdown rejects new intake, drains remaining ACKs, sends stop only when flat, and resolves after worker closed',async()=>{
 const f=fixture(100000);try{
  f.intake.observeIdentity(identity(1));f.intake.observeActivity(activity(2));const worker=f.current();worker.ready();await until(()=>worker.intake().length===2);
  let resolved=false;const closing=f.intake.close().then(()=>{resolved=true;});assert.equal(f.intake.available(),false);assert.throws(()=>f.intake.observeIdentity(identity(3)),/MARKET_INTAKE_CLOSED/);assert.equal(worker.sent.some(row=>row.kind==='stop'),false);
  worker.ack([worker.intake()[0]!.id]);await flush();assert.equal(worker.sent.some(row=>row.kind==='stop'),false);assert.equal(resolved,false);
  worker.ack([worker.intake()[1]!.id]);await flush();assert.equal(worker.sent.some(row=>row.kind==='stop'),true);assert.equal(resolved,false,'commit drain precedes the explicit worker close handshake');
  worker.emit('message',{kind:'closed'});await closing;assert.equal(resolved,true);assert.equal(f.intake.usage().state,'closed');assert.equal(f.intake.usage().pending,0);assert.equal(f.intake.usage().durableCommitted,2);assert.equal(f.records.some(row=>row.kind==='native-market-intake-undrained-shutdown'),false);
  await f.intake.close();assert.equal(f.intake.usage().durableCommitted,2,'repeated shutdown does not replay commits');
 }finally{await f.close();}
});
