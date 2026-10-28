/** Offline same-timing replay of a bounded ONE-hot/FIVE-quiet workload.
 * Real shared PilotRpc/ComponentBudget gates; injected responses are not a
 * provider-capacity experiment, market audit or position-protection proof. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PilotRpc} from '../src/pilot-rpc.js';

const MIB=1024*1024,START=200000,CYCLES=18,BUCKET=10000;
type Purpose='history-hot'|'history-quiet'|'support'|'ping';
type Job={cycle:number;key:string;purpose:Purpose;eligibleAt:number;deadlineAt:number};
type Completion=Job&{startedAt:number;completedAt:number;durationMs:number};
const purposeCounts=()=>({'history-hot':0,'history-quiet':0,support:0,ping:0});
function arrivals():Job[]{
 const rows:Job[]=[];
 for(let cycle=0;cycle<CYCLES;cycle++){
  const eligibleAt=START+cycle*BUCKET,deadlineAt=eligibleAt+BUCKET;
  // All four hot pages belong to one required audit cohort, never four windows.
  for(const [purpose,count] of [['ping',1],['support',1],['history-hot',4],['history-quiet',5]] as const)for(let i=0;i<count;i++)rows.push({cycle,key:purpose+':'+i,purpose,eligibleAt,deadlineAt});
 }
 return rows;
}
function directory(){const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-minute-trace-')),old=join(root,'old.json');writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:2,bytes:100,lastObservedAt:1000,starts:[900,1000],pending:[]}),{mode:0o600});return {root,old,before:readFileSync(old)};}
async function replay(maxStartsPerMinute:60|90,responseMs:number,jitterMs=0){
 const f=directory();let at=START,current:Job|null=null,physical=0,maximumPhysical=0;const starts:number[]=[],completed:Completion[]=[],missed:Array<Job&{reason:string}>=[];
 const rpc=new PilotRpc({directory:join(f.root,'rpc'),runId:'offline-minute-'+maxStartsPerMinute,durationMs:190000,maxUnits:200,maxResponseBytes:32*MIB,maxStartsPerMinute,maxStartsPer10s:20,priorPhysicalSettled:true,baselinePaths:[f.old],now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher:(async(_url,options)=>{
  assert.ok(current);assert.equal(physical,0);physical++;maximumPhysical=Math.max(maximumPhysical,physical);const request=JSON.parse(String(options?.body)),startedAt=at;starts.push(at);at+=responseMs;physical--;
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{classification:'SYNTHETIC-RESPONSE',purpose:current.purpose,startedAt}}));
 }) as typeof fetch});
 try{
  for(const job of arrivals()){
   current=job;at=Math.max(at,job.eligibleAt)+jitterMs;let startedAt:number|null=null;
   const duration=job.purpose==='ping'?5:responseMs;
   try{
    if(job.purpose==='ping')await rpc.operateData({transport:'ws',method:'ping'},async operation=>{assert.equal(physical,0);physical++;maximumPhysical=Math.max(maximumPhysical,physical);startedAt=at;starts.push(at);at+=5;physical--;operation.completeResponse();},undefined,{latestStartAt:job.deadlineAt-duration,timeoutMs:1500});
    else{await rpc.call(job.purpose==='support'?'getMultipleAccounts':'getSignaturesForAddress',[],undefined,{latestStartAt:job.deadlineAt-duration,timeoutMs:1500});startedAt=starts.at(-1)!;}
    assert.ok(startedAt!==null);if(at>job.deadlineAt)missed.push({...job,reason:'VALIDATED_INFORMATION_AFTER_COHORT_DEADLINE'});else completed.push({...job,startedAt,completedAt:at,durationMs:at-startedAt});
   }catch(error){missed.push({...job,reason:error instanceof Error?error.message:'UNKNOWN'});}
  }
  const byPurpose=purposeCounts();for(const row of completed)byPurpose[row.purpose]++;
  let hotCohorts=0,quietCohorts=0,hotWithinExistingTwoSecondBound=0,maximumCohortLatencyMs=0;
  for(let cycle=0;cycle<CYCLES;cycle++){
   const hot=completed.filter(r=>r.cycle===cycle&&r.purpose==='history-hot');
   if(hot.length===4){hotCohorts++;const span=hot.at(-1)!.completedAt-hot[0]!.startedAt;if(span<=2000)hotWithinExistingTwoSecondBound++;}
   for(const row of completed.filter(r=>r.cycle===cycle&&r.purpose==='history-quiet'))quietCohorts++;
   for(const row of completed.filter(r=>r.cycle===cycle))maximumCohortLatencyMs=Math.max(maximumCohortLatencyMs,row.completedAt-row.eligibleAt);
  }
  const maximumRolling=(window:number)=>Math.max(0,...starts.map(t=>starts.filter(s=>s<=t&&s>t-window).length));
  const usage=rpc.usage();assert.equal(usage.newUnits,starts.length);assert.equal(usage.automaticRequestRetries,0);assert.equal(maximumPhysical,1);assert.ok(starts.every((s,i)=>i===0||s-starts[i-1]!>=250));assert.ok(maximumRolling(10000)<=20);assert.ok(maximumRolling(60000)<=maxStartsPerMinute);
  return {classification:'OFFLINE_FIXED_RESPONSE_TIMING_RESCHEDULING',maxStartsPerMinute,responseMs,jitterMs,offeredJobs:198,offeredJobsPerMinute:66,completedJobs:completed.length,missedJobs:missed.length,byPurpose,hotCohorts,quietCohorts,hotWithinExistingTwoSecondBound,maximumCohortLatencyMs,maximumRollingMinuteStarts:maximumRolling(60000),maximumRollingTenSecondStarts:maximumRolling(10000),maximumPhysical,missReasons:[...new Set(missed.map(r=>r.reason))],requestBytesAndMarketSemantics:'not measured; synthetic response bodies only',holdingProtection:'not part of this trace'};
 }finally{rpc.close();assert.deepEqual(readFileSync(f.old),f.before);rmSync(f.root,{recursive:true,force:true});}
}

for(const responseMs of [667,680])test('same '+responseMs+'ms response trace separates60/minute arithmetic from proposed90/minute scheduling',async t=>{
 const sixty=await replay(60,responseMs),ninety=await replay(90,responseMs);
 assert.equal(sixty.completedJobs,180);assert.equal(sixty.missedJobs,18);assert.ok(sixty.missReasons.every(r=>r.includes('DISPATCH_EXPIRED')));assert.equal(ninety.completedJobs,198);assert.equal(ninety.missedJobs,0);assert.equal(ninety.hotCohorts,18);assert.equal(ninety.quietCohorts,90);
 // Even an uncongested four-page audit exceeds the CURRENT whole-audit bound.
 assert.ok(4*responseMs>2000);assert.equal(ninety.hotWithinExistingTwoSecondBound,0);assert.equal(sixty.hotWithinExistingTwoSecondBound,0);assert.ok(ninety.maximumCohortLatencyMs<=10000);
 t.diagnostic(JSON.stringify({existingTwoSecondAuditMinimumMs:4*responseMs,sixty,ninety}));
});
for(const jitterMs of [50,100])test('synthetic '+jitterMs+'ms dispatch jitter on the proposed90/minute one-hot trace',async t=>{
 const replayed=await replay(90,680,jitterMs);assert.equal(replayed.completedJobs,198);assert.equal(replayed.missedJobs,0);assert.equal(replayed.hotWithinExistingTwoSecondBound,0);t.diagnostic(JSON.stringify(replayed));
});
test('synthetic slow serial responses still lose deadlines at90/minute',async t=>{
 const replayed=await replay(90,1400,100);assert.ok(replayed.missedJobs>0);assert.ok(replayed.completedJobs<198);assert.equal(replayed.maximumPhysical,1);assert.ok(replayed.hotCohorts<18||replayed.quietCohorts<90);t.diagnostic(JSON.stringify(replayed));
});
test('real physical-timeout settlement guard cannot be removed by the optional minute envelope',async t=>{
 const f=directory();let at=START,resolveFetch!:(r:Response)=>void,invocations=0;
 const rpc=new PilotRpc({directory:join(f.root,'rpc'),runId:'offline-minute-timeout',maxStartsPerMinute:90,maxStartsPer10s:20,priorPhysicalSettled:true,baselinePaths:[f.old],now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher:(async(_url,options)=>{invocations++;const request=JSON.parse(String(options?.body));if(invocations===1)return new Promise<Response>(resolve=>{resolveFetch=resolve;});return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:123}));}) as typeof fetch});
 try{
  await assert.rejects(rpc.call('getSignaturesForAddress',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.equal(rpc.usage().inFlight,1);at+=3000;await assert.rejects(rpc.call('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(invocations,1);assert.throws(()=>rpc.close(),/PHYSICAL_SLOT_OCCUPIED/);
  resolveFetch(new Response('{}'));for(let i=0;i<8&&rpc.usage().inFlight;i++)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(rpc.usage().inFlight,0);assert.equal(rpc.usage().uncertainResponseBytes,2*MIB);assert.equal(await rpc.call('getSlot'),123);assert.equal(invocations,2);assert.equal(rpc.usage().newUnits,2);assert.equal(rpc.usage().automaticRequestRetries,0);t.diagnostic('Synthetic timeout: one real timer expires; physical gate stays occupied through late settlement. No successful audit or protection interval is claimed.');
 }finally{rpc.close();assert.deepEqual(readFileSync(f.old),f.before);rmSync(f.root,{recursive:true,force:true});}
});
