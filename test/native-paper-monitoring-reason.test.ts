/** OFFLINE inspection of the actual launcher predicate; no financial writes. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {NativePaperReportingHealth,nativePaperFinancialProviderAvailable,runNativePaper} from '../src/run-native-paper.js';

function fixture(){
 const holder:any={},state={positions:{}},rpc={closed:false,fatal:null as string|null,cooldownUntil:0},reportingHealth=new NativePaperReportingHealth();reportingHealth.observe(10,true);
 const flags={intake:true,nativeFatal:false,protectionOverdue:false,resource:true,evidenceCapacity:true,supervision:true,bounded:true,blocks:1024,diskBlockBytes:1024*1024};
 const markers=new Set<string>();let supervisionCalls=0;
 const context:any={__name:(value:unknown)=>value,holder,reportingHealth,currentLedger:{state:()=>state},currentRpc:{usage:()=>rpc},
  marketIntake:{available:()=>flags.intake},managementOnly:false,manualPaused:false,safeStopRequested:false,
  existsSync:(path:string)=>markers.has(path),join:(a:string,b:string)=>a+'/'+b,root:'/OFFLINE',admissionPausePath:'/OFFLINE/admission',stopped:false,sourceClosed:false,
  currentNative:{usage:()=>({fatal:flags.nativeFatal?'OFFLINE_FAILURE':null})},nativePaperFinancialProviderAvailable,service:true,financialProjectionReady:true,
  pilotOpenProtectionGaps:()=>[{overdue:flags.protectionOverdue}],completed:new Map(),startedAt:1,
  serviceResources:{view:()=>({newRiskAllowed:flags.resource})},serviceEvidenceHealthy:true,serviceRecorder:{usage:()=>({candidateAdmissionAllowed:flags.evidenceCapacity})},backupReady:true,
  serviceSupervision:()=>{supervisionCalls++;return {newRiskAllowed:flags.supervision};},nativePaperProcessingAdmission:()=>({entryAllowed:flags.bounded}),
  process:{cpuUsage:()=>({user:0,system:0}),memoryUsage:()=>({rss:1})},cpu:{user:0,system:0},eventBytes:0,
  statfsSync:()=>({bavail:flags.blocks,bsize:flags.diskBlockBytes}),MIB:1024*1024,
 };
 const source=runNativePaper.toString(),begin=source.search(/const\s+financialCapacityReason\s*=/),rest=source.slice(begin),end=rest.search(/;\s*bridge\s*=\s*new NativePaper/);
 assert.ok(begin>=0&&end>0,'actual capacity predicate and wrapper are identified');
 runInNewContext(rest.slice(0,end)+';holder.reason=financialCapacityReason;holder.allowed=financialCapacity;holder.entryReason=entryCapacityReason;',context,{timeout:1000});
 return {flags,context,markers,rpc,state,reportingHealth,reason:holder.reason as (at:number,requireProjection?:boolean)=>string|null,allowed:holder.allowed as (at:number,requireProjection?:boolean)=>boolean,entryReason:holder.entryReason as (at:number,requireProjection?:boolean)=>string|null,get supervisionCalls(){return supervisionCalls;}};
}

const cases:Array<[string,(f:ReturnType<typeof fixture>)=>void]>=[
 ['FINANCIAL_PUBLICATION_UNAVAILABLE',f=>f.reportingHealth.observe(10,false)],
 ['MANAGEMENT_ONLY',f=>{f.context.managementOnly=true;}],
 ['OWNER_PAUSE',f=>{f.context.manualPaused=true;}],
 ['OWNER_STOP',f=>{f.context.safeStopRequested=true;}],
 ['STOP_REQUEST',f=>{f.markers.add('/OFFLINE/stop.request');}],
 ['ADMISSION_SUSPENSION',f=>{f.markers.add('/OFFLINE/admission');}],
 ['RUNTIME_STOPPED',f=>{f.context.stopped=true;}],
 ['SOURCE_CLOSED',f=>{f.context.sourceClosed=true;}],
 ['NATIVE_SOURCE_FATAL',f=>{f.flags.nativeFatal=true;}],
 ['PROVIDER_RESTRICTION',f=>{f.rpc.cooldownUntil=2000;}],
 ['FINANCIAL_PROJECTION_UNAVAILABLE',f=>{f.context.financialProjectionReady=false;}],
 ['HELD_PROTECTION_OVERDUE',f=>{f.flags.protectionOverdue=true;}],
 ['RESOURCE_PRESSURE',f=>{f.flags.resource=false;}],
 ['EVIDENCE_UNAVAILABLE',f=>{f.context.serviceEvidenceHealthy=false;}],
 ['CANDIDATE_EVIDENCE_UNAVAILABLE',f=>{f.flags.evidenceCapacity=false;}],
 ['BACKUP_UNAVAILABLE',f=>{f.context.backupReady=false;}],
 ['SERVICE_SUPERVISION_UNAVAILABLE',f=>{f.flags.supervision=false;}],
 ['DISK_RESERVE',f=>{f.flags.blocks=127;}],
];
for(const [reason,close]of cases)test(`monitoring diagnosis names ${reason} while preserving the refusal`,()=>{
 const f=fixture(),before=structuredClone(f.state);assert.equal(f.allowed(1000),true);close(f);assert.equal(f.reason(1000),reason);assert.equal(f.allowed(1000),false);assert.deepEqual(f.state,before);
});

test('diagnostic reasons preserve existing short-circuit ordering and independent projection readiness',()=>{
 const f=fixture();f.context.financialProjectionReady=false;assert.equal(f.reason(1000),'FINANCIAL_PROJECTION_UNAVAILABLE');assert.equal(f.reason(1000,false),null,'an in-progress projection is not lost previously completed reporting readiness');
 f.flags.supervision=false;f.context.backupReady=false;const before=f.supervisionCalls;assert.equal(f.reason(1000,false),'BACKUP_UNAVAILABLE');assert.equal(f.supervisionCalls,before,'later supervision read is still skipped');
 f.reportingHealth.observe(10,false);assert.equal(f.reason(1000,false),'FINANCIAL_PUBLICATION_UNAVAILABLE');assert.equal(f.supervisionCalls,before);
});

test('completed slow publications remain valid while invalid measurements and disk headroom remain blocking',()=>{
 const f=fixture();f.reportingHealth.observe(1813.7,true);assert.equal(f.reason(1000),null,'the unchanged 250ms reporting target is not a financial rejection predicate');
 f.reportingHealth.observe(NaN,true);assert.equal(f.reason(1000),'FINANCIAL_PUBLICATION_UNAVAILABLE');f.reportingHealth.observe(10,true);
 f.flags.blocks=NaN;assert.equal(f.reason(1000),'DISK_RESERVE','unknown headroom cannot be converted into permission');
});

test('bounded nonservice admission retains its original processing guard',()=>{
 const f=fixture();f.context.service=false;f.flags.bounded=false;assert.equal(f.reason(1000),'BOUNDED_PROCESSING_RESERVE');assert.equal(f.allowed(1000),false);
 f.flags.bounded=true;assert.equal(f.allowed(1000),true);
});

test('unavailable discovery intake closes candidate entries while healthy financial recovery remains admitted',()=>{
 const f=fixture(),before=structuredClone(f.state);f.flags.intake=false;assert.equal(f.entryReason(1000),'MARKET_INTAKE_UNAVAILABLE');assert.equal(f.reason(1000),null);assert.equal(f.allowed(1000),true);assert.deepEqual(f.state,before);
});
