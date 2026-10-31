/** Pure operating-manifest resume checks; no financial database or source work. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {recordPilotStageTransition} from '../src/pilot.js';
import {ADAPTIVE_PILOT_BINDING,LIQUIDITY_RESILIENT_PILOT_BINDING,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256,resolvePilotBinding,type PilotBinding} from '../src/pilot-contract.js';

const AT=Date.parse('2026-10-31T04:00:00.000Z');
// Derived from the immutable upstream policy/contract objects, not from the
// current policy: e5dce137's 15% policy and 1423b184's 25% policy respectively.
const PREDECESSORS=[
 {commit:'e5dce137ae4b967a07b07bc2bbb4b10534cb582f',policySha256:'5f40cf902d5457d0c3b5540ce6bffc7c233a67783e26c9ac67e2d1de8e8bdb20',contractSha256:'c6388e70d2366a2310c7f05c5184aaa20b2b469ff746e247f39b358da8af2b7d'},
 {commit:'1423b1844155b0a4776989932cd9d3b77a3265a3',policySha256:'571e5b0fe26ff81328df2db53689c310d63bf247cf048d77fc4b22f5312644d7',contractSha256:'b05238659a3665a877225abccaf5775f3b1df6bc58598888d93879ed560ed271'},
 {commit:'59a22419b2afc27ce0af13a532d9889a3a0fc3da',policySha256:'e44679fef5c11c4763ea670159833b9825e219b84a4e2d9e4bcc1531d933af7e',contractSha256:'9ca95a7e90e21201bcbfb926b17116d387d1da5e73e5032df04fb864fd3e8622'},
] as const;
function retained(contractSha256:string){return {
 accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,contractSha256,
 source:{commit:PREDECESSORS[0].commit,sha256:'0e685866ead3ebe59fffa53c85a18c0773aed628b62ffd7d3aefc14f89a84b61'},
 stageHistory:[{runId:'native-paper-retained',at:AT-1000,stage:'two' as const,contractSha256,previousContractSha256:contractSha256}],
 baselinePaths:['offline-retained-source-proof'],runs:['native-paper-retained'],
 financialReference:{epochId:'poe-paper-10sol-v3-20261030',contributionLamports:'10000000000',revision:131268},
 controls:{entriesEnabled:false,reason:'owner pause retained',stopRequested:true},
 positions:{legacy:{version:'liquidity-resilient-momentum-v3',units:'100',entryLamports:'1000'},priorV31:{version:'liquidity-resilient-momentum-v3.1',units:'200',entryLamports:'2000'}},
 pending:{'offline-pending-exit':{side:'sell',mint:'priorV31',reserved:'7000'}},
};}

test('cold resume accepts only the reviewed prior V3.1 contracts and preserves account, holdings and financial authority',()=>{
 for(const predecessor of PREDECESSORS){
  const manifest=retained(predecessor.contractSha256),before=structuredClone(manifest);
  const selected=recordPilotStageTransition(manifest,'two','native-paper-forward-resume',AT,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING);
  assert.equal(selected.contractSha256,LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256);
  assert.equal(selected.binding.version,'liquidity-resilient-momentum-v3.1');
  assert.equal(selected.contract.mode,'PAPER');
  assert.equal(selected.contract.liveTradingEnabled,false);
  assert.equal(selected.binding.maxPositions,null);
  const active=resolvePilotBinding(selected.binding)!;
  assert.ok('resilient' in active.contract);
  assert.equal(active.contract.resilient.policy.exit.stopLossBps,2500);
  assert.equal(active.contract.resilient.policy.exit.trailingMinimumBps,2500);
  assert.deepEqual(manifest,{...before,contractSha256:LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256,stageHistory:[...before.stageHistory,{runId:'native-paper-forward-resume',at:AT,stage:'two',contractSha256:LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256,previousContractSha256:predecessor.contractSha256}]},'only operational contract provenance may change');
 }
});

test('current-contract restarts retain the binding and append ordinary provenance without repeating a policy change',()=>{
 const manifest=retained(LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256),before=structuredClone(manifest);
 for(const [index,run] of ['native-paper-current-first','native-paper-current-second'].entries()){
  recordPilotStageTransition(manifest,'two',run,AT+index,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING);
  assert.equal(manifest.contractSha256,LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256);
  assert.equal(manifest.stageHistory.at(-1)!.previousContractSha256,LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256);
 }
 assert.deepEqual({...manifest,stageHistory:before.stageHistory},before);
 assert.equal(manifest.stageHistory.length,before.stageHistory.length+2);
});

test('unknown hashes, rollback profiles and forged active bindings remain refused without changing the retained manifest',()=>{
 for(const contractSha256 of ['a'.repeat(64),...PREDECESSORS.map(p=>p.policySha256)]){
  const manifest=retained(contractSha256),before=structuredClone(manifest);
  assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-unknown',AT,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING),/PILOT_STAGE_TRANSITION_BINDING/);
  assert.deepEqual(manifest,before);
 }
 for(const predecessor of PREDECESSORS){
  const manifest=retained(predecessor.contractSha256),before=structuredClone(manifest);
  for(const binding of [ADAPTIVE_PILOT_BINDING,LIQUIDITY_RESILIENT_PILOT_BINDING]){
   assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-rollback',AT,binding),/PILOT_STAGE_TRANSITION_BINDING/);
   assert.deepEqual(manifest,before);
  }
  const priorBinding={...LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,contractSha256:predecessor.contractSha256};
  if(predecessor.contractSha256!==LIQUIDITY_RESILIENT_V3_1_PILOT_CONTRACT_SHA256){
   assert.equal(resolvePilotBinding(priorBinding),null,'historical recognition does not make an obsolete policy an active binding');
   assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-old-binding',AT,priorBinding as PilotBinding),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
  }
  for(const binding of [{...LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,stage:3},{...LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING,maxPositions:2}]){
   assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-forged-binding',AT,binding as PilotBinding),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
  }
  assert.throws(()=>recordPilotStageTransition(manifest,'single','native-paper-wrong-stage',AT,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
  assert.deepEqual(manifest,before);
 }
});
