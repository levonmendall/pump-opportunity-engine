import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import {nativeCandidateWatchControlAdmission} from '../src/run-native-candidates.js';
import bs58 from 'bs58';
import {PilotFeeds,type PilotFeedControl,type PilotFeedsOptions} from '../src/pilot-feeds.js';
import type {ComponentKind,ComponentOperation} from '../src/component-budget.js';

const fixtureTx=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:fixtureTx.transaction.slot,supportedPoolEvidence:'OFFLINE_FIXTURE_ONLY'};
const selected=()=>({mint:scope.mint,poolId:scope.pool,pool:'pump-amm',signature:fixtureTx.signature,action:'sell',txSigner:'NOT_THE_VERIFIED_TRADER',quoteAmount:1});
class Socket extends EventEmitter{
  _socket=Object.assign(new EventEmitter(),{bytesRead:200});closed=false;paused=false;pauseCalls=0;resumeCalls=0;readonly pendingFrames:Array<{payload:unknown;bytes?:number}>=[];readonly sent:string[]=[];
  constructor(readonly endpoint:string){super();}
  send(data:string,callback?:(error?:Error)=>void){assert.equal(this.endpoint,'wss://pumpportal.fun/api/data');const method=JSON.parse(data).method;assert.ok(['subscribeMigration','subscribeNewToken'].includes(method));this.sent.push(data);callback?.();queueMicrotask(()=>this.frame({message:method==='subscribeMigration'?"Subscribed to 'migration' events.":'Successfully subscribed to token creation events.'}));}
  frame(payload:unknown,bytes?:number,alreadyDecoded=false){if(this.closed)return;if(this.paused&&!alreadyDecoded){this.pendingFrames.push({payload,bytes});return;}const b=Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));this._socket.bytesRead+=bytes??b.length+4;this._socket.emit('data',b);this.emit('message',b);}
  pause(){this.paused=true;this.pauseCalls++;}
  resume(){this.paused=false;this.resumeCalls++;while(!this.paused&&this.pendingFrames.length){const next=this.pendingFrames.shift()!;this.frame(next.payload,next.bytes);}}
  terminate(){if(this.closed)return;this.closed=true;queueMicrotask(()=>this.emit('close'));}
  drop(){this.closed=true;this.emit('close');}
}
function setup(config:{persistent?:boolean;maximumRecordedBytes?:number;watchOnly?:boolean;marketIntake?:boolean;marketSinkFailure?:boolean;maximumCandidates?:1|2|3;responses?:Record<string,unknown>;onGap?:(gap:{mint?:string;reason:string;at:number},feeds:PilotFeeds)=>void;validationDelay?:number;afterRecordDelay?:number;durationMs?:number;hangOpen?:boolean;admitControl?:PilotFeedsOptions['admitControl'];maxPumpApiBytes?:number;closeBeforeSubscribe?:boolean;refuseUpgrade?:boolean;upgradeStatus?:number;upgradeRetryAfter?:string;chargeFailure?:boolean}={}){
  let at=Date.parse(fixtureTx.fetchedAt),mono=0,sequence=0,active=0,controlBytes=0,rpcCalls=0;const timers=new Map<number,{at:number;callback:()=>void}>(),sockets:Socket[]=[],operations:ComponentKind[]=[],records:Array<{kind:string;data:any}>=[],trades:any[]=[],migrations:any[]=[],watchHints:any[]=[],marketIdentities:any[]=[],marketActivities:any[]=[],marketFeedStatuses:any[]=[],gaps:any[]=[],opens:any[]=[],hints:any[]=[];
  const advance=async(ms:number)=>{const end=mono+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const delta=next[1].at-mono;at+=delta;mono=next[1].at;timers.delete(next[0]);next[1].callback();for(let i=0;i<8;i++)await Promise.resolve();}at+=end-mono;mono=end;for(let i=0;i<8;i++)await Promise.resolve();};
  const control:PilotFeedControl={async operateData<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,signal?:AbortSignal){assert.equal(active,0,'one physical control operation');operations.push(kind);active++;if(config.closeBeforeSubscribe&&kind.method==='subscribeMigration')sockets[0]!.drop();try{return await work({id:operations.length,signal:signal??new AbortController().signal,chargeHttp(){},completeResponse(){}});}finally{active--; }},accountControlBytes(n){if(config.chargeFailure)throw Error('COMPONENT_STORAGE_UNAVAILABLE');controlBytes+=n;},noteThrottle(){return at+15000;}};
  const feedOptions:PilotFeedsOptions={persistent:config.persistent,maximumRecordedBytes:config.maximumRecordedBytes,control,amountConvention:'user',maximumCandidates:config.maximumCandidates,durationMs:config.durationMs??300000,maxPumpApiBytes:config.maxPumpApiBytes,admitControl:config.admitControl,record(kind,data){records.push({kind,data});if(kind==='research-enrichment-validation-prepared'){at+=config.validationDelay??0;mono+=config.validationDelay??0;}if(kind==='research-normalized-trade'){at+=config.afterRecordDelay??0;mono+=config.afterRecordDelay??0;}},onMigration:s=>migrations.push(s),...(config.watchOnly?{watchedIdentities:()=>[{mint:scope.mint,pool:scope.pool}],onWatchActivity:(row:unknown)=>watchHints.push(row)}:{}),onFlowOpen:(mint,at)=>opens.push({mint,at}),onHint:(mint,at)=>hints.push({mint,at}),onTrade:t=>trades.push(t),onGap:g=>{gaps.push(g);config.onGap?.(g,feeds);}};
  if(config.marketIntake){feedOptions.onMarketIdentity=row=>{if(config.marketSinkFailure)throw Error('FIXTURE_SINK_FULL');marketIdentities.push(row);};feedOptions.onMarketActivity=row=>{if(config.marketSinkFailure)throw Error('FIXTURE_SINK_FULL');marketActivities.push(row);};feedOptions.onMarketFeed=row=>marketFeedStatuses.push(row);}
  const feeds=new PilotFeeds(feedOptions,
    {now:()=>at,monotonic:()=>mono,setTimer(callback,ms){const id=++sequence;timers.set(id,{at:mono+ms,callback});return id;},clearTimer(id){timers.delete(id as number);},makeSocket(endpoint,options){assert.equal(options.maxPayload,65536);assert.equal(options.followRedirects,false);const socket=new Socket(endpoint);sockets.push(socket);if(config.refuseUpgrade||config.upgradeStatus!==undefined)queueMicrotask(()=>socket.emit('unexpected-response',{}, {socket:{bytesRead:200},statusCode:config.upgradeStatus??429,headers:{'retry-after':config.upgradeRetryAfter??(config.refuseUpgrade?'10':undefined)},destroy(){}}));else if(!config.hangOpen)queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;}});
  const rpc={async call<T>(method:string,params:unknown[]){rpcCalls++;assert.equal(method,'getTransaction');assert.ok(params[0]===fixtureTx.signature||Object.hasOwn(config.responses??{},String(params[0])));at+=10;mono+=10;return (config.responses?.[String(params[0])]??fixtureTx.transaction) as T;}};
  return {feeds,feedOptions,control,rpc,advance,sockets,operations,records,trades,migrations,watchHints,marketIdentities,marketActivities,marketFeedStatuses,gaps,opens,hints,get now(){return at;},get rpcCalls(){return rpcCalls;},get controlBytes(){return controlBytes;},get active(){return active;}};
}

test('one free discovery connection restores only migration subscription and emits unverified public hints',async()=>{
  const f=setup();await f.feeds.startDiscovery();const socket=f.sockets[0]!;socket.frame({txType:'migrate',signature:fixtureTx.signature,mint:scope.mint});socket.frame({txType:'migrate',signature:fixtureTx.signature,mint:scope.mint});
  assert.equal(f.migrations.length,1);assert.equal(f.migrations[0].feedMint,scope.mint);assert.equal(f.feeds.usage().discoverySocketBytes,socket._socket.bytesRead);assert.deepEqual(f.operations.map(x=>x.method),['upgrade','subscribeMigration']);assert.equal(f.trades.length,0);
  socket.drop();await f.advance(1999);assert.equal(f.sockets.length,1);await f.advance(1);assert.equal(f.sockets.length,2);assert.equal(f.sockets[1]!.sent.length,1);await f.feeds.stop();assert.equal(f.feeds.usage().physicalTransportsSettled,true);
});

test('selected flow uses one delayed confirmed retrieval, complete validation time, and no broad-feed persistence',async()=>{
  const f=setup({validationDelay:7,afterRecordDelay:3});await f.feeds.selectCandidate(scope);const socket=f.sockets[0]!;
  socket.frame('irrelevant broad bytes which are not JSON');socket.frame(selected());socket.frame(selected());assert.equal(f.hints.length,1);assert.equal(f.feeds.peekHint()?.eligible,false);assert.equal(f.rpcCalls,0);assert.equal(socket.sent.length,0);
  await f.advance(1000);const before=f.now;await f.feeds.enrichNext(f.rpc);assert.equal(f.rpcCalls,1);assert.equal(f.trades.length,1);const trade=f.trades[0];assert.equal(trade.evidence.rpcAvailableAt,before+10);assert.equal(trade.trade.receivedAt,before+20);assert.equal(trade.validatedAt,before+20);assert.notEqual(trade.trade.wallet,'NOT_THE_VERIFIED_TRADER');assert.notEqual(trade.trade.quoteLamports,'1');assert.equal(f.feeds.snapshot()?.fullyEnriched,true);assert.equal(f.feeds.snapshot()?.warm,false);assert.equal(f.feeds.usage().irrelevantFrames,1);assert.equal(f.records.filter(r=>r.kind==='pilot-selected-pumpapi-payload').length,2);assert.ok(f.feeds.usage().pumpApiSocketBytes>f.controlBytes);assert.equal(f.opens.length,1);await f.feeds.stop();
});

test('a required hint exceeding five seconds suspends only that candidate and requires explicit fresh observation after backoff',async()=>{
  const f=setup();await f.feeds.selectCandidate(scope);f.sockets[0]!.frame(selected());await f.advance(5100);assert.equal(f.feeds.usage().failedCandidate,true);assert.equal(f.feeds.peekHint(),null);assert.equal(f.rpcCalls,0);assert.equal(f.feeds.snapshot()?.hasQualityLoss,true);assert.ok(f.gaps.some(g=>g.mint===scope.mint));await assert.rejects(f.feeds.selectCandidate(scope),/RECONNECT_BACKOFF/);
  await f.advance(2100);await f.feeds.selectCandidate(scope);assert.equal(f.opens.length,2);assert.equal(f.feeds.snapshot()?.pending,0);assert.equal(f.feeds.snapshot()?.warm,false);assert.equal(f.feeds.snapshot()?.hasQualityLoss,false);await f.feeds.stop();
});

test('a feed disconnect invalidates current flow without automatically reusing the old window or stopping discovery',async()=>{
  const f=setup();await f.feeds.startDiscovery();await f.feeds.selectCandidate(scope);f.sockets[1]!.frame(selected());f.sockets[1]!.drop();assert.equal(f.feeds.usage().failedCandidate,true);assert.equal(f.feeds.usage().discoveryConnected,true);await f.advance(2500);assert.equal(f.sockets.length,2,'no automatic new candidate stream after essential gap');await f.feeds.selectCandidate(scope);assert.equal(f.sockets.length,3);assert.equal(f.feeds.snapshot()?.normalizedEvents,0);await f.feeds.stop();
});

test('preparse byte limits and malformed selected evidence stop admissions without fake trades or broad data queues',async()=>{
  for(const payload of ['malformed '+scope.mint,{...selected(),signature:null}]){const f=setup();await f.feeds.selectCandidate(scope);f.sockets[0]!.frame(payload);assert.equal(f.feeds.usage().failedCandidate,true);assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);await f.feeds.stop();}
  const f=setup({maxPumpApiBytes:4*1024*1024});await f.feeds.selectCandidate(scope);f.sockets[0]!.frame('irrelevant',3*1024*1024);assert.equal(f.feeds.usage().failedCandidate,true);assert.equal(f.feeds.usage().pumpApiSocketBytes,3*1024*1024+200);assert.equal(f.controlBytes,200);assert.equal(f.trades.length,0);await f.feeds.stop();
});

test('global duration and canceled physical handshakes close and settle without a retry or production action',async()=>{
  const f=setup({durationMs:1000});await f.feeds.startDiscovery();await f.advance(1100);assert.equal(f.feeds.usage().stopped,true);assert.equal(f.feeds.usage().physicalTransportsSettled,true);
  const pending=setup({hangOpen:true}),start=pending.feeds.selectCandidate(scope);for(let i=0;i<8;i++)await Promise.resolve();const stop=pending.feeds.stop();await assert.rejects(start);await stop;assert.equal(pending.active,0);assert.equal(pending.feeds.usage().physicalTransportsSettled,true);assert.equal(pending.sockets.length,1);
});

test('a connection closing during subscription pacing rejects without leaving an unresolvable physical ACK waiter',async()=>{
  const f=setup({closeBeforeSubscribe:true});await assert.rejects(f.feeds.startDiscovery(),/COMPONENT_WS_TRANSPORT/);assert.equal(f.active,0);assert.equal(f.sockets[0]!.sent.length,0);assert.equal(f.feeds.usage().physicalTransportsSettled,true);await f.feeds.stop();
});

test('upgrade-refusal accounting failure stays inside the handler, while feed429 retains only its own reconnect deadline',async()=>{
  const failed=setup({refuseUpgrade:true,chargeFailure:true});await assert.rejects(failed.feeds.selectCandidate(scope));assert.equal(failed.active,0);assert.equal(failed.feeds.usage().physicalTransportsSettled,true);assert.ok(failed.gaps.some(g=>g.reason==='COMPONENT_STORAGE_UNAVAILABLE'));await failed.feeds.stop();
  const limited=setup({refuseUpgrade:true});await assert.rejects(limited.feeds.selectCandidate(scope),/COMPONENT_HTTP_429/);assert.equal(limited.feeds.usage().candidateRetryAt,limited.now+15000);await limited.advance(5000);await assert.rejects(limited.feeds.selectCandidate(scope),/RECONNECT_BACKOFF/);assert.equal(limited.sockets.length,1);await limited.feeds.stop();
});

for(const status of [500,502,503,504])test(`transient upgrade HTTP${status} restores both broad feeds through existing network backoff and fresh ACKs`,async()=>{
  const config={persistent:true,marketIntake:true,upgradeStatus:status as number|undefined,admitControl:():{}|false=>f.active===0?{}:false},f=setup(config);
  try{
    await assert.rejects(f.feeds.startDiscovery(),/COMPONENT_WS_TRANSPORT/);
    await assert.rejects(f.feeds.startWatchActivity(),/COMPONENT_WS_TRANSPORT/);
    const failed=f.feeds.usage();assert.equal(failed.physicalTransportsSettled,true);assert.equal(f.sockets.length,2);
    for(const leg of Object.values(failed.marketDiscovery.recovery)){assert.equal(leg.desired,true);assert.equal(leg.networkReconnects,1);assert.equal(leg.providerBackoffLevel,1);assert.equal(leg.localDeferrals,0);assert.equal(leg.providerNotBefore,0);}
    const retries=f.records.filter(r=>r.kind==='pilot-feed-reconnect-scheduled');assert.equal(retries.length,2);assert.ok(retries.every(r=>r.data.delayMs===2000&&r.data.reason===`PILOT_FEED_UPGRADE_HTTP_${status}`&&r.data.physicalAttemptStarted===true));
    config.upgradeStatus=undefined;await f.advance(1999);assert.equal(f.sockets.length,2);assert.ok(Object.values(f.feeds.usage().marketDiscovery.sources).every(s=>!s.connected));
    await f.advance(1);await f.advance(250);assert.equal(f.sockets.length,4);assert.ok(Object.values(f.feeds.usage().marketDiscovery.sources).every(s=>s.connected));assert.deepEqual(f.sockets[2]!.sent.map(s=>JSON.parse(s).method),['subscribeMigration','subscribeNewToken']);
  }finally{await f.feeds.stop();}
});

for(const status of [401,403])test(`upgrade HTTP${status} remains terminal even when a later provider response would be healthy`,async()=>{
  const config={persistent:true,marketIntake:true,upgradeStatus:status as number|undefined},f=setup(config);
  try{
    await assert.rejects(f.feeds.startDiscovery());await assert.rejects(f.feeds.startWatchActivity());
    for(const leg of Object.values(f.feeds.usage().marketDiscovery.recovery)){assert.equal(leg.desired,false);assert.equal(leg.retryTimerPending,false);assert.equal(leg.networkReconnects,0);}
    config.upgradeStatus=undefined;await f.advance(65000);assert.equal(f.sockets.length,2);assert.ok(Object.values(f.feeds.usage().marketDiscovery.sources).every(s=>!s.connected));
  }finally{await f.feeds.stop();}
});

for(const status of [429,503])test(`upgrade HTTP${status} explicit Retry-After remains a lower bound for both broad feeds`,async()=>{
  const config={persistent:true,marketIntake:true,upgradeStatus:status as number|undefined,upgradeRetryAfter:'10',admitControl:():{}|false=>f.active===0?{}:false},f=setup(config);
  try{
    await assert.rejects(f.feeds.startDiscovery());await assert.rejects(f.feeds.startWatchActivity());
    const until=f.now+15000;for(const leg of Object.values(f.feeds.usage().marketDiscovery.recovery))assert.equal(leg.providerNotBefore,until);
    config.upgradeStatus=undefined;await f.advance(14999);assert.equal(f.sockets.length,2);await f.advance(1);await f.advance(250);assert.equal(f.sockets.length,4);assert.ok(Object.values(f.feeds.usage().marketDiscovery.sources).every(s=>s.connected));
    assert.ok(f.records.filter(r=>r.kind==='pilot-feed-reconnect-scheduled').every(r=>r.data.delayMs===15000&&r.data.physicalAttemptStarted===true));
  }finally{await f.feeds.stop();}
});

test('current feature projection advances without adding duplicate quiet feature history',async()=>{
  const f=setup();await f.feeds.selectCandidate(scope);let s=f.feeds.snapshot();for(let i=0;i<112;i++){await f.advance(1000);f.sockets[0]!.frame('irrelevant heartbeat');s=f.feeds.snapshot();}
  assert.ok(s!.featureRows.length<=13);assert.equal(s!.windowEndAt,Math.floor(f.now/10000)*10000);assert.ok(s!.latestFeature!.at>s!.featureRows.at(-1)!.at);assert.equal(s!.failedCandidate,false);await f.feeds.stop();
});

test('background duration shutdown reports an unsettled transport without an unhandled promise rejection',async()=>{
  const f=setup({durationMs:1000});await f.feeds.startDiscovery();const socket=f.sockets[0]!;socket.terminate=()=>{};await f.advance(4000);assert.ok(f.gaps.some(g=>g.reason==='PILOT_FEED_TRANSPORT_UNSETTLED'));assert.equal(f.feeds.usage().physicalTransportsSettled,false);socket.drop();await f.feeds.stop();assert.equal(f.feeds.usage().physicalTransportsSettled,true);
});

// Retained transactions below are delivered at declared synthetic test times.
// These cases prove scoped dispatch mechanics, not live concurrent coverage.
const secondCapture=JSON.parse(readFileSync('evidence/overnight-20261027/07-field/capture.json','utf8'));
const secondScope={...secondCapture.scope,supportedPoolEvidence:'OFFLINE_CONCURRENT_SCOPE_ONLY'};
const secondEvidence=secondCapture.executedEvidence[0],secondSignature=secondEvidence.identity.signature;
const secondPayload=()=>({mint:secondScope.mint,poolId:secondScope.pool,pool:'pump-amm',signature:secondSignature,action:secondEvidence.side});
const otherScope=(run:string)=>{const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));return {mint:proof.quote.mint,pool:proof.quote.pool,baseUnits:proof.quote.buy.outputBaseUnits,minSlot:proof.origin.slot,supportedPoolEvidence:'OFFLINE_CONCURRENT_SCOPE_ONLY'};};
const thirdScope=otherScope('2026-10-26T19-42-16.130Z'),fourthScope=otherScope('2026-10-26T19-57-35.882Z');

test('explicit three-scope mode uses one socket, while default capacity and legacy replacement remain unchanged',async()=>{
  const single=setup();await single.feeds.addCandidate(scope);await assert.rejects(single.feeds.addCandidate(secondScope),/CANDIDATE_CAPACITY/);await single.feeds.stop();
  const f=setup({maximumCandidates:3});await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);await f.feeds.addCandidate(thirdScope);
  assert.equal(f.sockets.length,1);assert.equal(f.operations.length,1);assert.equal(f.sockets[0]!.sent.length,0);assert.equal(Object.keys(f.feeds.snapshots()).length,3);assert.equal(f.opens.length,3);
  await f.feeds.addCandidate(scope);assert.equal(f.opens.length,3,'identical add is idempotent and never clears a warmed window');
  await assert.rejects(f.feeds.addCandidate(fourthScope),/CANDIDATE_CAPACITY/);
  await f.feeds.selectCandidate(secondScope);assert.equal(f.sockets.length,2);assert.deepEqual(Object.keys(f.feeds.snapshots()),[secondScope.mint]);assert.equal(f.feeds.snapshot()?.scope.mint,secondScope.mint);await f.feeds.stop();
});

test('malformed selected data or removal of one scope preserves the other scopes and shared socket',async()=>{
  const f=setup({maximumCandidates:3});await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);await f.feeds.addCandidate(thirdScope);const socket=f.sockets[0]!;
  socket.frame({...selected(),signature:null});assert.equal(f.feeds.snapshot(scope.mint)?.failedCandidate,true);assert.equal(f.feeds.snapshot(secondScope.mint)?.failedCandidate,false);assert.equal(f.feeds.snapshot(thirdScope.mint)?.failedCandidate,false);assert.equal(f.feeds.usage().pumpApiConnected,true);
  assert.equal(f.feeds.usage().pumpApiSocketBytes,socket._socket.bytesRead,'broad raw bytes counted once, not once per candidate');
  await f.feeds.removeCandidate(scope.mint);assert.equal(socket.closed,false);await f.feeds.removeCandidate(secondScope.mint);assert.equal(socket.closed,false);assert.equal(f.feeds.snapshot(thirdScope.mint)?.failedCandidate,false);
  await f.feeds.removeCandidate(thirdScope.mint);assert.equal(socket.closed,true);await f.feeds.stop();
});

test('earliest scope deadline dispatches first and concurrent callers cannot start a second physical enrichment',async()=>{
  const f=setup({maximumCandidates:3,responses:{[secondSignature]:secondCapture.enrichmentTransactions[secondSignature]}});await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);const socket=f.sockets[0]!;
  socket.frame(secondPayload());await f.advance(100);socket.frame(selected());await f.advance(1000);
  assert.equal(f.feeds.peekHint()?.mint,secondScope.mint);await f.feeds.enrichNext(f.rpc);assert.equal(f.trades.length,1);assert.equal(f.trades[0].trade.mint,secondScope.mint);assert.equal(f.feeds.snapshot(secondScope.mint)?.pending,0);assert.equal(f.feeds.peekHint()?.mint,scope.mint);
  let release!:(value:any)=>void,calls=0;const pending=f.feeds.enrichNext({async call<T>():Promise<T>{calls++;return await new Promise<T>(resolve=>{release=resolve;});}});
  await Promise.resolve();assert.deepEqual(await f.feeds.enrichNext(f.rpc),[]);assert.equal(calls,1);assert.equal(f.feeds.usage().enrichmentInFlight,true);release(fixtureTx.transaction);await pending;
  assert.equal(f.trades.length,2);assert.equal(f.feeds.snapshot(scope.mint)?.fullyEnriched,true);assert.equal(f.feeds.snapshot(secondScope.mint)?.fullyEnriched,true);await f.feeds.stop();
});

test('currently eligible identical signatures share one confirmed read without inventing a second-pool trade',async()=>{
  const f=setup({maximumCandidates:3});await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);const socket=f.sockets[0]!;
  socket.frame(selected());socket.frame({...secondPayload(),signature:fixtureTx.signature});await f.advance(1000);await f.feeds.enrichNext(f.rpc);
  assert.equal(f.rpcCalls,1);assert.equal(f.trades.length,1);assert.equal(f.trades[0].trade.mint,scope.mint);assert.equal(f.feeds.snapshot(scope.mint)?.fullyEnriched,true);assert.equal(f.feeds.snapshot(secondScope.mint)?.failedCandidate,true,'actual response lacks the claimed second-pool swap');
  assert.equal(f.feeds.usage().pumpApiConnected,true);const record=f.records.find(row=>row.kind==='pilot-confirmed-enrichment')!;assert.equal(record.data.selectedHints.length,2);await f.feeds.stop();
});

test('shared disconnect invalidates every affected window once and requires explicit fresh warming',async()=>{
  const f=setup({maximumCandidates:3});await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);await f.feeds.addCandidate(thirdScope);f.sockets[0]!.drop();
  assert.ok(Object.values(f.feeds.snapshots()).every(snapshot=>snapshot!.failedCandidate));assert.equal(f.gaps.length,3);assert.equal(f.feeds.usage().candidateRetryAt,f.now+2000,'one transport episode uses one backoff, not three');
  await f.advance(2100);assert.equal(f.sockets.length,1,'no automatic reuse of old windows');await f.feeds.addCandidate(scope);assert.equal(f.sockets.length,2);assert.equal(f.feeds.snapshot(scope.mint)?.failedCandidate,false);assert.equal(f.feeds.snapshot(scope.mint)?.warm,false);assert.equal(f.feeds.snapshot(secondScope.mint)?.failedCandidate,true);await f.feeds.stop();
});

test('aggregate required-hint backlog stays bounded at sixteen across three scopes',async()=>{
  const f=setup({maximumCandidates:3});await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);await f.feeds.addCandidate(thirdScope);const socket=f.sockets[0]!;
  for(let i=1;i<=15;i++)socket.frame({...selected(),signature:bs58.encode(Buffer.alloc(64,i))});socket.frame(secondPayload());socket.frame({mint:thirdScope.mint,poolId:thirdScope.pool,pool:'pump-amm',signature:bs58.encode(Buffer.alloc(64,30)),action:'buy'});
  assert.equal(f.feeds.snapshot(scope.mint)?.pending,15);assert.equal(f.feeds.snapshot(secondScope.mint)?.pending,1);assert.equal(f.feeds.snapshot(thirdScope.mint)?.failedCandidate,true);assert.equal(f.feeds.snapshot(scope.mint)?.failedCandidate,false);assert.equal(f.feeds.snapshot(secondScope.mint)?.failedCandidate,false);assert.ok(f.gaps.some(g=>g.mint===thirdScope.mint&&g.reason==='PILOT_AGGREGATE_ENRICHMENT_CAPACITY'));assert.equal(f.rpcCalls,0);await f.feeds.stop();
});

test('owner gap callback can retire that same scope without recursion or disturbing another scope',async()=>{
  const retirements:Promise<void>[]=[];
  const f=setup({maximumCandidates:3,onGap(gap,feeds){if(gap.mint===scope.mint)retirements.push(feeds.removeCandidate(gap.mint,'OWNER_RETIREMENT'));}});
  await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);f.sockets[0]!.frame({...selected(),signature:null});await Promise.all(retirements);
  assert.equal(f.feeds.snapshot(scope.mint),null);assert.equal(f.feeds.snapshot(secondScope.mint)?.failedCandidate,false);assert.equal(f.feeds.usage().pumpApiConnected,true);assert.equal(f.gaps.filter(g=>g.mint===scope.mint).length,2,'one failure and one intentional retirement; no recursive third callback');await f.feeds.stop();
});


test('validated candidate cap cannot be raised by mutating caller-owned options',async()=>{
  const options={maximumCandidates:2 as 1|2|3};const f=setup(options);
  await f.feeds.addCandidate(scope);await f.feeds.addCandidate(secondScope);
  f.feedOptions.maximumCandidates=3;
  await assert.rejects(f.feeds.addCandidate(thirdScope),/CANDIDATE_CAPACITY/);
  assert.equal(f.feeds.usage().maximumCandidates,2);await f.feeds.stop();
});

test('validated amount convention cannot change after observation begins',async()=>{
  const f=setup();await f.feeds.selectCandidate(scope);f.feedOptions.amountConvention='curve';f.sockets[0]!.frame(selected());await f.advance(1000);await f.feeds.enrichNext(f.rpc);
  assert.equal(f.trades.length,1);assert.equal(f.trades[0].trade.quoteLamports,f.trades[0].evidence.userQuoteLamports);assert.notEqual(f.trades[0].trade.quoteLamports,f.trades[0].evidence.curveQuoteLamports);await f.feeds.stop();
});


test('held-priority retirement does not await a delayed stream close or reuse its draining transport',async()=>{
 const f=setup();await f.feeds.selectCandidate(scope);const old=f.sockets[0]!;let terminating=false;
 old.terminate=()=>{terminating=true;};
 await f.feeds.removeCandidate(scope.mint,'ISOLATED protection-first retirement',{waitForSettlement:false});
 assert.equal(terminating,true);assert.equal(f.feeds.snapshot(scope.mint),null);assert.equal(f.feeds.usage().pumpApiConnected,false);assert.equal(f.feeds.usage().physicalTransportsSettled,false);
 const bytes=f.feeds.usage().pumpApiSocketBytes,selectedBefore=f.feeds.usage().selectedFrames;
 old.frame(selected(),400);assert.ok(f.feeds.usage().pumpApiSocketBytes>=bytes+400);assert.equal(f.feeds.usage().selectedFrames,selectedBefore);
 await f.feeds.addCandidate(scope);assert.equal(f.sockets.length,1,'no new upgrade while the retired transport is unsettled');assert.equal(f.opens.length,1,'draining transport cannot activate new flow');
 old.drop();await f.advance(2100);assert.equal(f.sockets.length,2);assert.equal(f.opens.length,2);assert.equal(f.feeds.snapshot()?.warm,false);assert.equal(f.feeds.snapshot()?.pending,0);await f.feeds.stop();
});


test('two long-lived scopes keep bounded feature evidence while frequent status reads remain read-only',async()=>{
 const f=setup({maximumCandidates:2});await f.feeds.selectCandidate(scope);
 const other={...scope,mint:'EPyQ8ZFCuLCJc7zR7ai9ZBnFbVj2LdC1FHLHj71Dpump',pool:'8VC1h9KpX6MktrtTw9uYTdKKCtVBHEF9boLAkqrkwai4'};
 // A second validated canonical identity from existing fixture evidence.
 const migration=JSON.parse(readFileSync('evidence/integration-proof-2026-10-26T19-57-35.882Z.json','utf8'));
 other.mint=migration.quote.mint;other.pool=migration.quote.pool;await f.feeds.addCandidate(other);
 for(let i=0;i<1600;i++){f.sockets[0]!.frame({fixture:'irrelevant broad stream heartbeat'},64);await f.advance(100);for(let j=0;j<5;j++){f.feeds.snapshot(scope.mint);f.feeds.snapshot(other.mint);}}
 const rows=f.records.filter(r=>r.kind==='research-feature-view');assert.ok(rows.length<=36,rows.length+' redundant feature emissions');assert.equal(f.feeds.usage().failedCandidate,false);assert.ok(f.feeds.usage().recordedBytes<512*1024);
 const before=f.feeds.usage().recordedBytes;for(let i=0;i<1000;i++)f.feeds.snapshots();assert.equal(f.feeds.usage().recordedBytes,before);
 assert.ok(f.feeds.snapshot(scope.mint)!.latestFeature!.at>=f.now-1000);assert.equal(f.feeds.snapshot(scope.mint)!.warm,true);await f.feeds.stop();
});

// No production source wiring: the lean API is a separately reviewable equivalent.
test('lean feed readiness matches full diagnostics through warming, pending work and a disconnect',async()=>{
 const f=setup();assert.equal(f.feeds.readiness(),null);await f.feeds.selectCandidate(scope);
 const compare=()=>{const lean=f.feeds.readiness(scope.mint)!,full=f.feeds.snapshot(scope.mint)!;for(const k of ['latestFeature','pending','fullyEnriched','warm','windowEndAt','hasQualityLoss','failedCandidate'] as const)assert.deepEqual(lean[k],full[k]);return lean;};
 compare();f.sockets[0]!.frame(selected());assert.equal(compare().pending,1);await f.advance(1000);await f.feeds.enrichNext(f.rpc);assert.equal(compare().fullyEnriched,true);
 for(let i=0;i<75;i++){await f.advance(1000);f.sockets[0]!.frame('irrelevant heartbeat');compare();}assert.equal(compare().warm,true);
 const pipeline=(f.feeds as any).candidates.get(scope.mint).pipeline,original=pipeline.snapshot;pipeline.snapshot=()=>{throw Error('FULL_DIAGNOSTIC_PATH_MUST_NOT_RUN');};assert.equal(f.feeds.readiness(scope.mint)!.warm,true);pipeline.snapshot=original;
 f.sockets[0]!.drop();assert.equal(compare().failedCandidate,true);assert.equal(compare().hasQualityLoss,true);await f.feeds.stop();
});


test('explicit WATCH-only broad stream reconnects without registering or enriching a deep candidate',async()=>{
 const f=setup({watchOnly:true});await f.feeds.startWatchActivity();const first=f.sockets[0]!;first.frame(selected());
 assert.equal(f.feeds.usage().watchActivity.requested,true);assert.match(f.feeds.usage().watchActivity.semantics,/explicitly requested broad WATCH/);assert.equal(f.watchHints.length,1);assert.equal(f.feeds.usage().candidates.length,0);assert.equal(f.feeds.peekHint(),null);
 first.drop();assert.equal(f.feeds.usage().pumpApiConnected,false);await f.advance(1999);assert.equal(f.sockets.length,1);await f.advance(1);assert.equal(f.sockets.length,2);assert.equal(f.feeds.usage().pumpApiConnected,true);assert.deepEqual(f.operations.map(op=>op.method),['upgrade','upgrade']);
 assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);assert.equal(f.feeds.usage().normalizedTrades,0);assert.ok(f.gaps.some(g=>g.reason==='COMPONENT_WS_TRANSPORT'&&g.mint===undefined));assert.equal(f.controlBytes,400);
 await f.feeds.stop();const count=f.sockets.length;await f.advance(10000);assert.equal(f.sockets.length,count);assert.equal(f.feeds.usage().physicalTransportsSettled,true);
});

test('WATCH-only quiet timeout uses bounded reconnect and keeps new hints separate from validated flow',async()=>{
 const f=setup({watchOnly:true});await f.feeds.startWatchActivity();const first=f.sockets[0]!;await f.advance(15100);assert.equal(first.closed,true);assert.equal(f.feeds.usage().pumpApiConnected,false);await f.advance(2000);assert.equal(f.sockets.length,2);
 f.sockets[1]!.frame({...selected(),signature:bs58.encode(Buffer.alloc(64,50))});assert.equal(f.watchHints.length,1);assert.equal(f.watchHints[0].evidence,'unverified-pumpapi-activity-hint');assert.equal(f.feeds.peekHint(),null);assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);await f.feeds.stop();
});

test('removing legacy scopes preserves an explicitly requested WATCH stream and its byte stop remains final',async()=>{
 const f=setup({watchOnly:true,maxPumpApiBytes:4*1024*1024});await f.feeds.startWatchActivity();await f.feeds.addCandidate(scope);assert.equal(f.sockets.length,1);await f.feeds.removeCandidate(scope.mint);assert.equal(f.sockets[0]!.closed,false);assert.equal(f.feeds.usage().candidates.length,0);assert.equal(f.feeds.usage().pumpApiDesired,true);
 f.sockets[0]!.frame('irrelevant',3*1024*1024);assert.equal(f.sockets[0]!.closed,true);assert.equal(f.feeds.usage().pumpApiDesired,false);assert.equal(f.feeds.usage().pumpApiSocketBytes,3*1024*1024+200);assert.ok(f.gaps.some(g=>g.reason==='PILOT_PUMPAPI_BYTE_LIMIT'));await f.advance(10000);assert.equal(f.sockets.length,1,'a received-byte stop never reconnects');assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);await f.feeds.stop();
});

test('WATCH-only recovery honors its actual upgrade429 cooldown and performs no transaction enrichment',async()=>{
 const f=setup({watchOnly:true,refuseUpgrade:true});await assert.rejects(f.feeds.startWatchActivity(),/COMPONENT_HTTP_429/);assert.equal(f.sockets.length,1);assert.equal(f.feeds.usage().pumpApiConnected,false);await f.advance(14999);assert.equal(f.sockets.length,1);await f.advance(1);assert.equal(f.sockets.length,2);assert.equal(f.operations.length,2);assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);assert.equal(f.feeds.usage().candidates.length,0);await f.feeds.stop();
});

test('WATCH reconnect defers physical starts while selected native controls are due, then resumes through the same gate',async()=>{
 let nativeDue=false;let f:ReturnType<typeof setup>;f=setup({watchOnly:true,admitControl:()=>nativeCandidateWatchControlAdmission(false,true,{nextServiceAt:nativeDue?f.now:Infinity},f.now)?{}:false});
 await f.feeds.startWatchActivity();assert.equal(f.operations.length,1);nativeDue=true;f.sockets[0]!.drop();await f.advance(30000);assert.equal(f.operations.length,1,'due selected retirement/support keeps the service opportunity across repeated WATCH timer callbacks');assert.equal(f.feeds.usage().pumpApiConnected,false);
 nativeDue=false;await f.advance(10000);assert.equal(f.operations.length,2);assert.equal(f.feeds.usage().pumpApiConnected,true);await f.feeds.stop();
});

test('global activity reconnect local scheduling deferrals never become provider backoff and catch the next idle opportunity',async()=>{
 let nativeBusy=false;const f=setup({persistent:true,marketIntake:true,admitControl:()=>nativeBusy?false:{}});
 await f.feeds.startWatchActivity();nativeBusy=true;f.sockets[0]!.drop();await f.advance(45000);
 assert.equal(f.sockets.length,1,'native work keeps priority; local polling starts no sockets');assert.equal(f.operations.length,1);
 const blocked=f.feeds.usage().marketDiscovery.recovery.pumpapi!;assert.ok(blocked.localDeferrals>20);assert.equal(blocked.networkReconnects,1);assert.equal(blocked.providerBackoffLevel,1);assert.equal(blocked.lastLocalDeferralReason,'local-control-admission');
 nativeBusy=false;await f.advance(250);assert.equal(f.sockets.length,2,'first spare quarter-second opportunity is used rather than waiting60seconds');assert.equal(f.feeds.usage().pumpApiConnected,true);assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);await f.feeds.stop();
});

test('worker byte backpressure pauses both existing shared transports and drains every buffered identity without new connections',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startDiscovery();await f.feeds.startWatchActivity();const discovery=f.sockets[0]!,broad=f.sockets[1]!,budgetBytes=32*1024*1024;
 f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes,budgetBytes});assert.equal(discovery.paused,true);assert.equal(broad.paused,true);
 discovery.frame({txType:'create',mint:scope.mint,signature:fixtureTx.signature});broad.frame(selected());f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes/2,budgetBytes});
 assert.equal(discovery.pauseCalls,1);assert.equal(broad.pauseCalls,1);assert.equal(f.marketIdentities.length,0);assert.equal(f.marketActivities.length,0);
 await f.advance(20000);assert.equal(discovery.closed,false);assert.equal(broad.closed,false,'intentional transport pause is not a provider liveness failure');
 broad.frame({...selected(),signature:bs58.encode(Buffer.alloc(64,67))},undefined,true);assert.equal(f.marketActivities.length,1,'already decoded messages still reach the sink while reads are paused');
 const paused=f.feeds.usage().marketDiscovery.backpressure;assert.equal(paused.currentPausedMs,20000);assert.equal(paused.framesProcessedWhilePaused,1);assert.equal(paused.transports.pumpapi!.framesProcessedWhilePaused,1);
 f.feeds.setMarketBackpressure({paused:false,pendingBytes:0,budgetBytes});assert.equal(discovery.paused,false);assert.equal(broad.paused,false);assert.equal(f.marketIdentities.length,1);assert.equal(f.marketActivities.length,2);assert.equal(f.sockets.length,2);assert.equal(f.gaps.length,0);assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);
 const resumed=f.feeds.usage().marketDiscovery.backpressure;assert.equal(resumed.totalPausedMs,20000);assert.equal(resumed.transports.discovery!.totalPausedMs,20000);assert.equal(resumed.identityEvictions,0);assert.equal(resumed.nativeFinancialTransportAffected,false);await f.feeds.stop();
});

test('resuming a deliberately quiet paused transport preserves actual receipt timestamps and allows fresh read grace before genuine timeout',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startWatchActivity();const broad=f.sockets[0]!,lastTraffic=f.feeds.usage().lastAnyTrafficAt,budgetBytes=1024*1024;
 f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes,budgetBytes});await f.advance(20000);f.feeds.setMarketBackpressure({paused:false,pendingBytes:0,budgetBytes});
 await f.advance(100);assert.equal(broad.closed,false);assert.equal(f.feeds.usage().lastAnyTrafficAt,lastTraffic,'local resume cannot invent a provider receipt');await f.advance(15000);assert.equal(broad.closed,true);assert.ok(f.gaps.some(row=>row.reason==='PILOT_PUMPAPI_NO_TRANSPORT_RECEIPT'));await f.feeds.stop();
});

test('worker pressure defers network setup until drain without provider failure escalation or extra sockets',async()=>{
 const f=setup({persistent:true,marketIntake:true}),budgetBytes=1024*1024;f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes,budgetBytes});await f.feeds.startWatchActivity();await f.advance(5000);
 assert.equal(f.sockets.length,0);assert.equal(f.operations.length,0);assert.equal(f.feeds.usage().marketDiscovery.recovery.pumpapi!.providerBackoffLevel,0);assert.equal(f.feeds.usage().marketDiscovery.recovery.pumpapi!.lastLocalDeferralReason,'market-intake-byte-backpressure');
 f.feeds.setMarketBackpressure({paused:false,pendingBytes:0,budgetBytes});await f.advance(250);assert.equal(f.sockets.length,1);assert.equal(f.feeds.usage().pumpApiConnected,true);await f.feeds.stop();
});

test('provider disconnect during local pressure remains a real gap and reconnects through the existing gate only after drain',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startWatchActivity();const first=f.sockets[0]!,budgetBytes=1024*1024;f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes,budgetBytes});first.drop();await f.advance(10000);
 assert.equal(f.sockets.length,1);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.connected,false);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.gaps,1);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.currentOutageMs,10000);
 f.feeds.setMarketBackpressure({paused:false,pendingBytes:0,budgetBytes});await f.advance(250);assert.equal(f.sockets.length,2);assert.equal(first.resumeCalls,0,'closed transports are never resumed');assert.equal(f.feeds.usage().pumpApiConnected,true);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.observedOutageMs,10250);await f.feeds.stop();
});

test('synchronous queue pressure while a resumed transport drains can pause it again without losing subsequent frames',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startWatchActivity();const broad=f.sockets[0]!,budgetBytes=1024*1024;f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes,budgetBytes});
 for(let i=0;i<3;i++)broad.frame({...selected(),signature:bs58.encode(Buffer.alloc(64,70+i))});
 f.feedOptions.onMarketActivity=row=>{f.marketActivities.push(row);if(f.marketActivities.length===1)f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes,budgetBytes});};
 f.feeds.setMarketBackpressure({paused:false,pendingBytes:0,budgetBytes});assert.equal(broad.paused,true);assert.equal(f.marketActivities.length,1);assert.equal(broad.pendingFrames.length,2);
 f.feeds.setMarketBackpressure({paused:false,pendingBytes:0,budgetBytes});assert.equal(broad.paused,false);assert.equal(f.marketActivities.length,3);assert.equal(broad.pendingFrames.length,0);assert.equal(f.sockets.length,1);await f.feeds.stop();
});

test('pressure arriving during discovery setup allows required subscription acknowledgments before pausing shared reads',async()=>{
 const f=setup({persistent:true,marketIntake:true}),budgetBytes=1024*1024;f.feedOptions.onMarketFeed=row=>{f.marketFeedStatuses.push(row);if(row.connected&&row.source==='pumpportal-migration')f.feeds.setMarketBackpressure({paused:true,pendingBytes:budgetBytes,budgetBytes});};
 await f.feeds.startDiscovery();assert.equal(f.sockets.length,1);assert.equal(f.sockets[0]!.sent.length,2);assert.equal(f.sockets[0]!.paused,true);assert.equal(f.marketFeedStatuses.filter(row=>row.connected).length,2);await f.feeds.stop();
});


test('persistent discovery survives elapsed/evidence and reconnect-count research bounds with fresh subscriptions',async()=>{
 const f=setup({persistent:true,durationMs:1000,maximumRecordedBytes:65536});await f.feeds.startDiscovery();await f.advance(2000);
 for(let i=0;i<12;i++){f.sockets.at(-1)!.drop();await f.advance(2000);assert.equal(f.feeds.usage().discoveryConnected,true);}
 for(let i=0;i<1000;i++){const bytes=Buffer.alloc(64,17);bytes.writeUInt32BE(i,0);f.sockets.at(-1)!.frame({txType:'migrate',signature:bs58.encode(bytes),mint:scope.mint});}
 const u=f.feeds.usage();assert.equal(u.stopped,false);assert.equal(u.persistent,true);assert.ok(u.recordedBytes>65536);assert.ok(u.connections.discovery>9);assert.equal(f.migrations.length,1000);assert.equal(u.firstFailure,'COMPONENT_WS_TRANSPORT','planned drops remain truthful history');assert.ok(!f.gaps.some(g=>/DURATION_LIMIT|RECONNECT_LIMIT|EVIDENCE_CAP/.test(g.reason)));await f.feeds.stop();
});
test('persistent broad WATCH and discovery keep healthy capture above old rolling byte thresholds with all bytes counted',async()=>{
 const f=setup({persistent:true,watchOnly:true,maxPumpApiBytes:4*1024*1024});await f.feeds.startDiscovery();await f.feeds.startWatchActivity();const socket=f.sockets.at(-1)!,discovery=f.sockets[0]!;
 for(let i=0;i<65;i++)socket.frame('irrelevant',2*1024*1024);discovery.frame({message:'unrelated'},3*1024*1024);
 await f.advance(1);const u=f.feeds.usage();assert.equal(u.pumpApiDesired,true);assert.equal(u.pumpApiConnected,true);assert.equal(u.discoveryConnected,true);assert.ok(u.rollingTraffic.pumpapi.pressure);assert.ok(u.rollingTraffic.discovery.pressure);assert.equal(u.rollingTraffic.pumpapi.admissionEnforced,false);assert.equal(u.rollingTraffic.discovery.admissionEnforced,false);assert.ok(!f.gaps.some(g=>/ROLLING_TRAFFIC_PRESSURE/.test(g.reason)));assert.equal(u.pumpApiSocketBytes,socket._socket.bytesRead);assert.equal(u.discoverySocketBytes,discovery._socket.bytesRead);
 for(let i=0;i<4;i++){await f.advance(15000);socket.frame('unrelated traffic');discovery.frame({message:'unrelated'});}await f.advance(2000);assert.equal(f.feeds.usage().pumpApiConnected,true);assert.equal(f.feeds.usage().rollingTraffic.pumpapi.pressure,false);assert.ok(f.feeds.usage().pumpApiSocketBytes>128*1024*1024);assert.equal(f.feeds.usage().stopped,false);await f.feeds.stop();
});


test('persistent legacy candidate collection is not retired merely by the old three-minute research timer',async()=>{
 const f=setup({persistent:true});await f.feeds.selectCandidate(scope);
 for(let i=0;i<19;i++){f.sockets.at(-1)!.frame('unrelated transport traffic');await f.advance(10000);}
 assert.equal(f.feeds.usage().failedCandidate,false);assert.equal(f.feeds.usage().stopped,false);assert.equal(f.feeds.usage().candidates.length,1);assert.ok(!f.gaps.some(g=>g.reason==='PILOT_CANDIDATE_OBSERVATION_LIMIT'));assert.equal(f.trades.length,0);await f.feeds.stop();
});

test('global discovery receives creation and migration on one existing socket with separate acknowledged coverage',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startDiscovery();const socket=f.sockets[0]!;
 assert.deepEqual(socket.sent.map(value=>JSON.parse(value).method),['subscribeMigration','subscribeNewToken']);
 socket.frame({txType:'create',signature:fixtureTx.signature,mint:scope.mint});
 assert.equal(f.marketIdentities.length,1);assert.equal(f.marketIdentities[0].kind,'creation');assert.equal(f.marketIdentities[0].source,'pumpportal-new-token');assert.equal(f.migrations.length,0,'creation signature never enters migration verification');
 socket.frame({txType:'migrate',signature:fixtureTx.signature,mint:scope.mint});
 assert.equal(f.marketIdentities.length,2);assert.equal(f.migrations.length,1);assert.equal(f.marketActivities.length,0);assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);
 assert.deepEqual(f.marketFeedStatuses.filter(row=>row.connected).map(row=>row.source),['pumpportal-migration','pumpportal-new-token']);
 socket.drop();assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.connected,false);await f.advance(2000);
 assert.equal(f.sockets.length,2);assert.equal(f.sockets[1]!.sent.length,2);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpportal-new-token']!.gaps,1);await f.feeds.stop();
});

test('broad shared activity discovers every observed mint beyond old working-set limits without per-token RPC or retained feed identities',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startWatchActivity();const socket=f.sockets[0]!;
 for(let i=0;i<2048;i++){const mintBytes=Buffer.alloc(32,17);mintBytes.writeUInt32BE(i,0);const signatureBytes=Buffer.alloc(64,23);signatureBytes.writeUInt32BE(i,0);socket.frame({...selected(),mint:bs58.encode(mintBytes),signature:bs58.encode(signatureBytes),quoteMint:'So11111111111111111111111111111111111111112',quoteAmount:'0.123456789',tokenAmount:'123.456789'});}
 assert.equal(f.marketIdentities.length,0,'signed activity and identity are delivered together, avoiding duplicate durable writes');assert.equal(new Set(f.marketActivities.map(row=>row.mint)).size,2048);assert.equal(f.marketActivities.length,2048);assert.equal(f.marketActivities[0].quoteLamports,'123456789');assert.equal(f.marketActivities[0].tokenAmount,'123.456789');assert.equal('tokenUnits' in f.marketActivities[0],false);
 assert.equal(f.feeds.usage().watchActivity.knownIdentities,0);assert.equal(f.feeds.usage().candidates.length,0);assert.equal(f.sockets.length,1);assert.equal(socket.sent.length,0);assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.activities,2048);await f.feeds.stop();
});

test('unverified broad fields cannot invent quote denomination, signed volume, token decimals or authoritative trades',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startWatchActivity();const socket=f.sockets[0]!;
 socket.frame({...selected(),quoteAmount:'5',tokenAmount:'9007199254740993'});
 assert.equal(f.marketActivities.length,1);assert.equal(f.marketActivities[0].quoteLamports,undefined);assert.equal(f.marketActivities[0].tokenAmount,'9007199254740993');
 socket.frame({...selected(),signature:'1'.repeat(64),quoteMint:'So11111111111111111111111111111111111111112',quoteAmount:'5'});
 assert.equal(f.marketIdentities.length,1);assert.equal(f.marketIdentities[0].signature,undefined);assert.equal(f.marketActivities.length,1);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.unsignedActivityFrames,1);
 socket.frame({mint:scope.mint,action:'buy',signature:fixtureTx.signature,quoteMint:scope.mint,quoteAmount:'5'});
 assert.equal(f.marketActivities.at(-1)!.quoteLamports,undefined);
 socket.frame('invalid JSON');socket.frame({mint:'not-a-public-key',signature:fixtureTx.signature});assert.equal(f.marketIdentities.length,1);assert.equal(f.marketActivities.length,2);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.unusableFrames,2);assert.equal(f.feeds.usage().pumpApiConnected,true);assert.equal(f.trades.length,0);await f.feeds.stop();
});

test('durable discovery sink failure is visible and stops intake rather than silently discarding identities',async()=>{
 const f=setup({persistent:true,marketIntake:true,marketSinkFailure:true});await f.feeds.startWatchActivity();f.sockets[0]!.frame(selected());await Promise.resolve();
 assert.equal(f.marketIdentities.length,0);assert.equal(f.feeds.usage().marketDiscovery.sources['pumpapi-broad']!.deliveryFailures,1);assert.equal(f.feeds.usage().pumpApiConnected,false);assert.ok(f.gaps.some(row=>row.reason==='PILOT_MARKET_DISCOVERY_SINK_UNAVAILABLE'));assert.equal(f.rpcCalls,0);assert.equal(f.trades.length,0);await f.feeds.stop();
});

test('migration deduplication is time-based rather than evicting valid signatures after 256 discoveries',async()=>{
 const f=setup({persistent:true,marketIntake:true});await f.feeds.startDiscovery();const socket=f.sockets[0]!;const signatures:string[]=[];
 for(let i=0;i<400;i++){const raw=Buffer.alloc(64,29);raw.writeUInt32BE(i,0);const signature=bs58.encode(raw);signatures.push(signature);socket.frame({txType:'migrate',mint:scope.mint,signature});}
 socket.frame({txType:'migrate',mint:scope.mint,signature:signatures[0]});assert.equal(f.migrations.length,400);assert.equal(f.marketIdentities.length,401,'durable registry receives observations and owns unique-identity accounting');await f.feeds.stop();
});
