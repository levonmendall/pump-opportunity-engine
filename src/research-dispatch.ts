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

/** A research proposal, not an approved production protection tolerance.
 * 4s permits a bounded nonpreemptible operation between 2s target checks;
 * it is not inferred from the last successful sample or a stop-price guarantee. */
export const PROPOSED_RESEARCH_TIMING=Object.freeze({status:'PROPOSED_UNAPPROVED' as const,targetMs:2000,maximumUsableEvaluationGapMs:4000,quoteAgeMs:2000,sourceAgeMs:30000,enrichmentDeadlineMs:5000});
export type ProtectedDispatchView=DispatchView & {lastUsableEvaluationAt:number|null;observingSince:number;candidateWindowActive:boolean;recoveryActive:boolean;capacityAvailable:boolean;startSpacingMs?:number};
export type ProtectedDispatchResult={decision:DispatchDecision;candidateDisposition:'continue'|'suspend';reason:string|null;protectionDeadlineAt:number;protectionFeasible:boolean;protectionBreach:boolean;proposed:true};
/** Completion-deadline admission over the SAME physical gate. Request aborts
 * never create capacity. Owners must retain financial work, record suspension
 * as a flow gap, and warm a new complete window before permitting entry. */
export function chooseProtectedResearchWork(v:ProtectedDispatchView):ProtectedDispatchResult{
  chooseResearchWork(v); // reuse the established bounded view/job validation
  if(!int(v.observingSince)||v.lastUsableEvaluationAt!==null&&!int(v.lastUsableEvaluationAt)||v.startSpacingMs!==undefined&&(!int(v.startSpacingMs)||v.startSpacingMs<1))throw Error('PROTECTED_DISPATCH_INVALID_VIEW');
  const spacing=v.startSpacingMs??RESEARCH_DISPATCH.spacingMs;
  const setup=RESEARCH_DISPATCH.reservationReserveMs+RESEARCH_DISPATCH.quantumMs;
  const bound=RESEARCH_DISPATCH.operationBoundMs;
  const deadline=(v.lastUsableEvaluationAt??v.observingSince)+PROPOSED_RESEARCH_TIMING.maximumUsableEvaluationGapMs;
  const start=Math.max(v.now,v.readyAt),finishPrice=start+setup+bound;
  const breach=v.now>deadline;
  const jobs=[...v.jobs].sort((a,b)=>(a.kind==='pending'?0:1)-(b.kind==='pending'?0:1)||a.deadlineAt-b.deadlineAt||a.enqueuedAt-b.enqueuedAt||a.id.localeCompare(b.id));
  const pending=jobs.find(j=>j.kind==='pending'&&j.eligibleAt<=v.now);
  let disposition:'continue'|'suspend'=!v.candidateWindowActive||v.recoveryActive||!v.capacityAvailable||pending||breach?'suspend':'continue';
  let reason:string|null=breach?'proposed-protection-deadline-exceeded':pending?'pending-financial-action':v.recoveryActive?'recovery-work':!v.capacityAvailable?'monitoring-capacity-unavailable':!v.candidateWindowActive?'candidate-window-not-active':null;
  const result=(decision:DispatchDecision,feasible=finishPrice<=deadline):ProtectedDispatchResult=>({decision,candidateDisposition:disposition,reason,protectionDeadlineAt:deadline,protectionFeasible:feasible,protectionBreach:breach,proposed:true});
  if(v.physicalBusy){if(breach){disposition='suspend';reason='physical-operation-unsettled-at-protection-deadline';}return result({kind:'wait',until:Math.max(v.now+1,v.readyAt),reason:'physical-operation-or-cancellation-unsettled'},false);}
  if(v.readyAt>v.now){if(finishPrice>deadline){disposition='suspend';reason='pacing-makes-protection-envelope-infeasible';}return result({kind:'wait',until:v.readyAt,reason:'shared-physical-pacing'});}
  const price=(advance:boolean):DispatchDecision=>({kind:'protection',scheduledAt:v.nextProtectionAt??v.now,deadlineAt:deadline,advance});
  const afterJob=(j:ResearchJob)=>Math.max(start+spacing,start+setup+j.operationBoundMs)+setup+bound;
  const jobAfterPrice=(j:ResearchJob)=>Math.max(start+spacing,finishPrice,j.eligibleAt)+setup+j.operationBoundMs;
  const latestJobStart=(j:ResearchJob)=>Math.min(j.deadlineAt-setup-j.operationBoundMs,deadline-Math.max(spacing,setup+j.operationBoundMs)-setup-bound);
  if(pending){
    const ownFirst=start+setup+pending.operationBoundMs<=pending.deadlineAt&&afterJob(pending)<=deadline&&start+RESEARCH_DISPATCH.reservationReserveMs<=latestJobStart(pending);
    const priceFirst=finishPrice<=deadline&&jobAfterPrice(pending)<=pending.deadlineAt;
    if(priceFirst&&v.nextProtectionAt!==null&&v.now>=v.nextProtectionAt)return result(price(false));
    if(ownFirst)return result({kind:'job',job:pending,latestStartAt:latestJobStart(pending)});
    if(priceFirst)return result(price(v.nextProtectionAt!==null&&v.now<v.nextProtectionAt));
    // There is no ordering that meets both promises. Retain the financial owner
    // and expose the protection failure instead of hiding it in another queue.
    reason='pending-and-protection-deadlines-jointly-infeasible';disposition='suspend';
    const latest=pending.deadlineAt-setup-pending.operationBoundMs;
    return result(start+RESEARCH_DISPATCH.reservationReserveMs<=latest?{kind:'job',job:pending,latestStartAt:latest}:{kind:'refuse',job:pending,reason:'financial-action-retained-for-reconciliation:joint-deadlines-infeasible'},false);
  }
  if(finishPrice>deadline){disposition='suspend';reason='protection-envelope-no-longer-feasible';return result(price(true),false);}
  const due=v.nextProtectionAt!==null&&v.now>=v.nextProtectionAt;
  const normalProtectionTooLate=v.nextProtectionAt!==null&&v.nextProtectionAt+setup+bound>deadline;
  if(due||normalProtectionTooLate)return result(price(!due));
  const job=jobs.find(j=>j.eligibleAt<=v.now);
  if(job){
    if(job.kind==='enrichment'&&disposition==='suspend')return result({kind:'refuse',job,reason:reason??'candidate-window-suspended'});
    if(start+setup+job.operationBoundMs>job.deadlineAt){disposition='suspend';reason='required-enrichment-completion-envelope-exceeds-deadline';return result({kind:'refuse',job,reason});}
    if(afterJob(job)<=deadline&&start+RESEARCH_DISPATCH.reservationReserveMs<=latestJobStart(job))return result({kind:'job',job,latestStartAt:latestJobStart(job)});
    if(!v.advanceOutstanding&&jobAfterPrice(job)<=job.deadlineAt)return result(price(true));
    // An exhausted early-refresh reservation is not evidence that a queued
    // trade is impossible. Keep its bounded opportunity after the NEXT normal
    // protection check when that full completion envelope still fits. Every
    // wake rechecks readiness/deadlines; no new queue or exact-start slot exists.
    if(v.nextProtectionAt!==null&&v.now<v.nextProtectionAt){
      const normalStart=Math.max(v.nextProtectionAt,v.readyAt),afterNormal=normalStart+Math.max(spacing,setup+bound)+setup+job.operationBoundMs;
      if(normalStart+setup+bound<=deadline&&afterNormal<=job.deadlineAt)return result({kind:'wait',until:v.nextProtectionAt,reason:'bounded-enrichment-opportunity-after-normal-protection'});
    }
    disposition='suspend';reason='combined-enrichment-and-protection-envelope-infeasible';return result({kind:'refuse',job,reason});
  }
  const future=jobs.filter(j=>j.eligibleAt>v.now).map(j=>j.eligibleAt);
  return result({kind:'wait',until:Math.max(v.now+1,Math.min(v.now+RESEARCH_DISPATCH.quantumMs,...future,v.nextProtectionAt??Infinity,deadline-setup-bound)),reason:'waiting-for-eligible-work'});
}
