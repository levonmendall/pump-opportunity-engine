import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runMonitoringReplay,type MonitoringPolicy,type MonitoringReplayInput,type MonitoringObservation} from '../src/adaptive-monitoring.js';

const stable=[{at:0,netLamports:'100000000'}];
const heartbeats=(end=60000)=>Array.from({length:Math.floor(end/5000)+1},(_,i)=>({at:i*5000,kind:'heartbeat' as const}));
function config(policy:MonitoringPolicy,observations:MonitoringObservation[]=stable,extra:Partial<MonitoringReplayInput>={}):MonitoringReplayInput{
  return {policy,startAt:0,endAt:60000,sourceMode:'dense-synthetic',latencyMs:200,notifications:heartbeats(),positions:[{id:'A',enteredAt:0,entryCostLamports:'100000000',units:'100',observations}],...extra};
}

test('fixed2/5/10 schedules use fewer requests but do not pretend their old cache stays fresh',()=>{
  const [a,b,c]=(['fixed-2s','fixed-5s','fixed-10s'] as const).map(p=>runMonitoringReplay(config(p)));
  assert.deepEqual([a!.requestsByKind.pricing,b!.requestsByKind.pricing,c!.requestsByKind.pricing],[30,12,6]);
  for(const r of [a!,b!,c!]){assert.equal(r.positions[0]!.quoteAgeAtUseMs.maximum,200);assert.equal(r.positions[0]!.staleQuoteUsedForAction,0);assert.equal(r.networkRequests,0);}
  assert.ok(b!.positions[0]!.unavailableOrStaleQuoteCacheFraction>a!.positions[0]!.unavailableOrStaleQuoteCacheFraction);
  assert.ok(c!.positions[0]!.unavailableOrStaleQuoteCacheFraction>b!.positions[0]!.unavailableOrStaleQuoteCacheFraction);
});

test('a real notification trigger requests a new coherent quote independently of old safe risk classification',()=>{
  const obs=[...stable,{at:3001,netLamports:'80000000'}],notifications=[...heartbeats(12000),{at:3001,positionId:'A',kind:'change' as const}];
  const fixed=runMonitoringReplay(config('fixed-5s',obs,{endAt:12000,notifications}));
  const hybrid=runMonitoringReplay(config('hybrid-5s',obs,{endAt:12000,notifications}));
  assert.equal(fixed.positions[0]!.firstActionableExit!.at,5200);assert.equal(hybrid.positions[0]!.firstActionableExit!.at,3201);
  assert.equal(hybrid.positions[0]!.thresholdEpisodes[0]!.recognitionDelayMs,200);
  assert.equal(hybrid.positions[0]!.exit!.at,4401);assert.equal(hybrid.positions[0]!.modeledPnlLamports,'-20000000');
});

test('silent lost notifications with healthy heartbeats can make five-second hybrid miss a transient stop',()=>{
  const obs=[...stable,{at:2501,netLamports:'80000000'},{at:4501,netLamports:'100000000'}];
  const baseline=runMonitoringReplay(config('fixed-2s',obs,{endAt:12000}));
  const hybrid=runMonitoringReplay(config('hybrid-5s',obs,{endAt:12000}));
  assert.equal(baseline.positions[0]!.firstActionableExit!.at,4200);assert.equal(hybrid.positions[0]!.firstActionableExit,null);
  assert.equal(hybrid.positions[0]!.missedThresholdEpisodes,1);assert.equal(hybrid.notifications.healthyAtEnd,true);
  assert.equal(hybrid.positions[0]!.exit,null);
});

test('notification changes arriving during an RPC remain dirty and coalesce without becoming prices',()=>{
  const obs=[...stable,{at:500,netLamports:'80000000'}];
  const r=runMonitoringReplay(config('hybrid-5s',obs,{endAt:6000,latencyMs:1000,notifications:[{at:500,kind:'change'},{at:700,kind:'change'}]}));
  assert.equal(r.positions[0]!.evaluations[0]!.netLamports,'100000000');
  assert.equal(r.positions[0]!.firstActionableExit!.at,3000);assert.equal(r.positions[0]!.firstActionableExit!.sourceAt,2000);
  assert.equal(r.notifications.coalescedChanges,1);assert.ok(r.requests.filter(q=>q.kind==='pricing').some(q=>q.at===2000));
});

test('all request classes share actual start spacing and bounded physical occupancy',()=>{
  const jobs=Array.from({length:20},(_,i)=>({at:201+i,kind:'candidate' as const,deadlineAt:10000}));
  const r=runMonitoringReplay(config('fixed-5s',stable,{endAt:12000,backgroundJobs:jobs,backgroundStartsPerMinute:60}));
  assert.ok(r.minimumObservedStartGapMs!==null&&r.minimumObservedStartGapMs>=1000);
  assert.ok(r.maximumStartsPerTenSeconds<=10);assert.ok(r.maximumRollingMinuteStarts<=60);
  assert.equal(r.physicalRequestsInFlightMaximum,1);assert.ok(r.background.candidateMissed>0);
});

test('long nonprotection RPC cannot release an imaginary slot; its delay and candidate loss remain visible',()=>{
  const r=runMonitoringReplay(config('fixed-2s',stable,{endAt:10000,backgroundJobs:[{at:1000,kind:'candidate',deadlineAt:3000}],requestLatency:(_at,kind)=>kind==='candidate'?3500:200}));
  assert.equal(r.physicalRequestsInFlightMaximum,1);assert.equal(r.background.candidateMissed,1);
  assert.ok(r.maximumPricingStartDelayMs>=2500);assert.ok(r.positions[0]!.maximumFreshEvaluationGapMs>=4500);
  const q=r.requests.find(q=>q.kind==='candidate')!;assert.equal(q.at,1000);assert.equal(q.finishAt,4500);
});

test('disconnection fallback restores subscriptions and keeps a missing held pool unreconciled',()=>{
  const positions=[{id:'A',enteredAt:0,entryCostLamports:'100000000',units:'100',observations:stable},{id:'B',enteredAt:0,entryCostLamports:'100000000',units:'100',observations:[...stable,{at:1000,netLamports:null}]}];
  const r=runMonitoringReplay(config('hybrid-5s',stable,{endAt:8000,positions,notifications:[{at:1000,kind:'disconnect'},{at:2000,kind:'reconnected'},{at:2500,kind:'subscriptions-restored'}]}));
  assert.equal(r.notifications.healthyAtEnd,true);assert.equal(r.notifications.coherentRestorePending,true);assert.deepEqual(r.notifications.restorePoolsPending,['B']);
  assert.ok(r.positions[1]!.unavailableEvaluations>0);assert.ok(r.notifications.healthEvents.some(e=>e.reason.includes('not-restored')));
});

test('a targeted trigger refreshes the coherent held union and avoids staggered duplicate polls',()=>{
  const positions=['A','B','C'].map(id=>({id,enteredAt:0,entryCostLamports:'100000000',units:'100',observations:stable}));
  const r=runMonitoringReplay(config('hybrid-5s',stable,{endAt:10000,positions,notifications:[...heartbeats(10000),{at:2001,positionId:'B',kind:'change'}]}));
  assert.deepEqual(r.requests.filter(q=>q.kind==='pricing').map(q=>q.at),[0,2001,7001]);
  assert.ok(r.requests.filter(q=>q.kind==='pricing').every(q=>q.ids.length===3));
  assert.equal(r.positions[0]!.freshEvaluations,r.positions[2]!.freshEvaluations);
});

test('maximum-holding timer reserves a fresh evaluation even under the ten-second policy',()=>{
  const r=runMonitoringReplay(config('fixed-10s',stable,{startAt:899000,endAt:905000,notifications:[],positions:[{id:'A',enteredAt:0,entryCostLamports:'100000000',units:'100',observations:stable}]}));
  assert.equal(r.positions[0]!.firstActionableExit!.at,900200);assert.ok(r.positions[0]!.firstActionableExit!.reason.includes('maximum-holding-time'));
  assert.equal(r.positions[0]!.exit!.status,'filled');
});

test('failed or stale quotes cannot create an actionable exit, free fill or disappearance',()=>{
  const r=runMonitoringReplay(config('fixed-2s',[{at:0,netLamports:'70000000'}],{endAt:10000,latencyMs:2500}));
  assert.equal(r.positions[0]!.freshEvaluations,0);assert.equal(r.positions[0]!.firstActionableExit,null);
  assert.equal(r.positions[0]!.exit,null);assert.equal(r.positions[0]!.unresolvedPosition,true);
  assert.equal(r.positions[0]!.markedPnlAtEndLamports,null);assert.equal(r.positions[0]!.staleQuoteUsedForAction,0);
});

test('sparse captured replay preserves original availability and never refreshes an old quote at poll time',()=>{
  const obs=[{at:0,availableAt:100,sourceAt:0,marketTimeAt:0,netLamports:'100000000'},{at:5000,availableAt:5100,sourceAt:5000,marketTimeAt:5000,netLamports:'100000000'}];
  const r=runMonitoringReplay(config('fixed-2s',obs,{startAt:100,endAt:8000,sourceMode:'sparse-captured'}));
  assert.equal(r.positions[0]!.evaluations[0]!.sourceAt,0);assert.ok(r.positions[0]!.unavailableEvaluations>=2);
  assert.ok(r.positions[0]!.evaluations.every(e=>e.sourceAt===null||e.sourceAt===0||e.sourceAt===5000));
});

test('failed first delayed execution is final and its cost is explicit, with no favorable later retry',()=>{
  const obs=[...stable,{at:3001,netLamports:'80000000'},{at:4300,netLamports:'60000000'},{at:8000,netLamports:'100000000'}];
  const r=runMonitoringReplay(config('hybrid-5s',obs,{endAt:12000,notifications:[...heartbeats(),{at:3001,kind:'change'}]}));
  const p=r.positions[0]!;assert.equal(p.exit!.status,'filled'); // snapshot at4201 precedes4300 adverse change
  assert.equal(p.exit!.netLamports,'80000000');assert.equal(r.requests.filter(q=>q.kind==='exit').length,1);
  const failed=runMonitoringReplay(config('hybrid-5s',[...stable,{at:3001,netLamports:'80000000'},{at:4100,netLamports:'60000000'},{at:8000,netLamports:'100000000'}],{endAt:12000,notifications:[...heartbeats(),{at:3001,kind:'change'}]}));
  assert.equal(failed.positions[0]!.exit!.status,'failed');assert.equal(failed.positions[0]!.failedExecutionCostLamports,'7000');assert.equal(failed.positions[0]!.unresolvedPosition,true);assert.equal(failed.requests.filter(q=>q.kind==='exit').length,1);
});

test('counterfactual monitoring and actual first-exit exposure denominators remain distinct',()=>{
  const r=runMonitoringReplay(config('fixed-2s',[{at:0,netLamports:'80000000'},{at:10000,netLamports:'140000000'}],{endAt:20000,stopAfterExit:true}));
  const p=r.positions[0]!;assert.equal(p.exit!.status,'filled');assert.equal(p.positionDurationMs,p.exit!.at);
  assert.equal(p.activeEndAt,p.exit!.at);assert.equal(r.requests.filter(q=>q.kind==='pricing').length,1);
  assert.equal(p.thresholdEpisodes.length,1);assert.equal(p.thresholdEpisodes[0]!.kind,'stop');assert.equal(p.missedThresholdEpisodes,0);
});

test('an exit that cannot get its first permitted attempt before expiry stays unresolved without a later fill',()=>{
  const r=runMonitoringReplay(config('fixed-2s',[{at:0,netLamports:'80000000'}],{endAt:12000,requestLimitPerMinute:1}));
  const p=r.positions[0]!;assert.equal(p.exit!.status,'expired');assert.equal(p.exit!.failedCostLamports,'0');
  assert.equal(p.unresolvedPosition,true);assert.equal(p.modeledPnlLamports,null);assert.equal(r.requests.filter(q=>q.kind==='exit').length,0);
});


test('exit slippage compares gross SDK proceeds before gas exactly as Trader.reserveExit',()=>{
  const gas=7000n,decisionNet=80000000n,minGross=(decisionNet+gas)*9500n/10000n,netAtBoundary=minGross-gas;
  const observations=[{at:0,netLamports:decisionNet.toString()},{at:1000,netLamports:netAtBoundary.toString()}];
  const filled=runMonitoringReplay(config('fixed-2s',observations,{endAt:4000,exitGasLamportsIncluded:gas.toString(),exitSlippageBps:500}));
  const p=filled.positions[0]!;assert.equal(p.firstActionableExit!.grossLamports,(decisionNet+gas).toString());
  assert.equal(p.exit!.minimumGrossReceiveLamports,minGross.toString());assert.equal(p.exit!.attemptGrossLamports,minGross.toString());
  assert.equal(p.exit!.status,'filled');assert.equal(p.exit!.netLamports,netAtBoundary.toString());
  assert.equal(p.modeledPnlLamports,(netAtBoundary-100000000n).toString());
  // The prior net*95% constraint would incorrectly fail this exact gross boundary.
  assert.ok(netAtBoundary<decisionNet*9500n/10000n);
  const failed=runMonitoringReplay(config('fixed-2s',[observations[0]!,{at:1000,netLamports:(netAtBoundary-1n).toString()}],{endAt:4000,exitGasLamportsIncluded:gas.toString(),exitSlippageBps:500}));
  assert.equal(failed.positions[0]!.exit!.status,'failed');assert.equal(failed.positions[0]!.failedExecutionCostLamports,'7000');
  assert.equal(failed.positions[0]!.unresolvedPosition,true);assert.equal(failed.requests.filter(r=>r.kind==='exit').length,1);
});


test('response at or beyond exact order expiry expires before any modeled attempt gas',()=>{
  for(const exitLatency of [4000,4001]){
    const r=runMonitoringReplay(config('fixed-2s',[{at:0,netLamports:'80000000'}],{endAt:8000,requestLatency:(_at,kind)=>kind==='exit'?exitLatency:200}));
    const p=r.positions[0]!;assert.equal(p.firstActionableExit!.at,200);assert.equal(p.exit!.status,'expired');
    assert.equal(p.exit!.at,1200+exitLatency);assert.equal(p.exit!.failedCostLamports,'0');assert.equal(p.failedExecutionCostLamports,'0');
    assert.equal(p.unresolvedPosition,true);assert.equal(r.requests.filter(q=>q.kind==='exit').length,1);
  }
});

test('a fresh sparse quote from before modeled executeAt cannot fill an exit',()=>{
  const r=runMonitoringReplay(config('fixed-2s',[{at:0,availableAt:0,sourceAt:0,netLamports:'80000000'}],{endAt:4000,sourceMode:'sparse-captured'}));
  const p=r.positions[0]!;assert.equal(p.firstActionableExit!.at,200);assert.equal(p.exit!.at,1400);
  assert.equal(p.exit!.status,'failed');assert.equal(p.exit!.reason,'fresh-size-quote-unavailable');
  assert.equal(p.failedExecutionCostLamports,'7000');assert.equal(p.unresolvedPosition,true);
});
