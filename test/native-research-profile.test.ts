/** Pure profile arithmetic plus retained public measurements; no live status,
 * provider, credential, database or host access. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NATIVE_TWO_HOUR_RESEARCH_PROFILE as profile,NATIVE_TWO_HOUR_PROFILE_BASIS as basis,resolveNativeResearchProfile} from '../src/native-research-profile.js';
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
 assert.equal(profile.maximumBaselinePaths+profile.maximumChapters,profile.maximumTotalBaselinePaths);assert.equal(profile.maximumBaselinePaths,192);assert.equal(profile.maximumTotalBaselinePaths,256);
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
