/** Controller policies only: no network, live account, or natural trade. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolvePilotStage,recordPilotStageTransition,pilotLowerPriorityAdmission,pilotAuditFailurePolicy,pilotPreparationDeferrable,pilotCandidateWindowReady,pilotInitialAuditReady,pilotDiscretionaryAdmission,pilotObservationReadyAt,pilotCurrentContextMarks,pilotOpenProtectionGaps,pilotCapacity,pilotEligibilityRunway,choosePilotPreparation,nextPreparedPilotSeed} from '../src/pilot.js';
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


test('fresh candidate runway uses the unchanged closed window and audit timing and rechecks preparation delay',()=>{
 const migration=1000000,expiry=migration+7200000;
 assert.equal(pilotEligibilityRunway(migration,expiry).allowed,false);
 const before=pilotEligibilityRunway(migration,expiry-80000);assert.equal(before.allowed,true);assert.equal(before.firstWindowEndAt,expiry-20000);assert.equal(before.earliestAuditStartAt,expiry-15000);
 assert.equal(pilotEligibilityRunway(migration,expiry-65000).allowed,false,'aligned window would need audit at or after expiry');
 assert.equal(pilotEligibilityRunway(migration,expiry-1000).allowed,false,'support preparation cannot authorize an unusable fresh window');
});

test('fresh discovery gets bounded service alongside prepared cache without dispatching immature or backed-off hints',()=>{
 const cached={signature:'cached',receivedAt:1},fresh={signature:'fresh',receivedAt:5000},immature={signature:'too-new',receivedAt:39999},backoff={signature:'backoff',receivedAt:1,eligibleAfter:90000};
 let choice=choosePilotPreparation(cached,[immature,backoff,fresh],40000,true)!;assert.equal(choice.kind,'fresh-discovery');assert.equal(choice.index,2);
 choice=choosePilotPreparation(cached,[fresh],40000,choice.preferFreshNext)!;assert.equal(choice.kind,'verified-cache');
 choice=choosePilotPreparation(cached,[fresh],40000,choice.preferFreshNext)!;assert.equal(choice.kind,'fresh-discovery');
 assert.equal(choosePilotPreparation(null,[immature,backoff],40000,true),null);
});


test('prepared selection prefers recent eligible identities and excludes only impossible fresh-window age runways',()=>{
 const now=10000000;
 const proof=(mint:string,age:number)=>({identity:{baseMint:mint,signature:'fixture-'+mint,chainBlockTime:(now-age)/1000},evidence:'ISOLATED identity timing fixture'});
 const pools={near:proof('near-expiry',7190000),old:proof('older',600000),recent:proof('recent',300000)};
 assert.equal(nextPreparedPilotSeed(pools as any,new Set(),now)?.feedMint,'recent');
 assert.equal(nextPreparedPilotSeed(pools as any,new Set(['recent']),now)?.feedMint,'older');
 assert.equal(nextPreparedPilotSeed(pools as any,new Set(['recent','older']),now),null);
});


test('observation concurrency is independent of the permitted financial stage',()=>{
 const stage=resolvePilotStage('three',2);assert.equal(stage.maximumCandidates,2);assert.equal(stage.maximumPositions,3);assert.equal(stage.binding.maxPositions,3);
 assert.equal(stage.contract.baseline,PILOT_CONTRACT.baseline);assert.equal(stage.contract.execution,PILOT_CONTRACT.execution);
 assert.equal(resolvePilotStage('two',1).maximumPositions,2);assert.equal(resolvePilotStage('three').maximumCandidates,3);
 assert.throws(()=>resolvePilotStage('single',2),/CANDIDATE_STAGE_LIMIT/);assert.throws(()=>resolvePilotStage('three',4),/CANDIDATE_STAGE_LIMIT/);assert.throws(()=>resolvePilotStage('three',0),/CANDIDATE_STAGE_LIMIT/);
});


test('required candidate enrichment precedes lower-priority preparation without requiring a held position',()=>{
 const start=100000,arrivals=[100078,100150,100200],remaining=[...arrivals],completed:number[]=[],starts:number[]=[];
 // Explicit counterfactual50ms responses and250ms shared pacing. The retained
 // forward responses are not assumed identical at different request times.
 let now=start;let lastStart=-Infinity;
 while(remaining.length){
  const pending=remaining.some(t=>t<=now);
  const preparation=pilotLowerPriorityAdmission({now,endAt:start+20000,held:0,lastUsable:null,nextPendingAt:null,candidatePending:pending});
  if(pending){assert.equal(preparation.admitted,false);const received=remaining.shift()!;now=Math.max(now,received+1000,lastStart+250);const enrich=pilotLowerPriorityAdmission({now,endAt:start+20000,held:0,lastUsable:null,nextPendingAt:null,candidatePending:false});assert.equal(enrich.admitted,true);lastStart=now;starts.push(now);now+=50;completed.push(now-received);}
  else now=arrivals[0]!;
 }
 assert.deepEqual(starts,[101078,101328,101578]);assert.ok(completed.every(delay=>delay<=5000));
 const held=pilotLowerPriorityAdmission({now:start+2500,endAt:start+20000,held:3,lastUsable:start,nextPendingAt:null,candidatePending:true});assert.equal(held.admitted,false,'known required flow cannot make preparation consume held reserve either');
});


test('local prephysical deferrals preserve discovery seeds and bounded independent audit recovery',()=>{
 for(const reason of ['PILOT_RPC_COMPONENT_ADMISSION_CLOSED','PILOT_RPC_COMPONENT_DISPATCH_EXPIRED','PILOT_SCHEDULER_LOWER_PRIORITY_DEFER']){
  assert.equal(pilotPreparationDeferrable(reason),true);
  const initial=pilotAuditFailurePolicy(reason,null,1000,0);assert.equal(initial.defer,true);assert.equal(initial.firstUnavailableAt,1000);
  assert.equal(pilotAuditFailurePolicy(reason,initial.firstUnavailableAt,30999,0).defer,true);
  assert.equal(pilotAuditFailurePolicy(reason,initial.firstUnavailableAt,31000,0).defer,false);
 }
 assert.equal(pilotPreparationDeferrable('PILOT_HISTORY_UNSUPPORTED_EVENT'),false);
 assert.equal(pilotAuditFailurePolicy('PILOT_RPC_COMPONENT_RESPONSE_CAP',null,1000,0).defer,false);
});


test('explicit progressive deep slots leave financial position contracts independent',()=>{
 for(const slots of [3,6,12]){const c=resolvePilotStage('three',undefined,slots);assert.equal(c.maximumCandidates,slots);assert.equal(c.maximumPositions,3);assert.equal(c.binding.maxPositions,3);assert.equal(c.contract.baseline,PILOT_CONTRACT.baseline);}
 assert.throws(()=>resolvePilotStage('single',undefined,3),/DEEP_STAGE_LIMIT/);assert.throws(()=>resolvePilotStage('three',2,6),/DEEP_STAGE_LIMIT/);assert.throws(()=>resolvePilotStage('three',undefined,20),/DEEP_STAGE_LIMIT/);
});

test('warm-up audit deferral never bypasses the first complete closed-window or current audit barrier',()=>{
 const flowAt=1001;for(const at of [15000,25000,35000,45000,55000,65000,74999])assert.equal(pilotInitialAuditReady(flowAt,at),false);
 assert.equal(pilotInitialAuditReady(flowAt,75000),true);assert.equal(pilotInitialAuditReady(flowAt,80000),false);assert.equal(pilotInitialAuditReady(flowAt,85000),true);
 assert.equal(pilotCandidateWindowReady({warm:true,fullyEnriched:true,hasQualityLoss:false,windowEndAt:70000,auditedThrough:1001,flowAt,connected:true},75000),false);
 assert.equal(pilotCandidateWindowReady({warm:true,fullyEnriched:true,hasQualityLoss:false,windowEndAt:70000,auditedThrough:70000,flowAt,connected:true},75000),true);
});


test('support phase reserves all five reads before consuming the opening headroom',()=>{
 const starts=[10000,10250,10500,10750,11000],now=11250;
 // Old post-phase check required15free slots only after spendingfive calls.
 assert.equal(pilotObservationReadyAt(starts,now,20,{short:15,minute:20}),now);
 const ready=pilotObservationReadyAt(starts,now,20,{short:20,minute:25});assert.equal(ready,21000);
 assert.equal(pilotObservationReadyAt(starts,ready,20,{short:20,minute:25}),ready);
 const five=Array.from({length:5},(_,i)=>ready+i*250);
 assert.equal(pilotObservationReadyAt(five,ready+1250,20,{short:15,minute:20}),ready+1250,'after admission allfive freshreads stillleaveopeningheadroom');
 const discretionary=Array.from({length:16},(_,i)=>10000+i*250);assert.equal(pilotDiscretionaryAdmission(discretionary,15000).admitted,true);assert.equal(pilotDiscretionaryAdmission(discretionary,15000,false,5).admitted,false);
 assert.equal(pilotDiscretionaryAdmission(discretionary,70000,false,5).admitted,true);
});
