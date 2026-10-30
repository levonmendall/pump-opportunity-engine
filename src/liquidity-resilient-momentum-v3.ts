/** Pure PAPER strategy. All inputs are already acquired and independently
 * audited by the native source. No RPC, order, ledger, clock or account writer.
 * Scenario outcomes are conditional arithmetic, never predicted profit. */
import {createHash} from 'node:crypto';
import {assessPredictiveBuying,eventIdentity,type FlowFeatures,type NormalizedTrade} from './strategy.js';
import {adaptiveMigrationEligible,adaptiveReentryEligible,type AdaptiveRuleContext,type AdaptiveExitInput,type AdaptiveExitDecision} from './adaptive-momentum-v2.js';

export const LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION='liquidity-resilient-momentum-v3' as const;
export const LIQUIDITY_RESILIENT_MOMENTUM_V3_POLICY=Object.freeze({
 version:LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION,mode:'PAPER',liveTradingEnabled:false,
 calibration:'EXPERIMENTAL_CAUSAL_SCENARIOS_NOT_ESTABLISHED_EDGE',
 sizing:Object.freeze({entryConsumedCostBps:500,refundableDepositsIncluded:false}),
 demand:Object.freeze({minimumNetFlowShareBps:1000,minimumPositiveBuckets:2,dustRelativeToProposedEntryBps:100,minimumWalletCount:null,meaning:'Capital-weighted concentration discounts continuation; raw wallet count does not establish independence or qualify an entry.'}),
 continuation:Object.freeze({recentBuckets:3,minimumRecentPositiveBuckets:2,maximumConsolidationRangeBps:1000,maximumConsolidationNetFlowShareBps:2000,ageRouting:false}),
 economics:Object.freeze({renewedDemandFractionBps:5000,minimumNetSurplusBps:100,unobservedSellerScenarioPoolBaseBps:100,maximumStressLossBps:2000,meaning:'Repeat half of the lesser full-window or time-normalized recent net demand, discounted by non-dominant capital share and capital diversity (one minus wallet HHI); compare exact-size after-fee/cost proceeds. This conditional scenario is not an expected return.'}),
 exit:Object.freeze({stopLossBps:1500,trailingMinimumBps:1500,volatilityMultiplierBps:20000,maximumQuoteAgeMs:2000,profitGivebackBps:Object.freeze({unknown:2500,priceReserveOnly:3500,auditedDemandMinimum:4000,auditedDemandMaximum:6500,verifiedDeterioration:1500}),takeProfitBps:null,maximumProfitableHoldingMs:null,partialExits:false,meaning:'Protect a risk-adjusted fraction of actual executable profit above consumed cost, alongside the cost and mark high-water stops. Fresh matched reserve/sell stress and audited flow change retention; unknown participation remains unknown. No fixed profitable holding expiry or profit cap.'}),
 limitations:Object.freeze(['beneficial-owner independence and wallet coordination unknown','current whole-wallet inventories and out-of-pool transfers unknown; known account balances are point-in-time observations','historical maximum balances and executed sells are diagnostic repeat scenarios, not current seller-inventory evidence','future order flow, fee-tier changes, landing and stop fills not guaranteed','partial profit-taking unavailable without explicit lot/cost allocation accounting']),
});
export const LIQUIDITY_RESILIENT_MOMENTUM_V3_SHA256=createHash('sha256').update(JSON.stringify(LIQUIDITY_RESILIENT_MOMENTUM_V3_POLICY)).digest('hex');
export type V3ReserveObservation={at:number;evidence:string;baseReserveUnits:string;rawQuoteReserveLamports:string;virtualQuoteReserveLamports:string};
export type V3ConsolidationEvidence={mint:string;pool:string;windowStartAt:number;windowEndAt:number;auditedAt:number;auditEvidence:string;netFlowShareBps:number;priceRangeBps:number;highPrice:{quoteLamports:string;tokenUnits:string}};
export type V3InventoryObservation={wallet:string;tokenAccount?:string;baseUnits:string;at:number;evidence:string;eventIdentity?:string;balanceTiming?:'before-trade'|'after-trade'};
export type V3AuditedFlow={mint:string;pool:string;windowStartAt:number;windowEndAt:number;auditedAt:number;auditEvidence:string;complete:true;trades:readonly NormalizedTrade[];reserveObservations?:readonly V3ReserveObservation[];/** Point-in-time account observations, never a current whole-wallet census. */observedWalletInventory?:readonly V3InventoryObservation[];priorConsolidation?:V3ConsolidationEvidence};
export type V3MarketEvidence={mint:string;pool:string;at:number;evidence:string;baseReserveUnits:string;rawQuoteReserveLamports:string;virtualQuoteReserveLamports:string;feeBucketsLamports:string;fees:{lpFeeBps:number;protocolFeeBps:number;creatorFeeBps:number};buyInputLamports:string;expectedBaseUnits:string;buyCurveInputLamports:string;entryGasLamports:string;exitGasLamports:string;slippageBps:number;maximumConsumedLamports:string;/** Explicitly evidenced cash affordability may reduce the proposed order; it
 * is never reported as a full five-percent allocation. */cashLimited?:true};
export type V3Evidence={flow:V3AuditedFlow;market?:V3MarketEvidence};
export type V3Dimension={status:'passed'|'failed'|'unavailable';reason:string};
export type V3BuyingAssessment={status:'not-rejected'|'failed'|'unavailable';reason:string;qualified:false;features:FlowFeatures|null;scoreBps:null;components:V3Components|null;assessments:{genuineDemand:V3Dimension;liquidityResilience:V3Dimension;continuation:V3Dimension;netEconomics:V3Dimension};limitations:readonly string[]};
export type V3SellScenario={name:string;assumedExternalSellBaseUnits:string;requiredForAdmission:boolean;grossCurveLamports:string|null;netLamports:string|null;lossFromConsumedCostBps:number|null;executable:boolean;classification:'CONDITIONAL_CPMM_SCENARIO_NOT_OBSERVED_EXECUTION'};
export type V3Components={rawBuyerCount:number;capitalDiversityBps:number;effectiveBuyerCount:number;effectiveBuyerCountBps:number;largestBuyerBps:number;top5BuyerBps:number;top10BuyerBps:number;dustBuyerCount:number|null;dustBuyVolumeBps:number|null;equalSizeBuyVolumeBps:number;multiEventSignatureBuyVolumeBps:number;netFlowShareBps:number;recentNetBuyLamports:string;recentPositiveBuckets:number;renewedDemandScenarioLamports:string|null;pattern:'audited-continuation'|'audited-reacceleration'|'unproven';observedInventoryLargestBaseUnits:string;historicalMaximumObservedAccountBaseUnits:string;windowNetPurchasedLargestBaseUnits:string;inventoryEvidence:'POINT_IN_TIME_ACCOUNT_OBSERVATIONS_AND_PLAUSIBLE_UNDISPOSED_PURCHASES_NOT_CURRENT_WALLET_BALANCES';outOfPoolTransfers:'UNKNOWN';externalSellerInventory:'UNKNOWN';proposedConsumedLamports:string|null;maximumConsumedLamports:string|null;cashLimited:boolean;reserveStability:{observations:number;minimumRawQuoteLamports:string|null;maximumRawQuoteLamports:string|null};immediateNetLamports:string|null;scenarioNetSurplusLamports:string|null;scenarioNetSurplusBps:number|null;scenarios:V3SellScenario[]};
const P=LIQUIDITY_RESILIENT_MOMENTUM_V3_POLICY;
const uint=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f]/.test(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const amount=(v:string)=>{if(!money(v))throw Error('V3_AMOUNT');return BigInt(v);};
const signedAmount=(v:string)=>{if(typeof v!=='string'||!/^(-?[1-9][0-9]{0,38}|0)$/.test(v))throw Error('V3_SIGNED_AMOUNT');return BigInt(v);};
const ceilDiv=(n:bigint,d:bigint)=>(n+d-1n)/d;
const bps=(n:bigint,d:bigint)=>{if(d<=0n)return 0;const r=n*10000n/d;return Number(r>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(Number.MAX_SAFE_INTEGER):r<BigInt(Number.MIN_SAFE_INTEGER)?BigInt(Number.MIN_SAFE_INTEGER):r);};
const fee=(n:bigint,rate:number)=>ceilDiv(n*BigInt(rate),10000n);
const max=(a:bigint,b:bigint)=>a>b?a:b;
type Pool={base:bigint;raw:bigint;virtual:bigint;buckets:bigint;fees:V3MarketEvidence['fees']};
function validPool(pool:Pool){return pool.base>0n&&pool.raw>0n&&pool.raw+pool.virtual>0n&&pool.buckets>=0n&&pool.buckets<=pool.raw&&Object.values(pool.fees).length===3&&Object.values(pool.fees).every(n=>uint(n)&&n<10000)&&pool.fees.lpFeeBps+pool.fees.protocolFeeBps+pool.fees.creatorFeeBps<10000;}
/** PumpSwap exact-input integer arithmetic, including per-component ceiling,
 * the SDK's one-unit buy guard and real-vault fee-bucket payout constraint.
 * Rates are held constant within a scenario; future tier changes are unknown. */
export function v3CpmmBuy(pool:Pool,input:bigint){
 if(input<=0n||!validPool(pool))throw Error('V3_CPMM_INPUT');
 let curve=input*10000n/BigInt(10000+pool.fees.lpFeeBps+pool.fees.protocolFeeBps+pool.fees.creatorFeeBps);
 const lp=fee(curve,pool.fees.lpFeeBps),protocol=fee(curve,pool.fees.protocolFeeBps),creator=fee(curve,pool.fees.creatorFeeBps),excess=curve+lp+protocol+creator-input;
 if(excess>0n)curve-=excess;
 if(curve<=1n)throw Error('V3_CPMM_BUY_DUST');
 const output=pool.base*(curve-1n)/(pool.raw+pool.virtual+curve-1n);
 if(output<=0n)throw Error('V3_CPMM_BUY_DUST');
 return {output,curve,pool:{...pool,base:pool.base-output,raw:pool.raw+input,buckets:pool.buckets+protocol+creator}};
}
export function v3CpmmSell(pool:Pool,units:bigint){
 if(units<=0n||!validPool(pool))throw Error('V3_CPMM_INPUT');
 const gross=(pool.raw+pool.virtual)*units/(pool.base+units),lp=fee(gross,pool.fees.lpFeeBps),protocol=fee(gross,pool.fees.protocolFeeBps),creator=fee(gross,pool.fees.creatorFeeBps);
 if(gross-lp>pool.raw-pool.buckets||gross<lp+protocol+creator)throw Error('V3_REAL_VAULT_PAYOUT_UNAVAILABLE');
 const output=gross-lp-protocol-creator;
 return {gross,output,pool:{...pool,base:pool.base+units,raw:pool.raw-output,buckets:pool.buckets+protocol+creator}};
}
const passed=(reason:string):V3Dimension=>({status:'passed',reason});
const failed=(reason:string):V3Dimension=>({status:'failed',reason});
const unknown=(reason:string):V3Dimension=>({status:'unavailable',reason});
function validateFlow(f:FlowFeatures,flow:V3AuditedFlow,now:number){
 if(!flow||flow.complete!==true||flow.mint!==f.mint||!text(flow.pool)||!text(flow.auditEvidence)||flow.windowStartAt!==f.windowStartAt||flow.windowEndAt!==f.windowEndAt||!uint(flow.auditedAt)||flow.auditedAt<flow.windowEndAt||flow.auditedAt>now||now-flow.windowEndAt>=10000||!Array.isArray(flow.trades)||flow.trades.length!==f.tradeCount||flow.trades.length>4096)throw Error('V3_COMPLETE_MATCHED_AUDIT_REQUIRED');
 const seen=new Set<string>(),buyers=new Map<string,bigint>(),buckets=Array.from({length:6},()=>0n),size=new Map<string,bigint>(),signatures=new Map<string,{count:number;buy:bigint}>(),inventories=new Map<string,bigint>();let bought=0n,sold=0n,previous=-1;
 for(const t of flow.trades){
  if(t.mint!==f.mint||!text(t.wallet)||!['buy','sell'].includes(t.side)||!['confirmed','finalized'].includes(t.commitment)||!uint(t.receivedAt)||t.receivedAt<flow.windowStartAt||t.receivedAt>=flow.windowEndAt||t.receivedAt<previous||!money(t.quoteLamports)||!money(t.tokenUnits)||amount(t.quoteLamports)===0n||amount(t.tokenUnits)===0n)throw Error('V3_AUDITED_TRADE_INVALID');
  previous=t.receivedAt;const key=eventIdentity(t.identity);if(seen.has(key))throw Error('V3_DUPLICATE_AUDITED_TRADE');seen.add(key);
  const q=amount(t.quoteLamports),u=amount(t.tokenUnits),bucket=Math.floor((t.receivedAt-flow.windowStartAt)/10000);buckets[bucket]!+=t.side==='buy'?q:-q;
  inventories.set(t.wallet,(inventories.get(t.wallet)??0n)+(t.side==='buy'?u:-u));
  const signature=signatures.get(t.identity.signature)??{count:0,buy:0n};signature.count++;if(t.side==='buy'){bought+=q;buyers.set(t.wallet,(buyers.get(t.wallet)??0n)+q);size.set(t.quoteLamports,(size.get(t.quoteLamports)??0n)+q);signature.buy+=q;}else sold+=q;signatures.set(t.identity.signature,signature);
 }
 const ranked=[...buyers.values()].sort((a,b)=>a>b?-1:a<b?1:0),largest=ranked[0]??0n;
 if(bought!==amount(f.buyLamports)||sold!==amount(f.sellLamports)||buyers.size!==f.distinctBuyerWallets||buckets.filter(x=>x>0n).length!==f.positiveNetBuckets||(bought===0n?0:Number(ceilDiv(largest*10000n,bought)))!==f.largestBuyerBps)throw Error('V3_AUDITED_AGGREGATE_MISMATCH');
 for(const [trade,price] of [[flow.trades[0],f.firstPrice],[flow.trades.at(-1),f.lastPrice]] as const)if(trade?price===null||price.quoteLamports!==trade.quoteLamports||price.tokenUnits!==trade.tokenUnits:price!==null)throw Error('V3_AUDITED_PRICE_MISMATCH');
 return {buyers,ranked,buckets,bought,sold,size,signatures,inventories};
}
function validateMarket(m:V3MarketEvidence,flow:V3AuditedFlow,now:number):Pool{
 if(!m||m.mint!==flow.mint||m.pool!==flow.pool||!text(m.evidence)||!uint(m.at)||m.at>now||now-m.at>P.exit.maximumQuoteAgeMs||!uint(m.slippageBps)||m.slippageBps>=10000||Object.values(m.fees??{}).length!==3||Object.values(m.fees).some(x=>!uint(x)||x>=10000)||m.fees.lpFeeBps+m.fees.protocolFeeBps+m.fees.creatorFeeBps>=10000)throw Error('V3_FRESH_EXACT_SIZE_POOL_REQUIRED');
 const pool={base:amount(m.baseReserveUnits),raw:amount(m.rawQuoteReserveLamports),virtual:signedAmount(m.virtualQuoteReserveLamports),buckets:amount(m.feeBucketsLamports),fees:m.fees};
 const consumed=amount(m.buyInputLamports)+amount(m.entryGasLamports),maximum=amount(m.maximumConsumedLamports);
 if(pool.base===0n||pool.raw===0n||pool.raw+pool.virtual<=0n||pool.buckets>pool.raw||consumed>maximum||consumed!==maximum&&m.cashLimited!==true||maximum===0n||amount(m.expectedBaseUnits)===0n)throw Error('V3_EXACT_FIVE_PERCENT_CONSUMED_SIZE_REQUIRED');
 const buy=v3CpmmBuy(pool,amount(m.buyInputLamports));if(buy.output!==amount(m.expectedBaseUnits)||buy.curve!==amount(m.buyCurveInputLamports))throw Error('V3_SDK_QUOTE_ARITHMETIC_MISMATCH');
 return pool;
}
function priceAbove(a:{quoteLamports:string;tokenUnits:string},b:{quoteLamports:string;tokenUnits:string}){return amount(a.quoteLamports)*amount(b.tokenUnits)>amount(b.quoteLamports)*amount(a.tokenUnits);}
/** Reconcile a known pre-swap account observation only with its exact audited
 * event. Later receipts replace earlier receipts for that known account. No
 * unseen transfer, second token account or current whole-wallet balance is
 * inferred. Old historical maxima are retained only as diagnostics. */
function inventoryScenarios(flow:V3AuditedFlow,netPurchased:ReadonlyMap<string,bigint>,now:number){
 const trades=new Map(flow.trades.map((t,index)=>[eventIdentity(t.identity),{trade:t,index}])),latest=new Map<string,{wallet:string;units:bigint;at:number;order:number}>();let historicalMaximum=0n;
 for(const i of flow.observedWalletInventory??[]){
  if(!i||!text(i.wallet)||!money(i.baseUnits)||!uint(i.at)||i.at>now||i.at<flow.windowStartAt||!text(i.evidence)||i.tokenAccount!==undefined&&!text(i.tokenAccount))continue;
  const before=amount(i.baseUnits),linked=i.eventIdentity===undefined?null:trades.get(i.eventIdentity);let units=before;
  if(i.balanceTiming==='before-trade'){
   if(!linked||linked.trade.wallet!==i.wallet||linked.trade.receivedAt!==i.at)continue;
   const change=amount(linked.trade.tokenUnits);if(linked.trade.side==='sell'&&change>before)continue;units=before+(linked.trade.side==='buy'?change:-change);
  }else if(i.balanceTiming!==undefined&&i.balanceTiming!=='after-trade')continue;
  historicalMaximum=max(historicalMaximum,before);const key=i.tokenAccount??'unresolved-account-of-actor:'+i.wallet,prior=latest.get(key),order=linked?.index??-1;
  if(!prior||i.at>prior.at||i.at===prior.at&&order>=prior.order)latest.set(key,{wallet:i.wallet,units,at:i.at,order});
 }
 const directlyObservedWallets=new Set([...latest.values()].map(i=>i.wallet)),observed=[...latest.values()].reduce((n,i)=>max(n,i.units),0n),plausible=[...netPurchased.entries()].filter(([wallet])=>!directlyObservedWallets.has(wallet)).reduce((n,[,units])=>max(n,units),0n);
 return {observed,plausible,historicalMaximum};
}
export function deriveV3Consolidation(features:FlowFeatures,flow:V3AuditedFlow,now:number):V3ConsolidationEvidence|null{
 const f=assessPredictiveBuying(features,now).features;if(!f||!f.sufficientlyObserved||f.qualityReason!==null||f.provisionalTradeCount!==0)return null;
 try{const a=validateFlow(f,flow,now);if(!flow.trades.length)return null;let low=flow.trades[0]!,high=low;for(const t of flow.trades){if(priceAbove(t,high))high=t;if(priceAbove(low,t))low=t;}return {mint:flow.mint,pool:flow.pool,windowStartAt:f.windowStartAt,windowEndAt:f.windowEndAt,auditedAt:flow.auditedAt,auditEvidence:flow.auditEvidence,netFlowShareBps:bps(a.bought-a.sold,a.bought+a.sold),priceRangeBps:bps(amount(high.quoteLamports)*amount(low.tokenUnits)-amount(low.quoteLamports)*amount(high.tokenUnits),amount(low.quoteLamports)*amount(high.tokenUnits)),highPrice:{quoteLamports:high.quoteLamports,tokenUnits:high.tokenUnits}};}catch{return null;}
}
export function assessLiquidityResilientBuying(features:FlowFeatures,now:number,evidence?:V3Evidence):V3BuyingAssessment{
 const f=assessPredictiveBuying(features,now).features;let c:V3Components|null=null;
 const dimensions={genuineDemand:unknown('complete-audited-trades-required'),liquidityResilience:unknown('fresh-exact-size-pool-required'),continuation:unknown('audited-temporal-flow-required'),netEconomics:unknown('fresh-exact-size-net-economics-required')};
 const result=(status:V3BuyingAssessment['status'],reason:string):V3BuyingAssessment=>({status,reason,qualified:false,features:f,scoreBps:null,components:c,assessments:dimensions,limitations:P.limitations});
 if(!f||!f.sufficientlyObserved||f.qualityReason!==null||f.provisionalTradeCount!==0)return result('unavailable','v3-complete-confirmed-audited-flow-required');
 if(!evidence)return result('unavailable','v3-complete-audited-trades-required');
 let a:ReturnType<typeof validateFlow>;try{a=validateFlow(f,evidence.flow,now);}catch{return result('unavailable','v3-complete-matched-audited-trades-required');}
 const total=a.bought+a.sold,net=a.bought-a.sold,squares=a.ranked.reduce((n,q)=>n+q*q,0n),effectiveBps=squares===0n?0:bps(a.bought*a.bought,squares),recent=a.buckets.slice(-3),recentNet=recent.reduce((n,q)=>n+q,0n),recentPositive=recent.filter(q=>q>0n).length;
 const inventory=inventoryScenarios(evidence.flow,a.inventories,now);
 c={rawBuyerCount:a.buyers.size,capitalDiversityBps:a.bought===0n?0:Number(10000n-ceilDiv(squares*10000n,a.bought*a.bought)),effectiveBuyerCount:effectiveBps/10000,effectiveBuyerCountBps:effectiveBps,largestBuyerBps:bps(a.ranked[0]??0n,a.bought),top5BuyerBps:bps(a.ranked.slice(0,5).reduce((n,q)=>n+q,0n),a.bought),top10BuyerBps:bps(a.ranked.slice(0,10).reduce((n,q)=>n+q,0n),a.bought),dustBuyerCount:null,dustBuyVolumeBps:null,equalSizeBuyVolumeBps:bps([...a.size.values()].reduce((n,q)=>max(n,q),0n),a.bought),multiEventSignatureBuyVolumeBps:bps([...a.signatures.values()].filter(x=>x.count>1).reduce((n,x)=>n+x.buy,0n),a.bought),netFlowShareBps:bps(net,total),recentNetBuyLamports:recentNet.toString(),recentPositiveBuckets:recentPositive,renewedDemandScenarioLamports:null,pattern:'unproven',observedInventoryLargestBaseUnits:inventory.observed.toString(),historicalMaximumObservedAccountBaseUnits:inventory.historicalMaximum.toString(),windowNetPurchasedLargestBaseUnits:inventory.plausible.toString(),inventoryEvidence:'POINT_IN_TIME_ACCOUNT_OBSERVATIONS_AND_PLAUSIBLE_UNDISPOSED_PURCHASES_NOT_CURRENT_WALLET_BALANCES',outOfPoolTransfers:'UNKNOWN',externalSellerInventory:'UNKNOWN',proposedConsumedLamports:null,maximumConsumedLamports:null,cashLimited:false,reserveStability:{observations:0,minimumRawQuoteLamports:null,maximumRawQuoteLamports:null},immediateNetLamports:null,scenarioNetSurplusLamports:null,scenarioNetSurplusBps:null,scenarios:[]};
 dimensions.genuineDemand=net>0n&&c.netFlowShareBps>=P.demand.minimumNetFlowShareBps&&f.positiveNetBuckets>=P.demand.minimumPositiveBuckets?passed('positive-material-audited-executed-demand; capital-breadth-measured'):failed('v3-audited-net-demand-not-material');
 const continuation=recentNet>0n&&recentPositive>=P.continuation.minimumRecentPositiveBuckets&&f.priceReturnBps!==null&&f.priceReturnBps>=0;
 dimensions.continuation=continuation?passed('current-audited-recent-buying-and-nonnegative-price-continuation'):failed('v3-recent-demand-or-price-continuation-not-supported');
 if(continuation){c.pattern='audited-continuation';const prior=evidence.flow.priorConsolidation;
  if(prior&&prior.mint===f.mint&&prior.pool===evidence.flow.pool&&uint(prior.windowStartAt)&&uint(prior.windowEndAt)&&prior.windowStartAt<prior.windowEndAt&&prior.windowEndAt<=f.windowStartAt&&uint(prior.auditedAt)&&prior.auditedAt>=prior.windowEndAt&&prior.auditedAt<=now&&text(prior.auditEvidence)&&Number.isSafeInteger(prior.netFlowShareBps)&&Math.abs(prior.netFlowShareBps)<=P.continuation.maximumConsolidationNetFlowShareBps&&uint(prior.priceRangeBps)&&prior.priceRangeBps<=P.continuation.maximumConsolidationRangeBps&&prior.highPrice&&money(prior.highPrice.quoteLamports)&&money(prior.highPrice.tokenUnits)&&amount(prior.highPrice.tokenUnits)>0n&&f.lastPrice&&priceAbove(f.lastPrice,prior.highPrice)){c.pattern='audited-reacceleration';dimensions.continuation=passed('independently-audited-prior-consolidation-and-current-price-breakout');}}
 const m=evidence.market;if(!m)return dimensions.genuineDemand.status==='failed'||dimensions.continuation.status==='failed'?result('failed',dimensions.genuineDemand.status==='failed'?dimensions.genuineDemand.reason:dimensions.continuation.reason):result('not-rejected','v3-flow-supported; exact-five-percent-liquidity-and-economics-required');
 let pool:Pool;try{pool=validateMarket(m,evidence.flow,now);}catch{return result('unavailable','v3-fresh-matched-five-percent-pool-and-quote-required');}
 const cost=amount(m.buyInputLamports)+amount(m.entryGasLamports),entry=v3CpmmBuy(pool,amount(m.buyInputLamports)),gas=amount(m.exitGasLamports),netLiquidation=(p:Pool)=>{const sell=v3CpmmSell(p,entry.output);const lessSlippage=sell.output*BigInt(10000-m.slippageBps)/10000n;return {gross:sell.gross,net:lessSlippage>gas?lessSlippage-gas:0n};};c.proposedConsumedLamports=cost.toString();c.maximumConsumedLamports=m.maximumConsumedLamports;c.cashLimited=cost<amount(m.maximumConsumedLamports);
 const dust=[...a.buyers.values()].filter(q=>q*10000n<cost*BigInt(P.demand.dustRelativeToProposedEntryBps));c.dustBuyerCount=dust.length;c.dustBuyVolumeBps=bps(dust.reduce((n,q)=>n+q,0n),a.bought);
 for(const r of evidence.flow.reserveObservations??[]){if(!r||!uint(r.at)||r.at<f.windowStartAt||r.at>now||!text(r.evidence)||!money(r.rawQuoteReserveLamports)||!money(r.baseReserveUnits)||!(typeof r.virtualQuoteReserveLamports==='string'&&/^-?(0|[1-9][0-9]{0,38})$/.test(r.virtualQuoteReserveLamports)))continue;const q=amount(r.rawQuoteReserveLamports);c.reserveStability.observations++;if(c.reserveStability.minimumRawQuoteLamports===null||q<amount(c.reserveStability.minimumRawQuoteLamports))c.reserveStability.minimumRawQuoteLamports=q.toString();if(c.reserveStability.maximumRawQuoteLamports===null||q>amount(c.reserveStability.maximumRawQuoteLamports))c.reserveStability.maximumRawQuoteLamports=q.toString();}
 const largestExecutedSell=evidence.flow.trades.filter(t=>t.side==='sell').reduce((n,t)=>max(n,amount(t.tokenUnits)),0n),generic=ceilDiv(entry.pool.base*BigInt(P.economics.unobservedSellerScenarioPoolBaseBps),10000n);
 for(const [name,units,requiredForAdmission] of [['immediate-full-liquidation',0n,true],['latest-point-in-time-observed-account-balance-scenario',inventory.observed,true],['plausible-undisposed-window-net-purchases-scenario',inventory.plausible,true],['historical-largest-executed-sell-repeat-diagnostic',largestExecutedSell,false],['historical-maximum-observed-account-balance-repeat-diagnostic',inventory.historicalMaximum,false],['unobserved-seller-one-percent-pool-base-scenario',generic,true]] as const){
  try{const stressed=units===0n?entry.pool:v3CpmmSell(entry.pool,units).pool,sell=netLiquidation(stressed);c.scenarios.push({name,assumedExternalSellBaseUnits:units.toString(),requiredForAdmission,grossCurveLamports:sell.gross.toString(),netLamports:sell.net.toString(),lossFromConsumedCostBps:bps(cost-sell.net,cost),executable:true,classification:'CONDITIONAL_CPMM_SCENARIO_NOT_OBSERVED_EXECUTION'});if(name==='immediate-full-liquidation')c.immediateNetLamports=sell.net.toString();}catch{c.scenarios.push({name,assumedExternalSellBaseUnits:units.toString(),requiredForAdmission,grossCurveLamports:null,netLamports:null,lossFromConsumedCostBps:null,executable:false,classification:'CONDITIONAL_CPMM_SCENARIO_NOT_OBSERVED_EXECUTION'});}}
 dimensions.liquidityResilience=c.scenarios.filter(s=>s.requiredForAdmission).every(s=>s.executable&&s.lossFromConsumedCostBps!==null&&s.lossFromConsumedCostBps<=P.economics.maximumStressLossBps)?passed('exact-size-real-vault-and-point-in-time-plus-explicit-unknown-seller-stresses-supported'):failed('v3-exact-size-liquidation-not-resilient-under-declared-sell-stress');
 const timeNormalizedRecent=recentNet>0n?recentNet*2n:0n,renewed=(net>0n?(net<timeNormalizedRecent?net:timeNormalizedRecent):0n)*BigInt(10000-c.largestBuyerBps)*BigInt(c.capitalDiversityBps)*BigInt(P.economics.renewedDemandFractionBps)/1000000000000n;c.renewedDemandScenarioLamports=renewed.toString();
 try{const continued=renewed>0n?v3CpmmBuy(entry.pool,renewed).pool:entry.pool,sale=netLiquidation(continued),surplus=sale.net-cost;c.scenarioNetSurplusLamports=surplus.toString();c.scenarioNetSurplusBps=bps(surplus,cost);dimensions.netEconomics=surplus*10000n>=cost*BigInt(P.economics.minimumNetSurplusBps)?passed('discounted-observed-demand-scenario-clears-exact-size-fees-gas-and-slippage'):failed('v3-discounted-demand-scenario-does-not-clear-net-costs');}catch{dimensions.netEconomics=failed('v3-conditional-continuation-scenario-not-executable');}
 const rejected=Object.values(dimensions).find(d=>d.status==='failed');return rejected?result('failed',rejected.reason):result('not-rejected','v3-four-functional-assessments-supported; ledger-and-fill-still-required');
}
export type V3RuleContext=AdaptiveRuleContext&{v3?:V3Evidence};
export type V3RuleDecision=Omit<V3BuyingAssessment,'status'|'qualified'> &{qualified:boolean;kind:'missing-data'|'market-exclusion'|'strategy-rejection'|'risk-rejection'|'qualified';ruleVersion:typeof LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION;at:number};
export function evaluateLiquidityResilientPrimary(features:FlowFeatures,context:V3RuleContext):V3RuleDecision{
 const a=assessLiquidityResilientBuying(features,context.now,context.v3),f=a.features;
 const decision=(kind:V3RuleDecision['kind'],reason:string):V3RuleDecision=>{const {status:_,qualified:__,...rest}=a;return {...rest,qualified:kind==='qualified',kind,reason,ruleVersion:LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION,at:context.now};};
 if(context.flowFieldsVerified!==true||!text(context.flowVerificationEvidence)||!f||f.mint!==context.mint)return decision('missing-data','v3-complete-verified-native-flow-required');
 if(!adaptiveMigrationEligible(context.migrationAt,context.migrationVerified,context.now)||context.migrationAt!>f.windowStartAt)return decision('missing-data','v3-verified-pre-window-migration-required');
 if(context.supportedPool!==true)return decision('market-exclusion','unsupported-pool');
 if(context.riskEntriesAllowed!==true)return decision('risk-rejection','entries-not-authorized-by-ledger');
 if(context.alreadyTradedMint&&!adaptiveReentryEligible(f,context.now,context.reentry))return decision('risk-rejection','fresh-closed-and-reconciled-round-trip-required');
 const q=context.quote,m=context.v3?.market;
 if(!q||!m||q.mint!==context.mint||!text(q.evidence)||q.evidence!==m.evidence||q.at!==m.at||q.expectedBaseUnits!==m.expectedBaseUnits)return decision('missing-data','v3-matched-fresh-actual-size-quote-required');
 if(!money(context.maximumConsumedCostMicroUsd)||amount(context.maximumConsumedCostMicroUsd)===0n||!money(q.allInInitialCostMicroUsd)||amount(q.allInInitialCostMicroUsd)===0n||amount(q.allInInitialCostMicroUsd)>amount(context.maximumConsumedCostMicroUsd))return decision('risk-rejection','current-equity-consumed-entry-allowance-required');
 if(a.status==='unavailable')return decision('missing-data',a.reason);
 if(a.status==='failed')return decision('strategy-rejection',a.reason);
 if(Object.values(a.assessments).some(d=>d.status!=='passed'))return decision('missing-data','v3-all-four-functional-assessments-required');
 return decision('qualified','v3-liquidity-resilient-momentum-and-current-execution-checks-passed; accounting-and-fill-still-required');
}
/** Bounded descriptive prior-window memory. Seven successive rolling windows
 * retain the preceding non-overlapping 60s window; none is required before an
 * initial entry. Requoting one audited target never creates another window.
 * Runtime clears this cache on a source-generation change. Eviction only makes
 * historical pattern evidence unknown; it cannot reject current observation. */
export class V3AssessmentSeries {
 private readonly histories=new Map<string,{pool:string;windows:V3ConsolidationEvidence[]}>();
 private evictions=0;
 constructor(private readonly maximumMints=256){if(!uint(maximumMints)||maximumMints<1||maximumMints>4096)throw Error('V3_HISTORY_CAPACITY');}
 clear(mint?:string){if(mint===undefined)this.histories.clear();else this.histories.delete(mint);}
 usage(){return {mints:this.histories.size,maximumMints:this.maximumMints,retentionEvictions:this.evictions,maximumWindowsPerMint:7,entryWaitingWindows:0};}
 observe(input:{features:FlowFeatures;now:number;flow:V3AuditedFlow;market?:V3MarketEvidence}):V3BuyingAssessment{
  const {features,now,flow,market}=input;let history=this.histories.get(features.mint);
  if(history?.pool!==flow.pool){this.histories.delete(features.mint);history=undefined;}
  const prior=history?.windows.filter(w=>w.windowEndAt<=features.windowStartAt&&w.auditedAt<=now).at(-1),withPrior:V3AuditedFlow={...flow,...(prior?{priorConsolidation:prior}:{})};
  const result=assessLiquidityResilientBuying(features,now,{flow:withPrior,...(market?{market}:{})});
  const observed=deriveV3Consolidation(features,flow,now);
  if(observed){
   const windows=(history?.windows??[]).filter(w=>w.windowEndAt!==observed.windowEndAt);windows.push(observed);windows.sort((a,b)=>a.windowEndAt-b.windowEndAt);
   this.histories.delete(features.mint);this.histories.set(features.mint,{pool:flow.pool,windows:windows.slice(-7)});
   while(this.histories.size>this.maximumMints){const first=this.histories.keys().next().value;if(first!==undefined){this.histories.delete(first);this.evictions++;}}
  }
  return result;
 }
}
export type V3ExitInput=AdaptiveExitInput&{priorProfitProtectionFloorLamports?:string;liquidityContext?:{at:number;evidence:string;pricedBaseUnits:string;immediateNetLamports:string;stressedNetLamports:string;rawQuoteReserveLamports:string;priorRawQuoteReserveLamports?:string};flowContext?:{at:number;availableAt:number;evidence:string;complete:boolean;netBuyLamports:string;recentNetBuyLamports:string;priceReturnBps:number|null}};
export type V3ExitDecision=AdaptiveExitDecision&{profitProtectionFloorLamports:string|null;profitGivebackBps:number;continuationConfidence:'audited-flow'|'price-reserve-only'|'unknown';liquidityDeteriorationVerified:boolean};
/** The source, actual-size quote and financial gate remain authoritative. A
 * boolean cannot invent deterioration. Unknown flow is not zero demand. */
export function evaluateLiquidityResilientExit(input:V3ExitInput):V3ExitDecision{
 if(!uint(input.now)||!uint(input.enteredAt)||input.enteredAt>input.now||!money(input.entryCostLamports)||amount(input.entryCostLamports)===0n||!money(input.heldBaseUnits)||amount(input.heldBaseUnits)===0n)throw Error('V3_EXIT_POSITION');
 const p=P.exit,cost=amount(input.entryCostLamports);if(input.volatilityBps!==undefined&&(!uint(input.volatilityBps)||input.volatilityBps>10000))throw Error('V3_EXIT_VOLATILITY');
 const trailingDistanceBps=Math.min(9999,Math.max(p.trailingMinimumBps,Math.ceil((input.volatilityBps??0)*p.volatilityMultiplierBps/10000)));let high=input.highWaterNetLamports===undefined?null:amount(input.highWaterNetLamports),profitFloor=input.priorProfitProtectionFloorLamports===undefined?null:amount(input.priorProfitProtectionFloorLamports),profitGivebackBps=p.profitGivebackBps.unknown as number,continuationConfidence:V3ExitDecision['continuationConfidence']='unknown',liquidityDeteriorationVerified=false;
 const result=(action:AdaptiveExitDecision['action'],reason:string,net:bigint|null=null):V3ExitDecision=>({action,reason,highWaterNetLamports:high?.toString()??null,trailingDistanceBps,profitRetentionBps:net!==null&&high!==null&&high>cost?Math.max(0,Math.min(10000,bps(net-cost,high-cost))):null,profitProtectionFloorLamports:profitFloor?.toString()??null,profitGivebackBps,continuationConfidence,liquidityDeteriorationVerified});
 const m=input.mark;if(!m||!text(m.evidence)||!uint(m.at)||m.at<input.enteredAt||m.at>input.now||input.now-m.at>p.maximumQuoteAgeMs||m.pricedBaseUnits!==input.heldBaseUnits||!money(m.netLamports))return result('quote-required','v3-fresh-actual-size-net-liquidation-required');
 const net=amount(m.netLamports);high=high===null?net:max(high,net);
 const flow=input.flowContext,freshFlow=!!flow&&flow.complete===true&&uint(flow.at)&&flow.at>=input.enteredAt&&uint(flow.availableAt)&&flow.at<=flow.availableAt&&flow.availableAt<=input.now&&input.now-flow.at<10000&&text(flow.evidence)&&/^-?(0|[1-9][0-9]{0,38})$/.test(flow.netBuyLamports)&&/^-?(0|[1-9][0-9]{0,38})$/.test(flow.recentNetBuyLamports)&&Number.isSafeInteger(flow.priceReturnBps),flowReversal=freshFlow&&BigInt(flow!.netBuyLamports)<0n&&BigInt(flow!.recentNetBuyLamports)<0n&&flow!.priceReturnBps!<0;
 if(freshFlow&&BigInt(flow!.netBuyLamports)>0n&&BigInt(flow!.recentNetBuyLamports)>0n&&flow!.priceReturnBps!>=0){continuationConfidence='audited-flow';profitGivebackBps=Math.min(p.profitGivebackBps.auditedDemandMaximum,Math.max(p.profitGivebackBps.auditedDemandMinimum,(input.volatilityBps??0)*4));}
 const l=input.liquidityContext;if(l&&uint(l.at)&&l.at===m.at&&l.at<=input.now&&input.now-l.at<=2000&&l.evidence===m.evidence&&l.pricedBaseUnits===input.heldBaseUnits&&money(l.immediateNetLamports)&&l.immediateNetLamports===m.netLamports&&money(l.stressedNetLamports)&&money(l.rawQuoteReserveLamports)){
  const stress=amount(l.stressedNetLamports),raw=amount(l.rawQuoteReserveLamports),prior=l.priorRawQuoteReserveLamports&&money(l.priorRawQuoteReserveLamports)?amount(l.priorRawQuoteReserveLamports):null;
  if(stress<=net&&prior!==null&&raw>=prior&&continuationConfidence==='unknown'){continuationConfidence='price-reserve-only';profitGivebackBps=p.profitGivebackBps.priceReserveOnly;}
  liquidityDeteriorationVerified=stress<=net&&net>0n&&(net-stress)*10000n>net*BigInt(P.economics.maximumStressLossBps)&&prior!==null&&raw<prior;
  if(stress<=net&&prior!==null&&raw<prior)profitGivebackBps=p.profitGivebackBps.verifiedDeterioration;
 }
 if(flowReversal)profitGivebackBps=p.profitGivebackBps.verifiedDeterioration;
 if(high>cost){const modeled=high-(high-cost)*BigInt(profitGivebackBps)/10000n;profitFloor=profitFloor===null?modeled:max(profitFloor,modeled);}
 if(net*10000n<=cost*BigInt(10000-p.stopLossBps))return result('request-exit','v3-protective-cost-stop; fill-price-not-guaranteed',net);
 if(liquidityDeteriorationVerified)return result('request-exit','v3-actual-size-liquidity-stress-and-confirmed-reserve-deterioration',net);
 if(flowReversal)return result('request-exit','v3-complete-audited-demand-reversal-and-adverse-price',net);
 if(profitFloor!==null&&net<=profitFloor)return result('request-exit','v3-risk-adjusted-executable-profit-retention-floor',net);
 if(high>cost&&net*10000n<=high*BigInt(10000-trailingDistanceBps))return result('request-exit','v3-actual-size-net-high-water-trailing-stop',net);
 return result('hold','v3-actual-size-thesis-not-disproved; unknown-flow-and-external-inventory-remain-unknown',net);
}
