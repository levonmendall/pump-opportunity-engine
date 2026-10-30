/** Offline mechanics only. Mock finalized replies are not new finality evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {recoverPilotOrigin,PILOT_ORIGIN_RECOVERY_LIMITS,type PilotOriginRecoverySeed} from '../src/pilot-origin-recovery.js';
import {type PilotMigrationRpc} from '../src/pilot-discovery.js';
const original=readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line)).find(r=>r.kind==='migration-transaction').data;
const base='2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool=canonicalPumpPoolPda(new PublicKey(base)).toBase58(),signature=original.transaction.signatures[0];
const sig=(n:number)=>bs58.encode(Buffer.alloc(64,n)),hash=(n:number)=>bs58.encode(Buffer.alloc(32,n));
const signal=()=>new AbortController().signal;
function fixture(retained=false){
  const tx=structuredClone(original);let now=tx.blockTime*1000+3600000,mono=1000,bytes=1234;
  const anchorSig=sig(200),anchor=structuredClone(tx);anchor.transaction.signatures[0]=anchorSig;anchor.slot+=3;anchor.blockTime++;anchor.meta.innerInstructions=[];
  const seed:PilotOriginRecoverySeed={mint:base,pool,indexedCreatedAt:tx.blockTime*1000,receivedAt:now,...(retained?{retainedAnchorSignature:anchorSig}:{})};
  const calls:Array<{method:string;params:any[]}>=[];const extra=new Map<string,any>();let page:any[]=[{signature,slot:tx.slot,blockTime:tx.blockTime,err:null}],final=structuredClone(tx);
  let slotTime:(slot:number)=>number|null=slot=>tx.blockTime+Math.floor((slot-tx.slot)/2.5),perCallMs=125,charge=0,failMethod:string|null=null;
  const rpc:PilotMigrationRpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push({method,params:structuredClone(params)});now+=perCallMs;mono+=perCallMs;if(failMethod===method)throw Error(method==='getBlock'?'PAPER_RPC_METHOD_DENIED':'PILOT_RPC_COMPONENT_HTTP_429');let result:any;
    if(method==='getSlot')result=tx.slot+9000;
    else if(method==='getBlockTime')result=slotTime(Number(params[0]));
    else if(method==='getBlock')result={blockTime:slotTime(Number(params[0])),parentSlot:Number(params[0])-1,blockHeight:123,blockhash:hash(10),previousBlockhash:hash(11),signatures:[anchorSig]};
    else if(method==='getSignaturesForAddress'){assert.equal(params[0],pool);assert.deepEqual(params[1],{before:anchorSig,limit:1000,commitment:'confirmed'});result=page;}
    else {assert.equal(method,'getTransaction');assert.equal((params[1]as any).maxSupportedTransactionVersion,1);result=params[0]===anchorSig?anchor:(params[1]as any).commitment==='finalized'?final:extra.get(String(params[0]))??tx;}
    bytes+=Buffer.byteLength(JSON.stringify(result))+80+charge;return structuredClone(result) as T;
  }};
  const options={responseBytes:()=>bytes,now:()=>now,monotonic:()=>mono};
  return {seed,rpc,calls,tx,anchor,extra,options,setPage:(p:any[])=>{page=p;},setFinal:(t:any)=>{final=t;},setTime:(f:typeof slotTime)=>{slotTime=f;},setDuration:(n:number)=>{perCallMs=n;},setCharge:(n:number)=>{charge=n;},setFailMethod:(m:string)=>{failMethod=m;}};
}

test('bounded time hint obtains a finalized cursor then strict confirmed/finalized original identity',async()=>{
  const f=fixture(),r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,true);if(!r.ok)return;
  assert.equal(r.identity.baseMint,base);assert.equal(r.identity.pool,pool);assert.equal(r.identity.chainBlockTime,original.blockTime);assert.equal(r.identity.commitment,'finalized');assert.equal(r.identity.currentPoolStateVerified,false);assert.equal(r.identity.entryEligibilityVerified,false);
  assert.equal(r.proof.indexedTimeAuthority,false);assert.equal(r.proof.anchor.nearestHistoricalSlotClaimed,false);assert.ok(r.proof.anchor.blockTime>original.blockTime&&r.proof.anchor.blockTime<=original.blockTime+2);assert.ok(r.proof.anchor.slot>original.slot);
  assert.deepEqual(f.calls.filter(c=>c.method==='getTransaction').map(c=>c.params[1].commitment),['confirmed','finalized']);assert.equal(f.calls.filter(c=>c.method==='getSignaturesForAddress').length,1);assert.ok(f.calls.length<=24);assert.match(r.evidence,/^pilot-origin-recovery:[a-f0-9]{64}$/);
});

test('a known retained temporal signature is freshly verified and avoids block/time search',async()=>{
  const f=fixture(true),r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,true);if(!r.ok)return;
  assert.equal(r.proof.anchor.source,'verified-retained-signature');assert.equal(r.proof.block,null);assert.equal(r.proof.slotTimeSamples.length,0);assert.deepEqual(f.calls.map(c=>c.method),['getTransaction','getSignaturesForAddress','getTransaction','getTransaction']);assert.equal(f.calls[0]!.params[1].commitment,'finalized');
});

test('an already close current finalized bank does not require a possibly skipped historical bracket',async()=>{
  const f=fixture();f.setTime(slot=>slot===original.slot+9000?original.blockTime+1:null);
  const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,true);if(!r.ok)return;
  assert.equal(r.proof.anchor.slot,original.slot+9000);assert.equal(f.calls.filter(c=>c.method==='getBlockTime').length,1);assert.equal(f.calls.length,6);
});

test('nonmonotonic time hints cannot accept an origin at or after the chosen cursor slot',async()=>{
  const f=fixture();f.setTime(slot=>slot===original.slot+10?original.blockTime+5:slot<original.slot-20?original.blockTime-1:original.blockTime+1);
  const rpc:PilotMigrationRpc={call:async<T>(method:string,params:unknown[]=[],s?:AbortSignal)=>{const result=await f.rpc.call<T>(method,params,s);return (method==='getSlot'?original.slot+10:result) as T;}};
  const r=await recoverPilotOrigin(f.seed,rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/HISTORY_CONTEXT/);assert.equal(f.calls.filter(c=>c.method==='getTransaction').length,0);
});

test('index time is never installed as migration time, even when its hint is later',async()=>{
  const f=fixture(true);f.seed.indexedCreatedAt+=30000;f.anchor.blockTime+=30;const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,true);if(!r.ok)return;assert.equal(r.identity.chainBlockTime,original.blockTime);assert.notEqual(r.identity.chainBlockTime*1000,f.seed.indexedCreatedAt);
});

test('creation later than the hint is not accepted or silently searched with a wider cursor',async()=>{
  const f=fixture(true);f.seed.indexedCreatedAt-=1000;f.anchor.blockTime=original.blockTime+1;const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/NO_BOUNDED_ORIGIN_CANDIDATE/);assert.equal(f.calls.length,2);
});

test('wrong canonical pool is refused before any physical operation',async()=>{
  const f=fixture();f.seed.pool=new PublicKey(Buffer.alloc(32,5)).toBase58();const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/CANONICAL_SOL_SCOPE/);assert.equal(f.calls.length,0);
});

test('confirmed creation for a different base/pool never establishes the indexed identity',async()=>{
  const f=fixture(true);f.seed.mint=new PublicKey(Buffer.alloc(32,8)).toBase58();f.seed.pool=canonicalPumpPoolPda(new PublicKey(f.seed.mint)).toBase58();const rpc:PilotMigrationRpc={call:async<T>(method:string,params:unknown[]=[],s?:AbortSignal)=>f.rpc.call<T>(method,method==='getSignaturesForAddress'?[pool,params[1]]:params,s)};const r=await recoverPilotOrigin(f.seed,rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/ORIGIN_NOT_FOUND_IN_BOUNDED_HISTORY/);assert.equal(f.calls.filter(c=>c.method==='getTransaction').length,2);
});

test('a changed finalized origin is rejected rather than treated as a correction to its old identity',async()=>{
  const f=fixture(true),final=structuredClone(original);final.slot++;f.setFinal(final);const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/FINALIZED_IDENTITY_CHANGED/);
});

test('unavailable finality and malformed confirmed metadata remain strict decoder refusals',async()=>{
  const f=fixture(true);f.setFinal(null);const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/FINALIZED_CREATION_UNAVAILABLE/);
  const g=fixture(true);g.tx.meta.err={InstructionError:[0,'Custom']};const q=await recoverPilotOrigin(g.seed,g.rpc,signal(),g.options);assert.equal(q.ok,false);if(q.ok)return;assert.match(q.reason,/ORIGIN_NOT_FOUND_IN_BOUNDED_HISTORY/);
});

test('unresolved skipped slots terminate bounded search without history or automatic retry',async()=>{
  const f=fixture();let calls=0;f.setTime(slot=>{calls++;return calls<=2?original.blockTime+Math.floor((slot-original.slot)/2.5):null;});const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/SKIPPED_SLOT_AMBIGUITY/);assert.ok(!f.calls.some(c=>c.method==='getBlock'||c.method==='getSignaturesForAddress'));
});

test('saturated near-cursor page that never reaches the hint is refused, not paginated',async()=>{
  const f=fixture(true);f.setPage(Array.from({length:1000},(_,i)=>({signature:bs58.encode(Buffer.concat([Buffer.from([i>>8,i%256]),Buffer.alloc(62,9)])),slot:f.anchor.slot,blockTime:f.anchor.blockTime,err:null})));const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/HISTORY_SATURATED_HINT_NOT_COVERED/);assert.equal(f.calls.length,2);
});

test('only three bounded origin candidates are read; matching creation outside them is not fetched',async()=>{
  const f=fixture(true);const old=Array.from({length:3},(_,i)=>{const signature=sig(i+30),tx=structuredClone(original);tx.transaction.signatures[0]=signature;tx.slot-=i+1;tx.blockTime--;tx.transaction.message.instructions=[];tx.meta.innerInstructions=[];f.extra.set(signature,tx);return {signature,slot:tx.slot,blockTime:tx.blockTime,err:null};});f.setPage([{signature,slot:original.slot,blockTime:original.blockTime,err:null},...old]);const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/ORIGIN_NOT_FOUND_IN_BOUNDED_HISTORY/);assert.equal(f.calls.length,5);assert.equal(f.calls.filter(c=>c.method==='getTransaction'&&c.params[0]===signature).length,0);
});

test('physical response counter overflow, clock expiry and provider throttle stop later admissions',async()=>{
  const f=fixture(true);f.setCharge(PILOT_ORIGIN_RECOVERY_LIMITS.responseBytes);const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/RESPONSE_CAP/);assert.equal(f.calls.length,1);
  const g=fixture();g.setDuration(20001);const q=await recoverPilotOrigin(g.seed,g.rpc,signal(),g.options);assert.equal(q.ok,false);if(q.ok)return;assert.match(q.reason,/ELAPSED_CAP/);assert.equal(g.calls.length,1);
  const h=fixture();h.setFailMethod('getSlot');const t=await recoverPilotOrigin(h.seed,h.rpc,signal(),h.options);assert.equal(t.ok,false);if(t.ok)return;assert.equal(t.reason,'PILOT_RPC_COMPONENT_HTTP_429');assert.equal(h.calls.length,1);
});

test('missing getBlock authorization is reported exactly without bypassing the existing allowlist',async()=>{
  const f=fixture();f.setFailMethod('getBlock');const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.equal(r.reason,'PILOT_ORIGIN_RECOVERY_GET_BLOCK_NOT_AUTHORIZED');assert.equal(f.calls.at(-1)!.method,'getBlock');
});

test('a stale retained cursor, failed anchor, missing byte accounting and pre-abort cannot start an alternative session',async()=>{
  const f=fixture(true);f.anchor.blockTime+=2;const r=await recoverPilotOrigin(f.seed,f.rpc,signal(),f.options);assert.equal(r.ok,false);if(r.ok)return;assert.match(r.reason,/RETAINED_ANCHOR_CONTEXT/);assert.equal(f.calls.length,1);
  const g=fixture(true);g.anchor.meta.err='failed';const q=await recoverPilotOrigin(g.seed,g.rpc,signal(),g.options);assert.equal(q.ok,false);assert.equal(g.calls.length,1);
  const h=fixture(),c=new AbortController();c.abort();const t=await recoverPilotOrigin(h.seed,h.rpc,c.signal,h.options);assert.equal(t.ok,false);assert.equal(h.calls.length,0);
  const j=fixture(),u=await recoverPilotOrigin(j.seed,j.rpc,signal(),{} as any);assert.equal(u.ok,false);if(u.ok)return;assert.equal(u.reason,'PILOT_ORIGIN_RECOVERY_RESPONSE_ACCOUNTING_REQUIRED');assert.equal(j.calls.length,0);
});
