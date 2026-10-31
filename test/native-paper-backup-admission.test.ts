import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger} from '../src/ledger.js';
import {FinancialBackupStore,BackupPreparationDeferred} from '../src/backup.js';
import {nativePaperBackupFailureDisposition,nativePaperBackupDue} from '../src/run-native-paper.js';

test('an actual deferred backup preserves the prior verified artifact and readiness without inventing success',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-backup-admission-')),path=join(directory,'ledger.sqlite'),at=1793052456212;
 const ledger=new DisposableLedger(path,'fixture-timing-backup-deferral');chmodSync(path,0o600);ledger.initialize({at,microUsdPerSol:'100000000',source:'DISPOSABLE'},at);
 t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const store=new FinancialBackupStore({directory:join(directory,'backups'),sourcePath:path,identity:{accountId:ledger.accountId,mode:'DISPOSABLE_PAPER',inceptionAt:at}});
 const verified=await store.create(ledger),image=readFileSync(verified.path),before=ledger.state();let failure:unknown;
 try{await store.create(ledger,{admission:()=>false,measure:run=>run()});assert.fail('unadmitted maintenance cannot create a new verified backup');}catch(error){failure=error;}
 assert.ok(failure instanceof BackupPreparationDeferred);assert.deepEqual(nativePaperBackupFailureDisposition(true,failure),{ready:true,financialFailure:false});
 assert.equal(store.latest().backup?.path,verified.path);assert.deepEqual(readFileSync(verified.path),image);assert.deepEqual(ledger.state(),before);
 assert.deepEqual(nativePaperBackupFailureDisposition(false,failure),{ready:false,financialFailure:false},'deferral cannot manufacture the first successful backup');
 assert.deepEqual(nativePaperBackupFailureDisposition(true,Error('actual copy/validation failure')),{ready:false,financialFailure:true});
 assert.equal(nativePaperBackupDue({at:at+999,pending:false,nextAttemptAt:at+1000,lastSuccessfulAt:at}),false);
 assert.equal(nativePaperBackupDue({at:at+1000,pending:false,nextAttemptAt:at+1000,lastSuccessfulAt:at}),true,'deferral retry does not restamp the original success');
});
