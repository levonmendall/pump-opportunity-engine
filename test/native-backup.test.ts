/** Disposable worker/lease lifecycle faults. No operating account or provider. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,closeSync,constants,copyFileSync,existsSync,fstatSync,lstatSync,mkdtempSync,openSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {DisposableLedger} from '../src/ledger.js';
import {FinancialBackupStore,BackupPreparationDeferred,type BackupArtifactTask,type BackupArtifactRequest,type BackupOperationLease,type FinancialBackup} from '../src/backup.js';

const AT=Date.parse('2026-11-01T21:00:00Z'),PENDING='poe-financial-pending.sqlite',LOCK='.poe-backup.lock';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function fixture(t:TestContext,persistent=true){
 const directory=mkdtempSync(join(tmpdir(),'poe-native-backup-')),path=join(directory,'ledger.sqlite'),ledger=new DisposableLedger(path,'fixture-native-backup-worker');chmodSync(path,0o600);ledger.initialize({at:AT,microUsdPerSol:'100000000',source:'DISPOSABLE'},AT);
 const options={directory:join(directory,'backups'),sourcePath:path,identity:{accountId:ledger.accountId,mode:'DISPOSABLE_PAPER' as const,inceptionAt:AT},persistent},store=new FinancialBackupStore(options);
 t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});return {directory,path,ledger,options,store};
}
function body(path:string){const db=new Database(path,{readonly:true,fileMustExist:true});try{return JSON.parse((db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body);}finally{db.close();}}
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
type WorkerControl={worker:Worker;cancellation:Int32Array;request(task:BackupArtifactTask):Promise<FinancialBackup|null>;close():Promise<void>};
type Captured={operation:BackupOperationLease;worker:WorkerControl};
function observeWorker(store:FinancialBackupStore,handler:(task:BackupArtifactTask,run:()=>Promise<FinancialBackup|null>,scope:Captured)=>Promise<FinancialBackup|null>){
 const access=store as unknown as {artifactWorker(operation:BackupOperationLease):WorkerControl},original=access.artifactWorker.bind(store);let captured:Captured|null=null;
 access.artifactWorker=operation=>{const worker=original(operation),request=worker.request.bind(worker),scope={operation,worker};captured=scope;worker.request=task=>handler(task,()=>request(task),scope);return worker;};
 return ()=>{assert.ok(captured);return captured;};
}
function lockStatus(directory:string){return spawnSync('/usr/bin/flock',['-xn',join(directory,LOCK),'/usr/bin/true'],{stdio:'ignore',timeout:1000}).status;}

test('persistent snapshot copying never invokes the owner backup API and returns exact observed snapshot evidence',async t=>{
 const f=fixture(t);let ownerCopies=0,checks=0;
 const result=await f.store.create({state:()=>f.ledger.state(),async backup(){ownerCopies++;throw Error('OWNER_COPY_MUST_NOT_RUN');}},{admission:()=>{if(++checks===2)f.ledger.pause('new-owner-revision-before-snapshot',AT+1);return true;},measure:run=>run()});
 assert.equal(ownerCopies,0);assert.equal(checks,2);assert.equal(result.revision,1);assert.equal(result.lastAt,AT+1);assert.ok(result.sourceSnapshot);assert.equal(result.sourceSnapshot.revision,result.revision);assert.equal(result.sourceSnapshot.lastAt,result.lastAt);assert.equal(result.sourceSnapshot.stateSha256,createHash('sha256').update(JSON.stringify(body(result.path))).digest('hex'));assert.equal(result.sourceSnapshot.source.ino,lstatSync(f.path).ino);assert.equal(f.store.latest().backup?.sourceSnapshot,undefined,'historical selection cannot invent phase measurements');assert.equal(f.ledger.state().revision,1);
});

test('a newly due financial deadline after worker preparation defers before copy and preserves both verified generations',async t=>{
 const f=fixture(t),first=await f.store.create(f.ledger),second=await f.store.create(f.ledger),before=[hash(first.path),hash(second.path)];let checks=0,copies=0;
 observeWorker(f.store,async(task,run)=>{if(task.task==='copy')copies++;return run();});
 await assert.rejects(f.store.create(f.ledger,{admission:()=>++checks===1,measure:run=>run()}),BackupPreparationDeferred);
 assert.equal(checks,2);assert.equal(copies,0);assert.equal(existsSync(join(f.store.directory,PENDING)),false,'ordinary deferral removes its own empty staging inode');assert.deepEqual([hash(first.path),hash(second.path)],before);assert.equal(f.store.latest().backup?.path,second.path);assert.equal(lockStatus(f.store.directory),0);
 const recovered=await f.store.create(f.ledger,{admission:()=>true,measure:run=>run()});assert.equal(recovered.generation,'00000000000000000003');assert.equal(f.ledger.state().revision,0);
});

test('the captured snapshot remains exact while the authoritative writer advances before finish',async t=>{
 const f=fixture(t);observeWorker(f.store,async(task,run)=>{const result=await run();if(task.task==='copy')f.ledger.pause('owner-advance-after-snapshot',AT+1);return result;});
 const backup=await f.store.create(f.ledger);assert.equal(backup.revision,0);assert.equal(backup.sourceSnapshot?.revision,0);assert.equal(body(backup.path).revision,0);assert.equal(f.ledger.state().revision,1);assert.equal(f.ledger.state().lastAt,AT+1);assert.equal(f.ledger.integrity(),'ok');
});

for(const change of ['financial-revision','reporting-sequence'])test('finish refuses replacement contents that differ from captured '+change,async t=>{
 const f=fixture(t),good=await f.store.create(f.ledger),goodHash=hash(good.path);
 observeWorker(f.store,async(task,run)=>{const result=await run();if(task.task==='copy'){if(change==='financial-revision')f.ledger.pause('new-valid-snapshot',AT+1);else f.ledger.nextSnapshotSequence();await f.ledger.backup(join(f.store.directory,PENDING));}return result;});
 await assert.rejects(f.store.create(f.ledger),/differs from captured readonly financial snapshot/);assert.equal(hash(good.path),goodHash);assert.equal(f.store.latest().backup?.path,good.path);assert.equal(existsSync(join(f.store.directory,PENDING)),false);assert.equal(lockStatus(f.store.directory),0);
});

for(const after of ['acquire','prepare'])test('immutable source inode anchor rejects a same-account path replacement after '+after,async t=>{
 const f=fixture(t),good=await f.store.create(f.ledger),replacement=join(f.directory,'same-account-replacement.sqlite'),original=join(f.directory,'original-source.sqlite');copyFileSync(good.path,replacement);chmodSync(replacement,0o600);let swapped=false;
 observeWorker(f.store,async(task,run)=>{const result=await run();if(task.task===after){renameSync(f.path,original);renameSync(replacement,f.path);swapped=true;}return result;});
 try{await assert.rejects(f.store.create(f.ledger),/source inode changed|FILE_IDENTITY_REQUIRED/);assert.ok(swapped);assert.equal(f.store.latest().backup?.path,good.path);assert.equal(body(f.path).accountId,f.ledger.accountId);}finally{if(swapped){renameSync(f.path,replacement);renameSync(original,f.path);}}
 assert.equal(f.ledger.state().revision,0);assert.equal(lockStatus(f.store.directory),0);
});

test('an expired finish request cannot promote or prune a previously verified generation',async t=>{
 const f=fixture(t),first=await f.store.create(f.ledger),second=await f.store.create(f.ledger),before=[hash(first.path),hash(second.path)];
 observeWorker(f.store,async(task,run,scope)=>{if(task.task==='finish'){const post=scope.worker.worker.postMessage.bind(scope.worker.worker);scope.worker.worker.postMessage=((request:BackupArtifactRequest)=>post({...request,deadlineAtMonoNs:process.hrtime.bigint()-1n})) as typeof scope.worker.worker.postMessage;}return run();});
 await assert.rejects(f.store.create(f.ledger),/cancelled or expired/);assert.deepEqual([hash(first.path),hash(second.path)],before);assert.equal(f.store.latest().backup?.path,second.path);assert.equal(readdirSync(f.store.directory).filter(name=>/^poe-financial-\d/.test(name)).length,2);assert.equal(lockStatus(f.store.directory),0);
});

test('cancellation after real artifact inspection preserves both prior generations and prevents promotion',async t=>{
 const f=fixture(t),first=await f.store.create(f.ledger),second=await f.store.create(f.ledger),before=[hash(first.path),hash(second.path)],source=lstatSync(f.path),fd=openSync(join(f.store.directory,LOCK),constants.O_RDWR|constants.O_NOFOLLOW),held=fstatSync(fd),cancellation=new SharedArrayBuffer(4);
 // A disposable harness cancels immediately after the actual production
 // inspect method returns. It does not replace validation or promotion code.
 const code=`
  import {parentPort,workerData} from 'node:worker_threads';
  const {register}=await import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))});register();
  const {FinancialBackupStore}=await import(${JSON.stringify(new URL('../src/backup.ts',import.meta.url).href)});
  const store=new FinancialBackupStore(workerData.options),cancelled=new Int32Array(workerData.cancellation);let finishing=false,queue=Promise.resolve();
  store.bindWorkerOperation(workerData.operation,()=>Atomics.load(cancelled,0)!==0);
  const inspect=store.inspect;store.inspect=function(...args){const result=Reflect.apply(inspect,this,args);if(finishing&&args[1]==='0'){Atomics.store(cancelled,0,1);parentPort.postMessage({event:'actual-inspection-complete',revision:result.revision});}return result;};
  parentPort.on('message',request=>{queue=queue.then(async()=>{finishing=request.task.task==='finish';try{parentPort.postMessage({id:request.id,ok:true,result:await store.runArtifactTask(request.task)});}catch(error){parentPort.postMessage({id:request.id,ok:false,error:error.message});}});});
 `;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{options:f.options,operation:{fd,dev:held.dev,ino:held.ino},cancellation},execArgv:[],env:{}});let sequence=0,inspectedRevision:number|null=null;
 worker.on('message',reply=>{if(reply.event==='actual-inspection-complete')inspectedRevision=reply.revision;});
 const request=(task:BackupArtifactTask)=>new Promise<void>((resolve,reject)=>{const id=++sequence,cleanup=()=>{worker.off('message',message);worker.off('error',error);},error=(failure:Error)=>{cleanup();reject(failure);},message=(reply:{id?:number;ok?:boolean;error?:string})=>{if(reply.id!==id)return;cleanup();if(reply.ok)resolve();else reject(Error(reply.error));};worker.on('message',message);worker.once('error',error);worker.postMessage({id,task});});
 try{
  await request({task:'acquire'});await request({task:'prepare',minimumRevision:0,expectedSource:{dev:source.dev,ino:source.ino}});await request({task:'copy'});
  await assert.rejects(request({task:'finish'}),/cancelled or expired/);assert.equal(inspectedRevision,0);assert.equal(lockStatus(f.store.directory),1);assert.deepEqual([hash(first.path),hash(second.path)],before);assert.equal(f.store.latest().backup?.path,second.path);assert.ok(f.store.latest().pending,'the complete unpromoted copy remains evidence');assert.equal(readdirSync(f.store.directory).filter(name=>/^poe-financial-\d/.test(name)).length,2);
 }finally{await worker.terminate();closeSync(fd);}
 assert.equal(lockStatus(f.store.directory),0);f.ledger.pause('owner-after-cancelled-validation',AT+1);assert.equal(f.ledger.state().revision,1);
});

test('parent timeout retains the original lease until delayed real worker termination settles and prevents later promotion',async t=>{
 const f=fixture(t),good=await f.store.create(f.ledger),goodHash=hash(good.path),timedOut=deferred(),allowTermination=deferred();let settled=false;
 const captured=observeWorker(f.store,async(task,run,scope)=>{
  if(task.task!=='copy')return run();
  const terminate=scope.worker.worker.terminate.bind(scope.worker.worker);scope.worker.worker.terminate=async()=>{await allowTermination.promise;return terminate();};
  t.mock.timers.enable({apis:['setTimeout']});const pending=run();t.mock.timers.tick(30_000);t.mock.timers.reset();timedOut.resolve();return pending;
 });
 const pending=f.store.create(f.ledger);void pending.then(()=>{settled=true;},()=>{settled=true;});await timedOut.promise;
 try{const scope=captured();assert.notEqual(scope.worker.worker.threadId,-1);assert.equal(fstatSync(scope.operation.fd).ino,scope.operation.ino);assert.equal(lockStatus(f.store.directory),1);assert.equal(settled,false);f.ledger.pause('owner-progress-during-cancel-settlement',AT+1);assert.equal(f.ledger.state().revision,1);assert.equal(hash(good.path),goodHash);}
 finally{allowTermination.resolve();}
 await assert.rejects(pending,/exceeded 30s/);const scope=captured();assert.equal(scope.worker.worker.threadId,-1);assert.throws(()=>fstatSync(scope.operation.fd),{code:'EBADF'});assert.equal(lockStatus(f.store.directory),0);assert.equal(f.store.latest().backup?.path,good.path);assert.equal(hash(good.path),goodHash);
});

test('worker failure cannot release the parent lease while a legacy owner copy is still physically pending',async t=>{
 const f=fixture(t,false),good=await f.store.create(f.ledger),copyStarted=deferred(),allowCopy=deferred();let copyFinished=false,settled=false;
 const captured=observeWorker(f.store,async(_task,run)=>run());
 const pending=f.store.create({state:()=>f.ledger.state(),async backup(path){copyStarted.resolve();await allowCopy.promise;await f.ledger.backup(path);copyFinished=true;}});void pending.then(()=>{settled=true;},()=>{settled=true;});await copyStarted.promise;
 try{const scope=captured();await scope.worker.worker.terminate();assert.equal(scope.worker.worker.threadId,-1);assert.equal(fstatSync(scope.operation.fd).ino,scope.operation.ino);assert.equal(lockStatus(f.store.directory),1);assert.equal(settled,false);assert.equal(copyFinished,false);f.ledger.pause('legacy-writer-progress-before-copy-completes',AT+1);}
 finally{allowCopy.resolve();}
 await assert.rejects(pending,/worker unavailable/);assert.equal(copyFinished,true);assert.throws(()=>fstatSync(captured().operation.fd),{code:'EBADF'});assert.equal(lockStatus(f.store.directory),0);assert.equal(f.store.latest().backup?.path,good.path);assert.ok(f.store.latest().pending);
});

test('worker rejects replacement of the named lock while the parent retains its original inode',async t=>{
 const f=fixture(t),good=await f.store.create(f.ledger),oldLock=join(f.store.directory,'fixture-original-lock'),lock=join(f.store.directory,LOCK);
 const captured=observeWorker(f.store,async(task,run)=>{const result=await run();if(task.task==='acquire'){renameSync(lock,oldLock);writeFileSync(lock,'',{mode:0o600});}return result;});
 await assert.rejects(f.store.create(f.ledger),/lease inode changed/);assert.notEqual(lstatSync(lock).ino,captured().operation.ino);assert.equal(lstatSync(oldLock).ino,captured().operation.ino);assert.equal(existsSync(good.path),true);assert.equal(f.ledger.state().revision,0);
});
