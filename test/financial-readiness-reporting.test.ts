import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CASH_RECONCILIATION_OUTCOME_VERSION,projectFinancialReadinessReporting,validateFinancialReadinessReporting} from '../src/financial-readiness-reporting.js';
import {NativePaperReportTimings} from '../src/native-paper-reporting-timing.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION,projectOperatingIntelligence,validateOperatingIntelligence} from '../src/operating-intelligence.js';
const T=Date.parse('2026-11-01T21:30:00.000Z'),START=T-600000,iso=(at:number)=>new Date(at).toISOString();
function status(){return {accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),runId:'native-paper-offline-diagnostics',configurationSha256:'a'.repeat(64),strategyVersion:'liquidity-resilient-momentum-v3.1',startedAt:START,generatedAt:T,positions:{},pending:{},entriesEnabled:true,financial:{controls:{entriesEnabled:true,stopRequested:false,reason:'DO_NOT_EXPORT'},daily:{paused:false,reconciledAt:T-1251}},sourceTimes:{financialReconciliationAt:T-1251},financialReadiness:{derivedEntryReason:null as string|null,operatingDecision:{at:T-1251,reasonCode:'OPERATING_READINESS_NOT_REQUIRED'},maintenance:{outcomeVersion:CASH_RECONCILIATION_OUTCOME_VERSION,healthyMaintenanceArmed:true,attempts:6,reconciled:5,recoveries:1,unavailable:1,financialFailures:0,busyDeferrals:2,deadlineMisses:1,maximumLatenessMs:2001,maximumElapsedMs:4.5,lastStartedAt:T-1253,lastCompletedAt:T-1251,privateError:'DO_NOT_EXPORT'}},reporting:{localProjectionBudgetMs:250,lastProjectionMs:321,maximumProjectionMs:432,lastCompletedAt:T-15000,projectionOverruns:2,phaseTimings:[{stage:'candidate-status',count:3,totalMs:850,lastMs:300,maximumMs:400},{stage:'financial-snapshot',count:3,totalMs:13,lastMs:4,maximumMs:5},{stage:'secret provider URL DO_NOT_EXPORT',count:1,totalMs:1,lastMs:1,maximumMs:1}]}};}

test('current-process finance diagnostics retain durable permission separately from a transient stale projection',()=>{
 const raw=status(),fresh=projectFinancialReadinessReporting(raw,T)!;assert.ok(fresh);validateFinancialReadinessReporting(fresh,T);
 assert.equal(fresh.permission.durableEntriesEnabled,true);assert.equal(fresh.permission.currentEntriesEnabled,true);assert.equal(fresh.reconciliation.ageMs,1251);assert.equal(fresh.reconciliation.maximumAgeMs,2000);assert.equal(fresh.maintenance!.reconciled,5);assert.equal(fresh.maintenance!.deadlineMisses,1);assert.equal(fresh.reporting.stages.length,2);assert.equal(JSON.stringify(fresh).includes('DO_NOT_EXPORT'),false);
 raw.financial.daily.reconciledAt=T-2009;raw.entriesEnabled=false;raw.financialReadiness.derivedEntryReason='POE_ENTRY_RECONCILIATION_STALE';
 const stale=projectFinancialReadinessReporting(raw,T)!;assert.equal(stale.permission.durableEntriesEnabled,true);assert.equal(stale.permission.currentEntriesEnabled,false);assert.equal(stale.permission.derivedReasonCode,'POE_ENTRY_RECONCILIATION_STALE');assert.equal(stale.reconciliation.ageMs,2009);assert.deepEqual(stale.maintenance,fresh.maintenance);
});

test('legacy counters remain unavailable and unknown source messages are reduced to static reason codes',()=>{
 const raw=status() as any;delete raw.financialReadiness.maintenance.outcomeVersion;raw.financialReadiness.derivedEntryReason='https://private.invalid?key=DO_NOT_EXPORT';raw.financialReadiness.operatingDecision.reasonCode='PRIVATE_ERROR_DO_NOT_EXPORT';raw.entriesEnabled=false;
 const result=projectFinancialReadinessReporting(raw,T)!;assert.equal(result.maintenance,null);assert.equal(result.permission.derivedReasonCode,'OTHER_UNEXPORTED_REASON');assert.equal(result.operatingDecision.reasonCode,'OTHER_UNEXPORTED_REASON');assert.equal(JSON.stringify(result).includes('DO_NOT_EXPORT'),false);
 delete raw.financialReadiness;assert.equal(projectFinancialReadinessReporting(raw,T),undefined);const legacy=projectOperatingIntelligence(raw);assert.equal(Object.hasOwn(legacy,'financialReadiness'),false);validateOperatingIntelligence(legacy,iso(T));
});

test('financial diagnostic wire rejects contradictory readiness, unknown keys, future clocks and unrelated process counters',()=>{
 const valid=projectFinancialReadinessReporting(status(),T)!;
 for(const mutate of [(r:any)=>{r.permission.durableEntriesEnabled=false;},(r:any)=>{r.reconciliation.at=iso(T-2001);r.reconciliation.ageMs=2001;},(r:any)=>{r.permission.secret='DO_NOT_EXPORT';},(r:any)=>{r.maintenance.lastCompletedAt=iso(T+1);},(r:any)=>{r.maintenance.lastStartedAt=iso(START-1);},(r:any)=>{r.maintenance.reconciled=7;},(r:any)=>{r.reporting.stages[0].lastMs=401;},(r:any)=>{r.reporting.stages.push({...r.reporting.stages[0]});}]){const bad=structuredClone(valid);mutate(bad);assert.throws(()=>validateFinancialReadinessReporting(bad,T),/FINANCIAL_READINESS/);}
 const intelligence=projectOperatingIntelligence(status());validateOperatingIntelligence(intelligence,iso(T));intelligence.financialReadiness!.runId='wrong-run';assert.throws(()=>validateOperatingIntelligence(intelligence,iso(T)),/PROCESS_BINDING/);
 const malformed=status() as any;malformed.financialReadiness.maintenance.deadlineMisses=-1;assert.equal(projectFinancialReadinessReporting(malformed,T),undefined,'optional malformed diagnostics never invalidate unrelated financial balances');
});

test('report phase timings capture thrown work without changing its exception and remain bounded to known stages',()=>{
 let at=0;const timings=new NativePaperReportTimings(()=>at),error=Error('OFFLINE original publication failure');assert.throws(()=>timings.measure('financial-history',()=>{at+=12.25;throw error;}),e=>e===error);
 assert.deepEqual(timings.usage(),[{stage:'financial-history',count:1,totalMs:12.25,lastMs:12.25,maximumMs:12.25}]);const copy=timings.usage();copy[0]!.lastMs=100;assert.equal(timings.usage()[0]!.lastMs,12.25);
 const unavailableClock=new NativePaperReportTimings(()=>{throw Error('OFFLINE measurement clock');});assert.equal(unavailableClock.measure('financial-snapshot',()=>17),17);assert.deepEqual(unavailableClock.usage(),[]);
});
