import Database from 'better-sqlite3';
import {chmodSync,closeSync,constants,fsyncSync,lstatSync,mkdirSync,openSync,opendirSync,readSync,realpathSync,renameSync,statSync,unlinkSync,type Stats} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {validateFinancialState,type LedgerMode,type LedgerState,type PaperLedger,type ReportingHistory} from './ledger.js';
import {validateOperatingCosts,type OperatingCostState} from './costs.js';

export type BackupIdentity={accountId:string;mode:LedgerMode;inceptionAt:number};
export type FinancialBackup=BackupIdentity&{path:string;generation:string;revision:number;lastAt:number;snapshotSequence:string|null};
export type BackupSelection={backup:FinancialBackup|null;rejected:{file:string;reason:'invalid-backup'|'unrecognized-path'}[];pending:boolean};
type Source=Pick<PaperLedger,'state'|'backup'>;
type Options={directory:string;sourcePath:string;identity:BackupIdentity;maxBytes?:number};
export type BackupArtifactTask={task:'prepare';minimumRevision:number}|{task:'finish'|'abort'|'recover'};
const PREFIX='poe-financial-',PENDING='poe-financial-pending.sqlite';
const OPERATION_LOCK='.poe-backup.lock';
const NAME=/^poe-financial-([0-9]{20})\.sqlite$/;

/** One bounded worker per operation. Only artifact paths/identity cross threads. */
class ArtifactWorker{
  private readonly worker:Worker;
  private failed=false;
  constructor(options:Options){
    const source=import.meta.url.endsWith('.ts');
    // Register inside the source worker before resolving .js imports to .ts;
    // inheriting the parent's tsx preload alone does not register that thread.
    const register=source?'data:text/javascript,'+encodeURIComponent(`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();`):'';
    this.worker=new Worker(new URL(source?'./backup-worker.ts':'./backup-worker.js',import.meta.url),{workerData:options,execArgv:source?['--import',register]:[],env:{}});
    this.worker.on('error',()=>{this.failed=true;});
    this.worker.on('exit',()=>{this.failed=true;});
  }
  request(task:BackupArtifactTask):Promise<FinancialBackup|null>{
    if(this.failed)return Promise.reject(new Error('backup artifact worker unavailable; pending artifacts preserved'));
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);this.worker.off('message',message);this.worker.off('error',error);this.worker.off('exit',exited);};
      const error=()=>{cleanup();reject(new Error('backup artifact worker failed; pending artifacts preserved'));};
      const exited=()=>error();
      const message=(reply:{ok:boolean;result?:FinancialBackup|null;error?:string})=>{cleanup();if(reply.ok)resolve(reply.result??null);else reject(new Error(reply.error??'backup artifact operation failed'));};
      const timer=setTimeout(()=>{cleanup();this.failed=true;void this.worker.terminate();reject(new Error('backup artifact work exceeded 30s; pending artifacts preserved'));},30_000);
      this.worker.once('message',message);this.worker.once('error',error);this.worker.once('exit',exited);
      this.worker.postMessage(task);
    });
  }
  async close(){await this.worker.terminate();}
}

/** Two standalone completed SQLite backups and one bounded in-progress artifact.
 * No timer, network, financial action, account initialization or source-file copy.
 */
export class FinancialBackupStore{
  readonly directory:string;
  readonly identity:BackupIdentity;
  private readonly sourcePath:string;
  private readonly maxBytes:number;
  private staged:{path:string;own:Stats;completed:FinancialBackup[];minimumRevision:number;validated:boolean}|undefined;
  constructor(options:Options){
    this.directory=resolve(options.directory);
    const source=resolve(options.sourcePath);let sourceParent=dirname(source);
    try{sourceParent=realpathSync(sourceParent);}catch(error){if(!(error instanceof Error&&'code' in error&&['ENOENT','EACCES'].includes(String(error.code))))throw error;}
    this.sourcePath=join(sourceParent,basename(source));
    this.identity={...options.identity};this.maxBytes=options.maxBytes??64*1024*1024;
    if(!Number.isSafeInteger(this.maxBytes)||this.maxBytes<4096||this.maxBytes>1024*1024*1024)throw new Error('bounded backup size required');
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
  }
  private scan(){
    this.checkDirectory();const dir=opendirSync(this.directory),completed:{name:string;generation:string}[]=[],unknown:string[]=[];let pending=false;
    try{
      for(let count=0;;count++){
        const entry=dir.readSync();if(!entry)break;if(count>=32)throw new Error('backup directory entry bound exceeded; nothing removed');
        const match=NAME.exec(entry.name);
        if(match)completed.push({name:entry.name,generation:match[1]!});
        else if(entry.name===PENDING||entry.name===PENDING+'-wal'||entry.name===PENDING+'-shm')pending=true;
        else if(entry.name===OPERATION_LOCK){try{this.privateFile(join(this.directory,OPERATION_LOCK));}catch{unknown.push(entry.name);}}
        else unknown.push(entry.name);
      }
    }finally{dir.closeSync();}
    completed.sort((a,b)=>a.generation.localeCompare(b.generation));
    return {completed,unknown,pending};
  }
  private inspect(path:string,generation:string,requireStandalone=true):FinancialBackup{
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
      const metadata=db.prepare("SELECT key,length(value) size FROM metadata WHERE key IN ('reporting_history','snapshot_sequence')").all() as {key:string;size:number}[];
      if(metadata.some(x=>x.size>262_144))throw new Error('backup metadata bound exceeded');
      const historyRow=db.prepare("SELECT value FROM metadata WHERE key='reporting_history'").get() as {value:string}|undefined;
      if(!historyRow)throw new Error('backup inception history absent');
      const history=JSON.parse(historyRow.value) as ReportingHistory;let previous=-Infinity;
      if(!history||typeof history!=='object'||Object.keys(history).sort().join(',')!=='downsampled,points,windowLimited'||!Array.isArray(history.points)||history.points.length>720||typeof history.windowLimited!=='boolean'||typeof history.downsampled!=='boolean')throw new Error('backup reporting history malformed');
      for(const point of history.points){if(!point||Object.keys(point).sort().join(',')!=='at,economicMicroUsd,tradingMicroUsd'||!Number.isSafeInteger(point.at)||point.at<=previous||point.at<state.inceptionAt||![point.tradingMicroUsd,point.economicMicroUsd].every(v=>v===null||typeof v==='string'&&/^-?(0|[1-9][0-9]{0,38})$/.test(v)&&BigInt(v.replace(/^-/,''))<=(1n<<127n)-1n))throw new Error('backup reporting history chronology/value mismatch');previous=point.at;}
      if(!history.windowLimited&&(history.points[0]?.at!==state.inceptionAt||history.points[0]?.tradingMicroUsd!=='0'))throw new Error('backup reporting inception mismatch');
      const sequence=db.prepare("SELECT value FROM metadata WHERE key='snapshot_sequence'").get() as {value:string}|undefined;
      if(sequence&&!/^[1-9][0-9]{0,39}$/.test(sequence.value))throw new Error('backup sequence malformed');
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
  private ready(){
    const scan=this.scan();if(scan.completed.length>2||scan.unknown.length)throw new Error('backup retention layout needs review; nothing removed');
    const completed=scan.completed.map(item=>this.inspect(join(this.directory,item.name),item.generation));
    return {scan,completed};
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
  private acquireOperation(){
    this.checkDirectory();const path=join(this.directory,OPERATION_LOCK);
    const fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    try{
      this.privateFile(path);
      const result=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','pipe',fd],timeout:5000});
      if(result.error||result.status!==0)throw new Error('backup operation already active or standard Linux flock unavailable');
      return fd;
    }catch(error){closeSync(fd);throw error;}
  }
  private promote(valid:FinancialBackup,completed:FinancialBackup[]):FinancialBackup{
    const completedFd=openSync(valid.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(completedFd);}finally{closeSync(completedFd);}
    const newest=completed.at(-1);
    if(newest&&(valid.revision<newest.revision||newest.snapshotSequence!==null&&(valid.snapshotSequence===null||BigInt(valid.snapshotSequence)<BigInt(newest.snapshotSequence))))throw new Error('backup would regress durable history');
    const next=(BigInt(newest?.generation??'0')+1n).toString().padStart(20,'0');if(next.length>20)throw new Error('backup generation exhausted');
    const target=join(this.directory,PREFIX+next+'.sqlite');
    try{lstatSync(target);throw new Error('unexpected backup promotion target; nothing overwritten');}catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;}
    // The new staging copy is already validated. Remove at most one old verified
    // same-account copy before promotion, retaining another complete good backup.
    if(completed.length===2){this.inspect(completed[0]!.path,completed[0]!.generation);unlinkSync(completed[0]!.path);this.syncDirectory();}
    renameSync(valid.path,target);this.syncDirectory();return {...valid,path:target,generation:next};
  }
  async create(source:Source):Promise<FinancialBackup>{
    const operation=this.acquireOperation();
    let worker:ArtifactWorker|undefined;
    try{
      const before=source.state();if(before.accountId!==this.identity.accountId||before.mode!==this.identity.mode||before.inceptionAt!==this.identity.inceptionAt)throw new Error('backup source identity mismatch');
      worker=this.artifactWorker();await worker.request({task:'prepare',minimumRevision:before.revision});
      // The existing sole financial connection performs the SQLite backup API.
      // The worker never opens the source database or receives financial state.
      await source.backup(join(this.directory,PENDING));
      const result=await worker.request({task:'finish'});if(!result)throw new Error('backup completion missing');return result;
    }catch(error){
      try{await worker?.request({task:'abort'});}catch{/* A dead/timed-out worker leaves pending evidence for recovery. */}
      throw error;
    }finally{try{await worker?.close();}finally{closeSync(operation);}}
  }
  private artifactWorker(){return new ArtifactWorker({directory:this.directory,sourcePath:this.sourcePath,identity:this.identity,maxBytes:this.maxBytes});}
  /** Runtime-safe pending maintenance; all SQLite artifact work runs off-thread. */
  async maintainPending():Promise<FinancialBackup|null>{
    const operation=this.acquireOperation();let worker:ArtifactWorker|undefined;
    try{worker=this.artifactWorker();return await worker.request({task:'recover'});}
    finally{try{await worker?.close();}finally{closeSync(operation);}}
  }
  /** Internal worker entry. The parent holds the operation lease across phases. */
  runArtifactTask(message:BackupArtifactTask):FinancialBackup|null{
    if(message.task==='recover')return this.recoverPendingOwned();
    if(message.task==='prepare'){
      this.checkSourceSize();const {scan,completed}=this.ready();
      if(scan.pending)throw new Error('pending backup requires explicit recovery; nothing overwritten');
      const path=join(this.directory,PENDING),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);closeSync(fd);
      this.staged={path,own:lstatSync(path),completed,minimumRevision:message.minimumRevision,validated:false};return null;
    }
    const staged=this.staged;if(!staged)return null;
    if(message.task==='finish'){
      this.privateFile(staged.path);this.normalize(staged.path);
      const valid=this.inspect(staged.path,'0');if(valid.revision<staged.minimumRevision)throw new Error('backup predates source observation');
      staged.validated=true;const result=this.promote(valid,staged.completed);this.staged=undefined;return result;
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
      if(!this.scan().pending)return null;
      const {completed}=this.ready();
      const path=join(this.directory,PENDING);this.inspect(path,'0',false);this.normalize(path);
      return this.promote(this.inspect(path,'0'),completed);
  }
}
