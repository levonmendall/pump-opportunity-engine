import {REQUEST_TIMING_VERSION,REQUEST_TIMING_METHODS,REQUEST_ADMISSION_REASONS,REQUEST_TIMING_STAGES} from './financial-handoff-reporting.js';
/** Diagnostic ownership of currently usable audit certificates only. This
 * never authorizes a financial action or extends an evidence deadline. */
export const NATIVE_FINANCIAL_HANDOFF_VERSION='native-financial-handoff-v1' as const;
export const HANDOFF_REASONS=['await-financial-dispatch','financial-or-source-admission','proof-retention','required-service-or-protection-runway','await-earlier-candidate'] as const;
export type HandoffReason=typeof HANDOFF_REASONS[number];
export type HandoffCertificate={mint:string;windowEndAt:number;deadlineAt:number;admittedAt:number;openedAt:number;featuresSha256:string};
type Active=HandoffCertificate&{key:string;firstSeenAt:number;state:'waiting'|'dispatched';reason:HandoffReason};
const identity=(c:HandoffCertificate)=>[c.mint,c.windowEndAt,c.openedAt,c.featuresSha256].join(':');
const uint=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const rec=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const numeric=(v:unknown,signed=false)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER&&(signed||v>=0)?v:null;
const choice=(v:unknown,choices:readonly string[])=>typeof v==='string'&&choices.includes(v)?v:null;
const timingDeadlineKeys=['bindingDeadlineAt','certificateDeadlineAt','nativeServiceDeadlineAt','protectionLatestStartAt','callerLatestStartAt'] as const;
type TimingSummary={count:number;sumMs:number;maxMs:number};
const summary=():TimingSummary=>({count:0,sumMs:0,maxMs:0});
const add=(s:TimingSummary,v:number|null)=>{if(v!==null){s.count++;s.sumMs+=v;s.maxMs=Math.max(s.maxMs,v);}};
export class NativeFinancialHandoff {
 private active=new Map<string,Active>();
 private at:number;
 private seen=0;private dispatched=0;private financialEvaluations=0;
 private expiredBeforeDispatch=0;private invalidatedBeforeDispatch=0;
 private blockedMsByReason=Object.fromEntries(HANDOFF_REASONS.map(r=>[r,0])) as Record<HandoffReason,number>;
 private deferralTransitionsByReason=Object.fromEntries(HANDOFF_REASONS.map(r=>[r,0])) as Record<HandoffReason,number>;
 private waits={count:0,sum:0,max:0,bins:new Array<number>(101).fill(0)};
 private timingCounts={gateRefusals:0,componentRefusals:0,physicalStarts:0,physicalSettlements:0,completeResponses:0,unmatchedSettlements:0};
 private timingRefusals:Record<string,unknown>[]=[];
 private timingPlans=new Map<string,Record<string,any>>();
 private physicalTiming=new Map<string,{at:number;method:string|null;transport:string|null}>();
 private methodTiming=new Map<string,{method:string;transport:string;starts:number;settled:number;responses:number;queue:TimingSummary;pacing:TimingSummary;physical:TimingSummary}>();
 constructor(readonly runId:string,readonly startedAt:number,private maximumActive:number,private record:(kind:string,value:unknown)=>void=()=>{}){this.at=startedAt;}
 /** In-memory diagnostics only. Never emits through record(), changes trading
  * state or confuses a local refusal with a physically settled request. */
 observeTiming(kind:string,value:unknown){
  if(!['native-paper-request-plan','native-paper-request-admission-refused','component-local-admission-refused','component-physical-start','component-physical-settled'].includes(kind))return;
  const d=rec(value),at=numeric(d.at);if(at===null||!uint(at)||at<this.startedAt)return;
  const requestId=typeof(d.callerRequestId??d.requestId)==='string'&&String(d.callerRequestId??d.requestId).startsWith(this.runId+':request:')&&/^\d+$/.test(String(d.callerRequestId??d.requestId).slice((this.runId+':request:').length))?String(d.callerRequestId??d.requestId):null;
  const prior=requestId?this.timingPlans.get(requestId):undefined,context=prior&&prior.contextAt<=at?prior:undefined,method=choice(d.method??rec(d.kind).method??context?.method,REQUEST_TIMING_METHODS),transport=choice(rec(d.kind).transport,['http','ws-upgrade','ws']);
  if(kind==='native-paper-request-plan'||kind==='native-paper-request-admission-refused'){
   const row={...(context??{}),contextAt:at,requestId,requestedAt:numeric(d.requestedAt??context?.requestedAt??d.at),mint:typeof d.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(d.mint)?d.mint:context?.mint??null,owner:choice(d.owner,['idle','candidate','source','protection','pending']),method,reason:choice(d.reason,REQUEST_ADMISSION_REASONS)??(kind==='native-paper-request-admission-refused'?'OTHER_UNEXPORTED_REASON':null),...Object.fromEntries(timingDeadlineKeys.map(k=>[k,numeric(d[k]??context?.[k])])),requestedOperationMs:numeric(d.requestedOperationMs??d.operationBoundMs??context?.requestedOperationMs),remainingCertificateMs:numeric(d.remainingCertificateMs,true)};
   if(requestId){this.timingPlans.delete(requestId);this.timingPlans.set(requestId,row);while(this.timingPlans.size>64)this.timingPlans.delete(this.timingPlans.keys().next().value!);}
   if(kind==='native-paper-request-plan')return;
   this.timingCounts.gateRefusals++;const {contextAt,...shown}=row;this.addTimingRefusal({origin:'gate',at,...shown,transportStarted:false,physicalSettlementClaimed:false});return;
  }
  if(kind==='component-local-admission-refused'){
   this.timingCounts.componentRefusals++;this.addTimingRefusal({origin:'component',at,requestId,method,transport,code:choice(d.code,['COMPONENT_ADMISSION_CLOSED','COMPONENT_DISPATCH_EXPIRED']),stage:choice(d.stage,REQUEST_TIMING_STAGES),enqueuedAt:numeric(d.enqueuedAt),latestStartAt:numeric(d.latestStartAt),remainingStartMs:numeric(d.remainingStartMs,true),requestedOperationMs:numeric(d.requestedOperationMs),physicalTimeoutMs:numeric(d.physicalTimeoutMs),queueElapsedMs:numeric(d.queueElapsedMs),pacingWaitMs:numeric(d.pacingWaitMs),plannedPacingWaitMs:numeric(d.plannedPacingWaitMs),reservationId:numeric(d.reservationId),mint:context?.mint??null,owner:context?.owner??null,reason:context?.reason??null,...Object.fromEntries(timingDeadlineKeys.map(k=>[k,context?.[k]??null])),remainingCertificateMs:context?.certificateDeadlineAt===null||context?.certificateDeadlineAt===undefined?null:context.certificateDeadlineAt-at,transportStarted:false,physicalSettlementClaimed:false});return;
  }
  if(kind==='component-physical-settled'&&(d.transportStarted!==true||d.physicalSettlementObserved!==true))return;
  const physicalKey=uint(d.id)?String(d.id)+':'+String(transport)+':'+String(method):null;
  const key=method&&transport?transport+':'+method:null;
  let stats=key?this.methodTiming.get(key):undefined;if(key&&!stats){stats={method:method!,transport:transport!,starts:0,settled:0,responses:0,queue:summary(),pacing:summary(),physical:summary()};this.methodTiming.set(key,stats);}
  if(kind==='component-physical-start'){
   this.timingCounts.physicalStarts++;if(stats){stats.starts++;const queued=numeric(d.enqueuedAt);add(stats.queue,queued!==null&&queued<=at?at-queued:null);add(stats.pacing,numeric(d.pacingWaitMs));}
   if(physicalKey){this.physicalTiming.set(physicalKey,{at,method,transport});while(this.physicalTiming.size>16)this.physicalTiming.delete(this.physicalTiming.keys().next().value!);}return;
  }
  this.timingCounts.physicalSettlements++;if(d.responseComplete===true)this.timingCounts.completeResponses++;const start=physicalKey?this.physicalTiming.get(physicalKey):undefined;
  if(!start)this.timingCounts.unmatchedSettlements++;if(stats){stats.settled++;if(d.responseComplete===true)stats.responses++;add(stats.physical,numeric(d.physicalElapsedMs));}if(physicalKey)this.physicalTiming.delete(physicalKey);
 }
 private addTimingRefusal(row:Record<string,unknown>){this.timingRefusals.push(row);this.timingRefusals.sort((a,b)=>Number(a.at)-Number(b.at));if(this.timingRefusals.length>8)this.timingRefusals.splice(0,this.timingRefusals.length-8);}
 private advance(at:number){if(!uint(at)||at<this.at)return false;for(const row of this.active.values())if(row.state==='waiting')this.blockedMsByReason[row.reason]+=Math.max(0,Math.min(at,row.deadlineAt)-this.at);this.at=at;return true;}
 observe(at:number,certificates:readonly HandoffCertificate[]){
  if(certificates.length>this.maximumActive||!this.advance(at))return false;
  const current=new Map(certificates.filter(c=>c.mint&&[c.windowEndAt,c.deadlineAt,c.admittedAt,c.openedAt].every(uint)&&c.openedAt<=c.admittedAt&&c.windowEndAt<=c.admittedAt&&c.admittedAt<=at&&at<=c.deadlineAt).map(c=>[identity(c),c]));
  for(const [key,row]of this.active)if(!current.has(key)){
   if(row.state==='waiting'){const expired=at>row.deadlineAt;if(expired)this.expiredBeforeDispatch++;else this.invalidatedBeforeDispatch++;this.record('native-paper-certificate-handoff',{at,mint:row.mint,windowEndAt:row.windowEndAt,deadlineAt:row.deadlineAt,stage:expired?'expired-before-dispatch':'invalidated-before-dispatch',lastReason:row.reason,financialPermission:false});}
   this.active.delete(key);
  }
  for(const [key,c]of current)if(!this.active.has(key)){this.active.set(key,{...c,key,firstSeenAt:at,state:'waiting',reason:'await-financial-dispatch'});this.seen++;}
  return true;
 }
 defer(c:HandoffCertificate,reason:HandoffReason,at:number){
  if(!this.advance(at))return;const row=this.active.get(identity(c));if(!row||row.state!=='waiting'||row.reason===reason)return;
  row.reason=reason;this.deferralTransitionsByReason[reason]++;
 }
 dispatch(c:HandoffCertificate,at:number){
  if(!this.advance(at))return;const row=this.active.get(identity(c));if(!row||row.state!=='waiting'||at>row.deadlineAt)return;
  row.state='dispatched';this.dispatched++;const wait=at-row.admittedAt;this.waits.count++;this.waits.sum+=wait;this.waits.max=Math.max(this.waits.max,wait);const bin=Math.min(100,Math.ceil(wait/100));this.waits.bins[bin]=(this.waits.bins[bin]??0)+1;
  this.record('native-paper-certificate-handoff',{at,mint:row.mint,windowEndAt:row.windowEndAt,deadlineAt:row.deadlineAt,stage:'financial-dispatch',waitMs:wait,financialPermission:false});
 }
 complete(c:HandoffCertificate,at:number,evaluations:number){
  if(!this.advance(at))return;const row=this.active.get(identity(c));if(!row||row.state!=='dispatched')return;
  if(uint(evaluations))this.financialEvaluations+=evaluations;
  this.active.delete(row.key);this.record('native-paper-certificate-handoff',{at,mint:row.mint,windowEndAt:row.windowEndAt,deadlineAt:row.deadlineAt,stage:'financial-dispatch-completed',financialEvaluations:uint(evaluations)?evaluations:0,financialPermission:false});
 }
 usage(at:number){
  const blocked={...this.blockedMsByReason};if(uint(at)&&at>=this.at)for(const row of this.active.values())if(row.state==='waiting')blocked[row.reason]+=Math.max(0,Math.min(at,row.deadlineAt)-this.at);
  const quantile=(p:number)=>{if(!this.waits.count)return null;let sum=0;const goal=Math.ceil(this.waits.count*p);for(let i=0;i<this.waits.bins.length;i++){sum+=this.waits.bins[i]!;if(sum>=goal)return i*100;}return null;};
  return {version:NATIVE_FINANCIAL_HANDOFF_VERSION,scope:'CURRENT_SOURCE_PROCESS' as const,runId:this.runId,startedAt:this.startedAt,generatedAt:at,seen:this.seen,dispatched:this.dispatched,financialEvaluations:this.financialEvaluations,expiredBeforeDispatch:this.expiredBeforeDispatch,invalidatedBeforeDispatch:this.invalidatedBeforeDispatch,blockedMsByReason:blocked,deferralTransitionsByReason:{...this.deferralTransitionsByReason},dispatchWait:{count:this.waits.count,mean:this.waits.count?this.waits.sum/this.waits.count:null,max:this.waits.count?this.waits.max:null,p50UpperMs:quantile(.5),p95UpperMs:quantile(.95),histogramResolutionMs:100},active:[...this.active.values()].map(({key,...row})=>row),requestTiming:{version:REQUEST_TIMING_VERSION,runId:this.runId,startedAt:this.startedAt,generatedAt:at,...this.timingCounts,refusals:this.timingRefusals.map(row=>({...row})),methods:[...this.methodTiming.values()].map(m=>({...m,queue:{...m.queue},pacing:{...m.pacing},physical:{...m.physical}}))}};
 }
}
