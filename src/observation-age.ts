/** Observation allocation policy only. Frozen entry, execution and risk rules remain unchanged. */
import {PROVISIONAL_RULE} from './strategy.js';
export const OBSERVATION_AGE_POLICY=Object.freeze({version:'observation-age-v1',minimumObservationAgeMs:0,recentMaximumAgeMs:PROVISIONAL_RULE.maximumAgeMs,selectedOlderMaximumAgeMs:6*60*60*1000,olderActivityMaximumAgeMs:60000,primaryWatchCapacity:150,olderWatchCapacity:24,totalWatchCapacity:174,maximumOlderDeep:1});
const time=(value:number)=>Number.isSafeInteger(value)&&value>=0;
function need(value:unknown):asserts value {if(!value)throw Error('OBSERVATION_AGE_TIME');}
export function entryAgeEligible(migrationAt:number,at:number){need(time(migrationAt)&&time(at));const age=at-migrationAt;return age>=PROVISIONAL_RULE.minimumAgeMs&&age<PROVISIONAL_RULE.maximumAgeMs;}
export function observationExpiryAt(migrationAt:number,selectedOlder=false){need(time(migrationAt)&&typeof selectedOlder==='boolean');const expiry=migrationAt+(selectedOlder?OBSERVATION_AGE_POLICY.selectedOlderMaximumAgeMs:OBSERVATION_AGE_POLICY.recentMaximumAgeMs);need(time(expiry));return expiry;}
export function observationAgeEligible(migrationAt:number,at:number,selectedOlder=false){need(time(migrationAt)&&time(at)&&typeof selectedOlder==='boolean');return at>=migrationAt&&at<observationExpiryAt(migrationAt,selectedOlder);}
export function observationAgeCohort(migrationAt:number,at:number,selectedOlder=false):'pre-entry'|'entry-eligible'|'older-selected'|'outside-observation'{
 if(!observationAgeEligible(migrationAt,at,selectedOlder))return 'outside-observation';if(at-migrationAt<PROVISIONAL_RULE.minimumAgeMs)return 'pre-entry';return entryAgeEligible(migrationAt,at)?'entry-eligible':'older-selected';
}
/** Fresh actual-ACK windows still require six CLOSED ten-second buckets plus
 * audit availability. This is necessary timing capacity, never qualification. */
export function observationRunway(migrationAt:number,at:number,selectedOlder=false){
 need(time(migrationAt)&&time(at)&&at>=migrationAt);const firstWindowEndAt=Math.ceil(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs+PROVISIONAL_RULE.windowMs,earliestAuditStartAt=firstWindowEndAt+5000,expiresAt=observationExpiryAt(migrationAt,selectedOlder);
 return {allowed:observationAgeEligible(migrationAt,at,selectedOlder)&&earliestAuditStartAt<expiresAt,firstWindowEndAt,earliestAuditStartAt,expiresAt,remainingAuditEnvelopeMs:expiresAt-earliestAuditStartAt,meaning:'Observation-only fresh window/audit feasibility; entry age, data validity and execution remain separate.'};
}
