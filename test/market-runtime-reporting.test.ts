import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import {startMarketRegistryIntakeWorker} from '../src/market-registry-intake-worker.js';
import {projectIntakeWorkerReporting,projectSourceDispatchReporting,validateIntakeWorkerReporting,validateSourceDispatchReporting} from '../src/market-runtime-reporting.js';
import {projectMarketCoverageReporting,validateMarketCoverageReporting} from '../src/market-coverage-reporting.js';
const T=Date.parse('2026-10-30T23:00:00.000Z'),RUN='native-paper-runtime-fixture';
const raw=()=>({version:'off-thread-full-durable-market-intake-v1',state:'ready',received:10,durableCommitted:8,pending:2,pendingBytes:256,pendingBytesBudget:1024,oldestPendingAt:T-100,maximumPendingAgeMs:100,lastCommitAt:T-10,workerGeneration:2,restarts:1,failures:1,retryAt:null,reasonCode:null,worker:{committed:5,batches:2,maximumBatchMs:7.25,contentions:1,registry:{transactions:{writeCommits:2}}},inFlightTailMeaning:'UNACKNOWLEDGED_NETWORK_INTAKE_IS_NOT_YET_DURABLE',financialWriterOpened:false});
test('worker scope preserves pending tail, actual ACK totals and fractional batch latency without granting financial permission',()=>{
 const r=raw(),before=structuredClone(r),p=projectIntakeWorkerReporting(r,RUN,T)!;assert.ok(p);assert.deepEqual(r,before);validateIntakeWorkerReporting(p,T);assert.equal(p.scope,'CURRENT_SOURCE_PROCESS');assert.equal(p.runId,RUN);assert.equal(p.pending,2);assert.equal(p.durableCommitted,8);assert.equal(p.worker!.registryWriteCommits,2);assert.equal(p.worker!.maximumBatchMs,7.25);assert.equal(p.financialWriterOpened,false);
 const recovering=raw();recovering.state='recovering';assert.equal(projectIntakeWorkerReporting(recovering,RUN,T)!.worker!.generation,null,'last reported old worker stats are not attributed to a restarted generation before ready');
 assert.equal(projectIntakeWorkerReporting(undefined,RUN,T),null);assert.equal(projectIntakeWorkerReporting({...raw(),financialWriterOpened:true},RUN,T),null);
});
test('static classifications redact arbitrary errors and wire rejects extra secrets or inconsistent ACK counts',()=>{
 const r=raw() as any;r.reasonCode='https://private.example?key=DO_NOT_EXPORT';r.worker.privateError='DO_NOT_EXPORT';const p=projectIntakeWorkerReporting(r,RUN,T)!;assert.equal(p.reasonCode,'OTHER_UNEXPORTED_REASON');assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|private\.example/);
 for(const change of [(v:any)=>v.apiKey='private',(v:any)=>v.durableCommitted=9,(v:any)=>v.worker.registryWriteCommits=-1]){const bad=structuredClone(p);change(bad);assert.throws(()=>validateIntakeWorkerReporting(bad,T),/INVALID/);}
});
test('actual producer exclusion ACKs remain visible without becoming durable discoveries',async()=>{
 const events=new EventEmitter(),sent:any[]=[];
 const handle={on:(name:string,listener:(value:any)=>void)=>{events.on(name,listener);return handle;},postMessage:(value:any)=>{sent.push(value);if(value.kind==='stop')queueMicrotask(()=>events.emit('message',{kind:'closed'}));},terminate:async()=>0};
 const intake=new NativeMarketIntake({createWorker:()=>handle,now:()=>T,onCommitted:()=>{},onPressure:()=>{}});
 try{
  events.emit('message',{kind:'ready'});
  for(let n=0;n<2;n++)intake.observeIdentity({mint:String(n),receivedAt:T,source:'pumpapi-broad',kind:'activity',evidence:'unverified-provider-discovery-hint'});
  await new Promise<void>(resolve=>setImmediate(resolve));
  const ids=sent.filter(row=>row.kind==='intake').map(row=>row.id);
  events.emit('message',{kind:'committed',ids,excluded:[{id:ids[0],reason:'TOKEN_AGE_EXCEEDS_24H'},{id:ids[1],reason:'PUMPSWAP_VENUE_REQUIRED'}],committedAt:T,stats:{}});
  const usage=intake.usage(),p=projectIntakeWorkerReporting(usage,RUN,T)!;
  assert.ok(p,'legitimate exclusion ACKs must not erase the entire intake report');
  assert.equal(p.received,2);assert.equal(p.processedAcknowledged,2);assert.equal(p.ageExcluded,1);assert.equal(p.venueExcluded,1);assert.equal(p.durableCommitted,0);assert.equal(p.pending,0);assert.equal(p.financialWriterOpened,false);
  const coverage=projectMarketCoverageReporting({runId:RUN,marketCoverage:{version:'poe-market-coverage-v1',generatedAt:T,persistence:{state:'sqlite-wal'},resource:{intakeWorker:usage}}},T)!;
  assert.equal(coverage.resource.intakeWorker!.processedAcknowledged,2);validateMarketCoverageReporting(coverage,T);
 }finally{await intake.close();}
});
test('extended ACK accounting rejects contradictions while historical intake wire remains valid',()=>{
 const p=projectIntakeWorkerReporting({...raw(),processedAcknowledged:8,ageExcluded:0,venueExcluded:0},RUN,T)!;
 validateIntakeWorkerReporting(p,T);validateIntakeWorkerReporting(projectIntakeWorkerReporting(raw(),RUN,T),T);
 for(const change of [(v:any)=>v.processedAcknowledged=7,(v:any)=>v.ageExcluded=1,(v:any)=>delete v.venueExcluded,(v:any)=>v.venueExcluded=-1,(v:any)=>{v.pending=null;v.processedAcknowledged=11;v.durableCommitted=null;v.ageExcluded=null;v.venueExcluded=null;}]){
  const bad=structuredClone(p);change(bad);assert.throws(()=>validateIntakeWorkerReporting(bad,T),/INVALID/);
 }
 const unknown=projectIntakeWorkerReporting({...raw(),processedAcknowledged:'unavailable',ageExcluded:0,venueExcluded:0},RUN,T)!;
 assert.equal(unknown.processedAcknowledged,null,'missing evidence is not replaced by invented ACKs');
});
test('shutdown tail diagnostic distinguishes saved graceful-stop work from registry commits and crash coverage',()=>{
 const tail={enabled:true,replayed:2,awaitingAcknowledgment:1,durablySpooledOnClose:0,loadFailed:false,scope:'GRACEFUL_SHUTDOWN_ONLY_NOT_CRASH_JOURNAL'};
 const p=projectIntakeWorkerReporting({...raw(),processedAcknowledged:8,ageExcluded:0,venueExcluded:0,shutdownTail:{...tail,privatePath:'DO_NOT_EXPORT'}},RUN,T)!;
 assert.deepEqual(p.shutdownTail,tail);assert.equal(p.durableCommitted,8);assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|privatePath/);validateIntakeWorkerReporting(p,T);
 for(const change of [(v:any)=>v.shutdownTail.scope='CRASH_JOURNAL',(v:any)=>v.shutdownTail.awaitingAcknowledgment=3,(v:any)=>v.shutdownTail.durablySpooledOnClose=3,(v:any)=>v.shutdownTail.enabled=false,(v:any)=>v.shutdownTail.apiKey='secret']){
  const bad=structuredClone(p);change(bad);assert.throws(()=>validateIntakeWorkerReporting(bad,T),/INVALID/);
 }
 const failed=projectIntakeWorkerReporting({...raw(),reasonCode:'SHUTDOWN_TAIL_UNAVAILABLE',shutdownTail:{...tail,replayed:0,awaitingAcknowledgment:0,loadFailed:true}},RUN,T)!;
 assert.equal(failed.reasonCode,'SHUTDOWN_TAIL_UNAVAILABLE');assert.equal(failed.shutdownTail!.loadFailed,true);
});
test('source dispatch preserves false gates and redacts unrecognized outcomes without creating an admission decision',()=>{
 const p=projectSourceDispatchReporting({sourceInformationAdmission:true,sourceAdmission:false,sourceClosed:false,admissionSuspensionPresent:true,engineOpen:true,deepSetupAllowed:false,sourceWorkAllowed:false,hasNativeFatal:false,workOwner:'idle',lastOutcome:'PILOT_RPC private.example DO_NOT_EXPORT'},RUN)!;
 assert.equal(p.sourceAdmission,false);assert.equal(p.deepSetupAllowed,false);assert.equal(p.lastOutcome,'OTHER_UNEXPORTED_OUTCOME');assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|private\.example/);validateSourceDispatchReporting(p);assert.equal(projectSourceDispatchReporting(null,RUN),null);const bad=structuredClone(p) as any;bad.privateError='secret';assert.throws(()=>validateSourceDispatchReporting(bad),/INVALID/);
});
test('actual intake producer and SQLite batch ACK project pending messages as durable only after commit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-intake-report-')),messages=new EventEmitter(),events=new EventEmitter();
 const port={on:(name:string,listener:(value:any)=>void)=>{messages.on(name,listener);return port;},postMessage:(value:unknown)=>queueMicrotask(()=>events.emit('message',value)),close:()=>{}};
 const handle={on:(name:string,listener:(value:any)=>void)=>{events.on(name,listener);return handle;},postMessage:(value:unknown)=>messages.emit('message',value),terminate:async()=>0};
 const worker=startMarketRegistryIntakeWorker({path:join(dir,'market-registry.sqlite'),writerYieldMs:1,maximumComputeMs:5},port as any);
 const intake=new NativeMarketIntake({createWorker:()=>handle,onCommitted:()=>{},onPressure:()=>{}});
 try{
  await new Promise<void>(resolve=>queueMicrotask(resolve));intake.observeIdentity({mint:'11111111111111111111111111111111',receivedAt:Date.now(),source:'pumpportal-new-token',kind:'creation',evidence:'unverified-provider-discovery-hint'});
  const pending=projectIntakeWorkerReporting(intake.usage(),RUN,Date.now())!;assert.equal(pending.pending,1);assert.equal(pending.durableCommitted,0);
  const deadline=Date.now()+2000;while(intake.usage().durableCommitted!==1&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
  const committed=projectIntakeWorkerReporting(intake.usage(),RUN,Date.now())!;assert.equal(committed.pending,0);assert.equal(committed.durableCommitted,1);assert.ok(committed.lastCommitAt);assert.ok(committed.worker!.registryWriteCommits!>=1);assert.equal(worker.stats().committed,1);
 }finally{await intake.close();rmSync(dir,{recursive:true,force:true});}
});

test('cheap allocation and physical subscription runway remain distinct, while old sources publish unknown',()=>{
 const old=projectSourceDispatchReporting({engineOpen:true,deepSetupAllowed:false},RUN)!;assert.equal(old.allocation125Allowed,null);assert.equal(old.physicalSetup3000Allowed,null);
 const fresh=projectSourceDispatchReporting({engineOpen:true,deepSetupAllowed:false,allocation125Allowed:true,physicalSetup3000Allowed:false},RUN)!;assert.equal(fresh.allocation125Allowed,true);assert.equal(fresh.physicalSetup3000Allowed,false);validateSourceDispatchReporting(fresh);
 const olderWire=structuredClone(old);delete olderWire.allocation125Allowed;delete olderWire.physicalSetup3000Allowed;validateSourceDispatchReporting(olderWire);
});

test('actual waiting operation explains its own bound and deadline without treating fixed legacy probes as readiness',()=>{
 const raw={engineOpen:true,deepSetupAllowed:false,physicalSetup3000Allowed:false,allocationAllowed:true,preparedSetupAllowed:true,financialEvaluationPending:false,observedAt:T+25,waitingOperation:{observedAt:T+25,operation:'SUBSCRIPTION_ACK',requestedOperationMs:1700,availableMs:2200,deadlineAt:T+2225,bindingBlocker:'NONE',sourceAllowed:true,deadlineAllowed:true,providerReadyAt:T+10,physicalBusy:false}};
 const p=projectSourceDispatchReporting(raw,RUN)!;assert.equal(p.preparedSetupAllowed,true);assert.equal(p.physicalSetup3000Allowed,false);assert.equal(p.waitingOperation!.requestedOperationMs,1700);assert.equal(p.waitingOperation!.availableMs,2200);assert.equal(p.waitingOperation!.operation,'SUBSCRIPTION_ACK');assert.equal(p.observedAt,new Date(T+25).toISOString());validateSourceDispatchReporting(p);
 const coverage=projectMarketCoverageReporting({runId:RUN,marketCoverage:{version:'poe-market-coverage-v1',generatedAt:T,persistence:{state:'sqlite-wal'},resource:{sourceDispatch:raw}}},T)!;
 assert.ok(coverage);assert.equal(coverage.generatedAt,new Date(T).toISOString());assert.equal(coverage.resource.sourceDispatch!.observedAt,new Date(T+25).toISOString(),'later diagnostics retain their own timestamp while financial/report facts keep their original time');validateMarketCoverageReporting(coverage,T);
 const old=projectSourceDispatchReporting({physicalSetup3000Allowed:false},RUN)!;assert.equal(old.waitingOperation,null);assert.equal(old.preparedSetupAllowed,null);assert.equal(old.observedAt,null);
});

test('waiting operation diagnostics redact unknown text and reject malformed wire times and fields',()=>{
 const raw={observedAt:T,waitingOperation:{observedAt:T,operation:'DO_NOT_EXPORT',bindingBlocker:'https://private.example/key',requestedOperationMs:1700,availableMs:-1,sourceAllowed:false,deadlineAllowed:false,physicalBusy:true,apiKey:'DO_NOT_EXPORT'}};
 const p=projectSourceDispatchReporting(raw,RUN)!;assert.equal(p.waitingOperation!.operation,null);assert.equal(p.waitingOperation!.bindingBlocker,null);assert.equal(p.waitingOperation!.availableMs,null);assert.equal(p.waitingOperation!.sourceAllowed,false);assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|private\.example|apiKey/);
 for(const change of [(r:any)=>r.observedAt='invalid',(r:any)=>r.waitingOperation.availableMs=-1,(r:any)=>r.waitingOperation.apiKey='secret',(r:any)=>r.waitingOperation.operation='UNKNOWN']){const bad=structuredClone(p);change(bad);assert.throws(()=>validateSourceDispatchReporting(bad),/INVALID/);}
});
