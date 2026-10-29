import {constants,openSync,readSync,closeSync} from 'node:fs';
import {NATIVE_TWO_HOUR_90_RESEARCH_PROFILE} from './native-research-profile.js';
/** Operating controls for the existing isolated PAPER writer. These are rolling
 * pressure signals, not provider entitlements or lifetime research allowances. */
export const PAPER_SERVICE_POLICY=Object.freeze({
 version:'native-paper-persistent-service-resource-v2',cpuWindowMs:60000,minimumCpuWindowMs:10000,
 sampleMs:1000,maximumSamples:64,cpuUtilizationAdmissionEnforced:false,cpuBusyFraction:null,cpuResumeFraction:null,
 resumeStableMs:30000,candidateRssBytes:1536*1024*1024,resumeRssBytes:1408*1024*1024,
 minimumDiskBytes:256*1024*1024,resumeDiskBytes:512*1024*1024,
 minimumHostAvailableMemoryBytes:768*1024*1024,resumeHostAvailableMemoryBytes:1024*1024*1024,
 diagnosticMaximumBytes:4*1024*1024*1024,diagnosticCapacityDiskFraction:1/32,diagnosticWorkingReserveSegments:3,
 rpcProfile:NATIVE_TWO_HOUR_90_RESEARCH_PROFILE.version,rpcStartsPerMinute:90,
 supervisionFreshnessMs:90000,sourceRetryMinimumMs:2000,sourceRetryMaximumMs:60000,
 lifetimeCpuCap:null,lifetimeDurationCap:null,lifetimeRequestCap:null,lifetimeEvidenceCap:null,
 meaning:'CPU and rolling stream bytes are telemetry, not admission ceilings. Actual resident-memory, host-memory, disk, queue, information and protection deadlines remain enforced; owned financial management continues.'
});
const valid=(value:number)=>Number.isSafeInteger(value)&&value>=0;
type Sample={at:number;mono:number;cpu:number;rss:number;disk:number;availableMemory?:number|null};
/** Kernel MemAvailable is a host measurement, never RSS-derived or invented. */
export function parseHostMemoryAvailable(raw:string):number|null{
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)return null;
 const rows=[...raw.matchAll(/^MemAvailable:\s+(\d+) kB\s*$/gm)];if(rows.length!==1)return null;
 const bytes=Number(rows[0]![1])*1024;return valid(bytes)?bytes:null;
}
/** One bounded local /proc read per resource sample; no provider or credentials. */
export function readHostMemoryAvailable():number|null{
 let fd:number|undefined;
 try{fd=openSync('/proc/meminfo',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const raw=Buffer.alloc(65537),n=readSync(fd,raw,0,raw.length,0);return n<=65536?parseHostMemoryAvailable(raw.subarray(0,n).toString('utf8')):null;}catch{return null;}finally{if(fd!==undefined)try{closeSync(fd);}catch{}}
}
export class PaperServiceResources{
 private samples:Sample[]=[];private blocked:string[]=[];private clearSince:number|null=null;
 private last:Sample|null=null;private cpuFraction:number|null=null;
 sample(input:Sample){
  const {availableMemory,...required}=input;if(!Object.values(required).every(valid)||availableMemory!==undefined&&availableMemory!==null&&!valid(availableMemory))throw Error('PAPER_SERVICE_RESOURCE_SAMPLE');
  const last=this.last;
  if(last&&(input.mono<last.mono||input.cpu<last.cpu))throw Error('PAPER_SERVICE_RESOURCE_REGRESSION');
  if(last&&input.mono-last.mono<PAPER_SERVICE_POLICY.sampleMs)return this.view();
  this.last={...input,availableMemory:availableMemory??null};this.samples.push({...this.last});
  this.samples=this.samples.filter(s=>input.mono-s.mono<=PAPER_SERVICE_POLICY.cpuWindowMs).slice(-PAPER_SERVICE_POLICY.maximumSamples);
  const first=this.samples[0]!,elapsed=input.mono-first.mono;
  this.cpuFraction=elapsed>=PAPER_SERVICE_POLICY.minimumCpuWindowMs?(input.cpu-first.cpu)/(elapsed*1000):null;
  const hostPressure=availableMemory===null||availableMemory===undefined?this.blocked.includes('host-memory-pressure'):availableMemory<PAPER_SERVICE_POLICY.minimumHostAvailableMemoryBytes;
  const reasons=[...(input.rss>PAPER_SERVICE_POLICY.candidateRssBytes?['resident-memory-pressure']:[]),...(hostPressure?['host-memory-pressure']:[]),...(input.disk<PAPER_SERVICE_POLICY.minimumDiskBytes?['disk-headroom-pressure']:[])];
  if(reasons.length){this.blocked=[...new Set([...this.blocked,...reasons])];this.clearSince=null;}
  else if(this.blocked.length){
   const hostClear=availableMemory===null||availableMemory===undefined?!this.blocked.includes('host-memory-pressure'):availableMemory>=PAPER_SERVICE_POLICY.resumeHostAvailableMemoryBytes;
   const clear=input.rss<=PAPER_SERVICE_POLICY.resumeRssBytes&&input.disk>=PAPER_SERVICE_POLICY.resumeDiskBytes&&hostClear;
   if(!clear)this.clearSince=null;else if(this.clearSince===null)this.clearSince=input.mono;
   else if(input.mono-this.clearSince>=PAPER_SERVICE_POLICY.resumeStableMs){this.blocked=[];this.clearSince=null;}
  }
  return this.view();
 }
 view(){return {version:PAPER_SERVICE_POLICY.version,observedAt:this.last?.at??null,monotonicObservedAt:this.last?.mono??null,rollingCpuFraction:this.cpuFraction,rollingWindowMs:this.samples.length>1?this.samples.at(-1)!.mono-this.samples[0]!.mono:0,samples:this.samples.length,residentBytes:this.last?.rss??null,availableMemoryBytes:this.last?.availableMemory??null,availableDiskBytes:this.last?.disk??null,candidateAdmissionAllowed:this.last!==null&&this.blocked.length===0,newRiskAllowed:this.last!==null&&this.blocked.length===0,reasons:[...this.blocked],recoveryStableSinceMonotonic:this.clearSince,lifetimeCapReached:false,cpuUtilizationAdmissionEnforced:false,ownedFinancialManagementContinues:true};}
}
export type PaperServiceAdmission={schemaVersion:1;owner:'poe-runtime-service-supervisor';accountId:string;inceptionAt:number;source:{commit:string;sha256:string};runId:string|null;generatedAt:number;suspended:boolean;reason:string};
export function paperServiceSupervision(value:unknown,input:{at:number;accountId:string;inceptionAt:number;source:{commit:string;sha256:string};runId:string}){
 const v=value as Partial<PaperServiceAdmission>|null;
 const validIdentity=!!v&&v.schemaVersion===1&&v.owner==='poe-runtime-service-supervisor'&&v.accountId===input.accountId&&v.inceptionAt===input.inceptionAt&&v.source?.commit===input.source.commit&&v.source.sha256===input.source.sha256&&(v.runId===null||v.runId===input.runId)&&typeof v.generatedAt==='number'&&valid(v.generatedAt)&&v.generatedAt<=input.at&&input.at-v.generatedAt<=PAPER_SERVICE_POLICY.supervisionFreshnessMs&&typeof v.suspended==='boolean'&&typeof v.reason==='string'&&v.reason.length<=200;
 return {newRiskAllowed:validIdentity&&v!.runId===input.runId&&v!.suspended===false,reason:!validIdentity?'service-supervision-unavailable-or-stale':v!.runId===null?'service-supervision-startup':v!.reason,supervisionAt:validIdentity?v!.generatedAt!:null,ownedFinancialManagementContinues:true,candidateCaptureContinues:true};
}
