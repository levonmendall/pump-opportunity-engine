/** One four-read activity pass for the explicitly approved held-pricing component.
 * No feed, wallet, financial account or quote API is opened by this module.
 */
import bs58 from 'bs58';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from './sdk.js';
import {invokedCanonicalSolPools,invokedCanonicalSolSwaps,type CandidateScope,type SelectionRpc} from './active-selection.js';
import {mapConfirmedPumpSwapEvidence,type MappedTradeEvidence} from './pumpapi-mapping.js';
import type {SelectionRejectionStore,SelectionRejection} from './selection-rejections.js';

export const COMPONENT_PRIMARY_POOL=Object.freeze({mint:'7q9JLdtpktvSqvep8QLPbqRqeJKC4L3izhKLtoojpump',pool:'6ztGkeEPFbrBVh53fKbRtJk4Y74UBjPE8R5q5Ke2hvZv'});
type Row={signature:string;slot:number;blockTime:number|null;err:unknown};
export type ComponentPool={mint:string;pool:string;baseUnits:string;minSlot:number;signature:string;trades:MappedTradeEvidence[];activityVerifiedAt:number;quantitySelection:string;currentSupport:'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK';entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY'};
export type ComponentSelectionEvidence={method:string;maximumReads:4;reads:number;firstQueriedAt:number;completedAt:number|null;transactions:Array<{signature:string;requestedAt:number;availableAt:number;transaction:any}>;pages:Array<{kind:'seed'|'program';address:string;requestedAt:number;availableAt:number;rows:Row[]}>;rejections:Array<{signature:string|null;pool:string|null;reason:string}>};
type Options={rpc:SelectionRpc;seed?:CandidateScope;rejectionStore?:Pick<SelectionRejectionStore,'lookup'>;signal?:AbortSignal;now?:()=>number;record?:(kind:string,data:unknown)=>void};
export type ComponentSelectionResult={ok:true;candidate:ComponentPool;evidence:ComponentSelectionEvidence}|{ok:false;reason:string;evidence:ComponentSelectionEvidence};
function need(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
function safe(error:unknown){const s=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_]{0,96}(?::[A-Za-z][A-Za-z0-9_]{0,48})?$/.test(s)?s:'COMPONENT_ACTIVITY_UNAVAILABLE';}
function rows(value:unknown,limit:number):Row[]{
  need(Array.isArray(value)&&value.length<=limit,'COMPONENT_INVALID_SIGNATURE_PAGE');const seen=new Set<string>();
  return value.map((r:any)=>{need(r&&typeof r.signature==='string'&&r.signature.length<=100&&!seen.has(r.signature)&&Number.isSafeInteger(r.slot)&&r.slot>=0&&(r.blockTime===null||Number.isSafeInteger(r.blockTime)),'COMPONENT_INVALID_SIGNATURE_ROW');try{need(bs58.decode(r.signature).length===64,'COMPONENT_INVALID_SIGNATURE_ROW');}catch{throw Error('COMPONENT_INVALID_SIGNATURE_ROW');}seen.add(r.signature);return {signature:r.signature,slot:r.slot,blockTime:r.blockTime,err:r.err};});
}
/** The deepest retained independently verified pool is only a discovery seed.
 * It supplies no fresh market facts. If quiet, one bounded program page can
 * supply another identity; no old pool is revisited and no request is retried.
 * One current genuine swap is sufficient for THIS price/notification component;
 * there is no full-flow-window or strategy-eligibility claim.
 */
export async function selectComponentPool(options:Options):Promise<ComponentSelectionResult>{
  const now=options.now??Date.now,seed=options.seed??COMPONENT_PRIMARY_POOL,record=options.record??(()=>{});
  need(canonicalPumpPoolPda(new PublicKey(seed.mint)).toBase58()===seed.pool,'COMPONENT_INVALID_SEED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);timer.unref?.();
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  const began=now();
  const evidence:ComponentSelectionEvidence={method:'Activity-biased transport/held-pricing test. One known canonical pool history(limit8), then only if needed one latest256-signature program page, at most4 total reads. No repeat requests or pool-history scan. Every candidate must contain a successful current independently decoded swap; full current support is a later Clock-batch gate.',maximumReads:4,reads:0,firstQueriedAt:now(),completedAt:null,transactions:[],pages:[],rejections:[]};
  const seenSignatures=new Set<string>(),visited=new Set<string>();
  const call=async<T>(method:string,params:unknown[]):Promise<T>=>{signal.throwIfAborted();need(now()>=began&&now()-began<6000,'COMPONENT_SELECTION_ELAPSED_CAP');need(evidence.reads<4,'COMPONENT_SELECTION_REQUEST_CAP');evidence.reads++;const value=await options.rpc.call<T>(method,params,signal);need(now()>=began&&now()-began<6000,'COMPONENT_SELECTION_ELAPSED_CAP');return value;};
  const blocked=(scope:CandidateScope,signature:string|null)=>{const guard=options.rejectionStore?.lookup(scope,now());if(guard?.blocked){visited.add(scope.pool);evidence.rejections.push({signature,pool:scope.pool,reason:'PRIOR_POOL_REJECTION_'+guard.record!.reason});record('component-prior-pool-rejection',{scope,signature,guard});return true;}return false;};
  const current=(page:Row[],at:number)=>page.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime*1000>=at-30000&&r.blockTime*1000<=at);
  const page=async(address:string,kind:'seed'|'program',limit:number)=>{const requestedAt=now(),result=rows(await call('getSignaturesForAddress',[address,{commitment:'confirmed',limit}]),limit),entry={kind,address,requestedAt,availableAt:now(),rows:result};evidence.pages.push(entry);record('component-selection-signatures',entry);return current(result,requestedAt);};
  const inspect=async(row:Row,required?:CandidateScope):Promise<ComponentPool|null>=>{
    if(seenSignatures.has(row.signature))return null;seenSignatures.add(row.signature);
    const requestedAt=now(),tx=await call<any>('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}]),availableAt=now();
    need(tx&&tx.transaction?.signatures?.[0]===row.signature,'TRANSACTION_SIGNATURE_MISMATCH');need(tx.slot===row.slot&&tx.blockTime===row.blockTime,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');
    const entry={signature:row.signature,requestedAt,availableAt,transaction:tx};evidence.transactions.push(entry);record('component-selection-transaction',entry);
    const scopes=invokedCanonicalSolPools(tx).filter(s=>!required||s.pool===required.pool&&s.mint===required.mint);
    for(const scope of scopes){
      if(visited.has(scope.pool)||blocked(scope,row.signature))continue;
      try{
        const mapped=mapConfirmedPumpSwapEvidence(tx,{...scope,signature:row.signature,providerReceivedAt:null,availableAt});
        const invocations=invokedCanonicalSolSwaps(tx).filter(s=>s.pool===scope.pool&&s.mint===scope.mint).length;
        need(mapped.length>0&&mapped.length===invocations,'COMPONENT_SWAP_EVENT_DENOMINATOR_MISMATCH');
        need(mapped.every(t=>t.transferChecks.baseTransfer&&t.transferChecks.userQuoteTransfer),'COMPONENT_UNVERIFIED_EXECUTED_TRANSFERS');
        need(row.blockTime!==null&&availableAt-row.blockTime*1000<=30000&&row.blockTime*1000<=availableAt,'COMPONENT_ACTIVITY_AGED_DURING_READ');
        return {...scope,baseUnits:mapped[0]!.tokenUnits,minSlot:tx.slot,signature:row.signature,trades:mapped,activityVerifiedAt:availableAt,quantitySelection:'Entire executed base amount of the first verified swap; hypothetical only, no account position or capital is created.',currentSupport:'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK',entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY'};
      }catch(error){evidence.rejections.push({signature:row.signature,pool:scope.pool,reason:safe(error)});visited.add(scope.pool);}
    }
    if(!scopes.length)evidence.rejections.push({signature:row.signature,pool:required?.pool??null,reason:'NO_CURRENT_INVOKED_CANONICAL_SOL_SWAP'});
    return null;
  };
  try{
    if(!blocked(seed,null)){
      const recent=await page(seed.pool,'seed',8);
      for(const row of recent.slice(0,2)){const candidate=await inspect(row,seed);if(candidate)return {ok:true,candidate,evidence};}
      visited.add(seed.pool);evidence.rejections.push({signature:null,pool:seed.pool,reason:recent.length?'NO_VERIFIED_RECENT_SWAP_IN_SEED_SAMPLE':'NO_RECENT_SUCCESSFUL_SEED_ACTIVITY'});
    }
    // Leave at least one read for a transaction; a page alone cannot prove an
    // active swap and is not worth spending the last remaining request on.
    if(evidence.reads<=2){
      const recent=await page(PUMP_AMM_PROGRAM_ID.toBase58(),'program',256),available=4-evidence.reads;
      const candidates=recent.filter(r=>!seenSignatures.has(r.signature)),n=Math.min(available,candidates.length);
      const sample=Array.from({length:n},(_,i)=>candidates[n===1?Math.floor(candidates.length/2):Math.round(i*(candidates.length-1)/(n-1))]!);
      for(const row of sample){const candidate=await inspect(row);if(candidate)return {ok:true,candidate,evidence};}
    }
    return {ok:false,reason:'NO_VERIFIED_UNBLOCKED_ACTIVE_POOL_WITHIN_FOUR_READS',evidence};
  }catch(error){return {ok:false,reason:controller.signal.aborted?'COMPONENT_SELECTION_ELAPSED_CAP':options.signal?.aborted?'COMPONENT_SELECTION_ABORTED':safe(error),evidence};}
  finally{clearTimeout(timer);evidence.completedAt=now();}
}

/** Purpose-specific preparation added AFTER the closed grant. The historical
 * selectComponentPool above remains unchanged so its receipt/hash is replayable.
 * These functions do not authorize a request or establish current pool support.
 */
export type ComponentPurpose='basic-current-state'|'changing-price';
export type HistoricalComponentEvidence={proofRef:string;proofSha256:string;quoteSlot:number;quoteReceivedAt:string;hypotheticalBaseUnits:string;swapRef:string;swapSha256:string;swapSlot:number;swapSignature:string;swapBlockTime:number};
export type VerifiedComponentSeed=CandidateScope&{baseUnits:string;minSlot:number;historicalEvidence:HistoricalComponentEvidence};
export type MigrationComponentSeed=CandidateScope&{observedAt:number;sourceRef:string;signature?:string};
export type PreparedComponentPool=CandidateScope&{baseUnits:string;minSlot:number;signature:string|null;trades:MappedTradeEvidence[];activityVerifiedAt:number|null;activity:'UNVERIFIED'|'CURRENT_DECODED_SWAP';historicalEvidence:HistoricalComponentEvidence|null;discovery:MigrationComponentSeed|null;quantitySelection:string;currentSupport:'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK';entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY';requiredCurrentChecks:readonly string[]};
export type ComponentPreparationEvidence={purpose:ComponentPurpose;method:string;maximumReads:number;maximumElapsedMs:number;reads:number;startedAt:number;completedAt:number|null;pages:Array<{kind:'migration-seed';address:string;requestedAt:number;availableAt:number;rows:Row[]}>;transactions:Array<{signature:string;requestedAt:number;availableAt:number;transaction:any}>;rejections:Array<{pool:string|null;reason:string}>;ignoredPriorGuards:Array<{pool:string;reason:string;evidenceRef:string}>;authorization:'PREPARATION_ONLY_NO_NETWORK_GRANT';activityClaim:string};
type PreparationCommon={now?:()=>number;signal?:AbortSignal;record?:(kind:string,data:unknown)=>void;priorRejections?:readonly SelectionRejection[];supportPolicyVersion:string;globalRefusal?:string|null};
export type ComponentPreparationOptions=PreparationCommon&({purpose:'basic-current-state';verifiedSeed:VerifiedComponentSeed}|{purpose:'changing-price';rpc:SelectionRpc;migrationSeeds:readonly MigrationComponentSeed[];maximumReads?:number;maximumElapsedMs?:number});
export type ComponentPreparationResult={ok:true;candidate:PreparedComponentPool;evidence:ComponentPreparationEvidence}|{ok:false;reason:string;evidence:ComponentPreparationEvidence};
const REQUIRED_CURRENT_CHECKS=Object.freeze(['canonical pool and account links','mint/program/extensions','vault ownership and backing','fee configuration and integer calculations','coherent confirmed Clock/account context','fresh source and quote at use','actual hypothetical-size sell liquidity','subscription acknowledgement is separate from changed-state delivery']);
const PRICING_IRRELEVANT_FLOW_GUARDS=new Set(['POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN','SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY','POOL_ACTIVITY_BASELINE_TOO_SHORT']);
const BASIC_IRRELEVANT_GUARDS=new Set(['INSUFFICIENT_RECENT_POOL_ACTIVITY','FEWER_THAN_TWO_VERIFIED_RECENT_SWAP_TRANSACTIONS','POOL_HISTORY_HAS_UNKNOWN_BLOCK_TIME','VERIFIED_POOL_ACTIVITY_IS_NO_LONGER_CURRENT','VERIFIED_POOL_ACTIVITY_AGED_DURING_SUPPORT_CHECK']);
function canonicalScope(scope:CandidateScope){need(canonicalPumpPoolPda(new PublicKey(scope.mint)).toBase58()===scope.pool,'COMPONENT_INVALID_SEED');}
function evidenceRef(value:unknown):asserts value is string {need(typeof value==='string'&&value.startsWith('evidence/')&&value.length<=192&&!value.split('/').includes('..')&&!/[\u0000-\u001f]/.test(value),'COMPONENT_INVALID_EVIDENCE_REF');}
function positiveUnits(value:unknown):asserts value is string {need(typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18446744073709551615n,'COMPONENT_INVALID_HYPOTHETICAL_QUANTITY');}
/** Validate retained identity and an executed swap without claiming old account
 * bytes/prices are fresh. Exact supplied byte hashes remain attached to identity.
 */
export function componentSeedFromRetainedEvidence(input:{integrationProof:{ref:string;bytes:Buffer};swapProof:{ref:string;bytes:Buffer}}):VerifiedComponentSeed {
  for(const source of [input.integrationProof,input.swapProof]){evidenceRef(source.ref);need(Buffer.isBuffer(source.bytes)&&source.bytes.length>0&&source.bytes.length<=2*1024*1024,'COMPONENT_RETAINED_PROOF_SIZE');}
  const proof=JSON.parse(input.integrationProof.bytes.toString()),swap=JSON.parse(input.swapProof.bytes.toString()),q=proof.quote;
  need(proof.project==='pump-opportunity-engine'&&proof.origin?.commitment==='confirmed'&&proof.origin.instructionVerified===true&&proof.origin.creationCpiVerified===true,'COMPONENT_UNVERIFIED_RETAINED_ORIGIN');
  need(q&&q.sdk==='@pump-fun/pump-swap-sdk@2.2.0'&&q.mode==='QUOTE_ONLY'&&q.commitment==='confirmed'&&Number.isSafeInteger(q.slot)&&q.slot>=0&&Number.isSafeInteger(Date.parse(q.receivedAt)),'COMPONENT_UNVERIFIED_RETAINED_QUOTE');
  const scope={mint:q.mint,pool:q.pool};canonicalScope(scope);positiveUnits(q.buy?.outputBaseUnits);positiveUnits(q.correspondingSell?.outputLamports);
  need(typeof swap.signature==='string'&&swap.transaction?.transaction?.signatures?.[0]===swap.signature&&Number.isSafeInteger(swap.transaction?.slot)&&Number.isSafeInteger(swap.transaction?.blockTime),'COMPONENT_UNVERIFIED_RETAINED_SWAP');
  const availableAt=Date.parse(swap.fetchedAt);need(Number.isSafeInteger(availableAt)&&availableAt>=swap.transaction.blockTime*1000,'COMPONENT_RETAINED_SWAP_TIMESTAMP');
  const mapped=mapConfirmedPumpSwapEvidence(swap.transaction,{...scope,signature:swap.signature,providerReceivedAt:null,availableAt});
  const count=invokedCanonicalSolSwaps(swap.transaction).filter(s=>s.pool===scope.pool&&s.mint===scope.mint).length;
  need(mapped.length>0&&mapped.length===count&&mapped.every(t=>t.transferChecks.baseTransfer&&t.transferChecks.userQuoteTransfer),'COMPONENT_UNVERIFIED_RETAINED_TRANSFERS');
  const baseUnits=q.buy.outputBaseUnits;positiveUnits(baseUnits);
  return {...scope,baseUnits,minSlot:Math.max(q.slot,swap.transaction.slot),historicalEvidence:{proofRef:input.integrationProof.ref,proofSha256:createHash('sha256').update(input.integrationProof.bytes).digest('hex'),quoteSlot:q.slot,quoteReceivedAt:q.receivedAt,hypotheticalBaseUnits:baseUnits,swapRef:input.swapProof.ref,swapSha256:createHash('sha256').update(input.swapProof.bytes).digest('hex'),swapSlot:swap.transaction.slot,swapSignature:swap.signature,swapBlockTime:swap.transaction.blockTime}};
}
/** Basic pricing does not depend on a recent trade. Changing-price preparation
 * checks only explicitly supplied migration identities; it never samples the
 * whole program or claims that a quiet result disproves component correctness.
 * All physical reads still pass through the caller's shared authorized budget.
 */
export async function prepareComponentPool(options:ComponentPreparationOptions):Promise<ComponentPreparationResult>{
  const now=options.now??Date.now,record=options.record??(()=>{}),began=now();
  const maxReads=options.purpose==='basic-current-state'?0:options.maximumReads??4,maxElapsed=options.purpose==='basic-current-state'?0:options.maximumElapsedMs??6000;
  const evidence:ComponentPreparationEvidence={purpose:options.purpose,method:options.purpose==='basic-current-state'?'Historical independently verified identity only; no history or activity read. Full current Clock/account/actual-size support remains mandatory.':'One bounded pass over at most two explicit current migration identities. At most one history page per identity; no program-wide sample or automatic retry.',maximumReads:maxReads,maximumElapsedMs:maxElapsed,reads:0,startedAt:began,completedAt:null,pages:[],transactions:[],rejections:[],ignoredPriorGuards:[],authorization:'PREPARATION_ONLY_NO_NETWORK_GRANT',activityClaim:'No fresh state, changing price, complete flow, entry eligibility or acceptance claim from preparation.'};
  const controller=new AbortController();let timer:NodeJS.Timeout|undefined;
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  const rejected=(scope:CandidateScope)=>{
    for(const row of options.priorRejections??[]){
      if(row.pool!==scope.pool||row.mint!==scope.mint)continue;
      need(Number.isSafeInteger(row.observedAt)&&began>=row.observedAt,'COMPONENT_REJECTION_CLOCK_REGRESSION');
      const active=row.expiresAt===null?row.policyVersion===options.supportPolicyVersion:began<row.expiresAt;
      if(!active)continue;
      if(PRICING_IRRELEVANT_FLOW_GUARDS.has(row.reason)||options.purpose==='basic-current-state'&&BASIC_IRRELEVANT_GUARDS.has(row.reason)){evidence.ignoredPriorGuards.push({pool:row.pool,reason:row.reason,evidenceRef:row.evidenceRef});continue;}
      evidence.rejections.push({pool:row.pool,reason:'PRIOR_POOL_REJECTION_'+row.reason});return true;
    }return false;
  };
  const prepared=(scope:CandidateScope,extra:Omit<PreparedComponentPool,keyof CandidateScope|'currentSupport'|'entryEligibility'|'requiredCurrentChecks'>):PreparedComponentPool=>({...scope,...extra,currentSupport:'REQUIRES_CLOCK_POOL_MINT_VAULT_FEE_CHECK',entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',requiredCurrentChecks:REQUIRED_CURRENT_CHECKS});
  try{
    signal.throwIfAborted();need(typeof options.supportPolicyVersion==='string'&&options.supportPolicyVersion.length>0,'COMPONENT_SUPPORT_POLICY_REQUIRED');
    if(options.globalRefusal){evidence.rejections.push({pool:null,reason:safe(Error(options.globalRefusal))});return {ok:false,reason:'COMPONENT_GLOBAL_REFUSAL_ACTIVE',evidence};}
    if(options.purpose==='basic-current-state'){
      const seed=options.verifiedSeed;canonicalScope(seed);positiveUnits(seed.baseUnits);
      need(seed.historicalEvidence&&seed.baseUnits===seed.historicalEvidence.hypotheticalBaseUnits&&Number.isSafeInteger(seed.minSlot)&&seed.minSlot>=0&&seed.historicalEvidence.swapSlot<=seed.minSlot&&seed.historicalEvidence.quoteSlot<=seed.minSlot,'COMPONENT_UNVERIFIED_BASIC_SEED');
      for(const ref of [seed.historicalEvidence.proofRef,seed.historicalEvidence.swapRef])evidenceRef(ref);
      if(rejected(seed))return {ok:false,reason:'COMPONENT_STRUCTURAL_OR_CURRENT_STATE_GUARD',evidence};
      return {ok:true,candidate:prepared(seed,{baseUnits:seed.baseUnits,minSlot:seed.minSlot,signature:seed.historicalEvidence.swapSignature,trades:[],activityVerifiedAt:null,activity:'UNVERIFIED',historicalEvidence:structuredClone(seed.historicalEvidence),discovery:null,quantitySelection:'Fixed base quantity from the retained validated buy estimate; hypothetical only. No old price/account state is reused. Do not shrink the quantity if a current actual-size exit is unavailable.'}),evidence};
    }
    need(Number.isSafeInteger(maxReads)&&maxReads>=1&&maxReads<=4&&Number.isSafeInteger(maxElapsed)&&maxElapsed>=1&&maxElapsed<=6000,'COMPONENT_INVALID_PREPARATION_BOUNDS');
    need(Array.isArray(options.migrationSeeds)&&options.migrationSeeds.length<=2,'COMPONENT_INVALID_MIGRATION_SEED_COUNT');
    need(new Set(options.migrationSeeds.map(s=>s.pool)).size===options.migrationSeeds.length,'COMPONENT_DUPLICATE_MIGRATION_SEED');
    if(!options.migrationSeeds.length)return {ok:false,reason:'COMPONENT_CURRENT_MIGRATION_SEEDS_REQUIRED',evidence};
    for(const seed of options.migrationSeeds){canonicalScope(seed);evidenceRef(seed.sourceRef);need(Number.isSafeInteger(seed.observedAt)&&seed.observedAt>=0&&seed.observedAt<=began,'COMPONENT_INVALID_MIGRATION_OBSERVATION');}
    timer=setTimeout(()=>controller.abort(),maxElapsed);timer.unref?.();
    const call=async<T>(method:string,params:unknown[]):Promise<T>=>{signal.throwIfAborted();need(now()>=began&&now()-began<maxElapsed,'COMPONENT_PREPARATION_ELAPSED_CAP');need(evidence.reads<maxReads,'COMPONENT_PREPARATION_REQUEST_CAP');evidence.reads++;const v=await options.rpc.call<T>(method,params,signal);need(now()>=began&&now()-began<maxElapsed,'COMPONENT_PREPARATION_ELAPSED_CAP');return v;};
    const seen=new Set<string>();
    for(const seed of options.migrationSeeds){
      if(rejected(seed))continue;if(evidence.reads+2>maxReads)break;
      const requestedAt=now(),history=rows(await call('getSignaturesForAddress',[seed.pool,{commitment:'confirmed',limit:8}]),8),page={kind:'migration-seed' as const,address:seed.pool,requestedAt,availableAt:now(),rows:history};evidence.pages.push(page);record('component-preparation-signatures',page);
      const current=history.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime*1000>=requestedAt-30000&&r.blockTime*1000<=requestedAt&&!seen.has(r.signature));
      // One transaction per identity leaves room for a second supplied identity.
      const row=current[0];if(!row){evidence.rejections.push({pool:seed.pool,reason:'NO_RECENT_SUCCESSFUL_SEED_ACTIVITY'});continue;}
      seen.add(row.signature);const txAt=now(),tx=await call<any>('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}]),availableAt=now();
      need(tx?.transaction?.signatures?.[0]===row.signature,'TRANSACTION_SIGNATURE_MISMATCH');need(tx.slot===row.slot&&tx.blockTime===row.blockTime,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');
      const entry={signature:row.signature,requestedAt:txAt,availableAt,transaction:tx};evidence.transactions.push(entry);record('component-preparation-transaction',entry);
      const scopes=invokedCanonicalSolPools(tx);if(!scopes.some(s=>s.pool===seed.pool&&s.mint===seed.mint)){evidence.rejections.push({pool:seed.pool,reason:'NO_CURRENT_INVOKED_CANONICAL_SOL_SWAP'});continue;}
      const mapped=mapConfirmedPumpSwapEvidence(tx,{mint:seed.mint,pool:seed.pool,signature:row.signature,providerReceivedAt:null,availableAt}),count=invokedCanonicalSolSwaps(tx).filter(s=>s.pool===seed.pool&&s.mint===seed.mint).length;
      need(mapped.length>0&&mapped.length===count&&mapped.every(t=>t.transferChecks.baseTransfer&&t.transferChecks.userQuoteTransfer),'COMPONENT_UNVERIFIED_EXECUTED_TRANSFERS');
      need(row.blockTime!==null&&availableAt-row.blockTime*1000<=30000&&row.blockTime*1000<=availableAt,'COMPONENT_ACTIVITY_AGED_DURING_READ');
      return {ok:true,candidate:prepared(seed,{baseUnits:mapped[0]!.tokenUnits,minSlot:tx.slot,signature:row.signature,trades:mapped,activityVerifiedAt:availableAt,activity:'CURRENT_DECODED_SWAP',historicalEvidence:null,discovery:structuredClone(seed),quantitySelection:'Executed swap amount as a hypothetical quantity only; current full Clock/account support and sell liquidity remain unchecked.'}),evidence};
    }
    return {ok:false,reason:'NO_VERIFIED_ACTIVE_SUPPLIED_MIGRATION_SEED_WITHIN_BOUNDS',evidence};
  }catch(error){return {ok:false,reason:controller.signal.aborted?'COMPONENT_PREPARATION_ELAPSED_CAP':options.signal?.aborted?'COMPONENT_PREPARATION_ABORTED':safe(error),evidence};}
  finally{if(timer)clearTimeout(timer);evidence.completedAt=now();record('component-preparation-result',{purpose:options.purpose,reads:evidence.reads,completedAt:evidence.completedAt});}
}
