/** Predictive-only diagnostics; all fixture accounts/state are isolated. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlowWindow,assessPredictiveBuying,evaluatePrimary,type FlowFeatures,type RuleContext,type NormalizedTrade} from '../src/strategy.js';
import {PaperTrader,type TraderOptions} from '../src/trader.js';
import {PaperLedger} from '../src/ledger.js';
import {PILOT_CONTRACT_SHA256,PILOT_VERSION} from '../src/pilot-contract.js';
const T=Date.parse('2026-10-27T12:00:00Z'),MINT='fixture-predictive-token';
function event(i:number,kind='strong'):NormalizedTrade{
 const quote=kind==='net'?'100000000':kind==='concentration'?(i===0?'900000000':'100000000'):'300000000';
 return {identity:{signature:'fixture-'+kind+'-'+i,instructionIndex:0,eventIndex:0},mint:MINT,wallet:'fixture-buyer-'+i,side:'buy',quoteLamports:quote,tokenUnits:kind==='price'?String(300000+i*10000):kind==='concentration'?String(BigInt(quote)/1000n):String(300000-i*10000),receivedAt:T+(kind==='persistence'?Math.floor(i/3):i)*10000+100,commitment:'confirmed',slot:100+i};
}
function features(kind='strong'):FlowFeatures{const window=new FlowWindow(MINT,T);if(kind!=='empty')for(let i=0;i<(kind==='buyers'?4:6);i++)window.ingest(event(i,kind));return window.features(T+60000);}
const context=(overrides:Partial<RuleContext>={}):RuleContext=>({mint:MINT,now:T+60000,migrationAt:T-300000,migrationVerified:true,supportedPool:true,flowFieldsVerified:true,flowVerificationEvidence:'SYNTHETIC verified fields',riskEntriesAllowed:true,alreadyTradedMint:false,quote:{mint:MINT,at:T+60000,evidence:'SYNTHETIC validated quote',allInInitialCostMicroUsd:'50000000',sizeToEffectiveLiquidityBps:100,expectedBaseUnits:'1000'},...overrides});

test('shared predictive assessment retains all frozen buying predicates and never qualifies',()=>{
 const strong=assessPredictiveBuying(features(),T+60000);assert.equal(strong.status,'not-rejected');assert.equal(strong.qualified,false);assert.match(strong.reason,/risk-and-execution-not-assessed/);
 for(const kind of ['net','persistence','buyers','concentration','price','empty']){const assessment=assessPredictiveBuying(features(kind),T+60000);assert.equal(assessment.status,'failed',kind);assert.equal(assessment.reason,'persistent-broad-buying-rule-not-met');assert.equal(assessment.qualified,false);assert.equal(evaluatePrimary(features(kind),context()).reason,assessment.reason);}
 const original=features(),copy=assessPredictiveBuying(original,T+60000);assert.notEqual(copy.features,original);copy.features!.firstPrice!.quoteLamports='1';assert.notEqual(original.firstPrice!.quoteLamports,'1');
});

test('malformed, future/asOf-mismatched, warming and gap features remain unavailable',()=>{
 const valid=features();for(const bad of [{...valid,asOf:T+60001},{...valid,netBuyLamports:'999'},{...valid,sufficientlyObserved:true,qualityReason:'gap'}])assert.equal(assessPredictiveBuying(bad,T+60000).status,'unavailable');
 const window=new FlowWindow(MINT,T);assert.equal(assessPredictiveBuying(window.features(T+30000),T+30000).status,'unavailable');window.invalidate(T+30001,'feed-gap');assert.equal(assessPredictiveBuying(window.features(T+90000),T+90000).status,'unavailable');
});

test('primary financial, eligibility and execution ordering is unchanged by shared predicate reuse',()=>{
 const weak=features('empty');for(const [change,kind,reason]of [
  [{flowFieldsVerified:false},'missing-data','trade-feed-fields-not-verified'],
  [{riskEntriesAllowed:false},'risk-rejection','entries-not-authorized-by-ledger'],
  [{alreadyTradedMint:true},'risk-rejection','reentry-disabled'],
  [{quote:null},'missing-data','fresh-size-specific-quote-unavailable'],
  [{quote:{...context().quote!,mint:'different'}},'missing-data','candidate-quote-identity-mismatch'],
  [{quote:{...context().quote!,allInInitialCostMicroUsd:'50000001'}},'risk-rejection','initial-cost-including-execution-exceeds-limit'],
  [{quote:{...context().quote!,sizeToEffectiveLiquidityBps:501}},'market-exclusion','order-size-exceeds-execution-liquidity-bound'],
 ]as const){const d=evaluatePrimary(weak,context(change));assert.equal(d.kind,kind);assert.equal(d.reason,reason);assert.equal(d.qualified,false);}
 assert.equal(evaluatePrimary(features(),context()).qualified,true,'the actual primary still separately qualifies valid risk/quote evidence');
});

function fixture(t:TestContext,options:{ready?:boolean;diagnostics?:boolean;missingReadiness?:boolean;candidateOnly?:boolean}={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-ISOLATED-predictive-')),ledger=new PaperLedger(join(directory,'fixture.sqlite'),'poe-pilot-predictive-diagnostic-fixture');let now=T,ready=options.ready??true;const records:Array<{kind:string;data:any}>=[],quotes:unknown[]=[];
 const price=()=>({microUsdPerSol:'100000000',at:now,source:'ISOLATED synthetic USD'});ledger.initialize(price(),now);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const calls={context:0,executionContext:0,executionQuote:0};
 const config:TraderOptions={ledger,now:()=>now,...(options.candidateOnly?{candidateEvaluationOnly:true}:{}),context:async()=>{calls.context++;return {price:price(),marks:{}};},quote:async request=>{quotes.push(request);return null;},costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'ISOLATED diagnostic costs'},flowVerification:{verified:true,evidence:'ISOLATED verified fields'},recorder:{record:(kind,data)=>records.push({kind,data})},experimentalPilot:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},pilotExecution:{context:async()=>{calls.executionContext++;return {price:price(),marks:{}};},quote:async()=>{calls.executionQuote++;return null;}},...(options.diagnostics===false?{}:{predictiveDiagnostics:true}),...(options.missingReadiness?{}:{candidateReadiness:()=>ready})};
 const trader=new PaperTrader(config);trader.start();trader.admit({mint:MINT,migrationAt:T-300000,migrationVerified:true,supportedPool:true,evidence:'ISOLATED verified identity'});trader.activateFlow(MINT,'ISOLATED subscription start');
 return {ledger,trader,records,quotes,config,calls,set now(at:number){now=at;},set ready(value:boolean){ready=value;},warm(kind='empty'){if(kind!=='empty')for(let i=0;i<6;i++){const trade=event(i,kind);now=trade.receivedAt;trader.ingest(trade,'curve');}now=T+60000;},assessments:()=>records.filter(r=>r.kind==='trader-predictive-assessment').map(r=>r.data),decisions:()=>records.filter(r=>r.kind==='trader-decision').map(r=>r.data)};
}

test('paused audited weak candidate emits failed predictive diagnostic alongside unchanged risk rejection',async t=>{
 const f=fixture(t);f.warm();const before=f.ledger.state();await f.trader.tick();assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().inceptionAt,before.inceptionAt);assert.equal(f.quotes.length,0);
 const assessment=f.assessments()[0];assert.equal(f.assessments().length,1);assert.equal(assessment.status,'failed');assert.equal(assessment.windowEndAt,T+60000);assert.equal(assessment.features.asOf,assessment.at);assert.deepEqual(assessment.riskDecision,{kind:'risk-rejection',reason:'entries-not-authorized-by-ledger'});assert.equal(f.decisions().at(-1)!.stage,'risk-rejection');assert.equal(f.decisions().at(-1)!.reason,'entries-not-authorized-by-ledger');assert.match(assessment.meaning,/no eligibility, quote, risk or entry permission/);
 await f.trader.tick();assert.equal(f.assessments().length,1,'only one assessment per closed bucket');
});

test('strong predictive diagnostic does not qualify or enable a financially paused entry',async t=>{
 const f=fixture(t);f.warm('strong');await f.trader.tick();assert.equal(f.assessments()[0]!.status,'not-rejected');assert.equal(f.decisions().at(-1)!.stage,'risk-rejection');assert.equal(f.trader.funnel.qualified,0);assert.equal(f.trader.funnel.reserved,0);assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.quotes.length,0);
});

test('warming, interrupted, information-pending, unaudited and non-opted-in states emit no assessment',async t=>{
 for(const state of ['warming','gap','pending','unaudited','readiness-absent','diagnostic-disabled']){const f=fixture(t,{ready:state!=='unaudited',missingReadiness:state==='readiness-absent',diagnostics:state!=='diagnostic-disabled'});if(state==='warming')f.now=T+30000;else f.warm();if(state==='gap')f.trader.candidateGap(MINT);if(state==='pending')f.trader.setCandidateInformationPending(MINT,true);await f.trader.tick();assert.equal(f.assessments().length,0,state);assert.deepEqual(f.ledger.state().pending,{});}
 const f=fixture(t);assert.throws(()=>new PaperTrader({...f.config,experimentalPilot:undefined,pilotExecution:undefined}),/diagnostics require the isolated pilot/);assert.throws(()=>new PaperTrader({...f.config,flowVerification:{verified:false,evidence:'not verified'}}),/verified flow fields/);
});


test('candidate-only run evaluates a strong audited window with no financial, quote or context work',async t=>{
 const f=fixture(t,{candidateOnly:true});f.warm('strong');const before=f.ledger.state();
 // Mutation of caller configuration cannot change the frozen process mode.
 delete f.config.candidateEvaluationOnly;
 const result=await f.trader.tick();assert.deepEqual(result,{execution:[],nextDueAt:null});
 assert.equal(f.assessments()[0]?.status,'not-rejected');assert.equal(f.decisions().at(-1)?.reason,'financial-execution-intentionally-disabled');assert.equal(f.decisions().at(-1)?.stage,'candidate-observation');assert.equal(f.decisions().at(-1)?.permissionContext.performanceFailure,false);assert.equal(f.assessments()[0]?.riskDecision.reason,'entries-not-authorized-by-ledger');
 assert.deepEqual(f.calls,{context:0,executionContext:0,executionQuote:0});assert.equal(f.quotes.length,0);
 assert.deepEqual(f.ledger.state(),before);assert.equal(f.trader.funnel.qualified,0);assert.equal(f.trader.funnel.reserved,0);
 assert.equal(f.trader.nextDueAt(),null);await f.trader.tick({evaluateCandidates:false});assert.deepEqual(f.ledger.state(),before);
});

test('candidate-only incomplete or unaudited windows never become predictive passes',async t=>{
 for(const kind of ['warming','unaudited','gap','pending']){
  const f=fixture(t,{candidateOnly:true,ready:kind!=='unaudited'});if(kind==='warming')f.now=T+30000;else f.warm('strong');
  if(kind==='gap')f.trader.candidateGap(MINT);if(kind==='pending')f.trader.setCandidateInformationPending(MINT,true);
  const before=f.ledger.state();await f.trader.tick();assert.equal(f.assessments().length,0,kind);assert.deepEqual(f.ledger.state(),before);assert.equal(f.quotes.length,0);
 }
});

test('candidate-only startup refuses exposure and pending obligations without taking financial ownership',t=>{
 const f=fixture(t,{candidateOnly:true});
 for(const key of ['positions','pending']){
  const facade=Object.create(f.ledger) as PaperLedger;facade.state=()=>({...f.ledger.state(),[key]:{existing:{}}} as any);
  const trader=new PaperTrader({...f.config,ledger:facade});assert.throws(()=>trader.start(),/candidate-only mode requires closed financial permission and no unresolved exposure/);
 }
 assert.throws(()=>new PaperTrader({...f.config,predictiveDiagnostics:undefined}),/candidate-only mode requires isolated predictive diagnostics/);
});

test('unexpected enabled ledger permissions fail closed before candidate-only evaluation',async t=>{
 const f=fixture(t,{candidateOnly:true});f.warm('strong');const price={microUsdPerSol:'100000000',at:T+60000,source:'ISOLATED changed permission'};
 f.ledger.reconcile('fixture-reconcile',T+60000,price,{});f.ledger.resume('fixture-unexpected-resume',T+60000,price,{}, {version:PILOT_VERSION,evidence:'ISOLATED unexpected permission',marketAt:T+60000,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 const before=f.ledger.state();await assert.rejects(f.trader.tick(),/candidate-only mode requires closed financial permission/);assert.deepEqual(f.ledger.state(),before);assert.equal(f.assessments().length,0);assert.equal(f.quotes.length,0);assert.deepEqual(f.calls,{context:0,executionContext:0,executionQuote:0});
});


test('candidate-only recorder loss prevents a predictive pass and never writes financial pause actions',async t=>{
 const f=fixture(t,{candidateOnly:true});f.warm('strong');const before=f.ledger.state(),original=f.config.recorder.record;let failed=false;
 f.config.recorder.record=(kind,data)=>{if(!failed&&kind==='trader-decision'){failed=true;throw Error('ISOLATED recording interruption');}original(kind,data);};
 await assert.rejects(f.trader.tick(),/selected evidence unavailable/);assert.equal(f.assessments().length,0);assert.deepEqual(f.ledger.state(),before);
 f.now=T+70000;await assert.rejects(f.trader.tick(),/selected evidence unavailable/);assert.equal(f.assessments().length,0);assert.deepEqual(f.calls,{context:0,executionContext:0,executionQuote:0});
 f.trader.pauseNewEntries('ISOLATED mode pause');assert.deepEqual(f.ledger.state(),before);
});
