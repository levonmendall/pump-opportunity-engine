/** Offline recovery tests use the actual shared PilotRpc/ComponentBudget gate.
 * Sockets, provider responses and elapsed time are synthetic; no provider calls. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {PilotFeeds,type PilotFeedControl,type PilotFeedsOptions} from '../src/pilot-feeds.js';
import {PilotRpc,PilotRpcUnavailable} from '../src/pilot-rpc.js';
import {nativeCandidateWatchControlRequest} from '../src/run-native-candidates.js';
import type {ComponentKind} from '../src/component-budget.js';

const flush=async()=>{for(let i=0;i<64;i++)await Promise.resolve();};
class Socket extends EventEmitter{
  readonly _socket=Object.assign(new EventEmitter(),{bytesRead:200});
  readonly sent:string[]=[];closed=false;terminateRequested=false;delayClose=false;automaticAck=true;
  constructor(readonly endpoint:string){super();}
  send(data:string,callback?:(error?:Error)=>void){const method=JSON.parse(data).method;this.sent.push(method);callback?.();if(this.automaticAck)queueMicrotask(()=>this.ack(method));}
  ack(method:string){if(this.closed)return;const data=Buffer.from(JSON.stringify({message:method==='subscribeMigration'?"Subscribed to 'migration' events.":'Successfully subscribed to token creation events.'}));this._socket.bytesRead+=data.length+4;this._socket.emit('data',data);this.emit('message',data);}
  terminate(){this.terminateRequested=true;if(!this.delayClose)queueMicrotask(()=>this.drop());}
  drop(){if(this.closed)return;this.closed=true;this.emit('close');}
}
function fixture(config:{persistent?:boolean;hangOpen?:boolean;automaticAck?:boolean;admitControl?:PilotFeedsOptions['admitControl'];beforeControl?:(kind:ComponentKind)=>Promise<void>;afterControl?:(kind:ComponentKind)=>void}={}){
  const directory=mkdtempSync(join(tmpdir(),'poe-feed-rpc-recovery-')),old=join(directory,'old.json');
  writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:20,bytes:272634,lastObservedAt:2000,starts:Array.from({length:20},(_,i)=>1000+i),pending:[{id:20,unobservedBytes:2*1024*1024}]}),{mode:0o600});
  const before=readFileSync(old),sockets:Socket[]=[],records:Array<{kind:string;data:any}>=[],refusals:Array<{at:number;code:string}>=[],gaps:unknown[]=[],physical=new Set<number>();
  let at=200000,mono=0,sequence=0,maximumPhysical=0,parkNext=false;
  const timers=new Map<number,{at:number;callback:()=>void}>(),pending:Array<{id:number;resolve:(response:Response)=>void;settled:boolean}>=[],requests:Promise<unknown>[]=[];
  const advance=async(ms:number)=>{assert.ok(ms>=0);const end=mono+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const delta=Math.max(0,next[1].at-mono);at+=delta;mono+=delta;timers.delete(next[0]);next[1].callback();await flush();}if(mono<end){at+=end-mono;mono=end;}await flush();};
  const rpc=new PilotRpc({persistent:config.persistent??true,directory:join(directory,'rpc'),runId:'broad-recovery-fixture',baselinePaths:[old],priorPhysicalSettled:true,now:()=>at,monotonic:()=>mono,sleep:async ms=>{at+=ms;mono+=ms;},record(kind,data){records.push({kind,data});const row=data as {id?:number};if(kind==='component-physical-start'){physical.add(row.id!);maximumPhysical=Math.max(maximumPhysical,physical.size);}else if(kind==='component-physical-settled')physical.delete(row.id!);},fetcher:(async(_url,init)=>{const body=JSON.parse(String(init?.body));if(parkNext){parkNext=false;return new Promise<Response>(resolve=>pending.push({id:body.id,resolve,settled:false}));}return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:123}));}) as typeof fetch});
  const control:PilotFeedControl={async operateData(kind,work,signal,options){await config.beforeControl?.(kind);try{const result=await rpc.operateData(kind,work,signal,options);config.afterControl?.(kind);return result;}catch(e){if(e instanceof PilotRpcUnavailable)refusals.push({at,code:e.code});throw e;}},accountControlBytes:n=>rpc.accountControlBytes(n),noteThrottle:(value,time)=>rpc.noteThrottle(value,time)};
  const feeds=new PilotFeeds({persistent:config.persistent??true,control,amountConvention:'user',record:(kind,data)=>records.push({kind,data}),onMigration(){},onMarketIdentity(){},onMarketActivity(){},onTrade(){assert.fail('no trading in discovery recovery fixture');},onGap:gap=>gaps.push(gap),admitControl:config.admitControl??(()=>nativeCandidateWatchControlRequest(()=>({busy:false,admissionOpen:true,flow:{nextServiceAt:Infinity},at}),1000000))},{now:()=>at,monotonic:()=>mono,setTimer(callback,ms){const id=++sequence;timers.set(id,{at:mono+ms,callback});return id;},clearTimer(id){timers.delete(id as number);},makeSocket(endpoint,options){assert.equal(options.handshakeTimeout,1200);assert.equal(options.followRedirects,false);const socket=new Socket(endpoint);socket.automaticAck=config.automaticAck??true;sockets.push(socket);if(!config.hangOpen)queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;}});
  const settle=(p:typeof pending[number])=>{if(!p.settled){p.settled=true;p.resolve(new Response(JSON.stringify({jsonrpc:'2.0',id:p.id,result:123})));}};
  return {rpc,feeds,sockets,records,refusals,gaps,advance,get now(){return at;},get maximumPhysical(){return maximumPhysical;},async park(){parkNext=true;const count=pending.length,request=rpc.call('getMultipleAccounts',[],undefined,{timeoutMs:1500});requests.push(request);void request.catch(()=>{});await flush();for(let i=0;i<20&&pending.length===count;i++)await new Promise<void>(r=>setImmediate(r));assert.equal(pending.length,count+1);assert.equal(rpc.usage().inFlight,1);return {startedAt:at,async finish(){settle(pending[count]!);assert.equal(await request,123);await flush();}};},async close(){for(const p of pending)settle(p);await Promise.allSettled(requests);await feeds.stop();rpc.close();assert.deepEqual(readFileSync(old),before);rmSync(directory,{recursive:true,force:true});}};
}

test('paired broad-feed retries colliding with a75ms ordinary RPC defer locally and recover in the next spare opportunity',async()=>{
  const f=fixture();try{
    await f.feeds.startDiscovery();await f.feeds.startWatchActivity();assert.equal(f.sockets.length,2);
    f.sockets[0]!.drop();f.sockets[1]!.drop();const gaps=f.gaps.length;
    await f.advance(1950);const request=await f.park(),physicalBefore=f.records.filter(r=>r.kind==='component-physical-start').length;
    await f.advance(50);assert.equal(f.sockets.length,2);assert.equal(f.refusals.length,2);assert.ok(f.refusals.every(r=>r.code==='PHYSICAL_SLOT_OCCUPIED'));assert.equal(f.records.filter(r=>r.kind==='component-physical-start').length,physicalBefore);
    for(const leg of Object.values(f.feeds.usage().marketDiscovery.recovery)){assert.equal(leg.localDeferrals,1);assert.equal(leg.networkReconnects,1);assert.equal(leg.providerBackoffLevel,1);assert.equal(leg.physicalAttempts,1);}
    assert.equal(f.gaps.length,gaps);await f.advance(25);await request.finish();assert.equal(f.now-request.startedAt,75);const settledAt=f.now;
    await f.advance(224);assert.equal(f.sockets.length,2);await f.advance(1);assert.ok(f.sockets.length>2);await f.advance(1000);
    assert.equal(f.sockets.length,4);assert.ok(Object.values(f.feeds.usage().marketDiscovery.sources).every(s=>s.connected));assert.ok(f.now-settledAt<2000,'no inherited60s retry after the real RPC settled');assert.equal(f.maximumPhysical,1);
    assert.ok(Object.values(f.feeds.usage().marketDiscovery.recovery).every(leg=>leg.networkReconnects===1));
    const local=f.records.filter(r=>r.kind==='pilot-feed-local-deferred');assert.equal(local.length,2);assert.ok(local.every(r=>r.data.reason==='PILOT_RPC_PHYSICAL_SLOT_OCCUPIED'&&r.data.physicalAttemptStarted===false));
    assert.deepEqual(f.records.filter(r=>r.kind==='pilot-feed-reconnect-scheduled').map(r=>r.data.delayMs),[2000,2000]);
  }finally{await f.close();}
});

for(const code of ['COMPONENT_ADMISSION_CLOSED','COMPONENT_DISPATCH_EXPIRED'] as const)test(`actual shared gate ${code} refusal before transport consumes no socket or provider backoff`,async()=>{
  let blocked=true;const f=fixture({admitControl:()=>code==='COMPONENT_ADMISSION_CLOSED'?{admissionOpen:()=>!blocked}:blocked?{latestStartAt:1}:{}});
  try{await f.feeds.startDiscovery();assert.equal(f.sockets.length,0);assert.equal(f.refusals.at(-1)?.code,code);const leg=f.feeds.usage().marketDiscovery.recovery.discovery!;assert.equal(leg.localDeferrals,1);assert.equal(leg.networkReconnects,0);assert.equal(leg.providerBackoffLevel,0);assert.equal(f.feeds.usage().firstFailure,null);assert.equal(f.gaps.length,0);blocked=false;await f.advance(250);assert.equal(f.sockets.length,1);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.connected,true);}finally{await f.close();}
});

test('actual shared control cooldown retains its original lower bound without spending reconnect attempts',async()=>{
  const f=fixture();try{const until=f.rpc.noteThrottle('10');await f.feeds.startWatchActivity();assert.equal(f.sockets.length,0);const leg=f.feeds.usage().marketDiscovery.recovery.pumpapi!;assert.equal(leg.providerNotBefore,until);assert.equal(leg.localDeferrals,1);assert.equal(leg.networkReconnects,0);await f.advance(9999);assert.equal(f.sockets.length,0);await f.advance(1);assert.equal(f.sockets.length,1);assert.equal(f.feeds.usage().pumpApiConnected,true);assert.equal(f.rpc.controlCooldownUntil(),until);}finally{await f.close();}
});

test('a valid cooldown deadline that elapsed before catch still defers locally',async()=>{
  let once=true;const f=fixture({async beforeControl(){if(once){once=false;throw new PilotRpcUnavailable('COOLDOWN',f.now-1);}}});
  try{await f.feeds.startWatchActivity();const leg=f.feeds.usage().marketDiscovery.recovery.pumpapi!;assert.equal(leg.localDeferrals,1);assert.equal(leg.networkReconnects,0);assert.equal(leg.providerBackoffLevel,0);assert.equal(f.sockets.length,0);await f.advance(249);assert.equal(f.sockets.length,0);await f.advance(1);assert.equal(f.sockets.length,1);assert.equal(f.feeds.usage().pumpApiConnected,true);}finally{await f.close();}
});

test('post-upgrade local subscription refusal closes and settles the old socket before fresh subscription ACKs',async()=>{
  let request:Awaited<ReturnType<ReturnType<typeof fixture>['park']>>|undefined,once=true;
  const config={automaticAck:true,async beforeControl(kind:ComponentKind){if(kind.method==='subscribeNewToken'&&once){once=false;f.sockets[0]!.delayClose=true;request=await f.park();}}},f=fixture(config);
  try{
    await f.feeds.startDiscovery();const old=f.sockets[0]!;assert.deepEqual(old.sent,['subscribeMigration']);assert.equal(old.terminateRequested,true);assert.equal(old.closed,false);assert.equal(f.feeds.usage().discoveryConnected,false);assert.equal(f.feeds.usage().physicalTransportsSettled,false);assert.equal(f.feeds.usage().marketDiscovery.recovery.discovery!.networkReconnects,0);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-migration']!.connected,false);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.connected,false);
    await f.advance(75);await request!.finish();await f.advance(250);assert.equal(f.sockets.length,1,'physical close is required even after the RPC becomes free');
    config.automaticAck=false;old.drop();await f.advance(250);assert.equal(f.sockets.length,2);const fresh=f.sockets[1]!;assert.deepEqual(fresh.sent,['subscribeMigration']);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-migration']!.connected,false);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.connected,false);
    fresh.ack('subscribeNewToken');await flush();assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-migration']!.connected,false);fresh.ack('subscribeMigration');await flush();assert.deepEqual(fresh.sent,['subscribeMigration','subscribeNewToken']);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-migration']!.connected,true);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.connected,false);fresh.ack('subscribeNewToken');await flush();assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.connected,true);assert.equal(f.feeds.usage().marketDiscovery.recovery.discovery!.networkReconnects,0);assert.equal(f.maximumPhysical,1);
  }finally{await f.close();}
});

test('a matching local error after physical control entry still uses failure backoff',async()=>{
  let once=true;const f=fixture({afterControl(kind){if(once&&kind.method==='upgrade'){once=false;throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');}}});
  try{await assert.rejects(f.feeds.startWatchActivity(),/PILOT_RPC_PHYSICAL_SLOT_OCCUPIED/);await flush();const leg=f.feeds.usage().marketDiscovery.recovery.pumpapi!;assert.equal(leg.localDeferrals,0);assert.equal(leg.physicalAttempts,1);assert.equal(leg.networkReconnects,1);assert.equal(leg.providerBackoffLevel,1);assert.equal(f.sockets[0]!.closed,true);await f.advance(1999);assert.equal(f.sockets.length,1);await f.advance(1);assert.equal(f.sockets.length,2);}finally{await f.close();}
});

test('a real transport error already closing the socket is not erased by a simultaneous local subscription refusal',async()=>{
  let once=true;const f=fixture({async beforeControl(kind){if(once&&kind.method==='subscribeMigration'){once=false;const socket=f.sockets[0]!;socket.delayClose=true;socket.emit('error',Error('synthetic transport error'));throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');}}});
  try{await assert.rejects(f.feeds.startDiscovery(),/PILOT_RPC_PHYSICAL_SLOT_OCCUPIED/);let leg=f.feeds.usage().marketDiscovery.recovery.discovery!;assert.equal(leg.localDeferrals,0);assert.equal(leg.networkReconnects,1);assert.equal(f.sockets[0]!.closed,false);const retry=f.records.find(r=>r.kind==='pilot-feed-reconnect-scheduled')!.data;assert.equal(retry.reason,'COMPONENT_WS_TRANSPORT');assert.equal(retry.physicalAttemptStarted,true);await f.advance(100);f.sockets[0]!.drop();leg=f.feeds.usage().marketDiscovery.recovery.discovery!;assert.equal(leg.networkReconnects,1);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-migration']!.lastGapReason,'COMPONENT_WS_TRANSPORT');assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.lastGapReason,'COMPONENT_WS_TRANSPORT');assert.ok(f.gaps.length>0);await f.advance(1900);assert.equal(f.sockets.length,2);}finally{await f.close();}
});

test('a genuine1500ms physical upgrade timeout preserves network backoff and waits for transport settlement',{timeout:10000},async()=>{
  const config={hangOpen:true},f=fixture(config);try{await assert.rejects(f.feeds.startWatchActivity(),/COMPONENT_PHYSICAL_TIMEOUT/);await flush();const leg=f.feeds.usage().marketDiscovery.recovery.pumpapi!;assert.equal(leg.localDeferrals,0);assert.equal(leg.networkReconnects,1);assert.equal(leg.providerBackoffLevel,1);assert.equal(f.feeds.usage().physicalTransportsSettled,true);assert.ok(f.records.some(r=>r.kind==='component-physical-timeout'&&r.data.requestedTimeoutMs===1500));config.hangOpen=false;await f.advance(1999);assert.equal(f.sockets.length,1);await f.advance(1);assert.equal(f.sockets.length,2);assert.equal(f.feeds.usage().pumpApiConnected,true);}finally{await f.close();}
});

test('stopping a locally deferred broad feed cancels retry and never opens a late transport',async()=>{
  const f=fixture({admitControl:()=>({admissionOpen:()=>false})});try{await f.feeds.startDiscovery();assert.equal(f.feeds.usage().marketDiscovery.recovery.discovery!.localDeferrals,1);await f.feeds.stop();await f.advance(10000);assert.equal(f.sockets.length,0);assert.equal(f.feeds.usage().stopped,true);assert.equal(f.feeds.usage().physicalTransportsSettled,true);assert.equal(f.gaps.length,0);}finally{await f.close();}
});

test('finite research retains its nine physical-upgrade ceiling after repeated local subscription refusals',async()=>{
  const f=fixture({persistent:false,async beforeControl(kind){if(kind.method==='subscribeMigration')throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');}});
  try{await f.feeds.startDiscovery();await f.advance(5000);const leg=f.feeds.usage().marketDiscovery.recovery.discovery!;assert.equal(f.sockets.length,9);assert.equal(leg.physicalAttempts,9);assert.equal(leg.desired,false);assert.equal(leg.networkReconnects,0);assert.equal(leg.providerBackoffLevel,0);assert.equal(f.feeds.usage().firstFailure,'PILOT_DISCOVERY_RECONNECT_LIMIT');assert.ok(f.sockets.every(s=>s.closed));}finally{await f.close();}
});
