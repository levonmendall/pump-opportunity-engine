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

import {componentSeedFromRetainedEvidence,prepareComponentPool,type MigrationComponentSeed} from '../src/component-selection.js';
import type {SelectionRejection} from '../src/selection-rejections.js';
const proofRef='evidence/integration-proof-2026-10-26T23-32-41.255Z.json',swapRef='evidence/targeted-transaction-sample.json';
const proofBytes=readFileSync(proofRef),swapBytes=readFileSync(swapRef);
const verifiedSeed=componentSeedFromRetainedEvidence({integrationProof:{ref:proofRef,bytes:proofBytes},swapProof:{ref:swapRef,bytes:swapBytes}});
const supportPolicyVersion='pump-swap-sdk2.2.0-supported-sol-v1';
function refusal(reason:string,at:number):SelectionRejection{return {mint:verifiedSeed.mint,pool:verifiedSeed.pool,reason,observedAt:at-1000,expiresAt:at+86400000,policyVersion:supportPolicyVersion,evidenceRef:'evidence/retained-refusal.json',releaseCondition:'cooldown-elapsed-and-fresh-revalidation'};}
function migration(f:ReturnType<typeof fixture>,overrides:Partial<MigrationComponentSeed>={}):MigrationComponentSeed{return {...scope,observedAt:f.now()-1000,sourceRef:'evidence/current-observer-migration.json',...overrides};}

test('basic purpose uses retained independently verified identity with zero history reads, not fresh activity',async()=>{
  const now=retained.transaction.blockTime*1000+86400000;
  const before=Buffer.from(swapBytes),result=await prepareComponentPool({purpose:'basic-current-state',verifiedSeed,supportPolicyVersion,now:()=>now});
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(result.evidence.reads,0);assert.equal(result.evidence.maximumReads,0);assert.equal(result.evidence.pages.length,0);assert.equal(result.evidence.transactions.length,0);
  assert.equal(result.candidate.activity,'UNVERIFIED');assert.equal(result.candidate.activityVerifiedAt,null);assert.deepEqual(result.candidate.trades,[]);
  assert.equal(result.candidate.baseUnits,'25229743127804');assert.equal(result.candidate.historicalEvidence?.quoteSlot,461852043);assert.equal(result.candidate.historicalEvidence?.swapSlot,461858799);
  assert.equal(result.candidate.currentSupport,'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK');assert.match(result.candidate.quantitySelection,/Do not shrink/);assert.ok(result.candidate.requiredCurrentChecks.includes('actual hypothetical-size sell liquidity'));
  assert.deepEqual(swapBytes,before);assert.deepEqual(readFileSync(swapRef),before);
});

test('basic ignores old flow capacity and quiet guards but never hides an older structural guard',async()=>{
  const at=retained.transaction.blockTime*1000+5000,capacity=refusal('POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN',at),quiet=refusal('INSUFFICIENT_RECENT_POOL_ACTIVITY',at);
  const pass=await prepareComponentPool({purpose:'basic-current-state',verifiedSeed,supportPolicyVersion,now:()=>at,priorRejections:[capacity,quiet]});assert.equal(pass.ok,true);assert.equal(pass.evidence.ignoredPriorGuards.length,2);
  const structural=refusal('UNSUPPORTED_MINT_EXTENSION:TransferFeeConfig',at);structural.expiresAt=null;structural.releaseCondition='support-policy-version-change-and-fresh-revalidation';
  for(const guards of [[structural,capacity],[capacity,structural]]){const blocked=await prepareComponentPool({purpose:'basic-current-state',verifiedSeed,supportPolicyVersion,now:()=>at,priorRejections:guards});assert.equal(blocked.ok,false);assert.equal(blocked.evidence.reads,0);assert.ok(blocked.evidence.rejections.some(r=>r.reason.includes('UNSUPPORTED_MINT_EXTENSION')));}
});

test('global refusal still blocks both purposes; an expired structural cooldown only permits fresh support checks',async()=>{
  const f=fixture(),before=f.calls.length;
  for(const options of [{purpose:'basic-current-state' as const,verifiedSeed},{purpose:'changing-price' as const,rpc:f.rpc,migrationSeeds:[migration(f)]}]){
    const result=await prepareComponentPool({...options,supportPolicyVersion,now:f.now,globalRefusal:'RPC_HTTP_429'});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.reason,'COMPONENT_GLOBAL_REFUSAL_ACTIVE');assert.equal(result.evidence.reads,0);
  }assert.equal(f.calls.length,before);
  const old=refusal('MISSING_ACCOUNT',f.now());old.expiresAt=f.now()-1;const result=await prepareComponentPool({purpose:'basic-current-state',verifiedSeed,supportPolicyVersion,now:f.now,priorRejections:[old]});assert.equal(result.ok,true);if(result.ok)assert.equal(result.candidate.currentSupport,'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK');
});

test('retained proof helper rejects mismatched canonical identity and missing executed-transfer evidence',()=>{
  const wrong=JSON.parse(proofBytes.toString());wrong.quote.mint=COMPONENT_PRIMARY_POOL.mint;wrong.quote.pool=COMPONENT_PRIMARY_POOL.pool;
  assert.throws(()=>componentSeedFromRetainedEvidence({integrationProof:{ref:proofRef,bytes:Buffer.from(JSON.stringify(wrong))},swapProof:{ref:swapRef,bytes:swapBytes}}));
  const unsupported=JSON.parse(proofBytes.toString());unsupported.origin.creationCpiVerified=false;
  assert.throws(()=>componentSeedFromRetainedEvidence({integrationProof:{ref:proofRef,bytes:Buffer.from(JSON.stringify(unsupported))},swapProof:{ref:swapRef,bytes:swapBytes}}),/UNVERIFIED_RETAINED_ORIGIN/);
});

test('changing purpose only checks supplied migration identity and separately verifies a current actual swap',async()=>{
  const f=fixture(),seed=migration(f),result=await prepareComponentPool({purpose:'changing-price',rpc:f.rpc,migrationSeeds:[seed],supportPolicyVersion,now:f.now,record:f.record});
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(result.evidence.reads,2);assert.equal(result.candidate.activity,'CURRENT_DECODED_SWAP');assert.equal(result.candidate.activityVerifiedAt,f.now());assert.equal(result.candidate.discovery?.sourceRef,seed.sourceRef);
  assert.equal(result.candidate.historicalEvidence,null);assert.equal(result.candidate.currentSupport,'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK');assert.equal(f.calls.some(c=>c.params[0]===PUMP_AMM_PROGRAM_ID.toBase58()),false);
});

test('changing purpose requires explicit seeds; quiet activity is inconclusive and never falls back to broad program sampling',async()=>{
  const f=fixture();const empty=await prepareComponentPool({purpose:'changing-price',rpc:f.rpc,migrationSeeds:[],supportPolicyVersion,now:f.now});assert.equal(empty.ok,false);if(!empty.ok)assert.equal(empty.reason,'COMPONENT_CURRENT_MIGRATION_SEEDS_REQUIRED');assert.equal(f.calls.length,0);
  f.seedRows([]);const quiet=await prepareComponentPool({purpose:'changing-price',rpc:f.rpc,migrationSeeds:[migration(f)],supportPolicyVersion,now:f.now});assert.equal(quiet.ok,false);assert.equal(f.calls.length,1);assert.equal(quiet.evidence.pages.length,1);assert.equal(quiet.evidence.pages[0]!.address,scope.pool);
});

test('two explicit migration seeds share four reads; address mentions and quiet seeds never become current swap evidence',async()=>{
  const f=fixture(),other={...COMPONENT_PRIMARY_POOL,observedAt:f.now()-2000,sourceRef:'evidence/second-migration.json'},calls:Array<{m:string;p:unknown[]}>=[];
  const rpc={async call<T>(m:string,p:unknown[]=[]){calls.push({m,p});if(m==='getSignaturesForAddress'&&p[0]===other.pool)return [] as T;return f.rpc.call<T>(m,p);}};
  const result=await prepareComponentPool({purpose:'changing-price',rpc,migrationSeeds:[other,migration(f)],supportPolicyVersion,now:f.now});assert.equal(result.ok,true);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.p[0]!==PUMP_AMM_PROGRAM_ID.toBase58()));
  const none=fixture(),tx=structuredClone(none.tx);tx.transaction.message.instructions=[];tx.meta.innerInstructions=[];none.answer(tx);
  const noSwap=await prepareComponentPool({purpose:'changing-price',rpc:none.rpc,migrationSeeds:[migration(none)],supportPolicyVersion,now:none.now});assert.equal(noSwap.ok,false);assert.equal(noSwap.evidence.transactions.length,1);assert.equal(noSwap.evidence.rejections[0]?.reason,'NO_CURRENT_INVOKED_CANONICAL_SOL_SWAP');
});

test('purpose preparation preserves throttle refusal, elapsed bounds, cancellation and no automatic retry',async()=>{
  const f=fixture();let count=0;
  const throttled=await prepareComponentPool({purpose:'changing-price',rpc:{async call<T>():Promise<T>{count++;throw Error('RPC_HTTP_429');}},migrationSeeds:[migration(f)],supportPolicyVersion,now:f.now});assert.equal(throttled.ok,false);if(!throttled.ok)assert.equal(throttled.reason,'RPC_HTTP_429');assert.equal(count,1);
  const c=new AbortController();c.abort();const cancelled=await prepareComponentPool({purpose:'basic-current-state',verifiedSeed,supportPolicyVersion,signal:c.signal});assert.equal(cancelled.ok,false);if(!cancelled.ok)assert.equal(cancelled.reason,'COMPONENT_PREPARATION_ABORTED');
  const slow=fixture(),rpc={async call<T>(m:string,p:unknown[]=[]){const value=await slow.rpc.call<T>(m,p);slow.advance(6000);return value;}};
  const timed=await prepareComponentPool({purpose:'changing-price',rpc,migrationSeeds:[migration(slow)],supportPolicyVersion,now:slow.now});assert.equal(timed.ok,false);if(!timed.ok)assert.equal(timed.reason,'COMPONENT_PREPARATION_ELAPSED_CAP');assert.equal(slow.calls.length,1);
});

test('changing pricing ignores full-flow capacity guards but retains quiet and structural refusals',async()=>{
  for(const reason of ['POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN','SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY','POOL_ACTIVITY_BASELINE_TOO_SHORT']){
    const f=fixture(),guard=refusal(reason,f.now()),result=await prepareComponentPool({purpose:'changing-price',rpc:f.rpc,migrationSeeds:[migration(f)],supportPolicyVersion,priorRejections:[guard],now:f.now});
    assert.equal(result.ok,true,reason);assert.equal(result.evidence.reads,2);assert.equal(result.evidence.ignoredPriorGuards[0]?.reason,reason);if(result.ok)assert.equal(result.candidate.activity,'CURRENT_DECODED_SWAP');
  }
  for(const reason of ['INSUFFICIENT_RECENT_POOL_ACTIVITY','MISSING_ACCOUNT','UNSUPPORTED_MINT_EXTENSION:TransferFeeConfig']){
    const f=fixture(),result=await prepareComponentPool({purpose:'changing-price',rpc:f.rpc,migrationSeeds:[migration(f)],supportPolicyVersion,priorRejections:[refusal(reason,f.now())],now:f.now});assert.equal(result.ok,false,reason);assert.equal(f.calls.length,0);assert.equal(result.evidence.ignoredPriorGuards.length,0);
  }
});

test('hypothetical token amounts must fit the on-chain unsigned64-bit range without shrinking',async()=>{
  const invalid='18446744073709551616';
  const q=JSON.parse(proofBytes.toString());q.quote.buy.outputBaseUnits=invalid;
  assert.throws(()=>componentSeedFromRetainedEvidence({integrationProof:{ref:proofRef,bytes:Buffer.from(JSON.stringify(q))},swapProof:{ref:swapRef,bytes:swapBytes}}),/COMPONENT_INVALID_HYPOTHETICAL_QUANTITY/);
  const invalidSeed=structuredClone(verifiedSeed);invalidSeed.baseUnits=invalid;invalidSeed.historicalEvidence.hypotheticalBaseUnits=invalid;
  const rejected=await prepareComponentPool({purpose:'basic-current-state',verifiedSeed:invalidSeed,supportPolicyVersion});assert.equal(rejected.ok,false);if(!rejected.ok)assert.equal(rejected.reason,'COMPONENT_INVALID_HYPOTHETICAL_QUANTITY');assert.equal(rejected.evidence.reads,0);
});
