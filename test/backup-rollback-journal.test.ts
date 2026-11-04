import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,copyFileSync,existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {DisposableLedger} from '../src/ledger.js';
import {FinancialBackupStore} from '../src/backup.js';

const AT=Date.parse('2026-11-04T08:00:00Z');
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const capsule=(directory:string)=>join(directory,'.poe-pending-recovery');
function crashPending(pending:string){
 const journal=pending+'-journal';
 const child=`const Database=require(${JSON.stringify(import.meta.resolve('better-sqlite3').replace(/^file:\/\//,''))});const db=new Database(process.argv[1]);db.pragma('journal_mode=DELETE');db.pragma('synchronous=FULL');db.pragma('cache_size=8');db.pragma('cache_spill=ON');db.exec('BEGIN IMMEDIATE');const insert=db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)');for(let n=0;n<96;n++)insert.run('UNCOMMITTED-crash-'+n,'x'.repeat(8192));process.kill(process.pid,'SIGKILL');`;
 const result=spawnSync(process.execPath,['-e',child,pending],{stdio:['ignore','pipe','pipe'],timeout:10000});assert.equal(result.signal,'SIGKILL',result.stderr?.toString());assert.equal(result.error,undefined);
 assert.ok(existsSync(journal),'SIGKILL must leave the original rollback journal');assert.equal(readFileSync(journal).subarray(0,8).toString('hex'),'d9d505f920a163d7','dirty pages must have spilled after a durable hot-journal header');
}
/** A real killed SQLite writer, not a hand-built journal or malformed file.
 * Enough dirty pages spill under an uncommitted transaction to make its
 * rollback journal hot. The financial source is a distinct disposable file. */
async function hotPendingFixture(t:{after:(cleanup:()=>void)=>void},prepare?:(path:string)=>void){
 const root=mkdtempSync(join(tmpdir(),'poe-hot-journal-DISPOSABLE-')),state=join(root,'state');mkdirSync(state,{mode:0o700});
 const sourcePath=join(state,'ledger.sqlite'),ledger=new DisposableLedger(sourcePath,'fixture-hot-journal');chmodSync(sourcePath,0o600);
 ledger.initialize({at:AT,microUsdPerSol:'100000000',source:'DISPOSABLE rollback recovery fixture'},AT);
 ledger.pause('fixture-valid-before-crash',AT+1,'DISPOSABLE original committed state');ledger.nextSnapshotSequence();
 const identity={accountId:'fixture-hot-journal',inceptionAt:AT,mode:'DISPOSABLE_PAPER' as const};
 const store=new FinancialBackupStore({directory:join(root,'backups'),sourcePath,identity});
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 const first=await store.create(ledger);ledger.pause('fixture-next-good-backup',AT+2,'DISPOSABLE second committed generation');ledger.nextSnapshotSequence();const second=await store.create(ledger);
 const pending=join(store.directory,'poe-financial-pending.sqlite'),journal=pending+'-journal';copyFileSync(second.path,pending);chmodSync(pending,0o600);prepare?.(pending);
 const stateBefore=structuredClone(ledger.state()),sourceHashBefore=digest(sourcePath),sourceWal=sourcePath+'-wal',walHashBefore=existsSync(sourceWal)?digest(sourceWal):null;
 crashPending(pending);
 return {root,ledger,sourcePath,sourceWal,sourceHashBefore,walHashBefore,stateBefore,store,identity,pending,journal,first,second,pendingHash:digest(pending),journalHash:digest(journal)};
}

function assertOriginalsUnchanged(f:Awaited<ReturnType<typeof hotPendingFixture>>){
 for(const [active,raw,hash]of [[f.pending,join(capsule(f.store.directory),'original.sqlite'),f.pendingHash],[f.journal,join(capsule(f.store.directory),'original.sqlite-journal'),f.journalHash]]){const paths=[active!,raw!].filter(existsSync);assert.equal(paths.length,1,'each original has exactly one preserved location');assert.equal(digest(paths[0]!),hash);}
 assert.deepEqual(f.ledger.state(),f.stateBefore);assert.equal(digest(f.sourcePath),f.sourceHashBefore);if(f.walHashBefore!==null)assert.equal(digest(f.sourceWal),f.walHashBefore);
}

test('real crash-left hot journal requires writable recovery of a private copy and leaves original financial evidence unchanged',async t=>{
 const f=await hotPendingFixture(t),isolated=join(f.root,'isolated');mkdirSync(isolated,{mode:0o700});const copy=join(isolated,'pending.sqlite');copyFileSync(f.pending,copy);copyFileSync(f.journal,copy+'-journal');chmodSync(copy,0o600);chmodSync(copy+'-journal',0o600);
 assert.throws(()=>{const readonly=new Database(copy,{readonly:true,fileMustExist:true});try{readonly.pragma('integrity_check');}finally{readonly.close();}},/readonly|read-only|rollback/i,'a readonly pre-validation cannot resolve a hot journal');
 const recovered=new Database(copy,{fileMustExist:true});try{assert.equal(recovered.pragma('integrity_check',{simple:true}),'ok');assert.equal((recovered.prepare("SELECT count(*) n FROM metadata WHERE key LIKE 'UNCOMMITTED-crash-%'").get() as {n:number}).n,0,'SQLite must roll back every uncommitted insertion');assert.deepEqual(JSON.parse((recovered.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body),f.stateBefore);}finally{recovered.close();}
 assert.equal(existsSync(copy+'-journal'),false);assertOriginalsUnchanged(f);
});

test('a real hot pending journal is recovered only on an isolated copy, promoted and preserved as original forensic evidence',async t=>{
 const f=await hotPendingFixture(t),secondHash=digest(f.second.path),originalPendingStat=(await import('node:fs')).lstatSync(f.pending),originalJournalStat=(await import('node:fs')).lstatSync(f.journal);
 const result=await f.store.maintainPending();assert.ok(result);assert.equal(result.generation,'00000000000000000003');assert.equal(result.revision,f.stateBefore.revision);assert.equal(result.lastAt,f.stateBefore.lastAt);assert.equal(result.snapshotSequence,'2');
 assert.equal(existsSync(f.pending),false);assert.equal(existsSync(f.journal),false);assert.equal(digest(f.second.path),secondHash);
 const original=join(capsule(f.store.directory),'original.sqlite'),journal=original+'-journal';assert.equal(JSON.parse(readFileSync(join(capsule(f.store.directory),'completed.json'),'utf8')).disposition,'PROMOTED');
 assert.equal(digest(original),f.pendingHash);assert.equal(digest(journal),f.journalHash);assert.equal((await import('node:fs')).lstatSync(original).ino,originalPendingStat.ino);assert.equal((await import('node:fs')).lstatSync(journal).ino,originalJournalStat.ino);
 assert.equal(lstatSync(original).mtimeMs,originalPendingStat.mtimeMs);assert.equal(lstatSync(journal).mtimeMs,originalJournalStat.mtimeMs);
 const db=new Database(result.path,{readonly:true,fileMustExist:true});try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(JSON.parse((db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body),f.stateBefore);assert.equal((db.prepare("SELECT count(*) n FROM metadata WHERE key LIKE 'UNCOMMITTED-crash-%'").get() as {n:number}).n,0);}finally{db.close();}
 assert.deepEqual(f.ledger.state(),f.stateBefore);assert.equal(digest(f.sourcePath),f.sourceHashBefore);if(f.walHashBefore!==null)assert.equal(digest(f.sourceWal),f.walHashBefore);
 assert.equal(await f.store.maintainPending(),null,'a completed incident is not repeatedly promoted or counted as a current backup');
 f.ledger.pause('fixture-current-after-recovery',AT+3,'DISPOSABLE genuine later financial event');const current=await f.store.create(f.ledger);assert.ok(current.revision>result.revision);assert.equal(current.lastAt,AT+3,'the ordinary new source backup uses its actual new source state');assert.equal(digest(original),f.pendingHash);assert.equal(digest(journal),f.journalHash);
});

for(const boundary of ['promotion','database-relocation','journal-relocation'] as const)test(`real SIGKILL after ${boundary} resumes the same incident without re-promotion or lost raw evidence`,async t=>{
 const f=await hotPendingFixture(t),sourceUrl=new URL('../src/backup.ts',import.meta.url).href;
 const script=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {FinancialBackupStore} from ${JSON.stringify(sourceUrl)};const directory=${JSON.stringify(f.store.directory)},pending=${JSON.stringify(f.pending)},journal=${JSON.stringify(f.journal)},boundary=${JSON.stringify(boundary)};const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(boundary==='promotion'&&String(a).endsWith('/candidate.sqlite')&&String(b).startsWith(directory+'/poe-financial-')||boundary==='database-relocation'&&a===pending||boundary==='journal-relocation'&&a===journal)process.kill(process.pid,'SIGKILL');};syncBuiltinESMExports();const store=new FinancialBackupStore({directory,sourcePath:${JSON.stringify(f.sourcePath)},identity:${JSON.stringify(f.identity)}});store.recoverPending();throw Error('CRASH_BOUNDARY_NOT_REACHED');`;
 const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe'],timeout:15000});assert.equal(child.signal,'SIGKILL',child.stderr?.toString());
 const raw=join(capsule(f.store.directory),'original.sqlite');assertOriginalsUnchanged(f);
 const result=await f.store.maintainPending();assert.ok(result);assert.equal(result.generation,'00000000000000000003');assert.equal(result.revision,f.stateBefore.revision);assert.equal(result.lastAt,f.stateBefore.lastAt);assert.equal(existsSync(f.pending),false);assert.equal(existsSync(f.journal),false);assert.equal(digest(raw),f.pendingHash);assert.equal(digest(raw+'-journal'),f.journalHash);
 assert.deepEqual(f.ledger.state(),f.stateBefore);assert.equal(digest(f.sourcePath),f.sourceHashBefore);if(f.walHashBefore!==null)assert.equal(digest(f.sourceWal),f.walHashBefore);assert.equal(await f.store.maintainPending(),null);
});

test('the immutable financial source cannot occupy any recovery workspace path',async t=>{
 const f=await hotPendingFixture(t),directory=capsule(f.store.directory);mkdirSync(directory,{mode:0o700});const source=join(directory,'candidate.sqlite');copyFileSync(f.second.path,source);chmodSync(source,0o600);const before=digest(source);
 assert.throws(()=>new FinancialBackupStore({directory:f.store.directory,sourcePath:source,identity:f.identity}),/backup directory must not contain source/);assert.equal(digest(source),before);assertOriginalsUnchanged(f);
});

test('an original source inode moved to pending cannot become a writable target after its source path is replaced',async t=>{
 const f=await hotPendingFixture(t);unlinkSync(f.pending);unlinkSync(f.journal);const inode=lstatSync(f.sourcePath).ino;renameSync(f.sourcePath,f.pending);copyFileSync(f.second.path,f.sourcePath);chmodSync(f.sourcePath,0o600);const original=digest(f.pending),replacement=digest(f.sourcePath),state=f.ledger.state();assert.equal(lstatSync(f.pending).ino,inode);assert.notEqual(lstatSync(f.sourcePath).ino,inode);
 await assert.rejects(f.store.maintainPending(),/cannot modify financial source/);assert.equal(digest(f.pending),original);assert.equal(digest(f.sourcePath),replacement);assert.deepEqual(f.ledger.state(),state);assert.equal(existsSync(capsule(f.store.directory)),false);
});

for(const invalid of ['foreign-account','incomplete-history'] as const)test(`a hot ${invalid} pending copy fails full certification and preserves all original inputs on repeated attempts`,async t=>{
 const f=await hotPendingFixture(t,path=>{const db=new Database(path);try{if(invalid==='foreign-account'){const row=JSON.parse((db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body);row.accountId='fixture-foreign';db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(row));}else db.prepare('DELETE FROM journal WHERE revision=1').run();}finally{db.close();}}),good=[digest(f.first.path),digest(f.second.path)];
 for(let attempt=0;attempt<2;attempt++){await assert.rejects(f.store.maintainPending());assertOriginalsUnchanged(f);assert.deepEqual([digest(f.first.path),digest(f.second.path)],good);}
 const root=capsule(f.store.directory),raw=join(root,'original.sqlite');assert.equal(readdirSync(f.store.directory).filter(name=>name==='.poe-pending-recovery').length,1,'a failed incident never grows a new quarantine per retry');assert.equal(digest(raw),f.pendingHash);assert.equal(digest(raw+'-journal'),f.journalHash);
});

for(const unsafe of ['unknown-file','completed-sidecar'] as const)test(`${unsafe} remains closed before recovery changes any original artifact`,async t=>{
 const f=await hotPendingFixture(t),path=unsafe==='completed-sidecar'?f.second.path+'-journal':join(f.store.directory,'UNKNOWN-artifact');writeFileSync(path,'',{mode:0o600});
 await assert.rejects(f.store.maintainPending(),/retention layout/);assertOriginalsUnchanged(f);assert.equal(existsSync(capsule(f.store.directory)),false);
});

test('a cancelled isolated normalization discards only its derived WAL/SHM on retry',async t=>{
 const f=await hotPendingFixture(t),access=f.store as unknown as {normalize:(path:string)=>void};access.normalize=path=>{writeFileSync(path+'-wal','DERIVED',{mode:0o600});writeFileSync(path+'-shm','DERIVED',{mode:0o600});throw Error('OFFLINE_INTERRUPTED_NORMALIZATION');};
 assert.throws(()=>f.store.recoverPending(),/OFFLINE_INTERRUPTED/);assertOriginalsUnchanged(f);
 const result=await f.store.maintainPending();assert.ok(result);assert.equal(result.revision,f.stateBefore.revision);assert.equal(digest(join(capsule(f.store.directory),'original.sqlite')),f.pendingHash);assert.deepEqual(f.ledger.state(),f.stateBefore);assert.equal(digest(f.sourcePath),f.sourceHashBefore);if(f.walHashBefore!==null)assert.equal(digest(f.sourceWal),f.walHashBefore);
});

test('an unavailable copy reserve preserves raw inputs and permits recovery after genuine capacity returns',async t=>{
 const f=await hotPendingFixture(t),restricted=new FinancialBackupStore({directory:f.store.directory,sourcePath:f.sourcePath,identity:f.identity,minimumFreeBytes:Number.MAX_SAFE_INTEGER});
 await assert.rejects(restricted.maintainPending(),/disk headroom/);assertOriginalsUnchanged(f);const root=capsule(f.store.directory);assert.equal(readdirSync(f.store.directory).filter(name=>name==='.poe-pending-recovery').length,1);assert.equal(digest(join(root,'original.sqlite')),f.pendingHash);
 const result=await f.store.maintainPending();assert.ok(result);assert.equal(result.revision,f.stateBefore.revision);assert.deepEqual(f.ledger.state(),f.stateBefore);
});

test('one genuine preserved incident exhausts the fixed capsule without removing any failed evidence',async t=>{
 const f=await hotPendingFixture(t);assert.ok(await f.store.maintainPending());
 const root=capsule(f.store.directory),before=readdirSync(root).sort();assert.equal(readdirSync(f.store.directory).filter(name=>name==='.poe-pending-recovery').length,1);const raw=[digest(join(root,'original.sqlite')),digest(join(root,'original.sqlite-journal'))];
 copyFileSync(f.store.latest().backup!.path,f.pending);chmodSync(f.pending,0o600);crashPending(f.pending);const pending=digest(f.pending),journal=digest(f.journal),latest=digest(f.store.latest().backup!.path);
 for(let attempt=0;attempt<2;attempt++){await assert.rejects(f.store.maintainPending(),/capsule already occupied/);assert.deepEqual(readdirSync(root).sort(),before);assert.equal(digest(f.pending),pending);assert.equal(digest(f.journal),journal);assert.deepEqual([digest(join(root,'original.sqlite')),digest(join(root,'original.sqlite-journal'))],raw);assert.equal(digest(f.store.latest().backup!.path),latest);}assert.deepEqual(f.ledger.state(),f.stateBefore);
});

test('unknown interrupted metadata cannot grow or bypass the fixed capsule layout',async t=>{
 const f=await hotPendingFixture(t,path=>{const db=new Database(path);try{db.prepare('DELETE FROM journal WHERE revision=1').run();}finally{db.close();}});await assert.rejects(f.store.maintainPending());assertOriginalsUnchanged(f);
 const work=capsule(f.store.directory);writeFileSync(join(work,'receipt.json.new-00000000-0000-0000-0000-000000000000'),'',{mode:0o600});const before=readdirSync(work).sort();
 for(let attempt=0;attempt<2;attempt++){await assert.rejects(f.store.maintainPending(),/capsule layout invalid/);assert.deepEqual(readdirSync(work).sort(),before);assertOriginalsUnchanged(f);}
});

test('an actual committed SQLite PERSIST journal with a zeroed header is preserved and validated without inventing rollback work',async t=>{
 const f=await hotPendingFixture(t),db=new Database(f.pending);try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.pragma('journal_mode=PERSIST');db.pragma('journal_size_limit=1024');db.exec('BEGIN IMMEDIATE');db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('fixture-committed-cold-journal','actual committed artifact');db.exec('COMMIT');}finally{db.close();}
 assert.equal(readFileSync(f.journal).subarray(0,8).toString('hex'),'0000000000000000');assert.equal(readFileSync(f.journal).length,1024);f.pendingHash=digest(f.pending);f.journalHash=digest(f.journal);
 const result=await f.store.maintainPending();assert.ok(result);const raw=join(capsule(f.store.directory),'original.sqlite');assert.equal(digest(raw),f.pendingHash);assert.equal(digest(raw+'-journal'),f.journalHash);
 const recovered=new Database(result.path,{readonly:true});try{assert.equal((recovered.prepare('SELECT value FROM metadata WHERE key=?').get('fixture-committed-cold-journal') as {value:string}).value,'actual committed artifact');assert.deepEqual(JSON.parse((recovered.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body),f.stateBefore);}finally{recovered.close();}assert.equal(digest(f.sourcePath),f.sourceHashBefore);if(f.walHashBefore!==null)assert.equal(digest(f.sourceWal),f.walHashBefore);
});
