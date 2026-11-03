/** Owner-selected eligibility clock. Mint creation, rediscovery and activity
 * never reset a canonical PumpSwap migration's timestamp. No provider calls. */
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {decodeMigrationIdentity} from './migration-identity.js';
import {canonicalObservationPool} from './native-observation-identity.js';

export const MIGRATION_AGE_POLICY=Object.freeze({
 version:'verified-pumpswap-migration-1m-24h-v1',minimumAgeMs:60_000,maximumAgeMs:86_400_000,
 basis:'verified-canonical-PumpSwap-migration-blockTime',boundaries:'inclusive',
 unknown:'ineligible-until-verified',existingPositions:'unchanged-exit-policy',
});
export type MigrationAgeFact=Readonly<{version:typeof MIGRATION_AGE_POLICY.version;mint:string;pool:string;signature:string;slot:number;migrationAt:number;availableAt:number;proofSha256:string}>;
export type MigrationOrigin={originConfirmed:{signature:string;availableAt:number;transaction:unknown};originFinalized:{signature:string;availableAt:number;transaction:unknown}};
export type MigrationAgeDecision='unknown'|'unavailable'|'warming'|'eligible'|'expired';
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
export function validMigrationAgeFact(value:unknown):value is MigrationAgeFact{
 try{const f=value as MigrationAgeFact;return !!f&&f.version===MIGRATION_AGE_POLICY.version&&new PublicKey(f.mint).toBase58()===f.mint&&canonicalObservationPool(f.mint)===f.pool&&typeof f.signature==='string'&&bs58.decode(f.signature).length===64&&integer(f.slot)&&integer(f.migrationAt)&&f.migrationAt>0&&f.migrationAt%1000===0&&integer(f.availableAt)&&f.availableAt>=f.migrationAt&&Number.isSafeInteger(f.migrationAt+MIGRATION_AGE_POLICY.maximumAgeMs)&&/^[a-f0-9]{64}$/.test(f.proofSha256);}catch{return false;}
}
export function migrationAgeDecision(fact:MigrationAgeFact|null|undefined,at:number):MigrationAgeDecision{
 if(!fact)return 'unknown';if(!integer(at)||at<fact.availableAt||at<fact.migrationAt)return 'unavailable';
 const age=at-fact.migrationAt;return age<MIGRATION_AGE_POLICY.minimumAgeMs?'warming':age<=MIGRATION_AGE_POLICY.maximumAgeMs?'eligible':'expired';
}
/** Only the same canonical migration, independently decoded at both existing
 * commitments, establishes the durable age. This never searches mint history. */
export function verifiedMigrationAge(origin:MigrationOrigin,at:number):MigrationAgeFact{
 const fail=()=>{throw Error('MIGRATION_AGE_PROOF_INVALID');};
 if(!origin?.originConfirmed||!origin.originFinalized||!integer(at))return fail();
 const c=origin.originConfirmed,f=origin.originFinalized;
 if(!integer(c.availableAt)||!integer(f.availableAt)||c.availableAt>at||f.availableAt>at||c.signature!==f.signature)return fail();
 const confirmed=decodeMigrationIdentity(c.transaction,{signature:c.signature,availableAt:c.availableAt,commitment:'confirmed'}),finalized=decodeMigrationIdentity(f.transaction,{signature:f.signature,availableAt:f.availableAt,commitment:'finalized'});
 if(!confirmed.ok||!finalized.ok)return fail();
 const x=confirmed.identity,y=finalized.identity;
 if(y.classification!=='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT'||x.classification!==y.classification||x.signature!==y.signature||x.slot!==y.slot||x.chainBlockTime!==y.chainBlockTime||x.baseMint!==y.baseMint||x.pool!==y.pool||x.quoteMint!==y.quoteMint||x.baseVault!==y.baseVault||x.quoteVault!==y.quoteVault||x.creator!==y.creator||x.baseTokenProgram!==y.baseTokenProgram||x.quoteTokenProgram!==y.quoteTokenProgram)return fail();
 const fact:MigrationAgeFact=Object.freeze({version:MIGRATION_AGE_POLICY.version,mint:y.baseMint,pool:y.pool,signature:y.signature,slot:y.slot,migrationAt:y.chainBlockTime*1000,availableAt:Math.max(c.availableAt,f.availableAt),proofSha256:createHash('sha256').update(JSON.stringify({originConfirmed:c,originFinalized:f})).digest('hex')});
 if(!validMigrationAgeFact(fact))return fail();return fact;
}
export class PumpSwapMigrationAgeAdmission{
 private readonly facts=new Map<string,MigrationAgeFact>();
 constructor(facts:readonly MigrationAgeFact[]=[]){for(const fact of facts)this.observeFact(fact);}
 observeFact(fact:MigrationAgeFact){
  if(!validMigrationAgeFact(fact))throw Error('MIGRATION_AGE_FACT_INVALID');
  const old=this.facts.get(fact.mint);
  if(old&&(old.pool!==fact.pool||old.signature!==fact.signature||old.slot!==fact.slot||old.migrationAt!==fact.migrationAt))throw Error('MIGRATION_AGE_FACT_CONFLICT');
  // A later RPC read must not move either the age origin or original availability.
  if(!old)this.facts.set(fact.mint,Object.freeze({...fact}));
 }
 scope(mint:string){return this.facts.get(mint);}
 decision(mint:string,at:number){return migrationAgeDecision(this.facts.get(mint),at);}
}
