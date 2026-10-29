/** OFFLINE frozen239 configuration regression. No services/providers/financial IO.
 * Restored identities/flow/RPC replies are labeled synthetic, not market evidence.
 * Business sources are exported from the exact installed commit, never imported
 * from the mutable resource-v2 working tree. Only test-fixture plumbing is adapted.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const COMMIT='239a00ea9fbc0a25ebcf318631d26618d941c899',repo=process.cwd();
const frozen=mkdtempSync(join(tmpdir(),'poe-OFFLINE-frozen239-four-'));
const originalFile='evidence/integration-2026-10-26T23-32-41.255Z.ndjson';
const tar=execFileSync('git',['archive',COMMIT,'src','package.json','package-lock.json','test/native-candidate-runner.test.ts','test/native-flow-fixture.ts',originalFile],{cwd:repo,maxBuffer:32*1024*1024});
execFileSync('tar',['-xf','-','-C',frozen],{input:tar,timeout:10000});
symlinkSync(join(repo,'node_modules'),join(frozen,'node_modules'),'dir');
const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const fixturePath=join(frozen,'test/native-candidate-runner.test.ts');
const original=readFileSync(fixturePath,'utf8'),firstTest=original.indexOf('\ntest(');assert.ok(firstTest>0);
let helper=original.slice(0,firstTest);
const fixtureNeedle='function fixture(config:{';assert.ok(helper.includes(fixtureNeedle));helper=helper.replace(fixtureNeedle,'export function fixture(config:{restoredWatch?:unknown;');
const constructorNeedle='now:()=>at,maximumDeep:config.maximumDeep??1,admissionOpen:()=>allow';assert.ok(helper.includes(constructorNeedle));helper=helper.replace(constructorNeedle,'now:()=>at,restoredWatch:config.restoredWatch,maximumDeep:config.maximumDeep??1,admissionOpen:()=>allow');
helper=helper.replace("readFileSync('"+originalFile+"'",'readFileSync('+JSON.stringify(join(frozen,originalFile)));
const helperPath=join(frozen,'test/four-slot-fixture.ts');writeFileSync(helperPath,helper);
const {fixture}=await import(pathToFileURL(helperPath).href);
const {setup:nativeFixture,scope}=await import(pathToFileURL(join(frozen,'test/native-flow-fixture.ts')).href);
const {PilotFeeds}=await import(pathToFileURL(join(frozen,'src/pilot-feeds.ts')).href);
const run=await import(pathToFileURL(join(frozen,'src/run-native-paper.ts')).href);
const {resolvePilotStage}=await import(pathToFileURL(join(frozen,'src/pilot.ts')).href);
const {NATIVE_PAPER_DATA_CONTRACT_VERSION}=await import(pathToFileURL(join(frozen,'src/native-paper-contract.ts')).href);
const {PublicKey}=await import('@solana/web3.js');
const {canonicalPumpPoolPda}=await import(pathToFileURL(join(frozen,'src/sdk.ts')).href);
let observedMaximum=0;const provenance={commit:COMMIT,exportedRoot:frozen,archiveSha256:digest(tar),runnerSourceSha256:digest(readFileSync(join(frozen,'src/native-candidate-runner.ts'))),fixtureSourceSha256:digest(original),fixtureAdapterSha256:digest(helper),providerRequests:0,serviceOperations:0,financialDatabaseOpened:false};

test('frozen239 six-to-four resume preserves six watch identities, enforces four audits, and fairly replaces retired scopes',async()=>{
 const before=fixture({maximumDeep:6,forcePredictiveFeatures:true});const mints=Array.from({length:6},(_,i)=>before.seed(i+1));await before.steps(30);assert.equal(before.runner.status().candidates.length,6);
 const checkpoint=before.runner.checkpoint();assert.equal(checkpoint.watch.rows.filter((r:any)=>r.state==='DEEP_OBSERVATION').length,6);await before.runner.stop('OFFLINE prior six-slot fixture stopped');
 const after=fixture({maximumDeep:4,forcePredictiveFeatures:true,restoredWatch:checkpoint.watch});
 assert.equal(after.runner.status().candidates.length,0,'old subscriptions/certificates are never restored as current');assert.equal(after.runner.status().watch.rows.length,6);assert.equal(after.runner.status().watch.summary.maximumDeep,4);assert.ok(after.runner.status().watch.rows.every((r:any)=>r.state==='DEFERRED'&&r.deepSince===null));
 const add=after.flow.addCandidate.bind(after.flow);after.flow.addCandidate=(s:any)=>{assert.ok(after.states.size+after.retiring.size<4,'retiring scopes also occupy physical capacity');add(s);observedMaximum=Math.max(observedMaximum,after.states.size+after.retiring.size);};
 await after.steps(50);const initial=after.runner.status();assert.equal(initial.candidates.length,4);assert.equal(initial.watch.summary.maximumDeep,4);assert.equal(initial.watch.summary.deepActive,4);assert.deepEqual(new Set(initial.watch.rows.map((r:any)=>r.mint)),new Set(mints));assert.equal(initial.watch.rows.filter((r:any)=>['WATCH','DEFERRED'].includes(r.state)).length,2);assert.equal(after.added.length,4);
 after.advance(70000);after.refresh();for(let i=0;i<80&&after.runner.status().counters.predictiveAssessments<4;i++){await after.runner.step();after.advance(50);}const audited=after.runner.status();assert.equal(audited.counters.predictiveAssessments,4,JSON.stringify({counters:audited.counters,candidates:audited.candidates,lastRecords:after.records.slice(-12)}));assert.equal(audited.counters.auditedWindows,4);assert.equal(audited.counters.uniqueEvaluated,4);assert.equal(audited.counters.decisionDeadlineMisses,0);assert.equal(after.rpcCalls.length,4,'four independent audit targets, no request for the two waiting identities');assert.equal(after.maximumInFlight,1);assert.equal(audited.maximumSimultaneousCandidates,4);
 const initiallySelected=new Set(initial.candidates.map((r:any)=>r.mint)),waiting=mints.filter((m:string)=>!initiallySelected.has(m));
 const replacements:Array<{retired:string;waitMs:number;currentDeep:number}>=[];for(const retire of [...initiallySelected].slice(0,2)){const retiredAt=after.now;after.runner.onGap({mint:retire,at:after.now,reason:'OFFLINE_SYNTHETIC_SCOPE_RETIREMENT'});for(let i=0;i<320&&after.runner.status().candidates.length<4;i++){await after.runner.step();after.advance(50);}assert.equal(after.runner.status().candidates.length,4);assert.ok(after.runner.status().maximumSimultaneousCandidates<=4);assert.equal(after.runner.status().watch.rows.length,6);replacements.push({retired:String(retire),waitMs:after.now-retiredAt,currentDeep:after.runner.status().candidates.length});}
 assert.ok(waiting.every((m:string)=>after.added.includes(m)),'both previously waiting identities get a fair replacement opportunity');assert.deepEqual(new Set(after.added),new Set(mints));assert.equal(observedMaximum,4);assert.equal(after.runner.status().financialWriterOpened,false);assert.equal(after.runner.status().financialExecutionAuthorized,false);assert.equal(after.runner.status().liveTradingEnabled,false);await after.runner.stop('OFFLINE four-slot fixture finished');
 console.log(JSON.stringify({kind:'OFFLINE_FROZEN_239_FOUR_SLOT_RESUME',...provenance,formerlyDeep:6,retainedWatchIdentities:6,maximumSimultaneousCandidates:observedMaximum,independentAuditedCandidates:4,allWaitingIdentitiesEventuallyAllocated:true,syntheticSchedulerStepMs:50,replacements,financialExecution:false}));
});

test('frozen239 native and broad-feed constructors honor four independently of watch and position capacity',async()=>{
 const f=nativeFixture({maximumCandidates:4});const scopes=Array.from({length:5},(_,i)=>{const mint=new PublicKey(Buffer.alloc(32,i+80)).toBase58();return{mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),minSlot:scope.minSlot};});for(const s of scopes.slice(0,4))f.flow.addCandidate(s);assert.equal(f.flow.usage().maximumCandidates,4);assert.equal(f.flow.usage().candidates,4);assert.throws(()=>f.flow.addCandidate(scopes[4]),/CANDIDATE_CAPACITY/);assert.equal(f.operations.length,0);assert.equal(f.supportCalls.length,0);await f.flow.stop('OFFLINE constructor test');
 const feeds=new PilotFeeds({maximumCandidates:4,persistent:true,amountConvention:'curve',control:{operateData(){throw Error('OFFLINE_NETWORK_FORBIDDEN');},accountControlBytes(){},noteThrottle(){return 0;}},record(){},onMigration(){},onTrade(){throw Error('OFFLINE_TRADE_FORBIDDEN');},onGap(){}},{setTimer(){return 1;},clearTimer(){},makeSocket(){throw Error('OFFLINE_NETWORK_FORBIDDEN');}});assert.equal(feeds.usage().maximumCandidates,4);assert.equal(feeds.usage().discoveryConnected,false);await feeds.stop();
});

test('only the frozen239 deep-slot argument changes; original account, strategy, timing, financial limits and source remain fixed',()=>{
 const argv=['--resume','--directory','/var/lib/poe/native-engine','--input','/var/lib/poe/native-engine/input.json','--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION,'--stage','single','--service'];
 const six=run.parseNativePaperArgs([...argv,'--deep-slots','6']),four=run.parseNativePaperArgs([...argv,'--deep-slots','4']);assert.deepEqual(four,{...six,deepSlots:4});assert.equal(four.service,true);assert.equal(four.stage,'single');assert.equal(four.ledgerPath,'/var/lib/poe/state/ledger.sqlite');assert.equal(four.managementOnly,false);const policy=resolvePilotStage(four.stage),priorPolicy=resolvePilotStage(six.stage);assert.deepEqual(policy,priorPolicy);assert.equal(policy.binding.maxPositions,1);
 const sixHash=run.nativePaperConfigurationSha256(six),fourHash=run.nativePaperConfigurationSha256(four);assert.equal(sixHash,'5e99ebe042521b3917a11b86ef4b46264205b11d38c407cba264a01046a79344','the fixture imports the actual frozen v1 configuration, not working resource-v2');assert.notEqual(fourHash,sixHash);
 const file=resolve('/tmp/poe-native-paper-output-coherent-entry-20261029/native-paper.mjs'),raw=readFileSync(file);console.log(JSON.stringify({kind:'OFFLINE_FROZEN_239_FOUR_SLOT_CONFIGURATION',...provenance,previousDeepSlots:6,deepSlots:4,previousConfigurationSha256:sixHash,configurationSha256:fourHash,frozenExecutableSha256:digest(raw),executableBytes:raw.length,strategyAndRiskContractSha256:policy.contractSha256,maximumPaperPositions:policy.binding.maxPositions,financialAccountPreserved:true}));
});
