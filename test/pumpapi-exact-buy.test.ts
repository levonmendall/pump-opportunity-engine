/** Corrected offline replay of retained data. Original forward gaps stay gaps. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {mapConfirmedPumpSwapEvidence,toResearchNormalizedTrade} from '../src/pumpapi-mapping.js';

const path='evidence/overnight-20261027/11-combined/';
const capture=JSON.parse(readFileSync(path+'capture.json','utf8'));
const records=readFileSync(path+'observations.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x));
const enrichments=records.filter(r=>r.kind==='confirmed-enrichment').map(r=>r.data);
const input=(e:any)=>({...capture.scope,signature:e.hint.signature,providerReceivedAt:e.hint.receivedAt,availableAt:e.availableAt});
const cases=[
  {prefix:'QxYy',curve:'19755168',user:'19923089',units:'858312221',outer:3,swap:10,event:14,vault:'19918150',buyback:'4939'},
  {prefix:'3wc5',curve:'1157921230',user:'1167763562',units:'50246366140',outer:5,swap:9,event:14,vault:'1167474082',buyback:'289480'},
];

test('actual exact-quote-in-v2 Buy event fields map curve net input and full executed user debit correctly',()=>{
  for(const expected of cases){
    const e=enrichments.find(e=>e.hint.signature.startsWith(expected.prefix))!,mapped=mapConfirmedPumpSwapEvidence(e.transaction,input(e));assert.equal(mapped.length,1);const trade=mapped[0]!;
    assert.equal(trade.side,'buy');assert.equal(trade.curveQuoteLamports,expected.curve);assert.equal(trade.userQuoteLamports,expected.user);assert.equal(trade.tokenUnits,expected.units);
    assert.deepEqual(trade.transferChecks,{baseTransfer:true,userQuoteTransfer:true});assert.equal(trade.identity.outerInstructionIndex,expected.outer);assert.equal(trade.identity.swapInnerInstructionIndex,expected.swap);assert.equal(trade.identity.eventInnerInstructionIndex,expected.event);
    const fees=BigInt(trade.fees.lp_fee!)+BigInt(trade.fees.protocol_fee!)+BigInt(trade.fees.coin_creator_fee!);
    assert.equal(BigInt(trade.curveQuoteLamports)+fees,BigInt(trade.userQuoteLamports));assert.equal(BigInt(expected.vault)+BigInt(expected.buyback),BigInt(trade.userQuoteLamports));
    const curve=toResearchNormalizedTrade(trade,'curve',capture.scope.supportedPoolEvidence),user=toResearchNormalizedTrade(trade,'user',capture.scope.supportedPoolEvidence);
    assert.equal(curve.trade.quoteLamports,expected.curve);assert.equal(user.trade.quoteLamports,expected.user);assert.equal(curve.trade.receivedAt,e.availableAt);assert.ok(e.availableAt>e.hint.receivedAt);assert.equal(curve.trade.commitment,'confirmed');
  }
});

test('actual alternate fee payer is not substituted for the Buy user and provider quote equals debit for these buys',()=>{
  const e=enrichments.find(e=>e.hint.signature.startsWith('QxYy'))!,trade=mapConfirmedPumpSwapEvidence(e.transaction,input(e))[0]!,raw=records.find(r=>r.kind==='selected-pumpapi-payload'&&JSON.parse(r.data.payloadUtf8).signature===e.hint.signature)!.data.payloadUtf8,payload=JSON.parse(raw);
  assert.equal(trade.trader,'87Udc8eTr1m9EyGfpLDT42hEMXeTnghCYnhD86pfm8AS');assert.equal(payload.breakdown[0].trader,trade.trader);
  assert.equal(payload.txSigner,'FHpcNSe6tb2n15bAdq4BkeYWGyZKFD7yLYrH92ng7wCT');assert.equal(payload.txSigner,e.transaction.transaction.message.accountKeys[0]);assert.notEqual(payload.txSigner,trade.trader);
  const quote=raw.match(/"quoteAmount":(\d+)\.(\d+)/)!;assert.equal((BigInt(quote[1]!)*1000000000n+BigInt(quote[2]!.padEnd(9,'0'))).toString(),trade.userQuoteLamports);assert.notEqual(trade.curveQuoteLamports,trade.userQuoteLamports);
});

test('corrected mapping still requires exact actually executed transfers and cannot repair the recorded forward window',()=>{
  const e=enrichments.find(e=>e.hint.signature.startsWith('QxYy'))!,bad=structuredClone(e.transaction),group=bad.meta.innerInstructions.find((g:any)=>g.index===3),transfer=group.instructions[12],raw=Buffer.from(bs58.decode(transfer.data));raw.writeBigUInt64LE(raw.readBigUInt64LE(1)+1n,1);transfer.data=bs58.encode(raw);
  const changed=mapConfirmedPumpSwapEvidence(bad,input(e))[0]!;assert.equal(changed.transferChecks.baseTransfer,true);assert.equal(changed.transferChecks.userQuoteTransfer,false);assert.throws(()=>toResearchNormalizedTrade(changed,'user',capture.scope.supportedPoolEvidence),/UNVERIFIED_EXECUTED_TRANSFERS/);
  const corrected=enrichments.flatMap(e=>mapConfirmedPumpSwapEvidence(e.transaction,input(e)));assert.equal(corrected.length,6);assert.equal(corrected.filter(t=>t.side==='buy').length,2);assert.ok(corrected.every(t=>t.transferChecks.baseTransfer&&t.transferChecks.userQuoteTransfer));
  assert.equal(capture.executedEvidence.length,4);assert.equal(capture.normalizedBuys,0);assert.equal(capture.qualityGaps.filter((g:any)=>g.reason==='executed-transfer-or-feature-validation-unavailable').length,2);assert.equal(capture.complete60SecondFeatureWindows,0);
  for(const original of capture.executedEvidence){const replay=corrected.find(t=>t.identityKey===original.identityKey)!;assert.equal(replay.fingerprint,original.fingerprint);}
});

test('an earlier retained actual exact-quote-in-v2 Buy independently confirms full debit versus net curve semantics',()=>{
  const run='2026-10-26T19-42-16.130Z',rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x)),r=rows.filter(r=>r.kind==='migration-transaction')[1]!,tx=r.data;
  const trades=mapConfirmedPumpSwapEvidence(tx,{signature:tx.transaction.signatures[0],mint:'A4CSsC9DPkKRnbcX3U3zQZnC9oV4JFieu7pu8oFWpump',pool:'7fQkV54AAoUUqkTu1nVCCguZNwr34kbRuXGqx8ZLvgXU',providerReceivedAt:null,availableAt:Date.parse(r.receivedAt)});
  assert.equal(trades.length,1);const trade=trades[0]!;assert.equal(trade.side,'buy');assert.equal(trade.curveQuoteLamports,'1975308641');assert.equal(trade.userQuoteLamports,'2000000000');assert.deepEqual(trade.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
});

test('distinct actual legacy exact-quote-in Buy proves net curve versus full debit across four fee/vault transfers',()=>{
  const path='evidence/overnight-20261027/14-retained-buy/',rows=readFileSync(path+'observations.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x)),record=rows.find(r=>r.kind==='retained-buy-transaction')!.data,tx=record.tx;
  const request={...record.hint,providerReceivedAt:record.hint.receivedAt,availableAt:record.availableAt},mapped=mapConfirmedPumpSwapEvidence(tx,request);assert.equal(mapped.length,1);const trade=mapped[0]!;
  assert.equal(tx.version,'legacy');assert.equal(trade.side,'buy');assert.equal(trade.curveQuoteLamports,'287832');assert.equal(trade.userQuoteLamports,'288696');assert.equal(trade.tokenUnits,'2070648');assert.deepEqual(trade.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
  assert.equal(trade.identity.outerInstructionIndex,6);assert.equal(trade.identity.swapInnerInstructionIndex,null);assert.equal(trade.identity.eventInnerInstructionIndex,6);
  const transfers=tx.meta.innerInstructions.find((g:any)=>g.index===6).instructions,amounts=[2,3,4,5].map(i=>Buffer.from(bs58.decode(transfers[i].data)).readBigUInt64LE(1));assert.deepEqual(amounts,[288408n,72n,144n,72n]);assert.equal(amounts.reduce((a,b)=>a+b,0n),BigInt(trade.userQuoteLamports));
  assert.equal(287832n+576n,amounts[0]);assert.equal(BigInt(trade.fees.protocol_fee!),amounts[1]!+amounts[3]!);assert.equal(BigInt(trade.fees.buyback_fee!),amounts[3]);assert.equal(287832n+576n+144n+144n,BigInt(trade.userQuoteLamports));
  // Exact actual debit proof remains mandatory, including a separately sent
  // buyback share. It is not an additional fee beyond the protocol total.
  const missing=structuredClone(tx);missing.meta.innerInstructions.find((g:any)=>g.index===6).instructions.splice(5,1);const bad=mapConfirmedPumpSwapEvidence(missing,request)[0]!;assert.equal(bad.transferChecks.userQuoteTransfer,false);
  assert.ok(record.availableAt-record.hint.receivedAt>3600000);assert.equal(trade.availableAt,record.availableAt);assert.equal(record.confirmationBackdated,false);
  const summary=JSON.parse(readFileSync(path+'summary.json','utf8'));assert.equal(summary.reason,'COMPONENT_RETAINED_BUY_TRANSFERS_UNVERIFIED');assert.equal(summary.selected,null);
  // This late transaction validates a mapper variant. Current pool/mint/vault/
  // fee support was not fetched in leg14 and no fresh candidate is fabricated.
});
