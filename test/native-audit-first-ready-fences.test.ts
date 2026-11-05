/** Synthetic audit mechanics, not historical or current market evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {auditNativeFlowWindow,sealNativeNotificationAuditFences,copyNativeNotificationAuditFenceWitness,selectNativeNotificationAuditFences,type NativeAuditNotificationFenceWitness,type NativeAuditNotificationGeneration,type NativeFlowAuditOptions} from '../src/native-flow-audit.js';
import {NativeAuditSession} from '../src/native-audit-session.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';

const mint=bs58.encode(Buffer.alloc(32,8)),pool=bs58.encode(Buffer.alloc(32,9));
const target={startAt:100000,endAt:160000};
const generation:NativeAuditNotificationGeneration={mint,pool,openedAt:90000,connectionId:3,subscriptionId:7};
const signature=(id:number)=>{const raw=Buffer.alloc(64);raw.writeUInt32LE(id);return bs58.encode(raw);};
const row=(id:number,slot:number)=>({signature:signature(id),slot,err:null,blockTime:100,confirmationStatus:'confirmed'});
function note(id:number,slot:number,at:number,patch:Partial<NativeNotification>={}):NativeNotification{
 return {signature:signature(id),slot,receivedAt:at,availableAt:at,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null,subscriptionMint:mint,subscriptionPool:pool,connectionId:generation.connectionId,subscriptionId:generation.subscriptionId,...patch};
}
const original=()=>[note(1,100,99900),note(2,110,110000),note(3,200,160100)];
const originalHistory=()=>[row(2,110),row(1,100),row(4,90)];
function seal(notifications=original(),selectedAt=161000){
 const selected=sealNativeNotificationAuditFences({notifications,target,at:selectedAt,generation});
 assert.equal(selected.available,true);return selected.witness;
}
function fixture(notifications=original(),witness:NativeAuditNotificationFenceWitness|undefined=seal(),at=168000){
 const calls:Array<{method:string;params:unknown[]}>=[];
 const options:NativeFlowAuditOptions={pool,target,notifications,notificationFenceGeneration:generation,...(witness?{notificationFenceWitness:witness}:{}),now:()=>at,
  call:async<T>(method:string,params:unknown[])=>{calls.push({method,params:structuredClone(params)});const before=(params[1] as {before:string}).before;
   return structuredClone(before===signature(3)?originalHistory():[row(6,350),row(5,300),row(3,200),...originalHistory()]) as T;}};
 return {calls,options};
}

test('a first-ready seal preserves the existing early audit census when dispatch waits behind other work',async()=>{
 const input=original(),witness=seal(input),before=structuredClone(input);
 const early=fixture(input,undefined,161000);delete early.options.notificationFenceWitness;
 const first=await auditNativeFlowWindow(early.options);assert.equal(first.status,'verified');
 const later=[...input,note(5,300,166000),note(7,400,167000)];
 const legacy=fixture(later,undefined);delete legacy.options.notificationFenceWitness;
 assert.equal((await auditNativeFlowWindow(legacy.options)).reason,'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED','unsealed dispatch expands the independent range into later traffic');
 const delayed=fixture(later,witness),result=await auditNativeFlowWindow(delayed.options);
 assert.equal(result.status,'verified');assert.deepEqual(result.strictInteriorSlots,first.strictInteriorSlots);assert.deepEqual(result.requiredSignatures,first.requiredSignatures);
 assert.deepEqual(delayed.calls[0]!.params,early.calls[0]!.params);assert.deepEqual(input,before);assert.equal(witness.selectedAt,161000);
 assert.equal(result.availableAt,168000,'current validation time is never backdated to readiness');
 assert.equal(delayed.calls.length,1);assert.equal(delayed.calls[0]!.method,'getSignaturesForAddress','no extra provider recovery read was introduced');
});

test('unknown successful information inside the sealed strict range still refuses the whole audit',async()=>{
 for(const change of ['missing','unconfirmed','status'] as const){
  const f=fixture([...original(),note(7,400,167000)]);
  f.options.call=async<T>()=>{f.calls.push({method:'getSignaturesForAddress',params:[]});return (change==='missing'?[row(8,150),...originalHistory()]:change==='unconfirmed'?[row(1,100),row(4,90)]:[{...row(2,110),err:{InstructionError:[0,'failed']}},row(1,100)]) as T;};
  const r=await auditNativeFlowWindow(f.options);assert.equal(r.complete,false);assert.equal(r.executedFlowCompletenessVerified,false);assert.equal(f.calls.length,1);
  assert.match(r.reason,/HISTORY_SIGNATURE_NOT_OBSERVED|CAPTURED_TARGET_NOT_IN_HISTORY|STATUS_DISAGREEMENT/);
 }
});

test('new target information, same-slot signatures and changed generation cannot reuse an earlier seal',async()=>{
 for(const added of [note(8,110,120000),note(8,150,120000),note(8,210,120000)]){
  const f=fixture([...original(),added]);const result=await auditNativeFlowWindow(f.options);
  assert.equal(result.reason,'NATIVE_AUDIT_LATCHED_TARGET_INFORMATION_CHANGED');assert.equal(f.calls.length,0);
 }
 for(const change of [{connectionId:4},{subscriptionId:8},{openedAt:90001},{mint:bs58.encode(Buffer.alloc(32,10))}]){
  const f=fixture();f.options.notificationFenceGeneration={...generation,...change};const result=await auditNativeFlowWindow(f.options);
  assert.equal(result.complete,false);assert.equal(f.calls.length,0);
 }
});

test('buffered wire-before-end packets outside the sealed range are explicit failures, never trimmed target activity',async()=>{
 for(const slot of [90,100,200,350]){
  const f=fixture([...original(),note(8,slot,159900,{availableAt:167000})]);const result=await auditNativeFlowWindow(f.options);
  assert.equal(result.reason,'NATIVE_AUDIT_LATCHED_WIRE_TARGET_OUTSIDE_FENCES');assert.equal(f.calls.length,0);assert.equal(result.complete,false);
 }
 const inside=fixture([...original(),note(8,150,159900,{availableAt:167000})]);
 inside.options.call=async<T>()=>[row(8,150),...originalHistory()] as T;
 const actual=await auditNativeFlowWindow(inside.options);assert.equal(actual.status,'verified');assert.deepEqual(actual.requiredSignatures,[signature(2)],'late availability is corroboration, not a backdated feature');
});

test('a wire-before-end packet arriving during the page read cannot evade a latched boundary',async()=>{
 let at=168000;const f=fixture();f.options.now=()=>at;
 f.options.notificationGeneration=generation;
 f.options.call=async<T>()=>{at=168100;return originalHistory() as T;};
 f.options.postSnapshotNotifications=()=>[note(8,350,159900,{availableAt:168050})];
 const r=await auditNativeFlowWindow(f.options);assert.equal(r.reason,'NATIVE_AUDIT_LATCHED_WIRE_TARGET_OUTSIDE_FENCES');assert.equal(r.complete,false);
});

test('source-owned boundary packets survive diagnostic-fence rotation without inventing new packet clocks',async()=>{
 const rows=original();rows[2]={...rows[2]!,success:false,classification:'failed-transaction',parsedEvents:0,eventsAccepted:0};
 const witness=seal(rows),current=[rows[0]!,rows[1]!,note(7,400,167000,{success:false,classification:'failed-transaction',parsedEvents:0,eventsAccepted:0})];
 const f=fixture(current,witness),r=await auditNativeFlowWindow(f.options);
 assert.equal(r.status,'verified');assert.equal(r.anchor?.signature,signature(3));assert.equal(r.anchor?.receivedAt,160100);assert.deepEqual(r.requiredSignatures,[signature(2)]);
});

test('serialized seals have no authority and immutable in-process copies preserve the original proof',async()=>{
 const witness=seal(),copy=copyNativeNotificationAuditFenceWitness(witness);
 assert.notEqual(copy,witness);assert.deepEqual(copy,witness);assert.equal((await auditNativeFlowWindow(fixture(original(),copy).options)).status,'verified');
 assert.throws(()=>{(witness.target as {endAt:number}).endAt=170000;},TypeError);
 const restored=fixture(original(),JSON.parse(JSON.stringify(witness))),r=await auditNativeFlowWindow(restored.options);
 assert.equal(r.reason,'NATIVE_AUDIT_UNRECOGNIZED_NOTIFICATION_FENCE_WITNESS');assert.equal(restored.calls.length,0);
});

test('a deferred session copies first-ready authority once and keeps its original deadline and page identity',async()=>{
 const witness=seal(),notifications=[...original(),note(7,400,167000)];let at=168000;
 const s=new NativeAuditSession({pool,target,notifications,notificationFenceGeneration:generation,notificationFenceWitness:witness,now:()=>at,deadlineAt:169999});
 await s.advance();const pending=s.pending();assert.ok(pending);assert.equal((pending.params[1] as {before:string}).before,signature(3));
 at=168100;assert.equal(s.respond(pending.page,originalHistory()),true);await s.advance();assert.equal(s.result()?.status,'verified');assert.equal(s.result()?.availableAt,168100);assert.equal(s.deadlineAt,169999);
 const expired=new NativeAuditSession({pool,target,notifications,notificationFenceGeneration:generation,notificationFenceWitness:witness,now:()=>at,deadlineAt:169999});
 await expired.advance();const request=expired.pending();assert.ok(request);at=170000;assert.equal(expired.respond(request.page,originalHistory()),false);assert.equal(expired.result(),null);assert.equal(expired.error(),'NATIVE_AUDIT_SESSION_DEADLINE');
});

test('duplicate, buffered and out-of-order packets cannot supply a fresh source boundary',async()=>{
 const replay=[...original(),note(7,400,167000,{duplicate:true})];
 const selected=selectNativeNotificationAuditFences({notifications:replay,target,at:168000,generation});assert.equal(selected.available,true);assert.equal(selected.anchor.signature,signature(3));
 const duplicateOnly=[note(1,100,99900),note(2,110,110000),note(7,400,167000,{duplicate:true})];
 assert.equal(sealNativeNotificationAuditFences({notifications:duplicateOnly,target,at:168000,generation}).available,false);
 const buffered=[note(1,100,99900),note(2,110,110000),note(7,400,159900,{availableAt:167000})];
 assert.equal(sealNativeNotificationAuditFences({notifications:buffered,target,at:168000,generation}).available,false);
 const lowerPost=[...original(),note(7,105,167000)];assert.equal(seal(lowerPost,168000).anchor.signature,signature(3));
 const quiet=[note(1,100,99900),note(3,200,160100)],quietSeal=seal(quiet);
 const f=fixture([...quiet,note(7,400,167000)],quietSeal);f.options.call=async<T>()=>[row(1,100),row(4,90)] as T;
 const result=await auditNativeFlowWindow(f.options);assert.equal(result.status,'verified');assert.equal(result.requiredSignatures.length,0);assert.deepEqual(result.strictInteriorSlots,{lower:100,upper:200});
});

test('history returned outside the exact sealed request cannot be discarded to manufacture a pass',async()=>{
 const f=fixture();f.options.call=async<T>()=>[row(8,350),...originalHistory()] as T;
 const r=await auditNativeFlowWindow(f.options);assert.equal(r.reason,'NATIVE_AUDIT_HISTORY_CONTEXT');assert.equal(r.complete,false);assert.equal(r.historyRows,0);
});

test('four delayed audit sessions retain independent first-ready fences through one caller-owned physical gate',async()=>{
 let at=166000;const sessions:NativeAuditSession[]=[];
 for(let i=0;i<4;i++){
  const current={...generation,mint:bs58.encode(Buffer.alloc(32,i+20)),pool:bs58.encode(Buffer.alloc(32,i+40)),subscriptionId:7+i};
  const notes=original().map(n=>({...n,subscriptionMint:current.mint,subscriptionPool:current.pool,subscriptionId:current.subscriptionId}));
  const selected=sealNativeNotificationAuditFences({notifications:notes,target,at:161000,generation:current});assert.equal(selected.available,true);
  notes.push({...note(7,400,165000),subscriptionMint:current.mint,subscriptionPool:current.pool,subscriptionId:current.subscriptionId});
  sessions.push(new NativeAuditSession({pool:current.pool,target,notifications:notes,notificationFenceGeneration:current,notificationFenceWitness:selected.witness,now:()=>at,deadlineAt:169999}));
 }
 await Promise.all(sessions.map(s=>s.advance()));let inFlight=0,physicalStarts=0;
 for(const session of sessions){const page=session.pending();assert.ok(page);assert.equal(inFlight,0);inFlight++;physicalStarts++;assert.equal((page.params[1] as {before:string}).before,signature(3));at+=500;
  assert.equal(session.respond(page.page,originalHistory()),true);inFlight--;await session.advance();assert.equal(session.result()?.status,'verified');assert.equal(session.result()?.anchor?.signature,signature(3));assert.equal(session.deadlineAt,169999);
 }
 assert.equal(physicalStarts,4);assert.equal(inFlight,0);assert.equal(at,168000);assert.ok(sessions.every(s=>s.error()===null&&s.result()?.complete));
});
