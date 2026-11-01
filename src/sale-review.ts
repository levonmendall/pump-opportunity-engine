/** Reporting-only four-hour price comparison. No strategy or execution authority. */
export const SALE_REVIEW_DELAY_MS = 4 * 60 * 60 * 1000;
// Scheduler/transport tolerance, not an extended observation window.
export const SALE_REVIEW_GRACE_MS = 60_000;
export const SALE_REVIEW_MAX_SOURCE_AGE_MS = 30_000;
export type SaleReviewStatus = 'PENDING'|'GOOD SALE'|'BAD SALE'|'UNCHANGED'|'UNAVAILABLE';
export type PriceRatio = {quoteLamports:string; baseUnits:string};
export type SalePricePoint = PriceRatio & {observedAt:number; sourceAt:number; decimals:number};
export type SaleReview = {
  fillId:string; mint:string; filledAt:number; dueAt:number;
  salePrice:PriceRatio; status:SaleReviewStatus; price:SalePricePoint|null;
  changePercent:string|null; reason:string|null;
};
export type SaleReviewReport = {
  schemaVersion:1; accountId:string; inceptionAt:string; generatedAt:number;
  basis:'four-hour-price-only'; reviews:SaleReview[];
};
export const positiveAmount = (v:unknown):v is string => typeof v==='string' && /^[1-9][0-9]{0,38}$/.test(v);
export const reviewTime = (v:unknown):v is number => Number.isSafeInteger(v) && Number(v)>=0;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:Record<string,unknown>,keys:string)=>Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
function ratio(v:unknown):v is PriceRatio{return object(v)&&exact(v,'quoteLamports,baseUnits')&&positiveAmount(v.quoteLamports)&&positiveAmount(v.baseUnits);}
export function pendingSaleReview(fillId:string,mint:string,filledAt:number,salePrice:PriceRatio):SaleReview {
  if(!/^paper-fill:[a-f0-9]{32}$/.test(fillId)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!reviewTime(filledAt)||!reviewTime(filledAt+SALE_REVIEW_DELAY_MS)||!ratio(salePrice))throw Error('SALE_REVIEW_FILL_INVALID');
  return {fillId,mint,filledAt,dueAt:filledAt+SALE_REVIEW_DELAY_MS,salePrice:{...salePrice},status:'PENDING',price:null,changePercent:null,reason:null};
}
export function unavailableSaleReview(review:SaleReview,reason:string):SaleReview {
  if(!/^[A-Z_]{1,64}$/.test(reason))throw Error('SALE_REVIEW_REASON_INVALID');
  return {...review,status:'UNAVAILABLE',price:null,changePercent:null,reason};
}
/** Exact cross multiplication decides the label; rounded display numbers never do. */
export function completeSaleReview(review:SaleReview,point:SalePricePoint|null,now:number):SaleReview {
  if(!reviewTime(now))throw Error('SALE_REVIEW_TIME_INVALID');
  if(now<review.dueAt)return review;
  if(now>review.dueAt+SALE_REVIEW_GRACE_MS)return unavailableSaleReview(review,'CHECKPOINT_MISSED');
  if(!point||!positiveAmount(point.quoteLamports)||!positiveAmount(point.baseUnits)||!reviewTime(point.observedAt)||!reviewTime(point.sourceAt)||!Number.isInteger(point.decimals)||point.decimals<0||point.decimals>255)return unavailableSaleReview(review,'PRICE_UNAVAILABLE');
  if(point.observedAt<review.dueAt||point.observedAt>now||point.observedAt>review.dueAt+SALE_REVIEW_GRACE_MS||point.sourceAt>point.observedAt||point.observedAt-point.sourceAt>SALE_REVIEW_MAX_SOURCE_AGE_MS||now-point.observedAt>SALE_REVIEW_MAX_SOURCE_AGE_MS)return unavailableSaleReview(review,'PRICE_STALE_OR_OUTSIDE_CHECKPOINT');
  const a=BigInt(point.quoteLamports)*BigInt(review.salePrice.baseUnits),b=BigInt(review.salePrice.quoteLamports)*BigInt(point.baseUnits),delta=a-b;
  const scaled=delta*100_000_000n/b,absolute=scaled<0n?-scaled:scaled;
  const changePercent=(scaled<0n?'-':'')+(absolute/1_000_000n).toString()+'.'+(absolute%1_000_000n).toString().padStart(6,'0');
  return {...review,status:delta>0n?'BAD SALE':delta<0n?'GOOD SALE':'UNCHANGED',price:{...point},changePercent,reason:null};
}
/** Strict, bounded reporting-only receiver contract. */
export function validateSaleReviewReport(value:unknown,accountId:string,inceptionAt:string,now=Date.now()):SaleReviewReport {
  if(!object(value)||!exact(value,'schemaVersion,accountId,inceptionAt,generatedAt,basis,reviews')||value.schemaVersion!==1||value.accountId!==accountId||value.inceptionAt!==inceptionAt||value.basis!=='four-hour-price-only'||!reviewTime(value.generatedAt)||value.generatedAt>now+5000||now-value.generatedAt>120000||!Array.isArray(value.reviews)||value.reviews.length>50||Buffer.byteLength(JSON.stringify(value))>64*1024)throw Error('SALE_REVIEW_REPORT_INVALID');
  const seen=new Set<string>();
  for(const r of value.reviews){
    if(!object(r)||!exact(r,'fillId,mint,filledAt,dueAt,salePrice,status,price,changePercent,reason'))throw Error('SALE_REVIEW_FIELDS_INVALID');
    const pending=pendingSaleReview(r.fillId,r.mint,r.filledAt,r.salePrice);
    if(r.filledAt<Date.parse(inceptionAt)||r.filledAt>value.generatedAt||r.dueAt!==pending.dueAt||seen.has(r.fillId))throw Error('SALE_REVIEW_IDENTITY_INVALID');seen.add(r.fillId);
    if(r.status==='PENDING'){if(r.price!==null||r.changePercent!==null||r.reason!==null)throw Error('SALE_REVIEW_PENDING_INVALID');}
    else if(r.status==='UNAVAILABLE'){if(r.price!==null||r.changePercent!==null||typeof r.reason!=='string'||!/^[A-Z_]{1,64}$/.test(r.reason)||value.generatedAt<r.dueAt)throw Error('SALE_REVIEW_UNAVAILABLE_INVALID');}
    else {
      if(!object(r.price)||!exact(r.price,'quoteLamports,baseUnits,observedAt,sourceAt,decimals')||r.price.observedAt>value.generatedAt)throw Error('SALE_REVIEW_POINT_INVALID');
      const checked=completeSaleReview(pending,r.price as SalePricePoint,r.price.observedAt);
      if(checked.status==='UNAVAILABLE'||checked.status==='PENDING'||checked.status!==r.status||checked.changePercent!==r.changePercent||r.reason!==null)throw Error('SALE_REVIEW_COMPARISON_INVALID');
    }
  }
  return structuredClone(value) as SaleReviewReport;
}
export class SaleReviewCache {
  private report:SaleReviewReport|null=null;
  accept(value:unknown,accountId:string,inceptionAt:string,now=Date.now()){
    const report=validateSaleReviewReport(value,accountId,inceptionAt,now);
    if(this.report&&report.generatedAt<this.report.generatedAt)throw Error('SALE_REVIEW_REPORT_REGRESSION');
    const old=new Map(this.report?.reviews.map(r=>[r.fillId,r])??[]);
    for(const row of report.reviews){const prior=old.get(row.fillId);if(prior&&(JSON.stringify(prior.salePrice)!==JSON.stringify(row.salePrice)||prior.mint!==row.mint||prior.filledAt!==row.filledAt||prior.status!=='PENDING'&&JSON.stringify(prior)!==JSON.stringify(row)))throw Error('SALE_REVIEW_REPORT_CONFLICT');}
    this.report=report;
  }
  forTrades(trades:readonly {id:string;mint:string;at:string;side:string;quantity:string}[]){
    const rows=new Map(this.report?.reviews.map(r=>[r.fillId,r])??[]);
    return trades.flatMap(t=>{const r=rows.get(t.id);return r&&t.side==='sell'&&r.mint===t.mint&&r.filledAt===Date.parse(t.at)&&r.salePrice.baseUnits===t.quantity?[structuredClone(r)]:[];});
  }
}
