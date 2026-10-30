import{pilotLowerPriorityAdmission}from'../src/pilot.js';
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
 return {rpc,events,directory,now:()=>at,mono:()=>mono,advance:move,set(ms:number){move(ms-at);},freezeWall(){freeze=true;},plan(...items:Behavior[]){queue.push(...items);},release(status=200,retryAfter?:string){late?.(new Response(status===200?'{}':'refused',{status,headers:retryAfter?{'retry-after':retryAfter}:{}}));late=null;},get calls(){return calls;},async close(){if(late){this.release();await turn();await turn();}rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(directory,{recursive:true,force:true});}};
}


test('BASELINE settled known-uninvoked candidate reservations are rebased into a false short-window provider burst at service compaction',async t=>{
 const f=fixture({persistent:true});let lastCompleted:number|null=null,nextHeld=f.now(),nextCandidate=f.now()+500,ghosts=0,roundRobin=0,maximumGap=0;const failures:any[]=[],compactions:any[]=[],beforeCompaction:any[]=[];const began=f.now(),until=began+120000;
 const lower=()=>pilotLowerPriorityAdmission({now:f.now(),endAt:Number.MAX_SAFE_INTEGER,held:1,lastUsable:lastCompleted,nextPendingAt:null,operationBoundMs:1700});
 const source=()=>nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,persistent:true,usage:f.rpc.usage()});
 try{while(f.now()<until){
  const at=f.now();
  if(at>=nextHeld){const heldBefore=f.rpc.usage(),priorCompacted=heldBefore.compactedAccountingEpochs;const starts=f.calls;nextHeld=at+2000;try{await f.rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:nativePaperProtectionReadDeadline(at,lastCompleted)});if(lastCompleted!==null)maximumGap=Math.max(maximumGap,f.now()-lastCompleted);lastCompleted=f.now();}catch(e){const u=f.rpc.usage();failures.push({at,ended:f.now(),code:e instanceof Error?e.message:null,newPhysical:f.calls-starts,allocatedShort:u.chapterUsage?.rolling10SecondStarts,physicalStarts:f.calls,probeAt:u.protectionRecovery.probeAt,compacted:u.compactedAccountingEpochs,readyAt:u.protectionDispatchWindow?.readyAt});}const heldAfter=f.rpc.usage();if(heldAfter.compactedAccountingEpochs!==priorCompacted)compactions.push({at:f.now(),during:'held-read',before:{short:heldBefore.chapterUsage?.rolling10SecondStarts,minute:heldBefore.chapterUsage?.rolling60SecondStarts},after:{short:heldAfter.chapterUsage?.rolling10SecondStarts,minute:heldAfter.chapterUsage?.rolling60SecondStarts,readyAt:heldAfter.protectionDispatchWindow?.readyAt,compacted:heldAfter.compactedAccountingEpochs},checkpoint:JSON.parse(readFileSync(heldAfter.recoveryBaselinePaths[0]!, 'utf8')).starts,physicalStarts:f.calls,ghosts});continue;}
  const before=f.rpc.usage();
  if(at>=nextCandidate&&source()&&lower().admitted&&(before.rpcDispatchWindow?.readyAt??at)<=at){
   nextCandidate=at+1500;const physical=f.calls,prior=before.compactedAccountingEpochs,margin=nativePaperManagementReserve(before,true,true);let injected=false;
   try{await f.rpc.call('getSignaturesForAddress',[String(++roundRobin%4+1).repeat(32),{limit:1000,commitment:'confirmed'}],undefined,{latestStartAt:lower().latestStartAt,operationBoundMs:1700,admissionOpen:()=>{const u=f.rpc.usage();if(u.currentUninvokedReservationCredit===1){injected=true;return false;}return source()&&lower().admitted;}});}catch(e){if(injected){assert.equal(f.calls,physical,'a locally proved uninvoked candidate never reached the fake provider');ghosts++;}}
   await turn();await turn();const after=f.rpc.usage();if(after.compactedAccountingEpochs!==prior)compactions.push({at:f.now(),prior,before:{short:before.chapterUsage?.rolling10SecondStarts,minute:before.chapterUsage?.rolling60SecondStarts,margin},after:{short:after.chapterUsage?.rolling10SecondStarts,minute:after.chapterUsage?.rolling60SecondStarts,readyAt:after.protectionDispatchWindow?.readyAt,compacted:after.compactedAccountingEpochs},physicalStarts:f.calls,ghosts});
   continue;
  }
  f.advance(50);
 }
 const timeouts=f.events.filter(e=>e.kind==='component-physical-timeout');t.diagnostic(JSON.stringify({scope:'OFFLINE actual69 RPC/ComponentBudget/source reserve/compaction with injected final-admission closure; four synthetic candidate scopes and normal2s owned reads. Not actual02:48cause attribution.',ghosts,physicalStarts:f.calls,maximumCompletedGapMs:maximumGap,timeouts:timeouts.length,failures,compactions,providerRequests:0}));
 assert.ok(ghosts>=31);assert.ok(compactions.length>0);assert.ok(maximumGap>10000);assert.ok(failures.some(f=>f.code==='PILOT_RPC_COMPONENT_DISPATCH_EXPIRED'&&f.newPhysical===0));assert.equal(timeouts.length,0);
 }finally{await f.close();}
});
