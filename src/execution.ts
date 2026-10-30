import {performance} from 'node:perf_hooks';
import {validatePaperExecutionPlan,validatePaperExecutionLanding,validatePaperProtectionExecutionFallback,paperProtectionFallbackEvidence,executionAttempt,type PaperExecutionPlan,type PaperExecutionLanding,type PaperExecutionAttempt,type PaperProtectionExecutionFallback} from './execution-realism.js';
import {PaperLedger,type ExecutionQuote,type Mark,type Order,type OrderOutcome,type UsdPrice} from './ledger.js';

export type ExecutionContext={price:UsdPrice|null;marks:Record<string,Mark>;/** Original bank-source expiry for every required holding; never a publishing heartbeat. */sourceValidUntil?:number};
export type QuoteRequest={order:Readonly<Order>;attemptedAt:number;fullPositionBaseUnits:string|null};
export type ExecutionResult={orderId:string;status:OrderOutcome['status']|'uncertain'|'canceled';reason:string;at:number};
export type ExecutionBatch={results:ExecutionResult[];adapterBlocked:boolean;nextDueAt:number|null;/** Present only for an explicitly bounded drain. */servicedActions?:number};
export type ExecutionRunOptions={maxActions?:1|2|3};
export type ExecutionOptions={
  ledger:PaperLedger;
  /** These adapters must honor AbortSignal. They may only read market/account context. */
  context:(signal:AbortSignal)=>Promise<ExecutionContext>;
  quote:(request:QuoteRequest,signal:AbortSignal)=>Promise<ExecutionQuote|null>;
  now?:()=>number;
  /** Total context/quote preparation deadline, also capped by order expiry. */
  timeoutMs?:number;
  /** New reservations only; no provider work or mutation inside this planner. */
  executionPlan?:(order:Omit<Order,'reserved'|'allocation'>)=>PaperExecutionPlan|PaperProtectionExecutionFallback|null;
  /** Optional scheduling wake after a timed-out adapter actually settles. */
  onAdapterSettled?:()=>void;
};
const UNKNOWN_PRICE:UsdPrice={microUsdPerSol:'0',at:0,source:'unavailable'};

/** The ledger remains the only financial owner. This coordinator never opens a
 * database, signs/submits, enables entries, invents a quote, or retries an order.
 * Caller schedules nextDueAt; a polling tick is not a latency guarantee.
 */
export class PaperExecutionCoordinator{
  private readonly now:()=>number;
  private readonly timeoutMs:number;
  private recovered=false;
  private recoveryResult:{canceledEntries:string[];uncertainExitOrders:string[]}|undefined;
  private readonly uncertain=new Set<string>();
  private readonly financialRetryAt=new Map<string,number>();
  private active:Promise<ExecutionBatch>|undefined;
  private outstanding:Promise<unknown>|undefined;

  constructor(private readonly options:ExecutionOptions){
    this.now=options.now??Date.now;this.timeoutMs=options.timeoutMs??1500;
    if(!Number.isSafeInteger(this.timeoutMs)||this.timeoutMs<1||this.timeoutMs>10_000)throw new Error('bounded execution preparation timeout required');
    options.ledger.state(); // Existing state only; never initialize/reseed.
  }
  private clock(){const at=this.now();if(!Number.isSafeInteger(at)||at<0)throw new Error('synchronized wall time required');return at;}
  /** On restart no old entry may execute. An unresolved exit is preserved and
   * quarantined: only expiry may finalize it, without fetching a later quote.
   */
  recover(){
    if(this.active)throw new Error('cannot recover during an execution attempt');
    if(this.recoveryResult)return structuredClone(this.recoveryResult);
    const state=this.options.ledger.state(),at=this.clock();
    const id=`execution-recovery:${state.accountId}:${state.revision}`;
    this.options.ledger.pause(id,at,'execution startup: fresh reconciliation/readiness required');
    const canceled=Object.values(state.pending).some(o=>o.side==='buy')
      ?this.options.ledger.cancelEntryOrders(id+':cancel',at,'restart invalidated entry signal before a durable PAPER attempt')
      :{canceledEntries:[]};
    for(const order of Object.values(state.pending))if(order.side==='sell')this.uncertain.add(order.id);
    this.recovered=true;
    this.recoveryResult={canceledEntries:canceled.canceledEntries,uncertainExitOrders:[...this.uncertain]};
    return structuredClone(this.recoveryResult);
  }
  /** Gas (base + priority) and refundable deposit are explicit simulated order
   * assumptions. Pool fees/impact belong in the adapter's size-specific quote.
   */
  reserve(order:Omit<Order,'reserved'|'allocation'>,context:ExecutionContext){
    if(!this.recovered)throw new Error('execution recovery required');
    const now=this.clock();
    if(!Number.isSafeInteger(order.decidedAt)||order.decidedAt>now||!Number.isSafeInteger(order.expiresAt)||order.expiresAt<=now)throw new Error('current nonexpired decision required; future information is unavailable');
    if(order.side==='buy'&&this.uncertain.size)throw new Error('financial uncertainty blocks new entries');
    if(order.side==='buy'&&this.outstanding)throw new Error('execution adapter unavailable for new entries');
    let prepared=order;
    if(this.options.executionPlan){const plan=this.options.executionPlan(Object.freeze({...order}));if(validatePaperProtectionExecutionFallback(plan)){const held=this.options.ledger.state().positions[order.mint];if(order.side!=='sell'||plan.mint!==order.mint||plan.units!==held?.units||plan.sourceEvidence!==order.decisionEvidence||plan.at>now||now-plan.at>2000)throw Error('PAPER execution preparation unavailable');prepared={...order,decisionEvidence:paperProtectionFallbackEvidence(plan,order.id)};}else{if(!plan||!validatePaperExecutionPlan(plan)||plan.plannedAt!==order.decidedAt)throw Error('PAPER execution preparation unavailable');prepared={...order,executeAt:plan.executeAt,expiresAt:plan.expiresAt,temporaryRentLamports:plan.temporaryQuoteRentLamports,executionModel:plan} as typeof prepared;}}
    return this.options.ledger.order(prepared,context.price??UNKNOWN_PRICE,context.marks);
  }
  readinessSafety(){return {recoveryComplete:this.recovered,idle:!this.active&&!this.outstanding,uncertainActions:this.uncertain.size};}
  nextDueAt():number|null{
    if(!this.recovered)return null;
    const times=Object.values(this.options.ledger.state().pending).map(o=>this.outstanding||this.uncertain.has(o.id)||o.side==='buy'&&this.uncertain.size>0?Math.max(o.expiresAt,this.financialRetryAt.get(o.id)??0):o.executeAt);
    return times.length?Math.min(...times):null;
  }
  runDue(options:ExecutionRunOptions={}):Promise<ExecutionBatch>{
    if(!this.recovered)return Promise.reject(new Error('execution recovery required'));
    if(!options||typeof options!=='object'||Array.isArray(options)||options.maxActions!==undefined&&(!Number.isSafeInteger(options.maxActions)||options.maxActions<1||options.maxActions>3))return Promise.reject(new Error('bounded due-action count required'));
    if(this.active)return this.active;
    this.active=this.drain(options.maxActions).finally(()=>{this.active=undefined;});return this.active;
  }
  /** Indexed durable lookup, independent of bounded journal export windows. */
  recordedOutcome(orderId:string):OrderOutcome|null{
    if(!orderId||orderId.length>100)throw new Error('bounded order identity required');
    const result=this.options.ledger.actionResult(`execution-attempt:${orderId}`);
    if(result===undefined)return null;
    const outcome=result as OrderOutcome;
    if(!outcome||!['filled','failed','expired'].includes(outcome.status)||typeof outcome.reason!=='string'||!Number.isSafeInteger(outcome.at))throw new Error('stored execution outcome invalid');
    return outcome;
  }
  private async bounded<T>(read:(signal:AbortSignal)=>Promise<T>,deadline:number):Promise<T>{
    if(this.outstanding)throw new Error('previous adapter has not honored cancellation');
    const remaining=deadline-performance.now();if(remaining<=0)throw new Error('execution preparation deadline');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    const request=Promise.resolve().then(()=>read(controller.signal));this.outstanding=request;
    const settled=()=>{
      if(this.outstanding===request)this.outstanding=undefined;
      if(timedOut){try{this.options.onAdapterSettled?.();}catch{/* Scheduling failures cannot alter a financial action. */}}
    };
    void request.then(settled,settled);
    try{return await Promise.race([request,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new Error('execution preparation timeout'));},remaining);})]);}
    finally{clearTimeout(timer);controller.abort();}
  }
  private async drain(maxActions:number|undefined):Promise<ExecutionBatch>{
    const results:ExecutionResult[]=[];let servicedActions=0;
    const pending=this.options.ledger.state().pending;
    for(const id of this.uncertain)if(!pending[id]){this.uncertain.delete(id);this.financialRetryAt.delete(id);}
    const orders=Object.values(pending).sort((a,b)=>(a.side==='sell'?0:1)-(b.side==='sell'?0:1)||a.executeAt-b.executeAt||a.id.localeCompare(b.id));
    for(const original of orders){
      if(maxActions!==undefined&&servicedActions>=maxActions)break;
      const order=this.options.ledger.state().pending[original.id];if(!order){this.uncertain.delete(original.id);this.financialRetryAt.delete(original.id);continue;}
      const at=this.clock();
      if(at<order.executeAt)continue;
      if((this.uncertain.has(order.id)||order.side==='buy'&&this.uncertain.size>0)&&at<order.expiresAt){results.push({orderId:order.id,status:'uncertain',reason:'financial action requires expiry or reconciliation before a new management decision; no re-quote',at});continue;}
      if((this.financialRetryAt.get(order.id)??0)>at){results.push({orderId:order.id,status:'uncertain',reason:'financial finalization retry backoff; preserve action and do not re-quote',at});continue;}
      if(this.outstanding&&at<order.expiresAt)continue; // At most one uncanceled adapter request.
      // Known quarantined/backoff actions above retain their own future wake;
      // they cannot consume this admission and starve a different due exit.
      servicedActions++;
      let context:ExecutionContext={price:null,marks:{}},quote:ExecutionQuote|null=null;
      if(at<order.expiresAt){
        const deadline=performance.now()+Math.min(this.timeoutMs,order.expiresAt-at);
        try{context=await this.bounded(this.options.context,deadline);}catch{/* Unknown remains explicit; never manufacture a fresh price. */}
        // Exits may obtain a SOL quote while USD is unavailable. New entries
        // cannot consume risk without the actual timestamped USD context.
        if((order.side==='sell'||context.price!==null)&&this.clock()<order.expiresAt&&!this.outstanding){
          const position=this.options.ledger.state().positions[order.mint];
          if(order.side==='sell'&&!position){this.uncertain.add(order.id);results.push({orderId:order.id,status:'uncertain',reason:'held position is unavailable; preserve financial action',at:this.clock()});continue;}
          try{quote=await this.bounded(signal=>this.options.quote({order:Object.freeze({...order}),attemptedAt:at,fullPositionBaseUnits:order.side==='sell'?position!.units:null},signal),deadline);}
          catch{quote=null;} // Exactly one preparation attempt, including failure/timeout.
        }
      }
      const finalizedAt=this.clock();
      // A context can cross its original bank-source expiry while preparing
      // another quote. Keep USD/exposure, but never let stale held marks admit
      // an entry merely because their receive timestamps are still recent.
      if(Object.keys(this.options.ledger.state().positions).length&&context.sourceValidUntil!==undefined&&(!Number.isSafeInteger(context.sourceValidUntil)||context.sourceValidUntil<finalizedAt))context={...context,marks:{}};
      if(!this.options.ledger.state().pending[order.id]){this.uncertain.delete(order.id);this.financialRetryAt.delete(order.id);results.push({orderId:order.id,status:'canceled',reason:'financial owner canceled action during preparation',at:finalizedAt});continue;}
      try{
        const model=(order as Order&{executionModel?:PaperExecutionPlan}).executionModel;
        let modeledAttempt:PaperExecutionAttempt|undefined;
        if(model){const landing=(quote as (ExecutionQuote&{executionModel?:PaperExecutionLanding})|null)?.executionModel,landed=!!quote&&validatePaperExecutionLanding(landing,model,finalizedAt)&&landing.landingAt===quote.at;modeledAttempt=executionAttempt(model,landed,finalizedAt>=order.expiresAt);if(!landed)quote=null;}
        // Keep the exact historical call/payload when the order has no model.
        const outcome=modeledAttempt
          ?(this.options.ledger.attempt as (...args:[string,string,number,ExecutionQuote|null,UsdPrice,Record<string,Mark>,PaperExecutionAttempt])=>OrderOutcome)(`execution-attempt:${order.id}`,order.id,finalizedAt,quote,context.price??UNKNOWN_PRICE,context.marks,modeledAttempt)
          :this.options.ledger.attempt(`execution-attempt:${order.id}`,order.id,finalizedAt,quote,context.price??UNKNOWN_PRICE,context.marks);
        this.uncertain.delete(order.id);this.financialRetryAt.delete(order.id);results.push({orderId:order.id,...outcome});
      }catch{
        try{
          const committed=this.recordedOutcome(order.id);
          if(committed){this.uncertain.delete(order.id);this.financialRetryAt.delete(order.id);results.push({orderId:order.id,...committed});continue;}
        }catch{/* Unreadable financial records remain uncertainty, never a reset. */}
        this.uncertain.add(order.id);
        this.financialRetryAt.set(order.id,finalizedAt+1000);
        results.push({orderId:order.id,status:'uncertain',reason:'financial commit unavailable; preserve action and block re-quote',at:finalizedAt});
      }
    }
    return {results,adapterBlocked:!!this.outstanding,nextDueAt:this.nextDueAt(),...(maxActions===undefined?{}:{servicedActions})};
  }
}
