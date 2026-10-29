/** Small isolated integration adapter. Existing PaperLedger remains the sole
 * financial writer. Program-native evidence never becomes a blockchain order. */
import type {MigrationIdentity} from './migration-identity.js';
import {PaperLedger,type LedgerState,type UsdPrice} from './ledger.js';
import {PaperTrader,TEMPORARY_ENTRY_READINESS_PAUSES,type TraderTickOptions} from './trader.js';
import {PilotMarket} from './pilot-market.js';
import type {PilotNativeFlow,PilotNativeFlowOptions} from './pilot-native-flow.js';
import type {NativeAuditCertificate} from './native-candidate-runner.js';
import {ADAPTIVE_PILOT_BINDING,type PilotBinding} from './pilot-contract.js';
import {PROVISIONAL_RULE,assessPredictiveBuying} from './strategy.js';
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
export type NativePaperOptions={ledger:PaperLedger;market:PilotMarket;binding:PilotBinding;source:Pick<PilotNativeFlow,'snapshot'|'usage'>;certificate:(mint:string,at:number)=>NativeAuditCertificate|null;record:RecordSource['record'];withProtectionWork?:<T>(work:()=>Promise<T>)=>Promise<T>;admitNewRisk?:(at:number)=>boolean;admitFinancialReadiness?:(at:number)=>boolean;internalShutdownRecovery?:(at:number)=>ReturnType<PaperLedger['internalShutdownRecoveryProof']>;now?:()=>number;restoredPools?:Readonly<Record<string,NativePaperPool>>;fixtureAccountBinding?:OperatingAccountBinding;pinQualification?:(proof:NativeQualificationProof)=>void;onTechnicalReevaluation?:(request:NativeTechnicalReevaluation)=>void;onEvaluationComplete?:(mint:string,at:number)=>void};
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
export const NATIVE_PAPER_FINANCIAL_READINESS_POLICY=Object.freeze({version:'native-paper-general-arming-internal-checkpoint-v2',targetMs:1000,maximumReconciliationAgeMs:2000,timerMs:250,localHeadroomMs:250,usdMaximumAgeMs:10000,marketEvidence:'original audited windowEndAt <= 2000ms after mandatory assessment record, before normal weak-candidate retirement; no price or executable quote claimed',internalStopRecovery:'bounded ordered original-account known-run control provenance; no owner/unknown/hard safety intent',generalPermission:'financial authorization independent of individual candidate qualification, queued work, physical RPC occupancy and position capacity; actual entry admission remains separate',recoverablePauseReasons:TEMPORARY_ENTRY_READINESS_PAUSES});
export const NATIVE_PAPER_ENTRY_BLOCKERS=Object.freeze({manual:'POE_ENTRY_MANUAL_PAUSE',stop:'POE_ENTRY_SAFE_STOP',loss:'POE_ENTRY_DAILY_LOSS',uncertainty:'POE_ENTRY_FINANCIAL_UNCERTAINTY',evidence:'POE_ENTRY_EVIDENCE_UNAVAILABLE',usd:'POE_ENTRY_USD_UNAVAILABLE',liquidation:'POE_ENTRY_LIQUIDATION_UNAVAILABLE',reconciliationRequired:'POE_ENTRY_RECONCILIATION_REQUIRED',reconciliationStale:'POE_ENTRY_RECONCILIATION_STALE',provider:'POE_ENTRY_PROVIDER_UNAVAILABLE',source:'POE_ENTRY_SOURCE_UNAVAILABLE',monitoring:'POE_ENTRY_MONITORING_UNAVAILABLE',readiness:'POE_ENTRY_READINESS_REQUIRED',paused:'POE_ENTRY_FINANCIAL_PAUSED'} as const);
const INTERNAL_STOP_DIAGNOSTIC_CODES=['INTERNAL_SHUTDOWN_NOT_EVALUATED','INTERNAL_SHUTDOWN_VERIFIED','INTERNAL_SHUTDOWN_PROOF_TIME','INTERNAL_SHUTDOWN_NOT_REQUESTED','INTERNAL_SHUTDOWN_RUN_SET','INTERNAL_SHUTDOWN_RUN_TIME','INTERNAL_SHUTDOWN_INCEPTION','INTERNAL_SHUTDOWN_HISTORY_MALFORMED','INTERNAL_SHUTDOWN_HISTORY_BOUND','INTERNAL_SHUTDOWN_OWNER_OR_UNKNOWN_STOP','INTERNAL_SHUTDOWN_STOP_BOUND','INTERNAL_SHUTDOWN_HARD_OR_UNKNOWN_PAUSE','INTERNAL_SHUTDOWN_CHAIN_ABSENT','INTERNAL_SHUTDOWN_STATE_CHANGED'] as const;
export function nativePaperDerivedEntryBlocker(input:{at:number;state:LedgerState;projection:ReturnType<PaperLedger['projection']>;safety:ReturnType<PaperTrader['entryReadinessSafety']>;manualPaused?:boolean;safeStopRequested?:boolean;evidenceAvailable?:boolean;providerAvailable?:boolean;sourceAvailable?:boolean;monitoringAvailable?:boolean;candidateEvidenceReady?:boolean}){
 const {at,state:s,projection:p,safety}=input,b=NATIVE_PAPER_ENTRY_BLOCKERS;
 if(input.safeStopRequested||s.controls.stopRequested)return b.stop;if(input.manualPaused)return b.manual;if(s.daily.lossPaused)return b.loss;
 if(!safety.recoveryComplete||!safety.idle||!safety.financialAvailable||safety.uncertainActions>0)return b.uncertainty;if(!safety.evidenceAvailable||input.evidenceAvailable===false)return b.evidence;
 if(!p.usdValuationAvailable)return b.usd;if(p.unknownMarks)return b.liquidation;
 if(s.daily.day!==new Date(at).toISOString().slice(0,10)||s.daily.reconciledAt<=0||s.daily.reconciledAt>at)return b.reconciliationRequired;
 if(at-s.daily.reconciledAt>NATIVE_PAPER_FINANCIAL_READINESS_POLICY.maximumReconciliationAgeMs)return b.reconciliationStale;
 if(input.providerAvailable===false)return b.provider;if(input.sourceAvailable===false)return b.source;if(input.monitoringAvailable===false)return b.monitoring;
 if(!s.controls.entriesEnabled||s.daily.paused)return NATIVE_PAPER_FINANCIAL_READINESS_POLICY.recoverablePauseReasons.includes(s.controls.reason as never)?b.readiness:b.paused;
 return null;
}
export class NativePaper {
 readonly trader:PaperTrader;private readonly adaptive:boolean;private readonly now:()=>number;private readonly maximumPositions:PilotBinding['maxPositions'];private readonly pools=new Map<string,NativePaperPool>();private readonly retired=new Set<string>();private readonly lastCandidateBucket=new Map<string,number>();
 private context:ExecutionContext={price:null,marks:{}};
 private internalStopDiagnostic:{code:typeof INTERNAL_STOP_DIAGNOSTIC_CODES[number];at:number|null;lastSuccessfulResumeRevision:number|null;knownStopCount:number|null}={code:'INTERNAL_SHUTDOWN_NOT_EVALUATED',at:null,lastSuccessfulResumeRevision:null,knownStopCount:null};
 private readonly internalStopRefusalCounts:Partial<Record<typeof INTERNAL_STOP_DIAGNOSTIC_CODES[number],number>>={};
 constructor(private readonly options:NativePaperOptions){
  this.now=options.now??Date.now;this.adaptive=options.binding.version===ADAPTIVE_PILOT_BINDING.version;this.maximumPositions=options.binding.maxPositions;const state=options.ledger.state();assertNativePaperAccount(state,options.fixtureAccountBinding);
  for(const [mint,pool]of Object.entries(options.restoredPools??{}))if(state.positions[mint]||Object.values(state.pending).some(o=>o.mint===mint))this.register(pool.identity,pool.evidence);
  for(const mint of new Set([...Object.keys(state.positions),...Object.values(state.pending).map(o=>o.mint)]))need(this.pools.has(mint),'NATIVE_PAPER_OWNED_POOL_PROOF_REQUIRED');
  // Ordinary ticks validate/sanitize this read and reconcile in PaperTrader.
  // Due actions bypass that tick stage, so only their execution context performs
  // its own fresh reconciliation before ledger.attempt checks financial gates.
  const context=async(positions:LedgerState['positions'],signal:AbortSignal)=>{const current=await (options.withProtectionWork?options.withProtectionWork(()=>options.market.context(positions,signal)):options.market.context(positions,signal));this.context=current;return current;};
  const executionContext=async(positions:LedgerState['positions'],signal:AbortSignal)=>{const current=await context(positions,signal),at=this.now();if(current.price){const marks=Object.keys(positions).length&&(!Number.isSafeInteger(current.sourceValidUntil)||current.sourceValidUntil!<at)?{}:current.marks;try{options.ledger.reconcile('native-paper-context:'+options.ledger.state().revision+':'+at,at,current.price,marks);}catch{this.trader?.pauseNewEntries('current financial reconciliation unavailable; exposure retained');}}return current;};
  this.trader=new PaperTrader({ledger:options.ledger,now:this.now,context,quote:options.market.quote,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'Frozen isolated PAPER fees/delay; program-native data contract '+NATIVE_PAPER_DATA_CONTRACT_VERSION},recorder:{record:options.record},flowVerification:{verified:true,evidence:NATIVE_PAPER_DATA_CONTRACT_VERSION},predictiveDiagnostics:true,deferPredictivelyRejectedQuotes:true,candidateReadiness:(mint,at)=>this.options.admitNewRisk?.(at)===true&&this.ready(mint,at)&&this.entryAge(mint,at),predictiveReadiness:(mint,at)=>this.ready(mint,at),experimentalPilot:options.binding,operatingAccount:options.fixtureAccountBinding?undefined:true,pilotExecution:{context:executionContext,quote:options.market.executionQuote},timeoutMs:3000,...(this.adaptive?{adaptiveMomentumV2:true as const}:{})});
  this.trader.start();options.record('native-paper-start',{at:this.now(),accountId:state.accountId,inceptionAt:state.inceptionAt,contract:NATIVE_PAPER_DATA_CONTRACT_VERSION,sourceContract:options.source.usage().dataContract,strategyVersion:options.binding.version,strategyMode:this.adaptive?'adaptive-momentum-v2':'baseline',liveTradingEnabled:false,capitalInitialized:false});
 }
 private entryAge(mint:string,at:number){const pool=this.pools.get(mint);if(!pool)return false;const migrationAt=pool.identity.chainBlockTime*1000;return this.adaptive?adaptiveMigrationEligible(migrationAt,true,at):entryAgeEligible(migrationAt,at);}
 private entryHistory(mint:string,at:number,windowEndAt?:number){
  if(!this.adaptive)return !this.options.ledger.hasTradedMint(mint);
  const end=windowEndAt??this.trader.candidateFeatures(mint,at)?.windowEndAt;
  return end!==undefined&&this.options.ledger.entryEligibility(mint,this.options.binding.version,end,at).allowed;
 }
 private assessment(features:ReturnType<PaperTrader['candidateFeatures']>,at:number){return features?(this.adaptive?assessAdaptiveBuying(features,at):assessPredictiveBuying(features,at)):null;}
 private register(identity:MigrationIdentity,evidence='independently decoded finalized migration identity'){
  const prior=this.pools.get(identity.baseMint);need(!prior||prior.identity.pool===identity.pool&&prior.identity.signature===identity.signature,'NATIVE_PAPER_POOL_IDENTITY_CHANGED');
  this.options.market.registerPool({mint:identity.baseMint,migrationSlot:identity.slot,migrationVerified:true,evidence});this.pools.set(identity.baseMint,{identity:structuredClone(identity),evidence});
 }
 allocated=(identity:MigrationIdentity)=>{this.register(identity);this.retired.delete(identity.baseMint);this.trader.admit({mint:identity.baseMint,migrationAt:identity.chainBlockTime*1000,migrationVerified:true,supportedPool:true,evidence:'native verified origin '+identity.signature});};
 opened=(row:{mint:string;at:number})=>{if(!this.pools.has(row.mint))return;this.trader.activateFlow(row.mint,'native actual confirmed subscription ACK',row.at);};
 trade: PilotNativeFlowOptions['onTrade']=row=>{if(!this.pools.has(row.trade.mint))return;this.trader.ingest(row.trade,'curve');this.slot(row.trade.mint,row.trade.slot!);};
 protocol:NonNullable<PilotNativeFlowOptions['onProtocolEffect']>=row=>{if(this.pools.has(row.mint))this.slot(row.mint,row.slot);};
 private slot(mint:string,slot:number){this.options.market.minimumSlot(mint,slot);if(this.trader.hasCandidate(mint))this.trader.noteCandidateSlot(mint,slot);}
 gap=(row:{mint?:string;at:number;reason:string})=>{const mints=row.mint?[row.mint]:[...this.pools.keys()];for(const mint of mints)if(this.trader.hasCandidate(mint))this.trader.candidateGap(mint,row.reason);};
 retiredCandidate=(mint:string,reason:string)=>{this.gap({mint,at:this.now(),reason});this.retired.add(mint);};
 ownership=(mint:string):'HELD'|'ENTRY_PENDING'|null=>{const state=this.options.ledger.state();return state.positions[mint]?'HELD':Object.values(state.pending).some(o=>o.mint===mint)?'ENTRY_PENDING':null;};
 private entryCapacity(){const state=this.options.ledger.state(),heldPositions=Object.keys(state.positions).length,pendingBuyOrders=Object.values(state.pending).filter(o=>o.side==='buy').length;return {heldPositions,pendingBuyOrders,maximumPositions:this.maximumPositions,available:heldPositions+pendingBuyOrders<this.maximumPositions};}
 ready(mint:string,at=this.now()){
  const view=this.options.source.snapshot(mint,at),certificate=this.options.certificate(mint,at),pool=this.pools.get(mint),features=this.trader.candidateFeatures(mint,at);
  return !!(view&&pool&&nativePaperEvidenceReady({contractVersion:NATIVE_PAPER_DATA_CONTRACT_VERSION,certificate,at,mint,pool:pool.identity.pool,dataContract:view.dataContract,openedAt:view.openedAt,connectionId:view.connectionId,subscriptionId:view.subscription,features,connected:view.connected,sourceSupportFresh:view.sourceSupportFresh,hasQualityLoss:view.hasQualityLoss}));
 }
 /** Called only outside an active financial/market adapter operation. */
 maintain(){for(const mint of [...this.retired])if(!this.ownership(mint)){this.trader.remove(mint);this.options.market.unregisterPool(mint);this.pools.delete(mint);this.lastCandidateBucket.delete(mint);this.retired.delete(mint);}}
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
 async protection(options:TraderTickOptions={}){return this.tick({...options,evaluateCandidates:false,maximumDueActions:1});}
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
  if(state.daily.lossPaused||!safety.recoveryComplete||!safety.idle||!safety.evidenceAvailable||!safety.financialAvailable||safety.uncertainActions||safety.newHardPauseObserved)return false;
  const proof=(state.controls.stopRequested||!safety.automaticRecoveryAllowed)?this.options.internalShutdownRecovery?.(this.now()):null;
  const provedInternal=proof?.verified===true&&proof.stateRevision===state.revision&&proof.accountId===state.accountId&&proof.inceptionAt===state.inceptionAt;
  if(state.controls.stopRequested&&!provedInternal||!safety.automaticRecoveryAllowed&&!provedInternal)return false;
  return state.controls.entriesEnabled||provedInternal||NATIVE_PAPER_FINANCIAL_READINESS_POLICY.recoverablePauseReasons.includes(state.controls.reason as never)||state.controls.reason==='startup: observation only; explicit runtime readiness required';
 }
 private refuseCandidateEntryAuthority(mint:string,at:number,windowEndAt:number){
  this.options.onEvaluationComplete?.(mint,this.now());this.lastCandidateBucket.set(mint,windowEndAt);
  this.options.record('native-paper-entry-unavailable',{mint,at,windowEndAt,reason:'financial-entry-control-authority-unavailable',predictiveOnly:true,executableQualification:false,orderCreated:false,existingFinancialActionsPreserved:true});
  return {kind:'entry-permission-refused' as const};
 }
 async candidate(mint:string,admitNewRisk:boolean){
  const at=this.now(),pool=this.pools.get(mint),features=this.trader.candidateFeatures(mint,at);if(!pool||!features||!this.ready(mint,at)||this.lastCandidateBucket.get(mint)===features.windowEndAt){this.technical(mint,'entry-preparation-unavailable',true);return {kind:'unavailable' as const};}
  // Required position slots are already committed by held exposure and pending
  // buys. A full account must not consume proof/rent/quote work or cancel an
  // existing action merely to reject another candidate later in PaperTrader.
  const capacity=this.entryCapacity();if(!capacity.available){this.options.onEvaluationComplete?.(mint,this.now());this.options.record('native-paper-entry-unavailable',{mint,at,windowEndAt:features.windowEndAt,reason:'simulated-position-capacity-reserved',...capacity,predictiveOnly:true,executableQualification:false,orderCreated:false,existingFinancialActionsPreserved:true});this.lastCandidateBucket.set(mint,features.windowEndAt);return {kind:'capacity-refused' as const};}
  if(!admitNewRisk||this.options.admitNewRisk?.(at)!==true){this.options.onEvaluationComplete?.(mint,this.now());this.options.record('native-paper-entry-unavailable',{mint,at,windowEndAt:features.windowEndAt,reason:'monitoring/time/request/response or pending-action reserve unavailable',predictiveOnly:true,executableQualification:false,orderCreated:false});this.lastCandidateBucket.set(mint,features.windowEndAt);return {kind:'capacity-refused' as const};}
  if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,at,features.windowEndAt);
  const assessment=this.assessment(features,at)!;
  if(assessment.status==='not-rejected'&&this.entryAge(mint,at)&&this.entryHistory(mint,at,features.windowEndAt)&&!this.ownership(mint)){
   try{if(this.options.pinQualification){const proof=this.qualificationProof(mint,this.now());need(proof,'NATIVE_PAPER_QUALIFICATION_PROOF_UNAVAILABLE');this.options.pinQualification(proof);need(this.ready(mint,this.now())&&this.options.admitNewRisk?.(this.now())===true,'NATIVE_PAPER_PINNED_PROOF_EXPIRED');}const plan=await this.options.market.prepareEntryCosts(mint,new AbortController().signal);this.trader.setPilotEntryDeposit(plan.depositLamports,plan.evidence,mint);
    if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,this.now(),features.windowEndAt);
    if(this.ready(mint,this.now())){await this.protection();const when=this.now(),context=this.context,state=this.options.ledger.state();if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,when,features.windowEndAt);if(context.price&&this.ready(mint,when)&&this.options.admitNewRisk?.(when)===true){const result=this.options.ledger.resume('native-paper-ready:'+state.revision+':'+when,when,context.price,context.marks,{version:NATIVE_PAPER_DATA_CONTRACT_VERSION,evidence:'current exact audited native window and isolated PAPER monitoring reserve',marketAt:plan.at,recoveryComplete:true,candidateWindowsReady:this.ready(mint,when),budgetAvailable:this.options.admitNewRisk?.(when)===true});if(result.enabled)this.trader.verifiedEntryReadinessRecovered();this.options.record('native-paper-entry-permission',{at:when,result,mint,windowEndAt:features.windowEndAt});}}
   }catch(error){if(!this.candidateEntryAuthority())return this.refuseCandidateEntryAuthority(mint,this.now(),features.windowEndAt);this.trader.pauseNewEntries('entry preparation or reconciliation unavailable');this.options.record('native-paper-entry-preparation-unavailable',{mint,at:this.now(),windowEndAt:features.windowEndAt,predictiveOnly:true,executableQualification:false,orderCreated:false,reason:error instanceof Error?error.message.slice(0,180):'unavailable'});this.lastCandidateBucket.set(mint,features.windowEndAt);this.technical(mint,'entry-preparation-unavailable');return {kind:'preparation-unavailable' as const};}
  }
  if(!this.ready(mint,this.now())){if(assessment.status==='not-rejected')this.technical(mint,'entry-preparation-unavailable');return {kind:'unavailable' as const};}
  const before=this.trader.funnel.evaluated;await this.tick({candidateMint:mint,reuseFreshContext:true,maximumDueActions:1});
  // Decision pricing can consume material time after the tick's earlier held
  // evaluation. Yield back to existing exposure before a newly reserved buy's
  // modeled delay/attempt. Obtain a fresh shared exact-size mark rather than
  // making an earlier quote appear to advance the completed protection clock.
  if(Object.keys(this.options.ledger.state().positions).length)await this.protection();
  if(this.trader.funnel.evaluated>before){this.lastCandidateBucket.set(mint,features.windowEndAt);const decision=this.trader.decisions().filter(d=>d.mint===mint&&d.at>=at).at(-1);if(!this.ownership(mint)){if(assessment.status==='not-rejected'&&(decision?.stage==='qualified'||decision?.stage==='missing-data'&&decision.reason==='fresh-size-specific-quote-unavailable'))this.technical(mint,'entry-quote-unavailable');else this.options.onEvaluationComplete?.(mint,this.now());}}else this.technical(mint,'entry-preparation-unavailable',true);return {kind:'evaluated' as const};
 }
 poolsForRecovery(){return Object.fromEntries([...this.pools].map(([mint,pool])=>[mint,structuredClone(pool)]));}
 valuation(){return this.context;}
 internalShutdownDiagnostics(){return {...this.internalStopDiagnostic};}
 internalShutdownRefusals(){return Object.fromEntries(Object.entries(this.internalStopRefusalCounts).map(([code,count])=>['internal-stop-proof:'+code,count!]));}
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
  if(!recover||current.controls.entriesEnabled||current.daily.lossPaused||!freshSafety.recoveryComplete||!freshSafety.evidenceAvailable||!freshSafety.financialAvailable||freshSafety.uncertainActions||financialAdmission?.(when)!==true)return {kind:'reconciled' as const,recovered:false};
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
