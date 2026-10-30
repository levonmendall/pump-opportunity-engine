/** Strategy-manifest evolution only; existing financial records are opaque. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordPilotStageTransition} from '../src/pilot.js';
import {ADAPTIVE_PILOT_BINDING,LIQUIDITY_RESILIENT_PILOT_BINDING,LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256,resolvePilotBinding,type PilotBinding} from '../src/pilot-contract.js';
const AT=Date.parse('2026-10-30T21:00:00Z');
function retained(){return {accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,contractSha256:LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256,stageHistory:[{runId:'native-paper-existing-v3',at:AT-1000,stage:'two' as const,contractSha256:LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256,previousContractSha256:LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256}],financialReference:{epochId:'poe-paper-10sol-v3-20261030',startedAt:1793387705083,contributionLamports:'10000000000',historyRetained:true},priorRuns:['retained-v3-source'],positions:{old:{version:'liquidity-resilient-momentum-v3',units:'100'}}};}

test('V3.1 explicitly evolves V3 in-place operational history and resumes without changing epoch or old holdings',()=>{
 const manifest=retained(),before=structuredClone(manifest);const selected=recordPilotStageTransition(manifest,'two','native-paper-v31-first',AT,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING);
 assert.equal(selected.binding.version,'liquidity-resilient-momentum-v3.1');assert.equal(selected.contract.liveTradingEnabled,false);assert.equal(selected.binding.maxPositions,null);assert.equal(selected.contractSha256,LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256);
 assert.deepEqual(manifest.stageHistory.slice(0,-1),before.stageHistory);assert.deepEqual(manifest.financialReference,before.financialReference);assert.deepEqual(manifest.positions,before.positions);assert.deepEqual(manifest.priorRuns,before.priorRuns);assert.equal(manifest.stageHistory.at(-1)!.previousContractSha256,LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256);
 recordPilotStageTransition(manifest,'two','native-paper-v31-cold',AT+1,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING);assert.equal(manifest.stageHistory.at(-1)!.previousContractSha256,LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256);assert.deepEqual(manifest.financialReference,before.financialReference);
});
test('V3.1 cannot silently downgrade to V3/V2 or accept a forged sizing/stage binding',()=>{
 const manifest=retained();recordPilotStageTransition(manifest,'two','native-paper-v31-first',AT,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING);const before=structuredClone(manifest);
 for(const binding of [LIQUIDITY_RESILIENT_PILOT_BINDING,ADAPTIVE_PILOT_BINDING]){assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-rollback',AT+1,binding),/PILOT_STAGE_TRANSITION_BINDING/);assert.deepEqual(manifest,before);}
 for(const binding of [{...LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,maxPositions:2},{...LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,stage:3},{...LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,contractSha256:LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256}]){assert.equal(resolvePilotBinding(binding),null);assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-forged',AT+1,binding as PilotBinding),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);assert.deepEqual(manifest,before);}
 assert.throws(()=>recordPilotStageTransition(manifest,'single','native-paper-wrong-stage',AT+1,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
});
