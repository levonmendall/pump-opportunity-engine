/** SYNTHETIC queued-ACK/cancellation ordering. No provider/account access. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {setup,settle,scope} from './native-flow-fixture.js';

test('cancelled managed unsubscribe retains actual physical ownership through a queued ACK until transport close',async()=>{
 const f=setup(),socket=await f.open();socket.autoClose=false;let request:any=null;
 const original=socket.send.bind(socket);socket.send=(data,callback)=>{const body=JSON.parse(data);if(body.method==='logsUnsubscribe'){socket.sent.push(body);request=body;callback?.();return;}original(data,callback);};
 f.flow.removeCandidate(scope.mint,'SYNTHETIC retired candidate');const controller=new AbortController();let settled=false;const operation=f.flow.service(controller.signal);void operation.then(()=>{settled=true;});await settle();assert.equal(request?.method,'logsUnsubscribe');assert.equal(f.active,1);assert.equal(f.flow.usage().nativePhysicalOperations,1);
 controller.abort();await settle();assert.equal(socket.readyState,WebSocket.CLOSING);assert.equal(settled,false);
 // A complete ACK can already be queued in ws when cancellation starts. It
 // must not complete the cancelled work while that same transport is closing.
 const raw=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:request.id,result:true}));socket._socket.bytesRead+=raw.length+4;socket._socket.emit('data',raw);socket.emit('message',raw);await settle();
 assert.equal(settled,false,'queued ACK must not free a cancelled physical request');assert.equal(f.active,1);assert.equal(f.flow.usage().nativePhysicalOperations,1);assert.equal(f.flow.usage().physicalTransportsSettled,false);
 socket.drop();await operation;await settle();assert.equal(settled,true);assert.equal(f.active,0);assert.equal(f.flow.usage().nativePhysicalOperations,0);assert.equal(f.flow.usage().connected,false);
 const refusal=f.records.find(r=>r.kind==='native-flow-control-refused'&&r.data.method==='logsUnsubscribe');assert.ok(refusal);assert.equal(refusal.data.acknowledgement.booleanResult,true);assert.equal(refusal.data.cancelled,true);assert.equal(refusal.data.transportClosing,true);assert.equal(refusal.data.physicalSettlementClaimed,false);assert.equal(refusal.data.writeCallbackSucceeded,true);assert.equal(typeof refusal.data.requestStartedAt,'number');assert.equal(typeof refusal.data.abortRequestedAt,'number');assert.equal(typeof refusal.data.acknowledgement.transportReceiptLowerBoundAt,'number');assert.equal(typeof refusal.data.acknowledgement.handledAt,'number');await f.flow.stop();
});
