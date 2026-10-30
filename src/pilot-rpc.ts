/** Finite, isolated PAPER-pilot data adapter. Existing public transport and
 * physical gate own requests; ordinary calls never retry. Explicit owned pricing
 * may make one bounded fresh read under its versioned recovery policy. No signing. */
import {constants,closeSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {ComponentBudget,type ComponentBaseline,type ComponentBudgetOptions,type ComponentKind,type ComponentOperation} from './component-budget.js';
import {ComponentTransport,type SignatureHistoryBatchRequest,type SignatureHistoryBatchResponse,PUBLICNODE_HISTORY_ROUTE,type ComponentHistoryRoute} from './component-transport.js';
import {readResearchBaseline,createResearchBaselineCheckpoint,RESEARCH_MAXIMUM_PATHS} from './research-baseline.js';
import {validateRpc} from './network.js';
import {NATIVE_TWO_HOUR_RESEARCH_PROFILE,NATIVE_TWO_HOUR_90_RESEARCH_PROFILE,resolveNativeResearchProfile,type NativeResearchProfile} from './native-research-profile.js';

const MIB=1024*1024;
export type PilotRpcProfile='candidate-native-research-v1'|NativeResearchProfile['version'];
/** Explicit first-stage native-flow envelope, not a provider entitlement.
 * Time/request/chapter and physical scheduling limits remain the legacy ones.
 * A two-hour profile needs separately validated cumulative-book capacity. */
export const CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE=Object.freeze({version:'candidate-native-research-v1' as const,maximumDurationMs:1800000,maximumUnits:1500,maximumResponseBytes:256*MIB});
export type PilotRpcCallOptions={latestStartAt?:number;timeoutMs?:number;/** Caller-owned complete operation/validation reservation. This does not extend the physical timeout or deadline. */operationBoundMs?:number;admissionOpen?:()=>boolean;/** Query-local timeout backoff for independently scheduled history audits only. Actual throttling/overload remains provider-wide in its fixed route domain. */queryTimeoutScope?:'independent-history'};
export type PilotRpcOptions={persistent?:boolean;profile?:PilotRpcProfile;directory:string;runId:string;baselinePaths:readonly string[];baselineCheckpointSha256?:string;priorPhysicalSettled:true;priorCooldownUntil?:number;historyRoute?:ComponentHistoryRoute;priorHistoryCooldownUntil?:number;durationMs?:number;maxUnits?:number;maxResponseBytes?:number;chapterMs?:number;chapterUnits?:number;maxChapters?:number;/** Explicit isolated research control; default60, accepted60..90. Not provider entitlement. */maxStartsPerMinute?:number;/** Research-only local gate; default10 retains earlier behavior. */maxStartsPer10s?:number;/** Optional conservative experiment limit, not a provider entitlement. */maxGetTransactionStartsPer10s?:number;record?:(kind:string,data:unknown)=>void;now?:()=>number;monotonic?:()=>number;fetcher?:typeof fetch;sleep?:ComponentBudgetOptions['sleep']};
/** Existing holdings get one bounded fresh-read recovery opportunity after an
 * unthrottled settled transport failure. Ordinary candidate work keeps its
 * backoff; actual provider restrictions and the one shared gate remain binding. */
export const PILOT_PROTECTION_RECOVERY_POLICY=Object.freeze({version:'bounded-owned-pricing-recovery-v1',maximumPhysicalReads:2,maximumReadMs:2000,physicalTimeoutMs:1000,validationReserveMs:125,rapidProbeIntervalMs:10000,outageProbeMs:2000,pollMs:25,normalStartsPer10s:5,normalStartsPerMinute:30,rapidStartsPer10s:1,rapidStartsPerMinute:6});
export type PilotProtectionCallOptions=PilotRpcCallOptions&{completeBy?:number};
export class PilotRpcUnavailable extends Error{
  constructor(readonly code:string,readonly retryAt:number|null=null){super('PILOT_RPC_'+code);this.name='PilotRpcUnavailable';}
}
type ProtectionFailureStage='provider-restriction'|'uninvoked-quota-or-spacing'|'physical-settlement-wait'|'physical-timeout'|'caller-cancel-before-physical'|'caller-cancel-during-physical'|'transport-or-node-response'|'local-admission';
type UninvokedHistoryRefusal=Readonly<{kind:'pilot-uninvoked-history-v1';at:number;pool:string;code:string;retryAt:number|null;physicalSettled:boolean}>;
// Only the actual client can issue this observation. Matching provider/error
// text, a constructed error or a copied metadata object cannot manufacture it.
const uninvokedHistoryRefusals=new WeakMap<Error,UninvokedHistoryRefusal>();
export function pilotUninvokedHistoryRefusal(error:unknown){return error instanceof Error?uninvokedHistoryRefusals.get(error)??null:null;}
const int=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const safe=(e:unknown)=>e instanceof Error&&/^(COMPONENT_[A-Z0-9_:-]{1,100}|PAPER_RPC_METHOD_DENIED)$/.test(e.message)?e.message:'COMPONENT_OPERATION_FAILED';
// A job can lose its admission/deadline while a durable reservation is being
// written. It remains charged, but this is neither a provider refusal nor a
// permanent failure of the shared gate. Existing settlement guards still apply.
const localAdmissionRefusal=(code:string)=>['COMPONENT_DISPATCH_EXPIRED','COMPONENT_ADMISSION_CLOSED'].includes(code);
const candidateBatchFault=(code:string)=>['COMPONENT_HISTORY_BATCH_RESPONSE_SIZE','COMPONENT_HISTORY_BATCH_ENVELOPE','COMPONENT_HISTORY_BATCH_MALFORMED_JSON'].includes(code);
const recoverable=(code:string)=>['COMPONENT_HTTP_429','COMPONENT_RPC_OVERLOAD','COMPONENT_RPC_ERROR_-32016','COMPONENT_HISTORY_BATCH_RESPONSE_SIZE','COMPONENT_HISTORY_BATCH_ENVELOPE','COMPONENT_HISTORY_BATCH_MALFORMED_JSON','COMPONENT_PHYSICAL_TIMEOUT','COMPONENT_HTTP_TRANSPORT','COMPONENT_WS_TRANSPORT','COMPONENT_ABORTED','COMPONENT_HTTP_STATUS_502','COMPONENT_HTTP_STATUS_503','COMPONENT_HTTP_STATUS_504'].includes(code);
function retryAfter(value:unknown,at:number){
  if(typeof value!=='string'||value.length>128)return at+65000;
  const n=/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value)*1000:NaN;
  const t=Number.isFinite(n)?at+Math.ceil(n):Date.parse(value);
  return Number.isSafeInteger(t)&&t>=at?Math.min(Number.MAX_SAFE_INTEGER,t+5000):at+65000;
}

export class PilotRpc{
  private readonly dir:string;private readonly paths:string[];private readonly now:()=>number;private readonly mono:()=>number;
  private readonly metadataBytes:number;private readonly componentProfile:NativeResearchProfile['version']|undefined;private readonly startedAt:number;private readonly startedMono:number;private readonly duration:number;private readonly units:number;private readonly responseBytes:number;private readonly chapterMs:number;private readonly chapterUnits:number;private readonly maximumChapters:number;private readonly startsPerMinute:number;private readonly startsPer10s:number;private readonly transactionStartsPer10s:number|undefined;
  private readonly initial:ComponentBaseline;private baseline:ComponentBaseline;private budget:ComponentBudget|undefined;private transport:ComponentTransport|undefined;
  private checkpointSha256:string|undefined;private compactedEpochs=0;private chapter=0;private active=false;private closed=false;private fatal:string|null=null;private cooldown=0;private cooldownMono=0;private failures=0;private pendingRetryAfter:number|null=null;private pendingHttpStatus:number|null=null;private inheritedUncertainty:number;private controlFailure=false;private controlCooldown=0;private controlCooldownMono=0;
  private providerRestriction=0;private providerRestrictionMono=0;
  private protectionProbeAt=0;private protectionProbeMono=0;private lastRapidProbeMono:number|null=null;private rapidProbePermit=false;private protectedOperation=false;private readonly protectedStarts:number[]=[];
  private readonly protectionRecovery={calls:0,logicalAttempts:0,rapidProbes:0,successesAfterRetry:0,refusals:0};
  private readonly protectionFailureStages:Partial<Record<ProtectionFailureStage,number>>={};
  private protectionLastFailure:{at:number;stage:ProtectionFailureStage;physicalInFlight:boolean}|null=null;
  private noteProtectionFailure(stage:ProtectionFailureStage){this.protectionFailureStages[stage]=(this.protectionFailureStages[stage]??0)+1;this.protectionLastFailure={at:this.now(),stage,physicalInFlight:(this.current()?.inFlight??0)>0};}
  private historyCooldown=0;private historyCooldownMono=0;private historyFailures=0;
  private historyBatchDisabledReason:string|null=null;
  private readonly queryTimeouts=new Map<string,{failures:number;until:number;untilMono:number;failedAt:number}>();private recentQueryTimeouts:Array<{key:string;at:number}>=[];private isolatedQueryTimeouts=0;private queryTimeoutEscalations=0;
  private readonly historyBatchCounts={plans:0,logicalQueriesRequested:0,physicalHttpStarts:0,logicalQueriesInvoked:0,logicalQueriesValidated:0,successfulLogicalQueries:0,rpcErrorResponses:0,providerBackoffBatches:0};
  private activeHistoryBatch:{transport:ComponentTransport;before:ReturnType<ComponentTransport['signatureHistoryBatchUsage']>}|null=null;
  private knownMethodStarts:Array<{at:number;method:string}>=[];private methodStarts:Array<{at:number;origin:'inherited-unknown'|'getTransaction'}>=[];private methodRefusals=0;
  private derivedTimer:ReturnType<typeof setTimeout>|null=null;private derivedDirtyAt:number|null=null;private derivedDirtyMono:number|null=null;private derivedGeneratedAt:number|null=null;private derivedGeneratedMono:number|null=null;
  private readonly derivedPersistence={maximumDelayMs:1000,passiveReceiptCalls:0,coalescedPassiveReceipts:0,timerFlushes:0,flushFailures:0,lastFailureAt:null as number|null,maximumObservedDirtyAgeMs:0};
  constructor(private readonly options:PilotRpcOptions){
    this.now=options.now??Date.now;this.mono=options.monotonic??(()=>performance.now());this.startedAt=this.now();this.startedMono=this.mono();
    if(options.persistent!==undefined&&typeof options.persistent!=='boolean')throw new PilotRpcUnavailable('INVALID_OPTIONS');this.checkpointSha256=options.baselineCheckpointSha256;
    const profile=options.profile;
    if(profile!==undefined&&profile!==CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.version&&profile!==NATIVE_TWO_HOUR_RESEARCH_PROFILE.version&&profile!==NATIVE_TWO_HOUR_90_RESEARCH_PROFILE.version)throw new PilotRpcUnavailable('INVALID_OPTIONS');
    const extended=profile!==undefined&&profile!==CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.version?resolveNativeResearchProfile(profile):null;
    if(extended&&(extended.physical.startsPerMinute===90?options.maxStartsPerMinute!==90:options.maxStartsPerMinute!==undefined&&options.maxStartsPerMinute!==60))throw new PilotRpcUnavailable('PROFILE_MINUTE_LIMIT_CONFLICT');
    this.componentProfile=extended?.version;this.metadataBytes=extended?.maximumRpcMetadataBytes??256*1024;
    const maximumResponseBytes=extended?.relatedResponseBytes??(profile===CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.version?CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.maximumResponseBytes:32*MIB);
    const maximumDuration=extended?.maximumDurationMs??1800000,maximumUnits=extended?.maximumUnits??1500,maximumChapters=extended?.maximumChapters??32;
    this.duration=options.durationMs??maximumDuration;this.units=options.maxUnits??maximumUnits;this.responseBytes=options.maxResponseBytes??32*MIB;this.chapterMs=options.chapterMs??300000;this.chapterUnits=options.chapterUnits??200;this.maximumChapters=options.maxChapters??maximumChapters;this.startsPerMinute=options.maxStartsPerMinute===undefined?60:options.maxStartsPerMinute;this.startsPer10s=options.maxStartsPer10s??10;this.transactionStartsPer10s=options.maxGetTransactionStartsPer10s;
    if(!int(this.startedAt)||!Number.isFinite(this.startedMono)||this.startedMono<0||!int(this.duration)||this.duration<1||this.duration>maximumDuration||!int(this.units)||this.units<1||this.units>maximumUnits||!int(this.responseBytes)||this.responseBytes<4*MIB||this.responseBytes>maximumResponseBytes||!int(this.chapterMs)||this.chapterMs<1||this.chapterMs>300000||!int(this.chapterUnits)||this.chapterUnits<1||this.chapterUnits>200||!int(this.maximumChapters)||this.maximumChapters<1||this.maximumChapters>maximumChapters||!int(this.startsPerMinute)||this.startsPerMinute<60||this.startsPerMinute>90||!int(this.startsPer10s)||this.startsPer10s<1||this.startsPer10s>20||options.priorPhysicalSettled!==true||!/^[a-z0-9-]{1,60}$/.test(options.runId))throw new PilotRpcUnavailable('INVALID_OPTIONS');
    if(this.transactionStartsPer10s!==undefined&&(!int(this.transactionStartsPer10s)||this.transactionStartsPer10s<2||this.transactionStartsPer10s>8))throw new PilotRpcUnavailable('INVALID_OPTIONS');
    this.dir=resolve(options.directory);const parent=lstatSync(dirname(this.dir));if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid?.()||(parent.mode&0o077)!==0||realpathSync(dirname(this.dir))!==dirname(this.dir))throw new PilotRpcUnavailable('UNSAFE_DIRECTORY');
    this.paths=options.baselinePaths.map(p=>resolve(p));if(this.paths.length+(options.persistent?0:this.maximumChapters)>RESEARCH_MAXIMUM_PATHS)throw new PilotRpcUnavailable('BASELINE_CHAPTER_CAP');
    const linked=readResearchBaseline({paths:this.paths,checkpointSha256:this.checkpointSha256,now:this.startedAt,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS});this.initial=structuredClone(linked.baseline);this.baseline=linked.baseline;this.inheritedUncertainty=linked.uncertainResponseBytes;
    // Historical books do not carry a complete per-method index. Treat EVERY
    // recent baseline start as getTransaction rather than refund unknown work.
    this.methodStarts=linked.baseline.starts.filter(at=>at>this.startedAt-10000).map(at=>({at,origin:'inherited-unknown' as const}));if(this.methodStarts.length>600)throw new PilotRpcUnavailable('METHOD_HISTORY_BOUND');
    const prior=JSON.parse(readFileSync(this.paths.at(-1)!,'utf8')) as {haltedReason?:string;lastObservedAt:number};
    if(prior.haltedReason==='COMPONENT_HTTP_429'&&options.priorCooldownUntil===undefined)throw new PilotRpcUnavailable('PRIOR_THROTTLE_RECEIPT_REQUIRED');
    if(prior.haltedReason==='COMPONENT_HTTP_429'&&options.historyRoute!==undefined&&options.priorHistoryCooldownUntil===undefined)throw new PilotRpcUnavailable('PRIOR_HISTORY_THROTTLE_RECEIPT_REQUIRED');
    this.cooldown=options.priorCooldownUntil??0;this.historyCooldown=options.priorHistoryCooldownUntil??0;
    if(options.historyRoute!==undefined&&options.historyRoute!==PUBLICNODE_HISTORY_ROUTE.version||!int(this.historyCooldown))throw new PilotRpcUnavailable('INVALID_HISTORY_ROUTE');this.historyCooldownMono=this.startedMono+Math.max(0,this.historyCooldown-this.startedAt);
    if(!int(this.cooldown))throw new PilotRpcUnavailable('INVALID_COOLDOWN');this.cooldownMono=this.startedMono+Math.max(0,this.cooldown-this.startedAt);this.providerRestriction=this.cooldown;this.providerRestrictionMono=this.cooldownMono;
    // Creation is exclusive. An old run cannot be silently resumed with a new
    // allowance; callers must review its receipts and explicitly link a new run.
    mkdirSync(this.dir,{mode:0o700});
    this.save('authorization.json',{profile:options.profile??'legacy',runId:options.runId,startedAt:this.startedAt,persistent:options.persistent===true,lifetimeCapsEnabled:options.persistent!==true,durationMs:options.persistent?null:this.duration,maxUnits:options.persistent?null:this.units,maxResponseBytes:options.persistent?null:this.responseBytes,chapterMs:this.chapterMs,chapterUnits:this.chapterUnits,maxChapters:options.persistent?null:this.maximumChapters,requestLimits:{maxStartsPer10s:this.startsPer10s,maxGetTransactionStartsPer10s:this.transactionStartsPer10s??null,maxStartsPerMinute:this.startsPerMinute,minSpacingMs:250,physicalInFlight:1},baseline:linked,priorCooldownUntil:this.cooldown,endpoint:'https://api.mainnet.solana.com',historyRoute:options.historyRoute===PUBLICNODE_HISTORY_ROUTE.version?PUBLICNODE_HISTORY_ROUTE:null,priorHistoryCooldownUntil:this.historyCooldown,readOnly:true,automaticRequestRetries:0,automaticRequestRetriesScope:'ordinary calls and control operations',protectedPricingRecovery:PILOT_PROTECTION_RECOVERY_POLICY});
    if(options.persistent&&this.paths.length>=32)this.compactAccounting();
    this.persist();
  }
  private readonly persistence={attempts:0,totalMs:0,maximumMs:0};
  private save(name:string,value:unknown,replace=false){
    const persistedAt=performance.now();this.persistence.attempts++;try{
    const path=join(this.dir,name),tmp=replace?path+'.pending':path,body=JSON.stringify(value)+'\n';if(Buffer.byteLength(body)>this.metadataBytes)throw new PilotRpcUnavailable('STORAGE_BOUND');
    const fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}if(replace)renameSync(tmp,path);const d=openSync(this.dir,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(d);}finally{closeSync(d);}
    }finally{const elapsed=Math.max(0,performance.now()-persistedAt);this.persistence.totalMs+=elapsed;this.persistence.maximumMs=Math.max(this.persistence.maximumMs,elapsed);}
  }
  /** This projection is independently coalesced. ComponentBudget keeps exact
   * receipt counts in memory inside a pre-durable bounded crash reservation;
   * checkpointed measured bytes and conservative uncertainty stay distinct. */
  private persist(){
    if(this.derivedTimer!==null){clearTimeout(this.derivedTimer);this.derivedTimer=null;}
    const generatedAt=this.now(),generatedMono=this.mono();if(this.derivedDirtyMono!==null)this.derivedPersistence.maximumObservedDirtyAgeMs=Math.max(this.derivedPersistence.maximumObservedDirtyAgeMs,Math.max(0,generatedMono-this.derivedDirtyMono));
    try{const usage=this.usage();this.save('status.json',{...usage,projectionGeneratedAt:generatedAt,derivedStatus:{...usage.derivedStatus,lastGeneratedAt:generatedAt,dirty:false,pendingSinceAt:null,pendingAgeMs:0}},true);}catch(error){this.derivedPersistence.flushFailures++;this.derivedPersistence.lastFailureAt=this.now();throw error;}
    this.derivedGeneratedAt=generatedAt;this.derivedGeneratedMono=generatedMono;this.derivedDirtyAt=null;this.derivedDirtyMono=null;
  }
  private deferPassiveStatus(){
    this.derivedPersistence.passiveReceiptCalls++;const at=this.now(),mono=this.mono();if(this.derivedDirtyAt===null){this.derivedDirtyAt=at;this.derivedDirtyMono=mono;}
    const delay=Math.max(0,this.derivedPersistence.maximumDelayMs-(mono-(this.derivedGeneratedMono??mono)));if(delay===0){this.persist();return;}
    this.derivedPersistence.coalescedPassiveReceipts++;if(this.derivedTimer!==null)return;
    // A single trailing timer is never pushed back by further receipt. The
    // timestamp/observed delay remains honest if the event loop is delayed.
    this.derivedTimer=setTimeout(()=>{this.derivedTimer=null;if(this.closed||this.derivedDirtyAt===null)return;this.derivedPersistence.timerFlushes++;try{this.persist();}catch{this.fatal='STORAGE_UNAVAILABLE';try{this.emit('pilot-derived-status-flush-unavailable',{at:this.now(),code:'STORAGE_UNAVAILABLE',automaticRetry:false,authoritativeCounterbooksUnchanged:true});}catch{this.fatal='DIAGNOSTIC_FAILURE';}}},Math.max(1,Math.ceil(delay)));this.derivedTimer.unref();
  }
  private emit(kind:string,data:unknown){this.options.record?.(kind,data);}
  private remainingMs(){if(this.options.persistent)return Number.MAX_SAFE_INTEGER-this.now();return Math.max(0,Math.min(this.duration-(this.now()-this.startedAt),this.duration-(this.mono()-this.startedMono)));}
  private recentMethodStarts(at=this.now()){if(!int(at))throw new PilotRpcUnavailable('METHOD_CLOCK');this.methodStarts=this.methodStarts.filter(r=>r.at>at-10000);return this.methodStarts;}
  /** Earliest time N getTransaction slots are simultaneously available. This
   * observes a method cache only; shared pacing/cooldowns still apply. Infinity
   * means N exceeds this run's method cap, not permission to wait internally. */
  methodReadyAt(method:string,reserveStarts=1):number{return this.methodReadyAtClock(method,reserveStarts,this.now());}
  private methodReadyAtClock(method:string,reserveStarts:number,at:number):number{
    validateRpc({method});if(!int(reserveStarts)||reserveStarts<1||reserveStarts>8)throw new PilotRpcUnavailable('INVALID_METHOD_RESERVE');if(!int(at))throw new PilotRpcUnavailable('METHOD_CLOCK');
    if(method!=='getTransaction'||this.transactionStartsPer10s===undefined)return at;if(reserveStarts>this.transactionStartsPer10s)return Infinity;
    const starts=this.recentMethodStarts(at),expire=starts.length+reserveStarts-this.transactionStartsPer10s;return expire>0?Math.max(at,starts[expire-1]!.at+10000):at;
  }
  private trackMethodStart(kind:string,data:unknown){
    if(kind==='component-physical-start'&&this.activeHistoryBatch){this.collectHistoryBatchCounts();this.persist();}
    if(kind!=='component-physical-start')return;const d=data as {at:number;kind?:ComponentKind};if(!d.kind)return;if(this.protectedOperation&&d.kind.transport==='http'&&d.kind.method==='getMultipleAccounts'){while(this.protectedStarts.length&&this.protectedStarts[0]!<=d.at-60000)this.protectedStarts.shift();this.protectedStarts.push(d.at);}if(!int(d.at)||d.at>this.now())throw new PilotRpcUnavailable('METHOD_CLOCK');this.knownMethodStarts=this.knownMethodStarts.filter(r=>r.at>d.at-10000);this.knownMethodStarts.push({at:d.at,method:d.kind.method});if(this.knownMethodStarts.length>600)throw new PilotRpcUnavailable('METHOD_HISTORY_BOUND');if(d.kind.transport!=='http'||d.kind.method!=='getTransaction')return;
    if(!int(d.at)||d.at>this.now()||this.methodStarts.at(-1)?.at!>d.at)throw new PilotRpcUnavailable('METHOD_CLOCK');this.recentMethodStarts();this.methodStarts.push({at:d.at,origin:'getTransaction'});if(this.methodStarts.length>600)throw new PilotRpcUnavailable('METHOD_HISTORY_BOUND');this.persist();
  }
  private current(){return this.budget?.usage();}
  private check(domain:'rpc'|'control'|'history'|'protection'='rpc'){
    if(this.closed)throw new PilotRpcUnavailable('CLOSED');if(this.fatal)throw new PilotRpcUnavailable(this.fatal);
    if(!this.options.persistent&&this.remainingMs()<=0)throw new PilotRpcUnavailable('RUN_TIME_CAP');
    const u=this.current(),calls=u?.cumulativeUnits??this.baseline.calls,bytes=(u?u.cumulativeResponseBytes+u.uncertainResponseBytes:this.baseline.bytes);
    if(!this.options.persistent&&calls-this.initial.calls>=this.units)throw new PilotRpcUnavailable('RUN_UNIT_CAP');if(!this.options.persistent&&bytes-this.initial.bytes+4*MIB>this.responseBytes)throw new PilotRpcUnavailable('RUN_RESPONSE_RESERVE');
    if(this.active||u&&(u.inFlight!==0||u.waitingOrOperating))throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');
    const until=domain==='protection'?Math.max(this.providerRestriction,this.protectionProbeAt):domain==='rpc'?this.cooldown:domain==='history'?this.historyCooldown:this.controlCooldown,untilMono=domain==='protection'?Math.max(this.providerRestrictionMono,this.protectionProbeMono):domain==='rpc'?this.cooldownMono:domain==='history'?this.historyCooldownMono:this.controlCooldownMono;
    if(this.now()<until||this.mono()<untilMono)throw new PilotRpcUnavailable('COOLDOWN',Math.max(until,this.now()+Math.ceil(Math.max(0,untilMono-this.mono()))));
    if(u?.haltedReason&&!this.controlFailure&&!recoverable(u.haltedReason)&&!localAdmissionRefusal(u.haltedReason)&&!['COMPONENT_UNIT_CAP','COMPONENT_TIME_CAP',...(this.options.persistent?['COMPONENT_RESPONSE_BYTE_CAP']:[])].includes(u.haltedReason))throw new PilotRpcUnavailable('FATAL_'+u.haltedReason);
  }
  private finishChapter(){
    if(!this.budget)return;const u=this.budget.usage();if(u.inFlight||u.waitingOrOperating)throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');
    this.budget.close();this.save('chapter-'+String(this.chapter).padStart(3,'0')+'-summary.json',{usage:u,closedAt:this.now(),physicalSettled:true,cooldownUntil:this.cooldown,controlCooldownUntil:this.controlCooldown,historyCooldownUntil:this.historyCooldown,lastFailureWasDataControl:this.controlFailure,unknownResponseReservationsRetained:u.uncertainResponseBytes});
    this.paths.push(join(this.dir,'chapter-'+String(this.chapter).padStart(3,'0')+'.json'));
    const linked=readResearchBaseline({paths:this.paths,checkpointSha256:this.checkpointSha256,now:this.now(),physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS});this.baseline=linked.baseline;this.inheritedUncertainty=linked.uncertainResponseBytes;this.budget=undefined;this.transport=undefined;if(this.options.persistent&&this.paths.length>=32)this.compactAccounting();
  }
  private compactAccounting(){
    if(!this.options.persistent||this.active||this.budget?.inFlight)throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');
    const result=createResearchBaselineCheckpoint({paths:this.paths,checkpointSha256:this.checkpointSha256,now:this.now(),physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS,outputPath:join(this.dir,'operating-checkpoint-'+String(++this.compactedEpochs).padStart(6,'0')+'.json'),liveAccountingBoundary:true,settlement:{inFlight:0,waitingOrOperating:false,physicalTransportsSettled:false}});
    this.paths.splice(0,this.paths.length,...result.baselinePaths);this.checkpointSha256=result.baselineCheckpointSha256;const linked=readResearchBaseline({paths:this.paths,checkpointSha256:this.checkpointSha256,now:this.now(),physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS});this.baseline=linked.baseline;this.inheritedUncertainty=linked.uncertainResponseBytes;
    // Sealing may conservatively move uninvoked legacy reservations to NOW.
    // Rebase their method window too. Actual methods observed by this process
    // remain known; every other retained start counts conservatively as getTX.
    const cutoff=this.now()-10000,known=new Map<number,string[]>();for(const r of this.knownMethodStarts.filter(r=>r.at>cutoff)){const methods=known.get(r.at)??[];methods.push(r.method);known.set(r.at,methods);}this.methodStarts=this.baseline.starts.filter(at=>at>cutoff).flatMap(at=>{const method=known.get(at)?.shift();return method!==undefined&&method!=='getTransaction'?[]:[{at,origin:method==='getTransaction'?'getTransaction' as const:'inherited-unknown' as const}];});
    this.emit('pilot-operating-accounting-checkpoint',{at:this.now(),...result,passiveStreamsMayRemainOpen:true,physicalOperationsSettled:true,lifetimeUsageRefunded:false});
  }
  private openChapter(domain:'rpc'|'control'|'history'|'protection'='rpc',accountingOnly=false){
    if(accountingOnly){if(this.closed||this.fatal||this.active||this.current()?.inFlight||this.current()?.waitingOrOperating)throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');}else this.check(domain);const u=this.current();
    if(u&&u.newUnits<this.chapterUnits&&this.now()<u.deadlineAt&&!u.haltedReason&&u.pending.length===0&&(!this.options.persistent||u.remainingGrantResponseBytes>=Math.min(4*MIB,this.responseBytes/2)))return;
    this.finishChapter();if(!accountingOnly)this.check(domain);if(!this.options.persistent&&this.chapter>=this.maximumChapters)throw new PilotRpcUnavailable('CHAPTER_CAP');
    const remainingUnits=this.options.persistent?this.chapterUnits:this.units-(this.baseline.calls-this.initial.calls),remainingBytes=this.options.persistent?this.responseBytes:this.responseBytes-(this.baseline.bytes-this.initial.bytes),at=this.now(),index=++this.chapter;
    const path=join(this.dir,'chapter-'+String(index).padStart(3,'0')+'.json');this.controlFailure=false;
    this.budget=new ComponentBudget({...(this.options.persistent?{continuousAccounting:true as const}:{}),...(this.componentProfile===undefined?{}:{profile:this.componentProfile}),statePath:path,grantId:this.options.runId+'-'+index,baseline:this.baseline,startedAt:at,totalMs:Math.min(this.chapterMs,Math.max(1,Math.floor(this.remainingMs()))),limits:{maxNewUnits:Math.min(this.chapterUnits,remainingUnits),maxCumulativeUnits:this.options.persistent?null:this.initial.calls+this.units,maxHttpBytes:remainingBytes,maxWsBytes:remainingBytes,maxCombinedBytes:remainingBytes,maxCumulativeBytes:this.options.persistent?null:this.initial.bytes+this.responseBytes,minSpacingMs:250,maxStartsPerMinute:this.startsPerMinute,maxStartsPer10s:this.startsPer10s},now:this.now,monotonic:this.mono,sleep:this.options.sleep,record:(kind,data)=>{
      this.trackMethodStart(kind,data);
      if(kind==='http-headers'){const h=data as {status:number;retryAfter:unknown;at:number};this.observeHttpHeaders(h);}
      this.emit(kind,data);
    }});
    this.transport=new ComponentTransport(this.budget,(kind,data)=>{
      if(kind==='http-headers'){const h=data as {status:number;retryAfter:unknown;at:number};this.observeHttpHeaders(h);}
      this.emit(kind,data);
    },()=>{},this.now,this.options.fetcher,undefined,this.options.historyRoute);this.persist();
  }
  private async perform<T>(work:(options:PilotRpcCallOptions)=>Promise<T>,signal:AbortSignal|undefined,options:PilotRpcCallOptions,domain:'rpc'|'control'|'history'|'protection',queryKey?:string):Promise<T>{
    if(signal?.aborted)throw new PilotRpcUnavailable('ABORTED');
    this.openChapter(domain);const operationBudget=this.budget!,invokedBefore=operationBudget.usage().actualInvokedUnits;const rapid=domain==='protection'&&this.rapidProbePermit&&(this.now()<this.cooldown||this.mono()<this.cooldownMono);if(rapid){this.rapidProbePermit=false;this.lastRapidProbeMono=this.mono();this.protectionProbeAt=this.now()+PILOT_PROTECTION_RECOVERY_POLICY.outageProbeMs;this.protectionProbeMono=this.mono()+PILOT_PROTECTION_RECOVERY_POLICY.outageProbeMs;this.protectionRecovery.rapidProbes++;}if(domain==='protection')this.protectionRecovery.logicalAttempts++;this.protectedOperation=domain==='protection';this.active=true;this.pendingRetryAfter=null;this.pendingHttpStatus=null;
    try{
      const remaining=Math.floor(this.remainingMs()),timeout=options.timeoutMs??1000;if(!int(timeout)||timeout<1||timeout>1500)throw new PilotRpcUnavailable('INVALID_TIMEOUT');
      const result=await work({...options,timeoutMs:Math.max(1,Math.min(timeout,remaining)),admissionOpen:()=>this.remainingMs()>0&&(!options.admissionOpen||options.admissionOpen())});
      if(domain==='rpc'||domain==='protection'){this.failures=0;this.protectionProbeAt=0;this.protectionProbeMono=0;}if(domain==='history')this.historyFailures=0;if(queryKey)this.queryTimeouts.delete(queryKey);return result;
    }catch(error){
      const code=safe(error),u=this.current();
      const refusalReason=u?.haltedReason??code;
      if(this.options.persistent&&u?.haltedReason&&['COMPONENT_UNIT_CAP','COMPONENT_TIME_CAP','COMPONENT_RESPONSE_BYTE_CAP'].includes(u.haltedReason)){this.emit('pilot-operating-epoch-boundary',{at:this.now(),code:u.haltedReason,physicalSettled:u.inFlight===0,uncertaintyRetained:u.uncertainResponseBytes,healthyServiceMayContinue:true});
      }else if(localAdmissionRefusal(refusalReason)){
        this.emit('pilot-job-admission-refused',{at:this.now(),code:refusalReason,domain,providerCooldownUnchanged:true,cooldownUntil:this.cooldown,physicalSettled:u?.inFlight===0,reservationsRetained:u?.uncertainResponseBytes??0,chapterHalted:u?.haltedReason!=null,nextAttemptRequiresExistingSettlementGuards:true,automaticRetry:false});
      }else if(u?.haltedReason){
        const globalFailure=/^COMPONENT_(STORAGE|DIAGNOSTIC|CLOCK|MONOTONIC|RESPONSE_|INVALID_)/.test(u.haltedReason);
        if(u.storageFailed){this.fatal='STORAGE_UNAVAILABLE';
        }else if(domain==='control'&&!globalFailure){
          this.controlFailure=true;this.emit('pilot-data-control-unavailable',{at:this.now(),code:u.haltedReason,controlCooldownUntil:this.controlCooldown,publicRpcCooldownUnchanged:true,physicalSettled:u.inFlight===0,reservationsRetained:u.uncertainResponseBytes});
        }else if((domain==='rpc'||domain==='history')&&candidateBatchFault(u.haltedReason)&&code===u.haltedReason&&this.pendingHttpStatus===200&&this.pendingRetryAfter===null&&u.inFlight===0&&!u.waitingOrOperating){
          // A fully settled refusal of the optional candidate-batch shape/size
          // does not establish a provider-wide outage. Its failed queries stay
          // unavailable and batching is disabled by its owner below. Preserve
          // the existing global incident streak/cooldown, physical starts and
          // uncertain bytes; ordinary pricing still needs the SAME recovered
          // chapter, rate/spacing and physical gate. No request is retried here.
          try{this.emit('pilot-candidate-batch-unavailable',{at:this.now(),code:u.haltedReason,httpStatus:this.pendingHttpStatus,cooldownUntil:this.cooldown,globalRpcCooldownUnchanged:true,globalFailureStreakUnchanged:true,physicalSettled:true,reservationsRetained:u.uncertainResponseBytes,ordinaryRequestsRequireSharedGate:true,automaticRetry:false});}catch{this.fatal='DIAGNOSTIC_FAILURE';throw new PilotRpcUnavailable('DIAGNOSTIC_FAILURE');}
        }else if(queryKey&&u.haltedReason==='COMPONENT_PHYSICAL_TIMEOUT'&&(this.pendingHttpStatus===null||this.pendingHttpStatus===200)&&this.isolateQueryTimeout(queryKey,u)){
          // Failed candidate history is unavailable; this never clears actual
          // physical occupancy, reservations, pacing or provider Retry-After.
        }else if(recoverable(u.haltedReason)){
          const failures=domain==='history'?++this.historyFailures:++this.failures,backoff=[2000,5000,10000,20000,40000,60000][Math.min(5,failures-1)]!,until=code==='COMPONENT_HTTP_429'||u.haltedReason==='COMPONENT_HTTP_429'?this.pendingRetryAfter??this.now()+65000:Math.max(this.now()+backoff,this.pendingRetryAfter??0);
          if(domain==='history'){this.historyCooldown=Math.max(this.historyCooldown,until);this.historyCooldownMono=Math.max(this.historyCooldownMono,this.mono()+Math.max(0,until-this.now()));}else{this.cooldown=Math.max(this.cooldown,until);this.cooldownMono=Math.max(this.cooldownMono,this.mono()+Math.max(0,until-this.now()));
            const explicitRestriction=this.pendingRetryAfter!==null||this.pendingHttpStatus!==null&&[429,502,503,504].includes(this.pendingHttpStatus)||['COMPONENT_HTTP_429','COMPONENT_RPC_OVERLOAD'].includes(u.haltedReason);
            if(explicitRestriction){this.providerRestriction=Math.max(this.providerRestriction,until);this.providerRestrictionMono=Math.max(this.providerRestrictionMono,this.mono()+Math.max(0,until-this.now()));}
            const rapidAvailable=!explicitRestriction&&(this.lastRapidProbeMono===null||this.mono()-this.lastRapidProbeMono>=PILOT_PROTECTION_RECOVERY_POLICY.rapidProbeIntervalMs);this.rapidProbePermit=rapidAvailable;
            this.protectionProbeAt=this.now()+(rapidAvailable?0:PILOT_PROTECTION_RECOVERY_POLICY.outageProbeMs);this.protectionProbeMono=this.mono()+(rapidAvailable?0:PILOT_PROTECTION_RECOVERY_POLICY.outageProbeMs);
          }
          this.emit('pilot-rpc-unavailable',{at:this.now(),domain,code:u.haltedReason,cooldownUntil:domain==='history'?this.historyCooldown:this.cooldown,primaryRpcCooldownUntil:this.cooldown,physicalSettled:u.inFlight===0,reservationsRetained:u.uncertainResponseBytes});
        }else if(!['COMPONENT_UNIT_CAP','COMPONENT_TIME_CAP',...(this.options.persistent?['COMPONENT_RESPONSE_BYTE_CAP']:[])].includes(u.haltedReason))this.fatal=u.haltedReason;
      }
      const unavailable=error instanceof PilotRpcUnavailable?error:new PilotRpcUnavailable(code,(domain==='history'?this.historyCooldown:this.cooldown)||null);
      if(queryKey&&localAdmissionRefusal(code)&&this.budget===operationBudget&&u?.actualInvokedUnits===invokedBefore&&u.inFlight===0&&!u.waitingOrOperating&&!u.storageFailed){uninvokedHistoryRefusals.set(unavailable,Object.freeze({kind:'pilot-uninvoked-history-v1',at:this.now(),pool:queryKey,code:unavailable.code,retryAt:unavailable.retryAt,physicalSettled:true}));}
      throw unavailable;
    }finally{this.protectedOperation=false;this.active=false;try{this.persist();}catch{this.fatal='STORAGE_UNAVAILABLE';throw new PilotRpcUnavailable('STORAGE_UNAVAILABLE');}}
  }
  private historyDomain(method:string):'rpc'|'history'{return this.options.historyRoute===PUBLICNODE_HISTORY_ROUTE.version&&method===PUBLICNODE_HISTORY_ROUTE.method?'history':'rpc';}
  private observeHttpHeaders(h:{status:number;retryAfter:unknown;at:number;method?:string}){
    const history=this.historyDomain(h.method??'')==='history';
    this.pendingHttpStatus=h.status;
    // A scoped candidate fault is excused only when no provider retry hint was
    // received. Preserve even a200 response's explicit hint on its failure path;
    // successful-response and actual429/503 handling otherwise stay unchanged.
    if(h.retryAfter!==null&&h.retryAfter!==undefined){
      this.pendingRetryAfter=retryAfter(h.retryAfter,h.at);const until=this.pendingRetryAfter;
      if(history){this.historyCooldown=Math.max(this.historyCooldown,until);this.historyCooldownMono=Math.max(this.historyCooldownMono,this.mono()+Math.max(0,until-this.now()));}else{this.cooldown=Math.max(this.cooldown,until);this.cooldownMono=Math.max(this.cooldownMono,this.mono()+Math.max(0,until-this.now()));this.providerRestriction=Math.max(this.providerRestriction,until);this.providerRestrictionMono=Math.max(this.providerRestrictionMono,this.mono()+Math.max(0,until-this.now()));}
      this.emit('pilot-rpc-explicit-retry-after',{at:h.at,status:h.status,domain:history?'history':'rpc',cooldownUntil:until,protectedFinancialReadsRemainRestricted:true,observedAfterLogicalCompletion:!this.active});if(!this.active)this.persist();
    }
    const throttle=h.status===429,unavailable=[502,503,504].includes(h.status);
    if(!throttle&&!unavailable)return;
    if(throttle||h.retryAfter!==null&&h.retryAfter!==undefined)this.pendingRetryAfter=retryAfter(h.retryAfter,h.at);
    // Headers can arrive during late physical settlement after perform() has
    // already returned its logical timeout. The original gate is still owned.
    // Actual throttle/overload must take effect before that slot can be reused.
    if(throttle||!this.active){
      const delay=throttle?65000:[2000,5000,10000,20000,40000,60000][Math.min(5,history?this.historyFailures++:this.failures++)]!,until=throttle?this.pendingRetryAfter??h.at+delay:Math.max(h.at+delay,this.pendingRetryAfter??0);
      if(history){this.historyCooldown=Math.max(this.historyCooldown,until);this.historyCooldownMono=Math.max(this.historyCooldownMono,this.mono()+Math.max(0,until-this.now()));}else{this.cooldown=Math.max(this.cooldown,until);this.cooldownMono=Math.max(this.cooldownMono,this.mono()+Math.max(0,until-this.now()));this.providerRestriction=Math.max(this.providerRestriction,until);this.providerRestrictionMono=Math.max(this.providerRestrictionMono,this.mono()+Math.max(0,until-this.now()));}
      this.emit('pilot-rpc-provider-backoff-observed',{at:h.at,status:h.status,domain:history?'history':'rpc',cooldownUntil:history?this.historyCooldown:this.cooldown,primaryRpcCooldownUntil:this.cooldown,physicalGateUnchanged:true,observedAfterLogicalCompletion:!this.active});
      if(!this.active||history){try{this.persist();}catch{this.fatal='STORAGE_UNAVAILABLE';throw new PilotRpcUnavailable('STORAGE_UNAVAILABLE');}}
    }
  }
  private isolateQueryTimeout(key:string,u:ReturnType<ComponentBudget['usage']>){
    const at=this.now();this.recentQueryTimeouts=this.recentQueryTimeouts.filter(r=>r.at>at-10000);for(const [k,row]of this.queryTimeouts)if(at-row.failedAt>60000&&this.mono()>=row.untilMono)this.queryTimeouts.delete(k);
    this.recentQueryTimeouts.push({key,at});
    // Three distinct query timeouts within10s indicate a possible broad outage,
    // not permission to probe every candidate. Retain the existing global backoff.
    if(new Set(this.recentQueryTimeouts.map(r=>r.key)).size>=3||this.queryTimeouts.size>=64&&!this.queryTimeouts.has(key)){this.queryTimeoutEscalations++;this.emit('pilot-query-timeout-escalated',{at,key,distinctTimedOutQueriesLast10s:new Set(this.recentQueryTimeouts.map(r=>r.key)).size,code:u.haltedReason,globalBackoffRequired:true,providerDomain:this.historyDomain('getSignaturesForAddress'),primaryRpcCooldownUnchanged:this.options.historyRoute!==undefined,physicalSettled:u.inFlight===0});return false;}
    const failures=(this.queryTimeouts.get(key)?.failures??0)+1,delay=[2000,5000,10000,20000,40000,60000][Math.min(5,failures-1)]!,until=at+delay;
    this.queryTimeouts.set(key,{failures,until,untilMono:this.mono()+delay,failedAt:at});this.isolatedQueryTimeouts++;
    this.emit('pilot-query-timeout-unavailable',{at,key,scope:'independent-history',code:u.haltedReason,httpStatus:this.pendingHttpStatus,queryCooldownUntil:until,queryFailures:failures,globalRpcCooldownUnchanged:true,physicalSettled:u.inFlight===0,reservationsRetained:u.uncertainResponseBytes,automaticRetry:false,meaning:'A timed-out query is not verified evidence or proof of provider saturation. Other jobs still require the shared physical/rate/byte gate.'});return true;
  }
  async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal,options:PilotRpcCallOptions={}):Promise<T>{
    validateRpc({method});if(Buffer.byteLength(JSON.stringify({method,params}))>64000)throw new PilotRpcUnavailable('REQUEST_SIZE');
    if(signal?.aborted)throw new PilotRpcUnavailable('ABORTED');
    if(method==='getTransaction'&&this.transactionStartsPer10s!==undefined){this.check();const at=this.now(),retryAt=this.methodReadyAtClock(method,1,at);if(retryAt>at){this.methodRefusals++;this.emit('pilot-method-capacity-refusal',{at,method,reserveStarts:1,retryAt,maximumStartsPer10s:this.transactionStartsPer10s,knownOrConservativelyInheritedStarts:this.recentMethodStarts(at).length,physicalRequestStarted:false,providerResponse:false});this.persist();throw new PilotRpcUnavailable('METHOD_PACING',retryAt);}}
    let queryKey:string|undefined;
    if(options.queryTimeoutScope!==undefined){if(options.queryTimeoutScope!=='independent-history'||method!=='getSignaturesForAddress'||typeof params[0]!=='string'||params[0].length<32||params[0].length>44||!/^[1-9A-HJ-NP-Za-km-z]+$/.test(params[0]))throw new PilotRpcUnavailable('INVALID_QUERY_TIMEOUT_SCOPE');queryKey=params[0];try{this.check(this.historyDomain(method));const row=this.queryTimeouts.get(queryKey);if(row&&(this.now()<row.until||this.mono()<row.untilMono))throw new PilotRpcUnavailable('QUERY_COOLDOWN',Math.max(row.until,this.now()+Math.ceil(Math.max(0,row.untilMono-this.mono()))));}catch(error){if(error instanceof PilotRpcUnavailable&&['COOLDOWN','QUERY_COOLDOWN','PHYSICAL_SLOT_OCCUPIED'].includes(error.code)){const u=this.current();uninvokedHistoryRefusals.set(error,Object.freeze({kind:'pilot-uninvoked-history-v1',at:this.now(),pool:queryKey,code:error.code,retryAt:error.retryAt,physicalSettled:!this.active&&(u?.inFlight??0)===0&&u?.waitingOrOperating!==true}));}throw error;}}
    return this.perform(o=>this.transport!.call<T>(method,params,signal,o),signal,options,this.historyDomain(method),queryKey);
  }
  /** Only the owned-position/pending financial adapter selects this path. It
   * cannot sign/submit and accepts only the existing complete account batch.
   * At most one fresh retry can fit the unchanged bounded read/deadline. */
  async callProtection<T>(method:string,params:unknown[]=[],signal?:AbortSignal,options:PilotProtectionCallOptions={}):Promise<T>{
    if(method!=='getMultipleAccounts'||!Array.isArray(params)||Buffer.byteLength(JSON.stringify({method,params}))>64000)throw new PilotRpcUnavailable('INVALID_PROTECTION_READ');
    const started=this.now(),startedMono=this.mono(),deadline=options.completeBy??started+PILOT_PROTECTION_RECOVERY_POLICY.maximumReadMs;
    if(!int(deadline)||deadline<=started||deadline>started+PILOT_PROTECTION_RECOVERY_POLICY.maximumReadMs)throw new PilotRpcUnavailable('INVALID_PROTECTION_DEADLINE');
    const deadlineMono=startedMono+deadline-started,copied=structuredClone(params);this.protectionRecovery.calls++;let last:unknown;
    for(let attempt=0;attempt<PILOT_PROTECTION_RECOVERY_POLICY.maximumPhysicalReads;attempt++){
      for(;;){
        if(signal?.aborted){this.noteProtectionFailure((this.current()?.inFlight??0)>0?'caller-cancel-during-physical':'caller-cancel-before-physical');throw new PilotRpcUnavailable('ABORTED');}
        const at=this.now(),window=this.dispatchView(this.current(),'protection').planned,readyAt=window?.readyAt??Math.max(at,this.providerRestriction,this.protectionProbeAt),busy=window?.actualPhysicalBusy===true;
        if(at>=deadline-PILOT_PROTECTION_RECOVERY_POLICY.validationReserveMs||this.mono()>=deadlineMono-PILOT_PROTECTION_RECOVERY_POLICY.validationReserveMs||readyAt>=deadline-PILOT_PROTECTION_RECOVERY_POLICY.validationReserveMs){this.protectionRecovery.refusals++;const hard=this.providerRestriction>at||this.providerRestrictionMono>this.mono();this.noteProtectionFailure(hard?'provider-restriction':busy?'physical-settlement-wait':'uninvoked-quota-or-spacing');throw hard?new PilotRpcUnavailable('COOLDOWN',readyAt):last??new PilotRpcUnavailable(busy?'PHYSICAL_SLOT_OCCUPIED':'COMPONENT_DISPATCH_EXPIRED',readyAt);}
        if(!busy&&readyAt<=at)break;
        const wait=Math.max(1,Math.min(PILOT_PROTECTION_RECOVERY_POLICY.pollMs,Math.min(deadline-at,deadlineMono-this.mono())-PILOT_PROTECTION_RECOVERY_POLICY.validationReserveMs,busy?PILOT_PROTECTION_RECOVERY_POLICY.pollMs:Math.max(1,readyAt-at)));
        try{if(this.options.sleep)await this.options.sleep(wait,signal);else await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,wait);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new PilotRpcUnavailable('ABORTED'));}signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}catch(error){this.noteProtectionFailure(signal?.aborted?(this.current()?.inFlight??0)>0?'caller-cancel-during-physical':'caller-cancel-before-physical':'local-admission');throw error;}
      }
      const remaining=Math.floor(Math.min(deadline-this.now(),deadlineMono-this.mono())-PILOT_PROTECTION_RECOVERY_POLICY.validationReserveMs);
      try{
        const result=await this.perform(o=>this.transport!.call<T>(method,copied,signal,o),signal,{...options,timeoutMs:Math.min(options.timeoutMs??PILOT_PROTECTION_RECOVERY_POLICY.physicalTimeoutMs,remaining),latestStartAt:Math.min(options.latestStartAt??deadline,deadline-PILOT_PROTECTION_RECOVERY_POLICY.validationReserveMs)},'protection');
        if(attempt)this.protectionRecovery.successesAfterRetry++;return result;
      }catch(error){
        last=error;this.noteProtectionFailure(signal?.aborted?(this.current()?.inFlight??0)>0?'caller-cancel-during-physical':'caller-cancel-before-physical':error instanceof PilotRpcUnavailable&&error.code==='COMPONENT_PHYSICAL_TIMEOUT'?'physical-timeout':error instanceof PilotRpcUnavailable&&/ADMISSION|DISPATCH_EXPIRED/.test(error.code)?'local-admission':'transport-or-node-response');const transient=error instanceof PilotRpcUnavailable&&['COMPONENT_PHYSICAL_TIMEOUT','COMPONENT_HTTP_TRANSPORT','COMPONENT_ABORTED','COMPONENT_RPC_ERROR_-32016'].includes(error.code);
        if(signal?.aborted||!transient||attempt+1>=PILOT_PROTECTION_RECOVERY_POLICY.maximumPhysicalReads)throw error;
        this.emit('pilot-protection-read-recovery',{at:this.now(),code:error.code,failedAttempt:attempt+1,latestCompletionAt:deadline,physicalSettlementStillRequired:true,providerRestrictionsPreserved:true,maximumAttempts:PILOT_PROTECTION_RECOVERY_POLICY.maximumPhysicalReads});
      }
    }
    throw last;
  }
  private collectHistoryBatchCounts(){
    if(!this.activeHistoryBatch)return;const {transport,before}=this.activeHistoryBatch,after=transport.signatureHistoryBatchUsage(),success=after.successfulLogicalQueries-before.successfulLogicalQueries,errors=after.rpcErrorResponses-before.rpcErrorResponses;
    this.historyBatchCounts.physicalHttpStarts+=after.physicalHttpStarts-before.physicalHttpStarts;this.historyBatchCounts.logicalQueriesInvoked+=after.logicalQueriesStarted-before.logicalQueriesStarted;this.historyBatchCounts.logicalQueriesValidated+=success+errors;this.historyBatchCounts.successfulLogicalQueries+=success;this.historyBatchCounts.rpcErrorResponses+=errors;this.historyBatchCounts.providerBackoffBatches+=after.providerBackoffBatches-before.providerBackoffBatches;this.activeHistoryBatch.before=after;
  }
  signatureHistoryBatchUsage(){this.collectHistoryBatchCounts();return {scope:'THIS_PILOT_RUN',...this.historyBatchCounts,logicalQueriesWithoutValidatedResponse:this.historyBatchCounts.logicalQueriesInvoked-this.historyBatchCounts.logicalQueriesValidated,maximumResponseBytes:512*1024,disabledReason:this.historyBatchDisabledReason,meaning:'Validated counts describe JSON-RPC envelopes, not audited pool windows. One physical HTTP envelope contains multiple provider queries; provider batch eligibility and metering remain unverified.'};}
  /** Query-local planning only. A caller may freeze its decision clock so a
   * healthy query does not become future work merely while readiness is read.
   * Real cooldowns retain current wall/monotonic evidence; call()/perform() still
   * recheck actual clocks, physical settlement and the single shared budget. */
  historyQueryReadyAt(pool:string,planningAt?:number):number{
    if(typeof pool!=='string'||pool.length<32||pool.length>44||!/^[1-9A-HJ-NP-Za-km-z]+$/.test(pool))throw new PilotRpcUnavailable('INVALID_HISTORY_POOL');
    const observedAt=this.now(),at=planningAt??observedAt,mono=this.mono(),row=this.queryTimeouts.get(pool);if(!int(at)||!int(observedAt)||!Number.isFinite(mono)||mono<0)throw new PilotRpcUnavailable('METHOD_CLOCK');
    const monoUntil=(until:number)=>until>mono?observedAt+Math.ceil(until-mono):0;
    const provider=this.options.historyRoute===PUBLICNODE_HISTORY_ROUTE.version?Math.max(this.historyCooldown,monoUntil(this.historyCooldownMono)):Math.max(this.cooldown,monoUntil(this.cooldownMono));return row?Math.max(at,provider,row.until,monoUntil(row.untilMono)):Math.max(at,provider);
  }
  /** Native quiet first pages only. The shared perform/gate retains all existing
   * physical quotas and uncertainty; a shared failure cannot identify one pool. */
  async callSignatureHistoryBatch<T=unknown>(requests:readonly SignatureHistoryBatchRequest[],signal?:AbortSignal,options:PilotRpcCallOptions={}):Promise<SignatureHistoryBatchResponse<T>>{
    if(!Array.isArray(requests)||requests.length<2||requests.length>6)throw new PilotRpcUnavailable('HISTORY_BATCH_SIZE');
    if(this.historyBatchDisabledReason)throw new PilotRpcUnavailable('HISTORY_BATCH_DISABLED');
    const keys=new Set<string>(),pools=new Set<string>();
    const copied=requests.map(request=>{
      if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['key','params'].includes(k))||typeof request.key!=='string'||!request.key||request.key.length>100||/[\u0000-\u001f]/.test(request.key)||keys.has(request.key)||!Array.isArray(request.params)||request.params.length!==2)throw new PilotRpcUnavailable('HISTORY_BATCH_REQUEST');
      const [pool,raw]=request.params,config=raw as Record<string,unknown>;
      if(typeof pool!=='string'||pool.length<32||pool.length>44||!/^[1-9A-HJ-NP-Za-km-z]+$/.test(pool)||pools.has(pool)||!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!['before','limit','commitment','minContextSlot'].includes(k))||config.limit!==100||config.commitment!=='confirmed'||!Number.isSafeInteger(config.minContextSlot)||Number(config.minContextSlot)<0)throw new PilotRpcUnavailable('HISTORY_BATCH_REQUEST');
      if(config.before!==undefined&&(typeof config.before!=='string'||config.before.length<64||config.before.length>88||!/^[1-9A-HJ-NP-Za-km-z]+$/.test(config.before)))throw new PilotRpcUnavailable('HISTORY_BATCH_REQUEST');
      keys.add(request.key);pools.add(pool);return {key:request.key,params:[pool,{...config}]};
    });
    if(options.queryTimeoutScope!==undefined&&options.queryTimeoutScope!=='independent-history')throw new PilotRpcUnavailable('INVALID_QUERY_TIMEOUT_SCOPE');
    if(signal?.aborted)throw new PilotRpcUnavailable('ABORTED');
    this.check(this.historyDomain('getSignaturesForAddress'));
    // Do not silently change the requested target set. The runner can select
    // eligible pools from queryTimeoutIsolation; both clocks are checked here.
    for(const pool of pools){const row=this.queryTimeouts.get(pool),at=this.now(),mono=this.mono();if(row&&(at<row.until||mono<row.untilMono))throw new PilotRpcUnavailable('QUERY_COOLDOWN',Math.max(row.until,at+Math.ceil(Math.max(0,row.untilMono-mono))));}
    this.historyBatchCounts.plans++;this.historyBatchCounts.logicalQueriesRequested+=copied.length;
    this.emit('pilot-signature-history-batch-plan',{at:this.now(),requests:structuredClone(copied),logicalQueriesRequested:copied.length,physicalStartNotYetAdmitted:true,maximumResponseBytes:512*1024,queryTimeoutAttribution:'Shared HTTP failure uses existing global backoff; no pool is identified.'});this.persist();
    let receipt:SignatureHistoryBatchResponse<T>|undefined;
    try{return await this.perform(async o=>{
      const transport=this.transport!;this.activeHistoryBatch={transport,before:transport.signatureHistoryBatchUsage()};
      try{
        receipt=await transport.callSignatureHistoryBatch<T>(copied,signal,{...o,maximumResponseBytes:512*1024});
        if(receipt.overloaded)throw Error(receipt.items.some(item=>item.errorCode===429)?'COMPONENT_HTTP_429':'COMPONENT_RPC_OVERLOAD');
        for(const item of receipt.items)if(item.status==='result')this.queryTimeouts.delete(String(copied.find(request=>request.key===item.key)!.params[0]));
        return receipt;
      }finally{
        this.collectHistoryBatchCounts();this.activeHistoryBatch=null;
      }
    },signal,options,this.historyDomain('getSignaturesForAddress'));}
    catch(error){
      // Preserve the fully settled per-item receipt after perform has applied
      // its existing actual-overload cooldown. Other failures remain failures.
      if(receipt?.overloaded&&error instanceof PilotRpcUnavailable&&['COMPONENT_HTTP_429','COMPONENT_RPC_OVERLOAD'].includes(error.code))return receipt;
      if(error instanceof PilotRpcUnavailable&&['COMPONENT_HISTORY_BATCH_RESPONSE_SIZE','COMPONENT_HISTORY_BATCH_ENVELOPE','COMPONENT_HISTORY_BATCH_MALFORMED_JSON'].includes(error.code)){this.historyBatchDisabledReason=error.code;try{this.emit('pilot-history-batch-disabled',{at:this.now(),reason:error.code,optimizationDisabledForRun:true,individualQueriesAndFinancialPricingRequireExistingSharedRecovery:true,uncertainReservationsRetained:true,automaticRetry:false});}catch{this.fatal='DIAGNOSTIC_FAILURE';throw new PilotRpcUnavailable('DIAGNOSTIC_FAILURE');}try{this.persist();}catch{this.fatal='STORAGE_UNAVAILABLE';throw new PilotRpcUnavailable('STORAGE_UNAVAILABLE');}}
      throw error;
    }
  }
  async operateData<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,signal?:AbortSignal,options:PilotRpcCallOptions={}):Promise<T>{
    if(!(kind.transport==='ws-upgrade'&&kind.method==='upgrade'||kind.transport==='ws'&&['subscribeMigration','logsSubscribe','logsUnsubscribe','ping','pong','close'].includes(kind.method)))throw new PilotRpcUnavailable('DATA_METHOD_DENIED');
    return this.perform(o=>this.budget!.operate(kind,work,signal,o),signal,options,'control');
  }
  /** Control/Portal receipt only. Broad PumpApi traffic has its own feed cap.
   * Receipt remains chargeable while an HTTP slot is occupied or halted. */
  accountControlBytes(bytes:number){
    if(!int(bytes)||bytes>2*MIB)throw new PilotRpcUnavailable('CONTROL_BYTE_CHARGE');
    const rotateAfterReceipt=this.options.persistent&&!this.closed&&!this.active&&this.budget&&this.budget.usage().inFlight===0&&this.budget.usage().remainingGrantResponseBytes<Math.min(4*MIB,this.responseBytes/2);
    if(!this.budget||this.closed)throw new PilotRpcUnavailable('CONTROL_WITHOUT_OPEN_CHAPTER');
    // Receipt already happened. Consume its OLD pre-funded tail first; only
    // then may a settled close release unused capacity or a new epoch fail.
    try{this.budget.chargePassiveWs(bytes);const u=this.budget.usage();if(!this.options.persistent&&u.cumulativeResponseBytes+u.uncertainResponseBytes-this.initial.bytes+2*MIB>this.responseBytes){this.budget.halt('COMPONENT_RESPONSE_RESERVE');throw Error('COMPONENT_RESPONSE_RESERVE');}if(rotateAfterReceipt)this.openChapter('control',true);if(this.derivedPersistence.flushFailures>0&&this.fatal)throw Error('COMPONENT_STORAGE_UNAVAILABLE');this.deferPassiveStatus();}catch(error){const code=safe(error);if(!['COMPONENT_TIME_CAP','COMPONENT_UNIT_CAP',...(this.options.persistent?['COMPONENT_RESPONSE_BYTE_CAP']:[])].includes(code))this.fatal=code;this.persist();throw new PilotRpcUnavailable(code);}
    // The receipt already happened and remains counted even when the global
    // interval has ended. It cannot admit another request or extend that run.
    if(this.remainingMs()<=0){this.persist();throw new PilotRpcUnavailable('RUN_TIME_CAP');}
  }
  chargeDataBytes(bytes:number){this.accountControlBytes(bytes);}
  /** A WS unexpected-response handler must call this before rejecting its
   * existing physical operation. It never starts or retries a request. */
  noteThrottle(value:string|null,at=this.now()){
    if(!int(at)||at>this.now())throw new PilotRpcUnavailable('INVALID_THROTTLE_TIME');
    const until=retryAfter(value,at);this.controlCooldown=Math.max(this.controlCooldown,until);this.controlCooldownMono=Math.max(this.controlCooldownMono,this.mono()+Math.max(0,until-this.now()));this.persist();return until;
  }
  /** Planning over the wrapper which can archive a SETTLED failed chapter.
   * Low-level pending reservations remain busy inside ComponentBudget. They are
   * not physical occupancy after settlement, and openChapter still owns every
   * cooldown, budget, settlement and immutable-book transition check. */
  private dispatchView(u:ReturnType<ComponentBudget['usage']>|undefined,domain:'rpc'|'control'|'history'|'protection'|'all'='all'){
    const raw=this.budget?.dispatchWindow()??null;if(!raw||!u)return {raw:null,planned:null};
    const at=this.now(),mono=this.mono(),physicalBusy=this.active||u.inFlight!==0||u.waitingOrOperating;
    const reason=u.haltedReason,reasonRecoverable=reason!==null&&(this.controlFailure||recoverable(reason)||localAdmissionRefusal(reason)||['COMPONENT_UNIT_CAP','COMPONENT_TIME_CAP',...(this.options.persistent?['COMPONENT_RESPONSE_BYTE_CAP']:[])].includes(reason));
    const needsChapterRecovery=u.pending.length!==0||reason!==null;
    const recoveryAdmissible=needsChapterRecovery&&reasonRecoverable&&!physicalBusy&&!this.closed&&!this.fatal&&!u.storageFailed&&this.remainingMs()>0&&(this.options.persistent||u.cumulativeUnits-this.initial.calls<this.units&&u.cumulativeResponseBytes+u.uncertainResponseBytes-this.initial.bytes+4*MIB<=this.responseBytes&&this.chapter<this.maximumChapters);
    // Domain cooldowns never grant a second gate or erase a failed book. The
    // legacy common view remains conservative until its caller selects a domain.
    const until=domain==='protection'?Math.max(this.providerRestriction,this.protectionProbeAt):domain==='rpc'?this.cooldown:domain==='history'?this.historyCooldown:domain==='control'?this.controlCooldown:Math.max(this.cooldown,this.controlCooldown,this.historyCooldown),untilMono=domain==='protection'?Math.max(this.providerRestrictionMono,this.protectionProbeMono):domain==='rpc'?this.cooldownMono:domain==='history'?this.historyCooldownMono:domain==='control'?this.controlCooldownMono:Math.max(this.cooldownMono,this.controlCooldownMono,this.historyCooldownMono);
    const readyAt=Math.max(raw.readyAt,until,at+Math.ceil(Math.max(0,untilMono-mono)));
    return {raw,planned:{...raw,readyAt,waitMs:Math.max(0,readyAt-at),physicalBusy:physicalBusy||raw.physicalBusy&&!recoveryAdmissible,actualPhysicalBusy:physicalBusy,needsChapterRecovery,recoveryAdmissible,uncertainResponseReservationsRetained:u.uncertainResponseBytes}};
  }
  usage(){
    const u=this.current(),dispatch=this.dispatchView(u),rpcDispatch=this.dispatchView(u,'rpc'),controlDispatch=this.dispatchView(u,'control'),historyDispatch=this.dispatchView(u,this.options.historyRoute?'history':'rpc'),protectionDispatch=this.dispatchView(u,'protection'),calls=u?.cumulativeUnits??this.baseline.calls,bytes=u?u.cumulativeResponseBytes+u.uncertainResponseBytes:this.baseline.bytes;
    const recoveryPaths=[...this.paths];return {persistent:this.options.persistent===true,lifetimeCapsEnabled:this.options.persistent!==true,lifetimeLimits:this.options.persistent?null:{durationMs:this.duration,units:this.units,responseBytes:this.responseBytes},recoveryBaselinePaths:recoveryPaths,recoveryBaselineCheckpointSha256:this.checkpointSha256??null,compactedAccountingEpochs:this.compactedEpochs,historyRoute:this.options.historyRoute===PUBLICNODE_HISTORY_ROUTE.version?PUBLICNODE_HISTORY_ROUTE:null,signatureHistoryBatch:this.signatureHistoryBatchUsage(),queryTimeoutIsolation:{scope:'opt-in independently scheduled history only',isolatedTimeouts:this.isolatedQueryTimeouts,globalEscalations:this.queryTimeoutEscalations,maximumQueries:64,rows:[...this.queryTimeouts].map(([key,row])=>({key,failures:row.failures,cooldownUntil:row.until,lastFailureAt:row.failedAt})),outagePolicy:this.options.historyRoute?'three distinct history query timeouts within10s retain history-provider backoff; primary HTTP/control remain independently gated':'three distinct query timeouts within10s retain existing global backoff',restartMeaning:'Local research backoff only; actual provider cooldown remains separately persisted'},persistence:{...this.persistence},derivedStatus:{...this.derivedPersistence,lastGeneratedAt:this.derivedGeneratedAt,dirty:this.derivedDirtyAt!==null,pendingSinceAt:this.derivedDirtyAt,pendingAgeMs:this.derivedDirtyMono===null?0:Math.max(0,this.mono()-this.derivedDirtyMono),authority:'Derived metadata only; chapter counterbooks retain exact checkpointed receipt bytes plus conservative durable crash-tail reservations. Not a market-data timestamp.',timing:'At most1s scheduled delay; actual flush can be late during event-loop stalls and remains source-timestamped.'},profile:this.options.profile??'legacy',runId:this.options.runId,startedAt:this.startedAt,deadlineAt:this.options.persistent?null:this.startedAt+this.duration,remainingMs:this.options.persistent?null:this.remainingMs(),chapter:this.chapter,chapterPaths:[...this.paths],baselineCheckpointSha256:this.checkpointSha256??null,activeChapterPath:this.budget?join(this.dir,'chapter-'+String(this.chapter).padStart(3,'0')+'.json'):null,cumulativeUnits:calls,newUnits:calls-this.initial.calls,accountedCumulativeResponseBytes:bytes,newAccountedResponseBytes:bytes-this.initial.bytes,maximumNewUnits:this.units,maximumNewResponseBytes:this.responseBytes,requestLimits:{maxStartsPer10s:this.startsPer10s,maxGetTransactionStartsPer10s:this.transactionStartsPer10s??null,maxStartsPerMinute:this.startsPerMinute,minSpacingMs:250,physicalInFlight:1},methodPacing:{getTransactionStartsLast10s:this.recentMethodStarts().map(r=>({...r})),capacityRefusals:this.methodRefusals,baselineUnknownMethodsCountConservatively:true},inFlight:u?.inFlight??0,waitingOrOperating:this.active||u?.waitingOrOperating===true,uncertainResponseBytes:this.inheritedUncertainty+(u?.uncertainResponseBytes??0),currentChapterUncertainResponseBytes:u?.uncertainResponseBytes??0,inheritedUncertaintyIsRetainedInBaseline:true,cooldownUntil:this.cooldown,controlCooldownUntil:this.controlCooldown,historyCooldownUntil:this.historyCooldown,lastFailureWasDataControl:this.controlFailure,closed:this.closed,fatal:this.fatal,chapterUsage:u??null,rawChapterDispatchWindow:dispatch.raw,dispatchWindow:dispatch.planned,rpcDispatchWindow:rpcDispatch.planned,controlDispatchWindow:controlDispatch.planned,historyDispatchWindow:historyDispatch.planned,protectionDispatchWindow:protectionDispatch.planned,currentUninvokedReservationCredit:this.active&&u?.inFlight===1&&u.pending.some(p=>!u.actualInvocations.some(a=>a.id===p.id))?1:0,protectionRecovery:{...this.protectionRecovery,failureStages:{...this.protectionFailureStages},lastFailure:this.protectionLastFailure?{...this.protectionLastFailure}:null,policy:PILOT_PROTECTION_RECOVERY_POLICY,rolling60SecondStarts:this.protectedStarts.filter(at=>at>this.now()-60000).length,rolling10SecondStarts:this.protectedStarts.filter(at=>at>this.now()-10000).length,providerRestrictionUntil:this.protectionProviderRestrictionUntil(),probeAt:this.protectionProbeAt},automaticRequestRetries:0,automaticRequestRetriesScope:'ordinary calls and control operations',protectedPricingMaximumAutomaticRetries:PILOT_PROTECTION_RECOVERY_POLICY.maximumPhysicalReads-1};
  }
  available(){try{this.check();return true;}catch{return false;}}
  cooldownUntil(){const remaining=this.cooldownMono-this.mono();return remaining>0?Math.max(this.cooldown,this.now()+Math.ceil(remaining)):this.cooldown;}
  protectionProviderRestrictionUntil(){const remaining=this.providerRestrictionMono-this.mono();return remaining>0?Math.max(this.providerRestriction,this.now()+Math.ceil(remaining)):this.providerRestriction;}
  controlCooldownUntil(){const remaining=this.controlCooldownMono-this.mono();return remaining>0?Math.max(this.controlCooldown,this.now()+Math.ceil(remaining)):this.controlCooldown;}
  historyCooldownUntil(){const remaining=this.historyCooldownMono-this.mono();return remaining>0?Math.max(this.historyCooldown,this.now()+Math.ceil(remaining)):this.historyCooldown;}
  close(){if(this.closed)return;if(this.active)throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');this.finishChapter();this.closed=true;this.persist();}
}
