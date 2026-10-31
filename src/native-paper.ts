/** Small isolated integration adapter. Existing PaperLedger remains the sole
 * financial writer. Program-native evidence never becomes a blockchain order. */
import type {MigrationIdentity} from './migration-identity.js';
import {PaperLedger,isLiquidityResilientPaperStrategy,OPERATING_FINANCIAL_READINESS_VERSION,TECHNICAL_PROTECTION_PAUSE_REASONS,dailyLossEntryBlocked,isV3PaperRiskState,type OperatingFinancialReadiness,type LedgerState,type UsdPrice,type Position,type Mark} from './ledger.js';
import {createHash} from 'node:crypto';
import {PaperTrader,TEMPORARY_ENTRY_READINESS_PAUSES,type TraderTickOptions} from './trader.js';
import {PilotMarket} from './pilot-market.js';
import type {PilotNativeFlow,PilotNativeFlowOptions} from './pilot-native-flow.js';
import type {NativeAuditCertificate,NativeEconomicRejection} from './native-candidate-runner.js';
import {ADAPTIVE_PILOT_BINDING,LIQUIDITY_RESILIENT_PILOT_BINDING,type PilotBinding} from './pilot-contract.js';
import {PROVISIONAL_RULE,assessPredictiveBuying,eventIdentity,type FlowFeatures,type NormalizedTrade} from './strategy.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION,assessLiquidityResilientBuying,deriveV3Consolidation,v3CpmmSell,type V3AuditedFlow,type V3ConsolidationEvidence,type V3Evidence,type V3ExitInput,type V3MarketEvidence,type V3ReserveObservation} from './liquidity-resilient-momentum-v3.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,assessLiquidityResilientBuyingV31,deriveV31Consolidation} from './liquidity-resilient-momentum-v3-1.js';
import {entryAgeEligible} from './observation-age.js';
import {assessAdaptiveBuying,adaptiveMigrationEligible} from './adaptive-momentum-v2.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION,nativePaperEvidenceReady} from './native-paper-contract.js';
import type {ExecutionContext} from './execution.js';
import type {TechnicalReevaluationReason} from './pilot-watch.js';
import {assertNativePaperAccount,type OperatingAccountBinding} from './poe-operating-account.js';

type RecordSource={record:(kind:string,data:unknown)=>void};
export type NativePaperPool={identity:MigrationIdentity;evidence:string};
export type NativeQualificationProof={proofId:string;mint:string;startAt:number;throughAt:number;windowEndAt:number;featuresSha256:string;certificateAt:number;deadlineAt:number};
export type NativeTechnicalReevaluation={mint:string;reason:TechnicalReevaluationReason;failedWindowEndAt:number;at:number;claimedOnly?:true};
export type NativePaperOptions={runId?:string;executionRealism?:true;operatingFinancialReadiness?:boolean;entryPreparationMaximumMs?:(at:number)=>number;ledger:PaperLedger;market:PilotMarket;binding:PilotBinding;source:Pick<PilotNativeFlow,'snapshot'|'usage'>;certificate:(mint:string,at:number)=>NativeAuditCertificate|null;record:RecordSource['record'];withProtectionWork?:<T>(work:()=>Promise<T>)=>Promise<T>;withFinancialExecutionWork?:<T>(work:()=>Promise<T>)=>Promise<T>;admitNewRisk?:(at:number)=>boolean;admitFinancialReadiness?:(at:number)=>boolean;internalShutdownRecovery?:(at:number)=>ReturnType<PaperLedger['internalShutdownRecoveryProof']>;now?:()=>number;restoredPools?:Readonly<Record<string,NativePaperPool>>;fixtureAccountBinding?:OperatingAccountBinding;pinQualification?:(proof:NativeQualificationProof)=>void;onTechnicalReevaluation?:(request:NativeTechnicalReevaluation)=>void;onEvaluationComplete?:(mint:string,at:number)=>void;onEconomicRejection?:(request:NativeEconomicRejection)=>void};
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
export const NATIVE_PAPER_FINANCIAL_READINESS_POLICY=Object.freeze({version:'native-paper-general-arming-internal-checkpoint-v2',targetMs:1000,maximumReconciliationAgeMs:2000,timerMs:250,localHeadroomMs:250,usdMaximumAgeMs:10000,marketEvidence:'original audited windowEndAt <= 2000ms after mandatory assessment record, before normal weak-candidate retirement; no price or executable quote claimed',internalStopRecovery:'bounded ordered original-account known-run control provenance; no owner/unknown/hard safety intent',operatingFinancialReadinessVersion:OPERATING_FINANCIAL_READINESS_VERSION,operatingFinancialPermission:'Current cash or complete exact-size held inventory plus original verified bank Clock, fresh USD/reconciliation and current financial admission; no candidate window or qualification asserted',generalPermission:'financial authorization independent of individual candidate qualification, queued work, physical RPC occupancy and position capacity; actual entry admission remains separate',recoverablePauseReasons:TEMPORARY_ENTRY_READINESS_PAUSES});
export const NATIVE_PAPER_ENTRY_BLOCKERS=Object.freeze({manual:'POE_ENTRY_MANUAL_PAUSE',stop:'POE_ENTRY_SAFE_STOP',loss:'POE_ENTRY_DAILY_LOSS',policy:'POE_ENTRY_RISK_POLICY_REQUIRED',uncertainty:'POE_ENTRY_FINANCIAL_UNCERTAINTY',evidence:'POE_ENTRY_EVIDENCE_UNAVAILABLE',usd:'POE_ENTRY_USD_UNAVAILABLE',liquidation:'POE_ENTRY_LIQUIDATION_UNAVAILABLE',reconciliationRequired:'POE_ENTRY_RECONCILIATION_REQUIRED',reconciliationStale:'POE_ENTRY_RECONCILIATION_STALE',provider:'POE_ENTRY_PROVIDER_UNAVAILABLE',source:'POE_ENTRY_SOURCE_UNAVAILABLE',monitoring:'POE_ENTRY_MONITORING_UNAVAILABLE',readiness:'POE_ENTRY_READINESS_REQUIRED',protection:'POE_ENTRY_PROTECTION_RECOVERY_REQUIRED',paused:'POE_ENTRY_FINANCIAL_PAUSED'} as const);
export const NATIVE_PAPER_PROTECTION_PAUSE_REASONS=TECHNICAL_PROTECTION_PAUSE_REASONS;
const INTERNAL_STOP_DIAGNOSTIC_CODES=['INTERNAL_SHUTDOWN_NOT_EVALUATED','INTERNAL_SHUTDOWN_VERIFIED','INTERNAL_SHUTDOWN_PROOF_TIME','INTERNAL_SHUTDOWN_NOT_REQUESTED','INTERNAL_SHUTDOWN_RUN_SET','INTERNAL_SHUTDOWN_RUN_TIME','INTERNAL_SHUTDOWN_INCEPTION','INTERNAL_SHUTDOWN_HISTORY_MALFORMED','INTERNAL_SHUTDOWN_HISTORY_BOUND','INTERNAL_SHUTDOWN_OWNER_OR_UNKNOWN_STOP','INTERNAL_SHUTDOWN_STOP_BOUND','INTERNAL_SHUTDOWN_HARD_OR_UNKNOWN_PAUSE','INTERNAL_SHUTDOWN_CHAIN_ABSENT','INTERNAL_SHUTDOWN_STATE_CHANGED'] as const;
export function nativePaperDerivedEntryBlocker(input:{at:number;state:LedgerState;projection:ReturnType<PaperLedger['projection']>;safety:ReturnType<PaperTrader['entryReadinessSafety']>;requireV3Policy?:boolean;manualPaused?:boolean;safeStopRequested?:boolean;evidenceAvailable?:boolean;providerAvailable?:boolean;sourceAvailable?:boolean;monitoringAvailable?:boolean;candidateEvidenceReady?:boolean}){
 const {at,state:s,projection:p,safety}=input,b=NATIVE_PAPER_ENTRY_BLOCKERS;
 if(input.safeStopRequested||s.controls.stopRequested)return b.stop;if(input.manualPaused)return b.manual;if(dailyLossEntryBlocked(s))return b.loss;
 if(input.requireV3Policy&&!isV3PaperRiskState(s))return b.policy;
 if(!safety.recoveryComplete||!safety.idle||!safety.financialAvailable||safety.uncertainActions>0)return b.uncertainty;if(!safety.evidenceAvailable||input.evidenceAvailable===false)return b.evidence;
 if(!p.usdValuationAvailable)return b.usd;if(p.unknownMarks)return b.liquidation;
 if(s.daily.day!==new Date(at).toISOString().slice(0,10)||s.daily.reconciledAt<=0||s.daily.reconciledAt>at)return b.reconciliationRequired;
 if(at-s.daily.reconciledAt>NATIVE_PAPER_FINANCIAL_READINESS_POLICY.maximumReconciliationAgeMs)return b.reconciliationStale;
 if(input.providerAvailable===false)return b.provider;if(input.sourceAvailable===false)return b.source;if(input.monitoringAvailable===false)return b.monitoring;
 if(!s.controls.entriesEnabled||s.daily.paused){if(NATIVE_PAPER_PROTECTION_PAUSE_REASONS.includes(s.controls.reason as never))return b.protection;return NATIVE_PAPER_FINANCIAL_READINESS_POLICY.recoverablePauseReasons.includes(s.controls.reason as never)?b.readiness:b.paused;}
 return null;
}
export class NativePaper {
 readonly trader:PaperTrader;private readonly adaptive:boolean;private readonly resilient:boolean;private readonly resilient31:boolean;private readonly now:()=>number;private readonly maximumPositions:PilotBinding['maxPositions'];private readonly pools=new Map<string,NativePaperPool>();private readonly retired=new Set<string>();private readonly lastCandidateBucket=new Map<string,number>();
 private readonly v3Trades=new Map<string,Map<string,{trade:NormalizedTrade;reserve:V3ReserveObservation|null;inventory:NonNullable<V3AuditedFlow['observedWalletInventory']>[number]|null}>>();
 private readonly v3Consolidation=new Map<string,V3ConsolidationEvidence[]>();
 private readonly v3PriorHeldReserves=new Map<string,{units:string;roundTripId:string;at:number;raw:string;economic:V3ReserveObservation}>();
 private context:ExecutionContext={price:null,marks:{}};
 private internalStopDiagnostic:{code:typeof INTERNAL_STOP_DIAGNOSTIC_CODES[number];at:number|null;lastSuccessfulResumeRevision:number|null;knownStopCount:number|null}={code:'INTERNAL_SHUTDOWN_NOT_EVALUATED',at:null,lastSuccessfulResumeRevision:null,knownStopCount:null};
 private readonly internalStopRefusalCounts:Partial<Record<typeof INTERNAL_STOP_DIAGNOSTIC_CODES[number],number>>={};
 constructor(private readonly options:NativePaperOptions){
  this.now=options.now??Date.now;this.resilient31=options.binding.version===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION;this.resilient=isLiquidityResilientPaperStrategy(options.binding.version);this.adaptive=this.resilient||options.binding.version===ADAPTIVE_PILOT_BINDING.version;this.maximumPositions=options.binding.maxPositions;const state=options.ledger.state();assertNativePaperAccount(state,options.fixtureAccountBinding);
  for(const [mint,pool]of Object.entries(options.restoredPools??{}))if(state.positions[mint]||Object.values(state.pending).some(o=>o.mint===mint))this.register(pool.identity,pool.evidence);
  for(const mint of new Set([...Object.keys(state.positions),...Object.values(state.pending).map(o=>o.mint)]))need(this.pools.has(mint),'NATIVE_PAPER_OWNED_POOL_PROOF_REQUIRED');
  // Ordinary ticks validate/sanitize this read and reconcile in PaperTrader.
  // Due actions bypass that tick stage, so only their execution context performs
  // its own fresh reconciliation before ledger.attempt checks financial gates.
  const context=async(positions:LedgerState['positions'],signal:AbortSignal)=>{const current=await (options.withProtectionWork?options.withProtectionWork(()=>options.market.context(positions,signal)):options.market.context(positions,signal));this.context=current;return current;};
  const executionContext=async(positions:LedgerState['positions'],signal:AbortSignal)=>{const current=await context(positions,signal),at=this.now();if(current.price){const marks=Object.keys(positions).length&&(!Number.isSafeInteger(current.sourceValidUntil)||current.sourceValidUntil!<at)?{}:current.marks;try{options.ledger.reconcile('native-paper-context:'+options.ledger.state().revision+':'+at,at,current.price,marks);}catch{this.trader?.pauseNewEntries('current financial reconciliation unavailable; exposure retained');}}return current;};
  const executionQuote=(request:Parameters<PilotMarket['executionQuote']>[0],signal:AbortSignal)=>{
   const pending=options.ledger.state().pending[request.order.id];
   if(!pending||JSON.stringify(pending)!==JSON.stringify(request.order))return Promise.resolve(null);
   return options.withFinancialExecutionWork?options.withFinancialExecutionWork(()=>options.market.executionQuote(request,signal)):options.market.executionQuote(request,signal);
  };
  if(options.executionRealism)need(options.market.executionRealismEnabled(),'NATIVE_PAPER_EXECUTION_MODEL_REQUIRED');
  this.trader=new PaperTrader({ledger:options.ledger,now:this.now,runId:options.runId,...(this.resilient?{maximumCandidates:4}:{}),...(options.executionRealism?{executionPlan:(order)=>options.market.executionPlan(order)}:{}),context,quote:options.market.quote,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'Frozen isolated PAPER fees/delay; program-native data contract '+NATIVE_PAPER_DATA_CONTRACT_VERSION},recorder:{record:options.record},flowVerification:{verified:true,evidence:NATIVE_PAPER_DATA_CONTRACT_VERSION},...(!this.resilient31?{predictiveDiagnostics:true as const}:{}),deferPredictivelyRejectedQuotes:true,candidateReadiness:(mint,at)=>this.options.admitNewRisk?.(at)===true&&this.ready(mint,at)&&this.entryAge(mint,at),predictiveReadiness:(mint,at)=>this.ready(mint,at),experimentalPilot:options.binding,operatingAccount:options.fixtureAccountBinding?undefined:true,pilotExecution:{context:executionContext,quote:executionQuote},timeoutMs:3000,...(this.resilient?{...(this.resilient31?{liquidityResilientMomentumV31:true as const,repriceEntryQuote:options.market.repriceEntryQuote}:{liquidityResilientMomentumV3:true as const}),v3Evidence:(mint:string,at:number,market?:V3MarketEvidence)=>this.v3Evidence(mint,at,market),v3HoldingEvidence:(position:Position,mark:Mark|null,at:number)=>this.v3HoldingEvidence(position,mark,at)}:this.adaptive?{adaptiveMomentumV2:true as const}:{})});
  this.trader.start();options.record('native-paper-start',{at:this.now(),accountId:state.accountId,inceptionAt:state.inceptionAt,contract:NATIVE_PAPER_DATA_CONTRACT_VERSION,sourceContract:options.source.usage().dataContract,strategyVersion:options.binding.version,strategyMode:this.resilient?options.binding.version:this.adaptive?'adaptive-momentum-v2':'baseline',liveTradingEnabled:false,capitalInitialized:false});
 }
 private entryAge(mint:string,at:number){const pool=this.pools.get(mint);if(!pool)return false;const migrationAt=pool.identity.chainBlockTime*1000;return this.adaptive?adaptiveMigrationEligible(migrationAt,true,at):entryAgeEligible(migrationAt,at);}
 private entryHistory(mint:string,at:number,windowEndAt?:number){
  if(!this.adaptive)return !this.options.ledger.hasTradedMint(mint);
  const end=windowEndAt??this.trader.candidateFeatures(mint,at)?.windowEndAt;
  return end!==undefined&&this.options.ledger.entryEligibility(mint,this.options.binding.version,end,at).allowed;
 }
 private assessment(features:ReturnType<PaperTrader['candidateFeatures']>,at:number){return features?(this.resilient?(this.resilient31?assessLiquidityResilientBuyingV31(features,at,this.v3Evidence(features.mint,at)??undefined):assessLiquidityResilientBuying(features,at,this.v3Evidence(features.mint,at)??undefined)):this.adaptive?assessAdaptiveBuying(features,at):assessPredictiveBuying(features,at)):null;}
 candidateAssessment=(mint:string,features:FlowFeatures,at:number)=>this.resilient31?assessLiquidityResilientBuyingV31(features,at,this.v3Evidence(mint,at)??undefined):assessLiquidityResilientBuying(features,at,this.v3Evidence(mint,at)??undefined);
 candidateEvidence=(mint:string,at:number)=>this.v3Evidence(mint,at);
 private v3Evidence(mint:string,at:number,market?:V3MarketEvidence):V3Evidence|null{
  const features=this.trader?.candidateFeatures(mint,at),pool=this.pools.get(mint),certificate=this.options.certificate(mint,at);
  if(!this.resilient||!features||!pool||!certificate||!this.ready(mint,at))return null;
  const rows=[...(this.v3Trades.get(mint)?.values()??[])].filter(row=>row.trade.receivedAt>=features.windowStartAt&&row.trade.receivedAt<features.windowEndAt).sort((a,b)=>a.trade.receivedAt-b.trade.receivedAt);
  const prior=this.v3Consolidation.get(mint)??[],auditEvidence='native-audit:'+createHash('sha256').update(JSON.stringify(certificate)).digest('hex');
  const flow:V3AuditedFlow={mint,pool:pool.identity.pool,windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditedAt:certificate.auditAvailableAt,auditEvidence,complete:true,
   trades:rows.map(row=>structuredClone(row.trade)),reserveObservations:rows.flatMap(row=>row.reserve?[structuredClone(row.reserve)]:[]),observedWalletInventory:rows.flatMap(row=>row.inventory?[structuredClone(row.inventory)]:[]),
   ...(prior.findLast(row=>row.windowEndAt<=features.windowStartAt)?{priorConsolidation:structuredClone(prior.findLast(row=>row.windowEndAt<=features.windowStartAt)!)}:{})};
  if(!prior.some(row=>row.windowEndAt===features.windowEndAt)){
   const measured=this.resilient31?deriveV31Consolidation(features,flow,at):deriveV3Consolidation(features,flow,at);if(measured){prior.push(measured);if(prior.length>12)prior.shift();this.v3Consolidation.set(mint,prior);}
  }
  // The pure strategy verifies every trade and aggregate, including count and
  // identities; a sampled/overflown local series cannot pass as complete flow.
  return {flow,...(market?{market}:{})};
 }
 private v3HoldingEvidence(position:Position,mark:Mark|null,at:number):Pick<V3ExitInput,'liquidityContext'|'flowContext'>{
  const evidence:Pick<V3ExitInput,'liquidityContext'|'flowContext'>={},q=mark?this.options.market.currentObservation(position.mint,position.units):null;
  if(mark&&q&&Date.parse(q.receivedAt)===mark.at&&q.sell.inputBaseUnits===position.units){
   try{
    const pool={base:BigInt(q.rawBaseReserve),raw:BigInt(q.rawQuoteReserve),virtual:BigInt(q.virtualQuoteReserves),buckets:BigInt(q.feeBuckets),fees:{lpFeeBps:Number(q.feeBps.lpFeeBps),protocolFeeBps:Number(q.feeBps.protocolFeeBps),creatorFeeBps:q.creatorFeeApplied?Number(q.feeBps.creatorFeeBps):0}};
    const prior=this.v3PriorHeldReserves.get(position.mint),same=prior?.units===position.units&&prior.roundTripId===position.strategy?.roundTripId;
    const stressedPool=v3CpmmSell(pool,(pool.base+99n)/100n).pool,stressedGross=v3CpmmSell(stressedPool,BigInt(position.units)).output,gas=BigInt(this.options.market.gasLamports);
    const economic:V3ReserveObservation={at:mark.at,evidence:mark.evidence,baseReserveUnits:q.rawBaseReserve,rawQuoteReserveLamports:q.rawQuoteReserve,virtualQuoteReserveLamports:q.virtualQuoteReserves,feeBucketsLamports:q.feeBuckets};
    evidence.liquidityContext={at:mark.at,evidence:mark.evidence,pricedBaseUnits:position.units,immediateNetLamports:mark.netLamports,stressedNetLamports:(stressedGross>gas?stressedGross-gas:0n).toString(),rawQuoteReserveLamports:q.rawQuoteReserve,...(same&&prior.at<mark.at?{priorRawQuoteReserveLamports:prior.raw}:{}),...(this.resilient31?{economicReserves:economic,...(same&&prior.at<mark.at?{priorEconomicReserves:prior.economic}:{})}:{})};
    if(!same||prior.at<mark.at)this.v3PriorHeldReserves.set(position.mint,{units:position.units,roundTripId:position.strategy?.roundTripId??'',at:mark.at,raw:q.rawQuoteReserve,economic});
   }catch{/* A failed declared stress is unknown; never an invented valuation. */}
  }
  const flow=this.v3Evidence(position.mint,at)?.flow,features=this.trader.candidateFeatures(position.mint,at);
  if(flow&&features){const recent=flow.trades.filter(t=>t.receivedAt>=flow.windowEndAt-30000).reduce((sum,t)=>sum+(t.side==='buy'?1n:-1n)*BigInt(t.quoteLamports),0n);evidence.flowContext={at:flow.windowEndAt,availableAt:flow.auditedAt,evidence:flow.auditEvidence,complete:true,netBuyLamports:features.netBuyLamports,recentNetBuyLamports:recent.toString(),priceReturnBps:features.priceReturnBps};}
  return evidence;
 }
 private register(identity:MigrationIdentity,evidence='independently decoded finalized migration identity'){
  const prior=this.pools.get(identity.baseMint);need(!prior||prior.identity.pool===identity.pool&&prior.identity.signature===identity.signature,'NATIVE_PAPER_POOL_IDENTITY_CHANGED');
  this.options.market.registerPool({mint:identity.baseMint,migrationSlot:identity.slot,migrationVerified:true,evidence});this.pools.set(identity.baseMint,{identity:structuredClone(identity),evidence});
 }
 allocated=(identity:MigrationIdentity)=>{this.register(identity);this.retired.delete(identity.baseMint);this.trader.admit({mint:identity.baseMint,migrationAt:identity.chainBlockTime*1000,migrationVerified:true,supportedPool:true,evidence:'native verified origin '+identity.signature});};
 opened=(row:{mint:string;at:number})=>{if(!this.pools.has(row.mint))return;this.v3Trades.delete(row.mint);this.v3Consolidation.delete(row.mint);this.trader.activateFlow(row.mint,'native actual confirmed subscription ACK',row.at);};
 trade: PilotNativeFlowOptions['onTrade']=row=>{if(!this.pools.has(row.trade.mint))return;this.trader.ingest(row.trade,'curve');this.slot(row.trade.mint,row.trade.slot!);if(this.resilient){const rows=this.v3Trades.get(row.trade.mint)??new Map(),key=eventIdentity(row.trade.identity),cutoff=Math.floor(row.trade.receivedAt/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs-PROVISIONAL_RULE.windowMs;for(const [id,item]of rows){if(item.trade.receivedAt<cutoff)rows.delete(id);else break;}if(!rows.has(key)&&rows.size>=4096){this.gap({mint:row.trade.mint,at:row.validatedAt,reason:'V3_COMPLETE_TRADE_RETENTION_UNAVAILABLE'});return;}rows.delete(key);rows.set(key,{trade:structuredClone(row.trade),reserve:row.evidence.reserveObservation?{...row.evidence.reserveObservation,at:row.trade.receivedAt,evidence:row.evidence.eventBytesSha256}:null,inventory:row.evidence.userBaseTokenReserveUnits===undefined||!row.evidence.userBaseTokenAccount||row.evidence.userBaseTokenAccount==='11111111111111111111111111111111'?null:{wallet:row.evidence.trader,baseUnits:row.evidence.userBaseTokenReserveUnits,at:row.trade.receivedAt,evidence:row.evidence.eventBytesSha256,tokenAccount:row.evidence.userBaseTokenAccount,eventIdentity:key,balanceTiming:'before-trade' as const}});this.v3Trades.set(row.trade.mint,rows);}};
 protocol:NonNullable<PilotNativeFlowOptions['onProtocolEffect']>=row=>{if(this.pools.has(row.mint))this.slot(row.mint,row.slot);};
 private slot(mint:string,slot:number){this.options.market.minimumSlot(mint,slot);if(this.trader.hasCandidate(mint))this.trader.noteCandidateSlot(mint,slot);}
 gap=(row:{mint?:string;at:number;reason:string})=>{const mints=row.mint?[row.mint]:[...this.pools.keys()];for(const mint of mints){this.v3Trades.delete(mint);this.v3Consolidation.delete(mint);if(this.trader.hasCandidate(mint))this.trader.candidateGap(mint,row.reason);}};
 retiredCandidate=(mint:string,reason:string)=>{this.gap({mint,at:this.now(),reason});this.retired.add(mint);};
 ownership=(mint:string):'HELD'|'ENTRY_PENDING'|null=>{const state=this.options.ledger.state();return state.positions[mint]?'HELD':Object.values(state.pending).some(o=>o.mint===mint)?'ENTRY_PENDING':null;};
 private entryCapacity(){const state=this.options.ledger.state(),heldPositions=Object.keys(state.positions).length,pendingBuyOrders=Object.values(state.pending).filter(o=>o.side==='buy').length;return {heldPositions,pendingBuyOrders,maximumPositions:this.maximumPositions,available:this.maximumPositions===null?this.options.ledger.v3RiskPolicyActive():heldPositions+pendingBuyOrders<this.maximumPositions};}
 ready(mint:string,at=this.now()){
  const view=this.options.source.snapshot(mint,at),certificate=this.options.certificate(mint,at),pool=this.pools.get(mint),features=this.trader.candidateFeatures(mint,at);
  return !!(view&&pool&&nativePaperEvidenceReady({contractVersion:NATIVE_PAPER_DATA_CONTRACT_VERSION,certificate,at,mint,pool:pool.identity.pool,dataContract:view.dataContract,openedAt:view.openedAt,connectionId:view.connectionId,subscriptionId:view.subscription,features,connected:view.connected,sourceSupportFresh:view.sourceSupportFresh,hasQualityLoss:view.hasQualityLoss}));
 }
 /** Called only outside an active financial/market adapter operation. */
 maintain(){if(this.options.market.retirementReady?.()===false)return;for(const mint of [...this.retired])if(!this.ownership(mint)){this.trader.remove(mint);this.options.market.unregisterPool(mint);this.pools.delete(mint);this.lastCandidateBucket.delete(mint);this.retired.delete(mint);}}
 private technical(mint:string,reason:TechnicalReevaluationReason,claimedOnly=false){
  if(!this.options.onTechnicalReevaluation||this.ownership(mint)||!this.entryHistory(mint,this.now()))return;
  const at=this.now(),request={mint,reason,at,...(claimedOnly?{claimedOnly:true as const}:{}),failedWindowEndAt:Math.floor(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs};this.options.record('native-paper-technical-reevaluation-request',{...request,oldOrderRetried:false,newCurrentAuditedWindowRequired:true,financialPermission:false});this.options.onTechnicalReevaluation(request);
 }
 private async tick(options:TraderTickOptions){
  const pending=this.options.ledger.state().pending,result=await this.trader.tick(options);
  for(const outcome of result.execution){const order=pending[outcome.orderId];if(order?.side!=='buy'||this.ownership(order.mint)||!this.entryHistory(order.mint,this.now()))continue;
   if(outcome.status==='expired')this.technical(order.mint,'entry-action-expired');
   else if(outcome.status==='failed'&&/^(USD valuation unavailable|unknown liquidation marks|missing\/stale first-attempt state|malformed first-attempt amounts)/.test(outcome.reason))this.technical(order.mint,'entry-attempt-data-unavailable');
   else if(outcome.status==='failed'||outcome.status==='canceled')this.options.onEvaluationComplete?.(order.mint,this.now());
  }return result;
 }
 async protection(options:TraderTickOptions={}){const result=await this.tick({...options,evaluateCandidates:false,maximumDueActions:1});if(this.options.operatingFinancialReadiness)this.maintainOperatingFinancialReadiness(this.context.price);return result;}
 /** No extra quote for a failed feature rule. Preparation/financial readiness
  * still recheck current evidence; an expired certificate never reserves entry. */
 candidateDue(mint:string,at=this.now()){const features=this.trader.candidateFeatures(mint,at),pool=this.pools.get(mint);return !!(features&&pool&&this.entryHistory(mint,at,features.windowEndAt)&&this.entryAge(mint,at)&&this.ready(mint,at)&&this.lastCandidateBucket.get(mint)!==features.windowEndAt);}
 qualificationProof(mint:string,at=this.now()):NativeQualificationProof|null{
  const pool=this.pools.get(mint),features=this.trader.candidateFeatures(mint,at),certificate=this.options.certificate(mint,at);
  if(!pool||!features||!certificate||!this.entryCapacity().available||this.ownership(mint)||!this.entryHistory(mint,at,features.windowEndAt)||!this.entryAge(mint,at)||!this.ready(mint,at)||this.assessment(features,at)?.status!=='not-rejected')return null;
  return {proofId:['entry',mint,features.windowEndAt,certificate.admittedAt,certificate.featuresSha256].join(':'),mint,startAt:features.windowStartAt,throughAt:at,windowEndAt:features.windowEndAt,featuresSha256:certificate.featuresSha256,certificateAt:certificate.admittedAt,deadlineAt:certificate.deadlineAt};
 }
 /** A qualifying market window is not authority to clear an owner or hard
  * financial stop. Recheck current state after every awaited preparation: a
  * stop can arrive while SDK/RPC work is in flight. The only stopped-account
  * exception is the same account/revision-bound internal shutdown proof used
  * by cash readiness; ordinary temporary preparation pauses remain retryable. */
 private candidateEntryAuthority(){
  const state=this.options.ledger.state(),safety=this.trader.entryReadinessSafety();
  if(this.resilient&&!this.options.ledger.v3RiskPolicyActive())return false;
  if(dailyLossEntryBlocked(state)||!safety.recoveryComplete||!safety.idle||!safety.evidenceAvailable||!safety.financialAvailable||safety.uncertainActions||safety.newHardPauseObserved)return false;
  const proof=(state.controls.stopRequested||!safety.automaticRecoveryAllowed)?this.options.internalShutdownRecovery?.(this.now()):null;
  const provedInternal=proof?.verified===true&&proof.stateRevision===state.revision&&proof.accountId===state.accountId&&proof.inceptionAt===state.inceptionAt;
  if(state.controls.stopRequested&&!provedInternal||!safety.automaticRecoveryAllowed&&!provedInternal)return false;
  if(this.options.operatingFinancialReadiness&&!state.controls.entriesEnabled&&!provedInternal)return this.options.ledger.operatingFinancialRecoveryAllowed(this.now());
  return state.controls.entriesEnabled||provedInternal||NATIVE_PAPER_FINANCIAL_READINESS_POLICY.recoverablePauseReasons.includes(state.controls.reason as never)||state.controls.reason==='startup: observation only; explicit runtime readiness required';
 }
 private refuseCandidateEntryAuthority(mint:string,at:number,windowEndAt:number){
  this.options.onEvaluationComplete?.(mint,this.now());this.lastCandidateBucket.set(mint,windowEndAt);
  this.options.record('native-paper-entry-unavailable',{mint,at,windowEndAt,reason:'financial-entry-control-authority-unavailable',predictiveOnly:true,executableQualification:false,orderCreated:false,existingFinancialActionsPreserved:true});
  return {kind:'entry-permission-refused' as const};
 }
 async candidate(mint:string,admitNewRisk:boolean){
  const at=this.now(),pool=this.pools.get(mint),features=this.trader.candidateFeatures(mint,at),entryCertificate=this.options.certificate(mint,at);if(!pool||!features||!this.ready(mint,at)||this.lastCandidateBucket.get(mint)===features.windowEndAt){this.technical(mint,'entry-preparation-unavailable',true);return {kind:'unavailable' as const};}
  // Required position slots are already committed by held exposure and pending
  // buys. A full account must not consume proof/rent/quote work or cancel an
  // existing action merely to reject another candidate later in PaperTrader.
  const capacity=this.entryCapacity();if(!capacity.available){this.options.onEvaluationComplete?.(mint,this.now());this.options.record('native-paper-entry-unavailable',{mint,at,windowEndAt:features.windowEndAt,reason:'simulated-position-capacity-reserved',...capacity,predictiveOnly:true,executableQualification:false,orderCreated:false,existingFinancialActionsPreserved:true});this.lastCandidateBucket.set(mint,features.windowEndAt);return {kind:'capacity-refused' as const};}
  if(!admitNewRisk||this.options.admitNewRisk?.(at)!==true){this.options.onEvaluationComplete?.(mint,this.now());this.options.record('native-paper-entry-unavailable',{mint,at,windowEndAt:features.windowEndAt,reason:'monitoring/time/request/response or pending-action reserve unavailable',predictiveOnly:true,executableQualification:false,orderCreated:false});this.lastCandidateBucket.set(mint,features.windowEndAt);return {kind:'capacity-refused' as const};}
  if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,at,features.windowEndAt);
  const assessment=this.assessment(features,at)!;
  if(assessment.status==='not-rejected'&&this.entryAge(mint,at)&&this.entryHistory(mint,at,features.windowEndAt)&&!this.ownership(mint)){
   let phase:'candidate-proof'|'candidate-preparation'|'financial-context'|'financial-resume'|'permission-evidence'='candidate-proof';
   try{if(this.options.pinQualification){const proof=this.qualificationProof(mint,this.now());need(proof,'NATIVE_PAPER_QUALIFICATION_PROOF_UNAVAILABLE');this.options.pinQualification(proof);need(this.ready(mint,this.now())&&this.options.admitNewRisk?.(this.now())===true,'NATIVE_PAPER_PINNED_PROOF_EXPIRED');}phase='candidate-preparation';const preparationAt=this.now(),preparationCertificate=this.options.certificate(mint,preparationAt),maximumMs=Math.floor(Math.min(3000,(preparationCertificate?.deadlineAt??preparationAt)-preparationAt,this.options.entryPreparationMaximumMs?.(preparationAt)??3000));need(Number.isSafeInteger(maximumMs)&&maximumMs>0,'NATIVE_PAPER_PREPARATION_DEFERRED_FOR_PROTECTION_OR_DEADLINE');const plan=await this.options.market.prepareEntryCosts(mint,new AbortController().signal,{maximumMs});this.trader.setPilotEntryDeposit(plan.depositLamports,plan.evidence,mint,plan.temporaryQuoteRentLamports??'0');
    if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,this.now(),features.windowEndAt);
    if(this.ready(mint,this.now())){phase='financial-context';await this.protection();const when=this.now(),context=this.context,state=this.options.ledger.state();if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,when,features.windowEndAt);if(context.price&&this.ready(mint,when)&&this.options.admitNewRisk?.(when)===true){phase='financial-resume';const safety=this.trader.entryReadinessSafety(),internal=(state.controls.stopRequested||!safety.automaticRecoveryAllowed)&&!safety.newHardPauseObserved?this.options.internalShutdownRecovery?.(when):null,provedInternal=internal?.verified===true&&internal.accountId===state.accountId&&internal.inceptionAt===state.inceptionAt&&internal.stateRevision===state.revision;
     let result:{enabled:boolean;reason:string};
     if(this.options.operatingFinancialReadiness&&!provedInternal){this.maintainOperatingFinancialReadiness(context.price);if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,this.now(),features.windowEndAt);result={enabled:this.options.ledger.projection(this.now(),context.price,context.marks).entriesEnabled,reason:'operating financial permission remains independently controlled'};}
     else{result=this.options.ledger.resume('native-paper-ready:'+state.revision+':'+when,when,context.price,context.marks,{version:NATIVE_PAPER_DATA_CONTRACT_VERSION,evidence:'current exact audited native window and isolated PAPER monitoring reserve',marketAt:plan.at,recoveryComplete:true,candidateWindowsReady:this.ready(mint,when),budgetAvailable:this.options.admitNewRisk?.(when)===true});if(result.enabled)this.trader.verifiedEntryReadinessRecovered();}
     phase='permission-evidence';this.options.record('native-paper-entry-permission',{at:when,result,mint,windowEndAt:features.windowEndAt});}}
   }catch(error){if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,this.now(),features.windowEndAt);
    // Proof expiry and read-only SDK/rent preparation affect this opportunity,
    // not the account's financial permission. Unexpected financial work or a
    // missing mandatory permission record remain global fail-closed events.
    const candidateLocal=phase==='candidate-proof'||phase==='candidate-preparation';
    if(!candidateLocal){if(phase==='permission-evidence')this.trader.pauseNewEntries('selected evidence unavailable; entries closed');else this.trader.financialMaintenanceFailed();}
    try{this.options.record('native-paper-entry-preparation-unavailable',{mint,at:this.now(),windowEndAt:features.windowEndAt,predictiveOnly:true,executableQualification:false,orderCreated:false,phase,candidateLocal,globalFinancialPermissionChanged:!candidateLocal,reason:error instanceof Error?error.message.slice(0,180):'unavailable'});}catch{this.trader.pauseNewEntries('selected evidence unavailable; entries closed');}
    this.lastCandidateBucket.set(mint,features.windowEndAt);if(candidateLocal)this.technical(mint,'entry-preparation-unavailable');return {kind:'preparation-unavailable' as const};}
  }
  if(!this.ready(mint,this.now())){if(assessment.status==='not-rejected')this.technical(mint,'entry-preparation-unavailable');return {kind:'unavailable' as const};}
  const before=this.trader.funnel.evaluated;await this.tick({candidateMint:mint,reuseFreshContext:true,maximumDueActions:1});
  // Decision pricing can consume material time after the tick's earlier held
  // evaluation. Yield back to existing exposure before a newly reserved buy's
  // modeled delay/attempt. Obtain a fresh shared exact-size mark rather than
  // making an earlier quote appear to advance the completed protection clock.
  if(Object.keys(this.options.ledger.state().positions).length)await this.protection();
  if(this.trader.funnel.evaluated>before){this.lastCandidateBucket.set(mint,features.windowEndAt);const decision=this.trader.decisions().filter(d=>d.mint===mint&&d.at>=at).at(-1);if(!this.ownership(mint)){if(assessment.status==='not-rejected'&&(decision?.stage==='qualified'||decision?.stage==='execution-unavailable'&&decision.reason==='PAPER execution preparation unavailable'||decision?.stage==='missing-data'&&['fresh-size-specific-quote-unavailable','v3-matched-fresh-actual-size-quote-required','v31-matched-fresh-actual-size-quote-required','v31-selected-size-sdk-quote-unavailable','v3.1-matched-fresh-actual-size-quote-required','v3.1-selected-size-sdk-quote-unavailable','v3.1-selected-size-outside-verified-allocation'].includes(decision.reason)))this.technical(mint,'entry-quote-unavailable');else{
    this.options.onEvaluationComplete?.(mint,this.now());
    if(this.resilient31&&entryCertificate&&decision?.stage==='strategy-rejection'&&decision.reason==='v3.1-nonpositive-joint-conditional-economic-balance'&&decision.ruleVersion===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION&&decision.quote?.liquidityResilience&&decision.features?.windowEndAt===entryCertificate.windowEndAt)this.options.onEconomicRejection?.({kind:'completed-economic-rejection',mint,pool:entryCertificate.pool,strategyVersion:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,windowEndAt:decision.features.windowEndAt,openedAt:entryCertificate.openedAt,decisionAt:decision.at,quoteAt:decision.quote.at,quoteEvidence:decision.quote.evidence,reobservationCostLamports:(BigInt(decision.quote.liquidityResilience.entryGasLamports)+BigInt(decision.quote.liquidityResilience.exitGasLamports)).toString(),reason:'v3.1-nonpositive-joint-conditional-economic-balance',at:this.now()});
   }}}else this.technical(mint,'entry-preparation-unavailable',true);return {kind:'evaluated' as const};
 }
 poolsForRecovery(){return Object.fromEntries([...this.pools].map(([mint,pool])=>[mint,structuredClone(pool)]));}
 valuation(){return this.context;}
 internalShutdownDiagnostics(){return {...this.internalStopDiagnostic};}
 internalShutdownRefusals(){return Object.fromEntries(Object.entries(this.internalStopRefusalCounts).map(([code,count])=>['internal-stop-proof:'+code,count!]));}
 /** Source-versioned operational permission, separate from any candidate's
  * qualification. Reuses completed financial facts only: no RPC, quote refresh,
  * original timestamp substitution, or order is performed by this controller. */
 maintainOperatingFinancialReadiness(price:UsdPrice|null,recover=true){
  const at=this.now(),state=this.options.ledger.state(),safety=this.trader.entryReadinessSafety();
  const technicalAuthority=this.options.operatingFinancialReadiness&&NATIVE_PAPER_PROTECTION_PAUSE_REASONS.includes(state.controls.reason as never)?this.options.ledger.technicalProtectionRecoveryAuthority(at):null;
  const refuse=(reasonCode:string,resetTechnical=true)=>{if(resetTechnical&&technicalAuthority?.verified)this.trader.technicalProtectionRecoveryProof(technicalAuthority,false,at);return {kind:'not-ready' as const,recovered:false,reasonCode};};
  if(!this.options.operatingFinancialReadiness)return refuse('OPERATING_READINESS_NOT_SELECTED');
  if(this.resilient&&!this.options.ledger.v3RiskPolicyActive())return refuse('OPERATING_READINESS_V3_EPOCH_AND_POLICY_REQUIRED');
  if(Object.keys(state.pending).length||!safety.idle||this.options.market.retirementReady?.()===false){refuse('OPERATING_READINESS_FINANCIAL_WORK_ACTIVE');return {kind:'busy' as const,recovered:false};}
  if(!recover||state.controls.entriesEnabled)return refuse('OPERATING_READINESS_NOT_REQUIRED');
  const technicalAllowed=technicalAuthority?.verified===true;
  if(state.controls.stopRequested||(!safety.automaticRecoveryAllowed||safety.newHardPauseObserved||!NATIVE_PAPER_FINANCIAL_READINESS_POLICY.recoverablePauseReasons.includes(state.controls.reason as never))&&!technicalAllowed)return refuse('OPERATING_READINESS_OWNER_OR_HARD_CONTROL');
  if(dailyLossEntryBlocked(state))return refuse('OPERATING_READINESS_DAILY_LOSS');
  if(!safety.recoveryComplete||!safety.evidenceAvailable||!safety.financialAvailable||safety.uncertainActions)return refuse('OPERATING_READINESS_FINANCIAL_OR_EVIDENCE_UNAVAILABLE');
  const admission=this.options.admitFinancialReadiness??this.options.admitNewRisk;if(admission?.(at)!==true)return refuse('OPERATING_READINESS_CURRENT_ADMISSION_UNAVAILABLE');
  if(!price||!Number.isSafeInteger(price.at)||price.at<0||price.at>at||at-price.at>NATIVE_PAPER_FINANCIAL_READINESS_POLICY.usdMaximumAgeMs||typeof price.microUsdPerSol!=='string'||!/^([1-9][0-9]{0,38})$/.test(price.microUsdPerSol)||typeof price.source!=='string'||!price.source||price.source.length>512||/[\u0000-\u001f]/.test(price.source)||state.daily.reconciledAt<=0||state.daily.reconciledAt>at||at-state.daily.reconciledAt>NATIVE_PAPER_FINANCIAL_READINESS_POLICY.maximumReconciliationAgeMs)return refuse('OPERATING_READINESS_FRESH_FINANCE_REQUIRED');
  const usage=this.options.source.usage();if(!usage.connected||usage.stopped||usage.fatal)return refuse('OPERATING_READINESS_CAPTURE_UNAVAILABLE');
  const positionUnits=Object.fromEntries(Object.entries(state.positions).map(([mint,position])=>[mint,position.units])),keys=Object.keys(positionUnits),marks=Object.fromEntries(keys.filter(mint=>this.context.marks[mint]).map(mint=>[mint,this.context.marks[mint]!]));
  const receivedAt=keys.length?Math.min(...keys.map(mint=>marks[mint]?.at??Infinity)):usage.lastFreshSupportAt,validUntil=keys.length?this.context.sourceValidUntil:Number(usage.lastBankClockAt)+30000,bankClockAt=keys.length?Number(validUntil)-30000:usage.lastBankClockAt;
  if(!Number.isSafeInteger(receivedAt)||!Number.isSafeInteger(validUntil)||!Number.isSafeInteger(bankClockAt)||Number(bankClockAt)>Number(receivedAt)||Number(receivedAt)>at||Number(validUntil)<at||Number(validUntil)!==Number(bankClockAt)+30000)return refuse('OPERATING_READINESS_CURRENT_SOURCE_CLOCK_REQUIRED');
  if(keys.some(mint=>!marks[mint]||marks[mint]!.pricedBaseUnits!==positionUnits[mint]||marks[mint]!.at<state.positions[mint]!.enteredAt||marks[mint]!.at>at||at-marks[mint]!.at>2000)||Object.keys(marks).length!==keys.length)return refuse('OPERATING_READINESS_EXACT_HELD_MARKS_REQUIRED');
  const projection=this.options.ledger.projection(at,price,marks);if(!projection.usdValuationAvailable||projection.unknownMarks)return refuse('OPERATING_READINESS_CURRENT_INVENTORY_REQUIRED');
  const technicalProof=technicalAllowed?this.trader.technicalProtectionRecoveryProof(technicalAuthority,true,at):null;if(technicalAllowed&&!technicalProof)return refuse('OPERATING_READINESS_SUSTAINED_PROTECTION_RECOVERY_REQUIRED',false);
  const readiness:OperatingFinancialReadiness={...(technicalProof?{technicalProtectionRecovery:technicalProof}:{}),version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'current original financial reconciliation, exact complete inventory and original verified bank Clock source; no candidate window, signal, entry price or order asserted',accountId:state.accountId,stateRevision:state.revision,reconciledAt:state.daily.reconciledAt,positionUnits,source:{kind:keys.length?'complete-held-liquidation-context':'selected-native-support',bankClockAt:Number(bankClockAt),receivedAt:Number(receivedAt),validUntil:Number(validUntil)},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true};
  let result;try{result=this.options.ledger.resume('native-paper-operating-financial-ready:'+state.revision+':'+at,at,price,marks,readiness);}catch{this.trader.financialMaintenanceFailed();return {kind:'financial-unavailable' as const,recovered:false};}
  if(result.enabled&&!technicalProof)this.trader.verifiedEntryReadinessRecovered();
  const retained=this.trader.recordFinancialReadiness({at,version:readiness.version,purpose:readiness.purpose,source:readiness.source,reconciledAt:readiness.reconciledAt,positionUnits,financialPermissionOnly:true,candidateWindowClaimed:false,entryQuoteClaimed:false,orderCreated:false,...(technicalProof?{technicalProtectionRecovery:technicalProof}:{}),result});
  if(result.enabled&&technicalProof&&!retained){
   // A required record can be durable yet too slow to retain a fresh proof.
   // Finalize its issued-proof failure rather than stranding an enabled ledger
   // behind a private hard latch. Never overwrite a newer owner/control intent.
   const owned=()=>{const current=this.options.ledger.state();return current.accountId===state.accountId&&current.inceptionAt===state.inceptionAt&&current.controls.entriesEnabled&&!current.controls.stopRequested&&current.controls.reason==='explicit verified operating financial readiness'&&current.controls.changedAt===at;};
   if(owned()&&!this.trader.technicalProtectionRecoveryCommitted(technicalProof)&&owned())this.trader.pauseNewEntries('PAPER protection unavailable; exposure retained');
  }
  if(result.enabled&&technicalProof&&retained){const commitAt=this.now(),currentSource=this.options.source.usage(),healthy=readiness.source.validUntil>=commitAt&&admission?.(commitAt)===true&&currentSource.connected&&!currentSource.stopped&&!currentSource.fatal&&this.options.ledger.projection(commitAt,price,marks).entriesEnabled;
   if(!healthy)this.trader.pauseNewEntries(technicalProof.controlReason);
   else if(!this.trader.technicalProtectionRecoveryCommitted(technicalProof))this.trader.pauseNewEntries('technical protection recovery commit unavailable; entries closed');
  }
  const afterRecord=this.now(),finalSafety=this.trader.entryReadinessSafety();
  return {kind:'reconciled' as const,recovered:result.enabled&&retained&&finalSafety.evidenceAvailable&&finalSafety.financialAvailable&&finalSafety.automaticRecoveryAllowed&&!finalSafety.newHardPauseObserved&&!finalSafety.uncertainActions&&readiness.source.validUntil>=afterRecord&&admission?.(afterRecord)===true&&this.options.ledger.projection(afterRecord,price,marks).entriesEnabled};
 }
 /** Cash-only maintenance: no market adapter, quote, feature assessment, order,
  * or outstanding financial action is driven by this synchronous operation. */
 maintainFlatFinancialReadiness(price:UsdPrice|null,recover=true,freshlyAuditedMint?:string){
  const at=this.now(),state=this.options.ledger.state(),safety=this.trader.entryReadinessSafety();
  if(Object.keys(state.positions).length||Object.keys(state.pending).length||!safety.idle)return {kind:'busy' as const,recovered:false};
  if(!safety.financialAvailable)return {kind:'financial-unavailable' as const,recovered:false};
  const currentPrice=(when:number)=>!!price&&Number.isSafeInteger(price.at)&&price.at>=0&&price.at<=when&&when-price.at<=NATIVE_PAPER_FINANCIAL_READINESS_POLICY.usdMaximumAgeMs&&typeof price.microUsdPerSol==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(price.microUsdPerSol)&&BigInt(price.microUsdPerSol)>0n&&typeof price.source==='string'&&price.source.length>0&&price.source.length<=512&&!/[\u0000-\u001f]/.test(price.source);
  if(!currentPrice(at)){this.context={price:null,marks:{}};this.trader.refreshFlatContext(null);this.trader.pauseNewEntries('current equity or liquidation unavailable; entries closed');return {kind:'unavailable' as const,recovered:false};}
  try{this.options.ledger.reconcile('native-paper-cash:'+state.revision+':'+at,at,price!,{});this.trader.funnel.reconciled++;this.context={price:{...price!},marks:{}};this.trader.refreshFlatContext(price);}
  catch{this.trader.financialMaintenanceFailed();return {kind:'financial-unavailable' as const,recovered:false};}
  // Reconciliation/SQLite callbacks can consume real time. Never apply later
  // readiness using the pre-write wall clock or make an old cutoff look fresh.
  const when=this.now();if(!currentPrice(when)||when-at>NATIVE_PAPER_FINANCIAL_READINESS_POLICY.maximumReconciliationAgeMs)return {kind:'reconciled' as const,recovered:false};
  const current=this.options.ledger.state(),freshSafety=this.trader.entryReadinessSafety(),financialAdmission=this.options.admitFinancialReadiness??this.options.admitNewRisk;
  if(this.options.operatingFinancialReadiness&&!current.controls.stopRequested)return this.maintainOperatingFinancialReadiness(price,recover);
  if(!recover||this.resilient&&!this.options.ledger.v3RiskPolicyActive()||current.controls.entriesEnabled||dailyLossEntryBlocked(current)||!freshSafety.recoveryComplete||!freshSafety.evidenceAvailable||!freshSafety.financialAvailable||freshSafety.uncertainActions||financialAdmission?.(when)!==true)return {kind:'reconciled' as const,recovered:false};
  for(const [mint,pool]of this.pools){
   if(freshlyAuditedMint!==undefined&&mint!==freshlyAuditedMint)continue;
   const now=this.now(),certificate=this.options.certificate(mint,now);if(!currentPrice(now)||!certificate||certificate.windowEndAt>now||now-certificate.windowEndAt>NATIVE_PAPER_FINANCIAL_READINESS_POLICY.maximumReconciliationAgeMs||!this.entryHistory(mint,now,certificate.windowEndAt)||!this.entryAge(mint,now)||!this.ready(mint,now)||financialAdmission?.(now)!==true)continue;
   const internalStop=(current.controls.stopRequested||!freshSafety.automaticRecoveryAllowed)&&!freshSafety.newHardPauseObserved?this.options.internalShutdownRecovery?.(now):null;
   if(internalStop){const code=internalStop.verified?'INTERNAL_SHUTDOWN_VERIFIED':INTERNAL_STOP_DIAGNOSTIC_CODES.includes(internalStop.reason as never)?internalStop.reason as typeof INTERNAL_STOP_DIAGNOSTIC_CODES[number]:'INTERNAL_SHUTDOWN_HISTORY_MALFORMED';if(code!=='INTERNAL_SHUTDOWN_VERIFIED'&&code!=='INTERNAL_SHUTDOWN_NOT_EVALUATED'&&code!==this.internalStopDiagnostic.code)this.internalStopRefusalCounts[code]=(this.internalStopRefusalCounts[code]??0)+1;this.internalStopDiagnostic={code,at:now,lastSuccessfulResumeRevision:internalStop.verified?internalStop.lastSuccessfulResumeRevision:null,knownStopCount:internalStop.verified?internalStop.stops.length:null};}
   const provedInternal=internalStop?.verified===true&&internalStop.stateRevision===current.revision&&internalStop.accountId===current.accountId&&internalStop.inceptionAt===current.inceptionAt;
   if(current.controls.stopRequested&&!provedInternal||!freshSafety.automaticRecoveryAllowed&&!provedInternal||!NATIVE_PAPER_FINANCIAL_READINESS_POLICY.recoverablePauseReasons.includes(current.controls.reason as never)&&!provedInternal)continue;
   // The original executed-flow cutoff is used, never its later audit/receipt
   // time. This global permission is neither prediction nor executable pricing.
   const resumeAt=this.now();if(!currentPrice(resumeAt)||certificate.windowEndAt>resumeAt||resumeAt-certificate.windowEndAt>NATIVE_PAPER_FINANCIAL_READINESS_POLICY.maximumReconciliationAgeMs)continue;
   let result;try{result=this.options.ledger.resume('native-paper-cash-ready:'+current.revision+':'+resumeAt,resumeAt,price!,{},{version:NATIVE_PAPER_FINANCIAL_READINESS_POLICY.version,evidence:'current cash reconciliation and complete exact audited flow through original cutoff; no entry price claimed',marketAt:certificate.windowEndAt,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});}catch{this.trader.financialMaintenanceFailed();return {kind:'financial-unavailable' as const,recovered:false};}
   if(provedInternal&&result.enabled)this.trader.verifiedEntryReadinessRecovered();
   const retained=this.trader.recordFinancialReadiness({at:resumeAt,mint,windowEndAt:certificate.windowEndAt,version:NATIVE_PAPER_FINANCIAL_READINESS_POLICY.version,result,...(provedInternal?{internalShutdownProvenance:{proofSha256:internalStop.proofSha256,lastSuccessfulResumeRevision:internalStop.lastSuccessfulResumeRevision,stopActions:internalStop.stops.length}}:{}),orderCreated:false,entryQuoteClaimed:false}),afterRecord=this.now(),finalSafety=this.trader.entryReadinessSafety();
   return {kind:'reconciled' as const,recovered:result.enabled&&retained&&finalSafety.evidenceAvailable&&finalSafety.financialAvailable&&finalSafety.automaticRecoveryAllowed&&!finalSafety.uncertainActions&&financialAdmission?.(afterRecord)===true&&this.options.ledger.projection(afterRecord,price??undefined,{}).entriesEnabled};
  }
  return {kind:'reconciled' as const,recovered:false};
 }
}
