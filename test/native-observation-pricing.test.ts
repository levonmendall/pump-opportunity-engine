/** OFFLINE replay of retained account bytes. Synthetic wall time and deliberate
 * account faults exercise source admission; no live provider or profit claim. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,canonicalPumpPoolPda} from '../src/sdk.js';
import {ResearchClockPositionPricer,type ResearchClockNativeObservationSupport} from '../src/research-clock-pricing.js';
import type {PoolWireAccount} from '../src/pool.js';

function fixture(t:TestContext){
 const retained=JSON.parse(readFileSync('evidence/native-startup-20261028/retained-six-pool-startup.json','utf8'));
 const accounts=new Map<string,PoolWireAccount|null>(retained.poolState.addresses.map((address:string,i:number)=>[address,structuredClone(retained.poolState.value[i])]));
 const context={...retained.poolState.context},requests=retained.support.map((row:{mint:string;sourceSlot:number})=>({mint:new PublicKey(row.mint),minSlot:row.sourceSlot}));
 const calls:Array<{method:string;params:unknown[]}> = [],records:Array<{kind:string;data:any}>=[];
 let at=Date.parse(retained.poolState.receivedAt)+5,recordHook:((kind:string)=>void)|undefined,rpcHook:(()=>Promise<void>)|undefined;
 const originalNow=Date.now;Date.now=()=>at;t.after(()=>{Date.now=originalNow;});
 const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push({method,params:structuredClone(params)});await rpcHook?.();assert.equal(method,'getMultipleAccounts');return {context:{...context},value:(params[0]as string[]).map(address=>structuredClone(accounts.get(address)??null))}as T;}};
 const rec={record(kind:string,data:unknown){records.push({kind,data:structuredClone(data)});recordHook?.(kind);}},pricer=new ResearchClockPositionPricer(rpc,rec);
 const moveSlot=()=>{context.slot++;const clock=accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58())!,raw=Buffer.from(clock.data[0],'base64');raw.writeBigUInt64LE(BigInt(context.slot));clock.data[0]=raw.toString('base64');};
 return {accounts,context,requests,calls,records,pricer,now:()=>at,advance:(ms:number)=>{at+=ms;},moveSlot,onRecord:(fn?:(kind:string)=>void)=>{recordHook=fn;},onRpc:(fn?:()=>Promise<void>)=>{rpcHook=fn;}};
}

for(const count of [1,4,6])test(`native observation uses one fresh ${2*count+1}-account union for ${count} cold or warm pools`,async t=>{
 const f=fixture(t),requests=f.requests.slice(0,count),expected=new Set([...requests.flatMap((r:{mint:PublicKey})=>[canonicalPumpPoolPda(r.mint).toBase58(),r.mint.toBase58()]),SYSVAR_CLOCK_PUBKEY.toBase58()]);
 for(let n=0;n<2;n++){
  const before=f.calls.length,result=await f.pricer.validateObservationMany(requests);assert.equal(f.calls.length-before,1);assert.deepEqual(new Set(f.calls.at(-1)!.params[0]as string[]),expected);assert.equal(expected.size,2*count+1);assert.deepEqual(result.unavailable,{});assert.equal(Object.keys(result.validations).length,count);
  for(const support of Object.values(result.validations)){
   assert.equal(support.sourceSlot,f.context.slot);assert.equal(support.summary.clockSlot,f.context.slot);assert.equal(support.summary.receivedAt,result.context!.receivedAt);assert.equal(support.at,f.now());assert.match(support.evidence,/^research-clock-native-observation:[a-f0-9]{64}$/);
   for(const quoteField of ['buy','sell','feeBps','rawBaseReserve','rawQuoteReserve','effectiveQuoteReserve','baseAssociatedAccount','quoteAssociatedAccount'])assert.equal(Object.hasOwn(support.summary,quoteField),false,quoteField);
   assert.equal(f.pricer.constructionBatch(support.mint,support.sourceSlot,support.at),null);
  }
 }
 assert.equal(f.pricer.usage().nativeObservation.unionReads,2);assert.equal(f.pricer.usage().nativeObservation.freshValidatedPools,2*count);assert.equal(f.pricer.usage().networkCalls,2);
 assert.equal(f.records.some(row=>['research-clock-buy-quote','research-clock-position-sell-quote','research-clock-observation-support'].includes(row.kind)),false);
});

for(const fault of ['global-config','fee-config','wsol-mint','base-vault','quote-vault','empty-base'])test(`passive observation defers ${fault} to fresh full financial validation`,async t=>{
 const f=fixture(t),request=f.requests[0]!,name=request.mint.toBase58(),pool=canonicalPumpPoolPda(request.mint),mint=f.accounts.get(name)!;
 const base=getAssociatedTokenAddressSync(request.mint,pool,true,new PublicKey(mint.owner)).toBase58(),quote=getAssociatedTokenAddressSync(NATIVE_MINT,pool,true,TOKEN_PROGRAM_ID).toBase58();
 const address=fault==='global-config'?GLOBAL_CONFIG_PDA.toBase58():fault==='fee-config'?PUMP_AMM_FEE_CONFIG_PDA.toBase58():fault==='wsol-mint'?NATIVE_MINT.toBase58():fault==='quote-vault'?quote:base;
 if(fault==='empty-base'){const wire=f.accounts.get(address)!,raw=Buffer.from(wire.data[0],'base64');raw.writeBigUInt64LE(0n,64);wire.data[0]=raw.toString('base64');}else f.accounts.set(address,null);
 const result=await f.pricer.validateObservationMany([request]);assert.deepEqual(result.unavailable,{});assert.ok(result.validations[name]);assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[0]as string[]).includes(address),false);
 const before=f.calls.length;await assert.rejects(f.pricer.quoteBuy({...request,buyLamports:10000000n}),fault==='empty-base'?/NONPOSITIVE_EFFECTIVE_RESERVES/:/MISSING_ACCOUNT/);assert.equal(f.calls.length-before,1,'financial quote uses every current dependency once, with no inline retry');assert.equal((f.calls.at(-1)!.params[0]as string[]).length,8);assert.equal(f.records.some(row=>row.kind==='research-clock-buy-quote'),false);
 const again=await f.pricer.validateObservationMany([request]);assert.ok(again.validations[name],'quote capability failure does not make current identity undecodable');
});

test('full financial support remains compatible and native metadata never substitutes for current prices',async t=>{
 const f=fixture(t),request=f.requests[0]!,name=request.mint.toBase58();await f.pricer.validateObservationMany([request]);
 const full=await f.pricer.validateMany([request]),compatible:ResearchClockNativeObservationSupport=full.validations[name]!;assert.ok(compatible);assert.ok(full.validations[name]!.summary.feeBps);assert.equal((f.calls.at(-1)!.params[0]as string[]).length,8);
 const first=await f.pricer.quoteBuy({...request,buyLamports:10000000n}),quote=getAssociatedTokenAddressSync(NATIVE_MINT,canonicalPumpPoolPda(request.mint),true,TOKEN_PROGRAM_ID).toBase58(),wire=f.accounts.get(quote)!,raw=Buffer.from(wire.data[0],'base64');raw.writeBigUInt64LE(raw.readBigUInt64LE(64)+100000000n,64);wire.data[0]=raw.toString('base64');f.moveSlot();
 const before=f.calls.length,next=await f.pricer.quoteBuy({...request,buyLamports:10000000n});assert.equal(f.calls.length-before,1);assert.notEqual(next.buy.outputBaseUnits,first.buy.outputBaseUnits);assert.equal(next.slot,f.context.slot);assert.equal(next.clockSlot,next.slot);
});

for(const fault of ['missing-pool','missing-mint','unsupported-mint','vault-link'])test(`native observation isolates ${fault} without requesting extra dependencies`,async t=>{
 const f=fixture(t),request=f.requests[0]!,name=request.mint.toBase58(),pool=canonicalPumpPoolPda(request.mint).toBase58();
 if(fault==='missing-pool')f.accounts.set(pool,null);if(fault==='missing-mint')f.accounts.set(name,null);if(fault==='unsupported-mint')f.accounts.get(name)!.owner=PublicKey.default.toBase58();if(fault==='vault-link'){const wire=f.accounts.get(pool)!,raw=Buffer.from(wire.data[0],'base64');raw[139]=raw[139]!^1;wire.data[0]=raw.toString('base64');}
 const result=await f.pricer.validateObservationMany(f.requests.slice(0,4));assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[0]as string[]).length,9);assert.equal(result.validations[name],undefined);assert.ok(result.unavailable[name]);assert.equal(Object.keys(result.validations).length,3);assert.equal(Object.hasOwn(f.pricer.usage().cachedPoolSlots,name),false);
});

test('historical dependency hints are unnecessary for passive binding and never determine the queried addresses',async t=>{
 const f=fixture(t),request={...f.requests[0]!,dependencyHints:{baseVault:'not-a-public-key',quoteVault:'also-not-a-public-key'}},result=await f.pricer.validateObservationMany([request]);assert.ok(result.validations[request.mint.toBase58()]);assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[0]as string[]).length,3);assert.equal(f.pricer.usage().dependencyHints.plans,0);
});

for(const fault of ['clock-owner','clock-slot','clock-age','regressing-context','slow-recording','late-admission'])test(`native observation refuses common ${fault} without publishing fresh support`,async t=>{
 const f=fixture(t),clock=f.accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58())!,raw=Buffer.from(clock.data[0],'base64');let admitted=true;
 if(fault==='clock-owner')clock.owner=PublicKey.default.toBase58();
 if(fault==='clock-slot'){raw.writeBigUInt64LE(BigInt(f.context.slot+1));clock.data[0]=raw.toString('base64');}
 if(fault==='clock-age')f.advance(31000);
 if(fault==='regressing-context')f.context.slot--;
 if(fault==='slow-recording')f.onRecord(kind=>{if(kind==='research-clock-native-observation-support')f.advance(1001);});
 if(fault==='late-admission')f.onRecord(kind=>{if(kind==='research-clock-native-observation-support')admitted=false;});
 await assert.rejects(f.pricer.validateObservationMany(f.requests.slice(0,4),undefined,{latestStartAt:f.now()+10000,admissionOpen:()=>admitted}),/RESEARCH_CLOCK_/);assert.equal(f.calls.length,1);assert.deepEqual(f.pricer.usage().cachedPoolSlots,{});
});

test('a transient passive read failure retains only metadata and keeps monotonic floor admission',async t=>{
 const f=fixture(t),request=f.requests[0]!;await f.pricer.validateObservationMany([request]);const before=structuredClone(f.pricer.usage().cachedPoolSlots);f.onRpc(async()=>{throw Error('PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT');});await assert.rejects(f.pricer.validateObservationMany([request]),/PHYSICAL_TIMEOUT/);assert.deepEqual(f.pricer.usage().cachedPoolSlots,before);
 f.onRpc();f.moveSlot();const recovered=await f.pricer.validateObservationMany([request]);assert.equal(f.calls.length,3);assert.ok(recovered.validations[request.mint.toBase58()]);assert.equal(f.pricer.usage().highestVerifiedSlot,f.context.slot);f.context.slot--;await assert.rejects(f.pricer.validateObservationMany([request]),/REGRESSING/);assert.equal(f.calls.length,4);assert.deepEqual(f.pricer.usage().cachedPoolSlots,{});
});

test('native binding shares owned source admission and cannot start alongside an unresolved holding or financial read',async t=>{
 const f=fixture(t);let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});f.onRpc(()=>wait);const pending=f.pricer.validateObservationMany(f.requests.slice(0,4));await Promise.resolve();assert.equal(f.calls.length,1);
 await assert.rejects(f.pricer.quoteMany([{...f.requests[0]!,fullBaseUnits:1000000000n}]),/CONCURRENT_QUOTE/);await assert.rejects(f.pricer.validateMany([f.requests[0]!]),/CONCURRENT_QUOTE/);assert.equal(f.calls.length,1);release();assert.equal(Object.keys((await pending).validations).length,4);
});

test('alternating held and passive reads keeps independent working sets and requires fresh full holding state',async t=>{
 const f=fixture(t),held=f.requests.slice(0,3).map((request:{mint:PublicKey;minSlot:number})=>({...request,fullBaseUnits:1000000000n}));const first=await f.pricer.quoteMany(held);assert.equal(Object.keys(first.quotes).length,3);assert.equal(f.calls.length,2);
 const observed=await f.pricer.validateObservationMany(f.requests.slice(3));assert.equal(Object.keys(observed.validations).length,3);assert.equal(f.calls.length,3);assert.equal((f.calls.at(-1)!.params[0]as string[]).length,7);assert.equal(Object.keys(f.pricer.usage().cachedPoolSlots).length,6);
 const protectedBatch=await f.pricer.quoteMany(held);assert.equal(Object.keys(protectedBatch.quotes).length,3);assert.equal(f.calls.length,4);assert.equal((f.calls.at(-1)!.params[0]as string[]).length,16);assert.deepEqual(protectedBatch.quotes,first.quotes);
});

test('native observation cardinality, duplicate identities, stale admission and cancellation refuse before any request',async t=>{
 const f=fixture(t),abort=new AbortController();abort.abort();await assert.rejects(f.pricer.validateObservationMany([],undefined),/BATCH_CAPACITY/);await assert.rejects(f.pricer.validateObservationMany([...f.requests,f.requests[0]!]),/BATCH_CAPACITY/);await assert.rejects(f.pricer.validateObservationMany([f.requests[0]!,f.requests[0]!]),/DUPLICATE/);await assert.rejects(f.pricer.validateObservationMany([{...f.requests[0]!,minSlot:-1}]),/INVALID_MINIMUM_SLOT/);await assert.rejects(f.pricer.validateObservationMany(f.requests,abort.signal));await assert.rejects(f.pricer.validateObservationMany(f.requests,undefined,{latestStartAt:f.now()-1,admissionOpen:()=>true}),/ADMISSION_CLOSED/);assert.equal(f.calls.length,0);
});
