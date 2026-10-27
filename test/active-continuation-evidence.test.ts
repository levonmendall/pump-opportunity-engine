import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {invokedCanonicalSolSwaps} from '../src/active-selection.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
const root='evidence/free-data-20261027',record=readFileSync(root+'/active-continuation-record.ndjson');
const rows=record.toString().trim().split('\n').map(x=>JSON.parse(x));
const analysis=JSON.parse(readFileSync(root+'/active-continuation-analysis.json','utf8'));

test('actual continuation evidence maps two direct Token2022 Sell instructions with exact executed amounts',()=>{
  assert.equal(createHash('sha256').update(record).digest('hex'),analysis.record.sha256);
  assert.equal(analysis.additionalNetworkRequests,0);assert.equal(analysis.actual.length,2);
  const expected=[['45355765675','75552859','74684000',4],['17862432','315762','312919',3]];
  for(let i=0;i<analysis.actual.length;i++){
    const e=analysis.actual[i],raw=rows.find(r=>r.kind==='selection-transaction'&&r.data.signature===e.identity.signature).data;
    const scopes=invokedCanonicalSolSwaps(raw.transaction);assert.equal(scopes.length,1);
    const mapped=mapConfirmedPumpSwapEvidence(raw.transaction,{...scopes[0]!,signature:raw.signature,providerReceivedAt:null,availableAt:raw.availableAt});
    assert.equal(mapped.length,1);const current=mapped[0]!;
    assert.equal(current.fingerprint,e.fingerprint);assert.equal(current.side,'sell');
    assert.deepEqual([current.tokenUnits,current.curveQuoteLamports,current.userQuoteLamports,current.identity.outerInstructionIndex],expected[i]);
    assert.equal(current.identity.swapInnerInstructionIndex,null);assert.equal(current.identity.eventInnerInstructionIndex,6);
    assert.deepEqual(current.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
    assert.equal(current.trader,raw.transaction.transaction.message.accountKeys[0]);assert.equal(current.availableAt,raw.availableAt);assert.equal(current.providerReceivedAt,null);
    assert.equal(BigInt(current.curveQuoteLamports)-BigInt(current.fees.lp_fee!)-BigInt(current.fees.protocol_fee!)-BigInt(current.fees.coin_creator_fee!),BigInt(current.userQuoteLamports));
    assert.equal(e.baseTokenProgram,'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');assert.equal(e.fullCurrentPoolSupportVerified,false);assert.equal(e.actualPumpApiMatch,false);
  }
});

test('actual continuation refusal preserves unknown capacity, cross-pass repeated pool and missing live observations',()=>{
  const summary=JSON.parse(readFileSync(root+'/active-continuation-summary.json','utf8'));
  assert.equal(summary.reason,'RESEARCH_RPC_HTTP_429');assert.equal(summary.streamOpened,false);
  assert.equal(summary.rpc.calls,20);assert.equal(summary.rpc.bytes,272634);assert.equal(summary.rpc.blockedReason,'RPC_HTTP_429');
  assert.deepEqual(analysis.histories.map((h:any)=>[h.rows,h.successfulAddressTransactions,h.failedAddressTransactions,h.chainTimeSpanSeconds]),[[20,19,1,3],[20,20,0,2]]);
  assert.equal(analysis.histories.every((h:any)=>!h.covered60SecondObservationInterval&&h.touchesAreNotVerifiedSwaps),true);
  assert.equal(analysis.crossPassSelection.priorRejectedPoolEncounteredAgain.length,1);
  assert.equal(analysis.observedVariants.directBuys,0);assert.equal(analysis.observedVariants.routedSwaps,0);assert.equal(analysis.observedVariants.multipleSwapTransactions,0);
  assert.equal(analysis.observedVariants.eligibleSwapsWithLoadedAddresses,0);assert.equal(analysis.observedVariants.nonEligibleSamplesWithLoadedAddresses,1);
  const loaded=analysis.samples.find((s:any)=>s.loadedAddresses.writable>0);assert.deepEqual(loaded.loadedAddresses,{writable:3,readonly:7});assert.equal(loaded.events.length,0);
});
