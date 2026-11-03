/** Read-only usable-certificate handoff telemetry. A certificate is not a
 * qualification; time blocked across certificates can overlap. */
import {SOURCE_WAITING_OPERATIONS} from './market-runtime-reporting.js';
export const FINANCIAL_HANDOFF_VERSION='native-financial-handoff-v1' as const;
const LEGACY_FINANCIAL_HANDOFF_REASONS=['await-financial-dispatch','financial-or-source-admission','proof-retention','required-service-or-protection-runway','await-earlier-candidate'] as const;
const SPECIFIC_FINANCIAL_HANDOFF_REASONS=['provider-capacity','holding-protection','pending-orders','source-unavailable','reporting-health','financial-permission','entry-preparation'] as const;
export const FINANCIAL_HANDOFF_REASONS=[...LEGACY_FINANCIAL_HANDOFF_REASONS,...SPECIFIC_FINANCIAL_HANDOFF_REASONS] as const;
export const FINANCIAL_HANDOFF_PREREQUISITES=['FINANCIAL_PUBLICATION_UNAVAILABLE','MARKET_INTAKE_UNAVAILABLE','MANAGEMENT_ONLY','OWNER_PAUSE','OWNER_STOP','STOP_REQUEST','ADMISSION_SUSPENSION','RUNTIME_STOPPED','SOURCE_CLOSED','NATIVE_SOURCE_FATAL','PROVIDER_RESTRICTION','FINANCIAL_PROJECTION_UNAVAILABLE','HELD_PROTECTION_OVERDUE','RESOURCE_PRESSURE','EVIDENCE_UNAVAILABLE','CANDIDATE_EVIDENCE_UNAVAILABLE','BACKUP_UNAVAILABLE','SERVICE_SUPERVISION_UNAVAILABLE','BOUNDED_PROCESSING_RESERVE','DISK_RESERVE','ENTRY_SHORT_WINDOW_CAPACITY','ENTRY_MINUTE_CAPACITY','ENTRY_PROVIDER_BUDGET','POSITION_CAPACITY','PENDING_ORDERS','MANAGEMENT_TIME_RESERVE','SOURCE_WORK_ADMISSION','PROVIDER_PHYSICAL_CAPACITY','PROVIDER_DISPATCH_UNAVAILABLE','PROOF_PENDING','ENTRY_PREPARATION_PENDING','ORIGINAL_CERTIFICATE_DEADLINE','REQUIRED_NATIVE_SERVICE_DEADLINE','HOLDING_PROTECTION_RUNWAY','AWAIT_EARLIER_CANDIDATE'] as const;
type Reason=typeof FINANCIAL_HANDOFF_REASONS[number];
type Count=number|null;
export const REQUEST_TIMING_VERSION='native-request-timing-v1' as const;
export const REQUEST_ADMISSION_REASONS=['stop-or-service-end','source-admission','protection-or-pending','entry-token','source-setup-budget','current-audit-certificate-required','source-admission-closed','required-native-service-deadline','original-certificate-deadline','caller-admission-closed','OTHER_UNEXPORTED_REASON'] as const;
export const REQUEST_TIMING_METHODS=['getBlock','getMultipleAccounts','getMinimumBalanceForRentExemption','getSignaturesForAddress','getTransaction','getSlot','getBlockTime','getGenesisHash','upgrade','accountSubscribe','accountUnsubscribe','logsSubscribe','logsUnsubscribe','subscribeMigration','subscribeNewToken','ping','pong','close'] as const;
export const REQUEST_TIMING_STAGES=['before-pacing','after-pacing','pacing-plan','before-reservation','before-physical-invocation'] as const;
export type RequestTimingReporting={version:typeof REQUEST_TIMING_VERSION;runId:string;startedAt:string;generatedAt:string;gateRefusals:number;componentRefusals:number;physicalStarts:number;physicalSettlements:number;completeResponses:number;unmatchedSettlements:number;refusals:Record<string,unknown>[];methods:{method:string;transport:'http'|'ws-upgrade'|'ws';starts:number;settled:number;responses:number;queue:{count:number;sumMs:number;maxMs:number};pacing:{count:number;sumMs:number;maxMs:number};physical:{count:number;sumMs:number;maxMs:number}}[]};
type HandoffReasons<T>=Record<typeof LEGACY_FINANCIAL_HANDOFF_REASONS[number],T>&Partial<Record<typeof SPECIFIC_FINANCIAL_HANDOFF_REASONS[number],T>>;
type HandoffOperation={observedAt?:string|null;blockingPrerequisite?:typeof FINANCIAL_HANDOFF_PREREQUISITES[number]|null;operation?:typeof SOURCE_WAITING_OPERATIONS[number]|null;requiredMs?:number|null;availableMs?:number|null};
const HANDOFF_OPERATION_KEYS=['observedAt','blockingPrerequisite','operation','requiredMs','availableMs'] as const;
export type FinancialHandoffReporting={version:typeof FINANCIAL_HANDOFF_VERSION;scope:'CURRENT_SOURCE_PROCESS';runId:string;startedAt:string;generatedAt:string;seen:Count;dispatched:Count;financialEvaluations:Count;economicDecisions?:Count;expiredBeforeDispatch:Count;invalidatedBeforeDispatch:Count;blockedMsByReason:HandoffReasons<number|null>;deferralTransitionsByReason:HandoffReasons<Count>;dispatchWait:{count:Count;mean:number|null;max:number|null;p50UpperMs:number|null;p95UpperMs:number|null;histogramResolutionMs:100};active:({mint:string;windowEndAt:string;deadlineAt:string;admittedAt:string;firstSeenAt:string;state:'waiting'|'dispatched';reason:Reason}&HandoffOperation)[];requestTiming?:RequestTimingReporting};
const INCEPTION=Date.parse('2026-10-26T22:07:36.212Z'),record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER?v:null;
const count=(v:unknown):Count=>Number.isSafeInteger(v)&&number(v)!==null?Number(v):null;
function need(v:unknown):asserts v {if(!v)throw Error('FINANCIAL_HANDOFF_REPORTING_INVALID');}
function exact(v:unknown,keys:string){const r=record(v);need(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(r).sort().join(' ')===keys.split(' ').sort().join(' '));return r;}
const iso=(value:unknown,generated:number,future=false)=>{const at=count(value);need(at!==null&&at>=INCEPTION&&(future||at<=generated)&&at<=8640000000000000);return new Date(at).toISOString();};
function projectHandoffOperation(row:Record<string,any>,generated:number):HandoffOperation{
 if(!HANDOFF_OPERATION_KEYS.some(key=>Object.hasOwn(row,key)))return {};
 const at=count(row.observedAt),observedAt=at!==null&&at>=INCEPTION&&at>=row.firstSeenAt&&at<=generated&&at<=8640000000000000?new Date(at).toISOString():null;
 return {observedAt,blockingPrerequisite:safeEnum(row.blockingPrerequisite,FINANCIAL_HANDOFF_PREREQUISITES) as HandoffOperation['blockingPrerequisite'],operation:safeEnum(row.operation,SOURCE_WAITING_OPERATIONS) as HandoffOperation['operation'],requiredMs:number(row.requiredMs),availableMs:number(row.availableMs)};
}
export function projectFinancialHandoffReporting(value:unknown,generated:number):FinancialHandoffReporting|undefined {
 const r=record(value);if(r.version!==FINANCIAL_HANDOFF_VERSION)return undefined;const requestTiming=projectRequestTimingReporting(r.requestTiming,generated,r.runId);
 try{const w=record(r.dispatchWait),c=count(w.count);need(Array.isArray(r.active)&&r.active.length<=16);
  const base=validateFinancialHandoffReporting({version:r.version,scope:r.scope,runId:r.runId,startedAt:iso(r.startedAt,generated),generatedAt:iso(r.generatedAt,generated),...Object.fromEntries(['seen','dispatched','financialEvaluations','economicDecisions','expiredBeforeDispatch','invalidatedBeforeDispatch'].map(key=>[key,count(r[key])])),blockedMsByReason:Object.fromEntries(FINANCIAL_HANDOFF_REASONS.map(key=>[key,number(record(r.blockedMsByReason)[key])])),deferralTransitionsByReason:Object.fromEntries(FINANCIAL_HANDOFF_REASONS.map(key=>[key,count(record(r.deferralTransitionsByReason)[key])])),dispatchWait:{count:c,mean:c===0?null:number(w.mean),max:c===0?null:number(w.max),p50UpperMs:c===0?null:number(w.p50UpperMs),p95UpperMs:c===0?null:number(w.p95UpperMs),histogramResolutionMs:w.histogramResolutionMs},active:r.active.map((value:unknown)=>{const row=record(value);return {mint:row.mint,windowEndAt:iso(row.windowEndAt,generated),deadlineAt:iso(row.deadlineAt,generated,true),admittedAt:iso(row.admittedAt,generated),firstSeenAt:iso(row.firstSeenAt,generated),state:row.state,reason:row.reason,...projectHandoffOperation(row,r.generatedAt)};})},generated);return requestTiming&&requestTiming.startedAt===base.startedAt&&requestTiming.generatedAt===base.generatedAt?validateFinancialHandoffReporting({...base,requestTiming},generated):base;
 }catch{return undefined;}
}
export function validateFinancialHandoffReporting(value:unknown,generated:number):FinancialHandoffReporting {
 const r=exact(value,'version scope runId startedAt generatedAt seen dispatched financialEvaluations expiredBeforeDispatch invalidatedBeforeDispatch blockedMsByReason deferralTransitionsByReason dispatchWait active'+['economicDecisions','requestTiming'].filter(key=>Object.hasOwn(record(value),key)).map(key=>' '+key).join(''));need(r.version===FINANCIAL_HANDOFF_VERSION&&r.scope==='CURRENT_SOURCE_PROCESS'&&typeof r.runId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(r.runId));
 const time=(v:unknown,future=false)=>{const at=typeof v==='string'?Date.parse(v):NaN;need(Number.isSafeInteger(at)&&at>=INCEPTION&&(future||at<=generated)&&new Date(at).toISOString()===v);return at;};const start=time(r.startedAt),at=time(r.generatedAt);need(start<=at);
 for(const key of ['seen','dispatched','financialEvaluations','expiredBeforeDispatch','invalidatedBeforeDispatch'])need(r[key]===null||count(r[key])!==null);
 if(Object.hasOwn(r,'economicDecisions'))need(r.economicDecisions===null||count(r.economicDecisions)!==null);
 need(r.seen===null||r.dispatched===null||r.dispatched<=r.seen);
 for(const field of ['blockedMsByReason','deferralTransitionsByReason']){const keys=[...LEGACY_FINANCIAL_HANDOFF_REASONS,...SPECIFIC_FINANCIAL_HANDOFF_REASONS.filter(key=>Object.hasOwn(record(r[field]),key))],section=exact(r[field],keys.join(' '));for(const key of keys)need(section[key]===null||(field==='blockedMsByReason'?number(section[key]):count(section[key]))!==null);}
 const w=exact(r.dispatchWait,'count mean max p50UpperMs p95UpperMs histogramResolutionMs');need((w.count===null||count(w.count)!==null)&&w.histogramResolutionMs===100);for(const key of ['mean','max','p50UpperMs','p95UpperMs'])need(w[key]===null||number(w[key])!==null);if(w.count===0)need(w.mean===null&&w.max===null&&w.p50UpperMs===null&&w.p95UpperMs===null);need(w.p50UpperMs===null||w.p95UpperMs===null||w.p50UpperMs<=w.p95UpperMs);
 need(Array.isArray(r.active)&&r.active.length<=16);const seen=new Set<string>();for(const value of r.active){const row=exact(value,'mint windowEndAt deadlineAt admittedAt firstSeenAt state reason'+HANDOFF_OPERATION_KEYS.filter(key=>Object.hasOwn(record(value),key)).map(key=>' '+key).join(''));need(typeof row.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)&&['waiting','dispatched'].includes(row.state)&&(FINANCIAL_HANDOFF_REASONS as readonly unknown[]).includes(row.reason));const end=time(row.windowEndAt),admitted=time(row.admittedAt),first=time(row.firstSeenAt),deadline=time(row.deadlineAt,true);need(end<=admitted&&admitted<=first&&first<=at&&admitted<=deadline);const key=row.mint+':'+row.windowEndAt;need(!seen.has(key));seen.add(key);if(Object.hasOwn(row,'observedAt')&&row.observedAt!==null)need(time(row.observedAt)>=first&&time(row.observedAt)<=at);for(const key of ['requiredMs','availableMs'])if(Object.hasOwn(row,key))need(row[key]===null||number(row[key])!==null);if(Object.hasOwn(row,'blockingPrerequisite'))need(row.blockingPrerequisite===null||safeEnum(row.blockingPrerequisite,FINANCIAL_HANDOFF_PREREQUISITES)!==null);if(Object.hasOwn(row,'operation'))need(row.operation===null||safeEnum(row.operation,SOURCE_WAITING_OPERATIONS)!==null);}
 if(Object.hasOwn(r,'requestTiming')){const timing=validateRequestTimingReporting(r.requestTiming,generated,r.runId);need(timing.startedAt===r.startedAt&&timing.generatedAt===r.generatedAt);}
 need(Buffer.byteLength(JSON.stringify(r))<=(Object.hasOwn(r,'requestTiming')?32768:12288));return r as FinancialHandoffReporting;
}

const requestGateTimes=['bindingDeadlineAt','certificateDeadlineAt','nativeServiceDeadlineAt','protectionLatestStartAt','callerLatestStartAt'] as const;
const requestGateKeys='origin at requestId requestedAt mint owner method reason '+requestGateTimes.join(' ')+' requestedOperationMs remainingCertificateMs transportStarted physicalSettlementClaimed';
const requestComponentKeys='origin at requestId enqueuedAt method transport code stage latestStartAt remainingStartMs requestedOperationMs physicalTimeoutMs queueElapsedMs pacingWaitMs plannedPacingWaitMs reservationId mint owner reason '+requestGateTimes.join(' ')+' remainingCertificateMs transportStarted physicalSettlementClaimed';
const signed=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER?v:null;
const nullableTime=(v:unknown,generated:number,future=false)=>v===null||v===undefined?null:iso(v,generated,future);
// The persistent flat service has no holding-protection cutoff. Its scheduler
// uses a numeric unbounded limit beyond the Date range; that is not a market
// timestamp. Map only this optional diagnostic to null, retaining every real
// caller/certificate deadline and the original raw scheduling evidence.
const gateTime=(key:typeof requestGateTimes[number],v:unknown,generated:number)=>key==='protectionLatestStartAt'&&Number.isSafeInteger(v)&&Number(v)>8640000000000000?null:nullableTime(v,generated,true);
const safeEnum=(v:unknown,choices:readonly string[])=>typeof v==='string'&&choices.includes(v)?v:null;

/** Projection strips payloads and arbitrary exception strings. Invalid optional
 * timing diagnostics never hide the independent usable-certificate counters. */
export function projectRequestTimingReporting(value:unknown,generated:number,runId:string):RequestTimingReporting|undefined{
 const r=record(value);if(r.version!==REQUEST_TIMING_VERSION)return undefined;
 try{
  need(Array.isArray(r.refusals)&&r.refusals.length<=8&&Array.isArray(r.methods)&&r.methods.length<=REQUEST_TIMING_METHODS.length*3);
  const out={version:r.version,runId:r.runId,startedAt:iso(r.startedAt,generated),generatedAt:iso(r.generatedAt,generated),...Object.fromEntries(['gateRefusals','componentRefusals','physicalStarts','physicalSettlements','completeResponses','unmatchedSettlements'].map(k=>[k,r[k]])),refusals:r.refusals.map((value:unknown)=>{
   const row=record(value),common={origin:row.origin,at:iso(row.at,generated),requestId:row.requestId,method:safeEnum(row.method,REQUEST_TIMING_METHODS),transportStarted:row.transportStarted,physicalSettlementClaimed:row.physicalSettlementClaimed};
   if(row.origin==='gate')return {...common,requestedAt:nullableTime(row.requestedAt,generated),mint:typeof row.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)?row.mint:null,owner:safeEnum(row.owner,['idle','candidate','source','protection','pending']),reason:safeEnum(row.reason,REQUEST_ADMISSION_REASONS)??'OTHER_UNEXPORTED_REASON',...Object.fromEntries(requestGateTimes.map(k=>[k,gateTime(k,row[k],generated)])),requestedOperationMs:number(row.requestedOperationMs),remainingCertificateMs:signed(row.remainingCertificateMs)};
   need(row.origin==='component');return {...common,enqueuedAt:nullableTime(row.enqueuedAt,generated),transport:safeEnum(row.transport,['http','ws-upgrade','ws']),code:safeEnum(row.code,['COMPONENT_ADMISSION_CLOSED','COMPONENT_DISPATCH_EXPIRED']),stage:safeEnum(row.stage,REQUEST_TIMING_STAGES),latestStartAt:nullableTime(row.latestStartAt,generated,true),remainingStartMs:signed(row.remainingStartMs),requestedOperationMs:number(row.requestedOperationMs),physicalTimeoutMs:number(row.physicalTimeoutMs),queueElapsedMs:number(row.queueElapsedMs),pacingWaitMs:number(row.pacingWaitMs),plannedPacingWaitMs:number(row.plannedPacingWaitMs),reservationId:count(row.reservationId),mint:typeof row.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)?row.mint:null,owner:safeEnum(row.owner,['idle','candidate','source','protection','pending']),reason:safeEnum(row.reason,REQUEST_ADMISSION_REASONS),...Object.fromEntries(requestGateTimes.map(k=>[k,gateTime(k,row[k],generated)])),remainingCertificateMs:signed(row.remainingCertificateMs)};
  }),methods:r.methods.map((value:unknown)=>{const m=record(value);return {method:m.method,transport:m.transport,starts:m.starts,settled:m.settled,responses:m.responses,...Object.fromEntries(['queue','pacing','physical'].map(key=>{const s=record(m[key]);return [key,{count:s.count,sumMs:s.sumMs,maxMs:s.maxMs}];}))};})};
  return validateRequestTimingReporting(out,generated,runId);
 }catch{return undefined;}
}

export function validateRequestTimingReporting(value:unknown,generated:number,runId:string):RequestTimingReporting{
 const r=exact(value,'version runId startedAt generatedAt gateRefusals componentRefusals physicalStarts physicalSettlements completeResponses unmatchedSettlements refusals methods');need(r.version===REQUEST_TIMING_VERSION&&r.runId===runId);
 const time=(v:unknown,future=false)=>{const n=typeof v==='string'?Date.parse(v):NaN;need(Number.isSafeInteger(n)&&n>=INCEPTION&&(future||n<=generated)&&new Date(n).toISOString()===v);return n;};
 const start=time(r.startedAt),at=time(r.generatedAt);need(start<=at);
 for(const k of ['gateRefusals','componentRefusals','physicalStarts','physicalSettlements','completeResponses','unmatchedSettlements'])need(count(r[k])!==null);
 need(r.completeResponses<=r.physicalSettlements&&r.unmatchedSettlements<=r.physicalSettlements);
 need(Array.isArray(r.refusals)&&r.refusals.length<=8);let previous=start;
 for(const value of r.refusals){const v=record(value);const row=exact(value,v.origin==='gate'?requestGateKeys:requestComponentKeys),eventAt=time(row.at);need(eventAt>=previous&&eventAt<=at&&row.transportStarted===false&&row.physicalSettlementClaimed===false);previous=eventAt;
  need(row.requestId===null||typeof row.requestId==='string'&&row.requestId.startsWith(runId+':request:')&&/^\d+$/.test(row.requestId.slice((runId+':request:').length)));
  need(row.method===null||safeEnum(row.method,REQUEST_TIMING_METHODS)!==null);
  if(row.origin==='gate'){
   need(row.requestedAt===null||time(row.requestedAt)<=eventAt);need(row.mint===null||typeof row.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint));need(row.owner===null||safeEnum(row.owner,['idle','candidate','source','protection','pending'])!==null);need(safeEnum(row.reason,REQUEST_ADMISSION_REASONS)!==null);
   for(const k of requestGateTimes)if(row[k]!==null)time(row[k],true);need(row.remainingCertificateMs===null||signed(row.remainingCertificateMs)!==null);
  }else{
   need(row.origin==='component'&&(row.enqueuedAt===null||time(row.enqueuedAt)<=eventAt));need(row.transport===null||safeEnum(row.transport,['http','ws-upgrade','ws'])!==null);need(row.code===null||safeEnum(row.code,['COMPONENT_ADMISSION_CLOSED','COMPONENT_DISPATCH_EXPIRED'])!==null);need(row.stage===null||safeEnum(row.stage,REQUEST_TIMING_STAGES)!==null);if(row.latestStartAt!==null)time(row.latestStartAt,true);need(row.remainingStartMs===null||signed(row.remainingStartMs)!==null);
   for(const k of ['physicalTimeoutMs','queueElapsedMs','pacingWaitMs','plannedPacingWaitMs'])need(row[k]===null||number(row[k])!==null);need(row.reservationId===null||count(row.reservationId)!==null);
   need(row.mint===null||typeof row.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint));need(row.owner===null||safeEnum(row.owner,['idle','candidate','source','protection','pending'])!==null);need(row.reason===null||safeEnum(row.reason,REQUEST_ADMISSION_REASONS)!==null);for(const k of requestGateTimes)if(row[k]!==null)time(row[k],true);need(row.remainingCertificateMs===null||signed(row.remainingCertificateMs)!==null);
  }
  need(row.requestedOperationMs===null||number(row.requestedOperationMs)!==null);
  if(row.certificateDeadlineAt!==null&&row.remainingCertificateMs!==null)need(time(row.certificateDeadlineAt,true)-eventAt===row.remainingCertificateMs);
 }
 need(Array.isArray(r.methods)&&r.methods.length<=REQUEST_TIMING_METHODS.length*3);const seen=new Set<string>();
 for(const value of r.methods){const m=exact(value,'method transport starts settled responses queue pacing physical');need(safeEnum(m.method,REQUEST_TIMING_METHODS)!==null&&safeEnum(m.transport,['http','ws-upgrade','ws'])!==null);const key=m.transport+':'+m.method;need(!seen.has(key));seen.add(key);for(const k of ['starts','settled','responses'])need(count(m[k])!==null);need(m.responses<=m.settled);
  for(const k of ['queue','pacing','physical']){const d=exact(m[k],'count sumMs maxMs');need(count(d.count)!==null&&number(d.sumMs)!==null&&number(d.maxMs)!==null&&d.maxMs<=d.sumMs&&(d.count!==0||d.sumMs===0&&d.maxMs===0)&&d.count<=(k==='physical'?m.settled:m.starts));}
 }
 for(const [methodKey,totalKey]of [['starts','physicalStarts'],['settled','physicalSettlements'],['responses','completeResponses']]as const)need(r.methods.reduce((sum:number,m:Record<string,number>)=>sum+m[methodKey]!,0)<=r[totalKey]);
 need(r.refusals.filter((v:Record<string,unknown>)=>v.origin==='gate').length<=r.gateRefusals&&r.refusals.filter((v:Record<string,unknown>)=>v.origin==='component').length<=r.componentRefusals);
 need(Buffer.byteLength(JSON.stringify(r))<=16384);return r as RequestTimingReporting;
}
