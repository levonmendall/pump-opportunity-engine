import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import bs58 from 'bs58';
import {captureOvernightFields} from '../src/overnight-field.js';
import type {ComponentBudget,ComponentKind,ComponentOperation} from '../src/component-budget.js';
import type {ComponentTransport} from '../src/component-transport.js';
const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:raw.transaction.slot,supportedPoolEvidence:'OFFLINE fixture canonical proof only'};
const selected=(signature=raw.signature)=>({mint:scope.mint,poolId:scope.pool,pool:'pump-amm',signature,action:'sell',quoteAmount:1,txSigner:'UNTRUSTED_UI_VALUE'});
class Socket extends EventEmitter{
  _socket=Object.assign(new EventEmitter(),{bytesRead:200});done=false;
  terminate(){if(this.done)return;this.done=true;queueMicrotask(()=>this.emit('close'));}
  frame(payload:unknown,extra?:number){const b=Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));this._socket.bytesRead+=extra??b.length+4;this._socket.emit('data',b);this.emit('message',b);}
}
function fixture(options:{closeAt?:number;events?:Array<{at:number;payload:unknown;bytes?:number}>;result?:(signature:string)=>unknown;failure?:string}={}){
  let clock=Date.parse(raw.fetchedAt),elapsed=0,units=20,active=0,halted:string|null=null,wsBytes=0,attempts=0;const rows:Array<{kind:string;data:any}>=[],operations:ComponentKind[]=[],requestedAt:number[]=[];
  const socket=new Socket(),events=[...(options.events??[])];
  const budget={get calls(){return units;},get inFlight(){return active;},chargeWs(n:number){wsBytes+=n;},usage(){return {haltedReason:halted};},async operate(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<unknown>){operations.push(kind);units++;active++;try{return await work({id:units,signal:new AbortController().signal,chargeHttp(){},completeResponse(){}});}catch(e){halted=e instanceof Error?e.message:'COMPONENT_TEST_FAILURE';throw e;}finally{active--;}}} as unknown as ComponentBudget;
  const rpc={budget,error(){return null;},async call<T>(method:string,params:unknown[]){assert.equal(method,'getTransaction');attempts++;requestedAt.push(clock);return budget.operate({transport:'http',method},async()=>{if(options.failure)throw Error(options.failure);clock+=20;elapsed+=20;return (options.result?.(String(params[0]))??raw.transaction) as T;});}} as unknown as ComponentTransport;
  const input={scope,budget,rpc,record:(kind:string,data:unknown)=>rows.push({kind,data}),signal:new AbortController().signal};
  const dependencies={makeSocket(endpoint:string,config:WebSocket.ClientOptions){assert.equal(endpoint,'wss://stream.pumpapi.io/');assert.equal(config.maxPayload,65536);assert.equal(config.followRedirects,false);queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;},now:()=>clock,monotonic:()=>elapsed,async sleep(ms:number){clock+=ms;elapsed+=ms;while(events[0]&&events[0].at<=elapsed&&!socket.done){const event=events.shift()!;socket.frame(event.payload,event.bytes);}if(options.closeAt!==undefined&&elapsed>=options.closeAt)socket.terminate();await Promise.resolve();}};
  return {input,dependencies,rows,operations,requestedAt,socket,get attempts(){return attempts;},get wsBytes(){return wsBytes;}};
}

test('field-only path retains raw selected evidence and confirms once after1s with actual availability; broad irrelevant frames are discarded',async()=>{
  const f=fixture({closeAt:1700,events:[{at:100,payload:'unparsed broad irrelevant payload'},{at:200,payload:selected()},{at:300,payload:selected()}]});
  const r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.normalizedEvents,1);assert.equal(r.normalizedSells,1);assert.equal(r.duplicateSignatureHints,1);assert.equal(r.enrichments,1);assert.equal(f.attempts,1);
  assert.equal(r.frames,3);assert.equal(r.parsedFrames,2);assert.equal(r.irrelevantFrames,1);assert.equal(r.upgradeObservedBytes,200);assert.equal(f.wsBytes,200);assert.ok(r.socketBytes>200);
  assert.deepEqual(f.operations.map(x=>x.transport),['ws-upgrade','http']);assert.equal(r.physicalSlotUncertain,false);assert.equal(r.complete60SecondFeatureWindows,0);assert.equal(r.qualificationEnabled,false);assert.equal(r.priceAttempts,0);
  const payload=f.rows.find(x=>x.kind==='selected-pumpapi-payload')!.data,enrichment=f.rows.find(x=>x.kind==='confirmed-enrichment')!.data,trade=f.rows.find(x=>x.kind==='research-normalized-trade')!.data;
  assert.deepEqual(JSON.parse(payload.payloadUtf8),selected());assert.ok(enrichment.requestedAt>=payload.receivedAt+1000);assert.ok(enrichment.availableAt>payload.receivedAt);assert.equal(trade.curve.trade.receivedAt,enrichment.availableAt);assert.notEqual(trade.curve.trade.quoteLamports,'1');
  assert.equal(r.enrichmentHints[raw.signature]!.availableAt,enrichment.availableAt);assert.ok(r.historicalWindowInvalidated);
});

test('quiet30s component stops without another session or fabricated complete observation window',async()=>{
  const f=fixture(),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.stopReason,'COMPONENT_FIELD_DURATION_LIMIT');assert.equal(r.openMs,30000);assert.ok(r.elapsedMs<=35000);assert.equal(f.operations.length,1);assert.equal(f.attempts,0);assert.equal(r.normalizedEvents,0);assert.equal(r.complete60SecondFeatureWindows,0);assert.equal(r.physicalSlotUncertain,false);
});

test('preparse socket headroom and missing selected fields stop and invalidate without enrichment',async()=>{
  for(const event of [{at:100,payload:selected(),bytes:63*1024*1024},{at:100,payload:{...selected(),signature:null}}]){
    const f=fixture({events:[event]}),r=await captureOvernightFields(f.input,f.dependencies);
    assert.ok(['COMPONENT_FIELD_SOCKET_STOP','COMPONENT_FIELD_SELECTED_INVALID'].includes(r.stopReason!));assert.equal(f.attempts,0);assert.equal(r.historicalWindowInvalidated,true);assert.equal(r.physicalSlotUncertain,false);
  }
});

test('RPC429 stops one measurement, retains invalidation and makes no automatic retry',async()=>{
  const f=fixture({events:[{at:100,payload:selected()}],failure:'COMPONENT_HTTP_429'}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.stopReason,'COMPONENT_HTTP_429');assert.equal(f.attempts,1);assert.equal(r.normalizedEvents,0);assert.equal(r.historicalWindowInvalidated,true);assert.equal(r.physicalSlotUncertain,false);
});

test('at most24 confirmed enrichment attempts; the next required hint invalidates instead of dropping silently',async()=>{
  const events=Array.from({length:25},(_,i)=>({at:100+i*1000,payload:selected(bs58.encode(Buffer.alloc(64,i+1)))}));
  const f=fixture({events,result:signature=>({...raw.transaction,transaction:{...raw.transaction.transaction,signatures:[signature]}})}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.enrichments,24);assert.equal(f.attempts,24);assert.equal(r.stopReason,'COMPONENT_FIELD_ENRICHMENT_CAP');assert.equal(r.historicalWindowInvalidated,true);assert.equal(r.complete60SecondFeatureWindows,0);
});

test('mismatched RPC budget is refused before constructing any network client',async()=>{
  const f=fixture();f.input.rpc={...f.input.rpc,budget:{}} as unknown as ComponentTransport;
  await assert.rejects(captureOvernightFields(f.input,f.dependencies),/SHARED_BUDGET_REQUIRED/);assert.equal(f.operations.length,0);
});
