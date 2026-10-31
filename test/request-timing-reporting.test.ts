import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {Script} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComponentBudget} from '../src/component-budget.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {REQUEST_TIMING_METHODS,projectFinancialHandoffReporting,validateFinancialHandoffReporting,projectRequestTimingReporting,validateRequestTimingReporting} from '../src/financial-handoff-reporting.js';

const T=Date.parse('2026-10-31T00:50:00.000Z'),RUN='native-paper-timing-fixture',mint='11111111111111111111111111111111',HTTP={transport:'http' as const,method:'getMultipleAccounts'};
const turn=()=>new Promise<void>(r=>setImmediate(r));
const id=(n:number)=>RUN+':request:'+n;
const plan=(n:number,at=T)=>({at,requestId:id(n),mint,owner:'candidate',method:HTTP.method,operationBoundMs:1200,certificateDeadlineAt:T+9999,callerLatestStartAt:T+9000});

test('actual physical timeout retains ownership until settlement; paced inner refusal retains its exact matched guard',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-request-timing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let at=T;
 const handoff=new NativeFinancialHandoff(RUN,T,4),b=new ComponentBudget({statePath:join(dir,'budget.json'),grantId:'fixture-timing',baseline:{calls:20,bytes:272634,starts:Array.from({length:20},(_,i)=>T-100000+i),refusal:'RPC_HTTP_429',refusalAt:T-100,sha256:'a'.repeat(64)},startedAt:T,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},record:(kind,data)=>handoff.observeTiming(kind,data)});
 let release:(()=>void)|undefined,next:ComponentBudget|undefined;
 try{
  handoff.observeTiming('native-paper-request-plan',plan(1));
  await assert.rejects(b.operate(HTTP,async op=>{await new Promise<void>(r=>{release=()=>{op.completeResponse();r();};});return 'late';},undefined,{requestId:id(1),timeoutMs:5,operationBoundMs:1200}),/PHYSICAL_TIMEOUT/);
  assert.equal(b.usage().inFlight,1);let observed=projectFinancialHandoffReporting(handoff.usage(at),at)!.requestTiming!;assert.equal(observed.physicalStarts,1);assert.equal(observed.physicalSettlements,0);assert.equal(observed.completeResponses,0);assert.equal(observed.methods[0]!.physical.count,0);
  at+=250;release!();await turn();await turn();assert.equal(b.usage().inFlight,0);observed=projectFinancialHandoffReporting(handoff.usage(at),at)!.requestTiming!;assert.equal(observed.physicalSettlements,1);assert.equal(observed.completeResponses,1);assert.deepEqual(observed.methods[0]!.physical,{count:1,sumMs:250,maxMs:250});
  const old=b.usage();b.close();next=new ComponentBudget({statePath:join(dir,'next-budget.json'),grantId:'fixture-settled-rollover',baseline:{calls:b.calls,bytes:b.bytes,starts:[...old.baseline.starts,...old.starts],refusal:'RPC_HTTP_429',refusalAt:T-100,sha256:'b'.repeat(64)},startedAt:at,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},record:(kind,data)=>handoff.observeTiming(kind,data)});
  handoff.observeTiming('native-paper-request-plan',plan(2,at));
  await assert.rejects(next.operate(HTTP,async op=>{op.completeResponse();assert.fail('local refusal must not invoke transport');},undefined,{requestId:id(2),timeoutMs:1000,operationBoundMs:1200,latestStartAt:T+9000,admissionOpen:()=>{if(at<T+1000)return true;handoff.observeTiming('native-paper-request-admission-refused',{...plan(2,T+250),at,requestedAt:T+250,requestedOperationMs:1200,reason:'required-native-service-deadline',bindingDeadlineAt:T+900,nativeServiceDeadlineAt:T+900,remainingCertificateMs:T+9999-at});return false;}}),/ADMISSION_CLOSED/);
  observed=projectFinancialHandoffReporting(handoff.usage(at),at)!.requestTiming!;assert.equal(observed.physicalStarts,1);assert.equal(observed.gateRefusals,1);assert.equal(observed.componentRefusals,1);assert.equal(observed.refusals.length,2);
  const refusal=observed.refusals.at(-1)!;assert.equal(refusal.origin,'component');assert.equal(refusal.requestId,id(2));assert.equal(refusal.reason,'required-native-service-deadline');assert.equal(refusal.bindingDeadlineAt,new Date(T+900).toISOString());assert.equal(refusal.stage,'after-pacing');assert.equal(refusal.pacingWaitMs,750);assert.equal(refusal.remainingCertificateMs,8999);assert.equal(refusal.transportStarted,false);assert.equal(refusal.physicalSettlementClaimed,false);
 }finally{release?.();await turn();next?.close();if(!b.usage().closed)b.close();}
});

test('refusal history stays bounded while current-run counts, negative remaining time and original timestamps remain exact',()=>{
 const handoff=new NativeFinancialHandoff(RUN,T,4);for(let n=0;n<20;n++)handoff.observeTiming('native-paper-request-admission-refused',{...plan(n,T+n),requestedAt:T+n,reason:'original-certificate-deadline',bindingDeadlineAt:T-1,certificateDeadlineAt:T-1,remainingCertificateMs:-(n+1)});
 const wire=projectFinancialHandoffReporting(handoff.usage(T+20),T+20)!;validateFinancialHandoffReporting(wire,T+20);const timing=wire.requestTiming!;assert.equal(timing.gateRefusals,20);assert.equal(timing.refusals.length,8);assert.equal(timing.refusals[0]!.at,new Date(T+12).toISOString());assert.equal(timing.refusals.at(-1)!.remainingCertificateMs,-20);assert.equal(timing.startedAt,new Date(T).toISOString());assert.ok(Buffer.byteLength(JSON.stringify(wire))<16384);
});

test('unknown physical settlement cannot invent a duration; uninvoked settlement and logical outcomes cannot become a completed physical request',()=>{
 const handoff=new NativeFinancialHandoff(RUN,T,4);handoff.observeTiming('component-physical-settled',{id:1,at:T+1,kind:HTTP,transportStarted:false,physicalSettlementObserved:false,responseComplete:true});handoff.observeTiming('component-physical-timeout',{id:1,at:T+2,kind:HTTP});handoff.observeTiming('component-physical-settled',{id:2,at:T+3,kind:HTTP,transportStarted:true,physicalSettlementObserved:true,responseComplete:false});
 const timing=projectFinancialHandoffReporting(handoff.usage(T+4),T+4)!.requestTiming!;assert.equal(timing.physicalStarts,0);assert.equal(timing.physicalSettlements,1);assert.equal(timing.completeResponses,0);assert.equal(timing.unmatchedSettlements,1);assert.deepEqual(timing.methods[0]!.physical,{count:0,sumMs:0,maxMs:0});
});

test('physical duration uses reported monotonic elapsed despite a wall-clock jump and stays unknown on older samples',()=>{
 const handoff=new NativeFinancialHandoff(RUN,T,4);handoff.observeTiming('component-physical-start',{id:1,at:T,kind:HTTP,enqueuedAt:T,pacingWaitMs:0});handoff.observeTiming('component-physical-settled',{id:1,at:T+10000,kind:HTTP,transportStarted:true,physicalSettlementObserved:true,responseComplete:true,physicalElapsedMs:20});
 handoff.observeTiming('component-physical-start',{id:2,at:T+10001,kind:HTTP,enqueuedAt:T+10001,pacingWaitMs:0});handoff.observeTiming('component-physical-settled',{id:2,at:T+20000,kind:HTTP,transportStarted:true,physicalSettlementObserved:true,responseComplete:true});
 const timing=projectFinancialHandoffReporting(handoff.usage(T+20001),T+20001)!.requestTiming!;assert.equal(timing.physicalStarts,2);assert.equal(timing.physicalSettlements,2);assert.deepEqual(timing.methods[0]!.physical,{count:1,sumMs:20,maxMs:20});assert.equal(timing.generatedAt,new Date(T+20001).toISOString());
});

test('timing projection prevents secret or cross-run context leakage and malformed optional timing cannot hide certificate counters',()=>{
 const handoff=new NativeFinancialHandoff(RUN,T,4);handoff.observeTiming('native-paper-request-plan',{...plan(1),requestId:'other-run:request:1',apiKey:'DO_NOT_EXPORT'});handoff.observeTiming('component-local-admission-refused',{at:T+2,enqueuedAt:T+1,callerRequestId:'other-run:request:1',kind:HTTP,code:'COMPONENT_ADMISSION_CLOSED',stage:'before-pacing',pacingWaitMs:0,privateError:'DO_NOT_EXPORT'});handoff.observeTiming('native-paper-request-admission-refused',{...plan(2,T+3),reason:'DO_NOT_EXPORT',method:'DO_NOT_EXPORT',apiKey:'DO_NOT_EXPORT'});
 const raw=handoff.usage(T+4) as any,wire=projectFinancialHandoffReporting(raw,T+4)!;assert.doesNotMatch(JSON.stringify(wire),/DO_NOT_EXPORT|other-run|apiKey|privateError/);assert.equal(wire.requestTiming!.refusals[0]!.mint,null);assert.equal(wire.requestTiming!.refusals[0]!.reason,null);assert.equal(wire.requestTiming!.refusals[1]!.reason,'OTHER_UNEXPORTED_REASON');assert.equal(wire.requestTiming!.refusals[1]!.method,null);
 const bad=structuredClone(wire.requestTiming!);bad.runId='other-run';assert.throws(()=>validateRequestTimingReporting(bad,T+4,RUN),/INVALID/);assert.equal(projectRequestTimingReporting({...raw.requestTiming,runId:'other-run'},T+4,RUN),undefined);raw.requestTiming.startedAt=T-1;assert.equal(projectFinancialHandoffReporting(raw,T+4)!.requestTiming,undefined,'same runId cannot launder a different observation interval');raw.requestTiming.startedAt=T+100;const retained=projectFinancialHandoffReporting(raw,T+4)!;assert.ok(retained);assert.equal(retained.requestTiming,undefined);assert.equal(retained.seen,0);
 for(const mutate of [(r:any)=>r.refusals[0].rawError='DO_NOT_EXPORT',(r:any)=>r.refusals[0].at=new Date(T+5).toISOString(),(r:any)=>r.methods.push({method:'PRIVATE',transport:'http'})]){const broken=structuredClone(wire.requestTiming!);mutate(broken);assert.throws(()=>validateRequestTimingReporting(broken,T+4,RUN),/INVALID/);}
});

test('old handoff frames remain valid without the additive request timing diagnostics',()=>{
 const raw=new NativeFinancialHandoff(RUN,T,4).usage(T) as any;delete raw.requestTiming;const wire=projectFinancialHandoffReporting(raw,T)!;assert.equal(wire.requestTiming,undefined);validateFinancialHandoffReporting(wire,T);
});

test('legacy sixteen active handoffs retain all method summaries and eight richly attributed refusals within32KiB',()=>{
 const handoff=new NativeFinancialHandoff(RUN,T,16);handoff.observe(T,Array.from('123456789ABCDEFG',c=>({mint:'1'.repeat(43)+c,windowEndAt:T-1000,deadlineAt:T+9999,admittedAt:T,openedAt:T-61000,featuresSha256:'a'.repeat(64)})));
 REQUEST_TIMING_METHODS.forEach((method,n)=>{const transport=n<8?'http':method==='upgrade'?'ws-upgrade':'ws',kind={method,transport};handoff.observeTiming('component-physical-start',{id:n,at:T+n*2,kind,enqueuedAt:T+n*2,pacingWaitMs:0});handoff.observeTiming('component-physical-settled',{id:n,at:T+n*2+1,kind,transportStarted:true,physicalSettlementObserved:true,responseComplete:true});});
 for(let n=0;n<8;n++){const at=T+100+n,context={...plan(n,at),requestedAt:at,reason:'required-native-service-deadline',bindingDeadlineAt:T+300,certificateDeadlineAt:T+9999,nativeServiceDeadlineAt:T+300,protectionLatestStartAt:T+400,callerLatestStartAt:T+9000,requestedOperationMs:1200,remainingCertificateMs:T+9999-at};handoff.observeTiming('native-paper-request-admission-refused',context);handoff.observeTiming('component-local-admission-refused',{at,enqueuedAt:at,callerRequestId:id(n),kind:HTTP,code:'COMPONENT_ADMISSION_CLOSED',stage:'after-pacing',latestStartAt:T+9000,remainingStartMs:9000-(at-T),requestedOperationMs:1200,physicalTimeoutMs:1000,queueElapsedMs:500,pacingWaitMs:250,plannedPacingWaitMs:250,reservationId:50+n});}
 const wire=projectFinancialHandoffReporting(handoff.usage(T+200),T+200)!;assert.ok(wire);assert.ok(wire.requestTiming);assert.equal(wire.requestTiming.methods.length,REQUEST_TIMING_METHODS.length);assert.equal(wire.requestTiming.refusals.length,8);assert.equal(wire.active.length,16);assert.ok(Buffer.byteLength(JSON.stringify(wire))<32768);
});

test('existing mobile diagnostic group renders the observed cutoff and pacing without claiming provider failure or settlement',()=>{
 const handoff=new NativeFinancialHandoff(RUN,T,4);handoff.observeTiming('native-paper-request-plan',plan(1));handoff.observeTiming('native-paper-request-admission-refused',{...plan(1),at:T+100,requestedAt:T,reason:'required-native-service-deadline',bindingDeadlineAt:T+99,remainingCertificateMs:9899});handoff.observeTiming('component-local-admission-refused',{at:T+100,enqueuedAt:T,callerRequestId:id(1),kind:HTTP,code:'COMPONENT_ADMISSION_CLOSED',stage:'after-pacing',requestedOperationMs:1200,pacingWaitMs:80,plannedPacingWaitMs:100});
 const wire=projectFinancialHandoffReporting(handoff.usage(T+101),T+101)!,source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8'),from=source.indexOf(' const handoff=intelligence.financialHandoff;'),through=source.indexOf(' const productivity=intelligence.slotProductivity;',from);assert.ok(from>=0&&through>from);
 const render=new Script('(function(intelligence,group,add,p){'+source.slice(from,through)+'})').runInNewContext(),groups:Array<[string,unknown[][]]>=[],notes:string[]=[];render({financialHandoff:wire},(title:string,rows:unknown[][])=>groups.push([title,rows]),(_p:unknown,_tag:string,text:string)=>notes.push(text),{});
 const text=JSON.stringify(groups);assert.match(text,/required-native-service-deadline/);assert.match(text,/80 ms \/ 100 ms/);assert.match(text,/Transport not started; no physical settlement claimed/);assert.match(text,new RegExp(new Date(T+99).toISOString().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(notes.join(' '),/not provider outages or strategy rejections/);assert.doesNotMatch(text,/0 ms \/ 0 ms|entry permitted|provider failed/i);
});
