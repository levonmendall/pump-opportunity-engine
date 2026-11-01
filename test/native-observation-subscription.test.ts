import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import WebSocket from 'ws';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {setup,scope,settle} from './native-flow-fixture.js';

test('fresh preflight is adopted once while another actual subscription stays healthy',async()=>{
 const f=setup({maximumCandidates:4}),socket=await f.open(),prior=f.flow.snapshot(scope.mint)!,mint=new PublicKey(Buffer.alloc(32,71)),pending={mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58()};
 try{const result=await f.flow.prepareObservation(pending);assert.equal(result.status,'ready');if(result.status!=='ready')return;const reads=f.supportCalls.length,preparedAt=result.support.at;
  assert.equal(f.flow.usage().candidates,1);await f.advance(100);f.flow.addCandidate(pending);f.flow.adoptPreparedObservation(pending.mint,result.support);assert.equal(f.flow.captureState(pending.mint)!.subscriptionSentAt,null);assert.equal(f.flow.servicePlan().action,'subscribe');await f.drive();
  assert.equal(f.supportCalls.length,reads);assert.equal(f.flow.snapshot(pending.mint)!.supportContext!.availableAt,preparedAt);assert.equal(f.flow.snapshot(pending.mint)!.connected,true);assert.equal(f.flow.snapshot(pending.mint)!.warm,false);assert.equal(f.flow.snapshot(scope.mint)!.openedAt,prior.openedAt);assert.equal(socket.readyState,WebSocket.OPEN);assert.equal(f.gaps.length,0);
 }finally{await f.flow.stop();}
});

test('unselected missing-pool and HTTP failures cannot invalidate an actual healthy peer capture',async()=>{
 const f=setup({maximumCandidates:4}),socket=await f.open(),before=f.flow.snapshot(scope.mint)!,mint=new PublicKey(Buffer.alloc(32,72)),pending={mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58()};
 try{f.setSupportUnavailable('NATIVE_OBSERVATION_POOL_MISSING');assert.equal((await f.flow.prepareObservation(pending)).status,'unavailable');f.setSupportUnavailable(undefined);f.setSupportFailure(Error('PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'));assert.equal((await f.flow.prepareObservation(pending)).status,'unavailable');
  assert.equal(f.flow.usage().candidates,1);assert.equal(f.flow.snapshot(scope.mint)!.connected,true);assert.equal(f.flow.snapshot(scope.mint)!.openedAt,before.openedAt);assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,false);assert.equal(socket.readyState,WebSocket.OPEN);assert.equal(f.gaps.length,0);f.notice(socket);assert.ok(f.trades.length>0,'healthy peer continues admitting its own actual scoped events');
 }finally{await f.flow.stop();}
});

test('request-sent reporting begins on actual managed send and remains distinct from later ACK',async()=>{
 const sent:Array<{mint:string;at:number;connection:number;operationId:number}>=[],f=setup({maximumCandidates:4,onSubscriptionSent:row=>sent.push(row)}),socket=await f.open(),mint=new PublicKey(Buffer.alloc(32,73)),pending={mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58()};
 try{const result=await f.flow.prepareObservation(pending);assert.equal(result.status,'ready');if(result.status!=='ready')return;f.flow.addCandidate(pending);f.flow.adoptPreparedObservation(pending.mint,result.support);assert.equal(sent.length,1);assert.equal(f.flow.captureState(pending.mint)!.subscriptionSentAt,null);
  const original=socket.send.bind(socket);socket.send=(body,callback)=>{const request=JSON.parse(body);if(request.method==='logsSubscribe'){socket.sent.push(request);callback?.();}else original(body,callback);};
  const operation=f.flow.service();await settle();const actual=sent.at(-1)!;assert.equal(sent.length,2);assert.equal(actual.mint,pending.mint);assert.equal(f.flow.captureState(pending.mint)!.subscriptionSentAt,actual.at);assert.equal(f.flow.captureState(pending.mint)!.openedAt,null);assert.equal(f.flow.captureState(pending.mint)!.connected,false);assert.equal(f.flow.usage().sharedOperationActive,true);
  await f.advance(50);socket.frame({jsonrpc:'2.0',id:actual.operationId,result:991});await operation;assert.equal(f.flow.captureState(pending.mint)!.openedAt,f.now);assert.equal(f.flow.captureState(pending.mint)!.subscriptionSentAt,actual.at);assert.equal(f.flow.captureState(pending.mint)!.connected,true);assert.equal(f.flow.snapshot(pending.mint)!.warm,false);
 }finally{await f.flow.stop();}
});
