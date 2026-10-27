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
function fixture(options:{closeAt?:number;events?:Array<{at:number;payload:unknown;bytes?:number}>;result?:(signature:string)=>unknown;failure?:string;pacing?:boolean;rpcDurationMs?:number;physicalStartLatencyMs?:number}={}){
  let clock=Date.parse(raw.fetchedAt),elapsed=0,units=20,active=0,halted:string|null=null,wsBytes=0,attempts=0;const rows:Array<{kind:string;data:any}>=[],operations:ComponentKind[]=[],requestedAt:number[]=[];
  const socket=new Socket(),events=[...(options.events??[])];
  const actualStarts:number[]=[],physicalOperations:Array<{kind:ComponentKind;at:number}>=[],waiters:Array<{at:number;resolve:()=>void}>=[];
  const budget={get calls(){return units;},get inFlight(){return active;},chargeWs(n:number){wsBytes+=n;},usage(){return {haltedReason:halted,baseline:{starts:[Date.parse(raw.fetchedAt)-10000]},starts:[...actualStarts]};},async operate(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<unknown>){operations.push(kind);if(options.pacing&&actualStarts.length&&clock<actualStarts.at(-1)!+1000)await new Promise<void>(resolve=>waiters.push({at:actualStarts.at(-1)!+1000,resolve}));clock+=options.physicalStartLatencyMs??0;elapsed+=options.physicalStartLatencyMs??0;units++;active++;actualStarts.push(clock);physicalOperations.push({kind,at:clock});try{return await work({id:units,signal:new AbortController().signal,chargeHttp(){},completeResponse(){}});}catch(e){halted=e instanceof Error?e.message:'COMPONENT_TEST_FAILURE';throw e;}finally{active--;}}} as unknown as ComponentBudget;
  const rpc={budget,error(){return null;},async call<T>(method:string,params:unknown[]){assert.equal(method,'getTransaction');attempts++;requestedAt.push(clock);return budget.operate({transport:'http',method},async()=>{if(options.failure)throw Error(options.failure);clock+=options.rpcDurationMs??20;elapsed+=options.rpcDurationMs??20;return (options.result?.(String(params[0]))??raw.transaction) as T;});}} as unknown as ComponentTransport;
  const input={scope,budget,rpc,record:(kind:string,data:unknown)=>rows.push({kind,data}),signal:new AbortController().signal};
  const dependencies={makeSocket(endpoint:string,config:WebSocket.ClientOptions){assert.equal(endpoint,'wss://stream.pumpapi.io/');assert.equal(config.maxPayload,65536);assert.equal(config.followRedirects,false);queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;},now:()=>clock,monotonic:()=>elapsed,async sleep(ms:number){clock+=ms;elapsed+=ms;while(events[0]&&events[0].at<=elapsed&&!socket.done){const event=events.shift()!;socket.frame(event.payload,event.bytes);}for(let i=waiters.length-1;i>=0;i--)if(waiters[i]!.at<=clock)waiters.splice(i,1)[0]!.resolve();if(options.closeAt!==undefined&&elapsed>=options.closeAt)socket.terminate();for(let i=0;i<(options.pacing?8:1);i++)await Promise.resolve();}};
  return {input,dependencies,rows,operations,physicalOperations,requestedAt,socket,get attempts(){return attempts;},get wsBytes(){return wsBytes;}};
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

const clockQuote=(at:number)=>({mint:scope.mint,slot:scope.minSlot,commitment:'confirmed',receivedAt:new Date(at).toISOString(),timeEvidence:'confirmed-bank-clock' as const,clockSlot:scope.minSlot,marketClockUnixSeconds:Math.floor(at/1000),sell:{inputBaseUnits:scope.baseUnits,outputLamports:'1000000'}});

test('absolute2s pricing takes priority over simultaneously ready burst hints without altering enrichment collection',async()=>{
  const secondSignature=bs58.encode(Buffer.alloc(64,90));
  const f=fixture({closeAt:6200,rpcDurationMs:0,events:[{at:1000,payload:selected()},{at:1000,payload:selected(secondSignature)}],result:signature=>({...raw.transaction,transaction:{...raw.transaction.transaction,signatures:[signature]}})});
  const starts:Array<{kind:string;at:number}>=[];
  const protection={everyMs:2000 as const,quote:async(_signal:AbortSignal,knownConfirmedSlot:number)=>{assert.equal(knownConfirmedSlot,scope.minSlot);starts.push({kind:'price',at:f.dependencies.now()});return f.input.budget.operate({transport:'http',method:'getMultipleAccounts'},async()=>clockQuote(f.dependencies.now()));}};
  const original=f.input.rpc.call.bind(f.input.rpc);f.input.rpc.call=(async(method:string,params:unknown[])=>{starts.push({kind:'hint',at:f.dependencies.now()});return original(method,params);}) as typeof f.input.rpc.call;
  const r=await captureOvernightFields({...f.input,observationMs:70000,protection},f.dependencies);
  assert.equal(r.normalizedEvents,2);assert.equal(r.priceAttempts,4);assert.equal(r.protection.unavailable,0);assert.equal(r.protection.missedSchedules,0);
  assert.deepEqual(starts.slice(0,3).map(x=>x.kind),['price','price','hint']);assert.ok(starts[2]!.at>=starts[1]!.at);
  assert.ok(r.protection.outcomes.every(x=>x.usable&&x.quoteAgeAtUseMs!==null&&x.quoteAgeAtUseMs>=0&&x.quoteAgeAtUseMs<=2000));assert.equal(r.mode,'COMBINED_FIELD_AND_FIXED_2S_PROTECTION_RESEARCH');assert.equal(r.qualificationEnabled,false);
});

test('an unavailable quote marks separate protection gaps and continues monitoring without invalidating intact trade-flow collection',async()=>{
  const f=fixture();let count=0;
  const protection={everyMs:2000 as const,quote:async()=>{count++;const q=clockQuote(f.dependencies.now());return count===1?{...q,receivedAt:new Date(f.dependencies.now()-2100).toISOString()}:q;}};
  const r=await captureOvernightFields({...f.input,protection},f.dependencies);
  assert.equal(r.protection.unavailable,1);assert.ok(r.priceAttempts>=3);assert.ok(r.prices.accepted>=2);assert.equal(r.historicalWindowInvalidated,false);assert.equal(r.stopReason,'COMPONENT_FIELD_DURATION_LIMIT');assert.equal(r.qualityGaps.length,0);assert.equal(r.protection.gaps.length,1);assert.equal(r.protection.serviceQuality,'UNAVAILABLE_OR_MISSED_DEADLINE');assert.equal(r.combinedAcceptance,false);
  assert.equal(r.protection.outcomes[0]!.reason,'COMPONENT_PROTECTION_QUOTE_UNAVAILABLE');assert.ok(r.protection.outcomes.slice(1).every(x=>x.usable));
  assert.ok(r.prices.rows.every(x=>(x.sourceTimeEvidence as {kind:string}).kind==='confirmed-bank-clock'));
});

test('a delayed in-flight evaluation is not preempted; protection deadline gap is separate from retained complete trade evidence',async()=>{
  const f=fixture({events:[{at:100,payload:selected()}]}),base=f.dependencies.now(),originalSleep=f.dependencies.sleep;
  let release:(()=>void)|undefined,first=true;
  f.dependencies.sleep=async ms=>{await originalSleep(ms);if(release&&f.dependencies.now()-base>=2500){const ready=release;release=undefined;ready();}};
  const protection={everyMs:2000 as const,quote:async()=>{if(first){first=false;await new Promise<void>(r=>{release=r;});}return clockQuote(f.dependencies.now());}};
  const r=await captureOvernightFields({...f.input,protection},f.dependencies);
  assert.ok(r.protection.maxCompletedEvaluationGapMs>=2500);assert.equal(r.protection.outcomes[0]!.late,true);assert.ok(r.protection.missedSchedules>=1);assert.ok(r.priceAttempts>=3);assert.equal(f.attempts,1);assert.equal(r.historicalWindowInvalidated,false);assert.equal(r.qualityGaps.length,0);assert.ok(r.protection.gaps.length>=1);assert.equal(r.physicalSlotUncertain,false);
});

test('the70s component performs35 fixed-cadence evaluations but never self-certifies completeness or entries',async()=>{
  const f=fixture(),protection={everyMs:2000 as const,quote:async()=>clockQuote(f.dependencies.now())};
  const r=await captureOvernightFields({...f.input,observationMs:70000,protection},f.dependencies);
  assert.equal(r.stopReason,'COMPONENT_FIELD_DURATION_LIMIT');assert.equal(r.openMs,70000);assert.ok(r.elapsedMs<=75000);assert.equal(r.priceAttempts,35);assert.equal(r.protection.maxCompletedEvaluationGapMs,2000);assert.equal(r.complete60SecondFeatureWindows,0);assert.equal(r.qualificationEnabled,false);assert.equal(r.paperEntriesEnabled,false);
});

test('the75s component provides38 fixed-cadence callbacks without changing byte limits, observation rules or acceptance',async()=>{
  const f=fixture(),protection={everyMs:2000 as const,quote:async()=>clockQuote(f.dependencies.now())};
  const r=await captureOvernightFields({...f.input,observationMs:75000,protection},f.dependencies);
  assert.equal(r.stopReason,'COMPONENT_FIELD_DURATION_LIMIT');assert.equal(r.openMs,75000);assert.ok(r.elapsedMs<=80000);assert.equal(r.priceAttempts,38);assert.equal(r.protection.maxCompletedEvaluationGapMs,2000);assert.equal(r.complete60SecondFeatureWindows,0);assert.equal(r.combinedAcceptance,false);assert.equal(r.qualificationEnabled,false);assert.equal(r.paperEntriesEnabled,false);
});

test('a hint cannot enter a future pacer wait that consumes the holdings start; actual starts from either current or baseline history reserve protection first',async()=>{
  for(const history of ['current','baseline'] as const){
    const f=fixture({pacing:true,events:[{at:500,payload:selected()}]});
    if(history==='baseline'){
      const usage=f.input.budget.usage.bind(f.input.budget);
      f.input.budget.usage=(()=>{const old=usage();return {...old,baseline:{...old.baseline,starts:[...old.baseline.starts,...old.starts]},starts:[]};}) as typeof f.input.budget.usage;
    }
    const protection={everyMs:2000 as const,quote:async()=>f.input.budget.operate({transport:'http',method:'getMultipleAccounts'},async()=>clockQuote(f.dependencies.now()))};
    const r=await captureOvernightFields({...f.input,protection,experimentalStrictStartReservation:true},f.dependencies),physical=f.physicalOperations;
    assert.deepEqual(physical.slice(0,4).map(x=>x.kind.method),['upgrade','getMultipleAccounts','getMultipleAccounts','getTransaction']);
    const secondPrice=physical.filter(x=>x.kind.method==='getMultipleAccounts')[1]!,hint=physical.find(x=>x.kind.method==='getTransaction')!;
    assert.ok(hint.at>=secondPrice.at+1000);assert.ok(f.requestedAt[0]!>=secondPrice.at);
    assert.equal(r.enrichments,1);assert.equal(r.normalizedEvents,1);assert.equal(r.selectedMessages,1);assert.equal(r.pending,0);assert.equal(r.qualityGaps.length,0);assert.equal(r.protection.missedSchedules,0);
    assert.ok(r.candidateRpcAdmission.lowPriorityReservationDeferralChecks>0);assert.ok(r.protection.maxCompletedEvaluationGapMs<=2250);assert.ok(physical.slice(1).every((x,i)=>x.at-physical[i]!.at>=1000));
  }
});

test('strict reservation can exhaust candidate opportunity under phase jitter; retained unprocessed hints invalidate flow while holdings continue',async()=>{
  const f=fixture({pacing:true,physicalStartLatencyMs:10,events:[{at:500,payload:selected()}]});
  const protection={everyMs:2000 as const,quote:async()=>f.input.budget.operate({transport:'http',method:'getMultipleAccounts'},async()=>clockQuote(f.dependencies.now()))};
  const r=await captureOvernightFields({...f.input,protection,experimentalStrictStartReservation:true},f.dependencies);
  assert.equal(r.enrichments,0);assert.equal(r.normalizedEvents,0);assert.equal(r.selectedMessages,1);assert.equal(f.rows.filter(x=>x.kind==='selected-pumpapi-payload').length,1);assert.ok(r.priceAttempts>=14);assert.equal(r.historicalWindowInvalidated,true);
  assert.ok(r.qualityGaps.some(g=>['selected-enrichment-queue-expired','unresolved-enrichment-at-final-close'].includes(g.reason)));assert.equal(r.qualificationEnabled,false);assert.equal(r.complete60SecondFeatureWindows,0);assert.equal(r.combinedAcceptance,false);
});

test('default combined behavior keeps the tested2s-attempt policy; the rejected strict reservation is opt-in',async()=>{
  const f=fixture({pacing:true,physicalStartLatencyMs:10,events:[{at:500,payload:selected()}]});
  const protection={everyMs:2000 as const,quote:async()=>f.input.budget.operate({transport:'http',method:'getMultipleAccounts'},async()=>clockQuote(f.dependencies.now()))};
  const r=await captureOvernightFields({...f.input,protection},f.dependencies);
  assert.equal(r.candidateRpcAdmission.experimentalStrictStartReservation,false);assert.equal(r.candidateRpcAdmission.lowPriorityReservationDeferralChecks,0);assert.equal(r.enrichments,1);assert.equal(r.normalizedEvents,1);assert.equal(r.pending,0);assert.equal(r.qualityGaps.length,0);assert.equal(r.qualificationEnabled,false);
});
