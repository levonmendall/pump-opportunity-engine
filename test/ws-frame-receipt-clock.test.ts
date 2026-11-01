import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {WsFrameReceiptClock,WS_FRAME_RECEIPT_POLICY} from '../src/ws-frame-receipt-clock.js';
import {WsReceiptClock} from '../src/ws-receipt-clock.js';
import {wsWire} from './ws-wire-fixture.js';
// The pinned implementation exposes Receiver through CommonJS; its separate
// @types package does not declare that parser as a named ESM export.
const {Receiver}=createRequire(import.meta.url)('ws');
const turn=()=>new Promise<void>(r=>setImmediate(r));
test('real pinned receiver: continuously queued fresh frames must not inherit the oldest batch timestamp',async()=>{
 const receiver=new Receiver({isServer:false,allowSynchronousEvents:false,maxPayload:512*1024});
 const old=new WsReceiptClock(()=>receiver),clock=new WsFrameReceiptClock(),rows:Array<{old:number;fresh:number;at:number}>=[];let at=100;
 const write=()=>{const b=wsWire(Buffer.from(String(at)));old.chunk(at);clock.chunk(b,at);receiver.write(b);};
 const done=new Promise<void>((resolve,reject)=>{receiver.on('error',reject);receiver.on('message',()=>{
  rows.push({old:old.receivedAt(at),fresh:clock.take('message',at).receivedAt,at});
  if(rows.length===70){resolve();return;}at+=100;write();
 });});
 write();await done;receiver.destroy();assert.ok(rows.at(-1)!.at-rows.at(-1)!.old>5000,'old implementation falsely ages a continuously arriving stream');
 assert.ok(rows.every(r=>r.fresh===r.at),'new frames retain their actual individual byte receipt');assert.equal(clock.usage().pendingEvents,0);
});
test('real receiver: queued old frames remain old, including when newer bytes arrive',async()=>{
 const receiver=new Receiver({isServer:false,allowSynchronousEvents:false,maxPayload:512*1024}),clock=new WsFrameReceiptClock(),rows:number[]=[];
 let at=100;receiver.on('message',()=>rows.push(clock.take('message',at).receivedAt));
 const first=Buffer.concat([wsWire(Buffer.from('one')),wsWire(Buffer.from('two'))]);clock.chunk(first,at);receiver.write(first);
 at=7000;const next=wsWire(Buffer.from('new'));clock.chunk(next,at);receiver.write(next);for(let i=0;i<10;i++)await turn();
 assert.deepEqual(rows,[100,100,7000]);receiver.destroy();
});
test('partial headers and fragments retain earliest bytes while interleaved controls have separate timestamps',()=>{
 const c=new WsFrameReceiptClock(),first=wsWire(Buffer.from('frag'),1,false);
 c.chunk(first.subarray(0,1),100);c.chunk(first.subarray(1),500);
 c.chunk(wsWire(Buffer.from('ping'),9),2000);assert.deepEqual(c.take('ping',2100),{kind:'ping',receivedAt:2000,completedAt:2000});
 c.chunk(wsWire(Buffer.from('ment'),0),7000);assert.deepEqual(c.take('message',7100),{kind:'message',receivedAt:100,completedAt:7000});
 c.chunk(wsWire(Buffer.from('pong'),10),7200);assert.equal(c.take('pong',7300).receivedAt,7200);assert.equal(c.usage().maximumMessageSpanMs,6900);
});
test('all supported frame lengths and arbitrary chunk boundaries preserve provenance',()=>{
 for(const size of [0,1,125,126,65535,65536,512*1024]){const c=new WsFrameReceiptClock(),wire=wsWire(Buffer.alloc(size));let at=100;
  for(let i=0;i<wire.length;i+=37)c.chunk(wire.subarray(i,i+37),at++);
  assert.equal(c.take('message',at).receivedAt,100);assert.equal(c.usage().pendingEvents,0);
 }
});
test('invalid framing, missing receipts and event mismatches fail closed, not refreshed to handler time',()=>{
 for(const bytes of [Buffer.from([0xc1,0]),Buffer.from([0x81,0x80]),Buffer.from([0x09,0]),Buffer.from([0x80,0]),Buffer.from([0x83,0])])assert.throws(()=>new WsFrameReceiptClock().chunk(bytes,100),/WS_FRAME_RECEIPT_/);
 const c=new WsFrameReceiptClock();assert.throws(()=>c.take('message',100),/EVENT_ORDER/);assert.throws(()=>c.chunk(wsWire(Buffer.from('x')),200),/UNAVAILABLE/);
 const p=new WsFrameReceiptClock();p.chunk(wsWire(Buffer.from('x')),100);assert.throws(()=>p.take('pong',100),/EVENT_ORDER/);
 const backwards=new WsFrameReceiptClock();backwards.chunk(Buffer.alloc(0),100);assert.throws(()=>backwards.chunk(Buffer.alloc(0),99),/CLOCK/);
});
test('receipt metadata capacity is explicit and never silently discards market events',()=>{
 const c=new WsFrameReceiptClock(),wire=wsWire(Buffer.alloc(0));for(let i=0;i<WS_FRAME_RECEIPT_POLICY.maximumPendingEvents;i++)c.chunk(wire,100);
 assert.throws(()=>c.chunk(wire,100),/EVENT_CAPACITY/);assert.equal(c.usage().failed,true);
});
