import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectFinancialPolicyReporting,validateFinancialPolicyReporting,FINANCIAL_POLICY_REPORTING_VERSION} from '../src/financial-policy-reporting.js';
const T=Date.parse('2026-10-30T03:50:00.000Z');
function risk(){return {version:'paper-equity-risk-5-10-v1',state:'ready',reasonCode:null,asOf:T,entry:{targetBps:500,targetConsumedCostMicroUsd:'47500000',targetConsumedCostLamports:'475000000',unreservedCashLamports:'8000000000',cashLimitedConsumedCostLamports:'475000000',refundableDepositsIncluded:false,executabilityClaimed:false},daily:{day:'2026-10-30',limitBps:1000,highWaterMicroUsd:'1000000000',highWaterAt:T-10000,currentEquityMicroUsd:'950000000',drawdownMicroUsd:'50000000',drawdownBps:500,remainingBeforePauseMicroUsd:'50000000',lossPaused:false,historyCoverage:'verified-retained-same-day',basis:'complete-observed-executable-equity-current-usd'}};}
const source=()=>({financial:{equityRisk:risk()},usage:{market:{}},entriesEnabled:false,status:'owner safe stop'});
test('source-owned percentage sizing and daily USD high-water facts survive without altering controls or claiming executability',()=>{
 const raw=source(),before=structuredClone(raw),p=projectFinancialPolicyReporting(raw,T)!;
 assert.equal(p.version,FINANCIAL_POLICY_REPORTING_VERSION);assert.equal(p.risk!.entry.targetConsumedCostSol,'0.475000000');assert.equal(p.risk!.entry.unreservedCashSol,'8.000000000');assert.equal(p.risk!.entry.refundableDepositsIncluded,false);assert.equal(p.risk!.entry.executabilityClaimed,false);
 assert.equal(p.risk!.daily.highWaterAt,new Date(T-10000).toISOString());assert.equal(p.risk!.daily.drawdownBps,500);assert.equal(p.risk!.daily.basis,'complete-observed-executable-equity-current-usd');assert.deepEqual(raw,before);validateFinancialPolicyReporting(p,T);
});
test('old sources expose no invented percentage policy, peak history, or execution scenarios',()=>{
 for(const s of [{},{financial:{}},{financial:{daily:{baselineMicroUsd:'1000000000',lossPaused:false}}}])assert.equal(projectFinancialPolicyReporting(s,T),undefined);
 const p=projectFinancialPolicyReporting({financial:{equityRisk:{version:'future-or-private'}}},T)!;assert.equal(p.risk,null);assert.equal(p.execution,null);validateFinancialPolicyReporting(p,T);
});
test('a current daily latch is reported without clearing it or manufacturing entry permission',()=>{
 const raw=source();raw.financial.equityRisk.daily.lossPaused=true;raw.financial.equityRisk.reasonCode='EQUITY_RISK_DAILY_DRAWDOWN' as any;
 const p=projectFinancialPolicyReporting(raw,T)!;assert.equal(p.risk!.state,'ready');assert.equal(p.risk!.daily.lossPaused,true);assert.equal(raw.entriesEnabled,false);validateFinancialPolicyReporting(p,T);
});
test('unavailable current valuation may retain a genuinely known same-day peak, with current allowance unknown',()=>{
 const r=risk();r.state='unavailable';r.reasonCode='EQUITY_RISK_VALUATION_UNAVAILABLE' as any;for(const k of ['targetConsumedCostMicroUsd','targetConsumedCostLamports','cashLimitedConsumedCostLamports'])(r.entry as any)[k]=null;for(const k of ['currentEquityMicroUsd','drawdownMicroUsd','drawdownBps','remainingBeforePauseMicroUsd'])(r.daily as any)[k]=null;
 const p=projectFinancialPolicyReporting({financial:{equityRisk:r}},T)!;assert.equal(p.risk!.entry.targetConsumedCostSol,null);assert.equal(p.risk!.daily.highWaterMicroUsd,'1000000000');assert.equal(p.risk!.daily.drawdownBps,null);validateFinancialPolicyReporting(p,T);
});
test('first complete observation and a genuine zero-equity day remain distinct from reconstructed history',()=>{
 const r=risk();r.daily.historyCoverage='first-complete-observation';for(const k of ['highWaterMicroUsd','currentEquityMicroUsd','drawdownMicroUsd','remainingBeforePauseMicroUsd'])(r.daily as any)[k]='0';r.daily.drawdownBps=0;r.entry.targetConsumedCostMicroUsd='0';r.entry.targetConsumedCostLamports='0';r.entry.cashLimitedConsumedCostLamports='0';
 const p=projectFinancialPolicyReporting({financial:{equityRisk:r}},T)!;assert.equal(p.risk!.daily.historyCoverage,'first-complete-observation');assert.equal(p.risk!.daily.highWaterMicroUsd,'0');validateFinancialPolicyReporting(p,T);
});
test('malformed private financial-policy data stays unknown without exposing arbitrary source fields',()=>{
 const changes:Array<(r:ReturnType<typeof risk>)=>void>=[r=>r.version='private://DO_NOT_EXPORT',r=>r.reasonCode='https://key/DO_NOT_EXPORT' as any,r=>r.asOf=T+1,r=>r.entry.targetBps=501,r=>r.entry.targetConsumedCostLamports='-1',r=>r.entry.targetConsumedCostMicroUsd='1e8',r=>r.entry.unreservedCashLamports=(1n<<127n).toString(),r=>(r.entry as any).executabilityClaimed=true,r=>r.daily.highWaterAt=T+1,r=>r.daily.highWaterAt=T-24*3600000,r=>r.daily.day='2026-10-31',r=>r.daily.drawdownBps=10001,r=>(r.daily as any).basis='displayed-chart-price'];
 for(const change of changes){const r=risk();change(r);const p=projectFinancialPolicyReporting({financial:{equityRisk:{...r,privateError:'DO_NOT_EXPORT'}}},T)!;assert.equal(p.risk,null);assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT/);validateFinancialPolicyReporting(p,T);}
 const r={...risk(),privateError:'DO_NOT_EXPORT',rawLedger:{credentials:'DO_NOT_EXPORT'}};const p=projectFinancialPolicyReporting({financial:{equityRisk:r}},T)!;assert.ok(p.risk);assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|rawLedger|credentials/);
});
test('the receiver rejects malformed or unknown public fields and versions while accepting absent optional policy',()=>{
 const good=projectFinancialPolicyReporting(source(),T)!;
 const mutations:Array<(p:any)=>void>=[p=>p.version='unknown',p=>p.secret='private',p=>p.risk.extra='private',p=>p.risk.entry.executabilityClaimed=true,p=>p.risk.entry.targetBps=10000,p=>p.risk.entry.targetConsumedCostSol='0.5',p=>p.risk.daily.limitBps=999,p=>p.risk.daily.highWaterMicroUsd='01',p=>p.risk.daily.drawdownBps=-1,p=>p.risk.daily.highWaterAt=new Date(T+1).toISOString(),p=>p.risk.daily.historyCoverage='backfilled',p=>p.risk.state='ready-but-entries-enabled'];
 for(const mutate of mutations){const p=structuredClone(good);mutate(p);assert.throws(()=>validateFinancialPolicyReporting(p,T),/FINANCIAL_POLICY_REPORTING/);}
});

test('typed financial facts survive a full ten-note original source view and remain optional under the strict intelligence validator',async()=>{
 const {projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION}=await import('../src/operating-intelligence.js');
 const raw={...source(),accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:T,startedAt:T-10000,runId:'reporting-only-fixture',strategyVersion:'adaptive-momentum-v2-paper-v1',configurationSha256:'a'.repeat(64),positions:{},pending:{},observationReportingMeaning:Array(10).fill('Bounded existing source note'),funnel:{},watch:{},sourceTimes:{},refusals:{},timing:{},usage:{market:{}}};
 const p=projectOperatingIntelligence(raw);assert.equal(p.quality.limitations.length,10);assert.equal(p.financialPolicy!.risk!.entry.targetBps,500);assert.equal(p.financialPolicy!.risk!.daily.limitBps,1000);assert.deepEqual(p.decisions,[]);assert.deepEqual(p.pendingOrders,[]);validateOperatingIntelligence(p,new Date(T).toISOString());
 const legacy=structuredClone(p);delete legacy.financialPolicy;validateOperatingIntelligence(legacy,new Date(T).toISOString());
 const malformed=structuredClone(p);(malformed.financialPolicy as any).entryPermission=true;assert.throws(()=>validateOperatingIntelligence(malformed,new Date(T).toISOString()),/FINANCIAL_POLICY_REPORTING/);
});
function execution(){return {version:'paper-chain-conditioned-v1',state:'active',scope:'current-market-instance',plans:2,supportedLandingStates:1,preflightUnsubmitted:1,unknownLanding:1,last:{at:T-100,stage:'landing-state-supported',reasonCode:'LANDING_STATE_SUPPORTED',observedRpcMs:325,modeledDelayMs:1375,feeLamports:'7000',sourceSlot:400000001}};}
function valuation(){return {lastObservation:{source:'coinbase-public-sol-usd',startedAt:T-1400,completedAt:T-1000,durationMs:398.6,outcome:'unavailable',reasonCode:'USD_PRICE_TIMEOUT',httpStatus:null,receivedAt:null,publicationTimeKnown:false},failuresByReason:{USD_PRICE_TIMEOUT:2}};}
test('execution preparations keep observed RPC latency separate from scenario delay and fees, without claiming a financial fill or chain landing',()=>{
 const raw={usage:{market:{executionModel:{...execution(),privateInstruction:'DO_NOT_EXPORT',signedTransaction:'DO_NOT_EXPORT'}}}},p=projectFinancialPolicyReporting(raw,T)!;
 assert.equal(p.execution!.scope,'current-market-instance');assert.equal(p.execution!.last!.observedRpcMs,325);assert.equal(p.execution!.last!.modeledDelayMs,1375);assert.equal(p.execution!.last!.feeSol,'0.000007000');assert.equal(p.execution!.supportedLandingStates,1);assert.equal(p.execution!.meaning,'PAPER_PREPARATION_NOT_OBSERVED_CHAIN_OUTCOME');assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|signedTransaction|privateInstruction/);validateFinancialPolicyReporting(p,T);
});
test('preflight-unsubmitted preparation and empty current instance remain genuine zero counters rather than observed transactions',()=>{
 const e=execution();e.last.stage='preflight-unsubmitted';e.last.reasonCode='LANDING_STATE_UNAVAILABLE';e.last.feeLamports='0';
 let p=projectFinancialPolicyReporting({usage:{market:{executionModel:e}}},T)!;assert.equal(p.execution!.last!.feeSol,'0.000000000');validateFinancialPolicyReporting(p,T);
 p=projectFinancialPolicyReporting({usage:{market:{executionModel:{...e,plans:0,supportedLandingStates:0,preflightUnsubmitted:0,unknownLanding:0,last:null}}}},T)!;assert.equal(p.execution!.plans,0);assert.equal(p.execution!.last,null);validateFinancialPolicyReporting(p,T);
});
test('malformed execution stages, scope, timestamps, counters and fee amounts never become public model facts',()=>{
 const changes:Array<(e:any)=>void>=[e=>e.version='private',e=>e.scope='durable-all-time',e=>e.state='funded',e=>e.plans=-1,e=>e.last.stage='confirmed-mainnet-fill',e=>e.last.reasonCode='https://DO_NOT_EXPORT',e=>e.last.at=T+1,e=>e.last.feeLamports='-1',e=>e.last.sourceSlot=Infinity,e=>e.last.observedRpcMs=NaN,e=>e.last.modeledDelayMs=-1,e=>e.last.stage='planned'];
 for(const change of changes){const e=execution();change(e);const p=projectFinancialPolicyReporting({usage:{market:{executionModel:e}}},T)!;assert.equal(p.execution,null);assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT/);validateFinancialPolicyReporting(p,T);}
 const p=projectFinancialPolicyReporting({usage:{market:{executionModel:execution()}}},T)!;for(const mutate of [(e:any)=>e.actualChainFee=true,(e:any)=>e.last.reasonCode='UNKNOWN',(e:any)=>e.last.feeSol='7000',(e:any)=>e.last.at=new Date(T+1).toISOString()]){const bad=structuredClone(p);mutate(bad.execution);assert.throws(()=>validateFinancialPolicyReporting(bad,T),/FINANCIAL_POLICY_REPORTING/);}
});
test('fixed USD outcome reasons identify a future source conversion failure without inventing its publication time or an earlier failure cause',()=>{
 const u=valuation(),raw={usage:{usd:{...u,endpoint:'https://DO_NOT_EXPORT',failuresByReason:{...u.failuresByReason,'https://DO_NOT_EXPORT':7}}}},p=projectFinancialPolicyReporting(raw,T)!;
 assert.equal(p.valuation!.scope,'current-source-instance');assert.equal(p.valuation!.lastObservation!.reasonCode,'USD_PRICE_TIMEOUT');assert.equal(p.valuation!.lastObservation!.publicationTimeKnown,false);assert.equal(p.valuation!.lastObservation!.receivedAt,null);assert.deepEqual(p.valuation!.failuresByReason,{USD_PRICE_TIMEOUT:2});assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT/);validateFinancialPolicyReporting(p,T);
 assert.equal(projectFinancialPolicyReporting({usage:{usd:{requests:100,failures:4}}},T),undefined,'old aggregate failure counts cannot assign historical reason');
});
test('received USD facts preserve application receive time while malformed or contradictory outcomes stay unknown',()=>{
 const u=valuation();u.lastObservation.outcome='received';u.lastObservation.reasonCode='USD_PRICE_RECEIVED';u.lastObservation.receivedAt=T-1001 as any;u.lastObservation.httpStatus=200 as any;
 const p=projectFinancialPolicyReporting({usage:{usd:u}},T)!;assert.equal(p.valuation!.lastObservation!.receivedAt,new Date(T-1001).toISOString());validateFinancialPolicyReporting(p,T);
 for(const change of [(l:any)=>l.publicationTimeKnown=true,(l:any)=>l.completedAt=T+1,(l:any)=>l.reasonCode='private://DO_NOT_EXPORT',(l:any)=>l.httpStatus=999,(l:any)=>l.receivedAt=T+1,(l:any)=>l.outcome='unavailable',(l:any)=>l.durationMs=Infinity]){const bad=structuredClone(u);change(bad.lastObservation);const projected=projectFinancialPolicyReporting({usage:{usd:bad}},T)!;assert.equal(projected.valuation,null);validateFinancialPolicyReporting(projected,T);}
 const bad=structuredClone(p);(bad.valuation!.failuresByReason as any).secret=1;assert.throws(()=>validateFinancialPolicyReporting(bad,T),/FINANCIAL_POLICY_REPORTING/);
});
test('all policy groups remain bounded together at maximum financial amounts and diagnostic counts',()=>{
 const r=risk(),max=((1n<<127n)-1n).toString();for(const k of ['targetConsumedCostMicroUsd','targetConsumedCostLamports','unreservedCashLamports','cashLimitedConsumedCostLamports'])(r.entry as any)[k]=max;for(const k of ['highWaterMicroUsd','currentEquityMicroUsd','drawdownMicroUsd','remainingBeforePauseMicroUsd'])(r.daily as any)[k]=max;
 const e=execution();for(const k of ['plans','supportedLandingStates','preflightUnsubmitted','unknownLanding'])(e as any)[k]=Number.MAX_SAFE_INTEGER;
 const p=projectFinancialPolicyReporting({financial:{equityRisk:r},usage:{market:{executionModel:e},usd:valuation()}},T)!;assert.ok(p.risk&&p.execution&&p.valuation);assert.ok(Buffer.byteLength(JSON.stringify(p))<4096);validateFinancialPolicyReporting(p,T);
});

test('fresh equity above a retained peak is source-owned evidence, not a malformed or dashboard-recomputed high-water',()=>{
 const r=risk();r.daily.currentEquityMicroUsd='1100000000';r.daily.drawdownMicroUsd='0';r.daily.drawdownBps=0;
 const p=projectFinancialPolicyReporting({financial:{equityRisk:r}},T)!;assert.equal(p.risk!.daily.highWaterMicroUsd,'1000000000');assert.equal(p.risk!.daily.currentEquityMicroUsd,'1100000000');assert.equal(p.risk!.daily.drawdownBps,0);validateFinancialPolicyReporting(p,T);
});
test('a new UTC day can retain an explicitly dated previous-day peak while its current allowance remains unavailable',()=>{
 const r=risk();r.state='unavailable';r.reasonCode='EQUITY_RISK_INITIALIZING' as any;r.daily.day='2026-10-29';r.daily.highWaterAt=Date.parse('2026-10-29T23:59:00.000Z');
 const p=projectFinancialPolicyReporting({financial:{equityRisk:r}},T)!;assert.equal(p.risk!.state,'unavailable');assert.equal(p.risk!.daily.day,'2026-10-29');validateFinancialPolicyReporting(p,T);
});
