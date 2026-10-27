/** One fixed-subject preparation pass. It never opens a stream or searches for
 * another pool. Current account support is checked separately by full prewarm. */
import {invokedCanonicalSolSwaps} from './active-selection.js';
import {mapConfirmedPumpSwapEvidence} from './pumpapi-mapping.js';
export type ForwardScope={mint:string;pool:string;baseUnits:string;minSlot:number;supportedPoolEvidence:string};
type Rpc={call<T>(method:string,params:unknown[],signal?:AbortSignal):Promise<T>};
function need(ok:unknown,code:string):asserts ok {if(!ok)throw Error(code);}
export async function preflightSchedulerForward(input:{scope:ForwardScope;rpc:Rpc;record:(kind:string,data:unknown)=>void;signal:AbortSignal;now?:()=>number}){
  const now=input.now??Date.now,startedAt=now(),{scope,rpc,record,signal}=input;
  const history=await rpc.call<any[]>('getSignaturesForAddress',[scope.pool,{limit:50,commitment:'confirmed'}],signal),historyAvailableAt=now();
  record('forward-preflight-history',{pool:scope.pool,historyAvailableAt,history});
  need(Array.isArray(history)&&history.length>0&&history.length<=50,'FORWARD_PREFLIGHT_NO_USABLE_HISTORY');
  need(history.every((r,i)=>typeof r.signature==='string'&&Number.isSafeInteger(r.slot)&&r.slot>=0&&Object.hasOwn(r,'err')&&(r.err===null||typeof r.err==='object')&&Number.isSafeInteger(r.blockTime)&&r.blockTime>0&&r.blockTime*1000<=historyAvailableAt&&(i===0||r.slot<=history[i-1]!.slot)),'FORWARD_PREFLIGHT_HISTORY_TIME_UNKNOWN');
  need(new Set(history.map(r=>r.signature)).size===history.length,'FORWARD_PREFLIGHT_DUPLICATE_HISTORY');
  const oldestAt=Math.min(...history.map(r=>r.blockTime*1000)),spanMs=historyAvailableAt-oldestAt;
  need(spanMs>=75000,'FORWARD_PREFLIGHT_CAPACITY_INTERVAL_UNKNOWN');
  // All pool-address transactions are an explicitly conservative demand bound,
  // not asserted swaps. Only the following confirmed decoder proves swaps.
  const inWindow=history.filter(r=>r.blockTime*1000>=historyAvailableAt-75000);
  need(inWindow.length<=10,'FORWARD_PREFLIGHT_EXPECTED_ENRICHMENT_EXCEEDS10');
  const candidates=history.filter(r=>r.err===null&&historyAvailableAt-r.blockTime*1000<=30000).slice(0,2);
  need(candidates.length>0,'FORWARD_PREFLIGHT_NO_RECENT_SUCCESS');
  const checked=[];
  for(const row of candidates){
    signal.throwIfAborted();const requestedAt=now();
    const transaction=await rpc.call<any>('getTransaction',[row.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}],signal),availableAt=now();
    record('forward-preflight-transaction',{signature:row.signature,requestedAt,availableAt,transaction});
    need(transaction&&transaction.slot===row.slot&&transaction.blockTime===row.blockTime&&transaction.transaction?.signatures?.[0]===row.signature,'FORWARD_PREFLIGHT_TRANSACTION_CONTEXT_UNKNOWN');
    need(transaction.meta?.err===null,'FORWARD_PREFLIGHT_TRANSACTION_UNSUCCESSFUL');
    const compiled=invokedCanonicalSolSwaps(transaction).filter(x=>x.pool===scope.pool&&x.mint===scope.mint).length;
    checked.push({signature:row.signature,compiledSelectedSwaps:compiled});if(!compiled)continue;
    const mapped=mapConfirmedPumpSwapEvidence(transaction,{...scope,signature:row.signature,providerReceivedAt:null,availableAt});
    need(mapped.length===compiled&&mapped.every(t=>t.transferChecks.baseTransfer&&t.transferChecks.userQuoteTransfer),'FORWARD_PREFLIGHT_SWAP_EVIDENCE_UNSUPPORTED');
    need(now()-transaction.blockTime*1000<=30000,'FORWARD_PREFLIGHT_SWAP_NO_LONGER_RECENT');
    const result={startedAt,completedAt:now(),scope:{...scope,minSlot:transaction.slot},verifiedSwap:{signature:row.signature,slot:transaction.slot,blockTime:transaction.blockTime,trades:mapped},history:{historyAvailableAt,oldestAt,spanMs,poolAddressTransactionsLast75s:inWindow.length,expectedEnrichmentUpperBound:inWindow.length,maximumAllowedEnrichments:10,projectionOnly:true,swapsNotInferredFromAddressCounts:true},checked,currentPoolAccounts:'REQUIRES_FRESH_PREWARM',entryEligibility:'PUMP_ORIGIN_AND_ENTRY_AGE_UNVERIFIED; no entry permitted'};
    need(now()-startedAt<5000,'FORWARD_PREFLIGHT_ELAPSED_CAP');record('forward-preflight-passed',result);need(now()-startedAt<5000,'FORWARD_PREFLIGHT_ELAPSED_CAP');return result;
  }
  throw Error('FORWARD_PREFLIGHT_NO_SUPPORTED_RECENT_SWAP_IN_TWO_CHECKS');
}
