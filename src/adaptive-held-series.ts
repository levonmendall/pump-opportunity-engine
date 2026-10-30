/** In-memory descriptive statistics over already acquired exact-size SOL
 * liquidation marks. No provider, financial writer, entry authority or I/O.
 * The ledger's durable high-water remains authoritative across restarts. */
import {ADAPTIVE_MOMENTUM_V2_POLICY} from './adaptive-momentum-v2.js';

export const ADAPTIVE_HELD_SERIES_POLICY=Object.freeze({
 version:'actual-size-net-liquidation-dispersion-v1',
 lookbackMs:60000,maximumQuotes:256,maximumSeries:256,maximumCompletedGapMs:4000,
 minimumPriorQuotes:3,
 measurement:'Sample standard deviation of signed consecutive net-liquidation returns in basis points; no time scaling or prediction. Current quote is excluded.',
 protection:'Width changes only at a new executable high-water, and never lowers the previously modeled trailing boundary. The cost stop is unchanged.',
 recovery:'Restart, source/evidence gap or changed inventory uses the existing 15% trailing fallback with the persisted ledger high-water. This may tighten protection.',
});
type Mark={at:number;netLamports:string;pricedBaseUnits:string;evidence:string};
export type AdaptiveHeldObservation={now:number;mint:string;roundTripId:string;enteredAt:number;heldBaseUnits:string;highWaterNetLamports:string;mark:Mark|null;sourceCurrent:boolean};
type Sample={at:number;observedAt:number;net:bigint;evidence:string};
type Series={roundTripId:string;enteredAt:number;units:string;samples:Sample[];peak:bigint;floorNumerator:bigint;effectiveVolatilityBps:number|null};
export type AdaptiveHeldSignal={
 version:typeof ADAPTIVE_HELD_SERIES_POLICY.version;
 state:'measured'|'fallback';reason:string;acceptedNewQuote:boolean;
 priorQuoteCount:number;priorReturnCount:number;priorFromAt:number|null;priorThroughAt:number|null;
 minimumIntervalMs:number|null;maximumIntervalMs:number|null;
 measuredVolatilityBps:number|null;effectiveVolatilityBps:number|null;trailingDistanceBps:number;
 modeledTrailingBoundaryLamports:string|null;
};
const p=ADAPTIVE_HELD_SERIES_POLICY,exit=ADAPTIVE_MOMENTUM_V2_POLICY.exit;
const uint=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown,max=512):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const money=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const ceilDiv=(n:bigint,d:bigint)=>(n+d-1n)/d;
const distance=(v:number|null)=>Math.min(9999,Math.max(exit.trailingMinimumBps,Math.ceil((v??0)*exit.volatilityMultiplierBps/10000)));
const fallback=(reason:string):AdaptiveHeldSignal=>({version:p.version,state:'fallback',reason,acceptedNewQuote:false,priorQuoteCount:0,priorReturnCount:0,priorFromAt:null,priorThroughAt:null,minimumIntervalMs:null,maximumIntervalMs:null,measuredVolatilityBps:null,effectiveVolatilityBps:null,trailingDistanceBps:exit.trailingMinimumBps,modeledTrailingBoundaryLamports:null});
/** Exact integer ceiling of sqrt(n/d), bounded by the existing exit input
 * contract. A larger or undefined statistic is unknown, never fabricated. */
function deviation(n:bigint,d:bigint):number|null{
 if(d<=0n||n<0n||n>10000n*10000n*d)return null;
 let low=0,high=10000;while(low<high){const mid=Math.floor((low+high)/2);if(BigInt(mid)*BigInt(mid)*d>=n)high=mid;else low=mid+1;}return low;
}
function measurement(samples:readonly Sample[]){
 const basic={priorQuoteCount:samples.length,priorReturnCount:Math.max(0,samples.length-1),priorFromAt:samples[0]?.at??null,priorThroughAt:samples.at(-1)?.at??null,minimumIntervalMs:null as number|null,maximumIntervalMs:null as number|null,measuredVolatilityBps:null as number|null};
 if(samples.length<p.minimumPriorQuotes)return {...basic,reason:'distinct-prior-quotes-required'};
 let total=0n,squares=0n,minimum=Infinity,maximum=0;
 for(let i=1;i<samples.length;i++){
  const before=samples[i-1]!,after=samples[i]!,interval=after.at-before.at;
  minimum=Math.min(minimum,interval);maximum=Math.max(maximum,interval);
  if(before.net===0n)return {...basic,minimumIntervalMs:minimum,maximumIntervalMs:maximum,reason:'zero-relative-price-baseline'};
  const change=(after.net-before.net)*10000n/before.net;total+=change;squares+=change*change;
 }
 const n=BigInt(samples.length-1),value=deviation(n*squares-total*total,n*(n-1n));
 return {...basic,minimumIntervalMs:minimum,maximumIntervalMs:maximum,measuredVolatilityBps:value,reason:value===null?'dispersion-outside-exit-input-range':'lagged-executable-return-dispersion'};
}

export class AdaptiveHeldSeries{
 private readonly series=new Map<string,Series>();
 /** Closed round trips never donate samples or protection to a later entry. */
 retain(current:readonly {mint:string;roundTripId:string}[]){const owned=new Map(current.map(v=>[v.mint,v.roundTripId]));for(const [mint,s]of this.series)if(owned.get(mint)!==s.roundTripId)this.series.delete(mint);}
 usage(){return {series:this.series.size,quotes:[...this.series.values()].reduce((n,s)=>n+s.samples.length,0),maximumQuotesPerSeries:p.maximumQuotes};}
 observe(input:AdaptiveHeldObservation):AdaptiveHeldSignal{
  const refuse=(reason:string)=>{this.series.delete(input.mint);return fallback(reason);};
  if(!uint(input.now)||!uint(input.enteredAt)||input.enteredAt>input.now||!text(input.mint,96)||!text(input.roundTripId,100)||!money(input.heldBaseUnits)||BigInt(input.heldBaseUnits)===0n||!money(input.highWaterNetLamports))return refuse('holding-identity-unavailable');
  const mark=input.mark;
  if(input.sourceCurrent!==true||!mark||!uint(mark.at)||mark.at<input.enteredAt||mark.at>input.now||input.now-mark.at>exit.maximumQuoteAgeMs||mark.pricedBaseUnits!==input.heldBaseUnits||!money(mark.netLamports)||!text(mark.evidence))return refuse('fresh-current-exact-size-mark-required');
  const peak=BigInt(input.highWaterNetLamports),net=BigInt(mark.netLamports);
  // The source must have passed the ledger's high-water validation first.
  if(net>peak)return refuse('authoritative-high-water-not-checkpointed');
  let s=this.series.get(input.mint),resetReason:string|null=null;
  if(s&&(s.roundTripId!==input.roundTripId||s.enteredAt!==input.enteredAt||s.units!==input.heldBaseUnits)){this.series.delete(input.mint);s=undefined;resetReason='round-trip-or-size-changed';}
  if(s&&peak<s.peak)return refuse('authoritative-high-water-regressed');
  const last=s?.samples.at(-1);
  if(last&&input.now<last.observedAt)return refuse('observation-time-regressed');
  if(last&&mark.at<last.at)return refuse('quote-time-regressed');
  if(last&&mark.at===last.at&&(net!==last.net||mark.evidence!==last.evidence))return refuse('same-time-quote-conflict');
  if(last&&(mark.at-last.at>p.maximumCompletedGapMs||input.now-last.observedAt>p.maximumCompletedGapMs)){this.series.delete(input.mint);s=undefined;resetReason='completed-protection-gap';}
  if(!s){
   if(this.series.size>=p.maximumSeries)return fallback('optional-series-capacity');
   s={roundTripId:input.roundTripId,enteredAt:input.enteredAt,units:input.heldBaseUnits,samples:[],peak,floorNumerator:peak*BigInt(10000-exit.trailingMinimumBps),effectiveVolatilityBps:null};this.series.set(input.mint,s);
  }
  s.samples=s.samples.filter(v=>v.at>=mark.at-p.lookbackMs);
  const prior=measurement(s.samples.filter(v=>v.at<mark.at)),isNew=mark.at!==(s.samples.at(-1)?.at);
  if(peak>s.peak){
   // A decline never recalibrates its own threshold, including on the next
   // evaluation. Even a new peak cannot lower the prior modeled boundary.
   const maximumDistance=Number(10000n-ceilDiv(s.floorNumerator,peak));
   let chosen=prior.measuredVolatilityBps;
   if(chosen!==null&&distance(chosen)>maximumDistance){let low=0,high=chosen;while(low<high){const mid=Math.ceil((low+high)/2);if(distance(mid)<=maximumDistance)low=mid;else high=mid-1;}chosen=low;}
   s.effectiveVolatilityBps=chosen;s.peak=peak;
  }
  const trailingDistanceBps=distance(s.effectiveVolatilityBps),boundary=peak*BigInt(10000-trailingDistanceBps);
  if(boundary>s.floorNumerator)s.floorNumerator=boundary;
  if(isNew){s.samples.push({at:mark.at,observedAt:input.now,net,evidence:mark.evidence});if(s.samples.length>p.maximumQuotes)s.samples.splice(0,s.samples.length-p.maximumQuotes);}
  return {...prior,version:p.version,state:s.effectiveVolatilityBps===null?'fallback':'measured',reason:resetReason??(!isNew?'same-quote-not-an-additional-sample':s.effectiveVolatilityBps===null?(prior.measuredVolatilityBps===null?prior.reason:'awaiting-new-high-water'):'lagged-width-with-nondecreasing-boundary'),acceptedNewQuote:isNew,effectiveVolatilityBps:s.effectiveVolatilityBps,trailingDistanceBps,modeledTrailingBoundaryLamports:ceilDiv(s.floorNumerator,10000n).toString()};
 }
}
