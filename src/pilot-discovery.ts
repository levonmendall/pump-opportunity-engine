/** Bounded, read-only migration origin proof for the isolated PAPER pilot.
 * A processed migration hint never supplies original creation time or identity.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {canonicalPumpPoolPda} from './sdk.js';
import {decodeMigrationIdentity,type MigrationIdentity} from './migration-identity.js';

export type PilotMigrationSeed={signature:string;feedMint?:string;receivedAt:number};
export type PilotMigrationRpc={call<T>(method:string,params?:unknown[],signal?:AbortSignal):Promise<T>};
type Read={signature:string;commitment:'confirmed'|'finalized';requestedAt:number;availableAt:number;transaction:unknown};
export type PilotMigrationProof={
  source:'direct-confirmed-creation'|'bounded-canonical-SOL-history';
  seed:PilotMigrationSeed;initialConfirmed:Read;
  history:{address:string;limit:1000;requestedAt:number;availableAt:number;rows:unknown[]}|null;
  originCandidates:Array<{signature:string;slot:number;reason:string}>;
  originConfirmed:Read;originFinalized:Read;
  finalizedIdentityMatchesConfirmed:true;
  currentPoolSupportVerified:false;entryEligibilityVerified:false;
};
export type PilotMigrationResult={ok:true;identity:MigrationIdentity;evidence:string;proof:PilotMigrationProof}|{ok:false;reason:string};
const MAX_READS=6,MAX_MS=20000,MAX_PROOF_BYTES=512*1024;
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
function signature(value:unknown):asserts value is string {need(typeof value==='string'&&value.length<=100,'PILOT_MIGRATION_SIGNATURE');try{need(bs58.decode(value).length===64,'PILOT_MIGRATION_SIGNATURE');}catch{throw Error('PILOT_MIGRATION_SIGNATURE');}}
function compareIdentity(identity:MigrationIdentity){const {commitment:_commitment,availableAt:_availableAt,...stable}=identity;return JSON.stringify(stable);}
function refusal(error:unknown){const message=error instanceof Error?error.message:'';return /^(?:PILOT_|COMPONENT_|RPC_|MIGRATION_IDENTITY_)[A-Z0-9_:-]{1,120}$/.test(message)?message:'PILOT_MIGRATION_LOOKUP_UNAVAILABLE';}

/** Maximum six reads, no retries or pagination: seed confirmed, one history
 * page if the seed was a creation-free retry, three oldest successful origin
 * candidates, and one finalized origin proof. A saturated page is not claimed
 * to contain the actual oldest transaction and is refused without scanning.
 */
export async function resolvePilotMigration(seed:PilotMigrationSeed,rpc:PilotMigrationRpc,signal:AbortSignal):Promise<PilotMigrationResult>{
  const startedAt=Date.now(),startedMono=performance.now(),controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
  let reads=0;
  const timer=setTimeout(()=>controller.abort(),MAX_MS);
  const check=()=>{need(!combined.aborted,'PILOT_MIGRATION_ABORTED');need(Date.now()-startedAt>=0&&Date.now()-startedAt<MAX_MS&&performance.now()-startedMono<MAX_MS,'PILOT_MIGRATION_ELAPSED_CAP');};
  const call=async<T>(method:string,params:unknown[]):Promise<T>=>{check();need(reads<MAX_READS,'PILOT_MIGRATION_READ_CAP');reads++;const result=await rpc.call<T>(method,params,combined);check();return result;};
  const transaction=async(sig:string,commitment:'confirmed'|'finalized'):Promise<Read>=>{
    const requestedAt=Date.now(),tx=await call<unknown>('getTransaction',[sig,{encoding:'json',commitment,maxSupportedTransactionVersion:1}]);
    const availableAt=Date.now();need(availableAt>=requestedAt,'PILOT_MIGRATION_READ_CLOCK_REGRESSION');return {signature:sig,commitment,requestedAt,availableAt,transaction:tx};
  };
  try{
    check();signature(seed?.signature);need(Number.isSafeInteger(seed.receivedAt)&&seed.receivedAt>=0&&seed.receivedAt<=startedAt,'PILOT_MIGRATION_SEED_TIME');
    if(seed.feedMint!==undefined)need(new PublicKey(seed.feedMint).toBase58()===seed.feedMint,'PILOT_MIGRATION_FEED_MINT');
    const selected=Object.freeze({signature:seed.signature,...(seed.feedMint===undefined?{}:{feedMint:seed.feedMint}),receivedAt:seed.receivedAt});
    const initial=await transaction(selected.signature,'confirmed');
    const initialDecoded=decodeMigrationIdentity(initial.transaction,{signature:initial.signature,feedMint:selected.feedMint,commitment:'confirmed',availableAt:initial.availableAt});
    let identity:MigrationIdentity,originConfirmed:Read,history:PilotMigrationProof['history']=null;
    const candidates:PilotMigrationProof['originCandidates']=[];
    if(initialDecoded.ok){
      need(initialDecoded.identity.classification==='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT','PILOT_MIGRATION_'+(initialDecoded.identity.reason??'OUTSIDE_SCOPE'));
      // A direct genuine event establishes actual roles; feedMint remains a hint.
      identity=initialDecoded.identity;originConfirmed=initial;
    }else{
      need(initialDecoded.reason==='MIGRATION_IDENTITY_CREATION_CPI_NOT_VERIFIED',initialDecoded.reason);
      need(selected.feedMint!==undefined,'PILOT_MIGRATION_RETRY_FEED_MINT_REQUIRED');
      const mint=new PublicKey(selected.feedMint);need(!mint.equals(NATIVE_MINT)&&!mint.equals(PublicKey.default),'PILOT_MIGRATION_RETRY_BASE_MINT_REQUIRED');
      const pool=canonicalPumpPoolPda(mint).toBase58(),requestedAt=Date.now();
      const rows=await call<any[]>('getSignaturesForAddress',[pool,{limit:1000,commitment:'confirmed'}]);
      need(Array.isArray(rows)&&rows.length>0&&rows.length<=1000,'PILOT_MIGRATION_HISTORY_UNAVAILABLE');
      history={address:pool,limit:1000,requestedAt,availableAt:Date.now(),rows:structuredClone(rows)};
      need(rows.length<1000,'PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN');
      let priorSlot=Infinity;const seen=new Set<string>();
      for(const row of rows){signature(row?.signature);need(!seen.has(row.signature)&&Number.isSafeInteger(row.slot)&&row.slot>=0&&row.slot<=priorSlot&&Object.hasOwn(row,'err'),'PILOT_MIGRATION_HISTORY_MALFORMED');seen.add(row.signature);priorSlot=row.slot;}
      const oldest=rows.filter(row=>row.err===null&&row.signature!==selected.signature).reverse().slice(0,3);
      need(oldest.length>0,'PILOT_MIGRATION_HISTORY_NO_SUCCESSFUL_ORIGIN_CANDIDATE');
      let found:{identity:MigrationIdentity;read:Read}|undefined;
      for(const row of oldest){
        const read=await transaction(row.signature,'confirmed'),decoded=decodeMigrationIdentity(read.transaction,{signature:row.signature,feedMint:selected.feedMint,commitment:'confirmed',availableAt:read.availableAt});
        if(!decoded.ok){candidates.push({signature:row.signature,slot:row.slot,reason:decoded.reason});continue;}
        const current=decoded.identity;
        need(current.slot===row.slot&&(!Number.isSafeInteger(row.blockTime)||row.blockTime===current.chainBlockTime),'PILOT_MIGRATION_HISTORY_CONTEXT_MISMATCH');
        if(current.classification!=='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT'||current.baseMint!==selected.feedMint||current.quoteMint!==NATIVE_MINT.toBase58()||current.pool!==pool){candidates.push({signature:row.signature,slot:row.slot,reason:'PILOT_MIGRATION_HISTORY_CREATION_SCOPE_MISMATCH'});continue;}
        candidates.push({signature:row.signature,slot:row.slot,reason:'ACTUAL_ORIGIN_CREATION_CONFIRMED'});found={identity:current,read};break;
      }
      need(found,'PILOT_MIGRATION_ORIGIN_NOT_FOUND_IN_BOUNDED_HISTORY');identity=found.identity;originConfirmed=found.read;
    }
    const originFinalized=await transaction(identity.signature,'finalized');
    const finalized=decodeMigrationIdentity(originFinalized.transaction,{signature:identity.signature,feedMint:selected.feedMint,commitment:'finalized',availableAt:originFinalized.availableAt});
    need(finalized.ok,'PILOT_MIGRATION_FINALIZED_CREATION_UNAVAILABLE');
    need(compareIdentity(identity)===compareIdentity(finalized.identity),'PILOT_MIGRATION_FINALIZED_IDENTITY_CHANGED');
    const proof:PilotMigrationProof={source:history?'bounded-canonical-SOL-history':'direct-confirmed-creation',seed:selected,initialConfirmed:initial,history,originCandidates:candidates,originConfirmed,originFinalized,finalizedIdentityMatchesConfirmed:true,currentPoolSupportVerified:false,entryEligibilityVerified:false};
    const encoded=JSON.stringify(proof);need(Buffer.byteLength(encoded)<=MAX_PROOF_BYTES,'PILOT_MIGRATION_PROOF_SIZE_CAP');check();
    return {ok:true,identity:finalized.identity,evidence:'pilot-finalized-migration:'+createHash('sha256').update(encoded).digest('hex'),proof};
  }catch(error){return {ok:false,reason:refusal(error)};}
  finally{clearTimeout(timer);controller.abort();}
}
