/** Reporting-only decomposition from one ledger projection. No writer or market request. */
import type {PaperLedger,UsdPrice} from './ledger.js';
import {OPERATING_REPORTING_BASIS} from './ledger.js';
type Projection=ReturnType<PaperLedger['projection']>;
const MAX=(1n<<127n)-1n,L=1000000000n;
const signed=(v:string|null)=>{if(v===null)return null;if(typeof v!=='string'||!/^(-?(0|[1-9][0-9]*))$/.test(v))throw Error('operating PnL integer required');const n=BigInt(v);if(n>MAX||n< -MAX)throw Error('operating PnL range');return n;};
function currentPrice(price:UsdPrice|null,at:number){if(!price||!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(price.at)||price.at<0||price.at>at||at-price.at>10000||typeof price.source!=='string'||!price.source||price.source.length>512||/[\u0000-\u001f]/.test(price.source)||typeof price.microUsdPerSol!=='string'||!/^(0|[1-9][0-9]*)$/.test(price.microUsdPerSol))return null;const n=BigInt(price.microUsdPerSol);return n>0n&&n<=MAX?n:null;}
export function operatingPnlReporting(input:{at:number;projection:Projection;price:UsdPrice|null;valuationUsable:boolean}){
 if(!Number.isSafeInteger(input.at)||input.at<0||typeof input.valuationUsable!=='boolean')throw Error('operating PnL observation required');
 const p=input.projection,net=signed(p.totalPnlLamports),valid=input.valuationUsable&&!p.unknownMarks&&net!==null,price=currentPrice(input.price,input.at),translated=valid&&price!==null&&p.usdValuationAvailable?net*price/L:null;
 if(translated!==null&&(translated>MAX||translated< -MAX))throw Error('operating PnL translation range');
 const cost=signed(p.operatingCostsMicroUsd);if(cost!==null&&cost<0n)throw Error('negative operating cost');
 const dollarState=price!==null&&p.usdValuationAvailable,overall=dollarState&&input.valuationUsable?signed(p.totalPnlMicroUsd):null,overallEconomic=dollarState&&input.valuationUsable?signed(p.economicPnlMicroUsd):null,passive=dollarState?signed(p.solPriceEffectMicroUsd):null,afterCosts=translated!==null&&cost!==null?translated-cost:null;
 if(afterCosts!==null&&(afterCosts>MAX||afterCosts< -MAX))throw Error('operating PnL cost range');
 return {schemaVersion:2 as const,basis:OPERATING_REPORTING_BASIS,at:input.at,netTokenTradingLamports:valid?net.toString():null,currentUsdTranslationMicroUsd:translated?.toString()??null,tokenTradingAfterOperatingCostsMicroUsd:afterCosts?.toString()??null,passiveSolPriceEffectMicroUsd:passive?.toString()??null,overallEquityChangeMicroUsd:overall?.toString()??null,overallEconomicPnlMicroUsd:overallEconomic?.toString()??null,operatingCostsMicroUsd:cost?.toString()??null,operatingCostClassification:p.operatingCostClassification,usdPriceAt:dollarState?input.price!.at:null,modeledExecutionCostsLamports:p.executionCostsLamports,meaning:'Net token-trading SOL result translated at the current verified SOL/USD rate; not historical realized USD. Modeled execution costs are already included in net token result. Passive initial SOL valuation is separate; unknown operating costs remain unknown.'};
}

/** Cumulative ledger outcomes plus current unrealized result, across all epochs.
 * Archived cash and every capital contribution are excluded from trading P&L. */
export function lifetimeTradingReporting(input:{at:number;projection:Projection;price:UsdPrice|null;valuationUsable:boolean}){
 const p=input.projection,realized=signed(p.lifetimeRealizedLamports)!,currentRealized=signed(p.realizedLamports)!,currentNet=signed(p.totalPnlLamports),unrealized=input.valuationUsable&&!p.unknownMarks&&currentNet!==null?currentNet-currentRealized:null,net=unrealized===null?null:realized+unrealized,price=currentPrice(input.price,input.at);
 const sol=(v:bigint)=>{const a=v<0n?-v:v;return (v<0n?'-':'')+(a/L).toString()+'.'+(a%L).toString().padStart(9,'0');};
 return {basis:'lifetime-token-trading-excludes-capital-contributions' as const,realizedSol:sol(realized),unrealizedSol:unrealized===null?null:sol(unrealized),netSol:net===null?null:sol(net),executionCostsSol:sol(signed(p.lifetimeExecutionCostsLamports)!),currentUsdTranslation:net!==null&&price!==null&&p.usdValuationAvailable?Number(net*price/L)/1e6:null,priceAt:price!==null&&p.usdValuationAvailable?new Date(input.price!.at).toISOString():null};
}
