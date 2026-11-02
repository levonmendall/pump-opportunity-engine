/** Reporting-only compatibility for reviewed EC2 upgrades. No trading controls.
 * Existing HTTP authentication, payload validation, sequence and epoch checks
 * still run. Accept the old source until a valid forward report is accepted;
 * then reject the old source. Invalid target reports never change identity.
 */
import {validateSnapshot} from '../dist/src/reporting.js';
export const HANDOVER=Object.freeze({
 accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',
 inceptionAt:'2026-10-26T22:07:36.212Z',
 strategy:'liquidity-resilient-momentum-v3.1',
 // A restart may still use the original configured identity. Accepting a
 // newer report does not rewrite that configuration, so retain its anchor.
 from:'bb145cc82b0f05560b03bbd9e53de0c9e360f48f',
 via:'905be6d92001351cc891d83fe11fa7b28fe98d4e',
 previous:'06995e21eb6a6975377de8c970be230fc698c957',
 to:'ce0693a33eb740bbde831a19c795ee8b6781403e',
});
const installed=new WeakSet();
export function attachReviewedSourceHandover(cache){
 const identity=cache.identity,p=HANDOVER,route=[p.from,p.via,p.previous,p.to];
 if(!identity||identity.accountId!==p.accountId||identity.inceptionAt!==p.inceptionAt||identity.strategy!==p.strategy||!route.slice(0,-1).includes(identity.release))return false;
 if(installed.has(cache))return true;
 const original=cache.accept.bind(cache);
 cache.accept=function(value,now=Date.now()){
  const next=route.indexOf(value?.source?.release),current=route.indexOf(identity.release);
  if(current<0||next<=current)return original(value,now);
  const target=route[next];
  validateSnapshot(value,{...identity,release:target},now);
  const previous=identity.release;
  identity.release=target;
  try{
   const result=original(value,now);
   return result;
  }catch(error){identity.release=previous;throw error;}
 };
 installed.add(cache);return true;
}
