/** OFFLINE only. Actual V3.1 NativePaper/Trader, PilotMarket preparation and
 * ledger use the existing disposable coordinated fixture. Retained SDK bytes,
 * clocks/flow and provider delays are synthetic; no operating account is read. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {coordinatedNativeReplayFixture} from './helpers/coordinated-native-replay-fixture.js';
import {NativePaperCashMaintenance,nativePaperFinancialProviderAvailable,nativePaperRpcConfiguration,runNativePaper} from '../src/run-native-paper.js';
import {NativePaperWorkState} from '../src/native-paper-work.js';
import {projectFinancialReadinessReporting} from '../src/financial-readiness-reporting.js';
import {PilotRpc} from '../src/pilot-rpc.js';

const WAIT='OPERATING_READINESS_READ_ONLY_ENTRY_PREPARATION_WAIT';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}

async function fixture(t:TestContext,admission?:(at:number)=>boolean){
 let financialAdmission=true;
 const f=await coordinatedNativeReplayFixture(t,true,false,{initialSingle:true,operatingFinancialReadiness:true,reusePreparedEntryRent:true,financialAdmission:at=>financialAdmission&&(admission?.(at)??true)});
 await f.open();
 assert.equal(f.ledger.v3RiskPolicyActive(),true);
 assert.equal(f.bridge.maintainFlatFinancialReadiness(f.price()).recovered,true);
 f.bridge.trader.pauseNewEntries('completed PAPER protection gap exceeded research boundary');
 const owner=new NativePaperWorkState(),holder:{options?:ConstructorParameters<typeof NativePaperCashMaintenance>[0]}={};
 // Use the launcher's actual busy/refresh wiring: source-owned physical reads
 // permit independent cash commits, unlike candidate/held/pending operations.
 const launcher=runNativePaper.toString(),wiring=launcher.match(/cashMaintenance\s*=\s*new NativePaperCashMaintenance\(([\s\S]*?)\);\s*if\s*\(managementOnly/);
 assert.ok(wiring,'the production cash-maintenance wiring is present');
 const context={__name:(v:unknown)=>v,holder,stopped:false,managementOnly:false,manualPaused:false,safeStopRequested:false,workOwner:owner,currentBridge:f.bridge,currentLedger:f.ledger};
 Object.defineProperty(context,'price',{get:f.price});
 runInNewContext('holder.options=('+wiring[1]+');',context,{timeout:1000});
 const cash=new NativePaperCashMaintenance({...holder.options!,now:()=>f.at,monotonic:()=>f.at,cpu:()=>0});
 const mint=f.retained[0]!.proof.quote.mint as string;
 let pending:{started:ReturnType<typeof deferred>;release:ReturnType<typeof deferred>}|null=null,physical=0;
 f.route({call:async<T>(method:string,params:unknown[]=[])=>{
  physical++;
  try{const gate=pending;if(gate){pending=null;gate.started.resolve();await gate.release.promise;}return await f.wireRpc.call<T>(method,params);}
  finally{physical--;}
 },usage:()=>({...f.wireRpc.usage(),inFlight:physical,waitingOrOperating:physical>0}),cooldownUntil:()=>0});
 const beginRead=async(kind:'preparation'|'other'='preparation',maximumMs=1700)=>{
  assert.equal(pending,null);f.market.invalidateEntryPreparation(mint);
  const gate={started:deferred(),release:deferred()};pending=gate;
  const controller=new AbortController(),restore=owner.enter('source');
  const task=kind==='preparation'?f.market.prepareEntryCostTurn(mint,controller.signal,maximumMs):f.market.validateObservationPool(mint,controller.signal);
  const outcome=task.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  await gate.started.promise;
  assert.equal(owner.current,'source');assert.equal(f.market.retirementReady(),false);
  return {controller,outcome,release:gate.release.resolve,async finish(){gate.release.resolve();const result=await outcome;await turn();restore();return result;}};
 };
 f.at+=1000;cash.run();assert.ok(f.bridge.trader.technicalProtectionRecoveryStatus());
 return {f,owner,cash,mint,beginRead,setFinancialAdmission(value:boolean){financialAdmission=value;}};
}

for(const classified of [false,true])test(`repeated source-owned preparation ${classified?'preserves':'without a proven tag resets'} actual sixty-second recovery`,async t=>{
 const {f,cash,beginRead}=await fixture(t);
 if(!classified)t.mock.method(f.market,'readOnlyEntryPreparationActive',()=>false);
 const initial=f.ledger.state(),first=f.bridge.trader.technicalProtectionRecoveryStatus()!;
 let waits=0;
 for(let n=0;n<31&&!f.ledger.state().controls.entriesEnabled;n++){
  const before=f.bridge.trader.technicalProtectionRecoveryStatus(),read=await beginRead();
  f.at+=1000;const revision=f.ledger.state().revision;cash.run();
  assert.equal(f.ledger.state().revision,revision+1,'the counted callback performs a real cash reconciliation only');
  assert.equal(f.ledger.state().daily.reconciledAt,f.at);
  assert.equal(f.bridge.operatingReadinessDiagnostics().reasonCode,classified?WAIT:'OPERATING_READINESS_FINANCIAL_WORK_ACTIVE');
  assert.deepEqual(f.bridge.trader.technicalProtectionRecoveryStatus(),classified?before:null,'a read-only deferral neither advances nor clears earned original clocks');
  assert.equal(f.ledger.state().controls.entriesEnabled,false,'no permission or proof consumption while physical preparation is active');
  assert.equal((await read.finish()).ok,true);waits++;
  f.at+=1000;cash.run();
 }
 const final=f.ledger.state(),recoveries=f.records.filter(r=>r.kind==='native-paper-financial-readiness-recovered'&&r.data.technicalProtectionRecovery);
 assert.equal(final.controls.entriesEnabled,classified);
 assert.equal(recoveries.length,classified?1:0);
 if(classified){const p=recoveries[0]!.data.technicalProtectionRecovery;assert.equal(p.startedAt,first.startedAt);assert.equal(p.completedAt-p.startedAt,60000);assert.equal(p.completedEvaluations,31);assert.equal(p.maximumCompletedGapMs,2000);assert.equal(p.lastQuoteAt,p.completedAt);assert.deepEqual(p.positionUnits,{});}
 assert.equal(final.lamports,initial.lamports);assert.deepEqual(final.positions,initial.positions);assert.deepEqual(final.pending,initial.pending);assert.deepEqual(final.paperEpoch,initial.paperEpoch);assert.equal(final.executionCosts,initial.executionCosts);
 assert.equal(f.records.filter(r=>r.kind==='trader-held-evaluation').length,0,'cash reconciliation is not a fictitious held evaluation');
 assert.equal(cash.usage().busyDeferrals,0);assert.equal(cash.usage().deadlineMisses,0);
 t.diagnostic(JSON.stringify({scope:'OFFLINE real V3.1 adapter, actual launcher cash wiring and disposable epoch/ledger; synthetic clocks/provider waits',classified,waits,recoveries:recoveries.length,originalProgressStartedAt:first.startedAt,endedAt:f.at,providerRequests:0,ordersCreated:0}));
});

test('successive read-only waits cannot bridge a genuine greater-than-four-second completion gap',async t=>{
 const {f,cash,beginRead}=await fixture(t),original=f.bridge.trader.technicalProtectionRecoveryStatus();
 for(let n=0;n<3;n++){
  const read=await beginRead();f.at+=1500;cash.run();
  assert.equal(f.bridge.operatingReadinessDiagnostics().reasonCode,WAIT);
  assert.deepEqual(f.bridge.trader.technicalProtectionRecoveryStatus(),original);
  assert.equal((await read.finish()).ok,true);
 }
 f.at+=1000;cash.run();const next=f.bridge.trader.technicalProtectionRecoveryStatus()!;
 assert.equal(next.startedAt,f.at);assert.equal(next.completedEvaluations,1);assert.ok(next.startedAt-original!.completedAt>4000);
 assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

for(const fault of ['provider','source','source-clock','usd','reconciliation','evidence','financial'] as const)test(`read-only preparation does not hide a concurrent ${fault} failure`,async t=>{
 const {f,cash,beginRead,setFinancialAdmission}=await fixture(t),read=await beginRead();
 f.at+=1000;
 if(fault==='provider')setFinancialAdmission(false);
 if(fault==='source'||fault==='source-clock'){
  const original=f.flow.usage.bind(f.flow);t.mock.method(f.flow,'usage',()=>({...original(),...(fault==='source'?{connected:false}:{lastBankClockAt:f.at-31000,lastFreshSupportAt:f.at})}));
 }
 if(fault==='evidence'||fault==='financial'){
  const original=f.bridge.trader.entryReadinessSafety.bind(f.bridge.trader);
  t.mock.method(f.bridge.trader,'entryReadinessSafety',()=>({...original(),...(fault==='evidence'?{evidenceAvailable:false}:{financialAvailable:false})}));
 }
 if(fault==='usd')f.bridge.maintainOperatingFinancialReadiness({...f.price(),at:f.at-10001});
 else if(fault==='reconciliation'){f.at+=2001;f.bridge.maintainOperatingFinancialReadiness(f.price());}
 else if(fault==='financial')f.bridge.maintainOperatingFinancialReadiness(f.price());
 else cash.run();
 assert.notEqual(f.bridge.operatingReadinessDiagnostics().reasonCode,WAIT);
 assert.equal(f.bridge.trader.technicalProtectionRecoveryStatus(),null);
 assert.equal(f.ledger.state().controls.entriesEnabled,false);
 assert.equal((await read.finish()).ok,true);
});

test('an actual supported-account physical timeout still resets recovery while preparation is active',async t=>{
 let rpc:PilotRpc|undefined;
 const {f,cash,mint,owner}=await fixture(t,at=>!rpc||nativePaperFinancialProviderAvailable(at,false,true,rpc.usage()));
 const prior=join(f.dir,'OFFLINE-support-timeout-prior.json');
 writeFileSync(prior,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:f.at-120000,starts:[f.at-121000],pending:[]}));
 let starts=0,refusals=0;
 const events:Array<{kind:string;data:any}>=[];
 rpc=new PilotRpc({directory:join(f.dir,'OFFLINE-support-timeout-rpc'),runId:'offline-supported-account-timeout',baselinePaths:[prior],priorPhysicalSettled:true,...nativePaperRpcConfiguration(true),now:()=>f.at,monotonic:()=>f.at,sleep:async ms=>{f.at+=ms;},fetcher:(async(_url,init)=>{
  starts++;assert.equal(JSON.parse(String(init?.body)).method,'getMultipleAccounts');
  return new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>{f.at+=1200;reject(Error('OFFLINE actual supported-account physical deadline'));},{once:true});});
 })as typeof fetch,record:(kind,data:any)=>{
  events.push({kind,data:structuredClone(data)});
  if(kind==='pilot-rpc-unavailable'&&data.code==='COMPONENT_PHYSICAL_TIMEOUT'){
   refusals++;assert.equal(f.market.readOnlyEntryPreparationActive(),true,'the original caller has not yet unwound its bounded preparation');
   assert.equal(nativePaperFinancialProviderAvailable(f.at,false,true,rpc!.usage()),false);
   cash.run();assert.equal(f.bridge.operatingReadinessDiagnostics().reasonCode,'OPERATING_READINESS_CURRENT_ADMISSION_UNAVAILABLE');
   assert.equal(f.bridge.trader.technicalProtectionRecoveryStatus(),null,'real provider restriction wins over the tagged wait');
  }
 }});
 f.route({call:<T>(method:string,params:unknown[]=[],signal?:AbortSignal)=>rpc!.call<T>(method,params,signal,{timeoutMs:5,operationBoundMs:1500}),usage:()=>rpc!.usage(),cooldownUntil:()=>rpc!.cooldownUntil()});
 const restore=owner.enter('source');f.market.invalidateEntryPreparation(mint);
 try{
  await assert.rejects(f.market.prepareEntryCostTurn(mint,new AbortController().signal,1700),/COMPONENT_PHYSICAL_TIMEOUT/);
  await turn();await turn();assert.equal(starts,1);assert.equal(refusals,1);assert.equal(rpc.usage().inFlight,0);
  assert.equal(events.filter(row=>row.kind==='component-physical-start').length,1);assert.equal(events.filter(row=>row.kind==='component-physical-settled').length,1);
  assert.ok(rpc.usage().cooldownUntil>f.at);assert.ok(rpc.usage().uncertainResponseBytes>=2*1024*1024,'incomplete response uncertainty is retained after settlement');
  assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.deepEqual(f.ledger.state().pending,{});
 }finally{restore();rpc.close();}
});

for(const action of ['pause','stop'] as const)test(`a real owner ${action} during preparation remains a permission barrier`,async t=>{
 const {f,cash,beginRead}=await fixture(t),read=await beginRead();f.at+=1000;
 if(action==='pause')f.ledger.pause('offline-owner-pause',f.at,'operator paused new entries');else f.ledger.safeStop('offline-owner-stop',f.at);
 const control=f.ledger.state().controls;
 // A stop bypasses optional flat recovery, so also exercise the real
 // operating controller's explicit stop barrier before its next cash turn.
 f.bridge.maintainOperatingFinancialReadiness(f.price());
 assert.equal(f.bridge.trader.technicalProtectionRecoveryStatus(),null);
 cash.run();assert.notEqual(f.bridge.operatingReadinessDiagnostics().reasonCode,WAIT);
 assert.equal((await read.finish()).ok,true);f.at+=1000;cash.run();
 assert.deepEqual(f.ledger.state().controls,control);assert.equal(f.ledger.state().controls.entriesEnabled,false);
 assert.equal(f.records.filter(r=>r.kind==='native-paper-financial-readiness-recovered'&&r.data.technicalProtectionRecovery).length,0);
});

for(const cancellation of ['caller','timeout'] as const)test(`${cancellation} cancellation loses read-only classification before late physical settlement`,async t=>{
 const {f,cash,beginRead}=await fixture(t),read=await beginRead('preparation',cancellation==='timeout'?5:1700);
 assert.equal(f.market.readOnlyEntryPreparationActive(),true);
 if(cancellation==='caller')read.controller.abort();
 const result=await read.outcome;assert.equal(result.ok,false);
 assert.equal(f.market.retirementReady(),false,'caller completion does not prove physical completion');
 assert.equal(f.market.readOnlyEntryPreparationActive(),false);
 f.at+=1000;cash.run();assert.equal(f.bridge.operatingReadinessDiagnostics().reasonCode,'OPERATING_READINESS_FINANCIAL_WORK_ACTIVE');assert.equal(f.bridge.trader.technicalProtectionRecoveryStatus(),null);
 await read.finish();assert.equal(f.market.retirementReady(),true);assert.equal(f.market.readOnlyEntryPreparationActive(),false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

test('other physical market activity remains a resetting barrier',async t=>{
 const {f,cash,beginRead}=await fixture(t),read=await beginRead('other');
 assert.equal(f.market.readOnlyEntryPreparationActive(),false);f.at+=1000;cash.run();
 assert.equal(f.bridge.operatingReadinessDiagnostics().reasonCode,'OPERATING_READINESS_FINANCIAL_WORK_ACTIVE');assert.equal(f.bridge.trader.technicalProtectionRecoveryStatus(),null);
 assert.equal((await read.finish()).ok,true);assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

test('an actual active trader operation cannot inherit a read-only preparation deferral',async t=>{
 const {f,beginRead}=await fixture(t),read=await beginRead();
 f.at+=500;const active=f.bridge.trader.tick({evaluateCandidates:false});
 assert.equal(f.bridge.trader.entryReadinessSafety().idle,false);
 f.bridge.maintainOperatingFinancialReadiness(f.price());
 assert.equal(f.bridge.operatingReadinessDiagnostics().reasonCode,'OPERATING_READINESS_FINANCIAL_WORK_ACTIVE');
 assert.equal(f.bridge.trader.technicalProtectionRecoveryStatus(),null);
 await active;await read.finish();assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

for(const pending of [false,true])test(`held inventory ${pending?'with a real pending exit resets':'retains actual protection clocks across'} a candidate preparation wait`,async t=>{
 const f=await coordinatedNativeReplayFixture(t,true,false,{operatingFinancialReadiness:true,reusePreparedEntryRent:true});
 await f.open();assert.equal(f.bridge.maintainFlatFinancialReadiness(f.price()).recovered,true);
 await f.warm();await f.audit();f.bridge.maintainFlatFinancialReadiness(f.price());
 const [owned,mint]=f.retained.map(row=>row.proof.quote.mint as string);
 assert.equal((await f.bridge.candidate(owned!,true)).kind,'evaluated');
 const order=Object.values(f.ledger.state().pending).find(value=>value.mint===owned);assert.ok(order);
 f.at=Math.max(f.at+1500,order.executeAt);await f.bridge.protection();assert.ok(f.ledger.state().positions[owned!]);
 f.engine.syncFinancialOwnership();f.bridge.trader.pauseNewEntries('completed PAPER protection gap exceeded research boundary');
 for(let n=0;n<3;n++){f.at+=2000;await f.bridge.protection();}
 const progress=f.bridge.trader.technicalProtectionRecoveryStatus();assert.ok(progress);assert.equal(progress.heldPositions,1);
 const before=f.ledger.state(),started=deferred(),release=deferred();let block=true;
 f.route({call:async<T>(method:string,params:unknown[]=[])=>{if(block){block=false;started.resolve();await release.promise;}return f.wireRpc.call<T>(method,params);},usage:f.wireRpc.usage,cooldownUntil:()=>0});
 f.market.invalidateEntryPreparation(mint!);
 const preparation=f.market.prepareEntryCostTurn(mint!,new AbortController().signal,1700).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));await started.promise;
 assert.equal(f.market.readOnlyEntryPreparationActive(),true);f.at+=500;
 if(pending)f.ledger.order({id:'OFFLINE-pending-held-exit',side:'sell',mint:owned!,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE real pending obligation during read-only candidate work'},f.price(),f.bridge.valuation().marks);
 f.bridge.maintainOperatingFinancialReadiness(f.price());
 assert.equal(f.bridge.operatingReadinessDiagnostics().reasonCode,pending?'OPERATING_READINESS_FINANCIAL_WORK_ACTIVE':WAIT);
 assert.deepEqual(f.bridge.trader.technicalProtectionRecoveryStatus(),pending?null:progress);
 assert.equal(f.ledger.state().controls.entriesEnabled,false);
 release.resolve();assert.equal((await preparation).ok,true);
 assert.deepEqual(f.ledger.state().positions,before.positions);assert.equal(f.ledger.state().lamports,before.lamports);
 if(pending){assert.ok(f.ledger.state().pending['OFFLINE-pending-held-exit']);return;}
 f.at+=1500;const heldRecords=f.records.filter(row=>row.kind==='trader-held-evaluation').length;await f.bridge.protection();
 const after=f.bridge.trader.technicalProtectionRecoveryStatus()!;assert.equal(after.startedAt,progress.startedAt);assert.equal(after.completedEvaluations,progress.completedEvaluations+1);assert.equal(after.completedAt,f.at);assert.equal(after.maximumCompletedGapMs,2000);
 assert.equal(f.records.filter(row=>row.kind==='trader-held-evaluation').length,heldRecords+1);assert.deepEqual(f.ledger.state().positions,before.positions);
});

test('read-only preparation deferral has its own exact public readiness reason',()=>{
 const at=Date.parse('2026-11-04T00:21:55.552Z'),value=projectFinancialReadinessReporting({runId:'native-paper-20261104000900361',startedAt:Date.parse('2026-11-04T00:09:00.361Z'),generatedAt:at,financialReadiness:{operatingDecision:{at,reasonCode:WAIT}}},at);
 assert.equal(value?.operatingDecision.reasonCode,WAIT);
});
