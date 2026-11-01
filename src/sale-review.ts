/** Reporting-only four-hour sale comparison. No trading or market imports. */
import {createHash} from 'node:crypto';
export const SALE_REVIEW_POLICY=Object.freeze({version:1 as const,horizonMs:4*60*60*1000,checkpointGraceMs:30_000,maximumSourceAgeMs:15_000,requestTimeoutMs:5_000});
export type SaleReviewStatus='PENDING'|'GOOD SALE'|'BAD SALE'|'UNCHANGED'|'UNAVAILABLE';
/** Exact lamports per token base unit. Human display uses verified mint decimals. */
export type SaleReviewPrice={quoteLamports:string;baseUnits:string};
export type SaleReviewSale={accountId:string;actionId:string;tradeId:string;mint:string;soldAt:number;salePrice:SaleReviewPrice};
export type SaleReviewObservation={mint:string;price:SaleReviewPrice;observedAt:number;sourceAt:number;decimals:number;source:string};
export type SaleReview={schemaVersion:1;accountId:string;actionId:string;tradeId:string;mint:string;soldAt:number;dueAt:number;salePrice:SaleReviewPrice;status:SaleReviewStatus;fourHourPrice:SaleReviewPrice|null;changePercent:string|null;observedAt:number|null;sourceAt:number|null;decimals:number|null;source:string|null;completedAt:number|null;reason:string|null};
export const saleReviewTradeId=(actionId:string)=>'paper-fill:'+createHash('sha256').update(actionId).digest('hex').slice(0,32);
const time=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const text=(x:unknown,max:number):x is string=>typeof x==='string'&&x.length>0&&x.length<=max&&!/[\u0000-\u001f]/.test(x);
export function validSaleReviewPrice(x:unknown):x is SaleReviewPrice{
 const p=x as SaleReviewPrice;return !!p&&typeof p==='object'&&Object.keys(p).sort().join(',')==='baseUnits,quoteLamports'&&[p.quoteLamports,p.baseUnits].every(n=>typeof n==='string'&&/^[1-9][0-9]{0,38}$/.test(n));
}
export function pendingSaleReview(sale:SaleReviewSale):SaleReview{
 if(!text(sale.accountId,160)||!text(sale.actionId,160)||sale.tradeId!==saleReviewTradeId(sale.actionId)||!text(sale.mint,96)||!time(sale.soldAt)||!time(sale.soldAt+SALE_REVIEW_POLICY.horizonMs)||!validSaleReviewPrice(sale.salePrice))throw Error('SALE_REVIEW_SALE_INVALID');
 return {...structuredClone(sale),schemaVersion:1,dueAt:sale.soldAt+SALE_REVIEW_POLICY.horizonMs,status:'PENDING',fourHourPrice:null,changePercent:null,observedAt:null,sourceAt:null,decimals:null,source:null,completedAt:null,reason:null};
}
export function unavailableSaleReview(review:SaleReview,at:number,reason:string):SaleReview{
 if(!time(at)||at<review.soldAt||!text(reason,96))throw Error('SALE_REVIEW_FAILURE_INVALID');
 return {...review,status:'UNAVAILABLE',fourHourPrice:null,changePercent:null,observedAt:null,sourceAt:null,decimals:null,source:null,completedAt:at,reason};
}
/** Exact cross-products determine direction, never rounded display prices. */
export function salePriceComparison(sale:SaleReviewPrice,later:SaleReviewPrice){
 if(!validSaleReviewPrice(sale)||!validSaleReviewPrice(later))throw Error('SALE_REVIEW_PRICE_INVALID');
 const baseline=BigInt(sale.quoteLamports)*BigInt(later.baseUnits),current=BigInt(later.quoteLamports)*BigInt(sale.baseUnits),difference=current-baseline;
 const status=difference>0n?'BAD SALE':difference<0n?'GOOD SALE':'UNCHANGED';
 const scaled=(difference<0n?-difference:difference)*100_000_000n/baseline;
 const changePercent=(difference<0n?'-':'')+(scaled/1_000_000n).toString()+'.'+(scaled%1_000_000n).toString().padStart(6,'0');
 return {status:status as 'GOOD SALE'|'BAD SALE'|'UNCHANGED',changePercent};
}
export function finishSaleReview(review:SaleReview,observation:SaleReviewObservation|null,now:number):SaleReview{
 if(review.status!=='PENDING')return structuredClone(review);
 if(!time(now)||now<review.dueAt)throw Error('SALE_REVIEW_NOT_DUE');
 if(now>review.dueAt+SALE_REVIEW_POLICY.checkpointGraceMs)return unavailableSaleReview(review,now,'CHECKPOINT_MISSED');
 if(!observation)return unavailableSaleReview(review,now,'PRICE_UNAVAILABLE');
 if(observation.mint!==review.mint||!validSaleReviewPrice(observation.price)||!time(observation.observedAt)||!time(observation.sourceAt)||!Number.isInteger(observation.decimals)||observation.decimals<0||observation.decimals>18||!text(observation.source,160))return unavailableSaleReview(review,now,'PRICE_INVALID');
 if(observation.observedAt<review.dueAt||observation.observedAt>now||observation.observedAt>review.dueAt+SALE_REVIEW_POLICY.checkpointGraceMs)return unavailableSaleReview(review,now,'PRICE_OUTSIDE_CHECKPOINT');
 if(observation.sourceAt>observation.observedAt||observation.observedAt-observation.sourceAt>SALE_REVIEW_POLICY.maximumSourceAgeMs)return unavailableSaleReview(review,now,'PRICE_STALE');
 return {...review,...salePriceComparison(review.salePrice,observation.price),fourHourPrice:structuredClone(observation.price),observedAt:observation.observedAt,sourceAt:observation.sourceAt,decimals:observation.decimals,source:observation.source,completedAt:now,reason:null};
}
/** Strict external/reporting boundary; recompute verdict and percentage. */
export function validateSaleReview(value:unknown):SaleReview{
 const r=value as SaleReview;
 if(!r||typeof r!=='object'||Object.keys(r).sort().join(',')!=='accountId,actionId,changePercent,completedAt,decimals,dueAt,fourHourPrice,mint,observedAt,reason,salePrice,schemaVersion,soldAt,source,sourceAt,status,tradeId')throw Error('SALE_REVIEW_INVALID');
 const pending=pendingSaleReview(r);if(r.schemaVersion!==1||r.dueAt!==pending.dueAt)throw Error('SALE_REVIEW_INVALID');
 let expected:SaleReview;
 if(r.status==='PENDING')expected=pending;
 else if(r.status==='UNAVAILABLE')expected=unavailableSaleReview(pending,r.completedAt!,r.reason!);
 else if(r.completedAt!==null&&r.observedAt!==null&&r.sourceAt!==null&&r.decimals!==null&&r.source!==null&&r.fourHourPrice!==null)expected=finishSaleReview(pending,{mint:r.mint,price:r.fourHourPrice,observedAt:r.observedAt,sourceAt:r.sourceAt,decimals:r.decimals,source:r.source},r.completedAt);
 else throw Error('SALE_REVIEW_INVALID');
 for(const key of Object.keys(expected) as Array<keyof SaleReview>)if(JSON.stringify(r[key])!==JSON.stringify(expected[key]))throw Error('SALE_REVIEW_INCONSISTENT');
 return structuredClone(expected);
}
