import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ADAPTIVE_PILOT_BINDING,ADAPTIVE_PILOT_CONTRACT,ADAPTIVE_PILOT_CONTRACT_SHA256,CONCURRENT_PILOTS,PILOT_CONTRACT,PILOT_CONTRACT_SHA256,assertPilotBaseline,resolveAdaptivePilotBinding,resolvePilotBinding} from '../src/pilot-contract.js';
import {recordPilotStageTransition} from '../src/pilot.js';

test('active adaptive profile preserves immutable baseline rollback and PAPER boundary',()=>{
 assertPilotBaseline();
 assert.equal(PILOT_CONTRACT_SHA256,'665b28e6cdc326b20cd5e921fbddbaf9fdfd786ce80cbd2286d98a00a8fef2a9');
 assert.equal(createHash('sha256').update(JSON.stringify(PILOT_CONTRACT)).digest('hex'),PILOT_CONTRACT_SHA256);
 assert.equal(CONCURRENT_PILOTS[2].contractSha256,'416dda5b84dd2e282534fcf20c77137afd61afb7de178d418bf2772bd6f2f100');
 assert.equal(PILOT_CONTRACT.risk.reentry,false);
 const active=resolveAdaptivePilotBinding();
 assert.equal(active.version,'adaptive-momentum-v2-paper-v1');assert.equal(active.maxPositions,2);
 assert.equal(active.contract.mode,'PAPER');assert.equal(active.contract.liveTradingEnabled,false);
 assert.equal(ADAPTIVE_PILOT_CONTRACT.adaptive.policy.exit.stopLossBps,1500);
 assert.equal(ADAPTIVE_PILOT_CONTRACT.adaptive.policy.exit.takeProfitBps,null);
 assert.equal(ADAPTIVE_PILOT_CONTRACT.adaptive.policy.exit.maximumProfitableHoldingMs,null);
 assert.equal(ADAPTIVE_PILOT_CONTRACT.risk.reentry,true);
 assert.equal(ADAPTIVE_PILOT_CONTRACT.risk.leverage,false);assert.equal(ADAPTIVE_PILOT_CONTRACT.risk.adds,false);
});

test('adaptive binding refuses arbitrary hashes, positions, stages and inherited baseline identity',()=>{
 assert.ok(resolvePilotBinding(ADAPTIVE_PILOT_BINDING));
 for(const patch of [{contractSha256:'0'.repeat(64)},{maxPositions:3},{stage:3},{version:PILOT_CONTRACT.version}])assert.equal(resolvePilotBinding({...ADAPTIVE_PILOT_BINDING,...patch}),null);
 assert.throws(()=>resolveAdaptivePilotBinding(3 as 2),/ADAPTIVE_TWO_POSITION_STAGE_REQUIRED/);
});

test('active profile transition preserves original manifest identity/history and permits explicit baseline rollback',()=>{
 const manifest={accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,contractSha256:PILOT_CONTRACT_SHA256 as string,runs:['original-run'],baselinePaths:['original-evidence']};
 const stable={accountId:manifest.accountId,inceptionAt:manifest.inceptionAt,runs:[...manifest.runs],baselinePaths:[...manifest.baselinePaths]};
 recordPilotStageTransition(manifest,'two','adaptive-active-1',1793300000000,ADAPTIVE_PILOT_BINDING);
 assert.equal(manifest.contractSha256,ADAPTIVE_PILOT_CONTRACT_SHA256);
 assert.deepEqual({accountId:manifest.accountId,inceptionAt:manifest.inceptionAt,runs:manifest.runs,baselinePaths:manifest.baselinePaths},stable);
 recordPilotStageTransition(manifest,'two','explicit-baseline-rollback',1793300000001);
 assert.equal(manifest.contractSha256,CONCURRENT_PILOTS[2].contractSha256);
 assert.throws(()=>recordPilotStageTransition(manifest,'single','wrong-stage',1793300000002,ADAPTIVE_PILOT_BINDING),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
 assert.throws(()=>recordPilotStageTransition(manifest,'two','untrusted-profile',1793300000002,{...ADAPTIVE_PILOT_BINDING,contractSha256:'0'.repeat(64)}),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
});
