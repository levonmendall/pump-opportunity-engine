import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,linkSync,readFileSync,chmodSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LifetimeEquityStore} from '../src/lifetime-equity-store.js';
import {equityCredentialOwnerModeAccepted} from '../src/lifetime-equity-publisher.js';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function directory(t:{after:(fn:()=>void)=>void}){const dir=mkdtempSync(join(tmpdir(),'poe-equity-boundary-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
test('sidecar refuses a hardlink to an existing database before any writable SQLite operation',t=>{
 const dir=directory(t),original=join(dir,'sentinel.sqlite'),alias=join(dir,'equity.sqlite');
 const db=new Database(original);db.exec('CREATE TABLE financial_sentinel(value TEXT); INSERT INTO financial_sentinel VALUES(\'retain exact financial bytes\')');db.close();chmodSync(original,0o600);linkSync(original,alias);
 const before=hash(original);assert.throws(()=>new LifetimeEquityStore(alias),/PRIVATE_FILE_REQUIRED/);
 assert.equal(hash(original),before);const check=new Database(original,{readonly:true});assert.deepEqual(check.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all(),[{name:'financial_sentinel'}]);check.close();
 assert.deepEqual(readdirSync(dir).sort(),['equity.sqlite','sentinel.sqlite']);
});
test('a renamed foreign database is inspected read-only and rejected without changing any table or bytes',t=>{
 const dir=directory(t),file=join(dir,'equity.sqlite');const db=new Database(file);db.exec('CREATE TABLE financial_sentinel(value TEXT); INSERT INTO financial_sentinel VALUES(\'original\')');db.close();chmodSync(file,0o600);
 const before=hash(file);assert.throws(()=>new LifetimeEquityStore(file),/FOREIGN_SCHEMA/);assert.equal(hash(file),before);assert.deepEqual(readdirSync(dir),['equity.sqlite']);
});
test('existing sidecar can reopen, but added foreign tables prevent subsequent writable use',t=>{
 const dir=directory(t),file=join(dir,'equity.sqlite');new LifetimeEquityStore(file).close();new LifetimeEquityStore(file).close();
 const db=new Database(file);db.exec('CREATE TABLE unreviewed_extra(value)');db.close();const before=hash(file);
 assert.throws(()=>new LifetimeEquityStore(file),/FOREIGN_SCHEMA/);assert.equal(hash(file),before);
});
test('sidecar rejects a symlink parent and never creates a database through it',t=>{
 const dir=directory(t),alias=dir+'-alias';symlinkSync(dir,alias);t.after(()=>rmSync(alias,{force:true}));assert.throws(()=>new LifetimeEquityStore(join(alias,'equity.sqlite')),/PRIVATE_DIRECTORY_REQUIRED/);assert.deepEqual(readdirSync(dir),[]);
});
test('systemd credential0440 exception is restricted to this exact companion credential',()=>{
 const directory='/run/credentials/poe-lifetime-equity.service',path=directory+'/poe-ingest-secret',file={uid:0,gid:0,mode:0o100440};
 assert.equal(equityCredentialOwnerModeAccepted(path,file,988,directory),true);
 for(const [p,d,f]of [[path,undefined,file],[path,directory,{...file,uid:988}],[path,directory,{...file,gid:982}],[path,directory,{...file,mode:0o100444}],['/tmp/poe-ingest-secret',directory,file],['/run/credentials/poe-runtime.service/poe-ingest-secret','/run/credentials/poe-runtime.service',file]]as const)assert.equal(equityCredentialOwnerModeAccepted(p,f,988,d),false);
 assert.equal(equityCredentialOwnerModeAccepted('/tmp/test-private',{uid:988,gid:982,mode:0o100600},988),true);
});
