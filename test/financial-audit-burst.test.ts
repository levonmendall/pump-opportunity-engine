/** OFFLINE capacity/router regression. Actual PilotRpc and the actual launcher
 * request router, synthetic fast responses; not NativeRunner audit validation,
 * real market coverage, liquidation evidence or live provider capacity. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PilotRpc,PilotRpcUnavailable} from '../src/pilot-rpc.js';
import {PUBLICNODE_HISTORY_ROUTE} from '../src/component-transport.js';
import {runNativePaper,nativePaperRpcConfiguration,nativePaperRequestOperationBound,nativePaperProtectionReadDeadline,nativePaperSourceWorkAdmission} from '../src/run-native-paper.js';

test('twelve ready audit pages use idle real capacity beyond optional lookup smoothing',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-audit-burst-')),old=join(dir,'prior.json');let at=200000,calls=0,active=0,maximumActive=0;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));const prior=readFileSync(old),starts:number[]=[];
 const rpc=new PilotRpc({directory:join(dir,'run'),runId:'independent-ready-audit-burst',baselinePaths:[old],priorPhysicalSettled:true,...nativePaperRpcConfiguration(true),historyRoute:PUBLICNODE_HISTORY_ROUTE.version,priorHistoryCooldownUntil:0,maxResponseBytes:256*1024*1024,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},record:(kind,data)=>{if(kind==='component-physical-start')starts.push((data as any).at);},fetcher:(async(_u,init)=>{calls++;active++;maximumActive=Math.max(maximumActive,active);const q=JSON.parse(String(init?.body));at+=100;active--;return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:[]}));})as typeof fetch});
 try{
  const source=runNativePaper.toString(),begin=source.search(/const\s+requestOptions\s*=/),rest=source.slice(begin),end=rest.search(/;\s*const\s+market\s*=/);assert.ok(begin>=0&&end>0,'extract actual complete request-options and scheduled-router closure');
  const owner={current:'source'},holder:any={},context:any={__name:(f:unknown)=>f,holder,currentLedger:{state:()=>({positions:{'fixture-held':{units:'1'}},pending:{}})},workOwner:owner,currentRpc:rpc,service:true,Date:{now:()=>at},endAt:Number.MAX_SAFE_INTEGER,stopped:false,lastCompleted:null,manifest:{controlCooldownUntil:0},PilotRpcUnavailable,nativePaperRequestOperationBound,nativePaperProtectionReadDeadline,nativePaperSourceWorkAdmission,lowerView:()=>({admitted:true,latestStartAt:Number.MAX_SAFE_INTEGER}),sourceAdmission:()=>true,sourceInformationAdmission:()=>true,optionalAdmission:()=>true,engine:{deadlineView:()=>({targets:[{ready:true,prospective:false,serviceableBeforeDeadline:true}]})}};
  runInNewContext(rest.slice(0,end)+';holder.scheduled=scheduled;',context,{timeout:1000});
  const jobs=[0,0,0,0],began=at,until=began+10000;let nextHeld=at,held=0,optionalRefused=false,auditsCompletedAt:number|null=null;
  while(at<until){
   if(at>=nextHeld){const started=at;owner.current='protection';await holder.scheduled.call('getMultipleAccounts');context.lastCompleted=at;held++;nextHeld=started+2000;continue;}
   const ready=jobs.findIndex(n=>n<3);
   if(ready>=0){
    owner.current='source';
    if(!optionalRefused&&jobs.reduce((n,x)=>n+x,0)===9){const priorCalls=calls;await assert.rejects(holder.scheduled.call('getSlot'),/ADMISSION_CLOSED/);assert.equal(calls,priorCalls,'the postponed optional lookup is never a physical request');optionalRefused=true;}
    const pool=String(ready+1).repeat(32);await holder.scheduled.call('getSignaturesForAddress',[pool,{limit:1000,commitment:'confirmed'}],undefined,{queryTimeoutScope:'independent-history'});jobs[ready]=jobs[ready]!+1;
    if(jobs.every(n=>n===3))auditsCompletedAt=at;continue;
   }
   at+=25;
  }
  assert.deepEqual(jobs,[3,3,3,3]);assert.equal(held,5);assert.ok(auditsCompletedAt!==null&&auditsCompletedAt<until);assert.equal(optionalRefused,true);assert.equal(calls,17);assert.equal(maximumActive,1);assert.equal(starts.length,17);
  for(let i=0;i<starts.length;i++){if(i)assert.ok(starts[i]!-starts[i-1]!>=250);assert.ok(starts.slice(0,i+1).filter(n=>n>starts[i]!-10000).length<=20);assert.ok(starts.slice(0,i+1).filter(n=>n>starts[i]!-60000).length<=90);}
  t.diagnostic(JSON.stringify({scope:'actual request router and provider budget only; full NativeRunner timing/qualification not claimed',auditReads:12,heldReads:held,optionalPhysicalReads:0,physicalReads:calls,auditReadsCompletedAfterMs:auditsCompletedAt!-began,maximumPhysicalInFlight:maximumActive,providerRequests:0}));
 }finally{rpc.close();assert.deepEqual(readFileSync(old),prior);rmSync(dir,{recursive:true,force:true});}
});
