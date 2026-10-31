/** Local isolation mechanics only. Injected delays are not provider capacity. */
import {test}from'node:test';import assert from'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{PilotRpc,PilotRpcUnavailable}from'../src/pilot-rpc.js';
const MIB=1024*1024,turn=()=>new Promise<void>(r=>setImmediate(r));
const pools=['11111111111111111111111111111111','22222222222222222222222222222222','33333333333333333333333333333333'];
const options={queryTimeoutScope:'independent-history' as const,timeoutMs:5};
function setup(mode:'abort'|'unsettled'|'429'|'503'='abort'){
 const directory=mkdtempSync(join(tmpdir(),'poe-query-timeout-')),old=join(directory,'prior.json');let at=200000,calls=0,fail=true,release:((value:Response)=>void)|undefined;const records:Array<{kind:string;data:any}>=[];
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:7,lastObservedAt:2000,starts:[1000],pending:[{id:1,unobservedBytes:2*MIB}]}));const prior=readFileSync(old);
 const fetcher=(async(_url,init)=>{calls++;const request=JSON.parse(String(init?.body));if(!fail)return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}));
  if(mode==='429'||mode==='503')return new Response('no',{status:Number(mode),headers:{'retry-after':'10'}});
  if(mode==='unsettled')return new Promise<Response>(resolve=>{release=()=>resolve(new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]})));});
  return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>{at+=1500;reject(Error('injected-abort-settlement'));},{once:true});});
 })as typeof fetch;
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'query-local-test',baselinePaths:[old],priorPhysicalSettled:true,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher,record:(kind,data)=>records.push({kind,data})});
 return{rpc,records,directory,get calls(){return calls;},now:()=>at,advance(ms:number){at+=ms;},succeed(){fail=false;},release(){release?.(new Response());},close(){rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(directory,{recursive:true,force:true});}};
}
const call=(f:ReturnType<typeof setup>,pool=pools[0]!,opt=options)=>f.rpc.call('getSignaturesForAddress',[pool,{commitment:'confirmed',limit:100}],undefined,opt);

test('isolated timed-out pool preserves its own backoff while another pool and protection use the shared settled gate',async()=>{
 const f=setup();try{
  await assert.rejects(call(f),/PHYSICAL_TIMEOUT/);await turn();await turn();const u=f.rpc.usage(),failed=readFileSync(join(f.directory,'run/chapter-001.json'));assert.equal(u.cooldownUntil,0);assert.equal(u.inFlight,0);assert.equal(u.queryTimeoutIsolation.isolatedTimeouts,1);assert.equal(u.queryTimeoutIsolation.rows[0]!.cooldownUntil,f.now()+2000);assert.equal(u.uncertainResponseBytes,4*MIB);assert.equal(f.calls,1);
  await assert.rejects(call(f),e=>e instanceof PilotRpcUnavailable&&e.code==='QUERY_COOLDOWN');assert.equal(f.calls,1);assert.equal(f.rpc.usage().newUnits,1);f.succeed();assert.deepEqual(await call(f,pools[1]),[]);assert.equal(f.rpc.usage().newUnits,2);assert.equal(f.rpc.usage().chapter,2);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),failed);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);
  assert.deepEqual(await f.rpc.call('getMultipleAccounts'),[]);assert.equal(f.rpc.usage().newUnits,3);assert.equal(f.rpc.usage().cooldownUntil,0);assert.ok(f.records.some(r=>r.kind==='pilot-query-timeout-unavailable'&&r.data.globalRpcCooldownUnchanged&&r.data.automaticRetry===false));
 }finally{f.close();}
});

test('three distinct timed-out queries in10s trigger the existing global backoff instead of probing every candidate',async()=>{
 const f=setup();try{for(const pool of pools){await assert.rejects(call(f,pool),/PHYSICAL_TIMEOUT/);await turn();await turn();}const u=f.rpc.usage();assert.equal(f.calls,3);assert.equal(u.queryTimeoutIsolation.isolatedTimeouts,2);assert.equal(u.queryTimeoutIsolation.globalEscalations,1);assert.equal(u.cooldownUntil,f.now()+2000);assert.equal(u.newUnits,3);await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,3);assert.ok(f.records.some(r=>r.kind==='pilot-query-timeout-escalated'&&r.data.distinctTimedOutQueriesLast10s===3));}
 finally{f.close();}
});

test('query isolation cannot preempt a timed-out physical request that has not actually settled',async()=>{
 const f=setup('unsettled');try{await assert.rejects(call(f),/PHYSICAL_TIMEOUT/);assert.equal(f.rpc.usage().inFlight,1);assert.equal(f.rpc.usage().cooldownUntil,0);f.advance(2500);await assert.rejects(call(f,pools[1]),/PHYSICAL_SLOT_OCCUPIED/);await assert.rejects(f.rpc.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse()),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.calls,1);assert.equal(f.rpc.usage().newUnits,1);f.release();await turn();await turn();assert.equal(f.rpc.usage().inFlight,0);f.succeed();assert.deepEqual(await call(f,pools[1]),[]);assert.equal(f.calls,2);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);}
 finally{f.release();await turn();f.close();}
});

for(const status of ['429','503']as const)test(`actual HTTP${status} remains global even when an independent audit opts into timeout isolation`,async()=>{
 const f=setup(status);try{await assert.rejects(call(f),new RegExp(status));await turn();assert.equal(f.rpc.usage().queryTimeoutIsolation.isolatedTimeouts,0);assert.ok(f.rpc.cooldownUntil()>f.now());await assert.rejects(call(f,pools[1]),/COOLDOWN/);assert.equal(f.calls,1);assert.equal(f.rpc.usage().newUnits,1);assert.equal(f.rpc.cooldownUntil(),f.now()+10000,'Retry-After is honored for actual503 as well as429');}
 finally{f.close();}
});

test('timeout isolation is rejected outside a bounded independently scheduled pool-history call before any request',async()=>{
 const f=setup();try{for(const [method,params]of [['getSlot',[]],['getSignaturesForAddress',[]],['getSignaturesForAddress',['invalid/path']]]as Array<[string,unknown[]]>)await assert.rejects(f.rpc.call(method,params,undefined,options),/INVALID_QUERY_TIMEOUT_SCOPE/);assert.equal(f.calls,0);assert.equal(f.rpc.usage().newUnits,0);assert.equal(f.rpc.usage().chapter,0);}
 finally{f.close();}
});

for(const status of [429,502,503,504])test(`actual${status} arriving during late physical settlement still establishes Retry-After after a logical isolated timeout`,async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-late-query429-')),old=join(directory,'prior.json');let at=200000,resolveFetch!:(r:Response)=>void,calls=0;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'late429',baselinePaths:[old],priorPhysicalSettled:true,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher:(async()=>{calls++;return new Promise<Response>(resolve=>{resolveFetch=resolve;});})as typeof fetch});
 try{await assert.rejects(rpc.call('getSignaturesForAddress',[pools[0]],undefined,options),/PHYSICAL_TIMEOUT/);assert.equal(rpc.usage().inFlight,1);assert.equal(rpc.cooldownUntil(),0);resolveFetch(new Response('',{status,headers:{'retry-after':'10'}}));await turn();await turn();assert.equal(rpc.usage().inFlight,0);assert.equal(rpc.cooldownUntil(),210000);assert.equal(JSON.parse(readFileSync(join(directory,'run/status.json'),'utf8')).cooldownUntil,210000);await assert.rejects(rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(calls,1);assert.equal(rpc.usage().newUnits,1);assert.equal(rpc.usage().uncertainResponseBytes,2*MIB);}
 finally{rpc.close();rmSync(directory,{recursive:true,force:true});}
});
