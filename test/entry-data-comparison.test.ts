import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ENTRY_COMPARISON_POLICY,evaluateEntryDataComparison,runEntryMechanics,entryWorkloadProjection,sizePriceReturnBps,retainedFieldProjectionMeasurement,equivalentQuoteRetrievalControl,candidateQuoteMinimumSlot,type SyntheticPriceEvidence} from '../src/entry-data-comparison.js';
const T=36_000_000;
test('frozen screen starts a complete fresh flow warmup and never backfills baseline data',()=>{
  assert.equal(Object.isFrozen(ENTRY_COMPARISON_POLICY),true);
  const a=runEntryMechanics('sustained-trend','A-full-flow'),b=runEntryMechanics('sustained-trend','B-screen-then-flow');
  assert.equal(a.firstQualifiedAt,T+60000);assert.equal(b.admittedAt,T+10000);assert.equal(b.firstQualifiedAt,T+70000);
  assert.equal(b.preAdmissionDiscarded,2);assert.equal(b.fullFlowObservations,a.fullFlowObservations-2);
  assert.equal(b.decisions.find(d=>d.at===T+60000)!.fullFlowWarm,false);
  assert.equal(b.decisions.find(d=>d.at===T+70000)!.featureWindowStartAt,T+10000);
});
test('price challenger uses a separate frozen information hypothesis and never fabricates flow features',()=>{
  const c=runEntryMechanics('sustained-trend','C-price-liquidity');assert.equal(c.firstQualifiedAt,T+60000);
  assert.equal(c.fullFlowObservations,0);assert.equal(c.rpcOperations.selectedTransactionEnrichment,0);assert.equal(c.broadFeedRequired,false);
  assert.ok(c.decisions.every(d=>d.distinctBuyers===null&&d.netBuyLamports===null&&d.fullFlowWarm===false));
});
test('thin liquidity remains excluded equally, while preliminary quote work is counted separately',()=>{
  const a=runEntryMechanics('thin-liquidity','A-full-flow'),b=runEntryMechanics('thin-liquidity','B-screen-then-flow'),c=runEntryMechanics('thin-liquidity','C-price-liquidity');
  for(const lane of [a,b,c])assert.equal(lane.firstQualifiedAt,null);
  assert.equal(b.admittedAt,null);assert.equal(b.fullFlowObservations,0);assert.equal(b.rpcOperations.periodicCoherentQuoteReads,0);
  assert.equal(a.rpcOperations.selectedTransactionEnrichment,0);assert.equal(a.commonInitialExclusion,true);assert.equal(b.totalProjectedRpcCalls,a.totalProjectedRpcCalls);assert.equal(a.broadFeedReceivedBytes,b.broadFeedReceivedBytes);
});
test('stale/outage evidence cannot qualify until appropriate fresh observations have recovered',()=>{
  const staleA=runEntryMechanics('stale-quotes','A-full-flow'),staleC=runEntryMechanics('stale-quotes','C-price-liquidity');
  assert.equal(staleA.firstQualifiedAt,T+110000);assert.equal(staleC.firstQualifiedAt,T+170000);
  const outageA=runEntryMechanics('outage','A-full-flow'),outageB=runEntryMechanics('outage','B-screen-then-flow'),outageC=runEntryMechanics('outage','C-price-liquidity');
  assert.equal(outageA.firstQualifiedAt,T+140000);assert.equal(outageB.firstQualifiedAt,T+140000);assert.equal(outageC.firstQualifiedAt,T+140000);
  assert.ok(outageA.unavailableSelectedDuringGap>0);assert.ok(outageC.rpcOperations.recoveryLinks>0);
});
test('screening can cost more than quiet flow; field retention and local discard do not save provider retrieval',()=>{
  const low=entryWorkloadProjection(1,0),high=entryWorkloadProjection(12,0),passAll=entryWorkloadProjection(12,1);
  assert.equal(low.BminusA,-1);assert.equal(low.BminusEquivalentLazyA,5);assert.equal(high.BminusA,-12);assert.equal(passAll.BminusA,0);
  assert.equal(low.remainingForSharedHeldPricing.A,38);assert.equal(low.remainingForSharedHeldPricing.AEquivalentLazyControl,44);assert.equal(low.remainingForSharedHeldPricing.B,39);
  const result=evaluateEntryDataComparison();assert.equal(result.dataRetentionControl.rpcSavingsFromRetainingFewerFetchedFields,0);assert.equal(result.dataRetentionControl.localBroadDiscardByteSavings,0);
  assert.equal(result.economicResults,null);assert.equal(result.retained.economicComparison,null);assert.equal(result.financialAccountCreated,false);assert.equal(result.providerRequests,0);
});
test('integer fixed-size return rejects size mixing and conservatively rounds a negative move',()=>{
  const q:SyntheticPriceEvidence={at:T,receivedAt:T,slot:1000,poolSupported:true,liquidationLamports:'1000000',pricedBaseUnits:'1000',sizeToLiquidityBps:200,sourceAgeMs:0,available:true,classification:'SYNTHETIC_VALIDATED_SIZE_PRICE_INPUT'};
  assert.equal(sizePriceReturnBps(q,{...q,liquidationLamports:'999999'}),-1);
  assert.throws(()=>sizePriceReturnBps(q,{...q,pricedBaseUnits:'1001'}),/SIZE_MISMATCH/);
});
test('actual retained transaction projection changes serialized storage only, never fetches or incoming broad traffic',()=>{
  const r=retainedFieldProjectionMeasurement();assert.equal(r.samples.length,2);assert.ok(r.totals.serializedTransactionResultBytes>r.totals.requiredMappedProjectionBytes);
  assert.equal(r.rpcRequestSavings,0);assert.equal(r.incomingHttpByteSavings,0);assert.equal(r.avoidedFullJsonParse,false);
  assert.equal(r.physicalGetTransactionCallsForTheseSamples,r.callsAfterRetainingFewerFields);assert.equal(r.priorPumpApiObservedSocketBytes,106994938);
  assert.equal(r.localPumpApiDiscardIncomingSavings,0);assert.equal(r.heldFlowEnrichmentSavings,0);
});


test('equivalent predictive short-circuit changes retrieval/refusal evidence without changing provided-oracle signals',()=>{
  const r=equivalentQuoteRetrievalControl();assert.ok(r.matchedCases.every(c=>c.flowRequestsUnchanged&&c.qualifiedDecisionBooleansEqual));
  assert.ok(r.matchedCases.every(c=>c.minimumSlotChecks.every(q=>q.actualSlot>=q.minimumSlot)));
  assert.equal(r.quietFlow.currentQuoteFirstCalls-r.quietFlow.lazyControlCalls,13);assert.equal(r.quietFlow.firstQualifiedAt.current,null);assert.equal(r.quietFlow.firstQualifiedAt.lazy,null);
  assert.ok(r.matchedCases.find(c=>c.scenario==='reversal')!.avoidedQuoteRetrievals>0);
  assert.equal(candidateQuoteMinimumSlot(100,110),110);assert.equal(candidateQuoteMinimumSlot(120,110),120);assert.throws(()=>candidateQuoteMinimumSlot(-1,100),/SLOT_FLOOR/);
});
