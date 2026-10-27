import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {selectActivePool,invokedCanonicalSolPools,invokedCanonicalSolSwaps,type SelectionRpc} from '../src/active-selection.js';
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
  const otherHistories=new Map<string,any[]>();
  const rowFor=(i:number,ageSeconds:number,next:typeof scope)=>{
    const result=row(i,ageSeconds),tx=txs.get(result.signature);
    const keys=new Map([[scope.mint,next.mint],[scope.pool,next.pool]]);
    const replaceBytes=(input:Buffer,old:Buffer,next:Buffer)=>{let start=0,index;while((index=input.indexOf(old,start))>=0){next.copy(input,index);start=index+32;}};
    tx.transaction.message.accountKeys=tx.transaction.message.accountKeys.map((key:string)=>keys.get(key)??key);
    for(const key of ['writable','readonly'])if(tx.meta.loadedAddresses?.[key])tx.meta.loadedAddresses[key]=tx.meta.loadedAddresses[key].map((address:string)=>keys.get(address)??address);
    for(const ix of [...tx.transaction.message.instructions,...tx.meta.innerInstructions.flatMap((g:any)=>g.instructions)])if(typeof ix.data==='string'){
      const encoded=Buffer.from(bs58.decode(ix.data));for(const [old,next] of keys)replaceBytes(encoded,new PublicKey(old).toBuffer(),new PublicKey(next).toBuffer());ix.data=bs58.encode(encoded);
    }
    return result;
  };
  const rpc:SelectionRpc={async call<T>(method:string,params:unknown[]=[]){calls.push({method,params});let result:any;
    if(method==='getSignaturesForAddress')result=params[0]===scope.pool?history:otherHistories.get(String(params[0]))??program;
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
  return {rpc,quote,records,calls,now:()=>now,row,rowFor,historyFor:(pool:string,rows:any[])=>otherHistories.set(pool,rows),program:(x:any[])=>{program=x;},history:(x:any[])=>{history=x;},quoteLag:(ms:number)=>{quoteLag=ms;},quoteWrong:()=>{quoteWrong=true;},qualityFault:()=>{qualityFault=true;},quoteCalls:()=>quoteCalls,record:(kind:string,data:unknown)=>records.push({kind,data}),advance:(ms:number)=>{now+=ms;}};
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
  const result=await selectActivePool({...f,maxCandidates:1});assert.equal(result.ok,false);if(result.ok)return;
  assert.equal(result.reason,'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN');assert.equal(f.quoteCalls(),0);assert.equal(f.calls.length,3);
});

test('null times, young baseline and projected enrichment exhaustion are explicit refusals',async()=>{
  const a=fixture();a.history([{...a.row(20,10),blockTime:null}]);const ar=await selectActivePool({...a});assert.equal(ar.ok,false);if(!ar.ok)assert.equal(ar.reason,'POOL_HISTORY_HAS_UNKNOWN_BLOCK_TIME');
  const b=fixture();b.history([b.row(10,2),b.row(11,15)]);const br=await selectActivePool({...b});assert.equal(br.ok,false);if(!br.ok)assert.equal(br.reason,'POOL_ACTIVITY_BASELINE_TOO_SHORT');
  const c=fixture();c.history([...Array.from({length:19},(_,i)=>c.row(i+10,i+1)),c.row(40,120)]);const cr=await selectActivePool({...c,enrichmentCapacity:12});assert.equal(cr.ok,false);if(!cr.ok)assert.equal(cr.reason,'SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY');assert.equal(c.quoteCalls(),0);
});

test('zero activity, unknown scoped transfer quality and insufficient genuine swaps never pass admission',async()=>{
  const empty=fixture();empty.program([]);const er=await selectActivePool({...empty});assert.equal(er.ok,false);if(!er.ok)assert.equal(er.reason,'NO_RECENT_SUCCESSFUL_PROGRAM_ACTIVITY');assert.equal(empty.calls.length,1);
  const bad=fixture();bad.qualityFault();const r=await selectActivePool({...bad});assert.equal(r.ok,false);if(!r.ok)assert.equal(r.reason,'UNVERIFIED_SCOPED_EXECUTED_TRANSFERS');assert.equal(r.evidence.rejections.every(x=>x.reason==='UNVERIFIED_SCOPED_EXECUTED_TRANSFERS'),true);assert.equal(bad.quoteCalls(),0);
  const one=fixture();one.history([one.row(1,5),one.row(3,120)]);const o=await selectActivePool({...one});assert.equal(o.ok,false);if(!o.ok)assert.equal(o.reason,'INSUFFICIENT_RECENT_POOL_ACTIVITY');assert.equal(one.quoteCalls(),0);
});

test('read cap includes quote requests, and stale or wrong-scope supported quotes refuse admission',async()=>{
  const bounded=fixture();const b=await selectActivePool({...bounded,maxReads:6});assert.equal(b.ok,false);if(!b.ok)assert.equal(b.reason,'PREFLIGHT_SUPPORT_READ_RESERVE');assert.equal(bounded.calls.length,2);
  const stale=fixture();stale.quoteLag(2001);const s=await selectActivePool({...stale});assert.equal(s.ok,false);if(!s.ok)assert.equal(s.reason,'SUPPORTED_QUOTE_STALE');
  const wrong=fixture();wrong.quoteWrong();const w=await selectActivePool({...wrong});assert.equal(w.ok,false);if(!w.ok)assert.equal(w.reason,'SUPPORTED_QUOTE_SCOPE_MISMATCH');
  const extension=fixture();const x=await selectActivePool({...extension,quote:async()=>{throw Error('UNMODELED_BASE_EXTENSION:TransferFeeConfig');}});assert.equal(x.ok,false);if(!x.ok)assert.equal(x.reason,'UNMODELED_BASE_EXTENSION:TransferFeeConfig');
});

test('preflight requires agreement of signature history and transaction context',async()=>{
  const f=fixture();const rpc:SelectionRpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){const result:any=await f.rpc.call(method,params,signal);if(method==='getTransaction')result.slot++;return result as T;}};
  const result=await selectActivePool({...f,rpc});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.reason,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');assert.equal(f.quoteCalls(),0);
});


test('one bounded pass skips a saturated distinct pool then supports a moderate pool without revisiting rejects',async()=>{
  const f=fixture(),mint=new PublicKey(Buffer.alloc(32,29)).toBase58(),next={mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58()};
  const first=f.row(1,5),repeated=f.row(2,8),a=f.rowFor(50,4,next),b=f.rowFor(51,12,next),old=f.rowFor(52,120,next);
  f.program([first,repeated,a]);f.history(Array.from({length:20},(_,i)=>f.row(i+10,i+1)));f.historyFor(next.pool,[a,b,old]);
  const result=await selectActivePool({...f});assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(result.candidate.pool,next.pool);assert.equal(result.evidence.candidateAttempts.length,2);
  assert.deepEqual(result.evidence.candidateAttempts.map(x=>x.reason),['POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN','SELECTED_CURRENT_SUPPORTED_POOL']);
  assert.equal(f.calls.filter(c=>c.method==='getSignaturesForAddress'&&c.params[0]===scope.pool).length,1);
  assert.equal(f.calls.filter(c=>c.method==='getSignaturesForAddress'&&c.params[0]===next.pool).length,1);
  assert.equal(result.evidence.decodedRecentTransactions,2);assert.equal(f.quoteCalls(),1);
});

test('distinct-candidate, exact response-byte and elapsed caps stop starts without retrying',async()=>{
  const bounded=fixture();bounded.history(Array.from({length:20},(_,i)=>bounded.row(i+10,i+1)));
  const br=await selectActivePool({...bounded,maxCandidates:1});assert.equal(br.ok,false);assert.equal(br.evidence.candidateAttempts.length,1);assert.equal(bounded.calls.length,3);
  const bytes=fixture();let consumed=0;
  const rpc:SelectionRpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){const result=await bytes.rpc.call<T>(method,params,signal);consumed+=2*1024*1024;return result;}};
  const exhausted=await selectActivePool({...bytes,rpc,maxResponseBytes:4*1024*1024,responseBytes:()=>consumed});assert.equal(exhausted.ok,false);if(!exhausted.ok)assert.equal(exhausted.reason,'PREFLIGHT_RESPONSE_BYTE_CAP');assert.equal(bytes.calls.length,2);assert.equal(exhausted.evidence.responseBytes,4*1024*1024);
  const aged=fixture();const slow:SelectionRpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){const result=await aged.rpc.call<T>(method,params,signal);aged.advance(1000);return result;}};
  const timeout=await selectActivePool({...aged,rpc:slow,maxElapsedMs:1000});assert.equal(timeout.ok,false);if(!timeout.ok)assert.equal(timeout.reason,'PREFLIGHT_ELAPSED_CAP');assert.equal(aged.calls.length,1);
  const stopped=fixture(),controller=new AbortController();controller.abort();const aborted=await selectActivePool({...stopped,signal:controller.signal});assert.equal(aborted.ok,false);if(!aborted.ok)assert.equal(aborted.reason,'PREFLIGHT_ABORTED');assert.equal(stopped.calls.length,0);
});

test('compiled swap denominator retains repeated invocations while candidate identities deduplicate',()=>{
  const tx=structuredClone(retained.transaction),swap=tx.transaction.message.instructions.find((ix:any)=>invokedCanonicalSolPools({...tx,transaction:{...tx.transaction,message:{...tx.transaction.message,instructions:[ix]}}}).length);
  assert.ok(swap);tx.transaction.message.instructions.push(structuredClone(swap));
  assert.deepEqual(invokedCanonicalSolSwaps(tx),[scope,scope]);assert.deepEqual(invokedCanonicalSolPools(tx),[scope]);
});


test('a single wider program sample stays inside explicit pass and support-call bounds',async()=>{
  const f=fixture(),result=await selectActivePool({...f,programLimit:256,maxProgramTransactions:24,maxReads:48,maxCandidates:6,maxElapsedMs:70_000,maxResponseBytes:8*1024*1024});
  assert.equal(result.ok,true);assert.equal((f.calls[0]!.params[1] as any).limit,256);assert.equal(result.evidence.maximumProgramTransactions,24);assert.equal(result.evidence.maximumReads,48);
  const bytes=fixture();await assert.rejects(selectActivePool({...bytes,programLimit:257}),/INVALID_SELECTION_BOUNDS/);assert.equal(bytes.calls.length,0);
});
