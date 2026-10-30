/** A single linked public-RPC component grant. No endpoint, wallet or transport.
 * The old counterbook/refusal is an immutable baseline, never rewritten here.
 */
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync,writeFileSync,fsyncSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {validateRpc,dataMessage} from './network.js';
import {resolveNativeResearchProfile,type NativeResearchProfile} from './native-research-profile.js';

const MIB=1024*1024;
/** Full cumulative starts stay durable; this bound is shared by every reader. */
export const COMPONENT_COUNTERBOOK_MAX_BYTES=512*1024;
export const COMPONENT_LIMITS=Object.freeze({units:70,totalMs:90_000,starts60s:60,starts10s:30,startGapMs:1000,httpBytes:24*MIB,wsBytes:8*MIB,combinedBytes:32*MIB,cumulativeBytes:64*MIB,httpResponseBytes:2*MIB,physicalHeadroomBytes:2*MIB,wsOperationReserveBytes:64*1024});
export type ComponentBudgetLimits={maxNewUnits:number;maxCumulativeUnits:number|null;maxHttpBytes:number;maxWsBytes:number;maxCombinedBytes:number;maxCumulativeBytes:number|null;minSpacingMs:number;maxStartsPerMinute:number;maxStartsPer10s:number};
export const LEGACY_COMPONENT_BUDGET_LIMITS:Readonly<ComponentBudgetLimits>=Object.freeze({maxNewUnits:70,maxCumulativeUnits:240,maxHttpBytes:24*MIB,maxWsBytes:8*MIB,maxCombinedBytes:32*MIB,maxCumulativeBytes:64*MIB,minSpacingMs:1000,maxStartsPerMinute:60,maxStartsPer10s:30});
export type ComponentBaseline={calls:number;bytes:number;starts:number[];/** A verified checkpoint may omit old pacing starts or durably proved never-invoked allocations. Cumulative calls/bytes and operation IDs never reset. */startHistory?:{schemaVersion:1;omittedStarts:number;retainedSinceAt:number};refusal:'RPC_HTTP_429';refusalAt:number;sha256:string};
export type ComponentKind={transport:'http'|'ws-upgrade'|'ws';method:string};
export type ComponentOperation={id:number;signal:AbortSignal;chargeHttp:(bytes:number)=>void;completeResponse:()=>void};
export type ComponentBudgetOptions={/** Service epoch time/byte boundaries trigger wrapper rollover after current physical work settles, without shortening its caller timeout; per-response payload guards remain hard. */continuousAccounting?:true;profile?:NativeResearchProfile['version'];statePath:string;grantId:string;baseline:ComponentBaseline;/** Derived only from verified linked counterbooks; never changes the canonical allocated baseline or refunds a unit/byte. */knownUninvokedBaselineStarts?:readonly number[];startedAt:number;totalMs?:number;notBefore?:number;/** Explicit per-run limits; null lifetime caps retain cumulative accounting. Historical books require their original limits. */limits?:Partial<ComponentBudgetLimits>;now?:()=>number;monotonic?:()=>number;sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;record?:(kind:string,data:unknown)=>void;/** Offline durability-latency injection; never configured by the live harness. */beforePersist?:()=>void};
type Pending={id:number;transport:ComponentKind['transport'];reservedBytes:number};
export const COMPONENT_RECEIPT_ACCOUNTING=Object.freeze({version:'durable-receipt-reservation-v1',maximumPassiveReservationBytes:4*MIB,maximumAcceptedReceiptBytes:2*MIB,minimumPassiveTailBytes:2*MIB,maximumScheduledFlushMs:1000});
export type ComponentByteAccounting={version:typeof COMPONENT_RECEIPT_ACCOUNTING.version;reservedBytes:number;uncertainBytes:number};
/** A crash tail is capacity reserved durably before receipt, never invented measured bytes. */
export function componentByteAccounting(book:{schemaVersion?:unknown;continuousAccounting?:unknown;byteAccounting?:unknown}):ComponentByteAccounting|null{
 if(book.schemaVersion===1){need(book.byteAccounting===undefined,'COMPONENT_INVALID_BYTE_ACCOUNTING');return null;}
 const a=book.byteAccounting as ComponentByteAccounting|undefined;need(book.schemaVersion===2&&book.continuousAccounting===true&&a&&Object.keys(a).sort().join('|')==='reservedBytes|uncertainBytes|version'&&a.version===COMPONENT_RECEIPT_ACCOUNTING.version&&integer(a.reservedBytes)&&a.reservedBytes<=COMPONENT_RECEIPT_ACCOUNTING.maximumPassiveReservationBytes&&integer(a.uncertainBytes)&&integer(a.reservedBytes+a.uncertainBytes),'COMPONENT_INVALID_BYTE_ACCOUNTING');return a;
}
export const COMPONENT_KNOWN_UNINVOKED_KIND='component-known-uninvoked-before-transport-v1' as const;
const knownUninvokedReasons=['COMPONENT_ADMISSION_CLOSED','COMPONENT_DISPATCH_EXPIRED','COMPONENT_ABORTED'] as const;
export type ComponentKnownUninvoked={kind:typeof COMPONENT_KNOWN_UNINVOKED_KIND;id:number;attestedAt:number;reasonCode:typeof knownUninvokedReasons[number]};
type State={schemaVersion:1|2;byteAccounting?:ComponentByteAccounting;continuousAccounting?:true;profile?:NativeResearchProfile['version'];grantId:string;baseline:ComponentBaseline;startedAt:number;totalMs?:number;limits?:ComponentBudgetLimits;deadlineAt:number;lastObservedAt:number;starts:number[];actualInvocations:Array<{id:number;at:number}>;knownUninvokedReservations?:ComponentKnownUninvoked[];byOperation:Record<string,number>;httpBytes:number;wsBytes:number;pending:Pending[];haltedReason:string|null;durationsMs:number[]};
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function need(v:unknown,code:string):asserts v {if(!v)throw Error(code);}
/** Optional proof never authorizes an operation or refunds accounting. Invalid,
 * absent, conflicting or ambiguous records retain the conservative old path. */
export function componentKnownUninvokedReservations(book:{baseline?:unknown;starts?:unknown;actualInvocations?:unknown;pending?:unknown;lastObservedAt?:unknown;knownUninvokedReservations?:unknown}):ComponentKnownUninvoked[]{
 try{
  const rows=book.knownUninvokedReservations,base=book.baseline as {calls?:unknown}|null;
  if(rows===undefined)return [];
  if(!Array.isArray(rows)||!Array.isArray(book.starts)||!Array.isArray(book.actualInvocations)||!Array.isArray(book.pending)||!base||!integer(base.calls)||!integer(book.lastObservedAt)||rows.length>book.starts.length||!book.starts.every(integer))return [];
  const starts=book.starts as number[],actual=book.actualInvocations as Array<{id?:unknown;at?:unknown}>,pending=book.pending as Array<{id?:unknown;transport?:unknown;reservedBytes?:unknown}>;
  if(!actual.every(r=>r&&integer(r.id)&&integer(r.at)))return [];
  const ids=new Set<number>(),out:ComponentKnownUninvoked[]=[];
  for(const value of rows){
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!=='attestedAt|id|kind|reasonCode')return [];
   const r=value as ComponentKnownUninvoked,index=r.id-base.calls-1,p=pending.find(p=>p?.id===r.id);
   if(r.kind!==COMPONENT_KNOWN_UNINVOKED_KIND||!integer(r.id)||index<0||index>=starts.length||ids.has(r.id)||!integer(r.attestedAt)||r.attestedAt<starts[index]!||r.attestedAt>book.lastObservedAt||!knownUninvokedReasons.includes(r.reasonCode)||actual.some(a=>a.id===r.id)||!p||!['http','ws','ws-upgrade'].includes(String(p.transport))||p.reservedBytes!==(p.transport==='http'?2*MIB:64*1024))return [];
   ids.add(r.id);out.push({...r});
  }
  return out;
 }catch{return [];}
}
/** The canonical baseline still contains every allocated start. Subtract only
 * the verified timestamp multiset supplied by its read-only chain verifier. */
export function componentPacingBaselineStarts(baseline:Pick<ComponentBaseline,'starts'>,known:readonly number[]=[]):number[]{
 const counts=new Map<number,number>();for(const at of baseline.starts)counts.set(at,(counts.get(at)??0)+1);
 if(!Array.isArray(known)||known.length>baseline.starts.length||known.some(at=>!integer(at)||(counts.set(at,(counts.get(at)??0)-1),counts.get(at)!<0)))return [...baseline.starts];
 const excluded=new Map<number,number>();for(const at of known)excluded.set(at,(excluded.get(at)??0)+1);
 return baseline.starts.filter(at=>{const n=excluded.get(at)??0;if(!n)return true;excluded.set(at,n-1);return false;});
}
function normalizedLimits(input:Partial<ComponentBudgetLimits>|undefined,profile?:NativeResearchProfile['version']):ComponentBudgetLimits{
  const extended=resolveNativeResearchProfile(profile),maximumCombinedBytes=extended?.relatedResponseBytes??256*MIB;
  need(input===undefined||input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>Object.hasOwn(LEGACY_COMPONENT_BUDGET_LIMITS,k)),'COMPONENT_INVALID_LIMITS');
  const l={...LEGACY_COMPONENT_BUDGET_LIMITS,...input};
  need(integer(l.maxNewUnits)&&l.maxNewUnits>=1&&l.maxNewUnits<=1000&&[l.maxCumulativeUnits,l.maxCumulativeBytes].every(n=>n===null||integer(n)&&n>=1),'COMPONENT_INVALID_LIMITS');
  need([l.maxHttpBytes,l.maxWsBytes,l.maxCombinedBytes].every(integer)&&l.maxCombinedBytes>=1&&l.maxCombinedBytes<=maximumCombinedBytes&&l.maxHttpBytes<=l.maxCombinedBytes&&l.maxWsBytes<=l.maxCombinedBytes,'COMPONENT_INVALID_LIMITS');
  need(integer(l.minSpacingMs)&&l.minSpacingMs>=1&&l.minSpacingMs<=60000&&integer(l.maxStartsPerMinute)&&l.maxStartsPerMinute>=1&&l.maxStartsPerMinute<=600&&integer(l.maxStartsPer10s)&&l.maxStartsPer10s>=1&&l.maxStartsPer10s<=100&&l.maxStartsPer10s<=l.maxStartsPerMinute,'COMPONENT_INVALID_LIMITS');
  return l;
}
const within=(value:number,cap:number|null)=>integer(value)&&(cap===null||value<=cap);
function pause(ms:number,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)return Promise.reject(Error('COMPONENT_ABORTED'));
  return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('COMPONENT_ABORTED'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});
}
const operationKey=(kind:ComponentKind)=>kind.transport+':'+kind.method;
function validateKind(kind:ComponentKind){
  need(kind&&['http','ws','ws-upgrade'].includes(kind.transport),'COMPONENT_OPERATION_DENIED');
  if(kind.transport==='http')validateRpc({method:kind.method});
  else if(kind.transport==='ws'&&['subscribeMigration','subscribeNewToken'].includes(kind.method))dataMessage(kind.method);
  else need(kind.transport==='ws-upgrade'?kind.method==='upgrade':['accountSubscribe','accountUnsubscribe','logsSubscribe','logsUnsubscribe','ping','pong','close'].includes(kind.method),'COMPONENT_OPERATION_DENIED');
}
const errorCode=(e:unknown)=>{const m=e instanceof Error?e.message:'';return /^COMPONENT_[A-Z0-9_:-]{1,100}$/.test(m)?m:'COMPONENT_OPERATION_FAILED';};

/** Caller owns one dispatcher. This gate paces actual starts; it never queues
 * or retries an operation. Notifications charge bytes without taking a request
 * slot. A caller-facing abort does not release a physical operation's slot.
 */
export class ComponentBudget {
  private readonly path:string;private readonly lease:number;private readonly now:()=>number;private readonly mono:()=>number;private readonly sleep:(ms:number,signal?:AbortSignal)=>Promise<void>;
  private readonly notBefore:number;private readonly totalMs:number;private readonly beforePersist:(()=>void)|undefined;private state:State;private active=0;private busy=false;private closed=false;private storageFailed=false;private lastStartMono:number|null=null;private readonly resumedMono:number;
  private byteFlushTimer:ReturnType<typeof setTimeout>|null=null;private byteDirtyMono:number|null=null;
  private readonly receiptPersistence={passiveReceipts:0,passiveBytes:0,coalescedReceipts:0,reservations:0,timerFlushes:0,maximumDirtyAgeMs:0};
  private currentController:AbortController|null=null;private readonly persistence={attempts:0,totalMs:0,maximumMs:0};
  private readonly record:NonNullable<ComponentBudgetOptions['record']>;
  private readonly limits:ComponentBudgetLimits;
  private readonly knownUninvokedBaselineStarts:readonly number[];
  private readonly durableKnownUninvoked=new Set<number>();
  constructor(options:ComponentBudgetOptions){
    this.path=resolve(options.statePath);this.now=options.now??Date.now;this.mono=options.monotonic??(()=>performance.now());this.sleep=options.sleep??pause;this.beforePersist=options.beforePersist;this.record=options.record??(()=>{});this.resumedMono=this.monotonic();this.notBefore=options.notBefore??0;this.totalMs=options.totalMs??COMPONENT_LIMITS.totalMs;
    need(options.continuousAccounting===undefined||options.continuousAccounting===true,'COMPONENT_INVALID_OPERATING_MODE');this.limits=normalizedLimits(options.limits,options.profile);if(options.continuousAccounting)need(this.limits.maxCumulativeUnits===null&&this.limits.maxCumulativeBytes===null,'COMPONENT_OPERATING_LIFETIME_CAP');
    need(integer(this.totalMs)&&this.totalMs>=1&&this.totalMs<=600000,'COMPONENT_INVALID_DURATION');
    const b=options.baseline;need(b&&within(b.calls,this.limits.maxCumulativeUnits)&&within(b.bytes,this.limits.maxCumulativeBytes)&&Array.isArray(b.starts)&&(b.startHistory===undefined?b.starts.length===b.calls:b.startHistory&&Object.keys(b.startHistory).length===3&&b.startHistory.schemaVersion===1&&integer(b.startHistory.omittedStarts)&&integer(b.startHistory.retainedSinceAt)&&b.startHistory.retainedSinceAt<=Math.max(0,options.startedAt-60000)&&b.starts.length+b.startHistory.omittedStarts===b.calls&&b.starts.every(t=>t>=b.startHistory!.retainedSinceAt))&&b.starts.every((t,i)=>integer(t)&&(i===0||t>=b.starts[i-1]!))&&b.refusal==='RPC_HTTP_429'&&integer(b.refusalAt)&&/^[a-f0-9]{64}$/.test(b.sha256),'COMPONENT_INVALID_BASELINE');
    const physicalBaseline=componentPacingBaselineStarts(b,options.knownUninvokedBaselineStarts),physicalCounts=new Map<number,number>();for(const at of physicalBaseline)physicalCounts.set(at,(physicalCounts.get(at)??0)+1);this.knownUninvokedBaselineStarts=b.starts.filter(at=>{const n=physicalCounts.get(at)??0;if(!n)return true;physicalCounts.set(at,n-1);return false;});
    need(/^[a-z0-9-]{1,100}$/.test(options.grantId)&&integer(options.startedAt)&&integer(this.notBefore)&&b.refusalAt<=options.startedAt&&b.starts.every(t=>t<=options.startedAt),'COMPONENT_INVALID_GRANT');
    const dir=lstatSync(dirname(this.path));need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.getuid?.()&&(dir.mode&0o022)===0,'COMPONENT_UNSAFE_DIRECTORY');
    this.lease=openSync(this.path+'.lock',constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
    try{
      const lock=fstatSync(this.lease);need(lock.isFile()&&lock.nlink===1&&lock.uid===process.getuid?.()&&(lock.mode&0o077)===0,'COMPONENT_UNSAFE_LOCK');
      const lease=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',this.lease],timeout:5000});need(!lease.error&&lease.status===0,'COMPONENT_BUDGET_OWNED');
      let saved:State|undefined;
      try{const file=lstatSync(this.path);need(file.isFile()&&!file.isSymbolicLink()&&file.nlink===1&&file.uid===process.getuid?.()&&(file.mode&0o077)===0&&file.size<=COMPONENT_COUNTERBOOK_MAX_BYTES,'COMPONENT_UNSAFE_STATE');saved=JSON.parse(readFileSync(this.path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const priorPassiveTail=saved?.schemaVersion===2?saved.byteAccounting?.reservedBytes??0:0;
      this.state=saved??{schemaVersion:options.continuousAccounting?2:1,...(options.continuousAccounting?{continuousAccounting:true as const,byteAccounting:{version:COMPONENT_RECEIPT_ACCOUNTING.version,reservedBytes:COMPONENT_RECEIPT_ACCOUNTING.maximumPassiveReservationBytes,uncertainBytes:0}}:{}),...(options.profile===undefined?{}:{profile:options.profile}),grantId:options.grantId,baseline:structuredClone(b),startedAt:options.startedAt,totalMs:this.totalMs,...(options.limits===undefined?{}:{limits:structuredClone(this.limits)}),deadlineAt:options.startedAt+this.totalMs,lastObservedAt:this.now(),starts:[],actualInvocations:[],byOperation:{},httpBytes:0,wsBytes:0,pending:[],haltedReason:null,durationsMs:[]};
      need((this.state.continuousAccounting??false)===(options.continuousAccounting??false),'COMPONENT_OPERATING_MODE_CONFLICT');need((this.state.profile??null)===(options.profile??null),'COMPONENT_PROFILE_CONFLICT');
      need(JSON.stringify(normalizedLimits(this.state.limits,options.profile))===JSON.stringify(this.limits),'COMPONENT_LIMITS_CONFLICT');
      need(this.state.grantId===options.grantId&&JSON.stringify(this.state.baseline)===JSON.stringify(b)&&this.state.startedAt===options.startedAt,'COMPONENT_BASELINE_OR_GRANT_CONFLICT');this.validate();this.clock();for(const r of componentKnownUninvokedReservations(this.state))this.durableKnownUninvoked.add(r.id);let changed=!saved;if(options.continuousAccounting&&this.state.schemaVersion===1){this.state.schemaVersion=2;this.state.byteAccounting={version:COMPONENT_RECEIPT_ACCOUNTING.version,reservedBytes:COMPONENT_RECEIPT_ACCOUNTING.maximumPassiveReservationBytes,uncertainBytes:0};changed=true;}const accounting=this.state.byteAccounting;if(accounting&&saved){accounting.uncertainBytes+=priorPassiveTail;need(integer(accounting.uncertainBytes),'COMPONENT_INVALID_BYTE_ACCOUNTING');accounting.reservedBytes=COMPONENT_RECEIPT_ACCOUNTING.maximumPassiveReservationBytes;changed=true;}if(changed)this.persist();
    }catch(e){closeSync(this.lease);throw e;}
  }
  private monotonic(){const n=this.mono();need(Number.isFinite(n)&&n>=0,'COMPONENT_MONOTONIC_CLOCK');return n;}
  private clock(){const at=this.now();need(integer(at)&&at>=this.state.lastObservedAt,'COMPONENT_CLOCK_REGRESSION');this.state.lastObservedAt=at;return at;}
  private validate(){
    const s=this.state;componentByteAccounting(s);need([1,2].includes(s?.schemaVersion)&&integer(s.lastObservedAt)&&s.lastObservedAt>=s.startedAt&&(s.totalMs??COMPONENT_LIMITS.totalMs)===this.totalMs&&s.deadlineAt===s.startedAt+this.totalMs&&Array.isArray(s.starts)&&s.starts.length<=this.limits.maxNewUnits&&within(s.baseline.calls+s.starts.length,this.limits.maxCumulativeUnits)&&s.starts.every((t,i)=>integer(t)&&t>=s.startedAt&&t<=s.lastObservedAt&&(i===0||t>=s.starts[i-1]!+this.limits.minSpacingMs)),'COMPONENT_INVALID_STATE');
    need(Array.isArray(s.actualInvocations)&&s.actualInvocations.length<=s.starts.length&&s.actualInvocations.every((r,i)=>integer(r.id)&&r.id>s.baseline.calls&&r.id<=s.baseline.calls+s.starts.length&&integer(r.at)&&r.at>=s.starts[r.id-s.baseline.calls-1]!&&r.at<=s.lastObservedAt&&(i===0||r.id>s.actualInvocations[i-1]!.id&&r.at>=s.actualInvocations[i-1]!.at+this.limits.minSpacingMs)),'COMPONENT_INVALID_INVOCATIONS');
    need(integer(s.httpBytes)&&integer(s.wsBytes)&&(s.continuousAccounting===true||s.httpBytes<=this.limits.maxHttpBytes+COMPONENT_LIMITS.httpResponseBytes&&s.wsBytes<=this.limits.maxWsBytes+65536),'COMPONENT_INVALID_BYTES');
    need(s.byOperation&&typeof s.byOperation==='object'&&Object.keys(s.byOperation).length<=20&&Object.values(s.byOperation).every(integer)&&Object.values(s.byOperation).reduce((n,x)=>n+x,0)===s.starts.length,'COMPONENT_INVALID_OPERATIONS');
    for(const key of Object.keys(s.byOperation)){const [transport,method,...rest]=key.split(':');need(rest.length===0,'COMPONENT_INVALID_OPERATIONS');try{validateKind({transport:transport as ComponentKind['transport'],method:method!});}catch{throw Error('COMPONENT_INVALID_OPERATIONS');}}
    need(Array.isArray(s.pending)&&s.pending.length<=s.starts.length&&s.pending.every((p,i)=>integer(p.id)&&p.id>s.baseline.calls&&p.id<=s.baseline.calls+s.starts.length&&['http','ws','ws-upgrade'].includes(p.transport)&&integer(p.reservedBytes)&&p.reservedBytes<=2*MIB&&s.pending.findIndex(q=>q.id===p.id)===i),'COMPONENT_INVALID_PENDING');
    need(s.haltedReason===null||/^COMPONENT_[A-Z0-9_:-]{1,100}$/.test(s.haltedReason),'COMPONENT_INVALID_HALT');need(Array.isArray(s.durationsMs)&&s.durationsMs.length<=this.limits.maxNewUnits&&s.durationsMs.every(x=>Number.isFinite(x)&&x>=0),'COMPONENT_INVALID_DURATIONS');
  }
  private persist(){
    const persistedAt=performance.now();this.persistence.attempts++;if(this.byteFlushTimer!==null){clearTimeout(this.byteFlushTimer);this.byteFlushTimer=null;}if(this.byteDirtyMono!==null)this.receiptPersistence.maximumDirtyAgeMs=Math.max(this.receiptPersistence.maximumDirtyAgeMs,Math.max(0,this.monotonic()-this.byteDirtyMono));const tmp=this.path+'.pending-'+process.pid;let fd:number|undefined,created=false;
    try{this.beforePersist?.();const encoded=JSON.stringify(this.state)+'\n';need(Buffer.byteLength(encoded)<=COMPONENT_COUNTERBOOK_MAX_BYTES,'COMPONENT_STATE_SIZE');fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;writeFileSync(fd,encoded);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(tmp,this.path);created=false;this.byteDirtyMono=null;const parent=openSync(dirname(this.path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}}
    catch{this.storageFailed=true;if(fd!==undefined)try{closeSync(fd);}catch{}if(created)try{unlinkSync(tmp);}catch{}throw Error('COMPONENT_STORAGE_UNAVAILABLE');}
    finally{const elapsed=Math.max(0,performance.now()-persistedAt);this.persistence.totalMs+=elapsed;this.persistence.maximumMs=Math.max(this.persistence.maximumMs,elapsed);}
  }
  private ready(){need(!this.closed,'COMPONENT_CLOSED');need(!this.storageFailed,'COMPONENT_STORAGE_UNAVAILABLE');need(!this.state.haltedReason,'COMPONENT_HALTED');}
  get calls(){return this.state.baseline.calls+this.state.starts.length;}get newUnits(){return this.state.starts.length;}get bytes(){return this.state.baseline.bytes+this.state.httpBytes+this.state.wsBytes;}get inFlight(){return this.active;}
  private effectiveStarts(){const actual=new Map(this.state.actualInvocations.map(r=>[r.id,r.at]));return [...componentPacingBaselineStarts(this.state.baseline,this.knownUninvokedBaselineStarts),...this.state.starts.flatMap((at,i)=>{const id=this.state.baseline.calls+i+1;return this.durableKnownUninvoked.has(id)?[]:[actual.get(id)??at];})];}
  private attestKnownUninvoked(id:number,reasonCode:string){
    if(!knownUninvokedReasons.includes(reasonCode as ComponentKnownUninvoked['reasonCode'])||this.storageFailed||this.state.actualInvocations.some(r=>r.id===id))return;
    const prior=this.state.knownUninvokedReservations,valid=componentKnownUninvokedReservations(this.state);if(prior!==undefined&&(!Array.isArray(prior)||valid.length!==prior.length))return;
    this.state.knownUninvokedReservations=[...(prior??[]),{kind:COMPONENT_KNOWN_UNINVOKED_KIND,id,attestedAt:this.clock(),reasonCode:reasonCode as ComponentKnownUninvoked['reasonCode']}];
    try{this.persist();}catch(error){if(prior===undefined)delete this.state.knownUninvokedReservations;else this.state.knownUninvokedReservations=prior;throw error;}
    this.durableKnownUninvoked.add(id);
  }
  /** An observation of the SAME gate; does not reserve, queue or charge work. */
  dispatchWindow(){
    const now=this.clock(),starts=this.effectiveStarts(),short=starts.filter(t=>t>now-10000),minute=starts.filter(t=>t>now-60000),last=starts.at(-1),mono=this.monotonic(),origin=this.lastStartMono??(this.state.starts.length?this.resumedMono:null);
    const l=this.limits,wait=Math.ceil(Math.max(0,this.notBefore-now,last===undefined?0:last+l.minSpacingMs-now,origin===null?0:origin+l.minSpacingMs-mono,short.length>=l.maxStartsPer10s?short[short.length-l.maxStartsPer10s]!+10000-now:0,minute.length>=l.maxStartsPerMinute?minute[minute.length-l.maxStartsPerMinute]!+60000-now:0));
    return {readyAt:now+wait,waitMs:wait,physicalBusy:this.active!==0||this.busy||this.state.pending.length!==0,haltedReason:this.state.haltedReason};
  }
  usage(){
    const now=this.clock(),starts=this.effectiveStarts(),short=starts.filter(t=>t>now-10000),minute=starts.filter(t=>t>now-60000),reserved=this.state.pending.reduce((n,p)=>n+p.reservedBytes,0);
    return {continuousAccounting:this.state.continuousAccounting===true,byteAccounting:this.state.byteAccounting?{...this.state.byteAccounting,policy:COMPONENT_RECEIPT_ACCOUNTING,pendingDirtyAgeMs:this.byteDirtyMono===null?0:Math.max(0,this.monotonic()-this.byteDirtyMono),...this.receiptPersistence}:null,persistence:{...this.persistence},grantId:this.state.grantId,limits:{...this.limits},baseline:structuredClone(this.state.baseline),cumulativeUnits:this.calls,newUnits:this.newUnits,actualInvokedUnits:this.state.actualInvocations.length,provenUninvokedCurrentUnits:this.durableKnownUninvoked.size,provenUninvokedBaselineUnits:this.knownUninvokedBaselineStarts.length,knownUninvokedReservations:componentKnownUninvokedReservations(this.state).filter(r=>this.durableKnownUninvoked.has(r.id)),cumulativeResponseBytes:this.bytes,httpBytes:this.state.httpBytes,wsBytes:this.state.wsBytes,newResponseBytes:this.state.httpBytes+this.state.wsBytes,remainingGrantUnits:this.limits.maxNewUnits-this.newUnits,remainingCumulativeUnits:this.limits.maxCumulativeUnits===null?null:this.limits.maxCumulativeUnits-this.calls,remainingGrantResponseBytes:Math.max(0,this.limits.maxCombinedBytes-this.state.httpBytes-this.state.wsBytes-reserved),remainingCumulativeResponseBytes:this.limits.maxCumulativeBytes===null?null:Math.max(0,this.limits.maxCumulativeBytes-this.bytes-reserved),pending:structuredClone(this.state.pending),uncertainResponseBytes:reserved+(this.state.byteAccounting?.uncertainBytes??0),rolling60SecondStarts:minute.length,rolling10SecondStarts:short.length,starts:this.state.actualInvocations.map(r=>r.at),actualInvocations:structuredClone(this.state.actualInvocations),reservationStarts:[...this.state.starts],byOperation:{...this.state.byOperation},durationsMs:[...this.state.durationsMs],inFlight:this.active,waitingOrOperating:this.busy,haltedReason:this.state.haltedReason,startedAt:this.state.startedAt,totalMs:this.totalMs,deadlineAt:this.state.deadlineAt,closed:this.closed,storageFailed:this.storageFailed};
  }
  halt(reason:string){need(/^COMPONENT_[A-Z0-9_:-]{1,100}$/.test(reason),'COMPONENT_INVALID_HALT');if(!this.state.haltedReason){this.state.haltedReason=reason;this.clock();this.persist();}this.currentController?.abort();}
  /** Charge measured WebSocket receipt once, before payload parsing. Caller
   * separately stops at7MiB socket/6MiB application to retain in-flight room. */
  chargeWs(n:number){this.chargeWsReceipt(n,true);}
  /** Existing pilot sockets can receive after a short accounting chapter ends.
   * Charge those bytes without extending admission: operate() still refuses all
   * starts at/after deadline. The pilot separately enforces its global duration. */
  chargePassiveWs(n:number){this.chargeWsReceipt(n,false);}
  private chargeWsReceipt(n:number,enforceChapterDeadline:boolean){
    need(!this.closed&&!this.storageFailed,'COMPONENT_CLOSED');need(integer(n)&&n<=COMPONENT_LIMITS.httpResponseBytes,'COMPONENT_INVALID_BYTE_CHARGE');
    const accounting=this.state.byteAccounting;if(accounting&&n){need(accounting.reservedBytes>=n,'COMPONENT_PASSIVE_RESERVATION_UNAVAILABLE');this.receiptPersistence.passiveReceipts++;this.receiptPersistence.passiveBytes+=n;accounting.reservedBytes-=n;this.state.wsBytes+=n;this.clock();if(accounting.reservedBytes<COMPONENT_RECEIPT_ACCOUNTING.minimumPassiveTailBytes){const remaining=accounting.reservedBytes;accounting.reservedBytes=COMPONENT_RECEIPT_ACCOUNTING.maximumPassiveReservationBytes;this.receiptPersistence.reservations++;try{this.persist();}catch(error){accounting.reservedBytes=remaining;throw error;}}else this.deferReceiptFlush();}else{this.state.wsBytes+=n;this.clock();if(!accounting)this.persist();}
    if(enforceChapterDeadline&&this.state.lastObservedAt>=this.state.deadlineAt){this.halt('COMPONENT_TIME_CAP');throw Error('COMPONENT_TIME_CAP');}
    if(!this.state.continuousAccounting&&(this.state.wsBytes>this.limits.maxWsBytes||this.state.httpBytes+this.state.wsBytes>this.limits.maxCombinedBytes||!within(this.bytes,this.limits.maxCumulativeBytes))){this.halt('COMPONENT_RESPONSE_BYTE_CAP');throw Error('COMPONENT_RESPONSE_BYTE_CAP');}
  }
  /** Exact observed counts stay in RAM; a bounded already-durable tail covers
   * every accepted receipt until this coalesced checkpoint. Timer lateness never
   * releases that reservation or presents its uncertain bytes as measured. */
  private deferReceiptFlush(){
    this.receiptPersistence.coalescedReceipts++;if(this.byteDirtyMono===null)this.byteDirtyMono=this.monotonic();if(this.byteFlushTimer!==null)return;
    this.byteFlushTimer=setTimeout(()=>{this.byteFlushTimer=null;if(this.closed||this.storageFailed)return;this.receiptPersistence.timerFlushes++;try{this.clock();this.persist();}catch{this.state.haltedReason='COMPONENT_STORAGE_UNAVAILABLE';this.currentController?.abort();try{this.record('component-storage-flush-unavailable',{at:this.now(),code:'COMPONENT_STORAGE_UNAVAILABLE',durableCrashReservationRetained:true});}catch{}}},COMPONENT_RECEIPT_ACCOUNTING.maximumScheduledFlushMs);this.byteFlushTimer.unref();
  }
  async operate<T>(kind:ComponentKind,work:(context:ComponentOperation)=>Promise<T>,outer?:AbortSignal,options:{timeoutMs?:number;latestStartAt?:number;admissionOpen?:()=>boolean}={}):Promise<T>{
    validateKind(kind);need(!this.busy,'COMPONENT_DISPATCH_BUSY');if(outer?.aborted)throw Error('COMPONENT_ABORTED');this.ready();need(this.active===0,'COMPONENT_PHYSICAL_SLOT_OCCUPIED');need(this.state.pending.length===0,'COMPONENT_UNCERTAIN_PRIOR_OPERATION');
    const timeout=options.timeoutMs??5000;need(integer(timeout)&&timeout>0&&timeout<=12000,'COMPONENT_INVALID_TIMEOUT');need(options.latestStartAt===undefined||integer(options.latestStartAt),'COMPONENT_INVALID_START_DEADLINE');need(options.admissionOpen===undefined||typeof options.admissionOpen==='function','COMPONENT_INVALID_ADMISSION');this.busy=true;
    const enqueuedAt=this.clock();
    let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined,abortListener:(()=>void)|undefined;
    try{
      this.record('component-job-enqueued',{at:enqueuedAt,kind,latestStartAt:options.latestStartAt??null});
      for(;;){
        if(outer?.aborted)throw Error('COMPONENT_ABORTED');if(options.admissionOpen&&!options.admissionOpen())throw Error('COMPONENT_ADMISSION_CLOSED');this.ready();const now=this.clock();if(now>=this.state.deadlineAt){this.halt('COMPONENT_TIME_CAP');throw Error('COMPONENT_TIME_CAP');}
        const starts=this.effectiveStarts(),short=starts.filter(t=>t>now-10000),minute=starts.filter(t=>t>now-60000),last=starts.at(-1),mono=this.monotonic();
        const monoOrigin=this.lastStartMono??(this.state.starts.length?this.resumedMono:null);
        const l=this.limits,wait=Math.ceil(Math.max(0,this.notBefore-now,last===undefined?0:last+l.minSpacingMs-now,monoOrigin===null?0:monoOrigin+l.minSpacingMs-mono,short.length>=l.maxStartsPer10s?short[short.length-l.maxStartsPer10s]!+10000-now:0,minute.length>=l.maxStartsPerMinute?minute[minute.length-l.maxStartsPerMinute]!+60000-now:0));
        if(options.latestStartAt!==undefined&&now+wait>options.latestStartAt)throw Error('COMPONENT_DISPATCH_EXPIRED');
        if(!wait)break;this.record('component-pacing-wait',{at:now,waitMs:wait,kind});await this.sleep(Math.min(wait,this.state.deadlineAt-now),outer);need(this.monotonic()>mono||outer?.aborted,'COMPONENT_CLOCK_DID_NOT_ADVANCE');
      }
      if(outer?.aborted)throw Error('COMPONENT_ABORTED');this.ready();if(!(this.newUnits<this.limits.maxNewUnits&&within(this.calls+1,this.limits.maxCumulativeUnits))){this.halt('COMPONENT_UNIT_CAP');throw Error('COMPONENT_UNIT_CAP');}
      const reserve=kind.transport==='http'?2*MIB:64*1024,pendingBytes=this.state.pending.reduce((n,p)=>n+p.reservedBytes,0);
      if(!this.state.continuousAccounting&&!((kind.transport==='http'?this.state.httpBytes+reserve+2*MIB<=this.limits.maxHttpBytes:this.state.wsBytes+reserve<=this.limits.maxWsBytes)&&this.state.httpBytes+this.state.wsBytes+pendingBytes+reserve+2*MIB<=this.limits.maxCombinedBytes&&within(this.bytes+pendingBytes+reserve+2*MIB,this.limits.maxCumulativeBytes))){this.halt('COMPONENT_RESPONSE_RESERVE');throw Error('COMPONENT_RESPONSE_RESERVE');}
      if(options.admissionOpen&&!options.admissionOpen())throw Error('COMPONENT_ADMISSION_CLOSED');const at=this.clock();if(options.latestStartAt!==undefined&&at>options.latestStartAt)throw Error('COMPONENT_DISPATCH_EXPIRED');if(at>=this.state.deadlineAt){this.halt('COMPONENT_TIME_CAP');throw Error('COMPONENT_TIME_CAP');}
      const id=this.calls+1,pending:Pending={id,transport:kind.transport,reservedBytes:reserve};this.state.starts.push(at);this.state.byOperation[operationKey(kind)]=(this.state.byOperation[operationKey(kind)]??0)+1;this.state.pending.push(pending);this.persist();this.active++;
      const began=this.monotonic();controller=new AbortController();this.currentController=controller;const signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal;let complete=false,responseBytes=0,invoked=false;
      const chargeHttp=(n:number)=>{need(kind.transport==='http'&&integer(n)&&n<=2*MIB,'COMPONENT_INVALID_BYTE_CHARGE');responseBytes+=n;this.state.httpBytes+=n;pending.reservedBytes=Math.max(0,2*MIB-responseBytes);this.clock();if(!this.state.continuousAccounting||responseBytes>2*MIB)this.persist();if(responseBytes>2*MIB||!this.state.continuousAccounting&&(this.state.httpBytes>this.limits.maxHttpBytes||this.state.httpBytes+this.state.wsBytes>this.limits.maxCombinedBytes||!within(this.bytes,this.limits.maxCumulativeBytes))){this.halt('COMPONENT_RESPONSE_BYTE_CAP');throw Error('COMPONENT_RESPONSE_BYTE_CAP');}};
      const operation=Promise.resolve().then(async()=>{
        signal.throwIfAborted();if(options.admissionOpen&&!options.admissionOpen())throw Error('COMPONENT_ADMISSION_CLOSED');const invokedAt=this.clock();if(options.latestStartAt!==undefined&&invokedAt>options.latestStartAt)throw Error('COMPONENT_DISPATCH_EXPIRED');if(invokedAt>=this.state.deadlineAt){this.halt('COMPONENT_TIME_CAP');throw Error('COMPONENT_TIME_CAP');}
        // Reservation is already durable. Stamp immediately before invoking
        // transport, AFTER variable fsync/rename latency, and persist the actual
        // stamp after invocation. A crash still leaves the conservative pending
        // reservation, which prevents resuming an uncertain operation.
        this.lastStartMono=this.monotonic();this.state.actualInvocations.push({id,at:invokedAt});
        // NOTHING potentially blocking between that stamp and transport.
        // If later persistence/telemetry fails, still await physical settlement.
        invoked=true;const running=work({id,signal,chargeHttp,completeResponse(){complete=true;}});
        let diagnosticFailure=false;
        try{this.persist();this.record('component-physical-start',{id,at:invokedAt,enqueuedAt,reservedAt:at,kind});}catch{diagnosticFailure=true;controller!.abort();}
        try{const result=await running;if(diagnosticFailure)throw Error('COMPONENT_DIAGNOSTIC_FAILURE');return result;}finally{this.persist();}
      }).catch(e=>{
        const message=e instanceof Error?e.message:'';const code=message.includes('429')?'COMPONENT_HTTP_429':message.includes('-32005')?'COMPONENT_RPC_OVERLOAD':signal.aborted?(this.state.haltedReason??'COMPONENT_ABORTED'):errorCode(e);
        if(!invoked)this.attestKnownUninvoked(id,code);this.halt(code);throw Error(code);
      }).finally(()=>{this.active--;if(complete)this.state.pending=this.state.pending.filter(p=>p.id!==id);else pending.reservedBytes=reserve;this.state.durationsMs.push(Math.max(0,this.monotonic()-began));this.clock();this.persist();this.record('component-physical-settled',{id,at:this.now(),responseComplete:complete,kind,uncertainReservedBytes:complete?0:reserve});if(this.currentController===controller)this.currentController=null;});
      try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{
        abortListener=()=>{const code=this.state.haltedReason??'COMPONENT_ABORTED';this.halt(code);reject(Error(code));};signal.addEventListener('abort',abortListener,{once:true});
        // A persistent service chapter is an accounting boundary, not a new
        // caller deadline. Already-admitted work keeps its physical timeout;
        // the wrapper rolls the settled chapter before admitting another start.
        // Bounded research grants retain their hard end-of-grant deadline.
        const timerScheduledAt=this.now(),timerScheduledMono=this.monotonic(),remainingChapterMs=this.state.deadlineAt-this.clock(),timerDelayMs=this.state.continuousAccounting?timeout:Math.max(0,Math.min(timeout,remainingChapterMs));timer=setTimeout(()=>{const observedAt=this.now(),elapsedMonotonicMs=Math.max(0,this.monotonic()-timerScheduledMono),diagnostic={id,at:observedAt,scheduledAt:timerScheduledAt,requestedTimeoutMs:timeout,scheduledDelayMs:timerDelayMs,elapsedMonotonicMs,callbackLatenessMs:Math.max(0,elapsedMonotonicMs-timerDelayMs),kind};this.halt(!this.state.continuousAccounting&&observedAt>=this.state.deadlineAt?'COMPONENT_TIME_CAP':'COMPONENT_PHYSICAL_TIMEOUT');try{this.record('component-physical-timeout',diagnostic);}catch{}},timerDelayMs);if(signal.aborted)abortListener();
      })]);}finally{clearTimeout(timer);if(abortListener)signal.removeEventListener('abort',abortListener);}
    }finally{this.busy=false;}
  }
  close(){need(!this.closed,'COMPONENT_CLOSED');need(!this.busy&&this.active===0,'COMPONENT_PHYSICAL_SLOT_OCCUPIED');if(this.byteFlushTimer!==null){clearTimeout(this.byteFlushTimer);this.byteFlushTimer=null;}try{if(this.state.byteAccounting&&!this.storageFailed){this.state.byteAccounting.reservedBytes=0;this.clock();this.persist();}}finally{this.closed=true;closeSync(this.lease);}}
}
