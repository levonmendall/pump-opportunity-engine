/** Offline launch guards; no live directory, provider, wallet or financial file. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parseNativePaperArgs,runNativePaper,nativePaperReportingAdmission} from '../src/run-native-paper.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION} from '../src/native-paper-contract.js';
const args=['--resume','--directory','/does-not-exist','--input','/must-not-be-read','--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION];
test('native PAPER CLI requires explicit resume/contract and optional flags cannot alias args[0]',()=>{
 assert.deepEqual(parseNativePaperArgs(args),{directory:'/does-not-exist',inputPath:'/must-not-be-read',contract:NATIVE_PAPER_DATA_CONTRACT_VERSION,stage:'single',deepSlots:3,durationMs:1800000,managementOnly:false});
 const staged=parseNativePaperArgs([...args,'--stage','two','--deep-slots','6','--duration-seconds','1200']);assert.equal(staged.stage,'two');assert.equal(staged.deepSlots,6);assert.equal(staged.durationMs,1200000);
 for(const bad of [args.slice(1),[...args,'--resume'],[...args,'--stage'],[...args,'--stage','live'],[...args,'--wallet','never'],[...args,'--directory','/other']])assert.throws(()=>parseNativePaperArgs(bad),/NATIVE_PAPER_/);
});
test('wrong source contract and invalid resource selection fail before directory, lease, ledger or provider access',async()=>{
 const options=parseNativePaperArgs(args);await assert.rejects(runNativePaper({...options,contract:'confirmed-program-activity-v3-shadow'}),/EXPLICIT_NONROOT_CONTRACT/);
 for(const patch of [{durationMs:89999},{durationMs:1800001},{durationMs:NaN},{deepSlots:0},{deepSlots:7}])await assert.rejects(runNativePaper({...options,...patch}),/FINITE_RESEARCH_LIMIT/);
});
test('unbound public source and mutable/mismatched startup provenance cannot open a financial writer',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-native-paper-launch-')),path=join(directory,'input.json');t.after(()=>rmSync(directory,{recursive:true,force:true}));const input={schemaVersion:1,baselinePaths:['/must-not-be-read.json'],priorPhysicalSettled:true,priorCooldownUntil:0,origins:[],dataContract:'confirmed-program-activity-v3-shadow',source:{commit:'0'.repeat(40),sha256:'1'.repeat(64)}};writeFileSync(path,JSON.stringify(input),{mode:0o600});
 const options={...parseNativePaperArgs(args),inputPath:path};await assert.rejects(runNativePaper(options),/EXPLICIT_SOURCE_IDENTITY/);
 writeFileSync(path,JSON.stringify({...input,reportingBinding:{accountId:'poe-pilot-fixture-launch',inceptionAt:1,sourceStatusSha256:'2'.repeat(64)}}),{mode:0o600});await assert.rejects(runNativePaper(options),/FROZEN_SOURCE_REQUIRED/);
 const source=readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/\.initialize\(|sendRawTransaction|sendTransaction\(|simulateTransaction\(|privateKey/);assert.match(source,/return verifyNativePaperBundleSource\(path,input\)/);assert.match(source,/checkpoint\(\);work='candidate'/,'pool/origin recovery metadata is durable before any candidate reservation');
});

// Explicit orchestration simulation; not market or filesystem latency evidence.
test('750ms holding reads retain reporting service opportunities without moving the two-second reference cadence',()=>{
 let lastReportAt=0;const reports:number[]=[];
 for(let start=0;start<65000;start+=2000){const completedAt=start+750;const admission=nativePaperReportingAdmission({at:completedAt,lastReportAt,held:2,nextProtectionAt:start+2000,nextPendingAt:null});if(admission.admitted){reports.push(completedAt);lastReportAt=completedAt;}}
 assert.deepEqual(reports,[16750,32750,48750,64750]);assert.ok(reports.every((at,i)=>i===0||at-reports[i-1]!<=16000));
 const due={at:20000,lastReportAt:0,held:2,nextProtectionAt:22000,nextPendingAt:20100};assert.equal(nativePaperReportingAdmission(due).reason,'pending-financial-action-has-priority');
 assert.equal(nativePaperReportingAdmission({...due,nextPendingAt:null,nextProtectionAt:20250}).reason,'next-protection-start-reserved');
 assert.equal(nativePaperReportingAdmission({...due,nextPendingAt:null,nextProtectionAt:21000}).admitted,true);
 const source=readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/lastProtectionStart<500/);assert.match(source,/reportingOverruns\+\+/);assert.match(source,/maybeReport\(\);await new Promise/);
});


test('financial reporting admission is versioned and only gates new risk, never native capture or owned work',()=>{
 const source=readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8');assert.match(source,/financialProjectionReady=false/);assert.match(source,/return financialProjectionReady&&sourceAdmission\(\)/);assert.match(source,/experimentalAccounting=pilotExperimentalAccounting\(valuation\);financialProjectionReady=true/);const capture=source.slice(source.indexOf('const sourceAdmission='),source.indexOf('const lowerView='));assert.doesNotMatch(capture,/financialProjectionReady/);assert.match(source,/financialReportingPolicy:NATIVE_PAPER_FINANCIAL_REPORTING_POLICY/);assert.match(source,/entriesEnabled:projection.entriesEnabled&&financialProjectionReady/);
});
