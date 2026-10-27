import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import {ActivePipeline} from '../src/active-pipeline.js';
import {captureOvernightFields,type ObservationRequestContext} from '../src/overnight-field.js';
import type {ComponentBudget,ComponentKind,ComponentOperation} from '../src/component-budget.js';
import type {ComponentTransport} from '../src/component-transport.js';

const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const base=Math.ceil(Date.parse(raw.fetchedAt)/10000)*10000,limit=75000;
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:raw.transaction.slot,supportedPoolEvidence:'OFFLINE retained hypothetical scope only'};
const payload=()=>({signature:raw.signature,mint:scope.mint,poolId:scope.pool,pool:'pump-amm',action:'sell'});
const quote=(at:number,output='1000000')=>({mint:scope.mint,slot:scope.minSlot,commitment:'confirmed',receivedAt:new Date(at).toISOString(),timeEvidence:'confirmed-bank-clock' as const,clockSlot:scope.minSlot,marketClockUnixSeconds:Math.floor(at/1000),sell:{inputBaseUnits:scope.baseUnits,outputLamports:output}});

function pipeline(blockKind?:string){
  let wall=base,mono=0;const rows:Array<{kind:string;data:any}>=[];
  const core=new ActivePipeline({scope,now:()=>wall,record:(kind,data)=>{rows.push({kind,data});if(kind===blockKind){wall+=2;mono+=2;}},admitInformation:(at)=>{if(at>=base+limit||mono>=limit){core.endObservation(wall,'logical-cutoff',Math.min(wall,base+limit));return false;}return true;}});
  core.open(base);return {core,rows,set:(at:number,m=at-base)=>{wall=at;mono=m;},get wall(){return wall;}};
}

test('fully validated trade admission is exclusive and recorder latency cannot backdate a late transaction into the window',()=>{
  const f=pipeline('research-enrichment-validation-prepared');f.set(base+73900);assert.equal(f.core.observe(payload(),base+73900),'queued');f.set(base+74900);const hint=f.core.nextHint(base+74900)!;
  f.set(base+74999);assert.deepEqual(f.core.completeHint(hint,raw.transaction,base+74999),[]);const s=f.core.snapshot(f.wall);
  assert.equal(s.observationEndedAt,base+limit);assert.equal(s.normalizedEvents,0);assert.equal(s.normalizedAfterObservation,0);assert.equal(s.pending,1);assert.equal(s.lastAcceptedTradeAt,null);assert.equal(s.lastAcceptedInformationAt,base+73900);assert.ok(s.qualityGaps.some(g=>g.reason==='selected-information-after-observation-cutoff'));assert.ok(f.rows.some(r=>r.kind==='research-information-after-cutoff'));assert.equal(f.rows.some(r=>r.kind==='research-normalized-trade'),false);
  const valid=pipeline();valid.set(base+73900);valid.core.observe(payload());valid.set(base+74900);const validHint=valid.core.nextHint()!;valid.set(base+74999);assert.equal(valid.core.completeHint(validHint,raw.transaction).length,1);assert.equal(valid.core.snapshot(base+74999).lastAcceptedTradeAt,base+74999);
});

test('late price preparation cannot change a mark, baseline or hypothetical exit decision',()=>{
  const f=pipeline('research-price-validation-prepared');f.set(base+1000);assert.ok(f.core.price(quote(base+1000),base+1000));const first=f.core.snapshot(f.wall);
  f.set(base+74999);assert.equal(f.core.price(quote(base+74999,'700000'),base+74999),null);const s=f.core.snapshot(f.wall);
  assert.equal(s.prices.accepted,1);assert.equal(s.prices.changes,0);assert.equal(s.prices.triggerEvents.length,0);assert.equal(s.prices.firstHypotheticalCost!.cost,first.prices.firstHypotheticalCost!.cost);assert.equal(s.lastAcceptedPriceAt,base+1002);assert.ok(s.lastAcceptedInformationAt!<base+limit);assert.equal(s.observationEndedAt,base+limit);
});

test('the monotonic boundary independently rejects information even when wall time has not reached its target',()=>{
  const f=pipeline();f.set(base+74999,75000);assert.equal(f.core.price(quote(base+74999)),null);const s=f.core.snapshot(f.wall);
  assert.equal(s.prices.accepted,0);assert.equal(s.lastAcceptedInformationAt,null);assert.equal(s.observationEndedAt,base+74999);assert.equal(s.rejectedCutoffInformation,1);
  const exact=pipeline();exact.set(base+limit);assert.equal(exact.core.price(quote(base+limit)),null);assert.equal(exact.core.snapshot(base+limit).prices.accepted,0);
});

class Socket extends EventEmitter {
  _socket=Object.assign(new EventEmitter(),{bytesRead:200});terminated=false;closed=false;closeDue=Infinity;
  terminate(){if(this.terminated)return;this.terminated=true;this.closeDue=200;}
  frame(value:unknown){const b=Buffer.from(JSON.stringify(value));this._socket.bytesRead+=b.byteLength+4;this._socket.emit('data',b);this.emit('message',b);}
}
function field(options:{jitterMs?:number;hintAt?:number;blockKind?:string;blockAt?:number}={}){
  let wall=base,mono=0,units=0,active=0,hintSent=false,stoppedAt:number|null=null,blocked=false;const rows:Array<{kind:string;data:any}>=[],starts:Array<{at:number;kind:ComponentKind;latestStartAt:number|null}>=[],contexts:ObservationRequestContext[]=[],socket=new Socket();let connections=0;
  const advance=(ms:number)=>{wall+=ms;mono+=ms;};
  const budget={get calls(){return units;},get inFlight(){return active;},chargeWs(){},usage(){return {haltedReason:null,baseline:{starts:[]},starts:starts.map(x=>x.at)};},dispatchWindow(){return {readyAt:Math.max(wall,(starts.at(-1)?.at??wall-1000)+1000),waitMs:0,physicalBusy:active!==0,haltedReason:null};},async operate(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<unknown>,_signal?:AbortSignal,opOptions:{latestStartAt?:number}={}){if(opOptions.latestStartAt!==undefined&&wall>opOptions.latestStartAt)throw Error('COMPONENT_DISPATCH_EXPIRED');units++;active++;starts.push({at:wall,kind,latestStartAt:opOptions.latestStartAt??null});try{return await work({id:units,signal:new AbortController().signal,chargeHttp(){},completeResponse(){}});}finally{active--;}}} as unknown as ComponentBudget;
  const rpc={budget,error(){return null;},async call<T>(method:string,_params:unknown[],signal?:AbortSignal,opOptions?:{latestStartAt?:number}){return budget.operate({transport:'http',method},async()=>raw.transaction as T,signal,opOptions);}} as unknown as ComponentTransport;
  const input={scope,budget,rpc,signal:new AbortController().signal,profile:'scheduler-forward-approved' as const,observationCutoff:{durationMs:limit},schedulerPolicy:'bounded-deadline-v1' as const,record(kind:string,data:unknown){rows.push({kind,data});if(kind==='field-observation-stop-requested')stoppedAt=mono;if(!blocked&&kind===options.blockKind&&wall-base>=(options.blockAt??0)){blocked=true;advance(base+limit+2-wall);}},protection:{everyMs:2000 as const,quote:async(signal:AbortSignal,_floor:number,context?:ObservationRequestContext)=>{assert.ok(context);contexts.push(context);return budget.operate({transport:'http',method:'getMultipleAccounts'},async()=>quote(wall),signal,{latestStartAt:context.latestStartAt});}}};
  const dependencies={now:()=>wall,monotonic:()=>mono,makeSocket(_endpoint:string,_options:WebSocket.ClientOptions){connections++;queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;},async sleep(ms:number){advance(ms+(options.jitterMs??0));if(options.hintAt!==undefined&&!hintSent&&mono>=options.hintAt&&!socket.terminated){hintSent=true;socket.frame(payload());}if(socket.terminated){stoppedAt??=mono;if(!socket.closed&&mono-stoppedAt>=socket.closeDue){socket.frame({drain:'counted after shutdown request'});socket.closed=true;socket.emit('close');}}for(let i=0;i<10;i++)await Promise.resolve();}};
  return {input,dependencies,rows,starts,contexts,get connections(){return connections;}};
}

test('logical75s data boundary is distinct from measured shutdown jitter and all drain traffic remains counted',async()=>{
  const f=field({jitterMs:2}),r=await captureOvernightFields(f.input,f.dependencies),cutoff=r.observationCutoff;
  assert.equal(cutoff.logicalCutoffAt,base+limit);assert.equal(cutoff.logicalCutoffMonotonicAt,limit);assert.equal(cutoff.admittedObservationEndAt,base+limit);assert.ok(r.openMs>=limit);assert.ok(cutoff.admissionClosedAt!>=cutoff.logicalCutoffAt!);assert.ok(cutoff.transportSettledAt!>cutoff.transportStopRequestedAt!);assert.ok(r.elapsedMs<=limit+5000);assert.equal(f.connections,1);
  assert.ok(cutoff.lastAcceptedInformationAt!<cutoff.logicalCutoffAt!);assert.ok(f.starts.filter(s=>s.kind.transport==='http').every(s=>s.at<base+limit&&s.latestStartAt===base+limit-1));assert.ok(f.contexts.every(c=>c.logicalCutoffAt===base+limit&&c.latestStartAt===base+limit-1));assert.ok(cutoff.drainFrames>0);assert.ok(cutoff.postCutoffApplicationBytes>0);assert.ok(cutoff.socketBytesAfterStop!>0);assert.ok(cutoff.applicationBytesAfterStop!>0);assert.equal(r.paperEntriesEnabled,false);assert.equal(r.combinedAcceptance,false);
});

test('cutoff is explicit, bounded by the selected duration, and independent of the old profile',async()=>{
  const f=field(),r=await captureOvernightFields({...f.input,profile:undefined,observationMs:30000,observationCutoff:{durationMs:1100}},f.dependencies);assert.equal(r.observationCutoff.enabled,true);assert.equal(r.observationCutoff.logicalCutoffAt,base+1100);assert.equal(r.observationCutoff.admittedObservationEndAt,base+1100);assert.equal(r.profile,'legacy');
  for(const durationMs of [0,75001,NaN]){const bad=field();await assert.rejects(captureOvernightFields({...bad.input,observationCutoff:{durationMs}},bad.dependencies),/CUTOFF_BOUNDS/);assert.equal(bad.connections,0);}
});

test('a dispatch recorder crossing cutoff starts no physical request and records actual stop time separately',async()=>{
  const f=field({blockKind:'shared-scheduler-dispatch',blockAt:74000}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.stopReason,'COMPONENT_FIELD_DURATION_LIMIT');assert.equal(r.observationCutoff.admittedObservationEndAt,base+limit);assert.equal(r.observationCutoff.admissionClosedAt,base+limit+2);assert.ok(f.starts.every(s=>s.at<base+limit));assert.equal(f.connections,1);assert.ok(r.lastAcceptedPriceAt!<base+74000);
});

test('raw confirmed response survives a recorder crossing cutoff, but no normalized trade or free resolution is created',async()=>{
  const f=field({hintAt:500,blockKind:'confirmed-enrichment'}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.ok(r.enrichmentTransactions[raw.signature]);assert.ok(f.rows.some(x=>x.kind==='confirmed-enrichment'));assert.equal(r.normalizedEvents,0);assert.equal(r.normalizedAfterObservation,0);assert.equal(r.pending,1);assert.ok(r.qualityGaps.some(g=>g.reason==='selected-information-after-observation-cutoff'));assert.ok(r.qualityGaps.some(g=>g.reason==='unresolved-enrichment-at-final-close'));assert.equal(r.lastAcceptedTradeAt,null);assert.equal(f.starts.filter(s=>s.kind.method==='getTransaction').length,1);assert.equal(r.observationCutoff.admittedObservationEndAt,base+limit);assert.equal(f.connections,1);
});

test('a pre-cutoff selected payload delayed by its raw recorder remains an unresolved target without a new request',async()=>{
  const f=field({hintAt:500,blockKind:'selected-pumpapi-payload'}),r=await captureOvernightFields(f.input,f.dependencies);
  assert.equal(r.selectedMessages,1);assert.equal(r.pending,1);assert.equal(r.enrichments,0);assert.equal(r.normalizedEvents,0);assert.equal(f.starts.filter(s=>s.kind.method==='getTransaction').length,0);assert.ok(f.rows.some(x=>x.kind==='selected-pumpapi-payload'));assert.ok(f.rows.some(x=>x.kind==='research-selected-hint-after-cutoff'&&x.data.unresolved));assert.ok(r.qualityGaps.some(g=>g.reason==='unresolved-enrichment-at-final-close'));assert.equal(r.observationCutoff.admittedObservationEndAt,base+limit);
});
