/** Actual PilotRpc/physical-gate mechanics under injected faults. No provider traffic. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import {PilotRpc,PilotRpcUnavailable}from'../src/pilot-rpc.js';
import {nativePaperFinancialProviderAvailable,nativePaperProtectionReadDeadline,nativePaperManagementReserve,nativePaperSourceWorkAdmission,nativePaperRpcConfiguration}from'../src/run-native-paper.js';
const MIB=1024*1024,turn=()=>new Promise<void>(r=>setImmediate(r));
type Behavior='ok'|'timeout'|'transport'|'unsettled'|{status:number;retryAfter?:string};
function fixture(options:{persistent?:boolean;timeoutAdvance?:number;priorCooldownUntil?:number}={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-protection-recovery-')),old=join(directory,'prior.json');let at=200000,mono=200000,calls=0,freeze=false;const queue:Behavior[]=[],events:Array<{kind:string;data:any}>=[];let late:((v:Response)=>void)|null=null;
 const move=(ms:number)=>{if(!freeze)at+=ms;mono+=ms;};
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));const prior=readFileSync(old);
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'protected-read-test',baselinePaths:[old],priorPhysicalSettled:true,...(options.persistent?{...nativePaperRpcConfiguration(true),maxResponseBytes:256*MIB}:{}),priorCooldownUntil:options.priorCooldownUntil,now:()=>at,monotonic:()=>mono,sleep:async ms=>{move(ms);},fetcher:(async(_url,init)=>{
  calls++;const request=JSON.parse(String(init?.body)),next=queue.shift()??'ok';
  if(next==='timeout')return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{move(options.timeoutAdvance??1000);reject(Error('injected settled timeout'));},{once:true}));
  if(next==='transport')throw TypeError('injected HTTP transport failure');
  if(next==='unsettled')return new Promise<Response>(resolve=>{late=resolve;});
  if(typeof next==='object')return new Response(next.status===200?JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}):'refused',{status:next.status,headers:next.retryAfter?{'retry-after':next.retryAfter}:{}});
  move(50);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}));
 })as typeof fetch,record:(kind,data)=>events.push({kind,data})});
 return {rpc,events,now:()=>at,mono:()=>mono,advance:move,set(ms:number){move(ms-at);},freezeWall(){freeze=true;},plan(...items:Behavior[]){queue.push(...items);},release(status=200,retryAfter?:string){late?.(new Response(status===200?'{}':'refused',{status,headers:retryAfter?{'retry-after':retryAfter}:{}}));late=null;},get calls(){return calls;},async close(){if(late){this.release();await turn();await turn();}rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(directory,{recursive:true,force:true});}};
}

test('retained baseline reproduces6000ms gap from one settled timeout plus the old two-second attempt cadence',async()=>{
 const f=fixture();try{
  await f.rpc.call('getMultipleAccounts');const first=f.now();f.set(202000);f.plan('timeout');await assert.rejects(f.rpc.call('getMultipleAccounts'),/PHYSICAL_TIMEOUT/);await turn();await turn();
  f.set(204000);await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);f.set(206000);await f.rpc.call('getMultipleAccounts');assert.equal(f.now()-first,6000);assert.equal(f.calls,3);
 }finally{await f.close();}
});

test('owned pricing retries one settled unthrottled timeout with a fresh read inside the unchanged4s completion boundary',async()=>{
 const f=fixture();try{
  await f.rpc.callProtection('getMultipleAccounts');const first=f.now();f.set(202000);f.plan('timeout');await f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:nativePaperProtectionReadDeadline(f.now(),first)});
  const gap=f.now()-first;assert.ok(gap<=4000,`completed gap ${gap}`);assert.equal(f.calls,3);assert.equal(f.rpc.usage().protectionRecovery.successesAfterRetry,1);assert.equal(f.rpc.usage().protectionRecovery.rapidProbes,1);assert.equal(f.rpc.usage().protectionRecovery.failureStages['physical-timeout'],1);
  assert.ok(f.rpc.usage().uncertainResponseBytes>=2*MIB,'failed bytes remain conservatively reserved');await assert.rejects(f.rpc.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,3,'candidate work does not inherit owned recovery permission');
 }finally{await f.close();}
});

test('a candidate primary timeout does not forbid a separately owned complete holding read after real settlement',async()=>{
 const f=fixture();try{
  f.plan('timeout');await assert.rejects(f.rpc.call('getMultipleAccounts'),/PHYSICAL_TIMEOUT/);await turn();await turn();const failedAt=f.now();
  await assert.rejects(f.rpc.call('getSlot'),/COOLDOWN/);assert.deepEqual(await f.rpc.callProtection('getMultipleAccounts'),[]);assert.ok(f.now()-failedAt<1000);assert.equal(f.calls,2);assert.ok(f.rpc.cooldownUntil()>f.now());
 }finally{await f.close();}
});

for(const status of [429,502,503,504])test(`actual HTTP${status} and Retry-After restrict owned reads, without any automatic extra request`,async()=>{
 const f=fixture();try{f.plan({status,retryAfter:'10'});await assert.rejects(f.rpc.callProtection('getMultipleAccounts'),new RegExp(String(status)));assert.equal(f.calls,1);assert.ok(f.rpc.protectionProviderRestrictionUntil()>=f.now()+15000);await assert.rejects(f.rpc.callProtection('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);}
 finally{await f.close();}
});

for(const status of [200,429,503])test(`late HTTP${status} Retry-After after logical timeout remains binding after physical settlement`,async()=>{
 const f=fixture({timeoutAdvance:0});try{
  f.plan('unsettled');await assert.rejects(f.rpc.call('getMultipleAccounts',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.equal(f.rpc.usage().inFlight,1);
  await assert.rejects(f.rpc.callProtection('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.calls,1);f.release(status,'10');await turn();await turn();assert.equal(f.rpc.usage().inFlight,0);
  assert.ok(f.rpc.protectionProviderRestrictionUntil()>=f.now()+15000);await assert.rejects(f.rpc.callProtection('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.calls,1);
 }finally{await f.close();}
});

test('sustained unthrottled outage has bounded probes, retained uncertainty and no early physical overlap',async()=>{
 const f=fixture({persistent:true});try{
  for(let cycle=0;cycle<5;cycle++){
   f.plan('timeout','timeout');await assert.rejects(f.rpc.callProtection('getMultipleAccounts',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT|DISPATCH_EXPIRED/);await turn();await turn();f.advance(2000);
  }
  assert.ok(f.calls<=7,`${f.calls} failed reads over ${f.mono()-200000}ms`);assert.ok(f.rpc.usage().protectionRecovery.rapidProbes<=2);assert.ok(f.rpc.usage().uncertainResponseBytes>=f.calls*2*MIB);
  const starts=f.events.filter(e=>e.kind==='component-physical-start').map(e=>e.data.at);assert.equal(starts.length,f.calls);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=250);
 }finally{await f.close();}
});

test('monotonic read budget and caller cancellation cannot create a third attempt or forget unsettled physical work',async()=>{
 const f=fixture({timeoutAdvance:0});try{
  f.plan('unsettled');await assert.rejects(f.rpc.call('getMultipleAccounts',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);f.freezeWall();const began=f.mono();
  await assert.rejects(f.rpc.callProtection('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);assert.ok(f.mono()-began<=2000);assert.equal(f.calls,1);assert.equal(f.rpc.usage().inFlight,1);
  const c=new AbortController();c.abort();await assert.rejects(f.rpc.callProtection('getMultipleAccounts',[],c.signal),/ABORTED/);assert.equal(f.calls,1);
 }finally{await f.close();}
});

test('owned adapter cannot promote arbitrary methods, invalid deadlines or cash permission through timeout backoff',async()=>{
 const f=fixture();try{
  await assert.rejects(f.rpc.callProtection('getSlot'),/INVALID_PROTECTION_READ/);for(const completeBy of [0,-1,NaN,f.now()+2001])await assert.rejects(f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy}),/INVALID_PROTECTION_DEADLINE/);assert.equal(f.calls,0);
  const at=f.now(),u={closed:false,fatal:null,cooldownUntil:at+5000,protectionRecovery:{providerRestrictionUntil:at}};
  assert.equal(nativePaperFinancialProviderAvailable(at,true,true,u),true);assert.equal(nativePaperFinancialProviderAvailable(at,false,true,u),false);assert.equal(nativePaperFinancialProviderAvailable(at,true,false,u),false);
  assert.equal(nativePaperFinancialProviderAvailable(at,true,true,{...u,protectionRecovery:undefined}),false);assert.equal(nativePaperFinancialProviderAvailable(at,true,true,{...u,protectionRecovery:{providerRestrictionUntil:at+1}}),false);
  for(const fail of [{closed:true},{fatal:'STORAGE_UNAVAILABLE'}])assert.equal(nativePaperFinancialProviderAvailable(at,true,true,{...u,...fail}),false);
 }finally{await f.close();}
});

test('owned rolling reservation subtracts genuinely used financial starts without permanently wasting provider capacity',()=>{
 const base={chapter:1,newUnits:80,maximumNewUnits:1500,newAccountedResponseBytes:0,maximumNewResponseBytes:256*MIB,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:80,rolling10SecondStarts:12}};
 const startup=nativePaperManagementReserve(base,true,true);assert.equal(startup.protectedMinuteStartReserve,36);assert.equal(startup.candidateWorkWithExposureAllowed,false);
 const measured={...base,protectionRecovery:{rolling60SecondStarts:30,rolling10SecondStarts:5}};const warm=nativePaperManagementReserve(measured,true,true);assert.equal(warm.protectedMinuteStartReserve,6);assert.equal(warm.protected10SecondStartReserve,4);assert.equal(warm.candidateWorkWithExposureAllowed,true);
 assert.equal(nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,persistent:true,usage:measured}),true);
 assert.equal(nativePaperManagementReserve({...measured,chapterUsage:{rolling60SecondStarts:85,rolling10SecondStarts:17}},true,true).candidateWorkWithExposureAllowed,false);
 assert.equal(nativePaperManagementReserve(base,true,false).candidateWorkWithExposureAllowed,true,'flat discovery keeps existing lightweight admission');
});

test('ready required audit pages can use idle short-window headroom beyond optional setup allowance',()=>{
 const usage={chapter:1,newUnits:50,maximumNewUnits:1500,newAccountedResponseBytes:0,maximumNewResponseBytes:256*MIB,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:50,rolling10SecondStarts:14},protectionRecovery:{rolling60SecondStarts:20,rolling10SecondStarts:4}};
 const reserve=nativePaperManagementReserve(usage,true,true);assert.equal(reserve.discretionary10SecondStartAllowance,9);assert.equal(reserve.discretionaryStartsLast10s,10);assert.equal(reserve.discretionarySetupAllowed,false);
 assert.equal(nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,discretionarySetup:true,usage,persistent:true}),false);
 assert.equal(nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,usage,persistent:true}),true,'deadline-ready audit retains available real6-start short headroom and40-start minute headroom');
});

/** Sustained local demand consumes the actual shared PilotRpc gate. Four
 * independent ready audit queues and continuous lower-priority lookup demand
 * are injected; these timings are not provider capacity or live market proof. */
test('sustained four-scope request pressure retains owned cadence, bounded recovery and fair audit service under actual rolling gates',async t=>{
 const f=fixture({persistent:true});try{
  const began=f.now(),until=began+120000,queues=Array.from({length:4},(_,i)=>({pool:String(i+1).repeat(32),nextAt:began+10000,readyAt:null as number|null,done:0}));let nextProtection=began,lastCompleted:number|null=null,maximumGap=0,timeoutInjected=false,lookups=0,missed=0,maximumAuditWait=0;
  while(f.now()<until){
   const at=f.now();for(const q of queues)if(q.readyAt===null&&at>=q.nextAt)q.readyAt=q.nextAt;
   if(at>=nextProtection){
    const start=at;if(!timeoutInjected&&at>=began+60000){f.plan('timeout');timeoutInjected=true;}
    await f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:nativePaperProtectionReadDeadline(at,lastCompleted)});
    if(lastCompleted!==null)maximumGap=Math.max(maximumGap,f.now()-lastCompleted);lastCompleted=f.now();nextProtection=start+2000;continue;
   }
   const hasReadyAudit=queues.some(q=>q.readyAt!==null),source=nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,discretionarySetup:!hasReadyAudit,usage:f.rpc.usage(),persistent:true}),runway=lastCompleted!==null&&at+1200+125+1200+125<lastCompleted+4000;
   if(source&&runway&&f.rpc.available()){
    const ready=queues.filter(q=>q.readyAt!==null).sort((a,b)=>a.readyAt!-b.readyAt!||a.pool.localeCompare(b.pool))[0];
    if(ready){if(at-ready.readyAt!>=10000)missed++;maximumAuditWait=Math.max(maximumAuditWait,at-ready.readyAt!);await f.rpc.call('getSignaturesForAddress',[ready.pool,{limit:100,commitment:'confirmed'}]);ready.done++;ready.nextAt=ready.readyAt!+10000;ready.readyAt=null;}
    else {await f.rpc.call('getSlot');lookups++;}
   }else f.advance(Math.max(1,Math.min(50,nextProtection-at)));
  }
  const starts=f.events.filter(e=>e.kind==='component-physical-start').map(e=>e.data.at);
  assert.ok(timeoutInjected);assert.ok(maximumGap<=4000,`maximum actual completed RPC gap ${maximumGap}ms`);assert.equal(missed,0);assert.ok(queues.every(q=>q.done>=8),JSON.stringify(queues));assert.ok(maximumAuditWait<10000);assert.ok(lookups>20,'ongoing discretionary lookup coverage was preserved');
  for(let i=0;i<starts.length;i++){if(i)assert.ok(starts[i]-starts[i-1]>=250);assert.ok(starts.filter(t=>t>starts[i]-10000&&t<=starts[i]).length<=20);assert.ok(starts.filter(t=>t>starts[i]-60000&&t<=starts[i]).length<=90);}
  assert.ok(f.rpc.usage().protectionRecovery.rapidProbes<=1);assert.equal(f.rpc.usage().protectionRecovery.successesAfterRetry,1);
  t.diagnostic(JSON.stringify({classification:'LOCAL_INJECTED_REQUEST_PRESSURE_NOT_LIVE_PROVIDER_CAPACITY',durationMs:f.now()-began,physicalCalls:f.calls,maximumCompletedGapMs:maximumGap,maximumAuditWaitMs:maximumAuditWait,auditsByScope:queues.map(q=>q.done),missedAuditDeadlines:missed,backgroundLookups:lookups,maximumRolling10SecondStarts:Math.max(...starts.map(at=>starts.filter(t=>t>at-10000&&t<=at).length)),maximumRollingMinuteStarts:Math.max(...starts.map(at=>starts.filter(t=>t>at-60000&&t<=at).length)),rapidProbes:f.rpc.usage().protectionRecovery.rapidProbes}));
 }finally{await f.close();}
});

test('twelve ready audit pages are not capped at nine when both real provider windows and held reserves permit the burst',async()=>{
 const f=fixture({persistent:true});try{
  const start=f.now();let pages=0,held=0,nextHeld=start;
  while(f.now()<start+10000){
   if(f.now()>=nextHeld){const began=f.now();await f.rpc.callProtection('getMultipleAccounts');held++;nextHeld=began+2000;continue;}
   if(pages<12){assert.equal(nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,usage:f.rpc.usage(),persistent:true}),true);await f.rpc.call('getSignaturesForAddress',['1'.repeat(32),{limit:100,commitment:'confirmed'}]);pages++;}
   else f.advance(Math.min(50,nextHeld-f.now()));
  }
  assert.equal(pages,12);assert.equal(held,5);assert.equal(f.calls,17);assert.equal(f.rpc.usage().chapterUsage!.rolling10SecondStarts,16,'first held read at exactwindowboundary legitimately expires');assert.equal(f.rpc.usage().requestLimits.maxStartsPer10s,20);assert.equal(f.rpc.usage().requestLimits.maxStartsPerMinute,90);
 }finally{await f.close();}
});
