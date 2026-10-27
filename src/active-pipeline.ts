/** Isolated research state only: no network, ledger, account, signer or entry control. */
import {FlowWindow,PROVISIONAL_RULE,evaluateExit,type FlowFeatures} from './strategy.js';
import {pumpApiSignatureHint,mapConfirmedPumpSwapEvidence,toResearchNormalizedTrade,compareMappedTradeEvidence,type MappedTradeEvidence} from './pumpapi-mapping.js';

export type ActiveScope={mint:string;pool:string;baseUnits:string|bigint;minSlot:number;supportedPoolEvidence:string};
export type ActiveHint={signature:string;receivedAt:number;expectedTrade:boolean};
type InformationKind='hint'|'trade'|'price'|'feature';
type PipelineOptions={scope:ActiveScope;now?:()=>number;record?:(kind:string,data:unknown)=>void;/** Optional research-only exclusive observation boundary. */admitInformation?:(at:number,kind:InformationKind)=>boolean};
type QuoteFields={mint:string;slot:number;commitment:string;receivedAt:string;sell:{inputBaseUnits:string;outputLamports:string}};
type SizedQuote=QuoteFields&({marketBlockTime:number;timeEvidence?:never}|{timeEvidence:'confirmed-bank-clock';clockSlot:number;marketClockUnixSeconds:number});
const MAX_HINTS=16,MAX_SIGNATURES=64,MAX_EVENTS=128,MAX_ROWS=100,ENRICH_DELAY_MS=1000,ENRICH_DEADLINE_MS=5000,GAS=7000n;
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const unsigned=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const percentile=(rows:number[],p:number)=>rows.length?[...rows].sort((a,b)=>a-b)[Math.min(rows.length-1,Math.ceil(rows.length*p)-1)]!:null;

export class ActivePipeline {
  readonly scope:Omit<ActiveScope,'baseUnits'>&{baseUnits:string};
  private readonly now:()=>number;private readonly record:(kind:string,data:unknown)=>void;
  private readonly admitInformation?:PipelineOptions['admitInformation'];
  private lastAcceptedInformationAt:number|null=null;private lastAcceptedTradeAt:number|null=null;private lastAcceptedPriceAt:number|null=null;private rejectedCutoffInformation=0;
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
    this.scope={...options.scope,baseUnits:base};this.now=options.now??Date.now;this.record=options.record??(()=>{});this.admitInformation=options.admitInformation;
  }
  get hasQualityLoss(){return this.qualityGaps.length>0;}
  private clock(at:number){if(!integer(at)||at<this.informationAt)throw Error('RESEARCH_INFORMATION_CLOCK_REGRESSION');this.informationAt=at;return at;}
  private emit(kind:string,data:unknown){this.record(kind,data);}
  private admissionAt(at:number,kind:InformationKind):number|null{const actual=this.admitInformation?Math.max(at,this.now()):at;return !this.admitInformation||this.admitInformation(actual,kind)?actual:null;}
  private accepted(at:number,kind:'hint'|'trade'|'price'){this.lastAcceptedInformationAt=at;if(kind==='trade')this.lastAcceptedTradeAt=at;if(kind==='price')this.lastAcceptedPriceAt=at;}
  private cutoffRejected(kind:InformationKind,at:number,signature?:string){const actual=this.clock(Math.max(at,this.now(),this.informationAt));this.rejectedCutoffInformation++;this.emit('research-information-after-cutoff',{kind,at:actual,signature:signature??null,admitted:false,rawEvidenceRetainedByCaller:true});if(kind==='trade'||kind==='hint')this.gap('selected-information-after-observation-cutoff',Math.max(actual,this.now()));}
  private unresolvedSelectedAfterCutoff(payload:unknown,receivedAt:number,alreadyCounted=false){
    const hint=pumpApiSignatureHint(payload,this.scope);
    if(hint&&!alreadyCounted)this.selectedMessages++;
    if(hint&&!this.signatures.has(hint.signature)&&this.signatures.size<MAX_SIGNATURES&&this.queue.length+(this.active?1:0)<MAX_HINTS){const p=payload as Record<string,unknown>;this.signatures.add(hint.signature);this.queue.push({signature:hint.signature,receivedAt,expectedTrade:p.action==='buy'||p.action==='sell'});this.queueHighWater=Math.max(this.queueHighWater,this.queue.length+(this.active?1:0));this.emit('research-selected-hint-after-cutoff',{...hint,receivedAt,admitted:false,unresolved:true});}
    this.cutoffRejected('hint',receivedAt,hint?.signature);return 'invalid' as const;
  }
  private observing(at:number){return this.openedAt!==null&&this.closedAt===null&&(this.endedAt===null||at<=this.endedAt);}
  open(at=this.now()){
    this.clock(at);if(this.openedAt!==null)throw Error('ONE_OBSERVATION_ONLY');this.openedAt=at;this.markIntegratedAt=at;this.lastFeatureAt=at;
    this.windows={curve:new FlowWindow(this.scope.mint,at),user:new FlowWindow(this.scope.mint,at)};
    this.emit('research-pipeline-open',{at,scope:this.scope,entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',enrichmentDelayMs:ENRICH_DELAY_MS,enrichmentDeadlineMs:ENRICH_DEADLINE_MS,mode:'RESEARCH_ONLY'});
  }
  observe(payload:unknown,receivedAt=this.now()):'irrelevant'|'queued'|'duplicate'|'invalid'{
    if(this.admissionAt(receivedAt,'hint')===null){
      // Preserve a selected target whose original receipt preceded a blocking
      // recorder. It never becomes a warmed trade or receives another request.
      return this.unresolvedSelectedAfterCutoff(payload,receivedAt);
    }
    this.clock(receivedAt);if(!this.observing(receivedAt)||this.endedAt!==null)return 'irrelevant';
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return 'irrelevant';const p=payload as Record<string,unknown>;
    // Other pools for this mint are outside the exact selected canonical pool.
    const exactPool=p.poolId===this.scope.pool,missingPool=p.mint===this.scope.mint&&(p.poolId===undefined||p.poolId===null);
    if(!exactPool&&!missingPool)return 'irrelevant';this.tick(receivedAt);if(this.admissionAt(receivedAt,'hint')===null)return this.unresolvedSelectedAfterCutoff(payload,receivedAt);this.selectedMessages++;
    const hint=pumpApiSignatureHint(payload,this.scope);
    if(!hint){this.gap('selected-essential-fields-unavailable',receivedAt);return 'invalid';}
    if(this.signatures.has(hint.signature)){this.duplicateHints++;return 'duplicate';}
    if(this.signatures.size>=MAX_SIGNATURES||this.queue.length+(this.active?1:0)>=MAX_HINTS){this.gap('selected-enrichment-capacity',receivedAt);return 'invalid';}
    const admittedAt=this.admissionAt(receivedAt,'hint');if(admittedAt===null)return this.unresolvedSelectedAfterCutoff(payload,receivedAt,true);
    const selected={signature:hint.signature,receivedAt,expectedTrade:p.action==='buy'||p.action==='sell'};
    this.signatures.add(hint.signature);this.queue.push(selected);this.queueHighWater=Math.max(this.queueHighWater,this.queue.length+(this.active?1:0));
    this.accepted(admittedAt,'hint');
    this.lastNoPendingWarm=false;
    this.emit('research-selected-hint',{...selected,providerAction:typeof p.action==='string'?p.action.slice(0,64):null,providerSlotClaim:integer(Number(p.block))?Number(p.block):null,requiresConfirmedRpc:true});return 'queued';
  }
  nextHint(now=this.now()):ActiveHint|null{
    if(this.admissionAt(now,'hint')===null)return null;
    this.clock(now);if(this.closedAt!==null||this.active)return null;const hint=this.queue[0];if(!hint)return null;
    if(now-hint.receivedAt>ENRICH_DEADLINE_MS){this.queue.shift();this.failedTransactions++;this.gap('selected-enrichment-queue-expired',now);return null;}
    if(now<hint.receivedAt+ENRICH_DELAY_MS)return null;
    this.active=this.queue.shift()!;this.uniqueAttempts++;this.queueAges.push(now-hint.receivedAt);return {...this.active};
  }
  /** Inspect admission timing without removing or activating a required trade. */
  peekHint():{hint:ActiveHint;eligibleAt:number;deadlineAt:number}|null{
    if(this.closedAt!==null||this.active||!this.queue[0])return null;
    const hint={...this.queue[0]};return {hint,eligibleAt:hint.receivedAt+ENRICH_DELAY_MS,deadlineAt:hint.receivedAt+ENRICH_DEADLINE_MS};
  }
  refuseHint(signature:string,reason:string,at=this.now()){
    this.clock(at);if(this.active||this.queue[0]?.signature!==signature)throw Error('RESEARCH_REFUSAL_IDENTITY_MISMATCH');
    const hint=this.queue.shift()!;this.failedTransactions++;this.emit('research-enrichment-refused',{...hint,at,reason,windowUnusable:true});this.gap(reason,at);
  }
  completeHint(hint:ActiveHint,tx:unknown,availableAt=this.now()):MappedTradeEvidence[]{
    if(this.admitInformation&&(!this.active||this.active.signature!==hint.signature))throw Error('ACTIVE_ENRICHMENT_IDENTITY_MISMATCH');
    if(this.admissionAt(availableAt,'trade')===null){this.completedTransactions++;this.cutoffRejected('trade',availableAt,hint.signature);return [];}
    this.clock(availableAt);if(!this.active||this.active.signature!==hint.signature)throw Error('ACTIVE_ENRICHMENT_IDENTITY_MISMATCH');
    this.tick(availableAt);this.completedTransactions++;
    if(availableAt-hint.receivedAt>ENRICH_DEADLINE_MS){this.active=null;this.completionAges.push(availableAt-hint.receivedAt);this.failedTransactions++;this.gap('selected-enrichment-completed-too-late',availableAt);return [];}
    const rows=this.map(hint,tx,availableAt,false);if(rows===null)return [];
    const completedAt=this.clock(Math.max(availableAt,this.now()));
    this.active=null;this.completionAges.push(completedAt-hint.receivedAt);this.tick(completedAt);return rows;
  }
  audit(hint:ActiveHint,tx:unknown,availableAt=this.now()):MappedTradeEvidence[]{
    this.clock(availableAt);return this.map(hint,tx,availableAt,true)??[];
  }
  private map(hint:ActiveHint,tx:unknown,at:number,audit:boolean):MappedTradeEvidence[]|null{
    let rows:MappedTradeEvidence[];
    try{rows=mapConfirmedPumpSwapEvidence(tx,{...this.scope,signature:hint.signature,providerReceivedAt:hint.receivedAt,availableAt:at});}
    catch(error){const failedAt=this.clock(Math.max(at,this.now()));this.failedTransactions++;this.gap('confirmed-transaction-mapping-unavailable',failedAt);this.emit('research-mapping-refusal',{at:failedAt,rpcAvailableAt:at,signature:hint.signature,reason:error instanceof Error?error.message:'UNKNOWN_MAPPING_ERROR',audit});return [];}
    // Decode and validate every new event before exposing any part of this
    // transaction to feature windows. RPC body receipt is not normalization
    // availability; executed evidence retains that original receipt unchanged.
    const staged:Array<{row:MappedTradeEvidence;change:'distinct'|'duplicate'|'correction';normalized:{curve:ReturnType<typeof toResearchNormalizedTrade>;user:ReturnType<typeof toResearchNormalizedTrade>}|null}>=[];
    try{
      const validationWindows={curve:new FlowWindow(this.scope.mint,at),user:new FlowWindow(this.scope.mint,at)};
      for(const row of rows){
        const prior=this.evidence.get(row.identityKey),change=prior?compareMappedTradeEvidence(prior,row):'distinct';
        const normalized=!audit&&change==='distinct'?{curve:toResearchNormalizedTrade(row,'curve',this.scope.supportedPoolEvidence),user:toResearchNormalizedTrade(row,'user',this.scope.supportedPoolEvidence)}:null;
        if(normalized){validationWindows.curve.ingest(normalized.curve.trade);validationWindows.user.ingest(normalized.user.trade);}
        staged.push({row,change,normalized});
      }
    }catch{const failedAt=this.clock(Math.max(at,this.now()));this.failedTransactions++;this.gap('executed-transfer-or-feature-validation-unavailable',failedAt);return [];}
    const preparedAt=this.clock(Math.max(at,this.now()));
    this.emit('research-enrichment-validation-prepared',{signature:hint.signature,rpcAvailableAt:at,preparedAt,eventCount:rows.length,audit});
    // Recording can itself block. Sample again only after all preparation,
    // immediately before the synchronous in-memory commit.
    const admissionAt=!audit?this.admissionAt(Math.max(preparedAt,this.now()),'trade'):Math.max(preparedAt,this.now());
    if(admissionAt===null){this.cutoffRejected('trade',Math.max(preparedAt,this.now()),hint.signature);return null;}
    const usableAt=this.clock(admissionAt);
    if(!audit&&usableAt-hint.receivedAt>ENRICH_DEADLINE_MS){this.failedTransactions++;this.gap('selected-enrichment-validation-too-late',usableAt);return [];}
    if(!audit&&this.evidence.size+staged.filter(s=>s.change==='distinct').length>MAX_EVENTS){this.gap('normalized-evidence-capacity',usableAt);return [];}
    if(!rows.length){if(hint.expectedTrade){this.failedTransactions++;this.gap('selected-trade-without-verified-event',usableAt);}else this.nonTradeTransactions++;return [];}
    if(!audit&&rows.length>1)this.multipleSwapTransactions++;
    const emitted:Array<{row:MappedTradeEvidence;curve:ReturnType<typeof toResearchNormalizedTrade>;user:ReturnType<typeof toResearchNormalizedTrade>;during:boolean}>=[],gaps:string[]=[];
    for(const {row,change,normalized} of staged){
      if(change==='duplicate'){this.duplicateEvents++;continue;}
      if(change==='correction'){this.corrections++;this.evidence.set(row.identityKey,row);gaps.push('confirmed-executed-evidence-correction');continue;}
      if(audit){this.evidence.set(row.identityKey,row);gaps.push('audit-found-previously-unavailable-event');continue;}
      if(this.evidence.size>=MAX_EVENTS){gaps.push('normalized-evidence-capacity');continue;}
      const {curve,user}=normalized!;curve.trade={...curve.trade,receivedAt:usableAt};user.trade={...user.trade,receivedAt:usableAt};
      this.evidence.set(row.identityKey,row);
      const during=this.endedAt===null&&this.closedAt===null;
      if(during){this.windows!.curve.ingest(curve.trade);this.windows!.user.ingest(user.trade);this.normalizedDuring++;this.firstNormalizedAt??=usableAt;this.lastNormalizedAt=usableAt;}
      else this.normalizedAfter++;
      row.side==='buy'?this.normalizedBuys++:this.normalizedSells++;if(row.identity.swapInnerInstructionIndex!==null)this.routedEvents++;
      emitted.push({row,curve,user,during});
    }
    if(emitted.some(e=>e.during))this.accepted(usableAt,'trade');
    // No recorder callback can observe a half-ingested transaction.
    for(const reason of gaps)this.gap(reason,Math.max(usableAt,this.now()));
    for(const {row,curve,user,during} of emitted)this.emit('research-normalized-trade',{at:usableAt,rpcAvailableAt:at,validationCompletedAt:usableAt,duringObservation:during,curve,user,executedEvidence:row,primaryStrategyEnabled:false});
    return rows;
  }
  failHint(reason:string,at=this.now()){
    this.clock(at);if(this.active)this.failedTransactions++;this.active=null;this.gap(reason,at);
  }
  retainHintAfterCutoff(at=this.now()){this.cutoffRejected('trade',at,this.active?.signature??this.queue[0]?.signature);}
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
    if(this.endedAt===null&&this.admissionAt(at,'feature')===null)return;
    this.clock(at);this.featureTick(at);
  }
  private featureTick(at:number){
    this.integrateMarks(at);if(!this.windows||this.endedAt!==null||this.closedAt!==null)return;
    const previous=this.lastFeatureAt??at,span=Math.max(0,at-previous);if(this.lastFeatureWarm)this.enrichedWarmMs+=span;if(this.lastNoPendingWarm)this.noPendingWarmMs+=span;
    const curve=this.windows.curve.features(at),user=this.windows.user.features(at),warm=curve.sufficientlyObserved&&user.sufficientlyObserved&&this.normalizedDuring>0,fullyEnriched=this.queue.length===0&&!this.active;
    this.lastFeatureWarm=warm;this.lastNoPendingWarm=warm&&fullyEnriched;this.lastFeatureAt=at;
    if(!this.featureRows.length||at-this.featureRows.at(-1)!.at>=1000){const row={at,curve,user,fullyEnriched,researchOnly:true as const};if(this.featureRows.length<MAX_ROWS)this.featureRows.push(row);this.emit('research-feature-view',row);}
  }
  price(quote:SizedQuote|null,availableAt=this.now()){
    const rpcAvailableAt=availableAt,firstAdmission=this.admissionAt(availableAt,'price');if(firstAdmission===null){this.rejectedQuotes++;this.cutoffRejected('price',availableAt);return null;}availableAt=firstAdmission;
    if(this.admitInformation){this.emit('research-price-validation-prepared',{rpcAvailableAt,preparedAt:availableAt});const useAt=this.admissionAt(availableAt,'price');if(useAt===null){this.rejectedQuotes++;this.cutoffRejected('price',availableAt);return null;}availableAt=useAt;}
    this.clock(availableAt);this.integrateMarks(availableAt);let reason:string|null=null;
    const sourceAt=quote?Date.parse(quote.receivedAt):NaN;
    const clockQuote=quote?.timeEvidence==='confirmed-bank-clock';
    const sourceTimeEvidence=clockQuote?{kind:'confirmed-bank-clock' as const,clockSlot:quote.clockSlot,marketClockUnixSeconds:quote.marketClockUnixSeconds}:quote&&quote.timeEvidence===undefined&&'marketBlockTime'in quote?{kind:'independently-retrieved-block-time' as const,marketBlockTime:quote.marketBlockTime}:null;
    const validSourceAt=(at:number)=>sourceTimeEvidence?.kind==='confirmed-bank-clock'?integer(sourceTimeEvidence.clockSlot)&&sourceTimeEvidence.clockSlot===quote?.slot&&integer(sourceTimeEvidence.marketClockUnixSeconds)&&sourceTimeEvidence.marketClockUnixSeconds*1000<=at&&at-sourceTimeEvidence.marketClockUnixSeconds*1000<=30_000:sourceTimeEvidence?.kind==='independently-retrieved-block-time'&&integer(sourceTimeEvidence.marketBlockTime)&&Math.abs(at-sourceTimeEvidence.marketBlockTime*1000)<=30_000;
    if(!quote||quote.mint!==this.scope.mint||quote.sell?.inputBaseUnits!==this.scope.baseUnits||quote.commitment!=='confirmed'||!integer(quote.slot)||quote.slot<this.scope.minSlot||!integer(sourceAt)||sourceAt>availableAt||availableAt-sourceAt>PROVISIONAL_RULE.maximumQuoteAgeMs||!validSourceAt(availableAt)||!unsigned(quote.sell.outputLamports))reason='actual-size-fresh-quote-unavailable';
    if(reason){this.rejectedQuotes++;this.emit('research-price-unavailable',{at:availableAt,reason,sourceTimeEvidence});return null;}
    const q=quote!,net=(BigInt(q.sell.outputLamports)>GAS?BigInt(q.sell.outputLamports)-GAS:0n).toString(),during=this.endedAt===null&&this.closedAt===null;
    if(!during){this.emit('research-price-after-observation',{at:availableAt,sourceAt,netLamports:net});return null;}
    if(this.admitInformation){const useAt=this.admissionAt(availableAt,'price');if(useAt===null){this.rejectedQuotes++;this.cutoffRejected('price',availableAt);return null;}availableAt=this.clock(useAt);if(sourceAt>availableAt||availableAt-sourceAt>PROVISIONAL_RULE.maximumQuoteAgeMs||!validSourceAt(availableAt)){this.rejectedQuotes++;this.emit('research-price-unavailable',{at:availableAt,reason:'actual-size-fresh-quote-unavailable',sourceTimeEvidence});return null;}this.integrateMarks(availableAt);}
    this.acceptedQuotes++;if(this.lastNet!==null&&this.lastNet!==net)this.priceChanges++;this.lastNet=net;
    this.accepted(availableAt,'price');
    this.latestMark={at:sourceAt,availableAt,netLamports:net,pricedBaseUnits:this.scope.baseUnits,evidence:'RESEARCH confirmed SDK full-size quote; '+sourceTimeEvidence!.kind+'; modeled gas7000 counted once'};
    if(!this.firstQuoteSeen){this.firstQuoteSeen=true;if(BigInt(net)>0n)this.baseline={at:availableAt,cost:net};}
    const decision=this.baseline?evaluateExit({now:availableAt,enteredAt:this.baseline.at,entryCostLamports:this.baseline.cost,heldBaseUnits:this.scope.baseUnits,mark:this.latestMark}):{action:'quote-required',reason:'initial-positive-hypothetical-cost-unavailable'};
    if(decision.action==='request-exit'&&this.lastExitAction!=='request-exit'&&this.acceptedQuotes>1&&this.triggerEvents.length<MAX_ROWS)this.triggerEvents.push({recognizedAt:availableAt,sourceReceivedAt:sourceAt,recognitionAfterBatchReceiveMs:availableAt-sourceAt,chainCrossingTime:'UNKNOWN_BETWEEN_SAMPLED_STATES',netLamports:net,reason:decision.reason});
    this.lastExitAction=decision.action;
    const row={availableAt,sourceReceivedAt:sourceAt,quoteAgeMs:availableAt-sourceAt,slot:q.slot,sourceTimeEvidence,grossSellLamports:q.sell.outputLamports,modeledGasLamports:GAS.toString(),netLamports:net,hypotheticalBaseline:this.baseline,decision,mode:'RESEARCH_ONLY; no entry or fill'};
    if(this.quoteRows.length<MAX_ROWS)this.quoteRows.push(row);this.emit('research-position-price',row);return row;
  }
  endObservation(at=this.now(),reason='bounded-source-end',logicalEndAt=at){
    this.clock(at);if(this.endedAt!==null)return;if(!integer(logicalEndAt)||logicalEndAt>at||logicalEndAt<(this.lastFeatureAt??this.openedAt??0))throw Error('RESEARCH_INVALID_LOGICAL_END');this.featureTick(logicalEndAt);this.endedAt=logicalEndAt;this.emit('research-observation-end',{at:logicalEndAt,stopRequestedAt:at,reason,pending:this.queue.length+(this.active?1:0),lateConfirmationsCannotWarm:true});
  }
  close(at=this.now(),reason='bounded-test-end'){
    this.clock(at);if(this.closedAt!==null)return;this.endObservation(at,reason);
    if(this.queue.length||this.active)this.gap('unresolved-enrichment-at-final-close',at);
    this.closedAt=at;this.emit('research-pipeline-close',{at,reason,pending:this.queue.length+(this.active?1:0)});
  }
  snapshot(at=this.now()){
    this.tick(at);const observationMs=this.openedAt===null?0:Math.max(0,(this.endedAt??at)-this.openedAt),fresh=Math.min(observationMs,this.freshMarkMs);
    return {mode:'RESEARCH_ONLY',scope:this.scope,openedAt:this.openedAt,observationEndedAt:this.endedAt,closedAt:this.closedAt,observationMs,lastAcceptedInformationAt:this.lastAcceptedInformationAt,lastAcceptedTradeAt:this.lastAcceptedTradeAt,lastAcceptedPriceAt:this.lastAcceptedPriceAt,rejectedCutoffInformation:this.rejectedCutoffInformation,selectedMessages:this.selectedMessages,uniqueEnrichmentAttempts:this.uniqueAttempts,duplicateSignatureHints:this.duplicateHints,completedTransactions:this.completedTransactions,failedTransactions:this.failedTransactions,nonTradeTransactions:this.nonTradeTransactions,pending:this.queue.length+(this.active?1:0),queueHighWater:this.queueHighWater,queueAgeMs:{samples:this.queueAges.length,p50:percentile(this.queueAges,.5),p95:percentile(this.queueAges,.95),maximum:this.queueAges.length?Math.max(...this.queueAges):null},enrichmentAvailableAfterHintMs:{samples:this.completionAges.length,p50:percentile(this.completionAges,.5),p95:percentile(this.completionAges,.95),maximum:this.completionAges.length?Math.max(...this.completionAges):null},normalizedEvents:this.normalizedDuring,normalizedDuringObservation:this.normalizedDuring,normalizedAfterObservation:this.normalizedAfter,normalizedBuys:this.normalizedBuys,normalizedSells:this.normalizedSells,routedEvents:this.routedEvents,variantCountsIncludeLateEnrichment:true,multipleSwapTransactions:this.multipleSwapTransactions,duplicateExecutedEvents:this.duplicateEvents,corrections:this.corrections,firstNormalizedAt:this.firstNormalizedAt,lastNormalizedAt:this.lastNormalizedAt,qualityGaps:this.qualityGaps,historicalWindowInvalidated:this.historicalWindowInvalidated,enrichedFeatureWarmSeconds:this.enrichedWarmMs/1000,noPendingFeatureWarmSeconds:this.noPendingWarmMs/1000,verifiedUsableFeatureWindowSeconds:0,coverage:'Requires later bounded independent signature/instruction audit; raw warmth is not completeness',featureRows:this.featureRows,prices:{accepted:this.acceptedQuotes,rejected:this.rejectedQuotes,changes:this.priceChanges,firstHypotheticalCost:this.baseline,modeledGasLamports:GAS.toString(),freshCacheMs:fresh,staleCacheMs:observationMs-fresh,freshCacheFraction:observationMs?fresh/observationMs:null,triggerEvents:this.triggerEvents,rows:this.quoteRows},executedEvidence:[...this.evidence.values()],paperEntriesEnabled:false,naturalPaperTrades:0};
  }
}
