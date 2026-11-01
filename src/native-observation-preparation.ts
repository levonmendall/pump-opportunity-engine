import type {ResearchClockNativeObservationSupport} from './research-clock-pricing.js';

/** Reusable passive binding only. It never supplies prices, a subscription ACK,
 * an observation window, or financial permission. The original bank/receipt
 * timestamps remain authoritative when the binding is adopted by capture. */
export function preparedObservationFresh(support:ResearchClockNativeObservationSupport|undefined,at:number,mint?:string,pool?:string,minimumSlot=0):support is ResearchClockNativeObservationSupport {
 return !!support&&Number.isSafeInteger(at)&&Number.isSafeInteger(support.at)&&support.at<=at&&at-support.at<30000
  &&Number.isSafeInteger(support.sourceSlot)&&support.sourceSlot>=minimumSlot
  &&(mint===undefined||support.mint===mint)&&(pool===undefined||support.pool===pool)
  &&typeof support.evidence==='string'&&support.evidence.length>0&&support.evidence.length<=512
  &&Number.isSafeInteger(support.summary?.marketClockUnixSeconds)&&support.summary.marketClockUnixSeconds*1000<=at&&at-support.summary.marketClockUnixSeconds*1000<30000;
}
export type NativeObservationPreparationResult=
 |{status:'ready';support:ResearchClockNativeObservationSupport}
 |{status:'unavailable'|'deferred';reason:string;retryAt?:number};
export type NativeCandidatePreparationState='idle'|'awaiting-dispatch'|'validating-pool'|'awaiting-token-age'|'ready'|'awaiting-market-evidence'|'provider-unavailable';
