/** Real pinned ws parser over an in-memory Duplex. No network/provider/ledger.
 * The malformed-close case reproduces the ordering seen in run40704936322:
 * library close attempt precedes the public WS_ERR_INVALID_CLOSE_CODE event. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Duplex} from 'node:stream';
import {PublicKey} from '@solana/web3.js';
import WebSocket from 'ws';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import type {PilotFeedControl} from '../src/pilot-feeds.js';
import type {ComponentKind,ComponentOperation} from '../src/component-budget.js';

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
class MemoryTransport extends Duplex {
 bytesRead=0;readonly written:Buffer[]=[];
 _read(){}
 _write(chunk:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){this.written.push(Buffer.from(chunk));callback();}
 receive(bytes:Buffer){this.bytesRead+=bytes.length;this.push(bytes);}
}
function fixture(){
 let at=200000,mono=0,active=0,id=0;
 const transports:MemoryTransport[]=[],sockets:WebSocket[]=[],starts:ComponentKind[]=[],records:Array<{kind:string;data:any}>=[],gaps:any[]=[];
 const mint=new PublicKey(Buffer.alloc(32,61)),scope={mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58()};
 const control:PilotFeedControl={async operateData<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,signal?:AbortSignal){assert.equal(active,0,'one physical gate');starts.push({...kind});active++;try{return await work({id:++id,signal:signal??new AbortController().signal,chargeHttp(){},completeResponse(){}});}finally{active--;}},accountControlBytes(){},noteThrottle(){return at+65000;}};
 const support={async validateMany(requests:any[]){return {validations:Object.fromEntries(requests.map(r=>{const m=r.mint.toBase58();return [m,{mint:m,pool:canonicalPumpPoolPda(r.mint).toBase58(),at,sourceSlot:123,evidence:'OFFLINE_IN_MEMORY_CURRENT_SUPPORT',summary:{marketClockUnixSeconds:at/1000}}];})),unavailable:{},context:{slot:123}};}};
 const flow=new PilotNativeFlow({control,support:support as any,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),onTrade(){throw Error('NO_TRADES_IN_CONTROL_FIXTURE');},onGap:gap=>gaps.push(gap),durationMs:300000},{now:()=>at,monotonic:()=>mono,setTimer:()=>0,clearTimer(){},makeSocket(){
  // ws exposes server construction for setSocket; the client-side flag below
  // selects the real unmasked-server-frame parser without opening a socket.
  const socket=new (WebSocket as any)(null,undefined,{autoPong:false,closeTimeout:1000}) as WebSocket;
  (socket as any)._isServer=false;const transport=new MemoryTransport();transports.push(transport);sockets.push(socket);
  queueMicrotask(()=>(socket as any).setSocket(transport,Buffer.alloc(0),{allowSynchronousEvents:false,maxPayload:512*1024,skipUTF8Validation:false}));return socket;
 }});
 return {flow,control,scope,transports,sockets,starts,records,gaps,get active(){return active;},advance(ms:number){at+=ms;mono+=ms;},async open(){flow.addCandidate(scope);assert.equal((await flow.service()).kind,'support');assert.equal((await flow.service()).kind,'connect');assert.equal(flow.usage().connected,true);return transports.at(-1)!;}};
}

for(const [label,code] of [['malformed peer close',1],['normal peer close',1000]] as const)test(`${label}: an unadmitted library reply is not written, and recovery remains paced`,async()=>{
 const f=fixture(),transport=await f.open(),priorStarts=f.starts.length;
 const close=Buffer.alloc(4);close[0]=0x88;close[1]=2;close.writeUInt16BE(code,2);
 transport.receive(close);await turn();await turn();
 assert.equal(transport.written.length,0,'no physical close frame was invoked outside the shared gate');
 assert.equal(f.flow.usage().unmanagedControlUnits,0,'suppressed attempts are not actual request units');
 assert.equal(f.flow.usage().protocolFrames,0,'the sent-frame counter excludes suppressed attempts');
 assert.equal(f.flow.usage().fatal,null,'a transport failure does not become source-wide accounting failure');
 assert.equal(f.flow.usage().connected,false);assert.ok(f.gaps.length);assert.equal(f.starts.length,priorStarts);
 const suppressed=f.records.find(row=>row.kind==='native-flow-suppressed-library-control');assert.ok(suppressed);assert.equal(suppressed.data.opcode,8);assert.equal(suppressed.data.physicalFrameSent,false);
 if(code===1)assert.ok(f.records.some(row=>row.kind==='native-flow-socket-error'&&row.data.code==='WS_ERR_INVALID_CLOSE_CODE'));
 assert.equal((await f.flow.service()).kind,'backoff');f.advance(1999);assert.equal((await f.flow.service()).kind,'backoff');
 f.advance(1);assert.equal((await f.flow.service()).kind,'support');assert.equal((await f.flow.service()).kind,'connect');assert.equal(f.flow.usage().connected,true);
 assert.equal(f.flow.snapshot(f.scope.mint)!.warm,false,'reconnection cannot reconstruct the missing window');await f.flow.stop();
});

test('malformed close during another physical operation cannot settle or bypass that occupied gate',async()=>{
 const f=fixture(),transport=await f.open();let release!:(value:void)=>void;
 const held=f.control.operateData({transport:'ws',method:'subscribeMigration'},async(_op:ComponentOperation)=>new Promise<void>(resolve=>{release=resolve;}));assert.equal(f.active,1);
 transport.receive(Buffer.from([0x88,0x02,0x00,0x01]));await turn();await turn();
 assert.equal(f.active,1,'closing a data transport does not settle unrelated physical work');assert.equal(transport.written.length,0);assert.equal(f.flow.usage().unmanagedControlUnits,0);
 release();await held;assert.equal(f.active,0);f.advance(2000);assert.equal((await f.flow.service()).kind,'support');assert.equal((await f.flow.service()).kind,'connect');await f.flow.stop();
});

test('an explicitly scheduled close still writes one counted frame and settles on the real ws close handshake',async()=>{
 const f=fixture(),transport=await f.open();f.flow.removeCandidate(f.scope.mint,'OFFLINE_MANAGED_RETIREMENT');
 const closing=f.flow.service();await turn();assert.equal(f.starts.at(-1)!.method,'close');assert.equal(f.active,1);
 assert.equal(f.flow.usage().protocolFrames,1);assert.equal(f.flow.usage().unmanagedControlUnits,0);assert.ok(transport.written.length>0);
 transport.receive(Buffer.from([0x88,0x02,0x03,0xe8]));transport.push(null);assert.equal((await closing).kind,'close');await turn();
 assert.equal(f.active,0);assert.equal(f.flow.usage().physicalTransportsSettled,true);
 assert.equal(f.records.some(row=>row.kind==='native-flow-suppressed-library-control'),false);await f.flow.stop();
});
