/** Synthetic offline package integration. No market, credentials or dispatch. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),stager=join(repository,'scripts/stage-native-candidate-ec2.mjs'),MIB=1024*1024,profile='candidate-native-two-hour-research-v1',profile90='candidate-native-two-hour-90-research-v1',study='observation-age-selected-24h-study-v1',shadow='confirmed-program-activity-v3-shadow';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t,{wrong90=false}={}){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-staging-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bundle=join(root,'bundle'),publisher=join(root,'publisher');mkdirSync(bundle);mkdirSync(join(publisher,'dist'),{recursive:true});
 const executable=Buffer.from(`export function nativeCandidateRunSettings(duration,profile,policy,contract){const selected=profile?{version:profile,maximumUnits:profile==='${profile90}'?${wrong90?7500:11500}:7500,physical:{startsPerMinute:profile==='${profile90}'?90:60}}:null;return {duration,profile:selected,limits:selected,policy,dataContract:contract};}\nexport function nativeCandidateConfigurationSha256(settings){return 'e'.repeat(64);}\n`);
 writeFileSync(join(bundle,'native-candidates.mjs'),executable);
 writeFileSync(join(bundle,'metadata.json'),JSON.stringify({entry:{path:'src/run-native-candidates.ts'},bundle:{sha256:sha(executable),bytes:executable.length},smoke:{exitStatus:0},measurementExecuted:false,credentialsRead:false,externalImports:[],dependencies:[],git:{commit:'a'.repeat(40)}}));
 const publicPublisher=Buffer.from('// SYNTHETIC reporting module; never executed\n'),release='b'.repeat(40);
 writeFileSync(join(publisher,'dist/publisher.mjs'),publicPublisher);writeFileSync(join(publisher,'dist/manifest.json'),JSON.stringify({schemaVersion:1,sourceRelease:release,destination:'https://meme-machine-dashboard-staging.onrender.com/api/pilot',bundle:{sha256:sha(publicPublisher),bytes:publicPublisher.length},build:{thirdPartyRuntimeDependencies:0}}));writeFileSync(join(publisher,'run-publisher.sh'),'# SYNTHETIC '+release+' --verify-only --permission\n');
 const book=join(root,'old.json');writeFileSync(book,JSON.stringify({schemaVersion:1,budgetId:'SYNTHETIC',calls:2,bytes:100,lastObservedAt:1000,starts:[900,1000],pending:[],blockedReason:'RPC_HTTP_429'}));
 const input={schemaVersion:1,priorPhysicalSettled:true,priorCooldownUntil:0,source:{commit:'a'.repeat(40),sha256:sha(executable)},baselinePaths:[book],origins:[],reportingBinding:{accountId:'poe-pilot-8468add6-f916-48cf-a585-6cd008a81360',inceptionAt:1793123773252,sourceStatusSha256:'c'.repeat(64)}};
 function run(extra=[],patch={}){const path=join(root,'input-'+Math.random().toString(36).slice(2)+'.json'),output=join(root,'stage-'+Math.random().toString(36).slice(2));writeFileSync(path,JSON.stringify({...input,...patch}));const result=spawnSync(process.execPath,['--import','tsx',stager,'--bundle-directory',bundle,'--input',path,'--publisher-directory',publisher,'--output',output,...extra],{cwd:repository,encoding:'utf8',timeout:15000});return {...result,output,manifest:()=>JSON.parse(readFileSync(join(output,'scripts/poe/native-candidates/package.json'),'utf8'))};}
 return {root,book,input,run};
}
test('default staging keeps the900-second envelope and pins independently staged readback helper',t=>{
 const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);const m=r.manifest();assert.equal(m.researchProfile,null);assert.equal(m.observationAgePolicy,'observation-age-v1');assert.equal(m.dataContract,'confirmed-program-events-v2');assert.equal(m.configurationSha256,'e'.repeat(64));assert.deepEqual([m.limits.durationSeconds,m.limits.temporaryMiB,m.limits.artifactMiB,m.limits.maximumBaselinePaths],[900,256,192,224]);assert.equal(m.limits.maximumComponentBookBytes,512*1024);assert.equal(m.limits.maximumBaselineBytes,32*MIB);assert.equal(m.costs.githubArtifactUpload,true);
 const helper=readFileSync(join(r.output,'operator/native-candidate-ec2/readback-public-evidence.py'));assert.equal(sha(helper),m.publicEvidenceReadback.helperSha256);assert.match(readFileSync(join(r.output,'.github/workflows/poe-native-candidate-evidence-readback.yml'),'utf8'),new RegExp(m.publicEvidenceReadback.helperSha256));assert.doesNotMatch(readFileSync(join(r.output,'.github/workflows/poe-native-candidates-research.yml'),'utf8'),/__REVIEWED_/);
});
test('two-hour source/profile/age/contract are explicit and Python and staged maps agree exactly',t=>{
 const f=fixture(t),r=f.run(['--profile',profile,'--observation-age-policy',study,'--data-contract',shadow],{observationAgePolicy:study,dataContract:shadow});assert.equal(r.status,0,r.stderr);const m=r.manifest();assert.equal(m.researchProfile,profile);assert.equal(m.observationAgePolicy,study);assert.equal(m.dataContract,shadow);assert.equal(m.costs.githubArtifactUpload,false);assert.equal(m.costs.artifactRetentionDays,null);assert.deepEqual([m.limits.durationSeconds,m.limits.temporaryMiB,m.limits.artifactMiB,m.limits.runnerCpuSeconds],[7200,1536,1280,1920]);assert.equal(m.baselineByteRunway.fullWorstCaseRunwayGuaranteed,false);
 const python=spawnSync('python3',['-B','-I','-c',`import importlib.util,json,sys;s=importlib.util.spec_from_file_location('bounded',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.host_profile(sys.argv[2])))`,join(repository,'operator/native-candidate-ec2/run-bounded.py'),profile],{encoding:'utf8'});assert.equal(python.status,0,python.stderr);assert.deepEqual(m.limits,JSON.parse(python.stdout));const workflow=readFileSync(join(r.output,'.github/workflows/poe-native-candidates-research.yml'),'utf8');assert.match(workflow,/timeout-minutes: 125/);assert.match(workflow,/5s 7320s/);assert.match(workflow,/POE_NATIVE_RESEARCH_PROFILE == 'default-900s'/);
});
test('duration profile never opts into shadow data or selected24-hour observation implicitly',t=>{
 const f=fixture(t),r=f.run(['--profile',profile]);assert.equal(r.status,0,r.stderr);assert.equal(r.manifest().observationAgePolicy,'observation-age-v1');assert.equal(r.manifest().dataContract,'confirmed-program-events-v2');
 for(const [args,patch,message] of [[['--profile','unlimited'],{},'UNKNOWN_HOST_RESEARCH_PROFILE'],[[],{observationAgePolicy:study},'EXPLICIT_OBSERVATION_POLICY_MISMATCH'],[[],{dataContract:shadow},'EXPLICIT_DATA_CONTRACT_MISMATCH'],[['--data-contract','unknown'],{},'UNKNOWN_DATA_CONTRACT'],[['--data-contract',shadow],{},'EXPLICIT_DATA_CONTRACT_MISMATCH']]){const bad=f.run(args,patch);assert.notEqual(bad.status,0);assert.match(bad.stderr,new RegExp(message));}
});
test('staging bounds physical book size, aggregate bytes and initial path count before reading accounting',t=>{
 const f=fixture(t),big=join(f.root,'oversize.json');writeFileSync(big,Buffer.alloc(512*1024+1,32));let r=f.run([],{baselinePaths:[big]});assert.notEqual(r.status,0);assert.match(r.stderr,/BOUNDED_REGULAR_PUBLIC_FILE_REQUIRED/);
 const paths=[];for(let i=0;i<65;i++){const path=join(f.root,'aggregate-'+i+'.json');writeFileSync(path,Buffer.alloc(512*1024,32));paths.push(path);}r=f.run([],{baselinePaths:paths});assert.notEqual(r.status,0);assert.match(r.stderr,/BASELINE_AGGREGATE_BYTE_CAP/);
 r=f.run(['--profile',profile],{baselinePaths:Array(193).fill(f.book)});assert.notEqual(r.status,0);assert.match(r.stderr,/PUBLIC_INPUT_CAPACITY/);
});

test('explicit90 package pins11500 units and same durable non-upload limits as old60 package',t=>{
 const f=fixture(t),old=f.run(['--profile',profile]),next=f.run(['--profile',profile90]);assert.equal(old.status,0,old.stderr);assert.equal(next.status,0,next.stderr);const a=old.manifest(),b=next.manifest();assert.equal(b.researchProfile,profile90);assert.equal(b.limits.maximumUnits,11500);assert.equal(a.limits.maximumUnits,7500);assert.deepEqual({...b.limits,maximumUnits:7500},a.limits);assert.equal(b.costs.githubArtifactUpload,false);assert.equal(b.costs.artifactRetentionDays,null);assert.equal(b.observationAgePolicy,'observation-age-v1');assert.equal(b.dataContract,'confirmed-program-events-v2');
 const python=spawnSync('python3',['-B','-I','-c',`import importlib.util,json,sys;s=importlib.util.spec_from_file_location('bounded',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.host_profile(sys.argv[2])))`,join(repository,'operator/native-candidate-ec2/run-bounded.py'),profile90],{encoding:'utf8'});assert.equal(python.status,0,python.stderr);assert.deepEqual(b.limits,JSON.parse(python.stdout));
 const workflow=readFileSync(join(next.output,'.github/workflows/poe-native-candidates-research.yml'),'utf8'),conditions=workflow.split('\n').filter(line=>line.trim().startsWith('if: always()'));assert.equal(conditions.length,3);for(const line of conditions.slice(0,2)){assert.match(line,/POE_NATIVE_RESEARCH_PROFILE == 'default-900s'/);assert.doesNotMatch(line,/!= 'candidate-native-two-hour/);}assert.ok(conditions[2].includes(profile)&&conditions[2].includes(profile90));assert.match(workflow,/timeout-minutes: 125/);assert.match(workflow,/5s 7320s/);
});
test('new90 staging refuses a bundle which resolves that name to old7500-unit settings',t=>{const f=fixture(t,{wrong90:true}),result=f.run(['--profile',profile90]);assert.notEqual(result.status,0);assert.match(result.stderr,/BUNDLED_EXPLICIT_90_PROFILE_REQUIRED/);});
