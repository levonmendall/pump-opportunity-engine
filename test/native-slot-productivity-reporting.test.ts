import test from 'node:test';
import assert from 'node:assert/strict';
import {projectNativeSlotProductivityReporting,validateNativeSlotProductivityReporting,NATIVE_SLOT_STATES,NATIVE_SLOT_COUNTS,NATIVE_SLOT_WAITS} from '../src/native-slot-productivity-reporting.js';
import {projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from '../src/operating-intelligence.js';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeSlotProductivity} from '../src/native-slot-productivity.js';
const T=Date.parse('2026-10-30T23:50:00.000Z'),iso=(n:number)=>new Date(n).toISOString();
function raw():any{return {version:'native-slot-productivity-v1',scope:'CURRENT_SOURCE_INSTANCE',sourceInstanceId:'native-runner:native-paper-20261030:12345-abc',runId:'native-paper-20261030',startedAt:T-1000,generatedAt:T,configuredSlots:4,stateMs:Object.fromEntries(NATIVE_SLOT_STATES.map(state=>[state,state==='VACANT'?4000:0])),slots:Array.from({length:4},(_,slot)=>({slot,mint:null,state:'VACANT',sinceAt:T-1000,stateAgeMs:1000,allocatedAt:null,openedAt:null,windowEndAt:null})),counts:Object.fromEntries(NATIVE_SLOT_COUNTS.map(key=>[key,0])),waits:Object.fromEntries(NATIVE_SLOT_WAITS.map(key=>[key,{count:0,sum:0,mean:null,max:null,p50:null,p95:null}])),percentileScope:'ALL_ACTUAL_STARTS_IN_SOURCE_INSTANCE',limitations:['FOUR_SLOTS_DO_NOT_IMPLY_PRODUCTIVE_WORK','PHYSICAL_START_REQUIRES_RECEIPT','NO_PER_SLOT_PROFIT_ATTRIBUTION']};}
const status=(slotProductivity:unknown)=>({accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:T,startedAt:T-10000,runId:'native-paper-20261030',strategyVersion:'liquidity-resilient-momentum-v3.1',configurationSha256:'a'.repeat(64),persistent:true,positions:{},pending:{},slotProductivity});
test('source-instance slot facts remain separate from retained account and candidate counters',()=>{
 const value=raw();value.counts.distinctPrimaryEvaluated=2;value.counts.qualified=1;value.counts.entryFills=0;const s=status(value),before=structuredClone(s),i=projectOperatingIntelligence(s),p=i.slotProductivity!;
 validateOperatingIntelligence(i,iso(T));assert.deepEqual(s,before);assert.equal(p.scope,'CURRENT_SOURCE_INSTANCE');assert.equal(p.startedAt,iso(T-1000));assert.equal(i.run.startedAt,iso(T-10000));assert.equal(p.configuredSlots,4);assert.equal(p.stateMs.VACANT,4000);assert.equal(p.counts.distinctPrimaryEvaluated,2);assert.equal(p.counts.entryFills,0);assert.equal(i.candidates.predictiveAssessments,null);
});
test('no observed transition has null duration statistics rather than a fictional zero-latency success',()=>{
 const value=raw();value.waits.queueToAllocation={count:2,sum:4.5,mean:2.25,max:3,p50:1.5,p95:3};const p=projectNativeSlotProductivityReporting({slotProductivity:value},T)!;
 assert.equal(p.waits.queueToAllocation.mean,2.25);assert.equal(p.waits.queueToAllocation.p95,3);assert.deepEqual(p.waits.auditReadyToPhysicalStart,{count:0,sum:0,mean:null,max:null,p50:null,p95:null});
 const unavailable=raw() as any;delete unavailable.counts.entryFills;assert.equal(projectNativeSlotProductivityReporting({slotProductivity:unavailable},T)!.counts.entryFills,null);
});
test('legacy and malformed optional productivity never block authoritative financial reporting',()=>{
 const legacy=status(undefined),i=projectOperatingIntelligence(legacy);assert.equal(i.slotProductivity,undefined);validateOperatingIntelligence(i,iso(T));
 const future=raw();future.generatedAt=T+1;assert.equal(projectNativeSlotProductivityReporting({slotProductivity:future},T),undefined);
 const bad=raw();bad.sourceInstanceId='https://private.example?key=DO_NOT_EXPORT';assert.equal(projectNativeSlotProductivityReporting({slotProductivity:bad},T),undefined);
});
test('source-owned static classifications omit private errors, unsupported limitations and credentials',()=>{
 const value=raw() as any;value.apiKey='DO_NOT_EXPORT';value.slots[0].privateError='DO_NOT_EXPORT';value.limitations.push('DO_NOT_EXPORT');const p=projectNativeSlotProductivityReporting({slotProductivity:value},T)!;
 assert.ok(p.limitations.includes('OTHER_UNEXPORTED_LIMITATION'));assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|apiKey|privateError/);
});
test('wire rejects overlapping duration totals, duplicate slots, future facts and secret-shaped extras',()=>{
 const p=projectNativeSlotProductivityReporting({slotProductivity:raw()},T)!;
 for(const change of [(s:any)=>s.stateMs.AUDIT_ACTIVE=1.1,(s:any)=>s.slots[1].slot=0,(s:any)=>s.slots[0].sinceAt=iso(T+1),(s:any)=>s.counts.entryFills=-1,(s:any)=>s.apiKey='private',(s:any)=>s.waits.queueToAllocation.extra='private']){const bad=structuredClone(p);change(bad);assert.throws(()=>validateNativeSlotProductivityReporting(bad,T),/INVALID/);}
 assert.ok(Buffer.byteLength(JSON.stringify(p))<8192);
});
test('actual slot producer reports receipt-based waits and financial callbacks through the bounded public projection',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T}),mint='11111111111111111111111111111111';
 try{
  const productivity=new NativeSlotProductivity({registry,sourceInstanceId:'native-runner:native-paper-fixture:actual-source',startedAt:T-1000,maximumSlots:4});
  productivity.allocated(mint,T-800,T-900,0);productivity.opened(mint,T-700);productivity.warmed(mint,T-200);productivity.ready(mint,T-100,T-100);productivity.physicalStarted(mint,T-100,T-90,'actual-physical-receipt');productivity.physicalSettled(mint,T-80);productivity.evaluated(mint,T-700,T-100,T-70);productivity.financial({mint,kind:'primary-evaluated',at:T-60,key:'primary'});productivity.financial({mint,kind:'qualified',at:T-50,key:'qualification'});productivity.retired(mint,T-40,'preliminary source assignment completed');
  const p=projectNativeSlotProductivityReporting({slotProductivity:productivity.snapshot(T)},T)!;assert.ok(p);validateNativeSlotProductivityReporting(p,T);
  assert.equal(p.evidenceCoverage!.verifiedEvidenceMs,600);assert.equal(p.counts.distinctAudited,1);assert.equal(p.counts.distinctPrimaryEvaluated,1);assert.equal(p.counts.qualified,1);assert.equal(p.counts.entryFills,0);assert.equal(p.waits.auditReadyToPhysicalStart.mean,10);assert.equal(p.waits.allocationToAck.p95,100);assert.equal(p.waits.ackToWarm.mean,500);assert.equal(Object.values(p.stateMs).reduce<number>((sum,value)=>sum+Number(value),0),4000);assert.equal(p.slots[0]!.state,'REPLACEMENT_WAIT');
 }finally{registry.close();}
});
test('verified evidence coverage remains distinct from occupancy and invalid optional coverage stays unavailable',()=>{
 const value=raw();value.evidenceCoverage={verifiedEvidenceMs:1500,occupiedSlotMs:2000,percent:75,basis:'RETROSPECTIVE_UNION_OF_VERIFIED_WINDOWS_PER_ACTUAL_SLOT_ASSIGNMENT'};const p=projectNativeSlotProductivityReporting({slotProductivity:value},T)!;
 assert.equal(p.evidenceCoverage!.percent,75);validateNativeSlotProductivityReporting(p,T);value.evidenceCoverage.verifiedEvidenceMs=2001;assert.equal(projectNativeSlotProductivityReporting({slotProductivity:value},T)!.evidenceCoverage,undefined);
 const bad=structuredClone(p);bad.evidenceCoverage!.percent=101;assert.throws(()=>validateNativeSlotProductivityReporting(bad,T),/INVALID/);
});
test('history-not-observed and deadline window failures stay distinct from verified provider failures',()=>{
 const value=raw();value.failureCounts={historyNotObservedWindows:3,decisionDeadlineWindows:2,auditUnusableWindows:0,providerUnavailableWindows:0,privateError:'DO_NOT_EXPORT'};
 const p=projectNativeSlotProductivityReporting({slotProductivity:value},T)!;assert.deepEqual(p.failureCounts,{historyNotObservedWindows:3,decisionDeadlineWindows:2,auditUnusableWindows:0,providerUnavailableWindows:0});assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT/);validateNativeSlotProductivityReporting(p,T);
 const bad=structuredClone(p);bad.failureCounts!.providerUnavailableWindows=-1;assert.throws(()=>validateNativeSlotProductivityReporting(bad,T),/INVALID/);delete value.failureCounts;assert.equal(projectNativeSlotProductivityReporting({slotProductivity:value},T)!.failureCounts,undefined);
});
test('subscription send receipts remain optional and reject future or unallocated sends',()=>{
 const legacy=projectNativeSlotProductivityReporting({slotProductivity:raw()},T)!;
 assert.equal(Object.hasOwn(legacy.slots[0]!,'subscriptionSentAt'),false);
 const value=raw();Object.assign(value.slots[0],{mint:'11111111111111111111111111111111',state:'SUBSCRIPTION_WAIT',allocatedAt:T-900,subscriptionSentAt:T-800});
 const p=projectNativeSlotProductivityReporting({slotProductivity:value},T)!;assert.ok(p);
 assert.equal(p.slots[0]!.subscriptionSentAt,iso(T-800));validateNativeSlotProductivityReporting(p,T);
 for(const sent of [T+1,T-901,'untrusted']){const bad=structuredClone(value);bad.slots[0].subscriptionSentAt=sent;assert.equal(projectNativeSlotProductivityReporting({slotProductivity:bad},T),undefined);}
 value.slots[0].subscriptionSentAt=null;assert.equal(projectNativeSlotProductivityReporting({slotProductivity:value},T)!.slots[0]!.subscriptionSentAt,null);
 const unallocated=raw();unallocated.slots[0].subscriptionSentAt=T-800;assert.equal(projectNativeSlotProductivityReporting({slotProductivity:unallocated},T),undefined);
});

test('a resubscription can follow a retained ACK while unusable without rewriting the earlier receipt',()=>{
 const value=raw();Object.assign(value.slots[0],{mint:'11111111111111111111111111111111',state:'UNUSABLE',allocatedAt:T-900,openedAt:T-800,subscriptionSentAt:T-500});
 const p=projectNativeSlotProductivityReporting({slotProductivity:value},T)!;assert.ok(p);assert.equal(p.slots[0]!.openedAt,iso(T-800));assert.equal(p.slots[0]!.subscriptionSentAt,iso(T-500));
 value.slots[0].state='EVIDENCE_WARMING';assert.equal(projectNativeSlotProductivityReporting({slotProductivity:value},T),undefined);
});
