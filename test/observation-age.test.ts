/** Pure allocation age policy: no provider, ledger or entry-permission owner. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROVISIONAL_RULE} from '../src/strategy.js';
import {PILOT_CONTRACT,PILOT_CONTRACT_SHA256,assertPilotBaseline} from '../src/pilot-contract.js';
import {OBSERVATION_AGE_POLICY,entryAgeEligible,observationAgeEligible,observationExpiryAt,observationAgeCohort,observationRunway} from '../src/observation-age.js';
const T=10000000;
test('verified observation may begin immediately while baseline entry remains five to120 minutes',()=>{
 assert.equal(observationAgeEligible(T,T),true);assert.equal(entryAgeEligible(T,T),false);assert.equal(observationAgeEligible(T,T+299999),true);assert.equal(entryAgeEligible(T,T+299999),false);assert.equal(entryAgeEligible(T,T+300000),true);assert.equal(entryAgeEligible(T,T+7199999),true);assert.equal(entryAgeEligible(T,T+7200000),false);assert.equal(observationAgeEligible(T,T+7200000),false);
 assert.equal(observationAgeCohort(T,T),'pre-entry');assert.equal(observationAgeCohort(T,T+300000),'entry-eligible');assert.equal(observationAgeCohort(T,T+7200000),'outside-observation');
});
test('older observations require explicit selection and remain capped at six hours without entry permission',()=>{
 assert.equal(observationAgeEligible(T,T+7200000,true),true);assert.equal(observationAgeCohort(T,T+7200000,true),'older-selected');assert.equal(observationAgeEligible(T,T+21599999,true),true);assert.equal(observationAgeEligible(T,T+21600000,true),false);assert.equal(entryAgeEligible(T,T+10000000),false);assert.equal(observationExpiryAt(T,true),T+21600000);assert.equal(OBSERVATION_AGE_POLICY.maximumOlderDeep,1);
});
test('early observation still waits for six complete closed buckets and a real independent audit',()=>{
 const at=T+1,runway=observationRunway(T,at);assert.equal(runway.firstWindowEndAt,T+70000);assert.equal(runway.earliestAuditStartAt,T+75000);assert.equal(runway.allowed,true);assert.equal(runway.expiresAt,T+7200000);
 assert.equal(observationRunway(T,T+7200000-65000).allowed,false);assert.equal(observationRunway(T,T+7200000-65000,true).allowed,true);assert.equal(observationRunway(T,T+21600000-65000,true).allowed,false);
});
test('age policy cannot change frozen entry rules, fees, risk or account contract',()=>{
 assertPilotBaseline();assert.equal(PROVISIONAL_RULE.minimumAgeMs,300000);assert.equal(PROVISIONAL_RULE.maximumAgeMs,7200000);assert.equal(PILOT_CONTRACT.baseline.minimumAgeMs,300000);assert.equal(PILOT_CONTRACT.baseline.maximumAgeMs,7200000);assert.equal(PILOT_CONTRACT_SHA256,'665b28e6cdc326b20cd5e921fbddbaf9fdfd786ce80cbd2286d98a00a8fef2a9');assert.equal(OBSERVATION_AGE_POLICY.primaryWatchCapacity,150);assert.equal(OBSERVATION_AGE_POLICY.totalWatchCapacity,174);
});
test('future or malformed origin times cannot create eligibility',()=>{
 assert.equal(entryAgeEligible(T+1,T),false);assert.equal(observationAgeEligible(T+1,T),false);for(const value of [-1,NaN,Infinity]){assert.throws(()=>observationAgeEligible(value,T),/OBSERVATION_AGE_TIME/);assert.throws(()=>entryAgeEligible(value,T),/OBSERVATION_AGE_TIME/);}assert.throws(()=>observationRunway(T+1,T),/OBSERVATION_AGE_TIME/);
});
