/** OFFLINE actual launcher branch and real admission planner. The observed
 * November4 timing is a diagnostic regression, never a live certificate or
 * permission to dispatch. No provider, ledger or filesystem owner is opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {runNativePaper,nativePaperHandoffCategory} from '../src/run-native-paper.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {projectFinancialHandoffReporting,validateFinancialHandoffReporting} from '../src/financial-handoff-reporting.js';

async function observedBlock(input:{at:number;deadline:number;nativeAt?:number;held?:boolean;proofReady?:boolean;proofState?:'pending'|'failed';waitWithoutStart?:boolean}){
 let now=input.at-1,capacityReason:string|null=null;const reads:number[]=[],events:any[]=[],admissions:any[]=[];
 const c={schemaVersion:1,mint:'OFFLINE_MINT',pool:'OFFLINE_POOL',dataContract:'OFFLINE',openedAt:1,connectionId:1,subscriptionId:2,windowStartAt:input.deadline-69999,windowEndAt:input.deadline-9999,auditAvailableAt:input.at-100,admittedAt:input.at-100,deadlineAt:input.deadline,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)} as unknown as NativeAuditCertificate;
 const engine:any={open:()=>true,deadlineView:()=>({requiredNativeAt:input.nativeAt??null,readyCount:1}),currentAuditCertificate:(_mint:string,at:number)=>at<=c.deadlineAt?c:null};
 engine.financialAdmission=(certificate:NativeAuditCertificate,bound:number,at=now)=>{const result=NativeCandidateRunner.prototype.financialAdmission.call(engine,certificate,bound,at);admissions.push({at,result});return result;};
 engine.serviceFinancialRunway=async()=>{await Promise.resolve();now+=200;capacityReason='PROVIDER_RESTRICTION';return {attempted:false};};
 const handoff=new NativeFinancialHandoff('offline',0,4,(_,value)=>events.push(value));handoff.observe(input.at-100,[c]);
 const context:any={__name:(v:unknown)=>v,Date:{now:()=>now++},riskCapacity:()=>true,plannedEntryWork:{decisionWorkMs:1450,quoteOperationMs:1200},handoffCertificate:c,currentEngine:engine,candidate:c.mint,proof:input.proofState?{proofId:'OFFLINE_PROOF'}:null,proofPreparation:{usage:()=>({state:input.proofState})},proofReady:input.proofReady??!input.proofState,preparationRequired:false,currentRpc:{usage:()=>({})},entryStartsRemaining:()=>input.waitWithoutStart?8:9,service:true,held:input.held?1:0,lowerView:()=>({admitted:!input.held,latestStartAt:input.at-100}),currentBridge:{protection:async()=>{}},workOwner:{enter:()=>()=>{}},lastProtectionStart:0,financialHandoff:handoff,entryCapacityReason:(at:number)=>{reads.push(at);return capacityReason;},nativePaperHandoffCategory,NATIVE_DEADLINE_POLICY,nativePaperManagementReserve:()=>({entryAllowed:true}),AbortController,requiredEntryNativeMaintenance:null,record:(kind:string,row:unknown)=>events.push({kind,...row as object})};
 const source=runNativePaper.toString(),begin=source.search(/const\s+newRisk\s*=/),tail=source.slice(begin),end=tail.search(/for\s*\(const\s+c\s+of\s+handoffCertificates\)/);
 assert.ok(begin>=0&&end>0,'actual financial-selection/defer branch is exercised');
 await runInNewContext('(async()=>{for(let once=0;once<1;once++){'+tail.slice(0,end)+'}})()',context,{timeout:1000});
 return {c,handoff,events,admissions,reads};
}

test('actual1450/1521 refusal reports the existing125ms reserve at the admission observation time',async()=>{
 const f=await observedBlock({at:1793758278478,deadline:1793758279999});
 const {at,result}=f.admissions[0];assert.equal(at,1793758278478);assert.equal(result.admitted,false);assert.equal(result.reason,'original-certificate-deadline');assert.equal(result.latestStartAt,1793758278424);
 const row=f.events.find(r=>r.stage==='financial-deferred');assert.equal(row.requiredMs,1575);assert.equal(row.availableMs,1521);assert.equal(row.requiredMs-row.availableMs,54);assert.equal(row.at,at);assert.equal(row.observedAt,at);assert.deepEqual(f.reads,[at]);assert.equal(row.financialPermission,false);
 f.handoff.observe(f.c.deadlineAt+1,[]);const expired=f.events.at(-1);assert.equal(expired.stage,'expired-before-dispatch');assert.equal(expired.deadlineAt,1793758279999);assert.equal(expired.requiredMs,1575);assert.equal(expired.availableMs,1521);assert.equal(expired.blockerObservedAt,at,'expiry retains the original blocker clock, not expiry time');
});

test('a binding native-service deadline is reported with its own unchanged total work requirement',async()=>{
 const f=await observedBlock({at:100500,deadline:110000,nativeAt:102021});const row=f.events.find(r=>r.stage==='financial-deferred');
 assert.equal(f.admissions[0].result.bindingDeadline,'required-native-service');assert.equal(row.blockingPrerequisite,'REQUIRED_NATIVE_SERVICE_DEADLINE');assert.equal(row.requiredMs,1575);assert.equal(row.availableMs,1521);assert.equal(row.deadlineAt,110000,'the certificate deadline is not replaced by the service deadline');
});

test('inclusive admission boundary remains unchanged and one millisecond later has matching diagnostic arithmetic',async()=>{
 const exact=await observedBlock({at:108425,deadline:110000});assert.equal(exact.admissions[0].result.admitted,true);assert.equal(exact.events.length,0);
 const late=await observedBlock({at:108426,deadline:110000});assert.equal(late.admissions[0].result.admitted,false);const row=late.events[0];assert.equal(row.requiredMs,1575);assert.equal(row.availableMs,1574);
});

test('the financial validation reserve is not added to the distinct holding quote envelope',async()=>{
 const f=await observedBlock({at:100500,deadline:110000,held:true});const row=f.events[0];assert.equal(row.blockingPrerequisite,'HOLDING_PROTECTION_RUNWAY');assert.equal(row.requiredMs,1200);assert.equal(row.financialPermission,false);
});

test('a declined native maintenance turn retains the original admission blocker and clock across its await',async()=>{
 const f=await observedBlock({at:100500,deadline:110000,nativeAt:102021,waitWithoutStart:true});
 const receipt=f.events.find(row=>row.kind==='native-paper-financial-prerequisite-service'),row=f.events.find(row=>row.stage==='financial-deferred');
 assert.ok(receipt.at>100700);assert.equal(receipt.result.attempted,false);assert.equal(row.at,100500);assert.equal(row.observedAt,100500);
 assert.equal(row.blockingPrerequisite,'REQUIRED_NATIVE_SERVICE_DEADLINE','later provider state is not mislabeled with the old clock');assert.equal(row.requiredMs,1575);assert.equal(row.availableMs,1521);assert.deepEqual(f.reads,[100500]);assert.equal(f.admissions.length,1,'the diagnostic neither reruns admission nor creates authority');
});

test('terminal proof retention failure is a technical blocker distinct from pending preparation',async()=>{
 for(const state of ['pending','failed'] as const){const f=await observedBlock({at:100500,deadline:110000,proofState:state}),row=f.events.find(row=>row.stage==='financial-deferred');
  assert.equal(row.blockingPrerequisite,state==='failed'?'PROOF_RETENTION_UNAVAILABLE':'PROOF_PENDING');assert.equal(row.reason,'proof-retention');assert.equal(row.operation,'PROOF_PREPARATION');assert.equal(row.requiredMs,null);assert.equal(row.availableMs,9500);assert.equal(row.financialPermission,false);assert.equal(f.handoff.usage(100501).financialEvaluations,0);assert.equal(f.handoff.usage(100501).economicDecisions,0);
 }
});

test('waiting peers report their own original deadline and unknown work rather than the selected candidate plan',()=>{
 const at=1793758278478,mint='1'.repeat(32),peerMint='2'.repeat(32),events:any[]=[],c={mint,windowEndAt:at-2000,deadlineAt:at+1521,admittedAt:at-1000,openedAt:at-62000,featuresSha256:'a'.repeat(64)},peer={...c,mint:peerMint,deadlineAt:at+9000};
 const handoff=new NativeFinancialHandoff('offline',at-10000,4,(_,row)=>events.push(row));handoff.observe(at-10,[c,peer]);
 const source=runNativePaper.toString(),matches=[...source.matchAll(/for\s*\(const\s+c\s+of\s+handoffCertificates\)\s*if\s*\(c\.mint\s*!==\s*candidate\s*&&\s*!terminalProofFailures\.has\(c\.mint\)\)/g)];
 assert.equal(matches.length,1,'select the actual peer-wait loop, not the earlier terminal-proof scan');
 const begin=matches[0]!.index!,tail=source.slice(begin),end=tail.search(/if\s*\(candidate\s*&&\s*entryRunwayAvailable/);assert.ok(end>0);
 let clockReads=0;runInNewContext(tail.slice(0,end),{__name:(v:unknown)=>v,Date:{now:()=>{clockReads++;return at;}},handoffCertificates:[c,peer],terminalProofFailures:new Set<string>(),candidate:mint,financialHandoff:handoff,operationMs:1450},{timeout:1000});
 assert.equal(clockReads,1);assert.equal(events.length,1);const row=events[0];assert.equal(row.mint,peerMint);assert.equal(row.blockingPrerequisite,'AWAIT_EARLIER_CANDIDATE');assert.equal(row.operation,'FINANCIAL_DECISION');assert.equal(row.requiredMs,null);assert.equal(row.availableMs,9000);assert.equal(row.observedAt,at);
 const publicView=projectFinancialHandoffReporting(handoff.usage(at+1),at+1)!;validateFinancialHandoffReporting(publicView,at+1);const projected=publicView.active.find(value=>value.mint===peerMint)!;assert.equal(projected.requiredMs,null);assert.equal(projected.availableMs,9000);
 handoff.observe(peer.deadlineAt+1,[]);const expired=events.find(value=>value.mint===peerMint&&value.stage==='expired-before-dispatch');assert.equal(expired.requiredMs,null);assert.equal(expired.availableMs,9000);assert.equal(expired.blockerObservedAt,at);
});
