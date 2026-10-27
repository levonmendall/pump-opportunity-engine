import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda,bondingCurvePda} from '../src/sdk.js';
import {invokedCanonicalSolPools} from '../src/active-selection.js';
const folder='evidence/public-component-20261027/';
const raw=readFileSync(folder+'observations.ndjson'),records=raw.toString().trim().split('\n').map(l=>JSON.parse(l));
const transactions=records.filter(r=>r.kind==='component-selection-transaction').map(r=>r.data);
const audit=JSON.parse(readFileSync(folder+'offline-selection-audit.json','utf8'));
const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);
function invocations(tx:any){const message=tx.transaction.message,keys=[...message.accountKeys,...tx.meta.loadedAddresses.writable,...tx.meta.loadedAddresses.readonly];return {keys,ix:[...message.instructions,...tx.meta.innerInstructions.flatMap((g:any)=>g.instructions)].filter((ix:any)=>keys[ix.programIdIndex]===PUMP_AMM_PROGRAM_ID.toBase58())};}

test('actual component starts are paced and linked cumulative usage preserves the historical429',()=>{
 const summary=JSON.parse(readFileSync(folder+'summary.json','utf8')),old=readFileSync('evidence/free-data-20261027/active-approved-rpc-budget.json'),prior=JSON.parse(old.toString()),u=summary.usage;
 assert.equal(prior.calls,20);assert.equal(prior.bytes,272634);assert.equal(prior.blockedReason,'RPC_HTTP_429');assert.equal(u.baseline.sha256,createHash('sha256').update(old).digest('hex'));
 assert.equal(u.newUnits,4);assert.equal(u.cumulativeUnits,24);assert.equal(u.httpBytes,104424);assert.equal(u.cumulativeResponseBytes,377058);assert.deepEqual(u.pending,[]);
 assert(u.starts.slice(1).every((t:number,i:number)=>t-u.starts[i]>=1000));assert.equal(summary.webSocket.connections,0);assert.equal(summary.pricing.completedPeriodic,0);assert.equal(summary.productionTouched,false);
});

test('retained actual routed swap has no SOL-quoted hop; decoding the new route does not create an eligible pool',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),audit.sourceSha256);
 const actual=transactions[0],tx=actual.transaction,{keys,ix}=invocations(tx);
 assert.equal(tx.meta.err,null);assert(tx.blockTime*1000<=actual.availableAt&&actual.availableAt-tx.blockTime*1000<=30000);
 const route=ix.find((i:any)=>coder.instruction.decode(Buffer.from(bs58.decode(i.data)))?.name==='multi_hop_swap');assert(route);
 const definition=idl.instructions.find(i=>i.name==='multi_hop_swap')!;assert.equal(definition.accounts.length,16);
 const remaining=route.accounts.slice(16);assert.equal(remaining.length,15);
 for(let i=0;i<3;i++){
  const [base,quote,venue]=remaining.slice(i*5,i*5+3).map((n:number)=>keys[n]),saved=audit.transactions[0].routeHops[i];
  assert.equal(base,saved.baseMint);assert.equal(quote,saved.quoteMint);assert.equal(venue,saved.venue);assert.notEqual(quote,NATIVE_MINT.toBase58());
  assert.notEqual(canonicalPumpPoolPda(new PublicKey(base)).toBase58(),venue);
  assert.equal(i<2?canonicalPumpPoolPda(new PublicKey(base),new PublicKey(quote)).toBase58():bondingCurvePda(new PublicKey(base)).toBase58(),venue);
 }
 assert.deepEqual(invokedCanonicalSolPools(tx),[]);assert.equal(audit.transactions[0].exactExclusionReason,'RECOGNIZED_MULTI_HOP_SWAP_HAS_ZERO_SOL_QUOTED_POOL_HOPS');
});

test('retained successful address-only transaction is not a PumpSwap invocation or a pricing result',()=>{
 const tx=transactions[1].transaction,{keys,ix}=invocations(tx);assert.equal(tx.meta.err,null);assert(keys.includes(PUMP_AMM_PROGRAM_ID.toBase58()));assert.equal(ix.length,0);assert.deepEqual(invokedCanonicalSolPools(tx),[]);
 assert.equal(audit.transactions[1].exactExclusionReason,'PROGRAM_ADDRESS_MENTION_ONLY_NO_PUMPSWAP_INVOCATION');
 assert.equal(records.filter(r=>r.kind==='research-clock-pool-state').length,0);assert.equal(audit.networkRequests,0);
});
