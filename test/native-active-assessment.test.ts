/** OFFLINE real audit/runner integration. Retained canonical pool identity and
 * synthetic current trades, bank clocks and signature-history replies. No
 * network or financial account. Verifies active policy is not baseline-gated. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import bs58 from 'bs58';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {NativePaper} from '../src/native-paper.js';
import {projectOperatingIntelligence,validateOperatingIntelligence} from '../src/operating-intelligence.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {nativePaperObservationReporting} from '../src/run-native-paper.js';
import {PaperLedger} from '../src/ledger.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,assessLiquidityResilientBuyingV31} from '../src/liquidity-resilient-momentum-v3-1.js';
import {ADAPTIVE_PILOT_BINDING} from '../src/pilot-contract.js';
import type {PilotMarket} from '../src/pilot-market.js';
import {FlowWindow,type NormalizedTrade} from '../src/strategy.js';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';
import type {ResearchClockObservationSupport} from '../src/research-clock-pricing.js';
const signature=(n:number)=>{const b=Buffer.alloc(64);b.writeUInt32LE(n);return bs58.encode(b);};

async function auditFixture(active:boolean,financialTest?:TestContext,migrationAgeBeforeOpenMs=1000,v31?:'negative'|'missing'){
 const retained=readFileSync('evidence/integration-2026-10-26T19-57-35.882Z.ndjson','utf8').trim().split('\n').map(l=>JSON.parse(l));
 const original=structuredClone(retained.find(r=>r.kind==='migration-transaction').data);let at=Math.ceil(Date.parse('2026-10-29T10:00:00Z')/10000)*10000;const opened=at;original.blockTime=Math.floor((at-migrationAgeBeforeOpenMs)/1000);let bridge:NativePaper|undefined,ledger:PaperLedger|undefined,netLiquidation='700000000';const price=()=>({microUsdPerSol:'100000000',at,source:'OFFLINE synthetic USD100/SOL'});
 const preparationInvalidations:string[]=[],auditedTrades:NormalizedTrade[]=[];const states=new Map<string,{pool:string;window:FlowWindow|null;openedAt:number|null;floor:number;notes:NativeNotification[]}>(),records:Array<{kind:string;data:any}>=[];let runner:NativeCandidateRunner,slot=original.slot+100;
 const flow={addCandidate(scope:any){states.set(scope.mint,{pool:scope.pool,window:null,openedAt:null,floor:slot,notes:[]});},removeCandidate(mint:string){states.delete(mint);},snapshot(mint:string,when=at){const s=states.get(mint);if(!s)return null;const lower={slot:s.floor,availableAt:opened,bankClockAt:opened},upper={slot:slot+1,availableAt:when,bankClockAt:Math.floor(when/1000)*1000};return {dataContract:'confirmed-program-activity-v3-shadow',scope:{mint,pool:s.pool},openedAt:s.openedAt,connectionId:1,subscription:41,connected:true,sourceSupportFresh:true,hasQualityLoss:false,warm:s.window?.features(when).sufficientlyObserved===true,features:s.window?.features(when)??null,supportContext:upper,openingSupportContext:lower,supportContexts:[lower,upper]};},notificationLedger(mint:string){return structuredClone(states.get(mint)?.notes??[]);},requestSupportRefresh(){},requestHeartbeat(){},async service(){for(const [mint,s]of states)if(s.openedAt===null){const support:ResearchClockObservationSupport={mint,pool:s.pool,at,sourceSlot:s.floor,evidence:'OFFLINE synthetic current pool validation before ACK',summary:{} as ResearchClockObservationSupport['summary']};runner.onCurrentPoolValidated(support);bridge?.currentPoolValidated(support);s.openedAt=at;s.window=new FlowWindow(mint,at);runner.onFlowOpen({mint,at});bridge?.opened({mint,at});return {kind:'subscribe'};}return {kind:'idle'};},usage(){return {dataContract:'confirmed-program-activity-v3-shadow',candidates:states.size,retiring:0,nextServiceAt:[...states.values()].some(s=>s.openedAt===null)?at:at+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat',fatal:null,physicalTransportsSettled:false};},async stop(){states.clear();}};
 const rpc={async call<T>(method:string,params:unknown[]):Promise<T>{assert.equal(method,'getSignaturesForAddress');const s=[...states.values()].find(s=>s.pool===params[0])!;return [...s.notes].reverse().map(n=>({signature:n.signature,slot:n.slot,err:null,blockTime:Math.floor(n.receivedAt/1000),confirmationStatus:'confirmed'})).concat([{signature:signature(1),slot:s.floor-1,err:null,blockTime:Math.floor((opened-1)/1000),confirmationStatus:'confirmed'}])as T;},usage(){return {inFlight:0,waitingOrOperating:false,cumulativeUnits:0,dispatchWindow:{readyAt:at,physicalBusy:false}};},cooldownUntil(){return 0;}};
 if(financialTest){
  const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-active-native-'));ledger=new PaperLedger(join(dir,'fixture.sqlite'),'poe-pilot-offline-active-native');ledger.initialize(price(),at);financialTest.after(()=>{ledger!.close();rmSync(dir,{recursive:true,force:true});});
  const market={registerPool(){},unregisterPool(){},invalidateEntryPreparation(mint:string){preparationInvalidations.push(mint);},minimumSlot(){},async context(positions:any){return {price:price(),sourceValidUntil:at+30000,marks:Object.fromEntries(Object.values(positions).map((p:any)=>[p.mint,{netLamports:netLiquidation,pricedBaseUnits:p.units,at,evidence:'OFFLINE size-specific synthetic liquidation'}]))};},async prepareEntryCosts(){return {at,depositLamports:'0',evidence:'OFFLINE synthetic no additional rent'};},async quote(request:any){return {...request,outputUnits:request.side==='buy'?'1000000':netLiquidation,at,slot:slot+1,evidence:'OFFLINE current actual-size synthetic quote',effectiveQuoteLiquidityLamports:'100000000000',requiredDepositLamports:'0',depositEvidence:'OFFLINE synthetic deposit exact'};},async executionQuote(request:any){return {at,spendLamports:request.order.side==='buy'?request.order.maxSpend:'0',receiveUnits:request.order.side==='buy'?'1000000':netLiquidation,evidence:'OFFLINE delayed synthetic execution',slot:slot+1,requiredDepositLamports:'0',depositEvidence:'OFFLINE synthetic deposit exact',...(request.order.side==='sell'?{pricedBaseUnits:request.fullPositionBaseUnits}:{})};}}as unknown as PilotMarket;
  bridge=new NativePaper({ledger,market,binding:ADAPTIVE_PILOT_BINDING,source:flow as any,certificate:(mint,when)=>runner?.currentAuditCertificate(mint,when)??null,now:()=>at,admitNewRisk:()=>true,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),fixtureAccountBinding:{accountId:ledger.state().accountId,inceptionAt:ledger.state().inceptionAt}});
 }
 runner=new NativeCandidateRunner({flow:flow as any,rpc:rpc as any,now:()=>at,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),maximumDeep:4,...(bridge?{onCandidateAllocated:bridge.allocated,onCandidateRetired:bridge.retiredCandidate,financialOwnership:bridge.ownership}:{}),...(v31?{runId:'OFFLINE-v31-preliminary',activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,...(v31==='negative'?{activeEvidence:(mint:string,when:number)=>{const s=states.get(mint)!,features=s.window!.features(when);return {flow:{mint,pool:s.pool,windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditedAt:when,auditEvidence:'OFFLINE same independently verified audit',complete:true as const,trades:structuredClone(auditedTrades)}};},activeAssessment:(mint:string,features:ReturnType<FlowWindow['features']>,when:number)=>assessLiquidityResilientBuyingV31(features,when,{flow:{mint,pool:states.get(mint)!.pool,windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditedAt:when,auditEvidence:'OFFLINE same independently verified audit',complete:true,trades:structuredClone(auditedTrades)}})}:{})}:active?{activeStrategy:'adaptive-momentum-v2' as const}:{})});
 const sig=original.transaction.signatures[0];runner.importOrigin({originConfirmed:{signature:sig,availableAt:at,transaction:original},originFinalized:{signature:sig,availableAt:at,transaction:original}});if(migrationAgeBeforeOpenMs>=2*60*60000)runner.onActivity({mint:runner.watch.snapshot(at).rows.find(r=>r.mint!==null)!.mint!,at,evidence:'OFFLINE synthetic renewed broad-watch activity; not buying proof'});
 for(let n=0;n<5;n++)await runner.step();assert.equal(states.size,1);const [mint,s]=[...states][0]!;assert.ok(s.window);
 for(let n=0;n<6;n++){at=opened+n*10000+100;const trade:NormalizedTrade={identity:{kind:'program-log',signature:signature(100+n),program:PUMP_AMM_PROGRAM_ID.toBase58(),logIndex:1,frameOrdinal:0},mint,wallet:bs58.encode(Buffer.alloc(32,60+n%3)),side:v31==='negative'?'sell':'buy',quoteLamports:'100000000',tokenUnits:String(300000-n*10000),receivedAt:at,commitment:'confirmed',slot:++slot};assert.equal(s.window.ingest(trade),'accepted');auditedTrades.push(structuredClone(trade));s.notes.push({signature:trade.identity.signature,slot,receivedAt:at,availableAt:at,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null});runner.onTrade();bridge?.trade({trade,validatedAt:at,evidence:{}as any,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});}
 at=opened+60000;slot++;for(let n=0;n<8&&runner.status().counters.auditedWindows===0;n++)await runner.step();assert.equal(runner.status().counters.auditedWindows,1,JSON.stringify(records.filter(r=>r.kind==='native-candidate-window-audit')));
 return {runner,records,preparationInvalidations,mint,get at(){return at;},set at(value:number){at=value;slot++;},bridge,ledger,price,setNetLiquidation(value:string){netLiquidation=value;}};
}

test('a baseline-failed independently audited window survives for active V2 exact-size evaluation',async()=>{
 const f=await auditFixture(true),s=f.runner.status();assert.equal(s.counters.predictiveFailed,1);assert.equal(s.counters.predictiveNotRejected,0);assert.equal(s.counters.adaptivePredictiveAssessments,1);assert.equal(s.counters.adaptivePredictiveNotRejected,1);assert.ok(f.runner.currentAuditCertificate(f.mint,f.at));
 const base=f.records.find(r=>r.kind==='native-predictive-assessment')!,active=f.records.find(r=>r.kind==='native-active-strategy-assessment')!;assert.equal(base.data.assessment.status,'failed');assert.equal(active.data.assessment.status,'not-rejected');assert.equal(active.data.financialQualification,false);assert.equal(active.data.assessment.scoreBps,null);assert.ok(f.records.indexOf(base)<f.records.indexOf(active));assert.ok(!f.records.some(r=>r.kind==='native-candidate-retired'));
});

test('baseline rollback keeps its unchanged weak-window retirement and does not claim adaptive decisions',async()=>{
 const f=await auditFixture(false),s=f.runner.status();assert.equal(s.counters.predictiveFailed,1);assert.equal(f.runner.currentAuditCertificate(f.mint,f.at),null);assert.ok(f.records.some(r=>r.kind==='native-candidate-retired'));assert.ok(!f.records.some(r=>r.kind==='native-active-strategy-assessment'));assert.equal(s.counters.adaptivePredictiveAssessments,undefined);
});


test('active native V2 turns a baseline-rejected early audited window into a real PAPER reservation and preserves winner beyond old caps',async t=>{
 const f=await auditFixture(true,t),bridge=f.bridge!,ledger=f.ledger!;assert.equal(bridge.ready(f.mint),true);assert.equal(bridge.candidateDue(f.mint),true);assert.ok(bridge.qualificationProof(f.mint));
 assert.equal(bridge.maintainFlatFinancialReadiness(f.price()).recovered,true);await bridge.candidate(f.mint,true);
 const pending=Object.values(ledger.state().pending);assert.equal(pending.length,1,JSON.stringify(bridge.trader.decisions()));assert.equal(pending[0]!.entryStrategy?.version,'adaptive-momentum-v2-paper-v1');assert.equal(bridge.trader.funnel.qualified,1);assert.ok(bridge.trader.decisions().some(d=>d.stage==='qualified'&&d.ruleVersion==='adaptive-momentum-v2-paper-v1'));
 f.at=pending[0]!.executeAt;await bridge.protection();await bridge.protection();assert.ok(ledger.state().positions[f.mint]);assert.deepEqual(ledger.state().pending,{});assert.equal(ledger.state().positions[f.mint]!.strategy?.version,'adaptive-momentum-v2-paper-v1');
 f.at=ledger.state().positions[f.mint]!.enteredAt+16*60000;await bridge.protection();assert.ok(ledger.state().positions[f.mint],'a healthy positive holding is not forced out at30% or15minutes');assert.deepEqual(ledger.state().pending,{});assert.equal(ledger.state().positions[f.mint]!.strategy?.highWaterNetLamports,'700000000');
 f.setNetLiquidation('580000000');f.at+=1000;await bridge.protection();const sale=Object.values(ledger.state().pending).find(o=>o.side==='sell');assert.ok(sale,'a real net-liquidation drawdown triggers the adaptive trailing exit');f.at=sale.executeAt;await bridge.protection();assert.deepEqual(ledger.state().positions,{});assert.deepEqual(ledger.state().pending,{});assert.equal(ledger.state().executionCosts,'14000');
});

test('active native age eligibility also retains an older audited token beyond120minutes',async t=>{
 const f=await auditFixture(true,t,3*60*60000);assert.equal(f.bridge!.ready(f.mint),true);assert.equal(f.bridge!.candidateDue(f.mint),true);assert.ok(f.bridge!.qualificationProof(f.mint));assert.equal(f.bridge!.maintainFlatFinancialReadiness(f.price()).recovered,true);await f.bridge!.candidate(f.mint,true);assert.equal(Object.keys(f.ledger!.state().pending).length,1,JSON.stringify(f.bridge!.trader.decisions()));
});


test('active native reporting uses adaptive preliminary counts and preserves baseline benchmark separately',async()=>{
 const f=await auditFixture(true),report=nativePaperObservationReporting({engine:f.runner.status(),feeds:undefined,financialDecisions:[],eventLoopDelayP95Ms:null});
 assert.equal(report.independentPredictive!.notRejected,1);assert.equal(report.independentPredictive!.failed,0);assert.equal(report.baselinePredictive!.notRejected,0);assert.equal(report.baselinePredictive!.failed,1);assert.equal(report.watch!.summary.predictiveFailures,0);assert.ok(report.decisions.some(d=>d.stage==='adaptive-predictive-not-rejected'));assert.ok(!report.decisions.some(d=>d.stage==='shadow-predictive-failed'));assert.ok(report.baselineDecisions!.some(d=>d.stage==='shadow-predictive-failed'));assert.match(report.meaning,/ACTIVE Adaptive/);for(const text of [report.meaning,...report.additionalMeanings!])assert.ok(text.length<=512);
});


test('active native public intelligence retains honest limitations in the existing strict schema',async()=>{
 const f=await auditFixture(true),report=nativePaperObservationReporting({engine:f.runner.status(),feeds:undefined,financialDecisions:[],eventLoopDelayP95Ms:null});
 const publicProjection=projectOperatingIntelligence({accountId:POE_OPERATING_ACCOUNT.accountId,inceptionAt:POE_OPERATING_ACCOUNT.inceptionAt,generatedAt:f.at,startedAt:f.at-60000,runId:'OFFLINE-active-native-report',configurationSha256:'a'.repeat(64),strategyVersion:ADAPTIVE_PILOT_BINDING.version,positions:{},pending:{},watch:report.watch?.summary,independentPredictive:{...report.independentPredictive,passed:report.independentPredictive?.notRejected,uniqueTokens:report.independentPredictive?.uniqueEvaluated},observationReportingMeaning:[report.meaning,...report.additionalMeanings!]});
 assert.deepEqual(validateOperatingIntelligence(publicProjection,new Date(f.at).toISOString()),publicProjection);assert.equal(publicProjection.candidates.predictivePasses,1);assert.equal(publicProjection.candidates.predictiveFailures,0);assert.equal(publicProjection.quality.limitations.length,3);assert.ok(publicProjection.quality.limitations.some(l=>l.includes('unknown')));assert.ok(publicProjection.quality.limitations.some(l=>l.includes('$50/$150')));
});

test('active adaptive score cannot clear an owner stop or a genuine daily-loss latch',async t=>{
 for(const control of ['owner-stop','daily-loss']as const)await t.test(control,async st=>{const f=await auditFixture(true,st);if(control==='owner-stop')f.ledger!.safeStop('OFFLINE explicit owner stop',f.at);else{f.ledger!.reconcile('OFFLINE preceding complete daily-equity reference',f.at,f.price(),{});f.ledger!.reconcile('OFFLINE daily-loss shock',f.at,{...f.price(),microUsdPerSol:'90000000'},{});}const state=f.ledger!.state();assert.equal((await f.bridge!.candidate(f.mint,true)).kind,'entry-permission-refused');assert.deepEqual(f.ledger!.state(),state);assert.deepEqual(state.pending,{});assert.equal(state.executionCosts,'0');});
});

test('active native entry still fails closed after genuine source evidence is lost',async t=>{
 const f=await auditFixture(true,t);f.runner.onGap({mint:f.mint,at:f.at,reason:'OFFLINE genuinely missing required executed packet'});assert.ok(f.preparationInvalidations.includes(f.mint),'source gap revokes discretionary preparation reuse');assert.equal(f.runner.currentAuditCertificate(f.mint,f.at),null);assert.equal(f.bridge!.ready(f.mint),false);assert.equal(f.bridge!.candidateDue(f.mint),false);assert.equal(f.bridge!.qualificationProof(f.mint),null);assert.equal((await f.bridge!.candidate(f.mint,true)).kind,'unavailable');assert.deepEqual(f.ledger!.state().pending,{});assert.equal(f.ledger!.state().executionCosts,'0');
});

test('existing report retires fixed-dollar fallback only from actual activated financial policy facts',async t=>{
 const f=await auditFixture(true,t);const projection=f.ledger!.projection(f.at,f.price());
 const input={engine:f.runner.status(),feeds:undefined,financialDecisions:[],eventLoopDelayP95Ms:null};
 const legacy=nativePaperObservationReporting(input);assert.ok(legacy.additionalMeanings!.some(s=>s.startsWith('Current $50/$150')));
 const current=nativePaperObservationReporting({...input,equityRisk:projection.equityRisk});assert.ok(current.additionalMeanings!.some(s=>s.includes('Activated PAPER risk:5%')&&s.includes('EQUITY_RISK_INITIALIZING')));assert.ok(!current.additionalMeanings!.some(s=>s.startsWith('Current $50/$150')));for(const line of current.additionalMeanings!)assert.ok(line.length<=512);
 f.ledger!.reconcile('OFFLINE full current policy observation',f.at,f.price(),{});const ready=nativePaperObservationReporting({...input,equityRisk:f.ledger!.projection(f.at,f.price()).equityRisk});assert.ok(ready.additionalMeanings!.some(s=>s.includes('Risk facts:ready')));
});


test('V3.1 preliminary rejected evidence is retained without confusing it with executable qualification',async()=>{
 const f=await auditFixture(true,undefined,1000,'negative'),event=f.records.find(r=>r.kind==='native-opportunity-evaluation')!.data;
 assert.equal(f.runner.status().activeStrategyVersion,LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION);assert.equal(event.version,'poe-opportunity-evaluation-v1');assert.equal(event.stage,'preliminary');assert.equal(event.runId,'OFFLINE-v31-preliminary');assert.equal(event.strategyVersion,LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION);assert.equal(event.decision.kind,'strategy-rejection');assert.equal(event.technicalFailure,false);assert.equal(event.auditedFlow.trades.length,6);assert.equal(event.baselineMarket,null);assert.equal(event.selectedMarket,null);assert.equal(event.financialQualification,false);assert.equal(event.fillClaimed,false);
});

test('V3.1 missing audited adapter evidence remains technical unavailability in preliminary outcome records',async()=>{
 const f=await auditFixture(true,undefined,1000,'missing'),event=f.records.find(r=>r.kind==='native-opportunity-evaluation')!.data;
 assert.equal(event.decision.kind,'missing-data');assert.equal(event.technicalFailure,true);assert.equal(event.auditedFlow,null);assert.equal(event.decision.qualified,false);assert.equal(event.providerRequests,0);assert.equal(event.fillClaimed,false);assert.equal(f.runner.status().counters.auditUnavailable,0,'the actual audit completed; missing analysis evidence is a separate unavailable condition');
});
