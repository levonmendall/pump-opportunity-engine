/** Interpretable PAPER-only adaptive strategy. No I/O, account, clock, order or
 * promotion authority. Experimental parameters are explicit; no economic edge
 * is claimed. The existing native audit and execution/ledger gates remain
 * mandatory at integration. Unknown dimensions are never fabricated. */
import {createHash} from 'node:crypto';
import {PAPER_EQUITY_RISK_VERSION} from './paper-equity-risk.js';
import {assessPredictiveBuying,PROVISIONAL_RULE,type FlowFeatures,type RuleContext} from './strategy.js';

export const ADAPTIVE_MOMENTUM_V2_VERSION='adaptive-momentum-v2-paper-v1' as const;
export const ADAPTIVE_MOMENTUM_V2_POLICY=Object.freeze({
 version:ADAPTIVE_MOMENTUM_V2_VERSION,mode:'PAPER',liveTradingEnabled:false,
 calibration:'EXPERIMENTAL_PARAMETERS_NOT_ESTABLISHED_PROFIT_OPTIMAL',
 entry:Object.freeze({minimumScoreBps:6500,minimumNetBuyLamports:'1',minimumNetDemandToLiquidityBps:10,minimumNetFlowShareBps:1000,minimumDistinctWallets:3,maximumLargestBuyerBps:6500,minimumPositiveBuckets:2,minimumObservedReturnBps:-1000,demandTargetBpsOfLiquidity:100,walletParticipationTarget:10,weights:Object.freeze({demand:3000,persistence:2500,participation:1500,dispersion:1500,observedPrice:1500})}),
 exit:Object.freeze({stopLossBps:1500,trailingMinimumBps:1500,volatilityMultiplierBps:20000,maximumQuoteAgeMs:2000,takeProfitBps:null,maximumProfitableHoldingMs:null,partialExits:false}),
 age:'verified on-chain migration time; no fixed early/late trading exclusion; complete audited observation remains mandatory',
 opportunityRouting:Object.freeze({earlyCohortThroughMs:7200000,meaning:'Cohort routes the target strategy, not proof of continuation or reacceleration. Earlier consolidation remains unknown unless independently evidenced.'}),
 sizing:Object.freeze({policyVersion:PAPER_EQUITY_RISK_VERSION,entryConsumedCostBps:500,maximumInitialCostMicroUsd:null,maximumAggregatePositionCostMicroUsd:null,dailyEquityHighWaterDrawdownBps:1000,refundableDepositsIncluded:false,appreciationCausesForcedSale:false}),
 unknownDimensions:Object.freeze(['beneficial-owner independence','wallet coordination','within-window acceleration','executable price trend without a matched quote series','reserve stability without matched states','net expected continuation return']),
});
export const ADAPTIVE_MOMENTUM_V2_SHA256=createHash('sha256').update(JSON.stringify(ADAPTIVE_MOMENTUM_V2_POLICY)).digest('hex');
const uint=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const text=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\u0000-\u001f]/.test(x);
const money=(x:unknown):x is string=>typeof x==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(x);
const amount=(x:string)=>{if(!money(x))throw Error('ADAPTIVE_AMOUNT');return BigInt(x);};
const bounded=(n:bigint)=>Number(n>10000n?10000n:n<0n?0n:n);
const signedBps=(n:bigint,d:bigint)=>{if(d<=0n)return null;const v=n*10000n/d;return v>BigInt(Number.MAX_SAFE_INTEGER)||v<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(v);};
export type AdaptiveComponents={demandToLiquidityBps:number|null;netFlowShareBps:number;demand:number|null;persistence:number;participation:number;dispersion:number;observedPrice:number|null;acceleration:null;independentBuyerCount:null;executablePriceReturnBps:null;liquidityStability:null};
export type AdaptiveBuyingAssessment={status:'failed'|'not-rejected'|'unavailable';reason:string;features:FlowFeatures|null;qualified:false;scoreBps:number|null;components:AdaptiveComponents|null;limitations:readonly string[]};

/** Preliminary mode (no liquidity) only decides whether exact-size preparation
 * is worth attempting. It is never a final score or qualification. */
export function assessAdaptiveBuying(features:FlowFeatures,now:number,liquidityLamports?:string):AdaptiveBuyingAssessment{
 const f=assessPredictiveBuying(features,now).features,policy=ADAPTIVE_MOMENTUM_V2_POLICY.entry;
 const result=(status:AdaptiveBuyingAssessment['status'],reason:string,components:AdaptiveComponents|null=null,scoreBps:number|null=null):AdaptiveBuyingAssessment=>({status,reason,features:f,qualified:false,scoreBps,components,limitations:ADAPTIVE_MOMENTUM_V2_POLICY.unknownDimensions});
 if(!f)return result('unavailable','malformed-or-unavailable-features');
 if(!f.sufficientlyObserved||f.qualityReason!==null||f.provisionalTradeCount!==0)return result('unavailable','complete-confirmed-audited-flow-required');
 const net=BigInt(f.netBuyLamports),gross=BigInt(f.buyLamports)+BigInt(f.sellLamports);
 if(net<BigInt(policy.minimumNetBuyLamports)||f.distinctBuyerWallets<policy.minimumDistinctWallets||f.largestBuyerBps>policy.maximumLargestBuyerBps||f.positiveNetBuckets<policy.minimumPositiveBuckets)return result('failed','adaptive-genuine-demand-floor-not-met');
 if(gross===0n||net*10000n<gross*BigInt(policy.minimumNetFlowShareBps))return result('failed','adaptive-near-neutral-executed-flow');
 if(f.priceReturnBps===null)return result('unavailable','observed-trade-price-structure-unavailable');
 if(f.priceReturnBps<policy.minimumObservedReturnBps)return result('failed','adaptive-adverse-observed-price-structure');
 const c:AdaptiveComponents={demandToLiquidityBps:null,netFlowShareBps:Number(net*10000n/gross),demand:null,persistence:Math.floor(f.positiveNetBuckets*10000/6),participation:Math.min(10000,Math.floor(f.distinctBuyerWallets*10000/policy.walletParticipationTarget)),dispersion:10000-f.largestBuyerBps,observedPrice:Math.max(0,Math.min(10000,5000+f.priceReturnBps*10)),acceleration:null,independentBuyerCount:null,executablePriceReturnBps:null,liquidityStability:null};
 if(liquidityLamports===undefined)return result('not-rejected','adaptive-preliminary-demand-only; exact-size-liquidity-and-financial-checks-required',c);
 if(!money(liquidityLamports)||BigInt(liquidityLamports)===0n)return result('unavailable','validated-executable-liquidity-unavailable',c);
 c.demandToLiquidityBps=signedBps(net,BigInt(liquidityLamports));
 if(c.demandToLiquidityBps===null)return result('unavailable','liquidity-normalization-out-of-range',c);
 if(net*10000n<BigInt(liquidityLamports)*BigInt(policy.minimumNetDemandToLiquidityBps))return result('failed','adaptive-liquidity-normalized-demand-floor-not-met',c);
 c.demand=bounded(net*10000n*10000n/(BigInt(liquidityLamports)*BigInt(policy.demandTargetBpsOfLiquidity)));
 const w=policy.weights,score=Math.floor((c.demand*w.demand+c.persistence*w.persistence+c.participation*w.participation+c.dispersion*w.dispersion+c.observedPrice!*w.observedPrice)/10000);
 return result(score>=policy.minimumScoreBps?'not-rejected':'failed',score>=policy.minimumScoreBps?'adaptive-score-not-rejected; execution-and-risk-still-required':'adaptive-score-below-experimental-threshold',c,score);
}

export function adaptiveMigrationEligible(migrationAt:number|null,verified:boolean,now:number){return verified===true&&uint(now)&&uint(migrationAt)&&migrationAt<=now;}
export function describeAdaptiveOpportunity(migrationAt:number|null,verified:boolean,now:number,priorConsolidation?:{throughAt:number;availableAt:number;evidence:string;confirmed:boolean}){
 if(!adaptiveMigrationEligible(migrationAt,verified,now))return {targetStrategy:null,migrationAgeMs:null,patternEvidence:'verified-migration-unavailable'} as const;
 const age=now-migrationAt!;
 if(age<=ADAPTIVE_MOMENTUM_V2_POLICY.opportunityRouting.earlyCohortThroughMs)return {targetStrategy:'early-momentum-continuation',migrationAgeMs:age,patternEvidence:'current-audited-demand-and-executable-entry-still-required'} as const;
 const prior=priorConsolidation,confirmed=!!prior&&prior.confirmed===true&&uint(prior.throughAt)&&uint(prior.availableAt)&&prior.throughAt<=prior.availableAt&&prior.availableAt<=now&&text(prior.evidence);
 return {targetStrategy:'momentum-reacceleration',migrationAgeMs:age,patternEvidence:confirmed?'prior-consolidation-evidence-supplied; renewed-demand-still-required':'prior-consolidation-unknown; age-alone-does-not-prove-reacceleration'} as const;
}
export type AdaptiveReentryEvidence={closedAt:number;reconciledAt:number;previousWindowEndAt:number;unresolved:boolean};
export type AdaptiveRuleContext=Omit<RuleContext,'quote'>&{quote:(NonNullable<RuleContext['quote']>&{effectiveQuoteLiquidityLamports?:string})|null;reentry?:AdaptiveReentryEvidence;maximumConsumedCostMicroUsd?:string};
export type AdaptiveRuleDecision={qualified:boolean;kind:'missing-data'|'market-exclusion'|'strategy-rejection'|'risk-rejection'|'qualified';reason:string;ruleVersion:typeof ADAPTIVE_MOMENTUM_V2_VERSION;at:number;features:FlowFeatures|null;scoreBps:number|null;components:AdaptiveComponents|null;limitations:readonly string[]};
/** Full-window re-entry: neither an old signal whose end follows the sale nor
 * a previously reserved/uncertain order can become a second round trip. */
export function adaptiveReentryEligible(features:FlowFeatures,now:number,evidence:AdaptiveReentryEvidence|undefined){
 return !!evidence&&uint(now)&&uint(evidence.closedAt)&&uint(evidence.reconciledAt)&&uint(evidence.previousWindowEndAt)&&evidence.closedAt<=evidence.reconciledAt&&evidence.reconciledAt<=now&&evidence.unresolved===false&&features.windowStartAt>evidence.closedAt&&features.windowEndAt>evidence.previousWindowEndAt;
}
export function evaluateAdaptivePrimary(features:FlowFeatures,context:AdaptiveRuleContext):AdaptiveRuleDecision{
 const a=assessAdaptiveBuying(features,context.now,context.quote?.effectiveQuoteLiquidityLamports),f=a.features;
 const decision=(kind:AdaptiveRuleDecision['kind'],reason:string):AdaptiveRuleDecision=>({qualified:kind==='qualified',kind,reason,ruleVersion:ADAPTIVE_MOMENTUM_V2_VERSION,at:context.now,features:f,scoreBps:a.scoreBps,components:a.components,limitations:a.limitations});
 if(context.flowFieldsVerified!==true||!text(context.flowVerificationEvidence)||!f||f.mint!==context.mint||!f.sufficientlyObserved||f.qualityReason!==null||f.provisionalTradeCount!==0)return decision('missing-data','complete-verified-native-flow-required');
 if(!adaptiveMigrationEligible(context.migrationAt,context.migrationVerified,context.now))return decision('missing-data','verified-migration-time-unavailable');
 if(context.supportedPool!==true)return decision('market-exclusion','unsupported-pool');
 if(context.migrationAt!==null&&context.migrationAt>f.windowStartAt)return decision('missing-data','observation-window-precedes-verified-migration');
 if(context.riskEntriesAllowed!==true)return decision('risk-rejection','entries-not-authorized-by-ledger');
 if(context.alreadyTradedMint&&!adaptiveReentryEligible(f,context.now,context.reentry))return decision('risk-rejection','fresh-closed-and-reconciled-round-trip-required');
 const q=context.quote;
 if(!q||!text(q.evidence)||q.mint!==context.mint||!uint(q.at)||q.at>context.now||context.now-q.at>PROVISIONAL_RULE.maximumQuoteAgeMs)return decision('missing-data','fresh-size-specific-quote-unavailable');
 if(!money(q.allInInitialCostMicroUsd)||BigInt(q.allInInitialCostMicroUsd)===0n||!money(context.maximumConsumedCostMicroUsd)||BigInt(q.allInInitialCostMicroUsd)>BigInt(context.maximumConsumedCostMicroUsd))return decision('risk-rejection','current-equity-consumed-entry-allowance-required');
 if(!money(q.expectedBaseUnits)||BigInt(q.expectedBaseUnits)===0n||!uint(q.sizeToEffectiveLiquidityBps)||q.sizeToEffectiveLiquidityBps>PROVISIONAL_RULE.maximumSizeToLiquidityBps)return decision('market-exclusion','order-size-exceeds-execution-liquidity-bound');
 if(a.status==='unavailable')return decision('missing-data',a.reason);
 if(a.status==='failed')return decision('strategy-rejection',a.reason);
 if(a.scoreBps===null)return decision('missing-data','validated-executable-liquidity-unavailable');
 return decision('qualified','adaptive-score-and-current-execution-checks-passed; accounting-and-fill-still-required');
}

export type AdaptiveExitInput={now:number;enteredAt:number;entryCostLamports:string;heldBaseUnits:string;mark:{at:number;netLamports:string;pricedBaseUnits:string;evidence:string}|null;highWaterNetLamports?:string;volatilityBps?:number;momentumDeteriorated?:boolean;liquidityDeteriorated?:boolean;/** Deterioration flags require current independently evidenced information. */continuationEvidence?:{at:number;availableAt:number;evidence:string}};
export type AdaptiveExitDecision={action:'hold'|'quote-required'|'request-exit';reason:string;highWaterNetLamports:string|null;trailingDistanceBps:number;profitRetentionBps:number|null};
export function evaluateAdaptiveExit(input:AdaptiveExitInput):AdaptiveExitDecision{
 if(!uint(input.now)||!uint(input.enteredAt)||input.enteredAt>input.now||!money(input.entryCostLamports)||BigInt(input.entryCostLamports)===0n||!money(input.heldBaseUnits)||BigInt(input.heldBaseUnits)===0n)throw Error('ADAPTIVE_EXIT_POSITION');
 const p=ADAPTIVE_MOMENTUM_V2_POLICY.exit,cost=BigInt(input.entryCostLamports),prior=input.highWaterNetLamports===undefined?null:amount(input.highWaterNetLamports);
 if(input.volatilityBps!==undefined&&(!uint(input.volatilityBps)||input.volatilityBps>10000))throw Error('ADAPTIVE_VOLATILITY');
 const trailingDistanceBps=Math.min(9999,Math.max(p.trailingMinimumBps,Math.ceil((input.volatilityBps??0)*p.volatilityMultiplierBps/10000)));
 let high=prior;const result=(action:AdaptiveExitDecision['action'],reason:string,net:bigint|null=null):AdaptiveExitDecision=>({action,reason,highWaterNetLamports:high?.toString()??null,trailingDistanceBps,profitRetentionBps:net!==null&&high!==null&&high>cost?bounded((net>cost?net-cost:0n)*10000n/(high-cost)):null});
 const m=input.mark;if(!m||!text(m.evidence)||!uint(m.at)||m.at<input.enteredAt||m.at>input.now||input.now-m.at>p.maximumQuoteAgeMs||m.pricedBaseUnits!==input.heldBaseUnits||!money(m.netLamports))return result('quote-required','fresh-actual-size-net-liquidation-required');
 const net=BigInt(m.netLamports);high=high===null||net>high?net:high;
 if(net*10000n<=cost*BigInt(10000-p.stopLossBps))return result('request-exit','adaptive-protective-cost-stop; fill-price-not-guaranteed',net);
 if(high>cost&&net*10000n<=high*BigInt(10000-trailingDistanceBps))return result('request-exit','adaptive-net-liquidation-high-water-trailing-stop',net);
 const e=input.continuationEvidence,freshEvidence=!!e&&uint(e.at)&&uint(e.availableAt)&&e.at<=e.availableAt&&e.availableAt<=input.now&&input.now-e.at<=2000&&text(e.evidence);
 if(freshEvidence&&input.liquidityDeteriorated===true)return result('request-exit','adaptive-verified-liquidity-deterioration',net);
 if(freshEvidence&&input.momentumDeteriorated===true)return result('request-exit','adaptive-verified-momentum-deterioration',net);
 return result('hold',input.volatilityBps===undefined?'adaptive-thesis-not-disproved; volatility-unknown-protective-trailing-fallback':'adaptive-thesis-not-disproved; volatility-adjusted-trailing',net);
}

export type AdaptiveRiskPosition={mint:string;entryCostLamports:string;currentNetLamports:string;stressedNetLamports:string|null};
/** Counterfactual downside accounting, not a claim that a stop guarantees a
 * fill. All-position simultaneous stress is conservative; unknown stress stays
 * unknown and cannot justify more allocation. Appreciation never forces sale. */
export function projectAdaptiveExposure(positions:readonly AdaptiveRiskPosition[]){
 if(positions.length>256||new Set(positions.map(p=>p.mint)).size!==positions.length)throw Error('ADAPTIVE_EXPOSURE_IDENTITIES');
 let deployed=0n,current=0n,risk=0n,profitAtRisk=0n,unknown=false;
 for(const p of positions){if(!text(p.mint))throw Error('ADAPTIVE_EXPOSURE_IDENTITY');const cost=amount(p.entryCostLamports),mark=amount(p.currentNetLamports);deployed+=cost;current+=mark;if(p.stressedNetLamports===null){unknown=true;continue;}const stress=amount(p.stressedNetLamports);if(stress>mark)throw Error('ADAPTIVE_STRESS_NOT_ADVERSE');risk+=cost>stress?cost-stress:0n;profitAtRisk+=mark-stress;}
 return {deployedCapitalLamports:deployed.toString(),currentExecutableExposureLamports:current.toString(),stressedLossFromCommittedCapitalLamports:unknown?null:risk.toString(),stressedLossFromCurrentValueLamports:unknown?null:profitAtRisk.toString(),riskUnknown:unknown,forcedSale:false as const,classification:'EXPLICIT_COUNTERFACTUAL_STRESS_NOT_A_STOP_GUARANTEE' as const};
}
