/** Offline schema compatibility. Public account binding is real; every market,
 * timing, counter and decision value below is an explicitly synthetic fixture.
 * No runtime, transport, status file, credential or ledger is opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {nativeCandidateReportingProjection} from '/workspace/poe-native-candidate-runner/src/run-native-candidates.ts';
import {projectPilotStatus} from '/workspace/poe-dashboard-age-reporting/dist/src/pilot-telemetry.js';
const NATIVE_PROJECTION_RELEASE='0450e0dca52d0ac8739ea6d49c0a214c9be334e8';
const DASHBOARD_RELEASE='9161d3849eae1ffa549a6afa2a1c263b6f3d1185';
const accountId='poe-pilot-8468add6-f916-48cf-a585-6cd008a81360',inceptionAt=1793123773252;
const T=Date.parse('2026-10-28T03:00:00Z'),source={commit:NATIVE_PROJECTION_RELEASE,sha256:'d'.repeat(64)};
const feedUsage=()=>({frames:19,totalSocketBytes:250000,pumpApiSocketBytes:240000,discoverySocketBytes:10000,discoveryConnected:true,pumpApiConnected:true});
function engineFixture(){return {generatedAt:T,observationAgePolicy:{version:'observation-age-v1',minimumObservationAgeMs:0,recentMaximumAgeMs:7200000,selectedOlderMaximumAgeMs:21600000},
 counters:{migrationHints:37,verificationQueueRefusals:2,verificationAttempts:33,verifiedOrigins:31,verificationRefusals:4,normalizedEvents:123,qualityGaps:3,featureViews:28,auditedWindows:12,predictiveAssessments:12,predictiveFailed:9,predictiveNotRejected:2,predictiveUnavailable:1,auditUnavailable:2,auditUnusable:1,decisionDeadlineMisses:1,uniqueEvaluated:5},
 rpc:{newUnits:77,cumulativeUnits:3000,cooldownUntil:T-1000},
 flow:{connected:true,receivedBoundNotifications:45,normalizedEvents:123,socketBytes:1000000,lastNotificationAt:T-20,lastFreshSupportAt:T-500,lastBankClockAt:T-1000},
 watch:{rows:[],summary:{known:149,watch:120,eligibleKnown:90,deepActive:3,maximumDeep:6,queued:14,promoted:42,repromoted:11,demoted:36,expired:2,capacityExclusions:4,structuralExclusions:3,completeWindows:12,waitMs:{mean:3200,maximum:15000},promotionWaitMs:{mean:2100,maximum:11000},observationEligibleKnown:103,observationQueued:18,maximumOlderResearchIdentities:24,ageCohorts:{preEntry:10,entryEligible:90,olderSelected:3}}},
 candidates:[{mint:'SYNTHETIC_MINT_A',snapshot:{sourceSupportFresh:true,hasQualityLoss:false,warm:true}},{mint:'SYNTHETIC_MINT_B',snapshot:{sourceSupportFresh:true,hasQualityLoss:false,warm:false}},{mint:'SYNTHETIC_MINT_C',snapshot:{sourceSupportFresh:true,hasQualityLoss:false,warm:false}}],
 decisions:[{at:T-1000,mint:'SYNTHETIC_MINT_A',stage:'predictive-assessment',reason:'persistent-broad-buying-rule-not-met'},{at:T-500,mint:'SYNTHETIC_MINT_B',stage:'predictive-assessment',reason:'predictive-not-rejected; executable qualification remains unavailable'}],lastAuditAt:T-1100,lastPredictiveAt:T-500};}
function rawStatus(projection,{running=true,generatedAt=T}={}){return {schemaVersion:1,project:'Pump Opportunity Engine',experimental:true,authoritative:false,accountId,inceptionAt,runId:'SYNTHETIC-native-reporting-fixture',source:{...source},strategyVersion:'persistent-buying-v0-unfrozen',generatedAt,running,mode:'candidate-evaluation',financialExecutionAuthorized:false,entriesEnabled:false,liveTradingEnabled:false,financialWriterOpened:false,portfolio:null,experimentalPortfolio:null,experimentalAccounting:null,financial:{fixturePrivate:'DO_NOT_EXPORT'},journal:['DO_NOT_EXPORT'],...projection};}
const hash=value=>createHash('sha256').update(value).digest('hex');

test('compatibility uses the committed native projection and exact existing deployed dashboard module',()=>{
 const nativeSource=readFileSync('/workspace/poe-native-candidate-runner/src/run-native-candidates.ts');
 const pinned=execFileSync('git',['show',NATIVE_PROJECTION_RELEASE+':src/run-native-candidates.ts'],{cwd:'/workspace/poe-native-candidate-runner',maxBuffer:1024*1024});
 assert.equal(hash(nativeSource),hash(pinned),'newer native commits must not silently change the tested projection');
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:'/workspace/poe-dashboard-age-reporting',encoding:'utf8'}).trim(),DASHBOARD_RELEASE);
});

test('missing engine remains unavailable/null through deployed projection without fabricating a portfolio',()=>{
 const local=nativeCandidateReportingProjection(undefined,undefined,null,true,'SYNTHETIC setup'),snapshot=projectPilotStatus(rawStatus(local));
 assert.equal(snapshot.accountId,accountId);assert.equal(snapshot.inceptionAt,inceptionAt);assert.deepEqual(snapshot.source,{release:source.commit,strategy:'persistent-buying-v0-unfrozen',sha256:source.sha256});assert.equal(snapshot.generatedAt,T);
 for(const field of ['discovered','supported','sufficientlyObserved','evaluated','verifiedMigrationOrigins','admitted','usableWindows'])assert.equal(snapshot.funnel[field],null,field);
 for(const field of ['qualified','reserved','attempted','paperFilled','exited','reconciled'])assert.equal(snapshot.funnel[field],0,'financial action path is intentionally disabled');
 for(const field of ['rpcRequests','providerEvents','normalizedTrades','eventLoopLagMs','maximumCompletedGapMs','maximumQuoteAgeMs','protectionBreaches','unavailableChecks','streamBytes'])assert.equal(snapshot.metrics[field],null,field);
 assert.equal(snapshot.watch,null);assert.equal(snapshot.observationAgePolicy,null);assert.equal(snapshot.mode,'candidate-evaluation');assert.equal(snapshot.financialExecutionAuthorized,false);assert.equal(snapshot.entriesEnabled,false);assert.equal(snapshot.liveTrading,false);assert.equal(snapshot.portfolio,null);assert.equal(snapshot.accounting,null);assert.match(snapshot.status,/initializing candidate-only/);assert.doesNotMatch(JSON.stringify(snapshot),/DO_NOT_EXPORT/);
});

test('realistic synthetic engine values, decisions, source times and age cohorts pass the deployed schema unchanged',()=>{
 const engine=engineFixture(),feeds=feedUsage(),local=nativeCandidateReportingProjection(engine,feeds,4.75,true,'SYNTHETIC run'),snapshot=projectPilotStatus(rawStatus(local));
 assert.equal(snapshot.funnel.discovered,37);assert.equal(snapshot.funnel.verifiedMigrationOrigins,31);assert.equal(snapshot.funnel.admitted,42);assert.equal(snapshot.funnel.sufficientlyObserved,12);assert.equal(snapshot.funnel.usableWindows,12);assert.equal(snapshot.funnel.evaluated,12);assert.equal(snapshot.funnel.qualified,0,'feature-only not-rejected observations are not executable qualifications');assert.equal(snapshot.funnel.paperFilled,0);
 assert.equal(snapshot.metrics.rpcRequests,77);assert.equal(snapshot.metrics.providerEvents,64);assert.equal(snapshot.metrics.normalizedTrades,123);assert.equal(snapshot.metrics.streamBytes,1250000);assert.equal(snapshot.metrics.eventLoopLagMs,4.75);assert.equal(snapshot.metrics.maximumCompletedGapMs,null);assert.equal(snapshot.metrics.maximumQuoteAgeMs,null);assert.equal(snapshot.metrics.protectionBreaches,null);assert.equal(snapshot.metrics.unavailableChecks,null,'no holding evaluations exist');
 assert.equal(snapshot.watch.known,149);assert.equal(snapshot.watch.deepActive,3);assert.equal(snapshot.watch.maximumDeep,6);assert.equal(snapshot.watch.predictiveAssessments,12);assert.equal(snapshot.watch.predictiveFailures,9);assert.equal(snapshot.watch.incompleteDataExclusions,3);assert.equal(snapshot.watch.strategyRejections,0,'independent predictive failures stay separate from executable strategy decisions');assert.deepEqual(snapshot.watch.waitMs,{mean:3200,maximum:15000});assert.deepEqual(snapshot.watch.promotionWaitMs,{mean:2100,maximum:11000});assert.deepEqual(snapshot.watch.ageCohorts,{preEntry:10,entryEligible:90,olderSelected:3});assert.equal(snapshot.watch.observationEligibleKnown,103);assert.equal(snapshot.watch.observationQueued,18);assert.equal(snapshot.observationAgePolicy.minimumObservationAgeMs,0);
 assert.deepEqual(snapshot.decisions,engine.decisions);assert.deepEqual(snapshot.refusals,[{reason:'migration-verification-unavailable',count:4},{reason:'verification-queue-full',count:2},{reason:'native-quality-gaps',count:3},{reason:'independent-audit-unavailable',count:2},{reason:'independent-audit-unusable',count:1}]);assert.equal(snapshot.generatedAt,T);assert.equal(snapshot.source.release,NATIVE_PROJECTION_RELEASE);assert.equal(local.sourceTimes.lastMarketNotificationAt,T-20);assert.equal(local.sourceTimes.lastAuditAt,T-1100);
 // Existing deployed telemetry has no sourceTimes field. These timestamps remain
 // local diagnostic evidence and are not silently promoted to generation time.
 assert.equal(Object.hasOwn(snapshot,'sourceTimes'),false);assert.match(snapshot.status,/current window requires independent audit/);assert.equal(snapshot.running,true);assert.equal(snapshot.portfolio,null);assert.equal(snapshot.accounting,null);assert.equal(snapshot.financialExecutionAuthorized,false);
});

test('stopped, provider-degraded and disconnected states remain truthful and never create fresh protection facts',()=>{
 const cases=[{modify:e=>{e.rpc.cooldownUntil=T+10000;},feeds:feedUsage(),running:true,expect:/RPC cooldown/},{modify:e=>{e.flow.connected=false;},feeds:feedUsage(),running:true,expect:/native flow disconnected/},{modify:e=>{e.candidates[0].snapshot.sourceSupportFresh=false;},feeds:feedUsage(),running:true,expect:/support unavailable\/stale/},{modify:e=>{e.candidates[0].snapshot.hasQualityLoss=true;},feeds:feedUsage(),running:true,expect:/data gap/},{modify:()=>{},feeds:{...feedUsage(),discoveryConnected:false,pumpApiConnected:false},running:true,expect:/Migration discovery disconnected.*WATCH activity hints unavailable/},{modify:()=>{},feeds:feedUsage(),running:false,expect:/stopped: SYNTHETIC finite interval ended/}];
 for(const c of cases){const engine=engineFixture();c.modify(engine);const local=nativeCandidateReportingProjection(engine,c.feeds,0.5,c.running,'SYNTHETIC finite interval ended'),snapshot=projectPilotStatus(rawStatus(local,{running:c.running,generatedAt:T+500}));assert.match(snapshot.status,c.expect);assert.equal(snapshot.running,c.running);assert.equal(snapshot.generatedAt,T+500);assert.equal(snapshot.metrics.maximumCompletedGapMs,null);assert.equal(snapshot.metrics.maximumQuoteAgeMs,null);assert.equal(snapshot.entriesEnabled,false);assert.equal(snapshot.portfolio,null);assert.equal(snapshot.accounting,null);assert.equal(snapshot.funnel.qualified,0);assert.ok(snapshot.status.length<=256);}
});
