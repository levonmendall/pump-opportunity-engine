import {createHash} from 'node:crypto';

export const NATIVE_OPERATING_SUPERVISION_VERSION='native-operating-supervision-v1' as const;
export const NATIVE_OPERATING_COMPONENTS=['discovery','qualification','slots','revisits','audits','financial','reconciliation','provider','resources','drift'] as const;
export const NATIVE_OPERATING_REASONS=[
 'DISCOVERY_COUNTERS_ADVANCING','DISCOVERY_NO_NEW_IDENTITIES','DISCOVERY_EVIDENCE_UNAVAILABLE','INTAKE_PENDING_WORK','INTAKE_BACKLOG_GROWING','INTAKE_WORKER_UNRESPONSIVE','INTAKE_PHYSICAL_SETTLEMENT_PENDING',
 'QUALIFICATION_PROGRESS','QUALIFICATION_WAITING','QUALIFICATION_EVIDENCE_UNAVAILABLE','REGISTRY_SAMPLE_STALE',
 'FOUR_SLOTS_OCCUPIED','SLOT_AUDIT_PROGRESS','SLOT_TRANSITIONS_PENDING','SLOT_WAIT_WITH_SERVICEABLE_CANDIDATES','SLOT_CAPACITY_MISMATCH','SLOT_EVIDENCE_UNAVAILABLE',
 'REVISITS_OBSERVED_MATERIALITY_UNPROVEN','NO_CURRENT_PROCESS_REVISITS','REVISIT_EVIDENCE_UNAVAILABLE','ALLOCATION_COUNTER_INCONSISTENT','DUPLICATE_IMMUTABLE_PROOF_EVALUATION',
 'AUDIT_COMPLETIONS_ADVANCING','AUDIT_EVIDENCE_FAILURES','AUDIT_WAITING','AUDIT_EVIDENCE_UNAVAILABLE',
 'FINANCIAL_DECISIONS_ADVANCING','FINANCIAL_HANDOFF_EXPIRED','FINANCIAL_INVALID_HANDOFF','FINANCIAL_ADMISSION_CLOSED','FINANCIAL_WAITING_FOR_EVIDENCE','FINANCIAL_EVIDENCE_UNAVAILABLE',
 'FINANCIAL_RECONCILIATION_CURRENT','FINANCIAL_RECONCILIATION_STALE','HOLDING_PROTECTION_OVERDUE','FINANCIAL_MAINTENANCE_FAILURE','RECONCILIATION_EVIDENCE_UNAVAILABLE',
 'PROVIDER_HEALTHY','PROVIDER_RECOVERY_ACTIVE','PROVIDER_PHYSICAL_WORK_IN_FLIGHT','PROVIDER_EVIDENCE_UNAVAILABLE',
 'RESOURCE_HEADROOM_HEALTHY','RESOURCE_PRESSURE','REPORTING_BUDGET_EXCEEDED','RESOURCE_EVIDENCE_UNAVAILABLE',
 'SOURCE_CONFIGURATION_MATCH','SOURCE_CONFIGURATION_DRIFT','SOURCE_IDENTITY_UNAVAILABLE'
] as const;
export const NATIVE_OPERATING_INCIDENT_CODES=[
 'INTAKE_BACKLOG_GROWING','INTAKE_WORKER_UNRESPONSIVE','INTAKE_PHYSICAL_SETTLEMENT_PENDING','REGISTRY_SAMPLE_STALE',
 'SLOT_CAPACITY_MISMATCH','SLOT_WAIT_WITH_SERVICEABLE_CANDIDATES','ALLOCATION_COUNTER_INCONSISTENT','DUPLICATE_IMMUTABLE_PROOF_EVALUATION',
 'AUDIT_EVIDENCE_FAILURES','FINANCIAL_HANDOFF_EXPIRED','FINANCIAL_INVALID_HANDOFF','FINANCIAL_RECONCILIATION_STALE','HOLDING_PROTECTION_OVERDUE','FINANCIAL_MAINTENANCE_FAILURE',
 'PROVIDER_RECOVERY_ACTIVE','RESOURCE_PRESSURE','REPORTING_BUDGET_EXCEEDED','SOURCE_CONFIGURATION_DRIFT'
] as const;
export const NATIVE_OPERATING_LIMITATIONS=['CURRENT_SOURCE_PROCESS_ONLY','COUNTER_DELTAS_NOT_CLOSED_COHORTS','NO_MARKET_DENOMINATOR','REVISIT_MATERIALITY_REQUIRES_PRIVATE_PROOF','UNKNOWN_FIELDS_NOT_ZERO','STDOUT_EMISSION_NOT_DURABLE_RECEIPT','NO_FINANCIAL_AUTHORITY','NO_UNSUPPORTED_AUTOMATIC_RECOVERY'] as const;
export type OperatingComponent=typeof NATIVE_OPERATING_COMPONENTS[number];
export type OperatingReason=typeof NATIVE_OPERATING_REASONS[number];
export type OperatingIncidentCode=typeof NATIVE_OPERATING_INCIDENT_CODES[number];
export type OperatingComponentState='PROGRESSING'|'WAITING'|'BLOCKED'|'DEGRADED'|'UNKNOWN'|'HEALTHY';
export type OperatingIncident={id:string;code:OperatingIncidentCode;component:OperatingComponent;severity:'info'|'warning'|'critical';firstObservedAt:number;lastObservedAt:number;occurrences:number;action:'EXISTING_RECOVERY'|'ESCALATION_REQUIRED'|'OBSERVE';eventAt:number|null;deadlineAt:number|null};
export type OperatingTransition={id:string;code:OperatingIncidentCode;component:OperatingComponent;at:number;transition:'OPENED'|'RESOLVED'};
export type NativeOperatingSupervisionView={version:typeof NATIVE_OPERATING_SUPERVISION_VERSION;scope:'CURRENT_SOURCE_PROCESS';runId:string;sourceCommit:string;configurationSha256:string;startedAt:number;generatedAt:number;sourceGeneration:number;state:'HEALTHY'|'DEGRADED'|'BLOCKED'|'UNKNOWN';components:Array<{component:OperatingComponent;state:OperatingComponentState;reasonCode:OperatingReason;observedAt:number|null;metrics:Record<string,number|null>}>;incidents:OperatingIncident[];activeIncidentCount:number;activeCriticalIncidentCount:number;activeEscalationRequiredCount:number;omittedActiveIncidents:number;recentTransitions:OperatingTransition[];diagnosticDelivery:{attempted:number;emitFailures:number;durableDeliveryVerified:false};financialAuthority:false;automaticDeployment:false;limitations:readonly typeof NATIVE_OPERATING_LIMITATIONS[number][]};

type Identity={runId:string;sourceCommit:string;sourceSha256:string;configurationSha256:string;accountId:string;inceptionAt:number;startedAt:number};
type CandidateIncident=Omit<OperatingIncident,'id'|'firstObservedAt'|'lastObservedAt'|'occurrences'>;
const rec=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const count=(value:unknown):number|null=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):null;
const finite=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const flag=(value:unknown):number|null=>typeof value==='boolean'?Number(value):null;
const clock=(value:unknown,at:number):number|null=>{const n=typeof value==='string'&&value.length<=32?Date.parse(value):count(value);return n!==null&&Number.isSafeInteger(n)&&n>0&&n<=at?n:null;};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

/** Deterministic observation of an already-built status. It has no filesystem,
 * provider, ledger, timer, strategy or recovery authority. Only the existing
 * intake/source/process owners perform their separately checked recoveries. */
export class NativeOperatingSupervision{
 private previous:{generation:number;at:number;counters:Record<string,number|null>}|null=null;
 private active=new Map<OperatingIncidentCode,OperatingIncident>();
 private recent:OperatingTransition[]=[];private incidentSerial=0;private attempted=0;private emitFailures=0;
 constructor(private readonly identity:Identity,private readonly emit?:(value:unknown)=>void){}
 observe(value:unknown):NativeOperatingSupervisionView|null{
  const s=rec(value),at=count(s.generatedAt),generation=count(rec(s.sourceRecovery).generation);
  if(at===null||at<this.identity.startedAt||generation===null||this.previous&&at<this.previous.at)return null;
  if(this.previous&&this.previous.generation!==generation){this.previous=null;this.active.clear();this.recent=[];}
  const source=rec(s.source),runMatch=s.runId===this.identity.runId&&s.startedAt===this.identity.startedAt&&s.accountId===this.identity.accountId&&s.inceptionAt===this.identity.inceptionAt,sourceMatch=source.commit===this.identity.sourceCommit&&source.sha256===this.identity.sourceSha256,configurationMatch=s.configurationSha256===this.identity.configurationSha256;
  const matched=runMatch&&sourceMatch&&configurationMatch;
  const coverage=rec(s.marketCoverage),pipeline=rec(coverage.pipeline),population=rec(pipeline.population),flow=rec(pipeline.flow),registryReporting=rec(rec(coverage.resource).registryReporting),intake=rec(rec(coverage.resource).intakeWorker),intakeHealth=rec(intake.supervision),settlement=rec(intake.workerSettlement);
  const slot=rec(s.slotProductivity),slotCounts=rec(slot.counts),slotFailures=rec(slot.failureCounts),handoff=rec(s.financialHandoff),readiness=rec(s.financialReadiness),maintenance=rec(readiness.maintenance),financial=rec(s.financial),rpc=rec(rec(s.usage).rpc),resources=rec(s.resources),report=rec(s.reporting),timing=rec(s.timing),preparation=rec(s.candidatePreparation);
  const registryDiagnostics=rec(s.marketRegistryDiagnostics),candidateCached=Object.hasOwn(registryDiagnostics,'cachedCandidateStatisticsAt')&&registryDiagnostics.cachedCandidateStatisticsAt!==null,slotAt=clock(slot.generatedAt,at),slotFresh=!candidateCached&&slotAt!==null&&at-slotAt<=30000;
  const counters={discoveries:count(flow.discoveredDistinct),acknowledged:count(intake.processedAcknowledged),received:count(intake.received),pending:count(intake.pending),proofs:count(rec(s.migrationAgeScope).verified),audits:count(flow.auditCompletions),auditFailures:count(slotFailures.auditUnusableWindows),economic:count(handoff.economicDecisions),expired:count(handoff.expiredBeforeDispatch),invalidated:count(handoff.invalidatedBeforeDispatch),maintenanceFailures:count(maintenance.financialFailures),overruns:count(report.projectionOverruns)};
  const delta=(key:keyof typeof counters)=>{const before=matched&&this.previous?.generation===generation?this.previous.counters[key]:null,now=counters[key];return before!==null&&before!==undefined&&now!==null&&now>=before?now-before:null;};
  const components:NativeOperatingSupervisionView['components']=[],candidates:CandidateIncident[]=[];
  const component=(name:OperatingComponent,state:OperatingComponentState,reasonCode:OperatingReason,observedAt:number|null,metrics:Record<string,number|null>)=>components.push({component:name,state,reasonCode,observedAt,metrics});
  const incident=(code:OperatingIncidentCode,name:OperatingComponent,action:OperatingIncident['action']='ESCALATION_REQUIRED',severity:OperatingIncident['severity']='warning',eventAt:number|null=null,deadlineAt:number|null=null)=>candidates.push({code,component:name,action,severity,eventAt,deadlineAt});
  const registryAt=clock(registryReporting.observedAt??pipeline.registryObservedAt??coverage.generatedAt,at),registryAge=registryAt===null?null:at-registryAt,registryFresh=registryAge!==null&&registryAge<=30000;
  if(!registryFresh||candidateCached){counters.discoveries=null;counters.proofs=null;}
  if(!slotFresh){counters.audits=null;counters.auditFailures=null;}
  const pending=counters.pending,ackDelta=delta('acknowledged'),pendingDelta=delta('pending'),arrivalDelta=delta('received'),physicalPending=settlement.physicalSettlementConfirmed===false;
  let discoveryState:OperatingComponentState=counters.discoveries===null?'UNKNOWN':delta('discoveries')!>0?'PROGRESSING':'WAITING',discoveryReason:OperatingReason=counters.discoveries===null?'DISCOVERY_EVIDENCE_UNAVAILABLE':delta('discoveries')!>0?'DISCOVERY_COUNTERS_ADVANCING':'DISCOVERY_NO_NEW_IDENTITIES';
  if(physicalPending){discoveryState='BLOCKED';discoveryReason='INTAKE_PHYSICAL_SETTLEMENT_PENDING';incident('INTAKE_PHYSICAL_SETTLEMENT_PENDING','discovery','EXISTING_RECOVERY');}
  else if(intake.reasonCode==='WORKER_LIVENESS_TIMEOUT'){discoveryState='DEGRADED';discoveryReason='INTAKE_WORKER_UNRESPONSIVE';incident('INTAKE_WORKER_UNRESPONSIVE','discovery','EXISTING_RECOVERY');}
  else if(pendingDelta!==null&&pendingDelta>0&&arrivalDelta!==null&&ackDelta!==null&&arrivalDelta>ackDelta){discoveryState='WAITING';discoveryReason='INTAKE_BACKLOG_GROWING';incident('INTAKE_BACKLOG_GROWING','discovery','OBSERVE','info');}
  else if(pending!==null&&pending>0){discoveryState='WAITING';discoveryReason='INTAKE_PENDING_WORK';}
  component('discovery',discoveryState,discoveryReason,clock(intake.lastCommitAt??coverage.generatedAt,at),{distinctDiscoveries:counters.discoveries,pendingIntake:pending,acknowledgedIntake:counters.acknowledged,arrivalDelta,acknowledgedDelta:ackDelta,pendingDelta,workerGeneration:count(intake.workerGeneration),livenessTimeouts:count(intakeHealth.timeouts)});
  const eligible=registryFresh&&!candidateCached?count(population.eligibleNow):null,serviceable=registryFresh&&!candidateCached?count(population.serviceableNow):null;
  component('qualification',!registryFresh||candidateCached?'UNKNOWN':delta('proofs')!>0?'PROGRESSING':eligible===null?'UNKNOWN':'WAITING',!registryFresh?'REGISTRY_SAMPLE_STALE':candidateCached?'QUALIFICATION_EVIDENCE_UNAVAILABLE':delta('proofs')!>0?'QUALIFICATION_PROGRESS':eligible===null?'QUALIFICATION_EVIDENCE_UNAVAILABLE':'QUALIFICATION_WAITING',registryAt,{eligibleNow:eligible,serviceableNow:serviceable,verifiedMigrations:counters.proofs,qualificationPending:count(rec(intake.qualification).pendingMints),registryAgeMs:registryAge,proofDelta:delta('proofs')});
  if(registryAt!==null&&!registryFresh)incident('REGISTRY_SAMPLE_STALE','qualification','OBSERVE');
  const slots=(Array.isArray(slot.slots)?slot.slots:[]).slice(0,4).map(rec),configured=count(slot.configuredSlots),occupied=slots.length===4?slots.filter(row=>typeof row.mint==='string'&&row.mint.length>0).length:null,unusable=slots.filter(row=>row.state==='UNUSABLE').length,waiting=slots.filter(row=>['SUBSCRIPTION_WAIT','REPLACEMENT_WAIT','AUDIT_WAIT','PROVIDER_WAIT'].includes(row.state)).length;
  const witness=rec(pipeline.capacityWitness),capacityCurrent=registryFresh&&count(population.capacityWaiting)!==null&&!(Array.isArray(pipeline.limitations)&&pipeline.limitations.includes('DETACHED_REGISTRY_SAMPLE_NOT_CURRENT_CAPACITY'))&&witness.sourceReady===true&&witness.providerReady===true&&witness.localReady===true;
  const slotMismatch=slotFresh&&configured!==null&&configured!==4,awaitingService=slotFresh&&capacityCurrent&&serviceable!==null&&serviceable>0&&occupied!==null&&occupied<4;
  component('slots',slotMismatch?'DEGRADED':!slotFresh||occupied===null||configured===null?'UNKNOWN':awaitingService?'WAITING':delta('audits')!>0?'PROGRESSING':'WAITING',slotMismatch?'SLOT_CAPACITY_MISMATCH':!slotFresh||occupied===null||configured===null?'SLOT_EVIDENCE_UNAVAILABLE':awaitingService?'SLOT_WAIT_WITH_SERVICEABLE_CANDIDATES':delta('audits')!>0?'SLOT_AUDIT_PROGRESS':occupied===4?'FOUR_SLOTS_OCCUPIED':'SLOT_TRANSITIONS_PENDING',clock(slot.generatedAt,at),{configured,occupied,waiting:slots.length?waiting:null,auditActive:slots.length?slots.filter(row=>row.state==='AUDIT_ACTIVE').length:null,unusable:slots.length?unusable:null,serviceableNow:serviceable,preparationAttemptsSinceProgress:count(rec(preparation.progress).attemptsSinceProgress),auditCompletedDelta:delta('audits')});
  if(slotMismatch)incident('SLOT_CAPACITY_MISMATCH','slots');if(awaitingService)incident('SLOT_WAIT_WITH_SERVICEABLE_CANDIDATES','slots','OBSERVE','info');
  const allocationProvenance=rec(slot.allocationProvenance),processAllocationBound=slotFresh&&allocationProvenance.scope==='CURRENT_SOURCE_PROCESS'&&allocationProvenance.runId===this.identity.runId,allocations=processAllocationBound?count(allocationProvenance.allocations):null,first=processAllocationBound?count(allocationProvenance.firstTimeObservations):null,revisits=processAllocationBound?count(allocationProvenance.currentRunRevisits):null,allocationMismatch=allocations!==null&&first!==null&&revisits!==null&&allocations!==first+revisits;
  component('revisits',allocationMismatch?'DEGRADED':revisits===null||revisits>0?'UNKNOWN':'HEALTHY',allocationMismatch?'ALLOCATION_COUNTER_INCONSISTENT':revisits===null?'REVISIT_EVIDENCE_UNAVAILABLE':revisits>0?'REVISITS_OBSERVED_MATERIALITY_UNPROVEN':'NO_CURRENT_PROCESS_REVISITS',clock(slot.generatedAt,at),{allocations,firstObservations:first,currentProcessRevisits:revisits,sourceInstanceAllocationsWithPriorPromotion:count(slotCounts.repromotions),sourceInstanceAuditedDistinct:count(slotCounts.distinctAudited),sourceInstanceEvaluatedDistinct:count(slotCounts.distinctPrimaryEvaluated)});
  if(allocationMismatch)incident('ALLOCATION_COUNTER_INCONSISTENT','revisits');
  const auditDelta=delta('audits'),auditFailures=delta('auditFailures');component('audits',auditFailures!>0?'DEGRADED':auditDelta!>0?'PROGRESSING':counters.audits===null?'UNKNOWN':'WAITING',auditFailures!>0?'AUDIT_EVIDENCE_FAILURES':auditDelta!>0?'AUDIT_COMPLETIONS_ADVANCING':counters.audits===null?'AUDIT_EVIDENCE_UNAVAILABLE':'AUDIT_WAITING',clock(slot.generatedAt,at),{completed:counters.audits,completedDelta:auditDelta,historyFailures:count(slotFailures.historyNotObservedWindows),deadlineFailures:count(slotFailures.decisionDeadlineWindows),unusableWindows:counters.auditFailures,providerFailures:count(slotFailures.providerUnavailableWindows)});if(auditFailures!>0)incident('AUDIT_EVIDENCE_FAILURES','audits');
  const expiredDelta=delta('expired'),invalidDelta=delta('invalidated'),economicDelta=delta('economic'),active=(Array.isArray(handoff.active)?handoff.active:[]).slice(0,16).map(rec),overdue=active.find(row=>count(row.deadlineAt)!==null&&row.deadlineAt<at),admissionClosed=typeof readiness.monitoringAdmissionReason==='string'&&readiness.monitoringAdmissionReason.length>0;
  component('financial',expiredDelta!>0||invalidDelta!>0||overdue?'DEGRADED':admissionClosed?'BLOCKED':economicDelta!>0?'PROGRESSING':counters.economic===null?'UNKNOWN':'WAITING',expiredDelta!>0||overdue?'FINANCIAL_HANDOFF_EXPIRED':invalidDelta!>0?'FINANCIAL_INVALID_HANDOFF':admissionClosed?'FINANCIAL_ADMISSION_CLOSED':economicDelta!>0?'FINANCIAL_DECISIONS_ADVANCING':counters.economic===null?'FINANCIAL_EVIDENCE_UNAVAILABLE':'FINANCIAL_WAITING_FOR_EVIDENCE',clock(handoff.generatedAt,at),{handoffs:count(handoff.seen),economicDecisions:counters.economic,economicDecisionDelta:economicDelta,expired:counters.expired,expiredDelta,invalidated:counters.invalidated,activeCertificates:Array.isArray(handoff.active)?active.length:null,pendingOrders:s.pending&&typeof s.pending==='object'&&!Array.isArray(s.pending)?Object.keys(s.pending).length:null});
  if(expiredDelta!>0||overdue)incident('FINANCIAL_HANDOFF_EXPIRED','financial','ESCALATION_REQUIRED','warning',null,overdue?count(overdue.deadlineAt):null);if(invalidDelta!>0)incident('FINANCIAL_INVALID_HANDOFF','financial');
  const positionMap=rec(s.positions),positions=s.positions&&typeof s.positions==='object'&&!Array.isArray(s.positions)?Object.keys(positionMap).length:null,orders=s.pending&&typeof s.pending==='object'&&!Array.isArray(s.pending)?Object.keys(s.pending).length:null,reconciledAt=clock(rec(financial.daily).reconciledAt??rec(s.sourceTimes).financialReconciliationAt,at),reconciliationAge=reconciledAt===null?null:at-reconciledAt;
  // Reuse the actual per-position protection epoch. Process start or an old
  // unrelated position completion cannot manufacture a newly held token's gap.
  const gapRows=(Array.isArray(timing.openProtectionGaps)?timing.openProtectionGaps:[]).slice(0,16).map(rec),validGaps=gapRows.filter(row=>typeof row.mint==='string'&&Object.hasOwn(positionMap,row.mint)&&clock(row.from,at)!==null&&row.at===at&&finite(row.gapMs)===at-row.from),gapMints=new Set(validGaps.map(row=>row.mint));
  const protectionGap=positions!==null&&positions>0&&validGaps.length===positions&&gapMints.size===positions?Math.max(...validGaps.map(row=>Number(row.gapMs))):null,overdueGap=validGaps.find(row=>row.gapMs>4000),protectionOverdue=!!overdueGap,maintenanceFailureDelta=delta('maintenanceFailures');
  const reconciliationStale=reconciliationAge!==null&&reconciliationAge>2000,protectionUnknown=positions!==null&&positions>0&&protectionGap===null;
  component('reconciliation',protectionOverdue||maintenanceFailureDelta!>0||reconciliationStale?'DEGRADED':reconciliationAge===null||protectionUnknown?'UNKNOWN':'HEALTHY',protectionOverdue?'HOLDING_PROTECTION_OVERDUE':maintenanceFailureDelta!>0?'FINANCIAL_MAINTENANCE_FAILURE':reconciliationStale?'FINANCIAL_RECONCILIATION_STALE':reconciliationAge===null||protectionUnknown?'RECONCILIATION_EVIDENCE_UNAVAILABLE':'FINANCIAL_RECONCILIATION_CURRENT',reconciledAt,{reconciliationAgeMs:reconciliationAge,positions,pendingOrders:orders,protectionGapMs:protectionGap,maintenanceFailures:counters.maintenanceFailures,maintenanceFailureDelta});
  if(protectionOverdue)incident('HOLDING_PROTECTION_OVERDUE','reconciliation','EXISTING_RECOVERY','critical',null,Number(overdueGap!.from)+4000);if(reconciliationStale)incident('FINANCIAL_RECONCILIATION_STALE','reconciliation','EXISTING_RECOVERY');if(maintenanceFailureDelta!>0)incident('FINANCIAL_MAINTENANCE_FAILURE','reconciliation','EXISTING_RECOVERY','critical');
  const inFlight=count(rpc.inFlight),providerFatal=typeof rpc.fatal==='string'&&rpc.fatal.length>0,sourceRecovering=typeof rec(s.sourceRecovery).reason==='string'&&rec(s.sourceRecovery).reason.length>0,providerRestricted=count(rec(rpc.protectionRecovery).providerRestrictionUntil),restricted=providerRestricted!==null&&providerRestricted>at;
  component('provider',providerFatal||sourceRecovering||restricted?'BLOCKED':inFlight===null?'UNKNOWN':inFlight>0||rpc.waitingOrOperating===true?'WAITING':'HEALTHY',providerFatal||sourceRecovering||restricted?'PROVIDER_RECOVERY_ACTIVE':inFlight===null?'PROVIDER_EVIDENCE_UNAVAILABLE':inFlight>0||rpc.waitingOrOperating===true?'PROVIDER_PHYSICAL_WORK_IN_FLIGHT':'PROVIDER_HEALTHY',at,{physicalInFlight:inFlight,waitingOrOperating:flag(rpc.waitingOrOperating),physicalStarts:count(rec(handoff.requestTiming).physicalStarts),physicalSettlements:count(rec(handoff.requestTiming).physicalSettlements),fatal:typeof rpc.fatal==='string'||rpc.fatal===null?Number(providerFatal):null,providerRestrictionUntil:providerRestricted});if(providerFatal||sourceRecovering||restricted)incident('PROVIDER_RECOVERY_ACTIVE','provider','EXISTING_RECOVERY');
  const overrun=finite(report.lastProjectionMs)!>250,resourcePressure=resources.state==='pressure'||rec(s.resourceControl).candidateAdmissionAllowed===false;
  component('resources',resourcePressure||overrun?'DEGRADED':resources.state==='normal'?'HEALTHY':'UNKNOWN',resourcePressure?'RESOURCE_PRESSURE':overrun?'REPORTING_BUDGET_EXCEEDED':resources.state==='normal'?'RESOURCE_HEADROOM_HEALTHY':'RESOURCE_EVIDENCE_UNAVAILABLE',clock(resources.sampleAt,at),{residentBytes:count(resources.rssBytes),availableMemoryBytes:count(resources.availableMemoryBytes),availableDiskBytes:count(resources.availableDiskBytes),reportLastMs:finite(report.lastProjectionMs),reportMaximumMs:finite(report.maximumProjectionMs),reportOverruns:counters.overruns,reportOverrunDelta:delta('overruns')});if(resourcePressure)incident('RESOURCE_PRESSURE','resources','EXISTING_RECOVERY');if(overrun)incident('REPORTING_BUDGET_EXCEEDED','resources','OBSERVE');
  component('drift',matched?'HEALTHY':'DEGRADED',matched?'SOURCE_CONFIGURATION_MATCH':'SOURCE_CONFIGURATION_DRIFT',at,{sourceMatches:Number(sourceMatch),configurationMatches:Number(configurationMatch),runMatches:Number(runMatch),clockMatches:1});if(!matched)incident('SOURCE_CONFIGURATION_DRIFT','drift','ESCALATION_REQUIRED','critical');
  // Resolution requires the particular incident's witness. A different known
  // failure in the same component cannot resolve missing protection/history.
  const resolutionKnown=new Set<OperatingIncidentCode>();
  const resolveWhen=(code:OperatingIncidentCode,known:boolean)=>{if(known)resolutionKnown.add(code);};
  resolveWhen('INTAKE_BACKLOG_GROWING',pending!==null&&counters.received!==null&&counters.acknowledged!==null);
  resolveWhen('INTAKE_WORKER_UNRESPONSIVE',intake.state==='ready'&&count(intake.workerGeneration)!==null);
  resolveWhen('INTAKE_PHYSICAL_SETTLEMENT_PENDING',settlement.physicalSettlementConfirmed===true||intake.state==='ready'&&Object.hasOwn(intake,'workerSettlement')&&intake.workerSettlement===null);
  resolveWhen('REGISTRY_SAMPLE_STALE',registryAt!==null&&registryFresh);
  resolveWhen('SLOT_CAPACITY_MISMATCH',slotFresh&&configured!==null);
  resolveWhen('SLOT_WAIT_WITH_SERVICEABLE_CANDIDATES',slotFresh&&(occupied===4||capacityCurrent&&serviceable!==null));
  resolveWhen('ALLOCATION_COUNTER_INCONSISTENT',allocations!==null&&first!==null&&revisits!==null);
  resolveWhen('AUDIT_EVIDENCE_FAILURES',slotFresh&&counters.auditFailures!==null);
  resolveWhen('FINANCIAL_HANDOFF_EXPIRED',Array.isArray(handoff.active)&&counters.expired!==null);
  resolveWhen('FINANCIAL_INVALID_HANDOFF',counters.invalidated!==null);
  resolveWhen('FINANCIAL_RECONCILIATION_STALE',reconciliationAge!==null);
  resolveWhen('HOLDING_PROTECTION_OVERDUE',positions===0||protectionGap!==null);
  resolveWhen('FINANCIAL_MAINTENANCE_FAILURE',counters.maintenanceFailures!==null);
  resolveWhen('PROVIDER_RECOVERY_ACTIVE',inFlight!==null&&(rpc.fatal===null||typeof rpc.fatal==='string')&&(rec(s.sourceRecovery).reason===null||typeof rec(s.sourceRecovery).reason==='string'));
  resolveWhen('RESOURCE_PRESSURE',resources.state==='normal'||resources.state==='pressure');
  resolveWhen('REPORTING_BUDGET_EXCEEDED',finite(report.lastProjectionMs)!==null);
  resolveWhen('SOURCE_CONFIGURATION_DRIFT',matched);
  this.previous=matched?{generation,at,counters}:null;this.updateIncidents(candidates,generation,at,resolutionKnown);
  const severityRank={critical:0,warning:1,info:2},incidents=[...this.active.values()].sort((a,b)=>severityRank[a.severity]-severityRank[b.severity]||b.firstObservedAt-a.firstObservedAt).slice(0,12).map(row=>({...row})),state:NativeOperatingSupervisionView['state']=incidents.some(row=>row.severity==='critical'||row.severity==='warning')?'DEGRADED':components.some(row=>row.state==='BLOCKED')?'BLOCKED':components.some(row=>row.state==='UNKNOWN')?'UNKNOWN':'HEALTHY';
  return {version:NATIVE_OPERATING_SUPERVISION_VERSION,scope:'CURRENT_SOURCE_PROCESS',runId:this.identity.runId,sourceCommit:this.identity.sourceCommit,configurationSha256:this.identity.configurationSha256,startedAt:this.identity.startedAt,generatedAt:at,sourceGeneration:generation,state,components,incidents,activeIncidentCount:this.active.size,activeCriticalIncidentCount:[...this.active.values()].filter(row=>row.severity==='critical').length,activeEscalationRequiredCount:[...this.active.values()].filter(row=>row.action==='ESCALATION_REQUIRED').length,omittedActiveIncidents:Math.max(0,this.active.size-incidents.length),recentTransitions:this.recent.map(row=>({...row})),diagnosticDelivery:{attempted:this.attempted,emitFailures:this.emitFailures,durableDeliveryVerified:false},financialAuthority:false,automaticDeployment:false,limitations:NATIVE_OPERATING_LIMITATIONS};
 }
 private updateIncidents(candidates:CandidateIncident[],generation:number,at:number,resolutionKnown:Set<OperatingIncidentCode>){
  const wanted=new Map(candidates.map(row=>[row.code,row]));
  for(const [code,prior]of this.active)if(!wanted.has(code)&&resolutionKnown.has(code)){this.active.delete(code);this.transition({id:prior.id,code,component:prior.component,at,transition:'RESOLVED'},generation);}
  for(const row of wanted.values()){
   const prior=this.active.get(row.code);if(prior){if(prior.lastObservedAt!==at)prior.occurrences++;prior.lastObservedAt=at;prior.deadlineAt=row.deadlineAt;continue;}
   const id=hash([this.identity.sourceCommit,this.identity.runId,generation,row.code,at,++this.incidentSerial].join(':')),value:OperatingIncident={...row,id,firstObservedAt:at,lastObservedAt:at,occurrences:1};this.active.set(row.code,value);this.transition({id,code:row.code,component:row.component,at,transition:'OPENED'},generation);
  }
 }
 private transition(value:OperatingTransition,generation:number){
  this.recent.push(value);if(this.recent.length>16)this.recent.shift();if(!this.emit)return;this.attempted++;
  try{this.emit({kind:'poe-operating-supervision-transition',sourceCommit:this.identity.sourceCommit,configurationSha256:this.identity.configurationSha256,runId:this.identity.runId,sourceGeneration:generation,sourceAt:value.at,...value,financialAuthority:false,durableDeliveryVerified:false});}catch{this.emitFailures++;}
 }
}
