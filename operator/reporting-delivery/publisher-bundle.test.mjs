/** Offline synthetic reporting fixtures only. No network or real credential access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {projectPilotStatus as originalProjector} from '../../src/pilot-telemetry.ts';
const directory=dirname(fileURLToPath(import.meta.url)),bundle=join(directory,'dist/publisher.mjs'),manifest=JSON.parse(await readFile(join(directory,'dist/manifest.json'),'utf8'));
const {projectPilotStatus,publishPilotStatus}=await import(pathToFileURL(bundle).href);
const accountId='poe-pilot-reporting-delivery-fixture',inceptionAt=Date.now()-60000;
const token='fixture-reporting-only-not-a-real-credential-0000';
function raw(){return {experimental:true,authoritative:false,liveTradingEnabled:false,accountId,inceptionAt,runId:'offline-bundle-fixture',generatedAt:Date.now(),source:{commit:'a'.repeat(40),sha256:'b'.repeat(64)},strategyVersion:'offline-fixture-v1',running:false,entriesEnabled:false,mode:'candidate-evaluation',financialExecutionAuthorized:false,status:'stopped; offline test',funnel:{evaluated:7,usableWindows:3},usage:{rpc:{newUnits:5},feeds:{frames:10,normalizedTrades:2,totalSocketBytes:500},eventLoopDelayP95Ms:20},timing:{completedEvaluationGaps:[],maximumCompletedGapMs:0,maximumQuoteAgeAtUseMs:0},observationAgePolicy:{version:'observation-age-v1',minimumObservationAgeMs:0,recentMaximumAgeMs:7200000,selectedOlderMaximumAgeMs:21600000},watch:{summary:{known:174,watch:120,eligibleKnown:90,maximumDeep:6,deepActive:6,queued:3,waitMs:{mean:0,maximum:0},observationEligibleKnown:116,observationQueued:8,maximumOlderResearchIdentities:24,ageCohorts:{preEntry:20,entryEligible:90,olderSelected:6}}},decisions:[],refusals:{},financial:{fixturePrivate:'DO_NOT_EXPORT'},journal:['DO_NOT_EXPORT'],credentials:{fixture:'DO_NOT_EXPORT'}};}
async function fixture(t){const d=await mkdtemp(join(tmpdir(),'poe-OFFLINE-reporting-delivery-'));t.after(()=>rm(d,{recursive:true,force:true}));const status=join(d,'status.json'),secret=join(d,'reporting-only.key'),other=join(d,'unrelated.fixture');const source=raw();await writeFile(status,JSON.stringify(source),{mode:0o600});await writeFile(secret,token,{mode:0o600});await writeFile(other,'unrelated synthetic file',{mode:0o600});return {d,status,secret,other,source};}
const launch=(f,args=[],env={})=>spawnSync('/usr/bin/bash',[join(directory,'run-publisher.sh'),'--node',process.execPath,'--status-file',f.status,'--secret-file',f.secret,'--account-id',accountId,'--inception-at',String(inceptionAt),'--verify-only',...args],{encoding:'utf8',env:{...process.env,...env},timeout:10000,maxBuffer:16384});

test('bundle and input hashes pin the existing deployed reporting release with standard-library runtime only',async()=>{
 const bytes=await readFile(bundle);assert.equal(manifest.sourceRelease,'9161d3849eae1ffa549a6afa2a1c263b6f3d1185');assert.equal(bytes.length,manifest.bundle.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.bundle.sha256);assert.equal(manifest.build.esbuild,'0.27.7');assert.equal(manifest.build.thirdPartyRuntimeDependencies,0);assert.deepEqual(manifest.build.externalImports,['node:fs/promises','node:path','node:url']);
 for(const [name,source] of Object.entries(manifest.sources)){const bytes=await readFile(resolve(directory,'../..',name));assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);}
});

test('bundle preserves the deployed projector and authenticated publisher behavior without publishing private fields',async t=>{
 const f=await fixture(t),projected=projectPilotStatus(f.source);assert.deepEqual(projected,originalProjector(f.source));assert.equal(projected.generatedAt,f.source.generatedAt);assert.equal(projected.running,false);assert.equal(projected.watch.ageCohorts.preEntry,20);assert.equal(projected.portfolio,null);let calls=0;
 const result=await publishPilotStatus({file:f.status,secret:token,accountId,inceptionAt,fetcher:async(url,options)=>{calls++;assert.equal(url.href,manifest.destination);assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+token);assert.deepEqual(JSON.parse(options.body),projected);assert.doesNotMatch(options.body,/DO_NOT_EXPORT/);return new Response(JSON.stringify({result:'accepted'}));}});
 assert.equal(calls,1);assert.equal(result.sourceAt,f.source.generatedAt);assert.equal(result.running,false);assert.equal(result.accountId,accountId);
 await assert.rejects(publishPilotStatus({file:f.status,secret:token,accountId:'poe-pilot-unrelated',inceptionAt,fetcher:()=>{throw Error('Unexpected network');}}),/identity mismatch/);
});

test('launcher verifies private files under a clean environment without starting a transport',async t=>{
 const f=await fixture(t),result=launch(f,[],{NODE_OPTIONS:'--require=/file-that-must-not-be-loaded',AWS_SECRET_ACCESS_KEY:'SYNTHETIC_DO_NOT_INHERIT',TURNKEY_API_KEY_FILE:f.other,POE_PILOT_REPORT_URL:'https://example.invalid/wrong'});assert.equal(result.status,0,result.stderr);const receipt=JSON.parse(result.stdout);assert.equal(receipt.configurationVerified,true);assert.equal(receipt.accountId,accountId);assert.equal(receipt.networkRequests,0);assert.equal(receipt.financialWriter,false);assert.doesNotMatch(result.stdout+result.stderr,/SYNTHETIC_DO_NOT_INHERIT|fixture-reporting-only-not-a-real-credential/);
});

test('runtime permissions allow only bundle/status/reporting-key reads and deny writes, children and unrelated files',async t=>{
 const f=await fixture(t),code=`import {readFile,writeFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';const [bundle,status,key,other]=process.argv.slice(2);const {readPrivateFile,projectPilotStatus}=await import(pathToFileURL(bundle).href);projectPilotStatus(JSON.parse(await readPrivateFile(status,4194304)));await readPrivateFile(key,4096);let blocked=0;for(const operation of [()=>readFile(other),()=>writeFile(status,'forbidden'),()=>spawnSync(process.execPath,['-e','process.exit(0)'])]){try{await operation();}catch(e){if(e.code==='ERR_ACCESS_DENIED')blocked++;else throw e;}}if(blocked!==3)process.exit(2);console.log(JSON.stringify({permissionDenials:blocked,networkRequests:0}));`;
 const result=spawnSync(process.execPath,['--permission','--allow-fs-read='+bundle,'--allow-fs-read='+f.status,'--allow-fs-read='+f.secret,'--input-type=module','-e',code,'poe-permission-fixture',bundle,f.status,f.secret,f.other],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:10000,maxBuffer:16384});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{permissionDenials:3,networkRequests:0});
});

test('launcher refuses wrong identity, unsafe private files and relative inputs without transmitting anything',async t=>{
 const f=await fixture(t);let result=launch(f,['--account-id','poe-pilot-other']);assert.notEqual(result.status,0);assert.match(result.stderr,/identity check failed/);await chmod(f.secret,0o644);result=launch(f);assert.notEqual(result.status,0);await chmod(f.secret,0o600);result=launch(f,['--status-file','status.json']);assert.notEqual(result.status,0);await writeFile(f.status,JSON.stringify({...f.source,generatedAt:Date.now()+60000}),{mode:0o600});result=launch(f);assert.notEqual(result.status,0,'future source is refused before network');assert.doesNotMatch(result.stdout+result.stderr,/fixture-reporting-only-not-a-real-credential/);
});

test('artifact corruption fails launcher integrity preflight before private-file access',async t=>{
 const f=await fixture(t),copy=join(f.d,'artifact');await mkdir(join(copy,'dist'),{recursive:true});await copyFile(join(directory,'run-publisher.sh'),join(copy,'run-publisher.sh'));await copyFile(join(directory,'dist/manifest.json'),join(copy,'dist/manifest.json'));await writeFile(join(copy,'dist/publisher.mjs'),'invalid artifact');const result=spawnSync('/usr/bin/bash',[join(copy,'run-publisher.sh'),'--node',process.execPath,'--status-file',f.status,'--secret-file',f.secret,'--account-id',accountId,'--inception-at',String(inceptionAt),'--verify-only'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'},timeout:10000,maxBuffer:16384});assert.notEqual(result.status,0);assert.match(result.stderr,/configuration rejected/);assert.equal(result.stdout,'');
});
