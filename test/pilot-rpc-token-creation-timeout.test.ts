/** Purpose-specific local failure handling; injected delays are not provider latency. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PilotRpc,PilotRpcUnavailable,type PilotRpcCallOptions,type PilotRpcOptions} from '../src/pilot-rpc.js';
import {NATIVE_TWO_HOUR_90_RESEARCH_PROFILE} from '../src/native-research-profile.js';

const MIB=1024*1024,turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const signature='4'.repeat(86),otherSignature='5'.repeat(86);
const proofParams=(sig=signature)=>[sig,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}];
const proofOptions={queryTimeoutScope:'token-creation-proof',timeoutMs:5} satisfies PilotRpcCallOptions;
type Mode='timeout'|'unsettled'|'success'|'transport'|'overload'|'malformed'|'body-timeout'|'abort-response';
function fixture(initial:Mode='timeout',status?:number,retryAfter?:string,settings:{timeoutAdvanceMs?:number;rpc?:Partial<PilotRpcOptions>}={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-creation-query-timeout-')),priorPath=join(directory,'prior.json');
 writeFileSync(priorPath,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:7,lastObservedAt:2000,starts:[1000],pending:[{id:1,unobservedBytes:2*MIB}]}));
 const prior=readFileSync(priorPath),records:Array<{kind:string;data:any}>=[];let at=200000,mono=200000,mode=initial,calls=0,release:((response?:Response)=>void)|undefined;
 const fetcher=(async(_url,init)=>{
  calls++;const request=JSON.parse(String(init?.body)),success=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}));
  if(mode==='body-timeout')return new Response(new ReadableStream({start(controller){init!.signal!.addEventListener('abort',()=>controller.error(Error('injected-body-timeout')),{once:true});}}),{status:200,headers:retryAfter===undefined?{}:{'retry-after':retryAfter}});
  if(mode==='abort-response')return new Promise<Response>(resolve=>{init!.signal!.addEventListener('abort',()=>resolve(new Response('',{status:status??401})),{once:true});});
  if(status!==undefined)return new Response('unavailable',{status,headers:retryAfter===undefined?{}:{'retry-after':retryAfter}});
  if(mode==='success')return success();
  if(mode==='transport')throw Error('injected-network-failure');
  if(mode==='overload')return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32005,message:'overloaded'}}));
  if(mode==='malformed')return new Response('not-json');
  if(mode==='unsettled')return new Promise<Response>(resolve=>{release=response=>resolve(response??success());});
  return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>{const elapsed=settings.timeoutAdvanceMs??1200;at+=elapsed;mono+=elapsed;reject(Error('injected-timeout-settlement'));},{once:true});});
 }) as typeof fetch;
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'creation-query-test',baselinePaths:[priorPath],priorPhysicalSettled:true,now:()=>at,monotonic:()=>mono,sleep:async ms=>{at+=ms;mono+=ms;},fetcher,record:(kind,data)=>records.push({kind,data}),...settings.rpc});
 return {rpc,records,directory,get calls(){return calls;},now:()=>at,advance(ms:number){at+=ms;mono+=ms;},wall(ms:number){at+=ms;},monotonic(ms:number){mono+=ms;},mode(value:Mode){mode=value;},release(response?:Response){release?.(response);},close(){rpc.close();assert.deepEqual(readFileSync(priorPath),prior);rmSync(directory,{recursive:true,force:true});}};
}

test('unscoped finalized creation transaction reproduces the primary cooldown after its local timeout',async()=>{
 const f=fixture();try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);await turn();await turn();
  assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.cooldownUntil(),f.now()+2000);assert.equal(f.rpc.available(),false);
  await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);
  assert.ok(f.records.some(row=>row.kind==='pilot-rpc-unavailable'&&row.data.domain==='rpc'&&row.data.code==='COMPONENT_PHYSICAL_TIMEOUT'));
 }finally{f.close();}
});

test('preliminary creation-proof timeout rejects the proof while keeping unrelated settled primary reads available',async()=>{
 const f=fixture();try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();
  const before=f.rpc.usage(),failed=readFileSync(join(f.directory,'run/chapter-001.json'));
  assert.equal(before.inFlight,0);assert.equal(f.rpc.cooldownUntil(),0);assert.equal(f.rpc.available(),true);
  assert.equal(before.tokenCreationProofTimeoutIsolation.isolatedTimeouts,1);assert.equal(f.rpc.tokenCreationProofReadyAt(signature),f.now()+2000);
  assert.equal(f.records.filter(row=>row.kind==='component-physical-timeout').length,1,'the actual physical timeout and existing warning counter source remain visible');
  assert.ok(f.records.some(row=>row.kind==='pilot-query-timeout-unavailable'&&row.data.scope==='token-creation-proof'&&row.data.proofVerified===false&&row.data.automaticRetry===false));
  assert.equal(f.calls,1);assert.equal(before.newUnits,1);assert.equal(before.uncertainResponseBytes,4*MIB);
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),error=>error instanceof PilotRpcUnavailable&&error.code==='QUERY_COOLDOWN');
  assert.equal(f.calls,1);f.mode('success');assert.deepEqual(await f.rpc.call('getMultipleAccounts'),[]);
  assert.equal(f.calls,2);assert.equal(f.rpc.usage().newUnits,2);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);
  assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),failed);
 }finally{f.close();}
});

test('multiple slow creation signatures cannot declare an outage for independent primary or held reads',async()=>{
 const f=fixture();try{
  for(const sig of [signature,otherSignature,'6'.repeat(86)]){await assert.rejects(f.rpc.call('getTransaction',proofParams(sig),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();}
  const u=f.rpc.usage();assert.equal(u.tokenCreationProofTimeoutIsolation.isolatedTimeouts,3);assert.equal(u.queryTimeoutIsolation.isolatedTimeouts,0);assert.equal(u.queryTimeoutIsolation.globalEscalations,0);
  assert.equal(f.rpc.cooldownUntil(),0);assert.equal(f.rpc.protectionProviderRestrictionUntil(),0);assert.equal(u.newUnits,3);assert.equal(u.uncertainResponseBytes,8*MIB);
  f.mode('success');assert.deepEqual(await f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:f.now()+2000}),[]);
  assert.equal(f.calls,4);assert.equal(f.rpc.usage().protectionRecovery.logicalAttempts,1);
 }finally{f.close();}
});

test('proof backoff observes both clocks, increases per signature, and does not move a healthy planner timestamp',async()=>{
 const f=fixture();try{
  const planningAt=f.now();f.advance(5);assert.equal(f.rpc.tokenCreationProofReadyAt(otherSignature,planningAt),planningAt);
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();
  f.wall(2500);assert.ok(f.rpc.tokenCreationProofReadyAt(signature)>f.now());
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),error=>error instanceof PilotRpcUnavailable&&error.code==='QUERY_COOLDOWN');assert.equal(f.calls,1);
  f.monotonic(2500);await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();
  assert.equal(f.rpc.tokenCreationProofReadyAt(signature),f.now()+5000);assert.equal(f.rpc.usage().tokenCreationProofTimeoutIsolation.lastTimeout!.failures,2);
  f.advance(5000);f.mode('success');await f.rpc.call('getTransaction',proofParams(),undefined,proofOptions);assert.equal(f.rpc.usage().tokenCreationProofTimeoutIsolation.cachedQueries,0);
  assert.equal(f.rpc.usage().newUnits,3);assert.equal(f.rpc.usage().uncertainResponseBytes,6*MIB);
 }finally{f.close();}
});

test('a local proof timeout cannot clear a preexisting primary failure streak or retry floor',async()=>{
 const f=fixture();try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);await turn();await turn();const first=f.rpc.cooldownUntil();
  assert.equal(f.rpc.tokenCreationProofReadyAt(signature),first);await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/COOLDOWN/);assert.equal(f.calls,1);
  f.advance(2000);await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.equal(f.rpc.cooldownUntil(),first);
  await assert.rejects(f.rpc.call('getSlot',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.equal(f.rpc.cooldownUntil(),f.now()+5000);
 }finally{f.close();}
});

test('unsettled proof transport continues to own the shared gate after its query backoff expires',async()=>{
 const f=fixture('unsettled');try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);assert.equal(f.rpc.usage().inFlight,1);assert.equal(f.rpc.available(),false);assert.equal(f.rpc.cooldownUntil(),0);
  f.advance(2500);await assert.rejects(f.rpc.call('getTransaction',proofParams(otherSignature),undefined,proofOptions),/PHYSICAL_SLOT_OCCUPIED/);
  await assert.rejects(f.rpc.call('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);await assert.rejects(f.rpc.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse()),/PHYSICAL_SLOT_OCCUPIED/);
  assert.equal(f.calls,1);assert.throws(()=>f.rpc.close(),/PHYSICAL_SLOT_OCCUPIED/);f.release();await turn();await turn();f.mode('success');assert.deepEqual(await f.rpc.call('getMultipleAccounts'),[]);
  assert.equal(f.rpc.usage().newUnits,2);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);
 }finally{f.release();await turn();await turn();f.close();}
});

for(const status of [429,502,503,504])test(`actual HTTP${status} on a proof read keeps shared Retry-After and protection restrictions`,async()=>{
 const f=fixture('timeout',status,'10');try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),new RegExp(String(status)));await turn();
  assert.equal(f.rpc.usage().tokenCreationProofTimeoutIsolation.isolatedTimeouts,0);assert.equal(f.rpc.cooldownUntil(),f.now()+10000);assert.equal(f.rpc.protectionProviderRestrictionUntil(),f.now()+10000);
  await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);
 }finally{f.close();}
});

for(const status of [401,403])test(`actual HTTP${status} authentication failure remains fatal for scoped proof reads`,async()=>{
 const f=fixture('timeout',status);try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),new RegExp(String(status)));await turn();
  assert.equal(f.rpc.usage().tokenCreationProofTimeoutIsolation.isolatedTimeouts,0);assert.equal(f.rpc.usage().fatal,'COMPONENT_HTTP_STATUS_'+status);assert.equal(f.rpc.available(),false);assert.equal(f.calls,1);
 }finally{f.close();}
});

for(const [mode,code]of [['transport','HTTP_TRANSPORT'],['overload','RPC_'],['malformed','MALFORMED_JSON']] as const)test(`${mode} failure is not isolated as a preliminary query timeout`,async()=>{
 const f=fixture(mode);try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),new RegExp(code));await turn();
  assert.equal(f.rpc.usage().tokenCreationProofTimeoutIsolation.isolatedTimeouts,0);assert.equal(f.rpc.available(),false);assert.equal(f.calls,1);
  await assert.rejects(f.rpc.call('getMultipleAccounts'));assert.equal(f.calls,1);
 }finally{f.close();}
});

test('a proof response with HTTP200 Retry-After does not receive a query-local timeout exemption',async()=>{
 const f=fixture('body-timeout',undefined,'10');try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();
  assert.equal(f.rpc.usage().tokenCreationProofTimeoutIsolation.isolatedTimeouts,0);assert.equal(f.rpc.cooldownUntil(),f.now()+10000);assert.equal(f.rpc.protectionProviderRestrictionUntil(),f.now()+10000);assert.equal(f.calls,1);
 }finally{f.close();}
});

for(const status of [200,429,502,503,504])test(`late HTTP${status} Retry-After from timed-out proof transport still blocks primary reads`,async()=>{
 const f=fixture('unsettled');try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);assert.equal(f.rpc.usage().inFlight,1);assert.equal(f.rpc.cooldownUntil(),0);
  f.release(new Response('{}',{status,headers:{'retry-after':'10'}}));await turn();await turn();
  assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.cooldownUntil(),f.now()+10000);assert.equal(f.rpc.protectionProviderRestrictionUntil(),f.now()+10000);
  await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);assert.equal(f.rpc.usage().newUnits,1);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);
  assert.equal(JSON.parse(readFileSync(join(f.directory,'run/status.json'),'utf8')).cooldownUntil,f.now()+10000);
 }finally{f.release();await turn();await turn();f.close();}
});

for(const status of [401,403,500])test(`HTTP${status} headers arriving in the abort listener remain fatal before the proof timeout catch`,async()=>{
 const f=fixture('abort-response',status);try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();
  const u=f.rpc.usage();assert.equal(u.inFlight,0);assert.equal(u.fatal,'COMPONENT_HTTP_STATUS_'+status);assert.equal(u.tokenCreationProofTimeoutIsolation.isolatedTimeouts,0);
  assert.equal(f.records.filter(row=>row.kind==='component-physical-timeout').length,1);assert.equal(u.newUnits,1);assert.equal(u.uncertainResponseBytes,4*MIB);
  assert.ok(f.records.some(row=>row.kind==='pilot-rpc-unavailable'&&row.data.code==='COMPONENT_HTTP_STATUS_'+status&&row.data.providerResponse===true));
  assert.equal(JSON.parse(readFileSync(join(f.directory,'run/status.json'),'utf8')).fatal,'COMPONENT_HTTP_STATUS_'+status);
  f.advance(2500);assert.equal(f.rpc.available(),false);await assert.rejects(f.rpc.call('getMultipleAccounts'),new RegExp('COMPONENT_HTTP_STATUS_'+status));assert.equal(f.calls,1);
 }finally{f.close();}
});

for(const status of [401,403,500])test(`late HTTP${status} after an isolated proof timeout remains a fatal provider response`,async()=>{
 const f=fixture('unsettled');try{
  await assert.rejects(f.rpc.call('getTransaction',proofParams(),undefined,proofOptions),/PHYSICAL_TIMEOUT/);f.release(new Response('',{status}));await turn();await turn();
  assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.available(),false);assert.equal(f.rpc.usage().fatal,'COMPONENT_HTTP_STATUS_'+status);assert.equal(f.calls,1);
 }finally{f.release();await turn();await turn();f.close();}
});

test('proof scope is rejected for other purposes, malformed proof requests and protected financial APIs',async()=>{
 const f=fixture('success');try{
  const bad:Array<[string,unknown[]]>=[['getSlot',[]],['getMultipleAccounts',[]],['getSignaturesForAddress',['4'.repeat(32)]],['getTransaction',[]],['getTransaction',['not/a/signature',proofParams()[1]]],['getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]],['getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:1}]],['getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]],['getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1,extra:true}]]];
  for(const [method,params]of bad)await assert.rejects(f.rpc.call(method,params,undefined,proofOptions),/INVALID_QUERY_TIMEOUT_SCOPE/);
  await assert.rejects(f.rpc.callProtection('getMultipleAccounts',[],undefined,proofOptions),/INVALID_QUERY_TIMEOUT_SCOPE/);
  await assert.rejects(f.rpc.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse(),undefined,proofOptions),/INVALID_QUERY_TIMEOUT_SCOPE/);
  assert.equal(f.calls,0);assert.equal(f.rpc.usage().newUnits,0);assert.equal(f.rpc.usage().chapter,0);
  for(const invalid of ['', '4'.repeat(89),'bad/'])assert.throws(()=>f.rpc.tokenCreationProofReadyAt(invalid),/INVALID_CREATION_PROOF_SIGNATURE/);
  for(const invalid of [-1,NaN,Infinity])assert.throws(()=>f.rpc.tokenCreationProofReadyAt(signature,invalid),/METHOD_CLOCK/);
 }finally{f.close();}
});

test('many distinct proof timeouts keep a bounded cache without hiding timeouts or imposing primary cooldown',async()=>{
 const f=fixture('timeout',undefined,undefined,{timeoutAdvanceMs:0,rpc:{persistent:true,profile:NATIVE_TWO_HOUR_90_RESEARCH_PROFILE.version,maxStartsPerMinute:90,maxStartsPer10s:20,maxResponseBytes:256*MIB}});
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';try{
  for(let i=0;i<70;i++){const sig=alphabet[Math.floor(i/58)]!+alphabet[i%58]!+'4'.repeat(84);await assert.rejects(f.rpc.call('getTransaction',proofParams(sig),undefined,proofOptions),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.ok(f.rpc.usage().tokenCreationProofTimeoutIsolation.cachedQueries<=64);}
  const u=f.rpc.usage();assert.equal(u.tokenCreationProofTimeoutIsolation.isolatedTimeouts,70);assert.equal(u.tokenCreationProofTimeoutIsolation.cachedQueries,64);assert.equal(u.cooldownUntil,0);assert.equal(u.newUnits,70);
  assert.equal(f.records.filter(row=>row.kind==='component-physical-timeout').length,70);assert.equal(u.queryTimeoutIsolation.globalEscalations,0);assert.equal(u.uncertainResponseBytes,142*MIB);
 }finally{f.close();}
});
