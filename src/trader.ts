import {assertPoeOperatingAccount} from './poe-operating-account.js';
import {PaperLedger,type ExecutionQuote,type Mark,type Position} from './ledger.js';
import {PaperExecutionCoordinator,type ExecutionContext,type ExecutionResult,type QuoteRequest} from './execution.js';
import {FlowWindow,copyEventIdentity,PROVISIONAL_RULE,evaluateExit,evaluatePrimary,assessPredictiveBuying,type EventIdentity,type NormalizedTrade,type RuleDecision} from './strategy.js';
import {assertPilotBaseline,resolvePilotBinding,type PilotBinding,type ResolvedPilotBinding} from './pilot-contract.js';

export type CandidateEvidence={mint:string;migrationAt:number;migrationVerified:boolean;supportedPool:boolean;evidence:string};
export type SizeRequest={mint:string;side:'buy'|'sell';inputUnits:string;minSlot?:number;requiredDepositLamports?:string};
export type SizeQuote=SizeRequest&{outputUnits:string;at:number;evidence:string;slot?:number;effectiveQuoteLiquidityLamports?:string;refundedDepositLamports?:string;refundEvidence?:string;depositEvidence?:string};
export type PilotExecutionQuote=ExecutionQuote&{slot?:number;requiredDepositLamports?:string;depositEvidence?:string};
export type PilotQuoteRequest=QuoteRequest&{minSlot?:number};
export type TraderOptions={
  ledger:PaperLedger;now?:()=>number;
  /** Deep-analysis capacity, independent of the financial position limit. */
  maximumCandidates?:number;
  context:(positions:Readonly<Record<string,Position>>,signal:AbortSignal)=>Promise<ExecutionContext>;
  quote:(request:SizeRequest,signal:AbortSignal)=>Promise<SizeQuote|null>;
  costs:{gasLamports:string;depositLamports:string;slippageBps:number;evidence:string};
  recorder:{record:(kind:string,data:unknown)=>void};
  flowVerification?:{verified:boolean;evidence:string};
  /** Financial-entry readiness, including current window/audit and eligibility; no provider work. */
  candidateReadiness?:(mint:string,at:number)=>boolean;
  /** Feature-only observation/audit readiness; never financial entry permission.
   * Omission preserves the existing candidateReadiness diagnostic contract. */
  predictiveReadiness?:(mint:string,at:number)=>boolean;
  /** Isolated research opt-in. Default quote ordering is unchanged. */
  deferPredictivelyRejectedQuotes?:true;
  /** Isolated pilot selection diagnostics only; never entry permission. */
  predictiveDiagnostics?:true;
  /** Frozen research mode: no financial recovery, contexts, quotes or execution. */
  candidateEvaluationOnly?:true;
  experimentalPilot?:PilotBinding;
  /** Exact original account identity; historical fixture path remains separate. */
  operatingAccount?:true;
  pilotExecution?:{context:(positions:Readonly<Record<string,Position>>,signal:AbortSignal)=>Promise<ExecutionContext>;quote:(request:PilotQuoteRequest,signal:AbortSignal)=>Promise<PilotExecutionQuote|null>};
  timeoutMs?:number;
};
export type TraderTickOptions={evaluateCandidates?:boolean;candidateMint?:string;reuseFreshContext?:boolean;maximumDueActions?:1|2|3};
type Candidate=CandidateEvidence&{admittedAt:number;window:FlowWindow;active:boolean;everActivated:boolean;interrupted:boolean;evaluatedBucket:number;evidenceDeferredBucket:number;predictiveAssessedBucket:number;knownSlot:number|null;informationPending:boolean};
type Decision={mint:string;at:number;stage:string;reason:string;ruleVersion:string;features?:RuleDecision['features'];quote?:SizeQuote|null;permissionContext?:{mode:'candidate-evaluation';primaryKind:string;primaryReason:string;performanceFailure:false}};
const validText=(s:unknown,max=512):s is string=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\u0000-\u001f]/.test(s);
const unsigned=(s:string)=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(s))throw new Error('bounded integer amount required');return BigInt(s);};
/** The exact existing predictive predicates, after evaluatePrimary has already
 * validated this feature snapshot. This cannot qualify an entry or replace any
 * quote/support/liquidity check. Only the refusal's order/knowledge changes. */
function quoteIndependentRefusal(decision:RuleDecision):RuleDecision|null {
  const f=decision.features;if(!f)return null;const predictive=assessPredictiveBuying(f,decision.at);
  if(predictive.status==='failed')return {...decision,qualified:false,kind:'strategy-rejection',reason:predictive.reason};
  return predictive.status==='unavailable'&&predictive.reason==='price-structure-unavailable'?{...decision,qualified:false,kind:'missing-data',reason:predictive.reason}:null;
}

/** Adapter-driven PAPER integration. It never initializes capital, enables
 * entries, loads credentials or owns another database. An unfrozen ordinary
 * PAPER account remains closed; only the exact isolated pilot may opt in.
 */
export class PaperTrader{
  private readonly now:()=>number;
  private readonly maximumCandidates:number;
  private readonly candidates=new Map<string,Candidate>();
  private readonly recent:Decision[]=[];
  private context:ExecutionContext={price:null,marks:{}};
  private contextInventory:Record<string,string>|null=null;
  private active:Promise<{execution:ExecutionResult[];nextDueAt:number|null}>|undefined;
  private tickActionsRemaining:number|null=null;
  private outstanding:Promise<unknown>|undefined;
  private evidenceUnavailable=false;
  private financialUnavailable=false;
  private readonly uncertainOrders=new Set<string>();
  private started=false;
  private readonly execution:PaperExecutionCoordinator;
  private readonly pilot:boolean;
  private readonly candidateEvaluationOnly:boolean;
  private readonly pilotConfig:Readonly<ResolvedPilotBinding>|null;
  private pilotDeposit:{lamports:string;evidence:string;preparedAt:number}|null=null;
  private readonly pilotDeposits=new Map<string,{lamports:string;evidence:string;preparedAt:number}>();
  readonly funnel={discovered:0,supported:0,sufficientlyObserved:0,evaluated:0,qualified:0,reserved:0,attempted:0,paperFilled:0,exited:0,reconciled:0};
  constructor(private readonly options:TraderOptions){
    this.maximumCandidates=options.maximumCandidates??12;if(!Number.isSafeInteger(this.maximumCandidates)||this.maximumCandidates<1||this.maximumCandidates>20)throw Error('bounded deep candidate capacity required');
    this.pilot=options.experimentalPilot!==undefined;
    this.candidateEvaluationOnly=options.candidateEvaluationOnly===true;
    if(this.candidateEvaluationOnly&&(!this.pilot||options.predictiveDiagnostics!==true))throw Error('candidate-only mode requires isolated predictive diagnostics');
    this.pilotConfig=this.pilot?resolvePilotBinding(options.experimentalPilot):null;
    if(options.predictiveDiagnostics===true&&!this.pilot)throw Error('predictive diagnostics require the isolated pilot contract');
    if(this.pilot){const state=options.ledger.state();if(options.operatingAccount===true)assertPoeOperatingAccount(state);assertPilotBaseline();if(!this.pilotConfig||state.mode!=='PAPER'||!(options.operatingAccount===true||/^poe-pilot-[a-z0-9-]+$/.test(state.accountId))||options.costs.gasLamports!=='7000'||options.costs.slippageBps!==100||(options.timeoutMs??3000)>3000||typeof options.pilotExecution?.context!=='function'||typeof options.pilotExecution?.quote!=='function')throw Error('isolated pilot identity, frozen contract and fresh execution adapters required');}
    else if(options.pilotExecution)throw Error('pilot execution adapters require the isolated pilot contract');
    // Match evaluatePrimary's existing 128-character evidence contract before
    // any observation starts, rather than silently rejecting every pilot bin.
    if(this.pilot&&(options.flowVerification?.verified!==true||!validText(options.flowVerification.evidence,128)))throw Error('pilot requires verified flow fields and bounded evidence of at most 128 characters');
    this.options={...options,timeoutMs:options.timeoutMs??(this.pilot?3000:1000),costs:Object.freeze({gasLamports:options.costs.gasLamports,depositLamports:options.costs.depositLamports,slippageBps:options.costs.slippageBps,evidence:options.costs.evidence}),flowVerification:options.flowVerification?Object.freeze({verified:options.flowVerification.verified,evidence:options.flowVerification.evidence}):undefined,experimentalPilot:options.experimentalPilot?Object.freeze({version:options.experimentalPilot.version,contractSha256:options.experimentalPilot.contractSha256,maxPositions:options.experimentalPilot.maxPositions,...('stage'in options.experimentalPilot?{stage:options.experimentalPilot.stage}:{})}) as PilotBinding:undefined,pilotExecution:options.pilotExecution?Object.freeze({context:options.pilotExecution.context,quote:options.pilotExecution.quote}):undefined};
    this.now=options.now??Date.now;unsigned(options.costs.gasLamports);unsigned(options.costs.depositLamports);
    if(unsigned(options.costs.gasLamports)===0n||!validText(options.costs.evidence)||!Number.isSafeInteger(options.costs.slippageBps)||options.costs.slippageBps<0||options.costs.slippageBps>1000||!Number.isSafeInteger(options.timeoutMs??1000)||(options.timeoutMs??1000)<1||(options.timeoutMs??1000)>10_000)throw new Error('explicit bounded simulated execution costs required');
    this.execution=new PaperExecutionCoordinator({ledger:options.ledger,now:this.now,timeoutMs:this.options.timeoutMs,context:async signal=>this.pilot?this.options.pilotExecution!.context(structuredClone(this.options.ledger.state().positions),signal):this.context,quote:async(request,signal)=>{
      if(this.pilot){const raw=await this.options.pilotExecution!.quote(Object.freeze({...request,...(request.order.side==='buy'?{minSlot:this.candidates.get(request.order.mint)?.knownSlot??0}:{})}),signal),at=this.clock(),floor=this.candidates.get(request.order.mint)?.knownSlot??0;if(!raw||!Number.isSafeInteger(raw.at)||raw.at<Math.max(request.attemptedAt,request.order.executeAt)||raw.at>at||at-raw.at>PROVISIONAL_RULE.maximumQuoteAgeMs||!validText(raw.evidence)||request.order.side==='buy'&&(raw.requiredDepositLamports!==request.order.deposit||!validText(raw.depositEvidence)||!Number.isSafeInteger(raw.slot)||raw.slot!<floor))return null;
        const current=()=>{const now=this.clock(),pending=this.options.ledger.state().pending[request.order.id];return !signal.aborted&&pending&&JSON.stringify(pending)===JSON.stringify(request.order)&&now<request.order.expiresAt&&raw.at<=now&&now-raw.at<=PROVISIONAL_RULE.maximumQuoteAgeMs&&(request.order.side!=='buy'||raw.slot!>=(this.candidates.get(request.order.mint)?.knownSlot??0));};if(!current())return null;
        if(request.order.side==='buy'){const c=this.candidates.get(request.order.mint);if(c)c.knownSlot=Math.max(c.knownSlot??0,raw.slot!);}
        const q:ExecutionQuote={at:raw.at,spendLamports:raw.spendLamports,receiveUnits:raw.receiveUnits,evidence:raw.evidence,...(request.order.side==='sell'?{pricedBaseUnits:raw.pricedBaseUnits,refundedDepositLamports:raw.refundedDepositLamports,refundEvidence:raw.refundEvidence}:{})};this.record('trader-pilot-execution-quote',{at,orderId:request.order.id,attemptedAt:request.attemptedAt,quote:q,quoteSlot:raw.slot??null,requiredDepositLamports:request.order.side==='buy'?raw.requiredDepositLamports:null,depositEvidence:request.order.side==='buy'?raw.depositEvidence:null,ruleVersion:this.effectiveVersion});if(!current()){this.record('trader-pilot-execution-refusal',{at:this.clock(),orderId:request.order.id,quoteAt:q.at,reason:'post-record-execution-evidence-stale-or-action-changed',ruleVersion:this.effectiveVersion});return null;}return q;}
      const input=this.withKnownFloor({mint:request.order.mint,side:request.order.side,inputUnits:request.order.side==='buy'?request.order.maxSpend:request.fullPositionBaseUnits!});
      const q=this.cleanQuote(await this.read(s=>this.options.quote(Object.freeze({...input}),s),signal),input);
      this.record('trader-quote',{at:this.clock(),purpose:'execution',request:input,quote:q});
      if(!q)return null;
      return {at:q.at,evidence:q.evidence,spendLamports:request.order.side==='buy'?q.inputUnits:'0',receiveUnits:q.outputUnits,...(request.order.side==='sell'?{pricedBaseUnits:q.inputUnits,refundedDepositLamports:q.refundedDepositLamports,refundEvidence:q.refundEvidence}:{})} satisfies ExecutionQuote;
    }});
  }
  private clock(){const at=this.now();if(!Number.isSafeInteger(at)||at<0)throw new Error('actual receive wall time required');return at;}
  private get effectiveVersion(){return this.pilotConfig?.version??PROVISIONAL_RULE.version;}
  get frozenVersion():PilotBinding['version']|null{return this.pilotConfig?.version??null;}
  nextDueAt(){if(this.candidateEvaluationOnly){this.assertCandidateOnlyState();return null;}return this.execution.nextDueAt();}
  private pilotDepositFor(mint:string){return this.pilotDeposits.get(mint)??(this.pilotConfig?.stage===null?this.pilotDeposit:null);}
  setPilotEntryDeposit(lamports:string,evidence:string,mint?:string){if(!this.pilot||!validText(evidence)||mint!==undefined&&!validText(mint,96)||Object.values(this.options.ledger.state().pending).some(o=>o.side==='buy'&&(mint===undefined||o.mint===mint)))throw Error('pilot deposit preparation requires no pending entry for the selected mint');if(this.pilotConfig?.stage!==null&&mint===undefined)throw Error('concurrent pilot deposit preparation requires an explicit mint');if(mint!==undefined&&!this.pilotDeposits.has(mint)&&this.pilotDeposits.size>=this.maximumCandidates+3)throw Error('bounded pilot deposit capacity');unsigned(lamports);const plan=Object.freeze({lamports,evidence,preparedAt:this.clock()});if(mint===undefined)this.pilotDeposit=plan;else this.pilotDeposits.set(mint,plan);this.record('trader-pilot-entry-deposit',{...plan,...(mint===undefined?{}:{mint}),classification:'required refundable locked capital; not a permanent execution fee'});}
  clearPilotEntryDeposit(mint:string){if(!this.pilot||!validText(mint,96))throw Error('isolated pilot and bounded mint required');const state=this.options.ledger.state();if(state.positions[mint]||Object.values(state.pending).some(order=>order.mint===mint))throw Error('held/pending deposit preparation must be retained');const removed=this.pilotDeposits.delete(mint);if(removed)this.record('trader-pilot-entry-deposit-cleared',{mint,at:this.clock(),reason:'unowned preparation released; financial history unchanged'});return removed;}
  pauseNewEntries(reason:string){if(!validText(reason))throw Error('bounded entry-pause reason required');this.pause(reason);}
  private id(kind:string){return `trader:${kind}:${this.options.ledger.state().revision}:${this.clock()}`;}
  private pause(reason:string){
    if(this.candidateEvaluationOnly){this.assertCandidateOnlyState();return;}
    const state=this.options.ledger.state(),at=this.clock(),buys=Object.values(state.pending).some(o=>o.side==='buy');
    if(state.controls.entriesEnabled)this.options.ledger.pause(this.id('pause'),at,reason);
    if(buys&&!this.financialUnavailable&&!this.uncertainOrders.size)this.options.ledger.cancelEntryOrders(this.id('cancel'),at,reason);
  }
  private record(kind:string,data:unknown){try{this.options.recorder.record(kind,data);}catch{this.evidenceUnavailable=true;this.pause('selected evidence unavailable; entries closed');}}
  private decision(decision:Decision){const effective={...decision,ruleVersion:this.effectiveVersion};this.recent.push(structuredClone(effective));if(this.recent.length>50)this.recent.shift();this.record('trader-decision',effective);}
  start(){if(this.started)return;if(this.candidateEvaluationOnly)this.assertCandidateOnlyState();else for(const id of this.execution.recover().uncertainExitOrders)this.uncertainOrders.add(id);this.started=true;this.record('trader-config',{mode:this.options.ledger.state().mode,candidateEvaluationOnly:this.candidateEvaluationOnly,financialExecutionAuthorized:!this.candidateEvaluationOnly,accountId:this.options.ledger.accountId,rule:{...PROVISIONAL_RULE,version:this.effectiveVersion},costs:{...this.options.costs},flowVerification:this.options.flowVerification??{verified:false,evidence:'unverified'},quoteRetrieval:this.options.deferPredictivelyRejectedQuotes===true?'RESEARCH_DEFER_ALREADY_REJECTED_PREDICTIVE_QUOTES':'EXISTING_QUOTE_FIRST_ORDER',...(this.pilotConfig?{pilot:{version:this.pilotConfig.version,contractSha256:this.pilotConfig.contractSha256,maxPositions:this.pilotConfig.maxPositions,...(this.pilotConfig.stage===null?{}:{stage:this.pilotConfig.stage}),amountConvention:'curve',entryDepositPreparation:'required-before-entry',contract:this.pilotConfig.contract}}:{})});}
  admit(input:CandidateEvidence){
    const now=this.clock();if(!validText(input.mint,96)||!validText(input.evidence)||!Number.isSafeInteger(input.migrationAt)||input.migrationAt<0||input.migrationAt>now)throw new Error('verified candidate identity/time required');
    const owned=this.options.ledger.state(),pendingMints=new Set(Object.values(owned.pending).map(order=>order.mint));
    // Completed financial history stays in the ledger. Retire only its no-longer
    // owned market record, so successive closed trades cannot consume deep slots.
    for(const mint of this.candidates.keys())if(mint!==input.mint&&!owned.positions[mint]&&!pendingMints.has(mint)&&this.options.ledger.hasTradedMint(mint)){this.candidates.delete(mint);this.pilotDeposits.delete(mint);}
    if(this.candidates.has(input.mint))return true;this.funnel.discovered++;
    const deepCount=[...this.candidates.keys()].filter(mint=>!owned.positions[mint]).length,capacity=deepCount>=this.maximumCandidates||this.candidates.size>=this.maximumCandidates+3;
    this.record('trader-input',{kind:'candidate',at:now,candidate:{mint:input.mint,migrationAt:input.migrationAt,migrationVerified:input.migrationVerified,supportedPool:input.supportedPool,evidence:input.evidence}});
    if(input.migrationVerified!==true||input.supportedPool!==true||capacity){this.decision({mint:input.mint,at:now,stage:'market-exclusion',reason:capacity?'candidate-capacity':'unsupported-or-unverified-pool',ruleVersion:PROVISIONAL_RULE.version});return false;}
    this.candidates.set(input.mint,{mint:input.mint,migrationAt:input.migrationAt,migrationVerified:input.migrationVerified,supportedPool:input.supportedPool,evidence:input.evidence,admittedAt:now,window:new FlowWindow(input.mint,now),active:false,everActivated:false,interrupted:false,evaluatedBucket:-1,evidenceDeferredBucket:-1,predictiveAssessedBucket:-1,knownSlot:null,informationPending:false});this.funnel.supported++;return true;
  }
  activateFlow(mint:string,evidence:string,openedAt?:number){const c=this.candidates.get(mint);if(!c||!validText(evidence))throw new Error('admitted pool and actual subscription evidence required');const now=this.clock(),at=openedAt??now;if(!Number.isSafeInteger(at)||at<0||at>now)throw new Error('actual nonfuture subscription ACK time required');if(at<c.admittedAt)throw new Error('information cannot be observed before it became available');c.window.features(now);if(c.everActivated||c.interrupted){if(openedAt===undefined)c.window.invalidate(at,'feed-gap');else c.window=new FlowWindow(mint,at);}else c.window=new FlowWindow(mint,at);c.everActivated=true;c.active=true;c.informationPending=false;c.evaluatedBucket=-1;this.record('trader-input',{kind:'flow-start',at,mint,evidence});}
  noteCandidateSlot(mint:string,slot:number){const c=this.candidates.get(mint);if(!c||!Number.isSafeInteger(slot)||slot<0)throw Error('admitted candidate and actual slot required');c.knownSlot=Math.max(c.knownSlot??0,slot);}
  /** Presence checks must not advance the candidate's receive-time window. */
  hasCandidate(mint:string){return this.candidates.has(mint);}
  candidateFeatures(mint:string,at=this.clock()){const c=this.candidates.get(mint);return c?c.window.features(at):null;}
  setCandidateInformationPending(mint:string,pending:boolean){const c=this.candidates.get(mint);if(!c||typeof pending!=='boolean')throw Error('admitted candidate and explicit information state required');c.informationPending=pending;this.record('trader-input',{kind:'candidate-information-pending',at:this.clock(),mint,pending});}
  /** A single incomplete candidate cannot cancel another candidate's entries
   * or disable management of held positions and owned financial actions. */
  candidateGap(mint:string,reason='candidate flow gap; fresh subscription and warming required'){
    const c=this.candidates.get(mint),at=this.clock();if(!c||!validText(reason))throw Error('admitted candidate and bounded gap reason required');
    c.window.invalidate(at,'feed-gap');c.active=false;c.interrupted=true;c.informationPending=true;
    const ownBuys=Object.values(this.options.ledger.state().pending).filter(o=>o.mint===mint&&o.side==='buy');
    if(ownBuys.length&&!this.financialUnavailable&&!ownBuys.some(o=>this.uncertainOrders.has(o.id)))this.options.ledger.cancelEntryOrders(this.id('candidate-cancel'),at,reason,mint);
    this.record('trader-input',{kind:'candidate-gap',at,mint,reason,financialUncertaintyPreserved:this.financialUnavailable||ownBuys.some(o=>this.uncertainOrders.has(o.id))});
  }
  ingest(trade:NormalizedTrade,amountConvention?:'curve'|'user'){
    if(this.pilot&&(amountConvention!=='curve'||!['confirmed','finalized'].includes(trade.commitment)||!Number.isSafeInteger(trade.slot)||trade.slot!<0)){this.feedGap();throw Error('pilot requires explicit curve amounts and confirmed executed flow with slot');}
    const c=this.candidates.get(trade.mint);if(!c||!c.active)return 'unselected';if(trade.receivedAt>this.clock())throw new Error('future flow information unavailable');
    const result=c.window.ingest(trade);
    if((this.pilot||this.options.deferPredictivelyRejectedQuotes===true)&&trade.slot!==undefined)c.knownSlot=Math.max(c.knownSlot??0,trade.slot);
    this.record('trader-input',{kind:'trade',...(this.pilot?{amountConvention:'curve'}:{}),trade:{identity:copyEventIdentity(trade.identity),mint:trade.mint,wallet:trade.wallet,side:trade.side,quoteLamports:trade.quoteLamports,tokenUnits:trade.tokenUnits,receivedAt:trade.receivedAt,commitment:trade.commitment,...(trade.slot===undefined?{}:{slot:trade.slot})}});return result;
  }
  reverse(mint:string,identity:EventIdentity){const c=this.candidates.get(mint);if(c){c.window.reverse(identity,this.clock());c.interrupted=true;}this.record('trader-input',{kind:'reversal',at:this.clock(),mint,identity:copyEventIdentity(identity)});}
  feedGap(){const at=this.clock();for(const c of this.candidates.values()){c.window.invalidate(at,'feed-gap');c.active=false;c.interrupted=true;}this.pause('feed gap; selected windows require fresh subscription and warming');this.record('trader-input',{kind:'gap',at});}
  /** Intentional upstream retirement is separate from losing the whole feed.
   * Held-position management comes from the ledger/RPC context, not this window.
   * The caller still must apply the upstream unsubscribe and verify its outcome.
   */
  deactivateFlow(mint:string,evidence:string){
    const c=this.candidates.get(mint),at=this.clock();
    if(!c||!validText(evidence))throw new Error('admitted token and subscription-retirement evidence required');
    if(Object.values(this.options.ledger.state().pending).some(o=>o.mint===mint&&o.side==='buy'&&o.expiresAt>at))throw new Error('pending entry flow remains required until outcome or expiry');
    c.window.invalidate(at,'feed-gap');c.active=false;c.interrupted=true;
    this.record('trader-input',{kind:'flow-stop',at,mint,evidence});
  }
  remove(mint:string){const state=this.options.ledger.state();if(state.positions[mint]||Object.values(state.pending).some(o=>o.mint===mint))throw new Error('held/pending observation has priority');this.candidates.delete(mint);this.pilotDeposits.delete(mint);}
  decisions(){return structuredClone(this.recent);}
  tick(options:TraderTickOptions={}){if(!this.started)return Promise.reject(new Error('trader recovery required'));if(!options||typeof options!=='object'||Array.isArray(options)||options.evaluateCandidates!==undefined&&typeof options.evaluateCandidates!=='boolean'||options.reuseFreshContext!==undefined&&typeof options.reuseFreshContext!=='boolean'||options.maximumDueActions!==undefined&&(!Number.isSafeInteger(options.maximumDueActions)||options.maximumDueActions<1||options.maximumDueActions>3)||options.candidateMint!==undefined&&(!validText(options.candidateMint,96)||!this.candidates.has(options.candidateMint)))return Promise.reject(new Error('bounded admitted candidate and explicit tick options required'));if(this.active)return this.active;const chosen=Object.freeze({evaluateCandidates:options.evaluateCandidates!==false,candidateMint:options.candidateMint,reuseFreshContext:options.reuseFreshContext===true,maximumDueActions:options.maximumDueActions});this.active=this.drain(chosen).finally(()=>{this.active=undefined;this.tickActionsRemaining=null;});return this.active;}
  private async read<T>(fn:(signal:AbortSignal)=>Promise<T>,outer?:AbortSignal,maxMs=this.options.timeoutMs??1000):Promise<T>{
    if(this.outstanding)throw new Error('previous market request has not canceled');
    const controller=new AbortController(),signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal;let timer:ReturnType<typeof setTimeout>|undefined;
    const request=Promise.resolve().then(()=>fn(signal));this.outstanding=request;
    void request.then(()=>{if(this.outstanding===request)this.outstanding=undefined;},()=>{if(this.outstanding===request)this.outstanding=undefined;});
    try{return await Promise.race([request,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('market request timeout'));},Math.max(1,Math.min(this.options.timeoutMs??1000,maxMs)));})]);}finally{clearTimeout(timer);controller.abort();}
  }
  private cleanQuote(q:SizeQuote|null,r:SizeRequest):SizeQuote|null{
    try{
      if(!q||q.mint!==r.mint||q.side!==r.side||q.inputUnits!==r.inputUnits||unsigned(q.outputUnits)===0n||!validText(q.evidence)||!Number.isSafeInteger(q.at)||q.at>this.clock()||this.clock()-q.at>PROVISIONAL_RULE.maximumQuoteAgeMs)return null;
      if(q.slot!==undefined&&(!Number.isSafeInteger(q.slot)||q.slot<0))return null;
      const floor=r.side==='buy'&&(this.pilot||this.options.deferPredictivelyRejectedQuotes===true)?Math.max(r.minSlot??0,this.candidates.get(r.mint)?.knownSlot??0):r.minSlot;
      if(floor!==undefined&&(!Number.isSafeInteger(floor)||floor<0||q.slot===undefined||q.slot<floor))return null;
      if(this.pilot&&r.side==='buy'&&(q.requiredDepositLamports!==r.requiredDepositLamports||!validText(q.depositEvidence)))return null;
      const cleaned={mint:q.mint,side:q.side,inputUnits:q.inputUnits,outputUnits:q.outputUnits,at:q.at,evidence:q.evidence,...(q.slot===undefined?{}:{slot:q.slot}),...(q.effectiveQuoteLiquidityLamports===undefined?{}:{effectiveQuoteLiquidityLamports:unsigned(q.effectiveQuoteLiquidityLamports).toString()}),...(q.refundedDepositLamports===undefined?{}:{refundedDepositLamports:unsigned(q.refundedDepositLamports).toString()}),...(validText(q.refundEvidence)?{refundEvidence:q.refundEvidence}:{}),...(this.pilot&&r.side==='buy'?{requiredDepositLamports:unsigned(q.requiredDepositLamports!).toString(),depositEvidence:q.depositEvidence!}:{})};
      if((this.pilot||this.options.deferPredictivelyRejectedQuotes===true)&&cleaned.slot!==undefined){const c=this.candidates.get(r.mint);if(c)c.knownSlot=Math.max(c.knownSlot??0,cleaned.slot);}
      return cleaned;
    }catch{return null;}
  }
  private withKnownFloor(request:SizeRequest):Readonly<SizeRequest>{return Object.freeze({...request,...(request.side==='buy'&&(this.pilot||this.options.deferPredictivelyRejectedQuotes===true)?{minSlot:Math.max(request.minSlot??0,this.candidates.get(request.mint)?.knownSlot??0)}:{})});}
  private async estimate(request:SizeRequest){
    const expected=this.withKnownFloor(request),due=this.execution.nextDueAt();let q:SizeQuote|null=null;
    if(due===null||due>this.clock()){try{q=this.cleanQuote(await this.read(s=>this.options.quote(Object.freeze({...expected}),s),undefined,due===null?undefined:due-this.clock()),expected);}catch{}}
    this.record('trader-quote',{at:this.clock(),purpose:'decision',request:{...expected},quote:q});return q;
  }
  private async attempts(){
    if(this.tickActionsRemaining===0)return [];
    const pending=this.options.ledger.state().pending,batch=await this.execution.runDue(this.tickActionsRemaining===null?{}:{maxActions:this.tickActionsRemaining as 1|2|3});
    if(this.tickActionsRemaining!==null)this.tickActionsRemaining-=batch.servicedActions??0;
    for(const result of batch.results){const side=pending[result.orderId]?.side;
      if(result.status==='uncertain')this.uncertainOrders.add(result.orderId);else this.uncertainOrders.delete(result.orderId);
      if(result.status==='filled'||result.status==='failed')this.funnel.attempted++;
      if(result.status==='filled'){if(side==='buy')this.funnel.paperFilled++;else if(side==='sell')this.funnel.exited++;}
      this.record('trader-execution',{...result,side:side??'unavailable'});
    }for(const id of this.uncertainOrders)if(!this.options.ledger.state().pending[id])this.uncertainOrders.delete(id);
    if(this.uncertainOrders.size)this.pause('financial action unresolved; entries closed and reservations preserved');return batch.results;
  }
  private async dueActions(){const due=this.execution.nextDueAt();return due!==null&&due<=this.clock()?this.attempts():[];}
  private sourceCurrent(at:number){return this.context.sourceValidUntil===undefined||Number.isSafeInteger(this.context.sourceValidUntil)&&this.context.sourceValidUntil>=at;}
  private entriesAllowed(c:Candidate,at:number){
    let checkedAt=at;
    if(this.options.candidateReadiness!==undefined){try{if(this.options.candidateReadiness(c.mint,at)!==true)return false;checkedAt=this.clock();if(Math.floor(checkedAt/PROVISIONAL_RULE.bucketMs)!==Math.floor(at/PROVISIONAL_RULE.bucketMs))return false;}catch{return false;}}
    const state=this.options.ledger.state(),pending=Object.values(state.pending);
    return !!(this.context.price&&(!Object.keys(state.positions).length||this.sourceCurrent(checkedAt))&&(!this.pilot||this.pilotDepositFor(c.mint)!==null)&&Object.keys(state.positions).length+pending.filter(o=>o.side==='buy').length<(this.pilotConfig?.maxPositions??3)&&!pending.some(o=>o.mint===c.mint)&&!this.evidenceUnavailable&&!this.financialUnavailable&&!this.uncertainOrders.size&&this.candidates.get(c.mint)===c&&c.active&&!c.informationPending&&this.options.ledger.projection(checkedAt,this.context.price,this.context.marks).entriesEnabled&&!(state.mode==='PAPER'&&!this.pilot&&PROVISIONAL_RULE.version.endsWith('unfrozen')));
  }
  /** An unavailable audit is not a completed candidate evaluation. A later
   * valid audit may arrive within this same decision bucket. This synchronous
   * evidence check performs no quote/provider work and grants no entry right;
   * financial readiness, current slot floors and quote validity are rechecked
   * by the existing reservation path. Completed decisions remain once/bucket.
   */
  private candidateEvidenceReady(c:Candidate,at:number){
    const ready=this.options.predictiveReadiness??this.options.candidateReadiness;
    if(ready===undefined)return true;
    let available=false;try{available=ready(c.mint,at)===true;}catch{}
    const checkedAt=this.clock();return available&&this.candidates.get(c.mint)===c&&c.active&&!c.informationPending&&Math.floor(checkedAt/PROVISIONAL_RULE.bucketMs)===Math.floor(at/PROVISIONAL_RULE.bucketMs);
  }
  private reserveExit(mint:string,q:SizeQuote,reason:string){
    const now=this.clock(),min=unsigned(q.outputUnits)*BigInt(10_000-this.options.costs.slippageBps)/10_000n;
    if(min===0n)return;
    this.execution.reserve({id:`sell:${this.options.ledger.state().revision}:${now}`,side:'sell',mint,decidedAt:now,executeAt:now+PROVISIONAL_RULE.modeledDelayMs,expiresAt:now+PROVISIONAL_RULE.orderExpiryMs,gas:this.options.costs.gasLamports,deposit:'0',maxSpend:'0',minReceive:min.toString(),decisionEvidence:q.evidence},this.context);
    this.decision({mint,at:now,stage:'exit-reserved',reason,ruleVersion:PROVISIONAL_RULE.version,quote:q});
  }
  private reusableContext(positions:Readonly<Record<string,Position>>){
    try{
      const now=this.clock(),keys=Object.keys(positions).sort(),same=(other:string[])=>other.sort().length===keys.length&&other.every((mint,i)=>mint===keys[i]);
      if(!this.contextInventory||!same(Object.keys(this.contextInventory))||!same(Object.keys(this.context.marks)))return false;
      if(keys.length&&(!Number.isSafeInteger(this.context.sourceValidUntil)||this.context.sourceValidUntil!<now))return false;
      const price=this.context.price;if(!price||unsigned(price.microUsdPerSol)===0n||!validText(price.source)||!Number.isSafeInteger(price.at)||price.at<0||price.at>now||now-price.at>10000)return false;
      return keys.every(mint=>{const p=positions[mint]!,m=this.context.marks[mint];return this.contextInventory![mint]===p.units&&!!m&&m.pricedBaseUnits===p.units&&Number.isSafeInteger(m.at)&&m.at>=0&&m.at<=now&&now-m.at<=PROVISIONAL_RULE.maximumQuoteAgeMs&&validText(m.evidence)&&unsigned(m.netLamports)>=0n;});
    }catch{return false;}
  }
  private predictiveAssessment(c:Candidate,decision:RuleDecision){
    if(this.evidenceUnavailable||!this.pilot||this.options.predictiveDiagnostics!==true||!c.active||c.informationPending||this.options.flowVerification?.verified!==true||!decision.features)return;
    const initialAt=this.clock(),bucket=Math.floor(initialAt/PROVISIONAL_RULE.bucketMs);
    if(c.predictiveAssessedBucket===bucket||Math.floor(decision.at/PROVISIONAL_RULE.bucketMs)!==bucket)return;
    const original=assessPredictiveBuying(decision.features,decision.at);if(!original.features?.sufficientlyObserved)return;
    let ready=false;try{ready=(this.options.predictiveReadiness??this.options.candidateReadiness)?.(c.mint,initialAt)===true;}catch{return;}
    const availableAt=this.clock();if(!ready||Math.floor(availableAt/PROVISIONAL_RULE.bucketMs)!==bucket||this.candidates.get(c.mint)!==c||!c.active||c.informationPending)return;
    // Re-read only bounded in-memory features at actual diagnostic availability;
    // no quote/provider work or change to the existing primary risk decision.
    const assessment=assessPredictiveBuying(c.window.features(availableAt),availableAt);if(assessment.status==='unavailable'||!assessment.features)return;
    c.predictiveAssessedBucket=bucket;this.record('trader-predictive-assessment',{mint:c.mint,at:availableAt,windowEndAt:assessment.features.windowEndAt,status:assessment.status,reason:assessment.reason,features:assessment.features,riskDecision:{kind:decision.kind,reason:decision.reason},meaning:'Predictive predicates only; no eligibility, quote, risk or entry permission is granted.'});
  }
  private assertCandidateOnlyState(){
    const state=this.options.ledger.state();
    if(state.controls.entriesEnabled||Object.keys(state.positions).length||Object.keys(state.pending).length)throw Error('candidate-only mode requires closed financial permission and no unresolved exposure');
  }
  /** Same frozen feature predicates/readiness; financial permission is
   * intentionally absent. No context, quote, reconciliation or order method. */
  private observeCandidates(options:Readonly<{evaluateCandidates:boolean;candidateMint:string|undefined}>){
    this.assertCandidateOnlyState();if(this.evidenceUnavailable)throw Error('candidate evaluation selected evidence unavailable');
    if(options.evaluateCandidates)for(const c of this.candidates.values()){
      if(options.candidateMint!==undefined&&c.mint!==options.candidateMint)continue;
      const at=this.clock(),bucket=Math.floor(at/PROVISIONAL_RULE.bucketMs);
      if(c.evaluatedBucket===bucket)continue;c.evaluatedBucket=bucket;
      const features=c.window.features(at),fields=this.options.flowVerification;
      const decision=evaluatePrimary(features,{mint:c.mint,now:at,migrationAt:c.migrationAt,migrationVerified:c.migrationVerified,supportedPool:c.supportedPool,flowFieldsVerified:fields?.verified===true&&c.active,flowVerificationEvidence:fields?.evidence??null,riskEntriesAllowed:false,alreadyTradedMint:this.options.ledger.hasTradedMint(c.mint),quote:null});
      this.funnel.evaluated++;if(features.sufficientlyObserved&&c.active&&fields?.verified===true)this.funnel.sufficientlyObserved++;
      this.decision({mint:c.mint,at:this.clock(),stage:decision.reason==='entries-not-authorized-by-ledger'?'candidate-observation':decision.kind,reason:decision.reason==='entries-not-authorized-by-ledger'?'financial-execution-intentionally-disabled':decision.reason,ruleVersion:decision.ruleVersion,features:decision.features,quote:null,...(decision.reason==='entries-not-authorized-by-ledger'?{permissionContext:{mode:'candidate-evaluation' as const,primaryKind:decision.kind,primaryReason:decision.reason,performanceFailure:false as const}}:{})});
      this.predictiveAssessment(c,decision);
    }
    this.assertCandidateOnlyState();if(this.evidenceUnavailable)throw Error('candidate evaluation selected evidence unavailable');return {execution:[] as ExecutionResult[],nextDueAt:null};
  }
  private async drain(options:Readonly<{evaluateCandidates:boolean;candidateMint:string|undefined;reuseFreshContext:boolean;maximumDueActions:1|2|3|undefined}>){
    if(this.candidateEvaluationOnly)return this.observeCandidates(options);
    this.tickActionsRemaining=options.maximumDueActions??null;
    const execution:ExecutionResult[]=[];
    if(this.pilot)execution.push(...await this.dueActions());
    try{
      const positions=this.options.ledger.state().positions;
      if(options.reuseFreshContext&&this.reusableContext(positions))this.record('trader-context-reuse',{at:this.clock(),priceAt:this.context.price!.at,marksAt:Object.fromEntries(Object.entries(this.context.marks).map(([mint,m])=>[mint,m.at])),...(this.context.sourceValidUntil===undefined?{}:{sourceValidUntil:this.context.sourceValidUntil}),meaning:'Existing exact-size facts retain their original timestamps; this is not a newly completed market evaluation.'});
      else{const raw=await this.read(s=>this.options.context(structuredClone(positions),s));
        if(Object.keys(positions).length&&raw.sourceValidUntil!==undefined&&(!Number.isSafeInteger(raw.sourceValidUntil)||raw.sourceValidUntil<this.clock()))throw Error('held market context source expired or invalid');
        this.context={price:raw.price?{microUsdPerSol:raw.price.microUsdPerSol,at:raw.price.at,source:raw.price.source}:null,marks:Object.fromEntries(Object.keys(positions).filter(mint=>raw.marks[mint]).map(mint=>{const m=raw.marks[mint]!;return [mint,{netLamports:m.netLamports,pricedBaseUnits:m.pricedBaseUnits,at:m.at,evidence:m.evidence}];})),...(Number.isSafeInteger(raw.sourceValidUntil)?{sourceValidUntil:raw.sourceValidUntil}:{})};this.contextInventory=Object.fromEntries(Object.entries(positions).map(([mint,p])=>[mint,p.units]));}
    }catch{this.context={price:null,marks:{}};this.contextInventory=null;}
    const now=this.clock();this.record('trader-context',{at:now,context:this.context});this.record('trader-input',{kind:'tick',at:now});
    try{const at=this.clock();if(!this.context.price||Object.keys(this.options.ledger.state().positions).length&&!this.sourceCurrent(at))throw new Error();this.options.ledger.reconcile(this.id('reconcile'),at,this.context.price,this.context.marks);this.funnel.reconciled++;}catch{this.pause('current equity or liquidation unavailable; entries closed');}
    execution.push(...await this.attempts());
    // Existing exposure and pending actions always precede any candidate quote.
    for(const position of Object.values(this.options.ledger.state().positions)){
      execution.push(...await this.dueActions());if(!this.options.ledger.state().positions[position.mint])continue;
      const evaluatedAt=this.clock(),mark=this.sourceCurrent(evaluatedAt)?this.context.marks[position.mint]??null:null,exit=evaluateExit({now:evaluatedAt,enteredAt:position.enteredAt,entryCostLamports:(unsigned(position.entryLamports)+unsigned(position.entryGas)).toString(),heldBaseUnits:position.units,mark});
      const pendingExit=Object.values(this.options.ledger.state().pending).some(o=>o.mint===position.mint&&o.side==='sell');
      const completed=(outcome:string)=>{const completedAt=this.clock();this.record('trader-held-evaluation',{mint:position.mint,units:position.units,evaluatedAt,completedAt,quoteAt:mark?.at??null,sourceValidUntil:this.context.sourceValidUntil??null,usable:!!mark&&mark.pricedBaseUnits===position.units&&mark.at<=completedAt&&completedAt-mark.at<=PROVISIONAL_RULE.maximumQuoteAgeMs&&this.sourceCurrent(completedAt)&&/^(0|[1-9][0-9]{0,38})$/.test(mark.netLamports)&&validText(mark.evidence),action:exit.action,reason:exit.reason,pendingExit,outcome});};
      // A retained owned exit blocks duplicate actions, not observation. This
      // pure evaluation records current evidence without replacing the action.
      if(pendingExit){completed('owned-exit-retained');continue;}
      if(exit.action!=='request-exit'){completed(exit.action);continue;}
      let q=await this.estimate({mint:position.mint,side:'sell',inputUnits:position.units});
      execution.push(...await this.dueActions());const currentPosition=this.options.ledger.state().positions[position.mint];if(!currentPosition)continue;
      // A higher-priority action can make this earlier quote stale or change
      // the holding. Retain exposure and require a later fresh decision.
      if(q)q=this.cleanQuote(q,{mint:position.mint,side:'sell',inputUnits:currentPosition.units});
      if(q)this.reserveExit(position.mint,q,exit.reason);else this.decision({mint:position.mint,at:this.clock(),stage:'execution-unavailable',reason:'fresh actual-size exit quote unavailable; position preserved',ruleVersion:PROVISIONAL_RULE.version});
      completed(q?'exit-reserved':'exit-quote-unavailable');
    }
    const nextFinancial=this.execution.nextDueAt();
    if(!options.evaluateCandidates||options.maximumDueActions!==undefined&&Object.keys(this.options.ledger.state().pending).length>0)return {execution,nextDueAt:nextFinancial};
    for(const c of this.candidates.values()){
      if(options.candidateMint!==undefined&&c.mint!==options.candidateMint)continue;
      execution.push(...await this.dueActions());
      const eligibilityAt=this.clock(),bucket=Math.floor(eligibilityAt/PROVISIONAL_RULE.bucketMs);if(c.evaluatedBucket===bucket)continue;
      if(!this.candidateEvidenceReady(c,eligibilityAt)){
        if(c.evidenceDeferredBucket!==bucket){c.evidenceDeferredBucket=bucket;this.record('trader-candidate-evidence-deferred',{mint:c.mint,at:this.clock(),windowEndAt:bucket*PROVISIONAL_RULE.bucketMs,reason:'current complete audited evidence unavailable; decision bucket remains available',financialPermissionGranted:false});}
        continue;
      }
      const at=this.clock();if(Math.floor(at/PROVISIONAL_RULE.bucketMs)!==bucket)continue;
      c.evaluatedBucket=bucket;
      const entryDeposit=this.pilot?this.pilotDepositFor(c.mint)?.lamports??this.options.costs.depositLamports:this.options.costs.depositLamports;
      const features=c.window.features(at),state=this.options.ledger.state(),fields=this.options.flowVerification;
      const risk=this.entriesAllowed(c,at);
      const context={mint:c.mint,now:at,migrationAt:c.migrationAt,migrationVerified:c.migrationVerified,supportedPool:c.supportedPool,flowFieldsVerified:fields?.verified===true&&c.active,flowVerificationEvidence:fields?.evidence??null,riskEntriesAllowed:risk,alreadyTradedMint:this.options.ledger.hasTradedMint(c.mint),quote:null};
      let decision=evaluatePrimary(features,context),q:SizeQuote|null=null;
      if(this.options.deferPredictivelyRejectedQuotes===true&&decision.reason==='fresh-size-specific-quote-unavailable'){
        const rejected=quoteIndependentRefusal(decision);
        if(rejected){decision=rejected;this.record('trader-quote-deferred',{mint:c.mint,at,reason:rejected.reason,featuresAsOf:features.asOf,knownSlotFloor:c.knownSlot,quoteSupportRefreshed:false,meaning:'Same predictive rule already rejects; current quote/support/liquidity knowledge was not obtained. No entry qualification or held-position protection depends on this skipped read.'});}
      }
      if(decision.reason==='fresh-size-specific-quote-unavailable'&&this.context.price){
        const price=unsigned(this.context.price.microUsdPerSol),budget=BigInt(PROVISIONAL_RULE.maximumInitialCostMicroUsd)*1_000_000_000n/price-unsigned(this.options.costs.gasLamports)-unsigned(entryDeposit);
        if(budget>0n){q=await this.estimate({mint:c.mint,side:'buy',inputUnits:budget.toString(),...(this.pilot?{requiredDepositLamports:entryDeposit}:{})});
          execution.push(...await this.dueActions());
          // Servicing pending actions can yield while new selected evidence
          // raises the floor. Recheck at actual rule use, without refreshing q.
          if(q&&(this.pilot||this.options.deferPredictivelyRejectedQuotes===true))q=this.cleanQuote(q,this.withKnownFloor({mint:c.mint,side:'buy',inputUnits:budget.toString(),...(this.pilot?{requiredDepositLamports:entryDeposit}:{})}));
          if(q){let liquidityBps=10_001;try{const liquidity=unsigned(q.effectiveQuoteLiquidityLamports??'0');if(liquidity>0n)liquidityBps=Number((budget*10_000n+liquidity-1n)/liquidity);}catch{}
            const current=this.clock();decision=evaluatePrimary(c.window.features(current),{...context,now:current,flowFieldsVerified:fields?.verified===true&&c.active,riskEntriesAllowed:this.entriesAllowed(c,current),alreadyTradedMint:this.options.ledger.hasTradedMint(c.mint),quote:{mint:q.mint,at:q.at,evidence:q.evidence,allInInitialCostMicroUsd:((budget+unsigned(this.options.costs.gasLamports)+unsigned(entryDeposit))*price/1_000_000_000n).toString(),sizeToEffectiveLiquidityBps:liquidityBps,expectedBaseUnits:q.outputUnits}});
          }
        }
      }
      c.evaluatedBucket=Math.max(c.evaluatedBucket,Math.floor(decision.at/PROVISIONAL_RULE.bucketMs));
      this.funnel.evaluated++;if(features.sufficientlyObserved&&c.active&&fields?.verified===true)this.funnel.sufficientlyObserved++;
      this.decision({mint:c.mint,at:this.clock(),stage:decision.kind,reason:decision.reason,ruleVersion:decision.ruleVersion,features:decision.features,quote:q});
      this.predictiveAssessment(c,decision);
      if(decision.qualified&&q&&this.options.candidateReadiness!==undefined)q=this.cleanQuote(q,this.withKnownFloor({mint:c.mint,side:'buy',inputUnits:q.inputUnits,...(this.pilot?{requiredDepositLamports:entryDeposit}:{})}));
      const reservationAt=this.clock(),reservationReady=decision.qualified&&q&&!this.evidenceUnavailable&&this.entriesAllowed(c,reservationAt);
      if(reservationReady&&q){this.funnel.qualified++;const at=reservationAt,min=unsigned(q.outputUnits)*BigInt(10_000-this.options.costs.slippageBps)/10_000n;
        if(min>0n){try{const result=this.execution.reserve({id:`buy:${this.options.ledger.state().revision}:${at}`,side:'buy',mint:c.mint,decidedAt:at,executeAt:at+PROVISIONAL_RULE.modeledDelayMs,expiresAt:at+PROVISIONAL_RULE.orderExpiryMs,gas:this.options.costs.gasLamports,deposit:entryDeposit,maxSpend:q.inputUnits,minReceive:min.toString(),decisionEvidence:q.evidence},this.context);if('reserved' in result){this.funnel.reserved++;break;}else this.decision({mint:c.mint,at,stage:'risk-rejection',reason:result.rejected,ruleVersion:PROVISIONAL_RULE.version});}catch(error){
          const reason=error instanceof Error?error.message:'';
          const expected=['pending capacity','position capacity','$150 cost limit','$50 initial commitment limit','insufficient unreserved cash','one pending action per token','adds/re-entry into held position forbidden','re-entry after a prior PAPER fill forbidden','existing account deposit cannot be charged twice','unresolved deposit capacity'].includes(reason);
          if(!expected){this.financialUnavailable=true;this.pause('financial reservation unavailable; preserve records and close entries');}
          this.decision({mint:c.mint,at,stage:expected?'risk-rejection':'execution-unavailable',reason:expected?reason:'financial reservation unavailable; state preserved',ruleVersion:PROVISIONAL_RULE.version});
        }}
      }
    }
    return {execution,nextDueAt:this.execution.nextDueAt()};
  }
}
