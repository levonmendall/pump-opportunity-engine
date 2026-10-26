import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,copyFileSync,existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,truncateSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import Database from 'better-sqlite3';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
import {FinancialBackupStore} from '../src/backup.js';
import {runAccountCommand} from '../src/account.js';

const AT=Date.parse('2026-10-26T12:00:00Z');
const price=(at=AT):UsdPrice=>({at,microUsdPerSol:'100000000',source:'DISPOSABLE backup fixture'});
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function setup(t:{after:(f:()=>void)=>void},id='fixture-bounded-backup'){
  const dir=mkdtempSync(join(tmpdir(),'poe-backup-DISPOSABLE-')),state=join(dir,'state');mkdirSync(state,{mode:0o700});
  const path=join(state,'ledger.sqlite'),ledger=new DisposableLedger(path,id);chmodSync(path,0o600);ledger.initialize(price(),AT);
  const identity={accountId:id,mode:'DISPOSABLE_PAPER' as const,inceptionAt:AT};
  const options={directory:join(dir,'backups'),sourcePath:path,identity};const store=new FinancialBackupStore(options);
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});return {dir,path,ledger,store,options,identity};
}
function readState(path:string){const db=new Database(path,{readonly:true,fileMustExist:true});try{return JSON.parse((db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body);}finally{db.close();}}

test('consistent backup works while sole writer is active and restores account/history without reseeding',async t=>{
  const f=setup(t);f.ledger.reconcile('fixture-reconcile',AT,price(),{});f.ledger.nextSnapshotSequence();
  f.ledger.recordReportingPoint({at:AT+1,tradingMicroUsd:null,economicMicroUsd:null});
  const before=f.ledger.state(),history=f.ledger.getReportingHistory(),backup=await f.store.create(f.ledger);
  assert.equal(f.ledger.integrity(),'ok');assert.deepEqual(f.ledger.state(),before);
  assert.deepEqual(readState(backup.path),before);assert.equal(backup.snapshotSequence,'1');
  const db=new Database(backup.path,{readonly:true});try{assert.equal(db.pragma('journal_mode',{simple:true}),'delete');}finally{db.close();}
  assert.equal(lstatSync(backup.path).mode&0o777,0o600);assert.equal(lstatSync(f.store.directory).mode&0o777,0o700);
  assert.ok(!readdirSync(f.store.directory).some(name=>/-wal$|-shm$/.test(name)));
  const target=join(f.dir,'restored','ledger.sqlite');
  await runAccountCommand(['restore','--db',target,'--account',f.identity.accountId,'--mode','DISPOSABLE_PAPER','--input',backup.path,'--now',new Date(AT+100).toISOString()]);
  const restored=new DisposableLedger(target,f.identity.accountId);
  try{assert.equal(restored.state().inceptionAt,AT);assert.equal(restored.state().lamports,before.lamports);assert.equal(restored.state().initialMicroUsd,before.initialMicroUsd);assert.deepEqual(restored.getReportingHistory(),history);assert.equal(restored.nextSnapshotSequence(),'2');assert.equal(restored.state().controls.entriesEnabled,false);}finally{restored.close();}
});

test('backup API tolerates a financial write during its await without a second source writer',async t=>{
  const f=setup(t);const before=f.ledger.state().revision,promise=f.store.create(f.ledger);
  f.ledger.pause('fixture-write-during-backup',AT+1,'fixture independent financial progress');
  const backup=await promise;
  assert.ok(backup.revision>=before&&backup.revision<=f.ledger.state().revision);
  assert.equal(readState(backup.path).revision,backup.revision);assert.equal(f.ledger.integrity(),'ok');
});

test('retention keeps exactly two validated backups, no sidecars, and leaves source intact',async t=>{
  const f=setup(t),sourceInode=lstatSync(f.path).ino;
  f.ledger.nextSnapshotSequence();const first=await f.store.create(f.ledger);
  f.ledger.pause('fixture-next',AT+1);f.ledger.nextSnapshotSequence();const second=await f.store.create(f.ledger);
  f.ledger.pause('fixture-newest',AT+2);f.ledger.nextSnapshotSequence();const third=await f.store.create(f.ledger);
  assert.equal(existsSync(first.path),false);assert.equal(existsSync(second.path),true);assert.equal(existsSync(third.path),true);
  assert.equal(f.store.latest().backup?.path,third.path);assert.equal(f.store.latest().rejected.length,0);
  assert.deepEqual(readdirSync(f.store.directory).sort(),['.poe-backup.lock',second.path.split('/').at(-1)!,third.path.split('/').at(-1)!].sort());
  assert.equal(lstatSync(f.path).ino,sourceInode);assert.equal(f.ledger.state().revision,2);
});

test('interrupted or invalid new copies preserve both earlier good backups',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger);f.ledger.pause('fixture-next',AT+1);const second=await f.store.create(f.ledger);
  const before=[hash(first.path),hash(second.path)],cash=f.ledger.state().lamports;
  await assert.rejects(f.store.create({state:()=>f.ledger.state(),async backup(path){writeFileSync(path,'DISPOSABLE interrupted partial');throw new Error('DISPOSABLE interrupted write');}}),/interrupted/);
  await assert.rejects(f.store.create({state:()=>f.ledger.state(),async backup(path){writeFileSync(path,'DISPOSABLE invalid completed bytes');}}));
  assert.deepEqual([hash(first.path),hash(second.path)],before);assert.equal(f.store.latest().backup?.path,second.path);
  assert.equal(f.store.latest().pending,false);assert.equal(f.ledger.state().lamports,cash);
});

test('unexpected promotion target is preserved together with both old backups and validated pending copy',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger);f.ledger.pause('fixture-next',AT+1);const second=await f.store.create(f.ledger);
  const target=join(f.store.directory,'poe-financial-00000000000000000003.sqlite');
  await assert.rejects(f.store.create({state:()=>f.ledger.state(),async backup(path){await f.ledger.backup(path);writeFileSync(target,'DISPOSABLE unexpected concurrent path',{mode:0o600});}}),/unexpected backup promotion target/);
  assert.equal(existsSync(first.path),true);assert.equal(existsSync(second.path),true);assert.equal(readFileSync(target,'utf8'),'DISPOSABLE unexpected concurrent path');
  assert.equal(existsSync(join(f.store.directory,'poe-financial-pending.sqlite')),true);
});

test('corrupt latest falls back to last good copy and blocks pruning uncertain files',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger);f.ledger.pause('fixture-next',AT+1);const second=await f.store.create(f.ledger);
  writeFileSync(second.path,'DISPOSABLE corrupt latest');const older=hash(first.path),bad=hash(second.path);
  const selected=f.store.latest();assert.equal(selected.backup?.path,first.path);assert.equal(selected.rejected.length,1);
  await assert.rejects(f.store.create(f.ledger));assert.equal(hash(first.path),older);assert.equal(hash(second.path),bad);
});

test('valid SQLite with a corrupt inception conversion is rejected in favor of the earlier backup',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger);f.ledger.pause('fixture-next',AT+1);const second=await f.store.create(f.ledger);
  const db=new Database(second.path);try{const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string};const state=JSON.parse(row.body);state.inceptionPrice.microUsdPerSol='0';db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));}finally{db.close();}
  assert.equal(f.store.latest().backup?.path,first.path);await assert.rejects(f.store.create(f.ledger),/conversion|timestamped/);assert.equal(f.ledger.state().inceptionPrice.microUsdPerSol,'100000000');
});

test('the writer recovery validator rejects semantically corrupt controls in an otherwise valid SQLite copy',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger);f.ledger.pause('fixture-next',AT+1);const second=await f.store.create(f.ledger);
  const controls=f.ledger.state().controls;
  const db=new Database(second.path);try{const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string};const state=JSON.parse(row.body);state.controls=null;db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));}finally{db.close();}
  const selected=f.store.latest();assert.equal(selected.backup?.path,first.path);assert.equal(selected.rejected.length,1);
  await assert.rejects(f.store.create(f.ledger),/control invariant/);assert.deepEqual(f.ledger.state().controls,controls);
});

test('missing middle financial journal history is rejected even when latest state and SQLite integrity are valid',async t=>{
  const f=setup(t);f.ledger.pause('fixture-one',AT+1);const first=await f.store.create(f.ledger);
  f.ledger.pause('fixture-two',AT+2);f.ledger.pause('fixture-three',AT+3);const second=await f.store.create(f.ledger);
  const db=new Database(second.path);try{db.prepare('DELETE FROM journal WHERE revision=2').run();assert.equal(db.pragma('integrity_check',{simple:true}),'ok');}finally{db.close();}
  assert.equal(f.store.latest().backup?.path,first.path);await assert.rejects(f.store.create(f.ledger),/history incomplete/);assert.equal(f.ledger.state().revision,3);
});

test('reporting metadata rejected by runtime recovery cannot become the selected latest backup',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger);f.ledger.pause('fixture-next',AT+1);const second=await f.store.create(f.ledger);
  const db=new Database(second.path);try{const row=db.prepare("SELECT value FROM metadata WHERE key='reporting_history'").get() as {value:string};const history=JSON.parse(row.value);history.points[0].unexpected='DISPOSABLE corrupt metadata';db.prepare("UPDATE metadata SET value=? WHERE key='reporting_history'").run(JSON.stringify(history));}finally{db.close();}
  assert.equal(f.store.latest().backup?.path,first.path);await assert.rejects(f.store.create(f.ledger),/reporting history/);assert.equal(f.ledger.getReportingHistory().points[0]?.tradingMicroUsd,'0');
});

test('corrupt or wrong-account operating costs cannot become the selected latest backup',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger);
  f.ledger.recordOperatingCost({kind:'expense',id:'fixture-invoice',accountId:f.identity.accountId,category:'data',classification:'actual',occurredAt:AT+1,recordedAt:AT+1,amount:{currency:'USD',microUsd:'250000'},evidence:'DISPOSABLE provider invoice'});
  const second=await f.store.create(f.ledger),db=new Database(second.path);
  try{
    const original=(db.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get() as {value:string}).value;
    for(const damage of ['total','account','chronology']){
      const costs=JSON.parse(original);
      if(damage==='total')costs.totals.data.actual.knownMicroUsd='0';
      if(damage==='account')costs.accountId='fixture-other-account';
      if(damage==='chronology')costs.lastRecordedAt=AT+2;
      db.prepare("UPDATE metadata SET value=? WHERE key='operating_costs'").run(JSON.stringify(costs));
      assert.equal(f.store.latest().backup?.path,first.path);
      await assert.rejects(f.store.create(f.ledger));
    }
  }finally{db.close();}
  assert.equal(f.ledger.getOperatingCosts().totals.data.actual.knownMicroUsd,'250000');
});

test('pending recovery rejects missing cost metadata evidenced in actions or journal and preserves every copy',async t=>{
  const f=setup(t);f.ledger.pause('fixture-before-cost-history',AT+1);const good=await f.store.create(f.ledger),original=hash(good.path);
  const pending=join(f.store.directory,'poe-financial-pending.sqlite');
  for(const prefix of ['cost:','cost-valuation:'])for(const location of ['actions','journal']){
    copyFileSync(good.path,pending);const db=new Database(pending);
    try{
      if(location==='actions')db.prepare('UPDATE actions SET id=? WHERE id=?').run(prefix+'fixture-missing-metadata','fixture-before-cost-history');
      else db.prepare('UPDATE journal SET action_id=? WHERE action_id=?').run(prefix+'fixture-missing-metadata','fixture-before-cost-history');
    }finally{db.close();}
    const bad=hash(pending);
    await assert.rejects(f.store.maintainPending(),/operating cost metadata missing/);
    assert.equal(hash(pending),bad);assert.equal(hash(good.path),original);
    rmSync(pending); // This test owns the deliberately damaged disposable inode.
  }
  assert.equal(f.ledger.state().revision,1);assert.equal(f.store.latest().backup?.path,good.path);
});

test('async pending maintenance preserves uncertainty and completes only a valid backup artifact',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger),pending=join(f.store.directory,'poe-financial-pending.sqlite');
  assert.equal(await f.store.maintainPending(),null);
  f.ledger.pause('fixture-pending-next',AT+1);writeFileSync(pending,'',{mode:0o600});await f.ledger.backup(pending);
  const recovered=await f.store.maintainPending();assert.ok(recovered);assert.equal(recovered.revision,1);assert.equal(existsSync(first.path),true);
  writeFileSync(pending,'DISPOSABLE interrupted worker copy',{mode:0o600});
  await assert.rejects(f.store.maintainPending());assert.equal(readFileSync(pending,'utf8'),'DISPOSABLE interrupted worker copy');
  assert.equal(f.store.latest().backup?.path,recovered.path);assert.equal(f.ledger.state().inceptionAt,AT);
});

test('large artifact validation runs off the live event loop while the sole writer can advance', {timeout:60_000},async t=>{
  const f=setup(t),store=new FinancialBackupStore({...f.options,maxBytes:256*1024*1024});
  // Only disposable fixture generation groups public ledger actions in its
  // existing connection. No second source connection/writer is created.
  (f.ledger as unknown as {db:Database.Database}).db.transaction(()=>{
    for(let i=0;i<100_000;i++)f.ledger.pause('fixture-large-'+i,AT+i,'DISPOSABLE validation load '+'.'.repeat(470));
  })();
  await store.create(f.ledger);await store.create(f.ledger);
  const pragma=Database.prototype.pragma;let mainIntegrityChecks=0;
  Database.prototype.pragma=function(this:Database.Database,...args:Parameters<typeof pragma>){if(args[0]==='integrity_check')mainIntegrityChecks++;return pragma.apply(this,args);} as typeof pragma;
  const start=performance.now();store.latest();const synchronousMs=performance.now()-start;
  assert.equal(mainIntegrityChecks,2);mainIntegrityChecks=0;
  let previous=performance.now(),maxGapMs=0,ticks=0;
  const timer=setInterval(()=>{const at=performance.now();maxGapMs=Math.max(maxGapMs,at-previous);previous=at;ticks++;},2);
  try{
    await store.maintainPending();
    const copying=store.create(f.ledger);
    f.ledger.pause('fixture-write-during-worker-validation',AT+100_001);
    const result=await copying;
    await new Promise(resolve=>setTimeout(resolve,5));
    assert.ok(result.revision>=100_000);assert.equal(f.ledger.state().revision,100_001);
    assert.equal(mainIntegrityChecks,0,'no artifact integrity scan may execute on the financial owner thread');
    assert.ok(ticks>10,'runtime timers must advance throughout artifact work');
    assert.ok(maxGapMs<Math.max(250,synchronousMs*2),`worker max timer gap ${maxGapMs}ms; offline two-copy validation ${synchronousMs}ms`);
    t.diagnostic(JSON.stringify({disposableSourceBytes:lstatSync(f.path).size,synchronousTwoCopyValidationMs:synchronousMs,workerMaxTimerGapMs:maxGapMs,timerTicks:ticks}));
  }finally{clearInterval(timer);Database.prototype.pragma=pragma;}
});

test('compiled Node worker validates backups without a TypeScript preload', {timeout:30_000},async t=>{
  const f=setup(t),project=fileURLToPath(new URL('../',import.meta.url));
  const compiled=mkdtempSync(join(project,'.poe-backup-worker-compiled-fixture-'));t.after(()=>rmSync(compiled,{recursive:true,force:true}));
  await promisify(execFile)(process.execPath,['node_modules/typescript/bin/tsc','--outDir',compiled,'--noEmit','false'],{cwd:project,timeout:20_000,maxBuffer:128*1024});
  const {FinancialBackupStore:CompiledStore}=await import(pathToFileURL(join(compiled,'src/backup.js')).href);
  const store=new CompiledStore({...f.options,directory:join(f.dir,'compiled-backups')});
  assert.equal(await store.maintainPending(),null);const backup=await store.create(f.ledger);
  assert.equal(backup.inceptionAt,AT);assert.equal(backup.accountId,f.identity.accountId);assert.equal(store.latest().backup?.path,backup.path);
});

test('source WAL pressure blocks another copy before its backup API is called and retains prior history',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),current=lstatSync(f.path).size+lstatSync(f.path+'-wal').size;
  const bounded=new FinancialBackupStore({...f.options,maxBytes:current+4096});
  for(let i=1;i<=20;i++)f.ledger.pause('fixture-grow-'+i,AT+i);
  let calls=0;
  await assert.rejects(bounded.create({state:()=>f.ledger.state(),async backup(path){calls++;await f.ledger.backup(path);}}),/bounded|limit/);
  assert.equal(calls,0);assert.equal(existsSync(good.path),true);assert.equal(f.store.latest().pending,false);assert.equal(f.ledger.state().revision,20);
});

test('backup selection and pending recovery remain available after source loss or oversized source corruption',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),pending=join(f.store.directory,'poe-financial-pending.sqlite');
  writeFileSync(pending,'',{mode:0o600});await f.ledger.backup(pending);
  const moved=f.path+'.preserved';renameSync(f.path,moved);
  const lost=new FinancialBackupStore(f.options);assert.equal(lost.latest().backup?.path,good.path);
  const recovered=lost.recoverPending();assert.ok(recovered);assert.equal(recovered.inceptionAt,AT);assert.equal(existsSync(f.path),false);
  writeFileSync(f.path,'DISPOSABLE oversized corrupt source',{mode:0o600});truncateSync(f.path,65*1024*1024);
  const oversized=new FinancialBackupStore(f.options);assert.equal(oversized.latest().backup?.path,recovered.path);
  assert.equal(lstatSync(f.path).size,65*1024*1024);assert.equal(existsSync(moved),true);
});

test('unknown and foreign account paths are preserved and never retention targets',async t=>{
  const f=setup(t),good=await f.store.create(f.ledger),other=setup(t,'fixture-unrelated-backup');
  const foreign=await other.store.create(other.ledger),foreignPath=join(f.store.directory,'poe-financial-00000000000000000009.sqlite');
  copyFileSync(foreign.path,foreignPath);const original=hash(foreignPath);
  assert.equal(f.store.latest().backup?.path,good.path);await assert.rejects(f.store.create(f.ledger));assert.equal(hash(foreignPath),original);
  const note=join(f.store.directory,'owner-note.txt');writeFileSync(note,'preserve unrelated note',{mode:0o600});
  await assert.rejects(f.store.create(f.ledger),/needs review/);assert.equal(readFileSync(note,'utf8'),'preserve unrelated note');
});

test('a crash-left complete pending copy requires explicit validation/recovery; invalid pending stays preserved',async t=>{
  const f=setup(t),first=await f.store.create(f.ledger),pending=join(f.store.directory,'poe-financial-pending.sqlite');
  f.ledger.pause('fixture-next',AT+1);writeFileSync(pending,'',{mode:0o600});await f.ledger.backup(pending);
  await assert.rejects(f.store.create(f.ledger),/pending backup/);
  const recovered=f.store.recoverPending();assert.ok(recovered);assert.equal(recovered.revision,1);
  assert.equal(f.store.latest().backup?.path,recovered.path);assert.equal(existsSync(first.path),true);assert.equal(existsSync(pending),false);
  assert.ok(!readdirSync(f.store.directory).some(name=>/-wal$|-shm$/.test(name)));
  writeFileSync(pending,'DISPOSABLE interrupted malformed staging',{mode:0o600});
  assert.throws(()=>f.store.recoverPending());assert.equal(readFileSync(pending,'utf8'),'DISPOSABLE interrupted malformed staging');assert.equal(f.store.latest().backup?.path,recovered.path);
});

test('standard backup operation lease prevents concurrent create/recovery without touching active staging',async t=>{
  const f=setup(t);let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  const first=f.store.create({state:()=>f.ledger.state(),async backup(path){await waiting;await f.ledger.backup(path);}});
  const other=new FinancialBackupStore(f.options);
  await assert.rejects(other.create(f.ledger),/operation already active/);await assert.rejects(other.maintainPending(),/operation already active/);assert.throws(()=>other.recoverPending(),/operation already active/);
  release();await first;assert.equal(other.latest().backup?.revision,0);
});

test('unsafe backup directories and symlink targets are refused without deleting source',async t=>{
  const f=setup(t),alias=join(f.dir,'backup-alias');symlinkSync(f.store.directory,alias);
  assert.throws(()=>new FinancialBackupStore({...f.options,directory:alias}),/canonical/);
  const unsafe=join(f.dir,'shared');mkdirSync(unsafe,{mode:0o755});chmodSync(unsafe,0o755);assert.throws(()=>new FinancialBackupStore({...f.options,directory:unsafe}),/private/);
  assert.throws(()=>new FinancialBackupStore({...f.options,directory:join(f.dir,'state')}),/must not contain source/);
  const bad=join(f.store.directory,'poe-financial-00000000000000000001.sqlite');symlinkSync(f.path,bad);
  await assert.rejects(f.store.create(f.ledger),/private bounded/);assert.equal(lstatSync(bad).isSymbolicLink(),true);assert.equal(f.ledger.state().lamports,'10000000000');
});
