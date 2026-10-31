import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {quotePositionsSell,quotePool,type PoolWireAccount} from '../src/pool.js';
import type {ReadOnlyRpc} from '../src/network.js';
import {ResearchClockPositionPricer,decodeResearchBankClock,RESEARCH_CLOCK_COHERENT_POOL_CAPACITY,RESEARCH_CLOCK_RPC_ACCOUNT_CAPACITY} from '../src/research-clock-pricing.js';

const copy=<T>(x:T):T=>structuredClone(x);
function fixture(){
  const run='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
  const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  const state=copy(rows.find(x=>x.kind==='pool-state').data);
  const request={mint:new PublicKey(proof.quote.mint),fullBaseUnits:BigInt(proof.quote.buy.outputBaseUnits)*3n+1n,minSlot:proof.origin.slot};
  const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(state.context.slot),0);raw.writeBigInt64LE(BigInt(proof.quote.marketBlockTime),32);
  // SYNTHETIC Clock fixture added to retained actual pool bytes. No live Clock
  // account or endpoint behavior was observed by this offline test.
  const clock:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};
  const calls:Array<{method:string;params:unknown[]}> = [],records:Array<{kind:string;data:any}>=[];
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:copy(params)});
    if(method==='getBlockTime')return proof.quote.marketBlockTime as T;
    assert.equal(method,'getMultipleAccounts');
    const addresses=params[0] as string[];
    const accounts=new Map<string,PoolWireAccount|null>(state.addresses.map((address:string,i:number)=>[address,state.value[i]??null]));accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(),clock);
    return copy({context:state.context,value:addresses.map(address=>accounts.get(address)??null)}) as T;
  }};
  const rec={record(kind:string,data:unknown){records.push({kind,data:copy(data)});}};
  const moveSlot=()=>{state.context.slot++;const b=Buffer.from(clock.data[0],'base64');b.writeBigUInt64LE(BigInt(state.context.slot));clock.data[0]=b.toString('base64');};
  return {proof,state,request,clock,rpc,rec,calls,records,moveSlot};
}
async function withTime<T>(fn:(f:ReturnType<typeof fixture>)=>Promise<T>){
  const f=fixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{return await fn(f);}finally{Date.now=realNow;}
}

test('same-batch Clock research path uses2cold/1steady reads, preserving exact established sell and fees',async()=>withTime(async f=>{
  const baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,[f.request],{record(){}}),key=f.request.mint.toBase58();
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);let before=f.calls.length;
  const first=await p.quote(f.request);assert.equal(f.calls.length-before,2);
  before=f.calls.length;const second=await p.quote(f.request);assert.equal(f.calls.length-before,1);
  for(const q of [first,second]){
    assert.deepEqual(q.sell,baseline.quotes[key]!.sell);assert.deepEqual(q.feeBps,baseline.quotes[key]!.feeBps);
    assert.equal(q.timeEvidence,'confirmed-bank-clock');assert.equal(q.clockSlot,f.state.context.slot);
    assert.equal(q.marketClockUnixSeconds,f.proof.quote.marketBlockTime);assert.equal('marketBlockTime' in q,false);
    assert.equal(q.receivedAt,new Date(Date.now()).toISOString());
  }
  assert.equal(p.usage().networkCalls,3);assert.equal(p.usage().linkCacheHits,1);
  assert.equal(f.calls.slice(3).some(x=>x.method==='getBlockTime'),false);
  assert.ok(f.records.filter(x=>x.kind==='research-clock-pool-state').every(x=>x.data.addresses.length===8));
}));

test('explicit observation admission reaches every physical read and late preparation cannot return a usable mark',async()=>withTime(async f=>{
  let open=true;const options:any[]=[];
  const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal,option?:unknown){options.push(option);return f.rpc.call<T>(method,params);}};
  const p=new ResearchClockPositionPricer(rpc,{record(kind,data){f.rec.record(kind,data);if(kind==='research-clock-position-sell-quote')open=false;}});
  const admission={latestStartAt:Date.now()+1000,admissionOpen:()=>open};
  await assert.rejects(p.quoteMany([f.request],undefined,admission),/RESEARCH_CLOCK_ADMISSION_CLOSED/);
  assert.equal(options.length,2);for(const option of options){assert.equal(option.latestStartAt,admission.latestStartAt);assert.equal(option.admissionOpen,admission.admissionOpen);}
  assert.equal(p.usage().cachedPoolSlot,null);
  const before=f.calls.length;await assert.rejects(p.quoteMany([f.request],undefined,admission),/RESEARCH_CLOCK_ADMISSION_CLOSED/);assert.equal(f.calls.length,before);
}));

test('fresh changed reserves and newer slot still get one coherent read and exactly match established math',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),first=await p.quote(f.request);
  const quote=Buffer.from(f.state.value[6].data[0],'base64');quote.writeBigUInt64LE(quote.readBigUInt64LE(64)+10_000_000n,64);f.state.value[6].data[0]=quote.toString('base64');f.moveSlot();
  const before=f.calls.length,changed=await p.quote(f.request),baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,[f.request],{record(){}}),key=f.request.mint.toBase58();
  assert.equal(f.calls.length-before,4); //1Clock read +3baseline reads
  assert.notEqual(changed.sell.outputLamports,first.sell.outputLamports);
  assert.deepEqual(changed.sell,baseline.quotes[key]!.sell);assert.deepEqual(changed.feeBps,baseline.quotes[key]!.feeBps);
  assert.equal(changed.slot,f.state.context.slot);assert.equal(changed.clockSlot,changed.slot);
}));

test('a transient failed holding read retains only validated links and recovers using one entirely fresh batch',async()=>{
  for(const code of ['PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT','PILOT_RPC_COMPONENT_HTTP_TRANSPORT','PILOT_RPC_COOLDOWN','PILOT_RPC_PHYSICAL_SLOT_OCCUPIED','PILOT_RPC_COMPONENT_ADMISSION_CLOSED'])await withTime(async f=>{
    let failure:string|null=null,attempts=0;
    const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){attempts++;if(failure){const refused=failure;failure=null;throw Error(refused);}return f.rpc.call<T>(method,params);}};
    const p=new ResearchClockPositionPricer(rpc,f.rec),first=await p.quote(f.request),links=copy(p.usage().cachedPoolSlots),quotesBefore=f.records.filter(r=>r.kind==='research-clock-position-sell-quote').length;
    failure=code;await assert.rejects(p.quote(f.request),new RegExp(code));
    assert.deepEqual(p.usage().cachedPoolSlots,links,'no contradictory pool state was obtained');
    assert.equal(f.records.filter(r=>r.kind==='research-clock-position-sell-quote').length,quotesBefore,'failure never returns or records a replacement price');
    const vault=Buffer.from(f.state.value[6].data[0],'base64');vault.writeBigUInt64LE(vault.readBigUInt64LE(64)+10_000_000n,64);f.state.value[6].data[0]=vault.toString('base64');
    const fee=Buffer.from(f.state.value[2].data[0],'base64'),tiers=fee.readUInt32LE(65);assert.ok(tiers>0&&tiers<256);for(let i=0;i<tiers;i++){const lp=69+i*40+16;fee.writeBigUInt64LE(fee.readBigUInt64LE(lp)+1n,lp);}f.state.value[2].data[0]=fee.toString('base64');f.moveSlot();
    const before=attempts,recovered=await p.quote(f.request);assert.equal(attempts-before,1,'old verified links avoid a redundant discovery read');
    const baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,[f.request],{record(){}}),name=f.request.mint.toBase58();
    assert.notEqual(recovered.sell.outputLamports,first.sell.outputLamports);assert.notDeepEqual(recovered.feeBps,first.feeBps);assert.deepEqual(recovered.sell,baseline.quotes[name]!.sell);assert.deepEqual(recovered.feeBps,baseline.quotes[name]!.feeBps);
    assert.equal(recovered.slot,f.state.context.slot);assert.equal(recovered.clockSlot,recovered.slot);
  });
});

test('cancellation after a warm read starts preserves existing address links without publishing an aborted quote',async()=>withTime(async f=>{
  let cancel:AbortController|null=null;
  const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){if(cancel){cancel.abort();signal!.throwIfAborted();}return f.rpc.call<T>(method,params);}};
  const p=new ResearchClockPositionPricer(rpc,f.rec);await p.quote(f.request);const links=copy(p.usage().cachedPoolSlots),before=f.calls.length;
  cancel=new AbortController();await assert.rejects(p.quote(f.request,cancel.signal),error=>error instanceof Error&&error.name==='AbortError');
  assert.deepEqual(p.usage().cachedPoolSlots,links);assert.equal(f.calls.length,before);
  cancel=null;await p.quote(f.request);assert.equal(f.calls.length-before,1);
}));

test('late admission closure cannot commit newly validated links or erase earlier verified links',async()=>withTime(async f=>{
  let open=true,closeOnQuote=false;
  const p=new ResearchClockPositionPricer(f.rpc,{record(kind,data){f.rec.record(kind,data);if(closeOnQuote&&kind==='research-clock-position-sell-quote')open=false;}});
  await p.quote(f.request);const prior=copy(p.usage().cachedPoolSlots);f.moveSlot();closeOnQuote=true;
  await assert.rejects(p.quoteMany([f.request],undefined,{latestStartAt:Date.now()+1000,admissionOpen:()=>open}),/RESEARCH_CLOCK_ADMISSION_CLOSED/);
  assert.deepEqual(p.usage().cachedPoolSlots,prior,'only previously committed address metadata survives');
  assert.equal(p.usage().highestVerifiedSlot,f.state.context.slot,'observed bank nonregression remains required');
  open=true;closeOnQuote=false;const before=f.calls.length,recovered=await p.quote(f.request);assert.equal(f.calls.length-before,1);assert.equal(recovered.slot,f.state.context.slot);
}));

test('malformed or unrecognized source failures still retire cached dependency links',async()=>{
  for(const fault of ['malformed-batch','PILOT_RPC_COMPONENT_HTTP_MALFORMED_JSON','unknown-source-failure'])await withTime(async f=>{
    let fail=false;
    const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){if(fail){if(fault==='malformed-batch')return {context:f.state.context,value:[]} as T;throw Error(fault);}return f.rpc.call<T>(method,params);}};
    const p=new ResearchClockPositionPricer(rpc,f.rec);await p.quote(f.request);fail=true;await assert.rejects(p.quote(f.request));assert.deepEqual(p.usage().cachedPoolSlots,{});
    fail=false;const before=f.calls.length;await p.quote(f.request);assert.equal(f.calls.length-before,2);
  });
});

test('fee-tier changes are read in the fresh dependency batch, with exact established decoder parity',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),first=await p.quote(f.request);
  const data=Buffer.from(f.state.value[2].data[0],'base64');
  // Pinned SDK2.2.0 IDL FeeConfig: discriminator8+bump1+admin32+
  // flatFees24 then vec-length4, each tier is thresholdu128+Fees(3*u64).
  const count=data.readUInt32LE(65);assert.ok(count>0&&count<256);
  for(let i=0;i<count;i++){const lp=69+i*40+16;data.writeBigUInt64LE(data.readBigUInt64LE(lp)+1n,lp);}
  f.state.value[2].data[0]=data.toString('base64');f.moveSlot();
  const changed=await p.quote(f.request),baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,[f.request],{record(){}}),key=f.request.mint.toBase58();
  assert.notDeepEqual(changed.feeBps,first.feeBps);assert.notEqual(changed.sell.outputLamports,first.sell.outputLamports);
  assert.deepEqual(changed.feeBps,baseline.quotes[key]!.feeBps);assert.deepEqual(changed.sell,baseline.quotes[key]!.sell);
}));

test('Clock refuses wrong owner, executable, encoding, layout, slot, out-of-range and stale/future timestamp',async()=>withTime(async f=>{
  assert.equal(decodeResearchBankClock(f.clock,f.state.context.slot).clockAccount,SYSVAR_CLOCK_PUBKEY.toBase58());
  const cases:Array<(c:PoolWireAccount)=>void>=[
    c=>{c.owner=PublicKey.default.toBase58();},c=>{c.executable=true;},c=>{c.data[1]='jsonParsed';},
    c=>{c.data[0]=Buffer.alloc(39).toString('base64');},
    c=>{const b=Buffer.from(c.data[0],'base64');b.writeBigUInt64LE(BigInt(f.state.context.slot+1),0);c.data[0]=b.toString('base64');},
    c=>{const b=Buffer.from(c.data[0],'base64');b.writeBigInt64LE(1n<<62n,32);c.data[0]=b.toString('base64');},
    c=>{const b=Buffer.from(c.data[0],'base64');b.writeBigInt64LE(BigInt(Math.floor(Date.now()/1000)-31),32);c.data[0]=b.toString('base64');},
    c=>{const b=Buffer.from(c.data[0],'base64');b.writeBigInt64LE(BigInt(Math.floor(Date.now()/1000)+31),32);c.data[0]=b.toString('base64');},
    c=>{const b=Buffer.from(c.data[0],'base64');b.writeBigInt64LE(BigInt(Math.floor(Date.now()/1000)+1),32);c.data[0]=b.toString('base64');},
  ];
  for(const mutate of cases){const c=copy(f.clock);mutate(c);assert.throws(()=>decodeResearchBankClock(c,f.state.context.slot),/RESEARCH_CLOCK_/);}
  assert.throws(()=>decodeResearchBankClock(null,f.state.context.slot),/RESEARCH_CLOCK_/);
}));

test('changed links fail current batch, invalidate reuse and never retry the failing quote',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.quote(f.request);
  const original=copy(f.state.value[0]);const b=Buffer.from(f.state.value[0].data[0],'base64');b[175]=b[175]!^1;f.state.value[0].data[0]=b.toString('base64');
  const before=f.calls.length;await assert.rejects(p.quote(f.request),/POOL_LINKS_CHANGED/);assert.equal(f.calls.length-before,1);assert.equal(p.usage().cachedPoolSlot,null);
  f.state.value[0]=original;const again=f.calls.length;await p.quote(f.request);assert.equal(f.calls.length-again,2);
}));

test('missing dependency, bad owner, Clock mismatch and context regression invalidate rather than price partial state',async()=>{
  for(const mutate of [(f:any)=>{f.state.value[6]=null;},(f:any)=>{f.state.value[5].owner=PublicKey.default.toBase58();},(f:any)=>{f.clock.owner=PublicKey.default.toBase58();},(f:any)=>{f.state.context.slot--; }]){
    await withTime(async f=>{
      const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.quote(f.request);const highest=p.usage().highestVerifiedSlot;mutate(f);
      const before=f.calls.length;await assert.rejects(p.quote(f.request));assert.equal(f.calls.length-before,1);assert.equal(p.usage().cachedPoolSlot,null);assert.equal(p.usage().highestVerifiedSlot,highest);
    });
  }
});

test('aborted and invalid-size quotes make no read; explicit invalidation retains nonregression floor',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);const aborted=new AbortController();aborted.abort();
  await assert.rejects(p.quote(f.request,aborted.signal));assert.equal(f.calls.length,0);
  await assert.rejects(p.quote({...f.request,fullBaseUnits:0n}),/SIZE/);assert.equal(f.calls.length,0);
  await p.quote(f.request);const floor=p.usage().highestVerifiedSlot;p.invalidate('offline-restart');f.state.context.slot--;
  const before=f.calls.length;await assert.rejects(p.quote(f.request),/REGRESSING/);assert.equal(f.calls.length-before,1);assert.equal(p.usage().highestVerifiedSlot,floor);
}));

test('slow validation or recording cannot refresh the original receive time into a fresh returned quote',async()=>{
  for(const slowKind of ['research-clock-pool-state','research-clock-position-sell-quote']){
    await withTime(async f=>{
      let now=Date.now();Date.now=()=>now;
      const rec={record(kind:string,data:unknown){f.rec.record(kind,data);if(kind===slowKind)now+=2001;}};
      const p=new ResearchClockPositionPricer(f.rpc,rec);
      await assert.rejects(p.quote(f.request),/QUOTE_AGE_AT_USE/);
      assert.equal(p.usage().cachedPoolSlot,null);
      const row=f.records.find(x=>x.kind==='research-clock-pool-state')!;
      assert.equal(Date.parse(row.data.receivedAt),Date.parse(f.proof.quote.validatedAt));
    });
  }
});

function multiFixture(){
  const runs=['2026-10-26T19-42-16.130Z','2026-10-26T19-57-35.882Z','2026-10-26T23-32-41.255Z'];
  const retained=runs.map(run=>{
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    return {proof,state:copy(rows.find(x=>x.kind==='pool-state').data)};
  });
  const slot=Math.max(...retained.map(r=>r.state.context.slot)),unix=Math.max(...retained.map(r=>r.proof.quote.marketBlockTime));
  // SYNTHETIC union/context made from three separate retained pool captures.
  // This tests batch decoding/scheduling equivalence, NOT a naturally observed
  // simultaneous three-pool bank or live Clock state. Shared configurations are
  // taken from the first capture and supplied identically to both decoders.
  const accounts=new Map<string,PoolWireAccount|null>();
  for(const r of retained)for(let i=0;i<7;i++)if(!accounts.has(r.state.addresses[i]))accounts.set(r.state.addresses[i],copy(r.state.value[i]));
  const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(unix),32);
  const clock:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};
  accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(),clock);
  const requests=retained.map(r=>({mint:new PublicKey(r.proof.quote.mint),fullBaseUnits:BigInt(r.proof.quote.buy.outputBaseUnits)*2n+1n,minSlot:r.proof.origin.slot}));
  const calls:Array<{method:string;params:unknown[]}>=[],records:Array<{kind:string;data:any}>=[];
  const context={slot};
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:copy(params)});
    if(method==='getBlockTime')return unix as T;
    assert.equal(method,'getMultipleAccounts');const addresses=params[0] as string[];
    return {context:copy(context),value:addresses.map(a=>copy(accounts.get(a)??null))} as T;
  }};
  const rec={record(kind:string,data:unknown){records.push({kind,data:copy(data)});}};
  return {retained,accounts,clock,requests,calls,records,rpc,rec,context,unix};
}
async function withMultiTime<T>(fn:(f:ReturnType<typeof multiFixture>)=>Promise<T>){
  const f=multiFixture(),realNow=Date.now;Date.now=()=>f.unix*1000+100;
  try{return await fn(f);}finally{Date.now=realNow;}
}

test('three holdings share one complete16-account Clock batch with exact established full-size quotes',async()=>withMultiTime(async f=>{
  const baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,f.requests,{record(){}});assert.equal(Object.keys(baseline.quotes).length,3);
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);let before=f.calls.length;
  const first=await p.quoteMany(f.requests);assert.equal(f.calls.length-before,2);
  before=f.calls.length;const second=await p.quoteMany(f.requests);assert.equal(f.calls.length-before,1);
  for(const result of [first,second]){
    assert.deepEqual(result.unavailable,{});assert.equal(result.context?.slot,f.context.slot);
    for(const r of f.requests){const name=r.mint.toBase58(),quote=result.quotes[name]!;
      assert.deepEqual(quote.sell,baseline.quotes[name]!.sell);assert.deepEqual(quote.feeBps,baseline.quotes[name]!.feeBps);
      assert.equal(quote.sell.inputBaseUnits,r.fullBaseUnits.toString());assert.equal(quote.slot,result.context!.slot);assert.equal(quote.clockSlot,quote.slot);
      assert.equal(quote.receivedAt,result.context!.receivedAt);assert.equal('marketBlockTime' in quote,false);
    }
  }
  const batches=f.records.filter(r=>r.kind==='research-clock-pool-state');assert.equal(batches.length,2);
  assert.ok(batches.every(r=>r.data.addresses.length===16&&new Set(r.data.addresses).size===16));
  assert.equal(p.usage().networkCalls,3);assert.equal(p.usage().linkCacheHits,3);
  assert.equal(Object.keys(p.usage().cachedPoolSlots).length,3);
}));

test('one missing holding dependency is isolated, while other holdings retain coherent quotes and reusable links',async()=>withMultiTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.quoteMany(f.requests);
  const name=f.requests[0]!.mint.toBase58(),vault=f.retained[0]!.state.addresses[6],saved=copy(f.accounts.get(vault));f.accounts.set(vault,null);
  const before=f.calls.length,result=await p.quoteMany(f.requests);assert.equal(f.calls.length-before,1);
  assert.equal(result.quotes[name],undefined);assert.equal(result.unavailable[name],'MISSING_ACCOUNT');assert.equal(Object.keys(result.quotes).length,2);
  assert.equal(Object.keys(p.usage().cachedPoolSlots).length,2);assert.ok(!Object.hasOwn(p.usage().cachedPoolSlots,name));
  assert.ok(Object.values(result.quotes).every(q=>q.slot===result.context!.slot&&q.receivedAt===result.context!.receivedAt));
  f.accounts.set(vault,saved??null);const again=f.calls.length,recovered=await p.quoteMany(f.requests);assert.equal(f.calls.length-again,2);
  assert.equal(Object.keys(recovered.quotes).length,3);assert.deepEqual(recovered.unavailable,{});
}));

test('one changed pool link cannot borrow old vault data or invalidate unaffected holding quotes',async()=>withMultiTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.quoteMany(f.requests);
  const pool=f.retained[0]!.state.addresses[0],original=copy(f.accounts.get(pool))!;
  const changed=copy(original),data=Buffer.from(changed.data[0],'base64');data[175]=data[175]!^1;changed.data[0]=data.toString('base64');f.accounts.set(pool,changed);
  const before=f.calls.length,result=await p.quoteMany(f.requests);assert.equal(f.calls.length-before,1);
  const name=f.requests[0]!.mint.toBase58();assert.equal(result.unavailable[name],'POOL_LINKS_CHANGED');assert.equal(result.quotes[name],undefined);assert.equal(Object.keys(result.quotes).length,2);
  assert.equal(Object.keys(p.usage().cachedPoolSlots).length,2);
  f.accounts.set(pool,original);const next=f.calls.length;await p.quoteMany(f.requests);assert.equal(f.calls.length-next,2);
}));

test('two held pools stay warm after a transport failure while a later contradictory pool remains isolated',async()=>withMultiTime(async f=>{
  let fail=false;
  const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){if(fail){fail=false;throw Error('PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT');}return f.rpc.call<T>(method,params);}};
  const held=f.requests.slice(0,2),p=new ResearchClockPositionPricer(rpc,f.rec);await p.quoteMany(held);const links=copy(p.usage().cachedPoolSlots);
  fail=true;await assert.rejects(p.quoteMany(held),/PHYSICAL_TIMEOUT/);assert.deepEqual(p.usage().cachedPoolSlots,links);
  const pool=f.retained[0]!.state.addresses[0],original=copy(f.accounts.get(pool))!,changed=copy(original),data=Buffer.from(changed.data[0],'base64');data[175]=data[175]!^1;changed.data[0]=data.toString('base64');f.accounts.set(pool,changed);
  const before=f.calls.length,result=await p.quoteMany(held),bad=held[0]!.mint.toBase58(),good=held[1]!.mint.toBase58();assert.equal(f.calls.length-before,1);
  assert.equal(result.unavailable[bad],'POOL_LINKS_CHANGED');assert.equal(result.quotes[bad],undefined);assert.ok(result.quotes[good]);assert.deepEqual(Object.keys(p.usage().cachedPoolSlots),[good]);
  f.accounts.set(pool,original);const again=f.calls.length,recovered=await p.quoteMany(held);assert.equal(f.calls.length-again,2);assert.deepEqual(recovered.unavailable,{});assert.equal(Object.keys(recovered.quotes).length,2);
}));

test('common Clock or context faults invalidate every cached holding without losing verified slot floors',async()=>{
  for(const fault of ['clock','context'])await withMultiTime(async f=>{
    const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.quoteMany(f.requests);const floors=copy(p.usage().highestHoldingSlots),highest=p.usage().highestVerifiedSlot;
    if(fault==='clock')f.clock.owner=PublicKey.default.toBase58();else f.context.slot--;
    const before=f.calls.length;await assert.rejects(p.quoteMany(f.requests),/RESEARCH_CLOCK_/);assert.equal(f.calls.length-before,1);
    assert.deepEqual(p.usage().cachedPoolSlots,{});assert.deepEqual(p.usage().highestHoldingSlots,floors);assert.equal(p.usage().highestVerifiedSlot,highest);
  });
});

test('missing discovery pool is isolated before dependency union and no duplicate/capacity request can start',async()=>withMultiTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),pool=f.retained[0]!.state.addresses[0];f.accounts.set(pool,null);
  const result=await p.quoteMany(f.requests);assert.equal(f.calls.length,2);assert.equal(Object.keys(result.quotes).length,2);
  assert.equal(result.unavailable[f.requests[0]!.mint.toBase58()],'BAD_POOL_OWNER');
  assert.equal((f.calls[1]!.params[0] as string[]).length,12);
  const before=f.calls.length;
  await assert.rejects(p.quoteMany([]),/POSITION_BATCH_CAPACITY/);
  await assert.rejects(p.quoteMany([...f.requests,f.requests[0]!] ),/DUPLICATE_POSITION_MINT/);
  await assert.rejects(p.quoteMany([f.requests[1]!,f.requests[1]!] ),/DUPLICATE_POSITION_MINT/);
  assert.equal(f.calls.length,before);
}));

test('an all-unavailable newer bank still prevents recovery from an older favorable snapshot',async()=>withMultiTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.quoteMany(f.requests);
  const saved=f.retained.map(r=>({address:r.state.addresses[6] as string,wire:copy(f.accounts.get(r.state.addresses[6]))}));
  f.context.slot++;const b=Buffer.from(f.clock.data[0],'base64');b.writeBigUInt64LE(BigInt(f.context.slot));f.clock.data[0]=b.toString('base64');
  for(const entry of saved)f.accounts.set(entry.address,null);
  const unavailable=await p.quoteMany(f.requests);assert.deepEqual(unavailable.quotes,{});assert.equal(Object.keys(unavailable.unavailable).length,3);
  assert.equal(p.usage().highestVerifiedSlot,f.context.slot);
  for(const entry of saved)f.accounts.set(entry.address,entry.wire??null);
  f.context.slot--;await assert.rejects(p.quoteMany(f.requests),/REGRESSING/);
}));

test('bank source-age is rechecked at return even when the batch itself remains within two seconds',async()=>withTime(async f=>{
  let now=f.proof.quote.marketBlockTime*1000+29_500;Date.now=()=>now;
  const rec={record(kind:string,data:unknown){f.rec.record(kind,data);if(kind==='research-clock-position-sell-quote')now+=600;}};
  const p=new ResearchClockPositionPricer(f.rpc,rec);
  await assert.rejects(p.quote(f.request),/RESEARCH_CLOCK_NOT_CURRENT_WITHIN_30_SECONDS/);
  assert.equal(p.usage().cachedPoolSlot,null);
}));

test('unsupported mint extensions keep the exact refusal and isolate the affected holding',async()=>withMultiTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.quoteMany(f.requests);
  const mint=f.retained[0]!.state.addresses[3],wire=copy(f.accounts.get(mint))!,raw=Buffer.from(wire.data[0],'base64');
  // Explicit synthetic TLV type mutation, not an observed token change.
  raw.writeUInt16LE(1,166);wire.data[0]=raw.toString('base64');f.accounts.set(mint,wire);
  const result=await p.quoteMany(f.requests),name=f.requests[0]!.mint.toBase58();
  assert.equal(result.unavailable[name],'UNMODELED_BASE_EXTENSION:TransferFeeConfig');assert.equal(Object.keys(result.quotes).length,2);
  await assert.rejects(p.quote(f.requests[0]!),/UNMODELED_BASE_EXTENSION:TransferFeeConfig/);
}));

/** Six real historical pool captures combined into an explicitly SYNTHETIC
 * common bank/context/config/Clock. This proves decoder/batching behavior only. */
function observationFixture(){
  const sources=['evidence/integration-2026-10-26T19-42-16.130Z.ndjson','evidence/integration-2026-10-26T19-57-35.882Z.ndjson','evidence/integration-2026-10-26T23-32-41.255Z.ndjson','evidence/high-activity-20261028/native-flow-20261028004053347/events.ndjson','evidence/high-activity-20261028/native-flow-20261028012322144/events.ndjson','evidence/free-data-20261027/discovery/evidence/integration-2026-10-27T01-15-44.429Z.ndjson'];
  const states=sources.map(path=>{const rows=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));return copy(rows.find(r=>r.kind==='pool-state').data);});
  const slot=Math.max(...states.map(s=>s.context.slot)),unix=Math.floor(Math.max(...states.map(s=>Date.parse(s.receivedAt)))/1000),accounts=new Map<string,PoolWireAccount|null>();
  for(const s of states)for(let i=0;i<7;i++)if(!accounts.has(s.addresses[i]))accounts.set(s.addresses[i],copy(s.value[i]));
  const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(unix),32);const clock:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(),clock);
  const requests=states.map(s=>({mint:new PublicKey(s.addresses[3]),minSlot:s.context.slot}));assert.equal(new Set(requests.map(r=>r.mint.toBase58())).size,6);
  const context={slot},calls:Array<{method:string;params:unknown[]}>=[],records:Array<{kind:string;data:any}>=[],rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push({method,params:copy(params)});assert.equal(method,'getMultipleAccounts');const addresses=params[0] as string[];return {context:copy(context),value:addresses.map(a=>copy(accounts.get(a)??null))} as T;}},rec={record(kind:string,data:unknown){records.push({kind,data:copy(data)});}};
  return {states,accounts,clock,context,requests,calls,records,rpc,rec,unix};
}
async function withObservationTime<T>(fn:(f:ReturnType<typeof observationFixture>)=>Promise<T>){const f=observationFixture(),realNow=Date.now;Date.now=()=>f.unix*1000+100;try{return await fn(f);}finally{Date.now=realNow;}}

test('one and four cold observation pools each use one RPC with the same total requested accounts as two-read discovery',async()=>{
  for(const count of [1,4])await withObservationTime(async f=>{
    const p=new ResearchClockPositionPricer(f.rpc,f.rec),selected=f.requests.slice(0,count),cold=await p.validateMany(selected);
    assert.deepEqual(cold.unavailable,{});assert.equal(Object.keys(cold.validations).length,count);assert.equal(f.calls.length,1);
    const keys=f.calls[0]!.params[0]as string[];assert.equal(keys.length,count+(4*count+4));assert.equal(keys.length,count===1?9:24);assert.equal(new Set(keys).size,keys.length);
    for(const request of selected){const pool=canonicalPumpPoolPda(request.mint);for(const program of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID])assert.ok(keys.includes(getAssociatedTokenAddressSync(request.mint,pool,true,program).toBase58()));assert.ok(keys.includes(getAssociatedTokenAddressSync(NATIVE_MINT,pool,true,TOKEN_PROGRAM_ID).toBase58()));}
    assert.ok(keys.includes(SYSVAR_CLOCK_PUBKEY.toBase58()));assert.equal(p.usage().canonicalObservation.freshValidatedPools,count);assert.equal(p.usage().canonicalObservation.discoveryRequestsAvoided,1);
    const warm=await p.validateMany(selected);assert.deepEqual(warm.unavailable,{});assert.equal(f.calls.length,2);assert.equal((f.calls[1]!.params[0]as string[]).length,4*count+4,'warm links omit unused alternate vaults, but never the current actual account');
    assert.equal(f.calls.every(call=>call.method==='getMultipleAccounts'),true);
  });
});

test('cold support selects canonical legacy and Token2022 vaults from each fresh mint owner in a mixed hinted cohort',async()=>withObservationTime(async f=>{
  // OFFLINE synthetic legacy conversion of retained Token2022 bytes. This is
  // layout/owner/ATA validation coverage, not an observed token-program change.
  const request=f.requests[0]!,state=f.states[0]!,pool=canonicalPumpPoolPda(request.mint),legacyVault=getAssociatedTokenAddressSync(request.mint,pool,true,TOKEN_PROGRAM_ID).toBase58(),oldVault=state.addresses[5]as string;
  const poolWire=copy(f.accounts.get(state.addresses[0]))!,poolRaw=Buffer.from(poolWire.data[0],'base64');assert.equal(poolRaw.subarray(139,171).toString('hex'),new PublicKey(oldVault).toBuffer().toString('hex'));new PublicKey(legacyVault).toBuffer().copy(poolRaw,139);poolWire.data[0]=poolRaw.toString('base64');f.accounts.set(state.addresses[0],poolWire);
  const mint=copy(f.accounts.get(request.mint.toBase58()))!;mint.owner=TOKEN_PROGRAM_ID.toBase58();mint.data[0]=Buffer.from(mint.data[0],'base64').subarray(0,82).toString('base64');f.accounts.set(request.mint.toBase58(),mint);
  const base=copy(f.accounts.get(oldVault))!;base.owner=TOKEN_PROGRAM_ID.toBase58();base.data[0]=Buffer.from(base.data[0],'base64').subarray(0,165).toString('base64');f.accounts.set(legacyVault,base);f.accounts.set(oldVault,{...copy(base),owner:PublicKey.default.toBase58()});
  const selected=f.requests.slice(0,4).map((r,i)=>i>=2?{...r,dependencyHints:{baseVault:f.states[i]!.addresses[5],quoteVault:f.states[i]!.addresses[6]}}:r),p=new ResearchClockPositionPricer(f.rpc,f.rec),supported=await p.validateMany(selected);
  assert.deepEqual(supported.unavailable,{});assert.equal(Object.keys(supported.validations).length,4);assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[0]as string[]).length,22,'two real hints omit two alternate base vault accounts');
  assert.equal(supported.validations[request.mint.toBase58()]!.summary.tokenProgram,TOKEN_PROGRAM_ID.toBase58());assert.equal(supported.validations[request.mint.toBase58()]!.summary.baseAssociatedAccount.accountLengthBytes,165);
  assert.equal(supported.validations[f.requests[1]!.mint.toBase58()]!.summary.tokenProgram,TOKEN_2022_PROGRAM_ID.toBase58());assert.equal(p.usage().canonicalObservation.freshValidatedPools,2);assert.equal(p.usage().dependencyHints.freshValidatedPools,2);
}));

test('cold observation isolates missing pool or mint, unsupported current owner, missing actual vault and noncanonical pool links',async()=>{
  for(const fault of ['missing-pool','pool-owner','missing-mint','mint-owner','missing-actual-vault','pool-links'])await withObservationTime(async f=>{
    const request=f.requests[0]!,state=f.states[0]!,name=request.mint.toBase58();
    if(fault==='missing-pool')f.accounts.set(state.addresses[0],null);
    if(fault==='pool-owner')f.accounts.get(state.addresses[0])!.owner=PublicKey.default.toBase58();
    if(fault==='missing-mint')f.accounts.set(name,null);
    if(fault==='mint-owner')f.accounts.get(name)!.owner=PublicKey.default.toBase58();
    if(fault==='missing-actual-vault'){const original=copy(f.accounts.get(state.addresses[5]))!;f.accounts.set(state.addresses[5],null);const alternate=getAssociatedTokenAddressSync(request.mint,canonicalPumpPoolPda(request.mint),true,TOKEN_PROGRAM_ID);assert.notEqual(alternate.toBase58(),state.addresses[5]);f.accounts.set(alternate.toBase58(),original);}
    if(fault==='pool-links'){const wire=f.accounts.get(state.addresses[0])!,raw=Buffer.from(wire.data[0],'base64');raw[139]=raw[139]!^1;wire.data[0]=raw.toString('base64');}
    const p=new ResearchClockPositionPricer(f.rpc,f.rec),result=await p.validateMany(f.requests.slice(0,4));assert.equal(f.calls.length,1,'invalid state never triggers an inline retry or a discovery call');assert.equal(result.validations[name],undefined);assert.equal(Object.keys(result.validations).length,3);assert.equal(Object.hasOwn(p.usage().cachedPoolSlots,name),false);
    assert.equal(result.unavailable[name],fault==='missing-pool'||fault==='pool-owner'?'BAD_POOL_OWNER':fault==='mint-owner'?'UNSUPPORTED_TOKEN_PROGRAM':fault==='pool-links'?'BAD_VAULT_ADDRESS':'MISSING_ACCOUNT');
  });
});

test('six distinct observation pools use1cold/1steady shared Clock read without hypothetical trading quotes',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),cold=await p.validateMany(f.requests);assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[0] as string[]).length,34,'same total account slots as the previous6+28 two-read path');
  const before=f.calls.length,steady=await p.validateMany(f.requests);assert.equal(f.calls.length-before,1);assert.equal((f.calls.at(-1)!.params[0] as string[]).length,28);
  for(const result of [cold,steady]){assert.deepEqual(result.unavailable,{});assert.equal(Object.keys(result.validations).length,6);for(const r of f.requests){const support=result.validations[r.mint.toBase58()]!;assert.equal(support.sourceSlot,f.context.slot);assert.equal(support.summary.clockSlot,f.context.slot);assert.equal(support.summary.receivedAt,result.context!.receivedAt);assert.equal(support.at,Date.now());assert.match(support.evidence,/^research-clock-observation-support:[a-f0-9]{64}$/);assert.equal(Object.hasOwn(support.summary,'sell'),false);assert.equal(Object.hasOwn(support.summary,'buy'),false);}}
  assert.equal(f.records.some(r=>r.kind==='research-clock-position-sell-quote'),false);assert.equal(p.usage().cachePoolCapacity,RESEARCH_CLOCK_COHERENT_POOL_CAPACITY+7);assert.equal(p.usage().dependencyAccountCapacity,RESEARCH_CLOCK_RPC_ACCOUNT_CAPACITY);
}));

test('observation support does not depend on whether a one-base-unit hypothetical sell produces output',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await assert.rejects(p.quote({...f.request,fullBaseUnits:1n}),/ZERO_POSITION_SELL_OUTPUT/);const result=await p.validateMany([{mint:f.request.mint,minSlot:f.request.minSlot}]);assert.equal(Object.keys(result.validations).length,1);assert.deepEqual(result.unavailable,{});
}));

test('alternating six observation pools and three holdings preserves shared links without pruning other observation identities',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.validateMany(f.requests);const holdings=f.requests.slice(0,3).map(r=>({...r,fullBaseUnits:1_000_000_000n}));let before=f.calls.length;const quoted=await p.quoteMany(holdings);assert.equal(f.calls.length-before,1);assert.equal(Object.keys(quoted.quotes).length,3);assert.equal(Object.keys(p.usage().cachedPoolSlots).length,6);
  before=f.calls.length;const supported=await p.validateMany(f.requests);assert.equal(f.calls.length-before,1);assert.equal(Object.keys(supported.validations).length,6);assert.equal(Object.keys(p.usage().highestHoldingSlots).length,3);assert.equal(Object.keys(p.usage().highestObservationSlots).length,6);
  before=f.calls.length;await assert.rejects(p.quoteMany([...holdings,holdings[0]!] ),/DUPLICATE_POSITION_MINT/);assert.equal(f.calls.length,before);
}));

test('observation changed links and missing vaults isolate affected pools and rediscover links in one recovery batch',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.validateMany(f.requests);const pool=f.states[0]!.addresses[0],original=copy(f.accounts.get(pool))!,changed=copy(original),data=Buffer.from(changed.data[0],'base64');data[175]=data[175]!^1;changed.data[0]=data.toString('base64');f.accounts.set(pool,changed);const vault=f.states[1]!.addresses[6],oldVault=copy(f.accounts.get(vault));f.accounts.set(vault,null);
  let before=f.calls.length;const failed=await p.validateMany(f.requests);assert.equal(f.calls.length-before,1);assert.equal(failed.unavailable[f.requests[0]!.mint.toBase58()],'POOL_LINKS_CHANGED');assert.equal(failed.unavailable[f.requests[1]!.mint.toBase58()],'MISSING_ACCOUNT');assert.equal(Object.keys(failed.validations).length,4);assert.equal(Object.keys(p.usage().cachedPoolSlots).length,4);
  f.accounts.set(pool,original);f.accounts.set(vault,oldVault??null);before=f.calls.length;const recovered=await p.validateMany(f.requests);assert.equal(f.calls.length-before,1);assert.equal((f.calls[before]!.params[0] as string[]).length,30,'only the two cold pools add alternate canonical base vaults');assert.equal(Object.keys(recovered.validations).length,6);
}));

test('observation common Clock/source/slot faults and slow recording refuse the whole batch without refreshing timestamps',async()=>{
  for(const fault of ['clock','slot','age','recording'])await withObservationTime(async f=>{let now=Date.now();Date.now=()=>now;const rec={record(kind:string,data:unknown){f.rec.record(kind,data);if(fault==='recording'&&kind==='research-clock-observation-support')now+=400;}};const p=new ResearchClockPositionPricer(f.rpc,rec);
    if(fault==='recording'){await assert.rejects(p.validateMany(f.requests),/SUPPORT_AGE_AT_USE/);assert.deepEqual(p.usage().cachedPoolSlots,{});return;}
    await p.validateMany(f.requests);const floors=copy(p.usage().highestObservationSlots),highest=p.usage().highestVerifiedSlot;if(fault==='clock')f.clock.owner=PublicKey.default.toBase58();if(fault==='slot')f.context.slot--;if(fault==='age')now+=31000;
    await assert.rejects(p.validateMany(f.requests),/RESEARCH_CLOCK_/);assert.deepEqual(p.usage().cachedPoolSlots,{});assert.deepEqual(p.usage().highestObservationSlots,floors);assert.equal(p.usage().highestVerifiedSlot,highest);
  });
});

test('observation invalid cardinality, duplicate identities, minimum slots, aborts and closed admission make no request',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await assert.rejects(p.validateMany([]),/OBSERVATION_BATCH_CAPACITY/);await assert.rejects(p.validateMany([...f.requests,f.requests[0]!] ),/OBSERVATION_BATCH_CAPACITY/);await assert.rejects(p.validateMany([f.requests[0]!,f.requests[0]!] ),/DUPLICATE_OBSERVATION_MINT/);await assert.rejects(p.validateMany([{...f.requests[0]!,minSlot:-1}]),/INVALID_MINIMUM_SLOT/);const aborted=new AbortController();aborted.abort();await assert.rejects(p.validateMany(f.requests,aborted.signal));await assert.rejects(p.validateMany(f.requests,undefined,{latestStartAt:Date.now()+1,admissionOpen:()=>false}),/ADMISSION_CLOSED/);assert.equal(f.calls.length,0);
}));

test('an observation refusal before source admission does not evict validated held dependency links',async()=>withObservationTime(async f=>{const p=new ResearchClockPositionPricer(f.rpc,f.rec),held=f.requests.slice(0,3).map(r=>({...r,fullBaseUnits:1_000_000_000n}));await p.validateMany(f.requests);await p.quoteMany(held);const before=f.calls.length,cache=copy(p.usage().cachedPoolSlots);await assert.rejects(p.validateMany(f.requests,undefined,{latestStartAt:Date.now()+1000,admissionOpen:()=>false}),/ADMISSION_CLOSED/);assert.equal(f.calls.length,before);assert.deepEqual(p.usage().cachedPoolSlots,cache);await p.quoteMany(held);assert.equal(f.calls.length-before,1);}));


test('coherent actual-input buy preserves retained SDK amounts and fees with2cold/1warm reads',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),request={mint:f.request.mint,buyLamports:BigInt(f.proof.quote.buy.inputLamports),minSlot:f.request.minSlot};
  let before=f.calls.length;const first=await p.quoteBuy(request);assert.equal(f.calls.length-before,2);
  before=f.calls.length;const second=await p.quoteBuy(request);assert.equal(f.calls.length-before,1);
  const initialLegacy=await quotePool(f.rpc as ReadOnlyRpc,request.mint,request.buyLamports,f.rec,request.minSlot);
  for(const q of[first,second]){assert.deepEqual(q.buy,f.proof.quote.buy);assert.deepEqual(q.correspondingSell,f.proof.quote.correspondingSell);assert.deepEqual(q.feeBps,f.proof.quote.feeBps);assert.deepEqual(q.embeddedCosts,initialLegacy.embeddedCosts);assert.equal(q.timeEvidence,'confirmed-bank-clock');assert.equal(q.clockSlot,q.slot);assert.equal('marketBlockTime'in q,false);}
  const reserve=Buffer.from(f.state.value[6].data[0],'base64');reserve.writeBigUInt64LE(reserve.readBigUInt64LE(64)+10000000n,64);f.state.value[6].data[0]=reserve.toString('base64');f.moveSlot();
  const changed=await p.quoteBuy(request),legacy=await quotePool(f.rpc as ReadOnlyRpc,request.mint,request.buyLamports,f.rec,request.minSlot);
  assert.notEqual(changed.buy.outputBaseUnits,first.buy.outputBaseUnits);assert.deepEqual(changed.buy,legacy.buy);assert.deepEqual(changed.embeddedCosts,legacy.embeddedCosts);
  const size=await p.quoteBuy({...request,buyLamports:50000000n});assert.equal(size.buy.inputLamports,'50000000');assert.notEqual(size.buy.outputBaseUnits,changed.buy.outputBaseUnits);
}));

test('buy admission, aborts, invalid amounts and unsupported state refuse without partial success',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),request={mint:f.request.mint,buyLamports:10000000n,minSlot:f.request.minSlot};
  for(const buyLamports of[0n,-1n,1n<<64n])await assert.rejects(p.quoteBuy({...request,buyLamports}),/SIZE_OUT_OF_RANGE/);
  const controller=new AbortController();controller.abort();await assert.rejects(p.quoteBuy(request,controller.signal));
  await assert.rejects(p.quoteBuy(request,undefined,{latestStartAt:Date.now()+1000,admissionOpen:()=>false}),/ADMISSION_CLOSED/);assert.equal(f.calls.length,0);
  await p.quoteBuy(request);f.state.value[5].owner=PublicKey.default.toBase58();
  await assert.rejects(p.quoteBuy(request));assert.deepEqual(p.usage().cachedPoolSlots,{});
}));

test('positive tiny buys use exact SDK validity instead of an arbitrary ten-lamport floor',async()=>withTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),request={mint:f.request.mint,buyLamports:10n,minSlot:f.request.minSlot};
  const current=await p.quoteBuy(request),legacy=await quotePool(f.rpc as ReadOnlyRpc,request.mint,request.buyLamports,f.rec,request.minSlot);
  assert.equal(current.buy.inputLamports,'10');assert.ok(BigInt(current.buy.outputBaseUnits)>0n);assert.deepEqual(current.buy,legacy.buy);assert.deepEqual(current.correspondingSell,legacy.correspondingSell);
  // A positive input can still be genuine SDK dust; removing a trading floor
  // must not turn zero output or invalid curve arithmetic into a quote.
  await assert.rejects(p.quoteBuy({...request,buyLamports:1n}));
}));

test('buy validation retains the original receive time through slow recording and bank expiry',async()=>withTime(async f=>{
  let now=Date.now();Date.now=()=>now;
  const p=new ResearchClockPositionPricer(f.rpc,{record(kind,data){f.rec.record(kind,data);if(kind==='research-clock-buy-quote')now+=2001;}});
  await assert.rejects(p.quoteBuy({mint:f.request.mint,buyLamports:10000000n}),/QUOTE_AGE_AT_USE/);assert.deepEqual(p.usage().cachedPoolSlots,{});
  const fresh=new ResearchClockPositionPricer(f.rpc,f.rec);now+=30001;
  await assert.rejects(fresh.quoteBuy({mint:f.request.mint,buyLamports:10000000n}),/NOT_CURRENT_WITHIN_30_SECONDS/);
}));

test('alternating buys, three held quotes and six observations preserves their existing dependency working sets',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec),held=f.requests.slice(0,3).map(r=>({...r,fullBaseUnits:1000000000n})),buy={...f.requests[4]!,buyLamports:10000000n};
  await p.validateMany(f.requests);let before=f.calls.length;await p.quoteMany(held);assert.equal(f.calls.length-before,1);
  for(let i=0;i<3;i++){before=f.calls.length;await p.quoteBuy(buy);await p.quoteMany(held);await p.validateMany(f.requests);assert.equal(f.calls.length-before,3);assert.equal(Object.keys(p.usage().cachedPoolSlots).length,6);assert.equal(Object.keys(p.usage().highestHoldingSlots).length,3);assert.equal(Object.keys(p.usage().highestObservationSlots).length,6);assert.equal(Object.keys(p.usage().highestBuySlots).length,1);}
  for(const r of f.requests)await p.quoteBuy({...r,buyLamports:10000000n});assert.equal(Object.keys(p.usage().highestBuySlots).length,1);assert.ok(Object.keys(p.usage().cachedPoolSlots).length<=RESEARCH_CLOCK_COHERENT_POOL_CAPACITY+7);
}));


test('an unavailable optional buy does not discard independently owned held and observation links',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);await p.validateMany(f.requests);
  // Explicitly unsupported additional held fixtures exercise retained ownership
  // and cache bounds; no valid protection quote is claimed for these identities.
  const missing=[221,222,223].map(n=>({mint:new PublicKey(Buffer.alloc(32,n)),fullBaseUnits:1000000000n}));
  const unavailable=await p.quoteMany(missing);assert.equal(Object.keys(unavailable.unavailable).length,3);
  const buy={...f.requests[0]!,buyLamports:10000000n};await p.quoteBuy(buy);
  const before=f.calls.length,cache=copy(p.usage().cachedPoolSlots),heldSlots=copy(p.usage().highestHoldingSlots),observationSlots=copy(p.usage().highestObservationSlots);
  await assert.rejects(p.quoteBuy({mint:new PublicKey(Buffer.alloc(32,224)),buyLamports:10000000n}),/BAD_POOL_OWNER/);
  assert.equal(f.calls.length,before+1);assert.deepEqual(p.usage().cachedPoolSlots,cache);assert.deepEqual(p.usage().highestHoldingSlots,heldSlots);assert.deepEqual(p.usage().highestObservationSlots,observationSlots);
  const supported=await p.validateMany(f.requests);assert.equal(Object.keys(supported.validations).length,6);assert.equal(f.calls.length-before,2);assert.ok(Object.keys(p.usage().cachedPoolSlots).length<=RESEARCH_CLOCK_COHERENT_POOL_CAPACITY+7);
}));


test('four through six held pools retain coherent exact-size pricing without the obsolete three-position gate',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);
  for(const count of [4,6]){
    const requests=f.requests.slice(0,count).map(r=>({...r,fullBaseUnits:1000000000n}));
    const before=f.calls.length,result=await p.quoteMany(requests);
    assert.equal(f.calls.length-before,2);assert.equal(Object.keys(result.quotes).length,count);assert.deepEqual(result.unavailable,{});
    assert.equal((f.calls.at(-1)!.params[0] as string[]).length,4*count+4);
    assert.ok(Object.values(result.quotes).every(q=>q.slot===result.context!.slot&&q.receivedAt===result.context!.receivedAt));
    // Established SDK pricing still agrees; the old helper admits three per
    // invocation, so use separate immutable fixture calls for comparison only.
    for(let i=0;i<requests.length;i+=3){const legacyRpc={call:async<T>(method:string,params:unknown[]=[])=>method==='getBlockTime'?Math.floor(Date.now()/1000) as T:f.rpc.call<T>(method,params)};const expected=await quotePositionsSell(legacyRpc as ReadOnlyRpc,requests.slice(i,i+3),{record(){}});for(const [mint,q]of Object.entries(expected.quotes))assert.deepEqual(result.quotes[mint]!.sell,q.sell);}
    const warm=f.calls.length;await p.quoteMany(requests);assert.equal(f.calls.length-warm,1);
  }
}));

test('provider-derived coherent cardinality refuses before any source request',async()=>withObservationTime(async f=>{
  const p=new ResearchClockPositionPricer(f.rpc,f.rec);assert.equal(RESEARCH_CLOCK_COHERENT_POOL_CAPACITY*4+4,RESEARCH_CLOCK_RPC_ACCOUNT_CAPACITY);
  const tooMany=Array.from({length:RESEARCH_CLOCK_COHERENT_POOL_CAPACITY+1},(_,i)=>({mint:new PublicKey(Buffer.alloc(32,i+1)),fullBaseUnits:1n}));
  await assert.rejects(p.quoteMany(tooMany),/POSITION_BATCH_CAPACITY/);assert.equal(f.calls.length,0);
}));

test('original vault address hints remove only cold discovery; all support and later pricing use fresh coherent bytes',async()=>withTime(async f=>{
 const key=f.request.mint.toBase58(),dependencyHints={baseVault:f.state.addresses[5],quoteVault:f.state.addresses[6]},p=new ResearchClockPositionPricer(f.rpc,f.rec);
 const observation=await p.validateMany([{mint:f.request.mint,minSlot:f.request.minSlot,dependencyHints}]);assert.ok(observation.validations[key]);assert.deepEqual(Object.keys(observation.unavailable),[]);assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[0]as string[]).length,8);assert.equal(observation.validations[key]!.sourceSlot,f.state.context.slot);assert.equal(observation.validations[key]!.summary.clockSlot,f.state.context.slot);assert.equal(p.usage().dependencyHints.freshValidatedPools,1);assert.equal(p.usage().dependencyHints.discoveryRequestsAvoided,1);assert.equal(p.usage().networkCalls,1);
 const oldValue=observation.validations[key]!.summary;const vault=Buffer.from(f.state.value[6].data[0],'base64');vault.writeBigUInt64LE(vault.readBigUInt64LE(64)+10_000_000n,64);f.state.value[6].data[0]=vault.toString('base64');f.moveSlot();const before=f.calls.length,quote=await p.quote(f.request);assert.equal(f.calls.length-before,1);assert.equal(quote.slot,f.state.context.slot);assert.notEqual(quote.slot,oldValue.slot);assert.equal(quote.clockSlot,quote.slot);const baseline=await quotePositionsSell(f.rpc as ReadOnlyRpc,[f.request],{record(){}});assert.deepEqual(quote.sell,baseline.quotes[key]!.sell);assert.deepEqual(quote.feeBps,baseline.quotes[key]!.feeBps);
}));

test('a stale vault hint is technical unavailability, then the next ordinarily admitted canonical union discovers actual links',async()=>withTime(async f=>{
 const key=f.request.mint.toBase58(),dependencyHints={baseVault:'11111111111111111111111111111111',quoteVault:f.state.addresses[6]},rpc={async call<T>(method:string,params:unknown[]=[]){const response=await f.rpc.call<any>(method,params);if((params[0]as string[]).includes(dependencyHints.baseVault))response.value[5]=null;return response as T;}},p=new ResearchClockPositionPricer(rpc,f.rec);
 const first=await p.validateMany([{mint:f.request.mint,dependencyHints}]);assert.equal(first.unavailable[key],'POOL_LINKS_CHANGED');assert.equal(first.validations[key],undefined);assert.equal(f.calls.length,1,'bad hints never trigger an inline discovery retry');assert.equal(p.usage().dependencyHints.rejectedHints,1);assert.equal(p.usage().dependencyHints.discoveryRequestsAvoided,0);assert.equal(p.usage().cachedPoolSlot,null);assert.ok(f.records.some(r=>r.kind==='research-clock-dependency-hint-rejected'&&r.data.financialPermission===false&&r.data.marketAttractivenessUnknown===true));
 let admitted=false;const before=f.calls.length;await assert.rejects(p.validateMany([{mint:f.request.mint,dependencyHints}],undefined,{latestStartAt:Date.now()+1000,admissionOpen:()=>admitted}),/ADMISSION_CLOSED/);assert.equal(f.calls.length,before,'fallback cannot bypass ordinary admission');admitted=true;const recovered=await p.validateMany([{mint:f.request.mint,dependencyHints}],undefined,{latestStartAt:Date.now()+1000,admissionOpen:()=>admitted});assert.equal(f.calls.length-before,1);assert.equal((f.calls.at(-1)!.params[0]as string[]).length,9);assert.ok(recovered.validations[key]);assert.equal(p.usage().dependencyHints.ordinaryDiscoveryFallbackReads,1);assert.equal(p.usage().dependencyHints.hotRejectedHints,1);assert.equal(p.usage().dependencyHints.discoveryRequestsAvoided,0);assert.equal(p.usage().canonicalObservation.discoveryRequestsAvoided,1);
}));

test('hinted discovery never bypasses current fee ownership or same-batch bank Clock freshness',async()=>{
 await withTime(async f=>{const p=new ResearchClockPositionPricer(f.rpc,f.rec),key=f.request.mint.toBase58();f.state.value[2].owner='11111111111111111111111111111111';const result=await p.validateMany([{mint:f.request.mint,dependencyHints:{baseVault:f.state.addresses[5],quoteVault:f.state.addresses[6]}}]);assert.equal(result.validations[key],undefined);assert.equal(result.unavailable[key],'BAD_CONFIG_OWNER');assert.equal(p.usage().dependencyHints.freshValidatedPools,0);assert.equal(p.usage().dependencyHints.discoveryRequestsAvoided,0);assert.equal(p.usage().cachedPoolSlot,null);assert.equal(f.calls.length,1);});
 await withTime(async f=>{const p=new ResearchClockPositionPricer(f.rpc,f.rec),raw=Buffer.from(f.clock.data[0],'base64');raw.writeBigInt64LE(BigInt(Math.floor(Date.now()/1000)-31),32);f.clock.data[0]=raw.toString('base64');await assert.rejects(p.validateMany([{mint:f.request.mint,dependencyHints:{baseVault:f.state.addresses[5],quoteVault:f.state.addresses[6]}}]),/RESEARCH_CLOCK_NOT_CURRENT_WITHIN_30_SECONDS/);assert.equal(f.calls.length,1);assert.equal(p.usage().dependencyHints.freshValidatedPools,0);assert.equal(p.usage().dependencyHints.discoveryRequestsAvoided,0);assert.equal(p.usage().cachedPoolSlot,null);});
});
