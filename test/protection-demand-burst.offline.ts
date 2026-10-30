import{NATIVE_CANDIDATE_AUDIT_PROFILE,NATIVE_DEADLINE_POLICY}from'../src/native-candidate-runner.js';
import {nativeHeldAuditScheduling}from'../src/native-held-audit-scheduling.js';
import{pilotLowerPriorityAdmission}from'../src/pilot.js';
import {ComponentTransport}from'../src/component-transport.js';
import {heldPricingFailureCode}from'../src/research-held-market.js';
/** Actual PilotRpc/physical-gate mechanics under injected faults. No provider traffic. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import {PilotRpc,PilotRpcUnavailable}from'../src/pilot-rpc.js';
import {nativePaperFinancialProviderAvailable,nativePaperProtectionReadDeadline,nativePaperManagementReserve,nativePaperSourceWorkAdmission,nativePaperRpcConfiguration}from'../src/run-native-paper.js';
const MIB=1024*1024,turn=()=>new Promise<void>(r=>setImmediate(r));
type Behavior='ok'|'timeout'|'transport'|'unsettled'|{latency:number}|{status:number;retryAfter?:string};
function fixture(options:{persistent?:boolean;timeoutAdvance?:number;priorCooldownUntil?:number}={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-protection-recovery-')),old=join(directory,'prior.json');let at=200000,mono=200000,calls=0,freeze=false;const queue:Behavior[]=[],events:Array<{kind:string;data:any}>=[];let late:((v:Response)=>void)|null=null;
 let lastPhysicalTimeoutMs=1000;const physicalTimeouts:number[]=[];const move=(ms:number)=>{if(!freeze)at+=ms;mono+=ms;};
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));const prior=readFileSync(old);
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'protected-read-test',baselinePaths:[old],priorPhysicalSettled:true,...(options.persistent?{...nativePaperRpcConfiguration(true),maxResponseBytes:256*MIB}:{}),priorCooldownUntil:options.priorCooldownUntil,now:()=>at,monotonic:()=>mono,sleep:async ms=>{move(ms);},fetcher:(async(_url,init)=>{
  calls++;lastPhysicalTimeoutMs=(rpc as any).transport.currentObserverTimeoutMs??1000;physicalTimeouts.push(lastPhysicalTimeoutMs);const request=JSON.parse(String(init?.body)),next=queue.shift()??'ok';
  if(next==='timeout')return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{move(options.timeoutAdvance??lastPhysicalTimeoutMs);reject(Error('injected settled timeout'));},{once:true}));
  if(next==='transport')throw TypeError('injected HTTP transport failure');
  if(next==='unsettled')return new Promise<Response>(resolve=>{late=resolve;});
  if(typeof next==='object'&&'latency'in next){move(next.latency);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}));}if(typeof next==='object')return new Response(next.status===200?JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}):'refused',{status:next.status,headers:next.retryAfter?{'retry-after':next.retryAfter}:{}});
  move(50);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}));
 })as typeof fetch,record:(kind,data)=>events.push({kind,data})});
 return {rpc,events,physicalTimeouts,now:()=>at,mono:()=>mono,advance:move,set(ms:number){move(ms-at);},freezeWall(){freeze=true;},plan(...items:Behavior[]){queue.push(...items);},release(status=200,retryAfter?:string){late?.(new Response(status===200?'{}':'refused',{status,headers:retryAfter?{'retry-after':retryAfter}:{}}));late=null;},get calls(){return calls;},async close(){if(late){this.release();await turn();await turn();}rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(directory,{recursive:true,force:true});}};
}



for(const releaseOffset of[0,3500])for(const pageLatency of[50,300,600,800,1000])test('actual early-protection role demand against unchanged shared quotas '+pageLatency+'ms pages released+'+releaseOffset,async t=>{
 const f=fixture({persistent:true});let lastCompleted:number|null=null,lastStart=0,bucket=-1,pages=0,lookups=0,early=0,normal=0,missed=0,maximumCompletedGapMs=0;const failures:any[]=[],starts:any[]=[];const began=f.now(),until=began+180000;
 const lower=(bound:number)=>pilotLowerPriorityAdmission({now:f.now(),endAt:Number.MAX_SAFE_INTEGER,held:1,lastUsable:lastCompleted,nextPendingAt:null,operationBoundMs:bound});
 const source=(setup=false)=>nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,discretionarySetup:setup,persistent:true,usage:f.rpc.usage()});
 const protect=async(kind:string)=>{const at=f.now();lastStart=at;f.plan({latency:50});try{await f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:nativePaperProtectionReadDeadline(at,lastCompleted)});if(lastCompleted!==null)maximumCompletedGapMs=Math.max(maximumCompletedGapMs,f.now()-lastCompleted);lastCompleted=f.now();}catch(e){failures.push({kind,at,ended:f.now(),code:e instanceof Error?e.message:null,usage:f.rpc.usage()});}};
 try{while(f.now()<until){
  const at=f.now(),current=Math.floor(at/10000);if(current!==bucket){if(bucket>=0)missed+=4-pages;bucket=current;pages=0;}
  if(!lastStart||at-lastStart>=2000){normal++;await protect('ordinary');continue;}
  const u=f.rpc.usage(),short=u.chapterUsage?.rolling10SecondStarts??0,minute=u.chapterUsage?.rolling60SecondStarts??0;
  const auditReleased=at>=bucket*10000+releaseOffset;const targets=Array.from({length:auditReleased?Math.max(0,4-pages):0},(_,i)=>({mint:String(i+1).repeat(32),eligibleAt:bucket*10000,deadlineAt:(bucket+1)*10000,ready:true,continuing:false,minimumPageWorkMs:NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+NATIVE_DEADLINE_POLICY.postValidationMs,prospective:false,historyReadyAt:at,serviceableBeforeDeadline:true}));
  const plan=nativeHeldAuditScheduling({at,held:1,lastProtectionStartedAt:lastStart,lastProtectionCompletedAt:lastCompleted,inventoryProtectionComplete:lastCompleted!==null&&at-lastCompleted<=4000,nextPendingAt:null,candidateInformationOpen:true,currentAuditFinancialRunwayAvailable:lower(NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+NATIVE_DEADLINE_POLICY.postValidationMs).admitted,deadlineView:{at,targets,requiredNativeAt:null},physical:{available:!u.fatal&&!u.closed&&u.cooldownUntil<=at,busy:u.inFlight!==0||u.waitingOrOperating,readyAt:u.rpcDispatchWindow?.readyAt??at,rolling10SecondHeadroom:20-short,rollingMinuteHeadroom:90-minute},protectionRequestStarts:1});
  if(plan.earlyProtection){early++;await protect('early');continue;}
  const ready=u.rpcDispatchWindow?.readyAt??at;
  if(source()&&ready<=at&&auditReleased&&pages<4&&lower(NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+NATIVE_DEADLINE_POLICY.postValidationMs).admitted&&at+NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+NATIVE_DEADLINE_POLICY.postValidationMs<(bucket+1)*10000){const bound=NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs;f.plan({latency:pageLatency});try{await f.rpc.call('getSignaturesForAddress',[String(pages+1).repeat(32),{limit:1000,commitment:'confirmed'}],undefined,{timeoutMs:1500,operationBoundMs:bound,latestStartAt:Math.min(lower(bound).latestStartAt,(bucket+1)*10000-bound),admissionOpen:()=>source()&&lower(bound).admitted});pages++;}catch(e){failures.push({kind:'audit',at,ended:f.now(),code:e instanceof Error?e.message:null,usage:f.rpc.usage()});}continue;}
  if(!targets.length&&source(true)&&ready<=at&&lower(1700).admitted){f.plan({latency:50});try{await f.rpc.call('getSlot',[],undefined,{timeoutMs:1500,operationBoundMs:1700,latestStartAt:lower(1700).latestStartAt,admissionOpen:()=>source(true)&&lower(1700).admitted});lookups++;}catch(e){failures.push({kind:'lookup',at,ended:f.now(),code:e instanceof Error?e.message:null,usage:f.rpc.usage()});}continue;}
  f.advance(50);
 }
 const physical=f.events.filter(e=>e.kind==='component-physical-start').map(e=>e.data.at as number),timeouts=f.events.filter(e=>e.kind==='component-physical-timeout');const logical=failures.map(({kind,at,ended,code,usage})=>({kind,at,ended,code,starts10:usage.chapterUsage?.rolling10SecondStarts,starts60:usage.chapterUsage?.rolling60SecondStarts,protected10:usage.protectionRecovery.rolling10SecondStarts,protected60:usage.protectionRecovery.rolling60SecondStarts,probeAt:usage.protectionRecovery.probeAt,readyAt:usage.protectionDispatchWindow?.readyAt,stage:usage.protectionRecovery.lastFailure}));
 const result={scope:'OFFLINE actual PilotRpc, held early planner and reserve/lower admission; synthetic four ready pages per10s and discretionary lookups, not full NativeCandidateRunner/audit or live attribution',auditReleaseOffsetMs:releaseOffset,pageLatency,elapsed:f.now()-began,normal,early,lookups,missed,maximumCompletedGapMs,physicalStarts:physical.length,httpTimeouts:timeouts.length,failures:logical,maximumShort:Math.max(...physical.map(at=>physical.filter(t=>t>at-10000&&t<=at).length)),maximumMinute:Math.max(...physical.map(at=>physical.filter(t=>t>at-60000&&t<=at).length)),providerRequests:0};
 t.diagnostic(JSON.stringify(result));assert.equal(timeouts.length,0);assert.equal(failures.length,0);assert.ok(maximumCompletedGapMs<=4000);assert.ok(result.maximumShort<=20&&result.maximumMinute<=90);
 }finally{await f.close();}
});
