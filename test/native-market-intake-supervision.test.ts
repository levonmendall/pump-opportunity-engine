import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,symlinkSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import {startMarketRegistryIntakeWorker,type MarketRegistryIntakePort} from '../src/market-registry-intake-worker.js';
import type {MarketIdentityHint} from '../src/market-discovery.js';

const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(check:()=>boolean){for(let i=0;i<50&&!check();i++)await flush();assert.equal(check(),true,'offsite worker state did not progress');}
async function diskUntil(check:()=>boolean){const end=Date.now()+5000;while(!check()&&Date.now()<end)await flush();assert.equal(check(),true,'offsite spool I/O did not settle');}
class ControlledWorker extends EventEmitter{
 readonly sent:any[]=[];terminations=0;private finish:((code:number)=>void)|null=null;
 constructor(readonly mode:'deferred'|'rejected'|'immediate'){super();}
 postMessage(value:unknown){this.sent.push(structuredClone(value));}
 terminate(){this.terminations++;return this.mode==='rejected'?Promise.reject(Error('OFFSITE no physical exit confirmation')):this.mode==='immediate'?Promise.resolve(0):new Promise<number>(resolve=>{this.finish=resolve;});}
 settle(){this.finish?.(0);}
 actualExit(){this.emit('exit',0);}
 ready(){this.emit('message',{kind:'ready',stats:{fixture:true}});}
 intake(){return this.sent.filter(row=>row.kind==='intake');}
 ack(ids:number[]){this.emit('message',{kind:'committed',ids,activities:[],excluded:[],committedAt:1000,stats:{fixture:true}});}
}
const identity=(mint:string):MarketIdentityHint=>({mint,receivedAt:1000,signature:'OFFLINE-'+mint,source:'pumpportal-migration',kind:'migration',evidence:'unverified-provider-discovery-hint'});
function fixture(mode:'deferred'|'rejected'|'immediate'='deferred',spoolPath?:string,observeDiagnostic?:(kind:string,data:unknown)=>void){
 let at=1000;const workers:ControlledWorker[]=[],records:Array<{kind:string;data:any}>=[],diagnostics:Array<{kind:string;data:any}>=[];
 const intake=new NativeMarketIntake({now:()=>at,...(spoolPath?{spoolPath}:{}),createWorker:()=>{const worker=new ControlledWorker(workers.length===0?mode:'immediate');workers.push(worker);return worker;},onPressure:()=>{},onCommitted:()=>{},record:(kind,data)=>{records.push({kind,data});},observeDiagnostic:(kind,data)=>{diagnostics.push({kind,data});observeDiagnostic?.(kind,data);}});
 return {intake,workers,records,diagnostics,current:()=>workers.at(-1)!,at:(value:number)=>{at=value;},cleanup:async()=>{
  for(const worker of workers)if(worker.terminations){worker.settle();worker.actualExit();}await flush();if(intake.usage().state==='closed')return;
  const closing=intake.close();await flush();const current=workers.at(-1);current?.ready();await flush();current?.ack(current.intake().map(row=>row.id));current?.emit('message',{kind:'closed'});await flush();for(const worker of workers){worker.settle();worker.actualExit();}await closing;
 }};
}

test('recovery waits for physical termination after the retry budget and preserves exact pending IDs and clocks',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  const first=f.current();first.ready();f.intake.observeIdentity(identity('one'));f.intake.observeIdentity(identity('two'));await until(()=>first.intake().length===2);const original=structuredClone(first.intake());
  first.emit('error',Error('OFFLINE native work still settling'));t.mock.timers.tick(500);await flush();
  assert.equal(f.workers.length,1);assert.equal(first.terminations,1);assert.equal(f.intake.usage().workerSettlement?.physicalSettlementConfirmed,false);assert.equal(f.intake.usage().pending,2);
  first.ack(original.map(row=>row.id));assert.equal(f.intake.usage().pending,2,'old generation cannot release retained ownership while settling');
  f.at(1750);first.settle();await until(()=>f.workers.length===2);const replacement=f.current();replacement.ready();await until(()=>replacement.intake().length===2);
  assert.deepEqual(replacement.intake(),original);assert.equal(f.intake.usage().oldestPendingAt,1000);assert.equal(f.intake.usage().workerSettlement?.settledAt,1750);assert.equal(f.intake.usage().restarts,1);
  replacement.ack(original.map(row=>row.id));assert.equal(f.intake.usage().durableCommitted,2);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('an actual exit settles a rejected termination while rejection itself never authorizes a replacement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture('rejected');try{
  const first=f.current();first.ready();f.intake.observeIdentity(identity('retained'));await until(()=>first.intake().length===1);first.emit('error',Error('OFFLINE failure'));await flush();t.mock.timers.tick(500);await flush();
  assert.equal(f.workers.length,1);assert.equal(f.intake.usage().workerSettlement?.terminationRejected,true);assert.equal(f.intake.usage().workerSettlement?.physicalSettlementConfirmed,false);
  first.actualExit();await until(()=>f.workers.length===2);assert.equal(f.intake.usage().workerSettlement?.settledBy,'exit-event');assert.equal(f.intake.usage().restarts,1);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('an actual exit and a later termination fulfillment cannot each start a replacement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  const first=f.current();first.ready();first.emit('error',Error('OFFLINE'));t.mock.timers.tick(500);first.actualExit();await until(()=>f.workers.length===2);
  first.settle();first.actualExit();await flush();assert.equal(f.workers.length,2);assert.equal(f.intake.usage().restarts,1);assert.equal(f.intake.usage().failures,1);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('shutdown during failed-worker settlement awaits the same barrier without starting a replacement',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  const first=f.current();first.ready();f.intake.observeIdentity(identity('tail'));await until(()=>first.intake().length===1);first.emit('error',Error('OFFLINE'));
  let complete=false;const closing=f.intake.close().then(()=>{complete=true;});await flush();t.mock.timers.tick(30000);await flush();
  assert.equal(complete,false);assert.equal(first.terminations,1);assert.equal(f.workers.length,1);assert.notEqual(f.intake.usage().state,'closed');
  first.actualExit();await closing;assert.equal(complete,true);assert.equal(f.intake.usage().state,'closed');assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().durableCommitted,0);assert.equal(f.workers.length,1);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('a closed acknowledgement is distinct from physical worker exit, including an early acknowledgement',async()=>{
 const f=fixture();try{
  const worker=f.current();worker.ready();let complete=false;const closing=f.intake.close().then(()=>{complete=true;});worker.emit('message',{kind:'closed'});await until(()=>worker.terminations===1);
  assert.equal(complete,false);assert.notEqual(f.intake.usage().state,'closed');worker.settle();await closing;assert.equal(f.intake.usage().state,'closed');assert.equal(f.intake.usage().failures,0);
 }finally{await f.cleanup();}
});

test('unexpected clean worker closure is recovered through the ordinary bounded lifecycle',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  const worker=f.current();worker.ready();worker.emit('message',{kind:'closed'});assert.equal(f.intake.usage().reasonCode,'WORKER_CLOSED_BEFORE_STOP');assert.notEqual(f.intake.usage().state,'closed');
  t.mock.timers.tick(500);await flush();assert.equal(f.workers.length,1);worker.settle();await until(()=>f.workers.length===2);assert.equal(f.intake.usage().restarts,1);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('optional settlement diagnostics cannot prevent the actual replacement or retained replay',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture('deferred',undefined,(kind)=>{if(kind==='native-market-intake-worker-physically-settled')throw Error('OFFLINE diagnostic failure');});try{
  const worker=f.current();worker.ready();f.intake.observeIdentity(identity('retained'));await until(()=>worker.intake().length===1);const original=worker.intake()[0];worker.emit('error',Error('OFFLINE'));
  t.mock.timers.tick(500);worker.settle();await until(()=>f.workers.length===2);const replacement=f.current();replacement.ready();await until(()=>replacement.intake().length===1);
  assert.deepEqual(replacement.intake()[0],original);assert.equal(f.intake.usage().supervisionDiagnosticFailures,1);assert.equal(f.intake.usage().financialWriterOpened,false);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('new settlement receipts use only the optional sink while actual lifecycle failure keeps its existing required record',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture('rejected',undefined,()=>{throw Error('OFFLINE optional stdout unavailable');});try{
  const worker=f.current();worker.ready();worker.emit('error',Error('OFFLINE existing lifecycle failure'));await flush();t.mock.timers.tick(500);await flush();assert.equal(f.workers.length,1);assert.equal(f.intake.usage().supervisionDiagnosticFailures,1);assert.equal(f.intake.usage().workerSettlement?.physicalSettlementConfirmed,false);
  worker.actualExit();await until(()=>f.workers.length===2);assert.equal(f.intake.usage().workerSettlement?.physicalSettlementConfirmed,true);assert.equal(f.intake.usage().supervisionDiagnosticFailures,2);assert.equal(f.intake.usage().restarts,1);assert.equal(f.intake.usage().financialWriterOpened,false);
  for(const kind of ['native-market-intake-worker-settlement-unconfirmed','native-market-intake-worker-physically-settled']){assert.equal(f.records.some(row=>row.kind===kind),false);assert.equal(f.diagnostics.filter(row=>row.kind===kind).length,1);}
  assert.equal(f.records.filter(row=>row.kind==='native-market-intake-worker-unavailable').length,1);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('a failed spool write still waits for physical settlement and never overwrites an aliased financial fixture',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-supervision-tail-')),path=join(directory,'market-intake-tail.json'),financial=join(directory,'ledger.sqlite'),f=fixture('deferred',path);try{
  await diskUntil(()=>f.workers.length===1);const worker=f.current();worker.ready();f.intake.observeIdentity(identity('tail'));await until(()=>worker.intake().length===1);
  writeFileSync(financial,'OFFLINE financial sentinel',{mode:0o600});symlinkSync(financial,path);let rejected=false;const closing=f.intake.close().catch(error=>{rejected=true;throw error;});const observed=assert.rejects(closing,/SPOOL_FILE/);
  await diskUntil(()=>worker.terminations===1);assert.equal(rejected,false);assert.equal(readFileSync(financial,'utf8'),'OFFLINE financial sentinel');worker.settle();await observed;
  assert.equal(f.intake.usage().workerSettlement?.physicalSettlementConfirmed,true);assert.equal(f.intake.usage().shutdownTail.durablySpooledOnClose,0);assert.equal(f.intake.usage().durableCommitted,0);
 }finally{await f.cleanup();rmSync(directory,{recursive:true,force:true});}
});

function liveness(worker:ControlledWorker,at:number,override:Record<string,unknown>={}){const request=worker.sent.filter(row=>row.kind==='liveness').at(-1);assert.ok(request);return {kind:'liveness-result',id:request.id,workerGeneration:request.workerGeneration,requestedAt:request.requestedAt,observedAt:at,pending:1,processedAcknowledged:0,contentions:200,lastCommitAt:null,...override};}

test('idle, not-yet-ready and unsent queues never start a worker liveness recovery',async()=>{
 const f=fixture('immediate');try{
  f.at(100000);f.intake.supervise();assert.equal(f.current().sent.length,0);f.intake.observeIdentity(identity('queued'));
  f.at(200000);f.intake.supervise();assert.equal(f.current().sent.length,0,'no actual worker-owned work has been dispatched');
  f.current().ready();await until(()=>f.current().intake().length===1);f.intake.supervise();assert.equal(f.current().sent.filter(row=>row.kind==='liveness').length,0);
  f.current().ack(f.current().intake().map(row=>row.id));f.at(400000);f.intake.supervise();assert.equal(f.current().terminations,0);assert.equal(f.intake.usage().failures,0);
 }finally{await f.cleanup();}
});

test('genuine ACK progress satisfies an outstanding probe without fabricating heartbeat or market coverage',async()=>{
 const f=fixture('immediate');try{
  const worker=f.current();worker.ready();f.intake.observeIdentity(identity('one'));await until(()=>worker.intake().length===1);
  f.at(30999);f.intake.supervise();assert.equal(worker.sent.filter(row=>row.kind==='liveness').length,0);
  f.at(31000);f.intake.supervise();const request=worker.sent.find(row=>row.kind==='liveness');assert.ok(request);assert.equal(f.intake.usage().supervision.outstandingSent,1);
  f.at(31001);worker.ack(worker.intake().map(row=>row.id));assert.equal(f.intake.usage().supervision.pendingProbe,null);assert.equal(f.intake.usage().supervision.satisfiedByDurableAck,1);assert.equal(f.intake.usage().supervision.lastAckProgressAt,31001);
  worker.emit('message',liveness(worker,31001));assert.equal(f.intake.usage().supervision.replies,0,'late probe cannot manufacture an independent heartbeat');assert.equal(f.intake.usage().durableCommitted,1);
 }finally{await f.cleanup();}
});

test('a responsive worker with contention and an uncommitted backlog is observed rather than restarted',async()=>{
 const f=fixture('immediate');try{
  const worker=f.current();worker.ready();f.intake.observeIdentity(identity('one'));await until(()=>worker.intake().length===1);
  for(const at of [31000,61000,91000]){f.at(at);f.intake.supervise();worker.emit('message',liveness(worker,at,{contentions:at}));assert.equal(f.intake.usage().supervision.lastReply?.observedAt,at);}
  assert.equal(f.intake.usage().supervision.replies,3);assert.equal(f.intake.usage().durableCommitted,0);assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().failures,0);assert.equal(f.intake.usage().restarts,0);assert.equal(worker.terminations,0);
 }finally{await f.cleanup();}
});

test('a missing actual heartbeat retires only its generation and awaits physical settlement before replay',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  const worker=f.current();worker.ready();f.intake.observeIdentity(identity('retained'));await until(()=>worker.intake().length===1);const original=structuredClone(worker.intake()[0]);
  f.at(31000);f.intake.supervise();f.at(60999);f.intake.supervise();assert.equal(worker.terminations,0);
  f.at(61000);f.intake.supervise();assert.equal(f.intake.usage().reasonCode,'WORKER_LIVENESS_TIMEOUT');assert.equal(f.intake.usage().supervision.timeouts,1);assert.equal(worker.terminations,1);
  worker.emit('message',liveness(worker,61000));worker.ack([original.id]);assert.equal(f.intake.usage().pending,1);t.mock.timers.tick(500);await flush();assert.equal(f.workers.length,1);
  worker.actualExit();await until(()=>f.workers.length===2);const replacement=f.current();replacement.ready();await until(()=>replacement.intake().length===1);assert.deepEqual(replacement.intake()[0],original);assert.equal(f.intake.usage().supervision.workerGeneration,2);
 }finally{await f.cleanup();t.mock.timers.reset();}
});

test('liveness replies require the exact generation, request and real response clock',async()=>{
 const f=fixture('immediate');try{
  const worker=f.current();worker.ready();f.intake.observeIdentity(identity('one'));await until(()=>worker.intake().length===1);f.at(31000);f.intake.supervise();const original=f.intake.usage().supervision.pendingProbe;
  for(const change of [{workerGeneration:0},{id:999},{requestedAt:31001},{observedAt:31001},{observedAt:30999},{pending:-1},{lastCommitAt:31001}]){worker.emit('message',liveness(worker,31000,change));assert.deepEqual(f.intake.usage().supervision.pendingProbe,original);assert.equal(f.intake.usage().supervision.replies,0);}
  worker.emit('message',liveness(worker,31000));assert.equal(f.intake.usage().supervision.replies,1);assert.equal(f.intake.usage().supervision.lastReply?.receivedAt,31000);assert.equal(f.intake.usage().durableCommitted,0);
 }finally{await f.cleanup();}
});

test('shutdown clears optional probes and never starts a recovery because an old probe later expires',async()=>{
 const f=fixture('immediate');try{
  const worker=f.current();worker.ready();f.intake.observeIdentity(identity('one'));await until(()=>worker.intake().length===1);f.at(31000);f.intake.supervise();
  const closing=f.intake.close();worker.ack(worker.intake().map(row=>row.id));worker.emit('message',{kind:'closed'});await closing;f.at(100000);f.intake.supervise();assert.equal(f.intake.usage().supervision.pendingProbe,null);assert.equal(f.intake.usage().supervision.timeouts,0);assert.equal(f.intake.usage().restarts,0);
 }finally{await f.cleanup();}
});

test('the real worker liveness handler responds without a SQLite write, durable ACK or copied timestamp',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-worker-liveness-'));chmodSync(directory,0o700);const path=join(directory,'market-registry.sqlite'),port=new EventEmitter() as EventEmitter&{postMessage:(value:unknown)=>void;close:()=>void},messages:any[]=[];port.postMessage=value=>messages.push(value);port.close=()=>{};
 // The offline adapter implements exactly the three methods the worker uses;
 // EventEmitter's fluent return type differs from the real MessagePort type.
 const worker=startMarketRegistryIntakeWorker({path},port as unknown as MarketRegistryIntakePort);try{
  const before=new Map([path,path+'-wal',path+'-shm'].filter(existsSync).map(p=>[p,readFileSync(p)])),at=Date.now();port.emit('message',{kind:'liveness',id:7,workerGeneration:2,requestedAt:at});const reply=messages.find(row=>row.kind==='liveness-result');
  assert.ok(reply);assert.equal(reply.id,7);assert.equal(reply.workerGeneration,2);assert.equal(reply.requestedAt,at);assert.ok(reply.observedAt>=at&&reply.observedAt<=Date.now());assert.equal(reply.processedAcknowledged,0);assert.equal(reply.pending,0);assert.equal(reply.lastCommitAt,null);
  for(const [p,raw]of before)assert.equal(readFileSync(p).equals(raw),true);assert.equal(messages.some(row=>row.kind==='committed'),false);
  port.emit('message',{kind:'liveness',id:8,workerGeneration:2,requestedAt:Date.now()+10000});assert.equal(messages.filter(row=>row.kind==='liveness-result').length,1);assert.equal(messages.some(row=>row.kind==='failure'),false);
 }finally{worker.close();await diskUntil(()=>messages.some(row=>row.kind==='closed'));rmSync(directory,{recursive:true,force:true});}
});
