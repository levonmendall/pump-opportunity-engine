/** OFFLINE: exercise the launcher's actual diagnostic closure, using the real
 * deadline and remaining-work planners. No provider or financial writer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {runNativePaper,nativePaperCurrentQualificationProof,nativePaperRemainingEntryWork,nativePaperManagementReserve,NativePaperProofPreparation} from '../src/run-native-paper.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {pilotLowerPriorityAdmission,PILOT_TIMING} from '../src/pilot.js';
import {RESEARCH_CLOCK_COHERENT_POOL_CAPACITY} from '../src/research-clock-pricing.js';

function fixture(){
 let at=100_000,source=true,permission:string|null=null,nativeAt:number|null=null,available=true,pendingAt:number|null=null;
 const certificate={schemaVersion:1,mint:'OFFLINE_MINT',pool:'OFFLINE_POOL',dataContract:'OFFLINE',openedAt:1,connectionId:1,subscriptionId:2,windowStartAt:0,windowEndAt:90_000,auditAvailableAt:99_000,admittedAt:99_000,deadlineAt:110_000,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)} as unknown as NativeAuditCertificate;
 const state:any={positions:{},pending:{},controls:{entriesEnabled:true,stopRequested:false},daily:{paused:false,reconciledAt:99_000}},proof={proofId:'OFFLINE_PROOF',mint:certificate.mint,startAt:0,throughAt:99_000,windowEndAt:certificate.windowEndAt,featuresSha256:certificate.featuresSha256,certificateAt:certificate.admittedAt,deadlineAt:certificate.deadlineAt};
 const retained:any={proofId:proof.proofId,mint:proof.mint,deadlineAt:proof.deadlineAt,state:'complete',availableAt:99_500,error:null};
 const preparation:any={state:'ready',remainingReads:0,quoteReads:1,ready:true,expiresAt:130_000,receiptAt:99_500};
 const usage:any={chapter:0,newUnits:0,maximumNewUnits:1000,newAccountedResponseBytes:0,maximumNewResponseBytes:1e8,requestLimits:{maxStartsPerMinute:60,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:0,rolling10SecondStarts:0},rpcDispatchWindow:{readyAt:100_000,physicalBusy:false},inFlight:0,waitingOrOperating:false};
 const historical:any={...certificate,state:'waiting',observedAt:99_600,operation:'ENTRY_PREPARATION',blockingPrerequisite:'ENTRY_PREPARATION_PENDING',requiredMs:1700,availableMs:10_400};
 const reads:{kind:string;at:number}[]=[],holder:any={};
 const owner:any={open:()=>source,deadlineView:()=>({requiredNativeAt:nativeAt,readyCount:1}),currentAuditCertificate:(mint:string,when:number)=>mint===certificate.mint&&when<=certificate.deadlineAt?certificate:null};
 owner.financialAdmission=(c:NativeAuditCertificate,bound:number,when:number)=>NativeCandidateRunner.prototype.financialAdmission.call(owner,c,bound,when);
 const context:any={__name:(value:unknown)=>value,holder,Date:{now:()=>at+60_000},financialHandoff:{usage:()=>({active:[historical]})},financialEvaluationCandidates:new Set([certificate.mint]),engine:owner,
  currentLedger:{state:()=>state,v3RiskPolicyActive:()=>true},currentRpc:{usage:()=>usage,available:()=>available},sourceInformationAdmission:()=>source,
  nativePaperCurrentQualificationProof,currentBridge:{qualificationProof:(_mint:string,when:number)=>{reads.push({kind:'proof',at:when});return proof;},trader:{nextDueAt:()=>pendingAt}},proofPreparation:{usage:()=>retained},
  args:{strategy:'liquidity-resilient-momentum-v3.1'},LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:'liquidity-resilient-momentum-v3.1',nativePaperRemainingEntryWork,
  market:{entryPreparationStatus:(_mint:string,when:number)=>{reads.push({kind:'support',at:when});return {...preparation};}},NATIVE_DEADLINE_POLICY,pilotLowerPriorityAdmission,PILOT_TIMING,
  endAt:2_000_000,lastCompleted:100_000,financialCapacityReason:()=>permission,configuration:{binding:{maxPositions:null}},RESEARCH_CLOCK_COHERENT_POOL_CAPACITY,
  nativePaperManagementReserve,service:true,entryStartsRemaining:()=>9,
 };
 const sourceText=runNativePaper.toString(),begin=sourceText.search(/const\s+financialWorkAdmissionView\s*=/),tail=sourceText.slice(begin),end=tail.search(/;\s*const\s+makeEngine\s*=/);
 assert.ok(begin>=0&&end>0,'actual admission diagnostic closure is identified');
 runInNewContext(tail.slice(0,end)+';holder.view=financialWorkAdmissionView;',context,{timeout:1000});
 return {certificate,state,proof,retained,preparation,usage,historical,reads,context,
  view:()=>JSON.parse(JSON.stringify(holder.view(at))),get at(){return at;},set at(value:number){at=value;},
  set source(value:boolean){source=value;},set permission(value:string|null){permission=value;},set nativeAt(value:number|null){nativeAt=value;},set available(value:boolean){available=value;},set pendingAt(value:number|null){pendingAt=value;}};
}

test('current admission sample discards historical preparation/runway without refreshing evidence receipts',()=>{
 const f=fixture(),before=structuredClone({proof:f.proof,retained:f.retained,support:f.preparation,financial:f.state,historical:f.historical});
 const first=f.view();assert.equal(first.observedAt,100_000);assert.equal(first.operation,'FINANCIAL_DECISION');assert.equal(first.requestedOperationMs,1450);assert.equal(first.availableMs,9875);assert.equal(first.deadlineAt,110_000);assert.equal(first.deadlineAllowed,true);assert.equal(first.bindingBlocker,'NONE');
 f.at=109_000;const late=f.view();assert.equal(late.observedAt,109_000);assert.equal(late.availableMs,875);assert.equal(late.deadlineAllowed,false);assert.equal(late.bindingBlocker,'AUDIT_DEADLINE');assert.equal(late.deadlineAt,first.deadlineAt);
 assert.deepEqual({proof:f.proof,retained:f.retained,support:f.preparation,financial:f.state,historical:f.historical},before);
 assert.deepEqual(f.reads,[{kind:'proof',at:100_000},{kind:'support',at:100_000},{kind:'proof',at:109_000},{kind:'support',at:109_000}]);
 f.at=110_001;assert.equal(f.view(),null,'expired original certificates never get a refreshed deadline');
});

test('support that expires before decision describes full remaining preparation without invalidating cache',()=>{
 const f=fixture();f.preparation.expiresAt=101_000;const before=structuredClone(f.preparation),view=f.view();
 assert.equal(view.operation,'ENTRY_PREPARATION');assert.equal(view.requestedOperationMs,1700);assert.equal(view.availableMs,5150);assert.equal(view.bindingBlocker,'PREREQUISITES_STALE');assert.equal(view.deadlineAllowed,true);assert.deepEqual(f.preparation,before);
 f.at=105_000;const late=f.view();assert.equal(late.availableMs,150);assert.equal(late.deadlineAllowed,false);assert.equal(late.bindingBlocker,'AUDIT_DEADLINE');assert.equal(late.deadlineAt,f.certificate.deadlineAt);
});

test('proof readiness uses original identity and availability at sample time, independent of provider pacing',()=>{
 const f=fixture();f.retained.availableAt=100_100;f.usage.rpcDispatchWindow.readyAt=103_000;f.usage.rpcDispatchWindow.physicalBusy=true;
 const pending=f.view();assert.equal(pending.operation,'PROOF_PREPARATION');assert.equal(pending.bindingBlocker,'PROOF_PENDING');assert.equal(pending.requestedOperationMs,null);assert.equal(pending.deadlineAllowed,null);assert.equal(pending.availableMs,10_000);assert.equal(pending.physicalBusy,true);
 f.at=100_100;assert.equal(f.view().operation,'FINANCIAL_DECISION');assert.equal(f.view().bindingBlocker,'PHYSICAL_CAPACITY');
 f.retained.proofId='DIFFERENT_CERTIFICATE';assert.equal(f.view().operation,'PROOF_PREPARATION');
});

test('current provider ready time consumes actual remaining runway and physical status shares sample time',()=>{
 const f=fixture();f.at=108_000;f.usage.rpcDispatchWindow.readyAt=108_500;
 const paced=f.view();assert.equal(paced.observedAt,108_000);assert.equal(paced.providerReadyAt,108_500);assert.equal(paced.availableMs,1375);assert.equal(paced.deadlineAllowed,false);assert.equal(paced.bindingBlocker,'AUDIT_DEADLINE');
 f.usage.rpcDispatchWindow.readyAt=108_100;const fits=f.view();assert.equal(fits.deadlineAllowed,true);assert.equal(fits.bindingBlocker,'PROVIDER_PACING');
 f.usage.rpcDispatchWindow.readyAt=108_000;f.usage.inFlight=1;assert.equal(f.view().bindingBlocker,'PHYSICAL_CAPACITY');
});

test('current native deadline and holding quote envelope are distinct from original certificate age',()=>{
 const f=fixture();f.nativeAt=101_500;f.at=100_100;const native=f.view();assert.equal(native.requestedOperationMs,1450);assert.equal(native.availableMs,1275);assert.equal(native.deadlineAllowed,false);assert.equal(native.bindingBlocker,'NATIVE_SERVICE_DEADLINE');assert.equal(native.deadlineAt,110_000);
 f.nativeAt=null;f.state.positions.HELD={units:'1'};f.context.lastCompleted=98_000;const held=f.view();assert.equal(held.operation,'ACTUAL_SIZE_QUOTE');assert.equal(held.requestedOperationMs,1200);assert.equal(held.availableMs,425);assert.equal(held.bindingBlocker,'HOLDING_PROTECTION');assert.equal(held.deadlineAllowed,false);
 f.pendingAt=100_300;const pending=f.view();assert.equal(pending.bindingBlocker,'PENDING_ORDER');assert.equal(pending.availableMs,50);
});

test('current plan replaces the old blanket provider charge while financial permission stays independent',()=>{
 const f=fixture();f.state.positions.HELD={units:'1'};f.usage.chapterUsage.rolling10SecondStarts=8;f.usage.chapterUsage.rolling60SecondStarts=21;
 const ready=f.view();assert.notEqual(ready.bindingBlocker,'PROVIDER_CAPACITY','three real remaining starts plus protected reserve fit where old nine-start charge did not');
 f.permission='OWNER_PAUSE';assert.equal(f.view().bindingBlocker,'FINANCIAL_PERMISSION');f.permission=null;
 f.state.pending.ORDER={};assert.equal(f.view().bindingBlocker,'PENDING_ORDER');delete f.state.pending.ORDER;
 f.usage.chapterUsage.rolling10SecondStarts=19;assert.equal(f.view().bindingBlocker,'PROVIDER_CAPACITY');
 f.usage.chapterUsage.rolling10SecondStarts=0;f.source=false;assert.equal(f.view().bindingBlocker,'SOURCE_UNAVAILABLE');assert.equal(f.view().sourceAllowed,false);
});

test('a replacement certificate cannot inherit an old handoff row or its timing',()=>{
 const f=fixture();f.certificate.featuresSha256='b'.repeat(64);assert.equal(f.view(),null);
});

test('actual cached peer selection cannot replace the target certificate readiness diagnostic',async()=>{
 const f=fixture(),cache=new NativePaperProofPreparation(()=>f.at),turn=()=>new Promise<void>(resolve=>setImmediate(resolve));f.context.proofPreparation=cache;
 cache.prepare(f.proof,async()=>{});await turn();const peer={...f.proof,proofId:'OFFLINE_PEER_PROOF',mint:'OFFLINE_PEER'};cache.prepare(peer,async()=>{});await turn();
 assert.equal(cache.usage()?.proofId,peer.proofId);const before=cache.usage(f.proof),view=f.view();assert.equal(view.operation,'FINANCIAL_DECISION');assert.equal(view.bindingBlocker,'NONE');assert.deepEqual(cache.usage(f.proof),before,'diagnosis preserves original retention availability');
});

test('an unchanged terminal target failure remains unavailable after a peer completes and never grants permission',async()=>{
 const f=fixture(),cache=new NativePaperProofPreparation(()=>f.at),turn=()=>new Promise<void>(resolve=>setImmediate(resolve));f.context.proofPreparation=cache;
 let pins=0;cache.prepare(f.proof,async()=>{pins++;throw Error('OFFLINE retention unavailable');});await turn();const peer={...f.proof,proofId:'OFFLINE_PEER_PROOF',mint:'OFFLINE_PEER'};cache.prepare(peer,async()=>{});await turn();
 for(let i=0;i<3;i++){const view=f.view();assert.equal(view.operation,'PROOF_PREPARATION');assert.equal(view.bindingBlocker,'PROOF_RETENTION_UNAVAILABLE');assert.equal(view.requestedOperationMs,null);assert.equal(view.deadlineAllowed,null);assert.equal(view.availableMs,10000);cache.prepare(f.proof,async()=>{pins++;});}
 await turn();assert.equal(pins,1);assert.equal(cache.ready(f.proof),false);f.permission='OWNER_PAUSE';assert.equal(f.view().bindingBlocker,'FINANCIAL_PERMISSION','real owner controls remain the binding blocker');
});
