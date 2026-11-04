/** Pure, bounded source facts for the original PAPER Portfolio Overview.
 * Never grants financial permission or reconstructs missing policy history. */
export const FINANCIAL_POLICY_REPORTING_VERSION='poe-paper-financial-policy-v1' as const;
export const EQUITY_RISK_REPORTING_VERSION='paper-equity-risk-5-10-v1' as const;
export const V3_EQUITY_RISK_REPORTING_VERSION='paper-equity-risk-v3-no-daily-stop-v1' as const;
export type FinancialRiskReporting={
 version:typeof EQUITY_RISK_REPORTING_VERSION|typeof V3_EQUITY_RISK_REPORTING_VERSION;state:'ready'|'unavailable';reasonCode:typeof EQUITY_RISK_REASON_CODES[number]|null;asOf:string;
 entry:{targetBps:500;targetConsumedCostMicroUsd:string|null;targetConsumedCostSol:string|null;unreservedCashSol:string;cashLimitedConsumedCostSol:string|null;refundableDepositsIncluded:false;executabilityClaimed:false};
 daily:{day:string;limitBps:1000|null;highWaterMicroUsd:string|null;highWaterAt:string|null;currentEquityMicroUsd:string|null;drawdownMicroUsd:string|null;drawdownBps:number|null;remainingBeforePauseMicroUsd:string|null;lossPaused:boolean;historyCoverage:'verified-retained-same-day'|'first-complete-observation'|'unavailable';basis:'complete-observed-executable-equity-current-usd'};
};
export const OPERATING_CAPACITY_REPORTING_VERSION='poe-effective-holding-capacity-v1' as const;
export const OPERATING_TWO_HOLDING_POLICY_VERSION='owner-paper-two-holdings-v1' as const;
export type OperatingCapacityReporting={version:typeof OPERATING_CAPACITY_REPORTING_VERSION;scope:'CURRENT_SOURCE_SNAPSHOT';asOf:string;operatingPolicyVersion:typeof OPERATING_TWO_HOLDING_POLICY_VERSION;policyMaximumPositions:2;historicalMaximumPositions:number|null;maximumPositions:number;heldPositions:number;pendingBuyOrders:number;occupiedPositions:number;available:boolean;occupiedCapacity:'held-positions-plus-pending-buy-reservations';existingObligations:'retain-and-manage-without-forced-liquidation';grantsFinancialPermission:false};
export type MigrationAdmissionReporting={version:'verified-pumpswap-migration-1m-24h-v1';scope:'CURRENT_SOURCE_SNAPSHOT';asOf:string;basis:'verified-canonical-PumpSwap-migration-block-time';minimumAgeMs:60000;maximumAgeMs:86400000;boundary:'inclusive-at-1-minute-and-24-hours';grantsFinancialPermission:false};
export type FinancialPolicyReporting={version:typeof FINANCIAL_POLICY_REPORTING_VERSION;risk:FinancialRiskReporting|null;execution:FinancialExecutionReporting|null;valuation:FinancialValuationReporting|null;operatingCapacity?:OperatingCapacityReporting|null;marketAdmissionAge?:MigrationAdmissionReporting|null};
export const EQUITY_RISK_REASON_CODES=['EQUITY_RISK_INITIALIZING','EQUITY_RISK_HISTORY_UNAVAILABLE','EQUITY_RISK_VALUATION_UNAVAILABLE','EQUITY_RISK_RECONCILIATION_STALE','EQUITY_RISK_DAILY_DRAWDOWN','EQUITY_RISK_POLICY_INVALID'] as const;
const INCEPTION=Date.parse('2026-10-26T22:07:36.212Z'),MAX=(1n<<127n)-1n;
const record=(v:unknown):Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
function need(v:unknown):asserts v {if(!v)throw Error('FINANCIAL_POLICY_REPORTING_INVALID');}
function exact(v:unknown,keys:string){const r=record(v);need(Object.keys(r).sort().join(' ')===keys.split(' ').sort().join(' '));return r;}
function amount(v:unknown,nullable=false):asserts v is string|null {if(nullable&&v===null)return;need(typeof v==='string'&&/^(0|[1-9]\d{0,38})$/.test(v)&&BigInt(v)<=MAX);}
function count(v:unknown,maximum=Number.MAX_SAFE_INTEGER):asserts v is number {need(Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=maximum);}
function time(v:unknown,generated:number,nullable?:false):asserts v is string;
function time(v:unknown,generated:number,nullable:true):asserts v is string|null;
function time(v:unknown,generated:number,nullable=false):asserts v is string|null {if(nullable&&v===null)return;const n=typeof v==='string'?Date.parse(v):NaN;need(Number.isSafeInteger(n)&&n>=INCEPTION&&n<=generated&&new Date(n).toISOString()===v);}
function iso(v:unknown,generated:number){need(Number.isSafeInteger(v)&&Number(v)>=INCEPTION&&Number(v)<=generated);return new Date(Number(v)).toISOString();}
function sol(v:unknown){amount(v);const n=BigInt(v!);return `${n/1000000000n}.${(n%1000000000n).toString().padStart(9,'0')}`;}
function solAmount(v:unknown,nullable=false){if(nullable&&v===null)return;need(typeof v==='string'&&/^(0|[1-9]\d{0,29})\.\d{9}$/.test(v));const [whole,part]=v.split('.');need(BigInt(whole!)*1000000000n+BigInt(part!)<=MAX);}
export function validateFinancialRiskReporting(value:unknown,generated:number):FinancialRiskReporting {
 const r=exact(value,'version state reasonCode asOf entry daily');need((r.version===EQUITY_RISK_REPORTING_VERSION||r.version===V3_EQUITY_RISK_REPORTING_VERSION)&&['ready','unavailable'].includes(r.state));time(r.asOf,generated);const v3=r.version===V3_EQUITY_RISK_REPORTING_VERSION;
 need(r.reasonCode===null||(EQUITY_RISK_REASON_CODES as readonly unknown[]).includes(r.reasonCode));
 const e=exact(r.entry,'targetBps targetConsumedCostMicroUsd targetConsumedCostSol unreservedCashSol cashLimitedConsumedCostSol refundableDepositsIncluded executabilityClaimed');
 need(e.targetBps===500&&e.refundableDepositsIncluded===false&&e.executabilityClaimed===false);amount(e.targetConsumedCostMicroUsd,true);solAmount(e.targetConsumedCostSol,true);solAmount(e.unreservedCashSol);solAmount(e.cashLimitedConsumedCostSol,true);
 const d=exact(r.daily,'day limitBps highWaterMicroUsd highWaterAt currentEquityMicroUsd drawdownMicroUsd drawdownBps remainingBeforePauseMicroUsd lossPaused historyCoverage basis');
 need(typeof d.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.day)&&Number.isFinite(Date.parse(d.day+'T00:00:00.000Z'))&&new Date(d.day+'T00:00:00.000Z').toISOString().slice(0,10)===d.day&&d.day>='2026-10-26'&&d.day<=String(r.asOf).slice(0,10)&&d.limitBps===(v3?null:1000)&&typeof d.lossPaused==='boolean'&&(!v3||d.lossPaused===false&&d.remainingBeforePauseMicroUsd===null&&r.reasonCode!=='EQUITY_RISK_DAILY_DRAWDOWN')&&['verified-retained-same-day','first-complete-observation','unavailable'].includes(d.historyCoverage)&&d.basis==='complete-observed-executable-equity-current-usd');
 for(const key of ['highWaterMicroUsd','currentEquityMicroUsd','drawdownMicroUsd','remainingBeforePauseMicroUsd'])amount(d[key],true);
 time(d.highWaterAt,Date.parse(r.asOf),true);need((d.highWaterMicroUsd===null)===(d.highWaterAt===null));if(d.highWaterAt!==null)need(d.highWaterAt.slice(0,10)===d.day);
 if(d.drawdownBps!==null)count(d.drawdownBps,10000);
 if(r.state==='ready')need(d.day===r.asOf.slice(0,10)&&e.targetConsumedCostMicroUsd!==null&&e.targetConsumedCostSol!==null&&e.cashLimitedConsumedCostSol!==null&&d.highWaterMicroUsd!==null&&d.currentEquityMicroUsd!==null&&d.drawdownMicroUsd!==null&&d.drawdownBps!==null&&(v3||d.remainingBeforePauseMicroUsd!==null)&&d.historyCoverage!=='unavailable'&&(r.reasonCode===null||r.reasonCode==='EQUITY_RISK_DAILY_DRAWDOWN'));
 else need(r.reasonCode!==null);
 // Reporting verifies the producer's integer identities without granting risk.
 // Positive-amount division truncates: floor(5% equity), floor(drawdown bps),
 // and max(floor(10% HWM) - drawdown, 0). A prior latch may remain after rebound.
 if(e.cashLimitedConsumedCostSol!==null&&e.targetConsumedCostSol!==null){const cash=BigInt(e.cashLimitedConsumedCostSol.replace('.',''));need(cash<=BigInt(e.targetConsumedCostSol.replace('.',''))&&cash<=BigInt(e.unreservedCashSol.replace('.','')));}
 if(e.targetConsumedCostMicroUsd!==null&&d.currentEquityMicroUsd!==null)need(BigInt(e.targetConsumedCostMicroUsd)===BigInt(d.currentEquityMicroUsd)*500n/10000n);
 if(d.highWaterMicroUsd!==null&&d.currentEquityMicroUsd!==null&&d.drawdownMicroUsd!==null&&d.drawdownBps!==null){
  const h=BigInt(d.highWaterMicroUsd),c=BigInt(d.currentEquityMicroUsd),dd=h>c?h-c:0n;
  need(BigInt(d.drawdownMicroUsd)===dd&&d.drawdownBps===(h===0n?0:Number(dd*10000n/h)));
  if(!v3&&d.remainingBeforePauseMicroUsd!==null){const limit=h*1000n/10000n,remaining=limit>dd?limit-dd:0n;need(BigInt(d.remainingBeforePauseMicroUsd)===remaining);if(h>0n&&dd*10000n>=h*1000n)need(d.lossPaused===true);}
 }
 if(r.state==='ready')need(d.lossPaused?r.reasonCode==='EQUITY_RISK_DAILY_DRAWDOWN':r.reasonCode===null);
 return r as FinancialRiskReporting;
}
function projectRisk(value:unknown,generated:number):FinancialRiskReporting|null {
 try{const r=record(value);need(r.version===EQUITY_RISK_REPORTING_VERSION||r.version===V3_EQUITY_RISK_REPORTING_VERSION);const e=record(r.entry),d=record(r.daily);
  return validateFinancialRiskReporting({version:r.version,state:r.state,reasonCode:r.reasonCode,asOf:iso(r.asOf,generated),entry:{targetBps:e.targetBps,targetConsumedCostMicroUsd:e.targetConsumedCostMicroUsd,targetConsumedCostSol:e.targetConsumedCostLamports===null?null:sol(e.targetConsumedCostLamports),unreservedCashSol:sol(e.unreservedCashLamports),cashLimitedConsumedCostSol:e.cashLimitedConsumedCostLamports===null?null:sol(e.cashLimitedConsumedCostLamports),refundableDepositsIncluded:e.refundableDepositsIncluded,executabilityClaimed:e.executabilityClaimed},daily:{day:d.day,limitBps:d.limitBps,highWaterMicroUsd:d.highWaterMicroUsd,highWaterAt:d.highWaterAt===null?null:iso(d.highWaterAt,generated),currentEquityMicroUsd:d.currentEquityMicroUsd,drawdownMicroUsd:d.drawdownMicroUsd,drawdownBps:d.drawdownBps,remainingBeforePauseMicroUsd:d.remainingBeforePauseMicroUsd,lossPaused:d.lossPaused,historyCoverage:d.historyCoverage,basis:d.basis}},generated);
 }catch{return null;}
}
export function validateOperatingCapacityReporting(value:unknown,generated:number):OperatingCapacityReporting {
 const c=exact(value,'version scope asOf operatingPolicyVersion policyMaximumPositions historicalMaximumPositions maximumPositions heldPositions pendingBuyOrders occupiedPositions available occupiedCapacity existingObligations grantsFinancialPermission');
 need(c.version===OPERATING_CAPACITY_REPORTING_VERSION&&c.scope==='CURRENT_SOURCE_SNAPSHOT'&&c.operatingPolicyVersion===OPERATING_TWO_HOLDING_POLICY_VERSION&&c.policyMaximumPositions===2&&c.occupiedCapacity==='held-positions-plus-pending-buy-reservations'&&c.existingObligations==='retain-and-manage-without-forced-liquidation'&&c.grantsFinancialPermission===false);time(c.asOf,generated);
 for(const key of ['maximumPositions','heldPositions','pendingBuyOrders','occupiedPositions'])count(c[key]);if(c.historicalMaximumPositions!==null)count(c.historicalMaximumPositions);
 need(c.maximumPositions===(c.historicalMaximumPositions===null?2:Math.min(c.historicalMaximumPositions,2))&&c.occupiedPositions===c.heldPositions+c.pendingBuyOrders&&typeof c.available==='boolean'&&(!c.available||c.occupiedPositions<c.maximumPositions));
 return c as OperatingCapacityReporting;
}
function projectOperatingCapacity(value:unknown,status:Record<string,any>,generated:number):OperatingCapacityReporting|null {
 try{const c=record(value),p=exact(c.policy,'version maximumPositions occupiedCapacity existingObligations financialPolicy');
  need(p.version===OPERATING_TWO_HOLDING_POLICY_VERSION&&p.maximumPositions===2&&p.occupiedCapacity==='held-positions-plus-pending-buy-reservations'&&p.existingObligations==='retain-and-manage-without-forced-liquidation'&&p.financialPolicy==='unchanged-v3-500bps-no-daily-stop'&&c.operatingPolicyVersion===p.version);
  need(Object.hasOwn(status,'positions')&&Object.hasOwn(status,'pending')&&status.positions&&typeof status.positions==='object'&&!Array.isArray(status.positions)&&status.pending&&typeof status.pending==='object'&&!Array.isArray(status.pending));
  const orders=Object.values(status.pending);need(orders.every(order=>['buy','sell'].includes(record(order).side)));
  need(c.heldPositions===Object.keys(status.positions).length&&c.pendingBuyOrders===orders.filter(order=>record(order).side==='buy').length);
  return validateOperatingCapacityReporting({version:OPERATING_CAPACITY_REPORTING_VERSION,scope:'CURRENT_SOURCE_SNAPSHOT',asOf:iso(status.generatedAt,generated),operatingPolicyVersion:c.operatingPolicyVersion,policyMaximumPositions:2,historicalMaximumPositions:c.historicalMaximumPositions,maximumPositions:c.maximumPositions,heldPositions:c.heldPositions,pendingBuyOrders:c.pendingBuyOrders,occupiedPositions:c.occupiedPositions,available:c.available,occupiedCapacity:p.occupiedCapacity,existingObligations:p.existingObligations,grantsFinancialPermission:false},generated);
 }catch{return null;}
}
export function validateMigrationAdmissionReporting(value:unknown,generated:number):MigrationAdmissionReporting {
 const p=exact(value,'version scope asOf basis minimumAgeMs maximumAgeMs boundary grantsFinancialPermission');
 need(p.version==='verified-pumpswap-migration-1m-24h-v1'&&p.scope==='CURRENT_SOURCE_SNAPSHOT'&&p.basis==='verified-canonical-PumpSwap-migration-block-time'&&p.minimumAgeMs===60000&&p.maximumAgeMs===86400000&&p.boundary==='inclusive-at-1-minute-and-24-hours'&&p.grantsFinancialPermission===false);time(p.asOf,generated);return p as MigrationAdmissionReporting;
}
function projectMigrationAdmission(value:unknown,status:Record<string,any>,generated:number):MigrationAdmissionReporting|null {
 try{const p=record(value);return validateMigrationAdmissionReporting({version:p.version,scope:'CURRENT_SOURCE_SNAPSHOT',asOf:iso(status.generatedAt,generated),basis:p.basis,minimumAgeMs:p.minimumAgeMs,maximumAgeMs:p.maximumAgeMs,boundary:p.boundary,grantsFinancialPermission:false},generated);}catch{return null;}
}
/** A missing or malformed optional policy never changes the financial snapshot,
 * manufactures a risk allowance, or masks its actual entry blocker. */
export function projectFinancialPolicyReporting(status:unknown,generated:number):FinancialPolicyReporting|undefined {
 const s=record(status),financial=record(s.financial),market=record(record(s.usage).market);
 if(!Object.hasOwn(financial,'equityRisk')&&!Object.hasOwn(market,'executionModel')&&!Object.hasOwn(record(record(s.usage).usd),'lastObservation')&&!Object.hasOwn(s,'operatingCapacity')&&!Object.hasOwn(s,'marketAdmissionAgePolicy'))return undefined;
 return {version:FINANCIAL_POLICY_REPORTING_VERSION,risk:projectRisk(financial.equityRisk,generated),execution:projectExecution(market.executionModel,generated),valuation:projectValuation(record(s.usage).usd,generated),...(Object.hasOwn(s,'operatingCapacity')?{operatingCapacity:projectOperatingCapacity(s.operatingCapacity,s,generated)}:{}),...(Object.hasOwn(s,'marketAdmissionAgePolicy')?{marketAdmissionAge:projectMigrationAdmission(s.marketAdmissionAgePolicy,s,generated)}:{})};
}
export function validateFinancialPolicyReporting(value:unknown,generated:number):FinancialPolicyReporting {
 const p=exact(value,'version risk execution valuation'+(Object.hasOwn(record(value),'operatingCapacity')?' operatingCapacity':'')+(Object.hasOwn(record(value),'marketAdmissionAge')?' marketAdmissionAge':''));need(p.version===FINANCIAL_POLICY_REPORTING_VERSION);
 if(p.risk!==null)validateFinancialRiskReporting(p.risk,generated);
 if(p.execution!==null)validateFinancialExecutionReporting(p.execution,generated);
 if(p.valuation!==null)validateFinancialValuationReporting(p.valuation,generated);
 if(Object.hasOwn(p,'operatingCapacity')&&p.operatingCapacity!==null)validateOperatingCapacityReporting(p.operatingCapacity,generated);
 if(Object.hasOwn(p,'marketAdmissionAge')&&p.marketAdmissionAge!==null)validateMigrationAdmissionReporting(p.marketAdmissionAge,generated);
 need(JSON.stringify(p).length<=8192);return p as FinancialPolicyReporting;
}
export const FINANCIAL_EXECUTION_REPORTING_VERSION='paper-chain-conditioned-v1' as const;
export const FINANCIAL_EXECUTION_STAGES=['planned','landing-state-supported','preflight-unsubmitted','legacy-protection-fallback'] as const;
export const FINANCIAL_EXECUTION_REASONS=['PLAN_PREPARED','LANDING_STATE_SUPPORTED','LANDING_STATE_UNAVAILABLE','UNSIGNED_CONSTRUCTION_UNAVAILABLE','SIMULATED_ACCOUNT_RENT_UNAVAILABLE','LEGACY_HELD_ACCOUNT_MODEL','PLAN_CONSTRUCTION_UNAVAILABLE','PLAN_DELAY_EXCEEDS_DECISION_LIFETIME','PLAN_FEE_MISMATCH'] as const;
export type FinancialExecutionReporting={version:typeof FINANCIAL_EXECUTION_REPORTING_VERSION;state:'active'|'unavailable';scope:'current-market-instance';plans:number;supportedLandingStates:number;preflightUnsubmitted:number;unknownLanding:number;legacyProtectionFallbacks:number;last:null|{at:string;stage:typeof FINANCIAL_EXECUTION_STAGES[number];reasonCode:typeof FINANCIAL_EXECUTION_REASONS[number];observedRpcMs:number|null;modeledDelayMs:number|null;feeSol:string|null;sourceSlot:number|null};meaning:'PAPER_PREPARATION_NOT_OBSERVED_CHAIN_OUTCOME'};
export function validateFinancialExecutionReporting(value:unknown,generated:number):FinancialExecutionReporting {
 const e=exact(value,'version state scope plans supportedLandingStates preflightUnsubmitted unknownLanding legacyProtectionFallbacks last meaning');
 need(e.version===FINANCIAL_EXECUTION_REPORTING_VERSION&&['active','unavailable'].includes(e.state)&&e.scope==='current-market-instance'&&e.meaning==='PAPER_PREPARATION_NOT_OBSERVED_CHAIN_OUTCOME');
 for(const key of ['plans','supportedLandingStates','preflightUnsubmitted','unknownLanding','legacyProtectionFallbacks'])count(e[key]);
 if(e.last!==null){const l=exact(e.last,'at stage reasonCode observedRpcMs modeledDelayMs feeSol sourceSlot');time(l.at,generated);need((FINANCIAL_EXECUTION_STAGES as readonly unknown[]).includes(l.stage)&&(FINANCIAL_EXECUTION_REASONS as readonly unknown[]).includes(l.reasonCode));
  const pairs={planned:['PLAN_PREPARED'],'landing-state-supported':['LANDING_STATE_SUPPORTED'],'preflight-unsubmitted':['LANDING_STATE_UNAVAILABLE','PLAN_CONSTRUCTION_UNAVAILABLE','PLAN_DELAY_EXCEEDS_DECISION_LIFETIME','PLAN_FEE_MISMATCH'],'legacy-protection-fallback':['UNSIGNED_CONSTRUCTION_UNAVAILABLE','SIMULATED_ACCOUNT_RENT_UNAVAILABLE','LEGACY_HELD_ACCOUNT_MODEL']};need(pairs[l.stage as keyof typeof pairs].includes(l.reasonCode));
  for(const key of ['observedRpcMs','modeledDelayMs'])if(l[key]!==null)need(typeof l[key]==='number'&&Number.isFinite(l[key])&&l[key]>=0&&l[key]<=86400000);
  if(l.sourceSlot!==null)count(l.sourceSlot);solAmount(l.feeSol,true);
 }
 return e as FinancialExecutionReporting;
}
function projectExecution(value:unknown,generated:number):FinancialExecutionReporting|null {
 try{const e=record(value);need(e.version===FINANCIAL_EXECUTION_REPORTING_VERSION);const l=record(e.last);
  return validateFinancialExecutionReporting({version:e.version,state:e.state,scope:e.scope,plans:e.plans,supportedLandingStates:e.supportedLandingStates,preflightUnsubmitted:e.preflightUnsubmitted,unknownLanding:e.unknownLanding,legacyProtectionFallbacks:e.legacyProtectionFallbacks,last:e.last===null?null:{at:iso(l.at,generated),stage:l.stage,reasonCode:l.reasonCode,observedRpcMs:l.observedRpcMs,modeledDelayMs:l.modeledDelayMs,feeSol:l.feeLamports===null?null:sol(l.feeLamports),sourceSlot:l.sourceSlot},meaning:'PAPER_PREPARATION_NOT_OBSERVED_CHAIN_OUTCOME'},generated);
 }catch{return null;}
}
export const FINANCIAL_VALUATION_REPORTING_VERSION='paper-sol-usd-observation-v1' as const;
export const FINANCIAL_VALUATION_REASONS=['USD_PRICE_RECEIVED','USD_PRICE_HTTP_STATUS','USD_PRICE_TIMEOUT','USD_PRICE_TRANSPORT','USD_PRICE_RESPONSE_TOO_LARGE','USD_PRICE_EMPTY','USD_PRICE_INVALID','USD_PRICE_NONPOSITIVE'] as const;
export type FinancialValuationReporting={version:typeof FINANCIAL_VALUATION_REPORTING_VERSION;scope:'current-source-instance';failuresByReason:Partial<Record<typeof FINANCIAL_VALUATION_REASONS[number],number>>;lastObservation:null|{source:'coinbase-public-sol-usd';startedAt:string;completedAt:string;durationMs:number;outcome:'received'|'unavailable';reasonCode:typeof FINANCIAL_VALUATION_REASONS[number];httpStatus:number|null;receivedAt:string|null;publicationTimeKnown:false}};
export function validateFinancialValuationReporting(value:unknown,generated:number):FinancialValuationReporting {
 const u=exact(value,'version scope failuresByReason lastObservation');need(u.version===FINANCIAL_VALUATION_REPORTING_VERSION&&u.scope==='current-source-instance');
 const counts=record(u.failuresByReason);need(u.failuresByReason&&typeof u.failuresByReason==='object'&&!Array.isArray(u.failuresByReason));for(const [code,n]of Object.entries(counts)){need(code!=='USD_PRICE_RECEIVED'&&(FINANCIAL_VALUATION_REASONS as readonly string[]).includes(code));count(n);}
 if(u.lastObservation!==null){const l=exact(u.lastObservation,'source startedAt completedAt durationMs outcome reasonCode httpStatus receivedAt publicationTimeKnown');time(l.startedAt,generated);time(l.completedAt,generated);time(l.receivedAt,generated,true);need(l.startedAt<=l.completedAt&&l.source==='coinbase-public-sol-usd'&&l.publicationTimeKnown===false&&['received','unavailable'].includes(l.outcome)&&(FINANCIAL_VALUATION_REASONS as readonly unknown[]).includes(l.reasonCode));
  need(typeof l.durationMs==='number'&&Number.isFinite(l.durationMs)&&l.durationMs>=0&&l.durationMs<=86400000);if(l.httpStatus!==null){count(l.httpStatus,599);need(l.httpStatus>=100);}
  need(l.outcome==='received'?l.reasonCode==='USD_PRICE_RECEIVED'&&l.receivedAt!==null&&l.receivedAt>=l.startedAt&&l.receivedAt<=l.completedAt:l.reasonCode!=='USD_PRICE_RECEIVED'&&l.receivedAt===null);
 }
 return u as FinancialValuationReporting;
}
function projectValuation(value:unknown,generated:number):FinancialValuationReporting|null {
 try{const u=record(value),l=record(u.lastObservation),counts:Record<string,number>={};need(Object.hasOwn(u,'lastObservation'));
  for(const code of FINANCIAL_VALUATION_REASONS){const n=record(u.failuresByReason)[code];if(code!=='USD_PRICE_RECEIVED'&&Number.isSafeInteger(n)&&n>=0)counts[code]=n;}
  return validateFinancialValuationReporting({version:FINANCIAL_VALUATION_REPORTING_VERSION,scope:'current-source-instance',failuresByReason:counts,lastObservation:u.lastObservation===null?null:{source:l.source,startedAt:iso(l.startedAt,generated),completedAt:iso(l.completedAt,generated),durationMs:l.durationMs,outcome:l.outcome,reasonCode:l.reasonCode,httpStatus:l.httpStatus,receivedAt:l.receivedAt===null?null:iso(l.receivedAt,generated),publicationTimeKnown:l.publicationTimeKnown}},generated);
 }catch{return null;}
}
