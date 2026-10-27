import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {compareMappedTradeEvidence,mapConfirmedPumpSwapEvidence,pumpApiSignatureHint,toResearchNormalizedTrade} from '../src/pumpapi-mapping.js';
const sample=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD'};
const input={...scope,signature:sample.signature,providerReceivedAt:null,availableAt:Date.parse(sample.fetchedAt)};
const fixture=()=>structuredClone(sample.transaction);
test('actual retained confirmed direct Sell maps executed integer amounts and full CPI identity',()=>{
  const rows=mapConfirmedPumpSwapEvidence(fixture(),input);assert.equal(rows.length,1);const row=rows[0]!;
  assert.equal(row.side,'sell');assert.equal(row.tokenUnits,'138353716808147');assert.equal(row.curveQuoteLamports,'1481514');assert.equal(row.userQuoteLamports,'1462993');
  assert.equal(row.trader,'BwJigd5taT26gAhNcv1DMrC7epkedHBjcgbWVbEMP8Q');
  assert.deepEqual(row.identity,{signature:sample.signature,program:'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',outerInstructionIndex:2,swapInnerInstructionIndex:null,eventInnerInstructionIndex:5,eventIndex:0});
  assert.deepEqual(row.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
  assert.equal(row.fees.lp_fee,'297');assert.equal(row.fees.protocol_fee,'13779');assert.equal(row.fees.coin_creator_fee,'4445');
  assert.equal(BigInt(row.curveQuoteLamports)-BigInt(row.fees.lp_fee!)-BigInt(row.fees.protocol_fee!)-BigInt(row.fees.coin_creator_fee!),BigInt(row.userQuoteLamports));
  assert.equal(row.normalizedForStrategy,false);assert.equal(row.commitment,'confirmed');
});
test('constraint minima and transaction fee are never mapped as executed notional',()=>{
  const row=mapConfirmedPumpSwapEvidence(fixture(),input)[0]!;assert.notEqual(row.userQuoteLamports,'1');assert.notEqual(row.userQuoteLamports,String(sample.transaction.meta.fee));assert.equal(sample.transaction.meta.fee,25000);
});
test('signature hints ignore UI numbers and txSigner, requiring RPC enrichment',()=>{
  const raw={pool:'pump-amm',poolId:scope.pool,mint:scope.mint,signature:sample.signature,txSigner:'not-a-trader',action:'buy',tokenAmount:JSON.parse('9007199254740993'),quoteAmount:1e-10};
  assert.deepEqual(pumpApiSignatureHint(raw,scope),{signature:sample.signature,requiresRpcEnrichment:true});
  assert.equal(raw.tokenAmount,9007199254740992);assert.equal(pumpApiSignatureHint({...raw,signature:'bad'},scope),null);assert.equal(pumpApiSignatureHint({...raw,poolId:'wrong'},scope),null);assert.equal(pumpApiSignatureHint({...raw,pool:'pump'},scope),null);
});
test('logs and event CPI are one evidence source; repeated bytes preserve identity and availability is not backdated',()=>{
  const tx=fixture(),first=mapConfirmedPumpSwapEvidence(tx,input)[0]!;tx.meta.logMessages.push(...tx.meta.logMessages);
  const later=mapConfirmedPumpSwapEvidence(tx,{...input,providerReceivedAt:input.availableAt-500,availableAt:input.availableAt+1000})[0]!;
  assert.equal(later.identityKey,first.identityKey);assert.equal(later.fingerprint,first.fingerprint);assert.equal(later.availableAt,input.availableAt+1000);assert.equal(later.providerReceivedAt,input.availableAt-500);
  assert.equal(compareMappedTradeEvidence(first,later),'duplicate');
});
test('failed, mismatched, unresolved-stack and noncanonical transactions cannot supply flow',()=>{
  const failed=fixture();failed.meta.err={InstructionError:[2,'failed']};assert.throws(()=>mapConfirmedPumpSwapEvidence(failed,input),/UNSUCCESSFUL/);
  assert.throws(()=>mapConfirmedPumpSwapEvidence(fixture(),{...input,signature:'wrong'}),/SIGNATURE_MISMATCH/);
  assert.throws(()=>mapConfirmedPumpSwapEvidence(fixture(),{...input,pool:scope.mint}),/CANONICAL_POOL/);
  const missing=fixture();delete missing.meta.innerInstructions[0].instructions[5].stackHeight;assert.throws(()=>mapConfirmedPumpSwapEvidence(missing,input),/STACK_HEIGHT/);
  const short=fixture(),event=short.meta.innerInstructions[0].instructions[5];event.data=bs58.encode(Buffer.from(bs58.decode(event.data)).subarray(0,-8));assert.throws(()=>mapConfirmedPumpSwapEvidence(short,input),/EVENT_LAYOUT/);
  assert.throws(()=>mapConfirmedPumpSwapEvidence(fixture(),{...input,providerReceivedAt:input.availableAt+1}),/AVAILABILITY/);
});
test('conflicting event contents remain identifiable, while role/transfer disagreement is visible',()=>{
  const tx=fixture(),original=mapConfirmedPumpSwapEvidence(tx,input)[0]!;
  const eventIx=tx.meta.innerInstructions[0].instructions[5],raw=Buffer.from(bs58.decode(eventIx.data));raw.writeBigUInt64LE(138353716808148n,24);eventIx.data=bs58.encode(raw);
  const changed=mapConfirmedPumpSwapEvidence(tx,input)[0]!;assert.equal(changed.identityKey,original.identityKey);assert.notEqual(changed.fingerprint,original.fingerprint);assert.equal(changed.transferChecks.baseTransfer,false);assert.equal(changed.normalizedForStrategy,false);
  assert.equal(compareMappedTradeEvidence(original,changed),'correction');
  const bad=fixture();bad.transaction.message.instructions[2].accounts[1]=2;assert.throws(()=>mapConfirmedPumpSwapEvidence(bad,input),/TRADER_ROLE_MISMATCH/);
});
test('changed transfer quality invalidates an unchanged event instead of being classified as a duplicate',()=>{
  const tx=fixture(),original=mapConfirmedPumpSwapEvidence(tx,input)[0]!;
  const transfer=tx.meta.innerInstructions[0].instructions[1],raw=Buffer.from(bs58.decode(transfer.data));raw.writeBigUInt64LE(raw.readBigUInt64LE(1)+1n,1);transfer.data=bs58.encode(raw);
  const changed=mapConfirmedPumpSwapEvidence(tx,input)[0]!;assert.equal(changed.identityKey,original.identityKey);assert.equal(changed.tokenUnits,original.tokenUnits);assert.equal(changed.transferChecks.baseTransfer,false);assert.equal(compareMappedTradeEvidence(original,changed),'correction');
  assert.throws(()=>toResearchNormalizedTrade(changed,'curve','retained verified migration'),/UNVERIFIED_EXECUTED_TRANSFERS/);
});
test('explicit curve/user research views preserve true CPI position and RPC availability without choosing a primary convention',()=>{
  const e=mapConfirmedPumpSwapEvidence(fixture(),{...input,providerReceivedAt:input.availableAt-900})[0]!;
  const curve=toResearchNormalizedTrade(e,'curve','evidence/integration-proof-2026-10-26T23-32-41.255Z.json'),user=toResearchNormalizedTrade(e,'user','evidence/integration-proof-2026-10-26T23-32-41.255Z.json');
  assert.equal(curve.mode,'RESEARCH_ONLY');assert.equal(curve.trade.quoteLamports,'1481514');assert.equal(user.trade.quoteLamports,'1462993');assert.deepEqual(curve.fullIdentity,e.identity);
  assert.deepEqual(curve.trade.identity,{signature:sample.signature,instructionIndex:2,eventIndex:5});assert.equal(curve.trade.receivedAt,input.availableAt);assert.equal(e.normalizedForStrategy,false);
  assert.throws(()=>toResearchNormalizedTrade(e,'curve',''),/SUPPORTED_POOL_EVIDENCE_REQUIRED/);
});
test('synthetic fee-payer separation uses event user and instruction role rather than key zero',()=>{
  const tx=fixture();tx.transaction.message.accountKeys.unshift('11111111111111111111111111111111');
  const bump=(ix:any)=>{ix.programIdIndex++;ix.accounts=ix.accounts.map((i:number)=>i+1);};tx.transaction.message.instructions.forEach(bump);for(const group of tx.meta.innerInstructions)group.instructions.forEach(bump);
  assert.equal(mapConfirmedPumpSwapEvidence(tx,input)[0]!.trader,'BwJigd5taT26gAhNcv1DMrC7epkedHBjcgbWVbEMP8Q');
});
test('current actual custom-quote Sell and program-address mentions cannot establish a supported pool sample',()=>{
  const current=JSON.parse(readFileSync('evidence/free-data-20261027/public-activity-2026-10-27T02-02-18.064Z.json','utf8'));
  const first=current.transactions[0];
  assert.throws(()=>mapConfirmedPumpSwapEvidence(first.value,{signature:first.signature,mint:'So11111111111111111111111111111111111111112',pool:'pCKusx9zFxyY1ZhaNjXPRtLVyL9KjnEvZBv4FefMDxb',providerReceivedAt:null,availableAt:first.availableAt}),/CANONICAL_POOL/);
  for(const noninvocation of current.transactions.slice(1))assert.deepEqual(mapConfirmedPumpSwapEvidence(noninvocation.value,{...input,signature:noninvocation.signature,availableAt:noninvocation.availableAt}),[]);
});
