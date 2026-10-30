/** Actual source93 RPC gate over a synthetic, valid pacing chronology.
 * No provider calls, account reads or financial actions. The caller3s timer is
 * the unchanged production whole-context bound, not a physical RPC timeout. */
import {test}from'node:test';import assert from'node:assert/strict';
import{mkdtempSync,readFileSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{PilotRpc}from'../src/pilot-rpc.js';import{heldPricingFailureCode}from'../src/research-held-market.js';
import{nativePaperManagementReserve}from'../src/run-native-paper.js';
const MIB=1024*1024,T=200000,turn=()=>new Promise<void>(r=>setImmediate(r));
function fixture(starts:number[]){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-held-abort-')),old=join(directory,'prior.json');let at=T,physical=0;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:starts.length,bytes:7,lastObservedAt:starts.at(-1),starts,pending:[{id:starts.length,unobservedBytes:2*MIB}]}),{mode:0o600});const original=readFileSync(old);
 const records:Array<{kind:string;data:any}>=[],sleeps:Array<{at:number;requestedMs:number;aborted:boolean}>=[];
 const rpc=new PilotRpc({directory:join(directory,'rpc'),runId:'synthetic-held-abort',persistent:true,profile:'candidate-native-two-hour-90-research-v1',maxStartsPerMinute:90,maxStartsPer10s:20,baselinePaths:[old],priorPhysicalSettled:true,now:()=>at,monotonic:()=>at,
  sleep:async(ms,signal)=>{const row={at,requestedMs:ms,aborted:false};sleeps.push(row);if(ms<=3000){at+=ms;return;}await new Promise<void>((_resolve,reject)=>{const abort=()=>{row.aborted=true;at+=3000;reject(Error('COMPONENT_ABORTED'));};if(signal?.aborted)abort();else signal!.addEventListener('abort',abort,{once:true});});},
  fetcher:(async(_url,init)=>{physical++;const request=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:123}));})as typeof fetch,record:(kind,data)=>records.push({kind,data})});
 return{rpc,records,sleeps,now:()=>at,set:(n:number)=>{at=n;},physical:()=>physical,close(){rpc.close();assert.deepEqual(readFileSync(old),original);rmSync(directory,{recursive:true,force:true});}};
}
async function contextRead(f:ReturnType<typeof fixture>,clip=false){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);try{return await f.rpc.call('getMultipleAccounts',[],controller.signal,clip?{latestStartAt:f.now()+2000}:{});}finally{clearTimeout(timer);controller.abort();}}
test('source93 whole-context cancellation can report ABORTED without any physical request or HTTP timeout',async()=>{
 const f=fixture(Array.from({length:20},(_,i)=>T-1000+i));try{
  const began=performance.now();let error:unknown;try{await contextRead(f);}catch(e){error=e;}await turn();
  assert.match(String(error),/PILOT_RPC_COMPONENT_ABORTED/);assert.equal(heldPricingFailureCode(error),'HELD_PRICING_ABORTED');assert.ok(performance.now()-began>=2900);
  assert.equal(f.physical(),0);assert.equal(f.rpc.usage().newUnits,0);assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.cooldownUntil(),0);
  assert.equal(f.records.filter(r=>r.kind==='component-physical-start').length,0);assert.equal(f.records.filter(r=>r.kind==='component-physical-timeout').length,0);
  assert.equal(f.sleeps.length,1);assert.ok(f.sleeps[0]!.requestedMs>=9000);assert.equal(f.sleeps[0]!.aborted,true);
 }finally{f.close();}
});
test('original latest-start admission rejects an impossible held read immediately instead of consuming its3s context',async()=>{
 const f=fixture(Array.from({length:20},(_,i)=>T-1000+i));try{
  const began=performance.now();await assert.rejects(contextRead(f,true),/COMPONENT_DISPATCH_EXPIRED/);assert.ok(performance.now()-began<1000);
  assert.equal(f.physical(),0);assert.equal(f.sleeps.length,0);assert.equal(f.rpc.usage().newUnits,0);assert.equal(f.rpc.cooldownUntil(),0);
 }finally{f.close();}
});
test('four rolling starts of headroom do not cover the known held obligation before existing minute starts expire',async()=>{
 // Historical85 starts obey20/10s and90/minute. The latest prior start is1.5s
 // old; no fictitious provider saturation, server response or timing is used.
 const starts=[...Array.from({length:70},(_,i)=>T-45000+i*500),...Array.from({length:15},(_,i)=>T-9900+i*600)];
 assert.equal(starts.length,85);assert.ok(starts.every(at=>starts.filter(x=>x>at-10000&&x<=at).length<=20));
 const f=fixture(starts);try{
  assert.equal(await f.rpc.call('getSlot'),123);const allowed=nativePaperManagementReserve(f.rpc.usage(),true);
  assert.equal(allowed.rollingStartHeadroom,4);assert.equal(allowed.rolling10SecondStartHeadroom,4);assert.equal(allowed.candidateWorkWithExposureAllowed,true);
  for(const delay of[2000,4000,6000,8000]){f.set(T+delay);assert.equal(await contextRead(f),123);}
  assert.equal(f.rpc.usage().chapterUsage!.rolling60SecondStarts,90);f.set(T+10000);const before=f.physical();let error:unknown;try{await contextRead(f);}catch(e){error=e;}await turn();
  assert.match(String(error),/PILOT_RPC_COMPONENT_ABORTED/);assert.equal(heldPricingFailureCode(error),'HELD_PRICING_ABORTED');assert.equal(f.physical(),before);assert.equal(f.rpc.usage().newUnits,5);
  assert.equal(f.records.filter(r=>r.kind==='component-physical-timeout').length,0);assert.ok(f.sleeps.some(r=>r.requestedMs===5000&&r.aborted));assert.equal(f.rpc.cooldownUntil(),0);
 }finally{f.close();}
});
