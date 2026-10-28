/** Offline reporting-only fixtures. No source, ledger, provider or credential
 * is opened. Financial execution counts are intentionally0 while independent
 * native observations are nonzero. */
import{test}from'node:test';import assert from'node:assert/strict';
import{nativePaperObservationReporting}from'../src/run-native-paper.js';

type Input=Parameters<typeof nativePaperObservationReporting>[0];
const T=Date.parse('2026-10-28T03:00:00Z');
function fixture(){
 const engine={generatedAt:T,observationAgePolicy:{version:'observation-age-v1',minimumObservationAgeMs:0,recentMaximumAgeMs:7200000,selectedOlderMaximumAgeMs:21600000},counters:{migrationHints:37,verificationQueueRefusals:2,verifiedOrigins:31,verificationRefusals:4,normalizedEvents:123,qualityGaps:3,auditedWindows:12,predictiveAssessments:12,predictiveFailed:9,predictiveNotRejected:2,predictiveUnavailable:1,uniqueEvaluated:5,strictV2BaselineUnavailableViews:0,auditUnavailable:2,auditUnusable:1,decisionDeadlineMisses:1},rpc:{newUnits:77,cooldownUntil:T-1000},flow:{connected:true,receivedBoundNotifications:45,normalizedEvents:123,socketBytes:1000000,lastNotificationAt:T-20,lastFreshSupportAt:T-500,lastBankClockAt:T-1000},watch:{rows:[],summary:{known:149,watch:120,eligibleKnown:90,deepActive:3,maximumDeep:6,queued:14,promoted:42,completeWindows:12}},candidates:[{snapshot:{sourceSupportFresh:true,hasQualityLoss:false,warm:true}}],decisions:[{at:T-1000,mint:'SYNTHETIC_A',stage:'shadow-predictive-failed',reason:'persistent buying rule not met'},{at:T-500,mint:'SYNTHETIC_B',stage:'shadow-predictive-not-rejected',reason:'predictive conditions not rejected; financial qualification remains separate'}],lastAuditAt:T-1100,lastPredictiveAt:T-500}as unknown as NonNullable<Input['engine']>;
 const feeds={frames:19,totalSocketBytes:250000,pumpApiSocketBytes:240000,discoverySocketBytes:10000,normalizedTrades:0,connections:{discovery:1,pumpapi:1},discoveryConnected:true,pumpApiConnected:true}as unknown as NonNullable<Input['feeds']>;
 return{engine,feeds,financialDecisions:[]as Input['financialDecisions'],eventLoopDelayP95Ms:4.75};
}

test('native PAPER reports real native flow even when the WATCH hint feed has zero normalized trades',()=>{
 const input=fixture(),before=structuredClone(input),p=nativePaperObservationReporting(input);
 assert.equal(p.feeds.normalizedTrades,123);assert.equal(p.feeds.frames,64);assert.equal(p.feeds.totalSocketBytes,1250000);assert.equal(p.feeds.nativeSocketBytes,1000000);assert.equal(p.feeds.broadWatchSocketBytes,240000);assert.equal(p.feeds.discoverySocketBytes,10000);assert.deepEqual(p.feeds.connections,{discovery:1,pumpapi:1},'broad transport diagnostics are retained');assert.deepEqual(p.independentPredictive,{assessments:12,failed:9,notRejected:2,unavailable:1,uniqueEvaluated:5});assert.equal(p.watch!.summary.predictiveAssessments,12);assert.equal(p.watch!.summary.predictiveFailures,9);assert.equal(p.watch!.summary.strategyRejections,null,'independent failures are not executable strategy rejections');assert.equal(p.watch!.summary.incompleteDataExclusions,3);assert.equal(p.observationAgePolicy!.minimumObservationAgeMs,0);assert.deepEqual(p.decisions,input.engine!.decisions);assert.deepEqual(input,before,'reporting does not mutate runtime counters or decisions');assert.equal('funnel'in p,false,'financial trader counters cannot be replaced by predictive activity');
});

test('native PAPER combines independent and financial decisions chronologically without leaking additional fields',()=>{
 const input=fixture();input.financialDecisions=[{at:T-750,mint:'SYNTHETIC_C',stage:'risk-rejection',reason:'isolated financial permission remains disabled',privatePayload:'DO_NOT_EXPORT'}as unknown as Input['financialDecisions'][number]];
 const p=nativePaperObservationReporting(input);assert.deepEqual(p.decisions.map(d=>d.stage),['shadow-predictive-failed','risk-rejection','shadow-predictive-not-rejected']);assert.ok(!JSON.stringify(p.decisions).includes('DO_NOT_EXPORT'));assert.equal(p.independentPredictive!.notRejected,2,'a predictive pass is not a financial qualification');assert.equal(p.decisions[1]!.at,T-750,'source availability time stays unchanged');
});

test('merged native PAPER decisions retain only the latest50 actual timestamps',()=>{
 const input=fixture();input.engine!.decisions=Array.from({length:30},(_,i)=>({at:T-200+i*2,mint:'SYNTHETIC_N',stage:'shadow-predictive-failed',reason:'recorded independent fixture'}));input.financialDecisions=Array.from({length:80},(_,i)=>({at:T-200+i*2+1,mint:'SYNTHETIC_F',stage:'risk-rejection',reason:'recorded financial fixture'}as Input['financialDecisions'][number]));const p=nativePaperObservationReporting(input);assert.equal(p.decisions.length,50);assert.equal(p.decisions[0]!.at,T-139);assert.equal(p.decisions.at(-1)!.at,T-41);assert.ok(p.decisions.every((d,i)=>!i||d.at>=p.decisions[i-1]!.at));
});

test('missing native engine remains unknown rather than borrowing WATCH zeroes or financial events',()=>{
 const input=fixture(),p=nativePaperObservationReporting({...input,engine:undefined});assert.equal(p.feeds.normalizedTrades,null);assert.equal(p.feeds.frames,null);assert.equal(p.feeds.totalSocketBytes,null);assert.equal(p.watch,null);assert.equal(p.independentPredictive,null);assert.equal(p.observationAgePolicy,null);assert.deepEqual(p.decisions,[]);
});
