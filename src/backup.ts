import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateReportingTradeCache,reportingFilledTrade} from './reporting.js';
import {chmodSync,closeSync,constants,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,opendirSync,readSync,realpathSync,renameSync,statSync,statfsSync,unlinkSync,writeSync,type Stats} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {isMainThread,Worker} from 'node:worker_threads';
import {validateFinancialState,validateOperatingReportingHistory,REPORTING_OPERATING_HISTORY_KEY,type LedgerMode,type LedgerState,type PaperLedger,type ReportingHistory} from './ledger.js';
import {validateOperatingCosts,type OperatingCostState} from './costs.js';
import {copyReadonlyFinancialSnapshot,type ReadonlyFinancialSnapshotCopy} from './backup-source-snapshot.js';

export type BackupIdentity={accountId:string;mode:LedgerMode;inceptionAt:number};
export type FinancialBackup=BackupIdentity&{path:string;generation:string;revision:number;lastAt:number;snapshotSequence:string|null;sourceSnapshot?:ReadonlyFinancialSnapshotCopy};
export type BackupSelection={backup:FinancialBackup|null;rejected:{file:string;reason:'invalid-backup'|'unrecognized-path'}[];pending:boolean};
type Source=Pick<PaperLedger,'state'|'backup'>;
export class BackupPreparationDeferred extends Error{constructor(){super('BACKUP_RUNTIME_PREPARATION_DEFERRED');}}
export type BackupFailurePhase='operation-open'|'source-anchor'|'worker-acquire'|'runtime-preparation'|'artifact-prepare'|'source-copy'|'artifact-finish'|'pending-recovery'|'unknown';
/** Preserve the real failed phase without granting different recovery authority.
 * The cause remains internal; operational projections use the bounded helper. */
export class BackupOperationError extends Error{
  constructor(readonly phase:BackupFailurePhase,cause:unknown){super(cause instanceof Error?cause.message:'backup operation failed',{cause});}
}
const SNAPSHOT_FAILURE_CODES=new Set(['BACKUP_SNAPSHOT_RESERVE_REQUIRED','BACKUP_SNAPSHOT_POLICY_LIMIT_REQUIRED','BACKUP_SNAPSHOT_DISTINCT_BOUND_FILES_REQUIRED','BACKUP_SNAPSHOT_EXPECTED_IDENTITY_REQUIRED','BACKUP_SNAPSHOT_MONOTONIC_CLOCK_REQUIRED','BACKUP_SNAPSHOT_LIFETIME_EXCEEDED','BACKUP_SNAPSHOT_CANCELLATION_STATE_REQUIRED','BACKUP_SNAPSHOT_CANCELLED','BACKUP_SNAPSHOT_DISK_MEASUREMENT_REQUIRED','BACKUP_SNAPSHOT_FILE_IDENTITY_REQUIRED','BACKUP_SNAPSHOT_PRIVATE_DIRECTORY_REQUIRED','BACKUP_SNAPSHOT_CANONICAL_PATH_REQUIRED','BACKUP_SNAPSHOT_PRIVATE_SIDECAR_REQUIRED','BACKUP_SNAPSHOT_WAL_GROWTH_EXCEEDED','BACKUP_SNAPSHOT_COPY_SIZE_REQUIRED','BACKUP_SNAPSHOT_DISK_RESERVE_REQUIRED','BACKUP_SNAPSHOT_EMPTY_OWNED_PENDING_REQUIRED','BACKUP_SNAPSHOT_READONLY_CONNECTION_REQUIRED','BACKUP_SNAPSHOT_READONLY_WAL_REQUIRED','BACKUP_SNAPSHOT_BOUNDED_STATE_REQUIRED','BACKUP_SNAPSHOT_ACCOUNT_REVISION_REQUIRED','BACKUP_SNAPSHOT_JOURNAL_HEAD_REQUIRED','BACKUP_SNAPSHOT_SEQUENCE_REQUIRED','BACKUP_SNAPSHOT_FIXED_PAGE_COUNT_REQUIRED','BACKUP_SNAPSHOT_COPY_INCOMPLETE','BACKUP_SNAPSHOT_CAPTURE_REQUIRED']);
const BACKUP_FAILURE_MESSAGES=new Map([
  ["backup retention layout needs review; nothing removed","BACKUP_RETENTION_LAYOUT_REQUIRED"],
  ["backup directory entry bound exceeded; nothing removed","BACKUP_DIRECTORY_ENTRY_BOUND_EXCEEDED"],
  ["backup recovery capsule identity invalid; originals preserved","BACKUP_RECOVERY_CAPSULE_IDENTITY_INVALID"],
  ["backup recovery capsule layout invalid; originals preserved","BACKUP_RECOVERY_CAPSULE_LAYOUT_INVALID"],
  ["backup recovery capsule metadata invalid; originals preserved","BACKUP_RECOVERY_CAPSULE_METADATA_INVALID"],
  ["backup recovery capsule metadata changed; originals preserved","BACKUP_RECOVERY_CAPSULE_METADATA_CHANGED"],
  ["backup recovery capsule metadata write failed; originals preserved","BACKUP_RECOVERY_CAPSULE_METADATA_WRITE_FAILED"],
  ["backup recovery capsule initialization incomplete; originals preserved","BACKUP_RECOVERY_CAPSULE_INITIALIZATION_INCOMPLETE"],
  ["backup recovery original identity changed; originals preserved","BACKUP_RECOVERY_ORIGINAL_IDENTITY_CHANGED"],
  ["backup recovery original bytes changed; originals preserved","BACKUP_RECOVERY_ORIGINAL_BYTES_CHANGED"],
  ["backup recovery journal changed; originals preserved","BACKUP_RECOVERY_JOURNAL_CHANGED"],
  ["backup recovery super-journal reference refused; originals preserved","BACKUP_RECOVERY_SUPER_JOURNAL_REFUSED"],
  ["backup recovery family changed; originals preserved","BACKUP_RECOVERY_FAMILY_CHANGED"],
  ["backup recovery family location ambiguous; originals preserved","BACKUP_RECOVERY_FAMILY_LOCATION_AMBIGUOUS"],
  ["backup recovery candidate copy incomplete; originals preserved","BACKUP_RECOVERY_CANDIDATE_COPY_INCOMPLETE"],
  ["backup recovery validated receipt required; originals preserved","BACKUP_RECOVERY_VALIDATED_RECEIPT_REQUIRED"],
  ["backup recovery promotion location ambiguous; originals preserved","BACKUP_RECOVERY_PROMOTION_LOCATION_AMBIGUOUS"],
  ["backup recovery validated sidecar unexpected; originals preserved","BACKUP_RECOVERY_VALIDATED_SIDECAR_UNEXPECTED"],
  ["backup recovery validated receipt mismatch; originals preserved","BACKUP_RECOVERY_VALIDATED_RECEIPT_MISMATCH"],
  ["backup recovery promotion target changed; originals preserved","BACKUP_RECOVERY_PROMOTION_TARGET_CHANGED"],
  ["backup recovery paired pending journal required; originals preserved","BACKUP_RECOVERY_PAIRED_JOURNAL_REQUIRED"],
  ["backup recovery capsule already occupied; second journal preserved","BACKUP_RECOVERY_CAPSULE_OCCUPIED"],
  ["backup empty recovery requires verified prior backup; originals preserved","BACKUP_RECOVERY_EMPTY_REQUIRES_PRIOR_BACKUP"],
  ['backup artifact work exceeded 30s; pending artifacts preserved','BACKUP_WORKER_DEADLINE_EXCEEDED'],
  ['backup artifact request cancelled or expired; pending artifacts preserved','BACKUP_WORKER_CANCELLED_OR_EXPIRED'],
  ['backup artifact worker failed; pending artifacts preserved','BACKUP_WORKER_FAILED'],
  ['backup artifact worker unavailable; pending artifacts preserved','BACKUP_WORKER_UNAVAILABLE'],
  ['backup operation already active or standard Linux flock unavailable','BACKUP_OPERATION_LEASE_UNAVAILABLE'],
  ['backup operation lease inode changed; nothing removed','BACKUP_OPERATION_LEASE_CHANGED'],
  ['backup source inode changed; prior backups preserved','BACKUP_SOURCE_INODE_CHANGED'],
  ['backup source identity mismatch','BACKUP_SOURCE_ACCOUNT_MISMATCH'],
  ['private bounded regular backup/source file required','BACKUP_PRIVATE_FILE_REQUIRED'],
  ['private canonical owner-held backup directory required','BACKUP_PRIVATE_DIRECTORY_REQUIRED'],
  ['backup disk headroom unavailable; financial source and prior backups retained','BACKUP_DISK_HEADROOM_UNAVAILABLE'],
  ['backup integrity failure','BACKUP_ARTIFACT_INTEGRITY_FAILED'],
  ['backup differs from captured readonly financial snapshot','BACKUP_CAPTURED_STATE_MISMATCH'],
  ['backup sequence differs from captured readonly financial snapshot','BACKUP_CAPTURED_SEQUENCE_MISMATCH'],
  ['backup would regress durable history','BACKUP_HISTORY_REGRESSION'],
  ['pending backup requires explicit recovery; nothing overwritten','BACKUP_PENDING_RECOVERY_REQUIRED'],
]);
const BACKUP_SQLITE_CODES=new Set(['SQLITE_BUSY','SQLITE_LOCKED','SQLITE_IOERR','SQLITE_CORRUPT','SQLITE_NOTADB','SQLITE_FULL','SQLITE_READONLY','SQLITE_READONLY_ROLLBACK','SQLITE_CANTOPEN']);
/** No arbitrary error text, file path, provider URL or credential is exported. */
export function backupFailureDiagnostic(error:unknown){
  const cause=error instanceof BackupOperationError?error.cause:error,message=cause instanceof Error?cause.message:'NON_ERROR_BACKUP_FAILURE';
  const rawCode=cause instanceof Error&&'code'in cause&&typeof cause.code==='string'?cause.code:null;
  return {version:'financial-backup-failure-v1',phase:error instanceof BackupOperationError?error.phase:'unknown' as BackupFailurePhase,
    code:error instanceof BackupPreparationDeferred?'BACKUP_RUNTIME_PREPARATION_DEFERRED':SNAPSHOT_FAILURE_CODES.has(message)?message:BACKUP_FAILURE_MESSAGES.get(message)??'OTHER_BACKUP_FAILURE',
    errorSha256:createHash('sha256').update(message).digest('hex'),sqliteCode:rawCode!==null&&BACKUP_SQLITE_CODES.has(rawCode)?rawCode:null,
    financialFailure:!(error instanceof BackupPreparationDeferred)};
}
export type BackupRuntimePreparation={admission:()=>boolean;measure:<T>(work:()=>T)=>T};
type Options={directory:string;sourcePath:string;identity:BackupIdentity;maxBytes?:number;persistent?:boolean;minimumFreeBytes?:number};
export type BackupArtifactTask={task:'prepare';minimumRevision:number;expectedSource:{dev:number;ino:number}}|{task:'acquire'|'copy'|'finish'|'abort'|'recover'};
export type BackupOperationLease={fd:number;dev:number;ino:number};
export type BackupWorkerData={options:Options;operation:BackupOperationLease;cancellation:SharedArrayBuffer};
export type BackupArtifactRequest={id:number;deadlineAtMonoNs:bigint;task:BackupArtifactTask};
const PREFIX='poe-financial-',PENDING='poe-financial-pending.sqlite';
const OPERATION_LOCK='.poe-backup.lock';
const NAME=/^poe-financial-([0-9]{20})\.sqlite$/;

type RecoverySource={dev:string;ino:string};
type RecoveryFile=RecoverySource&{suffix:string;size:number;mtimeNs:string;ctimeNs:string;sha256:string};
type RecoveryManifest={version:1;identity:BackupIdentity;source:RecoverySource;files:RecoveryFile[]};
type RecoveryValidated={version:1;manifestSha256:string;file:RecoveryFile;target:string;revision:number;lastAt:number;snapshotSequence:string|null};
type RecoveryCompleted={version:1;manifestSha256:string;disposition:'PROMOTED'|'PRESERVED_INCOMPLETE_STAGING';validatedSha256:string|null};
const RECOVERY='.poe-pending-recovery',RECOVERY_SUFFIXES=['','-journal','-wal','-shm'] as const;
const RECOVERY_NAMES=new Set(['manifest.json','validated.json','completed.json','manifest.json.tmp','validated.json.tmp','completed.json.tmp',...RECOVERY_SUFFIXES.flatMap(s=>['original.sqlite'+s,'candidate.sqlite'+s])]);


/** One bounded worker per operation. The parent owns the original lease FD
 * until every source-copy operation and the worker itself physically settle. */
class ArtifactWorker{
  private readonly worker:Worker;
  private readonly cancellation=new Int32Array(new SharedArrayBuffer(4));
  private readonly exited:Promise<void>;private closing:Promise<void>|null=null;
  private failed=false;private active=false;private sequence=0;
  constructor(options:Options,operation:BackupOperationLease){
    const source=import.meta.url.endsWith('.ts');
    // Register inside the source worker before resolving .js imports to .ts;
    // inheriting the parent's tsx preload alone does not register that thread.
    const register=source?'data:text/javascript,'+encodeURIComponent(`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();`):'';
    this.worker=new Worker(new URL(source?'./backup-worker.ts':'./backup-worker.js',import.meta.url),{workerData:{options,operation,cancellation:this.cancellation.buffer} satisfies BackupWorkerData,execArgv:source?['--import',register]:[],env:{}});
    this.worker.on('error',()=>{this.failed=true;});
    this.exited=new Promise(resolve=>this.worker.once('exit',()=>{this.failed=true;resolve();}));
  }
  request(task:BackupArtifactTask):Promise<FinancialBackup|null>{
    if(this.failed)return Promise.reject(new Error('backup artifact worker unavailable; pending artifacts preserved'));
    if(this.active)return Promise.reject(new Error('backup artifact request already active'));
    this.active=true;const id=++this.sequence,deadlineAtMonoNs=process.hrtime.bigint()+30_000_000_000n;
    return new Promise((resolve,reject)=>{
      let done=false;
      const cleanup=()=>{clearTimeout(timer);this.active=false;this.worker.off('message',message);this.worker.off('error',error);this.worker.off('exit',exited);};
      const rejectAfterExit=(reason:string)=>{if(done)return;done=true;cleanup();void this.close().then(()=>reject(new Error(reason)),()=>reject(new Error(reason)));};
      const error=()=>rejectAfterExit('backup artifact worker failed; pending artifacts preserved');
      const exited=()=>error();
      const message=(reply:{id:number;ok:boolean;result?:FinancialBackup|null;error?:string;sqliteCode?:string|null})=>{
        if(done)return;if(!reply||reply.id!==id||typeof reply.ok!=='boolean'){rejectAfterExit('backup artifact reply scope mismatch; pending artifacts preserved');return;}
        if(process.hrtime.bigint()>=deadlineAtMonoNs){rejectAfterExit('backup artifact work exceeded 30s; pending artifacts preserved');return;}
        done=true;cleanup();if(reply.ok)resolve(reply.result??null);else{const failure=new Error(reply.error??'backup artifact operation failed');if(typeof reply.sqliteCode==='string'&&BACKUP_SQLITE_CODES.has(reply.sqliteCode))Object.assign(failure,{code:reply.sqliteCode});reject(failure);}
      };
      const timer=setTimeout(()=>rejectAfterExit('backup artifact work exceeded 30s; pending artifacts preserved'),30_000);
      this.worker.once('message',message);this.worker.once('error',error);this.worker.once('exit',exited);
      try{this.worker.postMessage({id,deadlineAtMonoNs,task} satisfies BackupArtifactRequest);}catch{rejectAfterExit('backup artifact worker failed; pending artifacts preserved');}
    });
  }
  close(){
    if(!this.closing){this.failed=true;Atomics.store(this.cancellation,0,1);this.closing=(async()=>{try{await this.worker.terminate();}finally{await this.exited;}})();}
    return this.closing;
  }
}

/** Two standalone completed SQLite backups and one bounded in-progress artifact.
 * No timer, network, financial action, account initialization or source-file copy.
 */
export class FinancialBackupStore{
  readonly directory:string;
  readonly identity:BackupIdentity;
  private readonly sourcePath:string;
  private readonly maxBytes:number;
  private readonly persistent:boolean;private readonly minimumFreeBytes:number;
  private staged:{path:string;own:Stats;source:Stats;completed:FinancialBackup[];minimumRevision:number;validated:boolean;copy?:ReadonlyFinancialSnapshotCopy}|undefined;
  private recoverySource:RecoverySource|undefined;
  private workerOperation:BackupOperationLease|undefined;private workerLeaseAcquired=false;private workerCancelled:(()=>boolean)|undefined;
  constructor(options:Options){
    this.directory=resolve(options.directory);
    const source=resolve(options.sourcePath);let sourceParent=dirname(source);
    try{sourceParent=realpathSync(sourceParent);}catch(error){if(!(error instanceof Error&&'code' in error&&['ENOENT','EACCES'].includes(String(error.code))))throw error;}
    this.sourcePath=join(sourceParent,basename(source));
    this.identity={...options.identity};this.persistent=options.persistent===true;this.minimumFreeBytes=options.minimumFreeBytes??256*1024*1024;this.maxBytes=this.persistent?Number.MAX_SAFE_INTEGER:options.maxBytes??64*1024*1024;
    if(options.persistent!==undefined&&typeof options.persistent!=='boolean'||!Number.isSafeInteger(this.minimumFreeBytes)||this.minimumFreeBytes<1024*1024||!Number.isSafeInteger(this.maxBytes)||this.maxBytes<4096||!this.persistent&&this.maxBytes>1024*1024*1024)throw new Error('bounded backup size required');
    if(!Number.isSafeInteger(this.identity.inceptionAt)||this.identity.inceptionAt<0||!['PAPER','DISPOSABLE_PAPER'].includes(this.identity.mode)||!this.identity.accountId)throw new Error('actual backup identity required');
    if(this.sourcePath.startsWith(this.directory+'/'))throw new Error('backup directory must not contain source financial state');
    if(realpathSync(dirname(this.directory))!==dirname(this.directory))throw new Error('canonical backup parent required');
    try{mkdirSync(this.directory,{mode:0o700});}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='EEXIST'))throw error;}
    this.checkDirectory();
  }
  private checkDirectory(){
    const s=lstatSync(this.directory);
    if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700||realpathSync(this.directory)!==this.directory)throw new Error('private canonical owner-held backup directory required');
  }
  private privateFile(path:string):Stats{
    const s=lstatSync(path);
    if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.nlink!==1||s.size>this.maxBytes)throw new Error('private bounded regular backup/source file required');
    return s;
  }
  private checkSourceSize(){
    let size=this.privateFile(this.sourcePath).size;
    try{size+=this.privateFile(this.sourcePath+'-wal').size;}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    if(size>this.maxBytes)throw new Error('source database and active WAL exceed backup size limit');
    // A growing durable journal is not a reason to abandon the operating
    // account. Keep two complete same-account generations, and require room for
    // the next standalone copy plus an actual financial-write disk reserve.
    if(this.persistent){const disk=statfsSync(this.directory),free=disk.bavail*disk.bsize;if(!Number.isSafeInteger(free)||free<size+this.minimumFreeBytes)throw new Error('backup disk headroom unavailable; financial source and prior backups retained');}
  }
  private scan(){
    this.checkDirectory();const dir=opendirSync(this.directory),completed:{name:string;generation:string}[]=[],unknown:string[]=[];let pending=false,capsule=false,capsuleRefusal:Error|undefined;
    try{
      for(let count=0;;count++){
        const entry=dir.readSync();if(!entry)break;if(count>=32)throw new Error('backup directory entry bound exceeded; nothing removed');
        const match=NAME.exec(entry.name);
        if(match)completed.push({name:entry.name,generation:match[1]!});
        else if(entry.name===PENDING||entry.name===PENDING+'-wal'||entry.name===PENDING+'-shm'||entry.name===PENDING+'-journal')pending=true;
        else if(entry.name===RECOVERY)capsule=true;
        else if(entry.name===OPERATION_LOCK){try{this.privateFile(join(this.directory,OPERATION_LOCK));}catch{unknown.push(entry.name);}}
        else unknown.push(entry.name);
      }
    }finally{dir.closeSync();}
    completed.sort((a,b)=>a.generation.localeCompare(b.generation));
    if(capsule){
      try{if(this.recoveryInitializing())pending=true;else{const state=this.recoveryCapsule();if(state.completed)this.ensureCompletedRecoveryOriginals(state.manifest);else pending=true;}}
      catch(error){unknown.push(RECOVERY);pending=true;capsuleRefusal=error instanceof Error?error:new Error('backup recovery capsule metadata invalid; originals preserved');}
    }
    return {completed,unknown,pending,capsule,capsuleRefusal};
  }
  private inspect(path:string,generation:string,requireStandalone=true,expected?:ReadonlyFinancialSnapshotCopy):FinancialBackup{
    const file=this.privateFile(path);let source:Stats|undefined;
    try{source=statSync(this.sourcePath);}catch(error){if(!(error instanceof Error&&'code' in error&&['ENOENT','EACCES'].includes(String(error.code))))throw error;}
    if(source&&file.dev===source.dev&&file.ino===source.ino)throw new Error('source financial database cannot be a backup retention target');
    if(requireStandalone){
      const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),header=Buffer.alloc(100);
      try{if(readSync(fd,header,0,100,0)!==100||header[18]!==1||header[19]!==1)throw new Error('backup is not a standalone normalized artifact');}finally{closeSync(fd);}
    }
    const db=new Database(path,{readonly:true,fileMustExist:true,timeout:100});
    try{
      if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('backup integrity failure');
      if(requireStandalone&&db.pragma('journal_mode',{simple:true})!=='delete')throw new Error('backup is not a standalone normalized artifact');
      const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 5").all() as {name:string}[];
      if(tables.map(x=>x.name).sort().join(',')!=='actions,financial_state,journal,metadata')throw new Error('backup schema mismatch');
      const size=db.prepare('SELECT length(body) size FROM financial_state WHERE singleton=1').get() as {size:number}|undefined;
      if(!size||size.size>1_048_576)throw new Error('backup account absent or oversized');
      const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string};
      const state=JSON.parse(row.body) as LedgerState;
      if(expected&&(createHash('sha256').update(row.body).digest('hex')!==expected.stateSha256||state.revision!==expected.revision||state.lastAt!==expected.lastAt))throw new Error('backup differs from captured readonly financial snapshot');
      validateFinancialState(state,this.identity.accountId,this.identity.mode);
      if(state.inceptionAt!==this.identity.inceptionAt)throw new Error('backup inception identity mismatch');
      const costSize=db.prepare("SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key='operating_costs'").get() as {size:number}|undefined;
      if(costSize){
        if(costSize.size>262_144)throw new Error('backup operating cost metadata limit');
        const row=db.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get() as {value:string};
        const costs=JSON.parse(row.value) as OperatingCostState;validateOperatingCosts(costs);
        if(costs.accountId!==state.accountId||costs.inceptionAt!==state.inceptionAt||costs.lastRecordedAt>state.lastAt)throw new Error('backup operating cost account/inception chronology mismatch');
      }else for(const [from,through] of [['cost:','cost;'],['cost-valuation:','cost-valuation;']]){
        if(db.prepare('SELECT 1 FROM actions WHERE id>=? AND id<? LIMIT 1').get(from,through)||db.prepare('SELECT 1 FROM journal WHERE action_id>=? AND action_id<? LIMIT 1').get(from,through))throw new Error('backup operating cost metadata missing from recorded history');
      }
      const journal=db.prepare('SELECT revision,at FROM journal ORDER BY revision DESC LIMIT 1').get() as {revision:number;at:number}|undefined;
      if(!journal||journal.revision!==state.revision||journal.at!==state.lastAt)throw new Error('backup journal/state mismatch');
      const counts=db.prepare('SELECT (SELECT count(*) FROM journal) journal,(SELECT count(*) FROM actions) actions,(SELECT min(revision) FROM journal) first').get() as {journal:number;actions:number;first:number};
      if(counts.journal!==state.revision+1||counts.actions!==state.revision||counts.first!==0)throw new Error('backup financial history incomplete');
      if(db.prepare('SELECT action_id FROM journal WHERE revision>0 EXCEPT SELECT id FROM actions LIMIT 1').get())throw new Error('backup financial action identity mismatch');
      const inception=db.prepare('SELECT at,kind FROM journal WHERE revision=0').get() as {at:number;kind:string}|undefined;
      if(inception?.kind!=='inception'||inception.at!==state.inceptionAt)throw new Error('backup inception mismatch');
      const metadata=db.prepare("SELECT key,length(value) size FROM metadata WHERE key IN ('reporting_history','reporting_history_operating_v2','snapshot_sequence','reporting_trades')").all() as {key:string;size:number}[];
      if(metadata.some(x=>x.size>262_144))throw new Error('backup metadata bound exceeded');
      const historyRow=db.prepare("SELECT value FROM metadata WHERE key='reporting_history'").get() as {value:string}|undefined;
      if(!historyRow)throw new Error('backup inception history absent');
      const history=JSON.parse(historyRow.value) as ReportingHistory;let previous=-Infinity;
      if(!history||typeof history!=='object'||Object.keys(history).sort().join(',')!=='downsampled,points,windowLimited'||!Array.isArray(history.points)||history.points.length>720||typeof history.windowLimited!=='boolean'||typeof history.downsampled!=='boolean')throw new Error('backup reporting history malformed');
      for(const point of history.points){if(!point||Object.keys(point).sort().join(',')!=='at,economicMicroUsd,tradingMicroUsd'||!Number.isSafeInteger(point.at)||point.at<=previous||point.at<state.inceptionAt||![point.tradingMicroUsd,point.economicMicroUsd].every(v=>v===null||typeof v==='string'&&/^-?(0|[1-9][0-9]{0,38})$/.test(v)&&BigInt(v.replace(/^-/,''))<=(1n<<127n)-1n))throw new Error('backup reporting history chronology/value mismatch');previous=point.at;}
      if(!history.windowLimited&&(history.points[0]?.at!==state.inceptionAt||history.points[0]?.tradingMicroUsd!=='0'))throw new Error('backup reporting inception mismatch');
      const operatingHistoryRow=db.prepare('SELECT value FROM metadata WHERE key=?').get(REPORTING_OPERATING_HISTORY_KEY) as {value:string}|undefined;
      if(operatingHistoryRow)validateOperatingReportingHistory(JSON.parse(operatingHistoryRow.value),state.inceptionAt);
      const tradesRow=db.prepare("SELECT value FROM metadata WHERE key='reporting_trades'").get() as {value:string}|undefined;
      if(tradesRow){
        const cache=validateReportingTradeCache(JSON.parse(tradesRow.value),state.accountId,state.inceptionAt,state.lastAt);
        for(const trade of cache.trades){
          const attempt=db.prepare('SELECT j.at,j.kind,j.detail,a.result FROM journal j JOIN actions a ON a.id=j.action_id WHERE j.action_id=?').get(trade.actionId) as {at:number;kind:string;detail:string;result:string}|undefined;
          if(!attempt||attempt.kind!=='attempt'||Buffer.byteLength(attempt.detail)>65536)throw Error('backup reporting trade attempt absent');
          const payload=JSON.parse(attempt.detail),order=db.prepare('SELECT detail FROM journal WHERE action_id=?').get('order:'+payload.orderId) as {detail:string}|undefined;
          if(!order||Buffer.byteLength(order.detail)>65536||!isDeepStrictEqual(trade,reportingFilledTrade(trade.actionId,attempt.at,payload,JSON.parse(order.detail),JSON.parse(attempt.result))))throw Error('backup reporting trade durable evidence mismatch');
        }
      }
      const sequence=db.prepare("SELECT value FROM metadata WHERE key='snapshot_sequence'").get() as {value:string}|undefined;
      if(sequence&&!/^[1-9][0-9]{0,39}$/.test(sequence.value))throw new Error('backup sequence malformed');
      if(expected&&(sequence?.value??null)!==expected.snapshotSequence)throw new Error('backup sequence differs from captured readonly financial snapshot');
      return {...this.identity,path,generation,revision:state.revision,lastAt:state.lastAt,snapshotSequence:sequence?.value??null};
    }finally{db.close();}
  }
  /** Read-only selection never deletes corrupt, foreign or unknown paths. */
  latest():BackupSelection{
    const scan=this.scan(),rejected:BackupSelection['rejected']=scan.unknown.map(file=>({file,reason:'unrecognized-path'}));let backup:FinancialBackup|null=null;
    for(const item of [...scan.completed].reverse()){
      try{const valid=this.inspect(join(this.directory,item.name),item.generation);if(!backup)backup=valid;}
      catch{rejected.push({file:item.name,reason:'invalid-backup'});}
    }
    return {backup,rejected,pending:scan.pending};
  }
  private validatedRetention(scan:ReturnType<FinancialBackupStore['scan']>){
    if(scan.completed.length>2||scan.unknown.length)throw new Error('backup retention layout needs review; nothing removed');
    return scan.completed.map(item=>this.inspect(join(this.directory,item.name),item.generation));
  }
  private ready(){
    const scan=this.scan();if(scan.capsuleRefusal)throw scan.capsuleRefusal;
    if(scan.capsule&&(this.recoveryInitializing()||!this.recoveryCapsule().completed))throw new Error('pending backup requires explicit recovery; nothing overwritten');
    const completed=this.validatedRetention(scan);return {scan,completed};
  }

  private recoveryPath(name=''){return join(this.directory,RECOVERY,name);}
  private recoveryDirectory(){
    const path=this.recoveryPath(),s=lstatSync(path);
    if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700||realpathSync(path)!==path)throw new Error('backup recovery capsule identity invalid; originals preserved');
    const dir=opendirSync(path);try{for(let count=0;;count++){const e=dir.readSync();if(!e)break;if(count>=RECOVERY_NAMES.size||!RECOVERY_NAMES.has(e.name))throw new Error('backup recovery capsule layout invalid; originals preserved');this.privateFile(join(path,e.name));}}finally{dir.closeSync();}
  }
  private optionalRecoveryFile(path:string):Stats|undefined{
    try{return this.privateFile(path);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return;throw error;}
  }
  private recoveryFence(){this.workerFence();this.stagedSourceCurrent();}
  private recoveryMetadata(name:string):{raw:string;value:unknown;sha256:string}|null{
    const path=this.recoveryPath(name),file=this.optionalRecoveryFile(path);if(!file)return null;
    if(file.size>16_384)throw new Error('backup recovery capsule metadata invalid; originals preserved');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),bytes=Buffer.alloc(file.size);
    try{const before=fstatSync(fd);if(before.dev!==file.dev||before.ino!==file.ino||readSync(fd,bytes,0,bytes.length,0)!==bytes.length)throw new Error('backup recovery capsule metadata changed; originals preserved');const after=fstatSync(fd),named=this.privateFile(path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||named.dev!==before.dev||named.ino!==before.ino)throw new Error('backup recovery capsule metadata changed; originals preserved');}finally{closeSync(fd);}
    const raw=bytes.toString('utf8');let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error('backup recovery capsule metadata invalid; originals preserved');}
    return {raw,value,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  private writeRecoveryMetadata(name:string,value:unknown){
    this.recoveryFence();const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>16_384)throw new Error('backup recovery capsule metadata invalid; originals preserved');
    const final=this.recoveryPath(name),temporary=this.recoveryPath(name+'.tmp');
    if(this.optionalRecoveryFile(final))throw new Error('backup recovery capsule metadata changed; originals preserved');
    // Only fixed, private scratch metadata can be replaced. The immutable final
    // record is never opened for writing or truncated.
    if(this.optionalRecoveryFile(temporary))unlinkSync(temporary);
    const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{for(let at=0;at<bytes.length;){this.recoveryFence();const n=writeSync(fd,bytes,at,bytes.length-at);if(n<=0)throw new Error('backup recovery capsule metadata write failed; originals preserved');at+=n;}fsyncSync(fd);}finally{closeSync(fd);}
    this.publishRecoveryMetadata(name);
  }
  private publishRecoveryMetadata(name:string){
    this.recoveryFence();if(this.optionalRecoveryFile(this.recoveryPath(name)))throw new Error('backup recovery capsule metadata changed; originals preserved');
    this.privateFile(this.recoveryPath(name+'.tmp'));renameSync(this.recoveryPath(name+'.tmp'),this.recoveryPath(name));this.syncRecoveryDirectory();
  }
  private recoveryInitializing(){
    this.recoveryDirectory();if(this.optionalRecoveryFile(this.recoveryPath('manifest.json')))return false;
    // An interrupted mkdir/temp write cannot have moved an original: relocation
    // starts only after the immutable manifest was published and synced.
    const dir=opendirSync(this.recoveryPath());
    try{for(let count=0;;count++){const e=dir.readSync();if(!e)break;if(count>=1||e.name!=='manifest.json.tmp')throw new Error('backup recovery capsule initialization incomplete; originals preserved');}}
    finally{dir.closeSync();}return true;
  }
  private syncRecoveryDirectory(){const fd=openSync(this.recoveryPath(),constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
  private recoveryRecord(value:unknown,suffix?:string):value is RecoveryFile{
    if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as RecoveryFile;
    return Object.keys(v).sort().join(',')==='ctimeNs,dev,ino,mtimeNs,sha256,size,suffix'&&typeof v.suffix==='string'&&RECOVERY_SUFFIXES.some(s=>s===v.suffix)&&(suffix===undefined||v.suffix===suffix)&&[v.dev,v.ino,v.mtimeNs,v.ctimeNs].every(x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x))&&Number.isSafeInteger(v.size)&&v.size>=0&&v.size<=this.maxBytes&&typeof v.sha256==='string'&&/^[0-9a-f]{64}$/.test(v.sha256);
  }
  private recoveryCapsule(){
    this.recoveryDirectory();const original=this.recoveryMetadata('manifest.json');
    if(!original)throw new Error('backup recovery capsule initialization incomplete; originals preserved');
    const m=original.value as RecoveryManifest;
    if(!m||typeof m!=='object'||Object.keys(m).sort().join(',')!=='files,identity,source,version'||m.version!==1||!isDeepStrictEqual(m.identity,this.identity)||!m.source||Object.keys(m.source).sort().join(',')!=='dev,ino'||![m.source.dev,m.source.ino].every(x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x))||!Array.isArray(m.files)||m.files.length<2||m.files.length>4||m.files.some(x=>!this.recoveryRecord(x))||m.files.map(x=>x.suffix).join(',')!==RECOVERY_SUFFIXES.filter(s=>m.files.some(x=>x.suffix===s)).join(',')||!m.files.some(x=>x.suffix==='')||!m.files.some(x=>x.suffix==='-journal'))throw new Error('backup recovery capsule metadata invalid; originals preserved');
    const checked=this.recoveryMetadata('validated.json'),done=this.recoveryMetadata('completed.json');let validated:RecoveryValidated|null=null,completed:RecoveryCompleted|null=null;
    if(checked){const v=checked.value as RecoveryValidated;if(!v||Object.keys(v).sort().join(',')!=='file,lastAt,manifestSha256,revision,snapshotSequence,target,version'||v.version!==1||v.manifestSha256!==original.sha256||!this.recoveryRecord(v.file,'')||!NAME.test(v.target)||!Number.isSafeInteger(v.revision)||v.revision<0||!Number.isSafeInteger(v.lastAt)||v.lastAt<0||!(v.snapshotSequence===null||typeof v.snapshotSequence==='string'&&/^(0|[1-9][0-9]*)$/.test(v.snapshotSequence)))throw new Error('backup recovery capsule metadata invalid; originals preserved');validated=v;}
    if(done){const v=done.value as RecoveryCompleted;if(!v||Object.keys(v).sort().join(',')!=='disposition,manifestSha256,validatedSha256,version'||v.version!==1||v.manifestSha256!==original.sha256||!(v.disposition==='PROMOTED'&&validated&&v.validatedSha256===checked!.sha256||v.disposition==='PRESERVED_INCOMPLETE_STAGING'&&!validated&&v.validatedSha256===null))throw new Error('backup recovery capsule metadata invalid; originals preserved');completed=v;}
    return {manifest:m,manifestSha256:original.sha256,validated,validatedSha256:checked?.sha256??null,completed};
  }
  private recoveryFileIdentity(path:string,expected:RecoveryFile){
    this.privateFile(path);const s=lstatSync(path,{bigint:true});
    if(s.dev.toString()!==expected.dev||s.ino.toString()!==expected.ino||s.size!==BigInt(expected.size)||s.mtimeNs.toString()!==expected.mtimeNs)throw new Error('backup recovery original identity changed; originals preserved');
  }
  private fingerprintRecoveryFile(path:string,suffix:string):RecoveryFile{
    this.recoveryFence();this.privateFile(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const before=fstatSync(fd,{bigint:true}),named=lstatSync(path,{bigint:true});if(before.dev!==named.dev||before.ino!==named.ino||before.size>BigInt(this.maxBytes))throw new Error('backup recovery original identity changed; originals preserved');
      const digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
      while(offset<Number(before.size)){this.recoveryFence();const n=readSync(fd,buffer,0,Math.min(buffer.length,Number(before.size)-offset),offset);if(n<=0)throw new Error('backup recovery original identity changed; originals preserved');digest.update(buffer.subarray(0,n));offset+=n;}
      const after=fstatSync(fd,{bigint:true}),current=lstatSync(path,{bigint:true});if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||current.dev!==before.dev||current.ino!==before.ino||current.size!==before.size||current.mtimeNs!==before.mtimeNs||current.ctimeNs!==before.ctimeNs)throw new Error('backup recovery original identity changed; originals preserved');
      fsyncSync(fd);this.recoveryFence();
      return {suffix,dev:before.dev.toString(),ino:before.ino.toString(),size:Number(before.size),mtimeNs:before.mtimeNs.toString(),ctimeNs:before.ctimeNs.toString(),sha256:digest.digest('hex')};
    }finally{closeSync(fd);}
  }
  private authenticateRecoveryFile(path:string,expected:RecoveryFile){
    this.recoveryFileIdentity(path,expected);if(this.fingerprintRecoveryFile(path,expected.suffix).sha256!==expected.sha256)throw new Error('backup recovery original bytes changed; originals preserved');
  }
  /** The producer never uses ATTACH. A SQLite super-journal footer can name a
   * file outside this capsule, so conservatively refuse its magic at EOF. */
  private rejectSuperJournal(path:string){
    const file=this.privateFile(path);if(file.size<16)return;const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),tail=Buffer.alloc(16);
    try{const s=fstatSync(fd);if(s.dev!==file.dev||s.ino!==file.ino||readSync(fd,tail,0,16,file.size-16)!==16)throw new Error('backup recovery journal changed; originals preserved');if(tail.subarray(8).equals(Buffer.from('d9d505f920a163d7','hex')))throw new Error('backup recovery super-journal reference refused; originals preserved');}finally{closeSync(fd);}
  }
  private moveRecoveryOriginal(from:string,to:string){
    this.recoveryFence();renameSync(from,to);this.syncRecoveryDirectory();this.syncDirectory();
  }
  private relocateRecoveryOriginals(manifest:RecoveryManifest){
    for(const suffix of RECOVERY_SUFFIXES){const row=manifest.files.find(x=>x.suffix===suffix),from=join(this.directory,PENDING+suffix),to=this.recoveryPath('original.sqlite'+suffix),a=this.optionalRecoveryFile(from),b=this.optionalRecoveryFile(to);
      if(!row){if(a||b)throw new Error('backup recovery family changed; originals preserved');continue;}
      if(Boolean(a)===Boolean(b))throw new Error('backup recovery family location ambiguous; originals preserved');
      this.authenticateRecoveryFile(a?from:to,row);if(a)this.moveRecoveryOriginal(from,to);
    }
    this.recoveryFence();
  }
  private ensureCompletedRecoveryOriginals(manifest:RecoveryManifest){
    for(const suffix of RECOVERY_SUFFIXES){const row=manifest.files.find(x=>x.suffix===suffix),path=this.recoveryPath('original.sqlite'+suffix);if(row)this.recoveryFileIdentity(path,row);else if(this.optionalRecoveryFile(path))throw new Error('backup recovery family changed; originals preserved');}
  }
  private clearRecoveryCandidate(){
    for(const suffix of RECOVERY_SUFFIXES){const path=this.recoveryPath('candidate.sqlite'+suffix);if(this.optionalRecoveryFile(path)){this.recoveryFence();unlinkSync(path);}}
    this.syncRecoveryDirectory();
  }
  private clearValidatedCandidateSidecars(){
    // SQLite has settled and the candidate has passed full standalone (or exact
    // empty) validation. These are our disposable copy's residual sidecars;
    // the original family remains intact and is never opened by SQLite.
    for(const suffix of RECOVERY_SUFFIXES.slice(1)){const path=this.recoveryPath('candidate.sqlite'+suffix);if(this.optionalRecoveryFile(path)){this.recoveryFence();unlinkSync(path);}}
    this.syncRecoveryDirectory();
  }
  private copyRecoveryCandidate(manifest:RecoveryManifest){
    const total=manifest.files.reduce((n,row)=>n+row.size,0),disk=statfsSync(this.directory),free=disk.bavail*disk.bsize;
    if(!Number.isSafeInteger(total)||!Number.isSafeInteger(free)||free<total+this.minimumFreeBytes)throw new Error('backup disk headroom unavailable; financial source and prior backups retained');
    for(const row of manifest.files){
      this.recoveryFence();const from=this.recoveryPath('original.sqlite'+row.suffix),to=this.recoveryPath('candidate.sqlite'+row.suffix);this.recoveryFileIdentity(from,row);
      const input=openSync(from,constants.O_RDONLY|constants.O_NOFOLLOW);let output:number|undefined;
      try{
        output=openSync(to,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
        const stat=fstatSync(input,{bigint:true});if(stat.dev.toString()!==row.dev||stat.ino.toString()!==row.ino)throw new Error('backup recovery original identity changed; originals preserved');
        const digest=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
        while(offset<row.size){this.recoveryFence();const n=readSync(input,buffer,0,Math.min(buffer.length,row.size-offset),offset);if(n<=0)throw new Error('backup recovery original identity changed; originals preserved');digest.update(buffer.subarray(0,n));for(let at=0;at<n;){this.recoveryFence();const written=writeSync(output,buffer,at,n-at);if(written<=0)throw new Error('backup recovery candidate copy incomplete; originals preserved');at+=written;}offset+=n;}
        const after=fstatSync(input,{bigint:true});if(after.size!==stat.size||after.mtimeNs!==stat.mtimeNs||after.ctimeNs!==stat.ctimeNs||digest.digest('hex')!==row.sha256)throw new Error('backup recovery original bytes changed; originals preserved');fsyncSync(output);
      }finally{if(output!==undefined)closeSync(output);closeSync(input);}
      this.recoveryFileIdentity(from,row);
    }
    this.syncRecoveryDirectory();this.recoveryFence();
  }
  /** Reading the candidate read-write lets SQLite perform its own hot rollback.
   * Originals and the live financial source are never opened for writing here. */
  private recoverCandidateIsEmpty(path:string){
    this.recoveryFence();this.rejectSuperJournal(path+'-journal');const db=new Database(path,{fileMustExist:true,timeout:100});
    try{
      const schema=db.prepare('SELECT count(*) AS count FROM sqlite_schema').get() as {count:number};
      if(schema.count!==0||db.pragma('page_count',{simple:true})!==0||db.pragma('freelist_count',{simple:true})!==0)return false;
      if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('backup integrity failure');
      return true;
    }finally{db.close();this.recoveryFence();}
  }
  private recoveryTarget(completed:FinancialBackup[]){
    const next=(BigInt(completed.at(-1)?.generation??'0')+1n).toString().padStart(20,'0');if(next.length>20)throw new Error('backup generation exhausted');return PREFIX+next+'.sqlite';
  }
  private finishRecoveryPromotion(state:ReturnType<FinancialBackupStore['recoveryCapsule']>,completed:FinancialBackup[]):FinancialBackup{
    const receipt=state.validated;if(!receipt)throw new Error('backup recovery validated receipt required; originals preserved');
    const candidate=this.recoveryPath('candidate.sqlite'),target=join(this.directory,receipt.target),a=this.optionalRecoveryFile(candidate),b=this.optionalRecoveryFile(target);
    if(Boolean(a)===Boolean(b))throw new Error('backup recovery promotion location ambiguous; originals preserved');
    for(const suffix of RECOVERY_SUFFIXES.slice(1))if(this.optionalRecoveryFile(candidate+suffix))throw new Error('backup recovery validated sidecar unexpected; originals preserved');
    const path=a?candidate:target;this.authenticateRecoveryFile(path,receipt.file);const valid=this.inspect(path,a?'0':NAME.exec(receipt.target)![1]!);
    if(valid.revision!==receipt.revision||valid.lastAt!==receipt.lastAt||valid.snapshotSequence!==receipt.snapshotSequence)throw new Error('backup recovery validated receipt mismatch; originals preserved');
    if(a&&this.recoveryTarget(completed)!==receipt.target)throw new Error('backup recovery promotion target changed; originals preserved');
    const promoted=a?this.promote(valid,completed):valid;this.syncRecoveryDirectory();this.recoveryFence();
    this.writeRecoveryMetadata('completed.json',{version:1,manifestSha256:state.manifestSha256,disposition:'PROMOTED',validatedSha256:state.validatedSha256} satisfies RecoveryCompleted);
    return promoted;
  }
  private recoverJournalFamily(scan:ReturnType<FinancialBackupStore['scan']>,completed:FinancialBackup[]):FinancialBackup|null{
    const rootPending=join(this.directory,PENDING),source=this.privateFile(this.sourcePath);
    this.recoverySource={dev:String(source.dev),ino:String(source.ino)};
    try{
      if(!scan.capsule||this.recoveryInitializing()){
        const files=RECOVERY_SUFFIXES.flatMap(s=>this.optionalRecoveryFile(rootPending+s)?[this.fingerprintRecoveryFile(rootPending+s,s)]:[]);
        if(!files.some(x=>x.suffix==='')||!files.some(x=>x.suffix==='-journal'))throw new Error('backup recovery paired pending journal required; originals preserved');
        this.rejectSuperJournal(rootPending+'-journal');this.recoveryFence();if(!scan.capsule){mkdirSync(this.recoveryPath(),{mode:0o700});this.syncDirectory();}
        this.writeRecoveryMetadata('manifest.json',{version:1,identity:this.identity,source:this.recoverySource,files} satisfies RecoveryManifest);
      }
      const state=this.recoveryCapsule();this.recoverySource=state.manifest.source;this.recoveryFence();
      if(state.completed)throw new Error('backup recovery capsule already occupied; second journal preserved');
      this.relocateRecoveryOriginals(state.manifest);this.rejectSuperJournal(this.recoveryPath('original.sqlite-journal'));
      if(state.validated)return this.finishRecoveryPromotion(state,completed);
      this.clearRecoveryCandidate();this.copyRecoveryCandidate(state.manifest);
      const candidate=this.recoveryPath('candidate.sqlite');
      if(this.recoverCandidateIsEmpty(candidate)){
        if(completed.length===0)throw new Error('backup empty recovery requires verified prior backup; originals preserved');
        this.clearValidatedCandidateSidecars();this.recoveryFence();this.writeRecoveryMetadata('completed.json',{version:1,manifestSha256:state.manifestSha256,disposition:'PRESERVED_INCOMPLETE_STAGING',validatedSha256:null} satisfies RecoveryCompleted);
        return null;
      }
      this.normalize(candidate);this.recoveryFence();const valid=this.inspect(candidate,'0');this.clearValidatedCandidateSidecars();const file=this.fingerprintRecoveryFile(candidate,'');
      const receipt:RecoveryValidated={version:1,manifestSha256:state.manifestSha256,file,target:this.recoveryTarget(completed),revision:valid.revision,lastAt:valid.lastAt,snapshotSequence:valid.snapshotSequence};
      this.writeRecoveryMetadata('validated.json',receipt);const checked=this.recoveryMetadata('validated.json')!;
      const promoted=this.promote(valid,completed);this.syncRecoveryDirectory();this.recoveryFence();
      this.writeRecoveryMetadata('completed.json',{version:1,manifestSha256:state.manifestSha256,disposition:'PROMOTED',validatedSha256:checked.sha256} satisfies RecoveryCompleted);
      return promoted;
    }finally{this.recoverySource=undefined;}
  }

  private normalize(path:string){
    // SQLite backup inherits a WAL header. Normalize ONLY this completed staging
    // copy so read-only consumers do not create persistent WAL/SHM sidecars.
    const db=new Database(path,{fileMustExist:true,timeout:100});
    try{
      db.pragma('wal_checkpoint(TRUNCATE)');
      if(db.pragma('journal_mode=DELETE',{simple:true})!=='delete')throw new Error('backup journal normalization failed');
    }finally{db.close();}
    chmodSync(path,0o600);
  }
  private syncDirectory(){const fd=openSync(this.directory,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}}
  private validateOperationLease(operation:BackupOperationLease){
    this.checkDirectory();const path=join(this.directory,OPERATION_LOCK),named=this.privateFile(path),held=fstatSync(operation.fd);
    if(!held.isFile()||held.uid!==process.getuid?.()||(held.mode&0o777)!==0o600||held.nlink!==1||held.size>this.maxBytes||held.dev!==named.dev||held.ino!==named.ino||held.dev!==operation.dev||held.ino!==operation.ino)throw new Error('backup operation lease inode changed; nothing removed');
  }
  private openOperation():BackupOperationLease{
    this.checkDirectory();const fd=openSync(join(this.directory,OPERATION_LOCK),constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    try{const held=fstatSync(fd),operation={fd,dev:held.dev,ino:held.ino};this.validateOperationLease(operation);return operation;}catch(error){closeSync(fd);throw error;}
  }
  private acquireOperation(){
    const operation=this.openOperation(),fd=operation.fd;
    try{
      const result=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','pipe',fd],timeout:5000});
      if(result.error||result.status!==0)throw new Error('backup operation already active or standard Linux flock unavailable');
      this.validateOperationLease(operation);
      return fd;
    }catch(error){closeSync(fd);throw error;}
  }
  /** Worker borrows the original validated FD. Only its parent closes it. */
  bindWorkerOperation(operation:BackupOperationLease,cancelled:()=>boolean){
    if(isMainThread||this.workerOperation||!Number.isSafeInteger(operation.fd)||operation.fd<0)throw new Error('backup worker operation scope required');
    this.validateOperationLease(operation);this.workerOperation={...operation};this.workerCancelled=cancelled;
  }
  private workerFence(){
    if(this.workerCancelled?.())throw new Error('backup artifact request cancelled or expired; pending artifacts preserved');
    if(this.workerOperation)this.validateOperationLease(this.workerOperation);
  }
  private acquireWorkerOperation(){
    if(isMainThread||!this.workerOperation||this.workerLeaseAcquired)throw new Error('backup worker lease acquisition scope required');
    this.workerFence();
    // spawnSync stays entirely in this worker. Parent termination cannot claim
    // settlement while its fixed nonblocking child is still in native work.
    const result=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',this.workerOperation.fd],timeout:5000});
    if(result.error||result.status!==0)throw new Error('backup operation already active or standard Linux flock unavailable');
    this.workerFence();this.workerLeaseAcquired=true;
  }
  private stagedSourceCurrent(){
    if(this.recoverySource){const current=this.privateFile(this.sourcePath);if(String(current.dev)!==this.recoverySource.dev||String(current.ino)!==this.recoverySource.ino)throw new Error('backup source inode changed; prior backups preserved');}
    const staged=this.staged;if(!staged)return;const source=this.privateFile(this.sourcePath);
    if(source.dev!==staged.source.dev||source.ino!==staged.source.ino)throw new Error('backup source inode changed; prior backups preserved');
  }
  private promote(valid:FinancialBackup,completed:FinancialBackup[]):FinancialBackup{
    this.workerFence();this.stagedSourceCurrent();
    const completedFd=openSync(valid.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(completedFd);}finally{closeSync(completedFd);}
    this.workerFence();this.stagedSourceCurrent();
    const newest=completed.at(-1);
    if(newest&&(valid.revision<newest.revision||newest.snapshotSequence!==null&&(valid.snapshotSequence===null||BigInt(valid.snapshotSequence)<BigInt(newest.snapshotSequence))))throw new Error('backup would regress durable history');
    const next=(BigInt(newest?.generation??'0')+1n).toString().padStart(20,'0');if(next.length>20)throw new Error('backup generation exhausted');
    const target=join(this.directory,PREFIX+next+'.sqlite');
    try{lstatSync(target);throw new Error('unexpected backup promotion target; nothing overwritten');}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    // The new staging copy is already validated. Remove at most one old verified
    // same-account copy before promotion, retaining another complete good backup.
    if(completed.length===2){this.inspect(completed[0]!.path,completed[0]!.generation);this.workerFence();this.stagedSourceCurrent();unlinkSync(completed[0]!.path);this.syncDirectory();}
    this.workerFence();this.stagedSourceCurrent();
    renameSync(valid.path,target);this.syncDirectory();return {...valid,path:target,generation:next};
  }
  async create(source:Source,runtime?:BackupRuntimePreparation):Promise<FinancialBackup>{
    let phase:BackupFailurePhase='operation-open',operation:BackupOperationLease|undefined,worker:ArtifactWorker|undefined;
    try{
      operation=this.openOperation();phase='source-anchor';
      // The private canonical path is anchored before this operation's first
      // yield. Its inode is never silently refreshed after worker preparation.
      const anchoredSource=this.privateFile(this.sourcePath),expectedSource={dev:anchoredSource.dev,ino:anchoredSource.ino};
      phase='worker-acquire';worker=this.artifactWorker(operation);await worker.request({task:'acquire'});
      phase='runtime-preparation';
      if(runtime&&!runtime.admission())throw new BackupPreparationDeferred();
      const prepare=()=>{const before=source.state();if(before.accountId!==this.identity.accountId||before.mode!==this.identity.mode||before.inceptionAt!==this.identity.inceptionAt)throw new Error('backup source identity mismatch');return before;};
      const before=runtime?runtime.measure(prepare):prepare();phase='artifact-prepare';await worker.request({task:'prepare',minimumRevision:before.revision,expectedSource});
      phase='runtime-preparation';
      if(runtime&&!runtime.admission())throw new BackupPreparationDeferred();
      phase='source-copy';
      if(this.persistent)await worker.request({task:'copy'});
      else await source.backup(join(this.directory,PENDING));
      phase='artifact-finish';
      const result=await worker.request({task:'finish'});if(!result)throw new Error('backup completion missing');return result;
    }catch(error){
      const failure=error instanceof BackupPreparationDeferred?error:new BackupOperationError(phase,error);
      try{await worker?.request({task:'abort'});}catch{/* A dead/timed-out worker leaves pending evidence for recovery. */}
      throw failure;
    }finally{try{await worker?.close();}finally{if(operation)closeSync(operation.fd);}}
  }
  private artifactWorker(operation:BackupOperationLease){return new ArtifactWorker({directory:this.directory,sourcePath:this.sourcePath,identity:this.identity,maxBytes:this.persistent?undefined:this.maxBytes,persistent:this.persistent,minimumFreeBytes:this.minimumFreeBytes},operation);}
  /** Runtime-safe pending maintenance; all SQLite artifact work runs off-thread. */
  async maintainPending():Promise<FinancialBackup|null>{
    let phase:BackupFailurePhase='operation-open',operation:BackupOperationLease|undefined,worker:ArtifactWorker|undefined;
    try{operation=this.openOperation();phase='worker-acquire';worker=this.artifactWorker(operation);await worker.request({task:'acquire'});phase='pending-recovery';return await worker.request({task:'recover'});}
    catch(error){throw new BackupOperationError(phase,error);}
    finally{try{await worker?.close();}finally{if(operation)closeSync(operation.fd);}}
  }
  /** Internal worker entry. The parent holds the operation lease across phases. */
  async runArtifactTask(message:BackupArtifactTask):Promise<FinancialBackup|null>{
    this.workerFence();
    if(message.task==='acquire'){this.acquireWorkerOperation();return null;}
    if(!this.workerLeaseAcquired)throw new Error('backup worker lease required');
    if(message.task==='recover')return this.recoverPendingOwned();
    if(message.task==='prepare'){
      if(this.staged||!Number.isSafeInteger(message.minimumRevision)||message.minimumRevision<0)throw new Error('backup preparation scope required');
      const source=this.privateFile(this.sourcePath);if(source.dev!==message.expectedSource.dev||source.ino!==message.expectedSource.ino)throw new Error('backup source inode changed; prior backups preserved');
      this.checkSourceSize();const {scan,completed}=this.ready();
      if(scan.pending)throw new Error('pending backup requires explicit recovery; nothing overwritten');
      this.workerFence();const current=this.privateFile(this.sourcePath);if(current.dev!==source.dev||current.ino!==source.ino)throw new Error('backup source inode changed; prior backups preserved');
      const path=join(this.directory,PENDING),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);closeSync(fd);
      this.staged={path,own:lstatSync(path),source,completed,minimumRevision:message.minimumRevision,validated:false};return null;
    }
    const staged=this.staged;if(!staged)return null;
    if(message.task==='copy'){
      if(!this.persistent||staged.copy)throw new Error('persistent backup copy scope required');
      this.stagedSourceCurrent();
      staged.copy=await copyReadonlyFinancialSnapshot({sourcePath:this.sourcePath,pendingPath:staged.path,identity:this.identity,expectedSource:{dev:staged.source.dev,ino:staged.source.ino},expectedPending:{dev:staged.own.dev,ino:staged.own.ino},minimumRevision:staged.minimumRevision,minimumFreeBytes:this.minimumFreeBytes,cancelled:()=>this.workerCancelled?.()??false});
      this.workerFence();this.stagedSourceCurrent();return null;
    }
    if(message.task==='finish'){
      if(this.persistent&&!staged.copy)throw new Error('captured readonly backup snapshot required');
      const pending=this.privateFile(staged.path);if(pending.dev!==staged.own.dev||pending.ino!==staged.own.ino)throw new Error('backup staging inode changed; nothing removed');
      this.stagedSourceCurrent();this.normalize(staged.path);this.workerFence();
      const valid=this.inspect(staged.path,'0',true,staged.copy);if(valid.revision<staged.minimumRevision)throw new Error('backup predates source observation');
      this.workerFence();this.stagedSourceCurrent();
      staged.validated=true;const result=this.promote(valid,staged.completed),sourceSnapshot=staged.copy?structuredClone(staged.copy):undefined;this.staged=undefined;return {...result,...(sourceSnapshot?{sourceSnapshot}:{})};
    }
    // Only this operation's incomplete inode is disposable; completed/foreign
    // files and a validated copy awaiting promotion are always preserved.
    try{const current=lstatSync(staged.path);if(!staged.validated&&current.dev===staged.own.dev&&current.ino===staged.own.ino){for(const suffix of ['-wal','-shm','']){const path=staged.path+suffix;try{const s=lstatSync(path);if(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&s.nlink===1&&(s.mode&0o077)===0)unlinkSync(path);}catch{}}}}catch{}
    this.staged=undefined;return null;
  }
  /** Explicitly complete a crash-left staging artifact only after identity checks. */
  recoverPending():FinancialBackup|null{
    const operation=this.acquireOperation();
    try{return this.recoverPendingOwned();}finally{closeSync(operation);}
  }
  private recoverPendingOwned():FinancialBackup|null{
      const scan=this.scan();if(scan.capsuleRefusal)throw scan.capsuleRefusal;if(!scan.pending)return null;
      const completed=this.validatedRetention(scan),path=join(this.directory,PENDING);
      if(scan.capsule&&(this.recoveryInitializing()||!this.recoveryCapsule().completed)||this.optionalRecoveryFile(path+'-journal'))return this.recoverJournalFamily(scan,completed);
      this.inspect(path,'0',false);this.normalize(path);
      return this.promote(this.inspect(path,'0'),completed);
  }
}
