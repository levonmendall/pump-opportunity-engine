/** OFFLINE exact launcher branches and real admission/planning functions.
 * Fixtures are source-shaped; missing live plans are never reconstructed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {NativeFinancialHandoff,type HandoffCertificate} from '../src/native-financial-handoff.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {runNativePaper,nativePaperRemainingEntryWork,nativePaperHandoffCategory} from '../src/run-native-paper.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION} from '../src/liquidity-resilient-momentum-v3-1.js';
import {projectFinancialHandoffReporting,validateFinancialHandoffReporting} from '../src/financial-handoff-reporting.js';

const AT=1793768315743;
function certificate(deadlineAt=AT+3000):NativeAuditCertificate{
 return {schemaVersion:1,mint:'1'.repeat(32),pool:'2'.repeat(32),dataContract:'OFFLINE',openedAt:AT-65000,connectionId:1,subscriptionId:2,windowStartAt:AT-65000,windowEndAt:deadlineAt-9999,auditAvailableAt:AT-100,admittedAt:AT-100,deadlineAt,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)} as unknown as NativeAuditCertificate;
}
function realEngine(c:NativeAuditCertificate,nativeAt:number|null=null){
 const admissions:any[]=[],engine:any={open:()=>true,deadlineView:()=>({requiredNativeAt:nativeAt,readyCount:1}),currentAuditCertificate:(_mint:string,at:number)=>at<=c.deadlineAt?c:null};
 engine.financialAdmission=(candidate:NativeAuditCertificate,bound:number,at:number)=>{const result=NativeCandidateRunner.prototype.financialAdmission.call(engine,candidate,bound,at);admissions.push({at,result});return result;};
 return {engine,admissions};
}
function preparationSnippet(){
 const source=runNativePaper.toString(),begin=source.search(/let\s+entryPreparationDeferral\s*=/),tail=source.slice(begin),end=tail.search(/const\s+makeFeeds\s*=/);
 assert.ok(begin>=0&&end>0,'exact preparation implementation, not a mirrored helper');
 const handoffBegin=source.search(/if\s*\(candidate\s*&&\s*handoffCertificate\s*&&\s*preparationRequired\)/),handoffTail=source.slice(handoffBegin),handoffEnd=handoffTail.search(/const\s+newRisk\s*=/);
 assert.ok(handoffBegin>=0&&handoffEnd>0,'exact selected-certificate deferral call');
 return {preparation:tail.slice(0,end),handoff:handoffTail.slice(0,handoffEnd)};
}

async function preparationCase(input:{permission?:string;nativeAt?:number;staleZeroRead?:boolean;deferDelayMs?:number}={}){
 const c=certificate(),{engine,admissions}=realEngine(c,input.nativeAt??null),events:any[]=[],handoff=new NativeFinancialHandoff('offline',0,4,(_,value)=>events.push(value));
 handoff.observe(AT-1,[c]);const target={mint:c.mint,openedAt:c.openedAt,windowEndAt:c.windowEndAt,deadlineAt:c.deadlineAt,certificate:c};engine.financialPreparationTargets=()=>[target];
 let preparationReads=0,invalidations=0,providerCalls=0,clockReads=0;
 const observations=Object.freeze({layout:Object.freeze({requestedAt:AT-150,receivedAt:AT-100}),shortRent:Object.freeze({requestedAt:AT-8900,receivedAt:AT-8800}),otherRent:Object.freeze({requestedAt:AT-150,receivedAt:AT-100})}),preparationRequests:Array<{mint:string;observedAt:number;requiredValidThroughAt:number}>=[];
 const context:any={__name:(v:unknown)=>v,Date:{now:()=>++clockReads===1?AT:AT+(input.deferDelayMs??0)},service:true,serviceGeneration:1,
  args:{strategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION},LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,
  currentEngine:engine,currentLedger:{state:()=>({positions:{},pending:{}})},currentBridge:{ownership:()=>false},
  financialCapacityReason:()=>input.permission??null,sourceAdmission:()=>true,lowerView:()=>({admitted:true}),
  market:{entryPreparationStatus:(mint:string,observedAt:number,requiredValidThroughAt=observedAt)=>{preparationReads++;preparationRequests.push({mint,observedAt,requiredValidThroughAt});if(!input.staleZeroRead)return {remainingReads:3,quoteReads:2,expiresAt:null,ready:false,state:'layout-required'};const expiresAt=observations.shortRent.receivedAt+10000,short=expiresAt<Math.max(observedAt,requiredValidThroughAt);return {remainingReads:short?1:0,quoteReads:2,expiresAt,ready:!short,state:short?'rent-required':'ready'};},invalidateEntryPreparation:()=>{invalidations++;},prepareEntryCostTurn:async()=>{providerCalls++;throw Error('must not invoke an infeasible turn');}},
  currentRpc:{usage:()=>({})},nativePaperRemainingEntryWork,nativePaperManagementReserve:()=>({entryAllowed:true}),NATIVE_DEADLINE_POLICY,
  financialHandoff:handoff,nativePaperHandoffCategory,candidate:c.mint,handoffCertificate:c,preparationRequired:true,
  workOwner:{enter:()=>{throw Error('no ownership change on refusal');}},record:()=>{throw Error('no per-loop runtime record');},AbortController};
 const snippets=preparationSnippet();
 await runInNewContext('(async()=>{'+snippets.preparation+'for(let once=0;once<1;once++){'+snippets.handoff+'}})()',context,{timeout:1000});
 return {c,events,handoff,admissions,preparationReads,invalidations,providerCalls,observations,preparationRequests};
}

test('actual refused preparation retains original whole plan and admitted operation without pretending the sequence fits',async()=>{
 const f=await preparationCase(),row=f.events[0];assert.equal(f.events.length,1);assert.equal(f.providerCalls,0);assert.equal(f.admissions.length,1);
 assert.equal(row.blockingPrerequisite,'ORIGINAL_CERTIFICATE_DEADLINE');assert.equal(row.requiredMs,1700);assert.equal(row.availableMs,0);
 const work=row.remainingWork;assert.equal(work.version,'native-entry-remaining-work-v1');assert.equal(work.sampledAt,AT);assert.equal(work.plan.at,AT);
 assert.equal(work.plan.preparationReads,3);assert.equal(work.plan.quoteReads,1);assert.equal(work.plan.preparationWorkMs,5100);assert.equal(work.plan.decisionWorkMs,1450);assert.equal(work.plan.remainingSequenceMs,6550);
 assert.equal(work.plan.preparationExpiresAt,null);assert.equal(work.admission.admitted,true,'one1700ms operation fit, but the existing whole-sequence guard refused');
 assert.equal(work.admission.observedAt,AT);assert.equal(work.admission.requestedOperationMs,1700);assert.equal(work.admission.postValidationMs,125);assert.equal(work.admission.completionDeadlineAt,f.c.deadlineAt);
 assert.deepEqual(work.certificate,{mint:f.c.mint,windowEndAt:f.c.windowEndAt,deadlineAt:f.c.deadlineAt,admittedAt:f.c.admittedAt,openedAt:f.c.openedAt,featuresSha256:f.c.featuresSha256});
 assert.equal(row.financialPermission,false);assert.equal(f.handoff.usage(AT).dispatched,0);
});

test('an early permission refusal remains null and does not obtain a plan merely for diagnostics',async()=>{
 const f=await preparationCase({permission:'PROTECTION_RECOVERY_REQUIRED'}),row=f.events[0];
 assert.equal(row.blockingPrerequisite,'PROTECTION_RECOVERY_REQUIRED');assert.equal(row.remainingWork,null);assert.equal(f.preparationReads,0);assert.equal(f.admissions.length,0);assert.equal(f.providerCalls,0);
 f.handoff.observe(f.c.deadlineAt+1,[]);assert.equal(f.events.at(-1).remainingWork,null);
});

test('actual delayed preparation deferral preserves its original blocker clock through expiry',async()=>{
 const f=await preparationCase({deferDelayMs:250}),row=f.events[0];
 assert.equal(row.at,AT+250,'receipt is emitted after the actual async preparation return');assert.equal(row.observedAt,AT,'blocker retains the time its availableMs was calculated');
 assert.equal(row.remainingWork.sampledAt,AT);assert.equal(row.remainingWork.plan.at,AT);assert.equal(row.availableMs,0);assert.equal(f.admissions.length,1);assert.equal(f.providerCalls,0);
 assert.equal(f.handoff.usage(AT+250).active[0]!.observedAt,AT);
 f.handoff.observe(f.c.deadlineAt+1,[]);const expiry=f.events.at(-1);assert.equal(expiry.stage,'expired-before-dispatch');assert.equal(expiry.blockerObservedAt,AT);assert.equal(expiry.remainingWork.sampledAt,AT);assert.equal(expiry.at,f.c.deadlineAt+1);
});

test('future or malformed original blocker clocks are refused; existing callers retain emission-time default',()=>{
 const c=certificate(),events:any[]=[],h=new NativeFinancialHandoff('offline',0,4,(_,v)=>events.push(v));h.observe(AT-1,[c]);
 const detail={blockingPrerequisite:'ORIGINAL_CERTIFICATE_DEADLINE',operation:'ENTRY_PREPARATION',requiredMs:1700,availableMs:0};
 for(const observedAt of [AT+1,-1,1.5,Number.NaN,null])h.defer(c,'required-service-or-protection-runway',AT,{...detail,observedAt:observedAt as number});
 assert.equal(events.length,0);assert.equal(h.usage(AT).active[0]!.reason,'await-financial-dispatch');assert.equal(h.usage(AT).deferralTransitionsByReason['required-service-or-protection-runway'],0);
 h.defer(c,'required-service-or-protection-runway',AT,detail);assert.equal(events.length,1);assert.equal(events[0].observedAt,AT);
 h.observe(c.deadlineAt+1,[]);assert.equal(events.at(-1).blockerObservedAt,AT);
});

test('an actual native deadline refusal retains its original binding deadline and validation reserve',async()=>{
 const f=await preparationCase({nativeAt:AT+1000}),row=f.events[0];assert.equal(row.blockingPrerequisite,'REQUIRED_NATIVE_SERVICE_DEADLINE');
 assert.equal(row.remainingWork.admission.admitted,false);assert.equal(row.remainingWork.admission.nativeServiceLatestAt,AT+1000);assert.equal(row.remainingWork.admission.completionDeadlineAt,AT+1000);assert.equal(row.remainingWork.admission.latestStartAt,AT-825);
 assert.equal(row.remainingWork.certificate.deadlineAt,AT+3000,'native deadline never overwrites original certificate expiry');assert.equal(f.providerCalls,0);
});

test('a known short rent is replanned at the original decision horizon without blanket invalidation or timestamp renewal',async()=>{
 const f=await preparationCase({staleZeroRead:true}),row=f.events[0];assert.equal(f.events.length,1);assert.equal(f.invalidations,0,'a known insufficient rent does not discard valid layout or peer facts');assert.equal(f.preparationReads,3);assert.equal(f.admissions.length,1);assert.equal(f.providerCalls,0,'the full remaining sequence must fit before a physical refresh starts');
 assert.deepEqual(f.preparationRequests,[{mint:f.c.mint,observedAt:AT,requiredValidThroughAt:AT},{mint:f.c.mint,observedAt:AT,requiredValidThroughAt:AT+2775},{mint:f.c.mint,observedAt:AT,requiredValidThroughAt:AT+4475}]);
 const work=row.remainingWork;assert.equal(work.sampledAt,AT);assert.equal(work.plan.at,AT);assert.equal(work.plan.prepared,false);assert.equal(work.plan.preparationReads,1);assert.equal(work.plan.quoteReads,2);assert.equal(work.plan.preparationWorkMs,1700);assert.equal(work.plan.decisionWorkMs,2650);assert.equal(work.plan.remainingSequenceMs,4350);assert.equal(work.plan.maximumAccountedStarts,3);assert.equal(work.plan.preparationExpiresAt,AT+1200,'the too-short original observation keeps its original expiry');
 assert.deepEqual(f.observations,{layout:{requestedAt:AT-150,receivedAt:AT-100},shortRent:{requestedAt:AT-8900,receivedAt:AT-8800},otherRent:{requestedAt:AT-150,receivedAt:AT-100}});assert.equal(work.admission.admitted,true,'one1700ms read fits, while the full4350ms sequence does not');assert.equal(row.blockingPrerequisite,'ORIGINAL_CERTIFICATE_DEADLINE');assert.equal(row.operation,'ENTRY_PREPARATION');assert.equal(row.requiredMs,1700);assert.equal(row.availableMs,350);assert.equal(work.certificate.deadlineAt,AT+3000);assert.equal(row.financialPermission,false);assert.equal(f.handoff.usage(AT).dispatched,0);assert.equal(f.handoff.usage(AT).financialEvaluations,0);
 f.handoff.observe(f.c.deadlineAt+1,[]);const expired=f.events.at(-1);assert.equal(expired.stage,'expired-before-dispatch');assert.equal(expired.remainingWork.plan.preparationExpiresAt,AT+1200);assert.equal(expired.remainingWork.sampledAt,AT);assert.equal(expired.remainingWork.certificate.deadlineAt,f.c.deadlineAt);assert.equal(f.providerCalls,0);assert.equal(f.invalidations,0);
});

test('coalescing stores immutable last original work for expiry without changing public schema or emitting per-loop records',()=>{
 const c=certificate(),events:any[]=[],h=new NativeFinancialHandoff('offline',AT-100000,4,(_,v)=>events.push(v));h.observe(AT-1,[c]);
 const detail={blockingPrerequisite:'ORIGINAL_CERTIFICATE_DEADLINE',operation:'ENTRY_PREPARATION',requiredMs:1700,availableMs:0};
 const plan=nativePaperRemainingEntryWork({at:AT,owned:false,preparation:{state:'layout-required',remainingReads:3,quoteReads:2,expiresAt:null,ready:false}});
 const original=h.remainingWorkDiagnostic(plan,null,AT)!;h.defer(c,'required-service-or-protection-runway',AT,detail,original);
 plan.remainingSequenceMs=1;assert.equal(events[0].remainingWork.plan.remainingSequenceMs,6550,'mutation cannot rewrite an original receipt');assert.ok(Object.isFrozen(events[0].remainingWork.plan));assert.ok(Object.isFrozen(events[0].remainingWork.certificate));
 for(let i=1;i<=100;i++)h.defer(c,'required-service-or-protection-runway',AT+i,detail,h.remainingWorkDiagnostic({...plan,at:AT+i,remainingSequenceMs:6550},null,AT+i));
 assert.equal(events.length,1,'same reason/blocker keeps the existing write coalescing');
 assert.equal('remainingWork' in h.usage(AT+101).active[0]!,false);const publicView=projectFinancialHandoffReporting(h.usage(AT+101),AT+101)!;validateFinancialHandoffReporting(publicView,AT+101);assert.ok(!JSON.stringify(publicView).includes('remainingWork'));
 h.observe(c.deadlineAt+1,[]);assert.equal(events.length,2);const expired=events[1];assert.equal(expired.stage,'expired-before-dispatch');assert.equal(expired.remainingWork.plan.at,AT+100);assert.equal(expired.blockerObservedAt,AT+100);assert.equal(events[0].remainingWork.plan.at,AT);assert.equal(expired.financialPermission,false);
});

test('a later refusal without a calculated plan clears the old plan and replacement generations do not inherit it',()=>{
 const c=certificate(),events:any[]=[],h=new NativeFinancialHandoff('offline',0,4,(_,v)=>events.push(v)),plan=nativePaperRemainingEntryWork({at:AT,owned:false,preparation:{remainingReads:1,quoteReads:1,expiresAt:null,ready:false}});
 h.observe(AT-1,[c]);h.defer(c,'entry-preparation',AT,{blockingPrerequisite:'ENTRY_PREPARATION_PENDING',operation:'ENTRY_PREPARATION',requiredMs:1700,availableMs:3000},h.remainingWorkDiagnostic(plan,null,AT));
 h.defer(c,'financial-permission',AT+1,{blockingPrerequisite:'PROTECTION_RECOVERY_REQUIRED',operation:'ENTRY_PREPARATION',requiredMs:1700,availableMs:2999},null);
 assert.equal(events.at(-1).remainingWork,null);
 const next={...c,openedAt:c.openedAt+1,featuresSha256:'b'.repeat(64)};h.observe(AT+2,[next]);const invalidated=events.at(-1);assert.equal(invalidated.stage,'invalidated-before-dispatch');assert.equal(invalidated.remainingWork,null);
 h.observe(c.deadlineAt+1,[]);assert.equal(events.at(-1).remainingWork,null);assert.equal(h.usage(c.deadlineAt+1).seen,2);
});

test('actual financial refusal snapshots admission before an optional native await without rerunning it',async()=>{
 const c=certificate(AT+9000),{engine,admissions}=realEngine(c,AT+2000),events:any[]=[],h=new NativeFinancialHandoff('offline',0,4,(_,v)=>events.push(v));h.observe(AT-1,[c]);
 let now=AT;const plan=nativePaperRemainingEntryWork({at:AT-1,owned:false,preparation:{remainingReads:0,quoteReads:2,expiresAt:AT+30000,ready:true}});
 engine.serviceFinancialRunway=async()=>{await Promise.resolve();now+=200;plan.preparationExpiresAt=AT;return {attempted:false};};
 const context:any={__name:(v:unknown)=>v,Date:{now:()=>now},riskCapacity:()=>true,plannedEntryWork:plan,handoffCertificate:c,currentEngine:engine,candidate:c.mint,proof:null,proofReady:true,preparationRequired:false,currentRpc:{usage:()=>({})},entryStartsRemaining:()=>8,service:true,held:0,lowerView:()=>({admitted:true}),currentBridge:{protection:async()=>{}},workOwner:{enter:()=>()=>{}},financialHandoff:h,entryCapacityReason:()=>null,nativePaperHandoffCategory,NATIVE_DEADLINE_POLICY,nativePaperManagementReserve:()=>({entryAllowed:true}),AbortController,requiredEntryNativeMaintenance:null,record:(kind:string,row:unknown)=>events.push({kind,...row as object})};
 const source=runNativePaper.toString(),begin=source.search(/const\s+newRisk\s*=/),tail=source.slice(begin),end=tail.search(/for\s*\(const\s+c\s+of\s+handoffCertificates\)/);assert.ok(begin>=0&&end>0);
 await runInNewContext('(async()=>{for(let once=0;once<1;once++){'+tail.slice(0,end)+'}})()',context,{timeout:1000});
 const row=events.find(v=>v.stage==='financial-deferred');assert.equal(admissions.length,1);assert.equal(row.at,AT);assert.equal(row.remainingWork.sampledAt,AT);assert.equal(row.remainingWork.plan.at,AT-1);assert.equal(row.remainingWork.plan.preparationExpiresAt,AT+30000,'later mutation cannot rewrite pre-await evidence');assert.equal(row.remainingWork.admission.observedAt,AT);assert.equal(row.remainingWork.admission.nativeServiceLatestAt,AT+2000);assert.equal(row.remainingWork.admission.requestedOperationMs,2650);assert.equal(row.requiredMs,2775);assert.equal(row.availableMs,2000);assert.equal(h.usage(now).economicDecisions,0);
});

test('diagnostic projection is bounded, strips unrecognized data and cannot manufacture a missing plan',()=>{
 const h=new NativeFinancialHandoff('offline',0,4),plan=nativePaperRemainingEntryWork({at:AT,owned:true,preparation:{remainingReads:1,quoteReads:1,expiresAt:AT+1000,ready:false}});
 assert.equal(h.remainingWorkDiagnostic(null,null,AT),null);assert.equal(h.remainingWorkDiagnostic({...plan,at:AT+1},null,AT),null);assert.equal(h.remainingWorkDiagnostic({...plan,preparationReads:4},null,AT),null);
 const result=h.remainingWorkDiagnostic({...plan,secret:'not-exported'}, {reason:'private-provider/error'},AT)!;assert.equal(result.admission,null);assert.ok(!JSON.stringify(result).includes('not-exported'));assert.ok(!JSON.stringify(result).includes('private-provider'));assert.equal(result.plan.contextStarts,2);assert.ok(JSON.stringify(result).length<2000);
});
