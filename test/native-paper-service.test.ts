import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BoundedRotatingRecorder} from '../src/recorder.js';
import {runInNewContext} from 'node:vm';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {PilotRpc} from '../src/pilot-rpc.js';
import {PAPER_SERVICE_POLICY} from '../src/paper-service-policy.js';
import {NATIVE_TWO_HOUR_RESEARCH_PROFILE,NATIVE_TWO_HOUR_90_RESEARCH_PROFILE} from '../src/native-research-profile.js';
/** OFFLINE policy and proof-retention checks. No account, provider or credentials. */
import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseNativePaperArgs,nativePaperConfigurationSha256,nativePaperManagementReserve,nativePaperRecoveryInputs,NativePaperProofPreparation,nativePaperEssentialEvidence,nativePaperRecordServiceEvidence,nativePaperRequiredEvidence,nativePaperRetainRunIndex,nativePaperRpcConfiguration,runNativePaper} from '../src/run-native-paper.js';
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
test('actual runtime RPC configuration selects the explicit90 service profile without changing finite verification or physical gates',async()=>{
 assert.equal(PAPER_SERVICE_POLICY.rpcProfile,NATIVE_TWO_HOUR_90_RESEARCH_PROFILE.version);assert.equal(PAPER_SERVICE_POLICY.rpcStartsPerMinute,90);
 for(const service of [false,true]){
  const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-service-rpc-')),baseline=join(directory,'prior.json');writeFileSync(baseline,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:2,bytes:100,lastObservedAt:1000,starts:[900,1000],pending:[]}),{mode:0o600});const prior=readFileSync(baseline);let at=200000,requests=0;
  const selected=nativePaperRpcConfiguration(service),expectedProfile=service?NATIVE_TWO_HOUR_90_RESEARCH_PROFILE.version:NATIVE_TWO_HOUR_RESEARCH_PROFILE.version,expectedMinute=service?90:60;
  const rpc=new PilotRpc({...selected,directory:join(directory,'rpc'),runId:'offline-runtime-rpc-profile',baselinePaths:[baseline],priorPhysicalSettled:true,durationMs:1800000,maxUnits:1500,maxResponseBytes:256*1024*1024,maxChapters:64,now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher:(async(_url,options)=>{requests++;const request=JSON.parse(String(options?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:123}));}) as typeof fetch});
  try{
   assert.equal(await rpc.call('getSlot'),123);assert.equal(requests,1);
   const usage=rpc.usage(),authorization=JSON.parse(readFileSync(join(directory,'rpc/authorization.json'),'utf8')),chapter=JSON.parse(readFileSync(usage.activeChapterPath!,'utf8'));
   assert.equal(usage.profile,expectedProfile);assert.equal(authorization.profile,expectedProfile);assert.equal(chapter.profile,expectedProfile);assert.equal(usage.persistent,service);assert.equal(usage.lifetimeCapsEnabled,!service);assert.equal(authorization.lifetimeCapsEnabled,!service);
   const physical={maxStartsPerMinute:expectedMinute,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,minSpacingMs:250,physicalInFlight:1};assert.deepEqual(usage.requestLimits,physical);assert.deepEqual(authorization.requestLimits,physical);assert.equal(chapter.limits.maxStartsPerMinute,expectedMinute);assert.equal(chapter.limits.maxStartsPer10s,20);assert.equal(chapter.limits.minSpacingMs,250);assert.equal(usage.automaticRequestRetries,0);assert.equal(usage.inFlight,0);assert.equal(usage.cooldownUntil,0);assert.equal(usage.uncertainResponseBytes,0);assert.ok(usage.newAccountedResponseBytes>0,'the larger local minute allowance never bypasses byte accounting');
   const reserve=nativePaperManagementReserve({...usage,chapterUsage:{...usage.chapterUsage!,rolling60SecondStarts:expectedMinute-7}},true);assert.equal(reserve.entryAllowed,true);assert.equal(nativePaperManagementReserve({...usage,chapterUsage:{...usage.chapterUsage!,rolling60SecondStarts:expectedMinute-3}},true).candidateWorkWithExposureAllowed,false,'the existing financial request headroom remains relative to the selected rolling rate');
  }finally{rpc.close();assert.deepEqual(readFileSync(baseline),prior,'historical consumed usage is unchanged');rmSync(directory,{recursive:true,force:true});}
 }
});
test('original binding preserves inception and virtual funding; fixture exception is explicit and cannot bless another live account',()=>{
 const original={...POE_OPERATING_ACCOUNT,mode:'PAPER'};assert.doesNotThrow(()=>assertPoeOperatingAccount(original));assert.doesNotThrow(()=>assertNativePaperAccount(original));
 for(const patch of [{accountId:'poe-pilot-other'},{inceptionAt:original.inceptionAt+1},{initialMicroUsd:'1000000001'},{mode:'LIVE'}])assert.throws(()=>assertPoeOperatingAccount({...original,...patch}),/IDENTITY/);
 const fixture={...original,accountId:'poe-pilot-offline-fixture',inceptionAt:1};assert.throws(()=>assertNativePaperAccount(fixture),/IDENTITY/);assert.doesNotThrow(()=>assertNativePaperAccount(fixture,{accountId:fixture.accountId,inceptionAt:1}));
 assert.throws(()=>assertNativePaperAccount(original,{accountId:original.accountId,inceptionAt:original.inceptionAt}),/FIXTURE/);
});
test('persistent management uses rolling shared headroom, never cumulative CPU or completed chapter exhaustion',()=>{
 const consumed={chapter:1000000,newUnits:1000000,maximumNewUnits:1500,newAccountedResponseBytes:10**12,maximumNewResponseBytes:1,requestLimits:{maxStartsPerMinute:60},chapterUsage:{rolling60SecondStarts:53}};
 assert.equal(nativePaperManagementReserve(consumed).entryAllowed,false);assert.equal(nativePaperManagementReserve(consumed,true).entryAllowed,true);
 assert.equal(nativePaperManagementReserve({...consumed,chapterUsage:{rolling60SecondStarts:54}},true).entryAllowed,false);
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


test('only explicit supplementary representatives and local phase metrics may omit capacity diagnostics',()=>{
 assert.equal(nativePaperRequiredEvidence('native-paper-local-phase',{elapsedMs:2}),false);assert.equal(nativePaperRequiredEvidence('native-flow-raw-representative',{supplementaryOnly:true}),false);
 for(const [kind,data]of [['native-flow-raw-representative',{}],['native-flow-raw-representative',{supplementaryOnly:'true'}],['native-flow-validated-packet',{supplementaryOnly:true}],['native-flow-raw-refusal',{supplementaryOnly:true}],['native-paper-local-phase-overrun',{}],['trader-quote',{}],['native-paper-entry-proof-pinned',{}]]as const)assert.equal(nativePaperRequiredEvidence(kind,data),true,kind);
 assert.equal(nativePaperRequiredEvidence('native-paper-local-phase',{},true),true,'financial essential evidence remains required even if labeled with an optional diagnostic kind');
});

test('an explicit optional capacity omission stays unaccepted without closing healthy capture or inventing required flow',()=>{
 let healthy=true,requiredGaps=0;const calls:any[]=[];const recorder={record(kind:string,data:unknown,options:any){calls.push({kind,data,options});return false;},recordOutcome:()=>({kind:'optional-capacity-omitted' as const,reason:'OPTIONAL_DIAGNOSTIC_CAPACITY'})};
 const accepted=nativePaperRecordServiceEvidence(recorder,'native-paper-local-phase',{elapsedMs:4},false,()=>{healthy=false;requiredGaps++;},false);assert.equal(accepted,false,'omitted metadata never appears retained');assert.equal(healthy,true);assert.equal(requiredGaps,0);assert.deepEqual(calls[0].options,{essential:false,required:false});
});

test('required, essential, IO, unknown and thrown recorder failures still close new risk while preserving held obligations',()=>{
 const position={mint:'existing-held',units:'100'},pending={id:'unresolved-exit',side:'sell'};let pauses=0;
 for(const recorder of [{record:()=>false,recordOutcome:()=>({kind:'unavailable' as const,reason:'RECORD_IO_OR_INTEGRITY_FAILURE'})},{record:()=>false},{record:()=>{throw Error('IO failure');},recordOutcome:()=>({kind:'optional-capacity-omitted' as const,reason:'stale prior outcome'})},{record:()=>false,recordOutcome:()=>{throw Error('outcome unavailable');}}]){
  assert.equal(nativePaperRecordServiceEvidence(recorder,'native-paper-local-phase',{},false,()=>pauses++,false),false);
 }
 assert.equal(pauses,4);
 const optionalOutcome={record:(_kind:string,_data:unknown,options:any)=>{assert.equal(options.required,true);return false;},recordOutcome:()=>({kind:'optional-capacity-omitted' as const,reason:'incorrect outcome for required record'})};
 assert.equal(nativePaperRecordServiceEvidence(optionalOutcome,'native-flow-validated-packet',{},false,()=>pauses++),false);assert.equal(nativePaperRecordServiceEvidence(optionalOutcome,'trader-quote',{},true,()=>pauses++,false),false);assert.equal(pauses,6);assert.deepEqual(position,{mint:'existing-held',units:'100'});assert.deepEqual(pending,{id:'unresolved-exit',side:'sell'});
});

/** Execute the actual private recovery closure with injected, nonfinancial
 * components. This avoids starting the real account merely to reach recovery. */
function actualRecoveryBody(){const source=runNativePaper.toString(),start=source.search(/const\s+recoverSources\s*=/),rest=source.slice(start),end=rest.search(/;\s*finalReport\s*=/);assert.ok(start>=0&&end>0,'actual compiled recovery closure is identified');return rest.slice(0,end)+';recoverSources();';}
test('a required constructor record failure during actual source rebuild cannot be overwritten by a later healthy reset',async()=>{
 const state:any={registryIsolation:undefined,__name:(fn:unknown)=>fn,service:true,serviceRecoveryReason:'prior outage',serviceClosingSettled:true,serviceRecoveryAt:0,managementOnly:false,admissionPausePath:'/OFFLINE/no-marker',existsSync:()=>false,serviceResources:{view:()=>({candidateAdmissionAllowed:true})},serviceRecorder:{usage:()=>({candidateAdmissionAllowed:true})},currentRpc:{usage:()=>({fatal:null,inFlight:0,waitingOrOperating:false})},currentNative:{usage:()=>({physicalTransportsSettled:true})},currentFeeds:{usage:()=>({physicalTransportsSettled:true})},engineStatus:()=>({counters:{}}),serviceEngineTotals:{},serviceNativeTotals:{},serviceFeedTotals:{},nativeCounterKeys:[],feedCounterKeys:[],nativeUsage:()=>({}),feedUsage:()=>({}),serviceGeneration:0,serviceEvidenceHealthy:false,recoveredCheckpoint:null,sourceStartupIndex:2,sourceClosing:null,sourceClosed:true};let recordCalls=0;
 const recorder={record:()=>++recordCalls!==1,recordOutcome:()=>({kind:'unavailable' as const,reason:'RECORD_IO_OR_INTEGRITY_FAILURE'})};state.record=(kind:string,data:unknown)=>{const essential=nativePaperEssentialEvidence(kind,'source',false,data);return nativePaperRecordServiceEvidence(recorder,kind,data,essential,()=>{state.serviceEvidenceHealthy=false;},nativePaperRequiredEvidence(kind,data,essential));};
 state.makeNative=()=>new PilotNativeFlow({persistent:true,control:{operateData(){throw Error('OFFLINE_NETWORK_FORBIDDEN');},accountControlBytes(){},noteThrottle(){return 0;}},support:{validateMany(){throw Error('OFFLINE_NETWORK_FORBIDDEN');}},record:state.record,onTrade(){throw Error('OFFLINE_TRADE_FORBIDDEN');},onGap(){}},{setTimer(){return 1;},clearTimer(){}});state.makeEngine=()=>({fixture:true});state.makeFeeds=()=>({fixture:true});
 runInNewContext(actualRecoveryBody(),state,{timeout:1000});assert.equal(state.serviceGeneration,1);assert.ok(recordCalls>=2,'constructor failure is followed by a successfully retained recovery marker');assert.equal(state.serviceEvidenceHealthy,false,'failed required constructor evidence remains latched after the actual recovery closure');assert.equal(state.sourceStartupIndex,0);await state.native.stop('OFFLINE recovery test complete');
});


test('actual continuous recorder optional omission preserves complete required proof and financial-essential recording through caller wiring',async()=>{
 const now=1793290000000,directory=join(mkdtempSync(join(tmpdir(),'poe-OFFLINE-optional-caller-')),'evidence'),recorder=new BoundedRotatingRecorder({directory,segmentBytes:4096,diagnosticBytes:16384,minRetentionMs:300000,minimumDiskReserveBytes:0,continuousRotation:true,maximumDiagnosticBytes:65536,capacityDiskFraction:1/32,now:()=>now,monotonic:()=>0});let healthy=true;
 const write=(kind:string,data:unknown,essential=false)=>nativePaperRecordServiceEvidence(recorder,kind,data,essential,()=>{healthy=false;},nativePaperRequiredEvidence(kind,data,essential));
 try{
  assert.equal(write('native-flow-validated-packet',{fixture:'REQUIRED_FLOW_ONE',raw:'x'.repeat(3000)}),true);assert.equal(write('native-flow-validated-packet',{fixture:'REQUIRED_FLOW_TWO',raw:'y'.repeat(3000)}),true);
  assert.equal(write('native-paper-local-phase',{elapsedMs:10}),false);assert.equal(recorder.recordOutcome().kind,'optional-capacity-omitted');assert.equal(healthy,true);assert.equal(recorder.usage().optionalOmittedRecords,1);assert.equal(recorder.usage().refusedRecords,0);assert.deepEqual(recorder.usage().refusalIntervals,[]);
  assert.equal(write('trader-quote',{fixture:'HELD_FINANCIAL_QUOTE_RETAINED'},true),true);const proof=await recorder.pinRange('OFFLINE-current-required-window',now,now);assert.equal(proof.complete,true);const raw=proof.files.map(file=>readFileSync(join(directory,file),'utf8')).join('');assert.match(raw,/REQUIRED_FLOW_ONE/);assert.match(raw,/REQUIRED_FLOW_TWO/);assert.equal(healthy,true);
 }finally{await recorder.close();}
});

test('rolling short-window financial reserve blocks new risk before a burst consumes protection and pending-entry starts',()=>{
 const normal={chapter:2,newUnits:20,maximumNewUnits:1500,newAccountedResponseBytes:10000,maximumNewResponseBytes:256*1024*1024,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:20,rolling10SecondStarts:13}};
 assert.equal(nativePaperManagementReserve(normal,true).entryAllowed,true);assert.equal(nativePaperManagementReserve(normal,true).rolling10SecondStartHeadroom,7);
 assert.equal(nativePaperManagementReserve({...normal,chapterUsage:{...normal.chapterUsage,rolling10SecondStarts:14}},true).entryAllowed,false,'ample minute budget cannot authorize entry that consumes the held/pending short-window reserve');
 assert.equal(nativePaperManagementReserve({...normal,chapterUsage:{...normal.chapterUsage,rolling10SecondStarts:16}},true).candidateWorkWithExposureAllowed,true);assert.equal(nativePaperManagementReserve({...normal,chapterUsage:{...normal.chapterUsage,rolling10SecondStarts:17}},true).candidateWorkWithExposureAllowed,false);
 assert.equal(nativePaperManagementReserve({...normal,chapterUsage:{rolling60SecondStarts:20,rolling10SecondStarts:0}},true).entryAllowed,true,'rolling headroom recovers without a restart or cumulative allowance reset');
});
