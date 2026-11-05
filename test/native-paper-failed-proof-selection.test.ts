/** OFFLINE actual launcher selection and handoff branches. Synthetic current
 * certificates, the real bounded proof cache and real deadline planner; no
 * provider, ledger, order handler or host operation is opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {runNativePaper,nativePaperCurrentQualificationProof,nativePaperHandoffCategory,nativePaperRemainingEntryWork,nativePaperFinancialSelection,nativePaperManagementReserve,nativePaperFinancialProviderAvailable,nativePaperEntryWorkflowStarts,nativePaperSourceWorkAdmission} from '../src/run-native-paper.js';
import {NativePaperProofPreparation} from '../src/native-paper-proof-preparation.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {pilotLowerPriorityAdmission,PILOT_TIMING,pilotOpenProtectionGaps} from '../src/pilot.js';
import type {NativeQualificationProof} from '../src/native-paper.js';
import {PAPER_TWO_HOLDING_OPERATING_POLICY,paperEntryCapacity} from '../src/paper-operating-capacity.js';

type Outcome='complete'|'failed'|'pending'|'missing';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function proofFor(c:NativeAuditCertificate,at:number):NativeQualificationProof{return {proofId:['entry',c.mint,c.windowEndAt,c.admittedAt,c.featuresSha256].join(':'),mint:c.mint,startAt:c.windowStartAt,throughAt:at,windowEndAt:c.windowEndAt,featuresSha256:c.featuresSha256,certificateAt:c.admittedAt,deadlineAt:c.deadlineAt};}

async function fixture(outcomes:Outcome[],options:{coldFirst?:boolean;allCold?:boolean;owned?:boolean;lastCompletedAgeMs?:number;shortStarts?:number;minuteStarts?:number;actualGates?:boolean;preliminaryFirst?:boolean;intakeUnavailable?:boolean}={}){
 let at=100500;const events:any[]=[],qualificationReads:string[]=[],supportReads:string[]=[],preparationRequests:string[]=[],certificateReads:string[]=[],pinCalls:string[]=[],settlePending:(()=>void)[]=[];
 const certificates=outcomes.map((_,i)=>({schemaVersion:1,mint:'OFFLINE_'+String.fromCharCode(65+i),pool:'OFFLINE_POOL_'+i,dataContract:'OFFLINE',openedAt:40000,connectionId:1,subscriptionId:i+2,windowStartAt:40000,windowEndAt:100000,auditAvailableAt:100100,admittedAt:100100,deadlineAt:110000,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:String.fromCharCode(97+i).repeat(64)} as unknown as NativeAuditCertificate));
 const cache=new NativePaperProofPreparation(()=>at),originalProofs=certificates.map(c=>proofFor(c,at));
 // Existing completed/failed records can coexist with one live pending pin.
 for(const outcome of ['complete','failed','pending'] as const)for(let i=0;i<outcomes.length;i++)if(outcomes[i]===outcome){
  cache.prepare(originalProofs[i]!,async proof=>{pinCalls.push(proof.mint);if(outcome==='failed')throw Error('OFFLINE_PIN_UNAVAILABLE');if(outcome==='pending')await new Promise<void>(resolve=>settlePending.push(resolve));});await turn();
 }
 const handoff=new NativeFinancialHandoff('offline',0,4,(_,row)=>events.push(row)),priority=new Set<string>(['OFFLINE_STALE_PRIORITY']),holder:any={};
 const engine:any={now:()=>at,financialView:null,open:()=>true,deadlineView:()=>({requiredNativeAt:null,readyCount:certificates.length}),currentAuditCertificate:(mint:string,when:number)=>{certificateReads.push(mint);return certificates.find(c=>c.mint===mint&&when>=c.admittedAt&&when<=c.deadlineAt)??null;},certifiedCandidateMints:(when:number)=>certificates.filter(c=>when>=c.admittedAt&&when<=c.deadlineAt).map(c=>c.mint),candidateEvaluationOrder:(mints:string[])=>mints};
 engine.withFinancialView=(when:number,read:()=>unknown)=>NativeCandidateRunner.prototype.withFinancialView.call(engine,when,read);
 engine.financialAdmission=(c:NativeAuditCertificate,bound:number,when:number)=>NativeCandidateRunner.prototype.financialAdmission.call(engine,c,bound,when);
 const selectionEvents:any[]=[];
 const statuses=certificates.map((c,i)=>options.allCold||options.coldFirst&&i===0?{state:'layout-required',remainingReads:3,quoteReads:2,expiresAt:null,ready:false}:{state:'ready',remainingReads:0,quoteReads:1,expiresAt:120000,ready:true});
 const context:any={financialSelectionSnapshot:null,lastFinancialSelectionKey:null,currentLedger:{state:()=>({positions:options.owned?{OFFLINE_HELD:{units:'1'}}:{},pending:{}}),v3RiskPolicyActive:()=>true,entryCapacity:(maximum:number|null,current?:any)=>paperEntryCapacity(current??context.currentLedger.state(),maximum,PAPER_TWO_HOLDING_OPERATING_POLICY)},manualAdmissionPause:{entryReason:()=>null},configuration:{binding:{maxPositions:null}},RESEARCH_CLOCK_COHERENT_POOL_CAPACITY:24,endAt:Number.MAX_SAFE_INTEGER,lastCompleted:options.owned?at-(options.lastCompletedAgeMs??0):null,financialCapacityReason:()=>null,nativePaperFinancialSelection,nativePaperManagementReserve,nativePaperFinancialProviderAvailable,nativePaperEntryWorkflowStarts,pilotLowerPriorityAdmission,PILOT_TIMING,marketIntake:options.intakeUnavailable?{available:()=>false}:null,record:(kind:string,data:unknown)=>{if(kind==='native-paper-financial-selection')selectionEvents.push(data);},__name:(value:unknown)=>value,holder,Date:{now:()=>at},financialCandidates:certificates.map(c=>c.mint),financialEvaluationCandidates:priority,currentEngine:engine,service:true,args:{strategy:'liquidity-resilient-momentum-v3.1'},LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:'liquidity-resilient-momentum-v3.1',nativePaperCurrentQualificationProof:(bridge:any,mint:string)=>nativePaperCurrentQualificationProof(bridge,mint,()=>at),currentBridge:{trader:{nextDueAt:()=>null},qualificationProof:(mint:string)=>{qualificationReads.push(mint);if(options.preliminaryFirst&&mint===certificates[0]?.mint)return null;const c=certificates.find(row=>row.mint===mint);return c?proofFor(c,at):null;}},nativePaperRemainingEntryWork,market:{entryPreparationStatus:(mint:string)=>{supportReads.push(mint);return statuses[certificates.findIndex(c=>c.mint===mint)]!;}},plannedEntryWork:null,held:options.owned?1:0,proofPreparation:cache,prepareQualificationProof:(c:NativeAuditCertificate)=>{preparationRequests.push(c.mint);return false;},riskCapacity:()=>true,currentRpc:{available:()=>true,usage:()=>({closed:false,fatal:null,cooldownUntil:0,inFlight:0,waitingOrOperating:false,dispatchWindow:{readyAt:at,physicalBusy:false},requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:options.minuteStarts??0,rolling10SecondStarts:options.shortStarts??0}})},entryStartsRemaining:()=>9,lowerView:()=>({admitted:true,latestStartAt:at+10000}),financialHandoff:handoff,entryCapacityReason:()=>null,nativePaperHandoffCategory,NATIVE_DEADLINE_POLICY};
 Object.assign(context,{continuing:null,financialContinuation:null});Object.assign(context.currentBridge,{candidateDue:()=>true,ownership:()=>false});
 const source=runNativePaper.toString(),begin=source.indexOf('const financialAt=Date.now(),financialFrame='),waitBegin=source.indexOf('if(candidate&&handoffCertificate&&proof&&!proofReady&&!preparationRequired&&plannedEntryWork){',begin),waitEnd=source.indexOf('if(candidate&&handoffCertificate&&preparationRequired){',waitBegin),end=source.search(/if\s*\(candidate\s*&&\s*entryRunwayAvailable/);
 assert.ok(begin>=0&&waitBegin>begin&&waitEnd>waitBegin&&end>waitEnd,'execute the actual synchronous financial frame through fresh final admission and peer deferral');
 // Selection-only fixture: the existing asynchronous pin wait is covered by
 // the real runner/SDK continuation suite. Keep the complete current frame,
 // preparation/admission and peer-deferral branches; open no timer or provider.
 const selectionSource=source.slice(begin,waitBegin)+source.slice(waitEnd,end);
 let prefix='';
 if(options.actualGates){
  Object.assign(context,{reportingHealth:{entryAllowed:true},marketIntake:options.intakeUnavailable?{available:()=>false}:null,marketRegistry:null,managementOnly:false,manualPaused:false,safeStopRequested:false,existsSync:()=>false,join:(...parts:string[])=>parts.join('/'),root:'/OFFLINE',admissionPausePath:'/OFFLINE/pause',stopped:false,sourceClosed:false,currentNative:{usage:()=>({fatal:null})},financialProjectionReady:true,pilotOpenProtectionGaps,completed:new Map(),startedAt:at,serviceResources:{view:()=>({newRiskAllowed:true,candidateAdmissionAllowed:true})},serviceEvidenceHealthy:true,serviceRecorder:{usage:()=>({candidateAdmissionAllowed:true})},backupReady:true,serviceSupervision:()=>({newRiskAllowed:true}),statfsSync:()=>({bavail:1024*1024,bsize:4096}),MIB:1024*1024,sourceInformationAdmission:()=>true,nativePaperSourceWorkAdmission,workOwner:{current:'idle'},entryToken:null,ledger:context.currentLedger,rpc:context.currentRpc,priorColdPlan:nativePaperRemainingEntryWork({at,owned:false,preparation:statuses[0]!})});
  const sourceBegin=source.indexOf('const entryStartsRemaining='),sourceEnd=source.indexOf('const lowerView=',sourceBegin),gateBegin=source.indexOf('const financialCapacityReason='),gateEnd=source.indexOf('bridge=new NativePaper',gateBegin);assert.ok(sourceBegin>0&&sourceEnd>sourceBegin&&gateBegin>0&&gateEnd>gateBegin);
  prefix=source.slice(source.indexOf('const sourceInformationAdmission='),source.indexOf('let plannedEntryWork'))+'let plannedEntryWork=priorColdPlan;'+source.slice(sourceBegin,sourceEnd)+source.slice(gateBegin,gateEnd)+';holder.sourceAdmission=sourceAdmission;holder.financialCapacityReason=financialCapacityReason;holder.entryCapacityReason=entryCapacityReason;const riskCapacity=(at)=>entryCapacityReason(at)===null;';
  engine.open=()=>holder.sourceAdmission();
 }
 const code='(async()=>{'+prefix+'for(let once=0;once<1;once++){'+selectionSource+';holder.candidate=candidate;holder.proofReady=proofReady;holder.entryRunwayAvailable=entryRunwayAvailable;holder.certificate=handoffCertificate;holder.plan=plannedEntryWork;}})()';
 const run=async()=>{await runInNewContext(code,context,{timeout:1000});assert.equal(engine.financialView,null,'the actual synchronous view closes before final admission or any await');return {...holder};};
 return {cache,certificates,originalProofs,statuses,selectionEvents,capacity:()=>({financial:holder.financialCapacityReason?.(at),entry:holder.entryCapacityReason?.(at),source:holder.sourceAdmission?.()}),selection:()=>context.financialSelectionSnapshot,events,priority,qualificationReads,supportReads,preparationRequests,certificateReads,pinCalls,handoff,run,get at(){return at;},set at(value:number){at=value;},async close(){for(const done of settlePending)done();await turn();}};
}

test('an exact terminal failed A cannot block complete B or overwrite its own failure attribution',async t=>{
 const f=await fixture(['failed','complete','complete']);t.after(f.close);const before=JSON.stringify(f.certificates),selected=await f.run();
 assert.equal(selected.candidate,'OFFLINE_B');assert.equal(selected.proofReady,true);assert.equal(selected.entryRunwayAvailable,true);assert.equal(selected.certificate.deadlineAt,110000);
 assert.deepEqual([...f.priority],['OFFLINE_B','OFFLINE_C']);assert.deepEqual(f.qualificationReads,['OFFLINE_B','OFFLINE_C'],'each viable peer is qualified once; selection reuses the same synchronous proof');assert.deepEqual(f.supportReads,['OFFLINE_B','OFFLINE_C']);assert.deepEqual(f.preparationRequests,[]);
 const failed=f.events.filter(row=>row.mint==='OFFLINE_A');assert.equal(failed.length,1);assert.equal(failed[0].blockingPrerequisite,'PROOF_RETENTION_UNAVAILABLE');assert.equal(failed[0].operation,'PROOF_PREPARATION');assert.equal(failed[0].requiredMs,null);assert.equal(failed[0].availableMs,9500);assert.equal(failed[0].observedAt,f.at);assert.equal(failed[0].financialPermission,false);
 assert.equal(f.events.find(row=>row.mint==='OFFLINE_C')?.blockingPrerequisite,'AWAIT_EARLIER_CANDIDATE');assert.equal(f.events.some(row=>row.mint==='OFFLINE_A'&&row.blockingPrerequisite==='AWAIT_EARLIER_CANDIDATE'),false);
 const usage=f.handoff.usage(f.at);assert.equal(usage.seen,3);assert.equal(usage.active.length,3);assert.equal(usage.economicDecisions,0);assert.equal(usage.financialEvaluations,0);assert.equal(JSON.stringify(f.certificates),before);
 f.at+=50;await f.run();assert.equal(f.events.filter(row=>row.mint==='OFFLINE_A').length,1,'unchanged failure attribution is not repeatedly emitted');assert.equal(f.cache.usage(f.originalProofs[0]!)?.state,'failed');assert.equal(f.pinCalls.length,3,'selection adds no proof pin or queue');
});

test('skipping multiple exact failures preserves the existing order of all remaining candidates',async t=>{
 const f=await fixture(['failed','failed','complete','complete']);t.after(f.close);const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_C');assert.equal(selected.entryRunwayAvailable,true);assert.deepEqual([...f.priority],['OFFLINE_C','OFFLINE_D']);
 for(const mint of ['OFFLINE_A','OFFLINE_B'])assert.deepEqual(f.events.filter(row=>row.mint===mint).map(row=>row.blockingPrerequisite),['PROOF_RETENTION_UNAVAILABLE']);assert.equal(f.handoff.usage(f.at).seen,4);
});

test('all exact terminal failures retain handoff history but release impossible transient financial priority',async t=>{
 const f=await fixture(['failed','failed']);t.after(f.close);const selected=await f.run();assert.equal(selected.candidate,undefined);assert.equal(selected.entryRunwayAvailable,false);assert.deepEqual([...f.priority],[]);assert.deepEqual(f.qualificationReads,[]);assert.deepEqual(f.supportReads,[]);
 assert.equal(f.handoff.usage(f.at).seen,2);assert.equal(f.handoff.usage(f.at).active.length,2);assert.deepEqual(f.events.map(row=>row.blockingPrerequisite),['PROOF_RETENTION_UNAVAILABLE','PROOF_RETENTION_UNAVAILABLE']);
});

for(const outcome of ['pending','missing'] as const)test(`a ${outcome} proof yields to a complete feasible peer without losing its retained handoff`,async t=>{
 const f=await fixture([outcome,'complete']);t.after(f.close);const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_B');assert.equal(selected.proofReady,true);assert.equal(selected.entryRunwayAvailable,true);assert.deepEqual([...f.priority],['OFFLINE_B','OFFLINE_A']);assert.deepEqual(f.preparationRequests,[]);
 assert.equal(f.events.find(row=>row.mint==='OFFLINE_A')?.blockingPrerequisite,'AWAIT_EARLIER_CANDIDATE');assert.equal(f.events.some(row=>row.mint==='OFFLINE_B'&&row.blockingPrerequisite==='AWAIT_EARLIER_CANDIDATE'),false);assert.equal(f.events.some(row=>row.blockingPrerequisite==='PROOF_RETENTION_UNAVAILABLE'),false);
});

test('every changed stable certificate field prevents a previous failure from excluding new evidence',async t=>{
 for(const field of ['windowStartAt','windowEndAt','featuresSha256','admittedAt','deadlineAt'] as const){
  const f=await fixture(['failed','complete']);t.after(f.close);const c=f.certificates[0]!;if(field==='featuresSha256')c.featuresSha256='f'.repeat(64);else c[field]+=1;
  const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_B',field);assert.deepEqual([...f.priority],['OFFLINE_B','OFFLINE_A'],field);assert.equal(f.events.some(row=>row.mint==='OFFLINE_A'&&row.blockingPrerequisite==='PROOF_RETENTION_UNAVAILABLE'),false,field);assert.deepEqual(f.preparationRequests,[],field);f.certificates[1]!.deadlineAt=f.at-1;const next=await f.run();assert.equal(next.candidate,'OFFLINE_A',field);assert.deepEqual(f.preparationRequests,['OFFLINE_A'],field);
 }
});

/** The live M3EZ/WE52 bracket proves head blocking, but does not export the
 * waiting peer's preparation. These current-class fixtures supply that state
 * explicitly; no recovered live quote, coverage, trade or rescue is asserted. */
test('an unfit cold certificate yields to a warm peer under original deadlines and remains eligible if its stable preparation completes',async t=>{
 const f=await fixture(['complete','complete'],{coldFirst:true,actualGates:true});t.after(f.close);f.at=106000;
 const before=JSON.stringify(f.certificates),pins=f.pinCalls.length,selected=await f.run();
 assert.equal(selected.candidate,'OFFLINE_B');assert.equal(selected.entryRunwayAvailable,true);assert.equal(selected.plan.remainingSequenceMs,1450);
 const [cold,warm]=f.selection()!.candidates;assert.equal(cold.reason,'ORIGINAL_CERTIFICATE_DEADLINE');assert.equal(cold.requiredMs,6675);assert.equal(cold.availableMs,4000);assert.equal(warm.reason,'READY_FINANCIAL_DECISION');
 assert.deepEqual([...f.priority],['OFFLINE_B']);assert.equal(f.handoff.usage(f.at).active.length,2,'only transient scheduling priority is released');
 assert.equal(f.cache.ready(f.originalProofs[0]!),true);assert.equal(f.pinCalls.length,pins);assert.equal(JSON.stringify(f.certificates),before);
 const refusal=f.events.find(row=>row.mint==='OFFLINE_A');assert.equal(refusal.blockingPrerequisite,'ORIGINAL_CERTIFICATE_DEADLINE');assert.equal(refusal.observedAt,106000);assert.equal(refusal.requiredMs,6675);assert.equal(refusal.availableMs,4000);assert.equal(refusal.remainingWork.sampledAt,106000);
 f.at+=50;await f.run();assert.equal(f.selectionEvents.length,1,'unchanged ranking/reasons do not emit a record every turn');
 Object.assign(f.statuses[0]!,{state:'ready',remainingReads:0,quoteReads:1,expiresAt:120000,ready:true});f.at=107000;
 const recovered=await f.run();assert.equal(recovered.candidate,'OFFLINE_A');assert.equal(recovered.entryRunwayAvailable,true);assert.equal(recovered.certificate.deadlineAt,110000);assert.equal(f.cache.ready(f.originalProofs[0]!),true);assert.equal(f.pinCalls.length,pins);assert.equal(JSON.stringify(f.certificates),before);
});

test('candidate-specific short-window capacity admits the warm peer through actual source and final entry gates despite a prior cold plan',async t=>{
 const f=await fixture(['complete','complete'],{coldFirst:true,actualGates:true,shortStarts:18});t.after(f.close);
 const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_B');assert.equal(selected.entryRunwayAvailable,true);
 const [cold,warm]=f.selection()!.candidates;assert.equal(cold.reason,'ENTRY_PROVIDER_CAPACITY');assert.equal(cold.remainingStarts,4);assert.equal(warm.remainingStarts,1);
 assert.equal(cold.providerCapacity.rolling10SecondHeadroom,2);assert.equal(warm.providerCapacity.rolling10SecondHeadroom,2);assert.equal(warm.reason,'READY_FINANCIAL_DECISION');
 assert.equal(selected.plan.maximumAccountedStarts,1);assert.equal(f.pinCalls.length,2);assert.deepEqual(f.preparationRequests,[]);
});

for(const outcomes of [['pending','missing'],['missing','missing']] as Outcome[][])test(`all unready proofs preserve a bounded original recovery turn ${outcomes.join('/')}`,async t=>{
 const f=await fixture(outcomes);t.after(f.close);const selected=await f.run();
 assert.equal(selected.candidate,'OFFLINE_A');assert.equal(selected.entryRunwayAvailable,false);assert.equal(f.selection()!.selection,'waiting');assert.deepEqual(f.preparationRequests,['OFFLINE_A']);assert.deepEqual([...f.priority],['OFFLINE_A','OFFLINE_B']);
 assert.equal(f.handoff.usage(f.at).dispatched,0);assert.equal(f.handoff.usage(f.at).active.length,2);assert.equal(f.selection()!.candidates[0]!.reason,'PROOF_PENDING');
});

test('all deadline-infeasible certificates remain retained until their exact original expiry without new proof or preparation work',async t=>{
 const f=await fixture(['complete','complete'],{allCold:true});t.after(f.close);const original=JSON.stringify(f.certificates);f.at=106000;
 const selected=await f.run();assert.equal(selected.candidate,undefined);assert.equal(selected.entryRunwayAvailable,false);assert.deepEqual([...f.priority],[]);assert.equal(f.handoff.usage(f.at).active.length,2);assert.equal(f.cache.ready(f.originalProofs[0]!),true);
 assert.deepEqual(f.preparationRequests,[]);assert.equal(f.pinCalls.length,2);assert.ok(f.selection()!.candidates.every((row:any)=>row.reason==='ORIGINAL_CERTIFICATE_DEADLINE'));
 f.at=110000;await f.run();assert.equal(f.handoff.usage(f.at).active.length,2,'the unchanged inclusive deadline still belongs to its original certificate');
 f.at=110001;await f.run();assert.equal(f.handoff.usage(f.at).active.length,0);assert.equal(f.handoff.usage(f.at).expiredBeforeDispatch,2);assert.equal(JSON.stringify(f.certificates),original);
});

test('selection does not make inadequate holding reserves or protection runway into financial permission',async t=>{
 const cases=[{owned:true,shortStarts:17,minuteStarts:87},{owned:true,lastCompletedAgeMs:2000}];
 for(const options of cases){const f=await fixture(['complete','complete'],options);t.after(f.close);
  // Use the actual planner with real shared rolling-reserve and preservation
  // gates. A waiting recovery identity is deliberately not ready permission.
  const at=f.at,c=f.certificates[0]!,plan=nativePaperRemainingEntryWork({at,owned:true,preparation:f.statuses[0]!});
  const usage={requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:options.minuteStarts??0,rolling10SecondStarts:options.shortStarts??0}} as any;
  const reserve=nativePaperManagementReserve(usage,true,true,plan.maximumAccountedStarts),preservation=pilotLowerPriorityAdmission({now:at,endAt:Number.MAX_SAFE_INTEGER,held:1,lastUsable:at-(options.lastCompletedAgeMs??0),nextPendingAt:null,operationBoundMs:plan.quoteOperationMs});
  const owner:any={open:()=>true,deadlineView:()=>({requiredNativeAt:null,readyCount:2}),currentAuditCertificate:()=>c};const admission=NativeCandidateRunner.prototype.financialAdmission.call(owner,c,plan.decisionWorkMs,at);
  const result=nativePaperFinancialSelection({at,candidates:[{certificate:c,plan,proofState:'complete',admission,preservation,capacityAllowed:reserve.entryAllowed}],permissionReason:null,provider:{available:true,busy:false,readyAt:at}});
  assert.equal(result.selection,'waiting');assert.notEqual(result.candidates[0]!.reason,'READY_FINANCIAL_DECISION');
  assert.equal(result.candidates[0]!.reason,options.shortStarts?'ENTRY_PROVIDER_CAPACITY':'HOLDING_PROTECTION_RUNWAY');assert.equal(result.financialPermissionGranted,false);assert.equal(c.deadlineAt,110000);assert.equal(plan.contextStarts,2);
 }
});

test('a preliminary rejection without a buying proof does not acquire fabricated preparation or pin requirements',async t=>{
 const f=await fixture(['missing','pending'],{coldFirst:true,preliminaryFirst:true,actualGates:true});t.after(f.close);f.at=106000;
 const selected=await f.run();assert.equal(selected.candidate,'OFFLINE_A');assert.equal(selected.proofReady,true);assert.equal(selected.entryRunwayAvailable,true);
 const row=f.selection()!.candidates[0]!;assert.equal(row.proofState,'not-required');assert.equal(row.preparationRequired,false);assert.equal(row.requiredMs,1575);assert.equal(row.reason,'READY_FINANCIAL_DECISION');assert.deepEqual(f.preparationRequests,[]);assert.equal(f.pinCalls.length,1,'only the fixture’s original peer pin exists');
});

test('unavailable optional intake preserves healthy financial admission while actual source/new-entry gates remain closed',async t=>{
 const f=await fixture(['complete','complete'],{actualGates:true,intakeUnavailable:true});t.after(f.close);const selected=await f.run();
 assert.equal(f.capacity().financial,null,'the unchanged finance predicate still accepts actual healthy reconciliation/recovery');assert.equal(f.capacity().entry,'MARKET_INTAKE_UNAVAILABLE');assert.equal(f.capacity().source,false);assert.equal(selected.entryRunwayAvailable,false);assert.equal(f.selection()!.selection,'waiting');assert.ok(f.selection()!.candidates.every((row:any)=>row.reason==='MARKET_INTAKE_UNAVAILABLE'));assert.equal(f.handoff.usage(f.at).dispatched,0);
});
