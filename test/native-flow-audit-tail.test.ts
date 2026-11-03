/** Recorded source640 availability replay and explicit offline failure cases.
 * This does not simulate new provider responses, natural returns or capacity. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {auditNativeFlowWindow,type NativeFlowAuditOptions} from '../src/native-flow-audit.js';
import {NativeAuditSession} from '../src/native-audit-session.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';

function actual(id:1|2){return JSON.parse(readFileSync(`evidence/native-audit-tail-20261028/actual-tail-${id}.json`,'utf8'));}
function setup(id:1|2,tail=true){
 const f=actual(id);let at=f.result.startedAt,calls=0;const records:Array<{kind:string;data:any}>=[];
 const options:NativeFlowAuditOptions={pool:f.result.pool,target:structuredClone(f.result.target),notifications:structuredClone(f.snapshot),contextFences:structuredClone(f.result.contextFences),now:()=>at,pageLimit:1000,maximumElapsedMs:f.result.target.endAt+9999-at,
  call:async<T>()=>{calls++;at=f.result.availableAt;return f.historyRows.map((r:any)=>({signature:r.signature,slot:r.slot,err:r.success?null:{RecordedIndependentFailure:true},blockTime:r.blockTime,confirmationStatus:r.confirmationStatus})) as T;},
  record:(kind,data)=>records.push({kind,data:structuredClone(data)}),...(tail?{notificationGeneration:structuredClone(f.generation),postSnapshotNotifications:()=>structuredClone(f.tail)}:{})};
 return {f,options,records,get calls(){return calls;},set at(value:number){at=value;},get at(){return at;}};
}

test('recorded mWT3 late packets corroborate history without changing the original60s information or making extra requests',async()=>{
 const old=setup(1,false),oldResult=await auditNativeFlowWindow(old.options);assert.equal(oldResult.status,'unusable');assert.equal(oldResult.missingSuccessfulNotifications.length,3);
 const s=setup(1),r=await auditNativeFlowWindow(s.options);assert.equal(r.status,'verified',r.reason);assert.equal(s.calls,1);assert.deepEqual(r.requiredSignatures,s.f.result.requiredSignatures);assert.deepEqual(r.target,s.f.result.target);assert.deepEqual(r.strictInteriorSlots,s.f.result.strictInteriorSlots);assert.equal(r.notificationSnapshot.rows,58);assert.equal(r.notificationSnapshot.capturedAt,s.f.result.startedAt);assert.equal(r.postSnapshotTail.rows,3);assert.equal(r.postSnapshotTail.matchedInteriorSignatures.length,3);assert.equal(r.postSnapshotTail.addedPackets.length,3);assert.ok(r.postSnapshotTail.addedPackets.every(n=>n.availableAt>r.startedAt&&n.availableAt>r.target.endAt&&n.availableAt<=r.availableAt));assert.ok(s.records.some(e=>e.kind==='native-flow-audit-post-snapshot-tail'&&e.data.featureInformationBackdated===false));assert.equal(r.notificationCompletenessVerified,true);assert.equal(r.executedFlowCompletenessVerified,true);assert.deepEqual(s.options.notifications,s.f.snapshot,'the immutable original ledger is not mutated');
});

test('recorded vv2 known tail packets cannot waive its1unknown successful history row or become ordinary flow',async()=>{
 const s=setup(2),r=await auditNativeFlowWindow(s.options);assert.equal(r.status,'unusable');assert.equal(r.reason,'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED');assert.equal(r.postSnapshotTail.addedSignatures.length,2);assert.equal(r.postSnapshotTail.matchedInteriorSignatures.length,2);assert.equal(r.missingSuccessfulNotifications.length,1);assert.equal(r.missingSuccessfulNotifications[0]!.signature,'4ibMkh4H6PGYvtBuRjuzRm8KCKtp167Jbxcss6BgRGPdWZ54BcqUQ6FXfNjqaj8MmyuUVAq4QL8wS5Laa4iaTUhk');assert.deepEqual(r.requiredSignatures,s.f.result.requiredSignatures);assert.equal(r.complete,false);assert.equal(r.executedFlowCompletenessVerified,false);assert.equal(s.f.tail.filter((n:NativeNotification)=>n.protocolEffects===1).length,1,'a real protocol effect is evidence, not an invented external buy');
});

test('validated cross-scope tail uses its exact target generation without inventing a direct subscription delivery',async()=>{
 const s=setup(1),tail=structuredClone(s.f.tail),g=s.f.generation;
 Object.assign(tail[0],{subscriptionMint:bs58.encode(Buffer.alloc(32,9)),subscriptionPool:bs58.encode(Buffer.alloc(32,10)),subscriptionId:g.subscriptionId+100,deliveredByMint:bs58.encode(Buffer.alloc(32,9)),observedForMint:g.mint,scopeEvidence:'confirmed-transaction-program-frame',countsScope:'scope-only',classification:'program-event',parsedEvents:1,observedScope:structuredClone(g)});
 s.options.postSnapshotNotifications=()=>tail;const result=await auditNativeFlowWindow(s.options);
 assert.equal(result.status,'verified',result.reason);assert.equal(result.executedFlowCompletenessVerified,true);assert.deepEqual(result.requiredSignatures,s.f.result.requiredSignatures);assert.deepEqual(result.target,s.f.result.target);assert.deepEqual(result.strictInteriorSlots,s.f.result.strictInteriorSlots);assert.equal(result.postSnapshotTail.matchedInteriorSignatures.length,3);assert.equal(tail[0].subscriptionId,g.subscriptionId+100,'delivery identity remains honest');assert.deepEqual(s.options.notifications,s.f.snapshot,'the original feature snapshot stays immutable');assert.deepEqual(result.postSnapshotTail.addedPackets[0]!.observedScope,g);assert.equal(result.postSnapshotTail.addedPackets[0]!.subscriptionId,g.subscriptionId+100);
});

test('cross-scope tail refuses incomplete event proof, changed delivery and every changed target-generation field',async()=>{
 for(const field of ['no-binding','no-event-proof','no-scope-marker','wrong-target-mint','wrong-delivery-mint','missing-delivery-id','same-delivery-id','same-delivery-pool','wrong-delivery-connection','mint','pool','openedAt','connectionId','subscriptionId','nontrade','no-event','failed'] as const){
  const s=setup(1),tail=structuredClone(s.f.tail),g=s.f.generation,other=bs58.encode(Buffer.alloc(32,9)),n=tail[0] as any;
  Object.assign(n,{subscriptionMint:other,subscriptionPool:bs58.encode(Buffer.alloc(32,10)),subscriptionId:g.subscriptionId+100,deliveredByMint:other,observedForMint:g.mint,scopeEvidence:'confirmed-transaction-program-frame',countsScope:'scope-only',classification:'program-event',parsedEvents:1,protocolEffects:0,observedScope:structuredClone(g)});
  if(field==='no-binding')delete n.observedScope;else if(field==='no-event-proof')delete n.scopeEvidence;else if(field==='no-scope-marker')delete n.countsScope;else if(field==='wrong-target-mint')n.observedForMint=other;else if(field==='wrong-delivery-mint')n.deliveredByMint=g.mint;else if(field==='missing-delivery-id')delete n.subscriptionId;else if(field==='same-delivery-id')n.subscriptionId=g.subscriptionId;else if(field==='same-delivery-pool')n.subscriptionPool=g.pool;else if(field==='wrong-delivery-connection')n.connectionId++;else if(field==='mint'||field==='pool')n.observedScope[field]=other;else if(field==='openedAt'||field==='connectionId'||field==='subscriptionId')n.observedScope[field]++;else if(field==='nontrade')n.classification='nontrade';else if(field==='no-event')n.parsedEvents=0;else n.success=false;
  s.options.postSnapshotNotifications=()=>tail;const result=await auditNativeFlowWindow(s.options);assert.equal(result.status,'unavailable',field);assert.equal(result.reason,'NATIVE_AUDIT_TAIL_NOTIFICATION_GENERATION',field);assert.equal(result.executedFlowCompletenessVerified,false);assert.equal(s.calls,1);assert.deepEqual(result.target,s.f.result.target);assert.deepEqual(result.strictInteriorSlots,s.f.result.strictInteriorSlots);
 }
});

test('exact cross-scope protocol evidence can corroborate a tail but cannot excuse another missing successful signature',async()=>{
 for(const id of [1,2] as const){const s=setup(id),tail=structuredClone(s.f.tail),g=s.f.generation,other=bs58.encode(Buffer.alloc(32,9));Object.assign(tail[0],{subscriptionMint:other,subscriptionPool:bs58.encode(Buffer.alloc(32,10)),subscriptionId:g.subscriptionId+100,deliveredByMint:other,observedForMint:g.mint,scopeEvidence:'confirmed-transaction-program-frame',countsScope:'scope-only',classification:'program-event',parsedEvents:0,protocolEffects:1,observedScope:structuredClone(g)});s.options.postSnapshotNotifications=()=>tail;
  const result=await auditNativeFlowWindow(s.options);assert.equal(result.status,id===1?'verified':'unusable');assert.equal(result.missingSuccessfulNotifications.length,id===1?0:1);assert.deepEqual(result.requiredSignatures,s.f.result.requiredSignatures);if(id===2)assert.equal(result.missingSuccessfulNotifications[0]!.signature,'4ibMkh4H6PGYvtBuRjuzRm8KCKtp167Jbxcss6BgRGPdWZ54BcqUQ6FXfNjqaj8MmyuUVAq4QL8wS5Laa4iaTUhk');
 }
});

test('late successful/failed status reversal, correction, unusable packet and hash change remain blocking',async()=>{
 for(const mode of ['status','correction','unusable','hash'] as const){const s=setup(1);const tail=structuredClone(s.f.tail) as NativeNotification[];if(mode==='status')tail[0]!.success=false;else if(mode==='correction')tail[0]!.correction=true;else if(mode==='unusable')tail[0]!.classification='unusable';else tail.push({...s.f.snapshot[0],availableAt:s.f.result.availableAt-1,rawHash:'b'.repeat(64)});s.options.postSnapshotNotifications=()=>tail;const r=await auditNativeFlowWindow(s.options);assert.equal(r.status,'unusable');assert.equal(r.reason,mode==='status'?'NATIVE_AUDIT_CONFIRMED_STATUS_DISAGREEMENT':'NATIVE_AUDIT_POST_SNAPSHOT_CORRECTION');assert.equal(r.complete,false);assert.equal(r.notificationCompletenessVerified,false);assert.deepEqual(r.requiredSignatures,s.f.result.requiredSignatures);}
});

test('tail packets require exact pool/mint/connection/subscription and actual post-snapshot availability',async()=>{
 for(const field of ['subscriptionPool','subscriptionMint','connectionId','subscriptionId','rawHash','beforeSnapshot','future','beforeACK'] as const){const s=setup(1),tail=structuredClone(s.f.tail);if(field==='subscriptionPool'||field==='subscriptionMint')tail[0][field]=bs58.encode(Buffer.alloc(32,7));else if(field==='connectionId'||field==='subscriptionId')tail[0][field]++;else if(field==='rawHash')tail[0].rawHash='invalid';else if(field==='beforeSnapshot')tail[0].availableAt=s.f.result.startedAt;else if(field==='future')tail[0].availableAt=s.f.result.availableAt+1;else tail[0].receivedAt=s.f.generation.openedAt-1;s.options.postSnapshotNotifications=()=>tail;const r=await auditNativeFlowWindow(s.options);assert.equal(r.status,'unavailable',field);assert.match(r.reason,/NATIVE_AUDIT_TAIL_NOTIFICATION_(GENERATION|SCHEMA)/);assert.equal(r.complete,false);assert.equal(s.calls,1);}
 const s=setup(1);delete s.options.notificationGeneration;const r=await auditNativeFlowWindow(s.options);assert.equal(r.reason,'NATIVE_AUDIT_TAIL_OPTIONS');assert.equal(s.calls,0,'missing binding cannot start a history request');
});

test('tail refresh preserves8192row bounds and never changes a fence to admit delayed information',async()=>{
 const s=setup(1);s.options.postSnapshotNotifications=()=>Array(8193).fill(s.f.tail[0]);const r=await auditNativeFlowWindow(s.options);assert.equal(r.reason,'NATIVE_AUDIT_TAIL_NOTIFICATION_BOUND');assert.equal(r.status,'unavailable');assert.equal(r.postSnapshotTail.addedSignatures.length,0);assert.deepEqual(r.strictInteriorSlots,s.f.result.strictInteriorSlots);
 const b=setup(1),base=b.f.snapshot[0];b.options.notifications=Array.from({length:8192},(_,i)=>{const bytes=Buffer.alloc(64);bytes.writeUInt32LE(100000+i);return {...base,signature:bs58.encode(bytes),slot:b.f.result.contextFences.lower.slot-1,receivedAt:b.f.generation.openedAt,availableAt:b.f.generation.openedAt};});const bounded=await auditNativeFlowWindow(b.options);assert.equal(bounded.status,'unavailable');assert.equal(bounded.reason,'NATIVE_AUDIT_TAIL_NOTIFICATION_BOUND');assert.equal(bounded.postSnapshotTail.addedSignatures.length,0,'union of frozen snapshot and tail cannot exceed original8192bound');
});

test('cancelled or expired sessions do not refresh diagnostics, admit information or imply physical settlement',async()=>{
 for(const failure of ['cancel','deadline'] as const){const s=setup(1);let reads=0;s.options.postSnapshotNotifications=()=>{reads++;return s.f.tail;};const session=new NativeAuditSession({...s.options,maximumPages:4,deadlineAt:s.f.result.target.endAt+9999});await session.advance();const page=session.pending()!;assert.ok(page);if(failure==='cancel')session.cancel('NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');else s.at=s.f.result.target.endAt+10000;assert.equal(session.respond(page.page,[]),false);await session.advance();assert.equal(reads,0);assert.equal(session.result(),null);assert.equal(session.error(),failure==='cancel'?'NATIVE_AUDIT_SOURCE_GENERATION_CHANGED':'NATIVE_AUDIT_SESSION_DEADLINE');assert.equal(session.diagnosticResult()?.complete,false);}
});

test('deadline or admission closing during diagnostic callback leaves the audit unavailable with honest final availability',async()=>{
 for(const failure of ['clock','admission','generation'] as const){const s=setup(1);let open=true;s.options.admission={admissionOpen:()=>open};s.options.postSnapshotNotifications=()=>{if(failure==='clock')s.at=s.f.result.target.endAt+10000;else if(failure==='admission')open=false;else throw Error('NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');return s.f.tail;};const r=await auditNativeFlowWindow(s.options);assert.equal(r.status,'unavailable');assert.equal(r.complete,false);assert.equal(r.notificationCompletenessVerified,false);assert.equal(r.executedFlowCompletenessVerified,false);assert.equal(r.postSnapshotTail.addedSignatures.length,0);assert.equal(r.reason,failure==='clock'?'NATIVE_AUDIT_ELAPSED_LIMIT':failure==='admission'?'NATIVE_AUDIT_TAIL_ADMISSION_CLOSED':'NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');assert.equal(s.calls,1);}
});

test('deferred completion refreshes actual mWT diagnostic tail once while generation input remains immutable',async()=>{
 const s=setup(1);let reads=0;s.options.postSnapshotNotifications=()=>{reads++;return structuredClone(s.f.tail);};const originalGeneration=s.options.notificationGeneration!;
 const session=new NativeAuditSession({...s.options,maximumPages:4,deadlineAt:s.f.result.target.endAt+9999});await session.advance();const page=session.pending()!;assert.equal(reads,0);assert.equal(page.page,1);originalGeneration.connectionId++;
 s.at=s.f.result.availableAt;const history=s.f.historyRows.map((r:any)=>({signature:r.signature,slot:r.slot,err:r.success?null:{RecordedIndependentFailure:true},blockTime:r.blockTime,confirmationStatus:r.confirmationStatus}));assert.equal(session.respond(1,history),true);await session.advance();const result=session.result()!;assert.equal(result.status,'verified',result.reason);assert.equal(reads,1);assert.equal(result.postSnapshotTail.generation!.connectionId,s.f.generation.connectionId);assert.equal(result.postSnapshotTail.addedPackets.length,3);assert.deepEqual(result.requiredSignatures,s.f.result.requiredSignatures);assert.equal(session.pending(),null);assert.equal(session.error(),null);
});
