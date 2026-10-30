import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';
import {ReadOnlyRpc} from '../src/network.js';
import {quotePositionsSell} from '../src/pool.js';
import {ResearchPositionPricer} from '../src/research-pricing.js';

function fixture(){
  const run='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
  const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  const state=structuredClone(rows.find(x=>x.kind==='pool-state').data);
  let calls=0;const methods:string[]=[],records:any[]=[];
  const request={mint:new PublicKey(proof.quote.mint),fullBaseUnits:BigInt(proof.quote.buy.outputBaseUnits)*3n+1n,minSlot:proof.origin.slot};
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls++;methods.push(method);
    if(method==='getMultipleAccounts')return copy((params[0] as string[]).length===1?{context:state.context,value:[state.value[0]]}:state) as T;
    if(method==='getBlockTime')return proof.quote.marketBlockTime as T;
    throw Error('unexpected method');
  }};
  const rec={record(kind:string,data:unknown){records.push({kind,data:copy(data)});}};
  return {proof,state,request,rpc,rec,records,methods,get calls(){return calls;}};
}
const copy=<T>(x:T):T=>structuredClone(x);

test('research reuse retains exact same-byte established decoder output with fresh full dependency reads',async()=>{
  const f=fixture(),realNow=Date.now;let now=Date.parse(f.proof.quote.validatedAt);Date.now=()=>now;
  try{
    const pricer=new ResearchPositionPricer(f.rpc,f.rec);
    const baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,[f.request],{record(){}});
    assert.equal(f.calls,3);let before=f.calls;
    const first=await pricer.quote(f.request);assert.equal(f.calls-before,3);
    assert.deepEqual(first.quotes,baseline.quotes);assert.deepEqual(first.context,baseline.context);
    now+=1000;before=f.calls;const second=await pricer.quote(f.request);assert.equal(f.calls-before,1);
    const q=second.quotes[f.request.mint.toBase58()]!;
    assert.deepEqual(q.sell,baseline.quotes[f.request.mint.toBase58()]!.sell);
    assert.deepEqual(q.feeBps,baseline.quotes[f.request.mint.toBase58()]!.feeBps);
    assert.equal(q.receivedAt,new Date(now).toISOString());assert.equal(q.marketBlockTime,f.proof.quote.marketBlockTime);
    assert.equal(pricer.usage().linkCacheHits,1);assert.equal(pricer.usage().sameSlotBlockTimeHits,1);
    assert.ok(f.records.some(r=>r.kind==='research-pricing-cache-hit'&&r.data.kind==='same-slot-block-time'&&r.data.ageMs===1000));
    now+=2001;before=f.calls;await pricer.quote(f.request);assert.equal(f.calls-before,2);
    // Each cycle still reads all seven dependencies, never only vault prices.
    assert.equal(f.records.filter(r=>r.kind==='pools-state').length,3);
  }finally{Date.now=realNow;}
});

test('new slots require real block-time reads; same slot beyond2s cannot extend timestamp freshness',async()=>{
  const f=fixture(),realNow=Date.now;let now=Date.parse(f.proof.quote.validatedAt);Date.now=()=>now;
  try{
    const pricer=new ResearchPositionPricer(f.rpc,f.rec);await pricer.quote(f.request);
    f.state.context.slot++;now+=100;let before=f.calls;await pricer.quote(f.request);assert.equal(f.calls-before,2);
    now+=2001;before=f.calls;await pricer.quote(f.request);assert.equal(f.calls-before,2);
    now=Number(f.proof.quote.marketBlockTime)*1000+30_001;
    await assert.rejects(pricer.quote(f.request),/POOL_STATE_NOT_CURRENT/);
    assert.equal(pricer.usage().cachedPoolSlot,null);assert.equal(pricer.usage().cachedBlockTimeSlot,null);
    // Recovery is a subsequent explicit cycle; failure never retries internally.
    now=Date.parse(f.proof.quote.validatedAt);before=f.calls;await pricer.quote(f.request);assert.equal(f.calls-before,3);
  }finally{Date.now=realNow;}
});

test('changed vault links invalidate quote and cache; subsequent cycle rediscovers rather than retrying',async()=>{
  const f=fixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    const pricer=new ResearchPositionPricer(f.rpc,f.rec);await pricer.quote(f.request);
    const original=copy(f.state.value[0]);const bytes=Buffer.from(f.state.value[0].data[0],'base64');
    //IDL poolBaseTokenAccount begins at175, after LP mint. A synthetic link
    //change must fail the existing decoder; it is not observed market evidence.
    bytes[175]=bytes[175]!^1;f.state.value[0].data[0]=bytes.toString('base64');
    let before=f.calls;const refused=await pricer.quote(f.request);assert.equal(f.calls-before,1);
    assert.deepEqual(refused.quotes,{});assert.ok(refused.unavailable[f.request.mint.toBase58()]);assert.equal(pricer.usage().cachedPoolSlot,null);
    f.state.value[0]=original;before=f.calls;await pricer.quote(f.request);assert.equal(f.calls-before,3);
  }finally{Date.now=realNow;}
});

test('missing dependency, bad owner, unsupported mint and regressing context do not survive cache reuse',async()=>{
  for(const mutate of [(state:any)=>{state.value[6]=null;},(state:any)=>{state.value[5].owner=PublicKey.default.toBase58();},(state:any)=>{const bytes=Buffer.from(state.value[3].data[0],'base64');bytes.writeUInt16LE(14,166);state.value[3].data[0]=bytes.toString('base64');},(state:any)=>{state.context.slot=0;}]){
    const f=fixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
    try{
      const pricer=new ResearchPositionPricer(f.rpc,f.rec);await pricer.quote(f.request);mutate(f.state);
      try{const result=await pricer.quote(f.request);assert.deepEqual(result.quotes,{});}catch(error){assert.match(String(error),/REGRESSING/);}
      assert.equal(pricer.usage().cachedPoolSlot,null);assert.equal(pricer.usage().cachedBlockTimeSlot,null);
    }finally{Date.now=realNow;}
  }
});

test('explicit invalidation and increased verification slot force genuine rediscovery; cache age is bounded',async()=>{
  const f=fixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    assert.throws(()=>new ResearchPositionPricer(f.rpc,f.rec,{maxBlockTimeCacheAgeMs:2001}),/CACHE_AGE/);
    const pricer=new ResearchPositionPricer(f.rpc,f.rec);await pricer.quote(f.request);
    pricer.invalidate('isolated-disconnect');let before=f.calls;await pricer.quote(f.request);assert.equal(f.calls-before,3);
    f.state.context.slot++;before=f.calls;await pricer.quote({...f.request,minSlot:f.state.context.slot});assert.equal(f.calls-before,3);
  }finally{Date.now=realNow;}
});


test('fresh changed reserves are decoded from coherent full batch, with exact helper parity and no cached liquidation value',async()=>{
  const f=fixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    const pricer=new ResearchPositionPricer(f.rpc,f.rec),first=await pricer.quote(f.request);
    const quoteBytes=Buffer.from(f.state.value[6].data[0],'base64');
    quoteBytes.writeBigUInt64LE(quoteBytes.readBigUInt64LE(64)+10_000_000n,64);
    f.state.value[6].data[0]=quoteBytes.toString('base64');
    const changed=await pricer.quote(f.request),baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,[f.request],{record(){}}),key=f.request.mint.toBase58();
    assert.notEqual(changed.quotes[key]!.sell.outputLamports,first.quotes[key]!.sell.outputLamports);
    assert.deepEqual(changed.quotes,baseline.quotes);
  }finally{Date.now=realNow;}
});

test('invalidation preserves highest verified slot and invalid minimum slots are never silently normalized',async()=>{
  const f=fixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    const pricer=new ResearchPositionPricer(f.rpc,f.rec);await pricer.quote(f.request);
    const highest=pricer.usage().highestVerifiedSlot;pricer.invalidate('research-outage');f.state.context.slot--;
    await assert.rejects(pricer.quote(f.request),/REGRESSING_INITIAL_POOL_CONTEXT/);assert.equal(pricer.usage().highestVerifiedSlot,highest);
    let before=f.calls;await assert.rejects(pricer.quote({...f.request,minSlot:-1}),/INVALID_MINIMUM_SLOT/);assert.equal(f.calls,before);
    f.state.context.slot=highest;await pricer.quote(f.request);
  }finally{Date.now=realNow;}
});
