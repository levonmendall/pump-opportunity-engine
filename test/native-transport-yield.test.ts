/** OFFLINE transport stress. These wire frames and synchronous handler costs
 * are synthetic; they demonstrate event-loop mechanics, not provider latency. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';
import {WsReceiptClock} from '../src/ws-receipt-clock.js';
import {nativeCandidateWatchControlAdmission} from '../src/run-native-candidates.js';

async function receiveBurst(allowSynchronousEvents:boolean){
 const Receiver=(WebSocket as any).Receiver,receiver=new Receiver({isServer:false,maxPayload:65536,allowSynchronousEvents});
 const count=120,order:number[]=[];let atDeadline:number|null=null;
 // One already-received TCP chunk contains many small messages. Every message
 // must be retained in order; only callback scheduling may change.
 const frames=Array.from({length:count},(_,i)=>{const body=Buffer.from(String(i));return Buffer.concat([Buffer.from([0x81,body.length]),body]);});
 const end=new Promise<void>((resolve,reject)=>{receiver.on('message',(raw:Buffer)=>{order.push(Number(raw));const until=performance.now()+1;while(performance.now()<until){}if(order.length===count)resolve();});receiver.on('error',reject);});
 const timer=new Promise<void>(resolve=>{setTimeout(()=>{atDeadline=order.length;resolve();},10);});
 receiver.write(Buffer.concat(frames));await Promise.all([end,timer]);receiver.destroy();return {order,atDeadline};
}

test('SYNTHETIC one-chunk message burst yields to timers without dropping/reordering selected frames',async()=>{
 const original=await receiveBurst(true),corrected=await receiveBurst(false);
 assert.equal(original.atDeadline,120,'original synchronous callbacks prevent the10ms timer until all handlers finish');
 assert.ok(corrected.atDeadline!==null&&corrected.atDeadline<120,'yielding permits deadline servicing while the backlog remains');
 assert.deepEqual(corrected.order,Array.from({length:120},(_,i)=>i));assert.deepEqual(corrected.order,original.order);
});

test('due native retirement/support/peer controls retain the next shared service opportunity over WATCH reconnect',()=>{
 const at=10000;
 for(const nextServiceAt of [at-1,at])assert.equal(nativeCandidateWatchControlAdmission(false,true,{nextServiceAt},at),false);
 assert.equal(nativeCandidateWatchControlAdmission(false,true,{nextServiceAt:at+2001},at),true);
 assert.equal(nativeCandidateWatchControlAdmission(false,true,{nextServiceAt:Infinity},at),true,'empty closed selected source does not block discovery');
 assert.equal(nativeCandidateWatchControlAdmission(true,true,undefined,at),false);
 assert.equal(nativeCandidateWatchControlAdmission(false,false,undefined,at),false);
});

const wire=(body:string,opcode=0x81)=>{const b=Buffer.from(body);return Buffer.concat([Buffer.from([opcode,b.length]),b]);};
test('real pinned ws Receiver preserves the earlier receipt bound across queued TCP chunks and fragmented messages',async()=>{
 const Receiver=(WebSocket as any).Receiver,receiver=new Receiver({isServer:false,maxPayload:65536,allowSynchronousEvents:false}),clock=new WsReceiptClock(()=>receiver),rows:Array<{text:string;receipt:number;application:number}>=[];let application=100;
 receiver.on('message',(raw:Buffer)=>rows.push({text:raw.toString(),receipt:clock.receivedAt(application),application}));
 clock.chunk(100);receiver.write(wire('first'));application=200;clock.chunk(200);receiver.write(wire('second'));
 for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(rows.map(r=>r.text),['first','second']);assert.deepEqual(rows.map(r=>r.receipt),[100,100],'later chunks cannot relabel an older deferred frame fresh');assert.ok(rows.every(r=>r.receipt<=r.application));
 // FIN0 text frame then FIN1 continuation arrive in different chunks, with no
 // bytes left in the Writable between chunks. Framing state must retain1000.
 clock.chunk(1000);receiver.write(wire('frag',0x01));application=7000;clock.chunk(7000);receiver.write(wire('ment',0x80));
 for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(rows.at(-1),{text:'fragment',receipt:1000,application:7000});assert.ok(rows.at(-1)!.application-rows.at(-1)!.receipt>5000,'a six-second partial frame remains too old for the unchanged5s admission deadline');
 application=8000;clock.chunk(8000);receiver.write(wire('new'));for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));assert.deepEqual(rows.at(-1),{text:'new',receipt:8000,application:8000},'a fully drained receiver starts a fresh bounded batch');receiver.destroy();
});

test('unknown/destroyed receiver state retains the conservative bound without scheduling a local busy loop',()=>{
 for(const receiver of [{writableLength:1,_state:99,_bufferedBytes:0,_fragmented:0},{writableLength:0,_state:0,_bufferedBytes:0,_fragmented:0,destroyed:true},undefined]){
  const tasks:Array<()=>void>=[],clock=new WsReceiptClock(()=>receiver,work=>tasks.push(work));clock.chunk(100);assert.equal(tasks.length,1);tasks.shift()!();assert.equal(tasks.length,0);assert.equal(clock.receivedAt(6000),100);clock.chunk(6000);assert.equal(clock.receivedAt(6000),100);tasks.shift()!();assert.equal(tasks.length,0);
 }
});
