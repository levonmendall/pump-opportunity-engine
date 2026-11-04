import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import type {MarketIdentityHint,MarketActivityHint,PumpSwapQualificationHint} from '../src/market-discovery.js';
import {MARKET_REGISTRY_REPORTING_VERSION,type MarketRegistryReportingScope} from '../src/market-registry-reporting.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {mkdtempSync,readFileSync,existsSync,rmSync,writeFileSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeMarketIntakeSpool} from '../src/native-market-intake-spool.js';

class MockWorker extends EventEmitter {
 readonly sent:any[]=[];terminations=0;
 postMessage(value:unknown){this.sent.push(structuredClone(value));}
 async terminate(){this.terminations++;return 0;}
 ready(){this.emit('message',{kind:'ready',stats:{fixture:true}});}
 ack(ids:number[],activities:unknown[]=[],excluded:Array<{id:number;reason:string}>=[]){this.emit('message',{kind:'committed',ids,activities,excluded,committedAt:1001,stats:{fixture:true}});}
 intake(){return this.sent.filter(row=>row.kind==='intake');}
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(condition:()=>boolean){for(let i=0;i<30&&!condition();i++)await flush();assert.equal(condition(),true,'mock worker did not receive queued intake');}
const identity=(i:number):MarketIdentityHint=>({mint:'mint-'+i,signature:'signature-'+i,receivedAt:1000,source:'pumpportal-new-token',kind:'creation',evidence:'unverified-provider-discovery-hint'});
const activity=(i:number):MarketActivityHint=>({mint:'mint-'+i,signature:'trade-'+i,receivedAt:1000,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000000000',evidence:'unverified-provider-activity-hint'});
function fixture(budgetBytes=1024,now=()=>1000,spoolPath?:string){
 const workers:MockWorker[]=[],pressure:Array<{paused:boolean;pendingBytes:number;budgetBytes:number}>=[],committed:unknown[][]=[],records:Array<{kind:string;data:any}>=[];
 const intake=new NativeMarketIntake({budgetBytes,now,...(spoolPath?{spoolPath}:{}),createWorker:()=>{const worker=new MockWorker();workers.push(worker);return worker;},onPressure:value=>pressure.push(value),onCommitted:rows=>committed.push(rows),record:(kind,data)=>records.push({kind,data})});
 const current=()=>workers.at(-1)!;
 const close=async()=>{if(intake.usage().state==='closed')return;await flush();const worker=current();worker.ready();await flush();const closing=intake.close();worker.ack(worker.intake().map(row=>row.id));worker.emit('message',{kind:'closed'});await closing;};
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
  t.mock.timers.tick(500);await until(()=>f.workers.length===2);assert.equal(f.workers.length,2);const replacement=f.current();replacement.ready();await until(()=>replacement.intake().length===2);
  assert.deepEqual(replacement.intake(),initial.slice(1));assert.equal(f.intake.usage().restarts,1);assert.equal(f.intake.usage().failures,1);
  replacement.ack(replacement.intake().map(row=>row.id));assert.equal(f.intake.usage().pending,0);assert.equal(f.intake.usage().durableCommitted,3);assert.equal(f.pressure.at(-1)!.paused,false);
 }finally{if(f.workers.length===1)t.mock.timers.tick(500);await f.close();t.mock.timers.reset();}
});

test('a worker error before its queued send turn produces one failure and preserves the pending message for recovery',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  f.intake.observeIdentity(identity(8));const first=f.current();first.ready();first.emit('error',Error('worker failed before send turn'));await flush();
  assert.equal(f.intake.usage().failures,1,'a stale scheduled send must not report a second failure against a missing worker');assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().durableCommitted,0);
  t.mock.timers.tick(500);await until(()=>f.workers.length===2);f.current().ready();await until(()=>f.current().intake().length===1);assert.equal(f.current().intake()[0]!.value.mint,'mint-8');f.current().ack([f.current().intake()[0]!.id]);
 }finally{if(f.workers.length===1)t.mock.timers.tick(500);await f.close();t.mock.timers.reset();}
});

test('premature worker closure cannot count an unacknowledged tail as durable and the replacement receives retained records',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();try{
  f.intake.observeActivity(activity(5));f.current().ready();await until(()=>f.current().intake().length===1);const message=f.current().intake()[0];f.current().emit('message',{kind:'closed'});
  assert.equal(f.intake.usage().reasonCode,'WORKER_CLOSED_WITH_UNACKNOWLEDGED_INTAKE');assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().durableCommitted,0);
  t.mock.timers.tick(500);await until(()=>f.workers.length===2);f.current().ready();await until(()=>f.current().intake().length===1);assert.deepEqual(f.current().intake()[0],message);f.current().ack([message.id]);
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


test('migration handoff retains the exact seed until its durable worker ACK',async()=>{
 const f=fixture(100000);try{
  const seed={signature:'migration-handoff',feedMint:'migration-mint',receivedAt:1000};f.intake.observeMigration(seed);seed.feedMint='external-change';f.current().ready();await until(()=>f.current().intake().length===1);const sent=f.current().intake()[0];assert.equal(sent.operation,'migration');assert.deepEqual(sent.value,{signature:'migration-handoff',feedMint:'migration-mint',receivedAt:1000});assert.equal(f.intake.usage().durableCommitted,0);f.current().ack([sent.id]);assert.equal(f.intake.usage().durableCommitted,1);assert.equal(f.intake.usage().pending,0);
 }finally{await f.close();}
});

const qualification=(receivedAt:number):PumpSwapQualificationHint=>({mint:'qualification-mint',receivedAt,signature:'qualification-'+receivedAt,source:'pumpapi-broad',kind:'activity',venue:'pump-amm'});

test('qualification coalesces only unsent receipts and owns at most one immutable in-flight message plus its freshest successor',async()=>{
 const f=fixture(100000);try{
  for(let i=0;i<100;i++)f.intake.observeQualification({...qualification(1000+i),price:123,quoteLamports:'999',rawProviderPayload:'not qualification evidence'} as PumpSwapQualificationHint);
  assert.equal(f.intake.usage().received,1);assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().qualification.hintsCoalesced,99);
  const worker=f.current();worker.ready();await until(()=>worker.intake().length===1);const first=worker.intake()[0];assert.equal(first.operation,'qualification');assert.deepEqual(first.value,qualification(1099),'qualification retains only minimal identity and real receipt fields');
  for(let i=0;i<100;i++)f.intake.observeQualification(qualification(1100+i));
  f.intake.observeQualification(qualification(900));await flush();assert.equal(worker.intake().length,1,'successor cannot overtake the unacknowledged ID');assert.equal(f.intake.usage().pending,2);assert.equal(f.intake.usage().qualification.inFlight,1);
  worker.ack([first.id+1]);assert.equal(f.intake.usage().pending,2,'an unsent coalesced message cannot be acknowledged');
  worker.ack([first.id],[{mint:'qualification-mint',at:1099,evidence:'unverified-provider-activity-hint'}]);assert.equal(f.committed.length,0,'qualification cannot manufacture a market activity callback');
  await until(()=>worker.intake().length===2);const second=worker.intake()[1];assert.notEqual(second.id,first.id);assert.equal(second.value.receivedAt,1199);assert.deepEqual(worker.intake()[0],first,'in-flight receipt never changes');
  worker.ack([second.id]);const u=f.intake.usage();assert.equal(u.pendingBytes,0);assert.equal(u.processedAcknowledged,2);assert.equal(u.durableCommitted,2);assert.equal(u.qualification.durableCommitted,2);assert.equal(u.qualification.hintsReceived,201);assert.equal(u.qualification.hintsCoalesced,199);assert.equal(u.qualification.pendingMints,0);assert.equal(u.qualification.inFlight,0);
 }finally{await f.close();}
});

test('qualification restart replays the exact outstanding ID before its coalesced successor without accepting obsolete ACKs',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(100000);try{
  f.intake.observeQualification(qualification(1000));const first=f.current();first.ready();await until(()=>first.intake().length===1);const original=first.intake()[0];f.intake.observeQualification(qualification(1100));f.intake.observeQualification(qualification(1200));await flush();
  first.emit('error',Error('qualification commit ACK lost'));assert.equal(f.intake.usage().pending,2);first.ack([original.id]);assert.equal(f.intake.usage().pending,2);
  t.mock.timers.tick(500);await until(()=>f.workers.length===2);const replacement=f.current();replacement.ready();await until(()=>replacement.intake().length===1);assert.deepEqual(replacement.intake()[0],original);assert.equal(f.intake.usage().qualification.inFlight,1);
  replacement.ack([original.id]);await until(()=>replacement.intake().length===2);const successor=replacement.intake()[1];assert.equal(successor.id,original.id+1);assert.equal(successor.value.receivedAt,1200);replacement.ack([successor.id]);assert.equal(f.intake.usage().pending,0);assert.equal(f.intake.usage().qualification.durableCommitted,2);assert.equal(f.committed.length,0);
 }finally{if(f.workers.length===1)t.mock.timers.tick(500);await f.close();t.mock.timers.reset();}
});

test('excluded ACKs release owned messages while distinguishing processed exclusions from durable market intake',async()=>{
 const f=fixture(100000);try{
  f.intake.observeActivity(activity(1));f.intake.observeActivity(activity(2));f.current().ready();await until(()=>f.current().intake().length===2);const [first,second]=f.current().intake();
  f.current().ack([first.id],[{mint:'mint-1',at:1000,evidence:'unverified-provider-activity-hint'}],[{id:first.id,reason:'TOKEN_AGE_EXCEEDS_24H'}]);
  assert.equal(f.intake.usage().processedAcknowledged,1);assert.equal(f.intake.usage().durableCommitted,0);assert.equal(f.intake.usage().ageExcluded,1);assert.equal(f.committed.length,0);
  f.current().ack([first.id],[],[{id:first.id,reason:'TOKEN_AGE_EXCEEDS_24H'}]);assert.equal(f.intake.usage().ageExcluded,1);
  f.current().ack([second.id],[],[{id:second.id,reason:'PUMPSWAP_VENUE_REQUIRED'}]);assert.equal(f.intake.usage().pending,0);assert.equal(f.intake.usage().pendingBytes,0);assert.equal(f.intake.usage().processedAcknowledged,2);assert.equal(f.intake.usage().durableCommitted,0);assert.equal(f.intake.usage().venueExcluded,1);
 }finally{await f.close();}
});

const reportingScope=():MarketRegistryReportingScope=>({registryId:'OFFLINE-registry',sourceInstanceId:'native-runner:OFFLINE:source-a',startedAt:500,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,maximumDeep:4,strategy:'liquidity-resilient-momentum-v3.1',requireOrigin:false,pumpswapOnly:false,enforceTokenAge24h:false,enforceMigrationAge:false});
const reportReceipt=(request:any,at:number)=>({kind:'reporting-result',id:request.id,requestedAt:request.requestedAt,observedAt:at,completedAt:at,durationMs:5,snapshot:{version:MARKET_REGISTRY_REPORTING_VERSION,sourceInstanceId:request.scope.sourceInstanceId,observedAt:at,coverage:{generatedAt:at}},reasonCode:null});

test('optional reporting coalesces without changing intake ACK ownership and retains original sample clocks',async()=>{
 let at=1000;const f=fixture(100000,()=>at),scope=reportingScope();try{
  f.current().ready();f.intake.observeIdentity(identity(1));assert.equal(f.intake.registryReporting(scope,at).health.reasonCode,'REPORTING_INTAKE_PRIORITY');assert.equal(f.current().sent.length,0,'no optional report overtakes the scheduled unsent intake turn');await flush();
  for(let n=0;n<100;n++)assert.equal(f.intake.registryReporting(scope,at).health.reasonCode,'REPORTING_INTAKE_PRIORITY');
  assert.equal(f.current().sent.filter(r=>r.kind==='reporting').length,0,'optional reporting cannot overtake even unsent parent-owned intake');f.current().ack(f.current().intake().map(r=>r.id));
  for(let n=0;n<100;n++)f.intake.registryReporting(scope,at);f.intake.observeIdentity(identity(2));await flush();
  const requests=f.current().sent.filter(r=>r.kind==='reporting');assert.equal(requests.length,1);assert.equal(f.intake.usage().pending,1);
  f.current().emit('message',{...reportReceipt(requests[0],at),id:999});assert.equal(f.intake.registryReporting(scope,at).health.state,'UNAVAILABLE');
  f.current().emit('message',reportReceipt(requests[0],at));const first=f.intake.registryReporting(scope,at);assert.equal(first.health.state,'FRESH');assert.equal(first.health.pending,false);assert.equal(first.health.observedAt,1000);assert.equal(f.intake.usage().durableCommitted,1);f.current().ack(f.current().intake().map(r=>r.id));
  at=2001;const reused=f.intake.registryReporting(scope,at);assert.equal(reused.health.observedAt,1000);assert.equal(reused.health.completedAt,1000);assert.equal(reused.health.sampledAt,2001);assert.equal(reused.health.ageMs,1001);assert.equal(reused.health.pending,true);assert.equal(f.current().sent.filter(r=>r.kind==='reporting').length,2);
  f.current().ack(f.current().intake().map(r=>r.id));assert.equal(f.intake.usage().durableCommitted,2,'summary completion cannot ACK intake');
  at=31001;const old=f.intake.registryReporting(scope,at);assert.equal(old.health.state,'STALE');assert.equal(old.health.reasonCode,'REPORTING_SAMPLE_STALE');assert.equal(old.snapshot?.observedAt,1000);assert.equal(f.intake.available(),true,'diagnostic age is not source admission');
 }finally{await f.close();}
});

test('new applied ACKs allow one refreshed optional report during backlog after the scheduled intake send turn',async()=>{
 let at=1000;const f=fixture(100000,()=>at),scope=reportingScope();try{
  f.current().ready();for(let n=1;n<=3;n++)f.intake.observeIdentity(identity(n));await flush();
  const ids=f.current().intake().map(row=>row.id);f.current().ack([999]);
  f.intake.registryReporting(scope,at);assert.equal(f.current().sent.filter(row=>row.kind==='reporting').length,0,'unknown IDs cannot earn reporting credit');
  f.current().ack([ids[0]],[],[{id:ids[0],reason:'TOKEN_AGE_EXCEEDS_24H'}]);
  f.intake.observeIdentity(identity(4));f.intake.registryReporting(scope,at);
  assert.equal(f.current().sent.filter(row=>row.kind==='reporting').length,0,'the already scheduled unsent intake turn retains priority');await flush();
  for(let n=0;n<100;n++)f.intake.registryReporting(scope,at);
  const first=f.current().sent.filter(row=>row.kind==='reporting');assert.equal(first.length,1);assert.equal(f.intake.usage().pending,3);assert.equal(f.intake.usage().processedAcknowledged,1);assert.equal(f.intake.usage().durableCommitted,0,'an exclusion ACK is not a durable discovery');
  f.current().emit('message',reportReceipt(first[0],at));assert.equal(f.intake.registryReporting(scope,at).health.state,'FRESH');assert.equal(f.intake.usage().pending,3,'optional completion cannot ACK the retained tail');
  at=2001;f.current().ack([ids[0]]);await flush();for(let n=0;n<100;n++)f.intake.registryReporting(scope,at);
  assert.equal(f.current().sent.filter(row=>row.kind==='reporting').length,1,'duplicate ACKs cannot renew an already consumed opportunity');
  f.current().ack([ids[1]]);await flush();f.intake.registryReporting(scope,at);
  const second=f.current().sent.filter(row=>row.kind==='reporting');assert.equal(second.length,2);assert.equal(f.intake.usage().pending,2);
  f.current().emit('message',{...reportReceipt(second[1],at),snapshot:null,reasonCode:'REPORTING_READ_BUSY'});
  const retained=f.intake.registryReporting(scope,at);assert.equal(retained.health.observedAt,1000);assert.equal(retained.health.reasonCode,'REPORTING_READ_BUSY');assert.equal(f.intake.available(),true);assert.equal(f.intake.usage().failures,0);
 }finally{await f.close();}
});

test('a replacement worker cannot spend reporting credit earned by the prior generation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let at=1000;const f=fixture(100000,()=>at),scope=reportingScope();try{
  const prior=f.current();prior.ready();for(let n=1;n<=3;n++)f.intake.observeIdentity(identity(n));await flush();const ids=prior.intake().map(row=>row.id);
  prior.ack([ids[0]]);await flush();assert.equal(f.intake.usage().processedAcknowledged,1);
  prior.emit('error',Error('OFFLINE generation replacement'));t.mock.timers.tick(500);await until(()=>f.workers.length===2);at=2000;const replacement=f.current();replacement.ready();await flush();
  f.intake.registryReporting(scope,at);assert.equal(replacement.sent.filter(row=>row.kind==='reporting').length,0,'old ACK credit must not qualify replayed unacknowledged work');
  prior.ack([ids[1]]);f.intake.registryReporting(scope,at);assert.equal(replacement.sent.filter(row=>row.kind==='reporting').length,0,'obsolete worker ACKs cannot earn new-generation credit');
  replacement.ack([ids[1]]);await flush();f.intake.registryReporting(scope,at);assert.equal(replacement.sent.filter(row=>row.kind==='reporting').length,1);assert.equal(f.intake.usage().pending,1);assert.equal(f.intake.usage().processedAcknowledged,2);
 }finally{await f.close();}
});

test('source and worker generation changes cannot relabel old summary data as a fresh current sample',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let at=1000;const f=fixture(100000,()=>at),scope=reportingScope();try{
  const first=f.current();first.ready();f.intake.registryReporting(scope,at);first.emit('message',reportReceipt(first.sent.find(r=>r.kind==='reporting'),at));
  first.emit('error',Error('OFFLINE worker ended'));const failed=f.intake.registryReporting(scope,at);assert.equal(failed.health.state,'STALE');assert.equal(failed.health.sampleWorkerGeneration,1);assert.equal(failed.health.observedAt,1000);
  t.mock.timers.tick(500);await until(()=>f.workers.length===2);at=2000;const second=f.current();second.ready();const recovery=f.intake.registryReporting(scope,at);assert.equal(recovery.health.workerGeneration,2);assert.equal(recovery.health.sampleWorkerGeneration,1);assert.equal(recovery.health.state,'STALE');
  const request=second.sent.find(r=>r.kind==='reporting');first.emit('message',reportReceipt(request,at));assert.equal(f.intake.registryReporting(scope,at).health.state,'STALE','obsolete worker replies are ignored');
  second.emit('message',reportReceipt(request,at));assert.equal(f.intake.registryReporting(scope,at).health.state,'FRESH');
  const replacement=f.intake.registryReporting({...scope,sourceInstanceId:'native-runner:OFFLINE:source-b'},at);assert.equal(replacement.health.state,'UNAVAILABLE');assert.equal(replacement.snapshot,null,'source-instance cohorts cannot migrate into the replacement source');
 }finally{await f.close();t.mock.timers.reset();}
});

test('a failed or invalid optional summary keeps the last known sample without failing healthy intake',async()=>{
 let at=1000;const f=fixture(100000,()=>at),scope=reportingScope();try{
  f.current().ready();f.intake.registryReporting(scope,at);let request=f.current().sent.find(r=>r.kind==='reporting');f.current().emit('message',reportReceipt(request,at));
  at=2000;f.intake.registryReporting(scope,at);request=f.current().sent.filter(r=>r.kind==='reporting').at(-1);f.current().emit('message',{...reportReceipt(request,at),snapshot:null,reasonCode:'REPORTING_READ_BUSY'});
  const stale=f.intake.registryReporting(scope,at);assert.equal(stale.health.state,'STALE');assert.equal(stale.health.reasonCode,'REPORTING_READ_BUSY');assert.equal(stale.health.observedAt,1000);assert.equal(f.intake.available(),true);assert.equal(f.intake.usage().failures,0);
  at=3000;f.intake.registryReporting(scope,at);request=f.current().sent.filter(r=>r.kind==='reporting').at(-1);f.current().emit('message',{...reportReceipt(request,at),completedAt:at+1});assert.equal(f.intake.registryReporting(scope,at).health.reasonCode,'REPORTING_RESULT_INVALID');
  f.intake.observeIdentity(identity(2));await flush();f.current().ack(f.current().intake().map(r=>r.id));assert.equal(f.intake.usage().pending,0);assert.equal(f.intake.usage().durableCommitted,1);
 }finally{await f.close();}
});

test('an ignored or intake-starved summary times out diagnostically, retries and ignores late old IDs without restarting intake',async()=>{
 let at=1000;const f=fixture(100000,()=>at),scope=reportingScope();try{
  const worker=f.current();worker.ready();f.intake.registryReporting(scope,at);const old=worker.sent.find(r=>r.kind==='reporting');
  at=31000;const timeout=f.intake.registryReporting(scope,at);assert.equal(timeout.health.state,'UNAVAILABLE');assert.equal(timeout.health.reasonCode,'REPORTING_REQUEST_TIMEOUT');assert.equal(timeout.health.pending,false);assert.equal(timeout.health.failures,1);assert.equal(f.intake.available(),true);assert.equal(worker.terminations,0);
  f.intake.observeIdentity(identity(9));await flush();worker.ack(worker.intake().map(r=>r.id));assert.equal(f.intake.usage().durableCommitted,1);
  at=32000;assert.equal(f.intake.registryReporting(scope,at).health.pending,true);const current=worker.sent.filter(r=>r.kind==='reporting').at(-1);assert.notEqual(current.id,old.id);
  worker.emit('message',reportReceipt(old,at));assert.equal(f.intake.registryReporting(scope,at).health.state,'UNAVAILABLE');worker.emit('message',reportReceipt(current,at));assert.equal(f.intake.registryReporting(scope,at).health.state,'FRESH');assert.equal(f.intake.usage().restarts,0);assert.equal(f.intake.usage().failures,0);
 }finally{await f.close();}
});

test('graceful shutdown clears an impossible pending report while retaining prior sample provenance',async()=>{
 let at=1000;const f=fixture(100000,()=>at),scope=reportingScope();f.current().ready();f.intake.registryReporting(scope,at);const request=f.current().sent.find(r=>r.kind==='reporting');f.current().emit('message',reportReceipt(request,at));at=2000;assert.equal(f.intake.registryReporting(scope,at).health.pending,true);
 await f.close();const closed=f.intake.registryReporting(scope,at);assert.equal(closed.health.pending,false);assert.equal(closed.health.state,'STALE');assert.equal(closed.health.observedAt,1000);assert.equal(closed.health.completedAt,1000);assert.equal(closed.health.reasonCode,'WORKER_UNAVAILABLE');
});

async function diskUntil(condition:()=>boolean){const deadline=Date.now()+5000;while(!condition()&&Date.now()<deadline)await flush();assert.ok(condition(),'asynchronous shutdown spool did not settle');}
test('bounded shutdown durably hands off only unacknowledged receipts, replays original clocks and clears after their ACKs',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const dir=mkdtempSync(join(tmpdir(),'poe-intake-tail-')),path=join(dir,'market-intake-tail.json'),f=fixture(100000,()=>1000,path);let replacement:ReturnType<typeof fixture>|undefined;
 try{
  f.intake.observeIdentity(identity(1));f.intake.observeActivity(activity(2));f.intake.observeQualification(qualification(1000));await diskUntil(()=>f.workers.length===1);f.current().ready();await until(()=>f.current().intake().length===3);const original=f.current().intake();f.current().ack([original[0].id]);
  const closing=f.intake.close();assert.equal(f.intake.close(),closing,'concurrent close callers share the same durable handoff');await diskUntil(()=>f.intake.usage().shutdownTail.durablySpooledOnClose===2);await flush();t.mock.timers.tick(30000);await closing;
  const saved=JSON.parse(readFileSync(path,'utf8'));assert.deepEqual(saved.rows.map((row:any)=>row.message),original.slice(1));assert.deepEqual(saved.rows.map((row:any)=>row.queuedAt),[1000,1000]);assert.equal(statSync(path).mode&0o777,0o600);assert.equal(f.intake.usage().durableCommitted,1);assert.equal(f.intake.usage().shutdownTail.durablySpooledOnClose,2);assert.equal(f.records.find(row=>row.kind==='native-market-intake-undrained-shutdown')?.data.shutdownTailDurablySpooled,2);
  replacement=fixture(100000,()=>90000,path);replacement.intake.observeIdentity(identity(4));await diskUntil(()=>replacement!.workers.length===1);replacement.current().ready();await until(()=>replacement!.current().intake().length===3);const replay=replacement.current().intake();assert.deepEqual(replay.slice(0,2),original.slice(1),'shutdown tail must not receive new receipt timestamps or IDs');assert.ok(replay[2].id>Math.max(...original.map(row=>row.id)),'new intake cannot collide with restored IDs');assert.equal(replacement.intake.usage().shutdownTail.replayed,2);assert.equal(replacement.intake.usage().maximumPendingAgeMs,89000);assert.equal(replacement.intake.usage().durableCommitted,0,'spool persistence is not market qualification or a durable registry commit');
  replacement.current().ack([replay[0].id]);assert.equal(existsSync(path),true,'partial replay cannot retire the outstanding shutdown file');replacement.current().ack([replay[1].id],[],[{id:replay[1].id,reason:'TOKEN_AGE_EXCEEDS_24H'}]);await diskUntil(()=>!existsSync(path));assert.equal(replacement.intake.usage().pending,1);assert.equal(replacement.intake.usage().ageExcluded,1);assert.equal(replacement.intake.usage().shutdownTail.awaitingAcknowledgment,0);await replacement.close();
 }finally{if(replacement&&replacement.intake.usage().state!=='closed')await replacement.close();if(f.intake.usage().state!=='closed'){const closing=f.intake.close();await flush();t.mock.timers.tick(30000);await closing;}t.mock.timers.reset();rmSync(dir,{recursive:true,force:true});}
});

test('worker failure during shutdown preserves its owned tail for the next process instead of treating failure as drain',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-tail-failure-')),path=join(dir,'market-intake-tail.json'),f=fixture(100000,()=>1000,path);
 try{await diskUntil(()=>f.workers.length===1);f.intake.observeMigration({signature:'tail-migration',feedMint:'tail-mint',receivedAt:999});f.current().ready();await until(()=>f.current().intake().length===1);const original=f.current().intake()[0],closing=f.intake.close();f.current().emit('error',Error('worker unavailable during stop'));await closing;assert.deepEqual(await new NativeMarketIntakeSpool(path).load(),[{message:original,queuedAt:1000}]);assert.equal(f.intake.usage().durableCommitted,0);assert.equal(f.intake.usage().shutdownTail.durablySpooledOnClose,1);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('unreadable shutdown tail closes discovery admission and is never replaced or discarded',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-tail-invalid-')),path=join(dir,'market-intake-tail.json'),original='{"version":"invalid"}';writeFileSync(path,original,{mode:0o600});const f=fixture(100000,()=>1000,path);
 try{await diskUntil(()=>f.intake.usage().shutdownTail.loadFailed);assert.equal(f.intake.available(),false);assert.equal(f.workers.length,0);assert.equal(f.intake.usage().reasonCode,'SHUTDOWN_TAIL_UNAVAILABLE');await f.intake.close();assert.equal(readFileSync(path,'utf8'),original);assert.equal(f.intake.usage().durableCommitted,0);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('failed shutdown persistence rejects close without claiming a saved tail or touching an aliased file',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-tail-write-failure-')),path=join(dir,'market-intake-tail.json'),financial=join(dir,'ledger.sqlite'),f=fixture(100000,()=>1000,path);
 try{await diskUntil(()=>f.workers.length===1);f.intake.observeIdentity(identity(1));f.current().ready();await until(()=>f.current().intake().length===1);writeFileSync(financial,'financial-sentinel',{mode:0o600});symlinkSync(financial,path);const closing=f.intake.close();f.current().emit('error',Error('worker stopped without ACK'));await assert.rejects(closing,/SPOOL_FILE/);assert.equal(readFileSync(financial,'utf8'),'financial-sentinel');assert.equal(f.intake.usage().shutdownTail.durablySpooledOnClose,0);assert.equal(f.intake.usage().durableCommitted,0);assert.equal(f.records.some(row=>row.kind==='native-market-intake-shutdown-tail-write-unavailable'),true);}finally{rmSync(dir,{recursive:true,force:true});}
});
