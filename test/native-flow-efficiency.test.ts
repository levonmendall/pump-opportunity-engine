import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import {CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW} from '../src/program-log-mapping.js';
import {NATIVE_PACKET_EVIDENCE_POLICY,type NativeNotification} from '../src/pilot-native-flow.js';
import {setup,scope,tx,retained,clone} from './native-flow-fixture.js';

function signature(n:number){const bytes=Buffer.alloc(64,177);bytes.writeUInt32LE(n);return bs58.encode(bytes);}

test('V3 retains each canonical empty notification once without changing failed diagnostics, identity or received-byte accounting',async()=>{
 const activities:unknown[]=[],f=setup({dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,onActivity:row=>activities.push(row)}),socket=await f.open();
 try{
  for(let n=1;n<=40;n++)f.notice(socket,{signature:signature(n),logs:[],...(n%2?{}:{err:{InstructionError:[1,{Custom:1}]}})});
  const info=f.records.filter(r=>r.kind==='native-flow-information-available');
  assert.equal(info.length,40);assert.equal(new Set(info.map(r=>r.data.signature)).size,40);assert.equal(f.records.filter(r=>r.kind==='native-flow-validated-events').length,0);
  for(const record of info){assert.equal(record.data.packetEvidencePolicy,NATIVE_PACKET_EVIDENCE_POLICY.version);assert.equal(record.data.validatedEventPayloads,0);assert.equal(record.data.wholeTransactionFramesValidated,record.data.success);assert.match(record.data.rawHash,/^[a-f0-9]{64}$/);}
  assert.equal(f.flow.usage().notifications,40);assert.equal(f.flow.usage().packetEvidence.emptyEventEnvelopesOmitted,40);assert.equal(f.flow.usage().failedPacketDiagnostics.sourceReportedPackets,20);assert.equal(f.flow.usage().transactionRetention.records,40);
  assert.equal(activities.length,40);assert.equal(f.trades.length,0);assert.equal(f.gaps.length,0);assert.equal(f.controlBytes,socket._socket.bytesRead);
  const successful=f.flow.notificationLedger(scope.mint).filter(n=>n.success);assert.equal(successful.length,20);assert.deepEqual(new Set(successful.map(n=>n.signature)),new Set(info.filter(r=>r.data.success).map(r=>r.data.signature)));
  // Real economic event bytes are never replaced by a metadata-only record.
  f.notice(socket,{signature:signature(100),logs:clone(tx.meta.logMessages)});
  const payload=f.records.filter(r=>r.kind==='native-flow-validated-events');assert.equal(payload.length,1);assert.ok(payload[0]!.data.events.length>0);assert.ok(payload[0]!.data.events.every((e:any)=>typeof e.eventBase64==='string'&&e.eventBase64.length>0));
  assert.ok(f.trades.length>0);assert.equal(f.flow.usage().packetEvidence.emptyEventEnvelopesOmitted,40);
 }finally{await f.flow.stop();}
});

test('failure to retain the single required notification still invalidates its observation',async()=>{
 const f=setup({dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}),socket=await f.open(),options=(f.flow as any).options,record=options.record;
 options.record=(kind:string,data:unknown)=>{if(kind==='native-flow-information-available')throw Error('OFFLINE_REQUIRED_RECORD_UNAVAILABLE');record(kind,data);};
 try{
  f.notice(socket,{signature:signature(101),logs:[]});
  assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,true);assert.equal(f.flow.snapshot(scope.mint)!.lastGapReason,'OFFLINE_REQUIRED_RECORD_UNAVAILABLE');
  assert.equal(f.flow.usage().packetEvidence.emptyEventEnvelopesOmitted,0);assert.equal(f.trades.length,0);assert.equal(f.controlBytes,socket._socket.bytesRead);
 }finally{options.record=record;await f.flow.stop();}
});

test('persistent V3 removes accepted raw examples while retaining actual event bytes and refusal timings',async()=>{
 const f=setup({persistent:true,dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}),socket=await f.open();
 try{
  f.notice(socket,{signature:signature(102),logs:clone(tx.meta.logMessages)});
  assert.ok(f.trades.length>0);assert.equal(f.records.filter(r=>r.kind==='native-flow-raw-representative').length,0);
  const payload=f.records.find(r=>r.kind==='native-flow-validated-events')!;assert.ok(payload.data.events.length>0);assert.ok(payload.data.events.every((e:any)=>e.eventBase64.length>0));
  assert.equal(f.flow.usage().rawEvidence.successfulShapes,0);assert.equal(f.flow.usage().rawEvidence.successfulBytes,0);
  f.delayNextRecord(300);const trades=f.trades.length;f.notice(socket,{signature:signature(103),logs:clone(tx.meta.logMessages)});
  const refusal=f.records.find(r=>r.kind==='native-flow-refusal')!;
  assert.equal(refusal.data.reason,'NATIVE_FLOW_PROCESSING_DEADLINE');assert.equal(refusal.data.processingStages.validationElapsedMs,0);
  assert.equal(refusal.data.processingStages.requiredEventRetentionMs,300);assert.equal(refusal.data.processingStages.supplementaryRawRetentionMs,0);
  assert.equal(refusal.data.processingStages.maximumProcessingMs,250);assert.equal(refusal.data.processingStages.maximumReceiptAgeMs,5000);
  assert.equal(f.trades.length,trades);assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,true);assert.equal(f.controlBytes,socket._socket.bytesRead);
 }finally{await f.flow.stop();}
});

test('successful-looking malformed protocol labels remain unusable and retain distinct bounded refusal shapes',async()=>{
 const f=setup({dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}),socket=await f.open(),program=PUMP_AMM_PROGRAM_ID.toBase58();
 try{
  for(const label of ['BoostBuyAndBurn','Buy']){
   if(f.flow.snapshot(scope.mint)!.hasQualityLoss){f.flow.addCandidate(scope);await f.drive(8);}
   f.notice(socket,{signature:'1'.repeat(64),logs:[`Program ${program} invoke [1]`,`Program log: Instruction: ${label}`,`Program ${program} success`]});
   assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,true);assert.equal(f.flow.snapshot(scope.mint)!.suspended,true);assert.equal(f.flow.notificationLedger(scope.mint).length,0);
  }
  const refusals=f.records.filter(r=>r.kind==='native-flow-noncanonical-notification-refused'),raw=f.records.filter(r=>r.kind==='native-flow-raw-refusal');
  assert.equal(refusals.length,2);assert.equal(raw.length,2,'different observed malformed shapes share the same bounded raw reserve without hiding the second pattern');
  assert.equal(refusals[0]!.data.logShape.boostInstructionMarkers,1);assert.equal(refusals[1]!.data.logShape.swapInstructionMarkers,1);
  assert.ok(refusals.every(r=>r.data.requiresFreshWindow===true&&r.data.selectedInformationAdmitted===false&&r.data.logShape.qualificationEvidence===false));
  const usage=f.flow.usage();assert.equal(usage.refusedNotificationDiagnostics.last!.logShape.swapInstructionMarkers,1);assert.equal(usage.rawEvidence.refusalShapes,2);assert.ok(usage.rawEvidence.refusalBytes<=512*1024);
  assert.equal(f.trades.length,0);assert.equal(usage.protocolEffects,0);assert.equal(f.controlBytes,socket._socket.bytesRead);
 }finally{await f.flow.stop();}
});

// Independent original retention rule. Compare externally visible evidence,
// including lower fences and late lower-slot packets, not internal cache state.
function referenceCompact(rows:NativeNotification[],incoming:NativeNotification|undefined,at:number){
 const start=Math.floor(at/10000)*10000-60000,all=incoming?[...rows,incoming]:rows,required=all.filter(n=>n.availableAt>=start),minimum=required.length?Math.min(...required.map(n=>n.slot)):Infinity;
 const before=all.filter(n=>n.availableAt<start&&n.receivedAt<start&&!n.correction&&n.classification!=='unusable'&&n.slot<minimum).sort((a,b)=>b.slot-a.slot||b.availableAt-a.availableAt),fence=before[0];
 return fence?rows.filter(n=>n===fence||n.slot>fence.slot||n.availableAt>=start):rows;
}

test('same-boundary compaction preserves exact evidence through changing windows and out-of-order slots',async()=>{
 const at=Math.floor((retained.data.rpcAvailableAt as number)/10000)*10000+100,f=setup({at}),socket=await f.open(),subscription=f.flow.snapshot(scope.mint)!.subscription!;
 let expected:NativeNotification[]=[],supportAt=f.now+15000;
 try{
  for(let n=1;n<=850;n++){
   f.elapseWithoutTimers(100);if(f.now>=supportAt){f.flow.requestSupportRefresh();await f.drive(3);supportAt=f.now+15000;}
   const slot=tx.slot+n-(n%57===0?120:0);
   socket.frame({jsonrpc:'2.0',method:'logsNotification',params:{subscription,result:{context:{slot},value:{signature:signature(n+1000),err:{InstructionError:[1,{Custom:1}]},logs:[]}}}});
   const row=f.records.findLast(r=>r.kind==='native-flow-information-available')!.data as NativeNotification;
   assert.equal(row.signature,signature(n+1000));expected=referenceCompact(expected,row,f.now);expected.push(row);
   if(n%25===0){expected=referenceCompact(expected,undefined,f.now);assert.deepEqual(f.flow.notificationLedger(scope.mint).map(n=>n.signature),expected.map(n=>n.signature));}
  }
  assert.equal(f.gaps.length,0);assert.equal(f.flow.usage().fatal,null);assert.equal(f.controlBytes,socket._socket.bytesRead);
 }finally{await f.flow.stop();}
});

test('same-window appends do not enumerate the existing ledger, while a boundary change still rescans',async()=>{
 const at=Math.floor((retained.data.rpcAvailableAt as number)/10000)*10000+100,f=setup({at}),socket=await f.open();
 try{
  f.notice(socket,{signature:signature(2000),logs:[]});
  const candidate=(f.flow as any).candidates.get(scope.mint);let scans=0;
  candidate.ledger=new Proxy(candidate.ledger,{get(target,property,receiver){if(property===Symbol.iterator||property==='filter')scans++;return Reflect.get(target,property,receiver);}});
  for(let n=1;n<=100;n++)f.notice(socket,{signature:signature(2000+n),logs:[]});
  assert.equal(scans,0,'current-window appends cannot expose an additional removable prewindow row');
  f.elapseWithoutTimers(10000);f.notice(socket,{signature:signature(2200),logs:[]});assert.ok(scans>0,'new closed-window boundary must reevaluate exact fences');
  assert.equal(f.flow.notificationLedger(scope.mint).length,102);assert.equal(f.gaps.length,0);assert.equal(f.controlBytes,socket._socket.bytesRead);
 }finally{await f.flow.stop();}
});
