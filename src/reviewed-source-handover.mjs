/** Reporting-only compatibility for one reviewed EC2 upgrade. No trading controls.
 * Existing HTTP authentication, payload validation, sequence and epoch checks
 * still run. Accept the old source until a valid forward report is accepted;
 * then reject the old source. Invalid target reports never change identity.
 */
import {validateSnapshot} from '../dist/src/reporting.js';
export const HANDOVER=Object.freeze({
 accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',
 inceptionAt:'2026-10-26T22:07:36.212Z',
 strategy:'liquidity-resilient-momentum-v3.1',
 from:'bb145cc82b0f05560b03bbd9e53de0c9e360f48f',
 to:'905be6d92001351cc891d83fe11fa7b28fe98d4e',
});
const installed=new WeakSet();
export function attachReviewedSourceHandover(cache){
 const identity=cache.identity,p=HANDOVER;
 if(!identity||identity.accountId!==p.accountId||identity.inceptionAt!==p.inceptionAt||identity.strategy!==p.strategy||identity.release!==p.from)return false;
 if(installed.has(cache))return true;
 const original=cache.accept.bind(cache);let switched=false;
 cache.accept=function(value,now=Date.now()){
  if(switched||value?.source?.release!==p.to)return original(value,now);
  validateSnapshot(value,{...identity,release:p.to},now);
  const previous=identity.release;
  identity.release=p.to;
  try{
   const result=original(value,now);
   switched=true;
   return result;
  }catch(error){identity.release=previous;throw error;}
 };
 installed.add(cache);return true;
}
