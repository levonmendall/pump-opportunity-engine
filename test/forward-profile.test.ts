import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import bs58 from 'bs58';
import {captureOvernightFields,OVERNIGHT_FIELD_LIMITS,SCHEDULER_FORWARD_FIELD_LIMITS} from '../src/overnight-field.js';
import type {ComponentBudget,ComponentKind,ComponentOperation} from '../src/component-budget.js';
import type {ComponentTransport} from '../src/component-transport.js';

// Entirely injected transport/clock: these tests cannot construct a live socket
// or send an HTTP request, and never touch a financial account or grant book.
const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:raw.transaction.slot,supportedPoolEvidence:'RETAINED OFFLINE TRANSPORT FIXTURE ONLY'};
const selected=(signature=raw.signature)=>({mint:scope.mint,poolId:scope.pool,pool:'pump-amm',signature,action:'sell'});
class Socket extends EventEmitter {
  _socket=Object.assign(new EventEmitter(),{bytesRead:200});done=false;
  terminate(){if(this.done)return;this.done=true;queueMicrotask(()=>this.emit('close'));}
  frame(payload:unknown,bytes?:number){const b=Buffer.from(JSON.stringify(payload));this._socket.bytesRead+=bytes??b.byteLength+4;this._socket.emit('data',b);this.emit('message',b);}
}
function fixture(options:{events?:Array<{at:number;payload:unknown;bytes?:number}>;transaction?:(signature:string)=>unknown;rpcMs?:number;setupMs?:number}={}){
  let clock=Date.parse(raw.fetchedAt),elapsed=0,units=2,active=0;const rows:Array<{kind:string;data:any}>=[],starts:number[]=[],calls:ComponentKind[]=[],events=[...(options.events??[])],socket=new Socket();let opens=0,requests=0,afterSleep:()=>void=()=>{};
  const budget={get calls(){return units;},get inFlight(){return active;},chargeWs(){},usage(){return {haltedReason:null,baseline:{starts:[]},starts:[...starts]};},dispatchWindow(){return {readyAt:starts.length?Math.max(clock,starts.at(-1)!+1000):clock,waitMs:0,physicalBusy:active!==0,haltedReason:null};},async operate(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<unknown>){calls.push(kind);units++;active++;starts.push(clock);try{return await work({id:units,signal:new AbortController().signal,chargeHttp(){},completeResponse(){}});}finally{active--;}}} as unknown as ComponentBudget;
  const rpc={budget,error(){return null;},async call<T>(method:string,params:unknown[]){assert.equal(method,'getTransaction');requests++;return budget.operate({transport:'http',method},async()=>{clock+=options.rpcMs??20;elapsed+=options.rpcMs??20;return (options.transaction?.(String(params[0]))??raw.transaction) as T;});}} as unknown as ComponentTransport;
  const quote=(at=clock)=>({mint:scope.mint,slot:scope.minSlot,commitment:'confirmed',receivedAt:new Date(at).toISOString(),timeEvidence:'confirmed-bank-clock' as const,clockSlot:scope.minSlot,marketClockUnixSeconds:Math.floor(clock/1000),sell:{inputBaseUnits:scope.baseUnits,outputLamports:'1000000'}});
  const protection:{everyMs:2000;quote:()=>Promise<unknown>}={everyMs:2000,quote:async()=>budget.operate({transport:'http',method:'getMultipleAccounts'},async()=>quote())};
  const input={scope,budget,rpc,record:(kind:string,data:unknown)=>rows.push({kind,data}),signal:new AbortController().signal,profile:'scheduler-forward-approved' as const,schedulerPolicy:'bounded-deadline-v1' as const,protection};
  const dependencies={makeSocket(_endpoint:string,_options:WebSocket.ClientOptions){opens++;clock+=options.setupMs??0;elapsed+=options.setupMs??0;queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;},now:()=>clock,monotonic:()=>elapsed,async sleep(ms:number){clock+=ms;elapsed+=ms;while(events[0]&&events[0].at<=elapsed&&!socket.done){const e=events.shift()!;socket.frame(e.payload,e.bytes);}afterSleep();for(let i=0;i<8;i++)await Promise.resolve();}};
  return {input,dependencies,rows,calls,socket,quote,get opens(){return opens;},get requests(){return requests;},set afterSleep(fn:()=>void){afterSleep=fn;}};
}

test('approved profile is explicit, observes75s from open, preserves the original default and keeps all research gates closed',async()=>{
  assert.equal(OVERNIGHT_FIELD_LIMITS.hardSocketBytes,64*1024*1024);assert.equal(OVERNIGHT_FIELD_LIMITS.enrichmentAttempts,24);
  assert.equal(SCHEDULER_FORWARD_FIELD_LIMITS.hardSocketBytes,140*1024*1024);assert.equal(SCHEDULER_FORWARD_FIELD_LIMITS.socketStopBytes,138*1024*1024);assert.equal(SCHEDULER_FORWARD_FIELD_LIMITS.applicationStopBytes,136*1024*1024);assert.equal(SCHEDULER_FORWARD_FIELD_LIMITS.retainedBytes,5*1024*1024);
  const f=fixture({setupMs:700}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.openMs,75000);assert.equal(r.openedAt!-r.connectionStartedAt,700);assert.equal(r.stopReason,'COMPONENT_FIELD_DURATION_LIMIT');assert.equal(f.opens,1);assert.equal(r.priceAttempts,38);assert.equal(r.firstQualityFailure,null);assert.equal(r.sharedScheduler.totalProtectionCap,43);assert.equal(r.sharedScheduler.earlyEvaluationCap,5);assert.equal(r.profileLimits.stopOnFirstQualityFailure,true);assert.equal(r.qualificationEnabled,false);assert.equal(r.complete60SecondFeatureWindows,0);assert.equal(r.paperEntriesEnabled,false);assert.equal(r.combinedAcceptance,false);
  const missing=fixture();await assert.rejects(captureOvernightFields({...missing.input,protection:undefined},missing.dependencies),/PROFILE_BOUNDS/);assert.equal(missing.opens,0);
  const shortened=fixture();await assert.rejects(captureOvernightFields({...shortened.input,observationMs:70000},shortened.dependencies),/PROFILE_BOUNDS/);assert.equal(shortened.opens,0);
});

test('one selected invalid field or mapping failure stops the profile and retains its original quality evidence',async()=>{
  for(const mode of ['invalid','mapping'] as const){
    const f=fixture({events:[{at:100,payload:mode==='invalid'?{...selected(),signature:null}:selected()},{at:mode==='mapping'?100:10000,payload:selected(bs58.encode(Buffer.alloc(64,22)))}],transaction:()=>({...raw.transaction,meta:{...raw.transaction.meta,err:{InstructionError:[0,'Custom']}}})});
    const r=await captureOvernightFields(f.input,f.dependencies);
    assert.equal(r.stopReason,'COMPONENT_FIELD_FIRST_QUALITY_FAILURE');assert.equal(r.firstQualityFailure?.responsibility,'flow');assert.ok(r.qualityGaps.length>0);assert.equal(r.historicalWindowInvalidated,true);assert.equal(r.selectedMessages,mode==='invalid'?1:2);assert.equal(f.opens,1);assert.equal(f.requests,mode==='invalid'?0:1);assert.equal(r.normalizedEvents,0);assert.equal(r.physicalSlotUncertain,false);assert.ok(f.rows.some(x=>x.kind==='selected-pumpapi-payload'));
    if(mode==='mapping'){assert.equal(r.pending,1);assert.ok(r.qualityGaps.some(g=>g.reason==='unresolved-enrichment-at-final-close'));assert.equal(f.rows.filter(x=>x.kind==='selected-pumpapi-payload').length,2);}
  }
});

test('selected enrichment deadlines and scheduler refusals end the only capture rather than silently continuing with incomplete windows',async()=>{
  const late=fixture({events:[{at:100,payload:selected()}],rpcMs:5001}),l=await captureOvernightFields(late.input,late.dependencies);
  assert.equal(l.stopReason,'COMPONENT_FIELD_FIRST_QUALITY_FAILURE');assert.equal(late.requests,1);assert.equal(l.normalizedEvents,0);assert.ok(l.qualityGaps.some(x=>x.reason==='selected-enrichment-completed-too-late'));assert.ok(late.rows.some(x=>x.kind==='confirmed-enrichment'));
  const refused=fixture({events:[{at:100,payload:selected()}]});refused.input.budget.dispatchWindow=()=>({readyAt:refused.dependencies.now()+6000,waitMs:6000,physicalBusy:false,haltedReason:null});
  const r=await captureOvernightFields(refused.input,refused.dependencies);
  assert.equal(r.stopReason,'COMPONENT_FIELD_FIRST_QUALITY_FAILURE');assert.equal(r.sharedScheduler.schedulerRefusals,1);assert.equal(refused.requests,0);assert.ok(refused.rows.some(x=>x.kind==='research-enrichment-refused'));assert.equal(r.firstQualityFailure?.reason,'COMPONENT_ENRICHMENT_DEADLINE_INFEASIBLE');
});

test('a stale or unavailable actual-size quote stops, while an unfrozen2s evaluation-target miss alone remains diagnostic',async()=>{
  for(const source of ['quote-age','source-age','missing'] as const){const f=fixture();f.input.protection.quote=async()=>source==='missing'?null:source==='quote-age'?f.quote(f.dependencies.now()-2100):{...f.quote(),marketClockUnixSeconds:Math.floor(f.dependencies.now()/1000)-31};const r=await captureOvernightFields(f.input,f.dependencies);assert.equal(r.stopReason,'COMPONENT_FIELD_FIRST_QUALITY_FAILURE');assert.equal(r.firstQualityFailure?.responsibility,'protection');assert.equal(r.protection.unavailable,1);assert.equal(r.priceAttempts,1);assert.equal(f.opens,1);}
  const f=fixture(),base=f.dependencies.now();let release:(()=>void)|undefined,first=true;
  f.afterSleep=()=>{if(release&&f.dependencies.now()-base>=2600){const ready=release;release=undefined;ready();}};
  f.input.protection.quote=async()=>{if(first){first=false;await new Promise<void>(resolve=>{release=resolve;});}return f.quote();};
  const r=await captureOvernightFields(f.input,f.dependencies);assert.equal(r.stopReason,'COMPONENT_FIELD_DURATION_LIMIT');assert.equal(r.firstQualityFailure,null);assert.ok(r.protection.maxCompletedEvaluationGapMs>2000);assert.ok(r.protection.gaps.some(x=>x.reason==='COMPONENT_PROTECTION_LATE_EVALUATION'));assert.equal(r.sharedScheduler.acceptedMaximumCompletedEvaluationGapMs,null);
});

test('an eleventh selected transaction stops without another enrichment and preserves the cap refusal',async()=>{
  const events=Array.from({length:11},(_,i)=>({at:100+i*6000,payload:selected(bs58.encode(Buffer.alloc(64,i+1)))}));
  const f=fixture({events,transaction:signature=>({...raw.transaction,transaction:{...raw.transaction.transaction,signatures:[signature]}})}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.enrichments,10);assert.equal(f.requests,10);assert.equal(r.stopReason,'COMPONENT_FIELD_FIRST_QUALITY_FAILURE');assert.equal(r.firstQualityFailure?.reason,'COMPONENT_FIELD_ENRICHMENT_CAP');assert.equal(r.normalizedEvents,10);assert.equal(f.opens,1);assert.ok(r.historicalWindowInvalidated);assert.ok(r.retainedBytes<=5*1024*1024);
});

test('socket stops include all broad incoming bytes and terminate before the140MiB hard ceiling when headroom is available',async()=>{
  const f=fixture({events:[{at:100,payload:{irrelevant:true},bytes:138*1024*1024}]}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.stopReason,'COMPONENT_FIELD_SOCKET_STOP');assert.equal(r.socketBytes,138*1024*1024+200);assert.ok(r.socketBytes<140*1024*1024);assert.equal(f.requests,0);assert.equal(f.opens,1);assert.equal(r.parsedFrames,0);assert.equal(r.historicalWindowInvalidated,true);
});
