/** Offline entry-information comparison. These are frozen research hypotheses,
 * not strategy rewrites, financial accounts, provider clients or PAPER entries.
 */
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {FlowWindow,PROVISIONAL_RULE,evaluatePrimary,type FlowFeatures,type NormalizedTrade,type RuleContext} from './strategy.js';
import {invokedCanonicalSolPools} from './active-selection.js';
import {mapConfirmedPumpSwapEvidence} from './pumpapi-mapping.js';

export const ENTRY_COMPARISON_POLICY=Object.freeze({
  version:'entry-data-comparison-v1',decisionCadenceMs:10_000,
  baseline:'A: unchanged persistent-buying-v0-unfrozen with complete selected flow',
  preliminaryVersion:'B: nonnegative-10s-size-price-and-liquidity-v1',
  preliminaryLookbackMs:10_000,preliminaryMinimumReturnBps:0,
  challengerVersion:'C: positive-60s-size-price-and-liquidity-v1',
  challengerLookbackMs:60_000,challengerMinimumReturnBps:300,
  maximumSizeToLiquidityBps:PROVISIONAL_RULE.maximumSizeToLiquidityBps,
  priceEvidence:'Fresh validated same-size quote snapshots; fixed quantity, exact integer return. Seven uninterrupted10s snapshots required by C.',
  baselineLookbackMs:PROVISIONAL_RULE.windowMs,bucketMs:PROVISIONAL_RULE.bucketMs,
  allInInitialCostMicroUsd:'50000000',initialCapitalReferenceMicroUsd:'1000000000',
  maximumPositions:3,maximumAggregateCostMicroUsd:'150000000',dailyLossPauseMicroUsd:'50000000',
  accountCreated:false,executionAttempted:false,
} as const);
export const ENTRY_INPUT_TIMING=Object.freeze([
  {input:'Migration/canonical identity and supported pool/mint/vault/fee behavior',A:'Existing initial eligibility and current quote validation',B:'Reuse the same eligibility/state; no additional copy of this check',C:'Same mandatory eligibility; cannot omit it with flow',incrementalB:false},
  {input:'Actual-size liquidity <=500bps and <=$50 all-in initial cost',A:'Existing execution/eligibility requirement with a fresh size quote',B:'Reuse existing available quote while fresh; not a new predictive screen',C:'Same requirement; no risk/size loosening',incrementalB:false},
  {input:'10s indicative same-size price return >=0',A:'Not an extra admission gate in the baseline',B:'NEW frozen early-selection gate; requires two valid10s-spaced prices if not already available',C:'Different60s>=300bps price hypothesis',incrementalB:true},
  {input:'Complete trade-flow lookback',A:'Collect every selected event after common admission',B:'Start fresh60s/six-bin collection only after the new gate passes; never backfill',C:'Explicitly absent; buyer/netflow/concentration inputs remain null',incrementalB:true},
  {input:'Feature calculation cadence',A:'Completed10s intervals',B:'Completed10s intervals',C:'Same signal clock, different price-only rule',incrementalB:false},
  {input:'Fresh executable-size quote at decision',A:'Required at use; age<=2s and all current validations',B:'Reuse its same-time screen quote for the primary decision; one physical quote read, not two',C:'Current fresh quote still required; a60s old endpoint is never an execution quote',incrementalB:false},
]);

export type EntryComparisonArm='A-full-flow'|'B-screen-then-flow'|'C-price-liquidity';
export type EntryScenarioName='sustained-trend'|'reversal'|'thin-liquidity'|'stale-quotes'|'outage';
export type SyntheticPriceEvidence={at:number;receivedAt:number;slot:number;poolSupported:boolean;liquidationLamports:string;pricedBaseUnits:string;sizeToLiquidityBps:number;sourceAgeMs:number;available:boolean;classification:'SYNTHETIC_VALIDATED_SIZE_PRICE_INPUT'};
export type EntryMechanicDecision={at:number;qualified:boolean;reason:string;featureWindowStartAt:number|null;featureWindowEndAt:number|null;fullFlowWarm:boolean;priceReturnBps:number|null;netBuyLamports:string|null;distinctBuyers:number|null};
const START=36_000_000,DURATION=180_000,MINT='SYNTHETIC-entry-comparison-mint',UNITS='1000000';
const ARMS:EntryComparisonArm[]=['A-full-flow','B-screen-then-flow','C-price-liquidity'];
function need(v:unknown,message:string):asserts v {if(!v)throw Error(message);}
function integerAmount(v:string){need(/^[1-9][0-9]{0,38}$/.test(v),'ENTRY_COMPARISON_INTEGER_AMOUNT');return BigInt(v);}
export function sizePriceReturnBps(first:SyntheticPriceEvidence,last:SyntheticPriceEvidence){
  need(first.pricedBaseUnits===last.pricedBaseUnits,'ENTRY_COMPARISON_SIZE_MISMATCH');
  const before=integerAmount(first.liquidationLamports),after=integerAmount(last.liquidationLamports),numerator=(after-before)*10_000n;
  const result=numerator>=0n?numerator/before:-((-numerator+before-1n)/before);
  need(result>=BigInt(Number.MIN_SAFE_INTEGER)&&result<=BigInt(Number.MAX_SAFE_INTEGER),'ENTRY_COMPARISON_RETURN_RANGE');return Number(result);
}
function freshPrice(q:SyntheticPriceEvidence,at:number){return q.available&&q.poolSupported&&q.at===at&&Number.isSafeInteger(q.receivedAt)&&q.receivedAt<=at&&at-q.receivedAt<=PROVISIONAL_RULE.maximumQuoteAgeMs&&Number.isSafeInteger(q.slot)&&q.slot>=0&&Number.isSafeInteger(q.sourceAgeMs)&&q.sourceAgeMs>=0&&q.sourceAgeMs<=30000&&q.pricedBaseUnits===UNITS&&Number.isSafeInteger(q.sizeToLiquidityBps)&&q.sizeToLiquidityBps>=0;}
function eligiblePrice(q:SyntheticPriceEvidence,at:number){return freshPrice(q,at)&&q.sizeToLiquidityBps<=ENTRY_COMPARISON_POLICY.maximumSizeToLiquidityBps;}
function valueFor(name:EntryScenarioName,offsetMs:number){
  if(name==='reversal')return offsetMs<=60_000?1_000_000n+BigInt(Math.floor(offsetMs/1000))*1000n:1_060_000n-BigInt(Math.floor((offsetMs-60_000)/1000))*2500n;
  return 1_000_000n+BigInt(Math.floor(offsetMs/1000))*1000n;
}
function priceFor(name:EntryScenarioName,at:number):SyntheticPriceEvidence{
  const offset=at-START,missing=name==='outage'&&offset>=55_000&&offset<=75_000;
  return {at,receivedAt:at-(name==='stale-quotes'&&offset>=20_000&&offset<=100_000?2501:100),slot:10000+Math.floor(offset/5000),poolSupported:true,liquidationLamports:valueFor(name,offset).toString(),pricedBaseUnits:UNITS,sizeToLiquidityBps:name==='thin-liquidity'?800:200,sourceAgeMs:1000,available:!missing,classification:'SYNTHETIC_VALIDATED_SIZE_PRICE_INPUT'};
}
function tradeFor(name:EntryScenarioName,index:number,spacingMs=5000):NormalizedTrade{
  const receivedAt=START+index*spacingMs+500,price=valueFor(name,receivedAt-START),quote=200_000_000n;
  return {identity:{signature:`SYNTHETIC-entry-${name}-${index}`,instructionIndex:index%3,eventIndex:index%2},mint:MINT,wallet:`SYNTHETIC-trader-${index%10}`,side:'buy',quoteLamports:quote.toString(),tokenUnits:(quote*1_000_000n/price).toString(),receivedAt,commitment:'confirmed',slot:10000+Math.floor((receivedAt-START)/5000)};
}
function quoteContext(at:number,q:SyntheticPriceEvidence|null):RuleContext{
  return {mint:MINT,now:at,migrationAt:START-300000,migrationVerified:true,supportedPool:q?.poolSupported??true,flowFieldsVerified:true,flowVerificationEvidence:'SYNTHETIC complete normalized fixture, not a verified provider contract',riskEntriesAllowed:true,alreadyTradedMint:false,quote:q&&freshPrice(q,at)?{mint:MINT,at:q.receivedAt,evidence:'SYNTHETIC same-size quote input; no financial order',allInInitialCostMicroUsd:ENTRY_COMPARISON_POLICY.allInInitialCostMicroUsd,sizeToEffectiveLiquidityBps:q.sizeToLiquidityBps,expectedBaseUnits:UNITS}:null};
}
/** Cheap deterministic prequalification only. It requests no quote and cannot
 * produce an entry: actual evaluatePrimary still receives the real input quote.
 */
export function flowCanNeedQuote(f:FlowFeatures){return f.sufficientlyObserved&&BigInt(f.netBuyLamports)>=BigInt(PROVISIONAL_RULE.minimumNetBuyLamports)&&f.positiveNetBuckets>=PROVISIONAL_RULE.minimumPositiveBuckets&&f.distinctBuyerWallets>=PROVISIONAL_RULE.minimumBuyers&&f.largestBuyerBps<=PROVISIONAL_RULE.maximumLargestBuyerBps&&f.priceReturnBps!==null&&f.priceReturnBps>=0;}
export function candidateQuoteMinimumSlot(priorVerifiedQuoteSlot:number,latestVerifiedFlowSlot:number){
  need(Number.isSafeInteger(priorVerifiedQuoteSlot)&&priorVerifiedQuoteSlot>=0&&Number.isSafeInteger(latestVerifiedFlowSlot)&&latestVerifiedFlowSlot>=0,'ENTRY_COMPARISON_SLOT_FLOOR');
  return Math.max(priorVerifiedQuoteSlot,latestVerifiedFlowSlot);
}

export function runEntryMechanics(name:EntryScenarioName,arm:EntryComparisonArm,options:{equivalentLazyQuotes?:boolean;selectedTransactionsPerMinute?:1|12}={}){
  const counters={initialMigrationVerification:1,initialPoolLinks:1,initialCoherentSupportAndPrice:1,selectedTransactionEnrichment:0,periodicCoherentQuoteReads:0,independentAudit:3,recoveryLinks:0};
  const decisions:EntryMechanicDecision[]=[],prices:SyntheticPriceEvidence[]=[];
  const initial=priceFor(name,START),commonInitialExclusion=!eligiblePrice(initial,START);
  if(commonInitialExclusion)counters.independentAudit=0;
  let window:FlowWindow|null=arm==='A-full-flow'&&!commonInitialExclusion?new FlowWindow(MINT,START):null,admittedAt:number|null=window?START:null,index=0,observations=0,preAdmissionDiscarded=0,unavailableSelectedDuringGap=0,relink=false,latestVerifiedFlowSlot=10000,priorVerifiedQuoteSlot=10000;
  const spacing=options.selectedTransactionsPerMinute===1?60000:5000,events=Array.from({length:DURATION/spacing},(_,i)=>tradeFor(name,i,spacing));
  const quoteFloors:Array<{at:number;minimumSlot:number;actualSlot:number;accepted:boolean}>=[];
  // Initial support/price state is common. A can reuse it as admission evidence,
  // but it is never held out as a fresh quote at a later decision.
  prices.push(initial);
  let gapStarted=false,gapEnded=false;
  for(let at=START+10000;at<=START+DURATION;at+=10000){
    if(commonInitialExclusion){decisions.push({at,qualified:false,reason:'existing-common-initial-size-liquidity-exclusion; no additional screen needed',featureWindowStartAt:null,featureWindowEndAt:null,fullFlowWarm:false,priceReturnBps:null,netBuyLamports:null,distinctBuyers:null});continue;}
    const pending:Array<{at:number;kind:'trade';trade:NormalizedTrade}|{at:number;kind:'gap'}>=[];
    while(index<events.length&&events[index]!.receivedAt<=at){const trade=events[index++]!;
      if(name==='outage'&&trade.receivedAt>=START+55000&&trade.receivedAt<=START+75000){unavailableSelectedDuringGap++;continue;}
      pending.push({at:trade.receivedAt,kind:'trade',trade});
    }
    if(name==='outage'&&!gapStarted&&START+55001<=at){pending.push({at:START+55001,kind:'gap'});gapStarted=true;}
    if(name==='outage'&&!gapEnded&&START+75001<=at){pending.push({at:START+75001,kind:'gap'});gapEnded=true;}
    pending.sort((a,b)=>a.at-b.at);
    for(const event of pending){
      if(event.kind==='gap'){window?.invalidate(event.at,'feed-gap');continue;}
      if(window&&admittedAt!==null&&event.at>=admittedAt){window.ingest(event.trade);latestVerifiedFlowSlot=Math.max(latestVerifiedFlowSlot,event.trade.slot??0);counters.selectedTransactionEnrichment++;observations++;}
      else if(arm==='B-screen-then-flow')preAdmissionDiscarded++;
    }
    let q:SyntheticPriceEvidence|null=null,features:FlowFeatures|null=window?.features(at)??null,screenReturn:number|null=null;
    // Current trader.ts requests a missing quote once the full window is warm,
    // before evaluatePrimary reaches predictive thresholds. The lazy control
    // explicitly changes only this retrieval ordering; it is not the baseline.
    const requestPrice=arm!=='A-full-flow'||!!features&&(options.equivalentLazyQuotes?flowCanNeedQuote(features):features.sufficientlyObserved);
    if(requestPrice){
      if(relink){counters.recoveryLinks++;relink=false;}
      counters.periodicCoherentQuoteReads++;q=priceFor(name,at);
      const minimumSlot=candidateQuoteMinimumSlot(priorVerifiedQuoteSlot,latestVerifiedFlowSlot),accepted=q.slot>=minimumSlot;quoteFloors.push({at,minimumSlot,actualSlot:q.slot,accepted});if(!accepted)q={...q,available:false};
      if(freshPrice(q,at))priorVerifiedQuoteSlot=Math.max(priorVerifiedQuoteSlot,q.slot);
      if(!freshPrice(q,at)){prices.length=0;relink=true;}else prices.push(q);
    }
    // Only snapshots available then, at the fixed size, and with uninterrupted
    // scheduled price evidence can enter the10s/60s comparison. No fill-forward.
    if(arm==='B-screen-then-flow'&&window===null&&q&&eligiblePrice(q,at)){
      const previous=prices.find(p=>p.at===at-ENTRY_COMPARISON_POLICY.preliminaryLookbackMs);
      if(previous&&eligiblePrice(previous,previous.at)){
        screenReturn=sizePriceReturnBps(previous,q);
        if(screenReturn>=ENTRY_COMPARISON_POLICY.preliminaryMinimumReturnBps){admittedAt=at;window=new FlowWindow(MINT,at);features=window.features(at);}
      }
    }
    if(arm==='C-price-liquidity'){
      const lookback=Array.from({length:7},(_,i)=>prices.find(p=>p.at===at-60000+i*10000));
      const valid=q&&eligiblePrice(q,at)&&lookback.every((p):p is SyntheticPriceEvidence=>!!p&&eligiblePrice(p,p.at));
      const value=valid?sizePriceReturnBps(lookback[0]!,q!):null;
      decisions.push({at,qualified:value!==null&&value>=ENTRY_COMPARISON_POLICY.challengerMinimumReturnBps,reason:value===null?'complete-fresh60s-price-lookback-unavailable':value>=300?'price-liquidity-challenger-passed':'price-return-below300bps',featureWindowStartAt:null,featureWindowEndAt:null,fullFlowWarm:false,priceReturnBps:value,netBuyLamports:null,distinctBuyers:null});
    }else if(!features){decisions.push({at,qualified:false,reason:'preliminary-screen-not-admitted; no full-flow-window',featureWindowStartAt:null,featureWindowEndAt:null,fullFlowWarm:false,priceReturnBps:screenReturn,netBuyLamports:null,distinctBuyers:null});}
    else{
      const decision=evaluatePrimary(features,quoteContext(at,q));
      decisions.push({at,qualified:decision.qualified,reason:decision.reason,featureWindowStartAt:features.windowStartAt,featureWindowEndAt:features.windowEndAt,fullFlowWarm:features.sufficientlyObserved,priceReturnBps:features.priceReturnBps,netBuyLamports:features.netBuyLamports,distinctBuyers:features.distinctBuyerWallets});
    }
  }
  const total=Object.values(counters).reduce((n,v)=>n+v,0),first=decisions.find(d=>d.qualified);
  return {scenario:name,arm,quoteRetrievalPolicy:arm==='A-full-flow'?(options.equivalentLazyQuotes?'RESEARCH_EQUIVALENT_PREDICTIVE_SHORT_CIRCUIT':'CURRENT_WARM_WINDOW_QUOTE_FIRST_ORDER'):'EXPLICIT_PERIODIC_SCREEN_PRICE_HYPOTHESIS',selectedTransactionsPerMinute:options.selectedTransactionsPerMinute??12,classification:'SYNTHETIC_SIGNAL_AND_REQUEST_MECHANICS_ONLY',commonInitialExclusion,admittedAt,fullFlowObservations:observations,preAdmissionDiscarded,unavailableSelectedDuringGap,firstQualifiedAt:first?.at??null,qualifiedDecisions:decisions.filter(d=>d.qualified).length,decisions,quoteFloors,rpcOperations:counters,totalProjectedRpcCalls:total,projectedCallsPerMinute:total/(DURATION/60000),broadFeedRequired:arm!=='C-price-liquidity',broadFeedReceivedBytes:arm==='C-price-liquidity'?0:1_800_000,broadByteAssumption:'SYNTHETIC10kbytes/second shared broad transport for180s, identical in A/B despite local filtering; not additive per-pool traffic. C explicitly omits the entire broad PumpApi connection.',financialOutcome:null,paperOrders:0,paperFills:0,naturalTrades:0,heldPositionEnrichmentCalls:0,heldPricingCalls:0};
}

/** Operating scenarios, not endpoint capacity. Quote prequalification is
 * intentionally separate from a10s feature calculation; quiet A does not fetch
 * a price merely to discover that its complete flow cannot meet the rule.
 */
export function entryWorkloadProjection(selectedTransactionsPerMinute:1|12,screenAdmissionFraction:0|1){
  const common={admissionInitialization:3,independentVerification:2,recoveryReserve:4,safetyHeadroom:6},overhead=Object.values(common).reduce((n,v)=>n+v,0);
  const quoteA=6,lazyQuoteA=selectedTransactionsPerMinute===1?0:6,screenQuotes=6;
  const A=selectedTransactionsPerMinute+quoteA+overhead,lazyA=selectedTransactionsPerMinute+lazyQuoteA+overhead,B=selectedTransactionsPerMinute*screenAdmissionFraction+screenQuotes+overhead,C=screenQuotes+overhead;
  return {selectedTransactionsPerMinute,screenAdmissionFraction,common,classification:'DECLARED_REQUEST_SCENARIO_NOT_MEASURED_PROVIDER_CAPACITY',alreadyEligibleUnderExistingSafety:true,additionalScreenMeans:'Only the new10s price-sign admission gate; no credit for filtering pools already excluded by existing support/liquidity checks.',A:{enrichment:selectedTransactionsPerMinute,periodicQuotes:quoteA,totalWithReserves:A},AEquivalentLazyControl:{enrichment:selectedTransactionsPerMinute,periodicQuotes:lazyQuoteA,totalWithReserves:lazyA,scope:'Same full flow and rule; skip only quotes whose predictive features cannot qualify. This is an unintegrated ordering optimization, not current trader behavior.'},B:{enrichment:selectedTransactionsPerMinute*screenAdmissionFraction,periodicQuotes:screenQuotes,totalWithReserves:B},C:{enrichment:0,periodicQuotes:screenQuotes,totalWithReserves:C},BminusA:B-A,BminusEquivalentLazyA:B-lazyA,CminusA:C-A,remainingForSharedHeldPricing:{A:60-A,AEquivalentLazyControl:60-lazyA,B:60-B,C:60-C},limitations:'One candidate after full warmup; support3/min assumes one admission/rotation per minute. Current trader quote-first ordering fetches6/min even on quiet warm flow. Lazy control avoids those when predictive failure is already known. Same trade may contain multiple swaps; count unique selected transaction requests. No held transaction enrichment is added. Common held pricing must be allocated once separately; these totals do not prove service deadlines.'};
}

export function equivalentQuoteRetrievalControl(){
  const names:EntryScenarioName[]=['sustained-trend','reversal','thin-liquidity','stale-quotes','outage'];
  const compare=(name:EntryScenarioName,selectedTransactionsPerMinute:1|12)=>{
    const actual=runEntryMechanics(name,'A-full-flow',{selectedTransactionsPerMinute}),lazy=runEntryMechanics(name,'A-full-flow',{selectedTransactionsPerMinute,equivalentLazyQuotes:true});
    return {scenario:name,selectedTransactionsPerMinute,currentQuoteFirstCalls:actual.totalProjectedRpcCalls,lazyControlCalls:lazy.totalProjectedRpcCalls,avoidedQuoteRetrievals:actual.totalProjectedRpcCalls-lazy.totalProjectedRpcCalls,flowRequestsUnchanged:actual.rpcOperations.selectedTransactionEnrichment===lazy.rpcOperations.selectedTransactionEnrichment,qualifiedDecisionBooleansEqual:JSON.stringify(actual.decisions.map(d=>d.qualified))===JSON.stringify(lazy.decisions.map(d=>d.qualified)),firstQualifiedAt:{current:actual.firstQualifiedAt,lazy:lazy.firstQualifiedAt},refusalReasonsEqual:JSON.stringify(actual.decisions.map(d=>d.reason))===JSON.stringify(lazy.decisions.map(d=>d.reason)),minimumSlotChecks:lazy.quoteFloors,financialOutcome:null};
  };
  return {classification:'SYNTHETIC_EQUIVALENT_PREDICTIVE_SHORT_CIRCUIT_CONTROL_NOT_OPERATIONAL_EQUIVALENCE',baselineSource:'src/trader.ts warm-window quote:null -> fresh-size-specific-quote-unavailable -> quote before predictive thresholds',controlSource:'flowCanNeedQuote prechecks the same frozen predictive requirements without changing them; full evaluatePrimary still decides using a fresh real input quote when needed.',matchedCases:names.map(name=>compare(name,12)),quietFlow:compare('sustained-trend',1),requestFloorPolicy:'Every modeled future quote uses max(last actually verified quote slot, latest verified selected-flow slot) and all original quote/source/pool checks; skipped quotes never invent a newer state slot.',operationalGaps:['Production RpcMarket currently tracks migration and actually obtained quote slots, but no new verified-flow-slot handoff was integrated here.','Omitted nonqualifying quotes also omit their price/support observations and may change later knowledge/failure timing; identical provided-oracle synthetic signals do not prove identical live operational behavior.','Recorded refusal kind/evidence may differ because an unfetched quote remains unavailable; no qualified entry may bypass the full rule or ledger.','Held-position monitoring is independent and must not rely on candidate quotes that this control skips.'],recommendation:'Review equivalent retrieval deferral before adding any new screen. No production behavior changed and no economic result is inferred.'};
}

export function retainedEntryAssessment(){
  const path='evidence/rpc-observation-comparison.ndjson';need(statSync(path).size<=4*1024*1024,'ENTRY_COMPARISON_RETAINED_LIMIT');const bytes=readFileSync(path),rows=bytes.toString().trimEnd().split('\n').map(l=>JSON.parse(l));
  const quotes=rows.filter(r=>r.kind==='quote-attempt'),outputs=quotes.filter(r=>r.data.outputLamports!==null).map(r=>String(r.data.outputLamports));
  return {classification:'NATURAL_ECONOMIC_ENTRY_COMPARISON_NOT_ASSESSABLE',source:path,sha256:createHash('sha256').update(bytes).digest('hex'),capturedCoherentQuotes:quotes.length,usableQuotes:outputs.length,uniqueSuccessfulSizeOutputs:[...new Set(outputs)],matchedSelectedFlowWindows:0,qualificationComparison:null,entryExecutionComparison:null,economicComparison:null,reason:'Retained16batch sample has15usable identical size-specific quotes and no matched selected flow. It contains no chronological complete entry dataset, funded/disposable account lifecycle or natural entry/exit outcomes. Sparse quiet quotes cannot establish relative strategy returns.'};
}

/** Measure only a post-fetch projection using retained actual public bytes.
 * Whole getTransaction response retrieval/parsing and selected raw evidence
 * preservation still happen. This is not a provider-bandwidth optimization.
 */
export function retainedFieldProjectionMeasurement(){
  const path='evidence/free-data-20261027/active-continuation-record.ndjson';need(statSync(path).size<=4*1024*1024,'ENTRY_COMPARISON_RETAINED_LIMIT');
  const source=readFileSync(path),rows=source.toString().trimEnd().split('\n').map(s=>JSON.parse(s));
  const samples:Array<{signature:string;pool:string;serializedTransactionResultBytes:number;requiredMappedProjectionBytes:number;events:number}>=[];
  for(const row of rows){
    if(row.kind!=='selection-transaction')continue;
    const item=row.data;
    for(const scope of invokedCanonicalSolPools(item.transaction)){
      const events=mapConfirmedPumpSwapEvidence(item.transaction,{...scope,signature:item.signature,providerReceivedAt:null,availableAt:item.availableAt});
      if(!events.length||events.some(e=>!e.transferChecks.baseTransfer||!e.transferChecks.userQuoteTransfer))continue;
      samples.push({signature:item.signature,pool:scope.pool,serializedTransactionResultBytes:Buffer.byteLength(JSON.stringify(item.transaction)),requiredMappedProjectionBytes:Buffer.byteLength(JSON.stringify(events)),events:events.length});
    }
  }
  const full=samples.reduce((n,s)=>n+s.serializedTransactionResultBytes,0),projected=samples.reduce((n,s)=>n+s.requiredMappedProjectionBytes,0);
  const budget=JSON.parse(readFileSync('evidence/free-data-20261027/pumpapi-budget.json','utf8'));
  return {classification:'ACTUAL_RETAINED_TRANSACTION_SERIALIZATION_MEASUREMENT_NOT_HTTP_SAVINGS',source:path,sourceSha256:createHash('sha256').update(source).digest('hex'),samples,totals:{serializedTransactionResultBytes:full,requiredMappedProjectionBytes:projected,serializedProjectionReductionFraction:full?1-projected/full:null},physicalGetTransactionCallsForTheseSamples:new Set(samples.map(s=>s.signature)).size,callsAfterRetainingFewerFields:new Set(samples.map(s=>s.signature)).size,rpcRequestSavings:0,incomingHttpByteSavings:0,avoidedFullJsonParse:false,parseCpuComparison:null,priorPumpApiObservedSocketBytes:budget.attempts.reduce((n:number,a:any)=>n+(a.observedSocketBytes??0),0),localPumpApiDiscardIncomingSavings:0,heldPositionFlowEnrichmentCalls:0,heldFlowEnrichmentSavings:0,interpretation:'Serialized transaction result objects versus mapped evidence only; not original HTTP envelope, whitespace, framing or the190,905byte entire selection pass. Both variants fetch and parse the same full transactions. Keep selected raw proof separately for reproduction. Canonical swap identity/transfer mapping is verified; current full mint/vault/fee support was not admitted in that preflight.'};
}

export function evaluateEntryDataComparison(){
  const scenarios:EntryScenarioName[]=['sustained-trend','reversal','thin-liquidity','stale-quotes','outage'];
  return {schemaVersion:1,classification:'OFFLINE_FROZEN_ENTRY_INFORMATION_MECHANICS_NOT_ECONOMIC_EVIDENCE',policy:ENTRY_COMPARISON_POLICY,policySha256:createHash('sha256').update(JSON.stringify(ENTRY_COMPARISON_POLICY)).digest('hex'),commonUniverse:scenarios,inputTimingAndReuse:ENTRY_INPUT_TIMING,decisionCadenceMs:10000,simulatedDurationPerScenarioMs:DURATION,initialCapitalReferenceUsd:1000,financialAccountCreated:false,commonRiskReference:{initialCostUsd:50,maximumPositions:3,maximumAggregateCostUsd:150,dailyLossPauseUsd:50,feesAndGas:'Same required costing and execution constraints; no fills constructed or costs charged here.',exits:'Unchanged15%stop/30%profit/15minute limit with actual-size fresh2squotes; no held positions or exits are fabricated in this entry mechanic.',ledgerAuthority:'No ledger was initialized or modified. Signals are not ledger entry authorization.'},results:scenarios.flatMap(name=>ARMS.map(arm=>runEntryMechanics(name,arm))),workloadScenarios:[entryWorkloadProjection(1,0),entryWorkloadProjection(1,1),entryWorkloadProjection(12,0),entryWorkloadProjection(12,1)],equivalentRetrievalControl:equivalentQuoteRetrievalControl(),dataRetentionControl:{A:'Fetch full transaction and retain required fields',AretainFewerFields:'The exact same physical getTransaction requests still occur; selective retention changes storage only.',rpcSavingsFromRetainingFewerFetchedFields:0,localBroadDiscardByteSavings:0,C:'A separate versioned hypothesis can omit broad flow subscription, but loses buyer/netbuy/persistence information; it is not an equivalent implementation of A.'},retainedProjection:retainedFieldProjectionMeasurement(),retained:retainedEntryAssessment(),economicResults:null,maximumPracticalCapacity:null,providerRequests:0,productionChanged:false,entriesEnabled:false,liveTrading:false,acceptanceClockStarted:false,recommendation:{A:'Retain as frozen comparison baseline; edge remains unproven.',B:'Do not integrate an extra screen. Existing support/liquidity/quote checks are already mandatory and should be reused. The new10s price-sign gate changes selection, consumes incremental quotes when not otherwise available and delays warming; economic value remains unassessed.',C:'Economically not assessable; no fabricated flow fields or implicit production strategy replacement.'},limitations:['All changing prices, flows, exact amounts, trader identities and validations in synthetic scenarios are generated fixtures, not natural market observations.','Pricing inputs are synthetic already-validated size quotes; this module does not claim live SDK/pool evidence for them. Existing decoder/fees/execution/risk requirements must still pass before any real PAPER fill.','A/B strategy features always come from complete available fixture events after actual observation starts; B never backfills earlier discarded events.','C deliberately changes the information hypothesis and exposes null buyer/netflow fields; results are not same-strategy equivalence.','RPC operation counters are modeled retrieval workloads; no current429 was cleared and no approved request/capture allowance was consumed.','Observation continues after a signal for the matched180s window; counts are not per-filled-trade lifecycle cost.','No P&L, return, drawdown, winner statistics or profitable-entry recommendation is inferred from synthetic signal mechanics.']};
}
