import {NATIVE_PAPER_REPORT_PHASES,type NativePaperReportPhaseTiming} from './native-paper-reporting-timing.js';
/** Source-owned current-run diagnostics only. This read-only projection never
 * acquires a financial writer, resumes permission, or extends a deadline. */
export const FINANCIAL_READINESS_REPORTING_VERSION='poe-financial-readiness-v1' as const;
export const CASH_RECONCILIATION_OUTCOME_VERSION='cash-reconciliation-independent-permission-v1' as const;
const ENTRY_REASONS=['POE_ENTRY_MANUAL_PAUSE','POE_ENTRY_SAFE_STOP','POE_ENTRY_DAILY_LOSS','POE_ENTRY_RISK_POLICY_REQUIRED','POE_ENTRY_FINANCIAL_UNCERTAINTY','POE_ENTRY_EVIDENCE_UNAVAILABLE','POE_ENTRY_USD_UNAVAILABLE','POE_ENTRY_LIQUIDATION_UNAVAILABLE','POE_ENTRY_RECONCILIATION_REQUIRED','POE_ENTRY_RECONCILIATION_STALE','POE_ENTRY_PROVIDER_UNAVAILABLE','POE_ENTRY_SOURCE_UNAVAILABLE','POE_ENTRY_MONITORING_UNAVAILABLE','POE_ENTRY_READINESS_REQUIRED','POE_ENTRY_PROTECTION_RECOVERY_REQUIRED','POE_ENTRY_FINANCIAL_PAUSED','OTHER_UNEXPORTED_REASON'] as const;
const OPERATING_REASONS=['OPERATING_READINESS_NOT_SELECTED','OPERATING_READINESS_V3_EPOCH_AND_POLICY_REQUIRED','OPERATING_READINESS_FINANCIAL_WORK_ACTIVE','OPERATING_READINESS_NOT_REQUIRED','OPERATING_READINESS_OWNER_OR_HARD_CONTROL','OPERATING_READINESS_CONTROL_PROVENANCE_UNAVAILABLE','OPERATING_READINESS_DAILY_LOSS','OPERATING_READINESS_FINANCIAL_OR_EVIDENCE_UNAVAILABLE','OPERATING_READINESS_CURRENT_ADMISSION_UNAVAILABLE','OPERATING_READINESS_FRESH_FINANCE_REQUIRED','OPERATING_READINESS_CAPTURE_UNAVAILABLE','OPERATING_READINESS_CURRENT_SOURCE_CLOCK_REQUIRED','OPERATING_READINESS_EXACT_HELD_MARKS_REQUIRED','OPERATING_READINESS_CURRENT_INVENTORY_REQUIRED','OPERATING_READINESS_SUSTAINED_PROTECTION_RECOVERY_REQUIRED','OPERATING_READINESS_FINANCIAL_OPERATION_FAILED','OPERATING_READINESS_RECOVERED','OPERATING_READINESS_RECOVERY_NOT_RETAINED','OPERATING_READINESS_PERMISSION_NOT_GRANTED','OPERATING_READINESS_NOT_EVALUATED','OTHER_UNEXPORTED_REASON'] as const;
const COUNTERS=['attempts','reconciled','recoveries','unavailable','financialFailures','busyDeferrals','deadlineMisses'] as const;
type Maintenance=Record<typeof COUNTERS[number],number>&{outcomeVersion:typeof CASH_RECONCILIATION_OUTCOME_VERSION;healthyMaintenanceArmed:boolean;maximumLatenessMs:number;maximumElapsedMs:number;lastStartedAt:string|null;lastCompletedAt:string|null};
export type FinancialReadinessReporting={
 version:typeof FINANCIAL_READINESS_REPORTING_VERSION;scope:'CURRENT_SOURCE_PROCESS';runId:string;startedAt:string;generatedAt:string;
 permission:{durableEntriesEnabled:boolean|null;dailyPaused:boolean|null;stopRequested:boolean|null;currentEntriesEnabled:boolean|null;derivedReasonCode:typeof ENTRY_REASONS[number]|null};
 reconciliation:{at:string|null;ageMs:number|null;maximumAgeMs:2000;targetMs:1000};
 maintenance:Maintenance|null;
 operatingDecision:{at:string|null;reasonCode:typeof OPERATING_REASONS[number]|null};
 reporting:{budgetMs:250;lastDurationMs:number|null;maximumDurationMs:number|null;lastCompletedAt:string|null;overruns:number|null;stages:NativePaperReportPhaseTiming[]};
};
const INCEPTION=Date.parse('2026-10-26T22:07:36.212Z');
const rec=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const whole=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const bool=(v:unknown)=>typeof v==='boolean'?v:null;
function need(v:unknown):asserts v {if(!v)throw Error('FINANCIAL_READINESS_REPORTING_INVALID');}
function exact(v:unknown,keys:string){const r=rec(v);need(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(r).sort().join(' ')===keys.split(' ').sort().join(' '));return r;}
function iso(v:unknown,at:number){return whole(v)&&v>=INCEPTION&&v<=at?new Date(v).toISOString():null;}
function reason<T extends readonly string[]>(value:unknown,known:T):T[number]|null {return value===null||value===undefined?null:typeof value==='string'&&known.includes(value)?value:'OTHER_UNEXPORTED_REASON';}
export function projectFinancialReadinessReporting(status:unknown,generated:number):FinancialReadinessReporting|undefined {
 const s=rec(status);if(!Object.hasOwn(s,'financialReadiness'))return undefined;
 try {
  const raw=rec(s.financialReadiness),finance=rec(s.financial),controls=rec(finance.controls),daily=rec(finance.daily),maintenance=rec(raw.maintenance),report=rec(s.reporting),decision=rec(raw.operatingDecision),reconciledAt=iso(daily.reconciledAt,generated);
  // Earlier binaries had different successful-refresh counter semantics. Do
  // not relabel their counters as corrected current-process observations.
  const m:Maintenance|null=maintenance.outcomeVersion!==CASH_RECONCILIATION_OUTCOME_VERSION?null:{outcomeVersion:CASH_RECONCILIATION_OUTCOME_VERSION,healthyMaintenanceArmed:maintenance.healthyMaintenanceArmed,...Object.fromEntries(COUNTERS.map(k=>[k,maintenance[k]])) as Record<typeof COUNTERS[number],number>,maximumLatenessMs:maintenance.maximumLatenessMs,maximumElapsedMs:maintenance.maximumElapsedMs,lastStartedAt:iso(maintenance.lastStartedAt,generated),lastCompletedAt:iso(maintenance.lastCompletedAt,generated)};
  const stages=(Array.isArray(report.phaseTimings)?report.phaseTimings:[]).filter((row:unknown)=>(NATIVE_PAPER_REPORT_PHASES as readonly unknown[]).includes(rec(row).stage)).slice(0,NATIVE_PAPER_REPORT_PHASES.length).map((row:unknown)=>{const r=rec(row);return {stage:r.stage,count:r.count,totalMs:r.totalMs,lastMs:r.lastMs,maximumMs:r.maximumMs};});
  return validateFinancialReadinessReporting({version:FINANCIAL_READINESS_REPORTING_VERSION,scope:'CURRENT_SOURCE_PROCESS',runId:s.runId,startedAt:iso(s.startedAt,generated),generatedAt:iso(s.generatedAt,generated),permission:{durableEntriesEnabled:bool(controls.entriesEnabled),dailyPaused:bool(daily.paused),stopRequested:bool(controls.stopRequested),currentEntriesEnabled:bool(s.entriesEnabled),derivedReasonCode:reason(raw.derivedEntryReason,ENTRY_REASONS)},reconciliation:{at:reconciledAt,ageMs:reconciledAt===null?null:generated-Date.parse(reconciledAt),maximumAgeMs:2000,targetMs:1000},maintenance:m,operatingDecision:{at:iso(decision.at,generated),reasonCode:reason(decision.reasonCode,OPERATING_REASONS)},reporting:{budgetMs:250,lastDurationMs:finite(report.lastProjectionMs)?report.lastProjectionMs:null,maximumDurationMs:finite(report.maximumProjectionMs)?report.maximumProjectionMs:null,lastCompletedAt:iso(report.lastCompletedAt,generated),overruns:whole(report.projectionOverruns)?report.projectionOverruns:null,stages}},generated);
 }catch{return undefined;}
}
export function validateFinancialReadinessReporting(value:unknown,generated:number):FinancialReadinessReporting {
 const r=exact(value,'version scope runId startedAt generatedAt permission reconciliation maintenance operatingDecision reporting');
 need(r.version===FINANCIAL_READINESS_REPORTING_VERSION&&r.scope==='CURRENT_SOURCE_PROCESS'&&typeof r.runId==='string'&&/^[a-zA-Z0-9-]{1,128}$/.test(r.runId));
 const time=(value:unknown,nullable=false,minimum=INCEPTION):number|null=>{if(value===null&&nullable)return null;const n=typeof value==='string'?Date.parse(value):NaN;need(whole(n)&&n>=minimum&&n<=generated&&new Date(n).toISOString()===value);return n;};
 const start=time(r.startedAt)!,at=time(r.generatedAt,false,start)!;need(at===generated);
 const p=exact(r.permission,'durableEntriesEnabled dailyPaused stopRequested currentEntriesEnabled derivedReasonCode');
 for(const k of ['durableEntriesEnabled','dailyPaused','stopRequested','currentEntriesEnabled'])need(p[k]===null||typeof p[k]==='boolean');
 need(p.derivedReasonCode===null||(ENTRY_REASONS as readonly unknown[]).includes(p.derivedReasonCode));
 const reconciliation=exact(r.reconciliation,'at ageMs maximumAgeMs targetMs'),reconciledAt=time(reconciliation.at,true);
 need(reconciliation.maximumAgeMs===2000&&reconciliation.targetMs===1000&&(reconciledAt===null?reconciliation.ageMs===null:reconciliation.ageMs===at-reconciledAt));
 if(p.currentEntriesEnabled===true)need(p.durableEntriesEnabled===true&&p.dailyPaused===false&&p.stopRequested===false&&p.derivedReasonCode===null&&reconciledAt!==null&&reconciliation.ageMs<=reconciliation.maximumAgeMs);
 if(r.maintenance!==null){
  const m=exact(r.maintenance,'outcomeVersion healthyMaintenanceArmed attempts reconciled recoveries unavailable financialFailures busyDeferrals deadlineMisses maximumLatenessMs maximumElapsedMs lastStartedAt lastCompletedAt');
  need(m.outcomeVersion===CASH_RECONCILIATION_OUTCOME_VERSION&&typeof m.healthyMaintenanceArmed==='boolean');for(const k of COUNTERS)need(whole(m[k]));for(const k of ['maximumLatenessMs','maximumElapsedMs'])need(finite(m[k]));
  need(m.recoveries<=m.reconciled&&m.reconciled+m.unavailable<=m.attempts&&m.deadlineMisses<=m.reconciled);
  const began=time(m.lastStartedAt,true,start),completed=time(m.lastCompletedAt,true,start);need((began===null)===(completed===null)&&(began===null||completed!>=began));need(m.attempts===0?began===null:began!==null);
 }
 const decision=exact(r.operatingDecision,'at reasonCode');time(decision.at,true,start);need(decision.reasonCode===null||(OPERATING_REASONS as readonly unknown[]).includes(decision.reasonCode));
 const report=exact(r.reporting,'budgetMs lastDurationMs maximumDurationMs lastCompletedAt overruns stages');need(report.budgetMs===250);for(const k of ['lastDurationMs','maximumDurationMs'])need(report[k]===null||finite(report[k]));need(report.overruns===null||whole(report.overruns));time(report.lastCompletedAt,true,start);need(report.lastDurationMs===null||report.maximumDurationMs!==null&&report.lastDurationMs<=report.maximumDurationMs);
 need(Array.isArray(report.stages)&&report.stages.length<=NATIVE_PAPER_REPORT_PHASES.length);const seen=new Set<string>();
 for(const row of report.stages){const phase=exact(row,'stage count totalMs lastMs maximumMs');need((NATIVE_PAPER_REPORT_PHASES as readonly unknown[]).includes(phase.stage)&&!seen.has(phase.stage));seen.add(phase.stage);need(whole(phase.count)&&phase.count>0);for(const k of ['totalMs','lastMs','maximumMs'])need(finite(phase[k]));need(phase.lastMs<=phase.maximumMs&&phase.maximumMs<=phase.totalMs);}
 need(Buffer.byteLength(JSON.stringify(r))<=4096);return r as FinancialReadinessReporting;
}
