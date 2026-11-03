/** Upstream migration qualification, one bounded continuation at a time.
 * Pool-signature history only locates bytes to verify. It never supplies age,
 * current pool support, an observation slot, or financial permission. */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {canonicalPumpPoolPda} from './sdk.js';
import {decodeMigrationIdentity,type MigrationIdentity} from './migration-identity.js';
import {MIGRATION_AGE_POLICY} from './migration-age-policy.js';
import type {PilotMigrationSeed,PilotMigrationRpc,PilotMigrationResult,PilotMigrationProof} from './pilot-discovery.js';

export const PUMPSWAP_MIGRATION_RECOVERY_POLICY=Object.freeze({
 version:'cooperative-canonical-pool-migration-history-v1',pageLimit:1000 as const,
 maximumReadsPerTurn:2,maximumElapsedMs:20_000,maximumCheckpointBytes:512*1024,
 retainedCandidates:8,progressYieldMs:1,retryMs:60_000,
 historyHorizonMs:MIGRATION_AGE_POLICY.maximumAgeMs,
 meaning:'One canonical pool page or confirmed/finalized origin attempt per existing-budget turn; durable cursor, no mint-history reads, no population or total-page cap.',
} as const);
export const MIGRATION_RECOVERY_CONTINUES='PILOT_MIGRATION_RECOVERY_CONTINUES';
type Cursor={signature:string;slot:number};
type Candidate=Cursor&{blockTime:number|null};
type Read=PilotMigrationProof['originConfirmed'];
export type PumpSwapMigrationRecovery={
 version:typeof PUMPSWAP_MIGRATION_RECOVERY_POLICY.version;seed:PilotMigrationSeed;pool:string;
 revision:number;startedAt:number;updatedAt:number;phase:'history'|'candidate'|'finalized';
 before:Cursor|null;until:Cursor|null;sameSlotCursors:string[];candidates:Candidate[];originConfirmed:Read|null;
 historyPages:number;historyRows:number;candidateReads:number;scanPasses:number;seedConfirmedSha256:string;seedNonOrigin:boolean;
};
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const signature=(v:unknown):v is string=>{try{return typeof v==='string'&&v.length<=100&&bs58.decode(v).length===64;}catch{return false;}};
const cursor=(v:Cursor|null)=>v===null||!!v&&signature(v.signature)&&integer(v.slot);
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const NON_ORIGIN_REASONS=new Set(['MIGRATION_IDENTITY_OUTSIDE_PUMP_PROGRAM_FAMILY','MIGRATION_IDENTITY_MIGRATION_INSTRUCTION_NOT_VERIFIED','MIGRATION_IDENTITY_CREATION_CPI_NOT_VERIFIED']);
function need(v:unknown,reason:string):asserts v{if(!v)throw Error(reason);}
function stable(id:MigrationIdentity){const {commitment:_c,availableAt:_a,...rest}=id;return JSON.stringify(rest);}
function refusal(error:unknown){const message=error instanceof Error?error.message:'';return /^(?:PILOT_|COMPONENT_|RPC_|MIGRATION_IDENTITY_)[A-Z0-9_:-]{1,120}$/.test(message)?message:'PILOT_MIGRATION_LOOKUP_UNAVAILABLE';}
function seedMatches(a:PilotMigrationSeed,b:PilotMigrationSeed){return a.signature===b.signature&&a.feedMint===b.feedMint&&a.receivedAt===b.receivedAt;}

/** Validate durable routing state, not financial/age evidence. Raw history is
 * never retained. A confirmed origin is independently decoded again before a
 * finalized request, so a checkpoint cannot manufacture a migration proof. */
export function validPumpSwapMigrationRecovery(value:unknown,seed:PilotMigrationSeed,at:number):value is PumpSwapMigrationRecovery{
 try{
  const p=value as PumpSwapMigrationRecovery;
  if(!p||p.version!==PUMPSWAP_MIGRATION_RECOVERY_POLICY.version||!seedMatches(p.seed,seed)||!signature(seed.signature)||!integer(seed.receivedAt)||!seed.feedMint||new PublicKey(seed.feedMint).toBase58()!==seed.feedMint||seed.feedMint===NATIVE_MINT.toBase58()||seed.feedMint===PublicKey.default.toBase58()||canonicalPumpPoolPda(new PublicKey(seed.feedMint)).toBase58()!==p.pool)return false;
  if(!integer(at)||!integer(p.revision)||p.revision<1||!integer(p.startedAt)||!integer(p.updatedAt)||seed.receivedAt>p.startedAt||p.startedAt>p.updatedAt||p.updatedAt>at||!['history','candidate','finalized'].includes(p.phase)||!cursor(p.before)||!cursor(p.until))return false;
  if(!Array.isArray(p.sameSlotCursors)||!p.sameSlotCursors.every(signature)||new Set(p.sameSlotCursors).size!==p.sameSlotCursors.length||p.before&&!p.sameSlotCursors.includes(p.before.signature)||!p.before&&p.sameSlotCursors.length)return false;
  if(![p.historyPages,p.historyRows,p.candidateReads,p.scanPasses].every(integer)||typeof p.seedNonOrigin!=='boolean'||typeof p.seedConfirmedSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.seedConfirmedSha256)||!Array.isArray(p.candidates)||p.candidates.length>PUMPSWAP_MIGRATION_RECOVERY_POLICY.retainedCandidates)return false;
  const seen=new Set<string>();let priorSlot=-1;
  for(const row of p.candidates){if(!cursor(row)||row.slot<priorSlot||seen.has(row.signature)||!(row.blockTime===null||integer(row.blockTime)&&Number.isSafeInteger(row.blockTime*1000)&&row.blockTime*1000<=p.updatedAt))return false;seen.add(row.signature);priorSlot=row.slot;}
  if(p.phase==='candidate'&&!p.candidates.length||p.phase==='finalized'&&!p.originConfirmed||p.phase!=='finalized'&&p.originConfirmed!==null)return false;
  if(p.originConfirmed){const r=p.originConfirmed;if(r.commitment!=='confirmed'||!signature(r.signature)||!integer(r.requestedAt)||!integer(r.availableAt)||r.requestedAt>r.availableAt||r.availableAt>p.updatedAt)return false;}
  return Buffer.byteLength(JSON.stringify(p))<=PUMPSWAP_MIGRATION_RECOVERY_POLICY.maximumCheckpointBytes;
 }catch{return false;}
}

/** The initial hint is read once. Each later call resumes its saved cursor or
 * origin, within the runner's existing physical gate and 20-second workflow.
 * An eight-candidate window is a storage bound, never a rejection threshold:
 * if exhausted, a newer bounded range is searched with an exclusive `until`
 * cursor. Provider gaps/errors preserve progress and never establish age. */
export async function resolvePumpSwapMigrationAge(seed:PilotMigrationSeed,rpc:PilotMigrationRpc,signal:AbortSignal,checkpoint?:PumpSwapMigrationRecovery|null):Promise<PilotMigrationResult>{
 const policy=PUMPSWAP_MIGRATION_RECOVERY_POLICY,startedAt=Date.now(),startedMono=performance.now(),controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
 const timer=setTimeout(()=>controller.abort(),policy.maximumElapsedMs);let reads=0,state:PumpSwapMigrationRecovery|undefined,initial:Read|null=null;
 const check=()=>need(!combined.aborted&&Date.now()>=startedAt&&Date.now()-startedAt<policy.maximumElapsedMs&&performance.now()-startedMono<policy.maximumElapsedMs,'PILOT_MIGRATION_ABORTED');
 const call=async<T>(method:string,params:unknown[])=>{check();need(reads<policy.maximumReadsPerTurn,'PILOT_MIGRATION_READ_CAP');reads++;const result=await rpc.call<T>(method,params,combined);check();return result;};
 const transaction=async(sig:string,commitment:'confirmed'|'finalized'):Promise<Read>=>{const requestedAt=Date.now(),tx=await call<unknown>('getTransaction',[sig,{encoding:'json',commitment,maxSupportedTransactionVersion:1}]),availableAt=Date.now();need(availableAt>=requestedAt,'PILOT_MIGRATION_READ_CLOCK_REGRESSION');return {signature:sig,commitment,requestedAt,availableAt,transaction:tx};};
 const continued=(reason=MIGRATION_RECOVERY_CONTINUES):PilotMigrationResult=>{
  if(!state)return {ok:false,reason};
  const recovery={...state,revision:state.revision+1,updatedAt:Date.now()};
  need(validPumpSwapMigrationRecovery(recovery,seed,Date.now()),'PILOT_MIGRATION_RECOVERY_INVALID');
  return {ok:false,reason,recovery};
 };
 const scoped=(id:MigrationIdentity)=>id.classification==='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT'&&id.baseMint===seed.feedMint&&id.quoteMint===NATIVE_MINT.toBase58()&&id.pool===state!.pool;
 const finalize=async():Promise<PilotMigrationResult>=>{
  const originConfirmed=state!.originConfirmed!,confirmed=decodeMigrationIdentity(originConfirmed.transaction,{signature:originConfirmed.signature,feedMint:seed.feedMint,commitment:'confirmed',availableAt:originConfirmed.availableAt});
  need(confirmed.ok&&scoped(confirmed.identity),'PILOT_MIGRATION_RECOVERY_ORIGIN_INVALID');
  const originFinalized=await transaction(originConfirmed.signature,'finalized'),finalized=decodeMigrationIdentity(originFinalized.transaction,{signature:originConfirmed.signature,feedMint:seed.feedMint,commitment:'finalized',availableAt:originFinalized.availableAt});
  need(finalized.ok,'PILOT_MIGRATION_FINALIZED_CREATION_UNAVAILABLE');need(stable(confirmed.identity)===stable(finalized.identity),'PILOT_MIGRATION_FINALIZED_IDENTITY_CHANGED');
  const recovery={version:state!.version,startedAt:state!.startedAt,historyPages:state!.historyPages,historyRows:state!.historyRows,candidateReads:state!.candidateReads,scanPasses:state!.scanPasses,seedConfirmedSha256:state!.seedConfirmedSha256};
  const proof:PilotMigrationProof={source:state!.historyPages?'resumable-canonical-SOL-history':'direct-confirmed-creation',seed:{...seed},initialConfirmed:initial??(originConfirmed.signature===seed.signature?originConfirmed:null),history:null,originCandidates:[{signature:originConfirmed.signature,slot:confirmed.identity.slot,reason:'ACTUAL_ORIGIN_CREATION_CONFIRMED'}],originConfirmed,originFinalized,finalizedIdentityMatchesConfirmed:true,currentPoolSupportVerified:false,entryEligibilityVerified:false,recovery};
  const encoded=JSON.stringify(proof);need(Buffer.byteLength(encoded)<=policy.maximumCheckpointBytes,'PILOT_MIGRATION_PROOF_SIZE_CAP');check();
  return {ok:true,identity:finalized.identity,evidence:'pilot-finalized-migration:'+digest(proof),proof};
 };
 try{
  check();need(signature(seed.signature)&&integer(seed.receivedAt)&&seed.receivedAt<=startedAt,'PILOT_MIGRATION_SEED_TIME');
  need(seed.feedMint&&new PublicKey(seed.feedMint).toBase58()===seed.feedMint&&seed.feedMint!==NATIVE_MINT.toBase58()&&seed.feedMint!==PublicKey.default.toBase58(),'PILOT_MIGRATION_RETRY_BASE_MINT_REQUIRED');
  if(checkpoint){need(validPumpSwapMigrationRecovery(checkpoint,seed,startedAt),'PILOT_MIGRATION_RECOVERY_INVALID');state=structuredClone(checkpoint);}
  else{
   initial=await transaction(seed.signature,'confirmed');const decoded=decodeMigrationIdentity(initial.transaction,{signature:seed.signature,feedMint:seed.feedMint,commitment:'confirmed',availableAt:initial.availableAt});
   state={version:policy.version,seed:{...seed},pool:canonicalPumpPoolPda(new PublicKey(seed.feedMint)).toBase58(),revision:0,startedAt,updatedAt:initial.availableAt,phase:'history',before:null,until:null,sameSlotCursors:[],candidates:[],originConfirmed:null,historyPages:0,historyRows:0,candidateReads:0,scanPasses:0,seedConfirmedSha256:digest(initial.transaction),seedNonOrigin:!decoded.ok&&NON_ORIGIN_REASONS.has(decoded.reason)};
   if(decoded.ok){if(!scoped(decoded.identity)){state=undefined;throw Error('PILOT_MIGRATION_'+(decoded.identity.reason??'FEED_SCOPE_MISMATCH'));}state.phase='finalized';state.originConfirmed=initial;return await finalize();}
  }
  if(state.phase==='finalized')return await finalize();
  if(state.phase==='candidate'){
   const candidate=state.candidates[0]!,read=await transaction(candidate.signature,'confirmed'),tx=read.transaction as any;
   need(tx&&tx.transaction?.signatures?.[0]===candidate.signature&&tx.slot===candidate.slot&&(candidate.blockTime===null||tx.blockTime===candidate.blockTime),'PILOT_MIGRATION_HISTORY_CONTEXT_UNAVAILABLE');
   const decoded=decodeMigrationIdentity(tx,{signature:candidate.signature,feedMint:seed.feedMint,commitment:'confirmed',availableAt:read.availableAt});
   if(decoded.ok&&scoped(decoded.identity)){state.candidateReads++;state.phase='finalized';state.originConfirmed=read;return await finalize();}
   // Only a structurally decoded non-origin may advance the lower bound.
   // Null/partial/unsupported transaction data remains retryable at this row.
   need(decoded.ok||NON_ORIGIN_REASONS.has(decoded.reason),'PILOT_MIGRATION_ORIGIN_TRANSACTION_UNAVAILABLE');
   state.candidateReads++;state.candidates.shift();state.until={signature:candidate.signature,slot:candidate.slot};
   if(!state.candidates.length){state.phase='history';state.before=null;state.sameSlotCursors=[];state.scanPasses++;}
   return continued();
  }
  const params={limit:policy.pageLimit,commitment:'confirmed',...(state.before?{before:state.before.signature}:{}),...(state.until?{until:state.until.signature}:{})};
  const rows=await call<any[]>('getSignaturesForAddress',[state.pool,params]);
  need(Array.isArray(rows)&&rows.length<=policy.pageLimit,'PILOT_MIGRATION_HISTORY_UNAVAILABLE');
  let priorSlot=state.before?.slot??Infinity;const seen=new Set<string>(),priorCandidates=new Set(state.candidates.map(row=>row.signature)),sameSlotCursors=new Set(state.sameSlotCursors);
  for(const row of rows){
   need(row&&signature(row.signature)&&!seen.has(row.signature)&&!priorCandidates.has(row.signature)&&!sameSlotCursors.has(row.signature)&&row.signature!==state.before?.signature&&row.signature!==state.until?.signature&&integer(row.slot)&&row.slot<=priorSlot&&row.slot>=(state.until?.slot??0)&&Object.hasOwn(row,'err')&&(row.blockTime===null||integer(row.blockTime)&&Number.isSafeInteger(row.blockTime*1000)&&row.blockTime*1000<=Date.now()),'PILOT_MIGRATION_HISTORY_MALFORMED');
   seen.add(row.signature);priorSlot=row.slot;
  }
  state.historyPages++;state.historyRows+=rows.length;
  const cutoff=Date.now()-policy.historyHorizonMs;
  const candidates:Candidate[]=rows.filter(row=>row.err===null&&(!state!.seedNonOrigin||row.signature!==seed.signature)&&(row.blockTime===null||row.blockTime*1000>=cutoff)).reverse().map(row=>({signature:row.signature,slot:row.slot,blockTime:row.blockTime}));
  state.candidates=[...candidates,...state.candidates].filter(row=>row.blockTime===null||row.blockTime*1000>=cutoff).slice(0,policy.retainedCandidates);
  const oldest=rows.at(-1),pastHorizon=oldest&&oldest.blockTime!==null&&oldest.blockTime*1000<cutoff;
  if(rows.length===policy.pageLimit&&!pastHorizon){
   // Slots may tie across legitimate page boundaries. Retain cursors only
   // within that slot to detect a multi-page cycle without limiting history
   // depth or retaining every preceding page/transaction.
   state.sameSlotCursors=state.before?.slot===oldest.slot?[...state.sameSlotCursors,oldest.signature]:[oldest.signature];
   state.before={signature:oldest.signature,slot:oldest.slot};return continued();
  }
  if(state.candidates.length){state.phase='candidate';return continued();}
  // An empty/incomplete provider range is not proof of a token's age. Permit
  // a cooled retry if archival availability changes; preserve lifetime counts.
  state.before=null;state.until=null;state.sameSlotCursors=[];state.scanPasses++;
  return continued('PILOT_MIGRATION_ORIGIN_NOT_FOUND_IN_AVAILABLE_HISTORY');
 }catch(error){
  const reason=refusal(error);
  // Keep a valid confirmed origin/cursor after a provider failure. An invalid
  // checkpoint is never repaired by guessing or silently advancing its cursor.
  try{return continued(reason);}catch{return {ok:false,reason};}
 }finally{clearTimeout(timer);controller.abort();}
}
