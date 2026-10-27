/** Actual retained forward failure; correction remains offline. No networking. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {BorshCoder} from '@coral-xyz/anchor';
import BN from 'bn.js';
import bs58 from 'bs58';
import {decodePumpSwapInstruction,mapConfirmedPumpSwapEvidence,toResearchNormalizedTrade} from '../src/pumpapi-mapping.js';

const path='evidence/standing-research-20261027/01-paced-combined/',capture=JSON.parse(readFileSync(path+'capture.json','utf8')),records=readFileSync(path+'observations.ndjson','utf8').trim().split('\n').map(s=>JSON.parse(s));
const signature='2CPXozPnsW1SPnLsTYHzWPLjKCGySCBbtYLX3go3X6uanBCmCh5hLnWvkVoZhwq9xy7XEuSBZei7oB4MRmkh8miP',transaction=capture.enrichmentTransactions[signature],hint=capture.enrichmentHints[signature];
const input={...capture.scope,signature,providerReceivedAt:hint.receivedAt,availableAt:hint.availableAt};
const group=transaction.meta.innerInstructions.find((g:any)=>g.index===1),actualBytes=Buffer.from(bs58.decode(group.instructions[9].data));

test('actual24byte exact-quote-in instruction has two complete u64s and no invented trailing track_volume',()=>{
  assert.equal(transaction.version,1);assert.equal(transaction.meta.err,null);assert.equal(actualBytes.toString('hex'),'c62e1552b4d9e870338d9475000000000100000000000000');
  const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')),coder=new BorshCoder(idl);
  assert.throws(()=>coder.instruction.decode(actualBytes),/offset.*out of range/);
  const decoded=decodePumpSwapInstruction(actualBytes);assert.equal(decoded.name,'buy_exact_quote_in');assert.equal(decoded.layout,'observed-exact-quote-two-u64');assert.equal(decoded.exactLayout,true);assert.equal(decoded.trackVolumeAvailable,false);assert.equal(Object.hasOwn(decoded.data,'track_volume'),false);assert.ok(BN.isBN(decoded.data.spendable_quote_in));assert.equal(String(decoded.data.spendable_quote_in),'1972669747');assert.equal(String(decoded.data.min_base_amount_out),'1');
});

test('the actual nested Buy still requires exact trader roles, full integer transfers and existing fee ordering',()=>{
  const rows=mapConfirmedPumpSwapEvidence(transaction,input);assert.equal(rows.length,1);const trade=rows[0]!;
  assert.equal(trade.side,'buy');assert.equal(trade.tokenUnits,'98475000481');assert.equal(trade.curveQuoteLamports,'1955074078');assert.equal(trade.userQuoteLamports,'1972669747');assert.deepEqual(trade.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
  assert.deepEqual([trade.identity.outerInstructionIndex,trade.identity.swapInnerInstructionIndex,trade.identity.eventInnerInstructionIndex],[1,9,16]);assert.equal(trade.fingerprint,'c80e5485cc095cd5e2e1e2b2031d3ed63c50887e57a675c24672a6c1dca465cd');
  const fees=BigInt(trade.fees.lp_fee!)+BigInt(trade.fees.protocol_fee!)+BigInt(trade.fees.coin_creator_fee!);assert.equal(fees,17595669n);assert.equal(BigInt(trade.curveQuoteLamports)+fees,BigInt(trade.userQuoteLamports));assert.equal(trade.fees.buyback_fee,'488769');assert.equal(trade.fees.protocol_fee,'977538');
  assert.equal(trade.trader,'ARu4n5mFdZogZAravu7CcizaojWnS6oqka37gdLT5SZn');const payer=transaction.transaction.message.accountKeys[0];assert.equal(payer,'AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51');assert.notEqual(trade.trader,payer);
  const payload=JSON.parse(records.find(r=>r.kind==='selected-pumpapi-payload'&&JSON.parse(r.data.payloadUtf8).signature===signature)!.data.payloadUtf8);assert.equal(payload.txSigner,payer);assert.equal(payload.breakdown[0].trader,trade.trader);assert.equal(payload.quoteAmount,1.972669747);
  for(const convention of ['curve','user'] as const){const normalized=toResearchNormalizedTrade(trade,convention,capture.scope.supportedPoolEvidence);assert.equal(normalized.trade.receivedAt,hint.availableAt);assert.ok(normalized.trade.receivedAt>hint.receivedAt);assert.equal(normalized.trade.wallet,trade.trader);}
  // Offline mapping must not rewrite or promote the original failed window.
  assert.equal(capture.normalizedBuys,0);assert.equal(capture.normalizedSells,3);assert.ok(capture.qualityGaps.some((g:any)=>g.reason==='confirmed-transaction-mapping-unavailable'));assert.equal(capture.complete60SecondFeatureWindows,0);
});

test('length compatibility is exact; unknown, truncated and extra bytes remain explicit refusals',()=>{
  for(const invalid of [actualBytes.subarray(0,23),Buffer.concat([actualBytes,Buffer.from([2])]),Buffer.concat([actualBytes,Buffer.from([0,0])])])assert.throws(()=>decodePumpSwapInstruction(invalid),/UNSUPPORTED_SWAP_INSTRUCTION_LAYOUT/);
  const unknown=Buffer.from(actualBytes);unknown[0]=unknown[0]!^255;assert.throws(()=>decodePumpSwapInstruction(unknown),/UNKNOWN_SWAP_INSTRUCTION/);
  // Explicit synthetic suffix exercises the current packaged layout; it is not
  // evidence that the missing actual suffix represented false or true.
  for(const boolean of [0,1]){const full=decodePumpSwapInstruction(Buffer.concat([actualBytes,Buffer.from([boolean])]));assert.equal(full.layout,'pinned-sdk');assert.equal(full.trackVolumeAvailable,true);assert.ok(Object.hasOwn(full.data,'track_volume'));}
});

test('the short layout cannot bypass actual quote transfers or alter recorded Sell fingerprints',()=>{
  const bad=structuredClone(transaction),keys=[...bad.transaction.message.accountKeys,...bad.meta.loadedAddresses.writable,...bad.meta.loadedAddresses.readonly],instructions=bad.meta.innerInstructions.find((g:any)=>g.index===1).instructions;
  const real=mapConfirmedPumpSwapEvidence(transaction,input)[0]!,data=decodePumpSwapInstruction(actualBytes);assert.equal(String(data.data.spendable_quote_in),real.userQuoteLamports);
  let changed=false;
  for(let i=10;i<16;i++){const ix=instructions[i],b=Buffer.from(bs58.decode(ix.data));if(b.length===10&&b[0]===12&&keys[ix.accounts[1]]==='So11111111111111111111111111111111111111112'){b.writeBigUInt64LE(b.readBigUInt64LE(1)+1n,1);ix.data=bs58.encode(b);changed=true;break;}}
  assert.ok(changed);const broken=mapConfirmedPumpSwapEvidence(bad,input)[0]!;assert.equal(broken.transferChecks.userQuoteTransfer,false);assert.throws(()=>toResearchNormalizedTrade(broken,'user',capture.scope.supportedPoolEvidence),/UNVERIFIED_EXECUTED_TRANSFERS/);
  for(const original of capture.executedEvidence){const h=capture.enrichmentHints[original.identity.signature],replayed=mapConfirmedPumpSwapEvidence(capture.enrichmentTransactions[original.identity.signature],{...capture.scope,signature:original.identity.signature,providerReceivedAt:h.receivedAt,availableAt:h.availableAt});assert.equal(replayed.length,1);assert.equal(replayed[0]!.side,'sell');assert.equal(replayed[0]!.fingerprint,original.fingerprint);}
});
