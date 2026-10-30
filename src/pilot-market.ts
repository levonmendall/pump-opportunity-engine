/** Isolated PAPER-pilot composition. It owns no account, timer or financial
 * writer, and never constructs, signs or submits a blockchain transaction. */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {buildPaperUnsignedPumpSwap,type PaperUnsignedConstruction} from './paper-unsigned-pumpswap.js';
import {PAPER_EXECUTION_MODEL_VERSION,PAPER_EXECUTION_POLICY,PAPER_EXECUTION_POLICY_SHA256,planPaperExecution,paperExecutionFee,paperExecutionPlanSha256,validatePaperExecutionLanding,type PaperExecutionPlan,type PaperExecutionLanding,type PaperProtectionExecutionFallback} from './execution-realism.js';
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
  accountModel:'per-mint-dedicated-base-and-WSOL-accounts-v1'|'persistent-base-transient-shared-wsol-v2';
  temporaryQuoteRentLamports?:string;
  accountLengths:{base:number;quote:number};
  rentLamportsByBytes:Record<string,string>;sourceSlot:number;
  /** Existing locked deposits are assets; they are neither charged nor refunded here. */
  lockedDepositLamports:string;
};
export type PilotSizeQuote=SizeQuote&{requiredDepositLamports?:string;depositEvidence?:string};
export type PilotExecutionQuote=ExecutionQuote&{requiredDepositLamports?:string;depositEvidence?:string;slot?:number;executionModel?:PaperExecutionLanding};
export type PilotMarketOptions={
  rpc:PilotRpc;inventory:()=>PilotInventory;price:()=>UsdPrice|null;
  recorder:{record:(kind:string,data:unknown)=>void};
  gas:{baseFeeLamports:string;priorityFeeLamports:string;evidence:string};
  now?:()=>number;timeoutMs?:number;
  /** Explicit persistent-service opt-in; legacy historical orders remain unchanged. */
  executionRealism?:true;
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
 'PAPER_EXECUTION_QUOTE_RENT_UNAVAILABLE','PAPER_EXECUTION_POOL_EXTENSION_RENT_UNAVAILABLE','PAPER_EXECUTION_CONSTRUCTION_STALE','PAPER_EXECUTION_ORIGINAL_BATCH_REQUIRED','PAPER_EXECUTION_SIMULATED_ACCOUNT_PLAN_REQUIRED',
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
  private readonly constructions=new Map<string,{quote:PilotSizeQuote;construction:PaperUnsignedConstruction;constructionMs:number}>();
  private quoteRentSnapshot:{lamports:string;at:number}|null=null;
  private readonly quoteRentsByEvidence=new Map<string,{lamports:string;at:number}>();
  private readonly legacyProtectionQuotes=new Map<string,{quote:PilotSizeQuote;reasonCode:PaperProtectionExecutionFallback['reasonCode']}>();
  private readonly latencySamples:number[]=[];private lastObservedSource:{at:number;slot:number;sha256:string}|null=null;private observedSlotMs:number|null=null;
  private readonly executionDiagnostics={plans:0,supportedLandingStates:0,preflightUnsubmitted:0,unknownLanding:0,legacyProtectionFallbacks:0,last:null as {at:number;stage:'planned'|'landing-state-supported'|'preflight-unsubmitted'|'legacy-protection-fallback';reasonCode:'PLAN_PREPARED'|'LANDING_STATE_SUPPORTED'|'LANDING_STATE_UNAVAILABLE'|'UNSIGNED_CONSTRUCTION_UNAVAILABLE'|'SIMULATED_ACCOUNT_RENT_UNAVAILABLE'|'LEGACY_HELD_ACCOUNT_MODEL'|'PLAN_CONSTRUCTION_UNAVAILABLE'|'PLAN_DELAY_EXCEEDS_DECISION_LIFETIME'|'PLAN_FEE_MISMATCH';observedRpcMs:number|null;modeledDelayMs:number|null;feeLamports:string|null;sourceSlot:number|null}|null};
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
  invalidate(reason:string){this.generation++;this.plans.clear();this.entrySnapshots.clear();this.constructions.clear();this.legacyProtectionQuotes.clear();this.quoteRentsByEvidence.clear();this.quoteRentSnapshot=null;this.pricer.invalidate(reason);this.held.invalidate(reason);}
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
  executionRealismEnabled(){return this.options.executionRealism===true;}
  private async construct(q:PilotSizeQuote,minimumOutputUnits:string):Promise<{quote:PilotSizeQuote;construction:PaperUnsignedConstruction;constructionMs:number}>{
    need(this.options.executionRealism===true&&(q.side==='sell'||Number.isSafeInteger(q.slot)),'PAPER_EXECUTION_CONSTRUCTION_REQUIRED');
    const pricer=q.side==='buy'?this.pricer:this.holdingPricer,batch=pricer.constructionBatch(q.mint,q.slot,q.at);need(batch,'PAPER_EXECUTION_ORIGINAL_BATCH_REQUIRED');
    const held=this.options.inventory().positions[q.mint],locked=this.locked(q.mint),plan=q.side==='buy'?{...this.freshPlan(q.mint).accountPlan,at:this.clock()}:{baseExists:!!held,quoteExists:false,at:this.clock(),evidence:'paper-held-inventory:'+hash({mint:q.mint,units:held?.units??null,locked})};
    need(typeof plan.baseExists==='boolean'&&typeof plan.quoteExists==='boolean','PAPER_EXECUTION_SIMULATED_ACCOUNT_PLAN_REQUIRED');
    const quoteRent=this.quoteRentsByEvidence.get(q.evidence);need(quoteRent&&quoteRent.at<=this.clock()&&this.clock()-quoteRent.at<=10000,'PAPER_EXECUTION_QUOTE_RENT_UNAVAILABLE');
    const began=performance.now(),construction=await buildPaperUnsignedPumpSwap(batch,{side:q.side,inputUnits:q.inputUnits,minimumOutputUnits,quoteRentLamports:quoteRent.lamports,accountPlan:{...plan,baseExists:plan.baseExists,quoteExists:plan.quoteExists,evidence:'paper-account-and-observed-rent:'+hash({inventory:plan.evidence,quoteRent})}},this.now),constructionMs=Math.ceil(performance.now()-began);
    need(q.at<=this.clock()&&this.clock()-q.at<=2000&&(q.side!=='buy'||q.slot!>=this.floor(q.mint)),'PAPER_EXECUTION_CONSTRUCTION_STALE');
    if(this.lastObservedSource?.sha256!==construction.sourceSha256){
      const requested=Date.parse(batch.requestedAt),received=Date.parse(batch.receivedAt);this.latencySamples.push(received-requested);if(this.latencySamples.length>PAPER_EXECUTION_POLICY.observationSamples)this.latencySamples.shift();
      const prior=this.lastObservedSource;if(prior&&received>prior.at&&batch.slot>prior.slot){const duration=Math.ceil((received-prior.at)/(batch.slot-prior.slot));if(duration>=100&&duration<=2000)this.observedSlotMs=duration;}
      this.lastObservedSource={at:received,slot:batch.slot,sha256:construction.sourceSha256};
    }
    need(!construction.accounts.poolExtensionRequired,'PAPER_EXECUTION_POOL_EXTENSION_RENT_UNAVAILABLE');
    need(construction.accounts.quoteClosedByInstructions&&construction.temporaryQuoteRentLamports===quoteRent.lamports,'PAPER_EXECUTION_QUOTE_RENT_UNAVAILABLE');
    this.options.recorder.record('paper-unsigned-pumpswap',{at:this.clock(),quoteEvidence:q.evidence,construction,constructionMs,bankClockGuard:'existing same-batch confirmed Clock validated by source pricer; unsigned helper adds no Clock assertion',financialStateChanged:false});
    return {quote:structuredClone(q),construction,constructionMs};
  }
  private rememberQuoteRent(evidence:string,lamports:string,at=this.clock()){this.quoteRentsByEvidence.set(evidence,{lamports,at});while(this.quoteRentsByEvidence.size>18)this.quoteRentsByEvidence.delete(this.quoteRentsByEvidence.keys().next().value!);}
  private async prepareExitQuoteRent(q:PilotSizeQuote,signal:AbortSignal){if(!this.options.executionRealism)return;const at=this.clock(),prior=this.quoteRentSnapshot;if(prior&&prior.at<=at&&at-prior.at<=10000){this.rememberQuoteRent(q.evidence,prior.lamports,prior.at);return;}const requestedAt=this.clock(),rent=await this.options.rpc.call<number>('getMinimumBalanceForRentExemption',[165,{commitment:'confirmed'}],signal);need(Number.isSafeInteger(rent)&&rent>0,'PAPER_EXECUTION_QUOTE_RENT_UNAVAILABLE');const snapshot={lamports:BigInt(rent).toString(),at:this.clock()};this.options.recorder.record('paper-execution-rent',{requestedAt,receivedAt:snapshot.at,accountLengthBytes:165,lamports:snapshot.lamports,classification:'actual read-only minimum balance; reusable at original receive time within existing10s account-cost window; no market-price claim'});this.quoteRentSnapshot=snapshot;this.rememberQuoteRent(q.evidence,snapshot.lamports,snapshot.at);}
  private async rememberConstruction(q:PilotSizeQuote){if(!this.options.executionRealism)return;const minimum=integer(q.outputUnits)*9900n/10000n;need(minimum>0n,'PAPER_EXECUTION_NONZERO_MINIMUM_REQUIRED');const result=await this.construct(q,minimum.toString());this.constructions.set(q.evidence,result);while(this.constructions.size>18)this.constructions.delete(this.constructions.keys().next().value!);}
  /** No provider work. All transaction bytes were prepared from the decision's
   * original coherent state; timing is a labeled scenario conditioned on prior
   * observations, never measured propagation or a claimed validator success. */
  executionPlan(order:Omit<Order,'reserved'|'allocation'>):PaperExecutionPlan|PaperProtectionExecutionFallback|null{
    if(!this.options.executionRealism)return null;
    const now=this.clock(),fallback=this.legacyProtectionQuotes.get(order.decisionEvidence);if(fallback&&order.side==='sell'&&fallback.quote.mint===order.mint&&fallback.quote.inputUnits===this.options.inventory().positions[order.mint]?.units&&fallback.quote.at<=now&&now-fallback.quote.at<=2000){const fact:PaperProtectionExecutionFallback={version:'legacy-paper-protection-fallback-v1',mint:order.mint,units:fallback.quote.inputUnits,at:fallback.quote.at,sourceEvidence:order.decisionEvidence,reasonCode:fallback.reasonCode};this.options.recorder.record('paper-execution-protection-fallback',{at:now,orderId:order.id,fallback:fact,meaning:'Existing held obligation only; original PAPER protection execution component retained, no new-model construction or chain landing claim'});this.executionDiagnostics.legacyProtectionFallbacks++;this.executionDiagnostics.last={at:now,stage:'legacy-protection-fallback',reasonCode:fallback.reasonCode,observedRpcMs:null,modeledDelayMs:order.executeAt-order.decidedAt,feeLamports:order.gas,sourceSlot:fallback.quote.slot??null};return fact;}
    const prepared=this.constructions.get(order.decisionEvidence);if(!prepared||prepared.quote.mint!==order.mint||prepared.quote.side!==order.side||prepared.quote.at>now||now-prepared.quote.at>2000||prepared.construction.minimumOutputUnits!==order.minReceive||prepared.construction.inputUnits!==(order.side==='buy'?order.maxSpend:this.options.inventory().positions[order.mint]?.units))return this.refusedPlan('PLAN_CONSTRUCTION_UNAVAILABLE');
    const sorted=[...this.latencySamples].sort((a,b)=>a-b),observedRpcMs=sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)];if(observedRpcMs===undefined)return null;
    const plan=planPaperExecution({plannedAt:order.decidedAt,decisionQuoteAt:prepared.quote.at,sourceSlot:prepared.construction.sourceSlot,constructionSha256:prepared.construction.constructionSha256,intentSha256:hash(prepared.construction.instructions),temporaryQuoteRentLamports:prepared.construction.temporaryQuoteRentLamports,quoteRentProofSha256:prepared.construction.quoteRentProofSha256,constructionMs:prepared.constructionMs,observedRpcMs,...(this.observedSlotMs===null?{}:{slotDurationMs:this.observedSlotMs,slotDurationBasis:'observed' as const})});
    if(!plan)return this.refusedPlan('PLAN_DELAY_EXCEEDS_DECISION_LIFETIME');if(paperExecutionFee(plan)!==order.gas)return this.refusedPlan('PLAN_FEE_MISMATCH');
    this.options.recorder.record('paper-execution-plan',{at:now,mint:order.mint,side:order.side,plan,planSha256:paperExecutionPlanSha256(plan),decisionEvidence:order.decisionEvidence,construction:prepared.construction,policy:PAPER_EXECUTION_POLICY,meaning:PAPER_EXECUTION_POLICY.meaning});
    this.executionDiagnostics.plans++;this.executionDiagnostics.last={at:now,stage:'planned',reasonCode:'PLAN_PREPARED',observedRpcMs:plan.observedRpcMs,modeledDelayMs:plan.executeAt-plan.plannedAt,feeLamports:paperExecutionFee(plan),sourceSlot:plan.sourceSlot};return plan;
  }
  private refusedPlan(reasonCode:'PLAN_CONSTRUCTION_UNAVAILABLE'|'PLAN_DELAY_EXCEEDS_DECISION_LIFETIME'|'PLAN_FEE_MISMATCH'){this.options.recorder.record('paper-execution-plan-unavailable',{at:this.clock(),reasonCode,financialStateChanged:false,submissionClaimed:false});this.executionDiagnostics.last={at:this.clock(),stage:'preflight-unsubmitted',reasonCode,observedRpcMs:null,modeledDelayMs:null,feeLamports:'0',sourceSlot:null};return null;}
  private unavailableLanding(){this.executionDiagnostics.preflightUnsubmitted++;this.executionDiagnostics.unknownLanding++;this.executionDiagnostics.last={at:this.clock(),stage:'preflight-unsubmitted',reasonCode:'LANDING_STATE_UNAVAILABLE',observedRpcMs:null,modeledDelayMs:null,feeLamports:'0',sourceSlot:null};}
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
      for(const [role,needed,bytes]of [['base',!exists,lengths.base],['quote',this.options.executionRealism===true||!exists,lengths.quote]]as const){
        if(!needed)continue;
        if(rents[bytes]===undefined){const rent=await this.preparationRpc.call<number>('getMinimumBalanceForRentExemption',[bytes,{commitment:'confirmed'}],signal);need(Number.isSafeInteger(rent)&&rent>0,'PILOT_MARKET_RENT_UNAVAILABLE');rents[bytes]=BigInt(rent).toString();}
        if(!this.options.executionRealism||role==='base')deposit+=integer(rents[bytes]!);
      }
      signal.throwIfAborted();const at=this.clock();this.freshClock(state,mint,signal);
      need(generation===this.generation&&locked===this.locked(mint),'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');
      const body={mint,depositLamports:deposit.toString(),at,accountModel:this.options.executionRealism?'persistent-base-transient-shared-wsol-v2' as const:MODEL,...(this.options.executionRealism?{temporaryQuoteRentLamports:rents[lengths.quote]}:{}),accountLengths:lengths,rentLamportsByBytes:rents,sourceSlot:state.slot,lockedDepositLamports:locked};
      const evidence='pilot-entry-costs:'+hash({...body,poolEvidence:this.pools.get(mint)!.evidence,gas:this.options.gas});
      const plan:PilotEntryCosts={...body,evidence,accountPlan:{baseExists:exists,quoteExists:this.options.executionRealism?false:exists,at,evidence}};
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
      for(const [role,exists,bytes]of [['base',accountPlan.baseExists,plan.accountLengths.base],['quote',accountPlan.quoteExists,plan.accountLengths.quote]]as const){
        if(exists)continue;need(Number.isSafeInteger(bytes)&&bytes>=165&&bytes<=10240,'PILOT_MARKET_ACCOUNT_LENGTH');
        if(rents[bytes]===undefined){const rent=await this.options.rpc.call<number>('getMinimumBalanceForRentExemption',[bytes,{commitment:'confirmed'}],signal);need(Number.isSafeInteger(rent)&&rent>0,'PILOT_MARKET_RENT_UNAVAILABLE');rents[bytes]=BigInt(rent).toString();}
        if(!this.options.executionRealism||role==='base')required+=integer(rents[bytes]!);
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
      if(this.options.executionRealism)this.rememberQuoteRent(q.evidence,rents[plan.accountLengths.quote]!);
      await this.rememberConstruction(q);
      this.entrySnapshots.set(input.mint,structuredClone(q));return q;
    }catch(error){this.entryQuoteFailure(attempt,error);return null;}
  }
  readonly context=async(positions:Readonly<Record<string,Position>>,signal:AbortSignal):Promise<ExecutionContext>=>{
    if(this.holdingActive||this.active&&!this.protectionYield||signal.aborted)return {price:null,marks:{}};
    this.holdingActive=true;
    try{return await this.held.context(positions,signal);}
    finally{this.holdingActive=false;}
  };
  readonly quote=async(request:SizeRequest,signal:AbortSignal):Promise<PilotSizeQuote|null>=>{
    const q=await this.held.quote(request,signal);
    if(q&&request.side==='sell'&&this.options.executionRealism){
      const held=this.options.inventory().positions[q.mint];
      if(held&&held.units===q.inputUnits&&held.executionModelVersion!==PAPER_EXECUTION_MODEL_VERSION){
        if(signal.aborted||q.at>this.clock()||this.clock()-q.at>2000)return null;
        this.legacyProtectionQuotes.set(q.evidence,{quote:structuredClone(q),reasonCode:'LEGACY_HELD_ACCOUNT_MODEL'});
        while(this.legacyProtectionQuotes.size>3)this.legacyProtectionQuotes.delete(this.legacyProtectionQuotes.keys().next().value!);
      }else{try{await this.prepareExitQuoteRent(q,signal);await this.rememberConstruction(q);}catch{return null;}}
    }
    return q;
  };
  readonly executionQuote=async(request:QuoteRequest&{minSlot?:number},signal:AbortSignal):Promise<PilotExecutionQuote|null>=>{
    const order=request.order;
    try{
      if(request.minSlot!==undefined)this.minimumSlot(order.mint,request.minSlot);
      if(order.side==='buy'){this.entrySnapshots.delete(order.mint);need(this.freshPlan(order.mint).depositLamports===order.deposit,'PILOT_MARKET_RESERVED_DEPOSIT_MISMATCH');}
      const q=await this.held.executionQuote(request,signal);if(!q){if((order as Order&{executionModel?:PaperExecutionPlan}).executionModel)this.unavailableLanding();return null;}
      const at=this.clock(),pending=this.options.inventory().pending[order.id];
      need(!signal.aborted&&pending&&JSON.stringify(pending)===JSON.stringify(order)&&q.at>=Math.max(order.executeAt,request.attemptedAt)&&q.at<=at&&at-q.at<=2000&&at<order.expiresAt,'PILOT_MARKET_EXECUTION_CHANGED_OR_STALE');
      let modeled:PaperExecutionLanding|undefined;const model=(order as Order&{executionModel?:PaperExecutionPlan}).executionModel;
      if(model){const sizeQuote:PilotSizeQuote={mint:order.mint,side:order.side,inputUnits:order.side==='buy'?order.maxSpend:request.fullPositionBaseUnits!,outputUnits:q.receiveUnits,at:q.at,evidence:q.evidence,slot:undefined};if(order.side==='buy')sizeQuote.slot=this.entrySnapshots.get(order.mint)?.slot;else await this.prepareExitQuoteRent(sizeQuote,signal);const built=await this.construct(sizeQuote,order.minReceive);modeled={version:PAPER_EXECUTION_MODEL_VERSION,planSha256:paperExecutionPlanSha256(model),constructionSha256:built.construction.constructionSha256,intentSha256:hash(built.construction.instructions),temporaryQuoteRentLamports:built.construction.temporaryQuoteRentLamports,quoteRentProofSha256:built.construction.quoteRentProofSha256,preparedAt:this.clock(),landingAt:q.at,sourceSlot:built.construction.sourceSlot,outcome:'scenario-landed',feeLamports:paperExecutionFee(model)};need(validatePaperExecutionLanding(modeled,model,this.clock()),'PAPER_EXECUTION_LANDING_INTENT_OR_STATE_UNAVAILABLE');this.options.recorder.record('paper-execution-landing-state',{at:this.clock(),orderId:order.id,executionModel:modeled,quoteEvidence:q.evidence,meaning:PAPER_EXECUTION_POLICY.meaning});this.executionDiagnostics.supportedLandingStates++;this.executionDiagnostics.last={at:this.clock(),stage:'landing-state-supported',reasonCode:'LANDING_STATE_SUPPORTED',observedRpcMs:model.observedRpcMs,modeledDelayMs:model.executeAt-model.plannedAt,feeLamports:modeled.feeLamports,sourceSlot:modeled.sourceSlot};}
      if(order.side==='sell')return {...q,...(modeled?{executionModel:modeled}:{})};
      const plan=this.freshPlan(order.mint),entry=this.entrySnapshots.get(order.mint);need(plan.depositLamports===order.deposit,'PILOT_MARKET_RESERVED_DEPOSIT_MISMATCH');
      need(entry&&entry.evidence===q.evidence&&entry.at===q.at&&entry.outputUnits===q.receiveUnits&&entry.slot!==undefined&&entry.slot>=this.floor(order.mint,request.minSlot??0),'PILOT_MARKET_EXECUTION_SOURCE_REQUIRED');this.entryAttempts++;
      return {...q,...(modeled?{executionModel:modeled}:{}),slot:entry.slot,requiredDepositLamports:plan.depositLamports,depositEvidence:'pilot-execution-validated-costs:'+hash({preparation:plan.evidence,quote:q.evidence,deposit:plan.depositLamports})};
    }catch{if((order as Order&{executionModel?:PaperExecutionPlan}).executionModel)this.unavailableLanding();return null;}
  };
  usage(){return {executionModel:{version:PAPER_EXECUTION_MODEL_VERSION,state:this.options.executionRealism?'active':'unavailable',scope:'current-market-instance',...structuredClone(this.executionDiagnostics),policySha256:PAPER_EXECUTION_POLICY_SHA256,meaning:PAPER_EXECUTION_POLICY.meaning,assumptions:PAPER_EXECUTION_POLICY},classification:'isolated PAPER pilot only',registeredPools:this.pools.size,preparedEntryCostPlans:this.prepared,entryQuoteCalls:this.entryEstimates,entryExecutionQuotes:this.entryAttempts,entryQuoteFailures:structuredClone(this.entryQuoteFailures),held:this.holdingPricer.usage(),holdingDiagnostics:this.held.usage(),entryPricing:this.pricer.usage(),rpc:this.options.rpc.usage?.()??null,accountModel:this.options.executionRealism?'persistent-base-transient-shared-wsol-v2':MODEL,depositRefundsAssumed:false};}
}
