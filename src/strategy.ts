/** Offline rule/feature core. No provider, network, financial writer or entry-enable path. */
export const PROVISIONAL_RULE = Object.freeze({
  version: 'persistent-buying-v0-unfrozen', windowMs: 60_000, bucketMs: 10_000,
  minimumAgeMs: 300_000, maximumAgeMs: 7_200_000, minimumNetBuyLamports: '1000000000',
  minimumPositiveBuckets: 4, minimumBuyers: 5, maximumLargestBuyerBps: 3500,
  maximumSizeToLiquidityBps: 500, maximumInitialCostMicroUsd: '50000000',
  maximumHoldingMs: 900_000, stopLossBps: 1500, takeProfitBps: 3000,
  modeledDelayMs: 1000, orderExpiryMs: 5000, maximumQuoteAgeMs: 2000,
} as const);

export type EventIdentity = { signature: string; instructionIndex: number; eventIndex: number };
export type NormalizedTrade = {
  identity: EventIdentity; mint: string; wallet: string; side: 'buy'|'sell';
  quoteLamports: string; tokenUnits: string; receivedAt: number;
  commitment: 'processed'|'confirmed'|'finalized'; slot?: number;
};
type StoredTrade = NormalizedTrade & { quote: bigint; units: bigint; active: boolean; key: string };
type Seen = { fingerprint: string; commitment: NormalizedTrade['commitment']; lastAt: number; trade?: StoredTrade; revoked?: boolean };
export type FlowFeatures = {
  mint: string; asOf: number; windowStartAt: number; windowEndAt: number;
  sufficientlyObserved: boolean; qualityReason: string|null;
  buyLamports: string; sellLamports: string; netBuyLamports: string;
  tradeCount: number; provisionalTradeCount: number; distinctBuyerWallets: number;
  largestBuyerBps: number; positiveNetBuckets: number; priceReturnBps: number|null;
  /** Prices are ratios of observed lamports/base units, not pool-mid or executable prices. */
  firstPrice: {quoteLamports:string;tokenUnits:string}|null;
  lastPrice: {quoteLamports:string;tokenUnits:string}|null;
};
type PriceRatio=NonNullable<FlowFeatures['firstPrice']>;
const rank = {processed:0,confirmed:1,finalized:2};
const text = (v:unknown,max=128):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const at = (v:number)=>{if(!Number.isSafeInteger(v)||v<0)throw new Error('valid availability time required');return v;};
const amount = (v:string)=>{if(typeof v!=='string'||!/^[1-9][0-9]{0,38}$/.test(v))throw new Error('positive integer trade amount required');return BigInt(v);};
function priceReturn(first:PriceRatio|null,last:PriceRatio|null):number|null {
  if(!first||!last)return null;
  const numerator=(amount(last.quoteLamports)*amount(first.tokenUnits)-amount(first.quoteLamports)*amount(last.tokenUnits))*10_000n;
  const denominator=amount(first.quoteLamports)*amount(last.tokenUnits);
  const bps=numerator<0n?-((-numerator+denominator-1n)/denominator):numerator/denominator;
  return bps<=BigInt(Number.MAX_SAFE_INTEGER)?Number(bps):null;
}
export function eventIdentity(identity:EventIdentity):string {
  if(!text(identity?.signature,100)||!Number.isSafeInteger(identity.instructionIndex)||identity.instructionIndex<0||!Number.isSafeInteger(identity.eventIndex)||identity.eventIndex<0)throw new Error('complete instruction/event identity required');
  return `${identity.signature}:${identity.instructionIndex}:${identity.eventIndex}`;
}

/** Six closed 10s receive-time bins. Each observation enters/leaves aggregates once. */
export class FlowWindow {
  private active:StoredTrade[]=[]; private head=0;
  private pending:StoredTrade[]=[]; private pendingHead=0;
  private readonly seen=new Map<string,Seen>();
  private readonly buyers=new Map<string,{quote:bigint;count:number}>();
  private readonly buckets=new Map<number,bigint>();
  private bought=0n; private sold=0n; private provisional=0; private trades=0;
  private informationAt:number; private warmedFrom:number; private invalidReason:string|null=null;
  constructor(readonly mint:string,observingFrom:number,private readonly maximumEvents=4096) {
    if(!text(mint,96)||!Number.isSafeInteger(maximumEvents)||maximumEvents<6||maximumEvents>4096)throw new Error('bounded flow configuration required');
    this.informationAt=this.warmedFrom=at(observingFrom);
  }
  private advance(now:number) {
    at(now);if(now<this.informationAt)throw new Error('information cannot be observed before it became available');
    this.informationAt=now;
    const end=Math.floor(now/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs;
    const start=end-PROVISIONAL_RULE.windowMs;
    while(this.head<this.active.length&&this.active[this.head]!.receivedAt<start){const t=this.active[this.head++]!;this.aggregate(t,-1);t.active=false;}
    while(this.pendingHead<this.pending.length&&this.pending[this.pendingHead]!.receivedAt<end){
      const t=this.pending[this.pendingHead++]!;
      if(t.receivedAt>=start){t.active=true;this.active.push(t);this.aggregate(t,1);}
    }
    if(this.head>512){this.active=this.active.slice(this.head);this.head=0;}
    if(this.pendingHead>512){this.pending=this.pending.slice(this.pendingHead);this.pendingHead=0;}
    for(const [key,entry] of this.seen){if(entry.lastAt>=now-2*PROVISIONAL_RULE.windowMs)break;this.seen.delete(key);}
  }
  private aggregate(t:StoredTrade,delta:1|-1) {
    this.trades+=delta;if(t.commitment==='processed')this.provisional+=delta;
    const bucket=Math.floor(t.receivedAt/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs;
    const net=(t.side==='buy'?t.quote:-t.quote)*BigInt(delta),value=(this.buckets.get(bucket)??0n)+net;
    if(value===0n)this.buckets.delete(bucket);else this.buckets.set(bucket,value);
    if(t.side==='buy'){
      this.bought+=t.quote*BigInt(delta);const old=this.buyers.get(t.wallet)??{quote:0n,count:0};
      const next={quote:old.quote+t.quote*BigInt(delta),count:old.count+delta};
      if(next.count===0)this.buyers.delete(t.wallet);else this.buyers.set(t.wallet,next);
    }else this.sold+=t.quote*BigInt(delta);
  }
  /** Missing evidence or a correction invalidates the whole affected lookback. */
  invalidate(receivedAt:number,reason:'feed-gap'|'correction'|'reversal'|'capacity-gap') {
    this.advance(receivedAt);for(let i=this.head;i<this.active.length;i++)this.active[i]!.active=false;
    this.active=[];this.pending=[];this.head=this.pendingHead=0;this.buyers.clear();this.buckets.clear();
    // A window whose inclusive start is the lost event's time is still affected.
    this.bought=this.sold=0n;this.trades=this.provisional=0;this.warmedFrom=receivedAt+1;this.invalidReason=reason;
  }
  ingest(input:NormalizedTrade):'accepted'|'duplicate'|'confirmed'|'invalidated' {
    if(input.mint!==this.mint||!text(input.wallet)||!['buy','sell'].includes(input.side)||!Object.hasOwn(rank,input.commitment)||input.slot!==undefined&&(!Number.isSafeInteger(input.slot)||input.slot<0))throw new Error('invalid normalized trade');
    const key=eventIdentity(input.identity),quote=amount(input.quoteLamports),units=amount(input.tokenUnits);
    this.advance(input.receivedAt);
    const fingerprint=JSON.stringify([input.wallet,input.side,input.quoteLamports,input.tokenUnits,input.slot??null]);
    const prior=this.seen.get(key);
    if(prior){
      if(prior.revoked)return 'duplicate';
      this.seen.delete(key);this.seen.set(key,{...prior,lastAt:input.receivedAt});
      if(prior.fingerprint!==fingerprint){this.invalidate(input.receivedAt,'correction');this.seen.set(key,{fingerprint,commitment:input.commitment,lastAt:input.receivedAt,revoked:true});return 'invalidated';}
      if(rank[input.commitment]>rank[prior.commitment]){
        if(prior.trade){if(prior.trade.active&&prior.trade.commitment==='processed')this.provisional--;prior.trade.commitment=input.commitment;}
        this.seen.set(key,{...prior,commitment:input.commitment,lastAt:input.receivedAt});return 'confirmed';
      }
      return 'duplicate';
    }
    if(this.active.length-this.head+this.pending.length-this.pendingHead>=this.maximumEvents||this.seen.size>=2*this.maximumEvents){
      this.invalidate(input.receivedAt,'capacity-gap');this.seen.clear();
      this.seen.set(key,{fingerprint,commitment:input.commitment,lastAt:input.receivedAt,revoked:true});return 'invalidated';
    }
    const trade:StoredTrade={identity:{signature:input.identity.signature,instructionIndex:input.identity.instructionIndex,eventIndex:input.identity.eventIndex},mint:input.mint,wallet:input.wallet,side:input.side,quoteLamports:input.quoteLamports,tokenUnits:input.tokenUnits,receivedAt:input.receivedAt,commitment:input.commitment,...(input.slot===undefined?{}:{slot:input.slot}),quote,units,active:false,key};
    this.pending.push(trade);this.seen.set(key,{fingerprint,commitment:input.commitment,lastAt:input.receivedAt,trade});return 'accepted';
  }
  reverse(identity:EventIdentity,receivedAt:number) {
    const key=eventIdentity(identity);this.invalidate(receivedAt,'reversal');
    this.seen.delete(key);
    if(this.seen.size>=2*this.maximumEvents){this.invalidate(receivedAt,'capacity-gap');this.seen.clear();}
    this.seen.set(key,{fingerprint:'reversed',commitment:'processed',lastAt:receivedAt,revoked:true});
  }
  usage(){return {retainedTrades:this.active.length-this.head+this.pending.length-this.pendingHead,retainedIdentities:this.seen.size,maximumTrades:this.maximumEvents,maximumIdentities:2*this.maximumEvents};}
  features(now:number):FlowFeatures {
    this.advance(now);const end=Math.floor(now/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs,start=end-PROVISIONAL_RULE.windowMs;
    const first=this.active[this.head],last=first?this.active.at(-1):undefined;
    let largest=0n;for(const buyer of this.buyers.values())if(buyer.quote>largest)largest=buyer.quote;
    const sufficientlyObserved=start>=this.warmedFrom;
    const ratio=(t:StoredTrade|undefined)=>t?{quoteLamports:t.quoteLamports,tokenUnits:t.tokenUnits}:null;
    return {mint:this.mint,asOf:now,windowStartAt:start,windowEndAt:end,sufficientlyObserved,
      qualityReason:sufficientlyObserved?null:this.invalidReason??'warming',buyLamports:this.bought.toString(),sellLamports:this.sold.toString(),netBuyLamports:(this.bought-this.sold).toString(),
      tradeCount:this.trades,provisionalTradeCount:this.provisional,distinctBuyerWallets:this.buyers.size,
      largestBuyerBps:this.bought===0n?0:Number((largest*10_000n+this.bought-1n)/this.bought),positiveNetBuckets:[...this.buckets.values()].filter(n=>n>0n).length,
      priceReturnBps:priceReturn(ratio(first),ratio(last)),firstPrice:ratio(first),lastPrice:ratio(last)};
  }
}

/** No automatic eviction or hidden shrinkage: an admission refusal is visible. */
export class OpportunityBook {
  private readonly windows=new Map<string,FlowWindow>();
  admit(mint:string,observingFrom:number):FlowWindow|null {
    const existing=this.windows.get(mint);if(existing)return existing;
    if(this.windows.size>=12)return null;
    const window=new FlowWindow(mint,observingFrom);this.windows.set(mint,window);return window;
  }
  remove(mint:string){this.windows.delete(mint);}
  get size(){return this.windows.size;}
}

export type RuleContext = {
  mint:string;now:number; migrationAt:number|null; migrationVerified:boolean; supportedPool:boolean;
  /** Must come from the measured provider-field contract, never a fixture promoted to production. */
  flowFieldsVerified:boolean; flowVerificationEvidence:string|null;
  riskEntriesAllowed:boolean; alreadyTradedMint:boolean;
  quote:{mint:string;at:number;evidence:string;allInInitialCostMicroUsd:string;sizeToEffectiveLiquidityBps:number;expectedBaseUnits:string}|null;
};
export type RuleDecision = {qualified:boolean;kind:'missing-data'|'market-exclusion'|'strategy-rejection'|'risk-rejection'|'qualified';reason:string;ruleVersion:typeof PROVISIONAL_RULE.version;at:number;features:FlowFeatures|null};
function featureSnapshot(f:FlowFeatures,now:number):FlowFeatures|null {
  try{
    const integer=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
    if(!f||!text(f.mint,96)||f.asOf!==now||!Number.isSafeInteger(f.windowEndAt)||f.windowEndAt!==Math.floor(now/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs||f.windowStartAt!==f.windowEndAt-PROVISIONAL_RULE.windowMs||typeof f.sufficientlyObserved!=='boolean'||!(f.qualityReason===null||text(f.qualityReason))||f.sufficientlyObserved&&f.qualityReason!==null)return null;
    if(!integer(f.tradeCount,0,4096)||!integer(f.provisionalTradeCount,0,f.tradeCount)||!integer(f.distinctBuyerWallets,0,f.tradeCount)||!integer(f.positiveNetBuckets,0,Math.min(6,f.tradeCount))||!integer(f.largestBuyerBps,0,10_000))return null;
    const unsigned=(n:string)=>typeof n==='string'&&/^(0|[1-9][0-9]{0,42})$/.test(n);
    if(!unsigned(f.buyLamports)||!unsigned(f.sellLamports)||typeof f.netBuyLamports!=='string'||!/^(-?[1-9][0-9]{0,42}|0)$/.test(f.netBuyLamports)||BigInt(f.netBuyLamports)!==BigInt(f.buyLamports)-BigInt(f.sellLamports))return null;
    if(BigInt(f.buyLamports)===0n?(f.distinctBuyerWallets!==0||f.largestBuyerBps!==0):(f.distinctBuyerWallets===0||f.largestBuyerBps<Math.ceil(10_000/f.distinctBuyerWallets)))return null;
    if(f.tradeCount===0?(f.firstPrice!==null||f.lastPrice!==null||BigInt(f.buyLamports)+BigInt(f.sellLamports)!==0n):(!f.firstPrice||!f.lastPrice||BigInt(f.buyLamports)+BigInt(f.sellLamports)===0n))return null;
    if(f.priceReturnBps!==null&&!Number.isSafeInteger(f.priceReturnBps)||f.priceReturnBps!==priceReturn(f.firstPrice,f.lastPrice))return null;
    const ratio=(p:PriceRatio|null)=>p?{quoteLamports:p.quoteLamports,tokenUnits:p.tokenUnits}:null;
    return {mint:f.mint,asOf:f.asOf,windowStartAt:f.windowStartAt,windowEndAt:f.windowEndAt,sufficientlyObserved:f.sufficientlyObserved,qualityReason:f.qualityReason,buyLamports:f.buyLamports,sellLamports:f.sellLamports,netBuyLamports:f.netBuyLamports,tradeCount:f.tradeCount,provisionalTradeCount:f.provisionalTradeCount,distinctBuyerWallets:f.distinctBuyerWallets,largestBuyerBps:f.largestBuyerBps,positiveNetBuckets:f.positiveNetBuckets,priceReturnBps:f.priceReturnBps,firstPrice:ratio(f.firstPrice),lastPrice:ratio(f.lastPrice)};
  }catch{return null;}
}
export function evaluatePrimary(features:FlowFeatures,context:RuleContext):RuleDecision {
  at(context.now);
  const snapshot=featureSnapshot(features,context.now);
  const no=(kind:RuleDecision['kind'],reason:string):RuleDecision=>({qualified:kind==='qualified',kind,reason,ruleVersion:PROVISIONAL_RULE.version,at:context.now,features:snapshot});
  if(context.flowFieldsVerified!==true||!text(context.flowVerificationEvidence))return no('missing-data','trade-feed-fields-not-verified');
  if(!snapshot)return no('missing-data','malformed-or-unavailable-features');
  if(!text(context.mint,96)||snapshot.mint!==context.mint)return no('missing-data','candidate-identity-mismatch');
  if(context.migrationVerified!==true||context.migrationAt===null||!Number.isSafeInteger(context.migrationAt)||context.migrationAt<0||context.migrationAt>context.now)return no('missing-data','verified-migration-time-unavailable');
  if(context.supportedPool!==true)return no('market-exclusion','unsupported-pool');
  const age=context.now-context.migrationAt;
  if(age<PROVISIONAL_RULE.minimumAgeMs||age>PROVISIONAL_RULE.maximumAgeMs)return no('market-exclusion','outside-provisional-migration-age');
  if(snapshot.sufficientlyObserved!==true)return no('missing-data',snapshot.qualityReason??'feature-availability-mismatch');
  if(context.riskEntriesAllowed!==true||context.alreadyTradedMint)return no('risk-rejection',context.alreadyTradedMint?'reentry-disabled':'entries-not-authorized-by-ledger');
  const q=context.quote;
  if(!q||!text(q.evidence)||!Number.isSafeInteger(q.at)||q.at>context.now||context.now-q.at>PROVISIONAL_RULE.maximumQuoteAgeMs)return no('missing-data','fresh-size-specific-quote-unavailable');
  if(q.mint!==context.mint)return no('missing-data','candidate-quote-identity-mismatch');
  if(typeof q.allInInitialCostMicroUsd!=='string'||!/^[1-9][0-9]{0,38}$/.test(q.allInInitialCostMicroUsd)||BigInt(q.allInInitialCostMicroUsd)>BigInt(PROVISIONAL_RULE.maximumInitialCostMicroUsd))return no('risk-rejection','initial-cost-including-execution-exceeds-limit');
  if(typeof q.expectedBaseUnits!=='string'||!/^[1-9][0-9]{0,38}$/.test(q.expectedBaseUnits)||!Number.isSafeInteger(q.sizeToEffectiveLiquidityBps)||q.sizeToEffectiveLiquidityBps<0||q.sizeToEffectiveLiquidityBps>PROVISIONAL_RULE.maximumSizeToLiquidityBps)return no('market-exclusion','order-size-exceeds-execution-liquidity-bound');
  if(BigInt(snapshot.netBuyLamports)<BigInt(PROVISIONAL_RULE.minimumNetBuyLamports)||snapshot.positiveNetBuckets<PROVISIONAL_RULE.minimumPositiveBuckets||snapshot.distinctBuyerWallets<PROVISIONAL_RULE.minimumBuyers||snapshot.largestBuyerBps>PROVISIONAL_RULE.maximumLargestBuyerBps)return no('strategy-rejection','persistent-broad-buying-rule-not-met');
  if(snapshot.priceReturnBps===null)return no('missing-data','price-structure-unavailable');
  if(snapshot.priceReturnBps<0)return no('strategy-rejection','persistent-broad-buying-rule-not-met');
  return no('qualified','provisional-rule-passed; execution-and-accounting-still-required');
}

export function evaluateExit(input:{now:number;enteredAt:number;entryCostLamports:string;heldBaseUnits:string;mark:{at:number;netLamports:string;pricedBaseUnits:string;evidence:string}|null}):{action:'hold'|'quote-required'|'request-exit';reason:string} {
  at(input.now);at(input.enteredAt);if(input.now<input.enteredAt)throw new Error('entry cannot be in the future');
  const cost=amount(input.entryCostLamports);amount(input.heldBaseUnits);
  if(input.now-input.enteredAt>=PROVISIONAL_RULE.maximumHoldingMs)return {action:'request-exit',reason:'maximum-holding-time; fresh executable quote still required'};
  const m=input.mark;
  if(!m||!text(m.evidence)||!Number.isSafeInteger(m.at)||m.at>input.now||input.now-m.at>PROVISIONAL_RULE.maximumQuoteAgeMs||m.pricedBaseUnits!==input.heldBaseUnits||typeof m.netLamports!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(m.netLamports))return {action:'quote-required',reason:'actual-size-net-liquidation-unavailable'};
  const net=BigInt(m.netLamports);
  if(net*10_000n<=cost*BigInt(10_000-PROVISIONAL_RULE.stopLossBps))return {action:'request-exit',reason:'net-liquidation-stop; fill-price-not-guaranteed'};
  if(net*10_000n>=cost*BigInt(10_000+PROVISIONAL_RULE.takeProfitBps))return {action:'request-exit',reason:'net-liquidation-take-profit'};
  return {action:'hold',reason:'no-provisional-exit-trigger'};
}
