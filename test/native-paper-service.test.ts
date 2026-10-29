/** OFFLINE policy and proof-retention checks. No account, provider or credentials. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseNativePaperArgs,nativePaperConfigurationSha256,nativePaperManagementReserve,nativePaperRecoveryInputs,NativePaperProofPreparation,nativePaperEssentialEvidence,nativePaperRecordServiceEvidence,nativePaperRetainRunIndex} from '../src/run-native-paper.js';
import {POE_OPERATING_ACCOUNT,assertPoeOperatingAccount,assertNativePaperAccount} from '../src/poe-operating-account.js';
import {nativePaperRootReleasePath} from '../src/native-paper-bundle.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION} from '../src/native-paper-contract.js';
const argv=['--resume','--directory','/offline','--input','/offline/input.json','--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION];
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('persistent original service is explicit and cannot hide a finite duration or substitute a financial ledger',()=>{
 const finite=parseNativePaperArgs(argv),service=parseNativePaperArgs([...argv,'--service']);
 assert.equal(finite.service,false);assert.equal(finite.durationMs,1800000);assert.equal(service.service,true);assert.equal(service.durationMs,undefined);assert.equal(service.ledgerPath,POE_OPERATING_ACCOUNT.ledgerPath);
 assert.throws(()=>parseNativePaperArgs([...argv,'--service','--duration-seconds','120']),/SERVICE_DURATION_CONFLICT/);
 assert.throws(()=>parseNativePaperArgs([...argv,'--service','--service']),/DUPLICATE/);
 assert.notEqual(nativePaperConfigurationSha256(service),nativePaperConfigurationSha256(finite));
 assert.throws(()=>nativePaperConfigurationSha256({...service,ledgerPath:'/tmp/other.sqlite'}),/ORIGINAL_LEDGER/);
 assert.throws(()=>nativePaperConfigurationSha256({...service,durationMs:120000}),/SERVICE_DURATION_CONFLICT/);
});
test('original binding preserves inception and virtual funding; fixture exception is explicit and cannot bless another live account',()=>{
 const original={...POE_OPERATING_ACCOUNT,mode:'PAPER'};assert.doesNotThrow(()=>assertPoeOperatingAccount(original));assert.doesNotThrow(()=>assertNativePaperAccount(original));
 for(const patch of [{accountId:'poe-pilot-other'},{inceptionAt:original.inceptionAt+1},{initialMicroUsd:'1000000001'},{mode:'LIVE'}])assert.throws(()=>assertPoeOperatingAccount({...original,...patch}),/IDENTITY/);
 const fixture={...original,accountId:'poe-pilot-offline-fixture',inceptionAt:1};assert.throws(()=>assertNativePaperAccount(fixture),/IDENTITY/);assert.doesNotThrow(()=>assertNativePaperAccount(fixture,{accountId:fixture.accountId,inceptionAt:1}));
 assert.throws(()=>assertNativePaperAccount(original,{accountId:original.accountId,inceptionAt:original.inceptionAt}),/FIXTURE/);
});
test('persistent management uses rolling shared headroom, never cumulative CPU or completed chapter exhaustion',()=>{
 const consumed={chapter:1000000,newUnits:1000000,maximumNewUnits:1500,newAccountedResponseBytes:10**12,maximumNewResponseBytes:1,requestLimits:{maxStartsPerMinute:60},chapterUsage:{rolling60SecondStarts:54}};
 assert.equal(nativePaperManagementReserve(consumed).entryAllowed,false);assert.equal(nativePaperManagementReserve(consumed,true).entryAllowed,true);
 assert.equal(nativePaperManagementReserve({...consumed,chapterUsage:{rolling60SecondStarts:55}},true).entryAllowed,false);
 assert.equal(nativePaperManagementReserve({...consumed,chapterUsage:{rolling60SecondStarts:57}},true).candidateWorkWithExposureAllowed,false);
 assert.equal(nativePaperManagementReserve(consumed,true).lifetimeAllowanceEnforced,false);
});
test('sealed recovery anchor includes only later unsealed chapter suffix; old actual usage cannot be counted twice',()=>{
 const directory='/offline/rpc',anchor=directory+'/operating-checkpoint-2.json',names=['chapter-001.json','chapter-002.json','chapter-003.json','chapter-004.json','unrelated.json'];
 const recovery=nativePaperRecoveryInputs({directory,names,manifestPaths:['/old.json'],manifestCheckpointSha256:'a'.repeat(64),status:{recoveryBaselinePaths:[anchor],recoveryBaselineCheckpointSha256:'b'.repeat(64)},checkpointSources:[directory+'/chapter-001.json',directory+'/chapter-002.json']});
 assert.deepEqual(recovery,{paths:[anchor,directory+'/chapter-003.json',directory+'/chapter-004.json'],checkpointSha256:'b'.repeat(64)});
});
test('qualification proof work is async and unavailable until settled; expired or different evidence never authorizes an entry',async()=>{
 let at=100,resolve!:()=>void;const retention=new Promise<void>(r=>resolve=r),preparation=new NativePaperProofPreparation(()=>at),proof={proofId:'one',mint:'fixture',startAt:1,throughAt:100,windowEndAt:90,featuresSha256:'a'.repeat(64),certificateAt:95,deadlineAt:200};
 assert.equal(preparation.prepare(proof,async()=>retention),false);assert.equal(preparation.ready(proof),false);assert.equal(preparation.prepare({...proof,proofId:'two'},async()=>{}),false,'one bounded task instead of an unbounded proof queue');
 resolve();await turn();assert.equal(preparation.ready(proof),true);assert.equal(preparation.ready({...proof,proofId:'other'}),false);at=201;assert.equal(preparation.ready(proof),false);
 const failed={...proof,proofId:'failure',deadlineAt:300};assert.equal(preparation.prepare(failed,async()=>{throw Error('offline retention refusal');}),false);await turn();assert.equal(preparation.ready(failed),false);assert.equal(preparation.usage()?.state,'failed');
});
test('rolling unqualified inputs are not permanently pinned, while actual financial and owned protection evidence are retained',()=>{
 assert.equal(nativePaperEssentialEvidence('trader-input','candidate',false),false);assert.equal(nativePaperEssentialEvidence('trader-context','protection',false),false);assert.equal(nativePaperEssentialEvidence('trader-context','protection',true),true);assert.equal(nativePaperEssentialEvidence('trader-decision','candidate',false,{stage:'strategy-rejection'}),false);assert.equal(nativePaperEssentialEvidence('trader-decision','candidate',false,{stage:'qualified'}),true);assert.equal(nativePaperEssentialEvidence('trader-execution','pending',true),true);assert.equal(nativePaperEssentialEvidence('pool-state','source',false),false);assert.equal(nativePaperEssentialEvidence('pool-state','protection',true),true);
});
test('root-owned immutable provenance exception is confined to exact commit release path',()=>{
 const commit='a'.repeat(40);assert.equal(nativePaperRootReleasePath('/opt/poe/releases/'+commit+'/native-paper.mjs',commit),true);
 for(const path of ['/tmp/native-paper.mjs','/opt/poe/current/native-paper.mjs','/opt/poe/releases/'+commit+'/other.mjs','/opt/poe/releases/'+'b'.repeat(40)+'/native-paper.mjs'])assert.equal(nativePaperRootReleasePath(path,commit),false);
});

test('candidate diagnostic pressure and recorder failure close new risk without throwing through owned financial work',()=>{
 const exposure={mint:'held',units:'100'},pending={id:'retained-exit'},positions=[exposure];let newRisk=true,heldChecks=0;
 for(const recorder of [{record:()=>false},{record:()=>{throw Error('offline evidence unavailable');}}]){
  assert.doesNotThrow(()=>nativePaperRecordServiceEvidence(recorder,'native-paper-local-phase-overrun',{elapsedMs:130},false,()=>{newRisk=false;}));
  heldChecks++;assert.equal(newRisk,false);assert.deepEqual(positions,[exposure]);assert.deepEqual(pending,{id:'retained-exit'});
 }assert.equal(heldChecks,2,'caller can continue owned management after diagnostic pressure');
});
test('restart run-index rotation preserves the last referenced current-market recovery checkpoint',()=>{
 const directory='/offline',runs=Array.from({length:130},(_,i)=>'run-'+i),checkpoint=directory+'/runs/run-0/watch-checkpoint.json';
 const index=nativePaperRetainRunIndex(runs,checkpoint,directory);assert.equal(index.retained.length,128);assert.ok(index.retained.includes('run-0'));assert.ok(index.retained.includes('run-129'));assert.deepEqual(index.archived,['run-1','run-2']);assert.equal(runs.length,130);
});
