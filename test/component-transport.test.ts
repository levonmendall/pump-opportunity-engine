import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import WebSocket from 'ws';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport} from '../src/component-transport.js';
function setup(){let now=200000;const dir=mkdtempSync(join(tmpdir(),'poe-component-transport-'));
 const budget=new ComponentBudget({statePath:join(dir,'book.json'),grantId:'test-component',startedAt:now,baseline:{calls:20,bytes:272634,starts:Array.from({length:20},(_,i)=>1000+i),refusal:'RPC_HTTP_429',refusalAt:2000,sha256:'a'.repeat(64)},now:()=>now,monotonic:()=>now,sleep:async ms=>{now+=ms;}});
 return {budget,now:()=>now,advance(ms:number){now+=ms;},cleanup(){budget.close();rmSync(dir,{recursive:true,force:true});}};}
const turn=()=>new Promise<void>(r=>setImmediate(r));

test('HTTP429 stops at headers, retains uncertain body reserve and prior refusal, and never retries',{timeout:3000},async()=>{
 const f=setup();let calls=0,reads=0,cancelled=false;const records:any[]=[];
 try{const client=new ComponentTransport(f.budget,(kind,data)=>records.push({kind,data}),()=>{},f.now,(async()=>{calls++;return new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(new TextEncoder().encode('{"error":"limit"}'));controller.close();},cancel(){cancelled=true;}},{highWaterMark:0}),{status:429,headers:{'retry-after':'60'}});}) as typeof fetch);
 await assert.rejects(client.call('getSlot'),/429/);await turn();assert.equal(calls,1);assert.equal(reads,0);assert.equal(cancelled,true);assert.equal(f.budget.calls,21);assert.equal(f.budget.usage().httpBytes,0);assert.equal(f.budget.usage().baseline.refusal,'RPC_HTTP_429');assert.equal(f.budget.usage().pending.length,1);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);await assert.rejects(client.call('getSlot'));assert.equal(calls,1);assert.equal(records[0].data.retryAfter,'60');
 }finally{f.cleanup();}
});
test('a fully received bounded HTTP503 body is charged exactly without an unknown response reservation',async()=>{
 const f=setup(),records:any[]=[];let calls=0;
 const text='private provider error body is not telemetry',body=new TextEncoder().encode(text);
 try{const client=new ComponentTransport(f.budget,(kind,data)=>records.push({kind,data}),()=>{},f.now,(async()=>{calls++;return new Response(body,{status:503,headers:{'content-length':String(body.byteLength),'retry-after':'5'}});})as typeof fetch);
 await assert.rejects(client.call('getSlot'),/^Error: COMPONENT_HTTP_STATUS_503$/);await turn();const usage=f.budget.usage();
 assert.equal(calls,1);assert.equal(usage.httpBytes,body.byteLength);assert.equal(usage.pending.length,0);assert.equal(usage.uncertainResponseBytes,0);assert.equal(usage.haltedReason,'COMPONENT_HTTP_STATUS_503');assert.equal(usage.baseline.bytes,272634);assert.equal(usage.baseline.refusal,'RPC_HTTP_429');
 assert.deepEqual(records.find(r=>r.kind==='http-response-timing').data,{id:21,method:'getSlot',requestedAt:f.now(),availableAt:f.now(),responseBytes:body.byteLength,status:503});assert.equal(records.find(r=>r.kind==='http-headers').data.retryAfter,'5');assert.equal(JSON.stringify(records).includes(text),false);
 await assert.rejects(client.call('getSlot'),/HALTED/);assert.equal(calls,1,'no automatic retry follows a complete error response');
 }finally{f.cleanup();}
});
test('stalled HTTP503 body times out, charges partial receipt and preserves uncertain response bytes',{timeout:3000},async()=>{
 const f=setup();let canceled=false,pulls=0;const partial=new TextEncoder().encode('partial-error');
 try{const client=new ComponentTransport(f.budget,()=>{},()=>{},f.now,(async()=>new Response(new ReadableStream({pull(controller){if(pulls++===0)controller.enqueue(partial);},cancel(){canceled=true;}},{highWaterMark:0}),{status:503}))as typeof fetch);
 await assert.rejects(client.call('getSlot',[],undefined,{timeoutMs:10}),/PHYSICAL_TIMEOUT/);await turn();const usage=f.budget.usage();assert.equal(canceled,true);assert.equal(usage.httpBytes,partial.byteLength);assert.equal(usage.pending.length,1);assert.equal(usage.uncertainResponseBytes,2*1024*1024);assert.equal(usage.haltedReason,'COMPONENT_PHYSICAL_TIMEOUT');assert.equal(usage.inFlight,0);
 }finally{f.cleanup();}
});
test('canceling a partially received HTTP503 cannot turn cancellation into a complete response',async()=>{
 const f=setup(),controller=new AbortController();let canceled=false,pulls=0;
 try{const partial=new TextEncoder().encode('partial-error'),client=new ComponentTransport(f.budget,()=>{},()=>{},f.now,(async()=>new Response(new ReadableStream({pull(stream){if(pulls++===0)stream.enqueue(partial);},cancel(){canceled=true;}},{highWaterMark:0}),{status:503}))as typeof fetch);
 const pending=client.call('getSlot',[],controller.signal);await turn();controller.abort();await assert.rejects(pending,/ABORTED/);await turn();assert.equal(canceled,true);assert.equal(f.budget.usage().httpBytes,partial.byteLength);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);assert.equal(f.budget.usage().pending.length,1);assert.equal(f.budget.inFlight,0);
 }finally{f.cleanup();}
});
test('declared oversize HTTP503 is canceled before reading and preserves uncertainty',async()=>{
 const f=setup();let canceled=false,pulls=0;
 try{const client=new ComponentTransport(f.budget,()=>{},()=>{},f.now,(async()=>new Response(new ReadableStream({pull(){pulls++;},cancel(){canceled=true;}},{highWaterMark:0}),{status:503,headers:{'content-length':String(2*1024*1024+1)}}))as typeof fetch);
 await assert.rejects(client.call('getSlot'),/RESPONSE_SIZE/);await turn();assert.equal(canceled,true);assert.equal(pulls,0);assert.equal(f.budget.usage().httpBytes,0);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);
 }finally{f.cleanup();}
});
test('streamed oversize HTTP503 charges delivered chunks and cannot mark a partial body complete',async()=>{
 const f=setup();let canceled=false,index=0;
 try{const chunks=[new Uint8Array(1024*1024),new Uint8Array(1024*1024),new Uint8Array(1)];
 const client=new ComponentTransport(f.budget,()=>{},()=>{},f.now,(async()=>new Response(new ReadableStream({pull(controller){const chunk=chunks[index++];if(chunk)controller.enqueue(chunk);},cancel(){canceled=true;}},{highWaterMark:0}),{status:503}))as typeof fetch);
 await assert.rejects(client.call('getSlot'),/RESPONSE_BYTE_CAP/);await turn();assert.equal(canceled,true);assert.equal(f.budget.usage().httpBytes,2*1024*1024+1);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);assert.equal(f.budget.usage().pending.length,1);
 }finally{f.cleanup();}
});
test('truncated HTTP503 body does not clear uncertainty when the identity Content-Length disagrees',async()=>{
 const f=setup(),partial=new TextEncoder().encode('truncated');
 try{const client=new ComponentTransport(f.budget,()=>{},()=>{},f.now,(async()=>new Response(partial,{status:503,headers:{'content-length':String(partial.byteLength+1)}}))as typeof fetch);
 await assert.rejects(client.call('getSlot'),/TRUNCATED_RESPONSE/);await turn();assert.equal(f.budget.usage().httpBytes,partial.byteLength);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);assert.equal(f.budget.usage().pending.length,1);
 }finally{f.cleanup();}
});
type AckMode='normal'|'pre-notice'|'invalid'|'error'|'none';
class FakeSocket extends EventEmitter{
 readyState:number=WebSocket.OPEN;_socket=Object.assign(new EventEmitter(),{bytesRead:100});sent=0;
 constructor(readonly ack:AckMode='normal',readonly autoClose=true){super();queueMicrotask(()=>this.emit('open'));}
 receive(message:unknown){const body=Buffer.from(JSON.stringify(message));this._socket.bytesRead+=body.length;this._socket.emit('data');this.emit('message',body);}
 send(text:string,callback?:(error?:Error)=>void){const p=JSON.parse(text);this.sent++;queueMicrotask(()=>{callback?.();if(this.ack==='none')return;if(this.ack==='pre-notice')this.notice();this.receive(this.ack==='error'?{jsonrpc:'2.0',id:p.id,error:{code:-32005,message:'overload'}}:{jsonrpc:'2.0',id:p.id,result:this.ack==='invalid'?'invalid':p.method==='accountSubscribe'?7:true});});}
 terminate(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSING;if(this.autoClose)queueMicrotask(()=>this.finishClose());}
 finishClose(){this.readyState=WebSocket.CLOSED;this.emit('close',1006);}
 notice(){this.receive({jsonrpc:'2.0',method:'accountNotification',params:{subscription:7,result:{context:{slot:123},value:{owner:'owner',lamports:1,executable:false,data:['Ag==','base64']}}}});}
}
test('upgrade, ACK and passive data share counters without double-counting socket/payload',{timeout:3000},async()=>{
 const f=setup();let socket:FakeSocket|undefined;const notices:any[]=[];
 try{const c=new ComponentTransport(f.budget,()=>{},n=>notices.push(n),f.now,undefined,()=>{socket=new FakeSocket();return socket as unknown as WebSocket;});
 await c.connect();await c.manage('accountSubscribe','scoped');socket!.notice();assert.equal(f.budget.newUnits,2);assert.equal(c.notifications,1);assert.equal(notices[0].address,'scoped');assert.equal(f.budget.usage().wsBytes,socket!._socket.bytesRead);assert.equal(c.socketBytes,socket!._socket.bytesRead);assert.ok(c.applicationBytes<c.socketBytes);await c.manage('accountUnsubscribe',7);assert.equal(f.budget.newUnits,3);assert.equal(f.budget.usage().pending.length,0);await c.terminateAndWait('test');
 }finally{f.cleanup();}
});
test('raw partial and oversized receipt is charged before application parsing',async()=>{
 const f=setup();let socket:FakeSocket|undefined;
 try{const c=new ComponentTransport(f.budget,()=>{},()=>{},f.now,undefined,()=>{socket=new FakeSocket();return socket as unknown as WebSocket;});
 await c.connect();const initial=f.budget.usage().wsBytes;
 socket!._socket.bytesRead+=2*1024*1024+1;socket!._socket.emit('data');assert.equal(f.budget.usage().wsBytes,initial+2*1024*1024+1);assert.equal(c.applicationBytes,0);
 const oversized=Buffer.alloc(65537);socket!._socket.bytesRead+=oversized.length;socket!._socket.emit('data');socket!.emit('message',oversized);await turn();assert.equal(c.error()?.message,'COMPONENT_WS_PAYLOAD_STOP');assert.equal(f.budget.usage().wsBytes,initial+2*1024*1024+1+oversized.length);assert.equal(f.budget.newUnits,1);await assert.rejects(c.manage('accountSubscribe','selected'));
 }finally{f.cleanup();}
});
test('notification before subscribe ACK preserves receipt time and resolves only the acknowledged scope',async()=>{
 const f=setup(),notices:any[]=[];let socket:FakeSocket|undefined;
 try{const c=new ComponentTransport(f.budget,()=>{},n=>notices.push(n),f.now,undefined,()=>{socket=new FakeSocket('pre-notice');return socket as unknown as WebSocket;});
 await c.connect();await c.manage('accountSubscribe','selected');assert.equal(notices.length,1);assert.equal(notices[0].address,'selected');assert.equal(notices[0].at,201000);assert.equal(c.error(),null);await c.terminateAndWait('test');
 }finally{f.cleanup();}
});
for(const ack of ['invalid','error'] as const)test('rejected '+ack+' ACK halts without an automatic second request',async()=>{
 const f=setup();let socket:FakeSocket|undefined;
 try{const c=new ComponentTransport(f.budget,()=>{},()=>{},f.now,undefined,()=>{socket=new FakeSocket(ack);return socket as unknown as WebSocket;});
 await c.connect();await assert.rejects(c.manage('accountSubscribe','selected'),ack==='error'?/OVERLOAD/:/ACK_INVALID/);await turn();assert.equal(socket!.sent,1);assert.equal(f.budget.newUnits,2);assert.equal(f.budget.usage().pending.length,0);await assert.rejects(c.manage('accountSubscribe','selected'));assert.equal(socket!.sent,1);await c.terminateAndWait('test');
 }finally{f.cleanup();}
});
test('missing ACK cancellation retains uncertain response and cannot release a replacement request',async()=>{
 const f=setup();let socket:FakeSocket|undefined;
 try{const c=new ComponentTransport(f.budget,()=>{},()=>{},f.now,undefined,()=>{socket=new FakeSocket('none');return socket as unknown as WebSocket;});
 await c.connect();const abort=new AbortController(),pending=c.manage('accountSubscribe','selected',abort.signal);await turn();abort.abort();await assert.rejects(pending);await turn();assert.equal(f.budget.newUnits,2);assert.equal(f.budget.usage().pending.length,1);assert.equal(f.budget.usage().uncertainResponseBytes,64*1024);assert.equal(f.budget.inFlight,0);await assert.rejects(c.manage('accountSubscribe','selected'));assert.equal(socket!.sent,1);await c.terminateAndWait('test');
 }finally{f.cleanup();}
});
test('planned reconnect waits for CLOSED and ignores stale first-socket events',async()=>{
 const f=setup(),records:any[]=[];const sockets:FakeSocket[]=[];
 try{const c=new ComponentTransport(f.budget,(kind,data)=>records.push({kind,data}),()=>{},f.now,undefined,()=>{const s=new FakeSocket('normal',sockets.length>0);sockets.push(s);return s as unknown as WebSocket;});
 await c.connect();await c.manage('accountSubscribe','first');const closing=c.terminateAndWait('planned');await assert.rejects(c.connect(),/OLD_SOCKET_NOT_CLOSED/);assert.equal(f.budget.newUnits,2);sockets[0]!.finishClose();await closing;await c.connect();await c.manage('accountSubscribe','replacement');const bytes=f.budget.usage().wsBytes;
 sockets[0]!.notice();sockets[0]!.emit('error',Error('late'));sockets[0]!.emit('close',1006);assert.equal(c.error(),null);assert.equal(c.notifications,0);assert.equal(f.budget.usage().wsBytes,bytes);assert.equal(c.subscriptions.get(7),'replacement');assert.equal(records.filter(r=>r.kind==='ws-close'&&r.data.connection===1).length,1);assert.equal(f.budget.newUnits,4);await c.terminateAndWait('finished');
 }finally{f.cleanup();}
});
test('close timeout halts without opening a second session',async()=>{
 const f=setup();let socket:FakeSocket|undefined;
 try{const c=new ComponentTransport(f.budget,()=>{},()=>{},f.now,undefined,()=>{socket=new FakeSocket('normal',false);return socket as unknown as WebSocket;});await c.connect();await assert.rejects(c.terminateAndWait('planned',5),/CLOSE_TIMEOUT/);assert.equal(f.budget.newUnits,1);await assert.rejects(c.connect());socket!.finishClose();
 }finally{f.cleanup();}
});
test('unsupported request methods are denied before network and budget use',async()=>{
 const f=setup();let calls=0;
 try{const c=new ComponentTransport(f.budget,()=>{},()=>{},f.now,(async()=>{calls++;throw Error('must not fetch');}) as typeof fetch);
 await assert.rejects(c.call('sendTransaction'));await assert.rejects(c.call('simulateTransaction'));assert.equal(calls,0);assert.equal(f.budget.newUnits,0);
 }finally{f.cleanup();}
});


test('HTTP lifecycle separates headers, body transfer and JSON availability without claiming pool reuse',async()=>{
 const f=setup(),records:any[]=[];let index=0;
 try{const a=new TextEncoder().encode('{"jsonrpc":"2.0","id":21,"result":'),b=new TextEncoder().encode('123}');
 const c=new ComponentTransport(f.budget,(kind,data)=>records.push({kind,data}),()=>{},f.now,(async()=>{f.advance(25);return new Response(new ReadableStream({pull(stream){if(index++===0){f.advance(40);stream.enqueue(a);}else if(index===2){f.advance(60);stream.enqueue(b);}else{f.advance(5);stream.close();}}},{highWaterMark:0}),{status:200});})as typeof fetch);
 assert.equal(await c.call('getSlot'),123);const row=records.find(r=>r.kind==='http-lifecycle-timing')!.data;
 assert.equal(row.requestedAt,200000);assert.equal(row.headersAt,200025);assert.equal(row.firstBodyAt,200065);assert.equal(row.lastBodyAt,200125);assert.equal(row.bodyCompleteAt,200130);assert.equal(row.jsonDecodedAt,200130);assert.equal(row.headersDelayMs,25);assert.equal(row.bodyAfterHeadersMs,105);assert.equal(row.chunksReceived,2);assert.equal(row.responseBytes,a.byteLength+b.byteLength);assert.equal(row.outcome,'json-decoded');assert.equal(row.aborted,false);assert.ok(row.jsonDecodeMonotonicMs>=0);assert.match(row.connectionReuse,/not-instrumented/);assert.equal(f.budget.usage().uncertainResponseBytes,0);
 }finally{f.cleanup();}
});

test('HTTP lifecycle retains partial successful-body timing after timeout without logging payload',{timeout:3000},async()=>{
 const f=setup(),records:any[]=[];let pulls=0,cancelled=false;const payload=new TextEncoder().encode('PRIVATE_BODY_NEVER_TELEMETRY');
 try{const c=new ComponentTransport(f.budget,(kind,data)=>records.push({kind,data}),()=>{},f.now,(async()=>new Response(new ReadableStream({pull(stream){if(pulls++===0)stream.enqueue(payload);},cancel(){cancelled=true;}},{highWaterMark:0}),{status:200}))as typeof fetch);
 await assert.rejects(c.call('getSlot',[],undefined,{timeoutMs:10}),/PHYSICAL_TIMEOUT/);await turn();const row=records.find(r=>r.kind==='http-lifecycle-timing')!.data;
 assert.equal(row.status,200);assert.equal(row.responseBytes,payload.byteLength);assert.equal(row.chunksReceived,1);assert.equal(row.firstBodyAt,200000);assert.equal(row.bodyCompleteAt,null);assert.equal(row.jsonDecodedAt,null);assert.equal(row.jsonDecodeMonotonicMs,null);assert.equal(row.aborted,true);assert.equal(cancelled,true);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);assert.equal(JSON.stringify(records).includes('PRIVATE_BODY_NEVER_TELEMETRY'),false);
 }finally{f.cleanup();}
});

test('HTTP lifecycle does not emit a settled-body claim while timed-out fetch still owns physical gate',{timeout:3000},async()=>{
 const f=setup(),records:any[]=[];let release!:(r:Response)=>void;
 try{const c=new ComponentTransport(f.budget,(kind,data)=>records.push({kind,data}),()=>{},f.now,(()=>new Promise<Response>(resolve=>{release=resolve;}))as typeof fetch);
 await assert.rejects(c.call('getSlot',[],undefined,{timeoutMs:10}),/PHYSICAL_TIMEOUT/);assert.equal(f.budget.inFlight,1);assert.equal(records.some(r=>r.kind==='http-lifecycle-timing'),false);release(new Response('{"jsonrpc":"2.0","id":21,"result":123}'));
 for(let n=0;n<20&&f.budget.inFlight;n++)await turn();assert.equal(f.budget.inFlight,0);const row=records.find(r=>r.kind==='http-lifecycle-timing')!.data;assert.equal(row.aborted,true);assert.equal(row.bodyCompleteAt,null);assert.equal(row.jsonDecodedAt,null);assert.match(row.validationScope,/caller owns/);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);
 }finally{f.cleanup();}
});

test('HTTP lifecycle distinguishes fully received malformed JSON from a validated response',async()=>{
 const f=setup(),records:any[]=[];
 try{const c=new ComponentTransport(f.budget,(kind,data)=>records.push({kind,data}),()=>{},f.now,(async()=>new Response('{PRIVATE_MALFORMED'))as typeof fetch);
 await assert.rejects(c.call('getSlot'),/MALFORMED_JSON/);const row=records.find(r=>r.kind==='http-lifecycle-timing')!.data;assert.equal(row.bodyCompleteAt,200000);assert.equal(row.jsonDecodedAt,null);assert.equal(row.outcome,'COMPONENT_HTTP_MALFORMED_JSON');assert.ok(row.jsonDecodeMonotonicMs>=0);assert.equal(f.budget.usage().uncertainResponseBytes,0);assert.equal(JSON.stringify(records).includes('PRIVATE_MALFORMED'),false);
 }finally{f.cleanup();}
});
