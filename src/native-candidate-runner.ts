/** Candidate-only integration over the existing native source, watch registry
 * and physical RPC gate. This module never imports or opens a financial ledger. */
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {MarketRegistry,isMarketRegistryContention} from './market-registry.js';
import {NativeSlotProductivity,type NativeSlotFinancialKind} from './native-slot-productivity.js';
import {NativeActivityHintQueue,type NativeActivityHint} from './native-activity-hint-queue.js';
import type {MarketIdentityHint,MarketActivityHint,MarketFeedStatus} from './market-discovery.js';
import {nativePaperFeaturesSha256} from './native-paper-contract.js';
import {PilotWatch,type WatchRow,type TechnicalReevaluationReason} from './pilot-watch.js';
import {resolvePilotMigration,type PilotMigrationSeed,type PilotMigrationResult,type PilotMigrationRpc} from './pilot-discovery.js';
import {decodeMigrationIdentity,type MigrationIdentity} from './migration-identity.js';
import {canonicalObservationPool,assertNativeObservationIdentity,nativeObservationIdentityFromMigration,nativeCurrentPoolIdentityProof,type NativeObservationIdentity} from './native-observation-identity.js';
import type {ResearchClockNativeObservationSupport} from './research-clock-pricing.js';
import {assessPredictiveBuying,PROVISIONAL_RULE,type FlowFeatures} from './strategy.js';
import {assessAdaptiveBuying,ADAPTIVE_MOMENTUM_V2_VERSION} from './adaptive-momentum-v2.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION,assessLiquidityResilientBuying,type V3BuyingAssessment,type V3Evidence} from './liquidity-resilient-momentum-v3.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,assessLiquidityResilientBuyingV31} from './liquidity-resilient-momentum-v3-1.js';
import {decodeTokenCreationProof} from './token-age-policy.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY,entryAgeEligible,observationAgeEligible,observationAgeCohort,observationRunway,observationExpiryAt,observationAgePolicyByVersion,type ObservationAgePolicyVersion,type ObservationAgePolicy} from './observation-age.js';
import {CONFIRMED_PROGRAM_EVENTS_V2} from './program-log-mapping.js';
import {nativeFlowDataContract,type NativeFlowDataContract,type PilotNativeFlow} from './pilot-native-flow.js';
import {auditNativeFlowWindow,selectNativeNotificationAuditFences,type NativeFlowAuditResult,type NativeAuditHistoryCache} from './native-flow-audit.js';
import {NativeAuditSession} from './native-audit-session.js';
import {chooseResearchWork,type ResearchJob} from './research-dispatch.js';
import {pilotUninvokedHistoryRefusal,type PilotRpc,type PilotRpcCallOptions} from './pilot-rpc.js';
import {NativeCandidateFailureDiagnostics,nativeCandidateFailureReason,type NativeCandidateFailureKind} from './native-candidate-diagnostics.js';

export const NATIVE_CANDIDATE_VERSION='native-candidate-only-v1';
export const NATIVE_AUDIT_DISPATCH_DIAGNOSTICS=Object.freeze({version:'bounded-native-audit-dispatch-v1',maximumTransitionRecordsPerTarget:16,meaning:'Coalesced local eligibility/admission observations, not physical-start or provider-saturation claims. Actual physical starts and settlement remain separately recorded.'});
export const NATIVE_CANDIDATE_AUDIT_PROFILE=Object.freeze({version:'native-resumable-finalized-history-reuse-v6',pageLimit:1000 as const,adaptivePageSizing:true,completenessScope:'executed-transactions' as const,postSnapshotTail:true,maximumPages:6 as const,physicalTimeoutMs:1500,operationBoundMs:2000,maximumAuditSpanMs:9999,predictiveCadenceMs:PROVISIONAL_RULE.bucketMs,meaning:'One physical page per step, initially100 for quiet windows and up to1000 when required; controls may run between pages. Independently confirmed failed transactions remain packet-coverage diagnostics, not executed flow. Actual post-snapshot packets may corroborate history at final availability without changing original target features. All pages and predictive admission must complete in the original ten-second decision bucket. Quiet100-row first pages may share one bounded HTTP envelope; busy continuations remain individual. Six is an opportunistic page ceiling, not a promise that six2s bounds fit this bucket; every page retains actual deadline admission. Initial100 plus five1000 pages covers at most5100rows. A fresh exact finalized overlap may bridge a prior verified finalized suffix within the same candidate generation; reused denominator rows are separately recorded and do not consume physical calls. This is not a two-second whole-audit or holding-protection bound.'});
export type NativeAuditCertificate={schemaVersion:1;mint:string;pool:string;dataContract:NativeFlowDataContract;openedAt:number;connectionId:number;subscriptionId:number;windowStartAt:number;windowEndAt:number;auditAvailableAt:number;admittedAt:number;deadlineAt:number;notificationCompletenessVerified:boolean;executedFlowCompletenessVerified:boolean;featuresSha256:string};
/** A completed primary trading decision, not a preliminary or technical
 * refusal. Carries only scheduling provenance; it grants no financial authority. */
export type NativeEconomicRejection={kind:'completed-economic-rejection';mint:string;pool:string;strategyVersion:typeof LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION;windowEndAt:number;openedAt:number;decisionAt:number;quoteAt:number;quoteEvidence:string;reobservationCostLamports?:string;reason:'v3.1-nonpositive-joint-conditional-economic-balance';at:number};
export type NativeOrigin={originConfirmed:{signature:string;availableAt:number;transaction:unknown};originFinalized:{signature:string;availableAt:number;transaction:unknown};olderSelection?:{observedAt:number;evidence:string}};
type Flow=Pick<PilotNativeFlow,'addCandidate'|'removeCandidate'|'snapshot'|'notificationLedger'|'requestSupportRefresh'|'requestHeartbeat'|'service'|'usage'|'stop'>&Partial<Pick<PilotNativeFlow,'servicePlan'|'captureState'|'candidateMints'>>;
type Rpc=Pick<PilotRpc,'call'|'usage'|'cooldownUntil'>&Partial<Pick<PilotRpc,'callSignatureHistoryBatch'|'historyQueryReadyAt'>>;
type AuditDispatchReason='eligible'|'native-service-wait'|'native-service-dispatch'|'native-service-return'|'rpc-gate-wait'|'ceiling-backoff'|'ceiling-refresh'|'prepare-native-runway'|'scheduler-wait'|'scheduler-refusal'|'audit-selected'|'peer-selected'|'page-admission'|'page-response'|'page-refusal'|'page-deferred'|'page-not-exposed'|'work-exception';
type AuditDispatchTrace={windowEndAt:number;deadlineAt:number;firstReadyAt:number;lastAt:number;lastState:{reason:AuditDispatchReason;nextAction:string;context:Record<string,unknown>};reasonCounts:Partial<Record<AuditDispatchReason,number>>;transitionRecords:number;omittedTransitions:number;stateKey:string;final:boolean};
type Candidate={historyCache?:NativeAuditHistoryCache;identity:NativeObservationIdentity;allocatedAt:number;openedAt:number|null;lastFeatureEnd:number;lastAssessmentEnd:number;lastReadyWindowEnd:number;lastReadyObservedAt:number;lastExpiredWindowEnd:number;lastAuditFenceWarmingWindowEnd:number;auditFailures:number;nextAuditAt:number;lastAuditPageAt:number;auditPageRetryAt:number;readinessCheckedEnd:number;checkedAuditable:boolean;auditDispatch?:AuditDispatchTrace;auditSession?:{session:NativeAuditSession;windowEndAt:number;openedAt:number|null;connectionId:number|null|undefined;subscriptionId:number|null|undefined;deadlineAt:number}};
export type NativeMarketIntake={observeIdentity:(row:MarketIdentityHint)=>void;observeActivity:(row:MarketActivityHint)=>void;observeFeed:(row:MarketFeedStatus)=>void;observeMigration:(seed:PilotMigrationSeed)=>void};
export type NativeRunnerOptions={enforceTokenAge24h?:true;marketIntake?:NativeMarketIntake;registry?:MarketRegistry;runId?:string;activeEvidence?:(mint:string,at:number)=>V3Evidence|null;activeStrategy?:'adaptive-momentum-v2'|'liquidity-resilient-momentum-v3'|'liquidity-resilient-momentum-v3.1';activeAssessment?:(mint:string,features:FlowFeatures,at:number)=>V3BuyingAssessment;observationAgePolicy?:ObservationAgePolicyVersion;rpc:Rpc;flow:Flow;record:(kind:string,data:unknown)=>void;now?:()=>number;maximumDeep?:number;restoredWatch?:unknown;resolve?:typeof resolvePilotMigration;audit?:typeof auditNativeFlowWindow;admissionOpen?:()=>boolean;sourceWorkAdmission?:(operationBoundMs:number)=>boolean;onCandidateAllocated?:(identity:NativeObservationIdentity)=>void;onCandidateRetired?:(mint:string,reason:string)=>void;onAuditAvailable?:(certificate:NativeAuditCertificate)=>void;financialOwnership?:(mint:string)=>'HELD'|'ENTRY_PENDING'|null};
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
const safe=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,150}$/.test(error.message)?error.message:'NATIVE_CANDIDATE_OPERATION_UNAVAILABLE';
const PRE_OBSERVATION_POOL_REFUSALS=new Set(['NATIVE_OBSERVATION_POOL_MISSING','BAD_POOL_OWNER']);
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
// Request availability, RPC commitment and provider feed-hint role do not alter
// canonical on-chain creation identity. Every chain role/context remains bound.
const stable=(id:MigrationIdentity)=>{const {commitment:_c,availableAt:_a,feedHintRole:_hint,...value}=id;return JSON.stringify(canonical(value));};

export const NATIVE_DEADLINE_POLICY=Object.freeze({version:'native-certified-financial-handoff-admission-v3',pageOperationMs:2000,postValidationMs:125,discretionaryReadMs:1500,originWorkflowMs:20000,maximumOriginReads:6,uninvokedPageRetryMs:250,nativeOperationMs:1700,heartbeatOperationMs:1200});
export type NativeDeadlineTarget={mint:string;eligibleAt:number;deadlineAt:number;ready:boolean;continuing:boolean;minimumPageWorkMs:number;prospective:boolean;historyReadyAt:number;serviceableBeforeDeadline:boolean};
export type NativeDeadlineView={at:number;targets:NativeDeadlineTarget[];readyCount:number;nextEligibleAt:number|null;earliestDeadlineAt:number|null;discretionaryUntil:number|null;minimumReadyWorkMs:number;unavailableReadyCount:number;conservativeReadyEnvelopeFits:boolean;requiredNativeAt:number|null;requiredNativeAction:string|null;meaning:string};
type VerificationRead={method:string;params:unknown[];signal?:AbortSignal;resolve:(value:unknown)=>void;reject:(error:unknown)=>void};
type VerificationSession={seed:PilotMigrationSeed;startedAt:number;deadlineAt:number;controller:AbortController;pending:VerificationRead|null;result:PilotMigrationResult|null;reads:number;done:Promise<void>};

export class NativeCandidateRunner{
 readonly dataContract:NativeFlowDataContract;readonly currentPoolObservation:boolean;readonly watch:PilotWatch;readonly observationAgePolicy:ObservationAgePolicy;private readonly now:()=>number;private readonly candidates=new Map<string,Candidate>();private readonly origins=new Map<string,MigrationIdentity>();private readonly originProofs=new Map<string,NativeOrigin>();private readonly registry:MarketRegistry;private readonly runScope:string;private readonly certificates=new Map<string,NativeAuditCertificate>();private readonly productivity:NativeSlotProductivity;private pendingAuditPhysical:{mint:string;windowEndAt:number}|null=null;
 private readonly retirementRequests=new Map<string,{candidate:Candidate;reason:string;at:number;deferMs:number}>();
 private readonly cancelledAuditDiagnostics:Array<{mint:string;targetEndAt:number;deadlineAt:number;cancelledAt:number;session:NativeAuditSession}>=[];
 private verificationSession:VerificationSession|null=null;private committedActivityPending=true;private legacyObservationRepairPending=true;private primaryEconomicEvaluations=0;
 private readonly audit:typeof auditNativeFlowWindow;private readonly resolve:typeof resolvePilotMigration;
 private stopped=false;private working=false;private sourceAdmissionStopReason:string|null=null;private maximumSimultaneous=0;private lastDispatchAt=0;private lastOutcome:string|null=null;private nextCeilingRefreshAt=0;private lastAuditAt:number|null=null;private lastPredictiveAt:number|null=null;private lastAdmissionDeferralBucket=-1;
 private readonly activeDecisions:Array<{at:number;mint:string;stage:string;reason:string}>=[];
 private readonly activeCounters={adaptivePredictiveAssessments:0,adaptivePredictiveNotRejected:0,adaptivePredictiveFailed:0,adaptivePredictiveUnavailable:0};
 private readonly decisions:Array<{at:number;mint:string;stage:string;reason:string}>=[];
 private readonly pendingGapRetirements:Array<{row:{mint?:string;at:number;reason:string};targets:Array<{mint:string;candidate:Candidate}>;contentionReported:boolean}>=[];
 private readonly nativeActivityHints=new NativeActivityHintQueue<Candidate>();
 private readonly failureDiagnostics:NativeCandidateFailureDiagnostics;
 private counters={migrationHints:0,verificationQueueRefusals:0,verificationAttempts:0,verifiedOrigins:0,verificationRefusals:0,normalizedEvents:0,qualityGaps:0,featureViews:0,auditedWindows:0,predictiveAssessments:0,predictiveFailed:0,predictiveNotRejected:0,predictiveUnavailable:0,auditUnavailable:0,auditUnusable:0,decisionDeadlineMisses:0,auditFenceWarmingWindows:0,uniqueEvaluated:0,strictV2BaselineUnavailableViews:0,protocolAwareShadowViews:0};
 constructor(private readonly options:NativeRunnerOptions){
  this.dataContract=nativeFlowDataContract(options.flow.usage().dataContract);this.now=options.now??Date.now;this.registry=options.registry??new MarketRegistry(':memory:',{now:this.now});this.runScope='native-runner:'+(options.runId??randomUUID())+':'+randomUUID();this.productivity=new NativeSlotProductivity({registry:this.registry,sourceInstanceId:this.runScope,runId:options.runId,startedAt:this.now(),maximumSlots:options.maximumDeep??6,record:options.record});this.failureDiagnostics=new NativeCandidateFailureDiagnostics(this.now());this.audit=options.audit??auditNativeFlowWindow;this.resolve=options.resolve??resolvePilotMigration;this.observationAgePolicy=observationAgePolicyByVersion(options.observationAgePolicy);this.currentPoolObservation=options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION&&this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY;
  const restored=options.restoredWatch===undefined?undefined:structuredClone(options.restoredWatch) as any;
  if(restored&&Array.isArray(restored.rows))for(const row of restored.rows)if(row.capacityCoverage){options.record('native-watch-source-contract-transition',{at:this.now(),mint:row.mint,priorCoverage:row.capacityCoverage,priorContract:'selected-hints-with-per-transaction-enrichment',newContract:this.dataContract,reason:'old transaction-count-to-RPC estimate does not describe native transport; current support, subscription and independent audit still required',freshFullWindowRequired:true,financialPermission:false});delete row.capacityCoverage;}
  this.watch=new PilotWatch({...(options.enforceTokenAge24h?{enforceTokenAge24h:true as const}:{}),registry:this.registry,observationAgePolicy:this.observationAgePolicy.version,maximumDeep:options.maximumDeep??6,now:this.now,record:options.record,restored});
  // Legacy checkpoint rows are migrated once; durable watch/queue state is already indexed.
  if(restored&&Array.isArray(restored.rows))for(const row of restored.rows as WatchRow[])if(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state))this.queueProof(row,this.now());
  if(this.currentPoolObservation){this.releaseArchiveDeferrals(this.now());this.record('native-current-pool-observation-policy',{at:this.now(),archivalCreationRequired:false,automaticOriginRequests:false,historicalAgeMayBeUnknown:true,currentSupportedAccountsRequired:true,actualAckAndIndependentAuditRequired:true,financialPermission:false});}
 }
 private record(kind:string,data:unknown){this.options.record(kind,data);}
 private noteFailure(kind:NativeCandidateFailureKind,mint:string|undefined,reason:unknown,at:number,c?:Candidate,target?:{end:number;deadlineAt:number},result?:NativeFlowAuditResult){
  const end=target?.end??c?.auditSession?.windowEndAt??c?.lastReadyWindowEnd,trace=c?.auditDispatch&&c.auditDispatch.windowEndAt===end?c.auditDispatch:undefined,deadlineAt=target?.deadlineAt??c?.auditSession?.deadlineAt??trace?.deadlineAt;
  if(mint){this.productivity.unusable(mint,at,String(reason));if(end)this.productivity.failed(mint,end,at,kind,String(reason));if(c&&(end||this.currentPoolObservation&&PRE_OBSERVATION_POOL_REFUSALS.has(String(reason)))&&(this.watch.lookupIdentity(mint,at)?.verifiedAt!==null||this.currentPoolObservation))this.watch.noteEvaluation(mint,{kind:'technical-unavailable',windowEndAt:end||null,evidence:end?String(reason).slice(0,512):JSON.stringify({reason:String(reason),pool:c.identity.pool,supportRefusedAt:at,completedWindow:false})},at);}
  this.failureDiagnostics.observe({kind,mint,reason,at,windowEndAt:end,deadlineAt,lastDispatchReason:trace?.lastState.reason,lastDispatchAction:trace?.lastState.nextAction,lastSchedulerReason:trace?.lastState.context.dispatchReason,lastDispatchAt:trace?.lastAt,firstReadyAt:trace?.firstReadyAt,logicalHistoryCalls:result?.requestAttempts,auditResultStatus:result?.status});
  if(mint&&kind!=='quality-gap'){const view=this.options.flow.snapshot(mint,at),features=view?.features&&view.features.windowEndAt===end?view.features:null,code=this.failureDiagnostics.snapshot().recent.at(-1)?.reasonCode??'OTHER_UNEXPORTED_REASON';this.opportunity(mint,at,features,{kind:'missing-data',reason:code,qualified:false},true);}
 }
 private opportunity(mint:string,at:number,features:FlowFeatures|null,decision:{kind:string;reason:string;qualified:false;assessments?:unknown;components?:unknown},technicalFailure:boolean){
  if(this.options.activeStrategy!==LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION)return;
  const evidence=features?this.options.activeEvidence?.(mint,at)??null:null,flow=evidence?.flow;
  const auditedFlow=flow&&features&&flow.windowStartAt===features.windowStartAt&&flow.windowEndAt===features.windowEndAt?flow:null;
  this.record('native-opportunity-evaluation',{version:'poe-opportunity-evaluation-v1',...(this.options.runId?{runId:this.options.runId}:{}),mint,at,stage:'preliminary',strategyVersion:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,features,auditedFlow,normalAllocation:null,baselineMarket:null,selectedMarket:null,sizing:null,decision,technicalFailure,providerRequests:0,financialQualification:false,fillClaimed:false});
 }
 private auditDispatchSummary(c:Candidate){const t=c.auditDispatch;return t?{version:NATIVE_AUDIT_DISPATCH_DIAGNOSTICS.version,windowEndAt:t.windowEndAt,decisionDeadlineAt:t.deadlineAt,firstReadyAt:t.firstReadyAt,lastAt:t.lastAt,reasonCounts:{...t.reasonCounts},transitionRecords:t.transitionRecords,omittedTransitions:t.omittedTransitions,lastState:structuredClone(t.lastState),final:t.final}:null;}
 private finishAuditDispatch(c:Candidate,outcome:string,at=this.now()){const t=c.auditDispatch;if(!t||t.final)return;t.final=true;this.record('native-audit-dispatch-summary',{mint:c.identity.baseMint,pool:c.identity.pool,at,outcome,...this.auditDispatchSummary(c),physicalSettlementClaimed:false});}
 /** At most one current target per live candidate, sixteen changed states plus
  * its final summary. Repeated50ms waits only update bounded scalar counts. */
 private traceAuditDispatch(candidates:readonly Candidate[],at:number,reason:AuditDispatchReason,nextAction:string,context:Record<string,unknown>={}){
  for(const c of candidates){if(reason==='eligible'&&c.auditSession&&c.auditSession.windowEndAt!==c.lastReadyWindowEnd)continue;const end=c.auditSession?.windowEndAt??c.lastReadyWindowEnd;if(!end||end<=c.lastAssessmentEnd)continue;
   if(c.auditDispatch?.windowEndAt!==end){this.finishAuditDispatch(c,'superseded-target',at);c.auditDispatch={windowEndAt:end,deadlineAt:end+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs,firstReadyAt:end===c.lastReadyWindowEnd?c.lastReadyObservedAt:at,lastAt:at,lastState:{reason,nextAction,context:{}},reasonCounts:{},transitionRecords:0,omittedTransitions:0,stateKey:'',final:false};}
   if(reason==='eligible')this.productivity.ready(c.identity.baseMint,end,at);else if(reason!=='page-response'){const provider=(Number(context.providerCooldownUntil??0)>at||Number(context.historyCooldownUntil??0)>at||nextAction==='await-history-provider-or-query-cooldown');this.productivity.waiting(c.identity.baseMint,at,provider,nextAction);}
   const t=c.auditDispatch;if(t.final)continue;const localReason=reason==='audit-selected'&&context.selectedMint!==c.identity.baseMint?'peer-selected':reason,localAction=localReason==='peer-selected'?'await-selected-peer-audit-page':nextAction;t.lastAt=at;t.reasonCounts[localReason]=(t.reasonCounts[localReason]??0)+1;t.lastState={reason:localReason,nextAction:localAction,context:{...context,readyOrder:candidates.indexOf(c),readyCandidates:candidates.length,page:c.auditSession?.session.pending()?.page??null,sessionOpened:c.auditSession!==undefined}};
   const key=JSON.stringify([localReason,localAction,context.selectedMint??null,t.lastState.context.page]);if(key===t.stateKey)continue;t.stateKey=key;if(t.transitionRecords>=NATIVE_AUDIT_DISPATCH_DIAGNOSTICS.maximumTransitionRecordsPerTarget){t.omittedTransitions++;continue;}t.transitionRecords++;this.record('native-audit-dispatch-state',{mint:c.identity.baseMint,pool:c.identity.pool,at,windowEndAt:end,decisionDeadlineAt:t.deadlineAt,firstReadyAt:t.firstReadyAt,remainingDecisionMs:t.deadlineAt-at,...t.lastState,transitionRecord:t.transitionRecords,physicalStartClaimed:false});
  }
 }
 private auditGateWaitAction(usage:ReturnType<Rpc['usage']>,gate:ReturnType<Rpc['usage']>['dispatchWindow'],pacingAction:string){return usage.inFlight!==0||usage.waitingOrOperating?'await-physical-settlement':gate?.physicalBusy?'await-shared-gate-recovery':pacingAction;}
 private auditDispatchContext(at:number,usage:ReturnType<Rpc['usage']>,flow:ReturnType<Flow['usage']>){const rpc=usage.rpcDispatchWindow??usage.dispatchWindow,control=usage.controlDispatchWindow??usage.dispatchWindow;return {rpcReadyAt:rpc?.readyAt??null,historyReadyAt:(usage.historyDispatchWindow??rpc)?.readyAt??null,controlReadyAt:control?.readyAt??null,physicalBusy:rpc?.physicalBusy??null,actualPhysicalBusy:rpc&&'actualPhysicalBusy'in rpc?rpc.actualPhysicalBusy:null,inFlight:usage.inFlight,waitingOrOperating:usage.waitingOrOperating,rolling60SecondStarts:usage.chapterUsage?.rolling60SecondStarts??null,rolling10SecondStarts:usage.chapterUsage?.rolling10SecondStarts??null,startsPerMinuteLimit:usage.requestLimits?.maxStartsPerMinute??null,startsPer10SecondLimit:usage.requestLimits?.maxStartsPer10s??null,providerCooldownUntil:usage.cooldownUntil??null,historyCooldownUntil:usage.historyCooldownUntil??null,controlCooldownUntil:usage.controlCooldownUntil??null,nextNativeServiceAt:Number.isFinite(flow.nextServiceAt)?flow.nextServiceAt:null,nextNativeServiceDomain:flow.nextServiceDomain??null,nextNativeServiceAction:(flow as {nextServiceAction?:string|null}).nextServiceAction??null,nativeServiceSlackMs:Number.isFinite(flow.nextServiceAt)?flow.nextServiceAt-200-at:null,pageOperationBoundMs:NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs};}
 private open(){return !this.stopped&&this.sourceAdmissionStopReason===null&&(this.options.admissionOpen?.()??true);}
 private sourceWorkAllowed(bound:number){return this.open()&&(this.options.sourceWorkAdmission?.(bound)??true);}
 private registryHousekeeping(phase:'native-activity'|'migration-delivery'|'pool-progress'|'committed-activity'|'allocation',work:()=>void){
  try{work();}catch(error){
   if(!isMarketRegistryContention(error))throw error;
   this.record('native-candidate-housekeeping-deferred',{at:this.now(),phase,reason:'MARKET_REGISTRY_CONTENTION',sqliteCode:error.sqliteCode,callbackStarted:false,providerPermissionGranted:false,financialPermission:false});
  }
 }
 private async serviceFlow(signal:AbortSignal|undefined,deadlineAt:number,policy:{allowSetup:boolean;allowRetirement:boolean}){
  const plan=this.options.flow.servicePlan?.(policy),action=plan?.action??(this.options.flow.usage() as {nextServiceAction?:string|null}).nextServiceAction;
  const bound=action==='heartbeat'||action==='peer-pong'?NATIVE_DEADLINE_POLICY.heartbeatOperationMs:NATIVE_DEADLINE_POLICY.nativeOperationMs;
  if(!this.sourceWorkAllowed(bound)){this.traceAuditDispatch(this.readyAudits(this.now()),this.now(),'native-service-wait','await-financial-operation-runway',{operationBoundMs:bound,action:action??null});return {kind:'deferred',reason:'NATIVE_SOURCE_FINANCIAL_RUNWAY'};}
  return this.options.flow.service(signal,{...this.admission(deadlineAt),operationBoundMs:bound,admissionOpen:()=>this.sourceWorkAllowed(bound)&&this.now()<deadlineAt},policy);
 }
 /** Discovery capture is independent of discretionary provider/entry admission.
  * The durable queue is awareness, not permission to start RPC work. */
 private hasOrigin(mint:string){return this.origins.has(mint)||this.registry.hasOrigin(mint);}
 private queueProof(row:WatchRow,at:number){
  if(this.currentPoolObservation)return;
  if(row.mint&&this.hasOrigin(row.mint)||['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state))return;
  const inserted=this.registry.enqueueVerification({signature:row.signature,...(row.mint??row.feedMint?{feedMint:(row.mint??row.feedMint)!}:{}),receivedAt:Math.min(at,row.firstSeenAt)});
  if(inserted&&row.deferUntil>at)this.registry.deferVerification(row.signature,row.deferUntil,row.reason);
  if(inserted&&row.verifiedAt!==null)this.record('native-known-origin-proof-queued',{at,mint:row.mint,signature:row.signature,reason:'retained identity lacks creation-proof bytes; exact known signature requires confirmed/finalized verification',awarenessRetained:true,deepAdmissionAllowed:false});
 }
 private nextVerification(at:number):PilotMigrationSeed|undefined{
  if(this.currentPoolObservation)return;
  // Each indexed retrieval retires/defer only the selected item. No registry-sized
  // array or queue truncation is involved and a provider request is never started here.
  const maintenanceStarted=performance.now();while(performance.now()-maintenanceStarted<4){const seed=this.registry.nextVerification(at);if(!seed)return;
   const row=this.watch.lookupIdentity(seed.signature,at);
   if(!row||row.mint&&this.hasOrigin(row.mint)||['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state)){this.registry.removeVerification(seed.signature,at,!row?'missing watch identity':row.state);this.record('native-verification-queue-retired',{signature:seed.signature,at,reason:!row?'watch identity no longer retained':row.state,requestStarted:false});continue;}
   if(row.deferUntil>at){this.registry.deferVerification(seed.signature,row.deferUntil,row.reason);continue;}return seed;
  }
 }
 onMigration(seed:PilotMigrationSeed){
  if(this.options.marketIntake){this.options.marketIntake.observeMigration(seed);this.counters.migrationHints++;return;}
  this.applyMigration(seed);this.counters.migrationHints++;
 }
 private applyMigration(seed:PilotMigrationSeed){
  const at=this.now();
  this.registry.transaction(()=>{const row=this.watch.discover(seed);if(row){if(this.currentPoolObservation&&seed.feedMint){this.observeCurrentHint({mint:seed.feedMint,signature:seed.signature,receivedAt:seed.receivedAt,source:'migration-provider-hint'});this.watch.noteMigrationHint(seed.feedMint,{signature:seed.signature,receivedAt:seed.receivedAt},at);}else this.queueProof(row,at);}});
 }
 private drainMigrationDelivery(){
  if(!this.options.marketIntake||!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs)||!this.registry.nextMigrationDelivery())return;
  // The worker committed the original hint. Apply exactly one indexed item
  // under the main writer lease, and acknowledge it in that same transaction.
  // A refusal leaves the durable item pending; restart cannot lose the hint.
  this.registry.transaction(()=>{const seed=this.registry.nextMigrationDelivery();if(!seed)return;this.applyMigration(seed);this.registry.completeMigrationDelivery(seed.signature);});
 }
 private observeCurrentHint(hint:{mint:string;signature?:string;receivedAt:number;source:string}){
  const at=this.now();let pool:string;
  try{pool=canonicalObservationPool(hint.mint);}
  catch(error){this.registry.markDistinct('native-current-hint-invalid',hint.mint,at);this.record('native-current-observation-hint-refused',{at,mint:hint.mint,reason:safe(error),archivalFallback:false,financialPermission:false});return;}
  // Storage/contention failures must retain their source-recovery semantics;
  // they do not establish an invalid mint and cannot become a permanent filter.
  let signature=hint.signature??'current-pool:'+hint.mint;const historicalSeed=this.watch.lookupIdentity(signature,at);
  // A legacy structural refusal described that exact historical transaction,
  // whose provisional mint was never proved. Keep the refusal unbound instead
  // of turning it into a permanent exclusion of a current canonical scope.
  if(historicalSeed?.state==='PERMANENTLY_UNSUPPORTED'&&historicalSeed.mint===null)signature='current-pool:'+hint.mint;
  const row=this.watch.observeIdentity(signature,{mint:hint.mint,pool,availableAt:hint.receivedAt,evidence:('unverified current-pool scope hint from '+hint.source).slice(0,512)});this.watch.releaseArchiveDeferral(row.mint!,at);this.watch.releaseLegacyCapacityGate(row.mint!,at);return row;
 }
 private releaseArchiveDeferrals(at:number){
  if(!this.legacyObservationRepairPending)return;
  const began=performance.now(),rows=this.registry.queryRows({where:"w.mint IS NOT NULL AND (w.capacity_status IS NOT NULL OR (w.state='DEFERRED' AND (json_extract(w.body,'$.reason') LIKE 'known origin proof unavailable:%' OR json_extract(w.body,'$.reason')='durable origin quarantined; canonical creation re-verification required' OR (w.verified_at IS NULL AND EXISTS(SELECT 1 FROM verification_queue q WHERE q.signature=w.signature AND q.state='PENDING' AND q.attempts>0 AND q.last_reason=json_extract(w.body,'$.reason') AND q.not_before=w.defer_until)))))",orderBy:'w.signature',limit:128});if(!rows.length){this.legacyObservationRepairPending=false;return;}this.registry.transaction(()=>{for(const row of rows){if(performance.now()-began>=NATIVE_DEADLINE_POLICY.postValidationMs)break;if(row.mint){this.watch.releaseArchiveDeferral(row.mint,at);this.watch.releaseLegacyCapacityGate(row.mint,at);}}});
 }
 private prepareCurrentObservation(at:number){
  if(!this.currentPoolObservation)return false;const hint=this.registry.nextObservationCandidate(at);if(!hint)return false;
  const row=this.observeCurrentHint(hint);if(!row)return false;if(hint.activityAt!==null)this.watch.noteActivity(hint.mint,hint.activityAt,'unverified-provider-activity-hint');this.record('native-current-observation-selected',{at,mint:hint.mint,pool:row.pool,source:hint.source,historyKnown:row.migrationAt!==null,archivalCreationRequired:false,currentSupportedAccountsRequired:true,providerRequestStarted:false,financialPermission:false});return true;
 }
 onMarketIdentity(row:MarketIdentityHint){if(this.options.marketIntake){this.options.marketIntake.observeIdentity(row);return;}this.registry.observeIdentity(row);}
 onMarketActivity(row:MarketActivityHint){if(this.options.marketIntake){this.options.marketIntake.observeActivity(row);return;}this.registry.transaction(()=>{this.registry.observeActivity(row);this.onActivity({mint:row.mint,at:row.receivedAt,evidence:row.evidence});});}
 onMarketFeed(row:MarketFeedStatus){if(this.options.marketIntake){this.options.marketIntake.observeFeed(row);return;}this.registry.observeFeed(row);}
 /** ACKs confirm the worker committed the global hints. Pending application is
  * represented by the indexed database difference, not an in-memory universe
  * of token identities. Lost ACKs/restarts therefore do not lose watch progress. */
 onMarketActivityCommitted(rows:readonly {mint:string;at:number;evidence:string}[]){if(rows.length)this.committedActivityPending=true;}
 /** Native trade/window evidence is already ingested independently. Only the
  * optional watch-priority update is deferred out of the WS callback. */
 onNativeActivity(row:NativeActivityHint){
  need(row.at<=this.now(),'NATIVE_ACTIVITY_HINT_FUTURE');const candidate=this.candidates.get(row.mint);if(candidate)this.nativeActivityHints.enqueue(row,candidate,(mint,generation)=>this.candidates.get(mint)===generation);
 }
 private drainNativeActivity(){
  if(!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs))return;const began=performance.now();
  while(performance.now()-began<NATIVE_DEADLINE_POLICY.postValidationMs){
   const pending=this.nativeActivityHints.next((mint,generation)=>this.candidates.get(mint)===generation);if(!pending)return;let callbackStarted=false;
   try{this.registry.transaction(()=>{callbackStarted=true;this.onActivity(pending.row);});this.nativeActivityHints.complete(pending);}
   catch(error){if(callbackStarted||!isMarketRegistryContention(error)){this.nativeActivityHints.discard(pending);this.record('native-activity-hint-unavailable',{mint:pending.row.mint,at:this.now(),originalActivityAt:pending.row.at,reason:safe(error),independentNativeEvidenceRetained:true,financialPermission:false});}throw error;}
  }
 }
 private drainPoolSourceProgress(){
  if(!this.currentPoolObservation||!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs))return;
  const at=this.now(),rows=this.registry.nextPoolSourceProgress(at);if(!rows.length)return;const began=performance.now();
  this.registry.transaction(()=>{for(const row of rows){if(performance.now()-began>=NATIVE_DEADLINE_POLICY.postValidationMs)break;this.watch.notePoolHintProgress(row.mint,at);}});
 }
 private drainCommittedActivity(){if(!this.options.marketIntake||!this.committedActivityPending||!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs))return;if(!this.registry.nextWatchActivities(1).length){this.committedActivityPending=false;return;}const began=performance.now();this.registry.transaction(()=>{const rows=this.registry.nextWatchActivities(16);if(!rows.length){this.committedActivityPending=false;return;}for(const row of rows){if(performance.now()-began>=5)break;this.onActivity(row);}});}
 /** Select one measured shared-stream opportunity only when the existing
  * origin-work dispatcher has actual spare runway. A trade signature is a
  * lookup hint: only the unchanged confirmed/finalized resolver may prove an
  * actual canonical pool creation. All other tokens stay durably discoverable. */
 private enqueueActivityOrigin(at:number){
  if(this.currentPoolObservation)return;
  const selected=this.registry.nextOriginCandidate(at);if(!selected)return;
  const seed={signature:selected.signature,feedMint:selected.mint,receivedAt:selected.receivedAt};
  this.registry.transaction(()=>{const row=this.watch.discover(seed);if(!row||row.mint&&this.hasOrigin(row.mint))return;
   this.watch.transition(row.signature,'DISCOVERED','shared activity hint selected for bounded canonical-origin lookup; creation remains unverified',at);
   const inserted=this.registry.enqueueVerification(seed,selected.priority,{source:selected.source,kind:'activity-origin-lookup'});
   if(inserted)this.record('native-shared-activity-origin-lookup-selected',{at,...selected,reason:'positive measured shared activity and spare existing origin-work runway; independently confirmed/finalized canonical creation still required',hintIsCanonicalProof:false,providerRequestStarted:false,financialPermission:false});
  });
 }
 /** Genuine creation proofs can be transported as public input. Identity is
  * decoded again; current pool support is always obtained by the native adapter. */
 importOrigin(origin:NativeOrigin){
  const at=this.now();let id:MigrationIdentity;
  try{
   need(origin&&typeof origin==='object'&&origin.originConfirmed&&origin.originFinalized,'NATIVE_ORIGIN_BODY_UNAVAILABLE');
   need(Number.isSafeInteger(origin.originConfirmed.availableAt)&&Number.isSafeInteger(origin.originFinalized.availableAt)&&origin.originConfirmed.availableAt>=0&&origin.originFinalized.availableAt>=0&&origin.originConfirmed.availableAt<=at&&origin.originFinalized.availableAt<=at,'NATIVE_ORIGIN_FUTURE');
   const confirmed=decodeMigrationIdentity(origin.originConfirmed.transaction,{signature:origin.originConfirmed.signature,commitment:'confirmed',availableAt:origin.originConfirmed.availableAt});
   const finalized=decodeMigrationIdentity(origin.originFinalized.transaction,{signature:origin.originFinalized.signature,commitment:'finalized',availableAt:origin.originFinalized.availableAt});
   need(confirmed.ok&&finalized.ok,'NATIVE_ORIGIN_CREATION_UNVERIFIED');need(stable(confirmed.identity)===stable(finalized.identity),'NATIVE_ORIGIN_CHANGED');need(finalized.identity.classification==='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT','NATIVE_ORIGIN_NOT_CANONICAL_SOL');id=finalized.identity;
  }catch(error){
   if(!this.currentPoolObservation)throw error;
   const signature=(value:unknown)=>typeof value==='string'&&value.length<=100&&!/[\u0000-\u001f]/.test(value)?value:null,confirmedSignature=signature(origin?.originConfirmed?.signature),finalizedSignature=signature(origin?.originFinalized?.signature);
   // Storage reads and recording deliberately remain outside the pure decoder
   // boundary. Contention/corruption are source failures, not malformed archives.
   const row=confirmedSignature?this.watch.lookupIdentity(confirmedSignature,at):undefined;
   this.record('native-optional-origin-import-refused',{at,mint:row?.mint??null,pool:row?.pool??null,confirmedSignature,finalizedSignature,reason:safe(error),optionalArchiveIgnored:true,retainedObservationUnchanged:true,currentSupportedAccountsRequired:true,archivalRefetchQueued:false,financialPermission:false});return;
  }
  if(this.currentPoolObservation){const retained=this.watch.lookupIdentity(id.baseMint,at),seed=this.watch.lookupIdentity(id.signature,at);if(retained&&(retained.pool!==id.pool||retained.migrationAt!==null&&retained.migrationAt!==id.chainBlockTime*1000)||seed?.mint&&seed.mint!==id.baseMint){this.record('native-optional-origin-import-refused',{at,mint:id.baseMint,pool:id.pool,confirmedSignature:origin.originConfirmed.signature,finalizedSignature:origin.originFinalized.signature,reason:'NATIVE_ORIGIN_RETAINED_IDENTITY_CONFLICT',optionalArchiveIgnored:true,retainedObservationUnchanged:true,currentSupportedAccountsRequired:true,archivalRefetchQueued:false,financialPermission:false});return;}}
  this.watch.discover({signature:id.signature,feedMint:id.baseMint,receivedAt:at});this.acceptIdentity(id,id.signature,at);
  if(origin.olderSelection&&!this.watch.lookupIdentity(id.baseMint,at)?.olderResearch){try{this.watch.selectOlderResearch(id.baseMint,origin.olderSelection,at);}catch(error){this.record('native-imported-older-selection-unavailable',{at,mint:id.baseMint,reason:safe(error),originalSelection:origin.olderSelection,strictIdentityRetained:true,freshActivityStillRequired:true,entryPermission:false});}}
  this.storeOrigin(id,origin);
  this.record('native-origin-import',{at,identity:id,proof:{originConfirmed:origin.originConfirmed,originFinalized:origin.originFinalized},currentSupportVerified:false,financialPermission:false});
 }
 private acceptIdentity(id:MigrationIdentity,seedSignature:string,at:number){this.watch.verify(seedSignature,{mint:id.baseMint,pool:id.pool,migrationAt:id.chainBlockTime*1000,verifiedAt:at});if(this.registry.markDistinct(this.runScope+':verified',id.signature,at))this.counters.verifiedOrigins++;}
 private storeOrigin(id:MigrationIdentity,origin:NativeOrigin){this.registry.putOrigin(id.baseMint,{...structuredClone(origin),identity:structuredClone(id)});if(this.candidates.has(id.baseMint)||this.options.financialOwnership?.(id.baseMint)){this.origins.set(id.baseMint,structuredClone(id));this.originProofs.set(id.baseMint,structuredClone(origin));}}
 private origin(mint:string):MigrationIdentity|undefined{
  const hot=this.origins.get(mint);if(hot)return hot;
  try{
   const saved=this.registry.getOrigin<NativeOrigin&{identity?:MigrationIdentity}>(mint),row=this.watch.lookupIdentity(mint,this.now());need(saved&&row&&saved.originConfirmed&&saved.originFinalized&&Number.isSafeInteger(saved.originConfirmed.availableAt)&&Number.isSafeInteger(saved.originFinalized.availableAt),'NATIVE_DURABLE_ORIGIN_BODY_UNAVAILABLE');
   need(saved.originConfirmed.availableAt<=this.now()&&saved.originFinalized.availableAt<=this.now(),'NATIVE_DURABLE_ORIGIN_FUTURE');
   let id=saved.identity;
   if(this.resolve===resolvePilotMigration){
    const confirmed=decodeMigrationIdentity(saved.originConfirmed.transaction,{signature:saved.originConfirmed.signature,commitment:'confirmed',availableAt:saved.originConfirmed.availableAt}),finalized=decodeMigrationIdentity(saved.originFinalized.transaction,{signature:saved.originFinalized.signature,commitment:'finalized',availableAt:saved.originFinalized.availableAt});
    need(confirmed.ok&&finalized.ok&&stable(confirmed.identity)===stable(finalized.identity),'NATIVE_DURABLE_ORIGIN_PROOF_MISMATCH');
    need(!id||stable(finalized.identity)===stable(id),'NATIVE_DURABLE_ORIGIN_IDENTITY_MISMATCH');
    id=finalized.identity;
    if(JSON.stringify(saved.identity)!==JSON.stringify(id)){
     const priorIdentitySha256=createHash('sha256').update(JSON.stringify(saved.identity??null)).digest('hex'),proofSha256=createHash('sha256').update(JSON.stringify({originConfirmed:saved.originConfirmed,originFinalized:saved.originFinalized})).digest('hex'),key='origin-metadata-rehydration:'+mint+':'+priorIdentitySha256;
     if(!this.registry.getMetadata(key)){const receipt={at:this.now(),mint,priorIdentitySha256,canonicalIdentitySha256:createHash('sha256').update(stable(id)).digest('hex'),proofSha256,correction:'derive canonical identity from unchanged strict confirmed/finalized creation bytes; request metadata and feed hint role excluded from chain comparison',originalProofUnchanged:true,financialWriterOpened:false};this.registry.setMetadata(key,receipt);this.record('native-origin-metadata-rehydrated',receipt);}
    }
   }
   need(id&&id.baseMint===mint&&id.pool===row.pool&&id.chainBlockTime*1000===row.migrationAt&&id.classification==='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT','NATIVE_DURABLE_ORIGIN_IDENTITY_MISMATCH');
   this.origins.set(mint,id);this.originProofs.set(mint,{originConfirmed:saved.originConfirmed,originFinalized:saved.originFinalized,...(saved.olderSelection?{olderSelection:saved.olderSelection}:{})});return id;
  }catch(error){
   const reason=error instanceof SyntaxError?'NATIVE_DURABLE_ORIGIN_BODY_UNAVAILABLE':safe(error);if(!reason.startsWith('NATIVE_DURABLE_ORIGIN_'))throw error;
   const at=this.now(),row=this.watch.lookupIdentity(mint,at);this.registry.transaction(()=>{this.registry.archiveOrigin(mint,reason,at);if(row&&!this.currentPoolObservation){this.watch.transition(mint,'DEFERRED','durable origin quarantined; canonical creation re-verification required',at);this.registry.requeueVerification({signature:row.signature,feedMint:mint,receivedAt:Math.min(row.firstSeenAt,at)},at,reason);}});
   this.record('native-origin-proof-quarantined',{at,mint,reason,originalProofRetained:true,canonicalReverificationQueued:!!row&&!this.currentPoolObservation,observationIndependent:this.currentPoolObservation,otherCandidatesContinue:true,financialPermission:false});return;
  }
 }
 onCurrentPoolValidated(support:ResearchClockNativeObservationSupport){if(!this.candidates.has(support.mint))return;this.watch.currentPoolValidated(nativeCurrentPoolIdentityProof(support,this.now()));}
 onFlowOpen(row:{mint:string;at:number}){this.certificates.delete(row.mint);const c=this.candidates.get(row.mint);if(c){this.productivity.opened(row.mint,row.at);this.finishAuditDispatch(c,'new-ack-generation',row.at);delete c.auditDispatch;delete c.historyCache;c.openedAt=row.at;c.lastFeatureEnd=0;c.lastAssessmentEnd=0;c.lastReadyWindowEnd=0;c.lastReadyObservedAt=0;c.lastExpiredWindowEnd=0;c.lastAuditFenceWarmingWindowEnd=0;c.auditPageRetryAt=0;c.readinessCheckedEnd=0;c.checkedAuditable=false;this.record('native-candidate-observation-open',{mint:row.mint,at:row.at,actualAcknowledgment:true,freshWindowRequired:true});}}
 /** A one-shot ACK callback can meet a busy registry writer. Reconcile only
  * the current native scope's actual ACK, retaining its original timestamp;
  * no subscription or observation completeness is inferred from allocation. */
 private reconcileFlowOpen(){
  if(!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs))return;
  const capture=(mint:string,at:number)=>this.options.flow.captureState?this.options.flow.captureState(mint,at):this.options.flow.snapshot(mint,at);
  const valid=(mint:string,c:Candidate,view:ReturnType<typeof capture>,at:number)=>!!view&&view.scope.mint===mint&&view.scope.pool===c.identity.pool&&view.connected===true&&view.sourceSupportFresh===true&&!view.suspended&&!view.hasQualityLoss&&Number.isSafeInteger(view.openedAt)&&view.openedAt!>=c.allocatedAt&&(c.openedAt===null||view.openedAt!>=c.openedAt)&&view.openedAt!<=at&&Number.isSafeInteger(view.connectionId)&&view.connectionId!>=0&&Number.isSafeInteger(view.subscription)&&view.subscription!>=0;
  for(const [mint,c]of this.candidates){const at=this.now(),view=capture(mint,at);if(!valid(mint,c,view,at)||c.openedAt===view!.openedAt)continue;
   this.registry.transaction(()=>{const current=capture(mint,this.now());if(this.candidates.get(mint)!==c||!valid(mint,c,current,this.now())||current!.openedAt!==view!.openedAt||current!.connectionId!==view!.connectionId||current!.subscription!==view!.subscription)return;this.onFlowOpen({mint,at:current!.openedAt!});});
  }
 }
 onTrade(){this.counters.normalizedEvents++;}
 onActivity(row:{mint:string;at:number;evidence:string}){const at=this.now(),known=this.watch.lookupIdentity(row.mint,at);if(known?.migrationAt!==null&&known?.migrationAt!==undefined&&at-known.migrationAt>=PROVISIONAL_RULE.maximumAgeMs&&!['HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED'].includes(known.state)&&(!known.olderResearch||known.state==='EXPIRED')){try{this.watch.selectOlderResearch(row.mint,{observedAt:row.at,evidence:row.evidence},at);}catch(error){this.record('native-older-observation-selection-refused',{mint:row.mint,at,reason:safe(error),entryPermission:false});}}this.watch.noteActivity(row.mint,row.at,row.evidence);const current=this.watch.lookupIdentity(row.mint,at);if(!this.currentPoolObservation&&current&&!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(current.state)&&!this.hasOrigin(row.mint))this.queueProof(current,at);}
 private pruneProofCache(_at:number){for(const mint of this.origins.keys()){if(this.candidates.has(mint)||this.options.financialOwnership?.(mint))continue;this.origins.delete(mint);this.originProofs.delete(mint);}}
 onGap(row:{mint?:string;at:number;reason:string},options:{deferRegistryWrites?:boolean}={}){
  const mints=row.mint?[row.mint]:[...this.candidates.keys()],targets=mints.flatMap(mint=>{const candidate=this.candidates.get(mint);return candidate&&!this.pendingGapRetirements.some(p=>p.targets.some(t=>t.mint===mint&&t.candidate===candidate))?[{mint,candidate}]:[];});
  if(!targets.length){if(!mints.length){this.counters.qualityGaps++;this.noteFailure('quality-gap',undefined,row.reason,row.at);this.record('native-candidate-quality-gap',{...row,freshWindowRequired:true,financialExecutionAuthorized:false});}return;}
  // The flow has already suspended this generation. A busy intake writer must
  // not erase its one-shot retirement notification and strand the slot.
  for(const target of targets)this.certificates.delete(target.mint);
  this.pendingGapRetirements.push({row:{...row},targets,contentionReported:false});
  // The native scope is already unusable and financial gap handling remains
  // immediate. The regular coordinator step owns the bounded SQLite mutation.
  if(!options.deferRegistryWrites)this.drainGapRetirements();
 }
 private drainGapRetirements(){
  while(this.pendingGapRetirements.length){const pending=this.pendingGapRetirements[0]!,targets=pending.targets.filter(t=>this.candidates.get(t.mint)===t.candidate);
   if(!targets.length){this.pendingGapRetirements.shift();continue;}
   let callbackStarted=false;
   try{
    // Acquire the existing immediate writer lease before any callback mutates
    // counters, slot state or flow ownership. Only refusal before that callback
    // is retried; storage/logic failures retain their ordinary recovery path.
    this.registry.transaction(()=>{callbackStarted=true;const row=pending.row;this.counters.qualityGaps++;this.noteFailure('quality-gap',row.mint,row.reason,row.at,row.mint?this.candidates.get(row.mint):undefined);this.record('native-candidate-quality-gap',{...row,freshWindowRequired:true,financialExecutionAuthorized:false});for(const target of targets){const gate=this.watch.lookupIdentity(target.mint,this.now())?.reobservation;this.retire(target.mint,row.reason,Math.max(row.at,this.now()),this.currentPoolObservation&&PRE_OBSERVATION_POOL_REFUSALS.has(row.reason)&&gate?.kind==='technical-unavailable'&&gate.windowEndAt===null?0:30000);}});
    this.pendingGapRetirements.shift();
   }catch(error){if(callbackStarted||!isMarketRegistryContention(error)){this.pendingGapRetirements.shift();throw error;}if(!pending.contentionReported){pending.contentionReported=true;this.record('native-candidate-gap-retirement-deferred',{at:this.now(),mints:targets.map(t=>t.mint),reason:'MARKET_REGISTRY_CONTENTION',sqliteCode:error.sqliteCode,callbackStarted:false,pendingRetirementRetained:true,providerRequestStarted:false,financialExposure:false});}return false;}
  }
  return true;
 }
 /** Persist logical retirement as one write before changing native ownership.
  * A refused lease retains the exact generation and blocks its further audits;
  * physical occupancy is released only by the native unsubscribe/close ACK. */
 private retire(mint:string,reason:string,at:number,deferMs:number){
  this.certificates.delete(mint);const c=this.candidates.get(mint);if(!c)return true;
  this.retirementRequests.set(mint,{candidate:c,reason,at,deferMs});return this.commitRetirement(mint);
 }
 private commitRetirement(mint:string){
  const request=this.retirementRequests.get(mint);if(!request)return true;
  const c=request.candidate;if(this.candidates.get(mint)!==c){this.retirementRequests.delete(mint);return true;}
  let callbackStarted=false;
  try{this.registry.transaction(()=>{
   callbackStarted=true;const {reason,deferMs}=request,at=Math.max(request.at,this.now());
   const row=this.watch.lookupIdentity(mint,at),owned=this.options.financialOwnership?.(mint);
   if(row&&(owned||!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state)))this.watch.transition(mint,owned??'DEFERRED',reason,at,{deferUntil:Math.max(row.deferUntil,at+deferMs),releaseObservation:true});
   this.productivity.retired(mint,at,reason);
   this.registry.afterCommit(()=>{
    if(this.candidates.get(mint)!==c)return;
    this.finishAuditDispatch(c,'candidate-retired:'+reason,at);
    if(c.auditSession){const active=c.auditSession;active.session.cancel('NATIVE_AUDIT_CANDIDATE_RETIRED');need(this.cancelledAuditDiagnostics.length<6,'NATIVE_AUDIT_DIAGNOSTIC_BOUND');this.cancelledAuditDiagnostics.push({mint,targetEndAt:active.windowEndAt,deadlineAt:active.deadlineAt,cancelledAt:at,session:active.session});}
    delete c.auditSession;this.candidates.delete(mint);this.retirementRequests.delete(mint);
    this.options.flow.removeCandidate(mint,reason);this.options.onCandidateRetired?.(mint,reason);
    this.record('native-candidate-retired',{mint,at,reason,allocatedAt:c.allocatedAt,openedAt:c.openedAt,awarenessRetained:true,completeWindows:c.lastAssessmentEnd?1:0});
   });
  });return true;}catch(error){if(!callbackStarted&&isMarketRegistryContention(error))return false;throw error;}
 }
 private observationMember(c:Candidate,at:number){
  const mint=c.identity.baseMint;if(this.candidates.get(mint)!==c||this.retirementRequests.has(mint)||this.pendingGapRetirements.some(p=>p.targets.some(t=>t.mint===mint&&t.candidate===c)))return false;
  if(this.options.enforceTokenAge24h&&!this.options.financialOwnership?.(mint)&&!this.registry.tokenAgeEligibility(mint,at).allowed)return false;
  const row=this.watch.lookupIdentity(mint,at);
  return !!row&&row.pool===c.identity.pool&&row.deepSince===c.allocatedAt&&['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(row.state)&&this.productivity.hasAssignment(mint,c.allocatedAt);
 }
 private reconcileObservationMembership(){
  for(const mint of this.retirementRequests.keys())if(!this.commitRetirement(mint))return false;
  for(const c of [...this.candidates.values()])if(!this.observationMember(c,this.now())){
   const mint=c.identity.baseMint;this.record('native-candidate-membership-invalid',{at:this.now(),mint,allocatedAt:c.allocatedAt,action:'retire-original-generation',freshObservationRequired:true,financialPermission:false});
   if(!this.retire(mint,'observation membership mismatch; fresh allocation required',this.now(),0))return false;
  }
  // Recovery from a partial old transition must retire, not adopt, a physical
  // scope lacking a coordinator owner. Never manufacture a warm observation.
  const orphans=new Set([...(this.options.flow.candidateMints?.()??[]),...this.productivity.assignedMints(),...this.watch.identitiesInStates(['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'],this.now()).filter(row=>row.mint&&!this.candidates.has(row.mint)&&this.watch.lookupIdentity(row.mint,this.now())?.deepSince!=null).flatMap(row=>row.mint?[row.mint]:[])]);
  for(const mint of orphans)if(!this.candidates.has(mint)){
   let started=false;
   try{this.registry.transaction(()=>{
    started=true;const at=this.now(),row=this.watch.lookupIdentity(mint,at),owned=this.options.financialOwnership?.(mint);
    if(row&&!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state))this.watch.transition(mint,owned??(['HELD','ENTRY_PENDING'].includes(row.state)?row.state:'DEFERRED'),'orphan observation owner; fresh allocation required',at,{deferUntil:Math.max(row.deferUntil,at),releaseObservation:true});
    this.productivity.retired(mint,at,'orphan observation owner');this.certificates.delete(mint);
    this.registry.afterCommit(()=>{this.options.flow.removeCandidate(mint,'orphan selected scope; native settlement required');this.options.onCandidateRetired?.(mint,'orphan observation owner');this.record('native-candidate-orphan-retired',{at,mint,physicalCapacityReleased:false,financialPermission:false});});
   });}catch(error){if(!started&&isMarketRegistryContention(error))return false;throw error;}
  }
  return true;
 }
 private async drainCancelledAuditDiagnostics(){for(const item of this.cancelledAuditDiagnostics.splice(0)){await item.session.advance();this.record('native-candidate-audit-cancelled-diagnostic',{mint:item.mint,targetEndAt:item.targetEndAt,deadlineAt:item.deadlineAt,cancelledAt:item.cancelledAt,recordedAt:this.now(),reason:item.session.error(),diagnosticResult:item.session.diagnosticResult(),admitted:false,physicalSettlementClaimed:false,meaning:'Logical cancellation only; original physical gate retains all unsettled work and uncertainty.'});}}
 private admission(deadlineAt:number):PilotRpcCallOptions{return {latestStartAt:Math.min(deadlineAt-1200,this.now()+1200),timeoutMs:1200,admissionOpen:()=>this.open()&&this.now()<deadlineAt};}
 private finishVerification(session:VerificationSession){
  const result=session.result;if(!result)return false;const seed=session.seed,at=this.now();this.verificationSession=null;
  if(result.ok){this.record('native-migration-resolution',result.proof);this.acceptIdentity(result.identity,seed.signature,at);this.storeOrigin(result.identity,{originConfirmed:result.proof.originConfirmed,originFinalized:result.proof.originFinalized});this.registry.removeVerification(seed.signature,at,'verified origin');}
  else if(this.currentPoolObservation){this.counters.verificationRefusals++;this.registry.removeVerification(seed.signature,at,'optional creation archive unavailable; current observation independent');this.record('native-optional-origin-unavailable',{seed,at,reason:result.reason,observationUnchanged:true,financialPermission:false});}
  else{this.counters.verificationRefusals++;const known=this.watch.lookupIdentity(seed.signature,at),structural=known?.verifiedAt===null&&/CUSTOM_QUOTE_OUTSIDE_SCOPE|TOKEN_PROGRAM_OUTSIDE_SCOPE|RETRY_BASE_MINT_REQUIRED|OUTSIDE_PUMP_PROGRAM_FAMILY/.test(result.reason);if(structural){this.watch.transition(seed.signature,'PERMANENTLY_UNSUPPORTED',result.reason,at);this.registry.removeVerification(seed.signature,at,result.reason);}else if(known?.verifiedAt===null)this.watch.deferVerification(seed.signature,result.reason,at);else if(known)this.watch.transition(seed.signature,'DEFERRED',('known origin proof unavailable: '+result.reason).slice(0,180),at,{deferUntil:at+60000});if(!structural){const deferred=this.watch.lookupIdentity(seed.signature,at);this.registry.deferVerification(seed.signature,deferred?.deferUntil??at+60000,result.reason);}this.record('native-migration-refused',{seed,at,reason:result.reason,structuralExactSeedOnly:structural,provisionalMintNotPermanentlyExcluded:true,notPredictiveRejection:true});}
  this.record('native-origin-workflow-settled',{at,signature:seed.signature,startedAt:session.startedAt,elapsedMs:at-session.startedAt,reads:session.reads,result:result.ok?'verified':result.reason,partialProofAdmitted:false});return true;
 }
 /** One existing resolver continuation, not an RPC queue. The resolver retains
  * its original transaction/request timestamps and unchanged six-read/20s cap.
  * Each step admits at most one physical read then returns to shared dispatch. */
 private async verify(seed:PilotMigrationSeed,deadlineAt:number,signal?:AbortSignal){
  let session=this.verificationSession;
  if(!session){this.counters.verificationAttempts++;if(this.watch.lookupIdentity(seed.signature,this.now())?.verifiedAt===null)this.watch.transition(seed.signature,'VERIFYING','bounded confirmed/finalized origin verification',this.now());
   const controller=new AbortController(),startedAt=this.now();session={seed,startedAt,deadlineAt:startedAt+NATIVE_DEADLINE_POLICY.originWorkflowMs,controller,pending:null,result:null,reads:0,done:Promise.resolve()};this.verificationSession=session;const current=session;
   const rpc:PilotMigrationRpc={call:<T>(method:string,params:unknown[]=[],s?:AbortSignal)=>new Promise<T>((resolve,reject)=>{need(!current.pending&&current.reads<NATIVE_DEADLINE_POLICY.maximumOriginReads,'NATIVE_ORIGIN_CONTINUATION_BOUND');if(s?.aborted||current.controller.signal.aborted){reject(Error('PILOT_MIGRATION_ABORTED'));return;}const read:VerificationRead={method,params,signal:s,resolve:v=>{s?.removeEventListener('abort',abort);resolve(v as T);},reject:e=>{s?.removeEventListener('abort',abort);reject(e);}};const abort=()=>{if(current.pending===read)current.pending=null;read.reject(Error('PILOT_MIGRATION_ABORTED'));};current.pending=read;s?.addEventListener('abort',abort,{once:true});})};
   current.done=this.resolve(seed,rpc,signal?AbortSignal.any([signal,controller.signal]):controller.signal).then(result=>{current.result=result;},error=>{current.result={ok:false,reason:safe(error)};});
   await Promise.resolve();await Promise.resolve();
  }
  if(this.now()>=session.deadlineAt){session.controller.abort();session.pending?.reject(Error('PILOT_MIGRATION_ABORTED'));session.pending=null;await session.done;}
  if(this.finishVerification(session))return;
  const read=session.pending;if(!read||!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs))return;session.pending=null;session.reads++;const at=this.now(),cutoff=Math.min(deadlineAt,session.deadlineAt),view=this.deadlineView(at);
  this.record('native-origin-read-dispatch',{at,signature:session.seed.signature,read:session.reads,method:read.method,workflowDeadlineAt:session.deadlineAt,physicalLatestStartAt:cutoff-1200,committedTargets:view.targets.length,partialProofAdmitted:false});
  try{const value=await this.options.rpc.call(read.method,read.params,read.signal,{...this.admission(cutoff),timeoutMs:1200,operationBoundMs:NATIVE_DEADLINE_POLICY.discretionaryReadMs,admissionOpen:()=>this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs)&&this.now()<cutoff&&this.discretionaryAdmission(1200,this.now()).admitted});read.resolve(value);}catch(error){read.reject(error);}
  await Promise.resolve();await Promise.resolve();await Promise.resolve();this.finishVerification(session);
 }
 /** A bounded shared deadline view, also used by the outer PAPER loop. Future
  * first windows are represented before any assessment has ever completed. */
 deadlineView(at=this.now()):NativeDeadlineView{
  const bucket=PROVISIONAL_RULE.bucketMs,targets:NativeDeadlineTarget[]=[];
  for(const c of this.candidates.values()){
   if(c.openedAt===null)continue;
   let end=c.auditSession?.windowEndAt??Math.max(Math.ceil(c.openedAt/bucket)*bucket+60000,c.nextAuditAt,Math.floor(at/bucket)*bucket);
   if(end<=c.lastAssessmentEnd||end===c.lastAuditFenceWarmingWindowEnd)end+=bucket;
   const ready=!!c.auditSession||!!(c.lastReadyWindowEnd===end&&c.checkedAuditable&&end>c.lastAssessmentEnd&&at>=c.nextAuditAt),prospective=!ready&&c.readinessCheckedEnd!==end;
   // Calendar uses readiness scalars already produced by the engine's normal
   // source check. It never clones packet ledgers/recomputes features merely
   // to admit reporting or measure a cheap housekeeping phase. One prospective
   // first/current boundary reserves the next engine service turn; a checked
   // unavailable target forecasts the next bucket instead of locking reports.
   if(!ready&&!prospective&&end<=at)end=Math.floor(at/bucket)*bucket+bucket;
   const minimumPageWorkMs=NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+NATIVE_DEADLINE_POLICY.postValidationMs,historyReadyAt=Math.max(c.auditPageRetryAt,this.options.rpc.historyQueryReadyAt?.(c.identity.pool,at)??at),deadlineAt=end+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs;
   targets.push({mint:c.identity.baseMint,eligibleAt:end,deadlineAt,ready,prospective,continuing:!!c.auditSession,minimumPageWorkMs,historyReadyAt,serviceableBeforeDeadline:Math.max(at,historyReadyAt)+minimumPageWorkMs<=deadlineAt});
  }
  targets.sort((a,b)=>a.deadlineAt-b.deadlineAt||a.mint.localeCompare(b.mint));
  const flow=this.options.flow.usage() as ReturnType<Flow['usage']>&{nextRequiredServiceAt?:number;nextRequiredServiceDeadlineAt?:number;nextRequiredServiceAction?:string|null;nativeServiceDeadlines?:Array<{deadlineAt:number;action:string|null}>};
  const obligations=flow.nativeServiceDeadlines?.map(v=>({action:v.action,deadlineAt:v.deadlineAt>at?v.deadlineAt:v.action==='support-refresh'?Infinity:at+1500})).sort((a,b)=>a.deadlineAt-b.deadlineAt),deadline=obligations===undefined?flow.nextRequiredServiceDeadlineAt:obligations[0]?.deadlineAt??Infinity,native=deadline===undefined?(flow.nextRequiredServiceAt??flow.nextServiceAt):deadline-1500,requiredNativeAt=Number.isFinite(native)?native:null,ready=targets.filter(t=>t.ready),minimumReadyWorkMs=ready.reduce((n,t)=>n+t.minimumPageWorkMs,0),earliest=targets[0]?.deadlineAt??null;
  // Reserve one declared page opportunity per committed peer, not a promise
  // that unknown additional history pages or an outage can fit this envelope.
  const serviceable=targets.filter(t=>t.serviceableBeforeDeadline),unavailableReadyCount=ready.filter(t=>!t.serviceableBeforeDeadline).length;
  // A provider cooldown extending beyond the original deadline cannot reserve
  // an impossible page forever or suppress degraded reporting. Keep the target
  // and its eventual unavailable/deadline accounting; never label it complete.
  const until=serviceable.length?Math.min(...serviceable.map((t,i)=>t.ready?t.deadlineAt-(i+1)*t.minimumPageWorkMs:t.eligibleAt)):Infinity;
  return {at,targets,readyCount:ready.length,nextEligibleAt:targets.length?Math.min(...targets.map(t=>t.eligibleAt)):null,earliestDeadlineAt:earliest,discretionaryUntil:Number.isFinite(until)?until:null,minimumReadyWorkMs,unavailableReadyCount,conservativeReadyEnvelopeFits:unavailableReadyCount===0&&(!ready.length||ready[0]!.deadlineAt-at>=minimumReadyWorkMs),requiredNativeAt,requiredNativeAction:obligations===undefined?flow.nextRequiredServiceAction??flow.nextServiceAction??null:Number.isFinite(deadline)?obligations[0]?.action??null:null,meaning:'Bounded commitments/future first windows; actual rate, occupancy, provider and financial admission still apply. Unknown extra pages are not guaranteed.'};
 }
 discretionaryAdmission(boundMs:number,at=this.now()){
  need(Number.isSafeInteger(boundMs)&&boundMs>0&&boundMs<=10000,'NATIVE_DISCRETIONARY_BOUND');const view=this.deadlineView(at),latest=Math.min(view.discretionaryUntil??Infinity,view.requiredNativeAt??Infinity)-NATIVE_DEADLINE_POLICY.postValidationMs;
  return {admitted:at+boundMs<=latest,latestStartAt:Number.isFinite(latest)?latest-boundMs:null,view,reason:at+boundMs<=latest?'shared-deadline-slack':'committed-native-or-candidate-deadline'};
 }
 /** Already completed independent evidence gets one current financial work
  * opportunity before hypothetical remaining peer pages. This is scheduling
  * only: the caller still owns protection, pending actions, provider pacing,
  * financial permission and the exact-size quote. Re-read this view after
  * pacing; neither an old bucket nor a replacement generation can inherit it. */
 financialAdmission(certificate:NativeAuditCertificate,boundMs:number,at=this.now()){
  need(Number.isSafeInteger(boundMs)&&boundMs>0&&boundMs<=10000,'NATIVE_DISCRETIONARY_BOUND');
  const view=this.deadlineView(at),current=this.currentAuditCertificate(certificate?.mint??'',at),fields=['schemaVersion','mint','pool','dataContract','openedAt','connectionId','subscriptionId','windowStartAt','windowEndAt','auditAvailableAt','admittedAt','deadlineAt','notificationCompletenessVerified','executedFlowCompletenessVerified','featuresSha256']as const;
  const matches=!!current&&fields.every(key=>certificate?.[key]===current[key]),sourceOpen=this.open(),certificateDeadlineAt=current?.deadlineAt??null,nativeServiceLatestAt=view.requiredNativeAt;
  const completionDeadlineAt=matches?Math.min(current!.deadlineAt,nativeServiceLatestAt??Infinity):null,latest=completionDeadlineAt===null?null:completionDeadlineAt-NATIVE_DEADLINE_POLICY.postValidationMs-boundMs;
  const bindingDeadline=completionDeadlineAt===null?'current-certificate':nativeServiceLatestAt!==null&&nativeServiceLatestAt<=current!.deadlineAt?'required-native-service':'original-certificate',admitted=matches&&sourceOpen&&latest!==null&&at<=latest;
  return {admitted,latestStartAt:latest,certificateLatestStartAt:matches?current!.deadlineAt-NATIVE_DEADLINE_POLICY.postValidationMs-boundMs:null,nativeLatestStartAt:nativeServiceLatestAt===null?null:nativeServiceLatestAt-NATIVE_DEADLINE_POLICY.postValidationMs-boundMs,view,reason:!matches?'current-audit-certificate-required':!sourceOpen?'source-admission-closed':admitted?'completed-certificate-financial-priority':bindingDeadline==='required-native-service'?'required-native-service-deadline':'original-certificate-deadline',bindingDeadline,certificateDeadlineAt,nativeServiceLatestAt,completionDeadlineAt,requestedOperationMs:boundMs,postValidationMs:NATIVE_DEADLINE_POLICY.postValidationMs,remainingCertificateMs:certificateDeadlineAt===null?null:certificateDeadlineAt-at,peerAuditReservationsDeferred:view.readyCount};
 }
 private observationIdentity(row:WatchRow):NativeObservationIdentity|undefined{
  if(!row.mint||!row.pool)return;
  const origin=this.currentPoolObservation?undefined:this.origin(row.mint);
  if(origin)return nativeObservationIdentityFromMigration(origin);
  if(!this.currentPoolObservation)return;
  const known=row.migrationAt!==null&&row.verifiedAt!==null,scope=row.observationIdentity;
  if(!known&&!scope)return;
  const identity:NativeObservationIdentity={schemaVersion:1,baseMint:row.mint,pool:row.pool,migrationAt:known?row.migrationAt:null,migrationVerified:known,identityBasis:known?'retained-verified-metadata':'canonical-pool-hint',identityAvailableAt:known?row.verifiedAt!:scope!.availableAt,identityEvidence:known?'retained previously verified migration metadata '+row.signature:scope!.evidence,...(scope?.currentPool?{minimumSlot:scope.currentPool.sourceSlot}:{})};
  assertNativeObservationIdentity(identity,this.now());return identity;
 }
 private observationAllowed(row:WatchRow,at:number){if(this.options.enforceTokenAge24h&&(!row.mint||!this.registry.tokenAgeEligibility(row.mint,at).allowed))return false;return row.migrationAt===null?this.currentPoolObservation:observationRunway(row.migrationAt,at,row.olderResearch!==undefined,this.observationAgePolicy).allowed;}
 private allocate(at:number){
  const began=performance.now(),maximum=this.options.maximumDeep??6,excluded=new Set(this.candidates.keys());
  if(this.currentPoolObservation)this.releaseArchiveDeferrals(at);
  for(let i=this.candidates.size;i<maximum;i++){
   if(performance.now()-began>=NATIVE_DEADLINE_POLICY.postValidationMs||!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs)||!this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.postValidationMs,this.now()).admitted)break;
   at=this.now();
   if(this.options.flow.usage().candidates+this.options.flow.usage().retiring>=maximum)break;
   // One newly evidenced identity joins the same competition per vacant slot.
   // A nonempty old queue must not prevent recent opportunities from competing.
   if(this.currentPoolObservation)this.prepareCurrentObservation(at);
   const row=this.watch.next(at,excluded,{requireOrigin:!this.currentPoolObservation});
   if(!row?.mint||!row.pool)break;excluded.add(row.mint);const id=this.observationIdentity(row);
   if(!id){this.record('native-observation-identity-unavailable',{mint:row.mint,at,awarenessRetained:true,deepAdmission:false,archivalCreationRequired:!this.currentPoolObservation,otherCandidatesContinue:true});continue;}
   at=this.now(); // Recheck age after local selection work, before admission.
   if(!this.observationAllowed(row,at)){this.watch.transition(row.mint,'EXPIRED','remaining horizon cannot fit a complete required window',at);continue;}
   // Acquire the writer before any slot/transport mirror is changed. Hooks
   // restore watch/productivity mirrors if an outer transaction rolls back.
   this.registry.transaction(()=>{
    const waitingSince=this.watch.allocationReadySince(id.baseMint,at,{requireOrigin:!this.currentPoolObservation})??at;
    this.watch.transition(id.baseMint,'DEEP_OBSERVATION','fresh native confirmed pool observation allocated; no financial permission',at);
    this.productivity.allocated(id.baseMint,at,waitingSince,row.promotions);this.registry.markStage(id.baseMint,'deep-admitted',at);
    this.registry.afterCommit(()=>{
     this.candidates.set(id.baseMint,{identity:id,allocatedAt:at,openedAt:null,lastFeatureEnd:0,lastAssessmentEnd:0,lastReadyWindowEnd:0,lastReadyObservedAt:0,lastExpiredWindowEnd:0,lastAuditFenceWarmingWindowEnd:0,auditFailures:0,nextAuditAt:0,lastAuditPageAt:0,auditPageRetryAt:0,readinessCheckedEnd:0,checkedAuditable:false});
     try{this.options.flow.addCandidate({mint:id.baseMint,pool:id.pool,...(id.minimumSlot===undefined?{}:{minSlot:id.minimumSlot}),...(id.dependencyHints?{dependencyHints:{...id.dependencyHints}}:{})});
      this.maximumSimultaneous=Math.max(this.maximumSimultaneous,this.candidates.size);this.options.onCandidateAllocated?.(structuredClone(id));
     }catch(error){this.retire(id.baseMint,'native allocation setup failed; fresh allocation required',this.now(),0);throw error;}
    });
   });
  }
 }
 /** This prerequisite is independent of scheduler admission. A complete raw
  * feature window without a post-ACK lower fence is not yet auditable, while a
  * fence-ready window remains deadline-eligible even if no page is dispatched. */
 private lowerAuditContext(c:Candidate,view:ReturnType<Flow['snapshot']>,ledger?:ReturnType<Flow['notificationLedger']>){
  if(!view?.features)return null;
  const postAckContext=view.supportContexts.filter(v=>v.availableAt>=(view.openedAt??Infinity)&&v.availableAt<=view.features!.windowStartAt).at(-1);if(postAckContext)return postAckContext;
  const preWindowNotice=(ledger??this.options.flow.notificationLedger(c.identity.baseMint)).some(n=>n.receivedAt>=(view.openedAt??Infinity)&&n.receivedAt<view.features!.windowStartAt&&n.availableAt<view.features!.windowStartAt&&!n.correction&&n.classification!=='unusable');
  return preWindowNotice?view.openingSupportContext:null;
 }
 /** Reuse the auditor's exact strict-interior boundary selection. Only direct
  * notifications from this actual ACK generation may replace a bank-Clock
  * ceiling refresh; the complete ledger still supplies the audit denominator. */
 private notificationAuditFences(c:Candidate,view:ReturnType<Flow['snapshot']>,ledger?:ReturnType<Flow['notificationLedger']>,at=this.now()){
  if(!this.currentPoolObservation||!view?.warm||!view.features||c.openedAt===null||view.openedAt!==c.openedAt||view.scope.pool!==c.identity.pool||!Number.isSafeInteger(view.connectionId)||!Number.isSafeInteger(view.subscription))return null;
  const generation={mint:c.identity.baseMint,pool:c.identity.pool,openedAt:c.openedAt,connectionId:view.connectionId!,subscriptionId:view.subscription!};
  const selected=selectNativeNotificationAuditFences({notifications:ledger??this.options.flow.notificationLedger(c.identity.baseMint),target:{startAt:view.features.windowStartAt,endAt:view.features.windowEndAt},at,generation});
  return selected.available?{generation,selected}:null;
 }
 private auditFenceWarming(c:Candidate,view:NonNullable<ReturnType<Flow['snapshot']>>,at:number){
  const end=view.features!.windowEndAt;if(c.lastAuditFenceWarmingWindowEnd===end)return;
  c.lastAuditFenceWarmingWindowEnd=end;this.counters.auditFenceWarmingWindows++;
  this.record('native-independent-audit-warming',{mint:c.identity.baseMint,at,windowStartAt:view.features!.windowStartAt,windowEndAt:end,openedAt:view.openedAt,reason:'no confirmed lower context or actual notification after subscription ACK and before target window; pre-ACK activity is not a capture failure',historyRequestStarted:false,deadlineEligible:false,windowUsable:false,financialQualification:false});
 }
 private readyAudits(at:number){
  return [...this.candidates.values()].filter(c=>this.observationMember(c,at)).flatMap(candidate=>{const view=this.options.flow.snapshot(candidate.identity.baseMint,at);if(!candidate.auditSession&&!(view?.warm&&view.features&&view.features.windowEndAt!==candidate.lastAuditFenceWarmingWindowEnd&&view.features.windowEndAt>candidate.lastAssessmentEnd&&at>=candidate.nextAuditAt))return [];return [{candidate,deadlineAt:candidate.auditSession?.deadlineAt??view!.features!.windowEndAt+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs}];}).sort((a,b)=>a.deadlineAt-b.deadlineAt||a.candidate.lastAuditPageAt-b.candidate.lastAuditPageAt||a.candidate.allocatedAt-b.candidate.allocatedAt).map(row=>row.candidate);
 }
 private async beginAudit(c:Candidate,signal?:AbortSignal){
  const mint=c.identity.baseMint,at=this.now(),view=this.options.flow.snapshot(mint,at);if(!view?.warm||!view.features)return;
  const end=view.features.windowEndAt;c.nextAuditAt=end+PROVISIONAL_RULE.bucketMs;
  const ledger=this.options.flow.notificationLedger(mint),lowerContext=this.lowerAuditContext(c,view,ledger),bankCeilingReady=!!view.supportContext&&view.supportContext.bankClockAt>=end,notificationFences=lowerContext&&bankCeilingReady?null:this.notificationAuditFences(c,view,ledger,at);
  if(!notificationFences&&!lowerContext){this.auditFenceWarming(c,view,at);return;}
  const deadlineAt=end+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs;
  const generation=Number.isSafeInteger(view.connectionId)&&Number.isSafeInteger(view.subscription)&&c.openedAt!==null?{mint,pool:c.identity.pool,openedAt:c.openedAt,connectionId:view.connectionId!,subscriptionId:view.subscription!}:null;
  const tail=generation?{notificationGeneration:generation,postSnapshotNotifications:(startedAt:number)=>{
   const current=this.options.flow.snapshot(mint,this.now());
   need(this.open()&&this.candidates.get(mint)===c&&c.openedAt===generation.openedAt&&current?.openedAt===generation.openedAt&&current.connectionId===generation.connectionId&&current.subscription===generation.subscriptionId&&current.scope.pool===generation.pool&&current.connected&&current.warm&&!current.hasQualityLoss&&!current.suspended,'NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');
   const rows=this.options.flow.notificationLedger(mint);need(rows.length<=8192,'NATIVE_AUDIT_TAIL_NOTIFICATION_BOUND');return rows.filter(n=>n.availableAt>startedAt);
  }}:{};
  const cacheGeneration={openedAt:c.openedAt,connectionId:view.connectionId,subscription:view.subscription};
  c.auditPageRetryAt=0;c.auditSession={windowEndAt:end,openedAt:c.openedAt,connectionId:view.connectionId,subscriptionId:view.subscription,deadlineAt,session:new NativeAuditSession({pool:c.identity.pool,notifications:ledger,...(c.historyCache?{reusableHistory:c.historyCache}:{}),onVerifiedHistory:cache=>{const current=this.options.flow.snapshot(mint,this.now());if(this.open()&&this.candidates.get(mint)===c&&c.openedAt===cacheGeneration.openedAt&&current?.openedAt===cacheGeneration.openedAt&&current.connectionId===cacheGeneration.connectionId&&current.subscription===cacheGeneration.subscription)c.historyCache=cache;},...tail,target:{startAt:view.features.windowStartAt,endAt:end},...(notificationFences?{notificationFenceGeneration:notificationFences.generation}:view.supportContext&&lowerContext?{contextFences:{lower:lowerContext,upper:view.supportContext}}:{}),now:this.now,signal,deadlineAt,maximumPages:NATIVE_CANDIDATE_AUDIT_PROFILE.maximumPages,pageLimit:NATIVE_CANDIDATE_AUDIT_PROFILE.pageLimit,adaptivePageSizing:NATIVE_CANDIDATE_AUDIT_PROFILE.adaptivePageSizing,completenessScope:NATIVE_CANDIDATE_AUDIT_PROFILE.completenessScope,audit:this.audit,record:(kind,data)=>this.record(kind,{mint,...data as object})})};
  this.record('native-candidate-audit-session-open',{mint,at,targetEndAt:end,deadlineAt,fenceKind:notificationFences?'current-generation-notifications':'confirmed-bank-context',forcedCeilingRefreshAvoided:notificationFences!==null&&!bankCeilingReady,maximumPages:NATIVE_CANDIDATE_AUDIT_PROFILE.maximumPages,onePhysicalPagePerStep:true,notHoldingProtectionAcceptance:true});
  await c.auditSession.session.advance();
 }
 private async finishAudit(c:Candidate){
  const active=c.auditSession;if(!active)return;if(active.session.pending()&&!this.auditSessionCurrent(c,active))active.session.cancel('NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');await active.session.advance();
  const result=active.session.result(),error=active.session.error();if(!result&&!error)return;
  const mint=c.identity.baseMint,end=active.windowEndAt,diagnostic=result??active.session.diagnosticResult();delete c.auditSession;c.nextAuditAt=Math.max(c.nextAuditAt,end+PROVISIONAL_RULE.bucketMs);
  if(!diagnostic){this.finishAuditDispatch(c,error??'NATIVE_AUDIT_SESSION_UNAVAILABLE');this.counters.auditUnavailable++;this.noteFailure('audit-unavailable',mint,error??'NATIVE_AUDIT_SESSION_UNAVAILABLE',this.now(),c,{end,deadlineAt:active.deadlineAt});c.auditFailures++;this.record('native-candidate-window-audit-unavailable',{mint,at:this.now(),targetEndAt:end,reason:error??'NATIVE_AUDIT_SESSION_UNAVAILABLE',deadlineAt:active.deadlineAt,partialHistoryNeverComplete:true});if(c.auditFailures>=3)this.retire(mint,error??'NATIVE_AUDIT_SESSION_UNAVAILABLE',this.now(),15000);return;}
  const unavailable=error!==null||this.now()>active.deadlineAt||c.openedAt!==active.openedAt;
  this.admitAuditResult(c,end,diagnostic,unavailable?error??'NATIVE_AUDIT_SESSION_DEADLINE_OR_GENERATION':null);
 }
 private auditSessionCurrent(c:Candidate,active:NonNullable<Candidate['auditSession']>){
  const view=this.options.flow.snapshot(c.identity.baseMint,this.now());return this.candidates.get(c.identity.baseMint)===c&&c.auditSession===active&&c.openedAt===active.openedAt&&view?.openedAt===active.openedAt&&view.connectionId===active.connectionId&&view.subscription===active.subscriptionId&&view.connected&&view.warm&&!view.hasQualityLoss&&!view.suspended&&view.features?.windowEndAt===active.windowEndAt;
 }
 private deferAuditPage(c:Candidate,active:NonNullable<Candidate['auditSession']>,reason:string,retryAt=0){
  const at=this.now();if(!this.auditSessionCurrent(c,active)||at>=active.deadlineAt)return false;
  c.lastAuditPageAt=at;c.auditPageRetryAt=Math.min(active.deadlineAt,Math.max(at+NATIVE_DEADLINE_POLICY.uninvokedPageRetryMs,retryAt));
  this.traceAuditDispatch([c],at,'page-deferred','retain-uninvoked-page-for-shared-scheduling',{reason,retryAt:c.auditPageRetryAt,originalDeadlineAt:active.deadlineAt,physicalStartClaimed:false,physicalSettlementClaimed:false,reservationRefunded:false});return true;
 }
 private admitAuditResult(c:Candidate,end:number,result:NativeFlowAuditResult,sessionFailure:string|null){
  const mint=c.identity.baseMint;
  const availableAt=this.now();this.finishAuditDispatch(c,sessionFailure??'audit-result:'+result.status,availableAt);if(result.requestAttempts>0)this.lastAuditAt=availableAt;this.record('native-candidate-window-audit',{mint,result,availableAt,notBackdated:true});
  if(this.candidates.get(mint)!==c)return;
  if(!this.observationMember(c,availableAt)){this.retire(mint,'audit result lost deep-observation membership; fresh allocation required',availableAt,0);return;}
  if(sessionFailure){this.counters.predictiveUnavailable++;this.noteFailure('predictive-unavailable',mint,sessionFailure,availableAt,c,{end,deadlineAt:end+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs},result);this.record('native-predictive-unavailable',{mint,at:availableAt,reason:sessionFailure,targetEndAt:end,auditPreserved:true});return;}
  if(result.status!=='verified'){if(result.status==='unusable'){this.counters.auditUnusable++;this.noteFailure('audit-unusable',mint,result.reason,availableAt,c,{end,deadlineAt:end+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs},result);this.onGap({mint,at:availableAt,reason:result.reason});}else{this.counters.auditUnavailable++;this.noteFailure('audit-unavailable',mint,result.reason,availableAt,c,{end,deadlineAt:end+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs},result);c.auditFailures++;if(c.auditFailures>=3)this.retire(mint,result.reason,availableAt,15000);}return;}
  const current=this.options.flow.snapshot(mint,availableAt);
  if(!current?.warm||!current.features||current.features.windowEndAt!==end){this.counters.predictiveUnavailable++;this.noteFailure('predictive-unavailable',mint,'AUDIT_COMPLETED_AFTER_DECISION_BUCKET',availableAt,c,{end,deadlineAt:end+NATIVE_CANDIDATE_AUDIT_PROFILE.maximumAuditSpanMs},result);this.record('native-predictive-unavailable',{mint,at:availableAt,reason:'audit-completed-after-target-window-decision-bucket',targetEndAt:end,currentEndAt:current?.features?.windowEndAt??null,auditPreserved:true});return;}
  this.watch.noteWindow(mint,availableAt);
  if(Number.isSafeInteger(current.connectionId)&&Number.isSafeInteger(current.subscription)&&Number.isSafeInteger(c.openedAt)){
   const certificate:NativeAuditCertificate={schemaVersion:1,mint,pool:c.identity.pool,dataContract:this.dataContract,openedAt:c.openedAt!,connectionId:current.connectionId!,subscriptionId:current.subscription!,windowStartAt:current.features.windowStartAt,windowEndAt:end,auditAvailableAt:result.availableAt,admittedAt:availableAt,deadlineAt:end+PROVISIONAL_RULE.bucketMs-1,notificationCompletenessVerified:result.notificationCompletenessVerified,executedFlowCompletenessVerified:result.executedFlowCompletenessVerified,featuresSha256:nativePaperFeaturesSha256(current.features)};
   this.certificates.set(mint,certificate);
  }
  this.watch.noteRelevantEvidence(mint,{kind:'source-recovery',at:availableAt,fingerprint:'verified-audited-signatures:'+createHash('sha256').update(JSON.stringify({pool:result.pool,required:result.requiredSignatures,compared:result.comparedSignatures})).digest('hex')},availableAt);
  this.productivity.evaluated(mint,current.features.windowStartAt,end,availableAt);
  const assessment=assessPredictiveBuying(current.features,availableAt);if(current.strictV2Unavailable)this.counters.strictV2BaselineUnavailableViews++;if(this.dataContract!==CONFIRMED_PROGRAM_EVENTS_V2)this.counters.protocolAwareShadowViews++;c.lastAssessmentEnd=end;c.auditFailures=0;c.nextAuditAt=end+PROVISIONAL_RULE.bucketMs;this.counters.auditedWindows++;this.counters.predictiveAssessments++;this.lastPredictiveAt=availableAt;this.decisions.push({at:availableAt,mint,stage:(this.dataContract===CONFIRMED_PROGRAM_EVENTS_V2?'predictive-':'shadow-predictive-')+assessment.status,reason:assessment.reason});if(this.decisions.length>30)this.decisions.shift();
  if(this.registry.markDistinct(this.runScope+':evaluated',mint,availableAt))this.counters.uniqueEvaluated++;this.registry.markStage(mint,'verified-audit',availableAt);if(assessment.status==='failed')this.counters.predictiveFailed++;else if(assessment.status==='not-rejected')this.counters.predictiveNotRejected++;else this.counters.predictiveUnavailable++;
  this.record('native-predictive-assessment',{mint,pool:c.identity.pool,at:availableAt,assessment,baselineFeatureSemantics:current.baselineFeatureSemantics??'V2_WITHOUT_PROTOCOL_FRAMES',strictV2BaselineUnavailable:current.strictV2Unavailable??false,protocolPoolEffects:current.protocolPoolEffects??null,assessmentScope:this.dataContract===CONFIRMED_PROGRAM_EVENTS_V2?'strict-v2-feature-only':'protocol-aware-shadow-ordinary-flow-only; not baseline qualification',auditAvailableAt:result.availableAt,auditCompletenessScope:result.completenessScope,notificationCompletenessVerified:result.notificationCompletenessVerified,executedFlowCompletenessVerified:result.executedFlowCompletenessVerified,windowEndAt:end,dataContract:this.dataContract,strategyVersion:PROVISIONAL_RULE.version,entryAgeEligible:c.identity.migrationAt!==null&&entryAgeEligible(c.identity.migrationAt,availableAt),ageCohort:c.identity.migrationAt===null?'unknown-migration-age':observationAgeCohort(c.identity.migrationAt,availableAt,this.watch.lookupIdentity(mint,availableAt)?.olderResearch!==undefined,this.observationAgePolicy),observationAgePolicy:this.observationAgePolicy.version,financialQualification:false,executionFeasibility:'not assessed; candidate-only mode',transferCrossCheck:'UNAVAILABLE'});
  // The frozen baseline remains independently measured. It must not retire
  // an audited window before the explicitly active adaptive rule can evaluate
  // it. This preliminary assessment grants neither liquidity nor entry/fill.
  const activeAssessment=this.options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION?(this.options.activeAssessment?.(mint,current.features,availableAt)??assessLiquidityResilientBuyingV31(current.features,availableAt)):this.options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION?(this.options.activeAssessment?.(mint,current.features,availableAt)??assessLiquidityResilientBuying(current.features,availableAt)):this.options.activeStrategy==='adaptive-momentum-v2'?assessAdaptiveBuying(current.features,availableAt):assessment;
  if(this.options.activeStrategy){
   this.activeDecisions.push({at:availableAt,mint,stage:'adaptive-predictive-'+activeAssessment.status,reason:activeAssessment.reason});if(this.activeDecisions.length>30)this.activeDecisions.shift();
   this.activeCounters.adaptivePredictiveAssessments++;if(activeAssessment.status==='not-rejected')this.activeCounters.adaptivePredictiveNotRejected++;else if(activeAssessment.status==='failed')this.activeCounters.adaptivePredictiveFailed++;else this.activeCounters.adaptivePredictiveUnavailable++;
   this.record('native-active-strategy-assessment',{mint,pool:c.identity.pool,at:availableAt,windowEndAt:end,strategyVersion:this.options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION?LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:this.options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION?LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION:ADAPTIVE_MOMENTUM_V2_VERSION,assessment:activeAssessment,baselineStrategyVersion:PROVISIONAL_RULE.version,baselineStatus:assessment.status,completeIndependentAudit:true,financialQualification:false,executionFeasibility:'not assessed; actual-size quote and ledger authorization remain required'});
   this.opportunity(mint,availableAt,current.features,{kind:activeAssessment.status==='unavailable'?'missing-data':activeAssessment.status==='failed'?'strategy-rejection':'preliminary-pass',reason:activeAssessment.reason,qualified:false,...('assessments'in activeAssessment?{assessments:activeAssessment.assessments}:{}),...('components'in activeAssessment?{components:activeAssessment.components}:{})},activeAssessment.status==='unavailable');
  }
  const admittedCertificate=this.certificates.get(mint);if(admittedCertificate)this.options.onAuditAvailable?.(structuredClone(admittedCertificate));
  if(activeAssessment.status!=='not-rejected'){this.watch.noteEvaluation(mint,{kind:activeAssessment.status==='failed'?'economic-rejection':'technical-unavailable',windowEndAt:end,evidence:activeAssessment.reason.slice(0,512)},availableAt);this.watch.finishTechnicalReevaluation(mint,availableAt,'new audited predictive assessment did not pass');this.retire(mint,'audited predictive observation completed; fair watch revisit',availableAt,this.options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION&&activeAssessment.status==='failed'?0:30000);}
 }
 private async evaluate(c:Candidate,deadlineAt:number,signal?:AbortSignal){
  if(!c.auditSession)await this.beginAudit(c,signal);
  const active=c.auditSession;if(!active)return;
  await this.finishAudit(c);if(c.auditSession!==active||this.candidates.get(c.identity.baseMint)!==c)return;
  const page=active.session.pending();if(!page){this.traceAuditDispatch([c],this.now(),'page-not-exposed','advance-logical-session');return;}
  const operationBoundMs=NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+NATIVE_DEADLINE_POLICY.postValidationMs;
  if(!this.sourceWorkAllowed(operationBoundMs)){this.deferAuditPage(c,active,'NATIVE_SOURCE_FINANCIAL_RUNWAY');return;}
  const dispatchedAt=this.now();c.lastAuditPageAt=dispatchedAt;c.auditPageRetryAt=0;this.traceAuditDispatch([c],dispatchedAt,'page-admission','invoke-shared-rpc',{requestedLimit:page.requestedLimit,operationBoundMs,latestStartAt:Math.min(deadlineAt,active.deadlineAt)-operationBoundMs});
  this.pendingAuditPhysical={mint:c.identity.baseMint,windowEndAt:active.windowEndAt};
  try{const value=await this.options.rpc.call(page.method,page.params,page.signal,{...page.options,...this.admission(Math.min(deadlineAt,active.deadlineAt)),timeoutMs:NATIVE_CANDIDATE_AUDIT_PROFILE.physicalTimeoutMs,operationBoundMs,queryTimeoutScope:'independent-history',latestStartAt:Math.min(deadlineAt,active.deadlineAt)-operationBoundMs,admissionOpen:()=>this.sourceWorkAllowed(operationBoundMs)&&this.auditSessionCurrent(c,active)&&this.now()+operationBoundMs<=Math.min(deadlineAt,active.deadlineAt)});if(this.now()-dispatchedAt>NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs){this.record('native-audit-late-page',{mint:c.identity.baseMint,page:page.page,dispatchedAt,availableAt:this.now(),operationBoundMs:NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs,payload:value,admitted:false});active.session.reject(page.page,Error('NATIVE_AUDIT_PAGE_OPERATION_BOUND'));}else{this.traceAuditDispatch([c],this.now(),'page-response','validate-logical-session',{requestedLimit:page.requestedLimit,responseRows:Array.isArray(value)?value.length:null});active.session.respond(page.page,value);}}
  catch(error){const proof=pilotUninvokedHistoryRefusal(error),at=this.now();if(proof&&proof.pool===c.identity.pool&&proof.at>=dispatchedAt&&proof.at<=at&&this.deferAuditPage(c,active,safe(error),proof.retryAt??0))return;this.traceAuditDispatch([c],at,'page-refusal','retain-unavailable-target',{reason:safe(error),physicalSettlementClaimed:false});active.session.reject(page.page,error);}finally{this.productivity.physicalSettled(c.identity.baseMint,this.now());this.pendingAuditPhysical=null;}
  if(c.auditSession!==active||this.candidates.get(c.identity.baseMint)!==c){await active.session.advance();this.record('native-candidate-audit-cancelled-after-page-return',{mint:c.identity.baseMint,at:this.now(),targetEndAt:active.windowEndAt,reason:active.session.error(),diagnosticResult:active.session.diagnosticResult(),admitted:false,physicalSettlementClaimed:false,physicalGateInFlight:this.options.rpc.usage().inFlight,physicalGateWaitingOrOperating:this.options.rpc.usage().waitingOrOperating,callerOwnsPhysicalSettlement:true});return;}
  await this.finishAudit(c);
 }
 /** Only small, already-ready first pages share an HTTP envelope. Each existing
  * logical session owns its original generation, full census and deadline.
  * Busy continuations remain individual and never enter this batch. */
 private async evaluateQuietBatch(ready:readonly Candidate[],deadlineAt:number,signal?:AbortSignal){
  // Operating PAPER deliberately uses individually paced history after the
  // measured batch stalls. A supplied financial operation contract must never
  // fall through the unvalidated research-batch path, even if a caller exposes
  // that optional transport method. Historical unguarded research is retained.
  if(this.options.sourceWorkAdmission)return false;
  const callBatch=this.options.rpc.callSignatureHistoryBatch;if(!callBatch||ready.length<2||this.options.rpc.usage().signatureHistoryBatch?.disabledReason)return false;
  const oldest=ready[0]!,target=oldest.auditSession?.windowEndAt??oldest.lastReadyWindowEnd,planningAt=this.now();
  if((this.options.rpc.historyQueryReadyAt?.(oldest.identity.pool,planningAt)??planningAt)>planningAt)return false;
  for(const c of ready){if(!this.open()||this.now()+NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+125>deadlineAt)break;if(this.candidates.get(c.identity.baseMint)!==c||c.auditSession&&c.auditSession.windowEndAt!==target||!c.auditSession&&c.lastReadyWindowEnd!==target)continue;if(!c.auditSession)await this.beginAudit(c,signal);await this.finishAudit(c);}
  const selectedAt=this.now(),selected=ready.flatMap(c=>{if(this.candidates.get(c.identity.baseMint)!==c)return [];const active=c.auditSession,page=active?.session.pending();if(!active||active.windowEndAt!==target||!page||page.page!==1||page.requestedLimit!==100||(this.options.rpc.historyQueryReadyAt?.(c.identity.pool,selectedAt)??selectedAt)>selectedAt)return [];return [{c,active,page}];});
  if(selected.length<2||selected[0]!.c!==oldest)return false;
  const dispatchedAt=this.now(),cutoff=Math.min(deadlineAt,...selected.map(s=>s.active.deadlineAt)),latestStartAt=cutoff-NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs;
  if(dispatchedAt+NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+125>cutoff)return false;
  const current=(s:typeof selected[number])=>this.open()&&this.candidates.get(s.c.identity.baseMint)===s.c&&s.c.auditSession===s.active&&!s.page.signal.aborted&&this.now()<=s.active.deadlineAt;
  this.record('native-candidate-audit-batch-selected',{at:dispatchedAt,targetEndAt:target,deadlineAt:cutoff,latestStartAt,mints:selected.map(s=>s.c.identity.baseMint),logicalQueries:selected.length,requestedLimit:100,maximumResponseBytes:512*1024,physicalHttpStarts:null,meaning:'One proposed HTTP envelope; logical provider queries remain separate. No physical settlement or denominator completeness claimed.'});
  for(const s of selected){s.c.lastAuditPageAt=dispatchedAt;this.traceAuditDispatch([s.c],dispatchedAt,'page-admission','invoke-shared-quiet-batch',{requestedLimit:100,latestStartAt,logicalQueries:selected.length});}
  try{
   const response=await callBatch.call(this.options.rpc,selected.map(s=>({key:s.c.identity.baseMint,params:s.page.params})),signal,{...this.admission(cutoff),timeoutMs:NATIVE_CANDIDATE_AUDIT_PROFILE.physicalTimeoutMs,latestStartAt,admissionOpen:()=>this.open()&&this.now()<cutoff&&selected.every(current)});
   need(response.physicalHttpStarts===1&&response.logicalQueries===selected.length&&response.items.length===selected.length&&response.validatedAt<=this.now()&&response.responseReceivedAt<=response.validatedAt&&response.requestedAt>=dispatchedAt&&response.responseBytes<=512*1024,'NATIVE_AUDIT_BATCH_RECEIPT');
   need(response.items.every(item=>typeof item.id==='string'&&['result','rpc-error'].includes(item.status)&&item.requestedAt===response.requestedAt&&item.responseReceivedAt===response.responseReceivedAt&&item.validatedAt>=response.responseReceivedAt&&item.validatedAt<=response.validatedAt&&(item.status==='rpc-error'?Number.isSafeInteger(item.errorCode):Object.hasOwn(item,'result')))&&new Set(response.items.map(item=>item.id)).size===selected.length,'NATIVE_AUDIT_BATCH_ITEM');
   const items=new Map(response.items.map(item=>[item.key,item]));need(items.size===selected.length&&selected.every(s=>items.has(s.c.identity.baseMint)),'NATIVE_AUDIT_BATCH_BINDING');
   const late=this.now()-dispatchedAt>NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs;
   for(const s of selected){const item=items.get(s.c.identity.baseMint)!;if(!current(s))continue;if(late||response.overloaded||item.status==='rpc-error'){const reason=late?'NATIVE_AUDIT_PAGE_OPERATION_BOUND':response.overloaded?'COMPONENT_RPC_OVERLOAD':'COMPONENT_RPC_ERROR_'+item.errorCode;this.traceAuditDispatch([s.c],this.now(),'page-refusal','retain-unavailable-target',{reason,logicalQueries:selected.length,physicalSettlementClaimed:false});s.active.session.reject(1,Error(reason));}else{need(item.status==='result'&&Object.hasOwn(item,'result'),'NATIVE_AUDIT_BATCH_ITEM');this.traceAuditDispatch([s.c],this.now(),'page-response','validate-logical-session',{requestedLimit:100,responseRows:Array.isArray(item.result)?item.result.length:null,logicalQueries:selected.length});s.active.session.respond(1,item.result);}}
   this.record('native-candidate-audit-batch-return',{at:this.now(),targetEndAt:target,logicalQueries:response.logicalQueries,physicalHttpStarts:response.physicalHttpStarts,responseBytes:response.responseBytes,overloaded:response.overloaded,late,items:response.items.map(({result:_result,...metadata})=>metadata)});
  }catch(error){const reason=safe(error),preAdmission=/^PILOT_RPC_(COOLDOWN|QUERY_COOLDOWN|HISTORY_BATCH_DISABLED|PHYSICAL_SLOT_OCCUPIED|COMPONENT_ADMISSION_CLOSED|COMPONENT_DISPATCH_EXPIRED)$/.test(reason);this.record('native-candidate-audit-batch-unavailable',{at:this.now(),targetEndAt:target,mints:selected.map(s=>s.c.identity.baseMint),reason,logicalQueriesRequested:selected.length,physicalHttpStarts:null,physicalSettlementClaimed:false,logicalPagesRetainedForScheduling:preAdmission});if(!preAdmission)for(const s of selected)if(current(s))s.active.session.reject(1,error);}
  for(const s of selected){if(this.candidates.get(s.c.identity.baseMint)===s.c&&s.c.auditSession===s.active)await this.finishAudit(s.c);else{await s.active.session.advance();this.record('native-candidate-audit-cancelled-after-page-return',{mint:s.c.identity.baseMint,at:this.now(),targetEndAt:s.active.windowEndAt,reason:s.active.session.error(),diagnosticResult:s.active.session.diagnosticResult(),admitted:false,physicalSettlementClaimed:false,callerOwnsPhysicalSettlement:true});}}
  return true;
 }
 /** One scheduled unit of work. No independent request queue or provider budget. */
 async step(signal?:AbortSignal){
  if(!this.open()||this.working)return 'closed';this.working=true;
  try{
   if(!this.drainGapRetirements()){this.lastOutcome='MARKET_REGISTRY_CONTENTION';return 'wait';}
   if(!this.reconcileObservationMembership()){this.lastOutcome='MARKET_REGISTRY_CONTENTION';return 'wait';}
   this.reconcileFlowOpen();
   this.registryHousekeeping('native-activity',()=>this.drainNativeActivity());
   this.registryHousekeeping('migration-delivery',()=>this.drainMigrationDelivery());
   this.registryHousekeeping('pool-progress',()=>this.drainPoolSourceProgress());
   this.registryHousekeeping('committed-activity',()=>this.drainCommittedActivity());
   await this.drainCancelledAuditDiagnostics();
   const origin=this.verificationSession;if(origin){if(this.now()>=origin.deadlineAt){origin.controller.abort();origin.pending?.reject(Error('PILOT_MIGRATION_ABORTED'));origin.pending=null;await Promise.resolve();await Promise.resolve();origin.result??={ok:false,reason:'PILOT_MIGRATION_ELAPSED_CAP'};}this.finishVerification(origin);}
   const sourceFailure=this.options.flow.usage().fatal;if(sourceFailure){this.sourceAdmissionStopReason=sourceFailure;this.lastOutcome=sourceFailure;this.record('native-candidate-source-admissions-closed',{at:this.now(),reason:sourceFailure,financialWriterOpened:false,scope:'candidate-only research; financial position management is not owned by this runner'});return 'source-fatal';}
   let at=this.now();this.pruneProofCache(at);for(const c of [...this.candidates.values()]){const row=this.watch.lookupIdentity(c.identity.baseMint,at);if(!row||row.state==='EXPIRED')this.retire(c.identity.baseMint,'existing observation-age horizon elapsed',at,0);}
   for(const c of this.candidates.values()){const view=this.options.flow.snapshot(c.identity.baseMint,at);if(view?.warm)this.productivity.warmed(c.identity.baseMint,at);if(view?.features){c.readinessCheckedEnd=view.features.windowEndAt;c.checkedAuditable=!!(view.warm&&(this.lowerAuditContext(c,view)||this.notificationAuditFences(c,view,undefined,at)));}if(view?.warm&&view.features){if(c.lastReadyWindowEnd&&view.features.windowEndAt>c.lastReadyWindowEnd&&c.lastAssessmentEnd<c.lastReadyWindowEnd&&c.lastExpiredWindowEnd<c.lastReadyWindowEnd){c.lastExpiredWindowEnd=c.lastReadyWindowEnd;this.counters.decisionDeadlineMisses++;this.noteFailure('decision-expired',c.identity.baseMint,'DECISION_DEADLINE_EXPIRED',at,c,{end:c.lastReadyWindowEnd,deadlineAt:c.lastReadyWindowEnd+PROVISIONAL_RULE.bucketMs});this.finishAuditDispatch(c,'decision-deadline-expired',at);this.record('native-predictive-window-expired',{mint:c.identity.baseMint,at,windowEndAt:c.lastReadyWindowEnd,decisionDeadlineAt:c.lastReadyWindowEnd+PROVISIONAL_RULE.bucketMs,dispatchTrace:this.auditDispatchSummary(c),reason:'no validated predictive decision before next completed bucket; not a strategy rejection'});}if(view.features.windowEndAt!==c.lastReadyWindowEnd&&view.features.windowEndAt!==c.lastAuditFenceWarmingWindowEnd){if(c.checkedAuditable){c.lastReadyWindowEnd=view.features.windowEndAt;c.lastReadyObservedAt=at;this.traceAuditDispatch([c],at,'eligible','await-shared-dispatch');}else this.auditFenceWarming(c,view,at);}}if(view?.features&&view.features.windowEndAt>c.lastFeatureEnd){c.lastFeatureEnd=view.features.windowEndAt;this.counters.featureViews++;this.record('native-candidate-feature-view',{mint:c.identity.baseMint,at,features:view.features,auditVerified:false,financialQualification:false});}}
   for(const c of [...this.candidates.values()])if(c.auditSession)await this.finishAudit(c);
   at=this.now();const pendingAudits=this.readyAudits(at);
   // A rejected scope creates a vacancy, not a new support/subscription
   // deadline. Keep replacement setup out of an already-ready audit batch.
   // Required retirement, current support refresh, heartbeat and recovery
   // continue through native service below; no existing observation is dropped.
   if(!pendingAudits.length&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs)&&this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.postValidationMs,at).admitted)this.registryHousekeeping('allocation',()=>this.allocate(at));
   else if(this.candidates.size<(this.options.maximumDeep??6)&&this.lastAdmissionDeferralBucket!==Math.floor(at/PROVISIONAL_RULE.bucketMs)){this.lastAdmissionDeferralBucket=Math.floor(at/PROVISIONAL_RULE.bucketMs);this.record('native-deep-admission-deferred',{at,reason:'existing-ready-audit-batch-before-replacement-setup',readyMints:pendingAudits.map(c=>c.identity.baseMint),currentDeep:this.candidates.size,maximumDeep:this.options.maximumDeep??6,watchAwarenessRetained:true,requiredNativeServicePreserved:true,financialPermission:false});}
   const servicePolicy={allowSetup:pendingAudits.length===0&&this.discretionaryAdmission(3000,at).admitted,allowRetirement:pendingAudits.length===0};
   const servicePlan=this.options.flow.servicePlan?.(servicePolicy),observedFlow=this.options.flow.usage(),flow=servicePlan?{...observedFlow,nextServiceAt:servicePlan.at,nextServiceDomain:servicePlan.domain,nextServiceAction:servicePlan.action}:observedFlow;
   const usage=this.options.rpc.usage(),rpcGate=usage.rpcDispatchWindow??usage.dispatchWindow,gate=flow.nextServiceDomain==='control'?(usage.controlDispatchWindow??usage.dispatchWindow):rpcGate;at=this.now();
   // Immediate native readiness is stamped by usage(), after variable local
   // validation/reporting work. Compare against a fresh dispatch time. Pending
   // setup/recovery retains its service opportunity while the shared gate waits;
   // lower-priority origin preparation must not force another support refresh.
   if((!gate||flow.nextServiceAt<=at)&&!(servicePlan&&pendingAudits.length&&servicePlan.required&&servicePlan.deadlineAt>at+NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+1500+125)){if(gate&&(gate.physicalBusy||gate.readyAt>at)){this.traceAuditDispatch(pendingAudits,at,'native-service-wait',this.auditGateWaitAction(usage,gate,'await-shared-pacing'),this.auditDispatchContext(at,usage,flow));this.lastOutcome='native-service-shared-pacing';return 'wait';}this.traceAuditDispatch(pendingAudits,at,'native-service-dispatch','perform-required-native-service',this.auditDispatchContext(at,usage,flow));const serviced=await this.serviceFlow(signal,at+3000,servicePolicy);this.lastOutcome=serviced.kind;if(serviced.kind!=='idle'){this.traceAuditDispatch(pendingAudits,this.now(),'native-service-return','recheck-after-'+serviced.kind,{...this.auditDispatchContext(at,usage,flow),serviceResult:serviced.kind,serviceReason:serviced.reason??null,dispatchContextObservedAt:at});return serviced.kind;}at=this.now();}
   // HTTP audit/origin work obeys its own cooldown while the same physical
   // gate still admits valid WebSocket liveness/retirement controls above.
   if(!(pendingAudits.length&&usage.historyRoute&&!rpcGate?.physicalBusy&&usage.inFlight===0&&!usage.waitingOrOperating)&&rpcGate&&(rpcGate.physicalBusy||rpcGate.readyAt>at)){this.traceAuditDispatch(pendingAudits,at,'rpc-gate-wait',this.auditGateWaitAction(usage,rpcGate,'await-shared-pacing-or-http-cooldown'),this.auditDispatchContext(at,usage,flow));this.lastOutcome='native-rpc-shared-pacing';return 'wait';}
   const jobs:ResearchJob[]=[],serviceDeadline=servicePlan?Math.min(...(observedFlow as typeof observedFlow&{nativeServiceDeadlines?:Array<{deadlineAt:number}>}).nativeServiceDeadlines?.map(v=>v.deadlineAt-1500)??[Infinity]):flow.nextServiceAt-200;
   const ready=this.readyAudits(at),dispatchable=ready.filter(c=>c.auditPageRetryAt<=at&&(this.options.rpc.historyQueryReadyAt?.(c.identity.pool,at)??at)<=at);
   if(pendingAudits.length&&!dispatchable.length){const local=ready.filter(c=>c.auditPageRetryAt>at),provider=ready.filter(c=>(this.options.rpc.historyQueryReadyAt?.(c.identity.pool,at)??at)>at);this.traceAuditDispatch(pendingAudits,at,'rpc-gate-wait',provider.length?'await-history-provider-or-query-cooldown':'await-local-uninvoked-page-retry',{...this.auditDispatchContext(at,usage,flow),localRetryDeferredCount:local.length,providerOrQueryBlockedCount:provider.length,earliestLocalRetryAt:local.length?Math.min(...local.map(c=>c.auditPageRetryAt)):null});}
   if(ready.length&&ready.some(c=>{if(c.auditSession)return false;const v=this.options.flow.snapshot(c.identity.baseMint,at);const needsCeiling=!v?.supportContext||v.supportContext.bankClockAt<(v.features?.windowEndAt??Infinity);return needsCeiling&&!this.notificationAuditFences(c,v,undefined,at);})){if(rpcGate&&(rpcGate.physicalBusy||rpcGate.readyAt>at)){this.traceAuditDispatch(ready,at,'rpc-gate-wait','await-primary-support-ceiling',this.auditDispatchContext(at,usage,flow));return 'wait';}if(at<this.nextCeilingRefreshAt){this.traceAuditDispatch(ready,at,'ceiling-backoff','await-bounded-ceiling-refresh',{...this.auditDispatchContext(at,usage,flow),nextCeilingRefreshAt:this.nextCeilingRefreshAt});return 'audit-ceiling-warming';}this.traceAuditDispatch(ready,at,'ceiling-refresh','refresh-confirmed-bank-ceiling',this.auditDispatchContext(at,usage,flow));this.nextCeilingRefreshAt=at+1500;this.options.flow.requestSupportRefresh();this.record('native-shared-audit-ceiling-requested',{at,mints:ready.map(c=>c.identity.baseMint),meaning:'coherent fresh confirmed SDK/Clock context; not a block timestamp or trade'});await this.serviceFlow(signal,at+3000,servicePolicy);return 'audit-ceiling-support';}
   if(ready.length&&serviceDeadline-at<NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+125){
    const action=(flow as {nextServiceAction?:string|null}).nextServiceAction??null,nextAction=flow.nextServiceDomain==='rpc'?'request-early-support-refresh':flow.nextServiceDomain==='control'&&action==='heartbeat'?'request-early-heartbeat':'await-native-service-action';
    if(nextAction==='request-early-heartbeat'&&gate&&(gate.physicalBusy||gate.readyAt>at)){this.traceAuditDispatch(ready,at,'native-service-wait','await-control-runway-gate',this.auditDispatchContext(at,usage,flow));return 'gate-wait';}
    this.traceAuditDispatch(ready,at,'prepare-native-runway',nextAction,this.auditDispatchContext(at,usage,flow));
    if(nextAction==='await-native-service-action')return 'audit-preparation-wait';
    if(nextAction==='request-early-support-refresh')this.options.flow.requestSupportRefresh();else this.options.flow.requestHeartbeat();
    const serviced=await this.serviceFlow(signal,at+2000,servicePolicy);return 'audit-preparation-'+serviced.kind;
   }
   const auditDeadline=Math.min(Math.floor(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs+PROVISIONAL_RULE.bucketMs-1,serviceDeadline);
   if(dispatchable.length&&auditDeadline-at>=NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs+125)jobs.push({id:'audit:'+dispatchable[0]!.identity.baseMint,kind:'enrichment',enqueuedAt:at,eligibleAt:at,deadlineAt:auditDeadline,operationBoundMs:NATIVE_CANDIDATE_AUDIT_PROFILE.operationBoundMs});
   const verification=this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.discretionaryReadMs,at);
   if(!this.verificationSession&&!ready.length&&verification.admitted&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs)&&(!rpcGate||!rpcGate.physicalBusy&&rpcGate.readyAt<=at))this.enqueueActivityOrigin(at);
   const lookupStartedAt=this.now();
   const creation=this.options.enforceTokenAge24h&&!ready.length&&verification.admitted&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs)?this.registry.nextTokenCreationRequest(lookupStartedAt):undefined;
   const seed=this.verificationSession?.seed??this.nextVerification(this.now());
   // These are NEW discretionary requests, not an already-open audit window.
   // Local selection can be slow; stamp their envelope only after it completes.
   // Existing service/audit deadlines and physical cooldowns are never rebased.
   at=this.now();const bootstrap=this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.discretionaryReadMs,at),bootstrapUsage=this.options.rpc.usage(),bootstrapGate=bootstrapUsage.rpcDispatchWindow??bootstrapUsage.dispatchWindow;
   const bootstrapAllowed=!ready.length&&!this.readyAudits(at).length&&bootstrap.admitted&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs)&&!bootstrapUsage.waitingOrOperating&&bootstrapUsage.inFlight===0&&(!bootstrapGate||!bootstrapGate.physicalBusy&&bootstrapGate.readyAt<=this.now());
   const bootstrapDeadline=Math.min(at+2000,serviceDeadline,bootstrap.latestStartAt===null?Infinity:bootstrap.latestStartAt+NATIVE_DEADLINE_POLICY.discretionaryReadMs);
   if(creation&&bootstrapAllowed)jobs.push({id:'token-creation:'+creation.signature,kind:'reconnect',enqueuedAt:at,eligibleAt:at,deadlineAt:bootstrapDeadline,operationBoundMs:NATIVE_DEADLINE_POLICY.discretionaryReadMs});
   if(seed&&bootstrapAllowed)jobs.push({id:'verify:'+seed.signature,kind:'reconnect',enqueuedAt:this.verificationSession?.startedAt??at,eligibleAt:at,deadlineAt:bootstrapDeadline,operationBoundMs:NATIVE_DEADLINE_POLICY.discretionaryReadMs});
   if(creation||seed)this.record('native-candidate-bootstrap-planned',{at,lookupStartedAt,lookupElapsedMs:Math.max(0,at-lookupStartedAt),kind:creation?'token-creation':'origin',admitted:bootstrapAllowed,deadlineAt:Number.isFinite(bootstrapDeadline)?bootstrapDeadline:null,providerRequestStarted:false,financialPermission:false});
   const fresh=this.options.rpc.usage(),dispatch=chooseResearchWork({now:this.now(),readyAt:(jobs.some(job=>job.id.startsWith('audit:'))?(fresh.historyDispatchWindow??fresh.rpcDispatchWindow??fresh.dispatchWindow):(fresh.rpcDispatchWindow??fresh.dispatchWindow))?.readyAt??this.now(),physicalBusy:fresh.waitingOrOperating||fresh.inFlight!==0,nextProtectionAt:null,otherStartSinceProtection:false,jobs});
   this.lastDispatchAt=this.now();if(dispatch.kind==='job'){this.traceAuditDispatch(ready,this.lastDispatchAt,dispatch.job.id.startsWith('audit:')?'audit-selected':'peer-selected',dispatch.job.id.startsWith('audit:')?'dispatch-audit-page':'dispatch-origin-verification',{...this.auditDispatchContext(this.lastDispatchAt,fresh,flow),selectedMint:dispatch.job.id.startsWith('audit:')?dispatchable[0]!.identity.baseMint:null,selectedJob:dispatch.job.id,jobDeadlineAt:dispatch.job.deadlineAt,latestStartAt:dispatch.latestStartAt});if(dispatch.job.id.startsWith('audit:')){const batched=await this.evaluateQuietBatch([...dispatchable,...ready.filter(c=>!dispatchable.includes(c))],dispatch.job.deadlineAt,signal);if(!batched&&this.candidates.get(dispatchable[0]!.identity.baseMint)===dispatchable[0])await this.evaluate(dispatchable[0]!,dispatch.job.deadlineAt,signal);}else if(dispatch.job.id.startsWith('token-creation:')&&creation)await this.verifyTokenCreation(creation,dispatch.job.deadlineAt,signal);else if(seed)await this.verify(seed,dispatch.job.deadlineAt,signal);this.lastOutcome=dispatch.job.id;return dispatch.job.id;}
   this.traceAuditDispatch(ready,this.lastDispatchAt,dispatch.kind==='refuse'?'scheduler-refusal':'scheduler-wait',dispatch.kind==='refuse'?'retain-refused-target':'await-next-dispatch',{...this.auditDispatchContext(this.lastDispatchAt,fresh,flow),dispatchReason:'reason'in dispatch?dispatch.reason:null,until:'until'in dispatch?dispatch.until:null,jobCount:jobs.length,auditDeadlineAt:Number.isFinite(auditDeadline)?auditDeadline:null});return dispatch.kind;
  }catch(error){if(isMarketRegistryContention(error)){this.lastOutcome='MARKET_REGISTRY_CONTENTION';this.record('native-candidate-registry-contention',{at:this.now(),reason:this.lastOutcome,sqliteCode:error.sqliteCode,callbackStarted:false,providerRequestStarted:false,financialExposure:false});return 'wait';}this.lastOutcome=safe(error);this.traceAuditDispatch([...this.candidates.values()],this.now(),'work-exception','retain-and-recheck-target',{reason:this.lastOutcome,physicalSettlementClaimed:false});this.record('native-candidate-work-unavailable',{at:this.now(),reason:this.lastOutcome,providerCooldownUntil:this.options.rpc.cooldownUntil(),financialExposure:false});return 'unavailable';}
  finally{this.working=false;}
 }
 private async verifyTokenCreation(request:{mint:string;signature:string},deadlineAt:number,signal?:AbortSignal){
  const at=this.now();if(!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs))return;
  // Persist the cooldown before dispatch; process death cannot create a hot retry loop.
  this.registry.deferTokenCreationRequest(request,at,'TOKEN_CREATION_REQUEST_PENDING');
  try{
   const tx=await this.options.rpc.call<unknown>('getTransaction',[request.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}],signal,this.admission(deadlineAt));
   const availableAt=this.now(),proof=decodeTokenCreationProof(tx,{...request,availableAt,commitment:'finalized'});
   if(proof){this.registry.putTokenCreationProof(proof);this.record('native-token-creation-verified',{at:availableAt,...proof,financialPermission:false});}
   else{this.registry.deferTokenCreationRequest(request,availableAt,tx===null?'TOKEN_CREATION_NOT_FINALIZED':'TOKEN_CREATION_PROOF_INVALID',tx!==null);this.record('native-token-creation-unavailable',{at:availableAt,mint:request.mint,reason:tx===null?'TOKEN_CREATION_NOT_FINALIZED':'TOKEN_CREATION_PROOF_INVALID',financialPermission:false});}
  }catch(error){this.record('native-token-creation-unavailable',{at:this.now(),mint:request.mint,reason:safe(error),financialPermission:false});}
 }
 /** Exact current source certificate; no later audit, stale generation or
  * merely warm feature view can authorize an external PAPER decision. */
 currentAuditCertificate(mint:string,at=this.now()):NativeAuditCertificate|null{
  const c=this.candidates.get(mint),certificate=this.certificates.get(mint);if(!c||!certificate||!Number.isSafeInteger(at)||at>this.now()||at<certificate.admittedAt||at>certificate.deadlineAt||!this.observationMember(c,at))return null;
  const view=this.options.flow.snapshot(mint,at);if(!view?.warm||!view.features||view.openedAt!==certificate.openedAt||view.connectionId!==certificate.connectionId||view.subscription!==certificate.subscriptionId||view.features.windowStartAt!==certificate.windowStartAt||view.features.windowEndAt!==certificate.windowEndAt||nativePaperFeaturesSha256(view.features)!==certificate.featuresSha256)return null;
  return structuredClone(certificate);
 }
 /** Financial ownership is read from the sole caller-owned ledger. Source
  * retirement releases selected flow while retaining every owned pool proof. */
 certifiedCandidateMints(at=this.now()){return [...this.certificates.keys()].filter(mint=>this.currentAuditCertificate(mint,at)!==null);}
 private resetResolvedAudit(c:Candidate,at:number){
  const mint=c.identity.baseMint;this.certificates.delete(mint);this.finishAuditDispatch(c,'owned-entry-resolved-requires-new-window',at);
  if(c.auditSession){const active=c.auditSession;active.session.cancel('NATIVE_AUDIT_OWNED_ENTRY_RESOLVED');need(this.cancelledAuditDiagnostics.length<6,'NATIVE_AUDIT_DIAGNOSTIC_BOUND');this.cancelledAuditDiagnostics.push({mint,targetEndAt:active.windowEndAt,deadlineAt:active.deadlineAt,cancelledAt:at,session:active.session});delete c.auditSession;}
  const failedEnd=Math.floor(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs;c.lastAssessmentEnd=Math.max(c.lastAssessmentEnd,failedEnd);c.nextAuditAt=Math.max(c.nextAuditAt,failedEnd+PROVISIONAL_RULE.bucketMs);c.lastReadyWindowEnd=0;c.readinessCheckedEnd=0;c.checkedAuditable=false;
 }
 syncFinancialOwnership(mints:ReadonlySet<string>=new Set([...this.candidates.keys(),...this.watch.identitiesInStates(['HELD','ENTRY_PENDING'],this.now()).flatMap(row=>row.mint?[row.mint]:[])])){for(const mint of mints){const at=this.now(),state=this.options.financialOwnership?.(mint),row=this.watch.lookupIdentity(mint,at);if(state&&row){if(state==='HELD'){this.watch.finishTechnicalReevaluation(mint,at,'a filled position is managed independently; no entry retry');if(this.candidates.has(mint))this.retire(mint,'PAPER holding uses independent actual-size pricing',at,0);}this.watch.transition(mint,state,'existing isolated financial obligation',at);}else if(row&&['HELD','ENTRY_PENDING'].includes(row.state)){
   const c=this.candidates.get(mint),view=c?this.options.flow.snapshot(mint,at):null,continuous=row.state==='ENTRY_PENDING'&&row.deepSince!==null&&(row.migrationAt===null?this.currentPoolObservation:observationAgeEligible(row.migrationAt,at,row.olderResearch!==undefined,this.observationAgePolicy))&&c?.openedAt!==null&&c!==undefined&&view?.openedAt===c.openedAt&&view.connected&&!view.hasQualityLoss&&!view.suspended;
   if(continuous){this.resetResolvedAudit(c,at);this.watch.resumeContinuousObservation(mint,'owned entry resolved; continuous capture retained; new audited window required',at);this.record('native-candidate-owned-entry-resolved',{mint,at,continuousCaptureRetained:true,oldCertificateInvalidated:true,newWindowEndAfter:Math.floor(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs,financialPermission:false});}
   else{if(c)this.retire(mint,'owned action resolved without continuous observation; fresh full window required',at,30000);else this.watch.transition(mint,'DEFERRED','owned action resolved; new complete observation required',at,{deferUntil:at+30000});}
  }}}
 requestTechnicalReevaluation(mint:string,reason:TechnicalReevaluationReason,failedWindowEndAt:number,at=this.now(),claimedOnly=false){
  if(claimedOnly&&this.watch.technicalReevaluation(mint,at)?.state!=='CLAIMED')return false;if(this.options.financialOwnership?.(mint))return false;this.syncFinancialOwnership(new Set([mint]));const requested=this.watch.requestTechnicalReevaluation(mint,{reason,failedWindowEndAt},at);if(requested){this.certificates.delete(mint);const c=this.candidates.get(mint);if(c){c.nextAuditAt=Math.max(c.nextAuditAt,failedWindowEndAt+PROVISIONAL_RULE.bucketMs);c.lastAssessmentEnd=Math.max(c.lastAssessmentEnd,failedWindowEndAt);}}return requested;
 }
 /** Only ordering metadata: every current certificate and ordinary financial
  * admission still applies, after held/pending work and committed audits. */
 candidateEvaluationOrder(mints:readonly string[],at=this.now()){
  return mints.filter(mint=>{const r=this.watch.technicalReevaluation(mint,at);return !r||!['WAITING','CLAIMED'].includes(r.state)||r.state==='WAITING'&&at>=r.notBefore&&(this.currentAuditCertificate(mint,at)?.windowEndAt??0)>Math.max(r.failedWindowEndAt,r.lastClaimedWindowEndAt??0);}).sort((a,b)=>{const x=this.watch.technicalReevaluation(a,at),y=this.watch.technicalReevaluation(b,at);return Number(y?.state==='WAITING')-Number(x?.state==='WAITING')||(x?.requestedAt??at)-(y?.requestedAt??at);});
 }
 claimTechnicalReevaluation(mint:string,at=this.now()){
  const retry=this.watch.technicalReevaluation(mint,at);if(!retry||!['WAITING','CLAIMED'].includes(retry.state))return true;if(this.options.financialOwnership?.(mint))return false;const certificate=this.currentAuditCertificate(mint,at);return !!certificate&&this.watch.claimTechnicalReevaluation(mint,certificate.windowEndAt,at);
 }
 finishTechnicalReevaluation(mint:string,at=this.now(),reason='new complete strategy or risk assessment finished'){this.watch.finishTechnicalReevaluation(mint,at,reason);}
 /** Complete the same fair-observation turn after an actual-size economic
  * rejection as after a failed preliminary assessment. Continuing positive
  * flow alone must not monopolize a deep slot once its primary economics have
  * been evaluated. Completed-negative scopes wait in lightweight awareness
  * for materially new evidence, including when no peer is currently ready. */
 finishEconomicRejection(request:NativeEconomicRejection){
  const at=this.now(),c=request&&this.candidates.get(request.mint),certificate=request&&this.certificates.get(request.mint);
  if(this.options.activeStrategy!==LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION||!c||!certificate||request.kind!=='completed-economic-rejection'||request.strategyVersion!==LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION||request.reason!=='v3.1-nonpositive-joint-conditional-economic-balance'||request.pool!==c.identity.pool||!Number.isSafeInteger(request.at)||request.at>at||!Number.isSafeInteger(request.decisionAt)||!Number.isSafeInteger(request.quoteAt)||request.quoteAt>request.decisionAt||request.decisionAt>request.at||request.quoteAt<request.openedAt||request.openedAt!==c.openedAt||request.openedAt!==certificate.openedAt||request.windowEndAt!==c.lastAssessmentEnd||request.windowEndAt!==certificate.windowEndAt||request.decisionAt<request.windowEndAt||request.decisionAt>certificate.deadlineAt||typeof request.quoteEvidence!=='string'||request.quoteEvidence.length<1||request.quoteEvidence.length>512||/[\u0000-\u001f]/.test(request.quoteEvidence)||this.options.financialOwnership?.(request.mint)||c.auditSession)return false;
  this.watch.noteEvaluation(request.mint,{kind:'economic-rejection',windowEndAt:request.windowEndAt,evidence:request.quoteEvidence,...(request.reobservationCostLamports?{minimumEconomicChangeLamports:request.reobservationCostLamports}:{})},at);
  const excluded=new Set(this.candidates.keys());let peer=this.watch.next(at,excluded,{requireOrigin:!this.currentPoolObservation});
  while(peer?.mint){const identity=this.observationIdentity(peer);if(identity&&this.observationAllowed(peer,at))break;this.record('native-waiting-peer-identity-unavailable',{at,mint:peer.mint,archivalCreationRequired:!this.currentPoolObservation,primaryNegativeDecisionUnchanged:true,financialPermission:false});excluded.add(peer.mint);peer=this.watch.next(at,excluded,{requireOrigin:!this.currentPoolObservation});}
  this.watch.finishTechnicalReevaluation(request.mint,at,'primary exact-size economic assessment completed');
  this.record('native-candidate-economic-rejection-completed',{...request,at,waitingPeerMint:peer?.mint??null,deepSlotReleased:true,peerAllocationClaimed:false,ordinaryWatchPreserved:true,newFinancialPermission:false,meaning:'Completed primary economics releases one observation turn; existing fair admission and fresh-window requirements remain.'});
  this.retire(request.mint,'primary exact-size economic rejection completed; wait for materially new evidence',at,0);return true;
 }
 checkpoint(){this.pruneProofCache(this.now());return {schemaVersion:1,observationAgePolicy:this.observationAgePolicy,generatedAt:this.now(),dataContract:this.dataContract,watch:this.watch.export(),origins:[...this.originProofs.values()].map(p=>structuredClone(p)),financialWriterOpened:false};}
 onPhysicalOperationStarted(input:{at:number;method:string;physicalId:string|number}){const current=this.pendingAuditPhysical;if(!current||input.method!=='getSignaturesForAddress')return false;return this.productivity.physicalStarted(current.mint,current.windowEndAt,input.at,String(input.physicalId));}
 onFinancialOutcome(input:{mint:string;kind:NativeSlotFinancialKind;at:number;key:string}){this.productivity.financial(input);if(input.kind==='primary-evaluated'&&this.registry.markDistinct(this.runScope+':pipeline-primary',input.mint+':'+input.key,input.at))this.primaryEconomicEvaluations++;}
 sourceAdmissionStatus(at=this.now()){const flow=this.options.flow.usage(),ownerAdmissionOpen=this.options.admissionOpen?.()??true,lastOutcome=this.lastOutcome===null?null:this.lastOutcome.startsWith('audit:')?'AUDIT_DISPATCHED':this.lastOutcome.startsWith('verify:')?'ORIGIN_VERIFICATION_DISPATCHED':nativeCandidateFailureReason(this.lastOutcome).reasonCode;return {engineOpen:!this.stopped&&this.sourceAdmissionStopReason===null&&ownerAdmissionOpen,stopped:this.stopped,ownerAdmissionOpen,sourceWork125Allowed:this.sourceWorkAllowed(125),deepSetup6000Allowed:this.discretionaryAdmission(6000,at).admitted,allocation125Allowed:this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.postValidationMs,at).admitted&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs),physicalSetup3000Allowed:this.discretionaryAdmission(3000,at).admitted&&this.sourceWorkAllowed(3000),lastOutcome,hasNativeFatal:!!flow.fatal};}
 slotProductivity(at=this.now()){return this.productivity.snapshot(at);}
 pipelineThroughput(at=this.now(),retainedMarketIdentities?:number){
  return this.pipelineThroughputWithProductivity(at,this.slotProductivity(at),retainedMarketIdentities);
 }
 private pipelineThroughputWithProductivity(at:number,productivity:ReturnType<NativeSlotProductivity['snapshot']>,retainedMarketIdentities?:number){
  const backlog=this.watch.serviceableBacklog(at,{requireOrigin:!this.currentPoolObservation}),usage=this.options.rpc.usage(),flow=this.options.flow.usage(),maximum=this.options.maximumDeep??6,physicalOccupancy=flow.candidates+flow.retiring;
  const sourceReady=this.open()&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs),providerReady=!usage.closed&&!usage.fatal&&this.options.rpc.cooldownUntil()<=at&&!usage.waitingOrOperating&&usage.inFlight===0&&(usage.rpcDispatchWindow??usage.dispatchWindow)?.readyAt!<=at&&(usage.controlDispatchWindow??usage.dispatchWindow)?.readyAt!<=at,localReady=this.discretionaryAdmission(3000,at).admitted&&this.sourceWorkAllowed(3000);
  const potentialWaiting=Math.max(0,backlog.population.serviceableNow-Math.max(0,maximum-physicalOccupancy));
  return {version:'native-pipeline-throughput-v1' as const,sourceInstanceId:this.runScope,startedAt:productivity.startedAt,generatedAt:at,population:{...backlog.population,retained:retainedMarketIdentities??this.registry.cohortCounts(0,at).discoveredDistinct,capacityWaiting:sourceReady&&providerReady&&localReady?potentialWaiting:null},capacityWitness:{potentialWaiting,sourceReady,providerReady,localReady,physicalOccupancy,configuredSlots:maximum},waits:backlog.waits,flow:{...this.registry.cohortCounts(productivity.startedAt,at),serviceableArrivals:null,deepAdmissions:productivity.counts.allocations,auditCompletions:this.counters.auditedWindows,financialEvaluations:this.primaryEconomicEvaluations,qualified:productivity.counts.qualified,entryFills:productivity.counts.entryFills,exitFills:productivity.counts.exitFills},limitations:['RETAINED_NOT_QUEUE','LOCAL_SERVICEABILITY_REQUIRES_RUNTIME_PROVIDER_ADMISSION','SHARED_HINTS_NOT_QUALIFICATION','INTAKE_COUNTS_ARE_NEW_UNIQUE_IDENTITY_COHORT','SERVICEABLE_QUEUE_WAIT_IS_NOT_CAUSAL_CAPACITY_DELAY',this.currentPoolObservation?'CURRENT_POOL_SUPPORT_REQUIRED_ARCHIVE_OPTIONAL':'ORIGIN_PROOF_REVALIDATED_AT_ADMISSION','SERVICEABLE_ARRIVALS_UNAVAILABLE','CAPACITY_COUNT_WITHHELD_WHILE_RUNTIME_OR_PROVIDER_BLOCKED']};
 }
 marketCoverage(at=this.now()){const coverage=this.registry.coverageSnapshot(at);return {...coverage,pipeline:this.pipelineThroughput(at,coverage.lifetime.uniqueTokensDiscovered)};}
 private marketCoverageWithProductivity(at:number,productivity:ReturnType<NativeSlotProductivity['snapshot']>){const coverage=this.registry.coverageSnapshot(at);return {...coverage,pipeline:this.pipelineThroughputWithProductivity(at,productivity,coverage.lifetime.uniqueTokensDiscovered)};}
 private watchStatus(at:number){const watch=this.watch.snapshot(at,this.options.activeStrategy);return {...watch,summary:{...watch.summary,auditDiagnostics:this.failureDiagnostics.snapshot()}};}
 status(){
  // One publication uses one current productivity snapshot; standalone readers
  // still take fresh snapshots and no values are cached between publications.
  const at=this.now(),watch=this.watchStatus(at),productivity=this.slotProductivity(at);
  return {...(this.options.enforceTokenAge24h?{tokenAgeScope:this.registry.tokenAgeSummary(at)}:{}),version:NATIVE_CANDIDATE_VERSION,mode:'candidate-evaluation',experimental:true,authoritative:false,running:!this.stopped,generatedAt:at,strategyVersion:PROVISIONAL_RULE.version,dataContract:this.dataContract,auditProfile:NATIVE_CANDIDATE_AUDIT_PROFILE,auditDispatchDiagnostics:NATIVE_AUDIT_DISPATCH_DIAGNOSTICS,observationAgePolicy:this.observationAgePolicy,financialExecutionAuthorized:false,financialWriterOpened:false,liveTradingEnabled:false,watch,counters:{...this.counters,...(this.options.activeStrategy?this.activeCounters:{})},...(this.options.activeStrategy?{activeStrategyVersion:this.options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION?LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:this.options.activeStrategy===LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION?LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION:ADAPTIVE_MOMENTUM_V2_VERSION,baselineStrategyVersion:PROVISIONAL_RULE.version,activeDecisions:this.activeDecisions.map(d=>({...d}))}:{}),maximumSimultaneousCandidates:this.maximumSimultaneous,verificationQueue:this.registry.verificationCount(),verificationBacklog:this.registry.verificationStats(at),marketCoverage:this.marketCoverageWithProductivity(at,productivity),slotProductivity:productivity,lastDispatchAt:this.lastDispatchAt,lastOutcome:this.lastOutcome,admissionsClosedReason:this.sourceAdmissionStopReason,decisions:this.decisions.map(d=>({...d})),lastAuditAt:this.lastAuditAt,lastPredictiveAt:this.lastPredictiveAt,candidates:[...this.candidates.values()].map(c=>({mint:c.identity.baseMint,pool:c.identity.pool,migrationAt:c.identity.migrationAt,migrationVerified:c.identity.migrationVerified,identityBasis:c.identity.identityBasis,allocatedAt:c.allocatedAt,openedAt:c.openedAt,lastAssessmentEnd:c.lastAssessmentEnd,auditDispatch:this.auditDispatchSummary(c),auditSession:c.auditSession?{windowEndAt:c.auditSession.windowEndAt,deadlineAt:c.auditSession.deadlineAt,retryAt:c.auditPageRetryAt||null,pendingPage:c.auditSession.session.pending()?.page??null}:null,snapshot:this.options.flow.snapshot(c.identity.baseMint,at)})),flow:this.options.flow.usage(),rpc:this.options.rpc.usage(),economicResults:'unavailable; no financial writer or execution'};
 }
 async stop(reason='bounded candidate-only research interval ended'){this.stopped=true;this.nativeActivityHints.clear();const verification=this.verificationSession;if(verification){verification.controller.abort();verification.pending?.reject(Error('PILOT_MIGRATION_ABORTED'));verification.pending=null;await Promise.resolve();await Promise.resolve();verification.result??={ok:false,reason:'PILOT_MIGRATION_ABORTED'};this.finishVerification(verification);}for(const mint of [...this.candidates.keys()])this.retire(mint,reason,this.now(),0);try{await this.drainCancelledAuditDiagnostics();}finally{await this.options.flow.stop(reason);}this.record('native-candidate-runner-stopped',{at:this.now(),reason,financialWriterOpened:false,flow:this.options.flow.usage()});}
}
