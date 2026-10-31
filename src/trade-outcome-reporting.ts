/** Small, deterministic reporting receipts made from already-owned PAPER facts.
 * No provider, clock, ledger, forecast, or entry permission lives in this module.
 * Invalid optional provenance becomes unknown; it cannot block liquidation. */
export type TradeEntryBasis={netBuyLamports:string|null;distinctBuyerWallets:number|null;positiveNetBuckets:number|null;largestBuyerBps:number|null;priceReturnBps:number|null;proposedInputLamports:string|null;effectiveQuoteLiquidityLamports:string|null;jointConditionalBalanceLamports:string|null};
export type TradeDecisionContext={
 schemaVersion:1;strategyVersion:string|null;reason:string|null;
 candidateAdmittedAt:number|null;windowStartAt:number|null;windowEndAt:number|null;
 assessedAt:number|null;decisionQuoteAt:number|null;
 entryBasis?:TradeEntryBasis;
};
export type TradeEntryProvenance={
 schemaVersion:1;orderId:string;units:string;decidedAt:number;executeAt:number;
 filledAt:number;quoteAt:number;context:TradeDecisionContext|null;failedExitGasLamports:string;
};
type TradeExecutionPoint={orderId:string|null;decidedAt:number|null;executeAt:number|null;filledAt:number;quoteAt:number|null;context:TradeDecisionContext|null};
export type TradeOutcomeReport={
 schemaVersion:1;kind:'entry'|'closed-position';basis:'durable-modeled-paper-fills';
 entry:TradeExecutionPoint;exit:TradeExecutionPoint|null;
 economics:{entrySpendLamports:string;entryGasLamports:string;exitReceiveLamports:string|null;exitGasLamports:string|null;failedExitGasLamports:string|null;filledPairNetLamports:string|null;closedTradeNetLamports:string|null};
 observation:{bestObservedNetLamports:string|null;bestObservedAt:number|null;givebackFromObservedNetLamports:string|null};
 attribution:'recorded-facts-only-cause-not-established';
};
type OrderFacts={id:string;side:'buy'|'sell';decidedAt:number;executeAt:number;gas:string;decisionContext?:TradeDecisionContext};
type QuoteFacts={at:number;spendLamports:string;receiveUnits:string};
type PositionFacts={units:string;enteredAt:number;entryLamports:string;entryGas:string;tradeProvenance?:TradeEntryProvenance;strategy?:{version:string;roundTripId:string;windowStartAt:number;windowEndAt:number;assessedAt:number;highWaterNetLamports:string;highWaterAt:number}};
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:Record<string,any>,keys:string)=>Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const time=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const amount=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const signed=(v:unknown):v is string=>typeof v==='string'&&/^(0|-?[1-9][0-9]{0,38})$/.test(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const knownTime=(v:unknown,at:number)=>v===null||time(v)&&v<=at;

/** A compact allowlist of evidence already calculated for the entry decision. */
export function tradeEntryBasis(features:unknown,quote:unknown,components:unknown):TradeEntryBasis{
 const empty:TradeEntryBasis={netBuyLamports:null,distinctBuyerWallets:null,positiveNetBuckets:null,largestBuyerBps:null,priceReturnBps:null,proposedInputLamports:null,effectiveQuoteLiquidityLamports:null,jointConditionalBalanceLamports:null};
 try{
  const f=obj(features)?features:{},q=obj(quote)?quote:{},c=obj(components)?components:{},e=obj(c.economicBalance)?c.economicBalance:{};
  const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):null;
  return {netBuyLamports:signed(f.netBuyLamports)?f.netBuyLamports:null,distinctBuyerWallets:count(f.distinctBuyerWallets),positiveNetBuckets:count(f.positiveNetBuckets),largestBuyerBps:count(f.largestBuyerBps)!==null&&f.largestBuyerBps<=10000?f.largestBuyerBps:null,priceReturnBps:Number.isSafeInteger(f.priceReturnBps)?f.priceReturnBps:null,proposedInputLamports:amount(q.inputUnits)?q.inputUnits:null,effectiveQuoteLiquidityLamports:amount(q.effectiveQuoteLiquidityLamports)?q.effectiveQuoteLiquidityLamports:null,jointConditionalBalanceLamports:signed(e.jointConditionalBalanceLamports)?e.jointConditionalBalanceLamports:null};
 }catch{return empty;}
}

/** Deliberately fails open for optional analytics, returning no provenance. */
export function tradeDecisionContext(value:unknown,decidedAt:number):TradeDecisionContext|null{
 try{
  if(!time(decidedAt)||!obj(value)||!exact(value,'schemaVersion,strategyVersion,reason,candidateAdmittedAt,windowStartAt,windowEndAt,assessedAt,decisionQuoteAt'+(Object.hasOwn(value,'entryBasis')?',entryBasis':''))||value.schemaVersion!==1||!(value.strategyVersion===null||text(value.strategyVersion,128))||!(value.reason===null||text(value.reason,256)))return null;
  for(const k of ['candidateAdmittedAt','windowStartAt','windowEndAt','assessedAt','decisionQuoteAt'])if(!knownTime(value[k],decidedAt))return null;
  if((value.windowStartAt===null)!==(value.windowEndAt===null)||value.windowStartAt!==null&&value.windowStartAt>value.windowEndAt||value.assessedAt!==null&&value.windowEndAt!==null&&value.assessedAt<value.windowEndAt)return null;
  if(Object.hasOwn(value,'entryBasis')){
   const b=value.entryBasis;if(!obj(b)||!exact(b,'netBuyLamports,distinctBuyerWallets,positiveNetBuckets,largestBuyerBps,priceReturnBps,proposedInputLamports,effectiveQuoteLiquidityLamports,jointConditionalBalanceLamports'))return null;
   for(const k of ['netBuyLamports','jointConditionalBalanceLamports'])if(b[k]!==null&&!signed(b[k]))return null;
   for(const k of ['proposedInputLamports','effectiveQuoteLiquidityLamports'])if(b[k]!==null&&!amount(b[k]))return null;
   for(const k of ['distinctBuyerWallets','positiveNetBuckets','largestBuyerBps'])if(b[k]!==null&&(!Number.isSafeInteger(b[k])||b[k]<0))return null;
   if(b.largestBuyerBps!==null&&b.largestBuyerBps>10000||b.priceReturnBps!==null&&!Number.isSafeInteger(b.priceReturnBps))return null;
  }
  return structuredClone(value) as TradeDecisionContext;
 }catch{return null;}
}
export function tradeEntryProvenance(value:unknown,position:{units:string;enteredAt:number},now:number):TradeEntryProvenance|null{
 try{
  if(!obj(value)||!exact(value,'schemaVersion,orderId,units,decidedAt,executeAt,filledAt,quoteAt,context,failedExitGasLamports')||value.schemaVersion!==1||!text(value.orderId,100)||value.units!==position.units||!amount(value.units)||value.filledAt!==position.enteredAt||!time(now)||![value.decidedAt,value.executeAt,value.filledAt,value.quoteAt].every(time)||value.decidedAt>value.executeAt||value.executeAt>value.quoteAt||value.quoteAt>value.filledAt||value.filledAt>now||!amount(value.failedExitGasLamports))return null;
  const context=value.context===null?null:tradeDecisionContext(value.context,value.decidedAt);if(value.context!==null&&!context)return null;
  return {...value,context} as TradeEntryProvenance;
 }catch{return null;}
}
export function entryTradeProvenance(order:OrderFacts,quote:QuoteFacts,at:number):TradeEntryProvenance|null{
 const value={schemaVersion:1,orderId:order.id,units:quote.receiveUnits,decidedAt:order.decidedAt,executeAt:order.executeAt,filledAt:at,quoteAt:quote.at,context:tradeDecisionContext(order.decisionContext,order.decidedAt),failedExitGasLamports:'0'};
 return tradeEntryProvenance(value,{units:quote.receiveUnits,enteredAt:at},at);
}
/** Only charged failed exits during this held position belong to its result.
 * Failed entries have no position and remain separate portfolio costs. */
export function withFailedExitGas(position:PositionFacts,gas:string,at:number):TradeEntryProvenance|null{
 const p=tradeEntryProvenance(position.tradeProvenance,position,at);
 if(!p||!amount(gas))return null;
 const total=BigInt(p.failedExitGasLamports)+BigInt(gas);
 return amount(total.toString())?{...p,failedExitGasLamports:total.toString()}:null;
}
const point=(p:TradeEntryProvenance):TradeExecutionPoint=>({orderId:p.orderId,decidedAt:p.decidedAt,executeAt:p.executeAt,filledAt:p.filledAt,quoteAt:p.quoteAt,context:p.context});
export function makeTradeOutcome(order:OrderFacts,quote:QuoteFacts,at:number,position?:PositionFacts):TradeOutcomeReport|null{
 try{
  if(!time(at)||!amount(order.gas)||!amount(quote.spendLamports)||!amount(quote.receiveUnits))return null;
  const own=entryTradeProvenance(order,quote,at);if(!own)return null;
  if(order.side==='buy')return {schemaVersion:1,kind:'entry',basis:'durable-modeled-paper-fills',entry:point(own),exit:null,economics:{entrySpendLamports:quote.spendLamports,entryGasLamports:order.gas,exitReceiveLamports:null,exitGasLamports:null,failedExitGasLamports:null,filledPairNetLamports:null,closedTradeNetLamports:null},observation:{bestObservedNetLamports:null,bestObservedAt:null,givebackFromObservedNetLamports:null},attribution:'recorded-facts-only-cause-not-established'};
  if(!position||!amount(position.entryLamports)||!amount(position.entryGas)||!time(position.enteredAt)||position.enteredAt>order.decidedAt)return null;
  const prior=tradeEntryProvenance(position.tradeProvenance,position,at),s=position.strategy;
  const fallbackContext=s?tradeDecisionContext({schemaVersion:1,strategyVersion:s.version,reason:null,candidateAdmittedAt:null,windowStartAt:s.windowStartAt,windowEndAt:s.windowEndAt,assessedAt:s.assessedAt,decisionQuoteAt:null},position.enteredAt):null;
  const entry=prior?point(prior):{orderId:s&&text(s.roundTripId,100)?s.roundTripId:null,decidedAt:null,executeAt:null,filledAt:position.enteredAt,quoteAt:null,context:fallbackContext};
  const pair=BigInt(quote.receiveUnits)-BigInt(order.gas)-BigInt(position.entryLamports)-BigInt(position.entryGas),failed=prior?.failedExitGasLamports??null;
  const peak=s&&amount(s.highWaterNetLamports)&&BigInt(s.highWaterNetLamports)>0n&&time(s.highWaterAt)&&s.highWaterAt>=position.enteredAt&&s.highWaterAt<=at?{net:s.highWaterNetLamports,at:s.highWaterAt}:null;
  const exitNet=BigInt(quote.receiveUnits)-BigInt(order.gas),giveback=peak?BigInt(peak.net)-exitNet:null;
  const result:TradeOutcomeReport={schemaVersion:1,kind:'closed-position',basis:'durable-modeled-paper-fills',entry,exit:point(own),economics:{entrySpendLamports:position.entryLamports,entryGasLamports:position.entryGas,exitReceiveLamports:quote.receiveUnits,exitGasLamports:order.gas,failedExitGasLamports:failed,filledPairNetLamports:pair.toString(),closedTradeNetLamports:failed===null?null:(pair-BigInt(failed)).toString()},observation:{bestObservedNetLamports:peak?.net??null,bestObservedAt:peak?.at??null,givebackFromObservedNetLamports:giveback===null?null:(giveback>0n?giveback:0n).toString()},attribution:'recorded-facts-only-cause-not-established'};
  return readTradeOutcome(result,at,'sell');
 }catch{return null;}
}
/** Exact public allowlist and arithmetic checks; never exports raw evidence. */
export function readTradeOutcome(value:unknown,at:number,side:'buy'|'sell'):TradeOutcomeReport|null{
 try{
  if(!time(at)||!obj(value)||!exact(value,'schemaVersion,kind,basis,entry,exit,economics,observation,attribution')||value.schemaVersion!==1||value.kind!==(side==='buy'?'entry':'closed-position')||value.basis!=='durable-modeled-paper-fills'||value.attribution!=='recorded-facts-only-cause-not-established')return null;
  const checkPoint=(p:unknown)=>{
   if(!obj(p)||!exact(p,'orderId,decidedAt,executeAt,filledAt,quoteAt,context')||!(p.orderId===null||text(p.orderId,100))||!time(p.filledAt)||p.filledAt>at)return false;
   for(const k of ['decidedAt','executeAt','quoteAt'])if(!knownTime(p[k],p.filledAt))return false;
   if(p.decidedAt!==null&&p.executeAt!==null&&p.decidedAt>p.executeAt||p.executeAt!==null&&p.quoteAt!==null&&p.executeAt>p.quoteAt)return false;
   return p.context===null||!!tradeDecisionContext(p.context,p.decidedAt??p.filledAt);
  };
  if(!checkPoint(value.entry))return null;
  if(side==='buy'?(value.exit!==null||value.entry.filledAt!==at):(!checkPoint(value.exit)||value.exit.filledAt!==at||value.entry.filledAt>value.exit.filledAt||value.exit.decidedAt!==null&&value.entry.filledAt>value.exit.decidedAt))return null;
  const e=value.economics,o=value.observation;
  if(!obj(e)||!exact(e,'entrySpendLamports,entryGasLamports,exitReceiveLamports,exitGasLamports,failedExitGasLamports,filledPairNetLamports,closedTradeNetLamports')||!amount(e.entrySpendLamports)||!amount(e.entryGasLamports)||!obj(o)||!exact(o,'bestObservedNetLamports,bestObservedAt,givebackFromObservedNetLamports'))return null;
  if(side==='buy'){
   if(['exitReceiveLamports','exitGasLamports','failedExitGasLamports','filledPairNetLamports','closedTradeNetLamports'].some(k=>e[k]!==null)||Object.values(o).some(v=>v!==null))return null;
  }else{
   if(!amount(e.exitReceiveLamports)||!amount(e.exitGasLamports)||!(e.failedExitGasLamports===null||amount(e.failedExitGasLamports))||!signed(e.filledPairNetLamports)||BigInt(e.filledPairNetLamports)!==BigInt(e.exitReceiveLamports)-BigInt(e.exitGasLamports)-BigInt(e.entrySpendLamports)-BigInt(e.entryGasLamports))return null;
   if(e.failedExitGasLamports===null?e.closedTradeNetLamports!==null:!signed(e.closedTradeNetLamports)||BigInt(e.closedTradeNetLamports)!==BigInt(e.filledPairNetLamports)-BigInt(e.failedExitGasLamports))return null;
   if(o.bestObservedNetLamports===null){if(o.bestObservedAt!==null||o.givebackFromObservedNetLamports!==null)return null;}
   else{if(!amount(o.bestObservedNetLamports)||!time(o.bestObservedAt)||o.bestObservedAt<value.entry.filledAt||o.bestObservedAt>at||!amount(o.givebackFromObservedNetLamports))return null;const difference=BigInt(o.bestObservedNetLamports)-(BigInt(e.exitReceiveLamports)-BigInt(e.exitGasLamports));if(BigInt(o.givebackFromObservedNetLamports)!==(difference>0n?difference:0n))return null;}
  }
  return structuredClone(value) as TradeOutcomeReport;
 }catch{return null;}
}
