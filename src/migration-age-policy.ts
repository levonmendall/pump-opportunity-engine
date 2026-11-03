/** Live PAPER market scope. The clock starts at the actual canonical PumpSwap
 * migration, never at mint creation, rediscovery, a pool refresh or reconnect. */
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {decodeMigrationIdentity} from './migration-identity.js';
import {canonicalObservationPool} from './native-observation-identity.js';

export const MIGRATION_AGE_POLICY=Object.freeze({
 version:'verified-pumpswap-migration-1m-24h-v1',minimumAgeMs:60_000,maximumAgeMs:86_400_000,
 basis:'verified-canonical-PumpSwap-migration-block-time',boundary:'inclusive-at-1-minute-and-24-hours',
 unknown:'ineligible-until-verified',acquisition:'migration signature; bounded canonical pool-origin fallback; no mint-creation-history reads',
 existingPositions:'unchanged-exit-policy; never-force-liquidate-on-age',
} as const);
export type MigrationAgeProof=Readonly<{
 version:typeof MIGRATION_AGE_POLICY.version;mint:string;pool:string;signature:string;slot:number;
 migrationAt:number;availableAt:number;confirmedTransactionSha256:string;finalizedTransactionSha256:string;
}>;
export type MigrationAgeScope=Readonly<{
 mint:string;pool:string;signature:string;slot:number;migrationAt:number;availableAt:number;eligibleAt:number;expiresAt:number;
}>;
export type MigrationAgeDecision={allowed:boolean;reason:'MIGRATION_AGE_WITHIN_1M_24H'|'MIGRATION_AGE_UNVERIFIED'|'MIGRATION_AGE_INVALID'|'MIGRATION_AGE_BELOW_1M'|'MIGRATION_AGE_EXCEEDS_24H';migrationAt:number|null;ageMs:number|null;eligibleAt:number|null;expiresAt:number|null;proof?:MigrationAgeProof};
export type MigrationOriginRead={signature:string;availableAt:number;transaction:unknown};
export type MigrationOrigin={originConfirmed:MigrationOriginRead;originFinalized:MigrationOriginRead};
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function validMigrationAgeProof(value:unknown):value is MigrationAgeProof{
 try{
  const p=value as MigrationAgeProof;
  return !!p&&p.version===MIGRATION_AGE_POLICY.version&&new PublicKey(p.mint).toBase58()===p.mint
   &&canonicalObservationPool(p.mint,p.pool)===p.pool&&typeof p.signature==='string'&&p.signature.length<=100&&bs58.decode(p.signature).length===64
   &&integer(p.slot)&&integer(p.migrationAt)&&p.migrationAt>0&&p.migrationAt%1000===0
   &&integer(p.availableAt)&&p.availableAt>=p.migrationAt
   &&[p.confirmedTransactionSha256,p.finalizedTransactionSha256].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s));
 }catch{return false;}
}
/** Both reads must independently establish the same actual Pump migrate CPI,
 * canonical SOL pool and CreatePoolEvent. Cached hint/identity fields are not
 * accepted in place of those transaction bytes. */
export function decodeMigrationAgeProof(origin:MigrationOrigin,at:number):MigrationAgeProof|null{
 try{
  if(!integer(at)||!origin?.originConfirmed||!origin.originFinalized)return null;
  const c=origin.originConfirmed,f=origin.originFinalized;
  if(!integer(c.availableAt)||!integer(f.availableAt)||c.availableAt>at||f.availableAt>at)return null;
  const confirmed=decodeMigrationIdentity(c.transaction,{signature:c.signature,commitment:'confirmed',availableAt:c.availableAt});
  const finalized=decodeMigrationIdentity(f.transaction,{signature:f.signature,commitment:'finalized',availableAt:f.availableAt});
  if(!confirmed.ok||!finalized.ok||finalized.identity.classification!=='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT')return null;
  const stable=({commitment:_c,availableAt:_a,...rest}:typeof finalized.identity)=>JSON.stringify(rest);
  if(stable(confirmed.identity)!==stable(finalized.identity))return null;
  const id=finalized.identity,proof:MigrationAgeProof={version:MIGRATION_AGE_POLICY.version,mint:id.baseMint,pool:id.pool,signature:id.signature,slot:id.slot,migrationAt:id.chainBlockTime*1000,availableAt:Math.max(c.availableAt,f.availableAt),confirmedTransactionSha256:digest(c.transaction),finalizedTransactionSha256:digest(f.transaction)};
  return validMigrationAgeProof(proof)?Object.freeze(proof):null;
 }catch{return null;}
}
export function migrationAgeScope(proof:MigrationAgeProof):MigrationAgeScope{
 if(!validMigrationAgeProof(proof))throw Error('MIGRATION_AGE_PROOF_INVALID');
 return Object.freeze({mint:proof.mint,pool:proof.pool,signature:proof.signature,slot:proof.slot,migrationAt:proof.migrationAt,availableAt:proof.availableAt,eligibleAt:proof.migrationAt+MIGRATION_AGE_POLICY.minimumAgeMs,expiresAt:proof.migrationAt+MIGRATION_AGE_POLICY.maximumAgeMs});
}
export function migrationAgeDecision(mint:string,at:number,proof:unknown):MigrationAgeDecision{
 const missing={allowed:false,migrationAt:null,ageMs:null,eligibleAt:null,expiresAt:null};
 if(proof===null||proof===undefined)return {...missing,reason:'MIGRATION_AGE_UNVERIFIED'};
 if(!integer(at)||!validMigrationAgeProof(proof)||proof.mint!==mint||proof.availableAt>at||proof.migrationAt>at)return {...missing,reason:'MIGRATION_AGE_INVALID'};
 const ageMs=at-proof.migrationAt,eligibleAt=proof.migrationAt+MIGRATION_AGE_POLICY.minimumAgeMs,expiresAt=proof.migrationAt+MIGRATION_AGE_POLICY.maximumAgeMs;
 const reason=at<eligibleAt?'MIGRATION_AGE_BELOW_1M':at>expiresAt?'MIGRATION_AGE_EXCEEDS_24H':'MIGRATION_AGE_WITHIN_1M_24H';
 return {allowed:reason==='MIGRATION_AGE_WITHIN_1M_24H',reason,migrationAt:proof.migrationAt,ageMs,eligibleAt,expiresAt,proof};
}
/** Constant-time feed and deep-slot eligibility. No registry/provider reads. */
export class PumpSwapMigrationAgeAdmission{
 private readonly scopes=new Map<string,MigrationAgeScope>();
 constructor(proofs:readonly MigrationAgeProof[]=[]){for(const proof of proofs)this.observeProof(proof);}
 observeProof(proof:MigrationAgeProof){const scope=migrationAgeScope(proof),prior=this.scopes.get(scope.mint);if(prior&&(prior.migrationAt!==scope.migrationAt||prior.signature!==scope.signature||prior.pool!==scope.pool||prior.slot!==scope.slot))throw Error('MIGRATION_AGE_SCOPE_CONFLICT');if(!prior)this.scopes.set(scope.mint,scope);}
 scope(mint:string){return this.scopes.get(mint);}
 decision(mint:string,at:number):'eligible'|'unknown'|'expired'|'unavailable'|'too-young'{
  const scope=this.scopes.get(mint);if(!scope)return 'unknown';
  if(!integer(at)||at<scope.migrationAt||at<scope.availableAt)return 'unavailable';
  return at<scope.eligibleAt?'too-young':at<=scope.expiresAt?'eligible':'expired';
 }
}
