/** One four-read activity pass for the explicitly approved held-pricing component.
 * No feed, wallet, financial account or quote API is opened by this module.
 */
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from './sdk.js';
import {invokedCanonicalSolPools,invokedCanonicalSolSwaps,type CandidateScope,type SelectionRpc} from './active-selection.js';
import {mapConfirmedPumpSwapEvidence,type MappedTradeEvidence} from './pumpapi-mapping.js';
import type {SelectionRejectionStore} from './selection-rejections.js';

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
