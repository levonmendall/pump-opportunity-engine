/** Three actual matched Sells, not full-flow coverage or strategy performance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapConfirmedPumpSwapEvidence,pumpApiSignatureHint,toResearchNormalizedTrade} from '../src/pumpapi-mapping.js';

const root='evidence/overnight-20261027/07-field/';
const capture=JSON.parse(readFileSync(root+'capture.json','utf8'));
const rows=readFileSync(root+'observations.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x));
const selected=rows.filter(r=>r.kind==='selected-pumpapi-payload');
const decimal=(value:string,decimals:number)=>{
  assert.match(value,/^\d+(?:\.\d+)?$/);const [whole,fraction='']=value.split('.');assert.ok(fraction.length<=decimals);
  return (BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'))).toString();
};
const values=(raw:string,name:string)=>[...raw.matchAll(new RegExp('"'+name+'":([0-9]+(?:\\.[0-9]+)?)','g'))].map(m=>m[1]!);
function matched(index:number){
  const record=selected[index]!,raw=record.data.payloadUtf8,payload=JSON.parse(raw),enrichment=rows.find(r=>r.kind==='confirmed-enrichment'&&r.data.hint.signature===payload.signature)!.data;
  const mapped=mapConfirmedPumpSwapEvidence(enrichment.transaction,{...capture.scope,signature:payload.signature,providerReceivedAt:record.data.receivedAt,availableAt:enrichment.availableAt});
  assert.equal(mapped.length,1);return {record,raw,payload,enrichment,event:mapped[0]!};
}

test('actual direct and Jupiter-CPI Sell captures preserve full identities, executed transfers and confirmed availability',()=>{
  assert.equal(selected.length,3);
  const identities=[{outer:3,swap:null,event:3},{outer:9,swap:0,event:4},{outer:3,swap:0,event:4}];
  for(let i=0;i<selected.length;i++){
    const {record,payload,enrichment,event}=matched(i),expected=identities[i]!;
    assert.equal(enrichment.transaction.meta.err,null);assert.equal(event.side,'sell');assert.equal(event.slot,payload.block);
    assert.equal(event.identity.outerInstructionIndex,expected.outer);assert.equal(event.identity.swapInnerInstructionIndex,expected.swap);assert.equal(event.identity.eventInnerInstructionIndex,expected.event);
    assert.deepEqual(event.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
    assert.equal(event.trader,payload.breakdown[0].trader);
    const normalized=toResearchNormalizedTrade(event,'curve',capture.scope.supportedPoolEvidence);
    assert.equal(normalized.trade.receivedAt,enrichment.availableAt);assert.ok(normalized.trade.receivedAt>record.data.receivedAt);
    assert.equal(normalized.trade.commitment,'confirmed');assert.equal(event.normalizedForStrategy,false);
    assert.equal(Object.hasOwn(payload,'commitment'),false);assert.equal(Object.hasOwn(payload,'instructionIndex'),false);assert.equal(Object.hasOwn(payload,'eventIndex'),false);
  }
  assert.equal(capture.complete60SecondFeatureWindows,0);assert.equal(capture.normalizedBuys,0);
});

test('actual UI decimal lexemes match integer base units and gross curve quote, not net user proceeds',()=>{
  for(let i=0;i<selected.length;i++){
    const {raw,payload,event}=matched(i);
    assert.equal(payload.decimals,6);assert.equal(payload.quoteMint,'So11111111111111111111111111111111111111112');
    assert.equal(values(raw,'tokenAmount').length,2);for(const x of values(raw,'tokenAmount'))assert.equal(decimal(x,6),event.tokenUnits);
    assert.equal(values(raw,'quoteAmount').length,2);for(const x of values(raw,'quoteAmount'))assert.equal(decimal(x,9),event.curveQuoteLamports);
    assert.notEqual(event.curveQuoteLamports,event.userQuoteLamports);
    const retainedFees=BigInt(event.fees.lp_fee!)+BigInt(event.fees.protocol_fee!)+BigInt(event.fees.coin_creator_fee!);
    assert.equal(BigInt(event.curveQuoteLamports)-retainedFees,BigInt(event.userQuoteLamports));
    // Buyback is a reported slice of protocol fees in these observed examples.
    // Adding it again would debit a cost that already reduced user proceeds.
    assert.ok(BigInt(event.fees.buyback_fee!)>0n);assert.ok(retainedFees+BigInt(event.fees.buyback_fee!)>BigInt(event.curveQuoteLamports)-BigInt(event.userQuoteLamports));
    const user=toResearchNormalizedTrade(event,'user',capture.scope.supportedPoolEvidence);assert.equal(user.trade.quoteLamports,event.userQuoteLamports);
  }
});

test('raw sender/UI hints cannot replace RPC event trader, amounts or identity; whole routed balance is different',()=>{
  const {payload,enrichment,event}=matched(1),changed={...payload,txSigner:'not-the-event-user',tokenAmount:1,quoteAmount:1,action:'buy'};
  assert.deepEqual(pumpApiSignatureHint(changed,capture.scope),{signature:payload.signature,requiresRpcEnrichment:true});
  const again=mapConfirmedPumpSwapEvidence(enrichment.transaction,{...capture.scope,signature:changed.signature,providerReceivedAt:enrichment.hint.receivedAt,availableAt:enrichment.availableAt})[0]!;
  assert.equal(again.trader,event.trader);assert.equal(again.side,'sell');assert.equal(again.tokenUnits,event.tokenUnits);assert.equal(again.identityKey,event.identityKey);
  const t=enrichment.transaction,nativeDelta=BigInt(t.meta.postBalances[0])-BigInt(t.meta.preBalances[0]);assert.equal(nativeDelta,4090948290n);assert.notEqual(nativeDelta,BigInt(event.userQuoteLamports));
  // Natural examples all have matching payer/user, so no alternate-payer claim.
  assert.equal(payload.txSigner,t.transaction.message.accountKeys[0]);assert.equal(payload.txSigner,event.trader);
});
