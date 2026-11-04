/** OFFLINE: actual launcher financial gate, proof helper and backup completion
 * closures. Synthetic artifact receipt only; no ledger writer, disk or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {NativePaperProofPreparation,NativePaperReportingHealth,nativePaperFinancialProviderAvailable,nativePaperCurrentQualificationProof,nativePaperBackupFailureDisposition,runNativePaper} from '../src/run-native-paper.js';
import {backupFailureDiagnostic} from '../src/backup.js';
import type {NativeAuditCertificate} from '../src/native-candidate-runner.js';
import type {NativeQualificationProof} from '../src/native-paper.js';

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
 let at=65_000,pins=0,backupCopies=0,qualificationReads=0;
 const state={accountId:'OFFLINE',mode:'PAPER',inceptionAt:1,positions:{},pending:{}};
 const certificate={schemaVersion:1,mint:'OFFLINE_MINT',pool:'OFFLINE_POOL',dataContract:'OFFLINE',openedAt:1,connectionId:1,subscriptionId:2,windowStartAt:0,windowEndAt:60_000,auditAvailableAt:at,admittedAt:at,deadlineAt:69_999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)} as unknown as NativeAuditCertificate;
 const proof:NativeQualificationProof={proofId:'OFFLINE:original-proof',mint:certificate.mint,startAt:0,throughAt:at,windowEndAt:certificate.windowEndAt,featuresSha256:certificate.featuresSha256,certificateAt:certificate.admittedAt,deadlineAt:certificate.deadlineAt};
 const events:any[]=[],holder:any={},health=new NativePaperReportingHealth();health.observe(1,true);
 const cache=new NativePaperProofPreparation(()=>at),rpc={closed:false,fatal:null as string|null,cooldownUntil:0};
 const context:any={__name:(v:unknown)=>v,holder,Date:{now:()=>at},service:true,stopped:false,backupReady:false,backupTask:null,nextBackupAttemptAt:0,lastBackup:0,
  reportingHealth:health,currentLedger:{state:()=>state},currentRpc:{usage:()=>rpc},marketIntake:null,managementOnly:false,manualPaused:false,safeStopRequested:false,
  existsSync:()=>false,join:(a:string,b:string)=>a+'/'+b,root:'/OFFLINE',admissionPausePath:'/OFFLINE/admission',sourceClosed:false,
  currentNative:{usage:()=>({fatal:null})},nativePaperFinancialProviderAvailable,financialProjectionReady:true,pilotOpenProtectionGaps:()=>[],completed:new Map(),startedAt:1,
  serviceResources:{view:()=>({newRiskAllowed:true})},serviceEvidenceHealthy:true,serviceSupervision:()=>({newRiskAllowed:true}),
  statfsSync:()=>({bavail:1024,bsize:1024*1024}),MIB:1024*1024,
  sourceInformationAdmission:()=>true,engine:{currentAuditCertificate:()=>at<=certificate.deadlineAt?certificate:null},proofPreparation:cache,
  nativePaperCurrentQualificationProof:(owner:any,mint:string)=>nativePaperCurrentQualificationProof(owner,mint,()=>at),
  currentBridge:{qualificationProof:()=>{qualificationReads++;return proof;},trader:{pauseNewEntries:()=>assert.fail('successful offline backup must not pause entries')}},
  serviceRecorder:{usage:()=>({candidateAdmissionAllowed:true}),pinProvisionalRange:async(id:string,start:number,through:number,deadline:number)=>{pins++;events.push({kind:'pin',id,start,through,deadline,at});return {complete:true,proofId:id,manifestSha256:'b'.repeat(64),bytes:1234};}},
  need:(condition:unknown,reason:string)=>{if(!condition)throw Error(reason);},hash:(v:string)=>v,record:(kind:string,data:any)=>events.push({kind,data}),
  backup:{maintainPending:async()=>null,create:async(_source:unknown,runtime:any)=>{assert.equal(runtime.admission(),true);backupCopies++;return {accountId:'OFFLINE',mode:'PAPER',inceptionAt:1,revision:1,lastAt:at,generation:'00000000000000000001',snapshotSequence:'1'};}},
  localAdmission:()=>true,localPhase:(_kind:string,_bound:number,work:()=>unknown)=>work(),nativePaperBackupFailureDisposition,backupFailureDiagnostic,
 };
 const source=runNativePaper.toString(),gateAt=source.indexOf('const financialCapacityReason='),gateEnd=source.indexOf('const entryCapacityReason=',gateAt),proofAt=source.indexOf('const prepareQualificationProof='),proofEnd=source.indexOf('const makeEngine=',proofAt),backupAt=source.indexOf('const startBackup='),backupEnd=source.indexOf('const report=',backupAt);
 assert.ok(gateAt>0&&gateEnd>gateAt&&proofAt>0&&proofEnd>proofAt&&backupAt>0&&backupEnd>backupAt,'use the three actual production closures');
 runInNewContext(source.slice(gateAt,gateEnd)+source.slice(proofAt,proofEnd)+source.slice(backupAt,backupEnd)+';holder.reason=financialCapacityReason;holder.prepare=prepareQualificationProof;holder.backup=startBackup;holder.task=()=>backupTask;',context,{timeout:1000});
 return {certificate,proof,state,cache,events,context,rpc,reason:()=>holder.reason(at),prepare:(eager=false)=>holder.prepare(certificate,eager)as boolean,async backup(){holder.backup();await holder.task();},get pins(){return pins;},get backupCopies(){return backupCopies;},get qualificationReads(){return qualificationReads;},get at(){return at;},set at(value:number){at=value;}};
}

test('closed current financial readiness refuses new eager and ranked proof work before qualification or retention',async()=>{
 const f=fixture(),before=structuredClone({certificate:f.certificate,proof:f.proof,state:f.state});
 assert.equal(f.reason(),'BACKUP_UNAVAILABLE');assert.equal(f.prepare(true),false);assert.equal(f.prepare(),false);await turn();
 assert.equal(f.qualificationReads,0);assert.equal(f.pins,0);assert.equal(f.cache.usage(),null);assert.deepEqual({certificate:f.certificate,proof:f.proof,state:f.state},before);
});

test('actual backup success remains independent of proof preparation and resumes the original unexpired certificate',async()=>{
 const f=fixture(),before=structuredClone({certificate:f.certificate,proof:f.proof,state:f.state});assert.equal(f.prepare(),false);
 await f.backup();assert.equal(f.backupCopies,1);assert.equal(f.reason(),null);assert.equal(f.context.lastBackup,65_000);assert.equal(f.pins,0,'the backup completion path never depends on a candidate proof');
 f.at=66_000;assert.equal(f.prepare(),false);assert.equal(f.cache.usage()?.state,'pending');await turn();assert.equal(f.pins,1);assert.equal(f.cache.ready(f.proof),true);
 const receipt=f.events.find(row=>row.kind==='pin');assert.equal(receipt.deadline,69_999);assert.equal(receipt.through,65_000);assert.deepEqual({certificate:f.certificate,proof:f.proof,state:f.state},before);
 f.at=70_000;assert.equal(f.prepare(),false);assert.equal(f.cache.ready(f.proof),false);assert.equal(f.pins,1,'backup readiness cannot extend an original expired certificate');
});

test('a later readiness closure neither evicts nor re-pins an already valid immutable proof',async()=>{
 const f=fixture();await f.backup();f.prepare();await turn();const retained=f.cache.usage(f.proof);
 f.context.backupReady=false;assert.equal(f.prepare(),false);assert.deepEqual(f.cache.usage(f.proof),retained);assert.equal(f.cache.ready(f.proof),true);
 f.context.backupReady=true;assert.equal(f.prepare(),true);await turn();assert.equal(f.pins,1);assert.deepEqual(f.cache.usage(f.proof),retained);
});

test('real provider restriction still refuses new proof work independently of a completed backup',async()=>{
 const f=fixture();await f.backup();f.rpc.cooldownUntil=66_000;assert.equal(f.reason(),'PROVIDER_RESTRICTION');assert.equal(f.prepare(),false);await turn();assert.equal(f.pins,0);
 f.rpc.cooldownUntil=0;assert.equal(f.prepare(),false);assert.equal(f.cache.usage()?.state,'pending');await turn();assert.equal(f.pins,1);
});

test('a readiness closure after accepting a pin leaves its owned task intact without a synthetic terminal failure',async()=>{
 const f=fixture();await f.backup();assert.equal(f.prepare(),false);const pending=f.cache.usage(f.proof);assert.equal(pending?.state,'pending');
 f.context.backupReady=false;assert.equal(f.prepare(),false);assert.deepEqual(f.cache.usage(f.proof),pending);
 await turn();assert.equal(f.pins,1);assert.equal(f.cache.usage(f.proof)?.state,'complete');assert.equal(f.cache.usage(f.proof)?.error,null);assert.equal(f.cache.ready(f.proof),true);assert.equal(f.reason(),'BACKUP_UNAVAILABLE','retention completion grants no financial permission');
});
