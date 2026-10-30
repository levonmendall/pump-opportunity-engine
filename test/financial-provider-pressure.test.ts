/** OFFLINE actual RPC/gate and launcher-admission pressure test. Four synthetic
 * runnable queues, no live market, operating ledger or provider traffic. */
import{test}from'node:test';
import assert from'node:assert/strict';import{mkdtempSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{PilotRpc}from'../src/pilot-rpc.js';
import{nativePaperSourceWorkAdmission,nativePaperProtectionReadDeadline,nativePaperRpcConfiguration}from'../src/run-native-paper.js';
import{pilotLowerPriorityAdmission}from'../src/pilot.js';

test('shared actual provider budget preserves timely held recovery and fair discretionary progress under sustained demand',async()=>{
const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-sustained-provider-')),old=join(dir,'prior.json');let at=200000,calls=0,active=0,maximumActive=0,holdingReads=0;const events:Array<{kind:string;data:any}>=[],jobs=[0,0,0,0],completions:number[]=[];let job=0;
writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));const prior=readFileSync(old);
const rpc=new PilotRpc({directory:join(dir,'run'),runId:'independent-sustained-provider',baselinePaths:[old],priorPhysicalSettled:true,...nativePaperRpcConfiguration(true),maxResponseBytes:256*1024*1024,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},record:(kind,data)=>events.push({kind,data}),fetcher:(async(_u,init)=>{calls++;active++;maximumActive=Math.max(maximumActive,active);const q=JSON.parse(String(init?.body));if(q.method==='getMultipleAccounts'&&++holdingReads===9)return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{at+=1000;active--;reject(Error('one injected settled timeout'));},{once:true}));at+=80;active--;return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:[]}));})as typeof fetch});
try{
 const end=at+120000;let nextHeldAt=at,lastCompleted:number|null=null;
 while(at<end){
  if(at>=nextHeldAt){const began=at;nextHeldAt=began+2000;assert.deepEqual(await rpc.callProtection('getMultipleAccounts',[],undefined,{completeBy:nativePaperProtectionReadDeadline(at,lastCompleted)}),[]);lastCompleted=at;completions.push(at);continue;}
  const u=rpc.usage(),view=pilotLowerPriorityAdmission({now:at,endAt:Number.MAX_SAFE_INTEGER,held:1,lastUsable:lastCompleted,nextPendingAt:null,operationBoundMs:1700});
  if(view.admitted&&nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,persistent:true,usage:u})&&!u.rpcDispatchWindow.physicalBusy&&u.rpcDispatchWindow.readyAt<=at){await rpc.call('getSlot',[],undefined,{latestStartAt:view.latestStartAt,operationBoundMs:1700});const index=job++%4;jobs[index]=jobs[index]!+1;continue;}
  at+=25;
 }
 const starts=events.filter(e=>e.kind==='component-physical-start').map(e=>e.data.at as number),gaps=completions.slice(1).map((n,i)=>n-completions[i]!);let maximumMinute=0,maximumShort=0;
 for(let i=0;i<starts.length;i++){const n=starts[i]!;const minute=starts.slice(0,i+1).filter(x=>x>n-60000).length,short=starts.slice(0,i+1).filter(x=>x>n-10000).length;maximumMinute=Math.max(maximumMinute,minute);maximumShort=Math.max(maximumShort,short);assert.ok(minute<=90);assert.ok(short<=20);if(i)assert.ok(n-starts[i-1]!>=250);}
 assert.equal(maximumActive,1);assert.ok(Math.max(...gaps)<=4000);assert.ok(jobs.every(n=>n>0));assert.ok(Math.max(...jobs)-Math.min(...jobs)<=1);assert.equal(rpc.usage().protectionRecovery.successesAfterRetry,1);assert.equal(starts.length,calls);
 console.log(JSON.stringify({elapsedFakeMs:at-200000,physicalStarts:calls,maximumMinute,maximumShort,maximumActive,heldCompletions:completions.length,maximumCompletedGapMs:Math.max(...gaps),discretionaryJobs:jobs,successesAfterRetry:rpc.usage().protectionRecovery.successesAfterRetry,measuredUncertaintyBytes:rpc.usage().uncertainResponseBytes,scope:'actual RPC/gate and actual launcher admission under four synthetic runnable discretionary queues; not real market or audit coverage',providerRequests:0}));
}finally{rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(dir,{recursive:true,force:true});}

});
