/** Independent authenticated reporting overlay; original financial snapshots remain unchanged. */
import {SALE_REVIEW_POLICY,validateSaleReview,unavailableSaleReview,type SaleReview} from './sale-review.js';
export type SaleReviewBatch={schemaVersion:1;accountId:string;inceptionAt:number;sequence:string;generatedAt:number;reviews:SaleReview[]};
export function validateSaleReviewBatch(value:unknown,accountId:string,inceptionAt:number,now=Date.now()):SaleReviewBatch{
 const b=value as SaleReviewBatch;
 if(!b||typeof b!=='object'||Object.keys(b).sort().join(',')!=='accountId,generatedAt,inceptionAt,reviews,schemaVersion,sequence'||b.schemaVersion!==1||b.accountId!==accountId||b.inceptionAt!==inceptionAt||!Number.isSafeInteger(b.generatedAt)||b.generatedAt<inceptionAt||b.generatedAt>now+30_000||typeof b.sequence!=='string'||!/^(0|[1-9][0-9]{0,39})$/.test(b.sequence)||!Array.isArray(b.reviews)||b.reviews.length>100||Buffer.byteLength(JSON.stringify(b))>128*1024)throw Error('SALE_REVIEW_BATCH_INVALID');
 const seen=new Set<string>();const reviews=b.reviews.map(value=>{const r=validateSaleReview(value);if(r.accountId!==accountId||r.soldAt<inceptionAt||r.soldAt>b.generatedAt||r.completedAt!==null&&r.completedAt>b.generatedAt||seen.has(r.tradeId))throw Error('SALE_REVIEW_BATCH_CONFLICT');seen.add(r.tradeId);return r;});return {...b,reviews};
}
export class SaleReviewReportingCache{
 private latest:SaleReviewBatch|null=null;
 accept(value:unknown,accountId:string,inceptionAt:number,now=Date.now()){
  const next=validateSaleReviewBatch(value,accountId,inceptionAt,now),prior=this.latest;
  if(prior){if(prior.accountId!==accountId||prior.inceptionAt!==inceptionAt)throw Error('SALE_REVIEW_ACCOUNT_CONFLICT');if(BigInt(next.sequence)<BigInt(prior.sequence)||next.generatedAt<prior.generatedAt)throw Error('SALE_REVIEW_SEQUENCE_REGRESSION');
   if(next.sequence===prior.sequence&&JSON.stringify(next.reviews)!==JSON.stringify(prior.reviews))throw Error('SALE_REVIEW_SEQUENCE_CONFLICT');
   const previous=new Map(prior.reviews.map(r=>[r.tradeId,r]));for(const r of next.reviews){const old=previous.get(r.tradeId);if(old&&(old.mint!==r.mint||old.soldAt!==r.soldAt||JSON.stringify(old.salePrice)!==JSON.stringify(r.salePrice)||old.status!=='PENDING'&&JSON.stringify(old)!==JSON.stringify(r)))throw Error('SALE_REVIEW_RESULT_CONFLICT');}
  }
  this.latest=next;return prior?.sequence===next.sequence?'duplicate':'accepted';
 }
 forTrades(trades:readonly {id:string;mint:string;side:string;quantity:string;at:string}[],now=Date.now()):Record<string,SaleReview>{
  const available=new Map(this.latest?.reviews.map(r=>[r.tradeId,r])??[]),result:Record<string,SaleReview>=Object.create(null);
  for(const trade of trades){const r=available.get(trade.id);if(trade.side!=='sell'||!r||r.mint!==trade.mint||r.soldAt!==Date.parse(trade.at)||r.salePrice.baseUnits!==trade.quantity)continue;
   result[trade.id]=r.status==='PENDING'&&now>r.dueAt+SALE_REVIEW_POLICY.checkpointGraceMs?unavailableSaleReview(r,now,'CHECKPOINT_RESULT_NOT_REPORTED'):structuredClone(r);
  }return result;
 }
}
