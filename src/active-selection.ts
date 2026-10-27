/** Bounded, activity-biased research selection. No feed, financial or wallet API. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID} from './sdk.js';
import {quotePositionSell,type PositionSellQuote} from './pool.js';
import type {ReadOnlyRpc} from './network.js';
import {mapConfirmedPumpSwapEvidence,type MappedTradeEvidence} from './pumpapi-mapping.js';

const require=createRequire(import.meta.url);
const idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;
const coder=new BorshCoder(idl),PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58(),SOL='So11111111111111111111111111111111111111112';
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
};
export type ActiveCandidate={
  mint:string;pool:string;baseUnits:string;minSlot:number;supportedQuote:PositionSellQuote;
  supportedPoolEvidence:string;quantitySelection:string;preflightTrades:MappedTradeEvidence[];
  entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY';migrationAgeVerified:false;
};
export type ActiveSelectionResult={ok:true;candidate:ActiveCandidate;evidence:ActivityEvidence}|{ok:false;reason:string;evidence:ActivityEvidence};
type Options={rpc:SelectionRpc;now?:()=>number;signal?:AbortSignal;maxReads?:number;enrichmentCapacity?:number;record?:(kind:string,data:unknown)=>void;
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
export function invokedCanonicalSolPools(tx:any):CandidateScope[]{
  need(tx?.meta?.err===null&&['legacy',0,1].includes(tx.version),'UNSUCCESSFUL_OR_UNSUPPORTED_TRANSACTION');
  const message=tx.transaction?.message;
  need(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128,'UNVERIFIED_COMPILED_MESSAGE');
  const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  need(keys.length<=256&&keys.every(k=>typeof k==='string'),'UNVERIFIED_ACCOUNT_KEYS');
  const address=(n:unknown)=>{need(Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<keys.length,'INVALID_ACCOUNT_INDEX');return keys[Number(n)] as string;};
  const instructions=[...message.instructions];
  need(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128,'MISSING_INNER_INSTRUCTIONS');
  for(const group of tx.meta.innerInstructions){need(Array.isArray(group.instructions)&&group.instructions.length<=512,'UNVERIFIED_INNER_GROUP');instructions.push(...group.instructions);}
  const result=new Map<string,CandidateScope>();
  for(const ix of instructions){
    if(address(ix.programIdIndex)!==PROGRAM)continue;
    need(typeof ix.data==='string'&&ix.data.length<=4096&&Array.isArray(ix.accounts),'UNVERIFIED_SWAP_BYTES');
    let decoded;try{decoded=coder.instruction.decode(Buffer.from(bs58.decode(ix.data)));}catch{continue;}
    if(!decoded||!SWAPS.has(decoded.name))continue;
    const definition=idl.instructions.find(i=>i.name===decoded.name);need(definition,'UNKNOWN_SWAP_INSTRUCTION');
    const role=(name:string)=>{const i=definition.accounts.findIndex(a=>a.name===name);need(i>=0,'MISSING_SWAP_ROLE');return address(ix.accounts[i]);};
    const mint=role('base_mint'),pool=role('pool');
    if(role('quote_mint')!==SOL)continue;
    if(canonicalPumpPoolPda(new PublicKey(mint)).toBase58()!==pool)continue;
    result.set(pool,{mint,pool});
  }
  return [...result.values()];
}

/** One program page, <=8 systematic transaction reads, one selected pool's
 * <=20-row history, <=4 extra transaction reads and one three-call SDK quote.
 * Never opens a feed or retries. An unsuccessful gate is an explicit refusal.
 */
export async function selectActivePool(options:Options):Promise<ActiveSelectionResult>{
  const now=options.now??Date.now,maxReads=options.maxReads??24,capacity=options.enrichmentCapacity??48;
  need(Number.isSafeInteger(maxReads)&&maxReads>=1&&maxReads<=24&&Number.isSafeInteger(capacity)&&capacity>=1&&capacity<=48,'INVALID_SELECTION_BOUNDS');
  const evidence:ActivityEvidence={selectionMethod:'Activity-biased transport test: one latest32-signature PumpSwap-program page; up to8 successful recent transactions systematically spread over that page. First genuinely decoded canonical SOL pool is checked against one bounded pool-history page. No universe or strategy-performance claim.',readsAttempted:0,maximumReads:maxReads,programRows:0,programTransactionsInspected:0,historyRows:0,historyWindowMs:60_000,historyWindowCovered:false,successfulAddressTransactions:0,activitySpanMs:0,addressTransactionsPerMinute:null,projected90sWithHeadroom:null,enrichmentCapacity:capacity,decodedRecentTransactions:0,decodedSwapEvents:0,sides:[],routes:[],rejections:[],transactions:[],history:[],selectedAt:null};
  const record=(kind:string,data:unknown)=>options.record?.(kind,data);
  const rpc:SelectionRpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal){if(evidence.readsAttempted>=maxReads)throw Error('PREFLIGHT_READ_CAP');evidence.readsAttempted++;return options.rpc.call<T>(method,params,signal??options.signal);}};
  const cache=new Map<string,SelectionTransaction>();
  const transaction=async(row:SignatureRow)=>{
    const prior=cache.get(row.signature);if(prior)return prior;
    const requestedAt=now(),tx=await rpc.call<any>('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],options.signal),availableAt=now();
    need(tx&&tx.transaction?.signatures?.[0]===row.signature,'TRANSACTION_SIGNATURE_MISMATCH');
    need(tx.slot===row.slot&&tx.blockTime===row.blockTime,'TRANSACTION_HISTORY_CONTEXT_MISMATCH');
    const value={signature:row.signature,requestedAt,availableAt,transaction:tx};cache.set(row.signature,value);evidence.transactions.push(value);record('selection-transaction',value);return value;
  };
  const mapped=(entry:SelectionTransaction,scope:CandidateScope)=>{
    const rows=mapConfirmedPumpSwapEvidence(entry.transaction,{...scope,signature:entry.signature,providerReceivedAt:null,availableAt:entry.availableAt});
    need(rows.every(t=>t.transferChecks.baseTransfer&&t.transferChecks.userQuoteTransfer),'UNVERIFIED_SCOPED_EXECUTED_TRANSFERS');
    return rows;
  };
  try{
    const queriedAt=now(),programRows=signatureRows(await rpc.call('getSignaturesForAddress',[PROGRAM,{commitment:'confirmed',limit:32}],options.signal),32);evidence.programRows=programRows.length;record('selection-program-signatures',{queriedAt,availableAt:now(),rows:programRows});
    const recent=programRows.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime*1000>=queriedAt-60_000&&r.blockTime*1000<=queriedAt+2000);
    if(!recent.length)return {ok:false,reason:'NO_RECENT_SUCCESSFUL_PROGRAM_ACTIVITY',evidence};
    const n=Math.min(8,recent.length),sample=Array.from({length:n},(_,i)=>recent[n===1?0:Math.round(i*(recent.length-1)/(n-1))]!);
    let scope:CandidateScope|undefined,firstTrades:MappedTradeEvidence[]=[];
    for(const row of sample){
      const entry=await transaction(row);evidence.programTransactionsInspected++;
      let pools:CandidateScope[];try{pools=invokedCanonicalSolPools(entry.transaction);}catch(e){evidence.rejections.push({signature:row.signature,reason:reason(e)});continue;}
      for(const candidate of pools){
        try{const trades=mapped(entry,candidate);if(trades.length){scope=candidate;firstTrades=trades;break;}evidence.rejections.push({signature:row.signature,reason:'NO_VERIFIED_EXECUTED_SWAP'});}
        catch(e){evidence.rejections.push({signature:row.signature,reason:reason(e)});}
      }
      if(scope)break;
      if(!pools.length)evidence.rejections.push({signature:row.signature,reason:'NO_INVOKED_CANONICAL_SOL_POOL'});
    }
    if(!scope)return {ok:false,reason:'NO_VERIFIED_CANONICAL_SOL_SWAP_IN_BOUNDED_PROGRAM_SAMPLE',evidence};
    const historyAt=now(),history=signatureRows(await rpc.call('getSignaturesForAddress',[scope.pool,{commitment:'confirmed',limit:20}],options.signal),20);evidence.history=history;evidence.historyRows=history.length;record('selection-pool-signatures',{scope,queriedAt:historyAt,availableAt:now(),rows:history});
    if(history.some(r=>r.blockTime===null))return {ok:false,reason:'POOL_HISTORY_HAS_UNKNOWN_BLOCK_TIME',evidence};
    const boundary=historyAt-60_000;
    evidence.historyWindowCovered=history.some(r=>r.blockTime!*1000<boundary);
    if(!evidence.historyWindowCovered)return {ok:false,reason:history.length===20?'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN':'POOL_ACTIVITY_BASELINE_TOO_SHORT',evidence};
    const successful=history.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime*1000>=boundary&&r.blockTime*1000<=historyAt+2000);
    evidence.successfulAddressTransactions=successful.length;
    const oldest=history.length?Math.min(...history.map(r=>r.blockTime!*1000)):historyAt;
    evidence.activitySpanMs=Math.min(60_000,Math.max(0,historyAt-oldest));
    if(evidence.activitySpanMs<30_000)return {ok:false,reason:'POOL_ACTIVITY_BASELINE_TOO_SHORT',evidence};
    evidence.addressTransactionsPerMinute=successful.length*60_000/evidence.activitySpanMs;
    evidence.projected90sWithHeadroom=Math.ceil(successful.length*90_000/evidence.activitySpanMs*1.25);
    if(evidence.projected90sWithHeadroom>capacity)return {ok:false,reason:'SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY',evidence};
    if(successful.length<2)return {ok:false,reason:'INSUFFICIENT_RECENT_POOL_ACTIVITY',evidence};
    const eligibleSignatures=new Set(successful.map(r=>r.signature));
    const verified=new Map<string,MappedTradeEvidence[]>();
    for(const entry of cache.values())if(eligibleSignatures.has(entry.signature)){
      try{const trades=mapped(entry,scope);if(trades.length)verified.set(entry.signature,trades);}catch(e){evidence.rejections.push({signature:entry.signature,reason:reason(e)});}
    }
    let added=0;
    for(const row of successful){
      if(verified.size>=2||added>=4)break;
      if(cache.has(row.signature))continue;
      added++;const entry=await transaction(row);
      try{const trades=mapped(entry,scope);if(trades.length)verified.set(entry.signature,trades);else evidence.rejections.push({signature:row.signature,reason:'POOL_TOUCH_WITHOUT_VERIFIED_SWAP'});}catch(e){evidence.rejections.push({signature:row.signature,reason:reason(e)});}
    }
    const trades=[...verified.values()].flat();evidence.decodedRecentTransactions=verified.size;evidence.decodedSwapEvents=trades.length;
    evidence.sides=[...new Set(trades.map(t=>t.side))];evidence.routes=[...new Set(trades.map(t=>t.identity.swapInnerInstructionIndex===null?'direct':'routed-CPI'))];
    if(verified.size<2)return {ok:false,reason:'FEWER_THAN_TWO_VERIFIED_RECENT_SWAP_TRANSACTIONS',evidence};
    const latest=Math.max(...trades.map(t=>t.chainBlockTime===null?0:t.chainBlockTime*1000));
    if(now()-latest>30_000)return {ok:false,reason:'VERIFIED_POOL_ACTIVITY_IS_NO_LONGER_CURRENT',evidence};
    const selectedFirst=trades.find(t=>t.identityKey===firstTrades[0]?.identityKey)??trades[0]!;
    const baseUnits=BigInt(selectedFirst.tokenUnits),minSlot=Math.max(...trades.map(t=>t.slot));
    const quote=options.quote??(async(r:SelectionRpc,s:CandidateScope,units:bigint,slot:number,signal?:AbortSignal)=>quotePositionSell(r as unknown as ReadOnlyRpc,new PublicKey(s.mint),units,{record},slot,signal));
    const supportedQuote=await quote(rpc,scope,baseUnits,minSlot,options.signal);
    need(supportedQuote.mint===scope.mint&&supportedQuote.pool===scope.pool&&supportedQuote.sell.inputBaseUnits===baseUnits.toString(),'SUPPORTED_QUOTE_SCOPE_MISMATCH');
    need(Number.isFinite(Date.parse(supportedQuote.receivedAt))&&now()-Date.parse(supportedQuote.receivedAt)>=0&&now()-Date.parse(supportedQuote.receivedAt)<=2000,'SUPPORTED_QUOTE_STALE');
    // Activity may have gone stale while RPC/pricing was unavailable.
    if(now()-latest>30_000)return {ok:false,reason:'VERIFIED_POOL_ACTIVITY_AGED_DURING_SUPPORT_CHECK',evidence};
    evidence.selectedAt=now();
    return {ok:true,candidate:{...scope,baseUnits:baseUnits.toString(),minSlot,supportedQuote,supportedPoolEvidence:'current independently verified SDK pool/mint/vault/fee quote recorded by selection',quantitySelection:'Full base-unit amount of the first independently decoded selected swap; hypothetical holding only, not a PAPER position.',preflightTrades:trades,entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',migrationAgeVerified:false},evidence};
  }catch(e){return {ok:false,reason:reason(e),evidence};}
}
