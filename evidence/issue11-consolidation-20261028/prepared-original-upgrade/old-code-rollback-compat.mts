import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DisposableLedger as Current} from '/workspace/pump-opportunity-engine/src/ledger.ts';
import {DisposableLedger as Installed} from '/tmp/poe-original-observer-bce-offline-rollback/src/ledger.ts';
const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-old-code-rollback-'));const db=join(dir,'fixture.sqlite'),id='fixture-original-rollback-compat';
const at=1793052456212,price={at,microUsdPerSol:'100000000',source:'OFFLINE fixture only'};let current:Current|undefined,old:Installed|undefined;
try{
 current=new Current(db,id);current.initialize(price,at);current.reconcile('fixture-reconciliation',at,price,{});
 current.recordReportingPoint({at:at+1,tradingMicroUsd:'123',economicMicroUsd:null});const originalHistory=current.getReportingHistory();
 current.recordOperatingReportingPoint({at:at+10,tradingMicroUsd:'0',economicMicroUsd:null},at+10);
 const oldBasisMetadata=current.getOperatingReportingHistory();const before=JSON.stringify(current.state());const integrity=current.integrity();assert.equal(integrity,'ok');current.close();current=undefined;
 old=new Installed(db,id);assert.equal(JSON.stringify(old.state()),before);assert.equal(old.integrity(),'ok');assert.deepEqual(old.getReportingHistory(),originalHistory);const revision=old.state().revision;old.close();old=undefined;
 current=new Current(db,id);assert.equal(JSON.stringify(current.state()),before);assert.deepEqual(current.getOperatingReportingHistory(),oldBasisMetadata);assert.equal(current.state().revision,revision);
 console.log(JSON.stringify({offlineFixture:true,installedSource:'bce3d22bb434eb429aafacb788a18f39ec189c1b',newRuntimeSource:'5e55d8b939de99698ddb311a282461931fcbc957',currentToInstalledToCurrent:true,financialStateByteEqual:true,revisionUnchanged:true,originalHistoryPreserved:true,operatingV2MetadataPreserved:true,sqliteIntegrity:'ok',originalAccountOpened:false,networkRequests:0,operatingAccountInitialized:false,temporaryFixtureRemovedOnExit:true,limitation:'Actual installed service rollback and protected original ledger remain untested.'}));
}finally{current?.close();old?.close();rmSync(dir,{recursive:true,force:true});}
