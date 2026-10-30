/** Retained actual read-only measurement. No network or authoritative ledger. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readResearchBaseline} from '../src/research-baseline.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
const root='evidence/scheduler-forward-20261027/',capture=JSON.parse(readFileSync(root+'capture.json','utf8')),audit=JSON.parse(readFileSync(root+'audit.json','utf8'));
const records=readFileSync(root+'observations.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x));
test('the new forward ordinary BuyV2 preserves independently proved units, fee split, trader roles and event fingerprint',()=>{
  const original=capture.executedEvidence.find((e:any)=>e.side==='buy');assert.ok(original);
  const response=records.find(r=>r.kind==='forward-audit-independent-transaction'&&r.data.signature===original.identity.signature);assert.ok(response);
  const row=mapConfirmedPumpSwapEvidence(response.data.transaction,{mint:capture.scope.mint,pool:capture.scope.pool,signature:original.identity.signature,providerReceivedAt:original.providerReceivedAt,availableAt:response.data.availableAt})[0]!;
  assert.equal(row.fingerprint,original.fingerprint);assert.deepEqual(row.identity,original.identity);assert.equal(row.tokenUnits,'6838952530');assert.equal(row.curveQuoteLamports,'146338375');assert.equal(row.userQuoteLamports,'147582253');
  assert.equal(BigInt(row.userQuoteLamports)-BigInt(row.curveQuoteLamports),292677n+73170n+878031n);assert.equal(row.transferChecks.baseTransfer,true);assert.equal(row.transferChecks.userQuoteTransfer,true);
});
test('the actual linked usage includes all three new phases without resetting earlier uncertainty or stream reservations',()=>{
  const baseline=JSON.parse(readFileSync(root+'baseline.json','utf8'));
  const b=readResearchBaseline({paths:[...baseline.baselinePaths,...['01-preflight','02-combined','03-audit'].map(p=>root+p+'/rpc-budget.json')],now:Date.now(),physicalSettled:true});
  assert.equal(b.baseline.calls,221);assert.equal(240-b.baseline.calls,19);assert.equal(b.observedBytes,2314558);assert.equal(b.uncertainResponseBytes,2097152);assert.equal(b.baseline.bytes,4411710);
  const stream=JSON.parse(readFileSync(root+'pumpapi-budget.json','utf8'));assert.equal(stream.reservedBytes,396*1024*1024);assert.equal(stream.reservedMs,320000);assert.equal(stream.baseline.reservedBytes,256*1024*1024);assert.equal(stream.refunded,false);
});
test('one scoped closed window never becomes generic completeness, and the2ms actual timer overrun remains visible',()=>{
  assert.equal(audit.complete,true);assert.equal(audit.verifiedSwapEvents,5);assert.equal(audit.matchedOriginalEvents,5);assert.equal(audit.receiveWindowCompleteness,'NOT_ESTABLISHED_BY_CHAIN_TIME_ALONE');
  assert.equal(audit.applicationTargetReadiness.rawReadyClosedTargetWindows,1);assert.equal(capture.openMs,75002);assert.ok(capture.observationEndedAt>capture.openedAt+75000);
  const cutoff=capture.openedAt+75000;for(const r of records){if(r.kind==='research-normalized-trade')assert.ok(r.data.validationCompletedAt<cutoff);if(r.kind==='forward-three-holding-evaluation'&&r.data.usedAt>=capture.openedAt)assert.ok(r.data.usedAt<cutoff);}
  assert.equal(capture.sharedScheduler.acceptedMaximumCompletedEvaluationGapMs,null);assert.ok(capture.protection.maxCompletedEvaluationGapMs>2000);
});
