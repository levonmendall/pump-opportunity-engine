import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Duplex} from 'node:stream';
import WebSocket from 'ws';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {PilotFeeds,type PilotFeedControl} from '../src/pilot-feeds.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {wsWire} from './ws-wire-fixture.js';

const {Receiver}=createRequire(import.meta.url)('ws');
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const mint=new PublicKey(Buffer.alloc(32,216));
const scope={mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58(),minSlot:1};

/** Real pinned ws Receiver/Sender over a local in-memory transport. In
 * particular, ws drains a paused socket directly into Receiver on close;
 * those bytes never emit socket 'data', unlike the usual mechanics fixture. */
class LocalTransport extends Duplex {
  bytesRead=200;
  readonly peer=new Receiver({isServer:true,allowSynchronousEvents:true});
  readonly requests:Array<{id:number;method:string}>=[];
  readonly pings:Buffer[]=[];
  pongEnabled=true;
  private subscription=100;
  constructor(){
    super();
    this.peer.on('message',(raw:Buffer)=>{
      const request=JSON.parse(raw.toString());this.requests.push(request);
      assert.ok(['logsSubscribe','logsUnsubscribe'].includes(request.method));
      queueMicrotask(()=>this.receive(wsWire(Buffer.from(JSON.stringify({jsonrpc:'2.0',id:request.id,result:request.method==='logsSubscribe'?++this.subscription:true})))));
    });
    this.peer.on('ping',(payload:Buffer)=>{this.pings.push(Buffer.from(payload));if(this.pongEnabled)queueMicrotask(()=>this.receive(wsWire(payload,10)));});
  }
  _read(){}
  _write(chunk:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){this.peer.write(chunk,callback);}
  receive(bytes:Buffer){this.bytesRead+=bytes.length;this.push(bytes);}
}

async function setup(){
  let at=Date.now(),id=0,active=0,charged=0,failCharge=false;
  const records:Array<{kind:string;data:any}>=[],gaps:any[]=[],trades:any[]=[],sockets:WebSocket[]=[],transports:LocalTransport[]=[],operations:string[]=[];
  const control:PilotFeedControl={
    async operateData(kind,work,signal){
      assert.equal(active,0,'the one physical gate remains occupied until transport settlement');
      signal?.throwIfAborted();operations.push(kind.method);active++;
      try{return await work({id:++id,signal:signal??new AbortController().signal,chargeHttp(){throw Error('unexpected HTTP');},completeResponse(){}});}finally{active--;}
    },
    accountControlBytes(bytes){charged+=bytes;if(failCharge)throw Error('COMPONENT_STORAGE_UNAVAILABLE');},
    noteThrottle(_value,when=at){return when+65000;}
  };
  const flow=new PilotNativeFlow({
    persistent:true,control,maximumCandidates:1,maximumRssBytes:1024*1024*1024,
    support:{async validateMany(){return {validations:{[scope.mint]:{mint:scope.mint,pool:scope.pool,at,sourceSlot:1,evidence:'OFFLINE_CURRENT_SUPPORT',summary:{marketClockUnixSeconds:Math.floor(at/1000)}}},unavailable:{},context:null};}} as any,
    record(kind,data){records.push({kind,data:structuredClone(data)});},onTrade:row=>trades.push(row),onGap:row=>gaps.push(row)
  },{now:()=>at,makeSocket(){
    // The public client constructor performs a network upgrade. setSocket is
    // the pinned implementation's local equivalent after an observed upgrade.
    const socket=new (WebSocket as any)(null,undefined,{autoPong:false}) as WebSocket;
    (socket as any)._isServer=false;
    const transport=new LocalTransport();sockets.push(socket);transports.push(transport);
    queueMicrotask(()=>(socket as any).setSocket(transport,Buffer.alloc(0),{allowSynchronousEvents:false,maxPayload:512*1024}));
    return socket;
  }});
  flow.addCandidate(scope);
  for(let i=0;i<8&&!flow.snapshot(scope.mint)?.connected;i++)await flow.service();
  assert.equal(flow.snapshot(scope.mint)?.connected,true);
  return {flow,records,gaps,trades,sockets,transports,operations,advance(ms:number){at+=ms;},failCharging(){failCharge=true;},get active(){return active;},get charged(){return charged;}};
}

function notification(subscription:number){return wsWire(Buffer.from(JSON.stringify({jsonrpc:'2.0',method:'logsNotification',params:{subscription,result:{context:{slot:2},value:{signature:bs58.encode(Buffer.alloc(64,217)),err:null,logs:[]}}}})));}

test('pinned ws close-tail callbacks have no receipt provenance and cannot escalate a cancelled heartbeat into a source fatal',async()=>{
  const f=await setup();
  try{
    const socket=f.sockets[0]!,transport=f.transports[0]!,before=f.flow.snapshot(scope.mint)!;
    transport.pongEnabled=false;f.flow.requestHeartbeat();
    const cancelled=new AbortController(),running=f.flow.service(cancelled.signal);
    await turn();assert.equal(transport.pings.length,1);assert.equal(f.active,1);
    transport.pause();
    // This is the actual pinned-ws close path, not an invented reordered event.
    transport.receive(Buffer.concat([notification(before.subscription!),wsWire(Buffer.from('peer ping during close'),9),wsWire(transport.pings[0]!,10)]));
    const observedBefore=f.flow.usage().receiptTiming!.frames;
    cancelled.abort();
    assert.equal(socket.readyState,WebSocket.CLOSING);
    const closingCapture=f.flow.captureState(scope.mint)!,closingSnapshot=f.flow.snapshot(scope.mint)!;
    assert.equal((await f.flow.service()).kind,'busy');
    await running;await turn();
    assert.equal(f.flow.usage().fatal,null);
    assert.equal(closingCapture.connected,false);
    assert.equal(closingSnapshot.completeRequiredEventFields,false);
    assert.equal(f.flow.usage().receiptTiming!.frames,observedBefore,'no missing stamp was fabricated from close-handler time');
    assert.equal(f.flow.usage().physicalTransportsSettled,true);
    assert.equal(f.charged,transport.bytesRead,'all bytes remain charged, including the close tail');
    assert.equal(f.trades.length,0);assert.deepEqual(f.flow.notificationLedger(scope.mint),[]);
    assert.equal(f.flow.snapshot(scope.mint)!.warm,false);assert.ok(f.gaps.length>0);
    assert.equal(f.flow.usage().transportRecovery.lifetimeFailures,1);
    const retiredOpenedAt=before.openedAt;f.advance(2000);
    for(let i=0;i<8&&!f.flow.snapshot(scope.mint)?.connected;i++)await f.flow.service();
    assert.equal(f.sockets.length,2);assert.equal(f.flow.usage().fatal,null);
    assert.equal(f.flow.captureState(scope.mint)!.connected,true);
    assert.ok(f.flow.snapshot(scope.mint)!.openedAt!>retiredOpenedAt!);
    assert.equal(f.flow.snapshot(scope.mint)!.warm,false,'a new ACK does not inherit the interrupted observation window');
  }finally{await f.flow.stop();}
});

test('real open-socket message and matching PONG retain strict order and first-byte receipts',async()=>{
  const f=await setup();
  try{
    const transport=f.transports[0]!,socket=f.sockets[0]!,before=f.flow.snapshot(scope.mint)!;
    transport.receive(notification(before.subscription!));
    f.flow.requestHeartbeat();assert.equal((await f.flow.service()).kind,'ping');
    assert.equal(socket.readyState,WebSocket.OPEN);assert.equal(f.flow.usage().fatal,null);
    assert.equal(f.flow.notificationLedger(scope.mint).length,1);
    assert.equal(f.flow.usage().receiptTiming!.pendingEvents,0);
    assert.equal(f.flow.usage().roundTripLiveness.proofKind,'ping');
    assert.equal(f.flow.snapshot(scope.mint)!.openedAt,before.openedAt);
    assert.equal(f.gaps.length,0);assert.equal(f.charged,transport.bytesRead);
  }finally{await f.flow.stop();}
});

test('external transport termination cannot let a matching queued PONG release the physical gate before close',async()=>{
  const f=await setup();
  try{
    const socket=f.sockets[0]!,transport=f.transports[0]!,proof=f.flow.usage().roundTripLiveness.lastVerifiedAt;
    transport.pongEnabled=false;f.flow.requestHeartbeat();const running=f.flow.service();
    await turn();assert.equal(f.active,1);
    // This cancellation is external to protocol()'s operation signal, as with
    // watchdog or scoped transport loss. Its local abort flag stays false.
    transport.pause();transport.receive(wsWire(transport.pings[0]!,10));
    let unsettledDuringPong=false;
    socket.on('pong',()=>{queueMicrotask(()=>{unsettledDuringPong=f.active===1&&!f.flow.usage().physicalTransportsSettled;});});
    socket.terminate();assert.equal(f.active,1);assert.equal((await f.flow.service()).kind,'busy');
    await running;await turn();
    assert.equal(unsettledDuringPong,true);
    assert.equal(f.flow.usage().fatal,null);assert.equal(f.flow.usage().physicalTransportsSettled,true);
    assert.equal(f.flow.usage().roundTripLiveness.lastVerifiedAt,proof);
    const refused=f.records.find(row=>row.kind==='native-flow-protocol-refused')!.data;
    assert.equal(refused.cancelled,false);assert.equal(refused.unadmittedMatchingPongs,1);
    assert.equal(refused.matchingPongReceiptAt,null);assert.equal(refused.transportClosed,true);
    assert.equal(refused.physicalSettlementClaimed,false);
  }finally{await f.flow.stop();}
});

test('an open-socket callback without the next exact receipt remains fatal',async()=>{
  const f=await setup();
  try{
    f.sockets[0]!.emit('pong',Buffer.from('unobserved wire bytes'));
    await turn();
    assert.equal(f.flow.usage().fatal,'WS_FRAME_RECEIPT_EVENT_ORDER');
    assert.equal(f.flow.snapshot(scope.mint)!.warm,false);assert.equal(f.trades.length,0);
  }finally{await f.flow.stop();}
});

test('closing admission fencing never suppresses receipt-accounting failure',async()=>{
  const f=await setup();
  try{
    const transport=f.transports[0]!,socket=f.sockets[0]!;
    transport.pause();transport.receive(notification(f.flow.snapshot(scope.mint)!.subscription!));
    f.failCharging();socket.terminate();await turn();await turn();
    assert.equal(f.flow.usage().fatal,'COMPONENT_STORAGE_UNAVAILABLE');
    assert.equal(f.charged,transport.bytesRead);assert.equal(f.trades.length,0);
  }finally{await f.flow.stop();}
});

test('final settlement preserves accounting failure even when a close-only tail emits no public data callback',async()=>{
  const f=await setup();
  try{
    const transport=f.transports[0]!,socket=f.sockets[0]!;
    transport.pause();transport.receive(wsWire(Buffer.alloc(0),8));
    f.failCharging();socket.terminate();await turn();await turn();
    assert.equal(f.flow.usage().fatal,'COMPONENT_STORAGE_UNAVAILABLE');
    assert.equal(f.flow.usage().physicalTransportsSettled,true);
    assert.equal(f.charged,transport.bytesRead);assert.equal(f.trades.length,0);
  }finally{await f.flow.stop();}
});

test('broad-feed close-tail bytes remain counted without admitting a new market hint',async()=>{
  const identities:any[]=[],activities:any[]=[],transports:LocalTransport[]=[],sockets:WebSocket[]=[];
  const control:PilotFeedControl={async operateData(_kind,work,signal){return work({id:1,signal:signal??new AbortController().signal,chargeHttp(){},completeResponse(){}});},accountControlBytes(){},noteThrottle(){return Date.now()+65000;}};
  const feeds=new PilotFeeds({persistent:true,control,amountConvention:'curve',record(){},onMigration(){},onTrade(){assert.fail('a broad hint never supplies trade evidence');},onGap(){},onMarketIdentity:row=>identities.push(row),onMarketActivity:row=>activities.push(row)},
    {makeSocket(){const socket=new (WebSocket as any)(null,undefined,{autoPong:false}) as WebSocket;(socket as any)._isServer=false;const transport=new LocalTransport();sockets.push(socket);transports.push(transport);queueMicrotask(()=>(socket as any).setSocket(transport,Buffer.alloc(0),{allowSynchronousEvents:false,maxPayload:65536}));return socket;}});
  try{
    await feeds.startWatchActivity();const transport=transports[0]!,socket=sockets[0]!;
    const message=wsWire(Buffer.from(JSON.stringify({mint:scope.mint,poolId:scope.pool,signature:bs58.encode(Buffer.alloc(64,218)),action:'buy',pool:'pump-amm'})));
    transport.receive(message);await turn();await turn();assert.equal(activities.length,1,'normal OPEN-socket hints still reach the durable intake');
    transport.pause();transport.receive(message);socket.terminate();await turn();await turn();
    assert.equal(activities.length,1);assert.equal(identities.length,0);
    assert.equal(feeds.usage().pumpApiSocketBytes,transport.bytesRead);
    assert.equal(feeds.usage().physicalTransportsSettled,true);
  }finally{await feeds.stop();}
});
