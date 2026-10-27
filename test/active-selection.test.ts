import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {selectActivePool,invokedCanonicalSolPools,type SelectionRpc} from '../src/active-selection.js';
import type {PositionSellQuote} from '../src/pool.js';

const retained=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const proof=JSON.parse(readFileSync('evidence/integration-proof-2026-10-26T23-32-41.255Z.json','utf8'));
const scope={mint:proof.quote.mint,pool:proof.quote.pool};
// Explicitly synthetic recency/signatures on real retained instruction/event
// bytes. This exercises selection gates, not live activity or market quotes.
function fixture(){
  let now=Date.parse(retained.fetchedAt),quoteCalls=0,quoteLag=0,quoteWrong=false,qualityFault=false;
  const calls:Array<{method:string;params:unknown[]}>=[],records:any[]=[];
  const sig=(i:number)=>bs58.encode(Buffer.alloc(64,i));
  const txs=new Map<string,any>();
  const row=(i:number,ageSeconds:number)=>{
    const tx=structuredClone(retained.transaction);tx.transaction.signatures[0]=sig(i);tx.blockTime=Math.floor(now/1000)-ageSeconds;txs.set(sig(i),tx);
    return {signature:sig(i),slot:tx.slot,err:null,blockTime:tx.blockTime,confirmationStatus:'confirmed'};
  };
  const a=row(1,5),b=row(2,15),old=row(3,120);
  let program:any[]=[a,b],history:any[]=[a,b,old];
  const rpc:SelectionRpc={async call<T>(method:string,params:unknown[]=[]){calls.push({method,params});let result:any;
    if(method==='getSignaturesForAddress')result=params[0]===scope.pool?history:program;
    else if(method==='getTransaction'){
      result=structuredClone(txs.get(String(params[0])));
      if(qualityFault&&result){const ix=result.meta.innerInstructions[0].instructions[1],raw=Buffer.from(bs58.decode(ix.data));raw.writeBigUInt64LE(raw.readBigUInt64LE(1)+1n,1);ix.data=bs58.encode(raw);}
    }else if(method==='getMultipleAccounts')result={context:{slot:retained.transaction.slot},value:[]};
    else if(method==='getBlockTime')result=Math.floor(now/1000);
    else throw Error('UNEXPECTED_FIXTURE_METHOD');
    return result as T;
  }};
  const quote=async(r:SelectionRpc,s:typeof scope,units:bigint,minSlot:number)=>{
    quoteCalls++;await r.call('getMultipleAccounts',[[s.pool],{commitment:'confirmed'}]);await r.call('getMultipleAccounts',[[s.pool,s.mint],{commitment:'confirmed'}]);await r.call('getBlockTime',[minSlot]);
    return {...proof.quote,mint:quoteWrong?'wrong':s.mint,pool:s.pool,slot:minSlot,receivedAt:new Date(now-quoteLag).toISOString(),validatedAt:new Date(now).toISOString(),sell:{inputBaseUnits:units.toString(),outputLamports:'1000000',grossCurveOutputLamports:'1010000',embeddedPoolFeeLamports:'10000'}} as PositionSellQuote;
  };
  return {rpc,quote,records,calls,now:()=>now,row,program:(x:any[])=>{program=x;},history:(x:any[])=>{history=x;},quoteLag:(ms:number)=>{quoteLag=ms;},quoteWrong:()=>{quoteWrong=true;},qualityFault:()=>{qualityFault=true;},quoteCalls:()=>quoteCalls,record:(kind:string,data:unknown)=>records.push({kind,data}),advance:(ms:number)=>{now+=ms;}};
}

test('actual compiled canonical swap is extracted; current custom quote and bare address mentions are excluded',()=>{
  assert.deepEqual(invokedCanonicalSolPools(retained.transaction),[scope]);
  const page=JSON.parse(readFileSync('evidence/free-data-20261027/public-activity-2026-10-27T02-02-18.064Z.json','utf8'));
  for(const row of page.transactions)assert.deepEqual(invokedCanonicalSolPools(row.value),[]);
});

test('two verified recent swaps and coherent support quote pass without claiming migration age or strategy evidence',async()=>{
  const f=fixture(),result=await selectActivePool({...f});assert.equal(result.ok,true);
  if(!result.ok)return;
  assert.equal(result.candidate.mint,scope.mint);assert.equal(result.candidate.baseUnits,'138353716808147');
  assert.equal(result.candidate.entryEligibility,'UNVERIFIED_HELD_PRICING_ONLY');assert.equal(result.candidate.migrationAgeVerified,false);
  assert.equal(result.evidence.decodedRecentTransactions,2);assert.equal(result.evidence.decodedSwapEvents,2);
  assert.deepEqual(result.evidence.sides,['sell']);assert.deepEqual(result.evidence.routes,['direct']);
  assert.equal(result.evidence.historyWindowCovered,true);assert.equal(result.evidence.projected90sWithHeadroom,4);
  assert.equal(result.evidence.readsAttempted,7);assert.equal(f.calls.length,7);assert.equal(f.quoteCalls(),1);
  assert.equal(f.records.filter(x=>x.kind==='selection-transaction').length,2);
});

test('a full twenty-row pool page inside the lookback refuses unknown capacity before quote or feed',async()=>{
  const f=fixture();f.history(Array.from({length:20},(_,i)=>f.row(i+10,i+1)));
  const result=await selectActivePool({...f});assert.equal(result.ok,false);if(result.ok)return;
  assert.equal(result.reason,'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN');assert.equal(f.quoteCalls(),0);assert.equal(f.calls.length,3);
});

test('null times, young baseline and projected enrichment exhaustion are explicit refusals',async()=>{
  const a=fixture();a.history([{...a.row(20,10),blockTime:null}]);const ar=await selectActivePool({...a});assert.equal(ar.ok,false);if(!ar.ok)assert.equal(ar.reason,'POOL_HISTORY_HAS_UNKNOWN_BLOCK_TIME');
  const b=fixture();b.history([b.row(10,2),b.row(11,15)]);const br=await selectActivePool({...b});assert.equal(br.ok,false);if(!br.ok)assert.equal(br.reason,'POOL_ACTIVITY_BASELINE_TOO_SHORT');
  const c=fixture();c.history([...Array.from({length:19},(_,i)=>c.row(i+10,i+1)),c.row(40,120)]);const cr=await selectActivePool({...c,enrichmentCapacity:12});assert.equal(cr.ok,false);if(!cr.ok)assert.equal(cr.reason,'SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY');assert.equal(c.quoteCalls(),0);
});

test('zero activity, unknown scoped transfer quality and insufficient genuine swaps never pass admission',async()=>{
  const empty=fixture();empty.program([]);const er=await selectActivePool({...empty});assert.equal(er.ok,false);if(!er.ok)assert.equal(er.reason,'NO_RECENT_SUCCESSFUL_PROGRAM_ACTIVITY');assert.equal(empty.calls.length,1);
  const bad=fixture();bad.qualityFault();const r=await selectActivePool({...bad});assert.equal(r.ok,false);if(!r.ok)assert.equal(r.reason,'NO_VERIFIED_CANONICAL_SOL_SWAP_IN_BOUNDED_PROGRAM_SAMPLE');assert.equal(r.evidence.rejections.every(x=>x.reason==='UNVERIFIED_SCOPED_EXECUTED_TRANSFERS'),true);assert.equal(bad.quoteCalls(),0);
  const one=fixture();one.history([one.row(1,5),one.row(3,120)]);const o=await selectActivePool({...one});assert.equal(o.ok,false);if(!o.ok)assert.equal(o.reason,'INSUFFICIENT_RECENT_POOL_ACTIVITY');assert.equal(one.quoteCalls(),0);
});

test('read cap includes quote requests, and stale or wrong-scope supported quotes refuse admission',async()=>{
  const bounded=fixture();const b=await selectActivePool({...bounded,maxReads:6});assert.equal(b.ok,false);if(!b.ok)assert.equal(b.reason,'PREFLIGHT_READ_CAP');assert.equal(bounded.calls.length,6);
  const stale=fixture();stale.quoteLag(2001);const s=await selectActivePool({...stale});assert.equal(s.ok,false);if(!s.ok)assert.equal(s.reason,'SUPPORTED_QUOTE_STALE');
  const wrong=fixture();wrong.quoteWrong();const w=await selectActivePool({...wrong});assert.equal(w.ok,false);if(!w.ok)assert.equal(w.reason,'SUPPORTED_QUOTE_SCOPE_MISMATCH');
  const extension=fixture();const x=await selectActivePool({...extension,quote:async()=>{throw Error('UNMODELED_BASE_EXTENSION:TransferFeeConfig');}});assert.equal(x.ok,false);if(!x.ok)assert.equal(x.reason,'UNMODELED_BASE_EXTENSION:TransferFeeConfig');
});

test('preflight requires agreement of signature history and transaction context',async()=>{
  const f=fixture();const rpc:SelectionRpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){const result:any=await f.rpc.call(method,params,signal);if(method==='getTransaction')result.slot++;return result as T;}};
  const result=await selectActivePool({...f,rpc});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.reason,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');assert.equal(f.quoteCalls(),0);
});
