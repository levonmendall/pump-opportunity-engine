/** Bounded, activity-biased research selection. No feed, financial or wallet API. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Idl} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID} from './sdk.js';
import {quotePositionSell,type PositionSellQuote} from './pool.js';
import type {ReadOnlyRpc} from './network.js';
import {decodePumpSwapInstruction,mapConfirmedPumpSwapEvidence,type MappedTradeEvidence} from './pumpapi-mapping.js';
import {isPoolRejection,type SelectionRejectionStore,type SelectionRejectionLookup} from './selection-rejections.js';

const require=createRequire(import.meta.url);
const idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;
const PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58(),SOL='So11111111111111111111111111111111111111112';
const SWAPS=new Set(['buy','buy_exact_quote_in','buy_v2','buy_exact_quote_in_v2','sell','sell_v2']);
export type SelectionRpc={call<T>(method:string,params?:unknown[],signal?:AbortSignal):Promise<T>};
type SignatureRow={signature:string;slot:number;err:unknown;blockTime:number|null;confirmationStatus?:string};
export type CandidateScope={mint:string;pool:string};
export type SelectionTransaction={signature:string;requestedAt:number;availableAt:number;transaction:any};
export type ActivityEvidence={
  selectionMethod:string;readsAttempted:number;maximumReads:number;programRows:number;
  programTransactionsInspected:number;historyRows:number;historyWindowMs:number;
  historyWindowCovered:boolean;successfulAddressTransactions:number;activitySpanMs:number;
  addressTransactionsPerMinute:number|null;projected90sWithHeadroom:number|null;
  enrichmentCapacity:number;decodedRecentTransactions:number;decodedSwapEvents:number;
  sides:string[];routes:string[];rejections:Array<{signature:string;reason:string}>;
  transactions:SelectionTransaction[];history:SignatureRow[];selectedAt:number|null;
  maximumCandidates:number;maximumProgramTransactions:number;maximumElapsedMs:number;maximumResponseBytes:number;
  responseBytes:number;responseByteAccounting:'transport'|'decoded-result-estimate-offline-only';elapsedMs:number;
  candidateAttempts:Array<{scope:CandidateScope;signature:string;reason:string;readsAtStart:number;readsAtEnd:number;historyRows:number;historyWindowCovered:boolean;successfulAddressTransactions:number;projected90sWithHeadroom:number|null}>;
  priorRejectionSkips:Array<{scope:CandidateScope;signature:string;prior:SelectionRejectionLookup}>;
};
export type ActiveCandidate={
  mint:string;pool:string;baseUnits:string;minSlot:number;supportedQuote:PositionSellQuote;
  supportedPoolEvidence:string;quantitySelection:string;preflightTrades:MappedTradeEvidence[];
  entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY';migrationAgeVerified:false;
};
export type ActiveSelectionResult={ok:true;candidate:ActiveCandidate;evidence:ActivityEvidence}|{ok:false;reason:string;evidence:ActivityEvidence};
export type ActiveSelectionOptions={rpc:SelectionRpc;now?:()=>number;signal?:AbortSignal;maxReads?:number;enrichmentCapacity?:number;record?:(kind:string,data:unknown)=>void;
  maxCandidates?:number;maxProgramTransactions?:number;programLimit?:number;maxElapsedMs?:number;maxResponseBytes?:number;responseBytes?:()=>number;
  rejectionStore?:SelectionRejectionStore;rejectionEvidenceRef?:string;
  quote?:(rpc:SelectionRpc,scope:CandidateScope,baseUnits:bigint,minSlot:number,signal?:AbortSignal)=>Promise<PositionSellQuote>};
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
function reason(error:unknown){const s=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_]{0,96}(?::[A-Za-z][A-Za-z0-9_]{0,48})?$/.test(s)?s:'UNVERIFIED_ACTIVITY_OR_POOL';}
function signatureRows(value:unknown,limit:number):SignatureRow[]{
  need(Array.isArray(value)&&value.length<=limit,'INVALID_SIGNATURE_ROWS');
  const seen=new Set<string>();
  return value.map((row:any)=>{need(row&&typeof row.signature==='string'&&row.signature.length>0&&row.signature.length<=100&&!seen.has(row.signature)&&Number.isSafeInteger(row.slot)&&row.slot>=0&&(row.blockTime===null||Number.isSafeInteger(row.blockTime)),'INVALID_SIGNATURE_ROW');
    try{need(bs58.decode(row.signature).length===64,'INVALID_SIGNATURE_ROW');}catch{throw Error('INVALID_SIGNATURE_ROW');}
    seen.add(row.signature);return {signature:row.signature,slot:row.slot,err:row.err,blockTime:row.blockTime,confirmationStatus:row.confirmationStatus};});
}

/** Actual compiled instructions only: a program address mention is not a swap.
 * This extracts candidate identities; mint/extension/fee support is verified later.
 */
export function invokedCanonicalSolSwaps(tx:any):CandidateScope[]{
  need(tx?.meta?.err===null&&['legacy',0,1].includes(tx.version),'UNSUCCESSFUL_OR_UNSUPPORTED_TRANSACTION');
  const message=tx.transaction?.message;
  need(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128,'UNVERIFIED_COMPILED_MESSAGE');
  const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  need(keys.length<=256&&keys.every(k=>typeof k==='string'),'UNVERIFIED_ACCOUNT_KEYS');
  const address=(n:unknown)=>{need(Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<keys.length,'INVALID_ACCOUNT_INDEX');return keys[Number(n)] as string;};
  const instructions=[...message.instructions];
  need(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128,'MISSING_INNER_INSTRUCTIONS');
  for(const group of tx.meta.innerInstructions){need(Array.isArray(group.instructions)&&group.instructions.length<=512,'UNVERIFIED_INNER_GROUP');instructions.push(...group.instructions);}
  const result:CandidateScope[]=[];
  for(const ix of instructions){
    if(address(ix.programIdIndex)!==PROGRAM)continue;
    need(typeof ix.data==='string'&&ix.data.length<=4096&&Array.isArray(ix.accounts),'UNVERIFIED_SWAP_BYTES');
    let decoded;try{decoded=decodePumpSwapInstruction(Buffer.from(bs58.decode(ix.data)));}catch{continue;}
    if(!decoded||!SWAPS.has(decoded.name))continue;
    const definition=idl.instructions.find(i=>i.name===decoded.name);need(definition,'UNKNOWN_SWAP_INSTRUCTION');
    const role=(name:string)=>{const i=definition.accounts.findIndex(a=>a.name===name);need(i>=0,'MISSING_SWAP_ROLE');return address(ix.accounts[i]);};
    const mint=role('base_mint'),pool=role('pool');
    if(role('quote_mint')!==SOL)continue;
    if(canonicalPumpPoolPda(new PublicKey(mint)).toBase58()!==pool)continue;
    result.push({mint,pool});
  }
  return result;
}

/** Deduplicated candidate identities. The swap helper deliberately retains
 * repeated compiled invocations for a transaction-level audit denominator. */
export function invokedCanonicalSolPools(tx:any):CandidateScope[]{
  return [...new Map(invokedCanonicalSolSwaps(tx).map(scope=>[scope.pool,scope])).values()];
}

/** One bounded candidate pass, never a retry loop: one program page, a fixed
 * systematic transaction sample, and each distinct canonical pool at most once.
 * Saturated history is capacity-unknown and skipped without pagination. Exact
 * transport response accounting must be supplied by a live caller; the decoded
 * estimate exists for network-free fixtures only. Never opens a feed.
 */
export async function selectActivePool(options:ActiveSelectionOptions):Promise<ActiveSelectionResult>{
  const now=options.now??Date.now,maxReads=options.maxReads??48,capacity=options.enrichmentCapacity??48;
  const maxCandidates=options.maxCandidates??6,maxProgramTransactions=options.maxProgramTransactions??16,programLimit=options.programLimit??64;
  const maxElapsedMs=options.maxElapsedMs??70_000,maxResponseBytes=options.maxResponseBytes??12*1024*1024;
  need(Number.isSafeInteger(maxReads)&&maxReads>=1&&maxReads<=48&&Number.isSafeInteger(capacity)&&capacity>=1&&capacity<=48,'INVALID_SELECTION_BOUNDS');
  need(Number.isSafeInteger(maxCandidates)&&maxCandidates>=1&&maxCandidates<=6&&Number.isSafeInteger(maxProgramTransactions)&&maxProgramTransactions>=1&&maxProgramTransactions<=24&&Number.isSafeInteger(programLimit)&&programLimit>=1&&programLimit<=256,'INVALID_SELECTION_BOUNDS');
  need(Number.isSafeInteger(maxElapsedMs)&&maxElapsedMs>=1&&maxElapsedMs<=70_000&&Number.isSafeInteger(maxResponseBytes)&&maxResponseBytes>=2*1024*1024&&maxResponseBytes<=12*1024*1024,'INVALID_SELECTION_BOUNDS');
  const began=now(),initialBytes=options.responseBytes?.()??0;
  need(Number.isSafeInteger(initialBytes)&&initialBytes>=0,'INVALID_SELECTION_RESPONSE_COUNTER');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),maxElapsedMs);timer.unref?.();
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  const evidence:ActivityEvidence={selectionMethod:`Activity-biased transport test: one latest${programLimit}-signature PumpSwap-program page; up to${maxProgramTransactions} successful recent transactions systematically spread over that page; at most${maxCandidates} distinct canonical SOL pools checked once each. A saturated20-row history is skipped as capacity-unknown, never treated as a measured swap rate. No universe or strategy-performance claim.`,readsAttempted:0,maximumReads:maxReads,programRows:0,programTransactionsInspected:0,historyRows:0,historyWindowMs:60_000,historyWindowCovered:false,successfulAddressTransactions:0,activitySpanMs:0,addressTransactionsPerMinute:null,projected90sWithHeadroom:null,enrichmentCapacity:capacity,decodedRecentTransactions:0,decodedSwapEvents:0,sides:[],routes:[],rejections:[],transactions:[],history:[],selectedAt:null,maximumCandidates:maxCandidates,maximumProgramTransactions:maxProgramTransactions,maximumElapsedMs:maxElapsedMs,maximumResponseBytes:maxResponseBytes,responseBytes:0,responseByteAccounting:options.responseBytes?'transport':'decoded-result-estimate-offline-only',elapsedMs:0,candidateAttempts:[],priorRejectionSkips:[]};
  const record=(kind:string,data:unknown)=>options.record?.(kind,data);
  const checkBounds=()=>{
    evidence.elapsedMs=Math.max(0,now()-began);
    need(now()>=began,'PREFLIGHT_CLOCK_REGRESSION');
    if(controller.signal.aborted||evidence.elapsedMs>=maxElapsedMs)throw Error('PREFLIGHT_ELAPSED_CAP');
    if(options.signal?.aborted)throw Error('PREFLIGHT_ABORTED');
    if(options.responseBytes){const total=options.responseBytes();need(Number.isSafeInteger(total)&&total>=initialBytes+evidence.responseBytes,'INVALID_SELECTION_RESPONSE_COUNTER');evidence.responseBytes=total-initialBytes;}
    need(evidence.responseBytes<=maxResponseBytes,'PREFLIGHT_RESPONSE_BYTE_CAP');
  };
  const rpc:SelectionRpc={async call<T>(method:string,params:unknown[]=[],_signal?:AbortSignal){
    checkBounds();if(evidence.readsAttempted>=maxReads)throw Error('PREFLIGHT_READ_CAP');
    // The shared live client has a2MiB single-response ceiling. Leave that
    // complete reservation before a start; it also retains its own global
    // cancellation headroom. No post-hoc refund creates another attempt.
    if(evidence.responseBytes+2*1024*1024>maxResponseBytes)throw Error('PREFLIGHT_RESPONSE_BYTE_CAP');
    evidence.readsAttempted++;
    try{const requestSignal=_signal?AbortSignal.any([signal,_signal]):signal;const result=await options.rpc.call<T>(method,params,requestSignal);if(!options.responseBytes)evidence.responseBytes+=Buffer.byteLength(JSON.stringify(result)??'null');checkBounds();return result;}
    catch(error){if(options.responseBytes)evidence.responseBytes=options.responseBytes()-initialBytes;if(controller.signal.aborted)throw Error('PREFLIGHT_ELAPSED_CAP');if(options.signal?.aborted)throw Error('PREFLIGHT_ABORTED');throw error;}
  }};
  const cache=new Map<string,SelectionTransaction>();
  const transaction=async(row:SignatureRow)=>{
    const prior=cache.get(row.signature);
    if(prior){need(prior.transaction.slot===row.slot&&prior.transaction.blockTime===row.blockTime,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');return prior;}
    const requestedAt=now(),tx=await rpc.call<any>('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],signal),availableAt=now();
    need(tx&&tx.transaction?.signatures?.[0]===row.signature,'TRANSACTION_SIGNATURE_MISMATCH');
    need(tx.slot===row.slot&&tx.blockTime===row.blockTime,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');
    const value={signature:row.signature,requestedAt,availableAt,transaction:tx};cache.set(row.signature,value);evidence.transactions.push(value);record('selection-transaction',value);return value;
  };
  const mapped=(entry:SelectionTransaction,scope:CandidateScope)=>{
    const rows=mapConfirmedPumpSwapEvidence(entry.transaction,{...scope,signature:entry.signature,providerReceivedAt:null,availableAt:entry.availableAt});
    need(rows.every(t=>t.transferChecks.baseTransfer&&t.transferChecks.userQuoteTransfer),'UNVERIFIED_SCOPED_EXECUTED_TRANSFERS');
    return rows;
  };
  const terminal=(code:string)=>code.startsWith('PREFLIGHT_')||code.startsWith('RESEARCH_')||code.startsWith('SELECTION_REJECTIONS_')||code==='INVALID_SELECTION_RESPONSE_COUNTER'||code==='TRANSACTION_SIGNATURE_MISMATCH'||code==='TRANSACTION_HISTORY_CONTEXT_MISMATCH';
  const visited=new Set<string>(),guarded=new Set<string>();
  let lastRejection='NO_VERIFIED_CANONICAL_SOL_SWAP_IN_BOUNDED_PROGRAM_SAMPLE';
  try{
    checkBounds();
    const queriedAt=now(),programRows=signatureRows(await rpc.call('getSignaturesForAddress',[PROGRAM,{commitment:'confirmed',limit:programLimit}],signal),programLimit);evidence.programRows=programRows.length;record('selection-program-signatures',{queriedAt,availableAt:now(),rows:programRows});
    const recent=programRows.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime*1000>=queriedAt-60_000&&r.blockTime*1000<=queriedAt+2000);
    if(!recent.length)return {ok:false,reason:'NO_RECENT_SUCCESSFUL_PROGRAM_ACTIVITY',evidence};
    const n=Math.min(maxProgramTransactions,recent.length),sample=Array.from({length:n},(_,i)=>recent[n===1?0:Math.round(i*(recent.length-1)/(n-1))]!);
    for(const row of sample){
      checkBounds();
      const entry=await transaction(row);evidence.programTransactionsInspected++;
      let pools:CandidateScope[];try{pools=invokedCanonicalSolPools(entry.transaction);}catch(e){evidence.rejections.push({signature:row.signature,reason:reason(e)});continue;}
      if(!pools.length)evidence.rejections.push({signature:row.signature,reason:'NO_INVOKED_CANONICAL_SOL_POOL'});
      for(const scope of pools){
        if(visited.has(scope.pool)||guarded.has(scope.pool))continue;
        // A prior guard is checked before new pool history or support reads.
        // Expiry only permits this complete fresh pass; it never imports old
        // swaps, quotes or eligibility into the present observation window.
        const prior=options.rejectionStore?.lookup(scope,now());
        if(prior?.blocked){guarded.add(scope.pool);const skipped={scope,signature:row.signature,prior};evidence.priorRejectionSkips.push(skipped);record('selection-prior-rejection-skipped',skipped);continue;}
        if(visited.size>=maxCandidates)return {ok:false,reason:lastRejection,evidence};
        visited.add(scope.pool);
        const attempt={scope,signature:row.signature,reason:'IN_PROGRESS',readsAtStart:evidence.readsAttempted,readsAtEnd:evidence.readsAttempted,historyRows:0,historyWindowCovered:false,successfulAddressTransactions:0,projected90sWithHeadroom:null as number|null};
        evidence.candidateAttempts.push(attempt);
        Object.assign(evidence,{historyRows:0,historyWindowCovered:false,successfulAddressTransactions:0,activitySpanMs:0,addressTransactionsPerMinute:null,projected90sWithHeadroom:null,decodedRecentTransactions:0,decodedSwapEvents:0,sides:[],routes:[],history:[]});
        try{
          const firstTrades=mapped(entry,scope);need(firstTrades.length>0,'NO_VERIFIED_EXECUTED_SWAP');
          // One history, up to two additional verification transactions and
          // the existing conservative three-call support quote must fit before
          // spending a candidate's first history read. Later reads keep the
          // quote reservation; a complex/non-swap history cannot consume it.
          need(maxReads-evidence.readsAttempted>=6,'PREFLIGHT_SUPPORT_READ_RESERVE');
          const historyAt=now(),history=signatureRows(await rpc.call('getSignaturesForAddress',[scope.pool,{commitment:'confirmed',limit:20}],signal),20);evidence.history=history;evidence.historyRows=history.length;record('selection-pool-signatures',{scope,queriedAt:historyAt,availableAt:now(),rows:history});
          need(!history.some(r=>r.blockTime===null),'POOL_HISTORY_HAS_UNKNOWN_BLOCK_TIME');
          need(history.every((r,i)=>i===0||r.slot<=history[i-1]!.slot),'POOL_HISTORY_ORDER_UNVERIFIED');
          const boundary=historyAt-60_000;
          evidence.historyWindowCovered=history.some(r=>r.blockTime!*1000<boundary);
          need(evidence.historyWindowCovered,history.length===20?'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN':'POOL_ACTIVITY_BASELINE_TOO_SHORT');
          const successful=history.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime*1000>=boundary&&r.blockTime*1000<=historyAt+2000);
          evidence.successfulAddressTransactions=successful.length;
          const oldest=history.length?Math.min(...history.map(r=>r.blockTime!*1000)):historyAt;
          evidence.activitySpanMs=Math.min(60_000,Math.max(0,historyAt-oldest));
          need(evidence.activitySpanMs>=30_000,'POOL_ACTIVITY_BASELINE_TOO_SHORT');
          evidence.addressTransactionsPerMinute=successful.length*60_000/evidence.activitySpanMs;
          evidence.projected90sWithHeadroom=Math.ceil(successful.length*90_000/evidence.activitySpanMs*1.25);
          need(evidence.projected90sWithHeadroom<=capacity,'SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY');
          need(successful.length>=2,'INSUFFICIENT_RECENT_POOL_ACTIVITY');
          const eligibleSignatures=new Set(successful.map(r=>r.signature)),verified=new Map<string,MappedTradeEvidence[]>();
          for(const available of cache.values())if(eligibleSignatures.has(available.signature)){
            try{const trades=mapped(available,scope);if(trades.length)verified.set(available.signature,trades);}catch(e){evidence.rejections.push({signature:available.signature,reason:reason(e)});}
          }
          let added=0;
          for(const historyRow of successful){
            if(verified.size>=2||added>=4)break;
            if(cache.has(historyRow.signature))continue;
            need(maxReads-evidence.readsAttempted>=4,'PREFLIGHT_SUPPORT_READ_RESERVE');
            added++;const available=await transaction(historyRow);
            try{const trades=mapped(available,scope);if(trades.length)verified.set(historyRow.signature,trades);else evidence.rejections.push({signature:historyRow.signature,reason:'POOL_TOUCH_WITHOUT_VERIFIED_SWAP'});}catch(e){evidence.rejections.push({signature:historyRow.signature,reason:reason(e)});}
          }
          const trades=[...verified.values()].flat();evidence.decodedRecentTransactions=verified.size;evidence.decodedSwapEvents=trades.length;
          evidence.sides=[...new Set(trades.map(t=>t.side))];evidence.routes=[...new Set(trades.map(t=>t.identity.swapInnerInstructionIndex===null?'direct':'routed-CPI'))];
          need(verified.size>=2,'FEWER_THAN_TWO_VERIFIED_RECENT_SWAP_TRANSACTIONS');
          const latest=Math.max(...trades.map(t=>t.chainBlockTime===null?0:t.chainBlockTime*1000));
          need(now()-latest<=30_000,'VERIFIED_POOL_ACTIVITY_IS_NO_LONGER_CURRENT');
          const selectedFirst=trades.find(t=>t.identityKey===firstTrades[0]?.identityKey)??trades[0]!;
          const baseUnits=BigInt(selectedFirst.tokenUnits),minSlot=Math.max(...trades.map(t=>t.slot));
          const quote=options.quote??(async(r:SelectionRpc,s:CandidateScope,units:bigint,slot:number,abort?:AbortSignal)=>quotePositionSell(r as unknown as ReadOnlyRpc,new PublicKey(s.mint),units,{record},slot,abort));
          need(maxReads-evidence.readsAttempted>=3,'PREFLIGHT_SUPPORT_READ_RESERVE');
          const supportedQuote=await quote(rpc,scope,baseUnits,minSlot,signal);
          need(supportedQuote.mint===scope.mint&&supportedQuote.pool===scope.pool&&supportedQuote.sell.inputBaseUnits===baseUnits.toString(),'SUPPORTED_QUOTE_SCOPE_MISMATCH');
          need(Number.isFinite(Date.parse(supportedQuote.receivedAt))&&now()-Date.parse(supportedQuote.receivedAt)>=0&&now()-Date.parse(supportedQuote.receivedAt)<=2000,'SUPPORTED_QUOTE_STALE');
          need(now()-latest<=30_000,'VERIFIED_POOL_ACTIVITY_AGED_DURING_SUPPORT_CHECK');
          evidence.selectedAt=now();attempt.reason='SELECTED_CURRENT_SUPPORTED_POOL';
          return {ok:true,candidate:{...scope,baseUnits:baseUnits.toString(),minSlot,supportedQuote,supportedPoolEvidence:'current independently verified SDK pool/mint/vault/fee quote recorded by selection',quantitySelection:'Full base-unit amount of the first independently decoded selected swap; hypothetical holding only, not a PAPER position.',preflightTrades:trades,entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',migrationAgeVerified:false},evidence};
        }catch(e){
          lastRejection=reason(e);attempt.reason=lastRejection;evidence.rejections.push({signature:row.signature,reason:lastRejection});
          if(terminal(lastRejection))throw e;
          if(options.rejectionStore&&isPoolRejection(lastRejection)){
            const stored=options.rejectionStore.reject(scope,lastRejection,options.rejectionEvidenceRef??'selection-pass-record',now());record('selection-rejection-persisted',stored);
          }
        }finally{
          attempt.readsAtEnd=evidence.readsAttempted;attempt.historyRows=evidence.historyRows;attempt.historyWindowCovered=evidence.historyWindowCovered;attempt.successfulAddressTransactions=evidence.successfulAddressTransactions;attempt.projected90sWithHeadroom=evidence.projected90sWithHeadroom;
          record('selection-candidate-result',attempt);
        }
        if(visited.size>=maxCandidates)return {ok:false,reason:lastRejection,evidence};
      }
    }
    return {ok:false,reason:visited.size?lastRejection:guarded.size?'PRIOR_REJECTIONS_BLOCKED_OBSERVED_CANDIDATES':'NO_VERIFIED_CANONICAL_SOL_SWAP_IN_BOUNDED_PROGRAM_SAMPLE',evidence};
  }catch(e){return {ok:false,reason:reason(e),evidence};}
  finally{clearTimeout(timer);evidence.elapsedMs=Math.max(0,now()-began);if(options.responseBytes)evidence.responseBytes=options.responseBytes()-initialBytes;}
}
