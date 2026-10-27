import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSharedScheduler,simulateSharedScheduler,syntheticPhaseCounterexamples,type SimulatedJob} from '../scripts/evaluate-shared-scheduler.js';

const evaluated=evaluateSharedScheduler();
const scenario=(name:string)=>{const s=evaluated.simulations.find(s=>s.name===name);assert.ok(s,name);return s;};
const cost={httpMs:80,parseMs:20,actuationMs:2};
function job(id:string,at:number,kind:SimulatedJob['kind']='enrichment',deadline=at+5000):SimulatedJob{return {id,kind,enqueuedAt:at,eligibleAt:kind==='enrichment'?at+1000:at,deadlineAt:deadline,operationBoundMs:1200,cost:{...cost}};}

test('retained3.224s gap remains actual arithmetic while rescheduled costs are explicitly counterfactual',()=>{
  assert.equal(evaluated.measuredReference.maximumCompletedGapMs,3224);assert.equal(evaluated.measuredReference.partitionSumMs,3224);
  assert.equal(evaluated.measuredReference.longestGapArithmetic.reduce((n:number,x:any)=>n+x.ms,0),3224);
  assert.equal(evaluated.originalInputsUnchanged,true);assert.equal(evaluated.networkRequests,0);
  for(const s of evaluated.simulations){assert.equal(s.classification,'DETERMINISTIC_COUNTERFACTUAL_SCHEDULING_NOT_MARKET_PERFORMANCE');assert.equal('financialPnl'in s,false);assert.equal(s.networkRequests,0);}
});

test('the zero-width reservation starves required enrichment instead of establishing full-flow capacity',()=>{
  for(const jitter of [0,10,50,100]){
    const s=scenario('trace11-strict-zero-window-jitter'+jitter);assert.equal(s.enrichments.submitted,6);assert.equal(s.enrichments.completedWithinFiveSeconds,0);assert.equal(s.requestsByKind.enrichment,0);assert.ok(s.requiredEvidenceLosses>0);assert.ok(s.enrichments.refused+s.enrichments.pendingAtEnd===6);
  }
});

test('adaptive gate wake avoids the fixed wake failure only within a measured offline jitter envelope',()=>{
  const zero=scenario('trace11-bounded-deadline-v1-jitter0'),ten=scenario('trace11-bounded-deadline-v1-jitter10'),fifty=scenario('trace11-bounded-deadline-v1-jitter50'),hundred=scenario('trace11-bounded-deadline-v1-jitter100'),fixed=scenario('trace11-bounded-fixed-wake-negative');
  assert.equal(zero.enrichments.completedWithinFiveSeconds,6);assert.equal(ten.enrichments.completedWithinFiveSeconds,6);assert.equal(zero.requiredEvidenceLosses,0);assert.equal(ten.requiredEvidenceLosses,0);
  assert.equal(zero.requests,43);assert.equal(zero.earlyProtectionStarts,5);assert.equal(zero.maximumCompletedEvaluationGapMs,2041);assert.ok(zero.completedGapsBeyondTwoSecondReference>0);
  assert.equal(fifty.enrichments.completedWithinFiveSeconds,5);assert.equal(fifty.enrichments.refused,1);assert.equal(fifty.requiredEvidenceLosses,1);assert.equal(hundred.enrichments.completedWithinFiveSeconds,0);assert.equal(hundred.enrichments.refused,5);assert.equal(hundred.enrichments.deadlineCensoredPendingAtEnd,1);assert.ok(fixed.enrichments.completedWithinFiveSeconds<6);
  // Reserving the measured small persistence overhead avoids a charged edge
  // expiry; it does not make larger timer jitter provide complete flow.
  for(const constrained of [fifty,hundred]){assert.equal(constrained.haltReason,null);assert.equal(constrained.durablyChargedUnits,constrained.requests);assert.equal(constrained.unstartedReservedOperation,null);}
  // No new gap tolerance or phase-equivalence claim is inferred from6/6 jobs.
  assert.ok(zero.maximumCompletedEvaluationGapMs!>2000);assert.ok(zero.modeledUnavailableOrStaleTransportCacheMs>0);
  const pair=zero.outcomes.filter(o=>o.kind==='enrichment'&&o.enqueuedAt===4225);assert.equal(pair.length,2);assert.match(pair[0]!.id,/^ErDS/);assert.match(pair[1]!.id,/^4DQE/);
});

test('every modeled physical operation shares spacing, rolling limits and one actual in-flight slot',()=>{
  for(const s of evaluated.simulations){
    assert.ok((s.minimumStartGapMs??1000)>=1000,s.name);assert.ok((s.maximumRolling60SecondStarts??0)<=60,s.name);assert.ok((s.maximumRolling10SecondStarts??0)<=30,s.name);assert.ok(s.physicalOperationOverlapMaximum<=1,s.name);
    assert.equal(s.requests,Object.values(s.requestsByKind).reduce((a,b)=>a+b,0));
    for(const o of s.outcomes.filter(o=>o.physicalStartedAt!==null)){
      assert.ok(o.physicalStartedAt!>=o.logicalDispatchedAt!);if(o.kind!=='protection')assert.ok(o.physicalStartedAt!>=o.eligibleAt);
      assert.ok(o.responseCompletedAt!>=o.physicalStartedAt!);if(o.parsedAt!==null)assert.ok(o.parsedAt>=o.responseCompletedAt!);
      if(o.latestStartAt!==null)assert.ok(o.physicalStartedAt!<=o.latestStartAt);
    }
  }
});

test('two-event bursts can fit but three-event and slow-path refusals remain explicit required-data failures',()=>{
  for(const jitter of [10,50,100]){
    const two=scenario('synthetic-burst2-arrival-jitter'+jitter),three=scenario('synthetic-burst3-arrival-jitter'+jitter);
    assert.equal(two.enrichments.completedWithinFiveSeconds,2);assert.equal(two.requiredEvidenceLosses,0);assert.equal(three.enrichments.completedWithinFiveSeconds,2);assert.equal(three.enrichments.refused,1);assert.equal(three.requiredEvidenceLosses,1);
    for(const r of three.outcomes.filter(o=>o.status==='refused')){assert.ok(r.reason);assert.equal(r.windowUnusable,true);assert.equal(r.physicalStartedAt,null);}
  }
  const slow=scenario('synthetic-slow-three');assert.ok(slow.requiredEvidenceLosses>0);assert.equal(slow.enrichments.completedWithinFiveSeconds+slow.enrichments.refused+slow.enrichments.timedOut+slow.enrichments.pendingAtEnd,3);
});

test('caller timeout retains the physical operation; urgent pending action and reconnect use the same gate afterward',()=>{
  const s=scenario('synthetic-timeout-pending-reconnect'),timeout=s.outcomes.find(o=>o.id==='ignored-cancellation')!,pending=s.outcomes.find(o=>o.id==='urgent-pending')!,reconnect=s.outcomes.find(o=>o.id==='restore-subscription')!;
  assert.equal(s.timeoutBehavior,'scheduler-recovery-only');assert.ok(s.assumptions.some(s=>s.includes('Actual ComponentBudget has a sticky timeout halt')));
  assert.equal(timeout.status,'timed-out');assert.equal(timeout.parsedAt,null);assert.ok(timeout.physicalSettledAt!>timeout.callerTimedOutAt!);assert.equal(timeout.windowUnusable,true);
  assert.ok(!s.outcomes.some(o=>o.physicalStartedAt!==null&&o.id!==timeout.id&&o.physicalStartedAt!>=timeout.callerTimedOutAt!&&o.physicalStartedAt!<timeout.physicalSettledAt!));
  assert.equal(pending.status,'completed');assert.ok(pending.physicalStartedAt!>=timeout.physicalSettledAt!);assert.ok(pending.parsedAt!<=pending.deadlineAt);assert.equal(reconnect.status,'completed');assert.ok(s.maximumCompletedEvaluationGapMs!>2000);
  const never=job('never-settles',500);never.cost={httpMs:9000,parseMs:20,settlementMs:10000,actuationMs:2};
  const unresolved=simulateSharedScheduler({name:'explicit-unsettled',policy:'bounded-deadline-v1',durationMs:4000,jobs:[never,job('retained-pending',2500,'pending',5000)],priceCosts:[cost]});assert.equal(unresolved.physicalUnsettledAtEnd?.id,'never-settles');assert.equal(unresolved.unresolvedFinancialActions,1);assert.equal(unresolved.requestsByKind.pending,0);
  assert.equal(unresolved.haltReason,'component-budget-sticky-timeout');assert.ok(unresolved.rightCensoredAfterStopMs>0);
});

test('post-persistence start expiry cannot silently consume a selected event or fabricate a physical request',()=>{
  // Isolate the unchanged 100ms physical-start window: normal checks at0/2s,
  // an eligible job at3.075s, and a latest start of3.100s. No early check is
  // allowed in this fixture.26ms persistence exceeds the admitted25ms reserve.
  const edge={...job('edge',2075),cost:{...cost,actuationMs:26}};
  const s=simulateSharedScheduler({name:'post-persistence-reserve-overrun',policy:'bounded-deadline-v1',durationMs:8000,jobs:[edge],priceCosts:[{httpMs:80,parseMs:20,actuationMs:0}],maximumAdvances:0}),r=s.outcomes.find(o=>o.id==='edge');assert.ok(r);
  assert.equal(r.logicalDispatchedAt,3075);assert.equal(r.latestStartAt,3100);
  assert.equal(r.status,'refused');assert.equal(r.physicalStartedAt,null);assert.match(r.reason!,/Post-persistence/);assert.equal(r.windowUnusable,true);
  assert.equal(s.durablyChargedUnits,s.requests+1);assert.equal(s.haltReason,'post-persistence-dispatch-expired-preserved-reservation');assert.ok(s.rightCensoredAfterStopMs>0);
});

test('two simultaneous pending actions retain deadline priority while candidate capacity and protection degrade explicitly',()=>{
  const s=scenario('synthetic-two-pending-with-reconnect-burst'),actions=s.outcomes.filter(o=>o.kind==='pending'),earlier=actions.find(o=>o.id==='exit-earlier')!,later=actions.find(o=>o.id==='exit-later')!;
  assert.equal(actions.length,2);assert.equal(earlier.eligibleAt,later.eligibleAt);assert.ok(earlier.physicalStartedAt!<later.physicalStartedAt!);assert.ok(actions.every(o=>o.status==='completed'&&o.parsedAt!<=o.deadlineAt&&o.retainedIfFinancial));
  assert.equal(s.unresolvedFinancialActions,0);assert.equal(s.outcomes.find(o=>o.id==='restore-once')!.status,'completed');assert.equal(s.enrichments.refused,1);assert.ok(s.requiredEvidenceLosses>0);assert.equal(s.maximumCompletedEvaluationGapMs,4008);
  assert.ok(s.assumptions.some(a=>a.includes('full seven-account subscription restoration is not modeled')));assert.ok(s.physicalOperationOverlapMaximum<=1);
});

test('processing time and service envelope assumptions are measured separately from HTTP settlement',()=>{
  const s=scenario('synthetic-processing-reserve-overrun');assert.ok(s.postProcessingReserveOverruns>0);assert.ok(s.serviceEnvelopeOverruns>0);
  for(const o of s.outcomes.filter(o=>o.parsedAt!==null)){assert.ok(o.physicalSettledAt!<o.parsedAt!);assert.equal(o.parsedAt!-o.responseCompletedAt!,220);}
});

test('early monitoring phase can miss a temporary15percent stop that the original phase sees, or vice versa',()=>{
  const [fixedWins,earlyWins]=syntheticPhaseCounterexamples();assert.ok(fixedWins&&earlyWins);
  assert.equal(fixedWins.fixed.find(x=>x.decision.action==='request-exit')!.at,6000);assert.equal(fixedWins.early.some(x=>x.decision.action==='request-exit'),false);
  assert.equal(earlyWins.early.find(x=>x.decision.action==='request-exit')!.at,5000);assert.equal(earlyWins.fixed.some(x=>x.decision.action==='request-exit'),false);
  assert.match(fixedWins.classification,/SYNTHETIC/);assert.equal('modeledPnl'in fixedWins,false);
});
