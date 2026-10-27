/** Offline resolver mechanics. Retained origin bytes are replayed by mocks;
 * responding to a finalized request here is not a new finality observation. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {resolvePilotMigration,type PilotMigrationRpc} from '../src/pilot-discovery.js';
import {decodeMigrationIdentity} from '../src/migration-identity.js';
const readRows=(path:string)=>readFileSync(path,'utf8').trim().split('\n').map(row=>JSON.parse(row));
const origin=readRows('evidence/integration-2026-10-26T23-32-41.255Z.ndjson').find(row=>row.kind==='migration-transaction')!.data;
const custom=readRows('evidence/overnight-20261027/04-active/observations.ndjson').find(row=>row.kind==='migration-transaction')!.data;
const base='2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump';
const sig=(byte:number)=>bs58.encode(Buffer.alloc(64,byte));
const signal=()=>new AbortController().signal;
function fixture(mode:'direct'|'retry'='direct'){
  const retry=structuredClone(origin);retry.transaction.signatures[0]=sig(5);retry.slot+=50;retry.blockTime+=30;retry.meta.innerInstructions=[];
  const seed={signature:mode==='direct'?origin.transaction.signatures[0]:retry.transaction.signatures[0],feedMint:base,receivedAt:Date.now()-1};
  const calls:Array<{method:string;params:any[]}>=[];
  let final:any=structuredClone(origin),page:any[]=[{signature:origin.transaction.signatures[0],slot:origin.slot,err:null,blockTime:origin.blockTime}],initial:any=mode==='direct'?origin:retry;
  const other=new Map<string,any>();
  const rpc:PilotMigrationRpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:structuredClone(params)});
    if(method==='getSignaturesForAddress')return structuredClone(page)as T;
    assert.equal(method,'getTransaction');assert.equal((params[1] as any).maxSupportedTransactionVersion,1);
    if((params[1] as any).commitment==='finalized')return structuredClone(final)as T;
    return structuredClone(params[0]===seed.signature?initial:other.get(String(params[0]))??origin)as T;
  }};
  return {seed,rpc,calls,retry,other,setFinal:(value:any)=>{final=value;},setPage:(value:any[])=>{page=value;},setInitial:(value:any)=>{initial=value;}};
}

test('direct actual SOL creation requires an independent finalized request and preserves its actual original time',async()=>{
  const f=fixture(),result=await resolvePilotMigration(f.seed,f.rpc,signal());assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(call=>call.params[1].commitment),['confirmed','finalized']);
  assert.equal(result.identity.signature,origin.transaction.signatures[0]);assert.equal(result.identity.chainBlockTime,origin.blockTime);assert.equal(result.identity.commitment,'finalized');
  assert.equal(result.identity.currentPoolStateVerified,false);assert.equal(result.identity.entryEligibilityVerified,false);assert.equal(result.proof.history,null);
  assert.equal(result.proof.source,'direct-confirmed-creation');assert.match(result.evidence,/^pilot-finalized-migration:[a-f0-9]{64}$/);
});

test('genuine custom-quote creation is excluded, without reinterpreting feed mint or searching other pools',async()=>{
  const f=fixture();f.seed.signature=custom.transaction.signatures[0];f.setInitial(custom);
  const result=await resolvePilotMigration(f.seed,f.rpc,signal());assert.deepEqual(result,{ok:false,reason:'PILOT_MIGRATION_CUSTOM_QUOTE_OUTSIDE_SCOPE'});assert.equal(f.calls.length,1);
});

test('creation-free retry is only a seed: one page, three oldest successful candidates, then actual finalized origin',async()=>{
  const f=fixture('retry'),older=[sig(6),sig(7)];
  const before=JSON.stringify(f.retry);assert.equal(decodeMigrationIdentity(f.retry,{signature:f.seed.signature,feedMint:base,commitment:'confirmed',availableAt:Date.now()}).ok,false);
  older.forEach((signature,index)=>{const tx=structuredClone(f.retry);tx.transaction.signatures[0]=signature;tx.slot=origin.slot-index-1;tx.transaction.message.instructions=[];f.other.set(signature,tx);});
  f.setPage([{signature:f.seed.signature,slot:f.retry.slot,blockTime:f.retry.blockTime,err:null},{signature:origin.transaction.signatures[0],slot:origin.slot,blockTime:origin.blockTime,err:null},...older.map((signature,index)=>({signature,slot:origin.slot-index-1,blockTime:origin.blockTime-1,err:null}))]);
  const result=await resolvePilotMigration(f.seed,f.rpc,signal());assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(f.calls.length,6);assert.deepEqual(f.calls[1]!.params[1],{limit:1000,commitment:'confirmed'});
  assert.deepEqual(f.calls.slice(2,5).map(call=>call.params[0]),[older[1],older[0],origin.transaction.signatures[0]]);
  assert.equal(result.identity.baseMint,base);assert.equal(result.identity.signature,origin.transaction.signatures[0]);assert.equal(result.identity.chainBlockTime,origin.blockTime);assert.notEqual(result.identity.chainBlockTime,f.retry.blockTime);
  assert.equal(result.proof.originCandidates.length,3);assert.equal(result.proof.source,'bounded-canonical-SOL-history');assert.equal(JSON.stringify(f.retry),before);
});

test('saturated or malformed one-page history stops without further scans or origin reads',async()=>{
  const f=fixture('retry');f.setPage(Array.from({length:1000},()=>({signature:sig(8),slot:1,err:null,blockTime:1})));
  assert.deepEqual(await resolvePilotMigration(f.seed,f.rpc,signal()),{ok:false,reason:'PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN'});assert.equal(f.calls.length,2);
  const bad=fixture('retry');bad.setPage([{signature:sig(9),slot:1,err:null},{signature:sig(10),slot:2,err:null}]);
  assert.deepEqual(await resolvePilotMigration(bad.seed,bad.rpc,signal()),{ok:false,reason:'PILOT_MIGRATION_HISTORY_MALFORMED'});assert.equal(bad.calls.length,2);
});

test('a fallback origin with a different base or pool never verifies the feed seed',async()=>{
  const f=fixture('retry');f.seed.feedMint='A4CSsC9DPkKRnbcX3U3zQZnC9oV4JFieu7pu8oFWpump';
  const result=await resolvePilotMigration(f.seed,f.rpc,signal());assert.deepEqual(result,{ok:false,reason:'PILOT_MIGRATION_ORIGIN_NOT_FOUND_IN_BOUNDED_HISTORY'});assert.equal(f.calls.length,3);
});

test('changed finalized identity or unavailable finality refuses eligibility',async()=>{
  const changed=fixture(),tx=structuredClone(origin);tx.slot++;changed.setFinal(tx);
  assert.deepEqual(await resolvePilotMigration(changed.seed,changed.rpc,signal()),{ok:false,reason:'PILOT_MIGRATION_FINALIZED_IDENTITY_CHANGED'});assert.equal(changed.calls.length,2);
  const missing=fixture();missing.setFinal(null);assert.deepEqual(await resolvePilotMigration(missing.seed,missing.rpc,signal()),{ok:false,reason:'PILOT_MIGRATION_FINALIZED_CREATION_UNAVAILABLE'});assert.equal(missing.calls.length,2);
});

test('aborted work and provider throttle do not retry or open a history scan',async()=>{
  const f=fixture('retry'),controller=new AbortController();controller.abort();assert.deepEqual(await resolvePilotMigration(f.seed,f.rpc,controller.signal),{ok:false,reason:'PILOT_MIGRATION_ABORTED'});assert.equal(f.calls.length,0);
  let calls=0;const rpc:PilotMigrationRpc={async call<T>():Promise<T>{calls++;throw Error('PILOT_RPC_COMPONENT_HTTP_429');}};
  assert.deepEqual(await resolvePilotMigration(f.seed,rpc,signal()),{ok:false,reason:'PILOT_RPC_COMPONENT_HTTP_429'});assert.equal(calls,1);
});
