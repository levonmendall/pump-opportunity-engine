import {wsWire} from './ws-wire-fixture.js';
/** Offline timing reproduction. Real coordinator/native adapter/RPC gate;
 * synthetic sockets, support and response timing. No market or financial claims. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {PublicKey} from '@solana/web3.js';
import {PilotRpc} from '../src/pilot-rpc.js';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {chooseProtectedResearchWork} from '../src/research-dispatch.js';

const MIB=1024*1024,turn=()=>new Promise<void>(r=>setImmediate(r));
const mint='So11111111111111111111111111111111111111112';
class Socket extends EventEmitter {
 readonly _receiver={writableLength:0,_state:0,_bufferedBytes:0,_fragmented:0};
 readonly _socket=Object.assign(new EventEmitter(),{bytesRead:200});
 readonly _sender={sendFrame:(_parts:Buffer[],callback?:()=>void)=>callback?.()};
 readonly controls:string[]=[];
 readyState:number=WebSocket.CONNECTING;
 open(){this.readyState=WebSocket.OPEN;this.emit('open');}
 frame(body:unknown){const data=Buffer.from(JSON.stringify(body));this._socket.bytesRead+=data.length+4;this._socket.emit('data',wsWire(data));this.emit('message',data);}
 send(data:string,callback?:()=>void){const request=JSON.parse(data);this.controls.push(request.method);callback?.();queueMicrotask(()=>this.frame({jsonrpc:'2.0',id:request.id,result:request.method==='logsSubscribe'?100:true}));}
 ping(payload:Buffer,_mask?:unknown,callback?:()=>void){this.controls.push('ping');this._sender.sendFrame([Buffer.from([0x89]),payload]);callback?.();queueMicrotask(()=>{this._socket.bytesRead+=payload.length+2;this._socket.emit('data',wsWire(payload,10));this.emit('pong',payload);});}
 terminate(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSED;queueMicrotask(()=>this.emit('close',1006));}
}
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'poe-native-settled-')),old=join(directory,'old.json');let at=200000,mono=200000,hang=false,contextOnce=false,pendingId:number|null=null,watchdog:(()=>void)|null=null,settle!:(r:Response)=>void;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:2,bytes:1000,lastObservedAt:1000,starts:[900,1000],pending:[]}),{mode:0o600});
 const oldBytes=readFileSync(old),sockets:Socket[]=[],records:Array<{kind:string;data:any}>=[],fetches:string[]=[];
 const rpc=new PilotRpc({directory:join(directory,'rpc'),runId:'settled-timeout-recovery',baselinePaths:[old],priorPhysicalSettled:true,maxStartsPer10s:20,now:()=>at,monotonic:()=>mono,sleep:async ms=>{at+=ms;mono+=ms;},record:(kind,data)=>records.push({kind,data}),fetcher:(async(_url,init)=>{const request=JSON.parse(String(init?.body));fetches.push(request.method);if(hang){pendingId=request.id;return new Promise<Response>(r=>settle=r);}if(contextOnce){contextOnce=false;return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32016,message:'synthetic minimum context not reached'}}));}return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:123}));}) as typeof fetch});
 let runner:NativeCandidateRunner;
 const flow=new PilotNativeFlow({control:rpc,support:{async validateMany(requests:any[],signal?:AbortSignal,admission?:any){await rpc.call('getMultipleAccounts',[],signal,admission);return {validations:Object.fromEntries(requests.map(r=>{const key=r.mint.toBase58();return [key,{mint:key,pool:canonicalPumpPoolPda(r.mint).toBase58(),at,sourceSlot:10,evidence:'SYNTHETIC_CURRENT_SUPPORT',summary:{marketClockUnixSeconds:Math.floor(at/1000)}}];})),unavailable:{},context:null};}} as any,record:(kind,data)=>records.push({kind,data}),onTrade(){throw Error('NO_SYNTHETIC_TRADE_EXPECTED');},onGap(){},durationMs:120000},{now:()=>at,monotonic:()=>mono,setTimer(fn,ms){if(ms===100)watchdog=fn;return 1;},clearTimer(){},makeSocket(){const socket=new Socket();sockets.push(socket);queueMicrotask(()=>socket.open());return socket as unknown as WebSocket;}});
 runner=new NativeCandidateRunner({rpc,flow,now:()=>at,maximumDeep:1,activeStrategy:'liquidity-resilient-momentum-v3.1',observationAgePolicy:'persistent-observable-market-v1',record:(kind,data)=>records.push({kind,data})});
 // The coordinator owns selected scopes. Seed the ordinary unverified hint so
 // its first step validates the pool outside the selected slots; the next step
 // performs real atomic WATCH/productivity/native admission using that proof.
 // A manually added ownerless transport is correctly retired by reconciliation.
 runner.onMigration({signature:'SYNTHETIC_SCOPE_HINT',feedMint:mint,receivedAt:at});
 return {rpc,flow,runner,directory,oldBytes,old,sockets,records,fetches,get at(){return at;},get mono(){return mono;},advance(ms:number){at+=ms;mono+=ms;},wallOnly(ms:number){at+=ms;},hang(){hang=true;},contextLagOnce(){contextOnce=true;},settle(status?:number){hang=false;settle(status===undefined?new Response('{}'):new Response(JSON.stringify({jsonrpc:'2.0',id:pendingId,result:123}),{status,headers:status===503?{'retry-after':'10'}:undefined}));},watchOne(){watchdog?.();},async close(){await runner.stop();rpc.close();assert.deepEqual(readFileSync(old),oldBytes);rmSync(directory,{recursive:true,force:true});}};
}

async function prepareBinding(f:ReturnType<typeof fixture>){
 assert.equal(await f.runner.step(),'prepare:'+mint);
 assert.equal(f.flow.usage().candidates,0,'passive binding does not own a selected slot');
 assert.equal(f.runner.status().slotProductivity.counts.allocations,0);
 assert.equal(f.runner.status().candidatePreparation.counters.poolReady,1);
 assert.equal(f.fetches.filter(method=>method==='getMultipleAccounts').length,1);
}

test('settled timeout uncertainty does not deadlock native service behind the coordinator planning guard',async()=>{
 const f=fixture();try{
  await prepareBinding(f);f.advance(250);
  assert.equal(await f.runner.step(),'connect');f.advance(250);
  assert.equal(await f.runner.step(),'subscribe');f.advance(250);
  assert.equal(f.flow.snapshot(mint)!.connected,true);
  assert.equal(f.fetches.filter(method=>method==='getMultipleAccounts').length,1,'allocation adopts the original binding without another support request');
  f.hang();await assert.rejects(f.rpc.call('getSlot',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);f.flow.requestHeartbeat();
  const until=f.rpc.cooldownUntil();assert.equal(until,f.at+2000);assert.equal(f.rpc.usage().inFlight,1);
  f.advance(3000);const unresolved=f.rpc.usage();assert.equal(unresolved.dispatchWindow!.physicalBusy,true);
  assert.equal(await f.runner.step(),'wait');assert.equal(f.sockets[0]!.controls.filter(x=>x==='ping').length,0);assert.equal(f.rpc.usage().chapter,1);
  f.settle();await turn();await turn();
  const before=f.rpc.usage(),chapter=before.activeChapterPath!,failed=readFileSync(chapter);
  assert.equal(before.inFlight,0);assert.equal(before.waitingOrOperating,false);assert.equal(before.currentChapterUncertainResponseBytes,2*MIB);
  assert.equal(f.rpc.usage().chapter,1,'observing a planning view does not eagerly close or rewrite the failed chapter');assert.deepEqual(readFileSync(chapter),failed);
  assert.equal(await f.runner.step(),'ping','real native control resumes without any WATCH/legacy upgrade');
  assert.equal(before.rawChapterDispatchWindow!.physicalBusy,true,'the low-level uncertain-operation guard is preserved');
  assert.equal(before.dispatchWindow!.actualPhysicalBusy,false);assert.equal(before.dispatchWindow!.needsChapterRecovery,true);assert.equal(before.dispatchWindow!.recoveryAdmissible,true);assert.equal(before.dispatchWindow!.physicalBusy,false);
  const after=f.rpc.usage();assert.equal(after.chapter,2);assert.equal(after.newUnits,before.newUnits+1);assert.equal(after.uncertainResponseBytes,2*MIB);assert.equal(after.currentChapterUncertainResponseBytes,0);assert.equal(after.fatal,null);assert.equal(f.sockets[0]!.controls.filter(x=>x==='ping').length,1);assert.deepEqual(readFileSync(chapter),failed);
  assert.equal(f.fetches.filter(x=>x==='getSlot').length,1,'no repeated HTTP attempt or legacy control is needed for recovery');
 }finally{await f.close();}
});

test('settled chapter recovery preserves cooldown readiness, raw history, and held/pending priority',async()=>{
 const f=fixture();try{
  await prepareBinding(f);f.advance(250);f.hang();await assert.rejects(f.rpc.call('getSlot',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);
  f.settle();await turn();await turn();const until=f.rpc.cooldownUntil(),units=f.rpc.usage().newUnits;
  const plan=()=>{const u=f.rpc.usage();return chooseProtectedResearchWork({now:f.at,readyAt:u.dispatchWindow!.readyAt,physicalBusy:u.dispatchWindow!.physicalBusy,nextProtectionAt:f.at,otherStartSinceProtection:false,lastUsableEvaluationAt:f.at,observingSince:f.at-1000,candidateWindowActive:true,recoveryActive:true,capacityAvailable:true,startSpacingMs:250,jobs:[]});};
  assert.equal(f.rpc.usage().dispatchWindow!.readyAt,until);assert.equal(f.rpc.usage().dispatchWindow!.physicalBusy,false);assert.equal(plan().decision.kind,'wait');
  const oldChapter=f.rpc.usage().activeChapterPath!,oldChapterBytes=readFileSync(oldChapter),httpStarts=f.fetches.length;
  f.advance(250);assert.ok(f.at<until,'HTTP cooldown remains active after mandatory shared spacing');
  assert.equal(await f.runner.step(),'connect','settled HTTP failure does not block an independent native control');assert.equal(f.sockets.length,1);assert.equal(f.rpc.usage().newUnits,units+1);assert.equal(f.rpc.cooldownUntil(),until);assert.deepEqual(readFileSync(oldChapter),oldChapterBytes);
  await assert.rejects(f.rpc.call('getSlot'),/COOLDOWN/);assert.equal(f.fetches.length,httpStarts,'HTTP retry stays blocked even after the same gate recovers for control');
  f.advance(until-f.at);
  const protection=plan();assert.equal(protection.decision.kind,'protection');assert.equal(protection.candidateDisposition,'suspend');
  const u=f.rpc.usage(),pending=chooseProtectedResearchWork({now:f.at,readyAt:u.dispatchWindow!.readyAt,physicalBusy:u.dispatchWindow!.physicalBusy,nextProtectionAt:f.at+2000,otherStartSinceProtection:false,lastUsableEvaluationAt:f.at,observingSince:f.at-1000,candidateWindowActive:true,recoveryActive:false,capacityAvailable:true,startSpacingMs:250,jobs:[{id:'unresolved-exit',kind:'pending',enqueuedAt:f.at,eligibleAt:f.at,deadlineAt:f.at+1800,operationBoundMs:500}]});
  assert.equal(pending.decision.kind,'job');if(pending.decision.kind==='job')assert.equal(pending.decision.job.id,'unresolved-exit');assert.equal(pending.candidateDisposition,'suspend');
  assert.equal(f.rpc.usage().chapter,2);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);assert.deepEqual(readFileSync(oldChapter),oldChapterBytes);
 }finally{await f.close();}
});

test('control cooldown is enforced at native admission without blocking unrelated HTTP or losing monotonic wait',async()=>{
 const f=fixture();try{
  await f.rpc.call('getSlot');const until=f.rpc.noteThrottle('10',f.at),units=f.rpc.usage().newUnits;let controls=0;
  await assert.rejects(f.rpc.operateData({transport:'ws',method:'ping'},async op=>{controls++;op.completeResponse();}),/COOLDOWN/);assert.equal(controls,0);assert.equal(f.rpc.usage().newUnits,units);assert.equal(f.rpc.usage().dispatchWindow!.readyAt,until);
  assert.equal(await f.rpc.call('getSlot'),123,'Portal-only cooldown does not block independent HTTP');
  const mono=f.mono;f.wallOnly(20000);const u=f.rpc.usage();assert.ok(u.dispatchWindow!.readyAt>=f.at+(until-200000-(mono-200000)));
  await assert.rejects(f.rpc.operateData({transport:'ws',method:'ping'},async op=>{controls++;op.completeResponse();}),/COOLDOWN/);assert.equal(controls,0);
  f.advance(until-mono);await f.rpc.operateData({transport:'ws',method:'ping'},async op=>{controls++;op.completeResponse();});assert.equal(controls,1);
 }finally{await f.close();}
});


test('native planner defers a settled context-floor cooldown without disconnecting healthy scopes',async()=>{
 const f=fixture();try{
  await prepareBinding(f);f.advance(250);assert.equal(await f.runner.step(),'connect');f.advance(250);assert.equal(await f.runner.step(),'subscribe');f.advance(250);
  f.contextLagOnce();await assert.rejects(f.rpc.call('getSignaturesForAddress'),/COMPONENT_RPC_ERROR_-32016/);await turn();f.flow.requestHeartbeat();
  const before=f.rpc.usage(),gaps=f.flow.usage().gaps;assert.equal(before.inFlight,0);assert.equal(before.currentChapterUncertainResponseBytes,0);assert.equal(before.fatal,null);assert.equal(before.dispatchWindow!.readyAt,f.at+2000);
  assert.equal(await f.runner.step(),'wait');assert.equal(f.flow.snapshot(mint)!.connected,true);assert.equal(f.flow.usage().gaps,gaps);assert.equal(f.sockets[0]!.controls.filter(x=>x==='ping').length,0);
  f.advance(250);assert.equal(await f.runner.step(),'ping','shared spacing elapses before HTTP cooldown; independent liveness may proceed');assert.ok(f.rpc.cooldownUntil()>f.at);await assert.rejects(f.rpc.call('getSlot'),/COOLDOWN/);assert.equal(f.flow.snapshot(mint)!.connected,true);assert.equal(f.flow.usage().gaps,gaps);assert.equal(f.rpc.usage().chapter,2);
 }finally{await f.close();}
});


for(const lateStatus of [200,503])test(`real shared gate: failed support refresh retains fresh capture through lateHTTP${lateStatus} physical settlement`,async()=>{
 const f=fixture();try{
  await prepareBinding(f);f.advance(250);assert.equal(await f.runner.step(),'connect');f.advance(250);assert.equal(await f.runner.step(),'subscribe');f.advance(250);f.advance(20569);
  const prior=f.flow.snapshot(mint)!,socket=f.sockets[0]!;f.flow.requestSupportRefresh();f.hang();assert.deepEqual(await f.flow.service(),{kind:'deferred',reason:'PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'});f.advance(1249);
  assert.equal(f.rpc.usage().inFlight,1);assert.equal(f.flow.snapshot(mint)!.connected,true);assert.equal(f.flow.snapshot(mint)!.hasQualityLoss,false);assert.deepEqual(f.flow.snapshot(mint)!.supportContext,prior.supportContext);assert.equal(socket.readyState,WebSocket.OPEN);const count=f.rpc.usage().newUnits;
  f.advance(2500);f.flow.requestHeartbeat();assert.equal(await f.runner.step(),'wait');assert.equal(f.rpc.usage().newUnits,count);assert.equal(socket.controls.filter(x=>x==='ping').length,0);assert.equal(f.flow.usage().gaps,0);
  const failedPath=f.rpc.usage().activeChapterPath!;f.settle(lateStatus);await turn();await turn();assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);assert.deepEqual(f.flow.snapshot(mint)!.supportContext,prior.supportContext,'late response is not admitted as a fresh successful refresh');assert.equal(f.flow.usage().gaps,0);
  f.advance(250);assert.equal((await f.flow.service()).kind,lateStatus===503?'ping':'support','physical settlement resumes the appropriate domain, not an extra provider budget');const settledArchive=readFileSync(failedPath);
  if(lateStatus===200){assert.equal((await f.flow.service()).kind,'ping');assert.ok(f.flow.snapshot(mint)!.supportContext!.availableAt>prior.supportContext!.availableAt);assert.equal(f.flow.snapshot(mint)!.openedAt,prior.openedAt);assert.equal(f.flow.usage().gaps,0);}
  else{const until=f.rpc.cooldownUntil();assert.ok(until>=f.at+9000);const n=f.fetches.length;await assert.rejects(f.rpc.call('getSlot'),/COOLDOWN/);assert.equal(f.fetches.length,n);f.advance(10000);f.watchOne();assert.equal(f.flow.snapshot(mint)!.sourceSupportFresh,false);assert.equal(f.flow.snapshot(mint)!.hasQualityLoss,true);assert.equal(socket.readyState,WebSocket.OPEN,'actual support expiry is scoped; no fabricated source success');}
  assert.deepEqual(readFileSync(failedPath),settledArchive,'the physically settled archived chapter is unchanged by later work');
 }finally{await f.close();}
});

test('real shared gate: support can actually expire while its failed HTTP request remains physically unsettled',async()=>{
 const f=fixture();try{
  await prepareBinding(f);f.advance(250);assert.equal(await f.runner.step(),'connect');f.advance(250);assert.equal(await f.runner.step(),'subscribe');f.advance(250);f.flow.requestSupportRefresh();f.hang();assert.equal((await f.flow.service()).kind,'deferred');assert.equal(f.rpc.usage().inFlight,1);f.advance(31000);f.watchOne();assert.equal(f.flow.snapshot(mint)!.sourceSupportFresh,false);assert.equal(f.flow.snapshot(mint)!.hasQualityLoss,true);assert.equal(f.flow.usage().gaps,1);const n=f.rpc.usage().newUnits;assert.equal(await f.runner.step(),'wait');assert.equal(f.rpc.usage().newUnits,n);assert.equal(f.sockets.length,1);assert.equal(f.sockets[0]!.readyState,WebSocket.OPEN);f.settle(200);await turn();await turn();assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);
 }finally{await f.close();}
});
