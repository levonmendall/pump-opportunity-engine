/** Isolated PAPER-pilot composition. It owns no account, timer or financial
 * writer, and never constructs, signs or submits a blockchain transaction. */
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import type {ExecutionContext,QuoteRequest} from './execution.js';
import type {ExecutionQuote,Order,Position,UsdPrice} from './ledger.js';
import type {ReadOnlyRpc} from './network.js';
import {quotePool} from './pool.js';
import {ResearchClockPositionPricer,type ResearchClockBuyQuote} from './research-clock-pricing.js';
import {ResearchHeldMarket} from './research-held-market.js';
import type {PaperAccountPlan,VerifiedMarketPool} from './rpc-market.js';
import type {SizeQuote,SizeRequest} from './trader.js';

export type PilotRpc={call<T>(method:string,params?:unknown[],signal?:AbortSignal):Promise<T>;usage?:()=>unknown};
export type PilotInventory={positions:Readonly<Record<string,Position>>;pending:Readonly<Record<string,Order>>;lockedDeposits:Readonly<Record<string,string>>};
export type PilotEntryCosts={
  mint:string;depositLamports:string;evidence:string;at:number;
  accountPlan:PaperAccountPlan;
  accountModel:'per-mint-dedicated-base-and-WSOL-accounts-v1';
  accountLengths:{base:number;quote:number};
  rentLamportsByBytes:Record<string,string>;sourceSlot:number;
  /** Existing locked deposits are assets; they are neither charged nor refunded here. */
  lockedDepositLamports:string;
};
export type PilotSizeQuote=SizeQuote&{requiredDepositLamports?:string;depositEvidence?:string};
export type PilotExecutionQuote=ExecutionQuote&{requiredDepositLamports?:string;depositEvidence?:string;slot?:number};
export type PilotMarketOptions={
  rpc:PilotRpc;inventory:()=>PilotInventory;price:()=>UsdPrice|null;
  recorder:{record:(kind:string,data:unknown)=>void};
  gas:{baseFeeLamports:string;priorityFeeLamports:string;evidence:string};
  now?:()=>number;timeoutMs?:number;
  /** Runs only between entry-cost preparation reads, before another physical
   * request starts. Never called from an active trader decision/entry quote. */
  beforeEntryPreparationRead?:(input:{method:string;signal:AbortSignal})=>Promise<void>;
};
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
const integer=(value:string)=>{need(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value),'PILOT_MARKET_AMOUNT');return BigInt(value);};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MODEL='per-mint-dedicated-base-and-WSOL-accounts-v1' as const;
export const PILOT_ENTRY_QUOTE_FAILURE_PHASES=['admission','plan','pool-state','rent','freshness','evidence','post-evidence'] as const;
export const PILOT_ENTRY_QUOTE_FAILURE_CODES=['ENTRY_QUOTE_BUSY','ENTRY_QUOTE_CALLER_ABORTED','ENTRY_QUOTE_TIMEOUT','ENTRY_QUOTE_UNKNOWN',
 'PILOT_MARKET_ENTRY_COSTS_UNAVAILABLE','PILOT_MARKET_ENTRY_POOL_REQUIRED','PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH','PILOT_MARKET_RENT_UNAVAILABLE','PILOT_MARKET_ACCOUNT_LENGTH','PILOT_MARKET_PREPARATION_CHANGED_OR_STALE','PILOT_MARKET_ENTRY_STATE_CHANGED',
 'PILOT_RPC_ABORTED','PILOT_RPC_COOLDOWN','PILOT_RPC_PHYSICAL_SLOT_OCCUPIED','PILOT_RPC_METHOD_PACING','PILOT_RPC_LOWER_PRIORITY_DEFER','PILOT_RPC_COMPONENT_ADMISSION_CLOSED','PILOT_RPC_COMPONENT_DISPATCH_EXPIRED','PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT','PILOT_RPC_COMPONENT_ABORTED','PILOT_RPC_COMPONENT_HTTP_TRANSPORT','PILOT_RPC_COMPONENT_HTTP_429','PILOT_RPC_COMPONENT_HTTP_STATUS_502','PILOT_RPC_COMPONENT_HTTP_STATUS_503','PILOT_RPC_COMPONENT_HTTP_STATUS_504','RESEARCH_CLOCK_POOL_UNAVAILABLE','RESEARCH_CLOCK_ADMISSION_CLOSED'] as const;
type EntryQuotePhase=typeof PILOT_ENTRY_QUOTE_FAILURE_PHASES[number];
type EntryQuoteAttempt={mint:string;phase:EntryQuotePhase;began:number;recorded:boolean;caller:AbortSignal;deadline:AbortSignal};
type EntryQuoteFailure={at:number;mint:string|null;phase:EntryQuotePhase;reasonCode:typeof PILOT_ENTRY_QUOTE_FAILURE_CODES[number];elapsedMs:number;callerAborted:boolean;deadlineAborted:boolean;unknownErrorSha256:string|null};

/** Dedicated simulated token-account pairs deliberately over-reserve compared
 * with sharing a WSOL account. Each mint's rent is locked exactly once in the
 * ledger. No ATA is claimed to exist on chain and no deposit refund is invented.
 */
export class PilotMarket {
  private readonly pools=new Map<string,VerifiedMarketPool>();
  private readonly plans=new Map<string,PilotEntryCosts>();
  private readonly floors=new Map<string,number>();
  private readonly entrySnapshots=new Map<string,PilotSizeQuote>();
  private readonly pricer:ResearchClockPositionPricer;
  private readonly holdingPricer:ResearchClockPositionPricer;
  private readonly preparationRpc:PilotRpc;
  private readonly held:ResearchHeldMarket;
  private readonly now:()=>number;
  private generation=0;
  private active=false;
  private holdingActive=false;
  private preparing=false;
  private protectionYield=false;
  private prepared=0;
  private entryEstimates=0;
  private entryAttempts=0;
  private readonly entryQuoteFailures:{count:number;last:EntryQuoteFailure|null}={count:0,last:null};
  readonly gasLamports:string;
  constructor(private readonly options:PilotMarketOptions){
    this.options={...options,gas:Object.freeze({...options.gas})};
    this.now=options.now??Date.now;
    this.gasLamports=(integer(options.gas.baseFeeLamports)+integer(options.gas.priorityFeeLamports)).toString();
    need(integer(this.gasLamports)>0n&&typeof options.gas.evidence==='string'&&options.gas.evidence.length>0,'PILOT_MARKET_GAS_REQUIRED');
    need(Number.isSafeInteger(options.timeoutMs??3000)&&(options.timeoutMs??3000)>0&&(options.timeoutMs??3000)<=3000,'PILOT_MARKET_BOUNDED_TIMEOUT_REQUIRED');
    this.preparationRpc={call:async<T>(method:string,params:unknown[]=[],signal?:AbortSignal)=>{
      signal?.throwIfAborted();
      if(this.preparing&&this.options.beforeEntryPreparationRead){
        need(signal,'PILOT_MARKET_PREPARATION_SIGNAL_REQUIRED');
        this.protectionYield=true;
        try{await this.options.beforeEntryPreparationRead({method,signal});}
        finally{this.protectionYield=false;}
        signal.throwIfAborted();
      }
      return options.rpc.call<T>(method,params,signal);
    }};
    this.pricer=new ResearchClockPositionPricer(this.preparationRpc,options.recorder);
    // Discretionary reads cannot retain the held pricer's busy lock or raise
    // its global slot floor through an unrelated candidate. Every holding
    // still preserves its own known slot and fresh complete union/Clock read.
    this.holdingPricer=new ResearchClockPositionPricer(options.rpc,options.recorder);
    this.held=new ResearchHeldMarket({pricer:this.holdingPricer,inventory:options.inventory,gasLamports:this.gasLamports,gasEvidence:options.gas.evidence,recorder:options.recorder,now:this.now,usd:options.price,entryQuote:(request,signal)=>this.entryQuote(request,signal)});
  }
  registerPool(pool:VerifiedMarketPool){
    this.held.registerPool(pool);
    this.pools.set(pool.mint,Object.freeze({...pool}));
  }
  /** A timeout does not prove physical settlement. Retire replaceable pool
   * state only after every earlier market continuation actually releases it. */
  retirementReady(){return !this.active&&!this.holdingActive;}
  /** Release only a retired, unowned pool's replaceable market state. Locked
   * deposits and the caller's durable origin/financial history are preserved. */
  unregisterPool(mint:string){
    need(!this.active&&!this.holdingActive,'PILOT_MARKET_READ_IN_FLIGHT');
    const removed=this.held.unregisterPool(mint);if(!removed)return false;
    this.generation++;this.pools.delete(mint);this.plans.delete(mint);this.floors.delete(mint);this.entrySnapshots.delete(mint);return true;
  }
  minimumSlot(mint:string,slot:number){this.held.minimumSlot(mint,slot);this.floors.set(mint,Math.max(this.floors.get(mint)??0,slot));}
  invalidate(reason:string){this.generation++;this.plans.clear();this.entrySnapshots.clear();this.pricer.invalidate(reason);this.held.invalidate(reason);}
  private clock(){const at=this.now();need(Number.isSafeInteger(at)&&at>=0,'PILOT_MARKET_CLOCK');return at;}
  private locked(mint:string){const value=this.options.inventory().lockedDeposits[mint]??'0';integer(value);return value;}
  private freshPlan(mint:string){
    const plan=this.plans.get(mint),at=this.clock();
    // This is a sizing expectation, not cached rent authority. RpcMarket reads
    // current lengths/rent again for every actual buy and rejects any mismatch.
    need(plan&&plan.at<=at&&plan.lockedDepositLamports===this.locked(mint),'PILOT_MARKET_ENTRY_COSTS_UNAVAILABLE');
    return plan!;
  }
  private floor(mint:string,min=0){return Math.max(min,this.floors.get(mint)??0,this.pools.get(mint)?.migrationSlot??0);}
  /** Candidate observation needs current supported pool evidence, not simulated
   * account-creation rent. Use the unchanged state decoder/SDK checks, but leave
   * financial entry plans absent; any future entry must prepare its own costs. */
  async validateObservationPool(mint:string,signal:AbortSignal):Promise<{mint:string;evidence:string;at:number;sourceSlot:number}>{
    need(!this.active&&!this.holdingActive&&!signal.aborted&&this.pools.has(mint),'PILOT_MARKET_PREPARATION_UNAVAILABLE');
    this.active=true;const generation=this.generation;
    try{
      const state=await quotePool(this.options.rpc as ReadOnlyRpc,new PublicKey(mint),10000000n,this.options.recorder,this.floor(mint),signal);
      const lengths={base:state.baseAssociatedAccount.accountLengthBytes,quote:state.quoteAssociatedAccount.accountLengthBytes};
      for(const bytes of Object.values(lengths))need(Number.isSafeInteger(bytes)&&bytes>=165&&bytes<=10240,'PILOT_MARKET_ACCOUNT_LENGTH');
      const received=Date.parse(state.receivedAt);
      const fresh=()=>{signal.throwIfAborted();const at=this.clock();need(generation===this.generation&&state.slot>=this.floor(mint)&&received<=at&&at-received<=2000&&state.marketBlockTime*1000<=at&&at-state.marketBlockTime*1000<=30000,'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');return at;};
      const at=fresh(),evidence='pilot-observation-support:'+hash({mint,at,state,poolEvidence:this.pools.get(mint)!.evidence});
      this.options.recorder.record('pilot-observation-support-validation',{mint,evidence,at,sourceSlot:state.slot,requestedAt:state.requestedAt,receivedAt:state.receivedAt,marketBlockTime:state.marketBlockTime,accountLengths:lengths,requests:3,classification:'current supported state/SDK validation only; no rent reads or financial entry plan'});
      fresh();this.minimumSlot(mint,state.slot);
      return {mint,evidence,at,sourceSlot:state.slot};
    }finally{this.active=false;}
  }

  /** Preparation is not an entry estimate or fill. Current supported SDK state
   * establishes account lengths (including Token2022 ImmutableOwner), then
   * current rent is read once per distinct required length. Every call counts.
   */
  async prepareEntryCosts(mint:string,signal:AbortSignal,options?:{maximumMs:number}):Promise<PilotEntryCosts>{
    need(!this.active&&!this.holdingActive&&!signal.aborted&&this.pools.has(mint),'PILOT_MARKET_PREPARATION_UNAVAILABLE');
    const maximumMs=options?.maximumMs??this.options.timeoutMs??3000;
    need(Number.isSafeInteger(maximumMs)&&maximumMs>0&&maximumMs<=3000,'PILOT_MARKET_PREPARATION_BOUND_REQUIRED');
    this.active=true;this.preparing=true;const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const operation=this.prepareEntryCostsOperation(mint,combined).finally(()=>{this.active=false;this.preparing=false;});
    let timer:ReturnType<typeof setTimeout>|undefined,listener:(()=>void)|undefined;
    try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{
      listener=()=>reject(Error('PILOT_MARKET_PREPARATION_ABORTED'));combined.addEventListener('abort',listener,{once:true});
      timer=setTimeout(()=>controller.abort(),maximumMs);if(combined.aborted)listener();
    })]);}
    finally{clearTimeout(timer);if(listener)combined.removeEventListener('abort',listener);controller.abort();}
  }
  private async prepareEntryCostsOperation(mint:string,signal:AbortSignal):Promise<PilotEntryCosts>{
    const generation=this.generation;
    try{
      const supported=await this.pricer.validateMany([{mint:new PublicKey(mint),minSlot:this.floor(mint)}],signal),support=supported.validations[mint];
      need(support,'PILOT_MARKET_ENTRY_SUPPORT_UNAVAILABLE');const state=support.summary;
      const lengths={base:state.baseAssociatedAccount.accountLengthBytes,quote:state.quoteAssociatedAccount.accountLengthBytes};
      for(const bytes of Object.values(lengths))need(Number.isSafeInteger(bytes)&&bytes>=165&&bytes<=10240,'PILOT_MARKET_ACCOUNT_LENGTH');
      const locked=this.locked(mint),exists=integer(locked)>0n,rents:Record<string,string>={};let deposit=0n;
      if(!exists)for(const bytes of Object.values(lengths)){
        if(rents[bytes]===undefined){const rent=await this.preparationRpc.call<number>('getMinimumBalanceForRentExemption',[bytes,{commitment:'confirmed'}],signal);need(Number.isSafeInteger(rent)&&rent>0,'PILOT_MARKET_RENT_UNAVAILABLE');rents[bytes]=BigInt(rent).toString();}
        deposit+=integer(rents[bytes]!);
      }
      signal.throwIfAborted();const at=this.clock();this.freshClock(state,mint,signal);
      need(generation===this.generation&&locked===this.locked(mint),'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');
      const body={mint,depositLamports:deposit.toString(),at,accountModel:MODEL,accountLengths:lengths,rentLamportsByBytes:rents,sourceSlot:state.slot,lockedDepositLamports:locked};
      const evidence='pilot-entry-costs:'+hash({...body,poolEvidence:this.pools.get(mint)!.evidence,gas:this.options.gas});
      const plan:PilotEntryCosts={...body,evidence,accountPlan:{baseExists:exists,quoteExists:exists,at,evidence}};
      this.options.recorder.record('pilot-entry-cost-preparation',{...plan,classification:'simulated account inventory; actual read-only rent and supported account lengths',requests:'One current coherent Clock/state batch plus cold dependency discovery if needed, and one rent read per distinct missing-account length; every physical request uses the shared RPC budget.',depositRefund:'Not assumed; retained locked capital after exit.'});
      need(this.clock()-at<=10000&&generation===this.generation&&locked===this.locked(mint),'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');
      this.minimumSlot(mint,state.slot);this.plans.set(mint,structuredClone(plan));this.prepared++;
      return structuredClone(plan);
    }finally{/* Physical ownership is released by the complete operation above. */}
  }
  /** Keep Clock provenance explicit; a received source keeps its original
   * timestamp after rent reads, validation and recorder callbacks. */
  private freshClock(state:Pick<ResearchClockBuyQuote,'slot'|'requestedAt'|'receivedAt'|'validatedAt'|'commitment'|'timeEvidence'|'clockSlot'|'marketClockUnixSeconds'>,mint:string,signal:AbortSignal){
    signal.throwIfAborted();const at=this.clock(),requested=Date.parse(state.requestedAt),received=Date.parse(state.receivedAt),validated=Date.parse(state.validatedAt);
    need(state.commitment==='confirmed'&&state.timeEvidence==='confirmed-bank-clock'&&state.clockSlot===state.slot&&Number.isSafeInteger(state.slot)&&state.slot>=this.floor(mint)&&Number.isSafeInteger(requested)&&Number.isSafeInteger(received)&&Number.isSafeInteger(validated)&&requested<=received&&received<=validated&&validated<=at&&received<=at&&at-received<=2000&&Number.isSafeInteger(state.marketClockUnixSeconds)&&state.marketClockUnixSeconds*1000<=at&&at-state.marketClockUnixSeconds*1000<=30000,'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');
    return received;
  }
  private async entryQuote(request:SizeRequest,signal:AbortSignal):Promise<PilotSizeQuote|null>{
    const controller=new AbortController(),attempt:EntryQuoteAttempt={mint:request.mint,phase:'admission',began:performance.now(),recorded:false,caller:signal,deadline:controller.signal};
    if(this.active||this.holdingActive||signal.aborted){this.entryQuoteFailure(attempt,Error('ENTRY_QUOTE_BUSY'));return null;}
    this.active=true;const generation=this.generation,combined=AbortSignal.any([signal,controller.signal]);
    const operation=this.readEntryQuote(request,combined,generation,attempt);void operation.then(()=>{this.active=false;},()=>{this.active=false;});
    let timer:ReturnType<typeof setTimeout>|undefined,listener:(()=>void)|undefined;
    try{return await Promise.race([operation,new Promise<null>(resolve=>{listener=()=>{this.entryQuoteFailure(attempt,combined.reason);resolve(null);};combined.addEventListener('abort',listener,{once:true});timer=setTimeout(()=>controller.abort(),this.options.timeoutMs??3000);if(combined.aborted)listener();})]);}
    finally{clearTimeout(timer);if(listener)combined.removeEventListener('abort',listener);controller.abort();}
  }
  private entryQuoteFailure(attempt:EntryQuoteAttempt,error:unknown){
    if(attempt.recorded)return;attempt.recorded=true;
    const message=error instanceof Error?error.message:'',code=attempt.caller.aborted?'ENTRY_QUOTE_CALLER_ABORTED':attempt.deadline.aborted?'ENTRY_QUOTE_TIMEOUT':PILOT_ENTRY_QUOTE_FAILURE_CODES.find(c=>c===message)??'ENTRY_QUOTE_UNKNOWN';
    let mint:string|null=null;try{if(attempt.mint.length<=44&&new PublicKey(attempt.mint).toBase58()===attempt.mint)mint=attempt.mint;}catch{/* Invalid identifiers never enter retained diagnostics. */}
    const fact:EntryQuoteFailure={at:this.clock(),mint,phase:attempt.phase,reasonCode:code,elapsedMs:Math.max(0,performance.now()-attempt.began),callerAborted:attempt.caller.aborted,deadlineAborted:attempt.deadline.aborted,unknownErrorSha256:code==='ENTRY_QUOTE_UNKNOWN'?hash(message.slice(0,4096)):null};
    this.entryQuoteFailures.count++;this.entryQuoteFailures.last=fact;
    // Bounded diagnostic only. Its absence never makes a quote usable or a
    // candidate qualified; normal financial decision evidence remains required.
    try{this.options.recorder.record('pilot-entry-quote-unavailable',{...fact,executableQualification:false,orderCreated:false});}catch{/* Quote remains unavailable; the source recorder owns its integrity handling. */}
  }
  private async readEntryQuote(request:SizeRequest,signal:AbortSignal,generation:number,attempt:EntryQuoteAttempt):Promise<PilotSizeQuote|null>{
    try{
      attempt.phase='plan';
      const plan=this.freshPlan(request.mint),pool=this.pools.get(request.mint);need(pool&&request.side==='buy','PILOT_MARKET_ENTRY_POOL_REQUIRED');
      const expected=(request as SizeRequest&{requiredDepositLamports?:string}).requiredDepositLamports;
      need(expected===undefined||expected===plan.depositLamports,'PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH');
      const input={mint:request.mint,side:'buy' as const,inputUnits:request.inputUnits,minSlot:this.floor(request.mint,request.minSlot??0)};
      // Read current rent against the independently validated preparation
      // lengths before acquiring the final executable market state. Ancillary
      // pacing must not repeatedly age a healthy market quote while native
      // executed trades advance its mandatory slot floor.
      attempt.phase='rent';const accountPlan={...plan.accountPlan,at:this.clock()},rents:Record<string,string>={};let required=0n;
      for(const [exists,bytes]of [[accountPlan.baseExists,plan.accountLengths.base],[accountPlan.quoteExists,plan.accountLengths.quote]]as const){
        if(exists)continue;need(Number.isSafeInteger(bytes)&&bytes>=165&&bytes<=10240,'PILOT_MARKET_ACCOUNT_LENGTH');
        if(rents[bytes]===undefined){const rent=await this.options.rpc.call<number>('getMinimumBalanceForRentExemption',[bytes,{commitment:'confirmed'}],signal);need(Number.isSafeInteger(rent)&&rent>0,'PILOT_MARKET_RENT_UNAVAILABLE');rents[bytes]=BigInt(rent).toString();}
        required+=integer(rents[bytes]!);
      }
      need(required.toString()===plan.depositLamports&&this.clock()-accountPlan.at<=10000,'PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH');
      input.minSlot=this.floor(input.mint,input.minSlot);
      attempt.phase='pool-state';const state=await this.pricer.quoteBuy({mint:new PublicKey(input.mint),buyLamports:integer(input.inputUnits),minSlot:input.minSlot},signal);
      need(state.baseAssociatedAccount.accountLengthBytes===plan.accountLengths.base&&state.quoteAssociatedAccount.accountLengthBytes===plan.accountLengths.quote,'PILOT_MARKET_ACCOUNT_LENGTH');
      need(this.clock()-accountPlan.at<=10000,'PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH');
      attempt.phase='freshness';const at=this.freshClock(state,input.mint,signal);need(generation===this.generation&&this.freshPlan(input.mint).evidence===plan.evidence&&state.slot>=this.floor(input.mint,input.minSlot),'PILOT_MARKET_ENTRY_STATE_CHANGED');
      const costs={depositLamports:required.toString(),plan:accountPlan,rents,gas:this.options.gas,gasLamports:this.gasLamports,classification:'simulated' as const};
      const evidence='rpc-market:'+hash({request:input,state,costs,gas:this.options.gas,migrationEvidence:pool.evidence});
      const q:PilotSizeQuote={...input,outputUnits:state.buy.outputBaseUnits,at,evidence,slot:state.slot,effectiveQuoteLiquidityLamports:state.effectiveQuoteReserve,requiredDepositLamports:plan.depositLamports,depositEvidence:'pilot-entry-validated-costs:'+hash({preparation:plan.evidence,quote:evidence,deposit:plan.depositLamports})};
      attempt.phase='evidence';this.options.recorder.record('rpc-market-quote',{request:input,quote:q,source:{slot:state.slot,commitment:state.commitment,requestedAt:state.requestedAt,receivedAt:state.receivedAt,validatedAt:state.validatedAt,timeEvidence:state.timeEvidence,clockSlot:state.clockSlot,marketClockUnixSeconds:state.marketClockUnixSeconds,migrationSlot:pool.migrationSlot},costs});
      attempt.phase='post-evidence';
      this.freshClock(state,input.mint,signal);need(generation===this.generation&&this.freshPlan(input.mint).evidence===plan.evidence&&state.slot>=this.floor(input.mint,input.minSlot),'PILOT_MARKET_ENTRY_STATE_CHANGED');
      this.minimumSlot(input.mint,state.slot);this.entryEstimates++;
      this.entrySnapshots.set(input.mint,structuredClone(q));return q;
    }catch(error){this.entryQuoteFailure(attempt,error);return null;}
  }
  readonly context=async(positions:Readonly<Record<string,Position>>,signal:AbortSignal):Promise<ExecutionContext>=>{
    if(this.holdingActive||this.active&&!this.protectionYield||signal.aborted)return {price:null,marks:{}};
    this.holdingActive=true;
    try{return await this.held.context(positions,signal);}
    finally{this.holdingActive=false;}
  };
  readonly quote=(request:SizeRequest,signal:AbortSignal):Promise<PilotSizeQuote|null>=>this.held.quote(request,signal);
  readonly executionQuote=async(request:QuoteRequest&{minSlot?:number},signal:AbortSignal):Promise<PilotExecutionQuote|null>=>{
    const order=request.order;
    try{
      if(request.minSlot!==undefined)this.minimumSlot(order.mint,request.minSlot);
      if(order.side==='buy'){this.entrySnapshots.delete(order.mint);need(this.freshPlan(order.mint).depositLamports===order.deposit,'PILOT_MARKET_RESERVED_DEPOSIT_MISMATCH');}
      const q=await this.held.executionQuote(request,signal);if(!q)return null;
      const at=this.clock(),pending=this.options.inventory().pending[order.id];
      need(!signal.aborted&&pending&&JSON.stringify(pending)===JSON.stringify(order)&&q.at>=Math.max(order.executeAt,request.attemptedAt)&&q.at<=at&&at-q.at<=2000&&at<order.expiresAt,'PILOT_MARKET_EXECUTION_CHANGED_OR_STALE');
      if(order.side==='sell')return q;
      const plan=this.freshPlan(order.mint),entry=this.entrySnapshots.get(order.mint);need(plan.depositLamports===order.deposit,'PILOT_MARKET_RESERVED_DEPOSIT_MISMATCH');
      need(entry&&entry.evidence===q.evidence&&entry.at===q.at&&entry.outputUnits===q.receiveUnits&&entry.slot!==undefined&&entry.slot>=this.floor(order.mint,request.minSlot??0),'PILOT_MARKET_EXECUTION_SOURCE_REQUIRED');this.entryAttempts++;
      return {...q,slot:entry.slot,requiredDepositLamports:plan.depositLamports,depositEvidence:'pilot-execution-validated-costs:'+hash({preparation:plan.evidence,quote:q.evidence,deposit:plan.depositLamports})};
    }catch{return null;}
  };
  usage(){return {classification:'isolated PAPER pilot only',registeredPools:this.pools.size,preparedEntryCostPlans:this.prepared,entryQuoteCalls:this.entryEstimates,entryExecutionQuotes:this.entryAttempts,entryQuoteFailures:structuredClone(this.entryQuoteFailures),held:this.holdingPricer.usage(),holdingDiagnostics:this.held.usage(),entryPricing:this.pricer.usage(),rpc:this.options.rpc.usage?.()??null,accountModel:MODEL,depositRefundsAssumed:false};}
}
