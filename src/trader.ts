import {PaperLedger,type ExecutionQuote,type Mark,type Position} from './ledger.js';
import {PaperExecutionCoordinator,type ExecutionContext,type ExecutionResult} from './execution.js';
import {FlowWindow,PROVISIONAL_RULE,evaluateExit,evaluatePrimary,type EventIdentity,type NormalizedTrade,type RuleDecision} from './strategy.js';

export type CandidateEvidence={mint:string;migrationAt:number;migrationVerified:boolean;supportedPool:boolean;evidence:string};
export type SizeRequest={mint:string;side:'buy'|'sell';inputUnits:string};
export type SizeQuote=SizeRequest&{outputUnits:string;at:number;evidence:string;effectiveQuoteLiquidityLamports?:string;refundedDepositLamports?:string;refundEvidence?:string};
export type TraderOptions={
  ledger:PaperLedger;now?:()=>number;
  context:(positions:Readonly<Record<string,Position>>,signal:AbortSignal)=>Promise<ExecutionContext>;
  quote:(request:SizeRequest,signal:AbortSignal)=>Promise<SizeQuote|null>;
  costs:{gasLamports:string;depositLamports:string;slippageBps:number;evidence:string};
  recorder:{record:(kind:string,data:unknown)=>void};
  flowVerification?:{verified:boolean;evidence:string};
  timeoutMs?:number;
};
type Candidate=CandidateEvidence&{window:FlowWindow;active:boolean;everActivated:boolean;interrupted:boolean;evaluatedBucket:number};
type Decision={mint:string;at:number;stage:string;reason:string;ruleVersion:string;features?:RuleDecision['features'];quote?:SizeQuote|null};
const validText=(s:unknown,max=512):s is string=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\u0000-\u001f]/.test(s);
const unsigned=(s:string)=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(s))throw new Error('bounded integer amount required');return BigInt(s);};

/** Offline adapter-driven integration. It never initializes capital, enables
 * entries, loads credentials or owns a second database. The current unfrozen
 * rule cannot enter a production PAPER account, even if an adapter says ready.
 */
export class PaperTrader{
  private readonly now:()=>number;
  private readonly candidates=new Map<string,Candidate>();
  private readonly recent:Decision[]=[];
  private context:ExecutionContext={price:null,marks:{}};
  private active:Promise<{execution:ExecutionResult[];nextDueAt:number|null}>|undefined;
  private outstanding:Promise<unknown>|undefined;
  private evidenceUnavailable=false;
  private financialUnavailable=false;
  private readonly uncertainOrders=new Set<string>();
  private started=false;
  private readonly execution:PaperExecutionCoordinator;
  readonly funnel={discovered:0,supported:0,sufficientlyObserved:0,evaluated:0,qualified:0,reserved:0,attempted:0,paperFilled:0,exited:0,reconciled:0};
  constructor(private readonly options:TraderOptions){
    this.options={...options,costs:Object.freeze({gasLamports:options.costs.gasLamports,depositLamports:options.costs.depositLamports,slippageBps:options.costs.slippageBps,evidence:options.costs.evidence}),flowVerification:options.flowVerification?Object.freeze({verified:options.flowVerification.verified,evidence:options.flowVerification.evidence}):undefined};
    this.now=options.now??Date.now;unsigned(options.costs.gasLamports);unsigned(options.costs.depositLamports);
    if(unsigned(options.costs.gasLamports)===0n||!validText(options.costs.evidence)||!Number.isSafeInteger(options.costs.slippageBps)||options.costs.slippageBps<0||options.costs.slippageBps>1000||!Number.isSafeInteger(options.timeoutMs??1000)||(options.timeoutMs??1000)<1||(options.timeoutMs??1000)>10_000)throw new Error('explicit bounded simulated execution costs required');
    this.execution=new PaperExecutionCoordinator({ledger:options.ledger,now:this.now,timeoutMs:options.timeoutMs??1000,context:async()=>this.context,quote:async(request,signal)=>{
      const input=Object.freeze({mint:request.order.mint,side:request.order.side,inputUnits:request.order.side==='buy'?request.order.maxSpend:request.fullPositionBaseUnits!});
      const q=this.cleanQuote(await this.read(s=>this.options.quote(Object.freeze({...input}),s),signal),input);
      this.record('trader-quote',{at:this.clock(),purpose:'execution',request:input,quote:q});
      if(!q)return null;
      return {at:q.at,evidence:q.evidence,spendLamports:request.order.side==='buy'?q.inputUnits:'0',receiveUnits:q.outputUnits,...(request.order.side==='sell'?{pricedBaseUnits:q.inputUnits,refundedDepositLamports:q.refundedDepositLamports,refundEvidence:q.refundEvidence}:{})} satisfies ExecutionQuote;
    }});
  }
  private clock(){const at=this.now();if(!Number.isSafeInteger(at)||at<0)throw new Error('actual receive wall time required');return at;}
  private id(kind:string){return `trader:${kind}:${this.options.ledger.state().revision}:${this.clock()}`;}
  private pause(reason:string){
    const state=this.options.ledger.state(),at=this.clock(),buys=Object.values(state.pending).some(o=>o.side==='buy');
    if(state.controls.entriesEnabled)this.options.ledger.pause(this.id('pause'),at,reason);
    if(buys&&!this.financialUnavailable&&!this.uncertainOrders.size)this.options.ledger.cancelEntryOrders(this.id('cancel'),at,reason);
  }
  private record(kind:string,data:unknown){try{this.options.recorder.record(kind,data);}catch{this.evidenceUnavailable=true;this.pause('selected evidence unavailable; entries closed');}}
  private decision(decision:Decision){this.recent.push(structuredClone(decision));if(this.recent.length>50)this.recent.shift();this.record('trader-decision',decision);}
  start(){if(this.started)return;for(const id of this.execution.recover().uncertainExitOrders)this.uncertainOrders.add(id);this.started=true;this.record('trader-config',{mode:this.options.ledger.state().mode,accountId:this.options.ledger.accountId,rule:PROVISIONAL_RULE,costs:{...this.options.costs},flowVerification:this.options.flowVerification??{verified:false,evidence:'unverified'}});}
  admit(input:CandidateEvidence){
    const now=this.clock();if(!validText(input.mint,96)||!validText(input.evidence)||!Number.isSafeInteger(input.migrationAt)||input.migrationAt<0||input.migrationAt>now)throw new Error('verified candidate identity/time required');
    if(this.candidates.has(input.mint))return true;this.funnel.discovered++;
    this.record('trader-input',{kind:'candidate',at:now,candidate:{mint:input.mint,migrationAt:input.migrationAt,migrationVerified:input.migrationVerified,supportedPool:input.supportedPool,evidence:input.evidence}});
    if(input.migrationVerified!==true||input.supportedPool!==true||this.candidates.size>=12){this.decision({mint:input.mint,at:now,stage:'market-exclusion',reason:this.candidates.size>=12?'candidate-capacity':'unsupported-or-unverified-pool',ruleVersion:PROVISIONAL_RULE.version});return false;}
    this.candidates.set(input.mint,{mint:input.mint,migrationAt:input.migrationAt,migrationVerified:input.migrationVerified,supportedPool:input.supportedPool,evidence:input.evidence,window:new FlowWindow(input.mint,now),active:false,everActivated:false,interrupted:false,evaluatedBucket:-1});this.funnel.supported++;return true;
  }
  activateFlow(mint:string,evidence:string){const c=this.candidates.get(mint);if(!c||!validText(evidence))throw new Error('admitted pool and actual subscription evidence required');const at=this.clock();c.window.features(at);if(c.everActivated||c.interrupted)c.window.invalidate(at,'feed-gap');else c.window=new FlowWindow(mint,at);c.everActivated=true;c.active=true;c.evaluatedBucket=-1;this.record('trader-input',{kind:'flow-start',at,mint,evidence});}
  ingest(trade:NormalizedTrade){
    const c=this.candidates.get(trade.mint);if(!c||!c.active)return 'unselected';if(trade.receivedAt>this.clock())throw new Error('future flow information unavailable');
    const result=c.window.ingest(trade);
    this.record('trader-input',{kind:'trade',trade:{identity:{signature:trade.identity.signature,instructionIndex:trade.identity.instructionIndex,eventIndex:trade.identity.eventIndex},mint:trade.mint,wallet:trade.wallet,side:trade.side,quoteLamports:trade.quoteLamports,tokenUnits:trade.tokenUnits,receivedAt:trade.receivedAt,commitment:trade.commitment,...(trade.slot===undefined?{}:{slot:trade.slot})}});return result;
  }
  reverse(mint:string,identity:EventIdentity){const c=this.candidates.get(mint);if(c){c.window.reverse(identity,this.clock());c.interrupted=true;}this.record('trader-input',{kind:'reversal',at:this.clock(),mint,identity:{signature:identity.signature,instructionIndex:identity.instructionIndex,eventIndex:identity.eventIndex}});}
  feedGap(){const at=this.clock();for(const c of this.candidates.values()){c.window.invalidate(at,'feed-gap');c.active=false;c.interrupted=true;}this.pause('feed gap; selected windows require fresh subscription and warming');this.record('trader-input',{kind:'gap',at});}
  remove(mint:string){const state=this.options.ledger.state();if(state.positions[mint]||Object.values(state.pending).some(o=>o.mint===mint))throw new Error('held/pending observation has priority');this.candidates.delete(mint);}
  decisions(){return structuredClone(this.recent);}
  tick(){if(!this.started)return Promise.reject(new Error('trader recovery required'));if(this.active)return this.active;this.active=this.drain().finally(()=>{this.active=undefined;});return this.active;}
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
      return {mint:q.mint,side:q.side,inputUnits:q.inputUnits,outputUnits:q.outputUnits,at:q.at,evidence:q.evidence,...(q.effectiveQuoteLiquidityLamports===undefined?{}:{effectiveQuoteLiquidityLamports:unsigned(q.effectiveQuoteLiquidityLamports).toString()}),...(q.refundedDepositLamports===undefined?{}:{refundedDepositLamports:unsigned(q.refundedDepositLamports).toString()}),...(validText(q.refundEvidence)?{refundEvidence:q.refundEvidence}:{})};
    }catch{return null;}
  }
  private async estimate(request:SizeRequest){
    const expected=Object.freeze({...request}),due=this.execution.nextDueAt();let q:SizeQuote|null=null;
    if(due===null||due>this.clock()){try{q=this.cleanQuote(await this.read(s=>this.options.quote(Object.freeze({...expected}),s),undefined,due===null?undefined:due-this.clock()),expected);}catch{}}
    this.record('trader-quote',{at:this.clock(),purpose:'decision',request:{...expected},quote:q});return q;
  }
  private async attempts(){
    const pending=this.options.ledger.state().pending,batch=await this.execution.runDue();
    for(const result of batch.results){const side=pending[result.orderId]?.side;
      if(result.status==='uncertain')this.uncertainOrders.add(result.orderId);else this.uncertainOrders.delete(result.orderId);
      if(result.status==='filled'||result.status==='failed')this.funnel.attempted++;
      if(result.status==='filled'){if(side==='buy')this.funnel.paperFilled++;else if(side==='sell')this.funnel.exited++;}
      this.record('trader-execution',{...result,side:side??'unavailable'});
    }for(const id of this.uncertainOrders)if(!this.options.ledger.state().pending[id])this.uncertainOrders.delete(id);
    if(this.uncertainOrders.size)this.pause('financial action unresolved; entries closed and reservations preserved');return batch.results;
  }
  private async dueActions(){const due=this.execution.nextDueAt();return due!==null&&due<=this.clock()?this.attempts():[];}
  private entriesAllowed(c:Candidate,at:number){
    const state=this.options.ledger.state(),pending=Object.values(state.pending);
    return !!(this.context.price&&Object.keys(state.positions).length+pending.filter(o=>o.side==='buy').length<3&&!pending.some(o=>o.mint===c.mint)&&!this.evidenceUnavailable&&!this.financialUnavailable&&!this.uncertainOrders.size&&c.active&&this.options.ledger.projection(at,this.context.price,this.context.marks).entriesEnabled&&!(state.mode==='PAPER'&&PROVISIONAL_RULE.version.endsWith('unfrozen')));
  }
  private reserveExit(mint:string,q:SizeQuote,reason:string){
    const now=this.clock(),min=unsigned(q.outputUnits)*BigInt(10_000-this.options.costs.slippageBps)/10_000n;
    if(min===0n)return;
    this.execution.reserve({id:`sell:${this.options.ledger.state().revision}:${now}`,side:'sell',mint,decidedAt:now,executeAt:now+PROVISIONAL_RULE.modeledDelayMs,expiresAt:now+PROVISIONAL_RULE.orderExpiryMs,gas:this.options.costs.gasLamports,deposit:'0',maxSpend:'0',minReceive:min.toString(),decisionEvidence:q.evidence},this.context);
    this.decision({mint,at:now,stage:'exit-reserved',reason,ruleVersion:PROVISIONAL_RULE.version,quote:q});
  }
  private async drain(){
    const execution:ExecutionResult[]=[];
    try{
      const positions=this.options.ledger.state().positions,raw=await this.read(s=>this.options.context(structuredClone(positions),s));
      this.context={price:raw.price?{microUsdPerSol:raw.price.microUsdPerSol,at:raw.price.at,source:raw.price.source}:null,marks:Object.fromEntries(Object.keys(positions).filter(mint=>raw.marks[mint]).map(mint=>{const m=raw.marks[mint]!;return [mint,{netLamports:m.netLamports,pricedBaseUnits:m.pricedBaseUnits,at:m.at,evidence:m.evidence}];}))};
    }catch{this.context={price:null,marks:{}};}
    const now=this.clock();this.record('trader-context',{at:now,context:this.context});this.record('trader-input',{kind:'tick',at:now});
    try{if(!this.context.price)throw new Error();this.options.ledger.reconcile(this.id('reconcile'),now,this.context.price,this.context.marks);this.funnel.reconciled++;}catch{this.pause('current equity or liquidation unavailable; entries closed');}
    execution.push(...await this.attempts());
    // Existing exposure and pending actions always precede any candidate quote.
    for(const position of Object.values(this.options.ledger.state().positions)){
      execution.push(...await this.dueActions());if(!this.options.ledger.state().positions[position.mint])continue;
      if(Object.values(this.options.ledger.state().pending).some(o=>o.mint===position.mint))continue;
      const exit=evaluateExit({now:this.clock(),enteredAt:position.enteredAt,entryCostLamports:(unsigned(position.entryLamports)+unsigned(position.entryGas)).toString(),heldBaseUnits:position.units,mark:this.context.marks[position.mint]??null});
      if(exit.action!=='request-exit')continue;
      const q=await this.estimate({mint:position.mint,side:'sell',inputUnits:position.units});
      execution.push(...await this.dueActions());if(!this.options.ledger.state().positions[position.mint])continue;
      if(q)this.reserveExit(position.mint,q,exit.reason);else this.decision({mint:position.mint,at:this.clock(),stage:'execution-unavailable',reason:'fresh actual-size exit quote unavailable; position preserved',ruleVersion:PROVISIONAL_RULE.version});
    }
    for(const c of this.candidates.values()){
      execution.push(...await this.dueActions());
      const at=this.clock(),bucket=Math.floor(at/PROVISIONAL_RULE.bucketMs);if(c.evaluatedBucket===bucket)continue;c.evaluatedBucket=bucket;
      const features=c.window.features(at),state=this.options.ledger.state(),fields=this.options.flowVerification;
      const risk=this.entriesAllowed(c,at);
      const context={mint:c.mint,now:at,migrationAt:c.migrationAt,migrationVerified:c.migrationVerified,supportedPool:c.supportedPool,flowFieldsVerified:fields?.verified===true&&c.active,flowVerificationEvidence:fields?.evidence??null,riskEntriesAllowed:risk,alreadyTradedMint:this.options.ledger.hasTradedMint(c.mint),quote:null};
      let decision=evaluatePrimary(features,context),q:SizeQuote|null=null;
      if(decision.reason==='fresh-size-specific-quote-unavailable'&&this.context.price){
        const price=unsigned(this.context.price.microUsdPerSol),budget=BigInt(PROVISIONAL_RULE.maximumInitialCostMicroUsd)*1_000_000_000n/price-unsigned(this.options.costs.gasLamports)-unsigned(this.options.costs.depositLamports);
        if(budget>0n){q=await this.estimate({mint:c.mint,side:'buy',inputUnits:budget.toString()});
          execution.push(...await this.dueActions());
          if(q){let liquidityBps=10_001;try{const liquidity=unsigned(q.effectiveQuoteLiquidityLamports??'0');if(liquidity>0n)liquidityBps=Number((budget*10_000n+liquidity-1n)/liquidity);}catch{}
            const current=this.clock();decision=evaluatePrimary(c.window.features(current),{...context,now:current,flowFieldsVerified:fields?.verified===true&&c.active,riskEntriesAllowed:this.entriesAllowed(c,current),alreadyTradedMint:this.options.ledger.hasTradedMint(c.mint),quote:{mint:q.mint,at:q.at,evidence:q.evidence,allInInitialCostMicroUsd:((budget+unsigned(this.options.costs.gasLamports)+unsigned(this.options.costs.depositLamports))*price/1_000_000_000n).toString(),sizeToEffectiveLiquidityBps:liquidityBps,expectedBaseUnits:q.outputUnits}});
          }
        }
      }
      c.evaluatedBucket=Math.max(c.evaluatedBucket,Math.floor(decision.at/PROVISIONAL_RULE.bucketMs));
      this.funnel.evaluated++;if(features.sufficientlyObserved&&c.active&&fields?.verified===true)this.funnel.sufficientlyObserved++;
      this.decision({mint:c.mint,at:this.clock(),stage:decision.kind,reason:decision.reason,ruleVersion:decision.ruleVersion,features:decision.features,quote:q});
      if(decision.qualified&&q&&!this.evidenceUnavailable){this.funnel.qualified++;const at=this.clock(),min=unsigned(q.outputUnits)*BigInt(10_000-this.options.costs.slippageBps)/10_000n;
        if(min>0n){try{const result=this.execution.reserve({id:`buy:${this.options.ledger.state().revision}:${at}`,side:'buy',mint:c.mint,decidedAt:at,executeAt:at+PROVISIONAL_RULE.modeledDelayMs,expiresAt:at+PROVISIONAL_RULE.orderExpiryMs,gas:this.options.costs.gasLamports,deposit:this.options.costs.depositLamports,maxSpend:q.inputUnits,minReceive:min.toString(),decisionEvidence:q.evidence},this.context);if('reserved' in result){this.funnel.reserved++;break;}else this.decision({mint:c.mint,at,stage:'risk-rejection',reason:result.rejected,ruleVersion:PROVISIONAL_RULE.version});}catch(error){
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
