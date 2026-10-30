/** Isolated offline shared-gate controls. Injected responses establish software
 * behavior only, not public-RPC entitlement or sustained provider capacity. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PilotRpc,type PilotRpcOptions} from '../src/pilot-rpc.js';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(options:Partial<PilotRpcOptions>={},priorStarts:number[]=[]){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-minute-gate-')),old=join(directory,'old.json');let at=200000,mono=200000,active=0,maximumActive=0;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:priorStarts.length,bytes:123,lastObservedAt:priorStarts.at(-1)??2000,starts:priorStarts,pending:[]}),{mode:0o600});const before=readFileSync(old),starts:Array<{at:number;method:string}>=[];
 const fetcher=(async(_url,init)=>{assert.equal(active,0);active++;maximumActive=Math.max(maximumActive,active);try{const body=JSON.parse(String(init?.body));starts.push({at,method:body.method});at+=5;mono+=5;return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:123}));}finally{active--;}}) as typeof fetch;
 let client:PilotRpc;try{client=new PilotRpc({directory:join(directory,'run'),runId:'offline-minute-gate',baselinePaths:[old],priorPhysicalSettled:true,priorCooldownUntil:0,maxStartsPer10s:20,now:()=>at,monotonic:()=>mono,sleep:async ms=>{at+=ms;mono+=ms;},fetcher,...options});}catch(error){assert.deepEqual(readFileSync(old),before);rmSync(directory,{recursive:true,force:true});throw error;}
 return {client,directory,old,before,starts,get at(){return at;},get maximumActive(){return maximumActive;},advance(ms:number){at+=ms;mono+=ms;},close(){client.close();assert.deepEqual(readFileSync(old),before,'historical consumed usage is never reset');rmSync(directory,{recursive:true,force:true});}};
}
function assertGate(starts:Array<{at:number}>,perMinute:number){for(let i=0;i<starts.length;i++){const at=starts[i]!.at;if(i)assert.ok(at-starts[i-1]!.at>=250);assert.ok(starts.filter(s=>s.at<=at&&s.at>at-10000).length<=20);assert.ok(starts.filter(s=>s.at<=at&&s.at>at-60000).length<=perMinute);}}

test('default60/minute remains unchanged; explicit60..90 is validated before any source work',()=>{
 const f=fixture();assert.deepEqual(f.client.usage().requestLimits,{maxStartsPer10s:20,maxGetTransactionStartsPer10s:null,maxStartsPerMinute:60,minSpacingMs:250,physicalInFlight:1});f.close();
 for(const bad of [0,59,59.5,60.5,90.5,91,600,NaN,Infinity,null,'90'])assert.throws(()=>fixture({maxStartsPerMinute:bad as any}),/PILOT_RPC_INVALID_OPTIONS/);
 for(const allowed of [60,61,75,90]){const f=fixture({maxStartsPerMinute:allowed});assert.equal(f.client.usage().requestLimits.maxStartsPerMinute,allowed);f.close();}
});

test('explicit90 flows into every chapter and durable authorization/status while default60 paces the61st start',async()=>{
 const baseline=fixture(),research=fixture({maxStartsPerMinute:90,chapterUnits:17});try{
  for(let i=0;i<61;i++)await baseline.client.call('getSlot');for(let i=0;i<91;i++)await research.client.call('getSlot');
  assert.ok(baseline.starts[60]!.at-baseline.starts[0]!.at>=60000);assert.ok(research.starts[60]!.at-research.starts[0]!.at<60000);assert.ok(research.starts[90]!.at-research.starts[0]!.at>=60000);assertGate(baseline.starts,60);assertGate(research.starts,90);assert.equal(research.maximumActive,1);assert.equal(research.client.usage().newUnits,91);assert.equal(research.client.usage().cumulativeUnits,91);assert.equal(research.client.usage().automaticRequestRetries,0);assert.equal(research.client.usage().chapter,6);
  const authorization=JSON.parse(readFileSync(join(research.directory,'run/authorization.json'),'utf8')),status=JSON.parse(readFileSync(join(research.directory,'run/status.json'),'utf8'));assert.equal(authorization.requestLimits.maxStartsPerMinute,90);assert.equal(status.requestLimits.maxStartsPerMinute,90);assert.equal(status.chapterUsage.limits.maxStartsPerMinute,90);
  for(const path of [...research.client.usage().chapterPaths.filter(path=>path!==research.old),research.client.usage().activeChapterPath!]){const chapter=JSON.parse(readFileSync(path,'utf8'));assert.equal(chapter.limits.maxStartsPerMinute,90);assert.equal(chapter.limits.maxStartsPer10s,20);assert.equal(chapter.limits.minSpacingMs,250);}
 }finally{baseline.close();research.close();}
});

test('raising only the minute ceiling cannot bypass physical serialization or eight getTransaction starts/10 seconds',async()=>{
 const f=fixture({maxStartsPerMinute:90,maxGetTransactionStartsPer10s:8});try{
  for(let i=0;i<8;i++)await f.client.call('getTransaction');const before=f.client.usage(),at=f.at;await assert.rejects(f.client.call('getTransaction'),/PILOT_RPC_METHOD_PACING/);assert.equal(f.at,at);assert.equal(f.client.usage().newUnits,8);assert.equal(f.client.usage().newAccountedResponseBytes,before.newAccountedResponseBytes);await f.client.call('getMultipleAccounts');assert.equal(f.client.usage().methodPacing.getTransactionStartsLast10s.length,8);
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),control=f.client.operateData({transport:'ws',method:'ping'},async op=>{await hold;op.completeResponse();});await turn();await assert.rejects(f.client.call('getSlot'),/PILOT_RPC_PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.client.usage().inFlight,1);release();await control;assert.equal(f.client.usage().inFlight,0);assert.equal(f.client.usage().newUnits,10);assert.equal(f.client.usage().requestLimits.maxGetTransactionStartsPer10s,8);assert.equal(f.client.usage().requestLimits.physicalInFlight,1);assertGate(f.starts,90);
 }finally{f.close();}
});

test('a90/minute local option inherits recent starts and never refunds a refused job or old receipt',async()=>{
 const prior=Array.from({length:90},(_,i)=>155000+i*250),f=fixture({maxStartsPerMinute:90},prior);try{
  const at=f.at;await assert.rejects(f.client.call('getSlot',[],undefined,{latestStartAt:at}),/PILOT_RPC_COMPONENT_DISPATCH_EXPIRED/);assert.equal(f.at,at);assert.equal(f.starts.length,0);assert.equal(f.client.usage().newUnits,0);assert.equal(f.client.usage().cumulativeUnits,90);assert.equal(f.client.usage().chapterUsage!.rolling60SecondStarts,90);assert.deepEqual(readFileSync(f.old),f.before);f.advance(15000);await f.client.call('getSlot');assert.equal(f.starts.length,1);assert.equal(f.client.usage().newUnits,1);assert.equal(f.client.usage().cumulativeUnits,91);assert.ok(f.starts[0]!.at>=prior[0]!+60000);
 }finally{f.close();}
});
