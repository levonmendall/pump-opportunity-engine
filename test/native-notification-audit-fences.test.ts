/** Offline notification-boundary scheduling and authoritative history audit.
 * Synthetic packets are never presented as market coverage or trading proof. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {auditNativeFlowWindow,selectNativeNotificationAuditFences,type NativeAuditNotificationGeneration,type NativeFlowAuditOptions} from '../src/native-flow-audit.js';
import {NativeAuditSession} from '../src/native-audit-session.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';

const mint=bs58.encode(Buffer.alloc(32,8)),pool=bs58.encode(Buffer.alloc(32,9));
const target={startAt:100000,endAt:160000},at=161000;
const generation:NativeAuditNotificationGeneration={mint,pool,openedAt:90000,connectionId:3,subscriptionId:7};
const signature=(id:number)=>{const raw=Buffer.alloc(64);raw.writeUInt32LE(id);return bs58.encode(raw);};
function note(id:number,slot:number,time:number,patch:Partial<NativeNotification>={}):NativeNotification{
 return {signature:signature(id),slot,receivedAt:time,availableAt:time,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null,subscriptionMint:mint,subscriptionPool:pool,connectionId:generation.connectionId,subscriptionId:generation.subscriptionId,...patch};
}
const notes=()=>[note(1,100,99900),note(2,110,110000),note(3,200,160100)];
const row=(id:number,slot:number)=>({signature:signature(id),slot,err:null,blockTime:100,confirmationStatus:'confirmed'});
const history=()=>[row(2,110),row(1,100),row(4,90)];
function fixture(notifications=notes(),page:unknown[]=history()){
 const calls:Array<{method:string;params:unknown[]}>=[];
 const options:NativeFlowAuditOptions={pool,target,notifications,notificationFenceGeneration:{...generation},now:()=>at,call:async<T>(method:string,params:unknown[]):Promise<T>=>{assert.equal(method,'getSignaturesForAddress','no additional account or transaction read is permitted');calls.push({method,params:structuredClone(params)});return structuredClone(page)as T;}};
 return {calls,options};
}

test('actual same-generation boundaries avoid a bank read while the complete independent census remains mandatory',async()=>{
 const f=fixture(),before=structuredClone(f.options.notifications),selected=selectNativeNotificationAuditFences({notifications:f.options.notifications,target,at,generation});
 assert.equal(selected.available,true);
 assert.equal(selected.anchor.signature,signature(3));assert.equal(selected.lowerFence.signature,signature(1));
 selected.anchor.slot=999;assert.deepEqual(f.options.notifications,before,'selection returns independent boundary values');
 const result=await auditNativeFlowWindow(f.options);assert.equal(result.status,'verified');assert.equal(result.anchorKind,'notification');assert.equal(result.contextFences,null);assert.equal(f.calls.length,1);
 assert.deepEqual(f.calls[0]!.params,[pool,{before:signature(3),limit:100,commitment:'confirmed',minContextSlot:200}]);
 assert.deepEqual(result.requiredSignatures,[signature(2)]);assert.equal(result.historyRangeCovered,true);assert.equal(result.requestAttempts,1);
});

test('strict boundary mode refuses old connection, subscription, mint or pool identity before any history call',async()=>{
 for(const index of [0,2])for(const patch of [{connectionId:4},{subscriptionId:8},{subscriptionMint:bs58.encode(Buffer.alloc(32,10))},{subscriptionPool:bs58.encode(Buffer.alloc(32,11))}]){
  const captured=notes();captured[index]={...captured[index]!,...patch};const f=fixture(captured);
  assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,false);
  const result=await auditNativeFlowWindow(f.options);assert.equal(result.status,'unavailable');assert.match(result.reason,/WINDOW_SLOT_FENCE_UNAVAILABLE/);assert.equal(f.calls.length,0);
 }
});

test('boundaries must be observed after this ACK and must actually straddle the target in receipt and availability time',async()=>{
 for(const captured of [
  [note(1,100,89999),note(2,110,110000),note(3,200,160100)],
  [note(1,100,99900,{availableAt:100001}),note(2,110,110000),note(3,200,160100)],
  [note(1,100,99900),note(2,110,110000),note(3,200,159999,{availableAt:160100})],
  [note(1,110,99900),note(2,110,110000),note(3,200,160100)],
  [note(1,100,99900),note(2,110,110000),note(3,110,160100)]
 ]){
  const f=fixture(captured);assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,false);
  assert.equal((await auditNativeFlowWindow(f.options)).status,'unavailable');assert.equal(f.calls.length,0);
 }
 const f=fixture();f.options.notificationFenceGeneration={...generation,openedAt:100001};assert.equal((await auditNativeFlowWindow(f.options)).status,'unavailable');assert.equal(f.calls.length,0);
});

test('a replayed old signature never acquires a new boundary time or subscription identity',async()=>{
 for(const oldSubscription of [generation.subscriptionId,99]){
  const captured=[note(4,210,95000,{subscriptionId:oldSubscription}),note(1,100,99900),note(2,110,110000),note(4,210,160100,{duplicate:true})],f=fixture(captured);
  assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,false);
  const result=await auditNativeFlowWindow(f.options);assert.equal(result.reason,'NATIVE_AUDIT_POST_WINDOW_SLOT_FENCE_UNAVAILABLE');assert.equal(f.calls.length,0);
 }
});

test('cross-scope interior evidence is retained, but another subscription cannot manufacture this scope boundary',async()=>{
 const captured=notes();captured[1]={...captured[1]!,subscriptionMint:bs58.encode(Buffer.alloc(32,10)),subscriptionPool:bs58.encode(Buffer.alloc(32,11)),subscriptionId:15,observedForMint:mint,scopeEvidence:'confirmed-transaction-program-frame',countsScope:'scope-only'};
 const f=fixture(captured),result=await auditNativeFlowWindow(f.options);assert.equal(result.status,'verified');assert.deepEqual(result.requiredSignatures,[signature(2)]);assert.deepEqual(result.comparedSignatures,[signature(2)]);
 const missing=fixture(captured,[row(1,100),row(4,90)]),refused=await auditNativeFlowWindow(missing.options);assert.equal(refused.reason,'NATIVE_AUDIT_CAPTURED_TARGET_NOT_IN_HISTORY');assert.deepEqual(refused.unconfirmedCapturedSignatures,[signature(2)]);
 captured[2]={...captured[2]!,...captured[1]!,signature:signature(3),slot:200,receivedAt:160100,availableAt:160100};const wrong=fixture(captured);assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,false);assert.equal((await auditNativeFlowWindow(wrong.options)).status,'unavailable');assert.equal(wrong.calls.length,0);
});

test('local boundary readiness never excuses missing successful history, unconfirmed rows, or status disagreement',async()=>{
 for(const page of [[row(5,120),...history()],[row(1,100),row(4,90)],[{...row(2,110),err:{InstructionError:[0,'failure']}},row(1,100),row(4,90)]]){
  const f=fixture(notes(),page);assert.equal(selectNativeNotificationAuditFences({notifications:f.options.notifications,target,at,generation}).available,true);
  const result=await auditNativeFlowWindow(f.options);assert.equal(result.complete,false);assert.equal(result.executedFlowCompletenessVerified,false);assert.equal(f.calls.length,1);
 }
});

test('quiet scopes retain the existing fresh bank-Clock fallback and old audit callers retain notification semantics',async()=>{
 const quiet=fixture([],[row(1,100),row(4,90)]);assert.equal(selectNativeNotificationAuditFences({notifications:[],target,at,generation}).available,false);
 delete quiet.options.notificationFenceGeneration;quiet.options.contextFences={lower:{slot:100,availableAt:99900,bankClockAt:99000},upper:{slot:200,availableAt:160500,bankClockAt:160000}};
 const fallback=await auditNativeFlowWindow(quiet.options);assert.equal(fallback.status,'verified');assert.equal(fallback.anchorKind,'confirmed-bank-context');assert.equal(quiet.calls.length,1);
 const unscoped=notes().map(({subscriptionMint:_m,subscriptionPool:_p,subscriptionId:_s,connectionId:_c,...n})=>n),legacy=fixture(unscoped);delete legacy.options.notificationFenceGeneration;
 assert.equal(selectNativeNotificationAuditFences({notifications:unscoped,target,at}).available,true);assert.equal(selectNativeNotificationAuditFences({notifications:unscoped,target,at,generation}).available,false);
 assert.equal((await auditNativeFlowWindow(legacy.options)).status,'verified');assert.equal(legacy.calls.length,1);
});

test('future, malformed and corrected packet data cannot authorize the no-refresh path',async()=>{
 for(const patch of [{availableAt:at+1},{signature:'invalid'},{slot:-1},{correction:true},{classification:'unusable' as const},{rawHash:'invalid'}]){
  const captured=notes();captured[1]={...captured[1]!,...patch};const f=fixture(captured);
  assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,false);assert.notEqual((await auditNativeFlowWindow(f.options)).status,'verified');assert.equal(f.calls.length,0);
 }
 const captured=[...notes(),note(2,111,110100,{duplicate:true})],f=fixture(captured);assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,false);assert.equal((await auditNativeFlowWindow(f.options)).reason,'NATIVE_AUDIT_CAPTURED_CORRECTION');assert.equal(f.calls.length,0);
});

test('the authoritative audit rechecks notification boundary identity after local scheduling selection',async()=>{
 const f=fixture();assert.equal(selectNativeNotificationAuditFences({notifications:f.options.notifications,target,at,generation}).available,true);
 f.options.notifications[2]!.connectionId=4;
 const result=await auditNativeFlowWindow(f.options);assert.equal(result.status,'unavailable');assert.equal(f.calls.length,0);
});

test('scheduler eligibility never replaces authoritative decoding of every interior signature',async()=>{
 const captured=notes();captured[1]!.signature=bs58.encode(Buffer.alloc(63,33));
 const f=fixture(captured);assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,true,'cheap local selection is not a signature census or audit pass');
 const result=await auditNativeFlowWindow(f.options);assert.equal(result.reason,'NATIVE_AUDIT_NOTIFICATION_SCHEMA');assert.equal(result.complete,false);assert.equal(f.calls.length,0);
 captured[0]!.signature=bs58.encode(Buffer.alloc(63,34));assert.equal(selectNativeNotificationAuditFences({notifications:captured,target,at,generation}).available,false,'actual boundary signatures are decoded by the selector itself');
});

test('resumable audit captures its boundary generation before any later caller mutation',async()=>{
 const supplied={...generation};let selectedGeneration:NativeAuditNotificationGeneration|undefined;
 const session=new NativeAuditSession({pool,target,notifications:notes(),notificationFenceGeneration:supplied,now:()=>at,deadlineAt:169999,audit:async options=>{
  await Promise.resolve();selectedGeneration=options.notificationFenceGeneration;return auditNativeFlowWindow(options);
 }});
 supplied.connectionId=99;supplied.subscriptionId=99;await session.advance();
 assert.deepEqual(selectedGeneration,generation);const page=session.pending();assert.ok(page);assert.equal(session.respond(page.page,history()),true);await session.advance();assert.equal(session.result()?.status,'verified');
});
