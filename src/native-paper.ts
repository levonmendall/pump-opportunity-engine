/** Small isolated integration adapter. Existing PaperLedger remains the sole
 * financial writer. Program-native evidence never becomes a blockchain order. */
import type {MigrationIdentity} from './migration-identity.js';
import {PaperLedger,type LedgerState,type UsdPrice} from './ledger.js';
import {PaperTrader,type TraderTickOptions} from './trader.js';
import {PilotMarket} from './pilot-market.js';
import type {PilotNativeFlow,PilotNativeFlowOptions} from './pilot-native-flow.js';
import type {NativeAuditCertificate} from './native-candidate-runner.js';
import type {PilotBinding} from './pilot-contract.js';
import {PROVISIONAL_RULE,assessPredictiveBuying} from './strategy.js';
import {entryAgeEligible} from './observation-age.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION,nativePaperEvidenceReady} from './native-paper-contract.js';
import type {ExecutionContext} from './execution.js';

type RecordSource={record:(kind:string,data:unknown)=>void};
export type NativePaperPool={identity:MigrationIdentity;evidence:string};
export type NativePaperOptions={ledger:PaperLedger;market:PilotMarket;binding:PilotBinding;source:Pick<PilotNativeFlow,'snapshot'|'usage'>;certificate:(mint:string,at:number)=>NativeAuditCertificate|null;record:RecordSource['record'];withProtectionWork?:<T>(work:()=>Promise<T>)=>Promise<T>;admitNewRisk?:(at:number)=>boolean;now?:()=>number;restoredPools?:Readonly<Record<string,NativePaperPool>>};
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
export class NativePaper {
 readonly trader:PaperTrader;private readonly now:()=>number;private readonly pools=new Map<string,NativePaperPool>();private readonly retired=new Set<string>();private readonly lastCandidateBucket=new Map<string,number>();
 private context:ExecutionContext={price:null,marks:{}};
 constructor(private readonly options:NativePaperOptions){
  this.now=options.now??Date.now;const state=options.ledger.state();need(state.mode==='PAPER'&&/^poe-pilot-[a-z0-9-]+$/.test(state.accountId),'NATIVE_PAPER_EXISTING_ISOLATED_ACCOUNT_REQUIRED');
  for(const [mint,pool]of Object.entries(options.restoredPools??{}))if(state.positions[mint]||Object.values(state.pending).some(o=>o.mint===mint))this.register(pool.identity,pool.evidence);
  for(const mint of new Set([...Object.keys(state.positions),...Object.values(state.pending).map(o=>o.mint)]))need(this.pools.has(mint),'NATIVE_PAPER_OWNED_POOL_PROOF_REQUIRED');
  // Ordinary ticks validate/sanitize this read and reconcile in PaperTrader.
  // Due actions bypass that tick stage, so only their execution context performs
  // its own fresh reconciliation before ledger.attempt checks financial gates.
  const context=async(positions:LedgerState['positions'],signal:AbortSignal)=>{const current=await (options.withProtectionWork?options.withProtectionWork(()=>options.market.context(positions,signal)):options.market.context(positions,signal));this.context=current;return current;};
  const executionContext=async(positions:LedgerState['positions'],signal:AbortSignal)=>{const current=await context(positions,signal),at=this.now();if(current.price){const marks=Object.keys(positions).length&&(!Number.isSafeInteger(current.sourceValidUntil)||current.sourceValidUntil!<at)?{}:current.marks;try{options.ledger.reconcile('native-paper-context:'+options.ledger.state().revision+':'+at,at,current.price,marks);}catch{this.trader?.pauseNewEntries('current financial reconciliation unavailable; exposure retained');}}return current;};
  this.trader=new PaperTrader({ledger:options.ledger,now:this.now,context,quote:options.market.quote,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'Frozen isolated PAPER fees/delay; program-native data contract '+NATIVE_PAPER_DATA_CONTRACT_VERSION},recorder:{record:options.record},flowVerification:{verified:true,evidence:NATIVE_PAPER_DATA_CONTRACT_VERSION},predictiveDiagnostics:true,deferPredictivelyRejectedQuotes:true,candidateReadiness:(mint,at)=>this.options.admitNewRisk?.(at)===true&&this.ready(mint,at)&&entryAgeEligible(this.pools.get(mint)!.identity.chainBlockTime*1000,at),predictiveReadiness:(mint,at)=>this.ready(mint,at),experimentalPilot:options.binding,pilotExecution:{context:executionContext,quote:options.market.executionQuote},timeoutMs:3000});
  this.trader.start();options.record('native-paper-start',{at:this.now(),accountId:state.accountId,inceptionAt:state.inceptionAt,contract:NATIVE_PAPER_DATA_CONTRACT_VERSION,sourceContract:options.source.usage().dataContract,liveTradingEnabled:false,capitalInitialized:false});
 }
 private register(identity:MigrationIdentity,evidence='independently decoded finalized migration identity'){
  const prior=this.pools.get(identity.baseMint);need(!prior||prior.identity.pool===identity.pool&&prior.identity.signature===identity.signature,'NATIVE_PAPER_POOL_IDENTITY_CHANGED');
  this.options.market.registerPool({mint:identity.baseMint,migrationSlot:identity.slot,migrationVerified:true,evidence});this.pools.set(identity.baseMint,{identity:structuredClone(identity),evidence});
 }
 allocated=(identity:MigrationIdentity)=>{this.register(identity);this.retired.delete(identity.baseMint);this.trader.admit({mint:identity.baseMint,migrationAt:identity.chainBlockTime*1000,migrationVerified:true,supportedPool:true,evidence:'native verified origin '+identity.signature});};
 opened=(row:{mint:string;at:number})=>{if(!this.pools.has(row.mint))return;this.trader.activateFlow(row.mint,'native actual confirmed subscription ACK',row.at);};
 trade: PilotNativeFlowOptions['onTrade']=row=>{if(!this.pools.has(row.trade.mint))return;this.trader.ingest(row.trade,'curve');this.slot(row.trade.mint,row.trade.slot!);};
 protocol:NonNullable<PilotNativeFlowOptions['onProtocolEffect']>=row=>{if(this.pools.has(row.mint))this.slot(row.mint,row.slot);};
 private slot(mint:string,slot:number){this.options.market.minimumSlot(mint,slot);if(this.trader.candidateFeatures(mint,this.now()))this.trader.noteCandidateSlot(mint,slot);}
 gap=(row:{mint?:string;at:number;reason:string})=>{const mints=row.mint?[row.mint]:[...this.pools.keys()];for(const mint of mints)if(this.trader.candidateFeatures(mint,this.now()))this.trader.candidateGap(mint,row.reason);};
 retiredCandidate=(mint:string,reason:string)=>{this.gap({mint,at:this.now(),reason});this.retired.add(mint);};
 ownership=(mint:string):'HELD'|'ENTRY_PENDING'|null=>{const state=this.options.ledger.state();return state.positions[mint]?'HELD':Object.values(state.pending).some(o=>o.mint===mint)?'ENTRY_PENDING':null;};
 ready(mint:string,at=this.now()){
  const view=this.options.source.snapshot(mint,at),certificate=this.options.certificate(mint,at),pool=this.pools.get(mint),features=this.trader.candidateFeatures(mint,at);
  return !!(view&&pool&&nativePaperEvidenceReady({contractVersion:NATIVE_PAPER_DATA_CONTRACT_VERSION,certificate,at,mint,pool:pool.identity.pool,dataContract:view.dataContract,openedAt:view.openedAt,connectionId:view.connectionId,subscriptionId:view.subscription,features,connected:view.connected,sourceSupportFresh:view.sourceSupportFresh,hasQualityLoss:view.hasQualityLoss}));
 }
 /** Called only outside an active financial/market adapter operation. */
 maintain(){for(const mint of [...this.retired])if(!this.ownership(mint)){this.trader.remove(mint);this.options.market.unregisterPool(mint);this.pools.delete(mint);this.lastCandidateBucket.delete(mint);this.retired.delete(mint);}}
 async protection(options:TraderTickOptions={}){return this.trader.tick({...options,evaluateCandidates:false,maximumDueActions:1});}
 /** No extra quote for a failed feature rule. Preparation/financial readiness
  * still recheck current evidence; an expired certificate never reserves entry. */
 candidateDue(mint:string,at=this.now()){const features=this.trader.candidateFeatures(mint,at),pool=this.pools.get(mint);return !!(features&&pool&&entryAgeEligible(pool.identity.chainBlockTime*1000,at)&&this.ready(mint,at)&&this.lastCandidateBucket.get(mint)!==features.windowEndAt);}
 async candidate(mint:string,admitNewRisk:boolean){
  const at=this.now(),pool=this.pools.get(mint),features=this.trader.candidateFeatures(mint,at);if(!pool||!features||!this.ready(mint,at)||this.lastCandidateBucket.get(mint)===features.windowEndAt)return {kind:'unavailable' as const};
  if(!admitNewRisk||this.options.admitNewRisk?.(at)!==true){this.trader.pauseNewEntries('monitoring capacity unavailable for new risk');this.options.record('native-paper-entry-unavailable',{mint,at,windowEndAt:features.windowEndAt,reason:'monitoring/time/request/response or pending-action reserve unavailable',predictiveOnly:true,executableQualification:false,orderCreated:false});this.lastCandidateBucket.set(mint,features.windowEndAt);return {kind:'capacity-refused' as const};}
  const assessment=assessPredictiveBuying(features,at);
  if(assessment.status==='not-rejected'&&entryAgeEligible(pool.identity.chainBlockTime*1000,at)&&!this.ownership(mint)){
   try{const plan=await this.options.market.prepareEntryCosts(mint,new AbortController().signal);this.trader.setPilotEntryDeposit(plan.depositLamports,plan.evidence,mint);
    if(this.ready(mint,this.now())){await this.protection();const when=this.now(),context=this.context,state=this.options.ledger.state();if(context.price&&this.ready(mint,when)&&this.options.admitNewRisk?.(when)===true){const result=this.options.ledger.resume('native-paper-ready:'+state.revision+':'+when,when,context.price,context.marks,{version:NATIVE_PAPER_DATA_CONTRACT_VERSION,evidence:'current exact audited native window and isolated PAPER monitoring reserve',marketAt:plan.at,recoveryComplete:true,candidateWindowsReady:this.ready(mint,when),budgetAvailable:this.options.admitNewRisk?.(when)===true});this.options.record('native-paper-entry-permission',{at:when,result,mint,windowEndAt:features.windowEndAt});}}
   }catch(error){this.trader.pauseNewEntries('entry preparation or reconciliation unavailable');this.options.record('native-paper-entry-preparation-unavailable',{mint,at:this.now(),windowEndAt:features.windowEndAt,predictiveOnly:true,executableQualification:false,orderCreated:false,reason:error instanceof Error?error.message.slice(0,180):'unavailable'});this.lastCandidateBucket.set(mint,features.windowEndAt);return {kind:'preparation-unavailable' as const};}
  }
  if(!this.ready(mint,this.now()))return {kind:'unavailable' as const};
  const before=this.trader.funnel.evaluated;await this.trader.tick({candidateMint:mint,reuseFreshContext:true,maximumDueActions:1});if(this.trader.funnel.evaluated>before)this.lastCandidateBucket.set(mint,features.windowEndAt);return {kind:'evaluated' as const};
 }
 poolsForRecovery(){return Object.fromEntries([...this.pools].map(([mint,pool])=>[mint,structuredClone(pool)]));}
 valuation(){return this.context;}
}
