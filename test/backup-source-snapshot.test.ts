import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {DisposableLedger} from '../src/ledger.js';
import {BACKUP_SOURCE_SNAPSHOT_DEFAULT_RESERVE_BYTES,copyReadonlyFinancialSnapshot,type ReadonlyFinancialSnapshotOptions} from '../src/backup-source-snapshot.js';

const AT=Date.parse('2026-10-26T12:00:00Z');
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(t:TestContext,seed=0){
  const directory=mkdtempSync(join(tmpdir(),'poe-readonly-snapshot-DISPOSABLE-'));
  const stateDirectory=join(directory,'state'),backupDirectory=join(directory,'backups');
  mkdirSync(stateDirectory,{mode:0o700});mkdirSync(backupDirectory,{mode:0o700});
  const sourcePath=join(stateDirectory,'ledger.sqlite'),pendingPath=join(backupDirectory,'pending.sqlite');
  const ledger=new DisposableLedger(sourcePath,'fixture-readonly-snapshot');chmodSync(sourcePath,0o600);
  ledger.initialize({at:AT,microUsdPerSol:'100000000',source:'DISPOSABLE readonly snapshot fixture'},AT);
  const writer=(ledger as unknown as {db:Database.Database}).db;
  if(seed)writer.transaction(()=>{for(let i=0;i<seed;i++)ledger.pause('seed-'+i,AT+i,'DISPOSABLE snapshot history '+'.'.repeat(470));})();
  writeFileSync(pendingPath,'',{mode:0o600,flag:'wx'});
  const a=lstatSync(sourcePath),b=lstatSync(pendingPath);
  const options:ReadonlyFinancialSnapshotOptions={sourcePath,pendingPath,identity:{accountId:'fixture-readonly-snapshot',mode:'DISPOSABLE_PAPER',inceptionAt:AT},expectedSource:{dev:a.dev,ino:a.ino},expectedPending:{dev:b.dev,ino:b.ino},minimumRevision:ledger.state().revision};
  t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,stateDirectory,backupDirectory,sourcePath,pendingPath,ledger,writer,options};
}
type Fixture=ReturnType<typeof fixture>;
function body(db:Database.Database){return (db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}).body;}
function allRows(db:Database.Database){
  return ['SELECT * FROM financial_state ORDER BY singleton','SELECT * FROM actions ORDER BY id','SELECT * FROM journal ORDER BY revision','SELECT * FROM metadata ORDER BY key'].map(sql=>db.prepare(sql).all());
}
function assertReaderReleased(f:Fixture,t:TestContext,label:string){
  const before=f.ledger.state(),started=performance.now();
  f.ledger.pause('after-release-'+before.revision,before.lastAt+1,'DISPOSABLE writer continues after reader release');
  const writerMs=performance.now()-started;
  assert.equal(f.ledger.state().revision,before.revision+1);
  const checkpointStarted=performance.now();
  const passive=f.writer.pragma('wal_checkpoint(PASSIVE)') as {busy:number;log:number;checkpointed:number}[];
  assert.equal(passive.length,1);assert.equal(passive[0]!.busy,0);
  assert.equal(passive[0]!.checkpointed,passive[0]!.log,'all committed WAL frames advance after snapshot release');
  const truncated=f.writer.pragma('wal_checkpoint(TRUNCATE)') as {busy:number;log:number;checkpointed:number}[];
  assert.equal(truncated[0]!.busy,0);assert.equal(truncated[0]!.log,0);
  assert.equal(lstatSync(f.sourcePath+'-wal').size,0,'physical WAL space is released, not merely a nonbusy return code');
  const checkpointMs=performance.now()-checkpointStarted;
  assert.ok(writerMs<2000,'sole-writer latency stays within the stricter existing 2s readiness boundary in this fixture');
  assert.ok(checkpointMs<2000,'post-reader checkpoint work is measured within the existing 2s readiness boundary');
  t.diagnostic(JSON.stringify({label,soleWriterAfterReleaseMs:writerMs,checkpointAfterReleaseMs:checkpointMs,checkpointedFrames:passive[0]!.checkpointed,walBytesAfterTruncate:0}));
}

test('fixed read-only WAL snapshot copies exact history while the same financial writer advances',async t=>{
  const f=fixture(t,1500);f.ledger.nextSnapshotSequence();
  const originalBody=body(f.writer),originalRows=allRows(f.writer),initial=f.ledger.state();
  const writerDurations:number[]=[];let checkpointDuring:{busy:number;log:number;checkpointed:number}|undefined,wrote=false;
  const result=await copyReadonlyFinancialSnapshot({...f.options,onProgress:()=>{
    if(wrote)return;wrote=true;
    for(let i=0;i<12;i++){
      const at=performance.now();f.ledger.pause('during-copy-'+i,initial.lastAt+i+1,'DISPOSABLE concurrent sole-writer progress');writerDurations.push(performance.now()-at);
    }
    f.ledger.nextSnapshotSequence();
    checkpointDuring=(f.writer.pragma('wal_checkpoint(PASSIVE)') as {busy:number;log:number;checkpointed:number}[])[0];
  }});
  assert.ok(wrote);assert.equal(result.revision,initial.revision);assert.equal(result.lastAt,initial.lastAt);
  assert.equal(result.stateSha256,digest(originalBody));assert.equal(result.snapshotSequence,'1');assert.deepEqual(result.source,f.options.expectedSource);
  assert.equal(f.ledger.state().revision,initial.revision+12);
  const saved=new Database(f.pendingPath,{readonly:true,fileMustExist:true});
  try{assert.equal(saved.pragma('integrity_check',{simple:true}),'ok');assert.equal(body(saved),originalBody);assert.deepEqual(allRows(saved),originalRows);}finally{saved.close();}
  assert.ok(checkpointDuring&&checkpointDuring.log>checkpointDuring.checkpointed,'active snapshot measurably holds a WAL prefix');
  assert.ok(result.pages.total>100&&result.pages.steps>1);assert.equal(result.pages.copied,result.pages.total);
  assert.ok(Object.values(result.phases).every(n=>Number.isFinite(n)&&n>=0));assert.ok(result.phases.totalMs<20_000);
  assert.equal(writerDurations.length,12);assert.ok(Math.max(...writerDurations)<2000);
  assertReaderReleased(f,t,'successful fixed snapshot');
  t.diagnostic(JSON.stringify({soleWriterDuringSnapshotMaximumMs:Math.max(...writerDurations),checkpointDuring,copy:result}));
});

test('copy connection is readonly and query_only without altering writer durability or checkpoint policy',async t=>{
  const f=fixture(t);const original=Database.prototype.backup;
  const policy={synchronous:f.writer.pragma('synchronous',{simple:true}),checkpoint:f.writer.pragma('wal_autocheckpoint',{simple:true}),journal:f.writer.pragma('journal_mode',{simple:true})};
  let checked=false;
  Database.prototype.backup=function(this:Database.Database,...args:Parameters<typeof original>){
    checked=true;assert.equal(this.readonly,true);assert.equal(this.inTransaction,true);assert.equal(this.pragma('query_only',{simple:true}),1);
    assert.throws(()=>this.prepare('UPDATE financial_state SET body=body WHERE singleton=1').run(),/readonly/i);
    return original.apply(this,args);
  };
  try{await copyReadonlyFinancialSnapshot(f.options);}finally{Database.prototype.backup=original;}
  assert.ok(checked);assert.deepEqual({synchronous:f.writer.pragma('synchronous',{simple:true}),checkpoint:f.writer.pragma('wal_autocheckpoint',{simple:true}),journal:f.writer.pragma('journal_mode',{simple:true})},policy);
  assertReaderReleased(f,t,'readonly enforcement');
});

test('wrong account, financial mode, inception and minimum revision cannot produce a copy receipt',async t=>{
  const f=fixture(t);const before=body(f.writer);
  const changes:Partial<ReadonlyFinancialSnapshotOptions>[]=[
    {identity:{...f.options.identity,accountId:'foreign-account'}},
    {identity:{...f.options.identity,mode:'PAPER'}},
    {identity:{...f.options.identity,inceptionAt:AT+1}},
    {minimumRevision:f.options.minimumRevision+1},
  ];
  for(const change of changes)await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,...change}),/BACKUP_SNAPSHOT_ACCOUNT_REVISION_REQUIRED/);
  assert.equal(body(f.writer),before);assert.equal(lstatSync(f.pendingPath).size,0);assertReaderReleased(f,t,'identity refusals');
});

test('source and pending inode bindings, canonical paths, private modes and single links are enforced',async t=>{
  const f=fixture(t),before=body(f.writer);
  await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,expectedSource:{...f.options.expectedSource,ino:f.options.expectedSource.ino+1}}),/FILE_IDENTITY_REQUIRED/);
  await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,expectedPending:{...f.options.expectedPending,ino:f.options.expectedPending.ino+1}}),/FILE_IDENTITY_REQUIRED/);
  await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,pendingPath:f.sourcePath,expectedPending:f.options.expectedSource}),/DISTINCT_BOUND_FILES_REQUIRED/);
  const link=join(f.stateDirectory,'source-link.sqlite');symlinkSync(f.sourcePath,link);
  await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,sourcePath:link}),/CANONICAL_PATH_REQUIRED/);unlinkSync(link);
  chmodSync(f.sourcePath,0o640);
  try{await assert.rejects(copyReadonlyFinancialSnapshot(f.options),/FILE_IDENTITY_REQUIRED/);}finally{chmodSync(f.sourcePath,0o600);}
  const hard=join(f.stateDirectory,'source-hardlink.sqlite');linkSync(f.sourcePath,hard);
  try{await assert.rejects(copyReadonlyFinancialSnapshot(f.options),/FILE_IDENTITY_REQUIRED/);}finally{unlinkSync(hard);}
  assert.equal(body(f.writer),before);assert.equal(lstatSync(f.pendingPath).size,0);
});

test('a nonempty or missing destination is preserved and never initialized as an owned pending file',async t=>{
  const f=fixture(t);writeFileSync(f.pendingPath,'preserve unrelated bytes');
  await assert.rejects(copyReadonlyFinancialSnapshot(f.options),/EMPTY_OWNED_PENDING_REQUIRED/);
  assert.equal(readFileSync(f.pendingPath,'utf8'),'preserve unrelated bytes');
  const missing=join(f.backupDirectory,'missing.sqlite');
  await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,pendingPath:missing}),/ENOENT/);assert.equal(existsSync(missing),false);
});

test('source must already use WAL; snapshot helper does not convert its journal policy',async t=>{
  const f=fixture(t);f.writer.pragma('journal_mode = DELETE');
  await assert.rejects(copyReadonlyFinancialSnapshot(f.options),/READONLY_WAL_REQUIRED/);
  assert.equal(f.writer.pragma('journal_mode',{simple:true}),'delete');assert.equal(lstatSync(f.pendingPath).size,0);
});

test('lifetime, WAL growth, disk pressure and cancellation release the real read transaction and preserve owned pending inode',async t=>{
  for(const reason of ['lifetime','wal','disk','abort','shared-cancel'] as const){
    await t.test(reason,async t=>{
      const f=fixture(t,50);f.writer.pragma('wal_checkpoint(TRUNCATE)');
      const controller=new AbortController();let simulated=0,lowDisk=false,cancelled=false,wrote=false;
      const options:ReadonlyFinancialSnapshotOptions={...f.options,signal:controller.signal,monotonicNow:()=>simulated,cancelled:()=>cancelled,
        availableBytes:()=>lowDisk?BACKUP_SOURCE_SNAPSHOT_DEFAULT_RESERVE_BYTES-1:Number.MAX_SAFE_INTEGER,
        ...(reason==='wal'?{maximumWalGrowthBytes:1}:{}),
        onProgress:()=>{
          if(wrote)return;wrote=true;const state=f.ledger.state();f.ledger.pause('while-pinned',state.lastAt+1,'DISPOSABLE pressure/cancellation fixture');
          if(reason==='lifetime')simulated=20_000;
          if(reason==='disk')lowDisk=true;
          if(reason==='abort')controller.abort();
          if(reason==='shared-cancel')cancelled=true;
        }};
      const expected=reason==='lifetime'?'LIFETIME_EXCEEDED':reason==='wal'?'WAL_GROWTH_EXCEEDED':reason==='disk'?'DISK_RESERVE_REQUIRED':'CANCELLED';
      await assert.rejects(copyReadonlyFinancialSnapshot(options),new RegExp('BACKUP_SNAPSHOT_'+expected));
      assert.ok(wrote);assert.ok(existsSync(f.pendingPath));assert.equal(lstatSync(f.pendingPath).ino,f.options.expectedPending.ino);
      assertReaderReleased(f,t,reason+' cleanup');
    });
  }
});

test('cancellation and lifetime are checked after the final native copy even without a final progress callback',async t=>{
  for(const reason of ['cancel','lifetime'] as const){
    await t.test(reason,async t=>{
      const f=fixture(t),original=Database.prototype.backup;let cancelled=false,simulated=0,completed=false;
      Database.prototype.backup=function(this:Database.Database,...args:Parameters<typeof original>){
        return original.apply(this,args).then(result=>{completed=true;if(reason==='cancel')cancelled=true;else simulated=20_000;return result;});
      };
      try{await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,cancelled:()=>cancelled,monotonicNow:()=>simulated}),new RegExp(reason==='cancel'?'CANCELLED':'LIFETIME_EXCEEDED'));}
      finally{Database.prototype.backup=original;}
      assert.ok(completed);assertReaderReleased(f,t,'post-final '+reason);
    });
  }
});

test('both filesystem reserves are enforced and configured limits cannot enlarge the reviewed policy',async t=>{
  const f=fixture(t);
  for(const lowDirectory of [f.stateDirectory,f.backupDirectory]){
    await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,availableBytes:directory=>directory===lowDirectory?0:Number.MAX_SAFE_INTEGER}),/DISK_RESERVE_REQUIRED/);
  }
  for(const change of [{maximumLifetimeMs:20_001},{maximumWalGrowthBytes:64*1024*1024+1},{minimumFreeBytes:1024*1024,maximumWalGrowthBytes:256*1024+1}]){
    await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,...change}),/POLICY_LIMIT_REQUIRED/);
  }
  assert.equal(lstatSync(f.pendingPath).size,0);
});

test('invalid or regressing monotonic measurements refuse safely and release any pinned reader',async t=>{
  const f=fixture(t);let time=10;
  await assert.rejects(copyReadonlyFinancialSnapshot({...f.options,monotonicNow:()=>time,onProgress:()=>{time=9;}}),/MONOTONIC_CLOCK_REQUIRED/);
  assertReaderReleased(f,t,'regressing clock');
  const g=fixture(t);
  await assert.rejects(copyReadonlyFinancialSnapshot({...g.options,monotonicNow:()=>Number.NaN}),/MONOTONIC_CLOCK_REQUIRED/);
  assert.equal(lstatSync(g.pendingPath).size,0);
});
