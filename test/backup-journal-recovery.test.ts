import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,chmodSync,closeSync,copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,readlinkSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {DisposableLedger} from '../src/ledger.js';
import {FinancialBackupStore,BackupOperationError,backupFailureDiagnostic,type FinancialBackup} from '../src/backup.js';

const AT=Date.parse('2026-10-26T12:00:00Z');
const PENDING='poe-financial-pending.sqlite',CAPSULE='.poe-pending-recovery';
const SUFFIXES=['','-journal','-wal','-shm'] as const;
const MAGIC=Buffer.from('d9d505f920a163d7','hex');
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const hash=(path:string)=>digest(readFileSync(path));
type Original={suffix:string;dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;sha256:string};
type Fixture=ReturnType<typeof setup>;
function setup(t:TestContext,id='fixture-journal-recovery'){
  const dir=mkdtempSync(join(tmpdir(),'poe-journal-recovery-DISPOSABLE-')),state=join(dir,'state');
  mkdirSync(state,{mode:0o700});
  const path=join(state,'ledger.sqlite');
  // SQLite sidecars inherit the original database mode; make it private before opening.
  writeFileSync(path,'',{mode:0o600,flag:'wx'});
  const ledger=new DisposableLedger(path,id);
  chmodSync(path,0o600);
  ledger.initialize({at:AT,microUsdPerSol:'100000000',source:'DISPOSABLE journal recovery fixture'},AT);
  for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))assert.equal(lstatSync(path+suffix).mode&0o777,0o600,'fixture source and sidecars must already be private');
  const identity={accountId:id,mode:'DISPOSABLE_PAPER' as const,inceptionAt:AT};
  const options={directory:join(dir,'backups'),sourcePath:path,identity};
  const store=new FinancialBackupStore(options);
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,path,ledger,identity,options,store,pending:join(store.directory,PENDING),capsule:join(store.directory,CAPSULE)};
}
function sourceState(f:Fixture){
  const db=(f.ledger as unknown as {db:Database.Database}).db;
  return {dev:lstatSync(f.path).dev,ino:lstatSync(f.path).ino,state:f.ledger.state(),
    durableRowsSha256:digest(JSON.stringify({
      journal:db.prepare('SELECT * FROM journal ORDER BY revision').all(),
      actions:db.prepare('SELECT * FROM actions ORDER BY id').all(),
      metadata:db.prepare('SELECT * FROM metadata ORDER BY key').all()}))};
}
function backupState(path:string){
  const db=new Database(path,{readonly:true,fileMustExist:true});
  try{return JSON.parse((db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body);}
  finally{db.close();}
}
function originalFamily(f:Fixture):Original[]{
  return SUFFIXES.flatMap(suffix=>{
    const path=f.pending+suffix;if(!existsSync(path))return [];
    const s=lstatSync(path,{bigint:true});
    assert.ok(s.isFile()&&!s.isSymbolicLink());assert.equal(s.nlink,1n);assert.equal(Number(s.mode&0o777n),0o600);
    return [{suffix,dev:s.dev,ino:s.ino,size:s.size,mtimeNs:s.mtimeNs,sha256:hash(path)}];
  });
}
function preserved(f:Fixture,originals:Original[],inCapsule=false){
  for(const original of originals){
    const candidates=[f.pending+original.suffix,join(f.capsule,'original.sqlite'+original.suffix)].filter(existsSync);
    assert.equal(candidates.length,1,'each original family member has one preserved location');
    const path=candidates[0]!;if(inCapsule)assert.equal(path,join(f.capsule,'original.sqlite'+original.suffix));
    const s=lstatSync(path,{bigint:true});
    assert.ok(s.isFile()&&!s.isSymbolicLink());assert.equal(s.nlink,1n);
    assert.equal(s.dev,original.dev);assert.equal(s.ino,original.ino);assert.equal(s.size,original.size);
    assert.equal(s.mtimeNs,original.mtimeNs,'rename changes ctime, not the original modification time');
    assert.equal(hash(path),original.sha256,'SQLite may only change the owned candidate, never this original');
  }
}
function completedNames(f:Fixture){return readdirSync(f.store.directory).filter(x=>/^poe-financial-[0-9]{20}\.sqlite$/.test(x)).sort();}
function completion(f:Fixture){return JSON.parse(readFileSync(join(f.capsule,'completed.json'),'utf8')) as {disposition:string};}
function coldJournal(path:string){
  const db=new Database(path,{fileMustExist:true});
  try{
    assert.equal(db.pragma('journal_mode=PERSIST',{simple:true}),'persist');
    db.pragma('synchronous=FULL');
    const original=(db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body;
    const state=JSON.parse(original),pretty=JSON.stringify(state,null,2);
    // A reused backup may already have pretty JSON. Force a real, semantically equal write.
    const replacement=original===pretty?JSON.stringify(state):pretty;assert.notEqual(replacement,original);
    db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(replacement);
  }finally{db.close();}
  chmodSync(path,0o600);chmodSync(path+'-journal',0o600);
  const raw=readFileSync(path+'-journal');
  assert.ok(raw.length>512,'a real committed PERSIST journal remains');
  assert.ok(raw.subarray(0,8).equals(Buffer.alloc(8)),'SQLite invalidated the cold journal header');
}
type CrashReady={kind:'hot';mode:'financial'|'empty-copy';pendingBytes:number;journalBytes:number;totalPages?:number;remainingPages?:number};
/** The child is killed with SIGKILL, not worker.terminate(): SQLite cannot run
 * connection finalizers or JavaScript cleanup and remove/rollback this journal. */
async function crashWithHotJournal(pending:string,mode:CrashReady['mode'],sourcePath?:string):Promise<CrashReady>{
  const code=[
    'import Database from '+JSON.stringify(import.meta.resolve('better-sqlite3'))+';',
    "import {chmodSync,lstatSync,readFileSync,writeSync} from 'node:fs';",
    'const [pending,mode,sourcePath]=process.argv.slice(1);',
    "const magic=Buffer.from('d9d505f920a163d7','hex');",
    'function pin(extra={}){',
    "  let raw;try{raw=readFileSync(pending+'-journal');}catch{return false;}",
    '  if(raw.length<=512||!raw.subarray(0,8).equals(magic))return false;',
    "  chmodSync(pending,0o600);chmodSync(pending+'-journal',0o600);",
    "  writeSync(1,JSON.stringify({kind:'hot',mode,pendingBytes:lstatSync(pending).size,journalBytes:raw.length,...extra})+'\\n');",
    '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);',
    "  throw new Error('DISPOSABLE unexpected crash barrier resume');",
    '}',
    'try{',
    "  if(mode==='financial'){",
    '    const db=new Database(pending,{fileMustExist:true});',
    "    db.pragma('journal_mode=DELETE');db.pragma('synchronous=FULL');db.pragma('cache_size=4');db.pragma('cache_spill=ON');",
    "    db.exec('BEGIN IMMEDIATE');",
    "    const initial=JSON.parse(db.prepare('SELECT body FROM financial_state WHERE singleton=1').get().body);",
    "    db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify({...initial,accountId:'DISPOSABLE UNCOMMITTED foreign identity'}));",
    "    const insert=db.prepare('INSERT INTO metadata(key,value) VALUES (?,?)');",
    "    for(let i=0;i<384;i++)insert.run('DISPOSABLE-crash-spill-'+i,'x'.repeat(8192));",
    "    if(!pin())throw new Error('SQLite did not spill a real hot financial journal');",
    "  }else if(mode==='empty-copy'){",
    '    const db=new Database(sourcePath,{readonly:true,fileMustExist:true});',
    '    await db.backup(pending,{progress(progress){',
    '      if(progress.remainingPages>0)pin({totalPages:progress.totalPages,remainingPages:progress.remainingPages});',
    '      return 16;',
    '    }});',
    "    throw new Error('SQLite backup completed before leaving a hot destination journal');",
    "  }else throw new Error('closed fixture mode required');",
    "}catch(error){writeSync(1,JSON.stringify({kind:'error',message:String(error)})+'\\n');process.exit(1);}",
  ].join('\n');
  const child=spawn(process.execPath,['--input-type=module','-e',code,pending,mode,sourcePath??''],{stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='',timer:ReturnType<typeof setTimeout>|undefined,announced=false;
  child.stderr.on('data',chunk=>{stderr+=(chunk as Buffer).toString();if(stderr.length>32*1024)child.kill('SIGKILL');});
  const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{
    const ready=await new Promise<CrashReady>((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('DISPOSABLE hot journal barrier timed out: '+stderr)),15_000);
      child.once('error',reject);
      child.once('exit',(code,signal)=>{if(!announced)reject(new Error('DISPOSABLE child exited before journal barrier: '+JSON.stringify({code,signal,stdout,stderr})));});
      child.stdout.on('data',chunk=>{
        stdout+=(chunk as Buffer).toString();
        if(stdout.length>32*1024){reject(new Error('DISPOSABLE child output exceeded fixture bound'));return;}
        const newline=stdout.indexOf('\n');if(newline<0||announced)return;
        try{
          const value=JSON.parse(stdout.slice(0,newline)) as CrashReady|{kind:'error';message:string};
          if(value.kind!=='hot'){reject(new Error('DISPOSABLE SQLite fixture failed: '+JSON.stringify(value)));return;}
          announced=true;resolve(value);
        }catch(error){reject(error);}
      });
    });
    assert.equal(ready.mode,mode);assert.ok(ready.journalBytes>512);
    assert.ok(readFileSync(pending+'-journal').subarray(0,8).equals(MAGIC));
    assert.equal(child.kill('SIGKILL'),true);
    const settled=await exit;assert.equal(settled.signal,'SIGKILL','wait for physical process death before recovery');
    return ready;
  }finally{
    clearTimeout(timer);
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}
  }
}
function copyFamilyToProbe(f:Fixture,name:string){
  const path=join(f.dir,name+'.sqlite');
  for(const suffix of SUFFIXES)if(existsSync(f.pending+suffix)){copyFileSync(f.pending+suffix,path+suffix);chmodSync(path+suffix,0o600);}
  return path;
}
function assertRequiresRollback(f:Fixture){
  const path=copyFamilyToProbe(f,'readonly-hot-probe');let db:Database.Database|undefined;
  try{assert.throws(()=>{db=new Database(path,{readonly:true,fileMustExist:true});db.prepare('SELECT name FROM sqlite_schema').all();},
    (error:unknown)=>error instanceof Error&&'code'in error&&error.code==='SQLITE_READONLY_ROLLBACK',
    'a real SQLite reader must require rollback, rather than a synthetic sidecar-shaped file');}
  finally{db?.close();}
}
async function seedEmptyCrash(f:Fixture){
  const db=(f.ledger as unknown as {db:Database.Database}).db;
  db.transaction(()=>{for(let i=0;i<6000;i++)f.ledger.pause('DISPOSABLE-copy-history-'+i,AT+i+1,'DISPOSABLE copy history '+'.'.repeat(470));})();
  // Exceed the default destination pager cache so a partial native backup must spill before commit.
  assert.ok(Number(db.pragma('page_count',{simple:true}))*Number(db.pragma('page_size',{simple:true}))>4*1024*1024,'real financial fixture exceeds the destination cache');
  writeFileSync(f.pending,'',{mode:0o600,flag:'wx'});
  const ready=await crashWithHotJournal(f.pending,'empty-copy',f.path);
  assert.ok(ready.totalPages!>100&&ready.remainingPages!>0,'the killed native backup really had uncopied pages');
  const originals=originalFamily(f),path=copyFamilyToProbe(f,'empty-rollback-probe'),probe=new Database(path,{fileMustExist:true});
  try{
    assert.equal(probe.pragma('integrity_check',{simple:true}),'ok');
    assert.equal((probe.prepare('SELECT count(*) AS count FROM sqlite_schema').get() as {count:number}).count,0);
    assert.equal(probe.pragma('page_count',{simple:true}),0);
    assert.equal(probe.pragma('freelist_count',{simple:true}),0);
  }finally{probe.close();}
  preserved(f,originals);return originals;
}

test('real crash-left hot journal recovers only its candidate and preserves originals and source', {timeout:30_000},async t=>{
  const f=setup(t),first=await f.store.create(f.ledger),before=sourceState(f);
  copyFileSync(first.path,f.pending);chmodSync(f.pending,0o600);
  await crashWithHotJournal(f.pending,'financial');
  const originals=originalFamily(f);assertRequiresRollback(f);
  const recovered=await f.store.maintainPending();assert.ok(recovered);
  assert.deepEqual(backupState(recovered.path),before.state);assert.equal(recovered.revision,first.revision);
  preserved(f,originals,true);assert.equal(completion(f).disposition,'PROMOTED');
  assert.deepEqual(sourceState(f),before);assert.equal(f.store.latest().backup?.path,recovered.path);
  assert.equal(f.store.latest().pending,false);assert.equal(await f.store.maintainPending(),null);
});

test('real cold PERSIST journal is preserved without mistaking its byte size for hotness',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger),before=sourceState(f);
  copyFileSync(first.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),recovered=await f.store.maintainPending();assert.ok(recovered);
  preserved(f,originals,true);assert.deepEqual(backupState(recovered.path),before.state);
  assert.equal(completion(f).disposition,'PROMOTED');assert.deepEqual(sourceState(f),before);
});

test('interrupted fresh SQLite backup rolls back to empty staging and requires a new fully validated current backup', {timeout:40_000},async t=>{
  const f=setup(t),first=await f.store.create(f.ledger),firstHash=hash(first.path);
  const originals=await seedEmptyCrash(f),before=sourceState(f);
  assert.equal(await f.store.maintainPending(),null,'an empty recovered staging file is never returned as a financial backup');
  assert.equal(completion(f).disposition,'PRESERVED_INCOMPLETE_STAGING');
  assert.equal(existsSync(join(f.capsule,'validated.json')),false,'there is no fabricated validated financial receipt');
  preserved(f,originals,true);assert.equal(hash(first.path),firstHash);
  assert.deepEqual(completedNames(f),[first.path.split('/').at(-1)!]);
  assert.equal(f.store.latest().backup?.path,first.path);
  assert.deepEqual(sourceState(f),before);
  const fresh=await f.store.create(f.ledger);
  assert.equal(fresh.revision,before.state.revision);assert.deepEqual(backupState(fresh.path),before.state);
  assert.equal(f.store.latest().backup?.path,fresh.path);assert.equal(hash(first.path),firstHash);
  preserved(f,originals,true);assert.deepEqual(sourceState(f),before);
});

test('empty staging cannot be cleared without a fully validated prior same-account backup', {timeout:40_000},async t=>{
  const f=setup(t),originals=await seedEmptyCrash(f),before=sourceState(f);
  await assert.rejects(f.store.maintainPending(),/verified prior backup/);
  preserved(f,originals,true);assert.equal(existsSync(join(f.capsule,'completed.json')),false);
  assert.deepEqual(completedNames(f),[]);assert.deepEqual(sourceState(f),before);
});

test('foreign populated pending database and its real journal are preserved and never promoted',async t=>{
  const f=setup(t),foreign=setup(t,'fixture-foreign-journal'),good=await f.store.create(f.ledger),other=await foreign.store.create(foreign.ledger);
  copyFileSync(other.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f),goodHash=hash(good.path);
  await assert.rejects(f.store.maintainPending(),/identity|account/);
  preserved(f,originals,true);assert.equal(hash(good.path),goodHash);
  assert.equal(existsSync(join(f.capsule,'completed.json')),false);assert.deepEqual(sourceState(f),before);
});

test('corrupt pending database cannot escape preservation through journal recovery',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),before=sourceState(f),goodHash=hash(good.path);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  writeFileSync(f.pending,'DISPOSABLE corrupt pending database',{mode:0o600});
  const originals=originalFamily(f);
  await assert.rejects(f.store.maintainPending());
  preserved(f,originals,true);assert.equal(hash(good.path),goodHash);
  assert.equal(existsSync(join(f.capsule,'completed.json')),false);assert.deepEqual(sourceState(f),before);
});

test('pending journal symlink refuses before following or relocating its outside target',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),outside=join(f.dir,'outside-journal');
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);
  writeFileSync(outside,Buffer.alloc(1024),{mode:0o600});symlinkSync(outside,f.pending+'-journal');
  const pendingHash=hash(f.pending),outsideHash=hash(outside),before=sourceState(f);
  await assert.rejects(f.store.maintainPending(),/private|canonical/);
  assert.equal(lstatSync(f.pending+'-journal').isSymbolicLink(),true);assert.equal(readlinkSync(f.pending+'-journal'),outside);
  assert.equal(hash(outside),outsideHash);assert.equal(hash(f.pending),pendingHash);
  assert.equal(existsSync(f.capsule),false);assert.deepEqual(sourceState(f),before);
});

test('unrelated names and completed-copy journals remain refusal boundaries',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  for(const name of ['owner-note.txt',good.path.split('/').at(-1)!+'-journal']){
    const path=join(f.store.directory,name);writeFileSync(path,'DISPOSABLE unrelated owner evidence',{mode:0o600});
    const pin=hash(path);await assert.rejects(f.store.maintainPending(),/layout needs review/);
    assert.equal(hash(path),pin);preserved(f,originals);assert.equal(existsSync(f.capsule),false);
    rmSync(path); // Only this test's deliberately introduced disposable file.
  }
  assert.deepEqual(sourceState(f),before);
});

test('a journal with a super-journal trailer is refused without opening any external path',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),outside=join(f.dir,'outside-super-journal');
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  writeFileSync(outside,'DISPOSABLE must remain untouched',{mode:0o600});
  const name=Buffer.from(outside),trailer=Buffer.alloc(16);
  trailer.writeUInt32BE(name.length,0);trailer.writeUInt32BE(name.reduce((sum,byte)=>(sum+byte)>>>0,0),4);MAGIC.copy(trailer,8);
  appendFileSync(f.pending+'-journal',Buffer.concat([name,trailer]));
  const originals=originalFamily(f),outsideHash=hash(outside),before=sourceState(f);
  await assert.rejects(f.store.maintainPending(),/super-journal/);
  preserved(f,originals);assert.equal(hash(outside),outsideHash);assert.equal(existsSync(f.capsule),false);
  assert.deepEqual(sourceState(f),before);
});

test('real backup lease contention leaves the crash family untouched',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  const owner=f.store as unknown as {acquireOperation:()=>number},fd=owner.acquireOperation();
  try{await assert.rejects(new FinancialBackupStore(f.options).maintainPending(),/operation already active/);}
  finally{closeSync(fd);}
  preserved(f,originals);assert.equal(existsSync(f.capsule),false);assert.deepEqual(sourceState(f),before);
  assert.ok(await f.store.maintainPending(),'physical lease release permits the next ordinary recovery');
});

test('same original family resumes after a durable first-member relocation interruption',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  const internal=f.store as unknown as {moveRecoveryOriginal:(from:string,to:string)=>void};
  const original=internal.moveRecoveryOriginal;let moved=0;
  internal.moveRecoveryOriginal=function(from,to){original.call(f.store,from,to);if(++moved===1)throw new Error('DISPOSABLE interruption after original move');};
  try{assert.throws(()=>f.store.recoverPending(),/DISPOSABLE interruption after original move/);}
  finally{internal.moveRecoveryOriginal=original;}
  assert.equal(moved,1);assert.equal(existsSync(join(f.capsule,'manifest.json')),true);
  preserved(f,originals);assert.equal(existsSync(f.pending),false);assert.equal(existsSync(f.pending+'-journal'),true);
  const resumed=new FinancialBackupStore(f.options),result=await resumed.maintainPending();assert.ok(result);
  preserved(f,originals,true);assert.equal(completion(f).disposition,'PROMOTED');
  assert.deepEqual(backupState(result.path),before.state);assert.deepEqual(sourceState(f),before);
});

test('same-family retry replaces only its owned interrupted candidate copy',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  const internal=f.store as unknown as {copyRecoveryCandidate:(manifest:unknown)=>void};
  const original=internal.copyRecoveryCandidate;
  internal.copyRecoveryCandidate=function(manifest){original.call(f.store,manifest);throw new Error('DISPOSABLE interruption after candidate copy');};
  try{assert.throws(()=>f.store.recoverPending(),/DISPOSABLE interruption after candidate copy/);}
  finally{internal.copyRecoveryCandidate=original;}
  preserved(f,originals,true);assert.equal(existsSync(join(f.capsule,'completed.json')),false);
  assert.equal(existsSync(join(f.capsule,'candidate.sqlite')),true);
  const resumed=new FinancialBackupStore(f.options),result=await resumed.maintainPending();assert.ok(result);
  preserved(f,originals,true);assert.deepEqual(backupState(result.path),before.state);assert.deepEqual(sourceState(f),before);
});

test('promotion interrupted before its completion receipt resumes without a duplicate generation or extra pruning',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),goodHash=hash(good.path);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  const internal=f.store as unknown as {promote:(valid:FinancialBackup,completed:FinancialBackup[])=>FinancialBackup};
  const original=internal.promote;let promoted:FinancialBackup|undefined;
  internal.promote=function(valid,completed){promoted=original.call(f.store,valid,completed);throw new Error('DISPOSABLE interruption after promotion');};
  try{assert.throws(()=>f.store.recoverPending(),/DISPOSABLE interruption after promotion/);}
  finally{internal.promote=original;}
  const actualPromoted=promoted as FinancialBackup|undefined;assert.ok(actualPromoted);assert.equal(existsSync(join(f.capsule,'validated.json')),true);assert.equal(existsSync(join(f.capsule,'completed.json')),false);
  const names=completedNames(f);assert.equal(names.length,2);preserved(f,originals,true);
  const resumed=new FinancialBackupStore(f.options),result=await resumed.maintainPending();assert.ok(result);
  assert.equal(result.path,actualPromoted.path);assert.deepEqual(completedNames(f),names);assert.equal(hash(good.path),goodHash);
  assert.equal(completion(f).disposition,'PROMOTED');preserved(f,originals,true);assert.deepEqual(sourceState(f),before);
});

test('completed capsule remains valid after ordinary two-copy retention prunes its promoted generation',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),recovered=await f.store.maintainPending();assert.ok(recovered);
  f.ledger.pause('DISPOSABLE-new-after-recovery',AT+1);await f.store.create(f.ledger);
  f.ledger.pause('DISPOSABLE-newest-after-recovery',AT+2);const newest=await f.store.create(f.ledger);
  assert.equal(existsSync(recovered.path),false);assert.equal(completedNames(f).length,2);
  assert.equal(f.store.latest().backup?.path,newest.path);assert.equal(await f.store.maintainPending(),null);
  assert.equal(completion(f).disposition,'PROMOTED');preserved(f,originals,true);
});

test('a second distinct journal incident refuses without overwriting the first preserved family',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const firstOriginals=originalFamily(f),recovered=await f.store.maintainPending();assert.ok(recovered);
  const manifestHash=hash(join(f.capsule,'manifest.json')),receiptHash=hash(join(f.capsule,'completed.json'));
  copyFileSync(recovered.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const secondOriginals=originalFamily(f),names=completedNames(f),before=sourceState(f);
  await assert.rejects(f.store.maintainPending(),/already occupied/);
  for(const original of secondOriginals){const path=f.pending+original.suffix;assert.equal(hash(path),original.sha256);assert.equal(lstatSync(path,{bigint:true}).ino,original.ino);}
  for(const original of firstOriginals)assert.equal(hash(join(f.capsule,'original.sqlite'+original.suffix)),original.sha256);
  assert.equal(hash(join(f.capsule,'manifest.json')),manifestHash);assert.equal(hash(join(f.capsule,'completed.json')),receiptHash);
  assert.deepEqual(completedNames(f),names);assert.deepEqual(sourceState(f),before);
});

test('changed preserved originals refuse new writes while a prior good backup remains selectable',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  const recovered=await f.store.maintainPending();assert.ok(recovered);preserved(f,originals,true);
  const originalJournal=join(f.capsule,'original.sqlite-journal');appendFileSync(originalJournal,'DISPOSABLE evidence changed');
  const changed=hash(originalJournal),names=completedNames(f);
  await assert.rejects(f.store.create(f.ledger),/original identity changed/);
  assert.equal(hash(originalJournal),changed);assert.deepEqual(completedNames(f),names);assert.deepEqual(sourceState(f),before);
  const selected=f.store.latest();assert.ok(selected.backup);assert.equal(selected.backup.path,recovered.path);
  assert.ok(selected.rejected.some(x=>x.file===CAPSULE),'capsule corruption cannot erase access to validated earlier financial recovery');
});

test('private empty capsule left before manifest publication safely resumes the untouched pair',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  mkdirSync(f.capsule,{mode:0o700});
  const recovered=await new FinancialBackupStore(f.options).maintainPending();assert.ok(recovered);
  assert.equal(completion(f).disposition,'PROMOTED');preserved(f,originals,true);assert.deepEqual(sourceState(f),before);
});

test('malformed final manifest is preserved and refused without hiding the prior good backup',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),goodHash=hash(good.path);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  mkdirSync(f.capsule,{mode:0o700});const malformed=join(f.capsule,'manifest.json');
  writeFileSync(malformed,'{"version":',{mode:0o600});const malformedHash=hash(malformed);
  await assert.rejects(f.store.maintainPending(),/metadata invalid/);
  preserved(f,originals);assert.equal(hash(malformed),malformedHash);assert.equal(hash(good.path),goodHash);
  assert.equal(existsSync(join(f.capsule,'completed.json')),false);
  const selected=f.store.latest();assert.equal(selected.backup?.path,good.path);assert.ok(selected.rejected.some(x=>x.file===CAPSULE));
  assert.deepEqual(sourceState(f),before);
});

test('interrupted manifest temporary write resumes without moving or discarding unauthenticated originals',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger);
  copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
  const originals=originalFamily(f),before=sourceState(f);
  const internal=f.store as unknown as {publishRecoveryMetadata:(name:string)=>void};
  const original=internal.publishRecoveryMetadata;let interrupted=0;
  internal.publishRecoveryMetadata=function(name){if(name==='manifest.json'){interrupted++;throw new Error('DISPOSABLE before manifest publication');}original.call(f.store,name);};
  try{assert.throws(()=>f.store.recoverPending(),/DISPOSABLE before manifest publication/);}
  finally{internal.publishRecoveryMetadata=original;}
  assert.equal(interrupted,1);assert.equal(existsSync(join(f.capsule,'manifest.json')),false);
  const temporary=join(f.capsule,'manifest.json.tmp');assert.equal(existsSync(temporary),true);
  preserved(f,originals);assert.equal(existsSync(f.pending),true);assert.equal(existsSync(f.pending+'-journal'),true);
  // A process can die during the temporary write, before its final rename.
  // This is the only owned unpublished metadata file, never an original.
  writeFileSync(temporary,'{"version":',{mode:0o600});
  const recovered=await new FinancialBackupStore(f.options).maintainPending();assert.ok(recovered);
  assert.equal(completion(f).disposition,'PROMOTED');preserved(f,originals,true);assert.deepEqual(sourceState(f),before);
});

for(const metadataName of ['validated.json','completed.json'] as const){
  test('same-family recovery resumes an interrupted '+metadataName+' atomic publication without duplicate promotion',async t=>{
    const f=setup(t),good=await f.store.create(f.ledger),goodHash=hash(good.path);
    copyFileSync(good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
    const originals=originalFamily(f),before=sourceState(f);
    const internal=f.store as unknown as {publishRecoveryMetadata:(name:string)=>void};
    const original=internal.publishRecoveryMetadata;let interrupted=0;
    internal.publishRecoveryMetadata=function(name){if(name===metadataName){interrupted++;throw new Error('DISPOSABLE before '+metadataName+' publication');}original.call(f.store,name);};
    try{assert.throws(()=>f.store.recoverPending(),/DISPOSABLE before .* publication/);}
    finally{internal.publishRecoveryMetadata=original;}
    assert.equal(interrupted,1);assert.equal(existsSync(join(f.capsule,metadataName)),false);
    assert.equal(existsSync(join(f.capsule,metadataName+'.tmp')),true);preserved(f,originals,true);
    const names=completedNames(f);
    assert.equal(names.length,metadataName==='completed.json'?2:1);
    const recovered=await new FinancialBackupStore(f.options).maintainPending();assert.ok(recovered);
    assert.equal(completedNames(f).length,2);
    if(metadataName==='completed.json')assert.deepEqual(completedNames(f),names);
    assert.equal(completion(f).disposition,'PROMOTED');assert.equal(hash(good.path),goodHash);
    preserved(f,originals,true);assert.deepEqual(backupState(recovered.path),before.state);assert.deepEqual(sourceState(f),before);
  });
}

test('journal recovery diagnostics retain closed reasons and original phase while unknown text stays hash-only',()=>{
  const known=[
    ['backup retention layout needs review; nothing removed','BACKUP_RETENTION_LAYOUT_REQUIRED'],
    ['backup directory entry bound exceeded; nothing removed','BACKUP_DIRECTORY_ENTRY_BOUND_EXCEEDED'],
    ['backup recovery capsule already occupied; second journal preserved','BACKUP_RECOVERY_CAPSULE_OCCUPIED'],
    ['backup recovery capsule initialization incomplete; originals preserved','BACKUP_RECOVERY_CAPSULE_INITIALIZATION_INCOMPLETE'],
  ] as const;
  for(const [message,code] of known){
    const projected=backupFailureDiagnostic(new BackupOperationError('pending-recovery',new Error(message)));
    assert.deepEqual(projected,{version:'financial-backup-failure-v1',phase:'pending-recovery',code,
      errorSha256:digest(message),sqliteCode:null,financialFailure:true});
  }
  const privateMessage='DISPOSABLE unknown private path /fixture/private.sqlite and unrecognized details';
  for(const rawCode of ['SQLITE_READONLY_ROLLBACK','SQLITE_UNREVIEWED_PRIVATE_EXTENSION']){
    const cause=Object.assign(new Error(privateMessage),{code:rawCode});
    const projected=backupFailureDiagnostic(new BackupOperationError('pending-recovery',cause));
    assert.equal(projected.code,'OTHER_BACKUP_FAILURE');assert.equal(projected.errorSha256,digest(privateMessage));
    assert.equal(projected.sqliteCode,rawCode==='SQLITE_READONLY_ROLLBACK'?rawCode:null);
    assert.equal(projected.phase,'pending-recovery');assert.equal(projected.financialFailure,true);
    assert.equal(JSON.stringify(projected).includes(privateMessage),false);
    assert.deepEqual(Object.keys(projected).sort(),['code','errorSha256','financialFailure','phase','sqliteCode','version']);
  }
});

test('copy-error abort preserves its real cold-journal family for ordinary recovery and a new validated backup',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),before=sourceState(f),goodHash=hash(good.path);
  let originals:Original[]=[];
  await assert.rejects(f.store.create({
    state:()=>f.ledger.state(),
    async backup(path){
      assert.equal(path,f.pending);await f.ledger.backup(path);coldJournal(path);
      originals=originalFamily(f);assert.ok(originals.some(x=>x.suffix==='-journal'));
      throw new Error('DISPOSABLE source-copy callback failure after journal creation');
    },
  }),/DISPOSABLE source-copy callback failure/);
  assert.ok(originals.length>=2);preserved(f,originals);
  assert.equal(existsSync(f.pending),true);assert.equal(existsSync(f.pending+'-journal'),true);
  assert.equal(hash(good.path),goodHash);assert.deepEqual(sourceState(f),before);
  const recovered=await f.store.maintainPending();assert.ok(recovered);
  preserved(f,originals,true);assert.deepEqual(backupState(recovered.path),before.state);
  const fresh=await f.store.create(f.ledger);
  assert.deepEqual(backupState(fresh.path),before.state);assert.equal(f.store.latest().backup?.path,fresh.path);
  preserved(f,originals,true);assert.deepEqual(sourceState(f),before);
});

test('copy-error abort preserves an unsafe journal path and never follows its outside target',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),before=sourceState(f),goodHash=hash(good.path);
  const outside=join(f.dir,'DISPOSABLE-outside-abort-journal');
  writeFileSync(outside,'DISPOSABLE external evidence',{mode:0o600});const outsideHash=hash(outside);
  let pendingHash:string|undefined,pendingInode:bigint|undefined;
  await assert.rejects(f.store.create({
    state:()=>f.ledger.state(),
    async backup(path){
      await f.ledger.backup(path);
      pendingHash=hash(path);pendingInode=lstatSync(path,{bigint:true}).ino;
      symlinkSync(outside,path+'-journal');
      throw new Error('DISPOSABLE source-copy callback failure with unsafe journal');
    },
  }),/DISPOSABLE source-copy callback failure/);
  assert.equal(hash(f.pending),pendingHash);assert.equal(lstatSync(f.pending,{bigint:true}).ino,pendingInode);
  assert.equal(lstatSync(f.pending+'-journal').isSymbolicLink(),true);assert.equal(readlinkSync(f.pending+'-journal'),outside);
  assert.equal(hash(outside),outsideHash);assert.equal(hash(good.path),goodHash);
  await assert.rejects(f.store.maintainPending(),/private|canonical/);
  assert.equal(hash(f.pending),pendingHash);assert.equal(hash(outside),outsideHash);
  assert.equal(lstatSync(f.pending+'-journal').isSymbolicLink(),true);assert.deepEqual(sourceState(f),before);
});
