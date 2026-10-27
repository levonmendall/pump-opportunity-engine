/** Isolated research state only: no network, ledger, account, signer or entry control. */
import {FlowWindow,PROVISIONAL_RULE,evaluateExit,type FlowFeatures} from './strategy.js';
import {pumpApiSignatureHint,mapConfirmedPumpSwapEvidence,toResearchNormalizedTrade,compareMappedTradeEvidence,type MappedTradeEvidence} from './pumpapi-mapping.js';

export type ActiveScope={mint:string;pool:string;baseUnits:string|bigint;minSlot:number;supportedPoolEvidence:string};
export type ActiveHint={signature:string;receivedAt:number;expectedTrade:boolean};
type PipelineOptions={scope:ActiveScope;now?:()=>number;record?:(kind:string,data:unknown)=>void};
type QuoteFields={mint:string;slot:number;commitment:string;receivedAt:string;sell:{inputBaseUnits:string;outputLamports:string}};
type SizedQuote=QuoteFields&({marketBlockTime:number;timeEvidence?:never}|{timeEvidence:'confirmed-bank-clock';clockSlot:number;marketClockUnixSeconds:number});
const MAX_HINTS=16,MAX_SIGNATURES=64,MAX_EVENTS=128,MAX_ROWS=100,ENRICH_DELAY_MS=1000,ENRICH_DEADLINE_MS=5000,GAS=7000n;
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const unsigned=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const percentile=(rows:number[],p:number)=>rows.length?[...rows].sort((a,b)=>a-b)[Math.min(rows.length-1,Math.ceil(rows.length*p)-1)]!:null;

export class ActivePipeline {
  readonly scope:Omit<ActiveScope,'baseUnits'>&{baseUnits:string};
  private readonly now:()=>number;private readonly record:(kind:string,data:unknown)=>void;
  private openedAt:number|null=null;private endedAt:number|null=null;private closedAt:number|null=null;private informationAt=0;
  private windows:{curve:FlowWindow;user:FlowWindow}|null=null;
  private queue:ActiveHint[]=[];private active:ActiveHint|null=null;private signatures=new Set<string>();
  private evidence=new Map<string,MappedTradeEvidence>();private historicalWindowInvalidated=false;
  private selectedMessages=0;private duplicateHints=0;private uniqueAttempts=0;private completedTransactions=0;private failedTransactions=0;private nonTradeTransactions=0;
  private normalizedDuring=0;private normalizedAfter=0;private normalizedBuys=0;private normalizedSells=0;private routedEvents=0;private multipleSwapTransactions=0;private duplicateEvents=0;private corrections=0;
  private firstNormalizedAt:number|null=null;private lastNormalizedAt:number|null=null;private queueHighWater=0;private queueAges:number[]=[];private completionAges:number[]=[];private qualityGaps:Array<{at:number;reason:string}>=[];
  private featureRows:Array<{at:number;curve:FlowFeatures;user:FlowFeatures;fullyEnriched:boolean;researchOnly:true}>=[];private lastFeatureAt:number|null=null;private lastFeatureWarm=false;private lastNoPendingWarm=false;private enrichedWarmMs=0;private noPendingWarmMs=0;
  private quoteRows:Array<Record<string,unknown>>=[];private rejectedQuotes=0;private acceptedQuotes=0;private priceChanges=0;private firstQuoteSeen=false;
  private latestMark:{at:number;availableAt:number;netLamports:string;pricedBaseUnits:string;evidence:string}|null=null;private baseline:{at:number;cost:string}|null=null;private lastNet:string|null=null;private lastExitAction:string|null=null;
  private markIntegratedAt:number|null=null;private freshMarkMs=0;private triggerEvents:Array<Record<string,unknown>>=[];
  constructor(options:PipelineOptions){
    const base=String(options.scope.baseUnits);
    if(!/^[1-9][0-9]{0,19}$/.test(base)||!integer(options.scope.minSlot)||!options.scope.mint||!options.scope.pool||!options.scope.supportedPoolEvidence)throw Error('VALID_RESEARCH_SCOPE_REQUIRED');
    this.scope={...options.scope,baseUnits:base};this.now=options.now??Date.now;this.record=options.record??(()=>{});
  }
  get hasQualityLoss(){return this.qualityGaps.length>0;}
  private clock(at:number){if(!integer(at)||at<this.informationAt)throw Error('RESEARCH_INFORMATION_CLOCK_REGRESSION');this.informationAt=at;return at;}
  private emit(kind:string,data:unknown){this.record(kind,data);}
  private observing(at:number){return this.openedAt!==null&&this.closedAt===null&&(this.endedAt===null||at<=this.endedAt);}
  open(at=this.now()){
    this.clock(at);if(this.openedAt!==null)throw Error('ONE_OBSERVATION_ONLY');this.openedAt=at;this.markIntegratedAt=at;this.lastFeatureAt=at;
    this.windows={curve:new FlowWindow(this.scope.mint,at),user:new FlowWindow(this.scope.mint,at)};
    this.emit('research-pipeline-open',{at,scope:this.scope,entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',enrichmentDelayMs:ENRICH_DELAY_MS,enrichmentDeadlineMs:ENRICH_DEADLINE_MS,mode:'RESEARCH_ONLY'});
  }
  observe(payload:unknown,receivedAt=this.now()):'irrelevant'|'queued'|'duplicate'|'invalid'{
    this.clock(receivedAt);if(!this.observing(receivedAt)||this.endedAt!==null)return 'irrelevant';
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return 'irrelevant';const p=payload as Record<string,unknown>;
    // Other pools for this mint are outside the exact selected canonical pool.
    const exactPool=p.poolId===this.scope.pool,missingPool=p.mint===this.scope.mint&&(p.poolId===undefined||p.poolId===null);
    if(!exactPool&&!missingPool)return 'irrelevant';this.tick(receivedAt);this.selectedMessages++;
    const hint=pumpApiSignatureHint(payload,this.scope);
    if(!hint){this.gap('selected-essential-fields-unavailable',receivedAt);return 'invalid';}
    if(this.signatures.has(hint.signature)){this.duplicateHints++;return 'duplicate';}
    if(this.signatures.size>=MAX_SIGNATURES||this.queue.length+(this.active?1:0)>=MAX_HINTS){this.gap('selected-enrichment-capacity',receivedAt);return 'invalid';}
    const selected={signature:hint.signature,receivedAt,expectedTrade:p.action==='buy'||p.action==='sell'};
    this.signatures.add(hint.signature);this.queue.push(selected);this.queueHighWater=Math.max(this.queueHighWater,this.queue.length+(this.active?1:0));
    this.lastNoPendingWarm=false;
    this.emit('research-selected-hint',{...selected,providerAction:typeof p.action==='string'?p.action.slice(0,64):null,providerSlotClaim:integer(Number(p.block))?Number(p.block):null,requiresConfirmedRpc:true});return 'queued';
  }
  nextHint(now=this.now()):ActiveHint|null{
    this.clock(now);if(this.closedAt!==null||this.active)return null;const hint=this.queue[0];if(!hint)return null;
    if(now-hint.receivedAt>ENRICH_DEADLINE_MS){this.queue.shift();this.failedTransactions++;this.gap('selected-enrichment-queue-expired',now);return null;}
    if(now<hint.receivedAt+ENRICH_DELAY_MS)return null;
    this.active=this.queue.shift()!;this.uniqueAttempts++;this.queueAges.push(now-hint.receivedAt);return {...this.active};
  }
  completeHint(hint:ActiveHint,tx:unknown,availableAt=this.now()):MappedTradeEvidence[]{
    this.clock(availableAt);if(!this.active||this.active.signature!==hint.signature)throw Error('ACTIVE_ENRICHMENT_IDENTITY_MISMATCH');
    this.tick(availableAt);this.active=null;this.completedTransactions++;this.completionAges.push(availableAt-hint.receivedAt);
    if(availableAt-hint.receivedAt>ENRICH_DEADLINE_MS){this.failedTransactions++;this.gap('selected-enrichment-completed-too-late',availableAt);return [];}
    const rows=this.map(hint,tx,availableAt,false);this.tick(availableAt);return rows;
  }
  audit(hint:ActiveHint,tx:unknown,availableAt=this.now()):MappedTradeEvidence[]{
    this.clock(availableAt);return this.map(hint,tx,availableAt,true);
  }
  private map(hint:ActiveHint,tx:unknown,at:number,audit:boolean):MappedTradeEvidence[]{
    let rows:MappedTradeEvidence[];
    try{rows=mapConfirmedPumpSwapEvidence(tx,{...this.scope,signature:hint.signature,providerReceivedAt:hint.receivedAt,availableAt:at});}
    catch(error){this.failedTransactions++;this.gap('confirmed-transaction-mapping-unavailable',at);this.emit('research-mapping-refusal',{at,signature:hint.signature,reason:error instanceof Error?error.message:'UNKNOWN_MAPPING_ERROR',audit});return [];}
    if(!rows.length){if(hint.expectedTrade){this.failedTransactions++;this.gap('selected-trade-without-verified-event',at);}else this.nonTradeTransactions++;return [];}
    if(!audit&&rows.length>1)this.multipleSwapTransactions++;
    for(const row of rows){
      const prior=this.evidence.get(row.identityKey),change=prior?compareMappedTradeEvidence(prior,row):'distinct';
      if(change==='duplicate'){this.duplicateEvents++;continue;}
      if(change==='correction'){this.corrections++;this.evidence.set(row.identityKey,row);this.gap('confirmed-executed-evidence-correction',at);continue;}
      if(audit){this.gap('audit-found-previously-unavailable-event',at);this.evidence.set(row.identityKey,row);continue;}
      if(this.evidence.size>=MAX_EVENTS){this.gap('normalized-evidence-capacity',at);continue;}
      try{
        const curve=toResearchNormalizedTrade(row,'curve',this.scope.supportedPoolEvidence),user=toResearchNormalizedTrade(row,'user',this.scope.supportedPoolEvidence);
        this.evidence.set(row.identityKey,row);
        const during=this.endedAt===null&&this.closedAt===null;
        if(during){this.windows!.curve.ingest(curve.trade);this.windows!.user.ingest(user.trade);this.normalizedDuring++;this.firstNormalizedAt??=at;this.lastNormalizedAt=at;}
        else this.normalizedAfter++;
        row.side==='buy'?this.normalizedBuys++:this.normalizedSells++;if(row.identity.swapInnerInstructionIndex!==null)this.routedEvents++;
        this.emit('research-normalized-trade',{at,duringObservation:during,curve,user,executedEvidence:row,primaryStrategyEnabled:false});
      }catch{this.failedTransactions++;this.gap('executed-transfer-or-feature-validation-unavailable',at);}
    }
    return rows;
  }
  failHint(reason:string,at=this.now()){
    this.clock(at);if(this.active)this.failedTransactions++;this.active=null;this.gap(reason,at);
  }
  gap(reason:string,at=this.now()){
    this.clock(at);if(this.windows&&this.endedAt===null)this.tick(at);if(this.qualityGaps.length<MAX_ROWS)this.qualityGaps.push({at,reason:reason.slice(0,120)});this.historicalWindowInvalidated=true;
    if(this.windows&&this.endedAt===null){this.windows.curve.invalidate(at,'feed-gap');this.windows.user.invalidate(at,'feed-gap');}
    this.lastFeatureWarm=false;this.lastNoPendingWarm=false;this.emit('research-quality-gap',{at,reason:reason.slice(0,120),affectedWindowUnusable:true});
  }
  private integrateMarks(at:number){
    if(this.openedAt===null)return;const end=Math.min(at,this.endedAt??at),start=this.markIntegratedAt??this.openedAt;if(end<=start)return;
    const mark=this.latestMark;if(mark)this.freshMarkMs+=Math.max(0,Math.min(end,mark.at+PROVISIONAL_RULE.maximumQuoteAgeMs)-Math.max(start,mark.availableAt));
    this.markIntegratedAt=end;
  }
  tick(at=this.now()){
    this.clock(at);this.integrateMarks(at);if(!this.windows||this.endedAt!==null||this.closedAt!==null)return;
    const previous=this.lastFeatureAt??at,span=Math.max(0,at-previous);if(this.lastFeatureWarm)this.enrichedWarmMs+=span;if(this.lastNoPendingWarm)this.noPendingWarmMs+=span;
    const curve=this.windows.curve.features(at),user=this.windows.user.features(at),warm=curve.sufficientlyObserved&&user.sufficientlyObserved&&this.normalizedDuring>0,fullyEnriched=this.queue.length===0&&!this.active;
    this.lastFeatureWarm=warm;this.lastNoPendingWarm=warm&&fullyEnriched;this.lastFeatureAt=at;
    if(!this.featureRows.length||at-this.featureRows.at(-1)!.at>=1000){const row={at,curve,user,fullyEnriched,researchOnly:true as const};if(this.featureRows.length<MAX_ROWS)this.featureRows.push(row);this.emit('research-feature-view',row);}
  }
  price(quote:SizedQuote|null,availableAt=this.now()){
    this.clock(availableAt);this.integrateMarks(availableAt);let reason:string|null=null;
    const sourceAt=quote?Date.parse(quote.receivedAt):NaN;
    const clockQuote=quote?.timeEvidence==='confirmed-bank-clock';
    const sourceTimeEvidence=clockQuote?{kind:'confirmed-bank-clock' as const,clockSlot:quote.clockSlot,marketClockUnixSeconds:quote.marketClockUnixSeconds}:quote&&quote.timeEvidence===undefined&&'marketBlockTime'in quote?{kind:'independently-retrieved-block-time' as const,marketBlockTime:quote.marketBlockTime}:null;
    const validSource=sourceTimeEvidence?.kind==='confirmed-bank-clock'?integer(sourceTimeEvidence.clockSlot)&&sourceTimeEvidence.clockSlot===quote?.slot&&integer(sourceTimeEvidence.marketClockUnixSeconds)&&sourceTimeEvidence.marketClockUnixSeconds*1000<=availableAt&&availableAt-sourceTimeEvidence.marketClockUnixSeconds*1000<=30_000:sourceTimeEvidence?.kind==='independently-retrieved-block-time'&&integer(sourceTimeEvidence.marketBlockTime)&&Math.abs(availableAt-sourceTimeEvidence.marketBlockTime*1000)<=30_000;
    if(!quote||quote.mint!==this.scope.mint||quote.sell?.inputBaseUnits!==this.scope.baseUnits||quote.commitment!=='confirmed'||!integer(quote.slot)||quote.slot<this.scope.minSlot||!integer(sourceAt)||sourceAt>availableAt||availableAt-sourceAt>PROVISIONAL_RULE.maximumQuoteAgeMs||!validSource||!unsigned(quote.sell.outputLamports))reason='actual-size-fresh-quote-unavailable';
    if(reason){this.rejectedQuotes++;this.emit('research-price-unavailable',{at:availableAt,reason,sourceTimeEvidence});return null;}
    const q=quote!,net=(BigInt(q.sell.outputLamports)>GAS?BigInt(q.sell.outputLamports)-GAS:0n).toString(),during=this.endedAt===null&&this.closedAt===null;
    if(!during){this.emit('research-price-after-observation',{at:availableAt,sourceAt,netLamports:net});return null;}
    this.acceptedQuotes++;if(this.lastNet!==null&&this.lastNet!==net)this.priceChanges++;this.lastNet=net;
    this.latestMark={at:sourceAt,availableAt,netLamports:net,pricedBaseUnits:this.scope.baseUnits,evidence:'RESEARCH confirmed SDK full-size quote; '+sourceTimeEvidence!.kind+'; modeled gas7000 counted once'};
    if(!this.firstQuoteSeen){this.firstQuoteSeen=true;if(BigInt(net)>0n)this.baseline={at:availableAt,cost:net};}
    const decision=this.baseline?evaluateExit({now:availableAt,enteredAt:this.baseline.at,entryCostLamports:this.baseline.cost,heldBaseUnits:this.scope.baseUnits,mark:this.latestMark}):{action:'quote-required',reason:'initial-positive-hypothetical-cost-unavailable'};
    if(decision.action==='request-exit'&&this.lastExitAction!=='request-exit'&&this.acceptedQuotes>1&&this.triggerEvents.length<MAX_ROWS)this.triggerEvents.push({recognizedAt:availableAt,sourceReceivedAt:sourceAt,recognitionAfterBatchReceiveMs:availableAt-sourceAt,chainCrossingTime:'UNKNOWN_BETWEEN_SAMPLED_STATES',netLamports:net,reason:decision.reason});
    this.lastExitAction=decision.action;
    const row={availableAt,sourceReceivedAt:sourceAt,quoteAgeMs:availableAt-sourceAt,slot:q.slot,sourceTimeEvidence,grossSellLamports:q.sell.outputLamports,modeledGasLamports:GAS.toString(),netLamports:net,hypotheticalBaseline:this.baseline,decision,mode:'RESEARCH_ONLY; no entry or fill'};
    if(this.quoteRows.length<MAX_ROWS)this.quoteRows.push(row);this.emit('research-position-price',row);return row;
  }
  endObservation(at=this.now(),reason='bounded-source-end'){
    this.clock(at);if(this.endedAt!==null)return;this.tick(at);this.endedAt=at;this.emit('research-observation-end',{at,reason,pending:this.queue.length+(this.active?1:0),lateConfirmationsCannotWarm:true});
  }
  close(at=this.now(),reason='bounded-test-end'){
    this.clock(at);if(this.closedAt!==null)return;this.endObservation(at,reason);
    if(this.queue.length||this.active)this.gap('unresolved-enrichment-at-final-close',at);
    this.closedAt=at;this.emit('research-pipeline-close',{at,reason,pending:this.queue.length+(this.active?1:0)});
  }
  snapshot(at=this.now()){
    this.tick(at);const observationMs=this.openedAt===null?0:Math.max(0,(this.endedAt??at)-this.openedAt),fresh=Math.min(observationMs,this.freshMarkMs);
    return {mode:'RESEARCH_ONLY',scope:this.scope,openedAt:this.openedAt,observationEndedAt:this.endedAt,closedAt:this.closedAt,observationMs,selectedMessages:this.selectedMessages,uniqueEnrichmentAttempts:this.uniqueAttempts,duplicateSignatureHints:this.duplicateHints,completedTransactions:this.completedTransactions,failedTransactions:this.failedTransactions,nonTradeTransactions:this.nonTradeTransactions,pending:this.queue.length+(this.active?1:0),queueHighWater:this.queueHighWater,queueAgeMs:{samples:this.queueAges.length,p50:percentile(this.queueAges,.5),p95:percentile(this.queueAges,.95),maximum:this.queueAges.length?Math.max(...this.queueAges):null},enrichmentAvailableAfterHintMs:{samples:this.completionAges.length,p50:percentile(this.completionAges,.5),p95:percentile(this.completionAges,.95),maximum:this.completionAges.length?Math.max(...this.completionAges):null},normalizedEvents:this.normalizedDuring,normalizedDuringObservation:this.normalizedDuring,normalizedAfterObservation:this.normalizedAfter,normalizedBuys:this.normalizedBuys,normalizedSells:this.normalizedSells,routedEvents:this.routedEvents,variantCountsIncludeLateEnrichment:true,multipleSwapTransactions:this.multipleSwapTransactions,duplicateExecutedEvents:this.duplicateEvents,corrections:this.corrections,firstNormalizedAt:this.firstNormalizedAt,lastNormalizedAt:this.lastNormalizedAt,qualityGaps:this.qualityGaps,historicalWindowInvalidated:this.historicalWindowInvalidated,enrichedFeatureWarmSeconds:this.enrichedWarmMs/1000,noPendingFeatureWarmSeconds:this.noPendingWarmMs/1000,verifiedUsableFeatureWindowSeconds:0,coverage:'Requires later bounded independent signature/instruction audit; raw warmth is not completeness',featureRows:this.featureRows,prices:{accepted:this.acceptedQuotes,rejected:this.rejectedQuotes,changes:this.priceChanges,firstHypotheticalCost:this.baseline,modeledGasLamports:GAS.toString(),freshCacheMs:fresh,staleCacheMs:observationMs-fresh,freshCacheFraction:observationMs?fresh/observationMs:null,triggerEvents:this.triggerEvents,rows:this.quoteRows},executedEvidence:[...this.evidence.values()],paperEntriesEnabled:false,naturalPaperTrades:0};
  }
}
