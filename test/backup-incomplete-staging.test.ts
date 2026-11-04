import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {DisposableLedger} from '../src/ledger.js';
import {FinancialBackupStore} from '../src/backup.js';
/** These killed SQLite transactions reproduce an actual hot destination journal
 * that rolls back to an empty database. They deliberately do not claim to be
 * interrupted SQLite backup API calls. The zero-byte fixture separately covers
 * the filesystem state left after backup prepare and before source copying. */
const AT=Date.parse('2026-11-04T08:00:00Z');
const digest=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function fixture(t:TestContext,prior=true,kind:'hot'|'zero'|'invalid'='hot',persistent=false){
 const root=mkdtempSync(join(tmpdir(),'poe-independent-empty-')),state=join(root,'state');mkdirSync(state,{mode:0o700});
 const source=join(state,'ledger.sqlite'),ledger=new DisposableLedger(source,'fixture-independent-empty');chmodSync(source,0o600);
 ledger.initialize({at:AT,microUsdPerSol:'100000000',source:'DISPOSABLE independent empty recovery'},AT);ledger.pause('fixture-committed',AT+1,'DISPOSABLE');ledger.nextSnapshotSequence();
 const identity={accountId:'fixture-independent-empty',inceptionAt:AT,mode:'DISPOSABLE_PAPER' as const},directory=join(root,'backups'),store=new FinancialBackupStore({directory,sourcePath:source,identity,persistent});
 let closed=false;t.after(()=>{if(!closed)ledger.close();rmSync(root,{recursive:true,force:true});});
 const good=prior?await store.create(ledger):null,pending=join(directory,'poe-financial-pending.sqlite'),journal=pending+'-journal';
 if(kind==='hot'){
  const code=`const Database=require(${JSON.stringify(import.meta.resolve('better-sqlite3').replace(/^file:\/\//,''))});const db=new Database(process.argv[1]);db.pragma('journal_mode=DELETE');db.pragma('synchronous=FULL');db.pragma('cache_size=4');db.pragma('cache_spill=ON');db.exec('BEGIN IMMEDIATE;CREATE TABLE interrupted(k TEXT,v TEXT)');const q=db.prepare('INSERT INTO interrupted VALUES(?,?)');for(let i=0;i<96;i++)q.run('row'+i,'x'.repeat(8192));process.kill(process.pid,'SIGKILL');`;
  const result=spawnSync(process.execPath,['-e',code,pending],{timeout:10000,stdio:['ignore','pipe','pipe']});assert.equal(result.error,undefined);assert.equal(result.signal,'SIGKILL',result.stderr?.toString());assert.equal(readFileSync(journal).subarray(0,8).toString('hex'),'d9d505f920a163d7');chmodSync(pending,0o600);chmodSync(journal,0o600);
  const probe=join(root,'empty-probe.sqlite');copyFileSync(pending,probe);copyFileSync(journal,probe+'-journal');const db=new Database(probe);try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal((db.prepare('SELECT count(*) n FROM sqlite_schema').get() as {n:number}).n,0);assert.equal(db.pragma('page_count',{simple:true}),0);assert.equal(db.pragma('freelist_count',{simple:true}),0);}finally{db.close();}assert.equal(lstatSync(probe).size,0);
 }else writeFileSync(pending,kind==='zero'?'':'NOT A FINANCIAL DATABASE',{mode:0o600});
 const original={database:{ino:lstatSync(pending).ino,hash:digest(pending)},journal:existsSync(journal)?{ino:lstatSync(journal).ino,hash:digest(journal)}:null},sourceHash=digest(source),wal=source+'-wal',walHash=existsSync(wal)?digest(wal):null,stateBefore=structuredClone(ledger.state());
 return {root,ledger,source,directory,identity,store,pending,journal,original,good,sourceHash,walHash,wal,stateBefore,close(){if(!closed){ledger.close();closed=true;}}};
}
function originalsArchived(f:Awaited<ReturnType<typeof fixture>>){const work=join(f.directory,'.poe-pending-recovery'),raw=join(work,'original.sqlite');assert.equal(lstatSync(raw).ino,f.original.database.ino);assert.equal(digest(raw),f.original.database.hash);if(f.original.journal){assert.equal(lstatSync(raw+'-journal').ino,f.original.journal.ino);assert.equal(digest(raw+'-journal'),f.original.journal.hash);}assert.equal(JSON.parse(readFileSync(join(work,'completed.json'),'utf8')).disposition,'PRESERVED_INCOMPLETE_STAGING');return work;}
function originalsPreserved(f:Awaited<ReturnType<typeof fixture>>){for(const [suffix,witness]of [['',f.original.database],['-journal',f.original.journal]] as const){if(!witness)continue;const active=f.pending+suffix,path=existsSync(active)?active:join(f.directory,'.poe-pending-recovery','original.sqlite'+suffix);assert.equal(lstatSync(path).ino,witness.ino);assert.equal(digest(path),witness.hash);}}
function sourceUnchanged(f:Awaited<ReturnType<typeof fixture>>){assert.deepEqual(f.ledger.state(),f.stateBefore);assert.equal(digest(f.source),f.sourceHash);if(f.walHash!==null)assert.equal(digest(f.wal),f.walHash);}
for(const kind of ['hot','zero'] as const)test(`independent real ${kind==='hot'?'SIGKILL empty-destination rollback':'zero-byte prepared staging'} preserves evidence and requires fresh actual-source copy`,async t=>{
 const f=await fixture(t,true,kind);assert.equal(await f.store.maintainPending(),null);assert.equal(existsSync(f.pending),false);assert.equal(existsSync(f.journal),false);const work=originalsArchived(f);sourceUnchanged(f);assert.equal(f.store.latest().backup!.generation,f.good!.generation,'empty recovery must not create a completed financial artifact');
 f.ledger.pause('fixture-genuine-after-empty',AT+2,'DISPOSABLE actual later event');const fresh=await f.store.create(f.ledger);assert.ok(fresh.revision>f.good!.revision);assert.equal(fresh.lastAt,AT+2);assert.equal(fresh.generation,'00000000000000000002');assert.equal(digest(join(work,'original.sqlite')),f.original.database.hash);assert.equal(lstatSync(join(work,'original.sqlite')).ino,f.original.database.ino);
});
for(const kind of ['hot','zero'] as const)test(`independent ${kind} incomplete staging refuses without a verified prior account backup`,async t=>{
 const f=await fixture(t,false,kind);await assert.rejects(f.store.maintainPending());originalsPreserved(f);sourceUnchanged(f);assert.equal(f.store.latest().backup,null);
});
test('independent nonempty invalid pending file does not enter empty recovery',async t=>{const f=await fixture(t,true,'invalid');await assert.rejects(f.store.maintainPending());assert.equal(digest(f.pending),f.original.database.hash);sourceUnchanged(f);assert.equal(f.store.latest().backup!.generation,f.good!.generation);});
test('independent source replacement after empty disposition is refused by a new store and new worker',async t=>{
 const f=await fixture(t,true,'hot');assert.ok(f.original.journal);assert.equal(await f.store.maintainPending(),null);const work=originalsArchived(f);f.close();const before=lstatSync(f.source).ino;renameSync(f.source,f.source+'.original-inode');copyFileSync(f.good!.path,f.source);chmodSync(f.source,0o600);assert.notEqual(lstatSync(f.source).ino,before);const store=new FinancialBackupStore({directory:f.directory,sourcePath:f.source,identity:f.identity});const db=new Database(f.source,{readonly:true});let state;try{state=JSON.parse((db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body);}finally{db.close();}
 await assert.rejects(store.create({state:()=>state,backup:async (target:string)=>copyFileSync(f.source,target)}),/source.*inode|source.*identity/i);assert.equal(digest(join(work,'original.sqlite')),f.original.database.hash);assert.equal(digest(join(work,'original.sqlite-journal')),f.original.journal.hash);assert.equal(store.latest().backup!.generation,f.good!.generation);
});
test('independent changed source before initial EMPTY recovery cannot be refreshed by restarting the store',async t=>{
 const f=await fixture(t,true,'hot');assert.ok(f.original.journal);f.close();const originalInode=lstatSync(f.source).ino;renameSync(f.source,f.source+'.original-inode');copyFileSync(f.good!.path,f.source);chmodSync(f.source,0o600);assert.notEqual(lstatSync(f.source).ino,originalInode);
 await assert.rejects(f.store.maintainPending(),/source.*inode|source.*identity/i);
 const restarted=new FinancialBackupStore({directory:f.directory,sourcePath:f.source,identity:f.identity});await assert.rejects(restarted.maintainPending(),/source.*inode|source.*identity/i,'a rejected original source anchor must not become acceptable after restart');originalsPreserved(f);
});

test('independent persistent fresh source snapshot alone completes the preserved EMPTY disposition',async t=>{
 const f=await fixture(t,true,'hot',true);assert.ok(f.original.journal);assert.equal(await f.store.maintainPending(),null);const work=originalsArchived(f);const manifest=JSON.parse(readFileSync(join(work,'manifest.json'),'utf8'));assert.equal(existsSync(join(work,'fresh-source.json')),false);assert.equal(Number(manifest.source.ino),lstatSync(f.source).ino);sourceUnchanged(f);
 f.ledger.pause('fixture-persistent-current-event',AT+2,'DISPOSABLE new financial event');const fresh=await f.store.create(f.ledger);assert.ok(fresh.sourceSnapshot);const receipt=JSON.parse(readFileSync(join(work,'fresh-source.json'),'utf8'));assert.equal(receipt.generation,fresh.generation);assert.equal(receipt.revision,fresh.revision);assert.equal(receipt.lastAt,AT+2);assert.equal(Number(receipt.source.ino),lstatSync(f.source).ino);assert.equal(digest(join(work,'original.sqlite')),f.original.database.hash);assert.equal(digest(join(work,'original.sqlite-journal')),f.original.journal.hash);
});

test('actual owner SIGKILL after artifact prepare leaves empty PENDING for preserved recovery and a fresh source copy',async t=>{
 const f=await fixture(t,true,'zero');unlinkSync(f.pending);const sourceUrl=new URL('../src/backup.ts',import.meta.url).href;
 const script=`import {lstatSync,existsSync} from 'node:fs';import {FinancialBackupStore} from ${JSON.stringify(sourceUrl)};const pending=${JSON.stringify(f.pending)},state=${JSON.stringify(f.ledger.state())};const store=new FinancialBackupStore({directory:${JSON.stringify(f.directory)},sourcePath:${JSON.stringify(f.source)},identity:${JSON.stringify(f.identity)}});await store.create({state:()=>state,backup:async target=>{if(target!==pending||lstatSync(target).size!==0||existsSync(target+'-journal'))throw Error('ACTUAL_PREPARE_BOUNDARY_REQUIRED');process.kill(process.pid,'SIGKILL');}});throw Error('KILL_BOUNDARY_NOT_REACHED');`;
 const killed=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{timeout:10000,stdio:['ignore','pipe','pipe']});assert.equal(killed.error,undefined);assert.equal(killed.signal,'SIGKILL',killed.stderr?.toString());assert.equal(lstatSync(f.pending).size,0);assert.equal(existsSync(f.journal),false);f.original.database={ino:lstatSync(f.pending).ino,hash:digest(f.pending)};
 assert.equal(await f.store.maintainPending(),null);const work=originalsArchived(f);sourceUnchanged(f);assert.equal(f.store.latest().backup!.generation,f.good!.generation);f.ledger.pause('fixture-after-real-preparation-kill',AT+2,'DISPOSABLE genuine source event');const current=await f.store.create(f.ledger);assert.equal(current.lastAt,AT+2);assert.ok(current.revision>f.good!.revision);assert.equal(digest(join(work,'original.sqlite')),f.original.database.hash);
});
