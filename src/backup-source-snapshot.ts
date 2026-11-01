import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,realpathSync,statfsSync,type Stats} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

export const BACKUP_SOURCE_SNAPSHOT_MAXIMUM_MS=20_000;
export const BACKUP_SOURCE_SNAPSHOT_MAXIMUM_WAL_GROWTH_BYTES=64*1024*1024;
export const BACKUP_SOURCE_SNAPSHOT_DEFAULT_RESERVE_BYTES=256*1024*1024;
export const BACKUP_SOURCE_SNAPSHOT_PAGES_PER_STEP=100;
export type BackupSourceFileIdentity={dev:number;ino:number};
export type ReadonlyFinancialSnapshotProgress={totalPages:number;remainingPages:number;pageSize:number};
export type ReadonlyFinancialSnapshotOptions={
  sourcePath:string;
  pendingPath:string;
  identity:{accountId:string;mode:'PAPER'|'DISPOSABLE_PAPER';inceptionAt:number};
  expectedSource:BackupSourceFileIdentity;
  expectedPending:BackupSourceFileIdentity;
  minimumRevision:number;
  minimumFreeBytes?:number;
  maximumLifetimeMs?:number;
  maximumWalGrowthBytes?:number;
  signal?:AbortSignal;
  /** Allows the worker to poll parent-owned shared cancellation state. */
  cancelled?:()=>boolean;
  /** Diagnostic seams can tighten real elapsed time/free space, never enlarge a budget. */
  monotonicNow?:()=>number;
  availableBytes?:(directory:string)=>number;
  onProgress?:(progress:ReadonlyFinancialSnapshotProgress)=>void;
};
export type ReadonlyFinancialSnapshotCopy={
  revision:number;lastAt:number;snapshotSequence:string|null;stateSha256:string;
  source:BackupSourceFileIdentity;
  phases:{openMs:number;captureMs:number;copyMs:number;releaseMs:number;totalMs:number};
  pages:{total:number;copied:number;steps:number};
  /** Physical WAL file growth, not cumulative logical WAL writes. */
  wal:{initialBytes:number;maximumBytes:number;growthBytes:number};
};

function need(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
function integer(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
function identity(value:BackupSourceFileIdentity){return value&&integer(value.dev)&&integer(value.ino)&&value.ino>0;}
function sameFile(a:BackupSourceFileIdentity,b:BackupSourceFileIdentity){return a.dev===b.dev&&a.ino===b.ino;}
function privateRegular(info:Stats){return info.isFile()&&info.uid===process.getuid?.()&&(info.mode&0o777)===0o600&&info.nlink===1&&integer(info.size);}
function privateDirectory(path:string){
  const info=lstatSync(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid?.()&&(info.mode&0o777)===0o700&&realpathSync(path)===path,'BACKUP_SNAPSHOT_PRIVATE_DIRECTORY_REQUIRED');
}
function canonical(path:string){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&realpathSync(path)===path,'BACKUP_SNAPSHOT_CANONICAL_PATH_REQUIRED');
  privateDirectory(dirname(path));
}
function verifiedFile(path:string,fd:number,expected:BackupSourceFileIdentity){
  canonical(path);const named=lstatSync(path),opened=fstatSync(fd);
  need(privateRegular(named)&&privateRegular(opened)&&sameFile(named,opened)&&sameFile(opened,expected),'BACKUP_SNAPSHOT_FILE_IDENTITY_REQUIRED');
  return opened;
}
function sidecarBytes(sourcePath:string,suffix:string){
  const path=sourcePath+suffix;
  try{
    const info=lstatSync(path);
    need(privateRegular(info)&&!info.isSymbolicLink()&&realpathSync(path)===path,'BACKUP_SNAPSHOT_PRIVATE_SIDECAR_REQUIRED');
    return info.size;
  }catch(error){
    if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return 0;
    throw error;
  }
}

/**
 * Worker-only copy from a fixed read-only WAL transaction. It never constructs
 * a financial writer, changes source durability/checkpoint settings, or owns
 * pending-file deletion. Its caller must hold the operation lease and validate
 * the completed artifact against this exact state/revision/sequence receipt.
 *
 * Limits are cooperative: a native copy/close or filesystem call can exceed a
 * budget before JavaScript resumes. Every 100-page boundary and the completion
 * boundary rechecks them. The read transaction closes before returning, so
 * artifact integrity scans, normalization and promotion do not pin source WAL.
 */
export async function copyReadonlyFinancialSnapshot(options:ReadonlyFinancialSnapshotOptions):Promise<ReadonlyFinancialSnapshotCopy>{
  const reserve=options.minimumFreeBytes??BACKUP_SOURCE_SNAPSHOT_DEFAULT_RESERVE_BYTES;
  const lifetime=options.maximumLifetimeMs??BACKUP_SOURCE_SNAPSHOT_MAXIMUM_MS;
  need(integer(reserve)&&reserve>=1024*1024,'BACKUP_SNAPSHOT_RESERVE_REQUIRED');
  const effectiveWalCap=Math.min(BACKUP_SOURCE_SNAPSHOT_MAXIMUM_WAL_GROWTH_BYTES,Math.floor(reserve/4));
  const walLimit=options.maximumWalGrowthBytes??effectiveWalCap;
  need(integer(lifetime)&&lifetime>0&&lifetime<=BACKUP_SOURCE_SNAPSHOT_MAXIMUM_MS&&integer(walLimit)&&walLimit>0&&walLimit<=effectiveWalCap,'BACKUP_SNAPSHOT_POLICY_LIMIT_REQUIRED');
  need(identity(options.expectedSource)&&identity(options.expectedPending)&&!sameFile(options.expectedSource,options.expectedPending),'BACKUP_SNAPSHOT_DISTINCT_BOUND_FILES_REQUIRED');
  need(integer(options.minimumRevision)&&options.identity&&typeof options.identity.accountId==='string'&&/^[a-zA-Z0-9-]{1,128}$/.test(options.identity.accountId)&&['PAPER','DISPOSABLE_PAPER'].includes(options.identity.mode)&&integer(options.identity.inceptionAt),'BACKUP_SNAPSHOT_EXPECTED_IDENTITY_REQUIRED');
  const start=performance.now();let previousReal=start;
  const injectedStart=options.monotonicNow?.();let previousInjected=injectedStart;
  if(options.monotonicNow)need(typeof injectedStart==='number'&&Number.isFinite(injectedStart)&&injectedStart>=0,'BACKUP_SNAPSHOT_MONOTONIC_CLOCK_REQUIRED');
  const clock=()=>{
    const now=performance.now();need(Number.isFinite(now)&&now>=previousReal,'BACKUP_SNAPSHOT_MONOTONIC_CLOCK_REQUIRED');previousReal=now;
    let elapsed=now-start;
    if(options.monotonicNow){const injected=options.monotonicNow();need(Number.isFinite(injected)&&injected>=previousInjected!,'BACKUP_SNAPSHOT_MONOTONIC_CLOCK_REQUIRED');previousInjected=injected;elapsed=Math.max(elapsed,injected-injectedStart!);}
    need(elapsed<lifetime,'BACKUP_SNAPSHOT_LIFETIME_EXCEEDED');return now;
  };
  const cancellation=()=>{
    const cancelled=options.cancelled?.()??false;
    need(typeof cancelled==='boolean','BACKUP_SNAPSHOT_CANCELLATION_STATE_REQUIRED');
    need(!options.signal?.aborted&&!cancelled,'BACKUP_SNAPSHOT_CANCELLED');
  };
  const available=(directory:string)=>{
    const fs=statfsSync(directory),actual=fs.bavail*fs.bsize;
    need(integer(actual),'BACKUP_SNAPSHOT_DISK_MEASUREMENT_REQUIRED');
    if(!options.availableBytes)return actual;
    const measured=options.availableBytes(directory);need(integer(measured),'BACKUP_SNAPSHOT_DISK_MEASUREMENT_REQUIRED');return Math.min(actual,measured);
  };
  let sourceFd:number|undefined,pendingFd:number|undefined,db:Database.Database|undefined;
  let openEnd=start,captureEnd=start,copyEnd=start;
  let initialWal=0,maximumWal=0,pageCount=0,pageSize=0,steps=0;
  let captured:{revision:number;lastAt:number;snapshotSequence:string|null;stateSha256:string}|undefined;
  const guard=(remainingBytes:number)=>{
    cancellation();clock();
    verifiedFile(options.sourcePath,sourceFd!,options.expectedSource);
    verifiedFile(options.pendingPath,pendingFd!,options.expectedPending);
    const wal=sidecarBytes(options.sourcePath,'-wal');sidecarBytes(options.sourcePath,'-shm');
    maximumWal=Math.max(maximumWal,wal);
    need(maximumWal-initialWal<=walLimit,'BACKUP_SNAPSHOT_WAL_GROWTH_EXCEEDED');
    need(integer(remainingBytes)&&integer(remainingBytes+reserve),'BACKUP_SNAPSHOT_COPY_SIZE_REQUIRED');
    need(available(dirname(options.sourcePath))>=reserve&&available(dirname(options.pendingPath))>=remainingBytes+reserve,'BACKUP_SNAPSHOT_DISK_RESERVE_REQUIRED');
    // Metadata and filesystem measurements themselves may take time. Do not
    // start another native step on permission sampled before those calls.
    cancellation();clock();
  };
  try{
    cancellation();clock();canonical(options.sourcePath);canonical(options.pendingPath);
    sourceFd=openSync(options.sourcePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    pendingFd=openSync(options.pendingPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    verifiedFile(options.sourcePath,sourceFd,options.expectedSource);
    need(verifiedFile(options.pendingPath,pendingFd,options.expectedPending).size===0,'BACKUP_SNAPSHOT_EMPTY_OWNED_PENDING_REQUIRED');
    initialWal=maximumWal=sidecarBytes(options.sourcePath,'-wal');sidecarBytes(options.sourcePath,'-shm');
    guard(0);
    db=new Database(options.sourcePath,{readonly:true,fileMustExist:true,timeout:100});
    need(db.readonly,'BACKUP_SNAPSHOT_READONLY_CONNECTION_REQUIRED');
    db.pragma('query_only = ON');
    need(db.pragma('query_only',{simple:true})===1&&db.pragma('journal_mode',{simple:true})==='wal','BACKUP_SNAPSHOT_READONLY_WAL_REQUIRED');
    openEnd=clock();
    db.exec('BEGIN');
    // The first bounded state read establishes the WAL snapshot. Every query
    // and backup step below uses this same connection and transaction.
    const size=db.prepare('SELECT length(CAST(body AS BLOB)) bytes FROM financial_state WHERE singleton=1').get() as {bytes:number}|undefined;
    need(size&&integer(size.bytes)&&size.bytes>0&&size.bytes<=1_048_576,'BACKUP_SNAPSHOT_BOUNDED_STATE_REQUIRED');
    const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}|undefined;
    need(row&&typeof row.body==='string'&&Buffer.byteLength(row.body)===size.bytes,'BACKUP_SNAPSHOT_BOUNDED_STATE_REQUIRED');
    const state=JSON.parse(row.body) as Record<string,unknown>;
    need(state&&typeof state==='object'&&!Array.isArray(state)&&state.accountId===options.identity.accountId&&state.mode===options.identity.mode&&state.inceptionAt===options.identity.inceptionAt&&integer(state.revision)&&state.revision>=options.minimumRevision&&integer(state.lastAt)&&state.lastAt>=options.identity.inceptionAt,'BACKUP_SNAPSHOT_ACCOUNT_REVISION_REQUIRED');
    const head=db.prepare('SELECT revision,at FROM journal ORDER BY revision DESC LIMIT 1').get() as {revision:number;at:number}|undefined;
    need(head&&head.revision===state.revision&&head.at===state.lastAt,'BACKUP_SNAPSHOT_JOURNAL_HEAD_REQUIRED');
    const sequenceSize=db.prepare("SELECT length(CAST(value AS BLOB)) bytes FROM metadata WHERE key='snapshot_sequence'").get() as {bytes:number}|undefined;
    let snapshotSequence:string|null=null;
    if(sequenceSize){
      need(integer(sequenceSize.bytes)&&sequenceSize.bytes>0&&sequenceSize.bytes<=40,'BACKUP_SNAPSHOT_SEQUENCE_REQUIRED');
      const sequence=db.prepare("SELECT value FROM metadata WHERE key='snapshot_sequence'").get() as {value:string}|undefined;
      need(sequence&&typeof sequence.value==='string'&&/^[1-9][0-9]{0,39}$/.test(sequence.value),'BACKUP_SNAPSHOT_SEQUENCE_REQUIRED');snapshotSequence=sequence.value;
    }
    pageCount=db.pragma('page_count',{simple:true}) as number;pageSize=db.pragma('page_size',{simple:true}) as number;
    need(integer(pageCount)&&pageCount>0&&integer(pageSize)&&pageSize>=512&&pageSize<=65536&&(pageSize&(pageSize-1))===0&&integer(pageCount*pageSize),'BACKUP_SNAPSHOT_COPY_SIZE_REQUIRED');
    captured={revision:state.revision,lastAt:state.lastAt,snapshotSequence,stateSha256:createHash('sha256').update(row.body).digest('hex')};
    guard(pageCount*pageSize);captureEnd=clock();
    let remaining=pageCount;
    const result=await db.backup(options.pendingPath,{progress:progress=>{
      need(progress.totalPages===pageCount&&integer(progress.remainingPages)&&progress.remainingPages<=remaining,'BACKUP_SNAPSHOT_FIXED_PAGE_COUNT_REQUIRED');
      remaining=progress.remainingPages;steps++;
      guard(remaining*pageSize);options.onProgress?.({totalPages:pageCount,remainingPages:remaining,pageSize});guard(remaining*pageSize);
      return BACKUP_SOURCE_SNAPSHOT_PAGES_PER_STEP;
    }});
    // better-sqlite3 omits the progress callback for its final native step.
    // Its promise settles only after native backup.close has completed.
    need(result.totalPages===pageCount&&result.remainingPages===0,'BACKUP_SNAPSHOT_COPY_INCOMPLETE');
    guard(0);copyEnd=clock();
  }finally{
    try{
      if(db){try{if(db.inTransaction)db.exec('ROLLBACK');}finally{if(db.open)db.close();}}
    }finally{
      try{if(pendingFd!==undefined)closeSync(pendingFd);}finally{if(sourceFd!==undefined)closeSync(sourceFd);}
    }
  }
  const end=clock();cancellation();
  need(captured,'BACKUP_SNAPSHOT_CAPTURE_REQUIRED');
  return {...captured,source:{dev:options.expectedSource.dev,ino:options.expectedSource.ino},
    phases:{openMs:openEnd-start,captureMs:captureEnd-openEnd,copyMs:copyEnd-captureEnd,releaseMs:end-copyEnd,totalMs:end-start},
    pages:{total:pageCount,copied:pageCount,steps},
    wal:{initialBytes:initialWal,maximumBytes:maximumWal,growthBytes:maximumWal-initialWal}};
}
