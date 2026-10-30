import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readResearchBaseline} from '../src/research-baseline.js';

const MIB=1024*1024,root='evidence/overnight-20261027';
const proposal=JSON.parse(readFileSync('evidence/scheduler-correction-20261027/forward-proposal.json','utf8'));
const pumpApi=JSON.parse(readFileSync(join(root,'pumpapi-budget.json'),'utf8'));
const capture=JSON.parse(readFileSync(join(root,'11-combined/capture.json'),'utf8'));
const chapters=readdirSync(root).filter(name=>/^\d\d-/.test(name)).sort().map(name=>join(root,name,'rpc-budget.json'));
// The prior attempts are completed; their uncertain response debit remains
// reserved. The reader never edits or refunds any source counterbook.
const linked=readResearchBaseline({paths:['evidence/free-data-20261027/active-approved-rpc-budget.json','evidence/public-component-20261027/rpc-budget.json',...chapters],now:Date.now(),physicalSettled:true});

test('proposal RPC allocations fit the actual linked allowance and independently audit every permitted selected transaction',()=>{
  const actual=linked.baseline,a=proposal.existingRpcAllowanceAllocation;
  assert.equal(actual.calls,163);assert.equal(actual.bytes,3587908);assert.equal(240-actual.calls,77);
  let planned=0;
  for(const phase of a.phases){
    const byPurpose=Object.values(phase.operations).reduce((sum,n)=>Number(sum)+Number(n),0);
    assert.equal(byPurpose,phase.maximumUnits);assert.ok(phase.maximumUnits<=70);planned+=phase.maximumUnits;
  }
  assert.equal(planned,73);assert.ok(planned<=240-actual.calls);assert.equal(a.plannedMaximumUnits,planned);assert.equal(a.unassignedShutdownOrUncertainOperationHeadroomUnits,4);assert.equal(actual.calls+planned+a.unassignedShutdownOrUncertainOperationHeadroomUnits,240);
  const combined=a.phases.find((p:any)=>p.phase==='one-corrected-combined-capture')!,audit=a.phases.find((p:any)=>p.phase==='immediate-independent-audit')!;
  assert.equal(combined.maximumUnits,56);assert.equal(combined.operations.getMultipleAccountsPeriodic3HoldingUnion,Math.ceil(75000/2000));assert.equal(combined.operations.getMultipleAccountsPossibleEarlyProtectionReserve,5);
  assert.equal(combined.operations.getTransactionSelectedCandidate,10);assert.equal(audit.operations.getTransactionIndependentSelectedOrUnmatched,combined.operations.getTransactionSelectedCandidate);
  assert.equal(audit.operations.getSignaturesForAddress,2);assert.equal(audit.operations.getTransactionFinalizedRecheck,2);assert.equal(audit.maximumUnits,14);
});

test('stream proposal preserves all old reservations and distinguishes a90s new reservation from the20s cumulative-ceiling increase',()=>{
  const g=proposal.preciseNewOwnerGrantProposal,change=g.requestedCeilingChanges;
  assert.equal(pumpApi.reservedBytes,256*MIB);assert.equal(pumpApi.reservedMs,230000);
  assert.equal(g.newPumpApiReceiptReservationBytes,140*MIB);assert.equal(g.newPumpApiReservedMs,90000);
  assert.equal(g.newCumulativePumpApiReservedBytes,pumpApi.reservedBytes+g.newPumpApiReceiptReservationBytes);assert.equal(g.newCumulativePumpApiReservedBytes,396*MIB);
  assert.equal(g.newCumulativePumpApiReservedMs,pumpApi.reservedMs+g.newPumpApiReservedMs);assert.equal(g.newCumulativePumpApiReservedMs,320000);
  assert.equal(change.pumpApiReceiptCeilingIncreaseBytes,140*MIB);assert.equal(change.newSingleConnectionReservationMs,90000);assert.equal(change.pumpApiTimeCeilingIncreaseMs,320000-300000);assert.equal(change.pumpApiTimeCeilingIncreaseMs,20000);
  assert.equal(proposal.networkRequestsMadeForThisProposal,0);assert.equal(proposal.sourceFilesUnchanged,true);
});

test('two-times measured75s receipt projection fits the proposed stops while actual rolling broad peaks remain unavailable',()=>{
  const g=proposal.preciseNewOwnerGrantProposal,s=g.socketSizing;
  const socketProjection=Math.ceil(capture.socketBytes/(capture.openMs/1000)*75*2),applicationProjection=Math.ceil(capture.applicationBytes/(capture.openMs/1000)*75*2);
  assert.equal(capture.openMs,69530);assert.equal(capture.socketBytes,65179210);assert.equal(s.projectedAtTwiceMeanBytes,socketProjection);
  assert.ok(socketProjection<138*MIB);assert.ok(applicationProjection<136*MIB);assert.equal(g.pumpApiSocketStopBytes,138*MIB);assert.equal(g.pumpApiApplicationStopBytes,136*MIB);assert.equal(g.pumpApiHardReceiptCapBytes,140*MIB);assert.equal(g.pumpApiHardReceiptCapBytes-g.pumpApiSocketStopBytes,2*MIB);
  assert.equal(proposal.measured11.broadRollingBytePeaks,null);assert.equal(proposal.measured11.physicalRequestStarts.maxRolling10s,10);assert.equal(proposal.measured11.physicalRequestStarts.maxRolling60s,37);
});

test('the120s aggregate contains separate prep,90s connection and audit phases, and retains uncertain response bytes',()=>{
  const t=proposal.observationTiming,a=proposal.existingRpcAllowanceAllocation,g=proposal.preciseNewOwnerGrantProposal;
  const aggregate=t.preflightMaximumMs+t.connectionPhaseMaximumMs+t.independentAuditMaximumMs+t.aggregateShutdownHeadroomMs;
  assert.equal(aggregate,120000);assert.equal(t.maximumAggregateTestMs,aggregate);assert.equal(t.aggregatePhaseSumMs,aggregate);assert.equal(g.maximumAggregateTestMs,aggregate);
  assert.equal(t.prewarmAndConnectionSetupMaximumMs+t.maximumOpenObservationMs+t.maximumPostCloseExistingOperationDrainMs,90000);assert.equal(t.connectionPhaseMaximumMs,90000);assert.equal(t.maximumOpenObservationMs,75000);assert.equal(t.maximumPostCloseExistingOperationDrainMs,5000);
  for(const [i,key] of ['preflightMaximumMs','connectionPhaseMaximumMs','independentAuditMaximumMs'].entries())assert.equal(a.phases[i].maximumMs,t[key]);
  assert.equal(g.connectionTimeBreakdown.independentAuditOutsideThisReservation,true);assert.equal(linked.uncertainResponseBytes,2*MIB);assert.equal(linked.observedBytes+linked.uncertainResponseBytes,linked.baseline.bytes);
  const remaining=64*MIB-linked.baseline.bytes;
  assert.equal(remaining,63520956);assert.ok(a.newRelatedResponseByteCeiling<=remaining);assert.equal(a.newRelatedResponseByteCeiling,32*MIB);assert.equal(a.maximumAccountedRelatedBytesAfterProposal,linked.baseline.bytes+a.newRelatedResponseByteCeiling);assert.equal(a.remainingCumulativeByteHeadroomAfterCeiling,remaining-a.newRelatedResponseByteCeiling);
});
