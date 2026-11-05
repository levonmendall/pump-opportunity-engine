import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,linkSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,unlinkSync,writeFileSync,lstatSync} from 'node:fs';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import bs58 from 'bs58';
import {NativeFailureEvidence,NATIVE_FAILURE_EVIDENCE_POLICY as P,type NativeFailureIdentity} from '../src/native-failure-evidence.js';
import {BoundedRotatingRecorder} from '../src/retained-recorder.js';
import {NativeNotificationIngress} from '../src/native-notification-ingress.js';

const ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e',START=1793653415048;
const id=(startedAt=START,commit='a'.repeat(40)):NativeFailureIdentity=>({accountId:ACCOUNT,inceptionAt:1793052456212,configurationSha256:'c'.repeat(64),source:{commit,sha256:'b'.repeat(64)},startedAt,runId:'native-paper-'+new Date(startedAt).toISOString().replace(/[^0-9]/g,'')});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(t:TestContext){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-failure-evidence-')),directory=join(root,'private');mkdirSync(directory,{mode:0o700});let at=START;
 const input={directory,identity:id(),now:()=>at},writer=new NativeFailureEvidence(input),path=join(directory,P.file);
 t.after(async()=>{await writer.close();rmSync(root,{recursive:true,force:true});});
 return {root,directory,input,writer,path,advance(ms:number){at+=ms;},read(){return JSON.parse(readFileSync(path,'utf8'));},get at(){return at;}};
}
function packet(at=START+1,n=1,logs=['Program log: Instruction: Sell']){return {signature:'2'.repeat(63)+(n%9+1),slot:464643630,receivedAt:at,logs,reason:'LOG_NATIVE_PROTOCOL_CHILD_SHAPE',supplementaryOnly:true};}
function auditWitness(at:number,count=2){
 const mint='3'.repeat(44),pool='4'.repeat(44),end=Math.floor((at-10)/10000)*10000;
 const rows=Array.from({length:count},(_,i)=>({signature:bs58.encode(Buffer.alloc(64,i+1)),slot:200+i,success:true,blockTime:Math.floor((at-10000)/1000),confirmationStatus:'finalized'}));
 return {mint,availableAt:at,notBackdated:true,result:{status:'unusable',reason:'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED',pool,target:{startAt:end-60000,endAt:end},startedAt:at-5,availableAt:at-1,strictInteriorSlots:{lower:100,upper:1000},historyRangeCovered:true,historyRows:300,interiorRows:299,requestAttempts:1,notificationSnapshot:{capturedAt:at-5,rows:297,requiredRows:297},postSnapshotTail:{generation:{mint,pool,openedAt:START,connectionId:3,subscriptionId:17},refreshedAt:at-2,rows:0},missingSuccessfulNotifications:rows,unknownSource:'https://SECRET',rawSuccessPayload:'SUCCESS_RAW_MUST_NOT_COPY'}};
}
function ingressWitness(event:ReturnType<typeof auditWitness>,count=1){
 const router=new NativeNotificationIngress(START),generation=event.result.postSnapshotTail.generation;
 for(let n=0;n<count;n++){
  const missing=event.result.missingSuccessfulNotifications[n%event.result.missingSuccessfulNotifications.length]!,row=router.observe({body:{params:{subscription:generation.subscriptionId,result:{context:{slot:missing.slot},value:{signature:missing.signature,err:null}}}},receivedAt:event.result.target.startAt+100+n,routedAt:event.result.availableAt-1,connectionId:generation.connectionId,generation,stage:'INITIAL_CALLBACK'});router.finish(row,'ACTIVE_PROCESSOR');
 }
 return router.evidence({target:event.result.target,availableAt:event.result.availableAt,generation,missingSignatures:event.result.missingSuccessfulNotifications.slice(0,8).map(row=>row.signature),missingSignaturesTotal:event.result.missingSuccessfulNotifications.length},event.availableAt);
}
function emit(f:ReturnType<typeof fixture>,p=packet(f.at)){
 const rawHash=hash({signature:p.signature,slot:p.slot,err:null,logs:p.logs});
 f.writer.observe('native-flow-refusal',{signature:p.signature,slot:p.slot,receivedAt:p.receivedAt,availableAt:p.receivedAt+1,success:true,rawHash,subscriptionMint:'3'.repeat(44),subscriptionPool:'4'.repeat(44),subscriptionId:17,connectionId:3,classification:'unusable',reason:p.reason,processingStages:{validationElapsedMs:2,maximumProcessingMs:250}});
 f.writer.observe('native-flow-raw-refusal',p);return rawHash;
}

test('exact refusal sample and paired hash/scope survive without successful raw or report data',async t=>{
 const f=fixture(t),p=packet(f.at),rawHash=emit(f,p);f.writer.observe('native-flow-raw-representative',{...p,logs:['SUCCESS_RAW_MUST_NOT_COPY']});f.writer.observe('native-flow-information-available',{signature:'SUCCESS_IDENTITY'});f.writer.observe('status',{private:'REPORT_MUST_NOT_COPY'});await f.writer.flush();
 const out=f.read(),raw=out.records.find((r:any)=>r.kind==='native-flow-raw-refusal'),detail=out.records.find((r:any)=>r.kind==='native-flow-refusal');
 assert.deepEqual(out.identity,f.input.identity);assert.deepEqual(raw.data,p);assert.equal(raw.retainedEventSha256,hash({kind:'native-flow-raw-refusal',data:p}));assert.equal(raw.eventAt,f.at);assert.equal(detail.data.rawHash,rawHash);assert.equal(detail.data.connectionId,3);assert.equal(detail.data.subscriptionId,17);assert.equal(out.rawSampleBytes,Buffer.byteLength(JSON.stringify({kind:'native-flow-raw-refusal',data:p})));
 assert.equal(out.financialWrites,0);assert.equal(out.tradingAuthority,false);assert.equal(out.previousRunEvidenceImported,false);assert.match(out.completeness,/NOT_A_COMPLETE_CENSUS/);assert.equal(lstatSync(f.path).mode&0o777,0o600);assert.ok(!readFileSync(f.path,'utf8').includes('MUST_NOT_COPY'));
});

test('typed failed transport includes causal timings and removes arbitrary payloads and expected closes',async t=>{
 const f=fixture(t);f.writer.observe('native-flow-protocol-refused',{at:f.at,connection:3,method:'PING',reason:'NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE',requestStartedAt:f.at-2,writeCallbackAt:f.at-1,writeCallbackSucceeded:true,matchingPongReceiptAt:null,transportClosed:false,receiptTiming:{frames:3,pendingEvents:1,maximumHandlerQueueMs:120,partialMessage:false,url:'https://SECRET'},url:'https://SECRET',headers:{authorization:'SECRET'},error:'SECRET'});
 f.writer.observe('native-flow-disconnected',{at:f.at,connection:4,expected:true,reason:'EXPECTED_CLOSE'});await f.writer.flush();const out=f.read(),record=out.records[0];
 assert.equal(out.records.length,1);assert.equal(record.eventTimeBasis,'PRODUCER_EVENT_TIMESTAMP');assert.equal(record.data.writeCallbackSucceeded,true);assert.equal(record.data.matchingPongReceiptAt,null);assert.deepEqual(record.data.receiptTiming,{frames:3,pendingEvents:1,maximumHandlerQueueMs:120,partialMessage:false});assert.ok(record.sourceFieldsOmitted>=3);assert.ok(!readFileSync(f.path,'utf8').includes('SECRET'));
});

test('actual control-refused acknowledgement and control-budget cause remain typed and attributable',async t=>{
 const f=fixture(t),acknowledgement={resultType:'number',safeNonnegativeInteger:true,subscriptionId:17,retiredSubscriptionMatch:true,activeSubscriptionMatch:false,booleanResult:null,transportReceiptLowerBoundAt:f.at,handledAt:f.at+3};
 const failed={at:f.at,method:'logsSubscribe',connection:3,mint:'3'.repeat(44),pool:'4'.repeat(44),reason:'NATIVE_FLOW_REBOUND_GENERATION_AMBIGUOUS',requestStartedAt:f.at-20,writeCallbackAt:f.at-18,writeCallbackSucceeded:true,abortRequestedAt:null,acknowledgement,rpcErrorCode:null,supportFresh:true,candidateStillRegistered:true,cancelled:false,transportClosing:false,physicalSettlementClaimed:false};f.writer.observe('native-flow-control-refused',failed);f.writer.observe('native-flow-control-refused',{...failed,mint:'5'.repeat(44)});
 f.writer.observe('pilot-data-control-unavailable',{at:f.at,code:'CONTROL_CAPACITY',controlCooldownUntil:f.at+1000,publicRpcCooldownUnchanged:true,physicalSettled:false,reservationsRetained:4096});await f.writer.flush();const records=f.read().records;
 assert.deepEqual(records[0].data.acknowledgement,acknowledgement);assert.notEqual(records[0].data.mint,records[1].data.mint,'different candidates on one connection retain separate failure attribution');assert.equal(records[2].data.code,'CONTROL_CAPACITY');assert.equal(records[2].data.physicalSettled,false);assert.equal(records[2].data.controlCooldownUntil,f.at+1000);
});

test('a missing typed transport receipt is explicitly producer time, while raw samples never substitute data.at',async t=>{
 const f=fixture(t);f.writer.observe('native-flow-protocol-refused',{at:f.at,receivedAt:null,connection:3,reason:'NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE'});f.writer.observe('native-flow-raw-refusal',{...packet(f.at),receivedAt:null,at:f.at});await f.writer.flush();const out=f.read();assert.equal(out.records.length,1);assert.equal(out.records[0].eventTimeBasis,'PRODUCER_EVENT_TIMESTAMP');assert.equal(out.records[0].eventAt,f.at);assert.equal(Object.hasOwn(out.records[0].data,'receivedAt'),false);assert.equal(out.counts.malformedSelectedEvents,1);
});

test('all new raw reasons are retained without a reason allowlist and mutable input cannot change evidence',async t=>{
 const f=fixture(t),p={...packet(f.at),reason:'PREVIOUSLY_UNSEEN_REFUSAL'},before=JSON.parse(JSON.stringify(p));emit(f,p);p.logs[0]='AFTER_CAPTURE_MUTATION';p.reason='AFTER_CAPTURE_MUTATION';await f.writer.flush();
 assert.deepEqual(f.read().records.find((r:any)=>r.kind==='native-flow-raw-refusal').data,before);
});

test('raw cap counts the complete original event envelope and persists the first explicit omission',async t=>{
 const f=fixture(t);for(let n=0;n<10;n++)emit(f,packet(f.at+n,n));await f.writer.flush();let out=f.read();assert.equal(out.rawSamples,8);assert.equal(out.counts.rawSamplesOmitted,2);assert.ok(out.rawSampleBytes<=P.maximumRawBytes);assert.ok(readFileSync(f.path).length<P.maximumFileBytes);
 await f.writer.close();const fresh=new NativeFailureEvidence({...f.input,identity:id(START+100),now:()=>START+100});t.after(()=>fresh.close());fresh.observe('native-flow-raw-refusal',packet(START+100,1,['x'.repeat(P.maximumRawBytes)]));await fresh.flush();out=f.read();assert.equal(out.rawSamples,0);assert.equal(out.counts.rawSamplesOmitted,1);assert.equal(out.rawSampleBytes,0);
});

test('transport failures and their bytes are independently bounded; repeated same cause cannot make a write loop',async t=>{
 const f=fixture(t);await f.writer.flush();for(let n=0;n<30;n++)f.writer.observe('native-flow-protocol-refused',{at:f.at,connection:n,reason:'NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE',method:'PING'});await f.writer.flush();let out=f.read();assert.equal(out.records.length,P.maximumTransportSamples);assert.equal(out.counts.transportSamplesOmitted,30-P.maximumTransportSamples);assert.ok(out.detailRecordBytes<=P.maximumDetailBytes);
 for(let n=0;n<100;n++)f.writer.observe('native-flow-protocol-refused',{at:f.at,connection:0,reason:'NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE',method:'PING'});await f.writer.flush();const revision=f.read().revision;
 for(let n=0;n<100;n++)f.writer.observe('native-flow-protocol-refused',{at:f.at,connection:0,reason:'NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE',method:'PING'});await f.writer.flush();assert.equal(f.read().revision,revision,'later duplicate counters wait for another admitted sample or final flush');await f.writer.close();out=f.read();assert.equal(out.counts.transportDuplicates,200);assert.equal(out.closed,true);
});

test('a mismatched companion never supplies invented packet hash or transport identity',async t=>{
 const f=fixture(t);f.writer.observe('native-flow-refusal',{...packet(f.at),rawHash:'d'.repeat(64),connectionId:3});f.writer.observe('native-flow-raw-refusal',packet(f.at,2));await f.writer.flush();const out=f.read();assert.equal(out.records.length,1);assert.equal(out.counts.detailRecordsOmitted,1);assert.equal(out.records[0].data.rawHash,undefined);
});

test('default-signature refusal retains its original hash and matching typed receipt facts',async t=>{
 const f=fixture(t),raw={...packet(f.at),signature:'1'.repeat(64),signatureSha256:'e'.repeat(64),rawHash:'f'.repeat(64),reason:'NATIVE_FLOW_NONCANONICAL_SIGNATURE',logShape:{lines:0}};
 f.writer.observe('native-flow-noncanonical-notification-refused',{at:f.at,receivedAt:f.at,slot:raw.slot,signature:raw.signature,rawHash:raw.rawHash,reason:raw.reason,connection:2,subscriptionId:9,defaultSignature:true});f.writer.observe('native-flow-raw-refusal',raw);await f.writer.flush();const out=f.read();assert.equal(out.records.length,2);assert.equal(out.records[0].data.rawHash,raw.rawHash);assert.equal(out.records[1].data.connection,2);
});

test('the first acceptance failure survives real diagnostic eviction beyond the unchanged 600-second window',async t=>{
 const f=fixture(t);emit(f);await f.writer.flush();const before=readFileSync(f.path);const directory=join(f.directory,'service-evidence');let monotonic=0;
 const recorder=new BoundedRotatingRecorder({directory,segmentBytes:4096,diagnosticBytes:24576,continuousRotation:true,maximumDiagnosticBytes:131072,minRetentionMs:300000,minimumDiskReserveBytes:0,now:()=>f.at,monotonic:()=>monotonic});
 for(let i=0;i<10;i++)assert.equal(recorder.record('routine',{payload:'x'.repeat(1800)}),true);await recorder.maintenance();f.advance(601000);monotonic+=601000;await recorder.maintenance();assert.ok(recorder.usage().retiredBytes>0);await recorder.close();
 assert.deepEqual(readFileSync(f.path),before);assert.equal(f.read().records[0].eventAt,START);assert.ok(f.at-f.read().records[0].eventAt>600000);
});

test('a restart replaces only the bounded current file and imports no previous-run records',async t=>{
 const f=fixture(t);emit(f);await f.writer.close();const nextIdentity=id(START+1000,'d'.repeat(40)),next=new NativeFailureEvidence({...f.input,identity:nextIdentity,now:()=>START+1000});t.after(()=>next.close());await next.flush();const out=f.read();assert.deepEqual(out.identity,nextIdentity);assert.deepEqual(out.records,[]);assert.equal(out.previousRunDiscarded,true);assert.equal(out.previousRunEvidenceImported,false);assert.deepEqual(readdirSync(f.directory),[P.file]);
});

test('same or newer run and foreign account cannot be reused or overwritten',async t=>{
 const f=fixture(t);emit(f);await f.writer.close();const before=readFileSync(f.path);
 for(const identity of [id(),id(START-1),{...id(START+10),accountId:'poe-00000000-0000-0000-0000-000000000000'}]){
  const blocked=new NativeFailureEvidence({...f.input,identity,now:()=>START+10});await blocked.flush();assert.equal(blocked.usage().available,false);await blocked.close();assert.deepEqual(readFileSync(f.path),before);
 }
});

test('symlink, hardlink, wrong mode and foreign file block only optional capture and remain untouched',async t=>{
 const f=fixture(t);await f.writer.close();const valid=readFileSync(f.path),victim=join(f.root,'victim');writeFileSync(victim,'ORIGINAL');
 for(const kind of ['symlink','hardlink','mode','foreign']){
  unlinkSync(f.path);if(kind==='symlink')symlinkSync(victim,f.path);else if(kind==='hardlink')linkSync(victim,f.path);else writeFileSync(f.path,kind==='foreign'?'UNRECOGNIZED':valid,{mode:0o600});
  if(kind==='mode'){chmodSync(f.path,0o644);assert.equal(lstatSync(f.path).mode&0o777,0o644,'unsafe-mode fixture must remain unsafe under umask 077');}
  const before=readFileSync(f.path),blocked=new NativeFailureEvidence({...f.input,identity:id(START+10),now:()=>START+10});assert.doesNotThrow(()=>blocked.observe('native-flow-raw-refusal',packet(START+10)));await blocked.flush();assert.equal(blocked.usage().available,false);await blocked.close();assert.deepEqual(readFileSync(f.path),before);assert.equal(readFileSync(victim,'utf8'),'ORIGINAL');
 }
});

test('canonical private directory is required; alias and writable directory do not receive a file',async t=>{
 const f=fixture(t);await f.writer.close();const alias=join(f.root,'alias');symlinkSync(f.directory,alias);
 for(const directory of [alias,f.directory+'/../private']){const blocked=new NativeFailureEvidence({...f.input,directory,identity:id(START+10)});await blocked.flush();assert.equal(blocked.usage().available,false);await blocked.close();}
 chmodSync(f.directory,0o770);const blocked=new NativeFailureEvidence({...f.input,identity:id(START+10)});await blocked.flush();assert.equal(blocked.usage().available,false);await blocked.close();chmodSync(f.directory,0o700);
});

test('a verified older fixed pending file is recovered without accumulating files, while partial pending refuses',async t=>{
 const f=fixture(t);emit(f);await f.writer.close();const pending=join(f.directory,P.pendingFile);writeFileSync(pending,readFileSync(f.path),{mode:0o600});
 const next=new NativeFailureEvidence({...f.input,identity:id(START+10),now:()=>START+10});await next.flush();assert.equal(next.usage().available,true);await next.close();assert.deepEqual(readdirSync(f.directory),[P.file]);
 writeFileSync(pending,'{"schemaVersion":1,',{mode:0o600});const before=readFileSync(f.path),blocked=new NativeFailureEvidence({...f.input,identity:id(START+20),now:()=>START+20});await blocked.flush();assert.equal(blocked.usage().available,false);await blocked.close();assert.deepEqual(readFileSync(f.path),before);assert.equal(readFileSync(pending,'utf8'),'{"schemaVersion":1,');
});

test('writes coalesce while one atomic replacement is in flight and orderly close flushes the final state',async t=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);const original=fsPromises.rename;let calls=0,active=0,maximumActive=0;
 t.mock.method(fsPromises,'rename',async(...args:Parameters<typeof original>)=>{calls++;active++;maximumActive=Math.max(maximumActive,active);try{if(calls===1){entered();await gate;}return await original(...args);}finally{active--;}});syncBuiltinESMExports();
 const f=fixture(t);try{await started;for(let n=0;n<8;n++)emit(f,packet(f.at,n));release();await f.writer.flush();assert.equal(calls,2);assert.equal(maximumActive,1);assert.equal(f.read().rawSamples,8);await f.writer.close();assert.equal(f.read().closed,true);assert.equal(calls,3);assert.deepEqual(readdirSync(f.directory),[P.file]);}finally{release();t.mock.restoreAll();syncBuiltinESMExports();}
});

test('write failure cannot escape observe/flush/close or replace the previous verified file',async t=>{
 const f=fixture(t);await f.writer.flush();const before=readFileSync(f.path),original=fsPromises.rename;t.mock.method(fsPromises,'rename',async()=>{throw Object.assign(Error('PRIVATE_FAILURE_MESSAGE'),{code:'EIO'});});syncBuiltinESMExports();
 try{assert.doesNotThrow(()=>emit(f));await assert.doesNotReject(f.writer.flush());assert.equal(f.writer.usage().available,false);assert.equal(f.writer.usage().ioFailures,1);await assert.doesNotReject(f.writer.close());assert.deepEqual(readFileSync(f.path),before);assert.deepEqual(readdirSync(f.directory),[P.file]);}finally{t.mock.restoreAll();syncBuiltinESMExports();assert.equal(fsPromises.rename,original);}
});

test('replacement of the target by another file is detected before any further write',async t=>{
 const f=fixture(t);await f.writer.flush();unlinkSync(f.path);writeFileSync(f.path,'FOREIGN_REPLACEMENT',{mode:0o600});emit(f);await f.writer.flush();assert.equal(f.writer.usage().available,false);assert.equal(readFileSync(f.path,'utf8'),'FOREIGN_REPLACEMENT');
});

test('missing or impossible receipt times and unmarked raw payloads remain explicitly unavailable',async t=>{
 const f=fixture(t);for(const value of [{...packet(f.at),receivedAt:undefined},packet(START-1),packet(START+6000),{...packet(f.at),supplementaryOnly:false}])f.writer.observe('native-flow-raw-refusal',value);await f.writer.flush();const out=f.read();assert.equal(out.rawSamples,0);assert.equal(out.counts.malformedSelectedEvents,4);assert.equal(f.writer.usage().available,true);
});

test('missing-success audit witness retains exact original scope and times without copying successful payloads or assigning packet-loss causality',async t=>{
 const f=fixture(t);f.advance(80000);const event=auditWitness(f.at,20),before=structuredClone(event);
 f.writer.observe('native-candidate-window-audit',event);await f.writer.flush();const out=f.read(),record=out.records[0],result=record.data.result;
 assert.equal(out.auditSamples,1);assert.equal(out.rawSamples,0);assert.equal(record.kind,'native-candidate-window-audit');assert.equal(record.eventAt,event.availableAt);assert.equal(result.startedAt,event.result.startedAt);assert.equal(result.availableAt,event.result.availableAt);assert.deepEqual(result.target,event.result.target);assert.deepEqual(result.postSnapshotTail,event.result.postSnapshotTail);
 assert.deepEqual(result.missingSuccessfulNotifications,event.result.missingSuccessfulNotifications.slice(0,P.maximumMissingSignaturesPerAudit));assert.equal(result.missingSuccessfulNotificationsTotal,20);assert.equal(result.missingSuccessfulNotificationsOmitted,20-P.maximumMissingSignaturesPerAudit);
 const projected=event.result.missingSuccessfulNotifications.map(row=>({signature:row.signature,slot:row.slot,success:true,confirmationStatus:row.confirmationStatus,blockTime:row.blockTime}));assert.equal(result.missingSuccessfulNotificationsSha256,hash(projected));assert.equal(result.witnessOnly,true);assert.equal(result.sourceDeliveryCausality,'UNDETERMINED_NO_COMPLETE_RECEIPT_TRACE');assert.equal(result.complete,false);assert.equal(result.executedFlowCompletenessVerified,false);assert.equal(out.tradingAuthority,false);
 assert.deepEqual(event,before);assert.ok(!JSON.stringify(out).includes('SECRET'));assert.ok(!JSON.stringify(out).includes('SUCCESS_RAW_MUST_NOT_COPY'));assert.ok(Buffer.byteLength(JSON.stringify(record))<=P.maximumDetailRecordBytes);
 const revision=out.revision;f.writer.observe('native-candidate-window-audit',{...event,result:{...event.result,status:'verified'}});f.writer.observe('native-candidate-window-audit',{...event,result:{...event.result,status:'unavailable'}});f.writer.observe('native-candidate-window-audit',{...event,result:{...event.result,missingSuccessfulNotifications:[]}});await f.writer.flush();assert.equal(f.read().revision,revision,'successful, unavailable and failed-only audits are not additional retained success archives');
});

test('rolling recent audit witnesses deduplicate within retention and share unchanged transport and byte budgets',async t=>{
 const f=fixture(t);f.advance(80000);const first=auditWitness(f.at);f.writer.observe('native-candidate-window-audit',first);f.writer.observe('native-candidate-window-audit',first);f.writer.observe('native-candidate-window-audit',first);
 for(let n=1;n<10;n++){f.advance(10000);f.writer.observe('native-candidate-window-audit',auditWitness(f.at));}
 for(let n=0;n<30;n++)f.writer.observe('native-flow-protocol-refused',{at:f.at,connection:n,reason:'NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE',method:'PING'});
 await f.writer.flush();const out=f.read();assert.equal(out.auditSamples,P.maximumAuditSamples);assert.equal(out.counts.auditDuplicates,2);assert.equal(out.counts.auditSamplesOmitted,0);assert.equal(out.counts.auditSamplesEvicted,10-P.maximumAuditSamples);assert.equal(out.policy.auditRetention,'LATEST_UNIQUE_CURRENT_RUN_ARRIVAL_ORDER');assert.equal(out.records.length,P.maximumTransportSamples);assert.ok(out.records.length<=40);assert.equal(f.writer.usage().transportSamples,P.maximumTransportSamples-P.maximumAuditSamples);assert.ok(out.detailRecordBytes<=P.maximumDetailBytes);assert.ok(lstatSync(f.path).size<=P.maximumFileBytes);
 assert.deepEqual(out.records.filter((r:any)=>r.kind==='native-candidate-window-audit').map((r:any)=>r.eventAt),Array.from({length:8},(_,n)=>first.availableAt+(n+2)*10000));
 f.writer.observe('native-candidate-window-audit',first);await f.writer.flush();assert.equal(f.read().counts.auditDuplicates,2,'evicted keys do not grow into a lifetime exclusion set');assert.equal(f.read().counts.auditSamplesEvicted,3);assert.equal(f.read().records.at(-1).eventAt,first.availableAt,'arrival-order policy retains the unchanged original event clock');
});

test('already emitted router matches retain exact original clocks, generation and diagnostic-only flags',async t=>{
 const f=fixture(t);f.advance(80000);const original=auditWitness(f.at),source=ingressWitness(original),event={...original,notificationIngress:{...source,arbitraryUrl:'https://SECRET',rawLogs:['SUCCESS_RAW_MUST_NOT_COPY']}};
 f.writer.observe('native-candidate-window-audit',event);source.matches[0]!.receivedAt=0;await f.writer.flush();const out=f.read(),record=out.records[0],ingress=record.data.notificationIngress;
 assert.equal(ingress.kind,'NATIVE_MISSING_HISTORY_ROUTER_WITNESS');assert.deepEqual(ingress.target,original.result.target);assert.deepEqual(ingress.requestedGeneration,original.result.postSnapshotTail.generation);assert.equal(ingress.auditAvailableAt,original.result.availableAt);assert.equal(ingress.observedAt,event.availableAt);assert.equal(ingress.matches[0].receivedAt,original.result.target.startAt+100);assert.equal(ingress.matches[0].routedAt,original.result.availableAt-1);assert.equal(ingress.matches[0].disposition,'ACTIVE_PROCESSOR');assert.equal(ingress.matches[0].generationAtRoutingEqualsRequested,true);assert.equal(ingress.retainedRouterIntervalComplete,true);
 for(const key of ['wholeSocketReceiptTrace','missingTransactionRelevanceEstablished','providerLossProved','localLossProved','financialQualification'])assert.equal(ingress[key],false);assert.equal(ingress.originalAuditOutcomeUnchanged,true);assert.equal(record.data.result.status,'unusable');assert.equal(record.data.result.executedFlowCompletenessVerified,false);assert.ok(!JSON.stringify(out).includes('SECRET'));assert.ok(!JSON.stringify(out).includes('SUCCESS_RAW_MUST_NOT_COPY'));assert.ok(Buffer.byteLength(JSON.stringify(record))<=P.maximumDetailRecordBytes);
});

test('bounded router match omissions and hashes remain explicit inside the original per-record cap',async t=>{
 const f=fixture(t);f.advance(80000);const original=auditWitness(f.at,8),source=ingressWitness(original,16),before=structuredClone(source);f.writer.observe('native-candidate-window-audit',{...original,notificationIngress:source});await f.writer.flush();const record=f.read().records[0],ingress=record.data.notificationIngress;
 assert.ok(Buffer.byteLength(JSON.stringify(record))<=P.maximumDetailRecordBytes);assert.equal(record.data.result.missingSuccessfulNotifications.length,8);assert.equal(ingress.sourceMatchesSha256,hash(before.matches));assert.ok(ingress.recordBudgetMatchesOmitted>0);assert.equal(ingress.matchingRows,16);
 if(ingress.status==='SUMMARY_ONLY_RECORD_BUDGET'){assert.equal(ingress.matchingRowsOmitted,16);assert.match(ingress.sourceWitnessSha256,/^[a-f0-9]{64}$/);}else{assert.ok(ingress.matches.length<16);assert.equal(ingress.matchingRowsOmitted,16-ingress.matches.length);assert.equal(ingress.recordBudgetMatchesOmitted,16-ingress.matches.length);}
 assert.deepEqual(source,before);assert.equal(ingress.providerLossProved,false);assert.equal(record.data.result.complete,false);assert.equal(f.read().counts.auditSamplesOmitted,0);
});

test('malformed or overstated router diagnostics cannot erase a valid refusal or claim financial authority',async t=>{
 const f=fixture(t);f.advance(80000);
 for(const change of ['generation','target','clock','provider','scope','oversized','interval']){
  const original=auditWitness(f.at),source=ingressWitness(original);
  if(change==='generation')source.requestedGeneration!.pool='8'.repeat(44);
  if(change==='target')source.target.endAt++;
  if(change==='clock')source.observedAt=f.at+1;
  if(change==='provider')source.providerLossProved=true;
  if(change==='scope')source.matches[0]!.generationAtRoutingEqualsRequested=false;
  if(change==='oversized')source.matches=Array.from({length:17},()=>source.matches[0]!);
  if(change==='interval')source.retention.clockFaults=1;
  f.writer.observe('native-candidate-window-audit',{...original,notificationIngress:source});f.advance(10000);
 }
 await f.writer.flush();const out=f.read();assert.equal(out.auditSamples,7);assert.equal(out.counts.malformedSelectedEvents,0);for(const record of out.records){assert.equal(record.data.result.status,'unusable');assert.equal(record.data.notificationIngress.status,'UNAVAILABLE');assert.equal(record.data.notificationIngress.reason,'INGRESS_DIAGNOSTIC_SCHEMA_REFUSED');assert.equal(record.data.notificationIngress.financialQualification,false);}
});

test('recent audit evidence replaces old transport under shared capacity without increasing records or bytes',async t=>{
 const f=fixture(t);f.advance(80000);for(let n=0;n<P.maximumTransportSamples;n++)f.writer.observe('native-flow-protocol-refused',{at:f.at,connection:n,reason:'NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE',method:'PING'});
 for(let n=0;n<10;n++){f.writer.observe('native-candidate-window-audit',auditWitness(f.at));f.advance(10000);}await f.writer.flush();const out=f.read();assert.equal(out.auditSamples,8);assert.equal(f.writer.usage().transportSamples,16);assert.equal(out.counts.transportSamplesEvictedForAudit,8);assert.equal(out.counts.auditSamplesEvicted,2);assert.equal(out.counts.auditSamplesOmitted,0);assert.equal(out.records.length,24);assert.ok(out.detailRecordBytes<=P.maximumDetailBytes);assert.ok(lstatSync(f.path).size<=P.maximumFileBytes);
});

test('audit witness refuses mismatched generations and malformed interior rows instead of inventing a usable trace',async t=>{
 const f=fixture(t);f.advance(80000);
 for(const change of ['pool','slot','signature','time','incomplete']){const event=auditWitness(f.at);
  if(change==='pool')event.result.postSnapshotTail.generation.pool='8'.repeat(44);
  if(change==='slot')event.result.missingSuccessfulNotifications[0]!.slot=event.result.strictInteriorSlots.lower;
  if(change==='signature')event.result.missingSuccessfulNotifications[0]!.signature='https://SECRET';
  if(change==='time')event.result.availableAt=event.availableAt+1;
  if(change==='incomplete')event.result.historyRangeCovered=false;
  assert.doesNotThrow(()=>f.writer.observe('native-candidate-window-audit',event));
 }
 await f.writer.flush();const out=f.read();assert.equal(out.auditSamples,0);assert.deepEqual(out.records,[]);assert.equal(out.counts.malformedSelectedEvents,5);assert.equal(f.writer.usage().available,true);
});
