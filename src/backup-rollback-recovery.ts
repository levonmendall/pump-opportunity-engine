import {createHash,randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {closeSync,constants,fstatSync,fsyncSync,linkSync,lstatSync,mkdirSync,openSync,opendirSync,readFileSync,readSync,realpathSync,renameSync,statfsSync,unlinkSync,writeFileSync,writeSync,type Stats} from 'node:fs';
import {join,dirname} from 'node:path';
import type {BackupIdentity,FinancialBackup} from './backup.js';

const VERSION='preserved-pending-rollback-recovery-v1',PENDING='poe-financial-pending.sqlite';
export const BACKUP_ROLLBACK_RECOVERY_POLICY=Object.freeze({maximumPreservedIncidents:2,maximumRootEntries:32,maximumWorkspaceEntries:32});
type Witness={dev:number;ino:number;size:number;mtimeMs:number;sha256?:string};
type SourceIdentity={dev:number;ino:number};
type Target={generation:string;file:Witness;revision:number;lastAt:number;snapshotSequence:string|null};
type Receipt={version:typeof VERSION;token:string;identity:BackupIdentity;phase:'capturing'|'promoting'|'promoted'|'incomplete'|'done';database:Witness;journal:Witness|null;sourceAtCapture:SourceIdentity|null;target?:Target;incompleteSource?:SourceIdentity;freshSourceBackup?:{generation:string;revision:number;lastAt:number;source:SourceIdentity}};
type Options={directory:string;sourcePath:string;sourceIdentities?:ReadonlyArray<{dev:number;ino:number}>;identity:BackupIdentity;minimumFreeBytes:number;fence:()=>void;completed:()=>FinancialBackup[];normalize:(path:string)=>void;inspect:(path:string,generation:string)=>FinancialBackup;promote:(valid:FinancialBackup,completed:FinancialBackup[],before:(target:string,generation:string)=>void)=>FinancialBackup};
const uint=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function need(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const absent=(error:unknown)=>(error as {code?:unknown})?.code==='ENOENT';
function info(path:string){try{return lstatSync(path);}catch(error){if(absent(error))return null;throw error;}}
function privateDirectory(path:string){const s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===0o700&&realpathSync(path)===path,'backup recovery private canonical directory required');}
function ensureDirectory(path:string){let created=false;try{mkdirSync(path,{mode:0o700});created=true;}catch(error){if((error as {code?:unknown})?.code!=='EEXIST')throw error;}privateDirectory(path);if(created)syncDirectory(dirname(path));}
function regular(s:Stats,links=1){need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===0o600&&s.nlink>=1&&s.nlink<=links&&uint(s.size),'backup recovery private regular file required');}
function witness(s:Stats):Witness{return {dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs};}
function matches(s:Stats,w:Witness){return s.dev===w.dev&&s.ino===w.ino&&s.size===w.size&&s.mtimeMs===w.mtimeMs;}
function same(a:Stats,b:Stats){return matches(a,witness(b))&&a.ctimeMs===b.ctimeMs&&a.nlink===b.nlink&&a.uid===b.uid&&a.mode===b.mode;}
function syncDirectory(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function metadataCapacity(path:string){
 const directory=dirname(path),root=path.endsWith('/current.json'),entries=opendirSync(directory);let count=0;
 try{for(;;){const entry=entries.readSync();if(!entry)break;need(++count<BACKUP_ROLLBACK_RECOVERY_POLICY.maximumWorkspaceEntries,'backup recovery metadata entry capacity requires review');const allowed=root?/^[a-f0-9]{32}$/.test(entry.name)||/^current\.json(?:\.new-[a-f0-9-]{36})?$/.test(entry.name):/^(?:receipt\.json(?:\.new-[a-f0-9-]{36})?|original\.sqlite(?:-journal)?|recovered\.sqlite(?:-(?:journal|wal|shm))?)$/.test(entry.name);need(allowed,'backup recovery workspace layout requires review');}}
 finally{entries.closeSync();}
}
function writeAtomic(path:string,value:unknown){
 metadataCapacity(path);const temporary=path+'.new-'+randomUUID(),fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let renamed=false,opened=true;
 try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);closeSync(fd);opened=false;renameSync(temporary,path);renamed=true;syncDirectory(dirname(path));}
 finally{if(opened)closeSync(fd);if(!renamed)try{unlinkSync(temporary);}catch{}}
}
function readJson(path:string){const named=lstatSync(path);regular(named);need(named.size<=32768,'backup recovery receipt size required');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const held=fstatSync(fd);need(same(named,held),'backup recovery receipt changed');const raw=readFileSync(fd);need(same(held,fstatSync(fd))&&same(held,lstatSync(path)),'backup recovery receipt changed');return JSON.parse(raw.toString('utf8')) as any;}finally{closeSync(fd);}}
function checked(path:string,w:Witness,links=2){const s=lstatSync(path);regular(s,links);need(matches(s,w),'backup recovery original identity changed');return s;}
function syncRaw(path:string,w:Witness){const named=checked(path,w),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{need(same(named,fstatSync(fd)),'backup recovery raw identity changed');fsyncSync(fd);need(same(named,fstatSync(fd))&&same(named,lstatSync(path)),'backup recovery raw identity changed');}finally{closeSync(fd);}}
function hashFile(path:string,w:Witness,fence:()=>void,links=2){const named=checked(path,w,links),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);try{const held=fstatSync(fd);need(same(named,held),'backup recovery original identity changed');let offset=0;while(offset<held.size){fence();const n=readSync(fd,buffer,0,Math.min(buffer.length,held.size-offset),offset);need(n>0,'backup recovery input truncated');hash.update(buffer.subarray(0,n));offset+=n;}need(same(held,fstatSync(fd))&&same(held,lstatSync(path)),'backup recovery input changed');return hash.digest('hex');}finally{closeSync(fd);}}
/** The producer never uses ATTACH. Refuse the SQLite super-journal EOF magic
 * before any writable SQLite open; even a malformed footer may name outsiders. */
export function rejectBackupSuperJournal(path:string){
 const file=info(path);if(!file)return;regular(file,2);if(file.size<16)return;
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),tail=Buffer.alloc(16);
 try{const held=fstatSync(fd);need(same(file,held)&&readSync(fd,tail,0,16,file.size-16)===16,'backup recovery journal changed');need(!tail.subarray(8).equals(Buffer.from('d9d505f920a163d7','hex')),'backup recovery super-journal reference refused; originals preserved');need(same(held,fstatSync(fd))&&same(held,lstatSync(path)),'backup recovery journal changed');}finally{closeSync(fd);}
}
function candidateIsEmpty(path:string){rejectBackupSuperJournal(path+'-journal');const db=new Database(path,{fileMustExist:true,timeout:100});try{const schema=db.prepare('SELECT count(*) AS count FROM sqlite_schema').get()as{count:number};if(schema.count!==0||db.pragma('page_count',{simple:true})!==0||db.pragma('freelist_count',{simple:true})!==0)return false;need(db.pragma('integrity_check',{simple:true})==='ok','backup integrity failure');return true;}finally{db.close();}}
function copyFile(path:string,target:string,w:Witness,fence:()=>void,progress:(remaining:number)=>void){
 const named=checked(path,w),source=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let destination:number|undefined;
 try{
  destination=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);const held=fstatSync(source);need(same(named,held),'backup recovery input changed');let offset=0;
  while(offset<held.size){fence();progress(held.size-offset);const n=readSync(source,buffer,0,Math.min(buffer.length,held.size-offset),offset);need(n>0,'backup recovery input truncated');hash.update(buffer.subarray(0,n));let written=0;while(written<n){fence();const nwrite=writeSync(destination,buffer,written,n-written);need(nwrite>0,'backup recovery copy made no progress');written+=nwrite;}offset+=n;}
  fsyncSync(destination);need(same(held,fstatSync(source))&&same(held,lstatSync(path)),'backup recovery input changed');return hash.digest('hex');
 }finally{if(destination!==undefined)closeSync(destination);closeSync(source);}
}
function token(database:Witness,journal:Witness|null){return createHash('sha256').update(JSON.stringify([database.dev,database.ino,database.size,database.mtimeMs,...(journal?[journal.dev,journal.ino,journal.size,journal.mtimeMs]:[null])])).digest('hex').slice(0,32);}
function validateReceipt(value:any,identity:BackupIdentity):asserts value is Receipt{
 need(value&&value.version===VERSION&&/^[a-f0-9]{32}$/.test(value.token)&&['capturing','promoting','promoted','incomplete','done'].includes(value.phase)&&value.identity?.accountId===identity.accountId&&value.identity?.mode===identity.mode&&value.identity?.inceptionAt===identity.inceptionAt,'backup recovery receipt identity required');
 for(const w of [value.database,...(value.journal===null?[]:[value.journal])])need(w&&uint(w.dev)&&uint(w.ino)&&w.ino>0&&uint(w.size)&&typeof w.mtimeMs==='number'&&Number.isFinite(w.mtimeMs)&&w.mtimeMs>=0&&(w.sha256===undefined||/^[a-f0-9]{64}$/.test(w.sha256)),'backup recovery original witness required');
 need(value.token===token(value.database,value.journal),'backup recovery incident token required');
 for(const source of [value.sourceAtCapture,value.incompleteSource,value.freshSourceBackup?.source])if(source!==undefined&&source!==null)need(uint(source.dev)&&uint(source.ino)&&source.ino>0,'backup recovery source witness required');
 if(value.incompleteSource)need(value.sourceAtCapture&&value.incompleteSource.dev===value.sourceAtCapture.dev&&value.incompleteSource.ino===value.sourceAtCapture.ino,'backup recovery incomplete source witness required');
 if(value.phase==='incomplete')need(value.incompleteSource,'backup recovery incomplete disposition required');
 if(value.freshSourceBackup){const fresh=value.freshSourceBackup;need(value.incompleteSource&&value.phase==='done'&&/^[0-9]{20}$/.test(fresh.generation)&&uint(fresh.revision)&&uint(fresh.lastAt)&&fresh.source.dev===value.incompleteSource.dev&&fresh.source.ino===value.incompleteSource.ino,'backup recovery fresh source receipt required');}
 if(value.phase!=='capturing'){const t=value.target;need(t&&/^[0-9]{20}$/.test(t.generation)&&t.file&&uint(t.file.dev)&&uint(t.file.ino)&&t.file.ino>0&&uint(t.file.size)&&typeof t.file.mtimeMs==='number'&&Number.isFinite(t.file.mtimeMs)&&t.file.mtimeMs>=0&&typeof t.file.sha256==='string'&&/^[a-f0-9]{64}$/.test(t.file.sha256)&&uint(t.revision)&&uint(t.lastAt)&&(t.snapshotSequence===null||typeof t.snapshotSequence==='string'&&/^[1-9][0-9]*$/.test(t.snapshotSequence)),'backup recovery promotion witness required');}
}
function incidentCapacity(root:string,incident:string){const directory=opendirSync(root);let count=0,incidents=0,existing=false;try{for(;;){const entry=directory.readSync();if(!entry)break;need(++count<=BACKUP_ROLLBACK_RECOVERY_POLICY.maximumRootEntries,'backup recovery archive entries require review');if(/^[a-f0-9]{32}$/.test(entry.name)){privateDirectory(join(root,entry.name));incidents++;if(entry.name===incident)existing=true;}else need(entry.name==='current.json'||/^current\.json\.new-[a-f0-9-]{36}$/.test(entry.name),'backup recovery archive layout requires review');}}finally{directory.closeSync();}need(existing||incidents<BACKUP_ROLLBACK_RECOVERY_POLICY.maximumPreservedIncidents,'backup recovery archive capacity requires review');}
function currentRecovery(directory:string,identity:BackupIdentity){
 const root=directory+'.pending-recovery',pointer=join(root,'current.json');if(!info(root))return null;privateDirectory(root);if(!info(pointer))return null;
 const p=readJson(pointer);need(p&&p.version===VERSION&&/^[a-f0-9]{32}$/.test(p.token),'backup recovery pointer required');const work=join(root,p.token);privateDirectory(work);const receipt=readJson(join(work,'receipt.json'));validateReceipt(receipt,identity);need(receipt.token===p.token,'backup recovery pointer scope required');return {root,pointer,work,receipt};
}
/** A preserved EMPTY disposition never verifies a financial backup. Its source
 * identity fence survives the next worker/process until a new source snapshot
 * has been fully validated and durably promoted. */
export function preservedIncompleteSource(directory:string,identity:BackupIdentity):SourceIdentity|null{const current=currentRecovery(directory,identity);return current?.receipt.incompleteSource&&!current.receipt.freshSourceBackup?{...current.receipt.incompleteSource}:null;}
export function completePreservedIncompleteSource(directory:string,identity:BackupIdentity,sourcePath:string,backup:FinancialBackup){
 const current=currentRecovery(directory,identity);if(!current?.receipt.incompleteSource||current.receipt.freshSourceBackup)return;
 const {receipt,work}=current,expected=receipt.incompleteSource;need(expected,'backup recovery incomplete source witness required');const live=lstatSync(sourcePath);regular(live);need(live.dev===expected.dev&&live.ino===expected.ino,'backup source inode changed; prior backups preserved');const source=backup.sourceSnapshot?.source;need(source&&source.dev===expected.dev&&source.ino===expected.ino,'backup source inode changed; prior backups preserved');
 need(receipt.phase==='done'&&backup.revision>=receipt.target!.revision&&backup.lastAt>=receipt.target!.lastAt&&BigInt(backup.generation)>BigInt(receipt.target!.generation),'backup recovery current source backup required');
 receipt.freshSourceBackup={generation:backup.generation,revision:backup.revision,lastAt:backup.lastAt,source:{...source}};writeAtomic(join(work,'receipt.json'),receipt);
}
/** The original family is never opened by SQLite. Durable raw archive links
 * retain its exact bytes/inodes. Only an isolated copy is recovered writable.
 * Explicit receipts resume promotion or narrow EMPTY preservation separately. */
export function recoverPendingRollbackJournal(o:Options):FinancialBackup|{kind:'preserved-incomplete'}|null{
 const pending=join(o.directory,PENDING),journal=pending+'-journal',root=o.directory+'.pending-recovery',pointer=join(root,'current.json');
 need(o.sourcePath!==root&&!o.sourcePath.startsWith(root+'/'),'backup recovery directory must not contain source financial state');
 const sources=[...(o.sourceIdentities??[]),info(o.sourcePath)].filter((v):v is SourceIdentity=>v!==undefined&&v!==null),notSource=(v:SourceIdentity)=>need(!sources.some(p=>p.dev===v.dev&&p.ino===v.ino),'backup recovery cannot modify financial source');
 const existing=currentRecovery(o.directory,o.identity);let receipt=existing?.receipt??null,work=existing?.work??null;
 if(receipt?.phase==='done'){receipt=null;work=null;}
 const pendingInfo=info(pending),journalInfo=info(journal);if(!receipt&&!journalInfo&&pendingInfo?.size!==0)return null;
 need(!info(pending+'-wal')&&!info(pending+'-shm'),'backup recovery mixed rollback and WAL requires review');const completed=o.completed();o.fence();
 if(!receipt){
  const databaseStat=lstatSync(pending);regular(databaseStat);notSource(databaseStat);if(journalInfo){regular(journalInfo);notSource(journalInfo);rejectBackupSuperJournal(journal);}
  const source=info(o.sourcePath),database=witness(databaseStat),journalWitness=journalInfo?witness(journalInfo):null,incident=token(database,journalWitness);
  ensureDirectory(root);incidentCapacity(root,incident);work=join(root,incident);ensureDirectory(work);const path=join(work,'receipt.json');
  if(info(path)){receipt=readJson(path);validateReceipt(receipt,o.identity);need(receipt.token===incident,'backup recovery incident changed');}
  else{receipt={version:VERSION,token:incident,identity:{...o.identity},phase:'capturing',database,journal:journalWitness,sourceAtCapture:source&&(o.sourceIdentities?.length??0)>0&&o.sourceIdentities!.every(v=>v.dev===source.dev&&v.ino===source.ino)?{dev:source.dev,ino:source.ino}:null};writeAtomic(path,receipt);}
  writeAtomic(pointer,{version:VERSION,token:incident});
 }
 need(receipt&&work,'backup recovery incident required');const path=join(work,'receipt.json'),raw=join(work,'original.sqlite'),rawJournal=raw+'-journal',copy=join(work,'recovered.sqlite'),copyJournal=copy+'-journal';
 const save=()=>writeAtomic(path,receipt),archive=(active:string,target:string,w:Witness)=>{notSource(w);const source=info(o.sourcePath);need(!source||source.dev!==w.dev||source.ino!==w.ino,'backup recovery cannot archive financial source');if(!info(target)){checked(active,w,1);linkSync(active,target);}checked(target,w);const current=info(active);if(current)need(current.dev===w.dev&&current.ino===w.ino,'backup recovery active alias changed');};
 const verifyRaw=()=>{need(receipt!.database.sha256&&hashFile(raw,receipt!.database,o.fence)===receipt!.database.sha256,'backup recovery raw archive changed');if(receipt!.journal)need(receipt!.journal.sha256&&hashFile(rawJournal,receipt!.journal,o.fence)===receipt!.journal.sha256,'backup recovery raw archive changed');};
 const emptySourceFence=()=>{const source=lstatSync(o.sourcePath),expected=receipt!.incompleteSource??receipt!.sourceAtCapture;regular(source);need(expected&&source.dev===expected.dev&&source.ino===expected.ino&&(o.sourceIdentities?.length??0)>0&&o.sourceIdentities!.every(v=>v.dev===source.dev&&v.ino===source.ino),'backup source inode changed; prior backups preserved');o.fence();return {dev:source.dev,ino:source.ino};};
 if(receipt.phase==='capturing'){
  metadataCapacity(path);archive(pending,raw,receipt.database);if(receipt.journal)archive(journal,rawJournal,receipt.journal);o.fence();syncRaw(raw,receipt.database);if(receipt.journal)syncRaw(rawJournal,receipt.journal);syncDirectory(work);syncDirectory(o.directory);
  const journalBytes=receipt.journal?.size??0,reserve=(remaining:number)=>{const free=statfsSync(work),available=free.bavail*free.bsize;need(Number.isSafeInteger(available)&&available>=remaining+o.minimumFreeBytes,'backup recovery disk reserve required');};reserve(receipt.database.size+journalBytes);
  for(const derived of [copy+'-wal',copy+'-shm',copyJournal,copy])if(info(derived)){const stat=lstatSync(derived);regular(stat);notSource(stat);need(stat.size<=Math.max(receipt.database.size,journalBytes,32768),'backup recovery derived file size required');unlinkSync(derived);}
  const databaseHash=copyFile(raw,copy,receipt.database,o.fence,remaining=>reserve(remaining+journalBytes));need(!receipt.database.sha256||receipt.database.sha256===databaseHash,'backup recovery original bytes changed');receipt.database.sha256=databaseHash;
  if(receipt.journal){const journalHash=copyFile(rawJournal,copyJournal,receipt.journal,o.fence,reserve);need(!receipt.journal.sha256||receipt.journal.sha256===journalHash,'backup recovery original bytes changed');receipt.journal.sha256=journalHash;}syncDirectory(work);save();
  o.fence();const ownedCopy=lstatSync(copy);regular(ownedCopy);notSource(ownedCopy);
  if(candidateIsEmpty(copy)){
   need(completed.length>0,'backup empty recovery requires verified prior backup; originals preserved');const source=emptySourceFence(),prior=completed.at(-1)!,stat=lstatSync(prior.path);verifyRaw();
   receipt.target={generation:prior.generation,file:{...witness(stat),sha256:hashFile(prior.path,witness(stat),o.fence,1)},revision:prior.revision,lastAt:prior.lastAt,snapshotSequence:prior.snapshotSequence};receipt.incompleteSource=source;receipt.phase='incomplete';save();
  }else{
   o.normalize(copy);o.fence();const normalized=lstatSync(copy);regular(normalized);need(normalized.dev===ownedCopy.dev&&normalized.ino===ownedCopy.ino,'backup recovery isolated copy inode changed');notSource(normalized);const valid=o.inspect(copy,'0');verifyRaw();
   const result=o.promote(valid,completed,(target,generation)=>{const stat=lstatSync(copy);regular(stat);receipt!.target={generation,file:{...witness(stat),sha256:hashFile(copy,witness(stat),o.fence,1)},revision:valid.revision,lastAt:valid.lastAt,snapshotSequence:valid.snapshotSequence};receipt!.phase='promoting';save();need(target===join(o.directory,'poe-financial-'+generation+'.sqlite'),'backup recovery promotion path required');});
   need(result.generation===receipt.target!.generation,'backup recovery promotion generation changed');receipt.phase='promoted';save();
  }
 }
 const target=receipt.target;need(target,'backup recovery target witness required');const promotedPath=join(o.directory,'poe-financial-'+target.generation+'.sqlite');
 if(receipt.phase==='promoting'&&!info(promotedPath)){const valid=o.inspect(copy,'0');need(hashFile(copy,target.file,o.fence,1)===target.file.sha256,'backup recovery prepared copy changed');o.promote(valid,completed,(targetPath,generation)=>{need(generation===target.generation&&targetPath===promotedPath,'backup recovery target changed');});receipt.phase='promoted';save();}
 if(receipt.incompleteSource)emptySourceFence();need(hashFile(promotedPath,target.file,o.fence,1)===target.file.sha256,'backup recovery certified artifact changed');const result=o.inspect(promotedPath,target.generation);need(result.revision===target.revision&&result.lastAt===target.lastAt&&result.snapshotSequence===target.snapshotSequence,'backup recovery certified history changed');
 syncDirectory(o.directory);if(!receipt.incompleteSource)receipt.phase='promoted';save();
 const originals:Array<[string,string,Witness]>=[[pending,raw,receipt.database]];if(receipt.journal)originals.push([journal,rawJournal,receipt.journal]);
 for(const [active,archived,w]of originals){need(w.sha256&&hashFile(archived,w,o.fence)===w.sha256,'backup recovery raw archive changed');const current=info(active);if(current){checked(active,w);if(receipt.incompleteSource)emptySourceFence();o.fence();unlinkSync(active);syncDirectory(o.directory);}}
 receipt.phase='done';save();if(receipt.incompleteSource)return {kind:'preserved-incomplete'};
 need(receipt.journal,'backup recovery financial journal witness required');return {...result,rollbackRecovery:{version:VERSION,archiveDirectory:work,originalDatabaseSha256:receipt.database.sha256!,originalJournalSha256:receipt.journal.sha256!,originalDatabaseMtimeMs:receipt.database.mtimeMs,originalJournalMtimeMs:receipt.journal.mtimeMs}};
}
