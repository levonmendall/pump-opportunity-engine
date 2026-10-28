/** Isolated historical-origin recovery. Indexed time selects where to look;
 * only the unchanged confirmed/finalized migration decoder establishes identity.
 * Not wired into the pilot and never a source of current pool/price evidence. */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {canonicalPumpPoolPda} from './sdk.js';
import {decodeMigrationIdentity,type MigrationIdentity} from './migration-identity.js';
import {type PilotMigrationRpc} from './pilot-discovery.js';

export const PILOT_ORIGIN_RECOVERY_LIMITS=Object.freeze({reads:24,elapsedMs:20000,responseBytes:4*1024*1024,historyRows:1000,originCandidates:3,anchorAfterHintSeconds:2,maximumLookbackSlots:262144});
export type PilotOriginRecoverySeed={mint:string;pool:string;indexedCreatedAt:number;receivedAt:number;retainedAnchorSignature?:string};
export type PilotOriginRecoveryOptions={
  /** Existing shared transport's measured/uncertain physical-response counter.
   * The caller must also enforce its response/in-flight byte ceiling there;
   * this helper cannot stop bytes already arriving behind a generic RPC call. */
  responseBytes:()=>number;now?:()=>number;monotonic?:()=>number;
};
type TimedRead={signature:string;commitment:'confirmed'|'finalized';requestedAt:number;availableAt:number;transaction:unknown};
type ReadRecord={method:string;params:unknown[];requestedAt:number;availableAt:number;responseBytesAtAdmission:number;responseBytesAtAvailability:number};
export type PilotOriginRecoveryProof={
  source:'bounded-unverified-time-hint-origin-recovery';seed:PilotOriginRecoverySeed;indexedTimeAuthority:false;
  anchor:{source:'finalized-block-signatures'|'verified-retained-signature';slot:number;blockTime:number;signature:string;availableAt:number;nearestHistoricalSlotClaimed:false};
  slotTimeSamples:Array<{slot:number;blockTime:number|null;availableAt:number}>;
  block:unknown|null;anchorTransaction:TimedRead|null;
  history:{address:string;before:string;limit:1000;requestedAt:number;availableAt:number;rows:unknown[]};
  originCandidates:Array<{signature:string;slot:number;reason:string}>;
  originConfirmed:TimedRead;originFinalized:TimedRead;reads:ReadRecord[];
  finalizedIdentityMatchesConfirmed:true;currentPoolSupportVerified:false;entryEligibilityVerified:false;
};
type Usage={attemptedReads:number;elapsedMs:number;responseBytes:number;physicalSettlementAuthority:'existing shared RPC transport';limits:typeof PILOT_ORIGIN_RECOVERY_LIMITS};
export type PilotOriginRecoveryResult={ok:true;identity:MigrationIdentity;evidence:string;proof:PilotOriginRecoveryProof;usage:Usage}|{ok:false;reason:string;usage:Usage};
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
function need(value:unknown,reason:string):asserts value{if(!value)throw Error('PILOT_ORIGIN_RECOVERY_'+reason);}
function sig(value:unknown):asserts value is string{try{need(typeof value==='string'&&value.length<=100&&bs58.decode(value).length===64,'SIGNATURE');}catch{throw Error('PILOT_ORIGIN_RECOVERY_SIGNATURE');}}
function key(value:unknown){try{need(typeof value==='string'&&new PublicKey(value).toBase58()===value,'PUBLIC_KEY');return new PublicKey(value);}catch{throw Error('PILOT_ORIGIN_RECOVERY_PUBLIC_KEY');}}
function stable(identity:MigrationIdentity){const {commitment:_commitment,availableAt:_availableAt,...rest}=identity;return JSON.stringify(rest);}
function reason(error:unknown){const value=error instanceof Error?error.message:'';return /^(?:PILOT_|COMPONENT_|RPC_|MIGRATION_IDENTITY_)[A-Z0-9_:-]{1,140}$/.test(value)?value:'PILOT_ORIGIN_RECOVERY_UNAVAILABLE';}

/** At most24 sequential RPC calls and20s admission/information availability.
 * No retries, pagination or broad program scans. Time binary search is a bounded
 * hint only: repeated/nonmonotonic timestamps may cause refusal, never proof.
 * A returned creation must independently decode, lie strictly before its cursor
 * slot, be no later than the index hint, and match again at finality. */
export async function recoverPilotOrigin(seed:PilotOriginRecoverySeed,rpc:PilotMigrationRpc,signal:AbortSignal,options:PilotOriginRecoveryOptions):Promise<PilotOriginRecoveryResult>{
  const limits=PILOT_ORIGIN_RECOVERY_LIMITS,now=options.now??Date.now,mono=options.monotonic??(()=>performance.now());
  const startedAt=now(),startedMono=mono(),controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
  let calls=0,initialBytes=0,lastBytes=0;const readRecords:ReadRecord[]=[],samples:PilotOriginRecoveryProof['slotTimeSamples']=[];
  const timer=setTimeout(()=>controller.abort(),limits.elapsedMs);
  const usage=():Usage=>({attemptedReads:calls,elapsedMs:Math.max(now()-startedAt,mono()-startedMono),responseBytes:lastBytes-initialBytes,physicalSettlementAuthority:'existing shared RPC transport',limits});
  const check=()=>{need(!combined.aborted,'ABORTED');need(now()>=startedAt&&mono()>=startedMono&&now()-startedAt<limits.elapsedMs&&mono()-startedMono<limits.elapsedMs,'ELAPSED_CAP');const n=options.responseBytes();need(integer(n)&&n>=lastBytes,'RESPONSE_ACCOUNTING');lastBytes=n;need(n-initialBytes<=limits.responseBytes,'RESPONSE_CAP');};
  const call=async<T>(method:string,params:unknown[]):Promise<T>=>{check();need(calls<limits.reads,'READ_CAP');const requestedAt=now(),before=lastBytes;calls++;let response:T;try{response=await rpc.call<T>(method,params,combined);}catch(error){if(method==='getBlock'&&error instanceof Error&&error.message==='PAPER_RPC_METHOD_DENIED')throw Error('PILOT_ORIGIN_RECOVERY_GET_BLOCK_NOT_AUTHORIZED');throw error;}check();need(Buffer.byteLength(JSON.stringify(response)??'null')<=limits.responseBytes,'REPLY_SIZE');readRecords.push({method,params:structuredClone(params),requestedAt,availableAt:now(),responseBytesAtAdmission:before-initialBytes,responseBytesAtAvailability:lastBytes-initialBytes});return response;};
  const transaction=async(signature:string,commitment:'confirmed'|'finalized'):Promise<TimedRead>=>{const requestedAt=now(),transaction=await call<unknown>('getTransaction',[signature,{encoding:'json',commitment,maxSupportedTransactionVersion:1}]);return {signature,commitment,requestedAt,availableAt:now(),transaction};};
  try{
    need(typeof options.responseBytes==='function','RESPONSE_ACCOUNTING_REQUIRED');initialBytes=lastBytes=options.responseBytes();need(integer(initialBytes),'RESPONSE_ACCOUNTING');check();
    const mint=key(seed?.mint),pool=key(seed?.pool);need(!mint.equals(NATIVE_MINT)&&!mint.equals(PublicKey.default)&&canonicalPumpPoolPda(mint).equals(pool),'CANONICAL_SOL_SCOPE');
    need(integer(seed.indexedCreatedAt)&&seed.indexedCreatedAt>0&&seed.indexedCreatedAt%1000===0&&integer(seed.receivedAt)&&seed.receivedAt<=startedAt&&seed.indexedCreatedAt<=seed.receivedAt,'UNVERIFIED_HINT_TIME');
    const hint=seed.indexedCreatedAt/1000;let anchor:PilotOriginRecoveryProof['anchor'],block:unknown|null=null,anchorTransaction:TimedRead|null=null;
    if(seed.retainedAnchorSignature!==undefined){
      sig(seed.retainedAnchorSignature);anchorTransaction=await transaction(seed.retainedAnchorSignature,'finalized');const tx=anchorTransaction.transaction as any;
      need(tx?.transaction?.signatures?.[0]===seed.retainedAnchorSignature&&tx?.meta?.err===null&&integer(tx.slot)&&integer(tx.blockTime)&&tx.blockTime>hint&&tx.blockTime<=hint+limits.anchorAfterHintSeconds&&tx.blockTime<=Math.floor(anchorTransaction.availableAt/1000),'RETAINED_ANCHOR_CONTEXT');
      anchor={source:'verified-retained-signature',slot:tx.slot,blockTime:tx.blockTime,signature:seed.retainedAnchorSignature,availableAt:anchorTransaction.availableAt,nearestHistoricalSlotClaimed:false};
    }else{
      const currentSlot=await call<number>('getSlot',[{commitment:'finalized'}]);need(integer(currentSlot)&&currentSlot>0,'FINALIZED_SLOT');
      const cache=new Map<number,number|null>();
      const time=async(slot:number)=>{if(cache.has(slot))return cache.get(slot)!;const t=await call<number|null>('getBlockTime',[slot]);need(t===null||integer(t)&&t>0&&t<=Math.floor(now()/1000),'BLOCK_TIME');cache.set(slot,t);samples.push({slot,blockTime:t,availableAt:now()});return t;};
      const currentTime=await time(currentSlot);need(currentTime!==null&&currentTime>hint,'HINT_NOT_BEFORE_FINALIZED_BANK');
      let selected: {slot:number;time:number}|null=currentTime<=hint+limits.anchorAfterHintSeconds?{slot:currentSlot,time:currentTime}:null;
      if(!selected){
        //3slots/s is an estimate for choosing a search bound, never a guarantee.
        let width=Math.max(16,Math.ceil((currentTime-hint+8)*3));need(width<=limits.maximumLookbackSlots,'LOOKBACK_CAP');
        let lower=Math.max(0,currentSlot-width),upper=currentSlot,lowerTime=await time(lower);
        for(let expansion=0;lowerTime!==null&&lowerTime>hint&&expansion<2;expansion++){width*=2;need(width<=limits.maximumLookbackSlots,'LOOKBACK_CAP');lower=Math.max(0,currentSlot-width);lowerTime=await time(lower);}
        need(lowerTime!==null&&lowerTime<=hint,'TIME_BRACKET_UNAVAILABLE');
        while(!selected&&upper-lower>1){
          // Reserve getBlock, pool history, three confirmed candidates and finality.
          need(calls<limits.reads-6,'TIME_SEARCH_READ_RESERVE');let midpoint=Math.floor((lower+upper)/2),t=await time(midpoint);
          if(t===null){need(midpoint+1<upper&&calls<limits.reads-6,'SKIPPED_SLOT_AMBIGUITY');midpoint++;t=await time(midpoint);need(t!==null,'SKIPPED_SLOT_AMBIGUITY');}
          if(t>hint&&t<=hint+limits.anchorAfterHintSeconds){selected={slot:midpoint,time:t};break;}
          if(t<=hint)lower=midpoint;else upper=midpoint;
        }
        if(!selected){const t=cache.get(upper);if(t!==undefined&&t!==null&&t>hint&&t<=hint+limits.anchorAfterHintSeconds)selected={slot:upper,time:t};}
      }
      need(selected,'CLOSE_TEMPORAL_CURSOR_UNAVAILABLE');
      block=await call<unknown>('getBlock',[selected.slot,{commitment:'finalized',transactionDetails:'signatures',rewards:false,maxSupportedTransactionVersion:1}]);const b=block as any;
      need(b&&b.blockTime===selected.time&&integer(b.parentSlot)&&b.parentSlot<selected.slot&&integer(b.blockHeight)&&typeof b.blockhash==='string'&&typeof b.previousBlockhash==='string','FINALIZED_BLOCK_CONTEXT');
      key(b.blockhash);key(b.previousBlockhash);need(Array.isArray(b.signatures)&&b.signatures.length>0&&b.signatures.length<=8192,'BLOCK_SIGNATURES');const seen=new Set<string>();for(const s of b.signatures){sig(s);need(!seen.has(s),'BLOCK_SIGNATURE_DUPLICATE');seen.add(s);}
      anchor={source:'finalized-block-signatures',slot:selected.slot,blockTime:selected.time,signature:b.signatures[0],availableAt:now(),nearestHistoricalSlotClaimed:false};
    }
    const requestedAt=now(),rows=await call<any[]>('getSignaturesForAddress',[seed.pool,{before:anchor.signature,limit:1000,commitment:'confirmed'}]);
    need(Array.isArray(rows)&&rows.length>0&&rows.length<=limits.historyRows,'HISTORY_UNAVAILABLE');let priorSlot=anchor.slot;const seen=new Set<string>();
    for(const row of rows){sig(row?.signature);need(!seen.has(row.signature)&&integer(row.slot)&&row.slot<=priorSlot&&row.slot<=anchor.slot&&Object.hasOwn(row,'err')&&(row.blockTime===null||integer(row.blockTime)&&row.blockTime>0),'HISTORY_CONTEXT');seen.add(row.signature);priorSlot=row.slot;}
    const history={address:seed.pool,before:anchor.signature,limit:1000 as const,requestedAt,availableAt:now(),rows:structuredClone(rows)};
    const oldest=rows.filter(r=>r.err===null&&r.slot<anchor.slot&&integer(r.blockTime)&&r.blockTime<=hint).reverse().slice(0,limits.originCandidates);
    need(oldest.length>0,rows.length===limits.historyRows?'HISTORY_SATURATED_HINT_NOT_COVERED':'NO_BOUNDED_ORIGIN_CANDIDATE');
    let found:{identity:MigrationIdentity;read:TimedRead}|null=null;const candidates:PilotOriginRecoveryProof['originCandidates']=[];
    for(const row of oldest){
      const read=await transaction(row.signature,'confirmed'),decoded=decodeMigrationIdentity(read.transaction,{signature:row.signature,feedMint:seed.mint,commitment:'confirmed',availableAt:read.availableAt});
      if(!decoded.ok){candidates.push({signature:row.signature,slot:row.slot,reason:decoded.reason});continue;}
      const identity=decoded.identity;need(identity.slot===row.slot&&identity.chainBlockTime===row.blockTime,'ORIGIN_HISTORY_CONTEXT_CHANGED');
      if(identity.classification!=='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT'||identity.baseMint!==seed.mint||identity.quoteMint!==NATIVE_MINT.toBase58()||identity.pool!==seed.pool){candidates.push({signature:row.signature,slot:row.slot,reason:'PILOT_ORIGIN_RECOVERY_ORIGIN_SCOPE_MISMATCH'});continue;}
      need(identity.slot<anchor.slot&&identity.chainBlockTime<=hint,'CREATION_LATER_THAN_HINT_OR_CURSOR');
      candidates.push({signature:row.signature,slot:row.slot,reason:'ACTUAL_ORIGIN_CREATION_CONFIRMED'});found={identity,read};break;
    }
    need(found,'ORIGIN_NOT_FOUND_IN_BOUNDED_HISTORY');
    const finalizedRead=await transaction(found.identity.signature,'finalized'),finalized=decodeMigrationIdentity(finalizedRead.transaction,{signature:found.identity.signature,feedMint:seed.mint,commitment:'finalized',availableAt:finalizedRead.availableAt});
    need(finalized.ok,'FINALIZED_CREATION_UNAVAILABLE');need(stable(found.identity)===stable(finalized.identity),'FINALIZED_IDENTITY_CHANGED');
    const proof:PilotOriginRecoveryProof={source:'bounded-unverified-time-hint-origin-recovery',seed:structuredClone(seed),indexedTimeAuthority:false,anchor,slotTimeSamples:samples,block,anchorTransaction,history,originCandidates:candidates,originConfirmed:found.read,originFinalized:finalizedRead,reads:readRecords,finalizedIdentityMatchesConfirmed:true,currentPoolSupportVerified:false,entryEligibilityVerified:false};
    const encoded=JSON.stringify(proof);need(Buffer.byteLength(encoded)<=limits.responseBytes,'PROOF_SIZE_CAP');check();
    return {ok:true,identity:finalized.identity,evidence:'pilot-origin-recovery:'+createHash('sha256').update(encoded).digest('hex'),proof,usage:usage()};
  }catch(error){try{const n=options.responseBytes?.();if(integer(n)&&n>=lastBytes)lastBytes=n;}catch{}return {ok:false,reason:reason(error),usage:usage()};}
  finally{clearTimeout(timer);controller.abort();}
}
