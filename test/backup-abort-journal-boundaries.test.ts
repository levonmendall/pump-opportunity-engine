/** OFFLINE disposable backups only. No operating ledger or provider access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {appendFileSync,chmodSync,copyFileSync,existsSync,lstatSync,mkdtempSync,readFileSync,readlinkSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger} from '../src/ledger.js';
import {FinancialBackupStore} from '../src/backup.js';
const AT=1793781839513,hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function fixture(t:{after:(cleanup:()=>void)=>void}){
 const root=mkdtempSync(join(tmpdir(),'poe-abort-family-')),source=join(root,'ledger.sqlite'),ledger=new DisposableLedger(source,'fixture-abort-family');chmodSync(source,0o600);ledger.initialize({at:AT,microUsdPerSol:'100000000',source:'DISPOSABLE'},AT);const identity={accountId:ledger.accountId,mode:'DISPOSABLE_PAPER' as const,inceptionAt:AT},store=new FinancialBackupStore({directory:join(root,'backups'),sourcePath:source,identity}),good=await store.create(ledger),pending=join(store.directory,'poe-financial-pending.sqlite');t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});return {root,ledger,source,identity,store,good,pending};
}
function coldJournal(path:string){const db=new Database(path,{fileMustExist:true});try{db.pragma('wal_checkpoint(TRUNCATE)');db.pragma('journal_mode=PERSIST');db.pragma('journal_size_limit=1024');db.exec('BEGIN IMMEDIATE');db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('fixture-cold-journal','committed artifact only');db.exec('COMMIT');}finally{db.close();}chmodSync(path+'-journal',0o600);assert.ok(existsSync(path+'-journal'));}

test('a copy failure preserves the entire real cold-journal family for isolated recovery and a fresh source backup',async t=>{
 const f=await fixture(t),before=f.ledger.state(),good=hash(f.good.path);let database='',journal='',inode=0;
 await assert.rejects(f.store.create({state:()=>f.ledger.state(),backup:async path=>{await f.ledger.backup(path);coldJournal(path);database=hash(path);journal=hash(path+'-journal');inode=lstatSync(path).ino;throw Error('OFFLINE_COPY_FAILURE_WITH_JOURNAL');}}),/OFFLINE_COPY_FAILURE/);
 assert.equal(hash(f.pending),database);assert.equal(hash(f.pending+'-journal'),journal);assert.equal(lstatSync(f.pending).ino,inode);assert.equal(hash(f.good.path),good);assert.deepEqual(f.ledger.state(),before);
 const recovered=await f.store.maintainPending();assert.ok(recovered?.rollbackRecovery);assert.equal(hash(join(recovered.rollbackRecovery.archiveDirectory,'original.sqlite')),database);assert.equal(hash(join(recovered.rollbackRecovery.archiveDirectory,'original.sqlite-journal')),journal);assert.deepEqual(f.ledger.state(),before);const fresh=await f.store.create(f.ledger);assert.equal(fresh.revision,before.revision);assert.equal(fresh.lastAt,before.lastAt);
});

test('an unsafe journal path during abort retains the database and never follows the outside target',async t=>{
 const f=await fixture(t),outside=join(f.root,'outside-private-artifact');writeFileSync(outside,'DISPOSABLE outside content',{mode:0o600});const external=hash(outside),before=f.ledger.state(),good=hash(f.good.path);let database='',inode=0;
 await assert.rejects(f.store.create({state:()=>f.ledger.state(),backup:async path=>{await f.ledger.backup(path);database=hash(path);inode=lstatSync(path).ino;symlinkSync(outside,path+'-journal');throw Error('OFFLINE_COPY_FAILURE_WITH_UNSAFE_JOURNAL');}}),/OFFLINE_COPY_FAILURE/);
 assert.equal(hash(f.pending),database);assert.equal(lstatSync(f.pending).ino,inode);assert.equal(lstatSync(f.pending+'-journal').isSymbolicLink(),true);assert.equal(readlinkSync(f.pending+'-journal'),outside);await assert.rejects(f.store.maintainPending(),/private regular/);assert.equal(hash(outside),external);assert.equal(hash(f.good.path),good);assert.deepEqual(f.ledger.state(),before);
});

test('a SQLite super-journal EOF trailer is rejected before any writable recovery namespace is created',async t=>{
 const f=await fixture(t),outside=join(f.root,'outside-super-journal');writeFileSync(outside,'DISPOSABLE outside content',{mode:0o600});copyFileSync(f.good.path,f.pending);chmodSync(f.pending,0o600);coldJournal(f.pending);
 const name=Buffer.from(outside),footer=Buffer.alloc(16);footer.writeUInt32BE(name.length,0);footer.writeUInt32BE(name.reduce((sum,byte)=>(sum+byte)>>>0,0),4);Buffer.from('d9d505f920a163d7','hex').copy(footer,8);appendFileSync(f.pending+'-journal',Buffer.concat([name,footer]));const database=hash(f.pending),journal=hash(f.pending+'-journal'),external=hash(outside),before=f.ledger.state(),good=hash(f.good.path);
 await assert.rejects(f.store.maintainPending(),/super-journal/);assert.equal(existsSync(f.store.directory+'.pending-recovery'),false);assert.equal(hash(f.pending),database);assert.equal(hash(f.pending+'-journal'),journal);assert.equal(hash(outside),external);assert.equal(hash(f.good.path),good);assert.deepEqual(f.ledger.state(),before);
});
