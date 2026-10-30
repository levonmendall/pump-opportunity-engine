/** Historical matched evidence plus explicitly synthetic negative/rounding
 * cases. No old failed window is repaired or admitted retroactively. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import BN from 'bn.js';
import bs58 from 'bs58';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import {PublicKey} from '@solana/web3.js';
import {parseProgramLogEvidence,compareLogToFull,toConfirmedProgramTrade} from '../src/program-log-mapping.js';
import {inspectScopedPumpSwapInstructions,mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
const require=createRequire(import.meta.url),coder=new BorshCoder(JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl);
const file='evidence/native-shape-review-20261028/multi-hop-actual.json',raw=readFileSync(file),actual=JSON.parse(raw.toString());
const scope={mint:'F5v2odurfbucdViokrzwYNczrrTZuvHhnY8ofRU2pump',pool:'89MFRL9ypWvMYsMvpGayei4rje6MDctEpoWqrSfuYWw8',supportedPoolEvidence:'retained exact compiled route and original scope; historical parity only',baseTokenProgram:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'};
// A fixed synthetic timely decision clock for admission mechanics. The actual
// later historical RPC retrieval is not backdated into a forward decision.
const at=actual.blockTime*1000+1000,signature=actual.transaction.signatures[0];
const input={...scope,signature,providerReceivedAt:null,availableAt:at};
const logInput=(tx=actual)=>({signature,slot:tx.slot,err:tx.meta.err,logs:tx.meta.logMessages,commitment:'confirmed' as const,receivedAt:at-100,availableAt:at});
const clone=()=>structuredClone(actual),group=(tx:any)=>tx.meta.innerInstructions.find((g:any)=>g.index===2).instructions;
const full=(tx=actual)=>mapConfirmedPumpSwapEvidence(tx,input);
const native=(tx=actual)=>parseProgramLogEvidence(logInput(tx),[scope]);
function eventMutation(tx:any,mutate:(data:any)=>void){
 const event=group(tx)[5],b=Buffer.from(bs58.decode(event.data)),decoded=coder.events.decode(b.subarray(8).toString('base64'))!;
 mutate(decoded.data);const encoded=Buffer.concat([b.subarray(8,16),coder.types.encode(decoded.name,decoded.data)]);
 const previous='Program data: '+b.subarray(8).toString('base64');tx.meta.logMessages=tx.meta.logMessages.map((s:string)=>s===previous?'Program data: '+encoded.toString('base64'):s);
 event.data=bs58.encode(Buffer.concat([b.subarray(0,8),encoded]));
}

test('actual own-event MultiHop first pool leg has exact native/compiled amounts, fees, roles and distinct identities',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'35230ba1673b68d2fc24ef47e1dbb04d3dfc59cf5367912e568e93de0b0a5684');
 const before=JSON.stringify(actual),logs=native(),rows=full(),e=logs[0]!,f=rows[0]!;assert.equal(logs.length,1);assert.equal(rows.length,1);assert.equal(compareLogToFull(e,f),true);
 assert.equal(e.instructionLabel,'MultiHopSwap');assert.equal(e.eventIxName,'multi_hop_swap');assert.equal(e.side,'buy');assert.equal(e.tokenUnits,'20914680636');assert.equal(e.curveQuoteLamports,'22570138');assert.equal(e.userQuoteLamports,'22581424');assert.equal(e.fees.protocol_fee,'11286');assert.equal(e.fees.buyback_fee,'5643');
 assert.equal(BigInt(e.userQuoteLamports)-BigInt(e.curveQuoteLamports),BigInt(e.fees.protocol_fee!));assert.notEqual(BigInt(e.userQuoteLamports)-BigInt(e.curveQuoteLamports),BigInt(e.fees.protocol_fee!)+BigInt(e.fees.buyback_fee!));
 assert.equal(e.trader,'D5V2LbmW8uPZrUomZH2ioAECCvxypoAmJadm1xnmv4GS');assert.deepEqual(e.framePath,['6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB','pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA']);assert.equal(e.identity.logArrayIndex,34);assert.equal(e.frameOrdinal,9);
 assert.deepEqual(f.identity,{signature,program:e.identity.program,outerInstructionIndex:2,swapInnerInstructionIndex:2,eventInnerInstructionIndex:5,eventIndex:0});assert.deepEqual(f.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
 assert.equal(f.route?.version,'observed-first-sol-pool-to-curve-buy-v1');assert.equal(f.route?.userReceivedIntermediateBase,false);assert.equal(f.route?.finalMint,'AW9JFcf8XexnLaPnVhs5zsy9XCAqVkGFoarY5rbypump');assert.equal(f.route?.finalUserTokenAccount,'7cVvzFbnrFg5EfCLUYeyGmfsUXf7LhNRBuGP66Jt6TVn');
 assert.equal(e.compiledInstructionIdentity,null);assert.equal(e.transferChecks,null);assert.equal(e.transactionCompleteness,'NOT_ESTABLISHED');assert.equal(f.normalizedForStrategy,false);assert.equal(JSON.stringify(actual),before);
 const inspection=inspectScopedPumpSwapInstructions(actual,input);assert.equal(inspection.supportedSwapInstructions,1);assert.equal(inspection.checks[0]!.instructionName,'multi_hop_swap');assert.equal(inspection.checks[0]!.classification,'supported-swap');
});

test('timely native admission retains log identity and curve-input convention without asserting historical receipt',()=>{
 const e=native()[0]!,n=toConfirmedProgramTrade(e,{...scope,verifiedAt:at-1,minimumSlot:actual.slot},at);assert.equal(n.trade.wallet,e.trader);assert.equal(n.trade.quoteLamports,'22570138');assert.equal(n.trade.tokenUnits,'20914680636');assert.equal(n.trade.receivedAt,at);assert.equal(n.transferCrossCheck,'UNAVAILABLE');
 assert.throws(()=>toConfirmedProgramTrade({...e,receivedAt:at-5001},{...scope,verifiedAt:at-1,minimumSlot:actual.slot},at),/RECEIPT_DEADLINE/);
 assert.throws(()=>toConfirmedProgramTrade({...e,availableAt:at+1},{...scope,verifiedAt:at-1,minimumSlot:actual.slot},at),/NORMALIZATION_DEADLINE/);
});

test('synthetic fee payer separation retains the actual route user role rather than key zero',()=>{
 const tx=clone();tx.transaction.message.accountKeys.unshift(PublicKey.default.toBase58());tx.transaction.message.header.numRequiredSignatures=2;
 const bump=(ix:any)=>{ix.programIdIndex++;ix.accounts=ix.accounts.map((i:number)=>i+1);};tx.transaction.message.instructions.forEach(bump);for(const g of tx.meta.innerInstructions)g.instructions.forEach(bump);for(const rows of [tx.meta.preTokenBalances,tx.meta.postTokenBalances])for(const b of rows)b.accountIndex++;tx.meta.preBalances.unshift(1);tx.meta.postBalances.unshift(1);
 assert.equal(full(tx)[0]!.trader,actual.transaction.message.accountKeys[0]);assert.notEqual(full(tx)[0]!.trader,tx.transaction.message.accountKeys[0]);
});

for(const [label,mutate] of [
 ['wrong compiled route user',(tx:any)=>{group(tx)[2].accounts[0]=2;}],
 ['unverified signer',(tx:any)=>{tx.transaction.message.header.numRequiredSignatures=0;}],
 ['wrong base mint',(tx:any)=>{group(tx)[2].accounts[16]=27;}],
 ['wrong SOL quote',(tx:any)=>{group(tx)[2].accounts[17]=27;}],
 ['wrong next quote',(tx:any)=>{group(tx)[2].accounts[22]=16;}],
 ['wrong final venue',(tx:any)=>{group(tx)[2].accounts[23]=7;}],
 ['third hop',(tx:any)=>{group(tx)[2].accounts.push(...group(tx)[2].accounts.slice(16,21));}],
 ['wrong curve instruction',(tx:any)=>{const b=Buffer.from(bs58.decode(group(tx)[6].data));b[0]=b[0]!^1;group(tx)[6].data=bs58.encode(b);}],
 ['wrong curve source',(tx:any)=>{group(tx)[6].accounts[5]=5;}],
 ['wrong pump global role',(tx:any)=>{group(tx)[2].accounts[13]=0;}],
 ['wrong curve token program',(tx:any)=>{group(tx)[6].accounts[9]=17;}],
 ['wrong curve event authority',(tx:any)=>{group(tx)[9].accounts[0]=0;}],
 ['extra curve event account',(tx:any)=>{group(tx)[9].accounts.push(0);}],
 ['wrong event authority',(tx:any)=>{group(tx)[5].accounts[0]=0;}],
 ['extra event account',(tx:any)=>{group(tx)[5].accounts.push(0);}],
 ['wrong quote amount',(tx:any)=>{const b=Buffer.from(bs58.decode(group(tx)[3].data));b.writeBigUInt64LE(b.readBigUInt64LE(1)+1n,1);group(tx)[3].data=bs58.encode(b);}],
 ['wrong pool base transfer',(tx:any)=>{const b=Buffer.from(bs58.decode(group(tx)[7].data));b.writeBigUInt64LE(b.readBigUInt64LE(1)+1n,1);group(tx)[7].data=bs58.encode(b);}],
 ['wrong recipient balance',(tx:any)=>{tx.meta.postTokenBalances.find((r:any)=>r.accountIndex===6).uiTokenAmount.amount='1';}],
 ['pool balance mismatch',(tx:any)=>{tx.meta.postTokenBalances.find((r:any)=>r.accountIndex===3).uiTokenAmount.amount='1';}],
 ['second AMM call',(tx:any)=>{group(tx).push(structuredClone(group(tx)[2]));}],
 ['external protected vault access',(tx:any)=>{tx.transaction.message.instructions[0].accounts.push(3);}],
] as const)test('compiled route refuses '+label,()=>{const tx=clone();mutate(tx);assert.throws(()=>full(tx),/MULTI_HOP_|RELEVANT_/);});

for(const [label,mutate] of [
 ['nonzero missing fee',(d:any)=>{d.lp_fee=new BN(1);}],
 ['fake user base account',(d:any)=>{d.user_base_token_account=new PublicKey(actual.transaction.message.accountKeys[6]);}],
 ['wrong quote convention',(d:any)=>{d.user_quote_amount_in=d.user_quote_amount_in.addn(1);}],
 ['double-counted buyback',(d:any)=>{d.protocol_fee=d.protocol_fee.add(d.buyback_fee);}],
 ['wrong output',(d:any)=>{d.base_amount_out=d.base_amount_out.addn(1);}],
 ['different instruction name',(d:any)=>{d.ix_name='buy';}],
] as const)test('native route refuses '+label,()=>{const tx=clone();eventMutation(tx,mutate);assert.throws(()=>native(tx),/MULTI_HOP_|BUY_VARIANT_AGREEMENT/);});

test('native grammar requires actual current Token2022 base support and the observed single curve shape',()=>{
 for(const baseTokenProgram of [undefined,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'])assert.throws(()=>parseProgramLogEvidence(logInput(),[{...scope,baseTokenProgram}]),/MULTI_HOP_VERIFIED_BASE_PROGRAM/);
 const tx=clone();tx.meta.logMessages=tx.meta.logMessages.filter((s:string)=>s!=='Program log: Instruction: MultiHopCurveSwap');assert.throws(()=>native(tx),/MULTI_HOP_CURVE_CHILD/);
 const renamed=clone();renamed.meta.logMessages=renamed.meta.logMessages.map((s:string)=>s==='Program log: Instruction: MultiHopSwap'?'Program log: Instruction: Buy':s);assert.throws(()=>native(renamed),/BUY_VARIANT_AGREEMENT/);
});

test('synthetic SDK rounding spends the full received budget after the rounded fee, not preliminary net',()=>{
 const tx=clone();eventMutation(tx,d=>{const gross=911n,bps=11n,preliminary=gross*10000n/(10000n+bps),fee=(preliminary*bps+9999n)/10000n,net=gross-fee;
  assert.equal(preliminary,909n);assert.equal(fee,1n);assert.equal(net,910n);
  d.quote_amount_in=d.max_quote_amount_in=new BN(gross.toString());d.user_quote_amount_in=d.quote_amount_in_with_lp_fee=new BN(net.toString());d.protocol_fee=new BN(fee.toString());d.protocol_fee_basis_points=new BN(bps.toString());d.buyback_fee=new BN(0);const base=BigInt(d.pool_base_token_reserves.toString())*(net-1n)/(BigInt(d.pool_quote_token_reserves.toString())+BigInt(d.virtual_quote_reserves.toString())+net-1n);d.base_amount_out=new BN(base.toString());
 });assert.equal(native(tx)[0]!.curveQuoteLamports,'910');
});

test('actual late historical retrieval never repairs or qualifies the earlier failed source window',()=>{
 const actualRpcAvailableAt=1793215281860,later=mapConfirmedPumpSwapEvidence(actual,{...input,availableAt:actualRpcAvailableAt})[0]!;assert.equal(later.availableAt,actualRpcAvailableAt);const e=parseProgramLogEvidence({...logInput(),receivedAt:actualRpcAvailableAt,availableAt:actualRpcAvailableAt},[scope])[0]!;assert.throws(()=>toConfirmedProgramTrade(e,{...scope,verifiedAt:actualRpcAvailableAt,minimumSlot:actual.slot},actualRpcAvailableAt),/PROGRAM_CLOCK_STALE/);
});
