/** Bounded observations of the existing candidate pipeline. No provider,
 * timer, writer, qualification or scheduler authority. Unknown source errors
 * remain one static bucket; arbitrary messages never enter this snapshot. */
export const NATIVE_CANDIDATE_FAILURE_CODES=[
 "BAD_POOL_OWNER","NATIVE_OBSERVATION_POOL_MISSING",
 "AUDIT_COMPLETED_AFTER_DECISION_BUCKET","COMPONENT_RPC_-32005","COMPONENT_RPC_OVERLOAD","COMPONENT_WS_RPC_ERROR",
 "COMPONENT_WS_TRANSPORT","DECISION_DEADLINE_EXPIRED","NATIVE_AUDIT_ADMISSION_CLOSED","NATIVE_AUDIT_BATCH_BINDING",
 "NATIVE_AUDIT_BATCH_ITEM","NATIVE_AUDIT_BATCH_RECEIPT","NATIVE_AUDIT_CANDIDATE_RETIRED","NATIVE_AUDIT_CAPTURED_CORRECTION",
 "NATIVE_AUDIT_CAPTURED_TARGET_NOT_IN_HISTORY","NATIVE_AUDIT_CLOCK_REGRESSION","NATIVE_AUDIT_CONFIRMED_STATUS_DISAGREEMENT","NATIVE_AUDIT_CONTEXT_FENCE_INVALID_OR_STALE",
 "NATIVE_AUDIT_DIAGNOSTIC_BOUND","NATIVE_AUDIT_ELAPSED_LIMIT","NATIVE_AUDIT_HISTORY_CONTEXT","NATIVE_AUDIT_HISTORY_PAGE_PAYLOAD_LIMIT",
 "NATIVE_AUDIT_FINALIZED_HISTORY_CONFLICT","NATIVE_AUDIT_HISTORY_CACHE_BINDING","NATIVE_AUDIT_HISTORY_CACHE_SCHEMA","NATIVE_AUDIT_HISTORY_CACHE_CONTIGUITY",
 "NATIVE_AUDIT_HISTORY_PAGE_SCHEMA","NATIVE_AUDIT_HISTORY_RANGE_NOT_COVERED","NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED","NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN",
 "NATIVE_AUDIT_INVALID_OPTIONS","NATIVE_AUDIT_INVALID_TARGET","NATIVE_AUDIT_LOWER_CONTEXT_CLOCK_INVALID","NATIVE_AUDIT_NOTIFICATION_BOUND",
 "NATIVE_AUDIT_NOTIFICATION_SCHEMA","NATIVE_AUDIT_NOT_COMPLETED","NATIVE_AUDIT_OWNED_ENTRY_RESOLVED","NATIVE_AUDIT_PAGE_OPERATION_BOUND",
 "NATIVE_AUDIT_POST_SNAPSHOT_CORRECTION","NATIVE_AUDIT_POST_WINDOW_SLOT_FENCE_UNAVAILABLE","NATIVE_AUDIT_PRE_WINDOW_SLOT_FENCE_UNAVAILABLE","NATIVE_AUDIT_SESSION_ABORTED",
 "NATIVE_AUDIT_SESSION_CANCELLED","NATIVE_AUDIT_SESSION_CLOCK","NATIVE_AUDIT_SESSION_DEADLINE","NATIVE_AUDIT_SESSION_DEADLINE_OR_GENERATION",
 "NATIVE_AUDIT_SESSION_INPUT_BOUND","NATIVE_AUDIT_SESSION_PAGE_BOUND","NATIVE_AUDIT_SESSION_PAGE_LIMIT","NATIVE_AUDIT_SESSION_UNAVAILABLE",
 "NATIVE_AUDIT_SOURCE_GENERATION_CHANGED","NATIVE_AUDIT_TAIL_ADMISSION_CLOSED","NATIVE_AUDIT_TAIL_GENERATION","NATIVE_AUDIT_TAIL_NOTIFICATION_BOUND",
 "NATIVE_AUDIT_TAIL_NOTIFICATION_GENERATION","NATIVE_AUDIT_TAIL_NOTIFICATION_SCHEMA","NATIVE_AUDIT_TAIL_OPTIONS","NATIVE_AUDIT_TARGET_SLOT_BOUNDARY_AMBIGUOUS",
 "NATIVE_AUDIT_UNAVAILABLE","NATIVE_AUDIT_UNUSABLE_TARGET_INFORMATION","NATIVE_FLOW_ACK_INVALID","NATIVE_FLOW_CALLBACK_PROCESSING_OVERRUN",
 "NATIVE_FLOW_CANDIDATE_CAPACITY","NATIVE_FLOW_CANDIDATE_RETIRED","NATIVE_FLOW_CANONICAL_SCOPE","NATIVE_FLOW_CLOSED",
 "NATIVE_FLOW_CONFIRMED_CORRECTION","NATIVE_FLOW_CONTROL_CALLBACK_FAILED","NATIVE_FLOW_CONTROL_CANCELLED","NATIVE_FLOW_CONTROL_DIAGNOSTIC_FAILED",
 "NATIVE_FLOW_CONTROL_GUARD_UNAVAILABLE","NATIVE_FLOW_CONTROL_RECORDING_FAILED","NATIVE_FLOW_CROSS_SCOPE_UNAVAILABLE","NATIVE_FLOW_DATA_CONTRACT",
 "NATIVE_FLOW_DISCONNECTED","NATIVE_FLOW_DURATION_LIMIT","NATIVE_FLOW_EVENT_CORRECTION","NATIVE_FLOW_FUTURE_SNAPSHOT",
 "NATIVE_FLOW_GAP_CALLBACK_FAILED","NATIVE_FLOW_INDEPENDENT_AUDIT_GAP","NATIVE_FLOW_INFORMATION_CUTOFF","NATIVE_FLOW_INVALID_LIMITS",
 "NATIVE_FLOW_INVALID_PERSISTENCE","NATIVE_FLOW_MEMORY_PRESSURE","NATIVE_FLOW_NONCANONICAL_SIGNATURE","NATIVE_FLOW_NOTIFICATION_LEDGER_LIMIT","NATIVE_FLOW_NOTIFICATION_SCHEMA",
 "NATIVE_FLOW_OPEN_CANCELLED","NATIVE_FLOW_PHYSICAL_SETTLEMENT_UNVERIFIED","NATIVE_FLOW_PAYLOAD_OR_TIME_LIMIT","NATIVE_FLOW_PEER_CONTROL_LIMIT","NATIVE_FLOW_PEER_PONG_DEADLINE",
 "NATIVE_FLOW_PROCESSING_DEADLINE","NATIVE_FLOW_PROTOCOL_EFFECT_CAPACITY","NATIVE_FLOW_PROTOCOL_EFFECT_CORRECTION","NATIVE_FLOW_PROTOCOL_MARKER_CAPACITY",
 "NATIVE_FLOW_REBOUND_GENERATION_AMBIGUOUS","NATIVE_FLOW_REBOUND_SUPPORT_BEFORE_RETIREMENT","NATIVE_FLOW_RECEIPT_LIMIT","NATIVE_FLOW_RESOURCE_LIMIT",
 "NATIVE_FLOW_RETENTION_LIMIT","NATIVE_FLOW_RETIRED_SUBSCRIPTION_LIMIT","NATIVE_FLOW_ROUND_TRIP_CONNECTION","NATIVE_FLOW_ROUND_TRIP_RECEIPT",
 "NATIVE_FLOW_ROUND_TRIP_UNAVAILABLE","NATIVE_FLOW_RPC_ENVELOPE","NATIVE_FLOW_SCOPE_CONFLICT","NATIVE_FLOW_SCOPE_NOT_USABLE",
 "NATIVE_FLOW_SIGNATURE","NATIVE_FLOW_SOCKET_COUNTER","NATIVE_FLOW_STOPPED","NATIVE_FLOW_SUBSCRIPTION_ACK",
 "NATIVE_FLOW_SUBSCRIPTION_ID_REUSED","NATIVE_FLOW_SUPPORT_EXPIRED","NATIVE_FLOW_SUPPORT_EXPIRED_DURING_ACK","NATIVE_FLOW_SUPPORT_UNAVAILABLE",
 "NATIVE_FLOW_TRANSPORT_CLOSED","NATIVE_FLOW_TRANSPORT_SETTLING","NATIVE_FLOW_UNAVAILABLE","NATIVE_FLOW_UNEXPECTED_ACK",
 "NATIVE_FLOW_UNSCHEDULED_CONTROL_SUPPRESSED","NATIVE_FLOW_UNSCOPED_NOTIFICATION","NATIVE_FLOW_UNSUBSCRIBE_ACK","NATIVE_FLOW_VALIDATED_ADMISSION_CLOSED",
 "NATIVE_SOURCE_FINANCIAL_RUNWAY","OTHER_UNEXPORTED_REASON","PILOT_RPC_ABORTED","PILOT_RPC_COMPONENT_ABORTED",
 "PILOT_RPC_COMPONENT_ADMISSION_CLOSED","PILOT_RPC_COMPONENT_DISPATCH_EXPIRED","PILOT_RPC_COMPONENT_HTTP_429","PILOT_RPC_COMPONENT_HTTP_STATUS_502",
 "PILOT_RPC_COMPONENT_HTTP_STATUS_503","PILOT_RPC_COMPONENT_HTTP_STATUS_504","PILOT_RPC_COMPONENT_HTTP_TRANSPORT","PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT",
 "PILOT_RPC_COMPONENT_RPC_ERROR_-32016","PILOT_RPC_COMPONENT_RPC_OVERLOAD","PILOT_RPC_COOLDOWN","PILOT_RPC_PHYSICAL_SLOT_OCCUPIED",
 "PILOT_RPC_QUERY_COOLDOWN","RESEARCH_CLOCK_ADMISSION_CLOSED","RESEARCH_CLOCK_POOL_UNAVAILABLE","RPC_NODE_ERROR",
] as const;
export const NATIVE_CANDIDATE_FAILURE_KINDS=['quality-gap','audit-unavailable','audit-unusable','predictive-unavailable','decision-expired'] as const;
export const NATIVE_AUDIT_DISPATCH_REASONS=['eligible','native-service-wait','native-service-dispatch','native-service-return','rpc-gate-wait','ceiling-backoff','ceiling-refresh','prepare-native-runway','scheduler-wait','scheduler-refusal','audit-selected','peer-selected','page-admission','page-response','page-refusal','page-deferred','page-not-exposed','work-exception'] as const;
export const NATIVE_AUDIT_DISPATCH_ACTIONS=['await-financial-operation-runway','await-shared-dispatch','await-selected-peer-audit-page','await-physical-settlement','await-shared-gate-recovery','await-shared-pacing','await-shared-pacing-or-http-cooldown','await-history-provider-or-query-cooldown','await-local-uninvoked-page-retry','await-primary-support-ceiling','await-bounded-ceiling-refresh','refresh-confirmed-bank-ceiling','await-control-runway-gate','await-native-service-action','request-early-support-refresh','request-early-heartbeat','perform-required-native-service','retain-uninvoked-page-for-shared-scheduling','advance-logical-session','invoke-shared-rpc','validate-logical-session','retain-unavailable-target','invoke-shared-quiet-batch','dispatch-audit-page','dispatch-origin-verification','retain-refused-target','await-next-dispatch','retain-and-recheck-target','recheck-after-backoff','recheck-after-busy','recheck-after-close','recheck-after-closed','recheck-after-connect','recheck-after-deferred','recheck-after-idle','recheck-after-ping','recheck-after-pong','recheck-after-subscribe','recheck-after-support','recheck-after-unavailable','recheck-after-unsubscribe'] as const;
export const NATIVE_AUDIT_SCHEDULER_REASONS=['physical-operation-or-cancellation-unsettled','completion-deadline-expired','shared-physical-pacing','declared-completion-envelope-exceeds-deadline','one-other-start-per-protection-cycle','outside-bounded-admission-window'] as const;
export const NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS=Object.freeze({version:'bounded-native-candidate-failures-v1',scope:'CURRENT_RUNNER_INSTANCE',maximumRecentFacts:8,meaning:'Actual outcome observations and last local dispatch state, not independent windows, physical-start proof, provider causation or financial qualification. Earlier-instance causes remain unknown.'});
export type NativeCandidateFailureCode=typeof NATIVE_CANDIDATE_FAILURE_CODES[number];
export type NativeCandidateFailureKind=typeof NATIVE_CANDIDATE_FAILURE_KINDS[number];
export type NativeAuditDispatchReason=typeof NATIVE_AUDIT_DISPATCH_REASONS[number];
export type NativeCandidateFailureFact={at:number;mint:string|null;kind:NativeCandidateFailureKind;reasonCode:NativeCandidateFailureCode;windowEndAt:number|null;deadlineAt:number|null;lastDispatchReason:NativeAuditDispatchReason|null;lastDispatchAction:string|null;lastSchedulerReason:string|null;lastDispatchAt:number|null;firstReadyAt:number|null;logicalHistoryCalls:number|null;auditResultStatus:'verified'|'unusable'|'unavailable'|null;transportCloseCode:number|null;rpcErrorCode:number|null};
export type NativeCandidateFailureInput={at:number;mint?:string;kind:NativeCandidateFailureKind;reason:unknown;windowEndAt?:number;deadlineAt?:number;lastDispatchReason?:unknown;lastDispatchAction?:unknown;lastSchedulerReason?:unknown;lastDispatchAt?:number;firstReadyAt?:number;logicalHistoryCalls?:number;auditResultStatus?:unknown};
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const codes=new Set<string>(NATIVE_CANDIDATE_FAILURE_CODES),kinds=new Set<string>(NATIVE_CANDIDATE_FAILURE_KINDS),dispatches=new Set<string>(NATIVE_AUDIT_DISPATCH_REASONS),actions=new Set<string>(NATIVE_AUDIT_DISPATCH_ACTIONS),scheduler=new Set<string>(NATIVE_AUDIT_SCHEDULER_REASONS);
export function nativeCandidateFailureReason(value:unknown):{reasonCode:NativeCandidateFailureCode;transportCloseCode:number|null;rpcErrorCode:number|null}{
 const none={transportCloseCode:null,rpcErrorCode:null};
 if(typeof value!=='string'||value.length>160)return {reasonCode:'OTHER_UNEXPORTED_REASON',...none};
 if(value==='audit-completed-after-target-window-decision-bucket')return {reasonCode:'AUDIT_COMPLETED_AFTER_DECISION_BUCKET',...none};
 const close=typeof value==='string'?/^NATIVE_FLOW_DISCONNECTED_(\d{4})$/.exec(value):null;
 if(close&&Number(close[1])>=1000&&Number(close[1])<=4999)return {reasonCode:'NATIVE_FLOW_DISCONNECTED',transportCloseCode:Number(close[1]),rpcErrorCode:null};
 const rpc=typeof value==='string'?/^(?:PILOT_RPC_)?COMPONENT_RPC_ERROR_(-?\d{1,10})$/.exec(value):null;
 if(rpc&&Number.isSafeInteger(Number(rpc[1]))&&Number(rpc[1])>=-2147483648&&Number(rpc[1])<=2147483647)return {reasonCode:'RPC_NODE_ERROR',transportCloseCode:null,rpcErrorCode:Number(rpc[1])};
 return {reasonCode:typeof value==='string'&&codes.has(value)?value as NativeCandidateFailureCode:'OTHER_UNEXPORTED_REASON',...none};
}
/** Per runner instance only. Existing retained failure totals are not reset or
 * replaced; diagnostic recovery never grants market or financial readiness. */
export class NativeCandidateFailureDiagnostics{
 private events=0;private omittedDetails=0;private readonly byReason:Partial<Record<NativeCandidateFailureCode,number>>={};private readonly byKind:Partial<Record<NativeCandidateFailureKind,number>>={};private readonly recent:NativeCandidateFailureFact[]=[];
 constructor(readonly startedAt:number){}
 observe(input:NativeCandidateFailureInput){
  if(!kinds.has(input.kind))return;
  const reason=nativeCandidateFailureReason(input.reason),inc=(n:number|undefined)=>Math.min(Number.MAX_SAFE_INTEGER,(n??0)+1);this.events=inc(this.events);this.byReason[reason.reasonCode]=inc(this.byReason[reason.reasonCode]);this.byKind[input.kind]=inc(this.byKind[input.kind]);
  if(!integer(input.at)||!integer(this.startedAt)||input.at<this.startedAt){this.omittedDetails=inc(this.omittedDetails);return;}
  const end=integer(input.windowEndAt)&&input.windowEndAt>0&&input.windowEndAt<=input.at?input.windowEndAt:null,deadline=end!==null&&integer(input.deadlineAt)&&input.deadlineAt>=end&&input.deadlineAt<=end+10000?input.deadlineAt:null;
  const mint=typeof input.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.mint)?input.mint:null,dispatch=typeof input.lastDispatchReason==='string'&&dispatches.has(input.lastDispatchReason)?input.lastDispatchReason as NativeAuditDispatchReason:null;
  this.recent.push({at:input.at,mint,kind:input.kind,...reason,windowEndAt:end,deadlineAt:deadline,lastDispatchReason:dispatch,lastDispatchAction:typeof input.lastDispatchAction==='string'&&actions.has(input.lastDispatchAction)?input.lastDispatchAction:null,lastSchedulerReason:typeof input.lastSchedulerReason==='string'&&scheduler.has(input.lastSchedulerReason)?input.lastSchedulerReason:null,lastDispatchAt:integer(input.lastDispatchAt)&&input.lastDispatchAt>=this.startedAt&&input.lastDispatchAt<=input.at?input.lastDispatchAt:null,firstReadyAt:integer(input.firstReadyAt)&&input.firstReadyAt>=this.startedAt&&input.firstReadyAt<=input.at?input.firstReadyAt:null,logicalHistoryCalls:integer(input.logicalHistoryCalls)?input.logicalHistoryCalls:null,auditResultStatus:['verified','unusable','unavailable'].includes(input.auditResultStatus as string)?input.auditResultStatus as NativeCandidateFailureFact['auditResultStatus']:null});if(this.recent.length>NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS.maximumRecentFacts)this.recent.shift();
 }
 snapshot(){return {version:NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS.version,scope:NATIVE_CANDIDATE_FAILURE_DIAGNOSTICS.scope,startedAt:integer(this.startedAt)?this.startedAt:null,events:this.events,byKind:{...this.byKind},byReason:{...this.byReason},omittedDetails:this.omittedDetails,recent:this.recent.map(row=>({...row}))};}
}
