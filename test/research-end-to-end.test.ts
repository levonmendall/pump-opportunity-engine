import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateResearchEndToEnd} from '../scripts/evaluate-research-end-to-end.js';

const result=await evaluateResearchEndToEnd();

test('actual retained flow reproduces both amount views while missing migration evidence prevents a fabricated natural entry',()=>{
  assert.equal(result.natural.events,5);assert.equal(result.natural.buys,1);assert.equal(result.natural.sells,4);assert.equal(result.natural.naturalOrdersSubmitted,0);assert.equal(result.natural.migrationAt,null);
  for(const view of result.natural.views){assert.equal(view.features.tradeCount,5);assert.equal(view.fullEntryDecision.qualified,false);assert.equal(view.fullEntryDecision.reason,'verified-migration-time-unavailable');assert.ok(view.predictivePrerequisiteFacts.netBuyingBelowMinimum);assert.ok(view.predictivePrerequisiteFacts.buyersBelowMinimum);assert.ok(view.predictivePrerequisiteFacts.concentrationAboveMaximum);}
  assert.equal(result.natural.chainAuditDenominator.matched,5);assert.match(result.natural.chainAuditDenominator.receiveWindowCompleteness,/NOT_ESTABLISHED/);assert.equal(result.naturalPaperTrades,0);assert.equal(result.sourceEvidenceUnchanged,true);
});

test('same-byte SDK entry and held pricing reach one disposable ledger lifecycle without hiding uncertain exit exposure',()=>{
  const f=result.fixture;assert.equal(f.mode,'DISPOSABLE_PAPER');assert.equal(f.inceptionCount,1);assert.ok(f.entryParities.length>=2);assert.ok(f.entryParities.every(p=>p.sameByteParity));assert.equal(f.entry[0]!.status,'filled');
  assert.equal(f.safeStop.safeToExit,false);assert.equal(f.safeStop.state,'management-required');assert.equal(f.uncertain[0]!.status,'uncertain');assert.equal(f.uncertainActionPreserved,true);assert.equal(f.restartStateExactlyPreserved,true);assert.equal(f.unknownMarkProjection.equityLamports,null);assert.equal(f.unknownMarkProjection.openPositions,1);
  assert.equal(f.expired[0]!.status,'expired');assert.equal(f.expiryChargedNoAdditionalGas,true);assert.equal(f.recoveryCurrentAdapterCalls,2);assert.equal(f.exit[0]!.status,'filled');assert.equal(f.exitContextAdapterCalls,1);assert.equal(f.postDelayExitQuoteReuse.newNetworkRequests,0);assert.equal(f.executionCostsLamports,'14000');assert.equal(f.fixtureOnlyRealizedLamports,f.fixtureOnlyCashDeltaLamports);assert.equal(f.finalProjection.openPositions,0);assert.equal(f.finalProjection.pendingActions,0);assert.equal(f.finalProjection.entriesEnabled,false);assert.equal(f.idempotentNoDuplicateAttempt,true);
});

test('fixture results cannot be interpreted as current trading, provider capacity or natural performance',()=>{
  assert.match(result.fixture.classification,/SYNTHETIC/);assert.match(result.fixture.stateProvenance,/reused unchanged/);assert.equal(result.fixture.economicPnl,null);assert.ok(result.remainingGaps.some(s=>s.includes('No natural qualifying entry')));assert.equal(result.networkRequests,0);assert.equal(result.productionChanged,false);assert.equal(result.authoritativeAccountChanged,false);assert.equal(result.paperEntriesEnabled,false);assert.equal(result.liveTradingEnabled,false);assert.equal(result.acceptanceClockStarted,false);
});
