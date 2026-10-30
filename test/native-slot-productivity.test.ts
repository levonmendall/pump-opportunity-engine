import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeSlotProductivity} from '../src/native-slot-productivity.js';
import {projectNativeSlotProductivityReporting} from '../src/native-slot-productivity-reporting.js';
const start=Date.parse('2026-10-30T23:00:00.000Z');
const mintA='5XBDiRf4RXJJU9acoSpaReSBhvoTac2GbcSF2Vp4pump',mintB='qi6wtTo9jZhkGcokNrjNNnBSjt12sUxgNyhWuUUpump';
const sourceInstanceId='native-runner:native-paper-20261030230000000:synthetic-source';
function setup(){const registry=new MarketRegistry(':memory:',{now:()=>start});return {registry,tracker:new NativeSlotProductivity({registry,sourceInstanceId,runId:'native-paper-20261030230000000',startedAt:start,maximumSlots:4})};}

test('slot intervals are disjoint and wait percentiles use actual allocations/ACKs/physical starts',()=>{
 const {registry,tracker}=setup();try{
  tracker.allocated(mintA,start+100,start,0);tracker.opened(mintA,start+200);tracker.warmed(mintA,start+1000);tracker.ready(mintA,start+1000,start+1100);tracker.waiting(mintA,start+1200,false,'financial-priority');
  assert.equal(tracker.snapshot(start+1300).waits.auditReadyToPhysicalStart.count,0,'local scheduling/admission is not a physical start');
  assert.equal(tracker.physicalStarted(mintA,start+1000,start+1400,'actual-receipt:1'),true);tracker.physicalSettled(mintA,start+1600);tracker.evaluated(mintA,start+200,start+1000,start+1700);tracker.retired(mintA,start+1800,'completed-negative');tracker.allocated(mintB,start+2000,start+1500,1);
  const s=tracker.snapshot(start+2100);assert.equal(Object.values(s.stateMs).reduce((a,b)=>a+b,0),4*2100);assert.equal(s.stateMs.AUDIT_ACTIVE,200);assert.equal(s.stateMs.REPLACEMENT_WAIT,200);assert.equal(s.counts.distinctAudited,1);assert.equal(s.counts.distinctPreliminaryEvaluated,1);assert.equal(s.counts.distinctPrimaryEvaluated,0);assert.equal(s.counts.repromotions,1);
  assert.deepEqual(s.waits.queueToAllocation,{count:2,sum:600,mean:300,max:500,p50:100,p95:500});assert.equal(s.waits.auditReadyToPhysicalStart.p50,300);assert.equal(s.waits.allocationToAck.p95,100);assert.equal(s.waits.ackToWarm.p50,800);assert.equal(s.waits.retirementToReplacement.max,200);
  assert.ok(projectNativeSlotProductivityReporting({slotProductivity:s},start+2100),'the actual producer DTO passes existing dashboard projection');
 }finally{registry.close();}
});

test('provider waits and local waits stay separate; no receipt means no active-audit duration',()=>{
 const {registry,tracker}=setup();try{
  tracker.allocated(mintA,start,start,0);tracker.opened(mintA,start);tracker.warmed(mintA,start+1000);tracker.ready(mintA,start+1000,start+1000);tracker.waiting(mintA,start+1100,true,'provider-query-cooldown');tracker.waiting(mintA,start+1500,false,'financial-runway');
  const s=tracker.snapshot(start+1700);assert.equal(s.stateMs.PROVIDER_WAIT,400);assert.equal(s.stateMs.AUDIT_WAIT,200);assert.equal(s.stateMs.AUDIT_ACTIVE,0);assert.equal(s.waits.auditReadyToPhysicalStart.count,0);assert.equal(s.waits.auditReadyToPhysicalStart.p50,null);assert.equal(s.slots.filter(row=>row.mint!==null).length,1);
 }finally{registry.close();}
});

test('actual financial callbacks deduplicate and retain assignment after retirement without guessing unknown attribution',()=>{
 const {registry,tracker}=setup();try{
  tracker.allocated(mintA,start,start,0);tracker.retired(mintA,start+100,'financially-owned');tracker.allocated(mintB,start+200,start+100,0);
  for(const kind of ['primary-evaluated','qualified','entry-fill','exit-fill'] as const){tracker.financial({mint:mintA,kind,at:start+300,key:'real:'+kind});tracker.financial({mint:mintA,kind,at:start+300,key:'real:'+kind});}
  tracker.financial({mint:mintB,kind:'primary-evaluated',at:start+400,key:'real:primary-evaluated'});tracker.financial({mint:'unknown',kind:'entry-fill',at:start+400,key:'unknown-assignment'});const s=tracker.snapshot(start+500);
  assert.equal(s.counts.distinctPrimaryEvaluated,2,'same financial window key across different mints cannot collide');assert.equal(s.counts.qualified,1);assert.equal(s.counts.entryFills,1);assert.equal(s.counts.exitFills,1);assert.equal(s.counts.unattributedFinancialEvents,1);assert.equal(s.counts.distinctAudited,0);assert.equal(s.slots.length,4);
  const saved=registry.getMetadata<any>(sourceInstanceId+':slot-productivity:financial:exit-fill:'+mintA+':real:exit-fill');assert.equal(saved.slot,0);assert.equal(saved.mint,mintA);assert.equal(saved.financialPermission,false);
 }finally{registry.close();}
});


test('retrospective usable-evidence coverage unions overlapping audited windows and clamps to actual ACK',()=>{
 const {registry,tracker}=setup();try{tracker.allocated(mintA,start,start,0);tracker.opened(mintA,start+200);tracker.ready(mintA,start+1000,start+1100);tracker.evaluated(mintA,start-500,start+1000,start+1200);tracker.ready(mintA,start+1200,start+1300);tracker.evaluated(mintA,start+400,start+1200,start+1400);const s=tracker.snapshot(start+1500);assert.equal(s.evidenceCoverage.verifiedEvidenceMs,1000,'pre-ACK data and overlapping window suffixes never add duplicate coverage');assert.equal(s.evidenceCoverage.occupiedSlotMs,1500);assert.equal(s.evidenceCoverage.percent,1000*100/1500);assert.equal(s.counts.distinctAudited,1);assert.equal(s.counts.distinctPreliminaryEvaluated,1);}finally{registry.close();}
});


test('failure counts deduplicate actual windows and never label missing capture as provider latency',()=>{
 const {registry,tracker}=setup();try{for(let i=0;i<3;i++)tracker.failed(mintA,start+1000,start+1100,'audit-unusable','NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED');tracker.failed(mintA,start+1000,start+1200,'decision-expired','DECISION_DEADLINE_EXPIRED');tracker.failed(mintA,start+2000,start+2100,'audit-unavailable','PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT');tracker.failed(mintA,0,start+2200,'audit-unavailable','PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT');assert.deepEqual(tracker.snapshot(start+2300).failureCounts,{historyNotObservedWindows:1,decisionDeadlineWindows:1,auditUnusableWindows:1,providerUnavailableWindows:1});}finally{registry.close();}
});
