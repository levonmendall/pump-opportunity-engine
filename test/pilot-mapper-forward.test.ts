/** Actual retained protocol actions plus explicitly synthetic integrity faults.
 * No network, trader account, natural fill or strategy expansion. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import BN from 'bn.js';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import {decodePumpSwapInstruction,inspectScopedPumpSwapInstructions,mapConfirmedPumpSwapEvidence,ScopedPumpSwapInstructionError} from '../src/pumpapi-mapping.js';
const captured=JSON.parse(readFileSync('evidence/pilot-mapper-20261027/boost-buy-and-burn.json','utf8'));
const ordinary=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD'};
const normalInput={...scope,signature:ordinary.signature,providerReceivedAt:null,availableAt:Date.parse(ordinary.fetchedAt)};
const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);
function keys(tx:any){return [...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];}
function events(tx:any){return tx.meta.innerInstructions.flatMap((g:any)=>g.instructions.flatMap((ix:any,index:number)=>{const raw=Buffer.from(bs58.decode(ix.data));return raw.subarray(0,8).toString('hex')==='e445a52e51cb9a1d'?[{index,event:coder.events.decode(raw.subarray(8).toString('base64'))}]:[];}));}

test('three actual successful protocol boosts are supported SDK instructions but not ordinary buyer observations',()=>{
  assert.equal(captured.records.length,3);
  for(const r of captured.records){
    const tx=r.transaction,k=keys(tx),outer=tx.transaction.message.instructions[2],decoded=decodePumpSwapInstruction(Buffer.from(bs58.decode(outer.data)));
    assert.equal(tx.meta.err,null);assert.equal(tx.transaction.signatures[0],r.input.signature);assert.equal(decoded.name,'boost_buy_and_burn');assert.equal(decoded.layout,'pinned-sdk');
    const buy=events(tx).find((x:any)=>x.event?.name==='BuyEvent')!.event.data as any,boost=events(tx).find((x:any)=>x.event?.name==='BoostBuyAndBurnEvent')!.event.data as any;
    const authority=PublicKey.findProgramAddressSync([Buffer.from('boost_vault'),new PublicKey(r.input.pool).toBuffer()],PUMP_AMM_PROGRAM_ID)[0].toBase58();
    assert.equal(buy.user.toBase58(),authority);assert.equal(k[outer.accounts[7]],authority);assert.equal(buy.user_base_token_account.toBase58(),'11111111111111111111111111111111');
    const [quoteIx,burnIx]=tx.meta.innerInstructions[0].instructions,quote=Buffer.from(bs58.decode(quoteIx.data)),burn=Buffer.from(bs58.decode(burnIx.data));
    assert.equal(quote[0],12);assert.equal(quote.readBigUInt64LE(1).toString(),buy.quote_amount_in.toString());assert.equal(k[quoteIx.accounts[0]],k[outer.accounts[8]]);assert.equal(k[quoteIx.accounts[3]],authority);
    assert.equal(burn[0],8);assert.equal(burn.length,9);assert.equal(burn.readBigUInt64LE(1).toString(),buy.base_amount_out.toString());assert.equal(k[burnIx.accounts[0]],k[outer.accounts[5]]);assert.equal(k[burnIx.accounts[1]],r.input.mint);
    assert.equal(boost.base_amount_burned.toString(),buy.base_amount_out.toString());assert.equal(boost.quote_amount_in_used.toString(),buy.quote_amount_in.toString());
    for(const fee of ['lp_fee','protocol_fee','coin_creator_fee','buyback_fee','holder_rewards','quote_transfer_fee'])assert.equal(buy[fee].toString(),'0');
    assert.throws(()=>inspectScopedPumpSwapInstructions(tx,r.input),/UNSUPPORTED_BOOST_BUY_AND_BURN_FLOW/);
    assert.throws(()=>mapConfirmedPumpSwapEvidence(tx,r.input),/UNSUPPORTED_BOOST_BUY_AND_BURN_FLOW/);
    assert.ok(r.rpcResponseRecordedAt>=r.input.availableAt);assert.ok(r.mappingFailureRecordedAt>=r.rpcResponseRecordedAt);
  }
});
test('an unrelated pool protocol action does not invalidate this scope or invent an ordinary buy',()=>{
  for(const r of captured.records){const input={...normalInput,signature:r.input.signature,availableAt:r.input.availableAt};assert.equal(inspectScopedPumpSwapInstructions(r.transaction,input).supportedSwapInstructions,0);assert.deepEqual(mapConfirmedPumpSwapEvidence(r.transaction,input),[]);}
});
test('unknown relevant top-level and inner AMM instructions cannot disappear as zero trades',()=>{
  for(const inner of [false,true]){const tx=structuredClone(ordinary.transaction),unknown={...tx.transaction.message.instructions[2],data:bs58.encode(Buffer.alloc(8,251))};
    if(inner){tx.transaction.message.instructions[2]={...unknown,programIdIndex:0,accounts:[]};tx.meta.innerInstructions=[{index:2,instructions:[{...unknown,stackHeight:2}]}];}else{tx.transaction.message.instructions[2]=unknown;tx.meta.innerInstructions=[];}
    assert.throws(()=>inspectScopedPumpSwapInstructions(tx,normalInput),(e:unknown)=>{assert.ok(e instanceof ScopedPumpSwapInstructionError);assert.equal(e.message,'RELEVANT_AMM_INSTRUCTION_UNSUPPORTED');assert.equal(e.checks[0]!.outerInstructionIndex,2);assert.equal(e.checks[0]!.innerInstructionIndex,inner?0:null);assert.equal(e.checks[0]!.discriminatorHex,'fbfbfbfbfbfbfbfb');return true;});
    assert.throws(()=>mapConfirmedPumpSwapEvidence(tx,normalInput),/RELEVANT_AMM_INSTRUCTION_UNSUPPORTED/);
  }
});
test('known ordinary swaps retain their compiled denominator when event bytes are missing; exact deposit is explicitly nontrade',()=>{
  const tx=structuredClone(ordinary.transaction);assert.equal(inspectScopedPumpSwapInstructions(tx,normalInput).supportedSwapInstructions,1);const fingerprint=mapConfirmedPumpSwapEvidence(tx,normalInput)[0]!.fingerprint;
  tx.meta.innerInstructions[0].instructions.splice(5,1);assert.equal(inspectScopedPumpSwapInstructions(tx,normalInput).supportedSwapInstructions,1);assert.deepEqual(mapConfirmedPumpSwapEvidence(tx,normalInput),[]);
  const deposit=structuredClone(tx);deposit.meta.innerInstructions=[];deposit.transaction.message.instructions[2].data=bs58.encode(coder.instruction.encode('deposit',{lp_token_amount_out:new BN(1),max_base_amount_in:new BN(1),max_quote_amount_in:new BN(1)}));const inspected=inspectScopedPumpSwapInstructions(deposit,normalInput);assert.equal(inspected.supportedSwapInstructions,0);assert.equal(inspected.knownNonSwapInstructions,1);assert.equal(inspected.checks[0]!.classification,'known-non-swap');
  assert.equal(mapConfirmedPumpSwapEvidence(structuredClone(ordinary.transaction),normalInput)[0]!.fingerprint,fingerprint);
});
test('a recognized AMM route wrapper requires a supported scoped child instead of being labeled nontrade',()=>{
  const tx=structuredClone(ordinary.transaction),sell=structuredClone(tx.transaction.message.instructions[2]);
  tx.transaction.message.instructions[2].data=bs58.encode(coder.instruction.encode('multi_hop_swap',{amount_in:new BN(1),min_amount_out:new BN(1)}));tx.meta.innerInstructions=[];
  assert.throws(()=>inspectScopedPumpSwapInstructions(tx,normalInput),/WRAPPER_WITHOUT_SUPPORTED_CHILD/);
  // Synthetic reparenting of retained bytes tests identity/stack mechanics only.
  const inner=ordinary.transaction.meta.innerInstructions[0].instructions.map((ix:any)=>({...structuredClone(ix),stackHeight:ix.stackHeight+1}));
  tx.meta.innerInstructions=[{index:2,instructions:[{...sell,stackHeight:2},...inner]}];
  const inspected=inspectScopedPumpSwapInstructions(tx,normalInput);assert.equal(inspected.supportedSwapInstructions,1);assert.equal(inspected.knownNonSwapInstructions,0);assert.equal(inspected.checks[0]!.classification,'supported-wrapper');
  const rows=mapConfirmedPumpSwapEvidence(tx,normalInput);assert.equal(rows.length,1);assert.equal(rows[0]!.identity.swapInnerInstructionIndex,0);assert.equal(rows[0]!.identity.eventInnerInstructionIndex,6);assert.deepEqual(rows[0]!.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
});
