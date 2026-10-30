/** Operating-manifest transitions only; no account, network, or trade is created. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordPilotStageTransition} from '../src/pilot.js';
import {parseNativePaperArgs,resolveNativePaperStrategy} from '../src/run-native-paper.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION} from '../src/native-paper-contract.js';
import {ADAPTIVE_PILOT_BINDING,ADAPTIVE_PILOT_CONTRACT_SHA256,LIQUIDITY_RESILIENT_PILOT_BINDING,LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256,type PilotBinding} from '../src/pilot-contract.js';

const AT=Date.parse('2026-10-30T19:12:25.857Z');
function retained(){return {accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,
 contractSha256:ADAPTIVE_PILOT_CONTRACT_SHA256,
 stageHistory:[{runId:'native-paper-20261030153025611',at:AT-3600000,stage:'two' as const,
  contractSha256:ADAPTIVE_PILOT_CONTRACT_SHA256,previousContractSha256:ADAPTIVE_PILOT_CONTRACT_SHA256}],
 runs:['native-paper-20261030153025611'],baselinePaths:['retained-provider-checkpoint'],
 serviceStatistics:{protection:{breaches:89,maxCompletedGapMs:156043}},
 financialReference:{epochId:'poe-paper-10sol-v3-20261030',contributionLamports:'10000000000',historyRetained:true}};}

test('actual V3 startup binding transitions the retained adaptive manifest without changing history or financial reference',()=>{
 const args=parseNativePaperArgs(['--resume','--directory','/OFFLINE-NO-ACCOUNT','--input','/OFFLINE-NO-INPUT',
  '--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION,'--service','--strategy','liquidity-resilient-momentum-v3',
  '--stage','two','--deep-slots','4']);
 const configuration=resolveNativePaperStrategy(args.stage,args.strategy),manifest=retained(),before=structuredClone(manifest);
 const selected=recordPilotStageTransition(manifest,args.stage!,'native-paper-20261030193500000',AT,configuration.binding);
 assert.equal(args.deepSlots,4);assert.equal(selected.contractSha256,LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256);
 assert.equal(selected.binding.maxPositions,null);assert.equal(selected.contract.liveTradingEnabled,false);
 assert.deepEqual(manifest.stageHistory.slice(0,-1),before.stageHistory);
 assert.deepEqual(manifest.stageHistory.at(-1),{runId:'native-paper-20261030193500000',at:AT,stage:'two',
  contractSha256:LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256,previousContractSha256:ADAPTIVE_PILOT_CONTRACT_SHA256});
 const {contractSha256:oldContract,stageHistory:oldHistory,...stableBefore}=before;
 const {contractSha256:newContract,stageHistory:newHistory,...stableAfter}=manifest;
 assert.deepEqual(stableAfter,stableBefore);
});

test('V3 cold resume accepts its recorded contract hash and appends only one operating history row',()=>{
 const manifest=retained();recordPilotStageTransition(manifest,'two','native-paper-20261030193500000',AT,LIQUIDITY_RESILIENT_PILOT_BINDING);
 const before=structuredClone(manifest);
 recordPilotStageTransition(manifest,'two','native-paper-20261030193600000',AT+60000,LIQUIDITY_RESILIENT_PILOT_BINDING);
 assert.equal(manifest.contractSha256,LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256);
 assert.deepEqual(manifest.stageHistory.slice(0,-1),before.stageHistory);
 assert.equal(manifest.stageHistory.at(-1)!.previousContractSha256,LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256);
 assert.deepEqual(manifest.financialReference,before.financialReference);
 assert.deepEqual(manifest.runs,before.runs);
});

test('forged V3 bindings, wrong stages and unknown predecessor hashes fail before manifest mutation',()=>{
 const cases:Array<['single'|'two',unknown]>=[['single',LIQUIDITY_RESILIENT_PILOT_BINDING],
  ['two',{...LIQUIDITY_RESILIENT_PILOT_BINDING,version:'unknown-version'}],
  ['two',{...LIQUIDITY_RESILIENT_PILOT_BINDING,maxPositions:2}],
  ['two',{...LIQUIDITY_RESILIENT_PILOT_BINDING,stage:3}],
  ['two',{...LIQUIDITY_RESILIENT_PILOT_BINDING,contractSha256:'0'.repeat(64)}]];
 for(const [stage,binding]of cases){const manifest=retained(),before=structuredClone(manifest);
  assert.throws(()=>recordPilotStageTransition(manifest,stage,'native-paper-20261030193500000',AT,binding as PilotBinding),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
  assert.deepEqual(manifest,before);
 }
 const manifest={...retained(),contractSha256:'f'.repeat(64)},before=structuredClone(manifest);
 assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-20261030193500000',AT,LIQUIDITY_RESILIENT_PILOT_BINDING),/PILOT_STAGE_TRANSITION_BINDING/);
 assert.deepEqual(manifest,before);
});

test('strict adaptive V2 binding still resumes and cannot silently reinterpret a V3 contract',()=>{
 const original=retained();recordPilotStageTransition(original,'two','native-paper-20261030193500000',AT,ADAPTIVE_PILOT_BINDING);
 assert.equal(original.contractSha256,ADAPTIVE_PILOT_CONTRACT_SHA256);
 for(const binding of [{...ADAPTIVE_PILOT_BINDING,maxPositions:null},{...ADAPTIVE_PILOT_BINDING,contractSha256:'0'.repeat(64)}]){
  const manifest=retained(),before=structuredClone(manifest);
  assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-20261030193500000',AT,binding as PilotBinding),/PILOT_EXPLICIT_ADAPTIVE_BINDING_REQUIRED/);
  assert.deepEqual(manifest,before);
 }
 const v3=retained();v3.contractSha256=LIQUIDITY_RESILIENT_PILOT_CONTRACT_SHA256;
 const before=structuredClone(v3);
 assert.throws(()=>recordPilotStageTransition(v3,'two','native-paper-20261030193500000',AT,ADAPTIVE_PILOT_BINDING),/PILOT_STAGE_TRANSITION_BINDING/);
 assert.deepEqual(v3,before);
});
