/** Diagnostic ownership of currently usable audit certificates only. This
 * never authorizes a financial action or extends an evidence deadline. */
export const NATIVE_FINANCIAL_HANDOFF_VERSION='native-financial-handoff-v1' as const;
export const HANDOFF_REASONS=['await-financial-dispatch','financial-or-source-admission','proof-retention','required-service-or-protection-runway','await-earlier-candidate'] as const;
export type HandoffReason=typeof HANDOFF_REASONS[number];
export type HandoffCertificate={mint:string;windowEndAt:number;deadlineAt:number;admittedAt:number;openedAt:number;featuresSha256:string};
type Active=HandoffCertificate&{key:string;firstSeenAt:number;state:'waiting'|'dispatched';reason:HandoffReason};
const identity=(c:HandoffCertificate)=>[c.mint,c.windowEndAt,c.openedAt,c.featuresSha256].join(':');
const uint=(n:number)=>Number.isSafeInteger(n)&&n>=0;
export class NativeFinancialHandoff {
 private active=new Map<string,Active>();
 private at:number;
 private seen=0;private dispatched=0;private financialEvaluations=0;
 private expiredBeforeDispatch=0;private invalidatedBeforeDispatch=0;
 private blockedMsByReason=Object.fromEntries(HANDOFF_REASONS.map(r=>[r,0])) as Record<HandoffReason,number>;
 private deferralTransitionsByReason=Object.fromEntries(HANDOFF_REASONS.map(r=>[r,0])) as Record<HandoffReason,number>;
 private waits={count:0,sum:0,max:0,bins:new Array<number>(101).fill(0)};
 constructor(readonly runId:string,readonly startedAt:number,private maximumActive:number,private record:(kind:string,value:unknown)=>void=()=>{}){this.at=startedAt;}
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
  return {version:NATIVE_FINANCIAL_HANDOFF_VERSION,scope:'CURRENT_SOURCE_PROCESS' as const,runId:this.runId,startedAt:this.startedAt,generatedAt:at,seen:this.seen,dispatched:this.dispatched,financialEvaluations:this.financialEvaluations,expiredBeforeDispatch:this.expiredBeforeDispatch,invalidatedBeforeDispatch:this.invalidatedBeforeDispatch,blockedMsByReason:blocked,deferralTransitionsByReason:{...this.deferralTransitionsByReason},dispatchWait:{count:this.waits.count,mean:this.waits.count?this.waits.sum/this.waits.count:null,max:this.waits.count?this.waits.max:null,p50UpperMs:quantile(.5),p95UpperMs:quantile(.95),histogramResolutionMs:100},active:[...this.active.values()].map(({key,...row})=>row)};
 }
}
