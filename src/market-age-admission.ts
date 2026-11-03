/** The discovery boundary uses already-validated creation facts. It performs
 * no provider work, registry writes, price parsing or per-frame proof decoding.
 * Actual creation proof is established by the separate qualification lane. */
import {PublicKey} from '@solana/web3.js';
import {TOKEN_AGE_POLICY,validTokenCreationProof,type TokenCreationProof} from './token-age-policy.js';

export type TokenCreationScope=Readonly<{mint:string;createdAt:number;availableAt:number;expiresAt:number}>;
export type MarketAgeAdmissionDecision='eligible'|'unknown'|'expired'|'unavailable';

export class PumpSwapTokenAgeAdmission {
 private readonly scopes=new Map<string,TokenCreationScope>();
 constructor(scopes:readonly TokenCreationScope[]=[]){for(const scope of scopes)this.retain(scope);}
 private retain(scope:TokenCreationScope){
  let canonical=false;try{canonical=typeof scope.mint==='string'&&new PublicKey(scope.mint).toBase58()===scope.mint;}catch{}
  if(!canonical||![scope.createdAt,scope.availableAt,scope.expiresAt].every(Number.isSafeInteger)||scope.createdAt<=0||scope.createdAt%1000!==0||scope.availableAt<scope.createdAt||scope.expiresAt!==scope.createdAt+TOKEN_AGE_POLICY.maximumAgeMs)throw Error('MARKET_TOKEN_AGE_SCOPE_INVALID');
  const prior=this.scopes.get(scope.mint);
  if(prior&&(prior.createdAt!==scope.createdAt||prior.availableAt!==scope.availableAt||prior.expiresAt!==scope.expiresAt))throw Error('MARKET_TOKEN_AGE_SCOPE_CONFLICT');
  if(!prior)this.scopes.set(scope.mint,Object.freeze({...scope}));
 }
 observeProof(proof:TokenCreationProof){
  if(!validTokenCreationProof(proof))throw Error('MARKET_TOKEN_CREATION_PROOF_REQUIRED');
  this.retain({mint:proof.mint,createdAt:proof.createdAt,availableAt:proof.availableAt,expiresAt:proof.createdAt+TOKEN_AGE_POLICY.maximumAgeMs});
 }
 scope(mint:string):TokenCreationScope|undefined{return this.scopes.get(mint);}
 decision(mint:string,at:number):MarketAgeAdmissionDecision{
  const scope=this.scopes.get(mint);if(!scope)return 'unknown';
  if(!Number.isSafeInteger(at)||at<scope.createdAt||at<scope.availableAt)return 'unavailable';
  return at<=scope.expiresAt?'eligible':'expired';
 }
}
