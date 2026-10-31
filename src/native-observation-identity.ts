/** Observation scopes and current account proofs are independent of archived
 * creation transactions. Unknown historical migration time stays unknown. */
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda} from './sdk.js';
import type {MigrationIdentity} from './migration-identity.js';
import type {ResearchClockNativeObservationSupport} from './research-clock-pricing.js';

export type NativeObservationIdentity={
 schemaVersion:1;baseMint:string;pool:string;migrationAt:number|null;migrationVerified:boolean;
 identityBasis:'creation-transaction'|'retained-verified-metadata'|'canonical-pool-hint';
 identityAvailableAt:number;identityEvidence:string;
 minimumSlot?:number;dependencyHints?:{baseVault:string;quoteVault:string};origin?:MigrationIdentity;
};
export type NativeCurrentPoolIdentityProof={schemaVersion:1;mint:string;pool:string;verifiedAt:number;sourceSlot:number;evidence:string};
const uint=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f]/.test(value);
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
export function canonicalObservationPool(mint:string,pool?:string){
 const key=new PublicKey(mint);need(key.toBase58()===mint,'NATIVE_OBSERVATION_MINT');
 const canonical=canonicalPumpPoolPda(key).toBase58();need(pool===undefined||pool===canonical,'NATIVE_OBSERVATION_POOL');return canonical;
}
export function assertNativeObservationIdentity(value:NativeObservationIdentity,at:number){
 need(value&&value.schemaVersion===1&&uint(at)&&uint(value.identityAvailableAt)&&value.identityAvailableAt<=at&&text(value.identityEvidence)&&['creation-transaction','retained-verified-metadata','canonical-pool-hint'].includes(value.identityBasis),'NATIVE_OBSERVATION_IDENTITY');
 canonicalObservationPool(value.baseMint,value.pool);
 need(typeof value.migrationVerified==='boolean'&&(value.migrationVerified?uint(value.migrationAt)&&value.migrationAt<=value.identityAvailableAt:value.migrationAt===null),'NATIVE_OBSERVATION_MIGRATION_PROVENANCE');
 need(value.identityBasis!=='retained-verified-metadata'||value.migrationVerified,'NATIVE_OBSERVATION_RETAINED_PROVENANCE');
 need(value.identityBasis!=='canonical-pool-hint'||!value.migrationVerified,'NATIVE_OBSERVATION_HINT_PROVENANCE');
 need(value.minimumSlot===undefined||uint(value.minimumSlot),'NATIVE_OBSERVATION_MINIMUM_SLOT');
 if(value.dependencyHints){const h=value.dependencyHints;need(new PublicKey(h.baseVault).toBase58()===h.baseVault&&new PublicKey(h.quoteVault).toBase58()===h.quoteVault&&h.baseVault!==h.quoteVault,'NATIVE_OBSERVATION_DEPENDENCY_HINTS');}
 if(value.origin){const id=value.origin;need(id.baseMint===value.baseMint&&id.pool===value.pool&&id.chainBlockTime*1000===value.migrationAt&&value.migrationVerified&&id.classification==='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT','NATIVE_OBSERVATION_ORIGIN_CONFLICT');}
 need(value.identityBasis!=='creation-transaction'||value.origin!==undefined,'NATIVE_OBSERVATION_ORIGIN_REQUIRED');
}
export function nativeObservationIdentityFromMigration(identity:MigrationIdentity):NativeObservationIdentity{
 const result:NativeObservationIdentity={schemaVersion:1,baseMint:identity.baseMint,pool:identity.pool,migrationAt:identity.chainBlockTime*1000,migrationVerified:true,identityBasis:'creation-transaction',identityAvailableAt:identity.availableAt,identityEvidence:'independently decoded creation transaction '+identity.signature,minimumSlot:identity.slot,dependencyHints:{baseVault:identity.baseVault,quoteVault:identity.quoteVault},origin:structuredClone(identity)};
 assertNativeObservationIdentity(result,identity.availableAt);return result;
}
export function assertNativeCurrentPoolIdentityProof(value:NativeCurrentPoolIdentityProof,at:number){
 need(value&&value.schemaVersion===1&&uint(at)&&uint(value.verifiedAt)&&value.verifiedAt<=at&&uint(value.sourceSlot)&&text(value.evidence),'NATIVE_CURRENT_POOL_IDENTITY_PROOF');canonicalObservationPool(value.mint,value.pool);
}
/** Called only with an accepted fresh canonical account binding. This proof records
 * when current identity became known; later refreshes must not rewrite its time. */
export function nativeCurrentPoolIdentityProof(support:ResearchClockNativeObservationSupport,at=support.at):NativeCurrentPoolIdentityProof{
 const proof:NativeCurrentPoolIdentityProof={schemaVersion:1,mint:support.mint,pool:support.pool,verifiedAt:support.at,sourceSlot:support.sourceSlot,evidence:support.evidence};assertNativeCurrentPoolIdentityProof(proof,at);return proof;
}
