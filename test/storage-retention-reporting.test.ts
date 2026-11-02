import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import fs,{chmodSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {projectPoeStorageRetentionReport,writePoeStorageRetentionReport,STORAGE_RETENTION_REPORT_FILE,STORAGE_RETENTION_REPORT_MAX_BYTES,STORAGE_RETENTION_REPORT_FRESH_MS,type PoeStorageRetentionProjectionInput} from '../src/storage-retention-reporting.js';

const ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e',SOURCE='a'.repeat(40);
function sample(at=Date.now()):PoeStorageRetentionProjectionInput{return {generatedAt:at,accountId:ACCOUNT,source:SOURCE,
 financial:{schemaVersion:1,financialHistoryComplete:true,financialOrdersIndexed:25,permanentlyProtectedMints:9,reason:null,financialWrites:0},
 registry:{policy:{version:'expired-nontrade-candidate-48h-v1'},last:{at:at-1000,scannedMints:4,protectedMints:2,oversizedRowsDeferred:0,cursor:{createdAt:1,mint:'PRIVATE_TOKEN'}},retiredHistoryRows:128,compactedWatchRows:4,retiredBodyBytes:500000,reusablePages:15,pageBytes:4096},
 proofs:{policy:'poe-provisional-proof-v1',lastSweepAt:at-1000,lastCompletedSweepAt:at-2000,skipped:0,retiring:false,lastFailure:null,retiredProofs:2,retiredBytes:100000},failure:null};}
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'poe-retention-public-')),privateDirectory=join(directory,'private'),publicDirectory=join(directory,'public');mkdirSync(privateDirectory,{mode:0o700});mkdirSync(publicDirectory,{mode:0o755});chmodSync(publicDirectory,0o755);t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const publicStatusPath=join(publicDirectory,'status.json'),target=join(publicDirectory,STORAGE_RETENTION_REPORT_FILE);
 const status={schemaVersion:1,project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,accountId:ACCOUNT,release:SOURCE,generatedAt:new Date().toISOString()};
 writeFileSync(publicStatusPath,JSON.stringify(status),{mode:0o644});chmodSync(publicStatusPath,0o644);
 return {directory,privateDirectory,publicDirectory,publicStatusPath,target,status,input:{...sample(),publicStatusPath,privateDirectory}};
}

test('writes only fixed bounded sibling counts and leaves public status unchanged',t=>{
 const f=fixture(t),before=readFileSync(f.publicStatusPath);assert.equal(writePoeStorageRetentionReport(f.input),true);
 const raw=readFileSync(f.target,'utf8'),report=JSON.parse(raw);assert.ok(Buffer.byteLength(raw)<STORAGE_RETENTION_REPORT_MAX_BYTES);assert.equal(lstatSync(f.target).mode&0o777,0o644);assert.equal(lstatSync(f.target).uid,process.getuid?.());
 assert.deepEqual(Object.keys(report),['schemaVersion','kind','project','generatedAt','accountId','source','status','reason','financial','registry','proofs']);assert.equal(report.status,'healthy');assert.equal(report.registry.retiredHistoryRows,128);assert.equal(report.proofs.retiredBytes,100000);assert.ok(!raw.includes('PRIVATE_TOKEN'));assert.ok(!raw.includes('cursor'));assert.deepEqual(readFileSync(f.publicStatusPath),before);assert.deepEqual(readdirSync(f.publicDirectory).sort(),[STORAGE_RETENTION_REPORT_FILE,'status.json'].sort());
 assert.equal(writePoeStorageRetentionReport({...f.input,financial:{...(f.input.financial as object),financialOrdersIndexed:26}}),true);assert.equal(JSON.parse(readFileSync(f.target,'utf8')).financial.ordersIndexed,26);
});

test('account and installed source must match existing public status',t=>{
 const f=fixture(t);assert.equal(writePoeStorageRetentionReport(f.input),true);const before=readFileSync(f.target);
 for(const change of [{accountId:'poe-other'},{source:'b'.repeat(40)}]){assert.equal(writePoeStorageRetentionReport({...f.input,...change}),false);assert.deepEqual(readFileSync(f.target),before);}
 writeFileSync(f.publicStatusPath,JSON.stringify({...f.status,mode:'LIVE'}));assert.equal(writePoeStorageRetentionReport(f.input),false);assert.deepEqual(readFileSync(f.target),before);
});

test('directory permissions, canonical path and private separation are enforced',t=>{
 const f=fixture(t);chmodSync(f.publicDirectory,0o777);assert.equal(writePoeStorageRetentionReport(f.input),false);chmodSync(f.publicDirectory,0o755);
 assert.equal(writePoeStorageRetentionReport({...f.input,privateDirectory:f.publicDirectory}),false);
 assert.equal(writePoeStorageRetentionReport({...f.input,publicStatusPath:'relative/status.json'}),false);
 assert.equal(writePoeStorageRetentionReport({...f.input,publicStatusPath:join(f.publicDirectory,'other.json')}),false);
 assert.equal(writePoeStorageRetentionReport({...f.input,publicStatusPath:f.publicDirectory+'/../public/status.json'}),false);
 const alias=join(f.directory,'alias');symlinkSync(f.publicDirectory,alias);assert.equal(writePoeStorageRetentionReport({...f.input,publicStatusPath:join(alias,'status.json')}),false);
 const getuid=process.getuid!,owner=getuid();t.mock.method(process as NodeJS.Process&{getuid:()=>number},'getuid',()=>owner+1);assert.equal(writePoeStorageRetentionReport(f.input),false);t.mock.restoreAll();assert.deepEqual(readdirSync(f.publicDirectory),['status.json']);
});

test('existing symlinks, hardlinks, wrong modes and malformed reports remain untouched',t=>{
 const f=fixture(t),victim=join(f.privateDirectory,'victim');writeFileSync(victim,'PRIVATE_CONTENT');symlinkSync(victim,f.target);assert.equal(writePoeStorageRetentionReport(f.input),false);assert.equal(readFileSync(victim,'utf8'),'PRIVATE_CONTENT');unlinkSync(f.target);
 assert.equal(writePoeStorageRetentionReport(f.input),true);const before=readFileSync(f.target),other=join(f.privateDirectory,'linked');linkSync(f.target,other);assert.equal(writePoeStorageRetentionReport(f.input),false);assert.deepEqual(readFileSync(f.target),before);unlinkSync(other);
 chmodSync(f.target,0o666);assert.equal(writePoeStorageRetentionReport(f.input),false);chmodSync(f.target,0o644);writeFileSync(f.target,'not-json');assert.equal(writePoeStorageRetentionReport(f.input),false);assert.equal(readFileSync(f.target,'utf8'),'not-json');
});

test('foreign ownership and oversized or linked public status cannot authorize output',t=>{
 const f=fixture(t),linked=join(f.privateDirectory,'status-copy');linkSync(f.publicStatusPath,linked);assert.equal(writePoeStorageRetentionReport(f.input),false);unlinkSync(linked);
 writeFileSync(f.publicStatusPath,'x'.repeat(4097));assert.equal(writePoeStorageRetentionReport(f.input),false);writeFileSync(f.publicStatusPath,JSON.stringify(f.status));
 const inode=lstatSync(f.publicStatusPath).ino,original=fs.fstatSync;t.mock.method(fs,'fstatSync',(fd:number)=>{const info=original(fd);if(info.ino===inode)info.uid+=1;return info;});syncBuiltinESMExports();
 try{assert.equal(writePoeStorageRetentionReport(f.input),false);}finally{t.mock.restoreAll();syncBuiltinESMExports();}
 assert.deepEqual(readdirSync(f.publicDirectory),['status.json']);
});

test('projection emits only finite safe counts and fixed reasons, never unknown raw strings or IDs',()=>{
 const at=Date.now(),input=sample(at);input.financial={schemaVersion:1,financialHistoryComplete:true,financialOrdersIndexed:Infinity,permanentlyProtectedMints:-1,reason:'SECRET_RPC_URL',financialWrites:0,privateKey:'SECRET_KEY'};
 input.registry={...(input.registry as object),retiredHistoryRows:NaN,retiredBodyBytes:BigInt(1),reusablePages:'1',cursor:{mint:'SECRET_TOKEN'}};input.proofs={...(input.proofs as object),retiredBytes:Number.MAX_SAFE_INTEGER+1,lastFailure:'/private/SECRET_PATH'};input.failure='SECRET_EXCEPTION';
 const report=projectPoeStorageRetentionReport(input,at),raw=JSON.stringify(report);assert.equal(report.status,'unknown');assert.equal(report.financial.ordersIndexed,null);assert.equal(report.financial.protectedMints,null);assert.equal(report.registry.retiredHistoryRows,null);assert.equal(report.registry.retiredBodyBytes,null);assert.equal(report.registry.reusablePages,null);assert.equal(report.proofs.retiredBytes,null);assert.equal(report.reason,'RETENTION_STATUS_UNAVAILABLE');assert.ok(!raw.includes('SECRET_'));assert.ok(!raw.includes('Infinity'));assert.ok(!raw.includes('NaN'));
});

test('stale, not-run and unknown inputs cannot look like successful current cleanup',()=>{
 const at=Date.now(),input=sample(at);
 assert.equal(projectPoeStorageRetentionReport(input,at+STORAGE_RETENTION_REPORT_FRESH_MS+1).status,'stale');
 const oldRegistry={...(input.registry as object),last:{at:at-STORAGE_RETENTION_REPORT_FRESH_MS-1,oversizedRowsDeferred:0}};
 const stale=projectPoeStorageRetentionReport({...input,registry:oldRegistry},at);assert.equal(stale.status,'stale');assert.equal(stale.registry.status,'stale');assert.equal(stale.registry.lastSweepAt,at-STORAGE_RETENTION_REPORT_FRESH_MS-1);assert.equal(stale.reason,'RETENTION_REPORT_STALE');
 const missing=projectPoeStorageRetentionReport({...input,registry:null,proofs:null,financial:null},at);assert.equal(missing.status,'unknown');assert.equal(missing.financial.status,'unknown');assert.equal(missing.registry.lastSweepAt,null);
 const warming=projectPoeStorageRetentionReport({...input,financial:{...(input.financial as object),financialHistoryComplete:false},registry:{...(input.registry as object),last:null},proofs:{...(input.proofs as object),lastSweepAt:null,lastCompletedSweepAt:null}},at);assert.equal(warming.status,'warming-up');assert.equal(warming.registry.status,'not-run');
 assert.equal(projectPoeStorageRetentionReport({...input,registry:{...(input.registry as object),last:{at:at+6000,oversizedRowsDeferred:0}}},at).status,'unknown');
});

test('known cleanup problems produce bounded status codes and preserve all counts',()=>{
 const at=Date.now(),input=sample(at);
 const deferred=projectPoeStorageRetentionReport({...input,proofs:{...(input.proofs as object),lastFailure:'PROVISIONAL_PROOF_PRIVATE_FILE',skipped:3}},at);assert.equal(deferred.status,'deferred');assert.equal(deferred.reason,'PROVISIONAL_PROOF_PRIVATE_FILE');assert.equal(deferred.proofs.skipped,3);
 const large=projectPoeStorageRetentionReport({...input,registry:{...(input.registry as object),last:{at,oversizedRowsDeferred:2}}},at);assert.equal(large.status,'deferred');assert.equal(large.reason,'REGISTRY_OVERSIZED_ROWS_DEFERRED');assert.equal(large.registry.oversizedRowsDeferred,2);
 assert.equal(projectPoeStorageRetentionReport({...input,failure:'REGISTRY_BUSY_RETRY'},at).reason,'REGISTRY_BUSY_RETRY');
});

test('invalid identity or future publication cannot replace a valid report',t=>{
 const f=fixture(t);assert.equal(writePoeStorageRetentionReport(f.input),true);const before=readFileSync(f.target);
 for(const change of [{accountId:'secret/path'},{source:'not-a-source'},{generatedAt:Infinity},{generatedAt:Date.now()+60000}]){assert.equal(writePoeStorageRetentionReport({...f.input,...change}),false);assert.deepEqual(readFileSync(f.target),before);}
});

test('same account can publish a new release after the existing public status advances',t=>{
 const f=fixture(t);assert.equal(writePoeStorageRetentionReport(f.input),true);const next='b'.repeat(40);writeFileSync(f.publicStatusPath,JSON.stringify({...f.status,release:next}));assert.equal(writePoeStorageRetentionReport({...f.input,source:next}),true);assert.equal(JSON.parse(readFileSync(f.target,'utf8')).source,next);
});
