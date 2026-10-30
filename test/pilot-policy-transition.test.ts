/** Exact retained source69 policy to current operating policy. Offline fixtures
 * exercise the real startup transition, not an installed account or provider. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordPilotStageTransition} from '../src/pilot.js';
import {DisposableLedger,type Mark} from '../src/ledger.js';
import {ADAPTIVE_PILOT_BINDING,ADAPTIVE_PILOT_CONTRACT_SHA256,resolvePilotBinding} from '../src/pilot-contract.js';
import {parseNativePaperArgs,resolveNativePaperStrategy} from '../src/run-native-paper.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION} from '../src/native-paper-contract.js';

// Independently imported from exact released source69, not computed using the
// new policy. This historical hash must never resolve as the current strategy.
const PRIOR='8e404a11d1868e3a2c3a4a708133f9831a555a590201c8e70e62c35a44c4d0bb';
const at=1793340000000;
function retained(){return {schemaVersion:1,experimental:false,authoritative:true,accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,contractSha256:PRIOR,stageHistory:[{runId:'native-paper-20261030021230118',at:1793326350118,stage:'two' as const,contractSha256:PRIOR,previousContractSha256:PRIOR}],runs:['native-paper-20261030021230118'],baselinePaths:['retained-checkpoint'],nativeCheckpointPath:'retained-watch-checkpoint',serviceStatistics:{protection:{breaches:79,unavailableChecks:271,maxCompletedGapMs:89426}}};}

test('retained source69 active adaptive stage forwards to current5%/10% policy without history reset or policy fallback',()=>{
 const args=parseNativePaperArgs(['--resume','--directory','/OFFLINE-NO-ACCOUNT','--input','/OFFLINE-NO-INPUT','--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION,'--service','--strategy','adaptive-momentum-v2','--stage','two','--deep-slots','4']);
 const target=resolveNativePaperStrategy(args.stage,args.strategy),manifest=retained(),before=structuredClone(manifest);
 const selected=recordPilotStageTransition(manifest,args.stage!,'native-paper-20261030062000000',at,target.binding);
 assert.equal(args.deepSlots,4);assert.equal(selected.binding.maxPositions,2);assert.equal(selected.contractSha256,ADAPTIVE_PILOT_CONTRACT_SHA256);assert.notEqual(selected.contractSha256,PRIOR);
 assert.equal(selected.contract.risk.maximumInitialCostMicroUsd,null);assert.equal(selected.contract.risk.maximumAggregatePositionCostMicroUsd,null);
 assert.equal('entryConsumedCostBps'in selected.contract.risk&&selected.contract.risk.entryConsumedCostBps,500);assert.equal('dailyEquityHighWaterDrawdownBps'in selected.contract.risk&&selected.contract.risk.dailyEquityHighWaterDrawdownBps,1000);
 assert.equal(selected.contract.mode,'PAPER');assert.equal(selected.contract.liveTradingEnabled,false);
 assert.deepEqual(manifest.stageHistory.slice(0,-1),before.stageHistory);assert.deepEqual(manifest.stageHistory.at(-1),{runId:'native-paper-20261030062000000',at,stage:'two',contractSha256:ADAPTIVE_PILOT_CONTRACT_SHA256,previousContractSha256:PRIOR});
 assert.deepEqual({...manifest,contractSha256:before.contractSha256,stageHistory:before.stageHistory},before);
 assert.equal(resolvePilotBinding({...ADAPTIVE_PILOT_BINDING,contractSha256:PRIOR}),null,'historical predecessor is not an active-policy resolver');
});

test('historical predecessor cannot activate baseline, wrong stage, forged target or unknown policy',()=>{
 for(const [stage,binding]of [['two',undefined],['single',ADAPTIVE_PILOT_BINDING],['two',{...ADAPTIVE_PILOT_BINDING,contractSha256:PRIOR}],['two',{...ADAPTIVE_PILOT_BINDING,maxPositions:3}]]as const){
  const manifest=retained(),before=structuredClone(manifest);assert.throws(()=>recordPilotStageTransition(manifest,stage,'native-paper-20261030062000000',at,binding as typeof ADAPTIVE_PILOT_BINDING),/PILOT_(STAGE_TRANSITION_BINDING|EXPLICIT_ADAPTIVE_BINDING_REQUIRED)/);assert.deepEqual(manifest,before);
 }
 const manifest={...retained(),contractSha256:'f'.repeat(64)},before=structuredClone(manifest);assert.throws(()=>recordPilotStageTransition(manifest,'two','native-paper-20261030062000000',at,ADAPTIVE_PILOT_BINDING),/PILOT_STAGE_TRANSITION_BINDING/);assert.deepEqual(manifest,before);
});

test('forward compatibility preserves monotone time and bounded history checks and repeated current startup',()=>{
 for(const [runId,time]of [['INVALID/RUN',at],['native-paper-20261030062000000',Number.NaN],['native-paper-20261030062000000',1793326350117]]as const){const manifest=retained(),before=structuredClone(manifest);assert.throws(()=>recordPilotStageTransition(manifest,'two',runId,time,ADAPTIVE_PILOT_BINDING),/PILOT_(STAGE_TRANSITION_BINDING|STAGE_HISTORY_BOUND)/);assert.deepEqual(manifest,before);}
 const manifest=retained();recordPilotStageTransition(manifest,'two','native-paper-20261030062000000',at,ADAPTIVE_PILOT_BINDING);recordPilotStageTransition(manifest,'two','native-paper-20261030062001000',at+1000,ADAPTIVE_PILOT_BINDING);assert.equal(manifest.stageHistory.length,3);assert.equal(manifest.stageHistory.at(-1)!.previousContractSha256,ADAPTIVE_PILOT_CONTRACT_SHA256);
 const full=retained();full.stageHistory=Array.from({length:64},()=>({...full.stageHistory[0]!}));const before=structuredClone(full);assert.throws(()=>recordPilotStageTransition(full,'two','native-paper-20261030062000000',at,ADAPTIVE_PILOT_BINDING),/PILOT_STAGE_HISTORY_BOUND/);assert.deepEqual(full,before);
});

test('startup transition with an open two-holding ledger leaves positions, pending state and journal unchanged',t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-policy-transition-')),path=join(directory,'fixture.sqlite');let ledger=new DisposableLedger(path,'fixture-policy-transition');
 t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const price=(time:number)=>({at:time,microUsdPerSol:'100000000',source:'OFFLINE fixed USD fixture'}),marks:Record<string,Mark>={};ledger.initialize(price(at),at);
 for(let i=0;i<2;i++){
  const time=at+i*1100,mint='fixture-held-'+i;
  for(const mark of Object.values(marks))mark.at=time;
  ledger.reconcile('reconcile-'+i,time,price(time),marks);
  ledger.order({id:'entry-'+i,mint,side:'buy',decidedAt:time,executeAt:time+500,expiresAt:time+5000,gas:'7000',deposit:'2000000',maxSpend:'10000000',minReceive:'100',decisionEvidence:'OFFLINE retained holding fixture'},price(time),marks);
  for(const mark of Object.values(marks))mark.at=time+500;
  assert.equal(ledger.attempt('fill-'+i,'entry-'+i,time+500,{at:time+500,spendLamports:'10000000',receiveUnits:'100',evidence:'OFFLINE actual-size fixture'},price(time+500),marks).status,'filled');
  marks[mint]={at:time+500,netLamports:'10000000',pricedBaseUnits:'100',evidence:'OFFLINE actual-size fixture'};
 }
 assert.equal(Object.keys(ledger.state().positions).length,2);const before=structuredClone(ledger.state()),journal=ledger.exportJournal(100),manifest=retained();
 recordPilotStageTransition(manifest,'two','native-paper-20261030062000000',at+2200,ADAPTIVE_PILOT_BINDING);
 assert.deepEqual(ledger.state(),before);assert.deepEqual(ledger.exportJournal(100),journal);
 ledger.close();ledger=new DisposableLedger(path,'fixture-policy-transition');assert.deepEqual(ledger.state(),before);assert.equal(Object.keys(ledger.state().positions).length,2);assert.deepEqual(ledger.exportJournal(100),journal);
});
