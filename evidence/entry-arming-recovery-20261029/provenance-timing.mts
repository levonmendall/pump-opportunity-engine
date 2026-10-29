/** OFFLINE disposable history-size timing only. No provider or operating DB.
 * An outer fixture transaction avoids 50,000 artificial fsync operations. */
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';
import {DisposableLedger} from '../../src/ledger.ts';
const root=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-control-proof-cost-')),ledger=new DisposableLedger(join(root,'fixture.sqlite'),'fixture-control-proof-cost');
let at=Date.parse('2026-10-26T12:00:00Z');const run='native-paper-'+new Date(at).toISOString().replace(/[^0-9]/g,''),price=()=>({at,microUsdPerSol:'100000000',source:'OFFLINE timing fixture USD'});
try{
 ledger.initialize(price(),at);ledger.reconcile('fixture-reconcile',at,price(),{});ledger.resume('fixture-ready',at,price(),{},{version:'OFFLINE fixture',evidence:'Synthetic accounting mechanics only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 const began=performance.now(),db=(ledger as any).db;
 db.transaction(()=>{for(let i=0;i<50000;i++){at+=1000;ledger.reconcile('fixture-history:'+i,at,price(),{});}})();
 ledger.safeStop('native-paper-stop:'+run,at);const state=ledger.state(),samples:number[]=[],cpu=process.cpuUsage();
 for(let i=0;i<10;i++){const start=performance.now(),proof=ledger.internalShutdownRecoveryProof([run],at);samples.push(performance.now()-start);assert.equal(proof.verified,true);}
 const used=process.cpuUsage(cpu),sorted=[...samples].sort((a,b)=>a-b);assert.deepEqual(ledger.state(),state);
 const result={classification:'OFFLINE_DISPOSABLE_SQL_HISTORY_TIMING_NOT_EC2_BENCHMARK',journalRows:db.prepare('SELECT count(*) n FROM journal').get().n,ordinaryReconciliationRows:50000,constructionMs:performance.now()-began,proofReads:10,samplesMs:samples,p50Ms:sorted[4],p95Ms:sorted[9],maximumMs:sorted[9],cpuMicros:used.user+used.system,financialStateUnchanged:true,stopStillRequested:state.controls.stopRequested,scope:'One-off legacy compatibility proof after a fresh audit; absent from steady 1Hz cash maintenance once armed. Actual EC2 cost remains a forward measurement.'};
 writeFileSync(new URL('./provenance-timing.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{ledger.close();rmSync(root,{recursive:true,force:true});}
