import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import {PilotFeeds,type PilotFeedControl,type PilotFeedsOptions} from '../src/pilot-feeds.js';
import type {ComponentKind,ComponentOperation} from '../src/component-budget.js';

const fixtureTx=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:fixtureTx.transaction.slot,supportedPoolEvidence:'OFFLINE_FIXTURE_ONLY'};
const selected=()=>({mint:scope.mint,poolId:scope.pool,pool:'pump-amm',signature:fixtureTx.signature,action:'sell',txSigner:'NOT_THE_VERIFIED_TRADER',quoteAmount:1});
class Socket extends EventEmitter{
  _socket=Object.assign(new EventEmitter(),{bytesRead:200});closed=false;readonly sent:string[]=[];
  constructor(readonly endpoint:string){super();}
  send(data:string,callback?:(error?:Error)=>void){assert.equal(this.endpoint,'wss://pumpportal.fun/api/data');assert.equal(JSON.parse(data).method,'subscribeMigration');this.sent.push(data);callback?.();queueMicrotask(()=>this.frame({message:"Subscribed to 'migration' events."}));}
  frame(payload:unknown,bytes?:number){if(this.closed)return;const b=Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));this._socket.bytesRead+=bytes??b.length+4;this._socket.emit('data',b);this.emit('message',b);}
  terminate(){if(this.closed)return;this.closed=true;queueMicrotask(()=>this.emit('close'));}
  drop(){this.closed=true;this.emit('close');}
}
function setup(config:{validationDelay?:number;afterRecordDelay?:number;durationMs?:number;hangOpen?:boolean;admitControl?:PilotFeedsOptions['admitControl'];maxPumpApiBytes?:number;closeBeforeSubscribe?:boolean;refuseUpgrade?:boolean;chargeFailure?:boolean}={}){
  let at=Date.parse(fixtureTx.fetchedAt),mono=0,sequence=0,active=0,controlBytes=0,rpcCalls=0;const timers=new Map<number,{at:number;callback:()=>void}>(),sockets:Socket[]=[],operations:ComponentKind[]=[],records:Array<{kind:string;data:any}>=[],trades:any[]=[],migrations:any[]=[],gaps:any[]=[],opens:any[]=[],hints:any[]=[];
  const advance=async(ms:number)=>{const end=mono+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const delta=next[1].at-mono;at+=delta;mono=next[1].at;timers.delete(next[0]);next[1].callback();for(let i=0;i<8;i++)await Promise.resolve();}at+=end-mono;mono=end;for(let i=0;i<8;i++)await Promise.resolve();};
  const control:PilotFeedControl={async operateData<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,signal?:AbortSignal){assert.equal(active,0,'one physical control operation');operations.push(kind);active++;if(config.closeBeforeSubscribe&&kind.method==='subscribeMigration')sockets[0]!.drop();try{return await work({id:operations.length,signal:signal??new AbortController().signal,chargeHttp(){},completeResponse(){}});}finally{active--; }},accountControlBytes(n){if(config.chargeFailure)throw Error('COMPONENT_STORAGE_UNAVAILABLE');controlBytes+=n;},noteThrottle(){return at+15000;}};
  const feeds=new PilotFeeds({control,amountConvention:'user',durationMs:config.durationMs??300000,maxPumpApiBytes:config.maxPumpApiBytes,admitControl:config.admitControl,record(kind,data){records.push({kind,data});if(kind==='research-enrichment-validation-prepared'){at+=config.validationDelay??0;mono+=config.validationDelay??0;}if(kind==='research-normalized-trade'){at+=config.afterRecordDelay??0;mono+=config.afterRecordDelay??0;}},onMigration:s=>migrations.push(s),onFlowOpen:(mint,at)=>opens.push({mint,at}),onHint:(mint,at)=>hints.push({mint,at}),onTrade:t=>trades.push(t),onGap:g=>gaps.push(g)},
    {now:()=>at,monotonic:()=>mono,setTimer(callback,ms){const id=++sequence;timers.set(id,{at:mono+ms,callback});return id;},clearTimer(id){timers.delete(id as number);},makeSocket(endpoint,options){assert.equal(options.maxPayload,65536);assert.equal(options.followRedirects,false);const socket=new Socket(endpoint);sockets.push(socket);if(config.refuseUpgrade)queueMicrotask(()=>socket.emit('unexpected-response',{}, {socket:{bytesRead:200},statusCode:429,headers:{'retry-after':'10'},destroy(){}}));else if(!config.hangOpen)queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;}});
  const rpc={async call<T>(method:string,params:unknown[]){rpcCalls++;assert.equal(method,'getTransaction');assert.equal(params[0],fixtureTx.signature);at+=10;mono+=10;return fixtureTx.transaction as T;}};
  return {feeds,control,rpc,advance,sockets,operations,records,trades,migrations,gaps,opens,hints,get now(){return at;},get rpcCalls(){return rpcCalls;},get controlBytes(){return controlBytes;},get active(){return active;}};
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

test('current feature projection advances beyond the bounded hundred-row diagnostic history',async()=>{
  const f=setup();await f.feeds.selectCandidate(scope);let s=f.feeds.snapshot();for(let i=0;i<112;i++){await f.advance(1000);f.sockets[0]!.frame('irrelevant heartbeat');s=f.feeds.snapshot();}
  assert.equal(s!.featureRows.length,100);assert.equal(s!.windowEndAt,Math.floor(f.now/10000)*10000);assert.ok(s!.latestFeature!.at>s!.featureRows.at(-1)!.at);assert.equal(s!.failedCandidate,false);await f.feeds.stop();
});

test('background duration shutdown reports an unsettled transport without an unhandled promise rejection',async()=>{
  const f=setup({durationMs:1000});await f.feeds.startDiscovery();const socket=f.sockets[0]!;socket.terminate=()=>{};await f.advance(4000);assert.ok(f.gaps.some(g=>g.reason==='PILOT_FEED_TRANSPORT_UNSETTLED'));assert.equal(f.feeds.usage().physicalTransportsSettled,false);socket.drop();await f.feeds.stop();assert.equal(f.feeds.usage().physicalTransportsSettled,true);
});
