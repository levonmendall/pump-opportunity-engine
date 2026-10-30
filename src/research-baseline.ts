/** Read-only, explicit ordered counterbook chain. Never opens credentials or
 * edits/refunds a historical grant. Pending reservations require independent
 * confirmation that the prior physical operation/process has settled. */
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,writeFileSync,fsyncSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {COMPONENT_COUNTERBOOK_MAX_BYTES,componentByteAccounting,componentKnownUninvokedReservations,type ComponentBaseline} from './component-budget.js';

const MIB=1024*1024;
/** Explicit finite history runway: at most512 books, each at most512KiB,
 * with an unchanged32MiB aggregate input bound.
 * Callers still default to32 paths; no directory scan, rewrite or refund. */
export const RESEARCH_MAXIMUM_PATHS=512;
export const RESEARCH_MAXIMUM_INPUT_BYTES=32*MIB;
type Book=Record<string,unknown>;
export type ResearchBaselineSource={path:string;sha256:string;incrementUnits:number;incrementObservedBytes:number;pendingReservedBytes:number;inputBytes:number};
export type ResearchBaselineOptions={paths:readonly string[];now:number;/** Manifest-pinned whole-file hash for a sealed checkpoint at paths[0]. */checkpointSha256?:string;physicalSettled?:boolean;/** Standing research explicitly removes only the historical lifetime caps. */allowCumulativeBeyondLegacy?:boolean;/** Bounded explicit chapter list; never searches the filesystem. */maximumPaths?:number};
const int=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function need(v:unknown,code:string):asserts v {if(!v)throw Error('RESEARCH_BASELINE_'+code);}
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const plain=(v:unknown):v is Book=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const exact=(v:Book,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function times(value:unknown,now:number):number[]{need(Array.isArray(value)&&value.every((t,i)=>int(t)&&t<=now&&(i===0||t>=value[i-1])),'INVALID_STARTS');return [...value];}
function readBook(path:string,remainingInputBytes:number){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=fstatSync(fd);need(stat.isFile()&&stat.size>0&&stat.size<=COMPONENT_COUNTERBOOK_MAX_BYTES,'INVALID_FILE');
    need(stat.size<=remainingInputBytes,'AGGREGATE_INPUT_BOUND');
    const buffer=Buffer.alloc(stat.size+1);let length=0;for(;;){const count=readSync(fd,buffer,length,buffer.length-length,length);length+=count;if(!count||length===buffer.length)break;}const after=fstatSync(fd);need(length===stat.size&&after.size===stat.size&&after.mtimeMs===stat.mtimeMs&&after.ctimeMs===stat.ctimeMs,'CHANGED_FILE');const bytes=buffer.subarray(0,length);
    let book:unknown;try{book=JSON.parse(bytes.toString('utf8'));}catch{throw Error('RESEARCH_BASELINE_INVALID_JSON');}
    need(book&&typeof book==='object'&&!Array.isArray(book),'INVALID_BOOK');
    return {book:book as Book,sha256:createHash('sha256').update(bytes).digest('hex'),inputBytes:bytes.length,stat:{uid:stat.uid,mode:stat.mode,nlink:stat.nlink}};
  }finally{closeSync(fd);}
}
function pendingBytes(value:unknown,firstId:number,lastId:number,legacy:boolean){
  need(Array.isArray(value),'INVALID_PENDING');const ids=new Set<number>();let bytes=0;
  for(const raw of value){
    need(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_PENDING');const p=raw as Book;
    const reserve=legacy?p.unobservedBytes:p.reservedBytes;
    need(int(p.id)&&p.id>=firstId&&p.id<=lastId&&!ids.has(p.id)&&int(reserve)&&reserve<=2*MIB,'INVALID_PENDING');
    if(!legacy)need(['http','ws','ws-upgrade'].includes(String(p.transport)),'INVALID_PENDING');
    ids.add(p.id);bytes+=reserve;
  }
  return {bytes,count:ids.size};
}

/** Baseline bytes include each unknown reservation once, in addition to actual
 * observed bytes. A later linked baseline must carry that conservative debit;
 * it is never counted again as a new chapter's observed traffic. */
export function readResearchBaseline(options:ResearchBaselineOptions){
  const maximumPaths=options.maximumPaths??32;
  need(int(maximumPaths)&&maximumPaths>=1&&maximumPaths<=RESEARCH_MAXIMUM_PATHS&&(options.allowCumulativeBeyondLegacy===undefined||typeof options.allowCumulativeBeyondLegacy==='boolean')&&(options.checkpointSha256===undefined||hex(options.checkpointSha256))&&int(options.now)&&Array.isArray(options.paths)&&options.paths.length>0&&options.paths.length<=maximumPaths,'INVALID_OPTIONS');
  const paths=options.paths.map(p=>{need(typeof p==='string'&&p.length>0,'INVALID_PATH');return resolve(p);});
  need(new Set(paths).size===paths.length,'DUPLICATE_PATH');
  const sources:ResearchBaselineSource[]=[],knownUninvokedStarts:number[]=[];let baseline:ComponentBaseline|undefined,observedBytes=0,uncertainResponseBytes=0,pendingOperations=0,lastObservedAt=0,inputBytes=0,checkpointCreatedAt=0;
  for(let index=0;index<paths.length;index++){
    const path=paths[index]!,{book:b,sha256,inputBytes:bookBytes,stat}=readBook(path,RESEARCH_MAXIMUM_INPUT_BYTES-inputBytes);inputBytes+=bookBytes;need(inputBytes<=RESEARCH_MAXIMUM_INPUT_BYTES,'AGGREGATE_INPUT_BOUND');
    need((b.schemaVersion===1||b.schemaVersion===2&&(index===0&&b.kind===RESEARCH_CHECKPOINT_KIND||index>0&&b.continuousAccounting===true))&&int(b.lastObservedAt)&&b.lastObservedAt<=options.now&&b.lastObservedAt>=lastObservedAt,'INVALID_CLOCK');lastObservedAt=b.lastObservedAt;
    if(index===0&&b.kind===RESEARCH_CHECKPOINT_KIND){
      need(stat.uid===process.getuid?.()&&(stat.mode&0o077)===0&&stat.nlink===1,'CHECKPOINT_PRIVATE_OWNER_FILE');need(options.checkpointSha256===sha256,'CHECKPOINT_HASH_MISMATCH');const checkpoint=checkedCheckpoint(b,options.now);checkpointCreatedAt=checkpoint.createdAt;observedBytes=checkpoint.accounted.observedBytes;uncertainResponseBytes=checkpoint.accounted.uncertainResponseBytes;pendingOperations=checkpoint.accounted.pendingOperations;
      baseline={calls:checkpoint.accounted.calls,bytes:checkpoint.accounted.bytes,starts:[...checkpoint.starts.times],startHistory:{schemaVersion:1,omittedStarts:checkpoint.starts.omittedCount,retainedSinceAt:checkpoint.starts.retainedSinceAt},refusal:'RPC_HTTP_429',refusalAt:checkpoint.refusal.at,sha256};
      sources.push({path,sha256,incrementUnits:baseline.calls,incrementObservedBytes:observedBytes,pendingReservedBytes:uncertainResponseBytes,inputBytes:bookBytes});
    }else if(index===0){
      need(options.checkpointSha256===undefined,'CHECKPOINT_ANCHOR_REQUIRED');componentByteAccounting(b);
      need(b.blockedReason==='RPC_HTTP_429'&&int(b.calls)&&int(b.bytes),'INVALID_LEGACY_BOOK');
      const starts=times(b.starts,b.lastObservedAt);need(starts.length===b.calls,'INVALID_LEGACY_CALLS');
      const pending=pendingBytes(b.pending,1,b.calls,true);
      observedBytes=b.bytes;uncertainResponseBytes=pending.bytes;pendingOperations=pending.count;
      baseline={calls:b.calls,bytes:b.bytes+pending.bytes,starts,refusal:'RPC_HTTP_429',refusalAt:b.lastObservedAt,sha256};
      sources.push({path,sha256,incrementUnits:b.calls,incrementObservedBytes:b.bytes,pendingReservedBytes:pending.bytes,inputBytes:bookBytes});
    }else{
      need(baseline,'MISSING_BASELINE');need(b.kind!==RESEARCH_CHECKPOINT_KIND,'CHECKPOINT_MUST_BE_FIRST');const linked=b.baseline as Partial<ComponentBaseline>|undefined;
      need(linked&&linked.calls===baseline.calls&&linked.bytes===baseline.bytes&&linked.refusal===baseline.refusal&&linked.refusalAt===baseline.refusalAt&&linked.sha256===baseline.sha256&&JSON.stringify(linked.starts)===JSON.stringify(baseline.starts)&&JSON.stringify(linked.startHistory)===JSON.stringify(baseline.startHistory),'CHAIN_CONFLICT');
      need(typeof b.grantId==='string'&&int(b.startedAt)&&b.startedAt>=baseline.refusalAt&&b.startedAt>=checkpointCreatedAt&&b.startedAt<=b.lastObservedAt&&int(b.httpBytes)&&int(b.wsBytes),'INVALID_CHAPTER');
      const reserved=times(b.starts,b.lastObservedAt);need(reserved.every(t=>t>=Number(b.startedAt)),'INVALID_CHAPTER_STARTS');
      const actual=new Map<number,number>();
      if(b.actualInvocations!==undefined){
        need(Array.isArray(b.actualInvocations),'INVALID_INVOCATIONS');
        for(const raw of b.actualInvocations){
          need(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_INVOCATIONS');const r=raw as Book;
          need(int(r.id)&&r.id>baseline.calls&&r.id<=baseline.calls+reserved.length&&!actual.has(r.id)&&int(r.at)&&r.at>=reserved[r.id-baseline.calls-1]!&&r.at<=b.lastObservedAt,'INVALID_INVOCATIONS');
          actual.set(r.id,r.at);
        }
      }
      const known=componentKnownUninvokedReservations(b);for(const r of known)knownUninvokedStarts.push(reserved[r.id-baseline.calls-1]!);
      const newStarts=reserved.map((at,i)=>actual.get(baseline!.calls+i+1)??at);
      const pending=pendingBytes(b.pending,baseline.calls+1,baseline.calls+reserved.length,false),receiptAccounting=componentByteAccounting(b),receiptUncertainty=receiptAccounting?receiptAccounting.uncertainBytes+receiptAccounting.reservedBytes:0;need(int(receiptUncertainty),'INVALID_RECEIPT_UNCERTAINTY');
      observedBytes+=b.httpBytes+b.wsBytes;uncertainResponseBytes+=pending.bytes+receiptUncertainty;pendingOperations+=pending.count;
      baseline={...baseline,calls:baseline.calls+reserved.length,bytes:baseline.bytes+b.httpBytes+b.wsBytes+pending.bytes+receiptUncertainty,starts:[...baseline.starts,...newStarts].sort((a,z)=>a-z),sha256};
      sources.push({path,sha256,incrementUnits:reserved.length,incrementObservedBytes:b.httpBytes+b.wsBytes,pendingReservedBytes:pending.bytes+receiptUncertainty,inputBytes:bookBytes});
    }
    need(int(baseline.calls)&&int(baseline.bytes)&&(options.allowCumulativeBeyondLegacy===true||baseline.calls<=240&&baseline.bytes<=64*MIB),'CUMULATIVE_CAP');
  }
  need(baseline,'MISSING_BASELINE');
  if(pendingOperations&&!options.physicalSettled){
    const error=Object.assign(Error('RESEARCH_BASELINE_PHYSICAL_UNCERTAINTY'),{uncertainResponseBytes,pendingOperations});throw error;
  }
  return {baseline,sources,knownUninvokedStarts,observedBytes,uncertainResponseBytes,pendingOperations,inputBytes,maximumInputBytes:RESEARCH_MAXIMUM_INPUT_BYTES,physicalSettlementConfirmed:options.physicalSettled===true};
}


export const RESEARCH_CHECKPOINT_KIND='poe-research-baseline-checkpoint' as const;
export type ResearchBaselineCheckpoint={
 schemaVersion:1|2;kind:typeof RESEARCH_CHECKPOINT_KIND;createdAt:number;lastObservedAt:number;sourceLastObservedAt:number;
 previousCheckpoint:{path:string;sha256:string}|null;
 sources:ResearchBaselineSource[];
 accounted:{calls:number;bytes:number;observedBytes:number;uncertainResponseBytes:number;pendingOperations:number};
 starts:{retainedSinceAt:number;omittedCount:number;conservativeUnknownAtSeal:number;times:number[]};
 refusal:{code:'RPC_HTTP_429';at:number};
 physicalSettlement:{verifiedAt:number;inFlight:0;waitingOrOperating:false;physicalTransportsSettled:boolean;passiveStreamsMayRemainOpen?:true};
 haltedReason:string|null;
};
/** Checkpoints are local integrity anchors, not provider allowance or financial
 * authority. The manifest pins their whole-file hash. Prior raw books and any
 * preceding checkpoint remain retained and independently auditable; startup
 * does not reread their ever-growing bytes. */
function checkedCheckpoint(raw:Book,now:number):ResearchBaselineCheckpoint{
 need(exact(raw,['schemaVersion','kind','createdAt','lastObservedAt','sourceLastObservedAt','previousCheckpoint','sources','accounted','starts','refusal','physicalSettlement','haltedReason'])&&[1,2].includes(Number(raw.schemaVersion))&&raw.kind===RESEARCH_CHECKPOINT_KIND,'INVALID_CHECKPOINT');
 need(int(raw.createdAt)&&raw.createdAt<=now&&raw.lastObservedAt===raw.createdAt&&int(raw.sourceLastObservedAt)&&raw.sourceLastObservedAt<=raw.createdAt,'CHECKPOINT_CLOCK');
 const a=raw.accounted,s=raw.starts,r=raw.refusal,p=raw.physicalSettlement;
 need(plain(a)&&exact(a,['calls','bytes','observedBytes','uncertainResponseBytes','pendingOperations'])&&int(a.calls)&&int(a.bytes)&&int(a.observedBytes)&&int(a.uncertainResponseBytes)&&int(a.pendingOperations)&&a.observedBytes+a.uncertainResponseBytes===a.bytes&&a.pendingOperations<=a.calls,'CHECKPOINT_COUNTERS');
 need(plain(s)&&exact(s,['retainedSinceAt','omittedCount','conservativeUnknownAtSeal','times'])&&int(s.retainedSinceAt)&&s.retainedSinceAt===Math.max(0,raw.createdAt-60000)&&int(s.omittedCount)&&int(s.conservativeUnknownAtSeal),'CHECKPOINT_STARTS');const starts=times(s.times,raw.createdAt);need(starts.every(t=>t>=Number(s.retainedSinceAt))&&starts.length+Number(s.omittedCount)===a.calls&&Number(s.conservativeUnknownAtSeal)<=starts.length&&starts.filter(t=>t===raw.createdAt).length>=Number(s.conservativeUnknownAtSeal),'CHECKPOINT_STARTS');
 need(plain(r)&&exact(r,['code','at'])&&r.code==='RPC_HTTP_429'&&int(r.at)&&r.at<=raw.sourceLastObservedAt,'CHECKPOINT_REFUSAL');
 need(plain(p)&&exact(p,raw.schemaVersion===2?['verifiedAt','inFlight','waitingOrOperating','physicalTransportsSettled','passiveStreamsMayRemainOpen']:['verifiedAt','inFlight','waitingOrOperating','physicalTransportsSettled'])&&p.verifiedAt===raw.createdAt&&p.inFlight===0&&p.waitingOrOperating===false&&(raw.schemaVersion===2?p.physicalTransportsSettled===false&&p.passiveStreamsMayRemainOpen===true:p.physicalTransportsSettled===true),'CHECKPOINT_PHYSICAL_UNSETTLED');
 need(raw.haltedReason===null||typeof raw.haltedReason==='string'&&/^COMPONENT_[A-Z0-9_:-]{1,100}$/.test(raw.haltedReason),'CHECKPOINT_HALT');
 const previous=raw.previousCheckpoint;need(previous===null||plain(previous)&&exact(previous,['path','sha256'])&&typeof previous.path==='string'&&previous.path===resolve(previous.path)&&previous.path.length<=4096&&hex(previous.sha256),'CHECKPOINT_PREVIOUS');
 need(Array.isArray(raw.sources)&&raw.sources.length>0&&raw.sources.length<=RESEARCH_MAXIMUM_PATHS,'CHECKPOINT_SOURCES');const paths=new Set<string>();let units=0,observed=0,uncertain=0,inputBytes=0;
 for(const source of raw.sources){need(plain(source)&&exact(source,['path','sha256','incrementUnits','incrementObservedBytes','pendingReservedBytes','inputBytes'])&&typeof source.path==='string'&&source.path===resolve(source.path)&&source.path.length<=4096&&!paths.has(source.path)&&hex(source.sha256)&&int(source.incrementUnits)&&int(source.incrementObservedBytes)&&int(source.pendingReservedBytes)&&int(source.inputBytes)&&source.inputBytes>0&&source.inputBytes<=COMPONENT_COUNTERBOOK_MAX_BYTES,'CHECKPOINT_SOURCES');paths.add(source.path);units+=source.incrementUnits;observed+=source.incrementObservedBytes;uncertain+=source.pendingReservedBytes;inputBytes+=source.inputBytes;}
 need(inputBytes<=RESEARCH_MAXIMUM_INPUT_BYTES,'AGGREGATE_INPUT_BOUND');
 need(units===a.calls&&observed===a.observedBytes&&uncertain===a.uncertainResponseBytes,'CHECKPOINT_SOURCE_COUNTERS');
 if(previous!==null)need((raw.sources[0] as ResearchBaselineSource).path===(previous as Book).path&&(raw.sources[0] as ResearchBaselineSource).sha256===(previous as Book).sha256,'CHECKPOINT_PREVIOUS_CONFLICT');
 return raw as unknown as ResearchBaselineCheckpoint;
}
export type ResearchCheckpointOptions=ResearchBaselineOptions&{outputPath:string;physicalSettled:true;settlement:{inFlight:number;waitingOrOperating:boolean;physicalTransportsSettled:boolean};/** Existing service owns the shared gate; synchronous seal has no physical operation, while passive streams may remain open. It never asserts socket closure. */liveAccountingBoundary?:true};
/** Append-only quiescent seal. Caller must own the existing research/process
 * leases and independently establish transport settlement. This checks the
 * current explicit chain twice, retains every uncertain debit, and never edits
 * old books, receipts or a financial manifest. Partial failed output is kept. */
export function createResearchBaselineCheckpoint(options:ResearchCheckpointOptions){
 need(options.physicalSettled===true&&plain(options.settlement)&&exact(options.settlement,['inFlight','waitingOrOperating','physicalTransportsSettled'])&&options.settlement.inFlight===0&&options.settlement.waitingOrOperating===false&&(options.settlement.physicalTransportsSettled===true||options.liveAccountingBoundary===true&&options.settlement.physicalTransportsSettled===false),'CHECKPOINT_PHYSICAL_UNSETTLED');
 const linked=readResearchBaseline(options),at=options.now,first=readBook(resolve(options.paths[0]!),RESEARCH_MAXIMUM_INPUT_BYTES),last=readBook(resolve(options.paths.at(-1)!),RESEARCH_MAXIMUM_INPUT_BYTES);const previous=first.book.kind===RESEARCH_CHECKPOINT_KIND?{path:resolve(options.paths[0]!),sha256:first.sha256}:null;
 // Durably attested pre-transport refusals are not physical starts. Their
 // allocated units/bytes/pending obligations and hash-linked raw books remain.
 // Every OTHER missing physical stamp must not be refunded from a rolling provider
 // window. A crash may occur after transport invocation but before persisting
 // that timestamp, so even book.lastObservedAt is not its upper bound. Use this
 // independently verified physical-settlement/seal time. Existing anchors retain
 // their previous estimates without retiming them; actual stamps remain exact.
 let unknownAtSeal=0;const conservative:number[]=[];for(let index=0;index<linked.sources.length;index++){const source=linked.sources[index]!,book=readBook(source.path,RESEARCH_MAXIMUM_INPUT_BYTES);need(book.sha256===source.sha256,'CHECKPOINT_SOURCE_CHANGED');const b=book.book;if(index===0&&b.kind===RESEARCH_CHECKPOINT_KIND)conservative.push(...checkedCheckpoint(b,at).starts.times);else if(index===0)conservative.push(...times(b.starts,Number(b.lastObservedAt)).map(()=>{unknownAtSeal++;return at;}));else{const invoked=new Map<number,number>((b.actualInvocations as Array<{id:number;at:number}>|undefined)?.map(r=>[r.id,r.at])??[]),base=(b.baseline as ComponentBaseline).calls;const never=new Set(componentKnownUninvokedReservations(b).map(r=>r.id));conservative.push(...times(b.starts,Number(b.lastObservedAt)).flatMap((_t,i)=>never.has(base+i+1)?[]:[invoked.get(base+i+1)??(unknownAtSeal++,at)]));}}
 const cutoff=Math.max(0,at-60000),retained=conservative.filter(t=>t>=cutoff).sort((a,z)=>a-z),value:ResearchBaselineCheckpoint={schemaVersion:options.liveAccountingBoundary?2:1,kind:RESEARCH_CHECKPOINT_KIND,createdAt:at,lastObservedAt:at,sourceLastObservedAt:Number(last.book.lastObservedAt),previousCheckpoint:previous,sources:linked.sources.map(s=>({...s})),accounted:{calls:linked.baseline.calls,bytes:linked.baseline.bytes,observedBytes:linked.observedBytes,uncertainResponseBytes:linked.uncertainResponseBytes,pendingOperations:linked.pendingOperations},starts:{retainedSinceAt:cutoff,omittedCount:linked.baseline.calls-retained.length,conservativeUnknownAtSeal:unknownAtSeal,times:retained},refusal:{code:'RPC_HTTP_429',at:linked.baseline.refusalAt},physicalSettlement:{verifiedAt:at,inFlight:0,waitingOrOperating:false,physicalTransportsSettled:options.liveAccountingBoundary!==true,...(options.liveAccountingBoundary?{passiveStreamsMayRemainOpen:true as const}:{})},haltedReason:typeof last.book.haltedReason==='string'?last.book.haltedReason:null};
 checkedCheckpoint(value as unknown as Book,at);const check=readResearchBaseline(options);need(JSON.stringify(check)===JSON.stringify(linked),'CHECKPOINT_SOURCE_CHANGED');
 const path=resolve(options.outputPath),parent=lstatSync(dirname(path));need(parent.isDirectory()&&!parent.isSymbolicLink()&&parent.uid===process.getuid?.()&&(parent.mode&0o077)===0&&realpathSync(dirname(path))===dirname(path)&&!linked.sources.some(s=>s.path===path),'CHECKPOINT_UNSAFE_OUTPUT');
 const bytes=Buffer.from(JSON.stringify(value)+'\n');need(bytes.length<=COMPONENT_COUNTERBOOK_MAX_BYTES,'CHECKPOINT_SIZE');const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}const directory=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(directory);}finally{closeSync(directory);}
 const sha256=createHash('sha256').update(bytes).digest('hex');return {path,sha256,bytes:bytes.length,baselinePaths:[path],baselineCheckpointSha256:sha256,accounted:{...value.accounted},retainedStarts:retained.length,unknownPhysicalStartsConservativelyAtSeal:unknownAtSeal,omittedStarts:value.starts.omittedCount,previousCheckpoint:previous,rawSourcesRetained:true as const};
}

/** A deployment/exporter may use this only AFTER verifying its existing run,
 * receipt and physical-settlement guards. This proves a proposed compacted
 * manifest represents precisely that same ordered source chain. It does not
 * waive or invent those guards, discover new paths, or change any manifest. */
export function verifyResearchCheckpointSourceHandoff(options:{checkpointPath:string;checkpointSha256:string;sourcePaths:readonly string[];sourceCheckpointSha256?:string;now:number;physicalSettled:true}){
 need(options.physicalSettled===true,'CHECKPOINT_PHYSICAL_UNSETTLED');
 const sealed=readResearchBaseline({paths:[options.checkpointPath],checkpointSha256:options.checkpointSha256,now:options.now,physicalSettled:true,allowCumulativeBeyondLegacy:true}),source=readResearchBaseline({paths:options.sourcePaths,checkpointSha256:options.sourceCheckpointSha256,now:options.now,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS}),raw=readBook(resolve(options.checkpointPath),RESEARCH_MAXIMUM_INPUT_BYTES);need(raw.sha256===options.checkpointSha256,'CHECKPOINT_HASH_MISMATCH');const checkpoint=checkedCheckpoint(raw.book,options.now);
 need(JSON.stringify(checkpoint.sources)===JSON.stringify(source.sources)&&sealed.baseline.calls===source.baseline.calls&&sealed.baseline.bytes===source.baseline.bytes&&sealed.observedBytes===source.observedBytes&&sealed.uncertainResponseBytes===source.uncertainResponseBytes&&sealed.pendingOperations===source.pendingOperations&&sealed.baseline.refusal===source.baseline.refusal&&sealed.baseline.refusalAt===source.baseline.refusalAt,'CHECKPOINT_SOURCE_HANDOFF');
 return {checkpointPath:resolve(options.checkpointPath),checkpointSha256:options.checkpointSha256,sourceCount:source.sources.length,accountedUnits:source.baseline.calls,accountedResponseBytes:source.baseline.bytes,observedResponseBytes:source.observedBytes,uncertainResponseBytes:source.uncertainResponseBytes,rawSourcesHashVerified:true as const,financialOrProviderAuthority:false as const};
}
