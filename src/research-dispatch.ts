/** Research-only admission decisions over the existing single physical gate.
 * No queue, provider budget, financial ownership or transport lives here. */
export const RESEARCH_DISPATCH = Object.freeze({periodMs:2000,spacingMs:1000,quantumMs:100,reservationReserveMs:25,enrichmentDelayMs:1000,enrichmentDeadlineMs:5000,operationBoundMs:1200,postProcessingReserveMs:200});
export type ResearchJob={id:string;kind:'pending'|'enrichment'|'reconnect';enqueuedAt:number;eligibleAt:number;deadlineAt:number;operationBoundMs:number};
export type DispatchView={now:number;readyAt:number;physicalBusy:boolean;nextProtectionAt:number|null;otherStartSinceProtection:boolean;advanceOutstanding?:boolean;jobs:readonly ResearchJob[]};
export type DispatchDecision={kind:'wait';until:number;reason:string}|{kind:'protection';scheduledAt:number;deadlineAt:number;advance:boolean}|{kind:'job';job:ResearchJob;latestStartAt:number}|{kind:'refuse';job:ResearchJob;reason:string};
const int=(n:number)=>Number.isSafeInteger(n)&&n>=0;
/** The100ms window is a dispatch-jitter research envelope, NOT an approved
 * protection-gap tolerance. All target misses/gaps must still be reported.
 * It replaces a zero-width exact-slot test; it never changes quote validity. */
export function chooseResearchWork(v:DispatchView):DispatchDecision{
  if(!int(v.now)||!int(v.readyAt)||v.nextProtectionAt!==null&&!int(v.nextProtectionAt)||v.jobs.length>16)throw Error('RESEARCH_DISPATCH_INVALID_VIEW');
  const ids=new Set<string>();
  for(const j of v.jobs){if(!j.id||ids.has(j.id)||!['pending','enrichment','reconnect'].includes(j.kind)||![j.enqueuedAt,j.eligibleAt,j.deadlineAt,j.operationBoundMs].every(int)||j.enqueuedAt>j.eligibleAt||j.eligibleAt>j.deadlineAt||j.operationBoundMs<1||j.operationBoundMs>12000)throw Error('RESEARCH_DISPATCH_INVALID_JOB');ids.add(j.id);}
  // An abort of the caller never makes a nonpreemptible operation disappear.
  if(v.physicalBusy)return {kind:'wait',until:Math.max(v.now+1,v.readyAt),reason:'physical-operation-or-cancellation-unsettled'};
  const start=Math.max(v.now,v.readyAt),ordered=[...v.jobs].sort((a,b)=>(a.kind==='pending'?0:1)-(b.kind==='pending'?0:1)||a.deadlineAt-b.deadlineAt||a.enqueuedAt-b.enqueuedAt||a.id.localeCompare(b.id));
  // Owners retain refused actions/evidence. Refusal is never a silent dequeue.
  const expired=ordered.find(j=>j.deadlineAt<=v.now);
  if(expired)return {kind:'refuse',job:expired,reason:'completion-deadline-expired'};
  // A bounded per-job timeout is recomputed at actual readiness. The present
  // timeout estimate must not become an irrevocable refusal while pacing waits.
  if(v.readyAt>v.now)return {kind:'wait',until:v.readyAt,reason:'shared-physical-pacing'};
  const impossible=ordered.find(j=>j.eligibleAt<=v.now&&start+RESEARCH_DISPATCH.reservationReserveMs+j.operationBoundMs>j.deadlineAt);
  if(impossible)return {kind:'refuse',job:impossible,reason:'declared-completion-envelope-exceeds-deadline'};
  const due=v.nextProtectionAt!==null&&v.now>=v.nextProtectionAt;
  const pending=ordered.find(j=>j.kind==='pending'&&j.eligibleAt<=v.now);
  // Financial deadlines have priority; a due valuation wins unless delaying an
  // already-pending action by one guarded operation would lose its deadline.
  if(pending&&(!due||v.now+RESEARCH_DISPATCH.spacingMs+pending.operationBoundMs>pending.deadlineAt))return {kind:'job',job:pending,latestStartAt:pending.deadlineAt-pending.operationBoundMs};
  if(due)return {kind:'protection',scheduledAt:v.nextProtectionAt!,deadlineAt:v.nextProtectionAt!+RESEARCH_DISPATCH.periodMs,advance:false};
  const job=ordered.find(j=>j.eligibleAt<=v.now);
  if(job&&!v.otherStartSinceProtection){
    const latest=Math.min(job.deadlineAt-job.operationBoundMs,v.nextProtectionAt===null?Infinity:v.nextProtectionAt-RESEARCH_DISPATCH.spacingMs+RESEARCH_DISPATCH.quantumMs);
    if(v.now+RESEARCH_DISPATCH.reservationReserveMs<=latest)return {kind:'job',job,latestStartAt:latest};
  }
  // A known hint which cannot use this cycle's finite window can justify ONE
  // early coherent refresh. Rebase the next target EARLIER, not later; the next
  // legal slot can then serve it. This changes observation phase and costs a
  // read: it is explicitly measured, never called decision-time equivalence.
  const waiting=ordered.find(j=>j.kind!=='pending');
  if(v.nextProtectionAt!==null&&!v.otherStartSinceProtection&&!v.advanceOutstanding&&waiting&&waiting.eligibleAt<=v.now+RESEARCH_DISPATCH.spacingMs&&waiting.deadlineAt>=v.now+2*RESEARCH_DISPATCH.spacingMs&&v.now<v.nextProtectionAt){
    return {kind:'protection',scheduledAt:v.nextProtectionAt,deadlineAt:v.nextProtectionAt+RESEARCH_DISPATCH.periodMs,advance:true};
  }
  const future=ordered.filter(j=>j.eligibleAt>v.now).map(j=>j.eligibleAt);
  return {kind:'wait',until:Math.max(v.now+1,Math.min(v.now+RESEARCH_DISPATCH.quantumMs,...future,v.nextProtectionAt??Infinity)),reason:v.otherStartSinceProtection?'one-other-start-per-protection-cycle':'outside-bounded-admission-window'};
}
