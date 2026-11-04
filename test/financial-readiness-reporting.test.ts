import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CASH_RECONCILIATION_OUTCOME_VERSION,projectFinancialReadinessReporting,validateFinancialReadinessReporting} from '../src/financial-readiness-reporting.js';
import {NativePaperReportTimings} from '../src/native-paper-reporting-timing.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION,projectOperatingIntelligence,validateOperatingIntelligence} from '../src/operating-intelligence.js';
const T=Date.parse('2026-11-01T21:30:00.000Z'),START=T-600000,iso=(at:number)=>new Date(at).toISOString();
function status(){return {accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),runId:'native-paper-offline-diagnostics',configurationSha256:'a'.repeat(64),strategyVersion:'liquidity-resilient-momentum-v3.1',startedAt:START,generatedAt:T,positions:{},pending:{},entriesEnabled:true,financial:{controls:{entriesEnabled:true,stopRequested:false,reason:'DO_NOT_EXPORT'},daily:{paused:false,reconciledAt:T-1251}},sourceTimes:{financialReconciliationAt:T-1251},financialReadiness:{derivedEntryReason:null as string|null,operatingDecision:{at:T-1251,reasonCode:'OPERATING_READINESS_NOT_REQUIRED'},maintenance:{outcomeVersion:CASH_RECONCILIATION_OUTCOME_VERSION,healthyMaintenanceArmed:true,attempts:6,reconciled:5,recoveries:1,unavailable:1,financialFailures:0,busyDeferrals:2,deadlineMisses:1,maximumLatenessMs:2001,maximumElapsedMs:4.5,lastStartedAt:T-1253,lastCompletedAt:T-1251,privateError:'DO_NOT_EXPORT'}},reporting:{localProjectionBudgetMs:250,lastProjectionMs:321,maximumProjectionMs:432,lastCompletedAt:T-15000,projectionOverruns:2,phaseTimings:[{stage:'candidate-status',count:3,totalMs:850,lastMs:300,maximumMs:400},{stage:'financial-snapshot',count:3,totalMs:13,lastMs:4,maximumMs:5},{stage:'secret provider URL DO_NOT_EXPORT',count:1,totalMs:1,lastMs:1,maximumMs:1}]}};}

test('technical protection provenance refusals retain their specific cause and original observation time',()=>{
 for(const code of ['TECHNICAL_PROTECTION_CONTROL_TIME','TECHNICAL_PROTECTION_CONTROL_NOT_ELIGIBLE','TECHNICAL_PROTECTION_CONTROL_HISTORY_UNAVAILABLE','TECHNICAL_PROTECTION_STOP_INTENT_PRESENT','TECHNICAL_PROTECTION_UNPROVEN_RESTORE','TECHNICAL_PROTECTION_OWNER_OR_UNKNOWN_CONTROL','TECHNICAL_PROTECTION_CURRENT_CONTROL_MISMATCH']){
  const raw=status();raw.entriesEnabled=false;raw.financial.controls.entriesEnabled=false;raw.financial.daily.paused=true;raw.financialReadiness.derivedEntryReason='POE_ENTRY_PROTECTION_RECOVERY_REQUIRED';raw.financialReadiness.operatingDecision.reasonCode=code;
  const projected=projectFinancialReadinessReporting(raw,T)!;assert.ok(projected);assert.equal(projected.operatingDecision.reasonCode,code);assert.equal(projected.operatingDecision.at,new Date(T-1251).toISOString());
 }
});

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

test('backup-blocked monitoring retains its precise prerequisite and source clock without granting permission',()=>{
 // Same prerequisite/permission shape as the retained H9 2026-11-04 09:05:47.213 source episode.
 const raw=status() as any;raw.entriesEnabled=false;raw.financial.controls.entriesEnabled=false;raw.financial.daily.paused=true;
 raw.financialReadiness.derivedEntryReason='POE_ENTRY_MONITORING_UNAVAILABLE';raw.financialReadiness.monitoringAdmissionReason='BACKUP_UNAVAILABLE';
 const before=structuredClone(raw),projected=projectFinancialReadinessReporting(raw,T)!;
 assert.ok(projected);assert.equal(projected.monitoringAdmissionReasonCode,'BACKUP_UNAVAILABLE');assert.equal(projected.generatedAt,iso(T));assert.equal(projected.runId,raw.runId);
 assert.equal(projected.permission.derivedReasonCode,'POE_ENTRY_MONITORING_UNAVAILABLE');assert.equal(projected.permission.currentEntriesEnabled,false);assert.equal(projected.permission.durableEntriesEnabled,false);assert.equal(projected.permission.dailyPaused,true);
 assert.deepEqual(raw,before);assert.equal(projected.maintenance!.reconciled,5);assert.equal(projected.reconciliation.at,iso(T-1251));
 const operating=projectOperatingIntelligence(raw);validateOperatingIntelligence(operating,iso(T));assert.equal(operating.financialReadiness!.monitoringAdmissionReasonCode,'BACKUP_UNAVAILABLE');
});

test('monitoring diagnostics preserve legacy absence and reported null, redact unknown causes, and reject contradictory wire permission',()=>{
 const legacy=projectFinancialReadinessReporting(status(),T)!;assert.equal(Object.hasOwn(legacy,'monitoringAdmissionReasonCode'),false);validateFinancialReadinessReporting(legacy,T);
 const raw=status() as any;raw.financialReadiness.monitoringAdmissionReason=null;
 const clear=projectFinancialReadinessReporting(raw,T)!;assert.equal(Object.hasOwn(clear,'monitoringAdmissionReasonCode'),true);assert.equal(clear.monitoringAdmissionReasonCode,null);assert.equal(clear.permission.currentEntriesEnabled,true);
 raw.entriesEnabled=false;raw.financialReadiness.derivedEntryReason='POE_ENTRY_MONITORING_UNAVAILABLE';raw.financialReadiness.monitoringAdmissionReason='https://private.invalid/DO_NOT_EXPORT';
 const unknown=projectFinancialReadinessReporting(raw,T)!;assert.equal(unknown.monitoringAdmissionReasonCode,'OTHER_UNEXPORTED_REASON');assert.equal(JSON.stringify(unknown).includes('DO_NOT_EXPORT'),false);
 raw.financialReadiness.monitoringAdmissionReason=undefined;assert.equal(projectFinancialReadinessReporting(raw,T)!.monitoringAdmissionReasonCode,'OTHER_UNEXPORTED_REASON','a present malformed value never claims an explicitly clear prerequisite');
 for(const code of ['PROVIDER_RESTRICTION','DISK_RESERVE','SERVICE_SUPERVISION_UNAVAILABLE','MARKET_INTAKE_UNAVAILABLE']){raw.financialReadiness.monitoringAdmissionReason=code;assert.equal(projectFinancialReadinessReporting(raw,T)!.monitoringAdmissionReasonCode,code);}
 for(const mutate of [(r:any)=>{r.monitoringAdmissionReasonCode='PRIVATE_ERROR_DO_NOT_EXPORT';},(r:any)=>{r.monitoringAdmissionReasonCode=undefined;},(r:any)=>{r.monitoringAdmissionReasonCode='BACKUP_UNAVAILABLE';},(r:any)=>{r.monitoringAdmissionReasonCode={reason:'BACKUP_UNAVAILABLE'};}]){const bad=structuredClone(clear);mutate(bad);assert.throws(()=>validateFinancialReadinessReporting(bad,T),/FINANCIAL_READINESS/);}
 const contradictory=status() as any;for(const reason of ['BACKUP_UNAVAILABLE',undefined]){contradictory.financialReadiness.monitoringAdmissionReason=reason;assert.equal(projectFinancialReadinessReporting(contradictory,T),undefined,'malformed optional diagnostics cannot silently certify current permission');}
});

test('a marker read failure has its own optional diagnostic without inventing owner intent or financial failure',()=>{
 const raw=status() as any;raw.entriesEnabled=false;raw.financialReadiness.derivedEntryReason='POE_ENTRY_MANUAL_PAUSE';raw.financialReadiness.monitoringAdmissionReason='MANUAL_ADMISSION_MARKER_UNAVAILABLE';
 const original=structuredClone(raw),projected=projectFinancialReadinessReporting(raw,T)!;assert.ok(projected);
 assert.equal(projected.monitoringAdmissionReasonCode,'MANUAL_ADMISSION_MARKER_UNAVAILABLE');assert.equal(projected.permission.currentEntriesEnabled,false);
 assert.equal(projected.permission.durableEntriesEnabled,true);assert.equal(projected.maintenance!.financialFailures,0);assert.equal(projected.reconciliation.ageMs,1251);assert.deepEqual(raw,original);
 const operating=projectOperatingIntelligence(raw);validateOperatingIntelligence(operating,iso(T));assert.equal(operating.financialReadiness!.monitoringAdmissionReasonCode,'MANUAL_ADMISSION_MARKER_UNAVAILABLE');
 raw.financialReadiness.monitoringAdmissionReason=null;raw.financialReadiness.derivedEntryReason=null;raw.entriesEnabled=true;
 assert.equal(projectFinancialReadinessReporting(raw,T)!.monitoringAdmissionReasonCode,null);
 delete raw.financialReadiness.monitoringAdmissionReason;assert.equal(Object.hasOwn(projectFinancialReadinessReporting(raw,T)!,'monitoringAdmissionReasonCode'),false);
});
