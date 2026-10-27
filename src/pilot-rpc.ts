/** Finite, isolated PAPER-pilot data adapter. Existing public transport and
 * physical gate own requests; this wrapper never queues, retries or signs. */
import {constants,closeSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {ComponentBudget,type ComponentBaseline,type ComponentBudgetOptions,type ComponentKind,type ComponentOperation} from './component-budget.js';
import {ComponentTransport} from './component-transport.js';
import {readResearchBaseline} from './research-baseline.js';
import {validateRpc} from './network.js';

const MIB=1024*1024;
export type PilotRpcCallOptions={latestStartAt?:number;timeoutMs?:number;admissionOpen?:()=>boolean};
export type PilotRpcOptions={directory:string;runId:string;baselinePaths:readonly string[];priorPhysicalSettled:true;priorCooldownUntil?:number;durationMs?:number;maxUnits?:number;maxResponseBytes?:number;chapterMs?:number;chapterUnits?:number;maxChapters?:number;/** Research-only local gate; default10 retains earlier behavior. */maxStartsPer10s?:number;/** Optional conservative experiment limit, not a provider entitlement. */maxGetTransactionStartsPer10s?:number;record?:(kind:string,data:unknown)=>void;now?:()=>number;monotonic?:()=>number;fetcher?:typeof fetch;sleep?:ComponentBudgetOptions['sleep']};
export class PilotRpcUnavailable extends Error{
  constructor(readonly code:string,readonly retryAt:number|null=null){super('PILOT_RPC_'+code);this.name='PilotRpcUnavailable';}
}
const int=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const safe=(e:unknown)=>e instanceof Error&&/^(COMPONENT_[A-Z0-9_:-]{1,100}|PAPER_RPC_METHOD_DENIED)$/.test(e.message)?e.message:'COMPONENT_OPERATION_FAILED';
const recoverable=(code:string)=>['COMPONENT_HTTP_429','COMPONENT_RPC_OVERLOAD','COMPONENT_PHYSICAL_TIMEOUT','COMPONENT_HTTP_TRANSPORT','COMPONENT_WS_TRANSPORT','COMPONENT_ABORTED','COMPONENT_HTTP_STATUS_502','COMPONENT_HTTP_STATUS_503','COMPONENT_HTTP_STATUS_504'].includes(code);
function retryAfter(value:unknown,at:number){
  if(typeof value!=='string'||value.length>128)return at+65000;
  const n=/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value)*1000:NaN;
  const t=Number.isFinite(n)?at+Math.ceil(n):Date.parse(value);
  return Number.isSafeInteger(t)&&t>=at?Math.min(Number.MAX_SAFE_INTEGER,t+5000):at+65000;
}

export class PilotRpc{
  private readonly dir:string;private readonly paths:string[];private readonly now:()=>number;private readonly mono:()=>number;
  private readonly startedAt:number;private readonly startedMono:number;private readonly duration:number;private readonly units:number;private readonly responseBytes:number;private readonly chapterMs:number;private readonly chapterUnits:number;private readonly maximumChapters:number;private readonly startsPer10s:number;private readonly transactionStartsPer10s:number|undefined;
  private readonly initial:ComponentBaseline;private baseline:ComponentBaseline;private budget:ComponentBudget|undefined;private transport:ComponentTransport|undefined;
  private chapter=0;private active=false;private closed=false;private fatal:string|null=null;private cooldown=0;private cooldownMono=0;private failures=0;private pendingRetryAfter:number|null=null;private inheritedUncertainty:number;private controlFailure=false;private controlCooldown=0;
  private methodStarts:Array<{at:number;origin:'inherited-unknown'|'getTransaction'}>=[];private methodRefusals=0;
  constructor(private readonly options:PilotRpcOptions){
    this.now=options.now??Date.now;this.mono=options.monotonic??(()=>performance.now());this.startedAt=this.now();this.startedMono=this.mono();
    this.duration=options.durationMs??1800000;this.units=options.maxUnits??1500;this.responseBytes=options.maxResponseBytes??32*MIB;this.chapterMs=options.chapterMs??300000;this.chapterUnits=options.chapterUnits??200;this.maximumChapters=options.maxChapters??32;this.startsPer10s=options.maxStartsPer10s??10;this.transactionStartsPer10s=options.maxGetTransactionStartsPer10s;
    if(!int(this.startedAt)||!Number.isFinite(this.startedMono)||this.startedMono<0||!int(this.duration)||this.duration<1||this.duration>1800000||!int(this.units)||this.units<1||this.units>1500||!int(this.responseBytes)||this.responseBytes<4*MIB||this.responseBytes>32*MIB||!int(this.chapterMs)||this.chapterMs<1||this.chapterMs>300000||!int(this.chapterUnits)||this.chapterUnits<1||this.chapterUnits>200||!int(this.maximumChapters)||this.maximumChapters<1||this.maximumChapters>32||!int(this.startsPer10s)||this.startsPer10s<1||this.startsPer10s>20||options.priorPhysicalSettled!==true||!/^[a-z0-9-]{1,60}$/.test(options.runId))throw new PilotRpcUnavailable('INVALID_OPTIONS');
    if(this.transactionStartsPer10s!==undefined&&(!int(this.transactionStartsPer10s)||this.transactionStartsPer10s<2||this.transactionStartsPer10s>8))throw new PilotRpcUnavailable('INVALID_OPTIONS');
    this.dir=resolve(options.directory);const parent=lstatSync(dirname(this.dir));if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid?.()||(parent.mode&0o077)!==0||realpathSync(dirname(this.dir))!==dirname(this.dir))throw new PilotRpcUnavailable('UNSAFE_DIRECTORY');
    this.paths=options.baselinePaths.map(p=>resolve(p));if(this.paths.length+this.maximumChapters>128)throw new PilotRpcUnavailable('BASELINE_CHAPTER_CAP');
    const linked=readResearchBaseline({paths:this.paths,now:this.startedAt,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:128});this.initial=structuredClone(linked.baseline);this.baseline=linked.baseline;this.inheritedUncertainty=linked.uncertainResponseBytes;
    // Historical books do not carry a complete per-method index. Treat EVERY
    // recent baseline start as getTransaction rather than refund unknown work.
    this.methodStarts=linked.baseline.starts.filter(at=>at>this.startedAt-10000).map(at=>({at,origin:'inherited-unknown' as const}));if(this.methodStarts.length>600)throw new PilotRpcUnavailable('METHOD_HISTORY_BOUND');
    const prior=JSON.parse(readFileSync(this.paths.at(-1)!,'utf8')) as {haltedReason?:string;lastObservedAt:number};
    if(prior.haltedReason==='COMPONENT_HTTP_429'&&options.priorCooldownUntil===undefined)throw new PilotRpcUnavailable('PRIOR_THROTTLE_RECEIPT_REQUIRED');
    this.cooldown=options.priorCooldownUntil??0;
    if(!int(this.cooldown))throw new PilotRpcUnavailable('INVALID_COOLDOWN');this.cooldownMono=this.startedMono+Math.max(0,this.cooldown-this.startedAt);
    // Creation is exclusive. An old run cannot be silently resumed with a new
    // allowance; callers must review its receipts and explicitly link a new run.
    mkdirSync(this.dir,{mode:0o700});
    this.save('authorization.json',{runId:options.runId,startedAt:this.startedAt,durationMs:this.duration,maxUnits:this.units,maxResponseBytes:this.responseBytes,chapterMs:this.chapterMs,chapterUnits:this.chapterUnits,maxChapters:this.maximumChapters,requestLimits:{maxStartsPer10s:this.startsPer10s,maxGetTransactionStartsPer10s:this.transactionStartsPer10s??null,maxStartsPerMinute:60,minSpacingMs:250,physicalInFlight:1},baseline:linked,priorCooldownUntil:this.cooldown,endpoint:'https://api.mainnet.solana.com',readOnly:true,automaticRequestRetries:0});
    this.persist();
  }
  private save(name:string,value:unknown,replace=false){
    const path=join(this.dir,name),tmp=replace?path+'.pending':path,body=JSON.stringify(value)+'\n';if(Buffer.byteLength(body)>256*1024)throw new PilotRpcUnavailable('STORAGE_BOUND');
    const fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}if(replace)renameSync(tmp,path);const d=openSync(this.dir,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(d);}finally{closeSync(d);}
  }
  private persist(){this.save('status.json',this.usage(),true);}
  private emit(kind:string,data:unknown){this.options.record?.(kind,data);}
  private remainingMs(){return Math.max(0,Math.min(this.duration-(this.now()-this.startedAt),this.duration-(this.mono()-this.startedMono)));}
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
    if(kind!=='component-physical-start')return;const d=data as {at:number;kind?:ComponentKind};if(d.kind?.transport!=='http'||d.kind.method!=='getTransaction')return;
    if(!int(d.at)||d.at>this.now()||this.methodStarts.at(-1)?.at!>d.at)throw new PilotRpcUnavailable('METHOD_CLOCK');this.recentMethodStarts();this.methodStarts.push({at:d.at,origin:'getTransaction'});if(this.methodStarts.length>600)throw new PilotRpcUnavailable('METHOD_HISTORY_BOUND');this.persist();
  }
  private current(){return this.budget?.usage();}
  private check(){
    if(this.closed)throw new PilotRpcUnavailable('CLOSED');if(this.fatal)throw new PilotRpcUnavailable(this.fatal);
    if(this.remainingMs()<=0)throw new PilotRpcUnavailable('RUN_TIME_CAP');
    const u=this.current(),calls=u?.cumulativeUnits??this.baseline.calls,bytes=(u?u.cumulativeResponseBytes+u.uncertainResponseBytes:this.baseline.bytes);
    if(calls-this.initial.calls>=this.units)throw new PilotRpcUnavailable('RUN_UNIT_CAP');if(bytes-this.initial.bytes+4*MIB>this.responseBytes)throw new PilotRpcUnavailable('RUN_RESPONSE_RESERVE');
    if(this.active||u&&(u.inFlight!==0||u.waitingOrOperating))throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');
    if(this.now()<this.cooldown||this.mono()<this.cooldownMono)throw new PilotRpcUnavailable('COOLDOWN',this.cooldown);
    if(u?.haltedReason&&!this.controlFailure&&!recoverable(u.haltedReason)&&!['COMPONENT_UNIT_CAP','COMPONENT_TIME_CAP'].includes(u.haltedReason))throw new PilotRpcUnavailable('FATAL_'+u.haltedReason);
  }
  private finishChapter(){
    if(!this.budget)return;const u=this.budget.usage();if(u.inFlight||u.waitingOrOperating)throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');
    this.budget.close();this.save('chapter-'+String(this.chapter).padStart(3,'0')+'-summary.json',{usage:u,closedAt:this.now(),physicalSettled:true,cooldownUntil:this.cooldown,controlCooldownUntil:this.controlCooldown,lastFailureWasDataControl:this.controlFailure,unknownResponseReservationsRetained:u.uncertainResponseBytes});
    this.paths.push(join(this.dir,'chapter-'+String(this.chapter).padStart(3,'0')+'.json'));
    const linked=readResearchBaseline({paths:this.paths,now:this.now(),physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:128});this.baseline=linked.baseline;this.inheritedUncertainty=linked.uncertainResponseBytes;this.budget=undefined;this.transport=undefined;
  }
  private openChapter(){
    this.check();const u=this.current();
    if(u&&u.newUnits<this.chapterUnits&&this.now()<u.deadlineAt&&!u.haltedReason&&u.pending.length===0)return;
    this.finishChapter();this.check();if(this.chapter>=this.maximumChapters)throw new PilotRpcUnavailable('CHAPTER_CAP');
    const remainingUnits=this.units-(this.baseline.calls-this.initial.calls),remainingBytes=this.responseBytes-(this.baseline.bytes-this.initial.bytes),at=this.now(),index=++this.chapter;
    const path=join(this.dir,'chapter-'+String(index).padStart(3,'0')+'.json');this.controlFailure=false;
    this.budget=new ComponentBudget({statePath:path,grantId:this.options.runId+'-'+index,baseline:this.baseline,startedAt:at,totalMs:Math.min(this.chapterMs,Math.max(1,Math.floor(this.remainingMs()))),limits:{maxNewUnits:Math.min(this.chapterUnits,remainingUnits),maxCumulativeUnits:this.initial.calls+this.units,maxHttpBytes:remainingBytes,maxWsBytes:remainingBytes,maxCombinedBytes:remainingBytes,maxCumulativeBytes:this.initial.bytes+this.responseBytes,minSpacingMs:250,maxStartsPerMinute:60,maxStartsPer10s:this.startsPer10s},now:this.now,monotonic:this.mono,sleep:this.options.sleep,record:(kind,data)=>{
      this.trackMethodStart(kind,data);
      if(kind==='http-headers'){const h=data as {status:number;retryAfter:unknown;at:number};if(h.status===429)this.pendingRetryAfter=retryAfter(h.retryAfter,h.at);}
      this.emit(kind,data);
    }});
    this.transport=new ComponentTransport(this.budget,(kind,data)=>{
      if(kind==='http-headers'){const h=data as {status:number;retryAfter:unknown;at:number};if(h.status===429)this.pendingRetryAfter=retryAfter(h.retryAfter,h.at);}
      this.emit(kind,data);
    },()=>{},this.now,this.options.fetcher);this.persist();
  }
  private async perform<T>(work:(options:PilotRpcCallOptions)=>Promise<T>,signal:AbortSignal|undefined,options:PilotRpcCallOptions,domain:'rpc'|'control'):Promise<T>{
    if(signal?.aborted)throw new PilotRpcUnavailable('ABORTED');
    this.openChapter();this.active=true;this.pendingRetryAfter=null;
    try{
      const remaining=Math.floor(this.remainingMs()),timeout=options.timeoutMs??1000;if(!int(timeout)||timeout<1||timeout>1500)throw new PilotRpcUnavailable('INVALID_TIMEOUT');
      const result=await work({...options,timeoutMs:Math.max(1,Math.min(timeout,remaining)),admissionOpen:()=>this.remainingMs()>0&&(!options.admissionOpen||options.admissionOpen())});
      if(domain==='rpc')this.failures=0;return result;
    }catch(error){
      const code=safe(error),u=this.current();
      if(u?.haltedReason){
        const globalFailure=/^COMPONENT_(STORAGE|DIAGNOSTIC|CLOCK|MONOTONIC|RESPONSE_|INVALID_)/.test(u.haltedReason);
        if(domain==='control'&&!globalFailure){
          this.controlFailure=true;this.emit('pilot-data-control-unavailable',{at:this.now(),code:u.haltedReason,controlCooldownUntil:this.controlCooldown,publicRpcCooldownUnchanged:true,physicalSettled:u.inFlight===0,reservationsRetained:u.uncertainResponseBytes});
        }else if(recoverable(u.haltedReason)){
          this.failures++;const backoff=[2000,5000,10000,20000,40000,60000][Math.min(5,this.failures-1)]!,until=code==='COMPONENT_HTTP_429'||u.haltedReason==='COMPONENT_HTTP_429'?this.pendingRetryAfter??this.now()+65000:this.now()+backoff;
          this.cooldown=Math.max(this.cooldown,until);this.cooldownMono=Math.max(this.cooldownMono,this.mono()+Math.max(0,until-this.now()));
          this.emit('pilot-rpc-unavailable',{at:this.now(),code:u.haltedReason,cooldownUntil:this.cooldown,physicalSettled:u.inFlight===0,reservationsRetained:u.uncertainResponseBytes});
        }else if(!['COMPONENT_UNIT_CAP','COMPONENT_TIME_CAP'].includes(u.haltedReason))this.fatal=u.haltedReason;
      }
      throw error instanceof PilotRpcUnavailable?error:new PilotRpcUnavailable(code,this.cooldown||null);
    }finally{this.active=false;try{this.persist();}catch{this.fatal='STORAGE_UNAVAILABLE';throw new PilotRpcUnavailable('STORAGE_UNAVAILABLE');}}
  }
  async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal,options:PilotRpcCallOptions={}):Promise<T>{
    validateRpc({method});if(Buffer.byteLength(JSON.stringify({method,params}))>64000)throw new PilotRpcUnavailable('REQUEST_SIZE');
    if(signal?.aborted)throw new PilotRpcUnavailable('ABORTED');
    if(method==='getTransaction'&&this.transactionStartsPer10s!==undefined){this.check();const at=this.now(),retryAt=this.methodReadyAtClock(method,1,at);if(retryAt>at){this.methodRefusals++;this.emit('pilot-method-capacity-refusal',{at,method,reserveStarts:1,retryAt,maximumStartsPer10s:this.transactionStartsPer10s,knownOrConservativelyInheritedStarts:this.recentMethodStarts(at).length,physicalRequestStarted:false,providerResponse:false});this.persist();throw new PilotRpcUnavailable('METHOD_PACING',retryAt);}}
    return this.perform(o=>this.transport!.call<T>(method,params,signal,o),signal,options,'rpc');
  }
  async operateData<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,signal?:AbortSignal,options:PilotRpcCallOptions={}):Promise<T>{
    if(!(kind.transport==='ws-upgrade'&&kind.method==='upgrade'||kind.transport==='ws'&&kind.method==='subscribeMigration'))throw new PilotRpcUnavailable('DATA_METHOD_DENIED');
    return this.perform(o=>this.budget!.operate(kind,work,signal,o),signal,options,'control');
  }
  /** Control/Portal receipt only. Broad PumpApi traffic has its own feed cap.
   * Receipt remains chargeable while an HTTP slot is occupied or halted. */
  accountControlBytes(bytes:number){
    if(!int(bytes)||bytes>2*MIB)throw new PilotRpcUnavailable('CONTROL_BYTE_CHARGE');
    if(!this.budget||this.closed)throw new PilotRpcUnavailable('CONTROL_WITHOUT_OPEN_CHAPTER');
    try{this.budget.chargePassiveWs(bytes);const u=this.budget.usage();if(u.cumulativeResponseBytes+u.uncertainResponseBytes-this.initial.bytes+2*MIB>this.responseBytes){this.budget.halt('COMPONENT_RESPONSE_RESERVE');throw Error('COMPONENT_RESPONSE_RESERVE');}this.persist();}catch(error){const code=safe(error);if(!['COMPONENT_TIME_CAP','COMPONENT_UNIT_CAP'].includes(code))this.fatal=code;this.persist();throw new PilotRpcUnavailable(code);}
    // The receipt already happened and remains counted even when the global
    // interval has ended. It cannot admit another request or extend that run.
    if(this.remainingMs()<=0)throw new PilotRpcUnavailable('RUN_TIME_CAP');
  }
  chargeDataBytes(bytes:number){this.accountControlBytes(bytes);}
  /** A WS unexpected-response handler must call this before rejecting its
   * existing physical operation. It never starts or retries a request. */
  noteThrottle(value:string|null,at=this.now()){
    if(!int(at)||at>this.now())throw new PilotRpcUnavailable('INVALID_THROTTLE_TIME');
    const until=retryAfter(value,at);this.controlCooldown=Math.max(this.controlCooldown,until);this.persist();return until;
  }
  usage(){
    const u=this.current(),calls=u?.cumulativeUnits??this.baseline.calls,bytes=u?u.cumulativeResponseBytes+u.uncertainResponseBytes:this.baseline.bytes;
    return {runId:this.options.runId,startedAt:this.startedAt,deadlineAt:this.startedAt+this.duration,remainingMs:this.remainingMs(),chapter:this.chapter,chapterPaths:[...this.paths],activeChapterPath:this.budget?join(this.dir,'chapter-'+String(this.chapter).padStart(3,'0')+'.json'):null,cumulativeUnits:calls,newUnits:calls-this.initial.calls,accountedCumulativeResponseBytes:bytes,newAccountedResponseBytes:bytes-this.initial.bytes,maximumNewUnits:this.units,maximumNewResponseBytes:this.responseBytes,requestLimits:{maxStartsPer10s:this.startsPer10s,maxGetTransactionStartsPer10s:this.transactionStartsPer10s??null,maxStartsPerMinute:60,minSpacingMs:250,physicalInFlight:1},methodPacing:{getTransactionStartsLast10s:this.recentMethodStarts().map(r=>({...r})),capacityRefusals:this.methodRefusals,baselineUnknownMethodsCountConservatively:true},inFlight:u?.inFlight??0,waitingOrOperating:this.active||u?.waitingOrOperating===true,uncertainResponseBytes:this.inheritedUncertainty+(u?.uncertainResponseBytes??0),currentChapterUncertainResponseBytes:u?.uncertainResponseBytes??0,inheritedUncertaintyIsRetainedInBaseline:true,cooldownUntil:this.cooldown,controlCooldownUntil:this.controlCooldown,lastFailureWasDataControl:this.controlFailure,closed:this.closed,fatal:this.fatal,chapterUsage:u??null,dispatchWindow:this.budget?.dispatchWindow()??null,automaticRequestRetries:0};
  }
  available(){try{this.check();return true;}catch{return false;}}
  cooldownUntil(){return this.cooldown;}
  close(){if(this.closed)return;if(this.active)throw new PilotRpcUnavailable('PHYSICAL_SLOT_OCCUPIED');this.finishChapter();this.closed=true;this.persist();}
}
