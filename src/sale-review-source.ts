/** Read-only projection of actual durable successful sale receipts, not snapshots. */
import {createHash} from 'node:crypto';
import {saleReviewTradeId,type SaleReviewSale} from './sale-review.js';
import type {ReviewSqlDatabase} from './sale-review-store.js';
const digest=(kind:string,payload:unknown)=>createHash('sha256').update(JSON.stringify({kind,payload})).digest('hex');
export function readSaleReviewSales(db:ReviewSqlDatabase,identity:{accountId:string;inceptionAt:number},afterRevision:number,now:number,limit=128){
 if(!Number.isSafeInteger(afterRevision)||afterRevision< -1||!Number.isSafeInteger(now)||!Number.isInteger(limit)||limit<1||limit>128)throw Error('SALE_REVIEW_READ_BOUND');
 const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}|undefined;
 if(!row)throw Error('SALE_REVIEW_LEDGER_MISSING');const state=JSON.parse(row.body);
 if(state.accountId!==identity.accountId||state.inceptionAt!==identity.inceptionAt||state.mode!=='PAPER')throw Error('SALE_REVIEW_LEDGER_IDENTITY');
 if(!Number.isSafeInteger(state.revision)||state.revision<afterRevision)throw Error('SALE_REVIEW_LEDGER_REGRESSED');
 const rows=db.prepare('SELECT j.revision,j.action_id,j.at,j.kind,j.detail,a.payload_hash,a.result FROM journal j JOIN actions a ON a.id=j.action_id WHERE j.revision>? ORDER BY j.revision LIMIT ?').all(afterRevision,limit) as Array<{revision:number;action_id:string;at:number;kind:string;detail:string;payload_hash:string;result:string}>;
 const sales:SaleReviewSale[]=[];let throughRevision=afterRevision;
 for(const r of rows){throughRevision=r.revision;if(r.kind!=='attempt')continue;if(r.detail.length>65536||r.result.length>65536)throw Error('SALE_REVIEW_RECEIPT_BOUND');const attempt=JSON.parse(r.detail),result=JSON.parse(r.result);if(result.status!=='filled')continue;
  if(digest('attempt',attempt)!==r.payload_hash||result.at!==r.at||attempt.now!==r.at||r.at>now)throw Error('SALE_REVIEW_ATTEMPT_INVALID');
  const orderRow=db.prepare("SELECT j.detail,a.payload_hash FROM journal j JOIN actions a ON a.id=j.action_id WHERE j.action_id=? AND j.kind='order'").get('order:'+attempt.orderId) as {detail:string;payload_hash:string}|undefined;
  if(!orderRow||orderRow.detail.length>65536)throw Error('SALE_REVIEW_ORDER_MISSING');const order=JSON.parse(orderRow.detail);
  if(digest('order',order)!==orderRow.payload_hash||order.input?.id!==attempt.orderId)throw Error('SALE_REVIEW_ORDER_INVALID');if(order.input.side!=='sell')continue;
  const q=attempt.quote;if(!q||typeof q.receiveUnits!=='string'||typeof q.pricedBaseUnits!=='string')throw Error('SALE_REVIEW_EXECUTION_PRICE_MISSING');
  sales.push({accountId:identity.accountId,actionId:r.action_id,tradeId:saleReviewTradeId(r.action_id),mint:order.input.mint,soldAt:r.at,salePrice:{quoteLamports:q.receiveUnits,baseUnits:q.pricedBaseUnits}});
 }
 return {sales,throughRevision};
}
