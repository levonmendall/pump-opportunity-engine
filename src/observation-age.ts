/** Observation allocation policy only. Frozen entry, execution and risk rules remain unchanged. */
import {PROVISIONAL_RULE} from './strategy.js';
export const OBSERVATION_AGE_POLICY=Object.freeze({version:'observation-age-v1',minimumObservationAgeMs:0,recentMaximumAgeMs:PROVISIONAL_RULE.maximumAgeMs,selectedOlderMaximumAgeMs:6*60*60*1000,olderActivityMaximumAgeMs:60000,primaryWatchCapacity:150,olderWatchCapacity:24,totalWatchCapacity:174,maximumOlderDeep:1});
/** Optional activity-selected observation study. This biased cohort supplies no
 * entry permission, market census, executable quote or evidence of economic edge. */
export const OBSERVATION_AGE_STUDY_24H_POLICY=Object.freeze({...OBSERVATION_AGE_POLICY,version:'observation-age-selected-24h-study-v1',selectedOlderMaximumAgeMs:24*60*60*1000});
/** Durable awareness has no token-count or token-age eviction boundary. Dormant
 * identities stay indexed on disk; current activity, evidence and execution
 * determine allocation separately. MAX_SAFE_INTEGER is a serializable timestamp
 * sentinel, not a new market-age ceiling or an entry authorization. */
export const PERSISTENT_OBSERVABLE_MARKET_POLICY=Object.freeze({...OBSERVATION_AGE_POLICY,version:'persistent-observable-market-v1',recentMaximumAgeMs:Number.MAX_SAFE_INTEGER,selectedOlderMaximumAgeMs:Number.MAX_SAFE_INTEGER,primaryWatchCapacity:null,olderWatchCapacity:null,totalWatchCapacity:null,maximumOlderDeep:null});
export type ObservationAgePolicy=typeof OBSERVATION_AGE_POLICY|typeof OBSERVATION_AGE_STUDY_24H_POLICY|typeof PERSISTENT_OBSERVABLE_MARKET_POLICY;
export type ObservationAgePolicyVersion=ObservationAgePolicy['version'];
/** Closed, versioned choices keep a custom object from silently relaxing limits. */
export function observationAgePolicyByVersion(version:unknown=OBSERVATION_AGE_POLICY.version):ObservationAgePolicy{
 if(version===OBSERVATION_AGE_POLICY.version)return OBSERVATION_AGE_POLICY;
 if(version===OBSERVATION_AGE_STUDY_24H_POLICY.version)return OBSERVATION_AGE_STUDY_24H_POLICY;
 if(version===PERSISTENT_OBSERVABLE_MARKET_POLICY.version)return PERSISTENT_OBSERVABLE_MARKET_POLICY;
 throw Error('OBSERVATION_AGE_POLICY');
}
function policy(value:ObservationAgePolicy){if(value!==OBSERVATION_AGE_POLICY&&value!==OBSERVATION_AGE_STUDY_24H_POLICY&&value!==PERSISTENT_OBSERVABLE_MARKET_POLICY)throw Error('OBSERVATION_AGE_POLICY');return value;}
const time=(value:number)=>Number.isSafeInteger(value)&&value>=0;
function need(value:unknown):asserts value {if(!value)throw Error('OBSERVATION_AGE_TIME');}
export function entryAgeEligible(migrationAt:number,at:number){need(time(migrationAt)&&time(at));const age=at-migrationAt;return age>=PROVISIONAL_RULE.minimumAgeMs&&age<PROVISIONAL_RULE.maximumAgeMs;}
export function observationExpiryAt(migrationAt:number,selectedOlder=false,agePolicy:ObservationAgePolicy=OBSERVATION_AGE_POLICY){need(time(migrationAt)&&typeof selectedOlder==='boolean');if(policy(agePolicy)===PERSISTENT_OBSERVABLE_MARKET_POLICY)return Number.MAX_SAFE_INTEGER;const expiry=migrationAt+(selectedOlder?agePolicy.selectedOlderMaximumAgeMs:agePolicy.recentMaximumAgeMs);need(time(expiry));return expiry;}
export function observationAgeEligible(migrationAt:number,at:number,selectedOlder=false,agePolicy:ObservationAgePolicy=OBSERVATION_AGE_POLICY){need(time(migrationAt)&&time(at)&&typeof selectedOlder==='boolean');return at>=migrationAt&&at<observationExpiryAt(migrationAt,selectedOlder,agePolicy);}
export function observationAgeCohort(migrationAt:number,at:number,selectedOlder=false,agePolicy:ObservationAgePolicy=OBSERVATION_AGE_POLICY):'pre-entry'|'entry-eligible'|'older-selected'|'outside-observation'{
 if(!observationAgeEligible(migrationAt,at,selectedOlder,agePolicy))return 'outside-observation';if(at-migrationAt<PROVISIONAL_RULE.minimumAgeMs)return 'pre-entry';return entryAgeEligible(migrationAt,at)?'entry-eligible':'older-selected';
}
/** Fresh actual-ACK windows still require six CLOSED ten-second buckets plus
 * audit availability. This is necessary timing capacity, never qualification. */
export function observationRunway(migrationAt:number,at:number,selectedOlder=false,agePolicy:ObservationAgePolicy=OBSERVATION_AGE_POLICY){
 need(time(migrationAt)&&time(at)&&at>=migrationAt);const firstWindowEndAt=Math.ceil(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs+PROVISIONAL_RULE.windowMs,earliestAuditStartAt=firstWindowEndAt+5000,expiresAt=observationExpiryAt(migrationAt,selectedOlder,agePolicy);
 return {allowed:observationAgeEligible(migrationAt,at,selectedOlder,agePolicy)&&earliestAuditStartAt<expiresAt,firstWindowEndAt,earliestAuditStartAt,expiresAt,remainingAuditEnvelopeMs:expiresAt-earliestAuditStartAt,meaning:'Observation-only fresh window/audit feasibility; entry age, data validity and execution remain separate.'};
}
