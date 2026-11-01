/** One current account batch on the existing read-only RPC pricing path.
 * No subscriptions, deep slots, strategy, holders, flow or historical queries. */
import {PublicKey} from '@solana/web3.js';
import {ResearchClockPositionPricer} from './research-clock-pricing.js';
import type {ReadOnlyRpc} from './network.js';
import type {SaleReviewPriceReader} from './sale-review-store.js';
export function saleReviewPriceReader(rpc:Pick<ReadOnlyRpc,'call'>):SaleReviewPriceReader{
 return async(review,signal)=>{
  // A new instance has no retained observations and makes a canonical, single
  // current dependency/Clock batch. Existing decoders validate price identity.
  const pricer=new ResearchClockPositionPricer(rpc,{record(){}});
  const result=await pricer.validateMany([{mint:new PublicKey(review.mint)}],signal);
  const current=result.validations[review.mint];if(!current)return null;
  const s=current.summary;
  return {mint:review.mint,price:{quoteLamports:s.effectiveQuoteReserve,baseUnits:s.rawBaseReserve},decimals:s.decimals,observedAt:Date.parse(s.receivedAt),sourceAt:s.marketClockUnixSeconds*1000,source:'confirmed PumpSwap SOL spot price'};
 };
}
