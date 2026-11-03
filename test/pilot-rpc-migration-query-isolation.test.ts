/** Controlled local deadlines and HTTP responses; no provider or operating data. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PilotRpc,PilotRpcUnavailable,type PilotRpcCallOptions,type PilotRpcOptions} from '../src/pilot-rpc.js';
import {NATIVE_TWO_HOUR_90_RESEARCH_PROFILE} from '../src/native-research-profile.js';

const MIB=1024*1024,turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const signature='4'.repeat(86),other='5'.repeat(86);
const params=(sig=signature,commitment:unknown='confirmed')=>[sig,{encoding:'json',commitment,maxSupportedTransactionVersion:1}];
const options={queryTimeoutScope:'migration-origin-proof',timeoutMs:5} satisfies PilotRpcCallOptions;
type Mode='timeout'|'unsettled'|'success'|'transport'|'overload'|'malformed'|'body-timeout'|'abort-response';
function fixture(settings:{mode?:Mode;status?:number;retryAfter?:string;timeoutAdvanceMs?:number;rpc?:Partial<PilotRpcOptions>}={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-migration-query-')),priorPath=join(directory,'prior.json');
 writeFileSync(priorPath,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:7,lastObservedAt:2000,starts:[1000],pending:[{id:1,unobservedBytes:2*MIB}]}));
 const prior=readFileSync(priorPath),records:Array<{kind:string;data:any}>=[];let at=200000,mono=200000,mode=settings.mode??'timeout',calls=0,release:((response?:Response)=>void)|undefined,onPhysical:(()=>void)|undefined;
 const fetcher=(async(_url,init)=>{
  calls++;const request=JSON.parse(String(init?.body)),success=()=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}));
  onPhysical?.();
  if(mode==='body-timeout')return new Response(new ReadableStream({start(controller){init!.signal!.addEventListener('abort',()=>controller.error(Error('OFFLINE body interrupted')),{once:true});}}),{status:200,headers:settings.retryAfter===undefined?{}:{'retry-after':settings.retryAfter}});
  if(mode==='abort-response')return new Promise<Response>(resolve=>{init!.signal!.addEventListener('abort',()=>resolve(new Response('',{status:settings.status??401})),{once:true});});
  if(settings.status!==undefined)return new Response('unavailable',{status:settings.status,headers:settings.retryAfter===undefined?{}:{'retry-after':settings.retryAfter}});
  if(mode==='success')return success();
  if(mode==='transport')throw Error('OFFLINE network failure');
  if(mode==='overload')return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32005,message:'overloaded'}}));
  if(mode==='malformed')return new Response('not-json');
  if(mode==='unsettled')return new Promise<Response>(resolve=>{release=response=>resolve(response??success());});
  return new Promise<Response>((_resolve,reject)=>{const abort=()=>{const elapsed=settings.timeoutAdvanceMs??1200;at+=elapsed;mono+=elapsed;reject(Error('OFFLINE request aborted'));};init!.signal!.addEventListener('abort',abort,{once:true});if(init!.signal!.aborted)abort();});
 }) as typeof fetch;
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'migration-query-test',baselinePaths:[priorPath],priorPhysicalSettled:true,now:()=>at,monotonic:()=>mono,sleep:async ms=>{at+=ms;mono+=ms;},fetcher,record:(kind,data)=>records.push({kind,data}),...settings.rpc});
 return {rpc,records,directory,get calls(){return calls;},now:()=>at,advance(ms:number){at+=ms;mono+=ms;},wall(ms:number){at+=ms;},monotonic(ms:number){mono+=ms;},mode(value:Mode){mode=value;},onPhysical(callback:()=>void){onPhysical=callback;},release(response?:Response){release?.(response);},close(){rpc.close();assert.deepEqual(readFileSync(priorPath),prior);rmSync(directory,{recursive:true,force:true});}};
}

for(const commitment of ['confirmed','finalized'])test(`${commitment} migration timeout stays unresolved without declaring unrelated primary reads unavailable`,async()=>{
 const f=fixture();try{
  await assert.rejects(f.rpc.call('getTransaction',params(signature,commitment),undefined,options),/PHYSICAL_TIMEOUT/);await turn();await turn();
  const u=f.rpc.usage(),book=readFileSync(join(f.directory,'run/chapter-001.json'));
  assert.equal(u.inFlight,0);assert.equal(f.rpc.cooldownUntil(),0);assert.equal(f.rpc.available(),true);assert.equal(f.rpc.protectionProviderRestrictionUntil(),0);
  assert.equal(u.migrationOriginProofTimeoutIsolation.isolatedTimeouts,1);assert.equal(u.migrationOriginProofTimeoutIsolation.isolatedCallerCancellations,0);assert.equal(u.tokenCreationProofTimeoutIsolation.isolatedTimeouts,0);
  assert.equal(f.rpc.migrationOriginProofReadyAt(signature),f.now()+2000);assert.equal(u.newUnits,1);assert.equal(u.uncertainResponseBytes,4*MIB);
  await assert.rejects(f.rpc.call('getTransaction',params(signature,commitment),undefined,options),error=>error instanceof PilotRpcUnavailable&&error.code==='QUERY_COOLDOWN');assert.equal(f.calls,1);
  f.mode('success');assert.deepEqual(await f.rpc.call('getMultipleAccounts'),[]);assert.deepEqual(await f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:f.now()+2000}),[]);
  assert.equal(f.calls,3);assert.equal(f.rpc.usage().newUnits,3);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),book);
  const event=f.records.find(r=>r.kind==='pilot-migration-origin-query-unavailable')!.data;assert.equal(event.signature,signature);assert.equal(event.failureStage,'physical-timeout');assert.equal(event.proofVerified,false);assert.equal(event.primaryProviderHealthClaimed,false);assert.equal(event.automaticRetry,false);
  assert.equal(f.records.filter(r=>r.kind==='component-physical-timeout').length,1);
 }finally{f.close();}
});

test('an unscoped slow transaction still establishes the existing primary failure cooldown',async()=>{
 const f=fixture();try{await assert.rejects(f.rpc.call('getTransaction',params(),undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.equal(f.rpc.cooldownUntil(),f.now()+2000);assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.isolatedTimeouts,0);await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);}finally{f.close();}
});

test('query-local deadlines do not erase a prior primary incident streak; repeated query backoff follows both clocks',async()=>{
 const f=fixture();try{
  const frozen=f.now();f.advance(5);assert.equal(f.rpc.migrationOriginProofReadyAt(other,frozen),frozen);
  await assert.rejects(f.rpc.call('getSlot',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);await turn();await turn();const prior=f.rpc.cooldownUntil();assert.equal(f.rpc.migrationOriginProofReadyAt(signature),prior);
  f.advance(2000);await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.equal(f.rpc.cooldownUntil(),prior);
  f.wall(2500);assert.ok(f.rpc.migrationOriginProofReadyAt(signature)>f.now());await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),/QUERY_COOLDOWN/);
  f.monotonic(2500);await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.equal(f.rpc.migrationOriginProofReadyAt(signature),f.now()+5000);
  await assert.rejects(f.rpc.call('getSlot',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.equal(f.rpc.cooldownUntil(),f.now()+5000,'two primary incidents, despite intervening isolated failures');
  f.advance(5000);f.mode('success');await f.rpc.call('getTransaction',params(),undefined,options);assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.cachedQueries,0);
 }finally{f.close();}
});

test('a caller cancellation during physical migration work is separately counted and preserves unresolved bytes',async()=>{
 const f=fixture(),controller=new AbortController();f.onPhysical(()=>setImmediate(()=>controller.abort()));try{
  await assert.rejects(f.rpc.call('getTransaction',params(),controller.signal,{...options,timeoutMs:1500}),/COMPONENT_ABORTED/);await turn();await turn();
  const u=f.rpc.usage();assert.equal(f.calls,1);assert.equal(u.inFlight,0);assert.equal(u.newUnits,1);assert.equal(u.uncertainResponseBytes,4*MIB);assert.equal(f.rpc.cooldownUntil(),0);assert.equal(u.migrationOriginProofTimeoutIsolation.isolatedCallerCancellations,1);assert.equal(u.migrationOriginProofTimeoutIsolation.isolatedTimeouts,0);
  assert.equal(f.records.filter(r=>r.kind==='component-physical-timeout').length,0);assert.equal(f.records.find(r=>r.kind==='pilot-migration-origin-query-unavailable')!.data.failureStage,'caller-cancel-during-physical');
  f.mode('success');assert.deepEqual(await f.rpc.call('getMultipleAccounts'),[]);
 }finally{f.close();}
});

test('cancel before any physical start creates neither provider failure nor query retry credit',async()=>{
 const f=fixture({mode:'success'}),controller=new AbortController();try{
  await assert.rejects(f.rpc.call('getTransaction',params(),controller.signal,{...options,admissionOpen:()=>{controller.abort();return true;}}),/ABORTED/);await turn();await turn();
  const u=f.rpc.usage();assert.equal(f.calls,0);assert.equal(f.rpc.cooldownUntil(),0);assert.equal(u.migrationOriginProofTimeoutIsolation.isolatedCallerCancellations,0);assert.equal(u.migrationOriginProofTimeoutIsolation.cachedQueries,0);
  assert.deepEqual(await f.rpc.call('getMultipleAccounts'),[]);assert.equal(f.calls,1);
 }finally{f.close();}
});

test('an unsettled timed-out migration request retains the one physical gate even after local backoff expires',async()=>{
 const f=fixture({mode:'unsettled'});try{
  await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),/PHYSICAL_TIMEOUT/);assert.equal(f.rpc.usage().inFlight,1);assert.equal(f.rpc.cooldownUntil(),0);f.advance(2500);
  for(const [method,p]of [['getTransaction',params(other)],['getMultipleAccounts',[]]] as const)await assert.rejects(f.rpc.call(method,[...p],undefined,method==='getTransaction'?options:{}),/PHYSICAL_SLOT_OCCUPIED/);
  await assert.rejects(f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:f.now()+2000}),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.calls,1);assert.throws(()=>f.rpc.close(),/PHYSICAL_SLOT_OCCUPIED/);
  f.release();await turn();await turn();f.mode('success');await f.rpc.call('getMultipleAccounts');assert.equal(f.rpc.usage().newUnits,2);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);
 }finally{f.release();await turn();await turn();f.close();}
});

for(const status of [429,502,503,504])test(`actual HTTP${status} and Retry-After still restrict migration, primary and held reads`,async()=>{
 const f=fixture({status,retryAfter:'10'});try{
  await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),new RegExp(String(status)));await turn();assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.isolatedTimeouts,0);assert.equal(f.rpc.cooldownUntil(),f.now()+10000);assert.equal(f.rpc.protectionProviderRestrictionUntil(),f.now()+10000);await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);await assert.rejects(f.rpc.callProtection('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);
 }finally{f.close();}
});

for(const [mode,code]of [['transport','HTTP_TRANSPORT'],['overload','RPC_'],['malformed','MALFORMED_JSON']] as const)test(`${mode} remains a real failure, not a scoped migration deadline`,async()=>{
 const f=fixture({mode});try{await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),new RegExp(code));await turn();assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.isolatedTimeouts,0);assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.isolatedCallerCancellations,0);assert.equal(f.rpc.available(),false);await assert.rejects(f.rpc.call('getMultipleAccounts'));assert.equal(f.calls,1);}finally{f.close();}
});

test('HTTP200 Retry-After received before body timeout retains its route-wide floor',async()=>{
 const f=fixture({mode:'body-timeout',retryAfter:'10'});try{await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.isolatedTimeouts,0);assert.equal(f.rpc.cooldownUntil(),f.now()+10000);assert.equal(f.rpc.protectionProviderRestrictionUntil(),f.now()+10000);}finally{f.close();}
});

for(const status of [200,429,503])test(`late HTTP${status} Retry-After from the original physical request survives its local logical timeout`,async()=>{
 const f=fixture({mode:'unsettled'});try{
  await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),/PHYSICAL_TIMEOUT/);assert.equal(f.rpc.usage().inFlight,1);f.release(new Response('{}',{status,headers:{'retry-after':'10'}}));await turn();await turn();
  assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.cooldownUntil(),f.now()+10000);assert.equal(f.rpc.protectionProviderRestrictionUntil(),f.now()+10000);await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);assert.equal(f.rpc.usage().uncertainResponseBytes,4*MIB);assert.equal(JSON.parse(readFileSync(join(f.directory,'run/status.json'),'utf8')).cooldownUntil,f.rpc.cooldownUntil());
 }finally{f.release();await turn();await turn();f.close();}
});

for(const mode of ['unsettled','abort-response']as const)test(`${mode} actual HTTP401 remains fatal after the logical migration timeout`,async()=>{
 const f=fixture({mode,...(mode==='abort-response'?{status:401}:{})});try{
  await assert.rejects(f.rpc.call('getTransaction',params(),undefined,options),/PHYSICAL_TIMEOUT/);if(mode==='unsettled')f.release(new Response('',{status:401}));await turn();await turn();assert.equal(f.rpc.usage().fatal,'COMPONENT_HTTP_STATUS_401');assert.equal(f.rpc.available(),false);await assert.rejects(f.rpc.call('getMultipleAccounts'),/COMPONENT_HTTP_STATUS_401/);assert.equal(f.calls,1);
 }finally{f.release();await turn();await turn();f.close();}
});

test('migration scope rejects other purposes and coercible/malformed commitment/config values before transport',async()=>{
 const f=fixture({mode:'success'});try{
  const bad:Array<[string,unknown[]]>=[['getSlot',[]],['getMultipleAccounts',[]],['getSignaturesForAddress',['4'.repeat(32)]],['getTransaction',[]],['getTransaction',['bad/',params()[1]]],...['processed',new String('confirmed'),{toString:()=> 'confirmed'},null,1].map(commitment=>['getTransaction',params(signature,commitment)]as [string,unknown[]]),['getTransaction',[signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]],['getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]],['getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1,extra:true}]]];
  for(const [method,p]of bad)await assert.rejects(f.rpc.call(method,p,undefined,options),/INVALID_QUERY_TIMEOUT_SCOPE/);
  await assert.rejects(f.rpc.callProtection('getMultipleAccounts',[],undefined,options),/INVALID_QUERY_TIMEOUT_SCOPE/);await assert.rejects(f.rpc.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse(),undefined,options),/INVALID_QUERY_TIMEOUT_SCOPE/);
  assert.equal(f.calls,0);assert.equal(f.rpc.usage().newUnits,0);assert.equal(f.rpc.usage().chapter,0);
  for(const invalid of ['', '4'.repeat(89),'bad/'])assert.throws(()=>f.rpc.migrationOriginProofReadyAt(invalid),/INVALID_MIGRATION_ORIGIN_SIGNATURE/);
  for(const invalid of [-1,NaN,Infinity])assert.throws(()=>f.rpc.migrationOriginProofReadyAt(signature,invalid),/METHOD_CLOCK/);
 }finally{f.close();}
});

test('many distinct deadlines keep the migration cache bounded and retain every physical/uncertain charge',async()=>{
 const f=fixture({timeoutAdvanceMs:0,rpc:{persistent:true,profile:NATIVE_TWO_HOUR_90_RESEARCH_PROFILE.version,maxStartsPerMinute:90,maxStartsPer10s:20,maxResponseBytes:256*MIB}}),alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';try{
  for(let i=0;i<70;i++){const sig=alphabet[Math.floor(i/58)]!+alphabet[i%58]!+'4'.repeat(84);await assert.rejects(f.rpc.call('getTransaction',params(sig),undefined,options),/PHYSICAL_TIMEOUT/);await turn();await turn();assert.ok(f.rpc.usage().migrationOriginProofTimeoutIsolation.cachedQueries<=64);}
  const u=f.rpc.usage();assert.equal(u.migrationOriginProofTimeoutIsolation.cachedQueries,64);assert.equal(u.migrationOriginProofTimeoutIsolation.isolatedTimeouts,70);assert.equal(u.newUnits,70);assert.equal(u.uncertainResponseBytes,142*MIB);assert.equal(f.rpc.cooldownUntil(),0);assert.equal(f.records.filter(r=>r.kind==='component-physical-timeout').length,70);
 }finally{f.close();}
});

test('late provider restriction after a caller-cancelled request remains route-wide and durable',async()=>{
 const f=fixture({mode:'unsettled'}),controller=new AbortController();f.onPhysical(()=>setImmediate(()=>controller.abort()));try{
  await assert.rejects(f.rpc.call('getTransaction',params(),controller.signal,{...options,timeoutMs:1500}),/COMPONENT_ABORTED/);assert.equal(f.rpc.usage().inFlight,1);assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.isolatedCallerCancellations,1);
  f.release(new Response('',{status:503,headers:{'retry-after':'10'}}));await turn();await turn();assert.equal(f.rpc.cooldownUntil(),f.now()+10000);assert.equal(f.rpc.protectionProviderRestrictionUntil(),f.now()+10000);assert.equal(f.rpc.usage().inFlight,0);await assert.rejects(f.rpc.callProtection('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);
 }finally{f.release();await turn();await turn();f.close();}
});

test('an unscoped caller cancellation retains the primary cooldown; scope cannot be inferred from method alone',async()=>{
 const f=fixture(),controller=new AbortController();f.onPhysical(()=>setImmediate(()=>controller.abort()));try{await assert.rejects(f.rpc.call('getTransaction',params(),controller.signal,{timeoutMs:1500}),/COMPONENT_ABORTED/);await turn();await turn();assert.equal(f.rpc.cooldownUntil(),f.now()+2000);assert.equal(f.rpc.usage().migrationOriginProofTimeoutIsolation.isolatedCallerCancellations,0);await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);}finally{f.close();}
});

test('a full cache of actual active backoffs defers a new key without eviction or a physical charge',async()=>{
 const f=fixture({timeoutAdvanceMs:0,rpc:{persistent:true,profile:NATIVE_TWO_HOUR_90_RESEARCH_PROFILE.version,maxStartsPerMinute:90,maxStartsPer10s:20,maxResponseBytes:256*MIB}}),alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',keys=Array.from({length:64},(_,i)=>alphabet[Math.floor(i/58)]!+alphabet[i%58]!+'4'.repeat(84));try{
  // Six rounds at 700ms spacing retain each real query failure for <60s and
  // reach the existing60s per-query backoff without changing any clock/rate cap.
  for(let round=0;round<6;round++)for(const key of keys){await assert.rejects(f.rpc.call('getTransaction',params(key),undefined,options),/PHYSICAL_TIMEOUT/);await turn();await turn();f.advance(700);}
  const before=f.rpc.usage(),calls=f.calls;assert.equal(before.migrationOriginProofTimeoutIsolation.cachedQueries,64);assert.equal(before.migrationOriginProofTimeoutIsolation.activeBackoffs,64);const readyAt=f.rpc.migrationOriginProofReadyAt(other);assert.ok(readyAt>f.now());
  await assert.rejects(f.rpc.call('getTransaction',params(other),undefined,options),error=>error instanceof PilotRpcUnavailable&&error.code==='QUERY_COOLDOWN'&&error.retryAt===readyAt);
  const after=f.rpc.usage();assert.equal(f.calls,calls);assert.equal(after.newUnits,before.newUnits);assert.equal(after.uncertainResponseBytes,before.uncertainResponseBytes);assert.equal(after.migrationOriginProofTimeoutIsolation.cachedQueries,64);assert.equal(after.migrationOriginProofTimeoutIsolation.activeBackoffs,64);assert.equal(after.migrationOriginProofTimeoutIsolation.capacityDeferrals,1);assert.equal(f.rpc.cooldownUntil(),0);
 }finally{f.close();}
});
