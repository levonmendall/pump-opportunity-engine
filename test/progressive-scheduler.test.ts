import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replayProgressiveWorkload,PROGRESSIVE_SYNTHETIC_CASES} from '../scripts/progressive-scheduler-replay.js';

test('progressive synthetic workloads share one physical gate and preserve every selected observation outcome',()=>{
 for(const spec of PROGRESSIVE_SYNTHETIC_CASES){const r=replayProgressiveWorkload(spec),s=r.actualSimulated;
  assert.ok(s.maximumRollingMinute<=60,spec.name);assert.ok(s.maximumRolling10s<=20,spec.name);assert.ok(s.maximumGetTransactionRolling10s<=8,spec.name);assert.ok((s.minimumStartSpacingMs??250)>=250,spec.name);
  for(let i=1;i<r.physical.length;i++)assert.ok(r.physical[i]!.startedAt>=r.physical[i-1]!.settledAt,spec.name+' cancellation cannot create a second slot');
  assert.equal(s.selectedTransactions,s.enrichedTransactions+s.coverageLostTransactions,spec.name);assert.ok(r.tasks.every(t=>t.status!=='queued'||t.receivedAt>=s.elapsedMs),spec.name);
  assert.equal(r.assumptions.completePilotLoopExecuted,false);assert.equal(r.assumptions.naturalTradeOrEconomicPerformance,false);
 }
});

test('one coherent protection request covers the declared holding batch without multiplying the physical request',()=>{
 const one=replayProgressiveWorkload({name:'matched-one',holdings:1,candidates:1,jitterMs:50,tradePeriodMs:30000}),three=replayProgressiveWorkload({name:'matched-three',holdings:3,candidates:1,jitterMs:50,tradePeriodMs:30000});
 assert.deepEqual(one.physical,three.physical);assert.equal(one.actualSimulated.byPurpose.protection,three.actualSimulated.byPurpose.protection);assert.ok(three.evaluations.every(e=>e.holdings===3));assert.equal(three.assumptions.unapprovedResearchCompletedGapBoundaryMs,4000);
});

test('50 and100ms dispatch jitter have explicit measured protection and candidate outcomes',()=>{
 for(const jitterMs of [50,100]){const r=replayProgressiveWorkload({name:'jitter-'+jitterMs,holdings:3,candidates:1,jitterMs,tradePeriodMs:30000});assert.equal(r.protectionFailed,false,JSON.stringify(r.actualSimulated));assert.equal(r.candidateCoverageComplete,true,JSON.stringify(r.failures));assert.ok(r.actualSimulated.usableWindows>0);assert.ok(r.actualSimulated.maximumQuoteAgeAtUseMs<=2000);}
});

test('capacity overflow invalidates candidate evidence instead of silently sampling or claiming complete windows',()=>{
 const r=replayProgressiveWorkload(PROGRESSIVE_SYNTHETIC_CASES.find(c=>c.name==='three-holdings-three-event-bursts')!);assert.equal(r.candidateCoverageComplete,false);assert.ok(r.actualSimulated.coverageLostTransactions>0);assert.ok(r.suspensions.length>0);assert.ok(r.failures.length>0);assert.ok(r.actualSimulated.completedEvaluationCount>0);
 const method=replayProgressiveWorkload(PROGRESSIVE_SYNTHETIC_CASES.find(c=>c.name==='three-holdings-nine-trade-burst')!);assert.ok(method.actualSimulated.maximumGetTransactionRolling10s<=8);assert.equal(method.candidateCoverageComplete,false);assert.ok(method.actualSimulated.coverageLostTransactions>0);assert.ok(method.failures.some(f=>f.reason.includes('method-ready')));
});

test('slow cancellation and processing overruns retain failures and right-censored protection tails',()=>{
 for(const name of ['nonpreemptible-slow-response','processing-overrun-stale-at-use']){const r=replayProgressiveWorkload(PROGRESSIVE_SYNTHETIC_CASES.find(c=>c.name===name)!);assert.equal(r.protectionFailed,true,name);assert.ok(r.failures.length>0);assert.ok(r.actualSimulated.maximumCompletedEvaluationGapMs>4000||r.actualSimulated.overdueTailMs>0||r.physical.some(p=>p.purpose==='protection'&&p.timedOut));
  const slow=r.physical.find(p=>p.cancelRequestedAt!==null);if(slow){assert.ok(slow.settledAt>slow.cancelRequestedAt!);const next=r.physical.find(p=>p.startedAt>slow.startedAt);if(next)assert.ok(next.startedAt>=slow.settledAt);}
 }
});

test('simultaneous financial requests have explicit completion or retained-unresolved outcomes; reconnect cannot preserve old flow warmth',()=>{
 const pending=replayProgressiveWorkload(PROGRESSIVE_SYNTHETIC_CASES.find(c=>c.name==='simultaneous-three-owned-actions')!);assert.equal(pending.actualSimulated.completeOwnedActions+pending.actualSimulated.unresolvedOwnedActions,3);assert.ok(pending.actualSimulated.byPurpose.pending!>0);assert.ok(pending.actualSimulated.byPurpose.protection!>0);
 const slow=replayProgressiveWorkload(PROGRESSIVE_SYNTHETIC_CASES.find(c=>c.name==='simultaneous-three-owned-actions-slow')!);assert.equal(slow.actualSimulated.completeOwnedActions+slow.actualSimulated.unresolvedOwnedActions,3);assert.ok(slow.actualSimulated.unresolvedOwnedActions>0||slow.protectionFailed,'slow simultaneous own work cannot be called fully served');
 const reconnect=replayProgressiveWorkload(PROGRESSIVE_SYNTHETIC_CASES.find(c=>c.name==='planned-reconnect-invalidates-fresh-window')!);assert.equal(reconnect.candidateCoverageComplete,false);assert.equal(reconnect.suspensions.filter(s=>s.reason==='planned transport gap; new complete flow window required').length,2);assert.ok(reconnect.windows.every(w=>w.endAt<30000||w.endAt>=90000),'reconnect must warm a fresh complete window');assert.ok(reconnect.actualSimulated.byPurpose.reconnect!>0);assert.ok(reconnect.windows.length>0,'explicit renewed observation can become usable after fresh warm-up; additional capacity losses stay disclosed');
});
