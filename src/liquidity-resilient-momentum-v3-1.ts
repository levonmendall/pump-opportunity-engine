/** V3.1 entry economics. Pure, decision-time arithmetic over existing audited
 * evidence. Conditional scenarios and robustness budgets are NOT probabilities,
 * expected returns, fills, or calibrated estimates of future profitability. */
import {createHash} from 'node:crypto';
import type {FlowFeatures,NormalizedTrade} from './strategy.js';
import {adaptiveMigrationEligible,adaptiveReentryEligible,type AdaptiveRuleContext} from './adaptive-momentum-v2.js';
import {
 assessLiquidityResilientBuying,deriveV3Consolidation,v3CpmmBuy,v3CpmmSell,
 evaluateLiquidityResilientExit,LIQUIDITY_RESILIENT_MOMENTUM_V3_POLICY,
 type V3AuditedFlow,type V3MarketEvidence,type V3Evidence,type V3Components,
 type V3BuyingAssessment,type V3Dimension,type V3SellScenario,type V3ConsolidationEvidence,type V3ExitInput,
} from './liquidity-resilient-momentum-v3.js';

export const LIQUIDITY_RESILIENT_MOMENTUM_V3_1_VERSION='liquidity-resilient-momentum-v3.1' as const;
export const LIQUIDITY_RESILIENT_MOMENTUM_V3_1_POLICY=Object.freeze({
 version:LIQUIDITY_RESILIENT_MOMENTUM_V3_1_VERSION,mode:'PAPER',liveTradingEnabled:false,
 calibration:'UNCALIBRATED_CONDITIONAL_ROBUSTNESS_NOT_EXPECTED_RETURN',
 sizing:Object.freeze({entryConsumedCostBps:500,refundableDepositsIncluded:false,selection:'highest-positive-joint-conditional-SOL-balance-among-tested-exact-sizes',minimumDollarAllocation:null}),
 demand:Object.freeze({minimumWalletCount:null,minimumNetFlowShareBps:null,minimumPositiveBuckets:null,ownership:'UNKNOWN; distinct addresses do not prove independent beneficial ownership'}),
 continuation:Object.freeze({ageRouting:false,minimumRecentPositiveBuckets:null,nonnegativePriceVeto:false,model:'Arithmetic midpoint of observed60s net demand and twice observed latest30s net demand, floored at zero. The one-half midpoint is a declared scenario assumption, not a probability, fitted coefficient or forecast.'}),
 economics:Object.freeze({minimumNetSurplusBps:null,maximumStressLossBps:null,
  decision:'Positive conditional after-cost upside less observed adverse-loss budget, HHI-scaled excess plausible-purchase loss and an observed adverse-price replay budget. Budgets are robustness tradeoffs, never accounting charges or expected losses.',
  concentration:'Wallet volume HHI scales only excess plausible-purchase uncertainty; it is not a beneficial-ownership probability. Directly observed account balances remain point-in-time, potentially already disposed.',
  weakStress:'Unobserved same-size seller and historical maximum/sale repeats remain explicit diagnostic scenarios; they are not independent admission vetoes.',
  frontier:'Finite integer geometric probes and local interval refinement; bit-length bounds arithmetic work, not trading size. Highest tested positive balance, without a global optimum claim.'}),
 exit:Object.freeze({...LIQUIDITY_RESILIENT_MOMENTUM_V3_POLICY.exit,stopLossBps:2500,trailingMinimumBps:2500}),
 exitPolicy:'OWNER_AUTHORIZED_PAPER_V31_25_PERCENT_COST_STOP_AND_MINIMUM_TRAIL; V3 15-percent exit remains unchanged; profit, flow and liquidity protection stay active',
 limitations:Object.freeze([...LIQUIDITY_RESILIENT_MOMENTUM_V3_POLICY.limitations,
  'Scenario-conditioned net upside is not a predicted return; robustness budgets are uncalibrated and forward economic performance remains unproven.',
  'A point-in-time account observation is not verified current sellable inventory; intervening unseen transfers remain unknown.',
  'Finite sizing search reports only the best tested integer size; it cannot prove global optimality or that no untested economic size exists.']),
});
export const LIQUIDITY_RESILIENT_MOMENTUM_V3_1_SHA256=createHash('sha256').update(JSON.stringify(LIQUIDITY_RESILIENT_MOMENTUM_V3_1_POLICY)).digest('hex');
// Same constants under the compact spelling used by the runtime integration.
export const LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION=LIQUIDITY_RESILIENT_MOMENTUM_V3_1_VERSION;
export const LIQUIDITY_RESILIENT_MOMENTUM_V31_POLICY=LIQUIDITY_RESILIENT_MOMENTUM_V3_1_POLICY;
export const LIQUIDITY_RESILIENT_MOMENTUM_V31_SHA256=LIQUIDITY_RESILIENT_MOMENTUM_V3_1_SHA256;
export type V31Evidence=V3Evidence;
export type V31EconomicBalance={
 classification:'UNCALIBRATED_CONDITIONAL_ROBUSTNESS_NOT_EXPECTED_RETURN';
 wholeWindowNetLamports:string;normalizedRecentNetLamports:string;midpointRenewalLamports:string;
 conditionalLiquidationLamports:string;conditionalNetSurplusLamports:string;
 observedAdverseLossLamports:string;plausiblePurchaseLossLamports:string;
 concentrationPenaltyBps:number;plausibleExcessUncertaintyLamports:string;adversePriceReplayLamports:string;
 jointConditionalBalanceLamports:string;minimumSurplusBps:null;maximumStressLossBps:null;
};
export type V31Components=V3Components&{economicBalance:V31EconomicBalance|null;sizingReason:'normal-equity-baseline'|'liquidity-economics'|'cash-affordability';
 continuationEvidence:{wholeWindowNetLamports:string;normalizedRecentNetLamports:string;midpointRenewalLamports:string;priceReturnBps:number|null;recentPositiveBuckets:number;priorConsolidationVerified:boolean};
};
export type V31BuyingAssessment=Omit<V3BuyingAssessment,'components'>&{components:V31Components|null;assessmentModel:'JOINT_CONDITIONAL_ECONOMICS; dimensions are descriptive, not four independent vetoes'};
export type V31SellScenario=V3SellScenario&{riskEvidence:'current-liquidation'|'point-in-time-observed-account'|'observed-reserve-depth-change'|'plausible-undisposed-purchases'|'historical-diagnostic'|'unknown-inventory-diagnostic';requestedExternalSellBaseUnits?:string};
type Pool=Parameters<typeof v3CpmmBuy>[0];
type Prepared={features:FlowFeatures;flow:V3AuditedFlow;components:V31Components;renewal:bigint;net:bigint;recent:bigint;buyerAmounts:bigint[];largestExecutedSell:bigint;reserveMinimum:bigint|null;reserveMaximum:bigint|null;reserveCount:number};
const P=LIQUIDITY_RESILIENT_MOMENTUM_V3_1_POLICY;
const uint=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f]/.test(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const amount=(v:string)=>{if(!money(v))throw Error('V31_AMOUNT');return BigInt(v);};
const signed=(v:string)=>{if(typeof v!=='string'||!/^(-?[1-9][0-9]{0,38}|0)$/.test(v))throw Error('V31_SIGNED_AMOUNT');return BigInt(v);};
const max=(a:bigint,b:bigint)=>a>b?a:b;
const loss=(cost:bigint,net:bigint)=>max(0n,cost-net);
const bps=(n:bigint,d:bigint)=>d<=0n?0:Number(n*10000n/d>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):n*10000n/d<BigInt(Number.MIN_SAFE_INTEGER)?BigInt(Number.MIN_SAFE_INTEGER):n*10000n/d);
const dimension=(status:V3Dimension['status'],reason:string):V3Dimension=>({status,reason});
const dimensions=()=>({genuineDemand:dimension('unavailable','complete-audited-trades-required'),liquidityResilience:dimension('unavailable','fresh-exact-size-pool-required'),continuation:dimension('unavailable','audited-temporal-evidence-required'),netEconomics:dimension('unavailable','fresh-exact-size-net-economics-required')});
function result(features:FlowFeatures|null,status:V31BuyingAssessment['status'],reason:string,components:V31Components|null=null,assessments=dimensions()):V31BuyingAssessment{
 return {status,reason,qualified:false,features,scoreBps:null,components,assessments,limitations:P.limitations,assessmentModel:'JOINT_CONDITIONAL_ECONOMICS; dimensions are descriptive, not four independent vetoes'};
}
function prepare(features:FlowFeatures,now:number,flow:V3AuditedFlow):Prepared|null{
 // Reuse the existing strict audit/aggregate/identity checks and descriptive
 // capital/inventory extraction. None of V3's four admission vetoes is reused.
 const old=assessLiquidityResilientBuying(features,now,{flow});if(!old.components||!old.features)return null;
 const c=structuredClone(old.components),net=signed(features.netBuyLamports),recent=signed(c.recentNetBuyLamports)*2n;
 const renewal=max(0n,(net+recent)/2n),prior=flow.priorConsolidation;
 const buyerAmounts=new Map<string,bigint>();let largestExecutedSell=0n;let low=flow.trades[0],high=low;for(const t of flow.trades){if(t.side==='buy')buyerAmounts.set(t.wallet,(buyerAmounts.get(t.wallet)??0n)+amount(t.quoteLamports));else largestExecutedSell=max(largestExecutedSell,amount(t.tokenUnits));if(high&&amount(t.quoteLamports)*amount(high.tokenUnits)>amount(high.quoteLamports)*amount(t.tokenUnits))high=t;if(low&&amount(t.quoteLamports)*amount(low.tokenUnits)<amount(low.quoteLamports)*amount(t.tokenUnits))low=t;}
 const currentRange=low&&high?bps(amount(high.quoteLamports)*amount(low.tokenUnits)-amount(low.quoteLamports)*amount(high.tokenUnits),amount(low.quoteLamports)*amount(high.tokenUnits)):0;
 const priorVerified=!!prior&&prior.mint===flow.mint&&prior.pool===flow.pool&&uint(prior.windowStartAt)&&uint(prior.windowEndAt)&&prior.windowEndAt-prior.windowStartAt===60000&&prior.windowEndAt<=features.windowStartAt&&uint(prior.auditedAt)&&prior.auditedAt>=prior.windowEndAt&&prior.auditedAt<=now&&text(prior.auditEvidence)&&uint(prior.priceRangeBps)&&prior.priceRangeBps<currentRange&&Number.isSafeInteger(prior.netFlowShareBps)&&Math.abs(prior.netFlowShareBps)<Math.abs(c.netFlowShareBps)&&!!features.lastPrice&&money(prior.highPrice?.quoteLamports)&&money(prior.highPrice?.tokenUnits)&&amount(prior.highPrice.tokenUnits)>0n&&amount(features.lastPrice.quoteLamports)*amount(prior.highPrice.tokenUnits)>amount(prior.highPrice.quoteLamports)*amount(features.lastPrice.tokenUnits)&&recent>0n;
 c.pattern=priorVerified?'audited-reacceleration':renewal>0n?'audited-continuation':'unproven';c.renewedDemandScenarioLamports=renewal.toString();
 let reserveMinimum:bigint|null=null,reserveMaximum:bigint|null=null,reserveCount=0;for(const r of flow.reserveObservations??[])if(r&&uint(r.at)&&r.at>=features.windowStartAt&&r.at<=now&&text(r.evidence)&&money(r.rawQuoteReserveLamports)&&amount(r.rawQuoteReserveLamports)>0n&&money(r.baseReserveUnits)&&amount(r.baseReserveUnits)>0n&&typeof r.virtualQuoteReserveLamports==='string'&&/^(-?[1-9][0-9]{0,38}|0)$/.test(r.virtualQuoteReserveLamports)&&amount(r.rawQuoteReserveLamports)+BigInt(r.virtualQuoteReserveLamports)>0n){const q=amount(r.rawQuoteReserveLamports);reserveMinimum=reserveMinimum===null||q<reserveMinimum?q:reserveMinimum;reserveMaximum=reserveMaximum===null||q>reserveMaximum?q:reserveMaximum;reserveCount++;}
 return {features:old.features,flow,renewal,net,recent,buyerAmounts:[...buyerAmounts.values()],largestExecutedSell,reserveMinimum,reserveMaximum,reserveCount,components:{...c,economicBalance:null,sizingReason:'normal-equity-baseline',continuationEvidence:{wholeWindowNetLamports:net.toString(),normalizedRecentNetLamports:recent.toString(),midpointRenewalLamports:renewal.toString(),priceReturnBps:features.priceReturnBps,recentPositiveBuckets:c.recentPositiveBuckets,priorConsolidationVerified:priorVerified}}};
}
function marketPool(m:V3MarketEvidence,flow:V3AuditedFlow,now:number):Pool{
 if(m.mint!==flow.mint||m.pool!==flow.pool||!text(m.evidence)||!uint(m.at)||m.at>now||now-m.at>P.exit.maximumQuoteAgeMs||!uint(m.slippageBps)||m.slippageBps>=10000||!m.fees||Object.keys(m.fees).sort().join(',')!=='creatorFeeBps,lpFeeBps,protocolFeeBps'||Object.values(m.fees).some(n=>!uint(n)||n>=10000)||Object.values(m.fees).reduce((n,v)=>n+v,0)>=10000)throw Error('V31_FRESH_MATCHED_POOL_REQUIRED');
 const pool={base:amount(m.baseReserveUnits),raw:amount(m.rawQuoteReserveLamports),virtual:signed(m.virtualQuoteReserveLamports),buckets:amount(m.feeBucketsLamports),fees:m.fees},cost=amount(m.buyInputLamports)+amount(m.entryGasLamports),maximum=amount(m.maximumConsumedLamports);
 if(pool.base<=0n||pool.raw<=0n||pool.raw+pool.virtual<=0n||pool.buckets>pool.raw||maximum===0n||cost>maximum)throw Error('V31_EXACT_EQUITY_CEILING_REQUIRED');
 amount(m.exitGasLamports);const buy=v3CpmmBuy(pool,amount(m.buyInputLamports));if(buy.output!==amount(m.expectedBaseUnits)||buy.curve!==amount(m.buyCurveInputLamports))throw Error('V31_SDK_QUOTE_ARITHMETIC_MISMATCH');return pool;
}
/** Greatest fee-valid opposing integer sale inside an evidenced inventory
 * bound. Real-vault debit is monotone; full sell success is not, because the
 * three independent fee ceilings create low-value dust holes. */
export function v31VaultBoundedOpposingSale(pool:Pool,requested:bigint):{units:bigint;pool:Pool;output:bigint}{
 const rates=Object.values(pool.fees);if(requested<0n||pool.base<=0n||pool.raw<=0n||pool.raw+pool.virtual<=0n||pool.buckets<0n||pool.buckets>pool.raw||rates.length!==3||rates.some(n=>!uint(n)||n>=10000)||rates.reduce((n,r)=>n+r,0)>=10000)throw Error('V31_OPPOSING_SALE_INPUT');
 if(requested===0n)return {units:0n,pool,output:0n};
 try{const sale=v3CpmmSell(pool,requested);return {units:requested,pool:sale.pool,output:sale.output};}catch{/* Find the real-vault boundary before considering fee dust. */}
 const quote=pool.raw+pool.virtual,gross=(units:bigint)=>quote*units/(pool.base+units),ceilFee=(n:bigint,rate:number)=>(n*BigInt(rate)+9999n)/10000n;
 let lo=0n,hi=requested;while(lo<hi){const mid=(lo+hi+1n)/2n,g=gross(mid);if(g-ceilFee(g,pool.fees.lpFeeBps)<=pool.raw-pool.buckets)lo=mid;else hi=mid-1n;}
 while(lo>0n){
  try{const sale=v3CpmmSell(pool,lo);return {units:lo,pool:sale.pool,output:sale.output};}catch{
   // Jump to the greatest integer input with a strictly smaller attainable
   // gross. Fee dust can occur only below3*10000/(10000-sum(fees)); this
   // arithmetic bound, rather than an arbitrary trading floor, bounds retries.
   const g=gross(lo);if(g===0n)break;const previous=(g*pool.base-1n)/(quote-g);lo=previous<lo?previous:lo-1n;
  }
 }
 return {units:0n,pool,output:0n};
}
function assessPrepared(p:Prepared,now:number,m?:V3MarketEvidence):V31BuyingAssessment{
 const {features:f,flow}=p,c=structuredClone(p.components),d=dimensions();
 d.genuineDemand=dimension(p.net>0n?'passed':'failed',p.net>0n?'positive-audited-demand; capital-concentration-and-ownership-uncertainty-retained':'net-selling-in-full-window; considered-jointly-with-recent-reacceleration');
 d.continuation=dimension(p.renewal>0n?'passed':'failed',c.pattern==='audited-reacceleration'?'observed-prior-consolidation-and-current-breakout; age-not-used':p.renewal>0n?'declared-observed-window-and-recent-demand-midpoint-scenario; no-price-sign-or-bucket-count-veto':'no-positive-declared-renewal-scenario');
 if(!m)return result(f,p.renewal>0n?'not-rejected':'failed',p.renewal>0n?'v3.1-audited-flow-ready-for-joint-exact-size-economics':'v3.1-no-positive-observed-renewal-scenario',c,d);
 let pool:Pool;try{pool=marketPool(m,flow,now);}catch{return result(f,'unavailable','v3.1-fresh-matched-exact-size-pool-and-quote-required',c,d);}
 const cost=amount(m.buyInputLamports)+amount(m.entryGasLamports),entry=v3CpmmBuy(pool,amount(m.buyInputLamports)),exitGas=amount(m.exitGasLamports);
 const liquidation=(state:Pool)=>{const sale=v3CpmmSell(state,entry.output),net=sale.output*BigInt(10000-m.slippageBps)/10000n;return {gross:sale.gross,net:max(0n,net-exitGas)};};
 c.proposedConsumedLamports=cost.toString();c.maximumConsumedLamports=m.maximumConsumedLamports;c.cashLimited=m.cashLimited===true;c.sizingReason=m.cashLimited===true?'cash-affordability':cost<amount(m.maximumConsumedLamports)?'liquidity-economics':'normal-equity-baseline';
 const dust=p.buyerAmounts.filter(q=>q*10000n<cost*100n);c.dustBuyerCount=dust.length;c.dustBuyVolumeBps=bps(dust.reduce((n,q)=>n+q,0n),amount(f.buyLamports));
 const largestPriorRaw=max(pool.raw,p.reserveMaximum??0n);c.reserveStability={observations:p.reserveCount,minimumRawQuoteLamports:p.reserveMinimum?.toString()??null,maximumRawQuoteLamports:p.reserveMaximum?.toString()??null};
 const scenarios:V31SellScenario[]=[];
 const recordScenario=(name:string,evidence:V31SellScenario['riskEvidence'],units:bigint,state?:Pool)=>{
  let stressed=state??entry.pool,admitted=units;
  if(units>0n){const opposing=v31VaultBoundedOpposingSale(stressed,units);admitted=opposing.units;stressed=opposing.pool;}
  try{const sale=liquidation(stressed);scenarios.push({name,riskEvidence:evidence,assumedExternalSellBaseUnits:admitted.toString(),...(admitted!==units?{requestedExternalSellBaseUnits:units.toString()}:{}),requiredForAdmission:evidence==='current-liquidation',grossCurveLamports:sale.gross.toString(),netLamports:sale.net.toString(),lossFromConsumedCostBps:bps(cost-sale.net,cost),executable:sale.net>0n,classification:'CONDITIONAL_CPMM_SCENARIO_NOT_OBSERVED_EXECUTION'});return sale.net;}catch{scenarios.push({name,riskEvidence:evidence,assumedExternalSellBaseUnits:admitted.toString(),requiredForAdmission:evidence==='current-liquidation',grossCurveLamports:null,netLamports:null,lossFromConsumedCostBps:null,executable:false,classification:'CONDITIONAL_CPMM_SCENARIO_NOT_OBSERVED_EXECUTION'});return 0n;}
 };
 const immediate=recordScenario('immediate-full-liquidation','current-liquidation',0n);c.immediateNetLamports=immediate.toString();c.scenarios=scenarios;
 if(immediate===0n){d.liquidityResilience=dimension('failed','current-complete-position-cannot-liquidate-net-of-costs');return result(f,'failed','v3.1-current-full-position-liquidation-not-executable',c,d);}
 const observed=recordScenario('point-in-time-observed-account-inventory','point-in-time-observed-account',amount(c.observedInventoryLargestBaseUnits));
 const plausible=recordScenario('plausible-undisposed-window-net-purchases','plausible-undisposed-purchases',amount(c.windowNetPurchasedLargestBaseUnits));
 const drain=max(0n,largestPriorRaw-pool.raw),remaining=max(0n,entry.pool.raw-drain),depth=drain===0n?immediate:recordScenario('repeat-observed-quote-depth-reduction','observed-reserve-depth-change',0n,{...entry.pool,raw:remaining});
 recordScenario('unknown-seller-as-large-as-proposed-position','unknown-inventory-diagnostic',entry.output);
 recordScenario('historical-largest-executed-sell-repeat','historical-diagnostic',p.largestExecutedSell);
 recordScenario('historical-maximum-account-repeat','historical-diagnostic',amount(c.historicalMaximumObservedAccountBaseUnits));
 const observedLoss=max(loss(cost,immediate),max(loss(cost,observed),loss(cost,depth))),plausibleLoss=loss(cost,plausible),concentration=10000-c.capitalDiversityBps,excess=max(0n,plausibleLoss-observedLoss)*BigInt(concentration)/10000n;
 const adversePriceBps=f.priceReturnBps===null?0:Math.min(10000,Math.max(0,-f.priceReturnBps)),priceBudget=cost*BigInt(adversePriceBps)/10000n;
 let continued:bigint;try{continued=liquidation(p.renewal>0n?v3CpmmBuy(entry.pool,p.renewal).pool:entry.pool).net;}catch{return result(f,'failed','v3.1-declared-continuation-scenario-not-executable',c,d);}
 const surplus=continued-cost,balance=surplus-observedLoss-excess-priceBudget;c.scenarioNetSurplusLamports=surplus.toString();c.scenarioNetSurplusBps=bps(surplus,cost);
 c.economicBalance={classification:'UNCALIBRATED_CONDITIONAL_ROBUSTNESS_NOT_EXPECTED_RETURN',wholeWindowNetLamports:p.net.toString(),normalizedRecentNetLamports:p.recent.toString(),midpointRenewalLamports:p.renewal.toString(),conditionalLiquidationLamports:continued.toString(),conditionalNetSurplusLamports:surplus.toString(),observedAdverseLossLamports:observedLoss.toString(),plausiblePurchaseLossLamports:plausibleLoss.toString(),concentrationPenaltyBps:concentration,plausibleExcessUncertaintyLamports:excess.toString(),adversePriceReplayLamports:priceBudget.toString(),jointConditionalBalanceLamports:balance.toString(),minimumSurplusBps:null,maximumStressLossBps:null};
 d.liquidityResilience=dimension('passed','current-exact-size-real-vault-executable; observed-and-uncertain-stress-losses-enter-joint-balance-without-a-percentage-veto');
 d.netEconomics=dimension(balance>0n?'passed':'failed',balance>0n?'conditional-after-cost-upside-exceeds-declared-adverse-and-uncertainty-budgets':'declared-joint-conditional-balance-does-not-clear-costs-and-risk-budgets');
 return result(f,balance>0n?'not-rejected':'failed',balance>0n?'v3.1-positive-joint-conditional-economic-balance; not-a-profit-forecast':'v3.1-nonpositive-joint-conditional-economic-balance',c,d);
}
export function assessLiquidityResilientBuyingV31(features:FlowFeatures,now:number,evidence?:V31Evidence):V31BuyingAssessment{
 if(!evidence)return result(features,'unavailable','v3.1-complete-audited-trades-required');const p=prepare(features,now,evidence.flow);return p?assessPrepared(p,now,evidence.market):result(features,'unavailable','v3.1-complete-matched-audited-trades-required');
}
export type V31RuleContext=AdaptiveRuleContext&{v3?:V31Evidence};
export type V31RuleDecision=Omit<V31BuyingAssessment,'status'|'qualified'>&{qualified:boolean;kind:'missing-data'|'market-exclusion'|'strategy-rejection'|'risk-rejection'|'qualified';ruleVersion:typeof LIQUIDITY_RESILIENT_MOMENTUM_V3_1_VERSION;at:number};
export function evaluateLiquidityResilientPrimaryV31(features:FlowFeatures,context:V31RuleContext):V31RuleDecision{
 const a=assessLiquidityResilientBuyingV31(features,context.now,context.v3),f=a.features;
 const decision=(kind:V31RuleDecision['kind'],reason:string):V31RuleDecision=>{const {status:_,qualified:__,...rest}=a;return {...rest,qualified:kind==='qualified',kind,reason,ruleVersion:LIQUIDITY_RESILIENT_MOMENTUM_V3_1_VERSION,at:context.now};};
 if(context.flowFieldsVerified!==true||!text(context.flowVerificationEvidence)||!f||f.mint!==context.mint)return decision('missing-data','v3.1-complete-verified-native-flow-required');
 if(!adaptiveMigrationEligible(context.migrationAt,context.migrationVerified,context.now)||context.migrationAt!>f.windowStartAt)return decision('missing-data','v3.1-verified-pre-window-migration-required');
 if(context.supportedPool!==true)return decision('market-exclusion','unsupported-pool');if(context.riskEntriesAllowed!==true)return decision('risk-rejection','entries-not-authorized-by-ledger');
 if(context.alreadyTradedMint&&!adaptiveReentryEligible(f,context.now,context.reentry))return decision('risk-rejection','fresh-closed-and-reconciled-round-trip-required');
 const q=context.quote,m=context.v3?.market;if(!q||!m||q.mint!==context.mint||!text(q.evidence)||q.evidence!==m.evidence||q.at!==m.at||q.expectedBaseUnits!==m.expectedBaseUnits)return decision('missing-data','v3.1-matched-fresh-actual-size-quote-required');
 if(!money(context.maximumConsumedCostMicroUsd)||amount(context.maximumConsumedCostMicroUsd)===0n||!money(q.allInInitialCostMicroUsd)||amount(q.allInInitialCostMicroUsd)===0n||amount(q.allInInitialCostMicroUsd)>amount(context.maximumConsumedCostMicroUsd))return decision('risk-rejection','current-equity-consumed-entry-allowance-required');
 if(a.status==='unavailable')return decision('missing-data',a.reason);if(a.status==='failed')return decision('strategy-rejection',a.reason);
 return a.components?.economicBalance?decision('qualified','v3.1-joint-conditional-economics-and-current-execution-checks-passed; accounting-and-fill-still-required'):decision('missing-data','v3.1-current-economic-assessment-required');
}
export type V31FrontierSelected={buyInputLamports:string;expectedBaseUnits:string;buyCurveInputLamports:string;proposedConsumedLamports:string};
export type V31FrontierCandidate=V31FrontierSelected&{status:V31BuyingAssessment['status'];reason:string;jointConditionalBalanceLamports:string|null};
export type V31SizeFrontier={selected:V31FrontierSelected|null;reason:string;assessment:V31BuyingAssessment;candidates:V31FrontierCandidate[];sourceEvidence:string;at:number;isGlobalOptimumCertified:false;search:{integerInputBits:number;testedSizes:number;maximumTests:number;method:'integer-geometric-probes-and-local-refinement';coverage:'BEST_TESTED_NOT_GLOBAL_OPTIMUM'}};
export function evaluateV31SizeFrontier(features:FlowFeatures,now:number,evidence:V31Evidence&{market:V3MarketEvidence}):V31SizeFrontier{
 const m=evidence.market,p=prepare(features,now,evidence.flow),initial=p?assessPrepared(p,now,m):result(features,'unavailable','v3.1-complete-matched-audited-trades-required'),bits=money(m.buyInputLamports)?amount(m.buyInputLamports).toString(2).length:0,maximumTests=4*bits+8;
 const output=(selected:V31FrontierSelected|null,reason:string,assessment:V31BuyingAssessment,candidates:V31FrontierCandidate[]):V31SizeFrontier=>({selected,reason,assessment,candidates,sourceEvidence:m.evidence,at:m.at,isGlobalOptimumCertified:false,search:{integerInputBits:bits,testedSizes:candidates.length,maximumTests,method:'integer-geometric-probes-and-local-refinement',coverage:'BEST_TESTED_NOT_GLOBAL_OPTIMUM'}});
 if(!p||initial.status==='unavailable')return output(null,initial.reason,initial,[]);let pool:Pool;try{pool=marketPool(m,evidence.flow,now);}catch{return output(null,initial.reason,initial,[]);}
 const candidates=new Map<string,{row:V31FrontierCandidate;assessment:V31BuyingAssessment}>();let best:{row:V31FrontierCandidate;assessment:V31BuyingAssessment;balance:bigint}|null=null;
 const evaluate=(input:bigint)=>{
  if(input<=0n||candidates.has(input.toString())||candidates.size>=maximumTests)return;let buy:ReturnType<typeof v3CpmmBuy>;try{buy=v3CpmmBuy(pool,input);}catch{return;}
  const quoted={...m,buyInputLamports:input.toString(),expectedBaseUnits:buy.output.toString(),buyCurveInputLamports:buy.curve.toString()},a=assessPrepared(p,now,quoted),row:V31FrontierCandidate={buyInputLamports:quoted.buyInputLamports,expectedBaseUnits:quoted.expectedBaseUnits,buyCurveInputLamports:quoted.buyCurveInputLamports,proposedConsumedLamports:(input+amount(m.entryGasLamports)).toString(),status:a.status,reason:a.reason,jointConditionalBalanceLamports:a.components?.economicBalance?.jointConditionalBalanceLamports??null};candidates.set(input.toString(),{row,assessment:a});
  const balance=row.jointConditionalBalanceLamports===null?null:BigInt(row.jointConditionalBalanceLamports);if(a.status==='not-rejected'&&balance!==null&&balance>0n&&(!best||balance>best.balance||balance===best.balance&&input>amount(best.row.buyInputLamports)))best={row,assessment:a,balance};
 };
 const maximum=amount(m.buyInputLamports);for(let input=maximum;input>0n;input/=2n)evaluate(input);
 // Refine around the best observed balance (or the least negative measured
 // point), never a fixed-dollar or percentage minimum. The input's finite bit
 // length bounds the work; rounding-scale islands remain explicitly unproven.
 const ordered=[...candidates.values()].filter(v=>v.row.jointConditionalBalanceLamports!==null).sort((a,b)=>amount(a.row.buyInputLamports)<amount(b.row.buyInputLamports)?-1:1);
 if(ordered.length){let peak=0;for(let i=1;i<ordered.length;i++)if(BigInt(ordered[i]!.row.jointConditionalBalanceLamports!)>BigInt(ordered[peak]!.row.jointConditionalBalanceLamports!))peak=i;
  let lo=peak===0?1n:amount(ordered[peak-1]!.row.buyInputLamports),hi=peak+1===ordered.length?maximum:amount(ordered[peak+1]!.row.buyInputLamports);
  for(let turn=0;turn<bits&&hi-lo>2n&&candidates.size+2<=maximumTests;turn++){
   const left=lo+(hi-lo)/3n,right=hi-(hi-lo)/3n;evaluate(left);evaluate(right);const a=candidates.get(left.toString())?.row.jointConditionalBalanceLamports,b=candidates.get(right.toString())?.row.jointConditionalBalanceLamports;
   if(a===null||a===undefined)lo=left+1n;else if(b===null||b===undefined)hi=right-1n;else if(BigInt(a)<BigInt(b))lo=left;else hi=right;
  }
  evaluate(lo);evaluate(hi);evaluate((lo+hi)/2n);
 }
 const chosen=best as {row:V31FrontierCandidate;assessment:V31BuyingAssessment;balance:bigint}|null,rows=[...candidates.values()].map(v=>v.row);
 return chosen?output({buyInputLamports:chosen.row.buyInputLamports,expectedBaseUnits:chosen.row.expectedBaseUnits,buyCurveInputLamports:chosen.row.buyCurveInputLamports,proposedConsumedLamports:chosen.row.proposedConsumedLamports},'v3.1-highest-positive-joint-conditional-balance-among-tested-exact-sizes',chosen.assessment,rows):output(null,'v3.1-no-positive-tested-size-economic-balance; untested-sizes-not-certified',initial,rows);
}
export const deriveV31Consolidation=deriveV3Consolidation;
/** V3.1 changes only the owner-authorized cost/trailing stop distances; other V3 holding protections remain. */
export const evaluateLiquidityResilientExitV31=(input:V3ExitInput)=>evaluateLiquidityResilientExit(input,P.exit);
export class V31AssessmentSeries{
 private readonly histories=new Map<string,{pool:string;windows:V3ConsolidationEvidence[]}>();private evictions=0;
 constructor(readonly maximumMints=174){if(!uint(maximumMints)||maximumMints<1||maximumMints>174)throw Error('V31_SERIES_CAPACITY');}
 clear(mint?:string){if(mint===undefined)this.histories.clear();else this.histories.delete(mint);}
 usage(){return {mints:this.histories.size,maximumMints:this.maximumMints,retentionEvictions:this.evictions,maximumWindowsPerMint:7,entryWaitingWindows:0};}
 observe(input:{features:FlowFeatures;now:number;flow:V3AuditedFlow;market?:V3MarketEvidence}):V31BuyingAssessment{
  const {features,now,flow,market}=input;let history=this.histories.get(features.mint);if(history?.pool!==flow.pool){this.histories.delete(features.mint);history=undefined;}
  const prior=history?.windows.filter(w=>w.windowEndAt<=features.windowStartAt&&w.auditedAt<=now).at(-1),result=assessLiquidityResilientBuyingV31(features,now,{flow:{...flow,...(prior?{priorConsolidation:prior}:{})},...(market?{market}:{})}),observed=deriveV3Consolidation(features,flow,now);
  if(observed){const windows=(history?.windows??[]).filter(w=>w.windowEndAt!==observed.windowEndAt);windows.push(observed);windows.sort((a,b)=>a.windowEndAt-b.windowEndAt);this.histories.delete(features.mint);this.histories.set(features.mint,{pool:flow.pool,windows:windows.slice(-7)});while(this.histories.size>this.maximumMints){const first=this.histories.keys().next().value;if(first!==undefined){this.histories.delete(first);this.evictions++;}}}return result;
 }
}
