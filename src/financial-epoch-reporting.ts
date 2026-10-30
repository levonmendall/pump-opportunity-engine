/** Public, source-owned epoch receipt. Capital restatement is never trading P&L. */
import {isDeepStrictEqual} from 'node:util';
type FinancialEpochFields={
 activatedAt:string;
 initialSol:'10.000000000';contributionSol:'10.000000000';initialUsd:number;solPriceUsd:number;priceAt:string;
 priorEquitySol:string;priorArchivedCashSol:string;priorArchivedDepositsSol:string;priorRealizedPnlSol:string;priorExecutionCostsSol:string;
 capitalAdjustmentSol:string;priorStateSha256:string;backupSha256:string;
};
export type LegacyFinancialEpochReport=FinancialEpochFields&{version:'poe-paper-epoch-v1';id:'poe-paper-10sol-20261030'};
export type V3FinancialEpochReport=FinancialEpochFields&{version:'poe-paper-epoch-v3';id:'poe-paper-10sol-v3-20261030';priorEpoch:LegacyFinancialEpochReport};
export type FinancialEpochReport=LegacyFinancialEpochReport|V3FinancialEpochReport;
/** Immutable source receipts in chronological order; contributions are not returns. */
export function financialEpochLineage(epoch:FinancialEpochReport):FinancialEpochReport[]{return epoch.version==='poe-paper-epoch-v3'?[epoch.priorEpoch,epoch]:[epoch];}
export const financialEpochEqual=(a:FinancialEpochReport|undefined|null,b:FinancialEpochReport|undefined|null)=>isDeepStrictEqual(a,b);
export function financialEpochTransitionAllowed(previous:FinancialEpochReport|undefined|null,next:FinancialEpochReport|undefined|null){return !previous||!!next&&(isDeepStrictEqual(previous,next)||next.version==='poe-paper-epoch-v3'&&isDeepStrictEqual(previous,next.priorEpoch));}
const iso=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const amount=(value:unknown,signed=false):value is string=>typeof value==='string'&&(signed?/^-?(0|[1-9]\d{0,20})(\.\d{1,9})?$/:/^(0|[1-9]\d{0,20})(\.\d{1,9})?$/).test(value)&&value!=='-0';
const atoms=(value:string)=>{const negative=value.startsWith('-'),[whole,part='']=(negative?value.slice(1):value).split('.');return (negative?-1n:1n)*(BigInt(whole!)*1000000000n+BigInt(part.padEnd(9,'0')));};
function sol(value:string){const n=BigInt(value),a=n<0n?-n:n;return (n<0n?'-':'')+(a/1000000000n).toString()+'.'+(a%1000000000n).toString().padStart(9,'0');}
export function validateFinancialEpochReport(value:unknown,generatedAt:string):FinancialEpochReport {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('EPOCH_REPORT_OBJECT_REQUIRED');
 const v=value as Record<string,unknown>,v3=v.version==='poe-paper-epoch-v3',keys=['version','id','activatedAt','initialSol','contributionSol','initialUsd','solPriceUsd','priceAt','priorEquitySol','priorArchivedCashSol','priorArchivedDepositsSol','priorRealizedPnlSol','priorExecutionCostsSol','capitalAdjustmentSol','priorStateSha256','backupSha256',...(v3?['priorEpoch']:[])];
 if(Object.keys(v).sort().join('|')!==keys.sort().join('|')||!(v3?v.id==='poe-paper-10sol-v3-20261030':v.version==='poe-paper-epoch-v1'&&v.id==='poe-paper-10sol-20261030')||v.initialSol!=='10.000000000'||v.contributionSol!=='10.000000000')throw Error('EPOCH_REPORT_FIELDS');
 if(!iso(generatedAt)||!iso(v.activatedAt)||!iso(v.priceAt)||Date.parse(v.priceAt)>Date.parse(v.activatedAt)||Date.parse(v.activatedAt)-Date.parse(v.priceAt)>10000||Date.parse(v.activatedAt)>Date.parse(generatedAt))throw Error('EPOCH_REPORT_TIME');
 if(typeof v.initialUsd!=='number'||!Number.isFinite(v.initialUsd)||v.initialUsd<=0||typeof v.solPriceUsd!=='number'||!Number.isFinite(v.solPriceUsd)||v.solPriceUsd<=0||Math.round(v.initialUsd*1e6)!==10*Math.round(v.solPriceUsd*1e6))throw Error('EPOCH_REPORT_VALUATION');
 if(!amount(v.priorEquitySol)||!amount(v.priorArchivedCashSol)||!amount(v.priorArchivedDepositsSol)||atoms(v.priorArchivedCashSol)+atoms(v.priorArchivedDepositsSol)!==atoms(v.priorEquitySol)||!amount(v.priorRealizedPnlSol,true)||!amount(v.priorExecutionCostsSol)||!amount(v.capitalAdjustmentSol,true)||atoms(v.priorEquitySol)+atoms(v.capitalAdjustmentSol)!==10000000000n)throw Error('EPOCH_REPORT_CAPITAL');
 if(v3){if(!v.priorEpoch||typeof v.priorEpoch!=='object'||(v.priorEpoch as Record<string,unknown>).version!=='poe-paper-epoch-v1')throw Error('EPOCH_REPORT_PRIOR_EPOCH');const prior=validateFinancialEpochReport(v.priorEpoch,v.activatedAt as string);if(prior.version!=='poe-paper-epoch-v1'||Date.parse(prior.activatedAt)>=Date.parse(v.activatedAt as string)||atoms(v.priorExecutionCostsSol as string)<atoms(prior.priorExecutionCostsSol))throw Error('EPOCH_REPORT_PRIOR_EPOCH');}
 if(![v.priorStateSha256,v.backupSha256].every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)))throw Error('EPOCH_REPORT_PROOF');
 return structuredClone(v) as FinancialEpochReport;
}
type EpochInput={version:string;id:string;startedAt:number;initialLamports:string;contributionLamports:string;archivedAssets:{cashLamports:string;lockedDeposits:Record<string,string>};initialMicroUsd:string;price:{at:number;microUsdPerSol:string};priorStateSha256:string;backupSha256:string;priorRealizedLamports:string;priorExecutionCostsLamports:string;capitalAdjustmentLamports:string;priorEpoch?:EpochInput};
export function financialEpochReport(epoch:EpochInput,generatedAt:number):FinancialEpochReport {
 return validateFinancialEpochReport({...(epoch.priorEpoch?{priorEpoch:financialEpochReport(epoch.priorEpoch,epoch.startedAt)}:{}),version:epoch.version,id:epoch.id,activatedAt:new Date(epoch.startedAt).toISOString(),initialSol:sol(epoch.initialLamports),contributionSol:sol(epoch.contributionLamports),initialUsd:Number(BigInt(epoch.initialMicroUsd))/1e6,solPriceUsd:Number(BigInt(epoch.price.microUsdPerSol))/1e6,priceAt:new Date(epoch.price.at).toISOString(),priorEquitySol:sol((BigInt(epoch.initialLamports)-BigInt(epoch.capitalAdjustmentLamports)).toString()),priorArchivedCashSol:sol(epoch.archivedAssets.cashLamports),priorArchivedDepositsSol:sol(Object.values(epoch.archivedAssets.lockedDeposits).reduce((sum,v)=>sum+BigInt(v),0n).toString()),priorRealizedPnlSol:sol(epoch.priorRealizedLamports),priorExecutionCostsSol:sol(epoch.priorExecutionCostsLamports),capitalAdjustmentSol:sol(epoch.capitalAdjustmentLamports),priorStateSha256:epoch.priorStateSha256,backupSha256:epoch.backupSha256},new Date(generatedAt).toISOString());
}
