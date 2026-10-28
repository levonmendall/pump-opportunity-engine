/** Retained real protocol actions; corruptions and clock changes are synthetic.
 * No network, financial account, actor-convention adoption or feature changes. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import BN from 'bn.js';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {decodeProtocolBuyAndBurns,type ProtocolDecodeInput} from '../scripts/decode-protocol-flow.js';
import {inspectScopedPumpSwapInstructions,mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';

const captured=JSON.parse(readFileSync('evidence/pilot-mapper-20261027/boost-buy-and-burn.json','utf8'));
const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);
const input=(r:any):ProtocolDecodeInput=>({...r.input,commitment:'confirmed'});
function editedEvent(tx:any,index:number,edit:(data:any)=>void){
  const ix=tx.meta.innerInstructions[0].instructions[index],raw=Buffer.from(bs58.decode(ix.data));
  const event=coder.events.decode(raw.subarray(8).toString('base64'))!;edit(event.data);
  ix.data=bs58.encode(Buffer.concat([raw.subarray(0,16),coder.types.encode(event.name,event.data)]));
}
function editedAmount(ix:any){const raw=Buffer.from(bs58.decode(ix.data));raw.writeBigUInt64LE(raw.readBigUInt64LE(1)+1n,1);ix.data=bs58.encode(raw);}

test('three retained successful boosts decode as protocol burn evidence, never ordinary wallet flow',()=>{
  assert.equal(captured.records.length,3);
  const expected=[['825356597','4870691576617'],['653527885','3609355260'],['486196455','1158660251653']];
  for(const [i,r] of captured.records.entries()){
    const before=JSON.stringify(r),at=r.input.availableAt+1000,rows=decodeProtocolBuyAndBurns(r.transaction,input(r),at);
    assert.equal(rows.length,1);const e=rows[0]!;
    assert.equal(e.classification,'protocol-buy-and-burn');assert.equal(e.mode,'OFFLINE_EVIDENCE_COMPONENT');
    assert.equal(e.version,'pump-boost-offline-v1-unadopted');assert.equal(e.normalizedForStrategy,false);
    assert.equal(e.actor.ordinaryBuyer,false);assert.equal(e.actor.kind,'protocol-boost-vault-authority');
    assert.equal(e.transactionCompleteness,'NOT_ESTABLISHED_BY_THIS_COMPONENT');
    assert.deepEqual([e.amounts.usedQuoteLamports,e.amounts.burnedBaseUnits],expected[i]);
    assert.equal(e.transfers.quote.amount,e.amounts.usedQuoteLamports);assert.equal(e.transfers.burn.amount,e.amounts.burnedBaseUnits);
    assert.equal(e.transfers.quote.authority,e.actor.authorityPda);assert.equal(e.transfers.burn.authority,e.pool);
    assert.equal(e.identity.outerInstructionIndex,2);assert.equal(e.identity.protocolInnerInstructionIndex,null);
    assert.equal(e.identity.buyEventInnerInstructionIndex,2);assert.equal(e.identity.boostEventInnerInstructionIndex,3);
    assert.equal(e.transfers.quote.innerInstructionIndex,0);assert.equal(e.transfers.burn.innerInstructionIndex,1);
    assert.equal(e.slot,r.transaction.slot);assert.equal(e.chainBlockTime,r.transaction.blockTime);
    assert.equal(e.providerReceivedAt,r.input.providerReceivedAt);assert.equal(e.recordedRpcAvailableAt,r.input.availableAt);assert.equal(e.offlineDecodedAt,at);
    const originalEvent=coder.events.decode(Buffer.from(bs58.decode(r.transaction.meta.innerInstructions[0].instructions[3].data)).subarray(8).toString('base64'))!;
    assert.equal(e.events.eventTimestamp,(originalEvent.data as any).timestamp.toString(10),'preserve actual program time even when equal to block time');
    assert.equal(e.commitment,'confirmed');assert.ok(Object.values(e.fees).every(v=>v==='0'));
    assert.equal(Object.hasOwn(e,'wallet'),false);assert.equal(Object.hasOwn(e,'side'),false);assert.equal(Object.hasOwn(e,'quoteLamports'),false);
    assert.equal(JSON.stringify(r),before,'offline decoder must not mutate retained evidence');
    assert.throws(()=>inspectScopedPumpSwapInstructions(r.transaction,r.input),/UNSUPPORTED_BOOST_BUY_AND_BURN_FLOW/);
    assert.throws(()=>mapConfirmedPumpSwapEvidence(r.transaction,r.input),/UNSUPPORTED_BOOST_BUY_AND_BURN_FLOW/);
    const again=decodeProtocolBuyAndBurns(r.transaction,{...input(r),availableAt:r.input.availableAt+10},at+100);
    assert.equal(again[0]!.fingerprint,e.fingerprint,'content identity does not rewrite later availability into earlier evidence');
  }
});

test('strict protocol evidence refuses corrupted authority, accounts, amounts, burn, event, fees and stacks',()=>{
  const cases:Array<[string,(tx:any)=>void]>=[
    ['failed transaction',tx=>{tx.meta.err={InstructionError:[2,'Custom']};}],
    ['boost authority PDA',tx=>{tx.transaction.message.instructions[2].accounts[7]=tx.transaction.message.instructions[2].accounts[0];}],
    ['invoking signer',tx=>{tx.transaction.message.instructions[2].accounts[1]=tx.transaction.message.instructions[2].accounts[7];}],
    ['pool base vault relation',tx=>{tx.transaction.message.instructions[2].accounts[5]=tx.transaction.message.instructions[2].accounts[6];}],
    ['quote transfer amount',tx=>{editedAmount(tx.meta.innerInstructions[0].instructions[0]);}],
    ['quote transfer authority',tx=>{tx.meta.innerInstructions[0].instructions[0].accounts[3]=tx.transaction.message.instructions[2].accounts[1];}],
    ['base burn amount',tx=>{editedAmount(tx.meta.innerInstructions[0].instructions[1]);}],
    ['base burn authority',tx=>{tx.meta.innerInstructions[0].instructions[1].accounts[2]=tx.transaction.message.instructions[2].accounts[7];}],
    ['missing paired event',tx=>{tx.meta.innerInstructions[0].instructions.splice(3,1);}],
    ['wrong paired event',tx=>{tx.meta.innerInstructions[0].instructions[3].data=tx.meta.innerInstructions[0].instructions[2].data;}],
    ['wrong event authority',tx=>{tx.meta.innerInstructions[0].instructions[2].accounts[0]=tx.transaction.message.instructions[2].accounts[12];}],
    ['event mint role',tx=>{editedEvent(tx,3,d=>{d.mint=new PublicKey('11111111111111111111111111111111');});}],
    ['paired output amount',tx=>{editedEvent(tx,3,d=>{d.base_amount_burned=d.base_amount_burned.addn(1);});}],
    ['nonzero executed fee',tx=>{editedEvent(tx,2,d=>{d.lp_fee=new BN(1);});}],
    ['nonzero fee basis points',tx=>{editedEvent(tx,2,d=>{d.holder_rewards_bps=new BN(1);});}],
    ['ordinary buyer substitution',tx=>{editedEvent(tx,2,d=>{d.user=d.coin_creator;});}],
    ['paired reserve mismatch',tx=>{editedEvent(tx,3,d=>{d.base_reserves_after=d.base_reserves_after.addn(1);});}],
    ['parent stack',tx=>{tx.transaction.message.instructions[2].stackHeight=2;}],
    ['child stack',tx=>{tx.meta.innerInstructions[0].instructions[2].stackHeight=3;}],
    ['extra child',tx=>{tx.meta.innerInstructions[0].instructions.push(structuredClone(tx.meta.innerInstructions[0].instructions[0]));}],
    ['truncated instruction',tx=>{const ix=tx.transaction.message.instructions[2];ix.data=bs58.encode(Buffer.from(bs58.decode(ix.data)).subarray(0,8));}],
    ['truncated event',tx=>{const ix=tx.meta.innerInstructions[0].instructions[3];ix.data=bs58.encode(Buffer.from(bs58.decode(ix.data)).subarray(0,24));}],
  ];
  for(const [name,edit] of cases){const r=captured.records[0],tx=structuredClone(r.transaction);edit(tx);assert.throws(()=>decodeProtocolBuyAndBurns(tx,input(r),r.input.availableAt+1000),Error,name);}
});

test('nested Boost remains explicitly unsupported and time/commitment are not invented',()=>{
  const r=captured.records[0],tx=structuredClone(r.transaction),inner={...structuredClone(tx.transaction.message.instructions[2]),stackHeight:2};
  tx.meta.innerInstructions[0].instructions.unshift(inner);
  assert.throws(()=>decodeProtocolBuyAndBurns(tx,input(r),r.input.availableAt+1000),/NESTED_SHAPE_UNTESTED/);
  assert.throws(()=>decodeProtocolBuyAndBurns(r.transaction,{...input(r),commitment:undefined} as any),/DECLARED_REQUEST_COMMITMENT/);
  assert.throws(()=>decodeProtocolBuyAndBurns(r.transaction,input(r),r.input.availableAt-1),/AVAILABILITY/);
  assert.throws(()=>decodeProtocolBuyAndBurns(r.transaction,{...input(r),providerReceivedAt:r.input.availableAt+1}),/RECEIPT_ORDER/);
  assert.throws(()=>decodeProtocolBuyAndBurns(r.transaction,{...input(r),signature:captured.records[1].input.signature}),/SIGNATURE/);
});

test('signed virtual reserve serialization preserves signed i128 evidence without inventing a price',()=>{
  const r=captured.records[0],tx=structuredClone(r.transaction);
  for(const index of [2,3])editedEvent(tx,index,d=>{d.virtual_quote_reserves=new BN(-123);});
  const result=decodeProtocolBuyAndBurns(tx,input(r),r.input.availableAt+1000)[0]!;
  assert.equal(result.events.virtualQuoteReserves,'-123');assert.equal(Object.hasOwn(result,'price'),false);
});

test('ordinary retained Buy and Sell fingerprints and transfer evidence are unchanged by the offline component',()=>{
  const rows=readFileSync('evidence/dynamic-funnel-20261027/retained-log-events.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line));
  const sides=new Set<string>();let swaps=0;
  for(const row of rows){const d=row.data,mint=d.selectedHints[0].mint,pool=canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),scope={signature:d.hint.signature,mint,pool,providerReceivedAt:d.hint.receivedAt,availableAt:d.rpcAvailableAt},before=mapConfirmedPumpSwapEvidence(d.transaction,scope),raw=JSON.stringify(d.transaction);
    assert.deepEqual(decodeProtocolBuyAndBurns(d.transaction,{...scope,commitment:'confirmed'},d.rpcAvailableAt+1000),[]);
    const after=mapConfirmedPumpSwapEvidence(d.transaction,scope);assert.deepEqual(after,before);assert.equal(JSON.stringify(d.transaction),raw);
    for(const trade of after){swaps++;sides.add(trade.side);assert.deepEqual(trade.transferChecks,{baseTransfer:true,userQuoteTransfer:true});}
  }
  assert.equal(swaps,6);assert.deepEqual([...sides].sort(),['buy','sell']);
});
