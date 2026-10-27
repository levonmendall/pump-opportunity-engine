/** Controller policies only: no network, live account, or natural trade. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolvePilotStage,recordPilotStageTransition,pilotLowerPriorityAdmission,pilotAuditFailurePolicy,pilotCandidateWindowReady,pilotDiscretionaryAdmission,pilotObservationReadyAt,pilotCurrentContextMarks,pilotOpenProtectionGaps,pilotCapacity} from '../src/pilot.js';
import {PILOT_CONTRACT,PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';

test('explicit stage transitions preserve account/inception and append known capacity contracts',()=>{
  const manifest={accountId:'poe-pilot-fixture-policy',inceptionAt:1000,contractSha256:PILOT_CONTRACT_SHA256 as string,stageHistory:[] as Array<{runId:string;at:number;stage:'single'|'shadow'|'two'|'three';contractSha256:string;previousContractSha256:string}>};
  assert.equal(resolvePilotStage('single').contract,PILOT_CONTRACT);
  const shadow=recordPilotStageTransition(manifest,'shadow','fixture-shadow',2000);assert.equal(shadow.maximumCandidates,2);assert.equal(shadow.maximumPositions,1);assert.equal(manifest.contractSha256,PILOT_CONTRACT_SHA256);
  const two=recordPilotStageTransition(manifest,'two','fixture-two',3000),three=recordPilotStageTransition(manifest,'three','fixture-three',4000);
  assert.equal(two.maximumPositions,2);assert.equal(three.maximumPositions,3);assert.equal(manifest.accountId,'poe-pilot-fixture-policy');assert.equal(manifest.inceptionAt,1000);assert.equal(manifest.stageHistory.length,3);
  assert.equal(two.contract.baseline,PILOT_CONTRACT.baseline);assert.equal(three.contract.execution,PILOT_CONTRACT.execution);assert.equal(three.contract.risk.maximumAggregatePositionCostMicroUsd,'150000000');
  assert.throws(()=>resolvePilotStage('unlimited'),/UNKNOWN_STAGE/);assert.throws(()=>recordPilotStageTransition({...manifest,contractSha256:'foreign'},'three','fixture-foreign',5000),/TRANSITION_BINDING/);
});

test('a nonpreemptible lower-priority sequence yields before consuming protection recovery envelope',()=>{
  let now=1100;const served:number[]=[];
  for(let i=0;i<5;i++){
    const decision=pilotLowerPriorityAdmission({now,endAt:100000,held:3,lastUsable:1000,nextPendingAt:null});if(!decision.admitted)break;
    served.push(now);now+=1000; // Explicit synthetic one-second physical occupancy.
  }
  assert.deepEqual(served,[1100,2100]);assert.equal(pilotLowerPriorityAdmission({now,endAt:100000,held:3,lastUsable:1000,nextPendingAt:null}).admitted,false);
  // The remaining125ms dispatch+1200ms physical protection bound finishes
  // within the experimental deadline. No provider timing is inferred.
  assert.ok(now+125+1200<=5000);
  assert.equal(pilotLowerPriorityAdmission({now:1100,endAt:100000,held:1,lastUsable:null,nextPendingAt:null}).admitted,false);
  assert.equal(pilotLowerPriorityAdmission({now:1100,endAt:100000,held:0,lastUsable:null,nextPendingAt:2000}).admitted,false);
});

test('transient verification failures defer without resetting thirty-second backlog or inventing coverage',()=>{
  const first=pilotAuditFailurePolicy('PILOT_RPC_COMPONENT_HTTP_STATUS_503',null,1000,3000);assert.equal(first.defer,true);assert.equal(first.retryAt,3000);
  const again=pilotAuditFailurePolicy('PILOT_RPC_COMPONENT_HTTP_STATUS_503',first.firstUnavailableAt,20000,25000);assert.equal(again.firstUnavailableAt,1000);assert.equal(again.defer,true);assert.equal(again.retryAt,25000);
  assert.equal(pilotAuditFailurePolicy('PILOT_RPC_COMPONENT_HTTP_STATUS_503',first.firstUnavailableAt,31000,35000).defer,false);
  assert.equal(pilotAuditFailurePolicy('PILOT_HISTORY_OMITTED_OR_CHANGED_KNOWN_TRADE',null,1000,0).defer,false);
});


test('a cached previous bucket or later quote cannot authorize an unaudited current window',()=>{
  const state={warm:true,fullyEnriched:true,hasQualityLoss:false,windowEndAt:100000,auditedThrough:100000,flowAt:30000,connected:true};
  assert.equal(pilotCandidateWindowReady(state,109999),true);
  assert.equal(pilotCandidateWindowReady(state,110000),false);
  assert.equal(pilotCandidateWindowReady({...state,windowEndAt:110000},110001),false);
  assert.equal(pilotCandidateWindowReady({...state,windowEndAt:110000,auditedThrough:110000},110001),true);
});

test('held discretionary reservation includes pre-entry history without creating a second provider budget',()=>{
  const history=Array.from({length:20},(_,i)=>10000+i*250);
  assert.equal(pilotDiscretionaryAdmission(history,15000).admitted,false);
  assert.equal(pilotDiscretionaryAdmission(history,70000).admitted,true);
  assert.equal(pilotDiscretionaryAdmission(history.slice(0,15),15000,true).admitted,true);
  assert.equal(pilotDiscretionaryAdmission(history.slice(0,16),15000,true).admitted,false);
  // Additional existing-socket observation leaves room for five periodic held
  // checks; it does not reserve an upgrade that will never occur.
  assert.equal(pilotObservationReadyAt([10000,12000,14000,16000,18000],19000,20,{short:10,minute:10}),19000);
});


test('source expiry at actual reconciliation use and ongoing outage tails remain explicit',()=>{
  const marks={fixture:{netLamports:'9',pricedBaseUnits:'1',at:1000,evidence:'ISOLATED'}};
  assert.deepEqual(pilotCurrentContextMarks({price:null,marks,sourceValidUntil:1000},1000,true),marks);
  assert.deepEqual(pilotCurrentContextMarks({price:null,marks,sourceValidUntil:1000},1001,true),{});
  assert.deepEqual(pilotCurrentContextMarks({price:null,marks},1000,true),{});
  const last=new Map([['a',{units:'1',at:1000}]]);
  const gaps=pilotOpenProtectionGaps({a:{units:'1'},b:{units:'2'}},last,6000,1500);
  assert.deepEqual(gaps.map(x=>[x.mint,x.gapMs,x.rightCensored,x.overdue,x.completedEvaluationAvailable]),[['a',5000,true,true,true],['b',4500,true,true,false]]);
  assert.equal(last.get('a')!.at,1000,'reporting never refreshes a completed evaluation');
});


test('shadow collection does not require a new exposure runway and preserves held reserves',()=>{
 const input={remainingMs:180000,remainingUnits:600,remainingBytes:7*1024*1024,held:1,rpcAvailable:true,streamBytes:0};
 assert.deepEqual(pilotCapacity(input),{entry:false,observation:true});
 assert.deepEqual(pilotCapacity({...input,remainingUnits:489}),{entry:false,observation:false});
 assert.deepEqual(pilotCapacity({...input,held:0,remainingUnits:30}),{entry:false,observation:true});
 assert.equal(pilotCapacity({...input,remainingMs:89999}).observation,false);
 assert.equal(pilotCapacity({...input,rpcAvailable:false}).observation,false);
 assert.deepEqual(pilotCapacity({...input,remainingMs:910000}),{entry:true,observation:true});
});


test('a newly filled position starts its protection clock at entry, not prior candidate warm-up',()=>{
 const gaps=pilotOpenProtectionGaps({newlyFilled:{units:'100',enteredAt:61000}},new Map(),61500,1000);
 assert.equal(gaps[0]!.gapMs,500);assert.equal(gaps[0]!.overdue,false);assert.equal(gaps[0]!.from,61000);
});
