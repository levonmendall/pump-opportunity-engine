/** Cheap deadline planning only. This module performs no financial, network,
 * evidence or entry-control operation. A requested turn must run the existing
 * actual-size whole-inventory protection path; only its genuine completed
 * evaluation can renew financial runway. */
import type {NativeDeadlineView} from './native-candidate-runner.js';

export const NATIVE_HELD_AUDIT_SCHEDULING_POLICY=Object.freeze({
 version:'deadline-aware-early-actual-protection-v1',
 targetMs:2000,financialOperationBoundMs:1200,postOperationReserveMs:125,
 retainedManagementStarts:4,
 meaning:'Only bring forward an otherwise necessary protection read when committed audited-window deadlines cannot fit the ordinary cadence. Preserve actual quotes, the four-second completion boundary, all physical gates and both rolling provider reserves. No entry permission is granted.'
});
export type NativeHeldAuditSchedulingInput={
 at:number;held:number;lastProtectionStartedAt:number;lastProtectionCompletedAt:number|null;
 inventoryProtectionComplete:boolean;nextPendingAt:number|null;candidateInformationOpen:boolean;
 currentAuditFinancialRunwayAvailable:boolean;deadlineView:Pick<NativeDeadlineView,'at'|'targets'|'requiredNativeAt'>;
 physical:{available:boolean;busy:boolean;readyAt:number;rolling10SecondHeadroom:number|null;rollingMinuteHeadroom:number|null};
 /** The caller must know the warm whole-inventory request plan. Unknown/cold
  * work cannot be assumed to cost one request merely to open audit capacity. */
 protectionRequestStarts:number|null;
};
export type NativeHeldAuditSchedulingReason='no-owned-position'|'normal-protection-due'|'prior-protection-not-complete'|'pending-action-priority'|'candidate-information-closed'|'no-dispatchable-ready-audit'|'audit-financial-runway-open'|'physical-gate-unavailable'|'rolling-provider-reserve'|'original-deadline-too-close'|'normal-cadence-has-runway'|'early-completed-protection-opportunity';
export type NativeHeldAuditSchedulingDecision={
 earlyProtection:boolean;reason:NativeHeldAuditSchedulingReason;readyAudits:number;earliestAuditDeadlineAt:number|null;
 nextOrdinaryProtectionAt:number;ordinaryFirstAuditCompletionBoundAt:number|null;earlyFirstAuditCompletionBoundAt:number|null;
 requiredStartHeadroom:number|null;entryPermissionGranted:false;protectionCompletionClaimed:false;
};
const valid=(value:number)=>Number.isSafeInteger(value)&&value>=0;
export function nativeHeldAuditScheduling(input:NativeHeldAuditSchedulingInput):NativeHeldAuditSchedulingDecision{
 const p=NATIVE_HELD_AUDIT_SCHEDULING_POLICY;
 if(!valid(input.at)||!valid(input.held)||!valid(input.lastProtectionStartedAt)||input.lastProtectionStartedAt>input.at||!valid(input.deadlineView.at)||input.deadlineView.at>input.at)throw Error('NATIVE_HELD_AUDIT_SCHEDULING_INPUT');
 const nextOrdinaryProtectionAt=input.lastProtectionStartedAt+p.targetMs;
 let readyAudits=0,earliestAuditDeadlineAt:number|null=null,ordinaryFirstAuditCompletionBoundAt:number|null=null,earlyFirstAuditCompletionBoundAt:number|null=null,requiredStartHeadroom:number|null=null;
 const result=(reason:NativeHeldAuditSchedulingReason,earlyProtection=false):NativeHeldAuditSchedulingDecision=>({earlyProtection,reason,readyAudits,earliestAuditDeadlineAt,nextOrdinaryProtectionAt,ordinaryFirstAuditCompletionBoundAt,earlyFirstAuditCompletionBoundAt,requiredStartHeadroom,entryPermissionGranted:false,protectionCompletionClaimed:false});
 if(!input.held)return result('no-owned-position');
 // The runtime's existing due/overdue protection branch retains priority.
 if(input.at>=nextOrdinaryProtectionAt)return result('normal-protection-due');
 if(input.lastProtectionCompletedAt===null||!valid(input.lastProtectionCompletedAt)||input.lastProtectionCompletedAt>input.at||input.lastProtectionStartedAt>input.lastProtectionCompletedAt||!input.inventoryProtectionComplete)return result('prior-protection-not-complete');
 if(input.nextPendingAt!==null)return result('pending-action-priority');
 if(!input.candidateInformationOpen)return result('candidate-information-closed');
 const ready=input.deadlineView.targets.filter(t=>t.ready&&!t.prospective&&t.serviceableBeforeDeadline&&valid(t.deadlineAt)&&valid(t.historyReadyAt)&&t.historyReadyAt<=input.at&&valid(t.minimumPageWorkMs)&&t.minimumPageWorkMs>0&&input.at+t.minimumPageWorkMs<=t.deadlineAt).sort((a,b)=>a.deadlineAt-b.deadlineAt||a.mint.localeCompare(b.mint));
 readyAudits=ready.length;earliestAuditDeadlineAt=ready[0]?.deadlineAt??null;
 if(!ready.length)return result('no-dispatchable-ready-audit');
 if(input.currentAuditFinancialRunwayAvailable)return result('audit-financial-runway-open');
 if(!input.physical.available||input.physical.busy||!valid(input.physical.readyAt)||input.physical.readyAt>input.at)return result('physical-gate-unavailable');
 const starts=input.protectionRequestStarts,short=input.physical.rolling10SecondHeadroom,minute=input.physical.rollingMinuteHeadroom;
 if(starts===null||!valid(starts)||starts<1||short===null||minute===null||!valid(short)||!valid(minute))return result('rolling-provider-reserve');
 requiredStartHeadroom=p.retainedManagementStarts+starts+1;
 if(short<requiredStartHeadroom||minute<requiredStartHeadroom)return result('rolling-provider-reserve');
 const first=ready[0]!,native=input.deadlineView.requiredNativeAt;
 if(native!==null&&(!valid(native)||native<input.at))return result('original-deadline-too-close');
 const firstCutoff=Math.min(first.deadlineAt,native??Infinity);
 earlyFirstAuditCompletionBoundAt=input.at+p.financialOperationBoundMs+p.postOperationReserveMs+first.minimumPageWorkMs;
 if(earlyFirstAuditCompletionBoundAt>firstCutoff)return result('original-deadline-too-close');
 let cursor=Math.max(input.at,nextOrdinaryProtectionAt)+p.financialOperationBoundMs+p.postOperationReserveMs;
 let ordinaryFits=true;
 for(const t of ready){cursor+=t.minimumPageWorkMs;ordinaryFirstAuditCompletionBoundAt??=cursor;if(cursor>t.deadlineAt)ordinaryFits=false;}
 // If the ordinary turn can still honor every currently committed page, avoid
 // spending an additional read merely because the source is momentarily idle.
 if(ordinaryFits)return result('normal-cadence-has-runway');
 return result('early-completed-protection-opportunity',true);
}
