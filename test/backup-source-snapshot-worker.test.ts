import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import Database from 'better-sqlite3';
import {chmodSync,lstatSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {DisposableLedger} from '../src/ledger.js';
import type {ReadonlyFinancialSnapshotOptions,ReadonlyFinancialSnapshotProgress} from '../src/backup-source-snapshot.js';

const AT=Date.parse('2026-10-26T12:00:00Z');
type Checkpoint={busy:number;log:number;checkpointed:number};

test('forced worker termination releases an actually pinned readonly snapshot through native cleanup', {timeout:20_000},async t=>{
  const directory=mkdtempSync(join(tmpdir(),'poe-snapshot-worker-exit-DISPOSABLE-'));
  const stateDirectory=join(directory,'state'),backupDirectory=join(directory,'backups');
  mkdirSync(stateDirectory,{mode:0o700});mkdirSync(backupDirectory,{mode:0o700});
  const sourcePath=join(stateDirectory,'ledger.sqlite'),pendingPath=join(backupDirectory,'pending.sqlite');
  const accountId='fixture-readonly-snapshot-worker-exit',ledger=new DisposableLedger(sourcePath,accountId);
  let worker:Worker|undefined;
  try{
    chmodSync(sourcePath,0o600);
    ledger.initialize({at:AT,microUsdPerSol:'100000000',source:'DISPOSABLE forced worker exit fixture'},AT);
    const writer=(ledger as unknown as {db:Database.Database}).db;
    writer.transaction(()=>{for(let i=0;i<800;i++)ledger.pause('seed-'+i,AT+i,'DISPOSABLE snapshot history '+'.'.repeat(470));})();
    const reset=(writer.pragma('wal_checkpoint(TRUNCATE)') as Checkpoint[])[0]!;
    assert.equal(reset.busy,0);assert.equal(lstatSync(sourcePath+'-wal').size,0);
    writeFileSync(pendingPath,'',{mode:0o600,flag:'wx'});
    const source=lstatSync(sourcePath),pending=lstatSync(pendingPath),initial=ledger.state();
    const options:ReadonlyFinancialSnapshotOptions={sourcePath,pendingPath,identity:{accountId,mode:'DISPOSABLE_PAPER',inceptionAt:AT},expectedSource:{dev:source.dev,ino:source.ino},expectedPending:{dev:pending.dev,ino:pending.ino},minimumRevision:initial.revision};
    const barrier=new SharedArrayBuffer(3*Int32Array.BYTES_PER_ELEMENT),flags=new Int32Array(barrier);
    // This test-only barrier leaves the real SQLite transaction and native
    // backup handle alive. The parent never signals cancellation or releases
    // the barrier: worker termination must clean up without JavaScript finally.
    const code=`
      import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};
      import {parentPort,workerData} from 'node:worker_threads';
      register();
      const {copyReadonlyFinancialSnapshot}=await import(${JSON.stringify(new URL('../src/backup-source-snapshot.ts',import.meta.url).href)});
      const flags=new Int32Array(workerData.barrier);let announced=false;
      try{
        await copyReadonlyFinancialSnapshot({...workerData.options,onProgress(progress){
          if(announced)return;announced=true;
          parentPort.postMessage({kind:'pinned',progress});
          Atomics.wait(flags,0,0);
          Atomics.store(flags,1,1);
        }});
        parentPort.postMessage({kind:'completed'});
      }catch(error){parentPort.postMessage({kind:'failed',error:String(error)});}
      finally{Atomics.store(flags,2,1);}
    `;
    worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{options,barrier}});
    const messages:{kind:string;progress?:ReadonlyFinancialSnapshotProgress;error?:string}[]=[];
    const errors:Error[]=[];let exitObserved=false;
    worker.on('message',message=>messages.push(message));worker.on('error',error=>errors.push(error));worker.once('exit',()=>{exitObserved=true;});
    let waitTimer:ReturnType<typeof setTimeout>|undefined;
    const pinned=await new Promise<ReadonlyFinancialSnapshotProgress>((resolve,reject)=>{
      waitTimer=setTimeout(()=>reject(Error('real snapshot worker did not reach its pinned barrier')),10_000);
      worker!.once('message',(message:{kind:string;progress?:ReadonlyFinancialSnapshotProgress;error?:string})=>{
        if(message.kind==='pinned'&&message.progress)resolve(message.progress);
        else reject(Error('snapshot worker failed before barrier: '+JSON.stringify(message)));
      });
      worker!.once('error',reject);
      worker!.once('exit',code=>reject(Error('snapshot worker exited before barrier: '+code)));
    }).finally(()=>clearTimeout(waitTimer));
    assert.ok(pinned.totalPages>100&&pinned.remainingPages>0,'the real native backup is incomplete while its read snapshot is pinned');
    assert.deepEqual(Array.from(flags),[0,0,0]);

    const duringWriterMs:number[]=[];
    for(let i=0;i<3;i++){
      const started=performance.now();ledger.pause('while-worker-pinned-'+i,initial.lastAt+i+1,'DISPOSABLE original writer advances while worker is pinned');duringWriterMs.push(performance.now()-started);
    }
    assert.equal(ledger.state().revision,initial.revision+3);
    const during=(writer.pragma('wal_checkpoint(PASSIVE)') as Checkpoint[])[0]!;
    assert.ok(during.log>during.checkpointed,'the worker actually pins committed WAL frames, not merely a waiting JavaScript callback');
    assert.ok(lstatSync(sourcePath+'-wal').size>0);
    assert.deepEqual(Array.from(flags),[0,0,0]);assert.equal(exitObserved,false);

    const terminationStarted=performance.now(),exitCode=await worker.terminate(),terminationMs=performance.now()-terminationStarted;
    assert.equal(exitCode,1);assert.equal(exitObserved,true,'termination is awaited through physical worker exit');
    assert.deepEqual(errors,[]);assert.deepEqual(messages.map(message=>message.kind),['pinned']);
    assert.deepEqual(Array.from(flags),[0,0,0],'neither the progress callback nor JavaScript finally resumed to close the reader');
    assert.equal(lstatSync(pendingPath).ino,pending.ino,'the helper did not delete or promote its caller-owned pending artifact');

    const before=ledger.state(),writerStarted=performance.now();
    ledger.pause('after-worker-termination',before.lastAt+1,'DISPOSABLE writer remains usable after forced native cleanup');
    const afterWriterMs=performance.now()-writerStarted;
    assert.equal(ledger.state().revision,before.revision+1);assert.equal(ledger.integrity(),'ok');
    const checkpointStarted=performance.now();
    const after=(writer.pragma('wal_checkpoint(PASSIVE)') as Checkpoint[])[0]!;
    assert.equal(after.busy,0);assert.ok(after.log>0);assert.equal(after.checkpointed,after.log,'all committed frames become checkpointable after actual worker exit');
    const truncated=(writer.pragma('wal_checkpoint(TRUNCATE)') as Checkpoint[])[0]!;
    const checkpointMs=performance.now()-checkpointStarted;
    assert.equal(truncated.busy,0);assert.equal(truncated.log,0);assert.equal(lstatSync(sourcePath+'-wal').size,0,'native cleanup releases the reader so physical WAL space can be reclaimed');
    assert.ok(Math.max(...duringWriterMs,afterWriterMs)<2000,'the sole writer remains within the existing 2s readiness boundary in this disposable fixture');
    assert.ok(checkpointMs<2000,'post-exit checkpoint work remains within the existing 2s readiness boundary in this disposable fixture');
    t.diagnostic(JSON.stringify({pinnedPages:pinned.totalPages,checkpointWhilePinned:during,checkpointAfterExit:after,terminationMs,soleWriterDuringSnapshotMaximumMs:Math.max(...duringWriterMs),soleWriterAfterExitMs:afterWriterMs,checkpointAfterExitMs:checkpointMs,walBytesAfterTruncate:0,javascriptFinallyRan:false}));
  }finally{
    try{if(worker)await worker.terminate();}finally{ledger.close();rmSync(directory,{recursive:true,force:true});}
  }
});
