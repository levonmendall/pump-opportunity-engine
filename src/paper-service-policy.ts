/** Operating controls for the existing isolated PAPER writer. These are rolling
 * pressure signals, not provider entitlements or lifetime research allowances. */
export const PAPER_SERVICE_POLICY=Object.freeze({
 version:'native-paper-persistent-service-v1',cpuWindowMs:60000,minimumCpuWindowMs:10000,
 sampleMs:1000,maximumSamples:64,cpuBusyFraction:.5,cpuResumeFraction:.35,
 resumeStableMs:30000,candidateRssBytes:384*1024*1024,resumeRssBytes:368*1024*1024,
 minimumDiskBytes:256*1024*1024,resumeDiskBytes:512*1024*1024,
 supervisionFreshnessMs:90000,sourceRetryMinimumMs:2000,sourceRetryMaximumMs:60000,
 lifetimeCpuCap:null,lifetimeDurationCap:null,lifetimeRequestCap:null,lifetimeEvidenceCap:null,
 meaning:'Measured rolling pressure suspends candidate admission and new risk; owned financial management continues. Recovery requires fresh data and stable headroom.'
});
const valid=(value:number)=>Number.isSafeInteger(value)&&value>=0;
type Sample={at:number;mono:number;cpu:number;rss:number;disk:number};
export class PaperServiceResources{
 private samples:Sample[]=[];private blocked:string[]=[];private clearSince:number|null=null;
 private last:Sample|null=null;private cpuFraction:number|null=null;
 sample(input:Sample){
  if(!Object.values(input).every(valid))throw Error('PAPER_SERVICE_RESOURCE_SAMPLE');
  const last=this.last;
  if(last&&(input.mono<last.mono||input.cpu<last.cpu))throw Error('PAPER_SERVICE_RESOURCE_REGRESSION');
  if(last&&input.mono-last.mono<PAPER_SERVICE_POLICY.sampleMs)return this.view();
  this.last={...input};this.samples.push({...input});
  this.samples=this.samples.filter(s=>input.mono-s.mono<=PAPER_SERVICE_POLICY.cpuWindowMs).slice(-PAPER_SERVICE_POLICY.maximumSamples);
  const first=this.samples[0]!,elapsed=input.mono-first.mono;
  this.cpuFraction=elapsed>=PAPER_SERVICE_POLICY.minimumCpuWindowMs?(input.cpu-first.cpu)/(elapsed*1000):null;
  const reasons=[...(this.cpuFraction!==null&&this.cpuFraction>PAPER_SERVICE_POLICY.cpuBusyFraction?['rolling-cpu-pressure']:[]),...(input.rss>PAPER_SERVICE_POLICY.candidateRssBytes?['resident-memory-pressure']:[]),...(input.disk<PAPER_SERVICE_POLICY.minimumDiskBytes?['disk-headroom-pressure']:[])];
  if(reasons.length){this.blocked=reasons;this.clearSince=null;}
  else if(this.blocked.length){
   const clear=this.cpuFraction!==null&&this.cpuFraction<=PAPER_SERVICE_POLICY.cpuResumeFraction&&input.rss<=PAPER_SERVICE_POLICY.resumeRssBytes&&input.disk>=PAPER_SERVICE_POLICY.resumeDiskBytes;
   if(!clear)this.clearSince=null;else if(this.clearSince===null)this.clearSince=input.mono;
   else if(input.mono-this.clearSince>=PAPER_SERVICE_POLICY.resumeStableMs){this.blocked=[];this.clearSince=null;}
  }
  return this.view();
 }
 view(){return {version:PAPER_SERVICE_POLICY.version,observedAt:this.last?.at??null,monotonicObservedAt:this.last?.mono??null,rollingCpuFraction:this.cpuFraction,rollingWindowMs:this.samples.length>1?this.samples.at(-1)!.mono-this.samples[0]!.mono:0,samples:this.samples.length,residentBytes:this.last?.rss??null,availableDiskBytes:this.last?.disk??null,candidateAdmissionAllowed:this.last!==null&&this.blocked.length===0,newRiskAllowed:this.last!==null&&this.blocked.length===0,reasons:[...this.blocked],recoveryStableSinceMonotonic:this.clearSince,lifetimeCapReached:false,ownedFinancialManagementContinues:true};}
}
export type PaperServiceAdmission={schemaVersion:1;owner:'poe-runtime-service-supervisor';accountId:string;inceptionAt:number;source:{commit:string;sha256:string};runId:string|null;generatedAt:number;suspended:boolean;reason:string};
export function paperServiceSupervision(value:unknown,input:{at:number;accountId:string;inceptionAt:number;source:{commit:string;sha256:string};runId:string}){
 const v=value as Partial<PaperServiceAdmission>|null;
 const validIdentity=!!v&&v.schemaVersion===1&&v.owner==='poe-runtime-service-supervisor'&&v.accountId===input.accountId&&v.inceptionAt===input.inceptionAt&&v.source?.commit===input.source.commit&&v.source.sha256===input.source.sha256&&(v.runId===null||v.runId===input.runId)&&typeof v.generatedAt==='number'&&valid(v.generatedAt)&&v.generatedAt<=input.at&&input.at-v.generatedAt<=PAPER_SERVICE_POLICY.supervisionFreshnessMs&&typeof v.suspended==='boolean'&&typeof v.reason==='string'&&v.reason.length<=200;
 return {newRiskAllowed:validIdentity&&v!.runId===input.runId&&v!.suspended===false,reason:!validIdentity?'service-supervision-unavailable-or-stale':v!.runId===null?'service-supervision-startup':v!.reason,supervisionAt:validIdentity?v!.generatedAt!:null,ownedFinancialManagementContinues:true,candidateCaptureContinues:true};
}
