/** Detached diagnostic reads only. This module has no financial writer,
 * provider, scheduler or watch owner, and never changes durable membership. */
import type {MarketRegistry} from './market-registry.js';
import type {WatchCheckpoint} from './pilot-watch.js';
import {observationAgePolicyByVersion,type ObservationAgePolicyVersion} from './observation-age.js';
import {readWatchRegistrySnapshot,readWatchRegistryBacklog,type WatchReportingStrategy} from './watch-registry-reporting.js';

export const MARKET_REGISTRY_REPORTING_VERSION='detached-market-registry-reporting-v1' as const;
/** Diagnostic refresh/transport bounds only; never financial or token limits. */
export const MARKET_REGISTRY_REPORTING_POLICY=Object.freeze({refreshMs:1000,staleMs:30000,requestTimeoutMs:30000,maximumResponseBytes:4*1024*1024});
export type MarketRegistryReportingScope={registryId:string;sourceInstanceId:string;startedAt:number;observationAgePolicy:ObservationAgePolicyVersion;maximumDeep:number;strategy:WatchReportingStrategy;requireOrigin:boolean;pumpswapOnly:boolean;enforceTokenAge24h:boolean;enforceMigrationAge:boolean};
export type MarketRegistryReportingRequest={kind:'reporting';id:number;requestedAt:number;scope:MarketRegistryReportingScope};
export type MarketRegistryReportingHealth={mode:'DETACHED_WORKER';sampledAt:number;state:'FRESH'|'STALE'|'UNAVAILABLE';sourceInstanceId:string;workerGeneration:number;sampleWorkerGeneration:number|null;requestedAt:number|null;observedAt:number|null;completedAt:number|null;durationMs:number|null;ageMs:number|null;pending:boolean;failures:number;reasonCode:string|null};
const uint=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const text=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=256&&/^[A-Za-z0-9:_-]+$/.test(value);
export function validMarketRegistryReportingRequest(value:unknown):value is MarketRegistryReportingRequest {
 const r=value as MarketRegistryReportingRequest,s=r?.scope;
 if(r?.kind!=='reporting'||!uint(r.id)||!uint(r.requestedAt)||!s||!text(s.registryId)||!text(s.sourceInstanceId)||!uint(s.startedAt)||s.startedAt>r.requestedAt||!uint(s.maximumDeep)||s.maximumDeep<1||s.maximumDeep>20||!['baseline','adaptive-momentum-v2','liquidity-resilient-momentum-v3','liquidity-resilient-momentum-v3.1'].includes(s.strategy)||!['requireOrigin','pumpswapOnly','enforceTokenAge24h','enforceMigrationAge'].every(key=>typeof s[key as keyof typeof s]==='boolean')||s.enforceMigrationAge&&(!s.enforceTokenAge24h||!s.pumpswapOnly))return false;
 try{observationAgePolicyByVersion(s.observationAgePolicy);return true;}catch{return false;}
}
export const marketRegistryReportingScopeKey=(scope:MarketRegistryReportingScope)=>JSON.stringify(scope);
export function readMarketRegistryReporting(registry:MarketRegistry,scope:MarketRegistryReportingScope,at:number){
 return registry.readTransaction(()=>{
  if(!uint(at)||at<scope.startedAt||registry.getMetadata('pilot-watch-identity')!==scope.registryId)throw Error('REPORTING_SCOPE_UNAVAILABLE');
  const state=registry.getMetadata<WatchCheckpoint>('pilot-watch-state');if(!state?.counters)throw Error('REPORTING_WATCH_STATE_UNAVAILABLE');
  const policy={observationAgePolicy:observationAgePolicyByVersion(scope.observationAgePolicy),maximumDeep:scope.maximumDeep,pumpswapOnly:scope.pumpswapOnly,enforceTokenAge24h:scope.enforceTokenAge24h};
  const watch=readWatchRegistrySnapshot(registry,policy,{counters:state.counters,entryAgePromotionCount:state.entryAgePromotionCount??0},at,scope.strategy),backlog=readWatchRegistryBacklog(registry,policy,at,{requireOrigin:scope.requireOrigin});
  return {version:MARKET_REGISTRY_REPORTING_VERSION,sourceInstanceId:scope.sourceInstanceId,observedAt:at,watch,backlog,verification:registry.verificationStats(at),coverage:registry.coverageSnapshot(at),cohort:registry.cohortCounts(scope.startedAt,at),migrationAgeScope:scope.enforceMigrationAge?registry.migrationAgeSummary(at):undefined,tokenAgeScope:!scope.enforceMigrationAge&&scope.enforceTokenAge24h?registry.tokenAgeSummary(at):undefined};
 });
}
export type MarketRegistryReportingSnapshot=ReturnType<typeof readMarketRegistryReporting>;
export type MarketRegistryReportingResult={kind:'reporting-result';id:number;requestedAt:number;observedAt:number;completedAt:number;durationMs:number;snapshot:MarketRegistryReportingSnapshot|null;reasonCode:string|null};
export type MarketRegistryReportingView={health:MarketRegistryReportingHealth;snapshot:MarketRegistryReportingSnapshot|null};

/** Explicit unknown populations before the first sample. Current in-memory
 * watch counters are permitted; an empty page never means an empty registry. */
export function unavailableRegistryWatch(policy:ReturnType<typeof observationAgePolicyByVersion>,maximumDeep:number,state:WatchCheckpoint){
 const unknown=Object.fromEntries(['known','observationEligibleKnown','observationCapacityAwaiting','observationCapacityProbeReady','observationQueued','watch','capacityAwaiting','capacityProbeReady','unverified','eligibleKnown','deepActive','queued'].map(key=>[key,null])) as Record<'known'|'observationEligibleKnown'|'observationCapacityAwaiting'|'observationCapacityProbeReady'|'observationQueued'|'watch'|'capacityAwaiting'|'capacityProbeReady'|'unverified'|'eligibleKnown'|'deepActive'|'queued',null>;
 return {rows:[] as import('./pilot-watch.js').WatchRow[],summary:{observationAgePolicy:policy,...state.counters,...unknown,maximumIdentities:null,maximumOlderResearchIdentities:null,minimumPrimaryIdentityCapacity:null,ageCohorts:{preEntry:null,entryEligible:null,olderSelected:null},maximumDeep,waitMs:{mean:null,maximum:null},promotionWaitMs:{mean:state.entryAgePromotionCount?state.counters.promotionWaitTotalMs/state.entryAgePromotionCount:null,maximum:state.counters.promotionWaitMaximumMs,entryAgePromotions:state.entryAgePromotionCount??null},coverage:{denominator:'detached registry summary unavailable',eligibleKnown:null,atLeastOneValidWindow:null,percent:null,wholeMarketPercent:null},states:Object.fromEntries(['DISCOVERED','VERIFYING','WATCH','DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD','DEFERRED','EXPIRED','PERMANENTLY_UNSUPPORTED'].map(key=>[key,null])),projection:{returned:0,total:null,complete:false,purpose:'detached registry summary unavailable; no population inferred'},storage:'persistent-market-registry-v1'}};
}
export function unavailableRegistryCoverage(at:number){
 return {version:'poe-market-coverage-v1' as const,generatedAt:at,persistence:{state:'sqlite-wal' as const,createdAt:null,updatedAt:null},lifetime:{uniqueTokensDiscovered:null,lightweightScreened:null,lightweightWithActivity:null,lightweightUnavailable:null,deepAdmitted:null,verifiedAudited:null},currentHour:{startedAt:Math.floor(at/3600000)*3600000,uniqueTokensDiscovered:null},active:{trackedIdentities:null,awaitingOrigin:null,awaitingLightweight:null,awaitingVerification:null,awaitingDeep:null,deepObserving:null},resource:{durableVerificationBacklog:null,oldestVerificationAt:null,maximumVerificationWaitMs:null,storageFailures:null,maximumWriteMs:null,meanWriteMs:null},feeds:[],marketDenominator:null,wholeMarketCoveragePercent:null,limitations:['MARKET_DENOMINATOR_UNKNOWN','REGISTRY_SUMMARY_UNAVAILABLE']};
}
export const unavailableRegistryBacklog=()=>({population:{retained:null,verifiedAwaitingPrerequisites:null,eligibleNow:null,serviceableNow:null,capacityWaiting:null,activeDeep:null},waits:{eligibleQueue:{count:null,sum:null,mean:null,max:null,p50:null,p95:null},capacityQueue:{count:null,sum:null,mean:null,max:null,p50:null,p95:null}}});
