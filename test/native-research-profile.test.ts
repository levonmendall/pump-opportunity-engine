/** Pure profile arithmetic plus retained public measurements; no live status,
 * provider, credential, database or host access. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PilotRpc,CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE} from '../src/pilot-rpc.js';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {PilotFeeds} from '../src/pilot-feeds.js';
import {NATIVE_TWO_HOUR_RESEARCH_PROFILE as profile,NATIVE_TWO_HOUR_90_RESEARCH_PROFILE as research90,NATIVE_TWO_HOUR_PROFILE_BASIS as basis,resolveNativeResearchProfile} from '../src/native-research-profile.js';
const MIB=1024*1024;

test('two-hour resource envelope requires explicit version selection and remains candidate-only',()=>{
 assert.equal(resolveNativeResearchProfile(undefined),null);assert.equal(resolveNativeResearchProfile(profile.version),profile);
 for(const bad of [null,true,7200000,'two-hours','paper','candidate-native-research-v1','candidate-native-two-hour-research-v2',{},[profile.version]])assert.throws(()=>resolveNativeResearchProfile(bad),/UNKNOWN_PROFILE/);
 assert.equal(profile.mode,'candidate-evaluation');assert.equal(profile.financialExecutionAuthorized,false);assert.equal(profile.durationMs,7200000);assert.equal(profile.maximumDurationMs,7200000);assert.equal(profile.shutdownReserveMs,10000);assert.equal(profile.maximumDeep,6);assert.equal(profile.maximumUnits,7500);assert.equal(profile.maximumChapters,64);
 assert.ok(Object.isFrozen(profile));assert.ok(Object.isFrozen(profile.physical));assert.ok(Object.isFrozen(profile.dataValidity));
});

test('larger finite allowances do not raise request rate, concurrency, freshness or strategy windows',()=>{
 assert.deepEqual(profile.physical,{startsPerMinute:60,startsPer10s:20,spacingMs:250,inFlight:1,getTransactionStartsPer10s:8});
 assert.deepEqual(profile.dataValidity,{supportAgeMs:30000,heartbeatIntervalMs:10000,physicalTimeoutMs:1500,watchdogIntervalMs:100,completeWindowMs:60000,bucketMs:10000});
 assert.equal(profile.maximumRssBytes,384*MIB);assert.equal(profile.maximumDiscoveryQueue,256);assert.match(profile.classification,/NOT TWO-HOUR CAPACITY/);assert.match(profile.infrastructureCost,/unverified/);
 // A7500-unit cap does not permit7500 starts inside7200s under60/min pacing.
 assert.ok(profile.maximumUnits>=profile.physical.startsPerMinute*profile.durationMs/60000);
});

test('two-hour append-only accounting and disk envelopes keep explicit bounded headroom',()=>{
 assert.equal(profile.maximumBaselinePaths+profile.maximumChapters,profile.maximumTotalBaselinePaths);assert.equal(profile.maximumBaselinePaths,448);assert.equal(profile.maximumTotalBaselinePaths,512);
 assert.equal(profile.maximumComponentBookBytes,512*1024);assert.equal(profile.maximumBaselineBytes,32*MIB);assert.equal(profile.maximumRpcMetadataBytes,2*MIB);
 assert.ok(profile.maximumChapters*200>=profile.maximumUnits,'64bounded200-unit chapters can represent7500total units');
 assert.equal(profile.startupDiskHeadroom,profile.retainedEvidenceBytes+profile.minimumDiskHeadroom+profile.additionalDiskReserveBytes);assert.equal(profile.additionalDiskReserveBytes,64*MIB);assert.equal(profile.retainedEvidenceBytes,1024*MIB);assert.equal(profile.evidenceSegmentBytes,8*MIB);assert.equal(profile.retainedEvidenceBytes/profile.evidenceSegmentBytes,128);
 assert.equal(profile.nativeRecordedBytes+profile.feedRecordedBytes,profile.retainedEvidenceBytes-64*MIB,'outer scheduling/audit and shutdown evidence keep a separate reserve');
 assert.equal(profile.relatedResponseBytes-profile.nativeSocketBytes,256*MIB);assert.equal(profile.broadWatchBytes,8*1024*MIB);assert.equal(profile.discoveryBytes,40*MIB);assert.equal(profile.maximumCpuMicros,1920000000);
});

test('profile provenance matches retained actual observations and labels six-pool scaling as a projection',()=>{
 const native=JSON.parse(readFileSync(basis.native.source,'utf8')),broad=JSON.parse(readFileSync(basis.broad.source,'utf8'));
 assert.equal(native.elapsedMs,basis.native.elapsedMs);assert.equal(native.responses.socketBytes,basis.native.socketBytes);assert.equal(native.resource.retainedEventBytes,basis.native.retainedEventBytes);assert.equal(native.resource.cpu.user+native.resource.cpu.system,basis.native.cpuMicros);assert.equal(native.resource.maximumRss,basis.native.maximumRssBytes);
 assert.equal(broad.elapsedMs,basis.broad.elapsedMs);assert.equal(broad.selectedWork.finalFeed.pumpApiSocketBytes,basis.broad.socketBytes);assert.equal(broad.resource.evidenceAdmissionClosedAfterMs,basis.broad.candidateObservationClosedAfterMs);
 const sixPoolNativeProjection=basis.native.socketBytes/basis.native.elapsedMs*profile.durationMs*6;
 const sixPoolEvidenceProjection=basis.native.retainedEventBytes/basis.native.elapsedMs*profile.durationMs*6;
 const sixPoolCpuProjection=basis.native.cpuMicros/basis.native.elapsedMs*profile.durationMs*6;
 assert.ok(sixPoolNativeProjection<profile.nativeSocketBytes);assert.ok(sixPoolEvidenceProjection<profile.nativeRecordedBytes);assert.ok(sixPoolCpuProjection<profile.maximumCpuMicros);
 assert.ok(sixPoolCpuProjection/profile.maximumCpuMicros>.95,'CPU headroom is narrow in this deliberately disclosed linear projection');
 const broadLowerBound=basis.broad.socketBytes/basis.broad.elapsedMs*profile.durationMs;assert.ok(broadLowerBound/profile.broadWatchBytes>.85,'quiet transport assumptions cannot be inferred from an8GiB cap');
 assert.match(basis.native.limitations,/not measured/);assert.match(basis.broad.limitations,/lower bound/);assert.match(basis.remainingEvidence,/before execution/);assert.match(basis.remainingEvidence,/early/);
});

test('explicit90/minute research is a different closed profile; every other existing two-hour resource stays unchanged',()=>{
 assert.equal(research90.version,'candidate-native-two-hour-90-research-v1');assert.equal(resolveNativeResearchProfile(research90.version),research90);assert.equal(resolveNativeResearchProfile(profile.version),profile);assert.equal(resolveNativeResearchProfile(undefined),null);assert.equal(research90.maximumUnits,11500);assert.equal(research90.physical.startsPerMinute,90);assert.equal(profile.maximumUnits,7500);assert.equal(profile.physical.startsPerMinute,60);
 assert.deepEqual({...research90,version:profile.version,maximumUnits:profile.maximumUnits,physical:profile.physical,classification:profile.classification},profile,'only the explicitly versioned minute/total allowance differs');assert.ok(Object.isFrozen(research90));assert.ok(Object.isFrozen(research90.physical));assert.equal(research90.maximumCpuMicros,1920000000);assert.equal(research90.maximumRssBytes,384*MIB);assert.equal(research90.maximumChapters,64);assert.equal(research90.maximumBaselinePaths,448);assert.equal(research90.maximumChapters*200,12800);assert.ok(research90.maximumChapters*200>=research90.maximumUnits);assert.ok(research90.maximumUnits>=90*120);assert.equal(research90.physical.inFlight,1);assert.equal(research90.physical.spacingMs,250);assert.equal(research90.physical.startsPer10s,20);assert.equal(research90.physical.getTransactionStartsPer10s,8);assert.match(research90.classification,/LOCAL RESEARCH CEILING/);assert.match(research90.classification,/NOT TWO-HOUR CAPACITY OR PROVIDER ENTITLEMENT/);
 for(const bad of ['90',90,'candidate-native-two-hour-90-research-v2','candidate-native-two-hour-120-research-v1',research90])assert.throws(()=>resolveNativeResearchProfile(bad),/UNKNOWN_PROFILE/);
});

test('two-hour90 profile requires the explicit matching rate and old two-hour profile cannot be relabeled90',()=>{
 const base={directory:'/OFFLINE-must-not-open',runId:'offline-rate-conflict',baselinePaths:['/OFFLINE-must-not-read.json'],priorPhysicalSettled:true as const};
 for(const maxStartsPerMinute of [undefined,60,89,91,null])assert.throws(()=>new PilotRpc({...base,profile:research90.version,maxStartsPerMinute:maxStartsPerMinute as any}),/PROFILE_MINUTE_LIMIT_CONFLICT/);
 for(const maxStartsPerMinute of [61,75,90])assert.throws(()=>new PilotRpc({...base,profile:profile.version,maxStartsPerMinute}),/PROFILE_MINUTE_LIMIT_CONFLICT/);
});

test('actual offline RPC/native/watch constructor composition keeps default, two-hour60 and explicit two-hour90 identities coherent',async()=>{
 for(const selected of [undefined,profile,research90]){
  const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-profile-composition-')),old=join(directory,'old.json');writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:2,bytes:100,lastObservedAt:1000,starts:[900,1000],pending:[]}),{mode:0o600});const original=readFileSync(old),records:Array<{kind:string;data:any}>=[];let at=200000;
  const duration=selected?.durationMs??900000,maximumUnits=selected?.maximumUnits??1500,maximumResponseBytes=selected?.relatedResponseBytes??256*MIB,minute=selected?.physical.startsPerMinute??60;
  const rpc=new PilotRpc({profile:selected?.version??CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.version,directory:join(directory,'rpc'),runId:'offline-profile-composition',baselinePaths:[old],priorPhysicalSettled:true,durationMs:duration,maxUnits:maximumUnits,maxResponseBytes:maximumResponseBytes,maxStartsPerMinute:minute,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,...(selected?{maxChapters:selected.maximumChapters}:{}),now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher:(async(_url,options)=>{const request=JSON.parse(String(options?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:123}));}) as typeof fetch});
  const control={operateData(){throw Error('OFFLINE_WS_MUST_NOT_START');},accountControlBytes(){throw Error('OFFLINE_WS_MUST_NOT_START');},noteThrottle(){throw Error('OFFLINE_NO_PROVIDER');}} as any,deps={now:()=>at,monotonic:()=>at,setTimer(){return 1;},clearTimer(){}},record=(kind:string,data:unknown)=>records.push({kind,data}),native=new PilotNativeFlow({profile:selected?.version,control,support:{} as any,record,onTrade(){throw Error('OFFLINE_NO_MARKET_TRADES');},onGap(){},maximumCandidates:6,durationMs:duration,maximumReceivedBytes:selected?.nativeSocketBytes??220*MIB,maximumRecordedBytes:selected?.nativeRecordedBytes??112*MIB,maximumCpuMicros:selected?.maximumCpuMicros??240000000,maximumRssBytes:384*MIB},deps),feed=new PilotFeeds({profile:selected?.version,control,amountConvention:'curve',record,onMigration(){},onTrade(){},onGap(){},maximumCandidates:6,durationMs:duration,maxPumpApiBytes:selected?.broadWatchBytes??1024*MIB,maxDiscoveryBytes:selected?.discoveryBytes??5*MIB,maximumRecordedBytes:selected?.feedRecordedBytes??8*MIB},deps);
  try{
   assert.equal(await rpc.call('getSlot'),123);const usage=rpc.usage(),authorization=JSON.parse(readFileSync(join(directory,'rpc/authorization.json'),'utf8')),chapter=JSON.parse(readFileSync(usage.activeChapterPath!,'utf8')),nativeLimits=records.find(r=>r.kind==='native-flow-contract')!.data.limits;assert.equal(usage.profile,selected?.version??CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.version);assert.equal(usage.maximumNewUnits,maximumUnits);assert.equal(usage.maximumNewResponseBytes,maximumResponseBytes);assert.equal(usage.requestLimits.maxStartsPerMinute,minute);assert.equal(authorization.profile,usage.profile);assert.equal(authorization.requestLimits.maxStartsPerMinute,minute);assert.equal(authorization.maxChapters,selected?.maximumChapters??32);assert.equal(chapter.profile,selected?.version);assert.equal(chapter.limits.maxStartsPerMinute,minute);assert.equal(chapter.limits.minSpacingMs,250);assert.equal(chapter.limits.maxStartsPer10s,20);assert.equal(nativeLimits.durationMs,duration);assert.equal(nativeLimits.maximumReceivedBytes,selected?.nativeSocketBytes??220*MIB);assert.equal(nativeLimits.maximumRecordedBytes,selected?.nativeRecordedBytes??112*MIB);assert.equal(nativeLimits.maximumCpuMicros,selected?.maximumCpuMicros??240000000);assert.equal(nativeLimits.maximumRssBytes,384*MIB);assert.equal(feed.usage().durationMs,duration);assert.equal(feed.usage().maximumCandidates,6);assert.equal(native.usage().liveTradingEnabled,false);assert.equal(native.usage().financialWriterOpened,false);assert.equal(feed.usage().liveTrading,false);assert.equal(usage.automaticRequestRetries,0);
  }finally{await Promise.all([native.stop('OFFLINE composition complete'),feed.stop()]);rpc.close();assert.deepEqual(readFileSync(old),original);rmSync(directory,{recursive:true,force:true});}
 }
});
