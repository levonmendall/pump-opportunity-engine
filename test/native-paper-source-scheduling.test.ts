/** Offline scheduler timing. Real SQLite coordinator operations surround
 * deterministic local-work costs; no provider or operating ledger is opened. */
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner,type NativeRunnerOptions} from '../src/native-candidate-runner.js';
import {NativePaperCashMaintenance} from '../src/run-native-paper.js';
import {NativePaperSourceWork,NativePaperWorkState,NATIVE_PAPER_SOURCE_WORK_QUANTUM_MS} from '../src/native-paper-work.js';
import {NATIVE_PAPER_FINANCIAL_READINESS_POLICY} from '../src/native-paper.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const START=Date.parse('2026-11-02T18:00:00.000Z');
function source(t:TestContext,options:{now:()=>number;checkpoint?:()=>Promise<void>;open?:()=>boolean;financial?:()=>boolean}){
 const registry=new MarketRegistry(':memory:',{now:options.now});t.after(()=>registry.close());
 let calls=0,services=0;
 const unavailable=()=>{calls++;throw Error('OFFLINE_PROVIDER_MUST_NOT_START');};
 const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:options.now()+60000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:unavailable,removeCandidate:unavailable,notificationLedger:()=>[],requestSupportRefresh:unavailable,requestHeartbeat:unavailable,service:async(_signal:AbortSignal|undefined,admission:{admissionOpen?:()=>boolean})=>{if(admission.admissionOpen?.()===false)return {kind:'deferred'};services++;return {kind:'idle'};},stop:async()=>{}} as unknown as NativeRunnerOptions['flow'];
 const rpc={usage:()=>({waitingOrOperating:false,inFlight:0,closed:false,fatal:null,dispatchWindow:{readyAt:options.now(),physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,call:unavailable} as unknown as NativeRunnerOptions['rpc'];
 const runner=new NativeCandidateRunner({registry,flow,rpc,runId:'offline-source-scheduling',maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:'liquidity-resilient-momentum-v3.1',now:options.now,record:()=>{},admissionOpen:options.open,sourceWorkAdmission:options.financial,sourceWorkCheckpoint:options.checkpoint?async()=>{assert.equal((registry as unknown as {db:{inTransaction:boolean}}).db.inTransaction,false,'source yields only after SQLite transactions close');await options.checkpoint!();}:undefined});
 return {runner,registry,get calls(){return calls;},get services(){return services;}};
}

test('real source phase boundaries prevent chained local work from starving cash and the timer turn',async t=>{
 for(const cooperative of [false,true])await t.test(cooperative?'cooperative source':'prior microtask-only source',async t=>{
  let at=START,last=at;const gaps:number[]=[];
  const maintenance=new NativePaperCashMaintenance({now:()=>at,monotonic:()=>at,cpu:()=>0,busy:()=>false,lastReconciledAt:()=>last,refresh:()=>{gaps.push(at-last);last=at;return {kind:'reconciled',recovered:false};}});
  at+=1000;maintenance.run();gaps.length=0;
  const turns=new NativePaperSourceWork({maintainCash:bound=>maintenance.run(bound),monotonic:()=>at});
  const f=source(t,{now:()=>at,...(cooperative?{checkpoint:()=>turns.checkpoint()}:{} )});
  const internals=f.runner as unknown as {drainNativeActivity():void;drainPoolSourceProgress():void};
  // Each real closed registry phase takes905ms in this deterministic replay.
  // Together with750ms-old cash, the old all-microtask path delays a timer
  // until2,560ms after the prior reconciliation, matching the observed scale.
  for(const method of ['drainNativeActivity','drainPoolSourceProgress']as const){
   const original=internals[method].bind(internals);
   t.mock.method(internals,method,()=>{original();at+=905;});
  }
  let timerRan=false;const timer=setTimeout(()=>{timerRan=true;},0);t.after(()=>clearTimeout(timer));
  at+=750;if(cooperative)await turns.checkpoint(true);
  await f.runner.step();maintenance.run();
  assert.equal(timerRan,cooperative,'fulfilled Promise awaits alone do not service the queued timer');
  assert.equal(maintenance.usage().deadlineMisses,cooperative?0:1);
  assert.equal(Math.max(...gaps),cooperative?1655:2560);
  assert.equal(f.calls,0);assert.equal(f.services,0);
  assert.equal(NATIVE_PAPER_FINANCIAL_READINESS_POLICY.maximumReconciliationAgeMs,2000);
  assert.equal(NATIVE_PAPER_FINANCIAL_READINESS_POLICY.targetMs,1000);
 });
});

test('short checkpoints are coalesced and cannot turn into a cash write for every source callback',async()=>{
 let at=START,last=at,writes=0,yields=0;
 const maintenance=new NativePaperCashMaintenance({now:()=>at,busy:()=>false,lastReconciledAt:()=>last,refresh:()=>{writes++;last=at;return {kind:'reconciled',recovered:false};}});
 const work=new NativePaperSourceWork({maintainCash:bound=>maintenance.run(bound),monotonic:()=>at,yield:async()=>{yields++;}});
 await work.checkpoint(true);for(let i=0;i<100;i++)await work.checkpoint();
 assert.equal(writes,0);assert.equal(yields,0);
 at+=NATIVE_PAPER_SOURCE_WORK_QUANTUM_MS;await work.checkpoint();
 assert.equal(yields,1);assert.equal(writes,0);
 at+=875;await work.checkpoint();assert.equal(writes,1);
 for(let i=0;i<100;i++)await work.checkpoint();assert.equal(writes,1);
});

test('source turn never reconciles across financial ownership, and retains failure retry pacing',async()=>{
 let at=START,last=at,writes=0,unavailable=false;const owner=new NativePaperWorkState();
 const maintenance=new NativePaperCashMaintenance({now:()=>at,busy:()=>owner.current==='pending'||owner.current==='protection'||owner.current==='candidate',lastReconciledAt:()=>last,refresh:()=>{writes++;if(unavailable)return {kind:'unavailable',recovered:false};last=at;return {kind:'reconciled',recovered:false};}});
 const work=new NativePaperSourceWork({maintainCash:bound=>maintenance.run(bound),monotonic:()=>at,yield:async()=>{}});
 owner.set('pending');at+=2001;await work.checkpoint(true);assert.equal(writes,0);assert.equal(last,START);
 owner.set('source');unavailable=true;await work.checkpoint(true);assert.equal(writes,1);
 for(let i=0;i<3;i++){at+=250;await work.checkpoint(true);assert.equal(writes,1);}
 at+=250;await work.checkpoint(true);assert.equal(writes,2);assert.equal(maintenance.usage().financialFailures,0);
});

test('runner rechecks current financial/source/abort admission after a checkpoint before source work',async t=>{
 for(const interruption of ['source','financial','abort']as const)await t.test(interruption,async t=>{
  let open=true,financial=true;const controller=new AbortController();
  const f=source(t,{now:()=>START,open:()=>open,financial:()=>financial,checkpoint:async()=>{if(interruption==='source')open=false;else if(interruption==='financial')financial=false;else controller.abort();}});
  assert.equal(await f.runner.step(controller.signal),'wait');assert.equal(f.calls,0);assert.equal(f.services,0);
 });
});

test('cooperative service retains the original physical deadline after a delayed turn',async t=>{
 let at=START;const originalDeadline=at+1700;
 const f=source(t,{now:()=>at,checkpoint:async()=>{at+=1701;}});
 const runner=f.runner as unknown as {serviceFlow(signal:AbortSignal|undefined,deadlineAt:number,policy:{allowSetup:boolean;allowRetirement:boolean}):Promise<{kind:string}>};
 const outcome=await runner.serviceFlow(undefined,originalDeadline,{allowSetup:true,allowRetirement:true});
 assert.equal(outcome.kind,'deferred');assert.equal(f.services,0);assert.equal(f.calls,0);
});

test('a single overlong synchronous phase still records a real miss instead of resetting timestamps',async()=>{
 let at=START,last=at;
 const maintenance=new NativePaperCashMaintenance({now:()=>at,busy:()=>false,lastReconciledAt:()=>last,refresh:()=>{last=at;return {kind:'reconciled',recovered:false};}});
 at+=1000;maintenance.run();
 const work=new NativePaperSourceWork({maintainCash:bound=>maintenance.run(bound),monotonic:()=>at,yield:async()=>{}});
 at+=2560;await work.checkpoint();
 assert.equal(maintenance.usage().deadlineMisses,1);assert.equal(maintenance.usage().maximumLatenessMs,1560);assert.equal(last,at);
});
