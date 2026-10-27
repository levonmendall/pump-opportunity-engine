import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {selectComponentPool,COMPONENT_PRIMARY_POOL} from '../src/component-selection.js';
import {invokedCanonicalSolPools} from '../src/active-selection.js';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import type {SelectionRejectionStore} from '../src/selection-rejections.js';

const retained=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope=invokedCanonicalSolPools(retained.transaction)[0]!;
// Retained real instruction/event bytes at an injected historical clock. This
// is network-free selection logic, not a new observation or fresh pool quote.
function fixture(){
  let now=retained.transaction.blockTime*1000+5000;
  const tx=structuredClone(retained.transaction),row={signature:retained.signature,slot:tx.slot,blockTime:tx.blockTime,err:null};
  const calls:Array<{method:string;params:unknown[]}>=[],records:any[]=[];
  let seedRows:any[]=[row],programRows:any[]=[row],answer=tx;
  const rpc={async call<T>(method:string,params:unknown[]=[]){calls.push({method,params});if(method==='getSignaturesForAddress')return (params[0]===PUMP_AMM_PROGRAM_ID.toBase58()?programRows:seedRows) as T;if(method==='getTransaction')return structuredClone(answer) as T;throw Error('FORBIDDEN_SELECTION_METHOD');}};
  return {now:()=>now,advance:(ms:number)=>{now+=ms;},rpc,calls,records,row,tx,seedRows:(r:any[])=>{seedRows=r;},programRows:(r:any[])=>{programRows=r;},answer:(x:any)=>{answer=x;},record:(kind:string,data:unknown)=>records.push({kind,data})};
}
const noGuard:Pick<SelectionRejectionStore,'lookup'>={lookup(){return {blocked:false,record:null,releaseReason:'no-prior-rejection'};}};
function guardFor(pool:string):Pick<SelectionRejectionStore,'lookup'>{return {lookup(s,at){return s.pool===pool?{blocked:true,record:{...s,reason:'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN',observedAt:at!-1000,expiresAt:at!+86400000,policyVersion:'retained-policy',evidenceRef:'retained-refusal',releaseCondition:'cooldown-elapsed-and-fresh-revalidation'},releaseReason:'cooldown-active'}:noGuard.lookup(s,at);}};}

test('one current actual compiled swap selects hypothetical full units without fetching support or opening transport',async()=>{
  const f=fixture(),result=await selectComponentPool({...f,seed:scope,rejectionStore:noGuard});
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(result.evidence.reads,2);assert.equal(f.calls.length,2);assert.equal(result.candidate.pool,scope.pool);
  assert.equal(result.candidate.baseUnits,'138353716808147');assert.equal(result.candidate.signature,retained.signature);
  assert.equal(result.candidate.currentSupport,'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK');assert.equal(result.candidate.entryEligibility,'UNVERIFIED_HELD_PRICING_ONLY');
  assert.equal(result.candidate.trades.length,1);assert.deepEqual(result.candidate.trades[0]!.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
  assert.ok(f.calls.every(c=>c.method==='getSignaturesForAddress'||c.method==='getTransaction'));
});

test('quiet historical seed can use exactly one bounded program page without fabricating seed activity',async()=>{
  const f=fixture();f.seedRows([]);
  const result=await selectComponentPool({...f,rejectionStore:noGuard});assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(f.calls.length,3);assert.equal(f.calls[0]!.params[0],COMPONENT_PRIMARY_POOL.pool);assert.equal(f.calls[1]!.params[0],PUMP_AMM_PROGRAM_ID.toBase58());
  assert.equal(result.candidate.pool,scope.pool);assert.ok(result.evidence.rejections.some(x=>x.reason==='NO_RECENT_SUCCESSFUL_SEED_ACTIVITY'));
});

test('persisted seed refusal skips its history; a guarded actual pool cannot become eligible',async()=>{
  const f=fixture(),guard:Pick<SelectionRejectionStore,'lookup'>={lookup(s,at){return guardFor(s.pool).lookup(s,at);}};
  const result=await selectComponentPool({...f,rejectionStore:guard});assert.equal(result.ok,false);
  assert.equal(f.calls.length,2);assert.equal(f.calls[0]!.params[0],PUMP_AMM_PROGRAM_ID.toBase58());
  assert.equal(f.calls.some(c=>c.method==='getSignaturesForAddress'&&c.params[0]===COMPONENT_PRIMARY_POOL.pool),false);
  assert.ok(result.evidence.rejections.some(x=>x.pool===scope.pool&&x.reason.startsWith('PRIOR_POOL_REJECTION_')));
});

test('address membership, failed or old transactions are not accepted as actual current swaps',async()=>{
  const f=fixture(),none=structuredClone(f.tx);none.transaction.message.instructions=[];none.meta.innerInstructions=[];f.answer(none);
  const result=await selectComponentPool({...f,seed:scope,rejectionStore:noGuard});assert.equal(result.ok,false);assert.ok(result.evidence.rejections.some(x=>x.reason==='NO_CURRENT_INVOKED_CANONICAL_SOL_SWAP'));
  const stale=fixture();stale.advance(31000);stale.programRows([]);const old=await selectComponentPool({...stale,seed:scope});assert.equal(old.ok,false);assert.equal(stale.calls.some(c=>c.method==='getTransaction'),false);
});

test('HTTP429 and source/context faults terminate without an automatic retry',async()=>{
  const f=fixture();let calls=0;const rpc={async call<T>():Promise<T>{calls++;throw Error('RESEARCH_RPC_HTTP_429');}};
  const throttled=await selectComponentPool({...f,rpc,seed:scope});assert.equal(throttled.ok,false);if(!throttled.ok)assert.equal(throttled.reason,'RESEARCH_RPC_HTTP_429');assert.equal(calls,1);
  const wrong=fixture(),tx=structuredClone(wrong.tx);tx.slot++;wrong.answer(tx);const mismatch=await selectComponentPool({...wrong,seed:scope});assert.equal(mismatch.ok,false);if(!mismatch.ok)assert.equal(mismatch.reason,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');assert.equal(wrong.calls.length,2);
});

test('the four-read cap and six-second elapsed bound leave the caller setup reserve intact',async()=>{
  const f=fixture();f.seedRows([]);
  const rows=Array.from({length:10},(_,i)=>({...f.row,signature:bs58.encode(Buffer.alloc(64,i+1))}));f.programRows(rows);
  const rpc={async call<T>(method:string,params:unknown[]=[]){if(method==='getTransaction'){const tx=structuredClone(f.tx);tx.transaction.signatures[0]=params[0];tx.transaction.message.instructions=[];tx.meta.innerInstructions=[];f.answer(tx);}return f.rpc.call<T>(method,params);}};
  const result=await selectComponentPool({...f,rpc});assert.equal(result.ok,false);assert.equal(f.calls.length,4);assert.equal(result.evidence.reads,4);
  const slow=fixture();const delayed={async call<T>(m:string,p:unknown[]=[]){const value=await slow.rpc.call<T>(m,p);slow.advance(6000);return value;}};
  const timed=await selectComponentPool({...slow,rpc:delayed,seed:scope});assert.equal(timed.ok,false);if(!timed.ok)assert.equal(timed.reason,'COMPONENT_SELECTION_ELAPSED_CAP');assert.equal(slow.calls.length,1);
});
