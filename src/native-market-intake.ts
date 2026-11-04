import {performance} from 'node:perf_hooks';
import type {WatchSeed} from './pilot-watch.js';
import type {MarketIdentityHint,MarketActivityHint,MarketFeedStatus,PumpSwapQualificationHint} from './market-discovery.js';
import type {MarketRegistryCommittedActivity,MarketRegistryIntakeMessage,MarketRegistryLivenessRequest,MarketRegistryLivenessResult} from './market-registry-intake-worker.js';
import {MARKET_REGISTRY_REPORTING_VERSION,MARKET_REGISTRY_REPORTING_POLICY,marketRegistryReportingScopeKey,validMarketRegistryReportingRequest,type MarketRegistryReportingScope,type MarketRegistryReportingRequest,type MarketRegistryReportingResult,type MarketRegistryReportingView} from './market-registry-reporting.js';
import {NativeMarketIntakeSpool} from './native-market-intake-spool.js';

export const NATIVE_MARKET_INTAKE_POLICY=Object.freeze({version:'off-thread-full-durable-market-intake-v1',pendingBytesBudget:32*1024*1024,sendQuantumMs:5,workerComputeMs:10,writerYieldMs:3,workerOldGenerationMiB:256,closeTimeoutMs:30000});
type Handle={postMessage:(value:unknown)=>void;on:(event:string,listener:(value:any)=>void)=>unknown;terminate:()=>Promise<number>};
type WorkerSettlement={worker:Handle;generation:number;requestedAt:number;settledAt:number|null;settledBy:'exit-event'|'termination-promise'|null;terminationRejected:boolean;promise:Promise<void>;resolve:()=>void};
type Pending={message:MarketRegistryIntakeMessage;bytes:number;queuedAt:number;sent:boolean};
type Options={createWorker:()=>Handle;onCommitted:(rows:MarketRegistryCommittedActivity[])=>void;onPressure:(value:{paused:boolean;pendingBytes:number;budgetBytes:number})=>void;now?:()=>number;budgetBytes?:number;spoolPath?:string;record?:(kind:string,data:unknown)=>void;observeDiagnostic?:(kind:string,data:unknown)=>void};
/** Nonfinancial IPC bridge. Records remain owned here until the worker ACKs a
 * FULL commit; its byte high-water mark pauses shared transports, never evicts
 * token identities. The optional shutdown spool preserves an undrained tail
 * across a graceful stop. A process crash can still lose new unacknowledged
 * network intake; neither kind of tail is counted as durable discovery. */
export class NativeMarketIntake {
 private readonly pending=new Map<number,Pending>();private readonly now:()=>number;private readonly budget:number;
 private readonly qualificationPending=new Map<string,number>();private readonly qualificationSent=new Map<string,number>();
 private worker:Handle|null=null;private workerGeneration=0;private ready=false;private stopping=false;private closed=false;
 private workerSettlement:WorkerSettlement|null=null;private readonly exitedWorkers=new WeakSet<Handle>();private retryElapsed=false;private diagnosticFailures=0;private workerClosedAcknowledged=false;
 private workerReadyAt:number|null=null;private lastAckProgressAt:number|null=null;private outstandingSent=0;private livenessSerial=0;private livenessPending:MarketRegistryLivenessRequest|null=null;private livenessNextAt=0;private livenessReplies=0;private livenessTimeouts=0;private livenessSatisfiedByAck=0;private lastLivenessReply:(MarketRegistryLivenessResult&{receivedAt:number})|null=null;
 private serial=0;private bytes=0;private received=0;private committed=0;private restarts=0;private failures=0;private retryAt:number|null=null;private reasonCode:string|null=null;private lastCommitAt:number|null=null;private workerStats:unknown=null;
 private processedAcknowledged=0;private ageExcluded=0;private venueExcluded=0;private qualificationHintsReceived=0;private qualificationHintsCoalesced=0;private qualificationCommitted=0;
 private sendTimer:ReturnType<typeof setImmediate>|null=null;private retryTimer:ReturnType<typeof setTimeout>|null=null;private closeResolve:(()=>void)|null=null;private pressureState:string|null=null;
 private reportingSerial=0;private reportingNextAt=0;private reportingFailures=0;private reportingReason:string|null=null;
 private reportingPending:{request:MarketRegistryReportingRequest;workerGeneration:number}|null=null;
 private reportingCached:{result:MarketRegistryReportingResult;scopeKey:string;workerGeneration:number}|null=null;
 private readonly spool:NativeMarketIntakeSpool|null;private startup:Promise<void>|null=null;private spoolWork:Promise<void>=Promise.resolve();private readonly spoolOwned=new Set<number>();private readonly shutdownSpoolPending=new Set<number>();private readonly savedTailIds=new Set<number>();private checkpointArmed=false;private checkpointVersion=0;private queuedCheckpointVersion=-1;private checkpointTimer:ReturnType<typeof setImmediate>|null=null;private stoppingWorkerFailed=false;private spoolLoadFailed=false;private replayed=0;private shutdownSpooled=0;private closing:Promise<void>|null=null;
 constructor(private readonly options:Options){this.now=options.now??Date.now;this.budget=options.budgetBytes??NATIVE_MARKET_INTAKE_POLICY.pendingBytesBudget;if(!Number.isSafeInteger(this.budget)||this.budget<1)throw Error('MARKET_INTAKE_BYTE_BUDGET');this.spool=options.spoolPath?new NativeMarketIntakeSpool(options.spoolPath):null;if(this.spool){this.pressure();this.startup=this.restore().finally(()=>{this.startup=null;});}else this.start();}
 private async restore(){try{const rows=await this.spool!.load(),newRows=[...this.pending.values()];this.pending.clear();this.qualificationPending.clear();this.bytes=0;this.serial=0;for(const row of rows)this.serial=Math.max(this.serial,row.message.id);for(const row of rows){const message=row.message,bytes=Buffer.byteLength(JSON.stringify(message));this.pending.set(message.id,{message,bytes,queuedAt:row.queuedAt,sent:false});this.spoolOwned.add(message.id);this.bytes+=bytes;this.received++;this.replayed++;if(message.operation==='qualification')this.qualificationPending.set(message.value.mint,message.id);}for(const row of newRows){row.message={...row.message,id:++this.serial};row.bytes=Buffer.byteLength(JSON.stringify(row.message));this.pending.set(row.message.id,row);this.bytes+=row.bytes;if(row.message.operation==='qualification')this.qualificationPending.set(row.message.value.mint,row.message.id);}if(rows.length)this.options.record?.('native-market-intake-shutdown-tail-restored',{at:this.now(),pending:rows.length,originalReceiptClocksPreserved:true,durableDiscoveryClaimed:false});this.start();}catch{this.spoolLoadFailed=true;this.reasonCode='SHUTDOWN_TAIL_UNAVAILABLE';this.failures++;this.pressure();this.options.record?.('native-market-intake-shutdown-tail-unavailable',{at:this.now(),reasonCode:this.reasonCode,existingFilePreserved:true,financialManagerContinues:true});}}
 private releaseSpool(id:number){const restored=this.spoolOwned.delete(id),closing=this.shutdownSpoolPending.delete(id);if(closing){this.savedTailIds.delete(id);this.shutdownSpooled=this.savedTailIds.size;}if(!restored&&!closing||this.spoolOwned.size||this.shutdownSpoolPending.size||!this.spool)return;this.spoolWork=this.spoolWork.then(()=>this.spool!.clear()).catch(()=>{this.options.record?.('native-market-intake-shutdown-tail-cleanup-unavailable',{at:this.now(),durableIntakePreserved:true,replayMayRepeatAcknowledgedReceipts:true});});}
 private pressure(){const paused=!this.ready||this.bytes>=this.budget;const key=paused+':'+this.bytes;if(key!==this.pressureState){this.pressureState=key;this.options.onPressure({paused,pendingBytes:this.bytes,budgetBytes:this.budget});}}
 private diagnostic(kind:string,data:unknown){try{this.options.record?.(kind,data);}catch{this.diagnosticFailures++;}}
 private optionalDiagnostic(kind:string,data:unknown){try{this.options.observeDiagnostic?.(kind,data);}catch{this.diagnosticFailures++;}}
 private finishWorkerSettlement(state:WorkerSettlement,by:'exit-event'|'termination-promise'){
  if(state.settledAt!==null)return;state.settledAt=this.now();state.settledBy=by;state.resolve();
  this.optionalDiagnostic('native-market-intake-worker-physically-settled',{at:state.settledAt,generation:state.generation,settledBy:by,terminationPreviouslyRejected:state.terminationRejected,financialWriterOpened:false});this.restartAfterSettlement();
 }
 private settleWorker(worker:Handle,generation:number):Promise<void>{
  if(this.workerSettlement?.worker===worker)return this.workerSettlement.promise;
  let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;}),state:WorkerSettlement={worker,generation,requestedAt:this.now(),settledAt:null,settledBy:null,terminationRejected:false,promise,resolve};this.workerSettlement=state;
  if(this.exitedWorkers.has(worker))this.finishWorkerSettlement(state,'exit-event');
  else try{void worker.terminate().then(()=>this.finishWorkerSettlement(state,'termination-promise'),()=>{state.terminationRejected=true;this.optionalDiagnostic('native-market-intake-worker-settlement-unconfirmed',{at:this.now(),generation,physicalSettlementClaimed:false,replacementStarted:false,financialManagerContinues:true});});}
  catch{state.terminationRejected=true;this.optionalDiagnostic('native-market-intake-worker-settlement-unconfirmed',{at:this.now(),generation,physicalSettlementClaimed:false,replacementStarted:false,financialManagerContinues:true});}
  return promise;
 }
 private restartAfterSettlement(){if(!this.retryElapsed||this.closed||this.stopping||this.worker||this.workerSettlement?.settledAt===null)return;this.retryElapsed=false;this.restarts++;this.start();}
 private start(){if(this.closed||this.workerSettlement?.settledAt===null)return;this.workerGeneration++;this.workerClosedAcknowledged=false;this.workerReadyAt=null;this.lastAckProgressAt=null;this.outstandingSent=0;this.livenessPending=null;this.livenessNextAt=0;const generation=this.workerGeneration;
  try{const worker=this.options.createWorker();this.worker=worker;worker.on('message',value=>{if(this.worker===worker)this.message(value);});worker.on('error',()=>{if(this.worker===worker)this.failed('WORKER_ERROR');});worker.on('exit',code=>{this.exitedWorkers.add(worker);if(this.workerSettlement?.worker===worker)this.finishWorkerSettlement(this.workerSettlement,'exit-event');if(this.worker===worker&&!this.closed&&!(this.stopping&&this.workerClosedAcknowledged))this.failed(code===0?'WORKER_EXIT_BEFORE_DRAIN':'WORKER_EXIT');});}
  catch{this.failed('WORKER_START_FAILED');}this.options.record?.('native-market-intake-worker-start',{at:this.now(),generation,financialWriterOpened:false});this.pressure();
 }
 private failed(reasonCode:string){if(this.closed)return;const prior=this.worker;this.worker=null;this.ready=false;this.retryElapsed=false;this.outstandingSent=0;this.livenessPending=null;if(this.sendTimer)clearImmediate(this.sendTimer);this.sendTimer=null;this.failures++;this.reasonCode=reasonCode;if(this.reportingPending)this.reportingFailures++;this.reportingPending=null;this.reportingReason='WORKER_UNAVAILABLE';for(const row of this.pending.values())row.sent=false;this.qualificationSent.clear();if(prior)void this.settleWorker(prior,this.workerGeneration);this.pressure();
  this.diagnostic('native-market-intake-worker-unavailable',{at:this.now(),reasonCode,pending:this.pending.size,pendingBytes:this.bytes,unacknowledgedTailRetained:true,physicalWorkerSettlementPending:this.workerSettlement?.settledAt===null,financialManagerContinues:true});
  if(this.stopping){this.stoppingWorkerFailed=true;this.closeResolve?.();return;}if(!this.retryTimer){const delay=Math.min(30000,500*2**Math.min(6,this.failures-1));this.retryAt=this.now()+delay;this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.retryElapsed=true;this.restartAfterSettlement();},delay);}
 }
 private message(value:any){
  if(value?.kind==='liveness-result'){
   const pending=this.livenessPending,at=this.now();
   if(!pending||value.id!==pending.id||value.workerGeneration!==pending.workerGeneration||value.workerGeneration!==this.workerGeneration||value.requestedAt!==pending.requestedAt||![value.observedAt,value.pending,value.processedAcknowledged,value.contentions].every(n=>Number.isSafeInteger(n)&&n>=0)||value.observedAt<value.requestedAt||value.observedAt>at||value.lastCommitAt!==null&&(!Number.isSafeInteger(value.lastCommitAt)||value.lastCommitAt<0||value.lastCommitAt>value.observedAt))return;
   this.lastLivenessReply={kind:'liveness-result',id:value.id,workerGeneration:value.workerGeneration,requestedAt:value.requestedAt,observedAt:value.observedAt,pending:value.pending,processedAcknowledged:value.processedAcknowledged,contentions:value.contentions,lastCommitAt:value.lastCommitAt,receivedAt:at};
   this.livenessPending=null;this.livenessReplies++;this.livenessNextAt=at+NATIVE_MARKET_INTAKE_POLICY.closeTimeoutMs;return;
  }
  if(value?.kind==='reporting-result'){
   const pending=this.reportingPending;if(!pending||pending.workerGeneration!==this.workerGeneration||value.id!==pending.request.id)return;
   this.reportingPending=null;const at=this.now(),snapshot=value.snapshot,code=typeof value.reasonCode==='string'&&/^REPORTING_[A-Z_]{1,64}$/.test(value.reasonCode)?value.reasonCode:null;
   if(!Number.isFinite(value.durationMs)||value.durationMs<0||value.durationMs>Number.MAX_SAFE_INTEGER||value.requestedAt!==pending.request.requestedAt||![value.observedAt,value.completedAt].every(n=>Number.isSafeInteger(n)&&n>=value.requestedAt&&n<=at)||value.completedAt<value.observedAt||snapshot&&(snapshot.version!==MARKET_REGISTRY_REPORTING_VERSION||snapshot.sourceInstanceId!==pending.request.scope.sourceInstanceId||snapshot.observedAt!==value.observedAt||snapshot.coverage?.generatedAt!==value.observedAt)){
    this.reportingFailures++;this.reportingReason='REPORTING_RESULT_INVALID';return;
   }
   if(!snapshot||code){this.reportingFailures++;this.reportingReason=code??'REPORTING_READ_UNAVAILABLE';return;}
   this.reportingCached={result:value,scopeKey:marketRegistryReportingScopeKey(pending.request.scope),workerGeneration:this.workerGeneration};this.reportingReason=null;return;
  }
  if(value?.kind==='ready'){this.ready=true;this.workerReadyAt??=this.now();this.reasonCode=null;this.retryAt=null;this.workerStats=value.stats;this.pressure();this.scheduleSend();return;}
  if(value?.kind==='committed'&&Array.isArray(value.ids)){
   const excluded=new Map<number,string>((Array.isArray(value.excluded)?value.excluded:[]).map((row:{id:number;reason:string})=>[row.id,row.reason]));let applied=0;const activityReceipts=new Set<string>();
   for(const id of value.ids){const row=this.pending.get(id);if(!row?.sent)continue;this.pending.delete(id);this.bytes-=row.bytes;this.releaseSpool(id);applied++;const reason=excluded.get(id);
    if(reason==='PUMPSWAP_VENUE_REQUIRED')this.venueExcluded++;else if(reason)this.ageExcluded++;else{this.committed++;if(row.message.operation==='activity')activityReceipts.add(JSON.stringify([row.message.value.mint,row.message.value.receivedAt,row.message.value.evidence]));}
    if(row.message.operation==='qualification'){const mint=row.message.value.mint;if(this.qualificationSent.get(mint)===id)this.qualificationSent.delete(mint);if(this.qualificationPending.get(mint)===id)this.qualificationPending.delete(mint);if(!reason)this.qualificationCommitted++;}
   }
   this.processedAcknowledged+=applied;this.outstandingSent-=applied;if(applied){this.lastAckProgressAt=this.now();if(this.livenessPending){this.livenessSatisfiedByAck++;this.livenessPending=null;}this.livenessNextAt=this.lastAckProgressAt+NATIVE_MARKET_INTAKE_POLICY.closeTimeoutMs;}this.lastCommitAt=value.committedAt;this.workerStats=value.stats;this.pressure();
   const activities=(Array.isArray(value.activities)?value.activities:[]).filter((row:MarketRegistryCommittedActivity)=>activityReceipts.has(JSON.stringify([row.mint,row.at,row.evidence])));if(activities.length)this.options.onCommitted(activities);
   this.scheduleSend();this.maybeStop();return;
  }
  if(value?.kind==='failure'){this.workerStats=value.stats;this.failed(typeof value.reasonCode==='string'&&/^[A-Z0-9_]+$/.test(value.reasonCode)?value.reasonCode:'WORKER_FAILURE');return;}
  if(value?.kind==='closed'){if(this.pending.size){this.failed('WORKER_CLOSED_WITH_UNACKNOWLEDGED_INTAKE');return;}if(!this.stopping){this.failed('WORKER_CLOSED_BEFORE_STOP');return;}this.workerClosedAcknowledged=true;this.ready=false;this.reportingPending=null;this.reportingReason='WORKER_UNAVAILABLE';this.closeResolve?.();}
 }
 private enqueue(operation:'identity'|'activity'|'feed'|'migration'|'qualification',value:MarketIdentityHint|MarketActivityHint|MarketFeedStatus|WatchSeed|PumpSwapQualificationHint){if(this.stopping||this.closed)throw Error('MARKET_INTAKE_CLOSED');const message={kind:'intake',id:++this.serial,operation,value:structuredClone(value)} as MarketRegistryIntakeMessage;const bytes=Buffer.byteLength(JSON.stringify(message));this.pending.set(message.id,{message,bytes,queuedAt:this.now(),sent:false});if(message.operation==='qualification')this.qualificationPending.set(message.value.mint,message.id);this.bytes+=bytes;this.received++;this.checkpointVersion++;if(this.checkpointArmed){this.shutdownSpoolPending.add(message.id);this.scheduleCheckpoint();}this.pressure();this.scheduleSend();}
 observeIdentity(value:MarketIdentityHint){this.enqueue('identity',value);}
 observeActivity(value:MarketActivityHint){this.enqueue('activity',value);}
 observeMigration(value:WatchSeed){this.enqueue('migration',value);}
 observeFeed(value:MarketFeedStatus){this.enqueue('feed',value);}
 /** Qualification owns no activity/price/volume history. Keep at most one
  * immutable in-flight message and one freshest unsent successor per mint.
  * Coalescing never discards an ID that the worker could still acknowledge. */
 observeQualification(value:PumpSwapQualificationHint){
  if(this.stopping||this.closed)throw Error('MARKET_INTAKE_CLOSED');this.qualificationHintsReceived++;
  const hint:PumpSwapQualificationHint={mint:value.mint,receivedAt:value.receivedAt,source:value.source,kind:value.kind,...(value.signature===undefined?{}:{signature:value.signature}),...(value.venue===undefined?{}:{venue:value.venue})};
  const id=this.qualificationPending.get(hint.mint),pending=id===undefined?undefined:this.pending.get(id);
  if(pending&&!pending.sent&&pending.message.operation==='qualification'){
   this.qualificationHintsCoalesced++;if(hint.receivedAt>=pending.message.value.receivedAt){const previous=pending.bytes;pending.message={...pending.message,value:hint};pending.bytes=Buffer.byteLength(JSON.stringify(pending.message));this.bytes+=pending.bytes-previous;this.checkpointVersion++;if(this.checkpointArmed)this.scheduleCheckpoint();this.pressure();}this.scheduleSend();return;
  }
  this.enqueue('qualification',hint);
 }
 private scheduleSend(){if(this.sendTimer||!this.ready||!this.worker||this.closed)return;this.sendTimer=setImmediate(()=>{this.sendTimer=null;if(!this.ready||!this.worker||this.closed)return;const start=performance.now();for(const row of this.pending.values()){if(row.sent||row.message.operation==='qualification'&&this.qualificationSent.has(row.message.value.mint))continue;try{this.worker!.postMessage(row.message);row.sent=true;this.outstandingSent++;if(row.message.operation==='qualification')this.qualificationSent.set(row.message.value.mint,row.message.id);}catch{this.failed('WORKER_SEND_FAILED');return;}if(performance.now()-start>=NATIVE_MARKET_INTAKE_POLICY.sendQuantumMs){this.scheduleSend();return;}}this.maybeStop();});}
 private maybeStop(){if(this.stopping&&this.ready&&this.worker&&this.pending.size===0)this.worker.postMessage({kind:'stop'});}
 available(){return this.ready&&!this.closed&&!this.stopping;}
 /** Existing maintenance calls this cheap IPC liveness check. Queue size or
  * contention alone never triggers recovery; a real worker reply proves it is
  * responsive. No provider, SQLite, financial or additional timer is used. */
 supervise(at=this.now()){
  if(!Number.isSafeInteger(at)||at<0||this.closed||this.stopping||!this.ready||!this.worker||!this.outstandingSent||this.workerReadyAt===null)return;
  if(this.livenessPending){if(at-this.livenessPending.requestedAt>=NATIVE_MARKET_INTAKE_POLICY.closeTimeoutMs){this.livenessTimeouts++;this.failed('WORKER_LIVENESS_TIMEOUT');}return;}
  if(at-Math.max(this.workerReadyAt,this.lastAckProgressAt??this.workerReadyAt)<NATIVE_MARKET_INTAKE_POLICY.closeTimeoutMs||at<this.livenessNextAt)return;
  const request:MarketRegistryLivenessRequest={kind:'liveness',id:++this.livenessSerial,workerGeneration:this.workerGeneration,requestedAt:at};this.livenessPending=request;
  try{this.worker.postMessage(request);}catch{this.failed('WORKER_LIVENESS_SEND_FAILED');}
 }
 /** Coalesced optional reporting only. Pending intake remains exclusively
  * governed by its original durable IDs/ACKs, byte pressure and recovery. */
 registryReporting(scope:MarketRegistryReportingScope,at=this.now()):MarketRegistryReportingView {
  const key=marketRegistryReportingScopeKey(scope);
  if(this.reportingPending&&at-this.reportingPending.request.requestedAt>=MARKET_REGISTRY_REPORTING_POLICY.requestTimeoutMs){
   // This releases only an optional diagnostic expectation. The worker/IPC
   // generation, intake IDs, durable ACKs and any physical work are untouched.
   this.reportingPending=null;this.reportingFailures++;this.reportingReason='REPORTING_REQUEST_TIMEOUT';this.reportingNextAt=at+MARKET_REGISTRY_REPORTING_POLICY.refreshMs;
  }
  if(this.ready&&!this.closed&&!this.stopping&&this.pending.size===0&&!this.reportingPending&&at>=this.reportingNextAt){
   const request:MarketRegistryReportingRequest={kind:'reporting',id:++this.reportingSerial,requestedAt:at,scope:structuredClone(scope)};
   if(validMarketRegistryReportingRequest(request)){
    this.reportingPending={request,workerGeneration:this.workerGeneration};this.reportingNextAt=at+MARKET_REGISTRY_REPORTING_POLICY.refreshMs;
    try{this.worker!.postMessage(request);}catch{this.reportingPending=null;this.reportingFailures++;this.reportingReason='REPORTING_SEND_FAILED';}
   }else{this.reportingFailures++;this.reportingReason='REPORTING_REQUEST_INVALID';}
  }
  const cached=this.reportingCached?.scopeKey===key&&this.reportingCached.result.observedAt<=at?this.reportingCached:null,snapshot=cached?.result.snapshot??null,ageMs=snapshot?at-snapshot.observedAt:null;
  const current=!!snapshot&&cached!.workerGeneration===this.workerGeneration&&this.ready&&!this.closed&&!this.stopping&&this.reportingReason===null&&ageMs!<=MARKET_REGISTRY_REPORTING_POLICY.staleMs;
  return {health:{mode:'DETACHED_WORKER',sampledAt:at,state:snapshot?current?'FRESH':'STALE':'UNAVAILABLE',sourceInstanceId:scope.sourceInstanceId,workerGeneration:this.workerGeneration,sampleWorkerGeneration:cached?.workerGeneration??null,requestedAt:cached?.result.requestedAt??this.reportingPending?.request.requestedAt??null,observedAt:snapshot?.observedAt??null,completedAt:cached?.result.completedAt??null,durationMs:cached?.result.durationMs??null,ageMs,pending:this.reportingPending!==null,failures:this.reportingFailures,reasonCode:current?null:this.reportingReason??(!this.ready||this.closed||this.stopping?'WORKER_UNAVAILABLE':this.pending.size>0?'REPORTING_INTAKE_PRIORITY':snapshot?'REPORTING_SAMPLE_STALE':this.reportingPending?'REPORTING_PENDING':'REPORTING_NOT_REQUESTED')},snapshot};
 }
 usage(){const oldest=this.pending.values().next().value as Pending|undefined;return {version:NATIVE_MARKET_INTAKE_POLICY.version,state:this.closed?'closed':this.ready?'ready':'recovering',received:this.received,processedAcknowledged:this.processedAcknowledged,durableCommitted:this.committed,ageExcluded:this.ageExcluded,venueExcluded:this.venueExcluded,qualification:{hintsReceived:this.qualificationHintsReceived,hintsCoalesced:this.qualificationHintsCoalesced,durableCommitted:this.qualificationCommitted,pendingMints:this.qualificationPending.size,inFlight:this.qualificationSent.size,marketActivity:false},pending:this.pending.size,pendingBytes:this.bytes,pendingBytesBudget:this.budget,oldestPendingAt:oldest?.queuedAt??null,maximumPendingAgeMs:oldest?Math.max(0,this.now()-oldest.queuedAt):0,lastCommitAt:this.lastCommitAt,workerGeneration:this.workerGeneration,restarts:this.restarts,failures:this.failures,retryAt:this.retryAt,reasonCode:this.reasonCode,worker:this.workerStats,shutdownTail:{enabled:this.spool!==null,replayed:this.replayed,awaitingAcknowledgment:this.spoolOwned.size,durablySpooledOnClose:this.shutdownSpooled,loadFailed:this.spoolLoadFailed,scope:'GRACEFUL_SHUTDOWN_ONLY_NOT_CRASH_JOURNAL'},inFlightTailMeaning:'UNACKNOWLEDGED_NETWORK_INTAKE_IS_NOT_YET_DURABLE',workerSettlement:this.workerSettlement?{workerGeneration:this.workerSettlement.generation,requestedAt:this.workerSettlement.requestedAt,settledAt:this.workerSettlement.settledAt,settledBy:this.workerSettlement.settledBy,terminationRejected:this.workerSettlement.terminationRejected,physicalSettlementConfirmed:this.workerSettlement.settledAt!==null}:null,supervisionDiagnosticFailures:this.diagnosticFailures,supervision:{policy:'native-intake-worker-liveness-v1' as const,deadlineMs:NATIVE_MARKET_INTAKE_POLICY.closeTimeoutMs,workerGeneration:this.workerGeneration,workerReadyAt:this.workerReadyAt,lastAckProgressAt:this.lastAckProgressAt,outstandingSent:this.outstandingSent,probesSent:this.livenessSerial,replies:this.livenessReplies,timeouts:this.livenessTimeouts,satisfiedByDurableAck:this.livenessSatisfiedByAck,pendingProbe:this.livenessPending?{...this.livenessPending}:null,lastReply:this.lastLivenessReply?{...this.lastLivenessReply}:null},financialWriterOpened:false};}
 /** Shutdown-only, nonclosing checkpoint. Producers may still deliver their
  * actual terminal state while physical close settles. Later accepted records
  * schedule another immutable snapshot; no normal-run crash journal is claimed. */
 preserveAcceptedTail(){this.checkpointArmed=true;if(this.startup)return this.startup.then(()=>this.persistAcceptedTail());return this.persistAcceptedTail();}
 private scheduleCheckpoint(){if(this.checkpointTimer||this.closed)return;this.checkpointTimer=setImmediate(()=>{this.checkpointTimer=null;void this.preserveAcceptedTail().catch(()=>{});});}
 private persistAcceptedTail():Promise<void>{
  if(!this.spool||this.spoolLoadFailed||this.closed||!this.pending.size||this.queuedCheckpointVersion===this.checkpointVersion)return this.spoolWork;
  const version=this.checkpointVersion,rows=structuredClone([...this.pending.values()].map(row=>({message:row.message,queuedAt:row.queuedAt})));for(const row of rows)this.shutdownSpoolPending.add(row.message.id);this.queuedCheckpointVersion=version;
  const saved=this.spoolWork.catch(()=>{}).then(async()=>{await this.spool!.save(rows);this.savedTailIds.clear();for(const row of rows)if(this.pending.has(row.message.id))this.savedTailIds.add(row.message.id);this.shutdownSpooled=this.savedTailIds.size;this.options.record?.('native-market-intake-shutdown-tail-persisted',{at:this.now(),pending:this.shutdownSpooled,originalReceiptClocksPreserved:true,durableDiscoveryClaimed:false,drainComplete:false});}).catch(error=>{if(this.queuedCheckpointVersion===version)this.queuedCheckpointVersion=-1;this.options.record?.('native-market-intake-shutdown-tail-write-unavailable',{at:this.now(),pending:this.pending.size,coverageComplete:false,financialHistoryPreserved:true});throw error;});this.spoolWork=saved;return saved;
 }
 close(){if(!this.closing)this.closing=this.closeOnce();return this.closing;}
 private async closeOnce(){if(this.closed)return;this.stopping=true;this.stoppingWorkerFailed||=this.workerSettlement?.settledAt===null;this.livenessPending=null;this.retryElapsed=false;this.reportingPending=null;this.reportingReason='WORKER_UNAVAILABLE';let shutdownError:unknown=null;
  try{if(this.startup)await this.startup;if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=null;
  // The supervisor's TERM-to-KILL budget also covers this drain. Persist the
  // accepted tail before waiting, so a later kill cannot preempt its first
  // durable handoff. ACK-triggered cleanup is serialized behind this write.
  if(this.checkpointTimer)clearImmediate(this.checkpointTimer);this.checkpointTimer=null;await this.preserveAcceptedTail();
  if(!this.closed&&!this.workerClosedAcknowledged&&!this.spoolLoadFailed&&!this.stoppingWorkerFailed&&(this.worker||this.pending.size)){let timer:ReturnType<typeof setTimeout>|null=null;await new Promise<void>(resolve=>{this.closeResolve=resolve;timer=setTimeout(resolve,NATIVE_MARKET_INTAKE_POLICY.closeTimeoutMs);if(!this.worker)this.start();this.scheduleSend();this.maybeStop();});if(timer)clearTimeout(timer);}
  }catch(error){shutdownError=error;}
  finally{
   if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=null;this.retryElapsed=false;this.retryAt=null;
   if(this.sendTimer)clearImmediate(this.sendTimer);this.sendTimer=null;const worker=this.worker;this.worker=null;this.ready=false;
   if(worker)await this.settleWorker(worker,this.workerGeneration);
   if(this.workerSettlement?.settledAt===null)await this.workerSettlement.promise;
   this.closed=true;
   try{await this.spoolWork;}catch(error){shutdownError??=error;}
  }
  if(shutdownError!==null)throw shutdownError;
  if(this.spool&&!this.spoolLoadFailed){try{if(this.pending.size){await this.spool.save([...this.pending.values()].map(row=>({message:row.message,queuedAt:row.queuedAt})));this.shutdownSpooled=this.pending.size;}else await this.spool.clear();}catch(error){this.options.record?.('native-market-intake-shutdown-tail-write-unavailable',{at:this.now(),pending:this.pending.size,coverageComplete:false,financialHistoryPreserved:true});throw error;}}
  if(this.pending.size)this.options.record?.('native-market-intake-undrained-shutdown',{at:this.now(),pending:this.pending.size,pendingBytes:this.bytes,durableCommitted:this.committed,shutdownTailDurablySpooled:this.shutdownSpooled,coverageComplete:false,financialHistoryPreserved:true});
 }
}
