/** Bounded diagnostics projected from the SAME authoritative source snapshot.
 * No financial writer, provider, credential or dashboard-side inference. */
export const ORIGINAL_POE_ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e';
export const ORIGINAL_POE_INCEPTION='2026-10-26T22:07:36.212Z';
export const OPERATING_INTELLIGENCE_VERSION='poe-operating-intelligence-v1';
type Count=number|null;
const EVIDENCE_PRESSURE_CODES=['FILESYSTEM_RESERVE','RECORD_BOUND','YOUNG_DIAGNOSTIC_CAPACITY','YOUNG_SEGMENT_CAPACITY','DIAGNOSTIC_HEADROOM','DIAGNOSTIC_SEGMENT_HEADROOM','INTERRUPTED_ESSENTIAL_PROOF','CHECKPOINT_UNAVAILABLE','RECORD_IO_OR_INTEGRITY_FAILURE','FILESYSTEM_UNAVAILABLE','RETENTION_IO_OR_INTEGRITY_FAILURE','RECOVERY_CHECKPOINT_UNAVAILABLE','OTHER_UNEXPORTED_REASON'] as const;
const RECOVERY_REASON_CODES=['ROLLING_RESOURCE_OR_EVIDENCE_PRESSURE','CANDIDATE_PROVIDER_FAILURE','CANDIDATE_STEP_UNAVAILABLE','OTHER_UNEXPORTED_REASON'] as const;
type EvidencePressureCode=typeof EVIDENCE_PRESSURE_CODES[number];
type RecoveryReasonCode=typeof RECOVERY_REASON_CODES[number];
export type OperatingAdmission={
 financialProjectionReady:boolean|null;supervisedNewRiskAllowed:boolean|null;candidateResourceAdmissionAllowed:boolean|null;
 evidenceAdmissionAllowed:boolean|null;evidencePressureReasonCode:EvidencePressureCode|null;evidenceDiagnosticBytes:Count;evidenceDiagnosticLimitBytes:Count;evidenceRequiresCriticalRecovery:boolean|null;evidenceRefusedRecords:Count;
 sourceRecoveryGeneration:Count;sourceRecoveryFailures:Count;sourceRecoveryReasonCode:RecoveryReasonCode|null;sourceRecoveryRetryAt:string|null;sourceRecoveryClosingSettled:boolean|null;sourceRestartRequired:boolean|null;
 proofPreparationState:'not-started'|'pending'|'complete'|'failed'|null;
};
export type OperatingIntelligence={
 version:typeof OPERATING_INTELLIGENCE_VERSION;
 admission?:OperatingAdmission;
 run:{id:string;startedAt:string;mode:'persistent-paper'|'bounded-verification'|'maintenance';configurationSha256:string;strategyVersion:string};
 candidates:{migrationsReceived:Count;verifiedOrigins:Count;known:Count;watch:Count;eligible:Count;deepActive:Count;deepMaximum:Count;queued:Count;promoted:Count;repromoted:Count;demoted:Count;completeWindows:Count;auditedWindows:Count;uniqueEvaluated:Count;uniqueAudited:Count;predictiveAssessments:Count;predictivePasses:Count;predictiveFailures:Count;predictiveUnavailable:Count;waitMeanMs:Count;waitMaximumMs:Count;olderSelected:Count};
 quality:{captureConnected:boolean|null;qualityGaps:Count;auditUnavailable:Count;auditUnusable:Count;decisionDeadlineMisses:Count;enrichmentDeadlineFailures:Count;incompleteExclusions:Count;capacityExclusions:Count;structuralExclusions:Count;limitations:string[]};
 provider:{rpcRequests:Count;rpcResponseBytes:Count;nativeStreamBytes:Count;broadWatchBytes:Count;discoveryConnected:boolean|null;watchConnected:boolean|null;httpTimeouts:Count;httpErrors:Count;throttles:Count;rollingStartsPerMinute:Count;maximumStartsPerMinute:Count;minimumSpacingMs:Count;primaryCooldownUntil:string|null;historyCooldownUntil:string|null;controlCooldownUntil:string|null};
 resources:{sampleAt:string|null;cpuOneCoreFraction:number|null;rssBytes:Count;availableMemoryBytes:Count;availableDiskBytes:Count;eventLoopLagMs:number|null;state:'normal'|'pressure'|'recovering'|'unavailable'};
 protection:{state:'flat'|'monitored'|'degraded'|'unavailable';targetCadenceMs:Count;completedEvaluationBoundaryMs:Count;lastCompletedAt:string|null;maximumCompletedGapMs:number|null;maximumQuoteAgeAtUseMs:number|null;breaches:Count;unavailableChecks:Count};
 times:{marketNotificationAt:string|null;freshSupportAt:string|null;bankClockAt:string|null;auditAt:string|null;predictiveAt:string|null;reconciliationAt:string|null};
 decisions:{id:string;mint:string;at:string;stage:string;reason:string}[];
 refusals:{reason:string;count:number}[];
 pendingOrders:{id:string;mint:string;side:'buy'|'sell';decidedAt:string;executeAt:string;expiresAt:string;reservedSol:string;quantityMinimum:string;reason:string}[];
};
const rec=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const count=(v:unknown):Count=>Number.isSafeInteger(v)&&(v as number)>=0?v as number:null;
const finite=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const boolean=(v:unknown):boolean|null=>typeof v==='boolean'?v:null;
const bounded=(v:unknown,maximum=256)=>typeof v==='string'&&v.length>0&&v.length<=maximum&&!/[\u0000-\u001f]/.test(v)?v:null;
const first=(...v:unknown[])=>v.find(x=>x!==undefined);
// Recovery errors can include provider text. Export only static classifications,
// never arbitrary messages, URLs, paths, credentials or proof identifiers.
function evidencePressureCode(v:unknown):EvidencePressureCode|null{
 if(v===null||v===undefined)return null;
 return typeof v==='string'&&(EVIDENCE_PRESSURE_CODES as readonly string[]).includes(v)?v as EvidencePressureCode:'OTHER_UNEXPORTED_REASON';
}
function recoveryReasonCode(v:unknown):RecoveryReasonCode|null{
 if(v===null||v===undefined)return null;
 if(v==='rolling resource or evidence pressure')return 'ROLLING_RESOURCE_OR_EVIDENCE_PRESSURE';
 if(typeof v==='string'&&v.startsWith('candidate/provider failure: '))return 'CANDIDATE_PROVIDER_FAILURE';
 if(typeof v==='string'&&v.startsWith('candidate step unavailable: '))return 'CANDIDATE_STEP_UNAVAILABLE';
 return 'OTHER_UNEXPORTED_REASON';
}
/** Null is an unavailable fact, never a manufactured zero. */
export function projectOperatingIntelligence(value:unknown):OperatingIntelligence{
 const s=rec(value),at=count(s.generatedAt),start=count(s.startedAt);
 if(s.accountId!==ORIGINAL_POE_ACCOUNT||s.inceptionAt!==Date.parse(ORIGINAL_POE_INCEPTION)||at===null||start===null||start<Date.parse(ORIGINAL_POE_INCEPTION)||at<start)throw Error('ORIGINAL_OPERATING_SOURCE_BINDING_REQUIRED');
 const time=(v:unknown)=>{const n=count(v);return n!==null&&n>0&&n<=at&&n<=8640000000000000?new Date(n).toISOString():null;};
 const futureTime=(v:unknown)=>{const n=count(v);return n!==null&&n>0&&n<=8640000000000000?new Date(n).toISOString():null;};
 if(!Object.hasOwn(s,'positions')||!Object.hasOwn(s,'pending')||!s.positions||!s.pending||Array.isArray(s.positions)||Array.isArray(s.pending)||typeof s.positions!=='object'||typeof s.pending!=='object')throw Error('OPERATING_OWNERSHIP_REQUIRED');
 const w=rec(s.watch),p=rec(s.independentPredictive),f=rec(s.funnel),u=rec(s.usage),rpc=rec(u.rpc),native=rec(u.native),feeds=rec(u.feeds),timing=rec(s.timing),times=rec(s.sourceTimes),resource=rec(first(s.resources,s.resourceControl)),refusals=rec(s.refusals);
 const runId=bounded(s.runId,128),configurationSha256=bounded(s.configurationSha256,64),strategyVersion=bounded(s.strategyVersion,128);
 if(!runId||!configurationSha256||!/^[a-f0-9]{64}$/.test(configurationSha256)||!strategyVersion)throw Error('OPERATING_RUN_PROVENANCE_REQUIRED');
 const decisions=(Array.isArray(s.decisions)?s.decisions:[]).slice(-50).flatMap((raw:unknown,index:number)=>{const d=rec(raw),when=time(d.at),mint=bounded(d.mint,96),stage=bounded(d.stage,80),reason=bounded(d.reason,512);return when&&mint&&stage&&reason?[{id:bounded(d.id,128)??`${runId}:${index}:${d.at}`,mint,at:when,stage,reason}]:[];});
 const pendingOrders=Object.values(rec(s.pending)).slice(0,3).map(raw=>{const o=rec(raw),fields=['id','mint','side','decidedAt','executeAt','expiresAt','reserved','minReceive','decisionEvidence'];if(fields.some(k=>o[k]===undefined)||!bounded(o.id,128)||!bounded(o.mint,96)||!['buy','sell'].includes(o.side)||!/^(0|[1-9]\d{0,38})$/.test(o.reserved)||!/^(0|[1-9]\d{0,38})$/.test(o.minReceive)||!bounded(o.decisionEvidence,512))throw Error('OPERATING_PENDING_ORDER_PROJECTION');const decidedAt=time(o.decidedAt);if(!decidedAt||!Number.isSafeInteger(o.executeAt)||!Number.isSafeInteger(o.expiresAt)||o.executeAt<o.decidedAt+500||o.expiresAt<=o.executeAt||o.expiresAt>o.decidedAt+30000)throw Error('OPERATING_PENDING_ORDER_TIME');const n=BigInt(o.reserved);return {id:o.id,mint:o.mint,side:o.side as 'buy'|'sell',decidedAt,executeAt:new Date(o.executeAt).toISOString(),expiresAt:new Date(o.expiresAt).toISOString(),reservedSol:`${n/1000000000n}.${(n%1000000000n).toString().padStart(9,'0')}`,quantityMinimum:o.minReceive,reason:o.decisionEvidence};});
 const positions=rec(s.positions),held=Object.keys(positions).length,breaches=count(timing.protectionBreaches),unavailable=count(timing.unavailableChecks),lastProtected=count(timing.lastCompletedProtectionAt),protectionBoundary=count(timing.experimentalCompletedEvaluationLimitMs),primaryUnavailable=(count(rpc.cooldownUntil)??0)>at;
 const protectionState:OperatingIntelligence['protection']['state']=held===0?'flat':!time(lastProtected)?'unavailable':primaryUnavailable||protectionBoundary===null||at-lastProtected!>protectionBoundary?'degraded':'monitored';
 const limitations=(Array.isArray(s.observationReportingMeaning)?s.observationReportingMeaning:typeof s.observationReportingMeaning==='string'?[s.observationReportingMeaning]:[]).flatMap(v=>bounded(v,512)?[v as string]:[]).slice(0,10);
 const hasAdmission=['reporting','serviceSupervision','resourceControl','evidenceRetention','sourceRecovery','proofPreparation'].some(k=>Object.hasOwn(s,k));
 const report=rec(s.reporting),supervision=rec(s.serviceSupervision),control=rec(s.resourceControl),retention=rec(s.evidenceRetention),recovery=rec(s.sourceRecovery),proof=rec(s.proofPreparation);
 const admission:OperatingAdmission|undefined=hasAdmission?{
  financialProjectionReady:boolean(report.financialProjectionReady),supervisedNewRiskAllowed:boolean(supervision.newRiskAllowed),candidateResourceAdmissionAllowed:boolean(control.candidateAdmissionAllowed),
  evidenceAdmissionAllowed:boolean(retention.candidateAdmissionAllowed),evidencePressureReasonCode:evidencePressureCode(retention.pressureReason),evidenceDiagnosticBytes:count(retention.diagnosticBytes),evidenceDiagnosticLimitBytes:count(retention.diagnosticLimitBytes),evidenceRequiresCriticalRecovery:boolean(retention.requiresCriticalRecovery),evidenceRefusedRecords:count(retention.refusedRecords),
  sourceRecoveryGeneration:count(recovery.generation),sourceRecoveryFailures:count(recovery.failures),sourceRecoveryReasonCode:recoveryReasonCode(recovery.reason),sourceRecoveryRetryAt:futureTime(recovery.retryAt),sourceRecoveryClosingSettled:boolean(recovery.closingSettled),sourceRestartRequired:boolean(recovery.restartRequired),
  proofPreparationState:s.proofPreparation===null?'not-started':['pending','complete','failed'].includes(proof.state)?proof.state:null
 }:undefined;
 return {version:OPERATING_INTELLIGENCE_VERSION,...(admission?{admission}:{}),
  run:{id:runId,startedAt:new Date(start).toISOString(),mode:s.persistent===true||s.service===true||s.operatingMode==='service'?'persistent-paper':s.running===false?'maintenance':'bounded-verification',configurationSha256,strategyVersion},
  candidates:{migrationsReceived:count(f.discovered),verifiedOrigins:count(f.verifiedMigrationOrigins),known:count(w.known),watch:count(first(w.watch,w.watchCandidates)),eligible:count(first(w.eligibleKnown,w.eligible)),deepActive:count(first(w.deepActive,w.deep)),deepMaximum:count(first(w.maximumDeep,w.maximumDeepCandidates)),queued:count(w.queued),promoted:count(w.promoted),repromoted:count(w.repromoted),demoted:count(w.demoted),completeWindows:count(w.completeWindows),auditedWindows:count(f.usableWindows),uniqueEvaluated:count(first(p.uniqueTokens,w.uniqueEvaluatedTokens)),uniqueAudited:count(first(p.uniqueAuditedTokens,w.uniqueAuditedTokens)),predictiveAssessments:count(first(p.assessments,w.predictiveAssessments)),predictivePasses:count(first(p.passed,w.predictivePasses)),predictiveFailures:count(first(p.failed,w.predictiveFailures)),predictiveUnavailable:count(first(p.unavailable,w.predictiveUnavailable)),waitMeanMs:count(rec(w.waitMs).mean),waitMaximumMs:count(rec(w.waitMs).maximum),olderSelected:count(rec(w.ageCohorts).olderSelected)},
  quality:{captureConnected:boolean(native.connected),qualityGaps:count(refusals['native-quality-gaps']),auditUnavailable:count(refusals['independent-audit-unavailable']),auditUnusable:count(refusals['independent-audit-unusable']),decisionDeadlineMisses:count(refusals['predictive-window-deadline-missed']),enrichmentDeadlineFailures:count(w.enrichmentDeadlineFailures),incompleteExclusions:count(w.incompleteDataExclusions),capacityExclusions:count(w.capacityExclusions),structuralExclusions:count(w.structuralExclusions),limitations},
  provider:{rpcRequests:count(rpc.newUnits),rpcResponseBytes:count(rpc.newAccountedResponseBytes),nativeStreamBytes:count(native.socketBytes),broadWatchBytes:count(first(feeds.broadWatchSocketBytes,feeds.pumpApiSocketBytes)),discoveryConnected:boolean(feeds.discoveryConnected),watchConnected:boolean(feeds.pumpApiConnected),httpTimeouts:count(rpc.httpTimeouts),httpErrors:count(rpc.httpErrors),throttles:count(rpc.throttles),rollingStartsPerMinute:count(rec(rpc.dispatchWindow).startsLastMinute),maximumStartsPerMinute:count(rec(rpc.requestLimits).maxStartsPerMinute),minimumSpacingMs:count(rec(rpc.requestLimits).minSpacingMs),primaryCooldownUntil:futureTime(rpc.cooldownUntil),historyCooldownUntil:futureTime(rpc.historyCooldownUntil),controlCooldownUntil:futureTime(rpc.controlCooldownUntil)},
  resources:{sampleAt:time(first(resource.sampleAt,resource.at)),cpuOneCoreFraction:finite(first(resource.cpuOneCoreFraction,resource.cpuFraction)),rssBytes:count(first(resource.rssBytes,u.maximumRss)),availableMemoryBytes:count(resource.availableMemoryBytes),availableDiskBytes:count(resource.availableDiskBytes),eventLoopLagMs:finite(u.eventLoopDelayP95Ms),state:['normal','pressure','recovering'].includes(resource.state)?resource.state:'unavailable'},
  protection:{state:protectionState,targetCadenceMs:count(timing.targetMs),completedEvaluationBoundaryMs:count(timing.experimentalCompletedEvaluationLimitMs),lastCompletedAt:time(timing.lastCompletedProtectionAt),maximumCompletedGapMs:held?finite(timing.maximumCompletedGapMs):null,maximumQuoteAgeAtUseMs:held?finite(timing.maximumQuoteAgeAtUseMs):null,breaches,unavailableChecks:unavailable},
  times:{marketNotificationAt:time(times.lastMarketNotificationAt),freshSupportAt:time(times.lastFreshSupportAt),bankClockAt:time(times.lastBankClockAt),auditAt:time(times.lastAuditAt),predictiveAt:time(times.lastPredictiveAt),reconciliationAt:time(times.financialReconciliationAt)},decisions,
  refusals:Object.entries(refusals).slice(0,30).flatMap(([reason,n])=>bounded(reason,256)&&count(n)!==null?[{reason,count:n as number}]:[]),pendingOrders};
}
function exact(v:unknown,keys:string[]):Record<string,any>{const o=rec(v);if(Object.getPrototypeOf(v)!==Object.prototype||Object.keys(o).sort().join('|')!==[...keys].sort().join('|'))throw Error('OPERATING_INTELLIGENCE_FIELDS');return o;}
export function validateOperatingIntelligence(value:unknown,generatedAt:string):OperatingIntelligence{
 const s=exact(value,['version','run','candidates','quality','provider','resources','protection','times','decisions','refusals','pendingOrders',...(Object.hasOwn(rec(value),'admission')?['admission']:[])]);if(s.version!==OPERATING_INTELLIGENCE_VERSION)throw Error('OPERATING_INTELLIGENCE_VERSION');const generated=Date.parse(generatedAt),inception=Date.parse(ORIGINAL_POE_INCEPTION);
 const text=(v:unknown,max=256)=>{if(!bounded(v,max))throw Error('OPERATING_INTELLIGENCE_TEXT');};
 const n=(v:unknown,whole=true)=>{if(v!==null&&(whole?count(v)===null:finite(v)===null))throw Error('OPERATING_INTELLIGENCE_NUMBER');};
 const b=(v:unknown)=>{if(v!==null&&typeof v!=='boolean')throw Error('OPERATING_INTELLIGENCE_BOOLEAN');};
 const t=(v:unknown,nullable=true,future=false)=>{if(v===null&&nullable)return;const at=typeof v==='string'?Date.parse(v):NaN;if(!Number.isSafeInteger(at)||new Date(at).toISOString()!==v||at<inception||!future&&at>generated)throw Error('OPERATING_INTELLIGENCE_TIME');};
 if(Object.hasOwn(s,'admission')){
  const a=exact(s.admission,'financialProjectionReady supervisedNewRiskAllowed candidateResourceAdmissionAllowed evidenceAdmissionAllowed evidencePressureReasonCode evidenceDiagnosticBytes evidenceDiagnosticLimitBytes evidenceRequiresCriticalRecovery evidenceRefusedRecords sourceRecoveryGeneration sourceRecoveryFailures sourceRecoveryReasonCode sourceRecoveryRetryAt sourceRecoveryClosingSettled sourceRestartRequired proofPreparationState'.split(' '));
  for(const k of ['financialProjectionReady','supervisedNewRiskAllowed','candidateResourceAdmissionAllowed','evidenceAdmissionAllowed','evidenceRequiresCriticalRecovery','sourceRecoveryClosingSettled','sourceRestartRequired'])b(a[k]);
  for(const k of ['evidenceDiagnosticBytes','evidenceDiagnosticLimitBytes','evidenceRefusedRecords','sourceRecoveryGeneration','sourceRecoveryFailures'])n(a[k]);
  if(a.evidencePressureReasonCode!==null&&!(EVIDENCE_PRESSURE_CODES as readonly unknown[]).includes(a.evidencePressureReasonCode))throw Error('OPERATING_EVIDENCE_PRESSURE_CODE');
  if(a.sourceRecoveryReasonCode!==null&&!(RECOVERY_REASON_CODES as readonly unknown[]).includes(a.sourceRecoveryReasonCode))throw Error('OPERATING_RECOVERY_REASON_CODE');
  t(a.sourceRecoveryRetryAt,true,true);
  if(a.proofPreparationState!==null&&!['not-started','pending','complete','failed'].includes(a.proofPreparationState))throw Error('OPERATING_PROOF_PREPARATION_STATE');
 }
 const run=exact(s.run,['id','startedAt','mode','configurationSha256','strategyVersion']);text(run.id,128);text(run.strategyVersion,128);t(run.startedAt,false);if(!['persistent-paper','bounded-verification','maintenance'].includes(run.mode)||typeof run.configurationSha256!=='string'||!/^[a-f0-9]{64}$/.test(run.configurationSha256))throw Error('OPERATING_INTELLIGENCE_RUN');
 const c=exact(s.candidates,'migrationsReceived verifiedOrigins known watch eligible deepActive deepMaximum queued promoted repromoted demoted completeWindows auditedWindows uniqueEvaluated uniqueAudited predictiveAssessments predictivePasses predictiveFailures predictiveUnavailable waitMeanMs waitMaximumMs olderSelected'.split(' '));Object.values(c).forEach(v=>n(v));if(c.deepActive!==null&&c.deepMaximum!==null&&c.deepActive>c.deepMaximum)throw Error('OPERATING_DEEP_CAPACITY');
 const q=exact(s.quality,'captureConnected qualityGaps auditUnavailable auditUnusable decisionDeadlineMisses enrichmentDeadlineFailures incompleteExclusions capacityExclusions structuralExclusions limitations'.split(' '));b(q.captureConnected);for(const k of Object.keys(q).filter(k=>k!=='captureConnected'&&k!=='limitations'))n(q[k]);if(!Array.isArray(q.limitations)||q.limitations.length>10)throw Error('OPERATING_LIMITATIONS_BOUND');q.limitations.forEach((v:unknown)=>text(v,512));
 const p=exact(s.provider,'rpcRequests rpcResponseBytes nativeStreamBytes broadWatchBytes discoveryConnected watchConnected httpTimeouts httpErrors throttles rollingStartsPerMinute maximumStartsPerMinute minimumSpacingMs primaryCooldownUntil historyCooldownUntil controlCooldownUntil'.split(' '));for(const k of Object.keys(p)){if(k.endsWith('Until')){if(p[k]!==null){const z=typeof p[k]==='string'?Date.parse(p[k]):NaN;if(!Number.isSafeInteger(z)||new Date(z).toISOString()!==p[k])throw Error('OPERATING_COOLDOWN_TIME');}}else if(k.endsWith('Connected'))b(p[k]);else n(p[k]);}
 const r=exact(s.resources,'sampleAt cpuOneCoreFraction rssBytes availableMemoryBytes availableDiskBytes eventLoopLagMs state'.split(' '));t(r.sampleAt);for(const k of ['cpuOneCoreFraction','eventLoopLagMs'])n(r[k],false);for(const k of ['rssBytes','availableMemoryBytes','availableDiskBytes'])n(r[k]);if(!['normal','pressure','recovering','unavailable'].includes(r.state))throw Error('OPERATING_RESOURCE_STATE');
 const h=exact(s.protection,'state targetCadenceMs completedEvaluationBoundaryMs lastCompletedAt maximumCompletedGapMs maximumQuoteAgeAtUseMs breaches unavailableChecks'.split(' '));if(!['flat','monitored','degraded','unavailable'].includes(h.state))throw Error('OPERATING_PROTECTION_STATE');t(h.lastCompletedAt);for(const k of ['targetCadenceMs','completedEvaluationBoundaryMs','breaches','unavailableChecks'])n(h[k]);for(const k of ['maximumCompletedGapMs','maximumQuoteAgeAtUseMs'])n(h[k],false);
 const times=exact(s.times,'marketNotificationAt freshSupportAt bankClockAt auditAt predictiveAt reconciliationAt'.split(' '));Object.values(times).forEach(v=>t(v));
 if(!Array.isArray(s.decisions)||s.decisions.length>50||!Array.isArray(s.refusals)||s.refusals.length>30||!Array.isArray(s.pendingOrders)||s.pendingOrders.length>3)throw Error('OPERATING_LIST_BOUND');
 for(const raw of s.decisions){const d=exact(raw,['id','mint','at','stage','reason']);text(d.id,128);text(d.mint,96);t(d.at,false);text(d.stage,80);text(d.reason,512);}
 for(const raw of s.refusals){const d=exact(raw,['reason','count']);text(d.reason,256);if(count(d.count)===null)throw Error('OPERATING_REFUSAL_COUNT');}
 for(const raw of s.pendingOrders){const o=exact(raw,'id mint side decidedAt executeAt expiresAt reservedSol quantityMinimum reason'.split(' '));text(o.id,128);text(o.mint,96);text(o.reason,512);if(!['buy','sell'].includes(o.side)||typeof o.reservedSol!=='string'||!/^(0|[1-9]\d{0,20})(\.\d{1,9})?$/.test(o.reservedSol)||typeof o.quantityMinimum!=='string'||!/^(0|[1-9]\d{0,38})$/.test(o.quantityMinimum))throw Error('OPERATING_ORDER_AMOUNT');t(o.decidedAt,false);t(o.executeAt,false,true);t(o.expiresAt,false,true);if(Date.parse(o.executeAt)<Date.parse(o.decidedAt)+500||Date.parse(o.expiresAt)<=Date.parse(o.executeAt)||Date.parse(o.expiresAt)>Date.parse(o.decidedAt)+30000)throw Error('OPERATING_ORDER_TIME');}
 if(Buffer.byteLength(JSON.stringify(s))>32*1024)throw Error('OPERATING_INTELLIGENCE_BYTES');return s as OperatingIntelligence;
}
