import {ComponentTransport}from'../src/component-transport.js';
import {heldPricingFailureCode}from'../src/research-held-market.js';
/** Actual PilotRpc/physical-gate mechanics under injected faults. No provider traffic. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import {PilotRpc,PilotRpcUnavailable}from'../src/pilot-rpc.js';
import {nativePaperFinancialProviderAvailable,nativePaperProtectionReadDeadline,nativePaperManagementReserve,nativePaperSourceWorkAdmission,nativePaperRpcConfiguration}from'../src/run-native-paper.js';
const MIB=1024*1024,turn=()=>new Promise<void>(r=>setImmediate(r));
type Behavior='ok'|'timeout'|'transport'|'unsettled'|{status:number;retryAfter?:string};
function fixture(options:{persistent?:boolean;timeoutAdvance?:number;priorCooldownUntil?:number}={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-protection-recovery-')),old=join(directory,'prior.json');let at=200000,mono=200000,calls=0,freeze=false;const queue:Behavior[]=[],events:Array<{kind:string;data:any}>=[];let late:((v:Response)=>void)|null=null;
 let lastPhysicalTimeoutMs=1000;const physicalTimeouts:number[]=[];const move=(ms:number)=>{if(!freeze)at+=ms;mono+=ms;};
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));const prior=readFileSync(old);
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'protected-read-test',baselinePaths:[old],priorPhysicalSettled:true,...(options.persistent?{...nativePaperRpcConfiguration(true),maxResponseBytes:256*MIB}:{}),priorCooldownUntil:options.priorCooldownUntil,now:()=>at,monotonic:()=>mono,sleep:async ms=>{move(ms);},fetcher:(async(_url,init)=>{
  calls++;lastPhysicalTimeoutMs=(rpc as any).transport.currentObserverTimeoutMs??1000;physicalTimeouts.push(lastPhysicalTimeoutMs);const request=JSON.parse(String(init?.body)),next=queue.shift()??'ok';
  if(next==='timeout')return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{move(options.timeoutAdvance??lastPhysicalTimeoutMs);reject(Error('injected settled timeout'));},{once:true}));
  if(next==='transport')throw TypeError('injected HTTP transport failure');
  if(next==='unsettled')return new Promise<Response>(resolve=>{late=resolve;});
  if(typeof next==='object')return new Response(next.status===200?JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}):'refused',{status:next.status,headers:next.retryAfter?{'retry-after':next.retryAfter}:{}});
  move(50);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[]}));
 })as typeof fetch,record:(kind,data)=>events.push({kind,data})});
 return {rpc,events,physicalTimeouts,now:()=>at,mono:()=>mono,advance:move,set(ms:number){move(ms-at);},freezeWall(){freeze=true;},plan(...items:Behavior[]){queue.push(...items);},release(status=200,retryAfter?:string){late?.(new Response(status===200?'{}':'refused',{status,headers:retryAfter?{'retry-after':retryAfter}:{}}));late=null;},get calls(){return calls;},async close(){if(late){this.release();await turn();await turn();}rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(directory,{recursive:true,force:true});}};
}


const originalCall=ComponentTransport.prototype.call;
(ComponentTransport.prototype as any).call=function(this:any,method:string,params:unknown[],signal:AbortSignal,options:any={}){this.currentObserverTimeoutMs=options.timeoutMs??1000;return originalCall.call(this,method,params,signal,options);};

test('three physical timeouts produce two unavailable contexts and five logical dispatch refusals without another physical start or quota pressure',async t=>{
 const f=fixture({persistent:true}),rows:any[]=[];try{
  await f.rpc.callProtection('getMultipleAccounts');const lastCompleted=f.now();f.set(202000);f.plan('timeout','timeout');
  const invoke=async(label:string)=>{const began=f.now(),prior=f.calls;let error:unknown=null;try{await f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:nativePaperProtectionReadDeadline(f.now(),lastCompleted)});}catch(e){error=e;}const u=f.rpc.usage();rows.push({label,began,ended:f.now(),newPhysical:f.calls-prior,code:error instanceof Error?error.message:null,heldCode:error?heldPricingFailureCode(error):null,probeAt:u.protectionRecovery.probeAt,readyAt:u.protectionDispatchWindow?.readyAt,headroom10s:u.requestLimits.maxStartsPer10s-(u.chapterUsage?.rolling10SecondStarts??0),headroomMinute:u.requestLimits.maxStartsPerMinute-(u.chapterUsage?.rolling60SecondStarts??0),lastFailure:u.protectionRecovery.lastFailure});};
  await invoke('two-physical-timeouts');await turn();await turn();f.set(f.rpc.usage().protectionRecovery.probeAt+1);f.plan('timeout');await invoke('third-physical-timeout-second-context');await turn();await turn();
  for(let n=0;n<5;n++){f.advance(10);await invoke('logical-followup-'+n);}
  const probe=f.rpc.usage().protectionRecovery.probeAt;f.set(Math.max(f.now(),probe)+1);await invoke('provider-healthy-after-probe');
  assert.equal(rows[0].heldCode,'HELD_PRICING_PROVIDER_TIMEOUT');assert.equal(rows[1].heldCode,'HELD_PRICING_PROVIDER_TIMEOUT');assert.equal(rows.filter(r=>r.heldCode==='HELD_PRICING_DISPATCH_UNAVAILABLE').length,5);assert.ok(rows.slice(2,7).every(r=>r.newPhysical===0&&r.heldCode==='HELD_PRICING_DISPATCH_UNAVAILABLE'));assert.equal(rows.at(-1).code,null);assert.ok(rows.every(r=>r.headroom10s>=15&&r.headroomMinute>=85));
  t.diagnostic(JSON.stringify({scope:'OFFLINE actual PilotRpc/ComponentBudget, exact timeout/deadline/probe policy; not actual incident attribution',rows,physicalTimeouts:f.physicalTimeouts,physicalStarts:f.calls,completedGapAfterRecoveryMs:f.now()-lastCompleted,providerRequests:0}));
 }finally{await f.close();}
});
