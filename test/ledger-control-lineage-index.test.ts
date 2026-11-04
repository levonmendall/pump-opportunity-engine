/** OFFLINE synthetic accounts only. Index creation must not alter permission,
 * authenticate different controls, or modify any retained financial row. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {DisposableLedger,PaperLedger,type UsdPrice} from '../src/ledger.js';
import {FinancialBackupStore} from '../src/backup.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {prepareV3ReportingAccount} from './fixtures/reporting-v3-account.js';

const AT=Date.parse('2026-10-29T01:00:00Z');
const INDEX='CREATE INDEX IF NOT EXISTS journal_kind_revision_v1 ON journal(kind,revision)';
const price=(at=AT):UsdPrice=>({at,microUsdPerSol:'100000000',source:'OFFLINE control lineage index fixture'});
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-control-index-')),privateDirectory=join(directory,'state');mkdirSync(privateDirectory,{mode:0o700});
 const path=join(privateDirectory,'fixture.sqlite'),id='fixture-offline-control-index',ledger=new DisposableLedger(path,id);chmodSync(path,0o600);ledger.initialize(price(),AT);
 t.after(()=>{try{ledger.close();}catch{}rmSync(directory,{recursive:true,force:true});});
 const db=(ledger as unknown as {db:Database.Database}).db;
 const reconcile=(at=AT)=>ledger.reconcile('OFFLINE reconcile:'+ledger.state().revision,at,price(at),{});
 const resume=(id:string,at=AT)=>ledger.resume(id,at,price(at),{},{version:'OFFLINE legacy readiness',evidence:'OFFLINE independently timestamped synthetic finance',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 const pause=(at=AT,reason='current equity or liquidation unavailable; entries closed',id='trader:pause:'+ledger.state().revision+':'+at)=>ledger.pause(id,at,reason);
 return {directory,path,id,ledger,db,reconcile,resume,pause};
}
function financialRows(db:Database.Database){return {state:db.prepare('SELECT * FROM financial_state ORDER BY singleton').all(),actions:db.prepare('SELECT * FROM actions ORDER BY id').all(),journal:db.prepare('SELECT * FROM journal ORDER BY revision').all(),metadata:db.prepare('SELECT * FROM metadata ORDER BY key').all()};}
function controlView(ledger:DisposableLedger,at:number){
 const state=ledger.state(),history=(ledger as unknown as {operatingControlHistory:(state:unknown,at:number)=>unknown}).operatingControlHistory(state,at);
 return {history,financialRecovery:ledger.operatingFinancialRecoveryAllowed(at),shutdown:ledger.internalShutdownRecoveryProof(['native-paper-20261029010000000'],at),state};
}

test('kind/revision indexing preserves authenticated control outcomes and exact original row bytes',async t=>{
 for(const scenario of ['missing-resume','old-resume','600-denied-resumes','owner-pause','copied-reason-owner','safe-stop','future-control','future-revision','corrupt-anchor','corrupt-hash','corrupt-result','missing-action','nonmonotonic-control'] as const)await t.test(scenario,st=>{
  const f=fixture(st);f.reconcile();
  if(scenario!=='missing-resume')assert.equal(f.resume('OFFLINE original grant').enabled,true);
  let at=AT+3001;
  if(scenario==='owner-pause')f.pause(at,'operator paused new entries','operator-pause:OFFLINE');
  else if(scenario==='copied-reason-owner')f.pause(at,'current equity or liquidation unavailable; entries closed','operator-pause:OFFLINE copied reason');
  else if(scenario==='safe-stop')f.ledger.safeStop('OFFLINE owner requested stop',at);
  else f.pause(at);
  const control=f.db.prepare('SELECT action_id FROM journal ORDER BY revision DESC LIMIT 1').get() as {action_id:string};
  if(scenario==='600-denied-resumes')for(let n=0;n<600;n++)assert.equal(f.resume('OFFLINE denied stale readiness '+n,at).enabled,false);
  f.reconcile(at);
  if(scenario==='future-control')f.db.prepare('UPDATE journal SET at=? WHERE action_id=?').run(at+1,control.action_id);
  if(scenario==='future-revision')f.db.prepare('UPDATE journal SET revision=? WHERE action_id=?').run(f.ledger.state().revision+1,control.action_id);
  if(scenario==='corrupt-anchor')f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),'OFFLINE original grant');
  if(scenario==='corrupt-hash')f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),control.action_id);
  if(scenario==='corrupt-result')f.db.prepare('UPDATE actions SET result=? WHERE id=?').run('{',control.action_id);
  if(scenario==='missing-action')f.db.prepare('DELETE FROM actions WHERE id=?').run(control.action_id);
  if(scenario==='nonmonotonic-control'){
   f.pause(at+1);at++;
   // Corrupt only this disposable retained row. Runtime cannot append a
   // backwards financial clock, and the index must not hide one if retained.
   f.db.prepare('UPDATE journal SET at=? WHERE revision=?').run(at-2,f.ledger.state().revision);
  }
  f.db.exec('DROP INDEX IF EXISTS journal_kind_revision_v1');const rows=financialRows(f.db),before=controlView(f.ledger,at);
  f.db.exec(INDEX);const after=controlView(f.ledger,at);
  assert.deepEqual(after,before,'same validated control result with unchanged query predicates/order');
  assert.deepEqual(financialRows(f.db),rows,'schema-only index retains every original financial/result byte');
  if(['owner-pause','copied-reason-owner','safe-stop','future-control','future-revision','corrupt-anchor','corrupt-hash','corrupt-result','missing-action','nonmonotonic-control'].includes(scenario))assert.equal(after.financialRecovery,false,'index cannot authorize a hard or unverified control');
  if(scenario==='old-resume'||scenario==='600-denied-resumes')assert.equal(after.financialRecovery,true,'valid temporary recovery remains available');
 });
});

test('reopening installs the index idempotently after identity checks without changing retained financial rows',t=>{
 const f=fixture(t);f.reconcile();assert.equal(f.resume('OFFLINE grant').enabled,true);f.pause();f.db.exec('DROP INDEX IF EXISTS journal_kind_revision_v1');const original=financialRows(f.db);f.ledger.close();
 assert.throws(()=>new DisposableLedger(f.path,'fixture-offline-wrong-account'),/identity|account/);
 const inspected=new Database(f.path,{readonly:true});try{assert.deepEqual(financialRows(inspected),original);assert.equal((inspected.prepare("SELECT count(*) count FROM sqlite_master WHERE type='index' AND name='journal_kind_revision_v1'").get() as {count:number}).count,0,'wrong identity cannot add the index');}finally{inspected.close();}
 for(let n=0;n<2;n++){
  const reopened=new DisposableLedger(f.path,f.id);try{const db=(reopened as unknown as {db:Database.Database}).db;assert.deepEqual(financialRows(db),original);assert.deepEqual(db.prepare("PRAGMA index_info('journal_kind_revision_v1')").all().map((row:any)=>row.name),['kind','revision']);assert.equal((db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='index' AND name='journal_kind_revision_v1'").get() as {count:number}).count,1);}finally{reopened.close();}
 }
});

test('consistent backup read-only validation accepts the index while retaining the original account and history',async t=>{
 const f=fixture(t);f.reconcile();assert.equal(f.resume('OFFLINE grant').enabled,true);f.pause();const before=financialRows(f.db),state=f.ledger.state();
 const store=new FinancialBackupStore({directory:join(f.directory,'backups'),sourcePath:f.path,identity:{accountId:f.id,mode:'DISPOSABLE_PAPER',inceptionAt:AT}}),backup=await store.create(f.ledger),selected=store.latest();
 assert.equal(selected.backup?.path,backup.path);assert.equal(selected.rejected.length,0);assert.equal(backup.accountId,f.id);assert.equal(backup.inceptionAt,AT);assert.equal(backup.revision,state.revision);
 const db=new Database(backup.path,{readonly:true,fileMustExist:true});try{assert.deepEqual(financialRows(db),before);assert.deepEqual(db.prepare("PRAGMA index_info('journal_kind_revision_v1')").all().map((row:any)=>row.name),['kind','revision']);assert.equal(db.pragma('journal_mode',{simple:true}),'delete');}finally{db.close();}
 assert.deepEqual(financialRows(f.db),before,'backup and index validation introduce no financial write');
});

test('V3 epoch anchors and a large original snapshot sequence remain byte-identical across index installation',async t=>{
 // Ordinary production methods create both epoch receipts in this fresh,
 // disposable path. No operating account database is opened or copied.
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-v3-control-index-')),path=join(directory,'fixture.sqlite');
 let ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);
 t.after(()=>{try{ledger.close();}catch{}rmSync(directory,{recursive:true,force:true});});
 await prepareV3ReportingAccount(ledger,join(directory,'epoch-backups'),AT);
 const db=(ledger as unknown as {db:Database.Database}).db,sequence='900719925474099312345678901234567890';
 db.prepare("INSERT INTO metadata VALUES('snapshot_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(sequence);
 assert.equal((db.prepare("SELECT count(*) n FROM journal WHERE kind='paper-epoch-transition'").get() as {n:number}).n,2);
 db.exec('DROP INDEX IF EXISTS journal_kind_revision_v1');const original=financialRows(db),state=ledger.state();
 ledger.close();ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);
 const reopened=(ledger as unknown as {db:Database.Database}).db;
 assert.deepEqual(financialRows(reopened),original,'index installation preserves both epoch receipts, accounting and all metadata bytes');
 assert.deepEqual(ledger.state(),state);assert.ok(ledger.state().paperEpoch?.id.includes('v3'));
 assert.equal((reopened.prepare("SELECT value FROM metadata WHERE key='snapshot_sequence'").get() as {value:string}).value,sequence);
 assert.deepEqual(reopened.prepare("PRAGMA index_info('journal_kind_revision_v1')").all().map((row:any)=>row.name),['kind','revision']);
});

test('read-only validation continues accepting an original pre-index backup without modifying its bytes',async t=>{
 const f=fixture(t);f.reconcile();assert.equal(f.resume('OFFLINE legacy grant').enabled,true);f.pause();
 f.db.exec('DROP INDEX IF EXISTS journal_kind_revision_v1');const before=financialRows(f.db);
 const store=new FinancialBackupStore({directory:join(f.directory,'legacy-backups'),sourcePath:f.path,identity:{accountId:f.id,mode:'DISPOSABLE_PAPER',inceptionAt:AT}}),backup=await store.create(f.ledger);
 const hash=()=>createHash('sha256').update(readFileSync(backup.path)).digest('hex'),originalHash=hash();
 f.db.exec(INDEX);const selected=store.latest();
 assert.equal(selected.backup?.path,backup.path);assert.equal(selected.rejected.length,0);assert.equal(hash(),originalHash,'legacy backup remains an untouched original');
 const db=new Database(backup.path,{readonly:true,fileMustExist:true});try{assert.deepEqual(financialRows(db),before);assert.equal((db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name='journal_kind_revision_v1'").get() as {n:number}).n,0,'validation does not require or add the newer index');}finally{db.close();}
 assert.deepEqual(financialRows(f.db),before);
});
