/** OFFLINE current projector against the exact installed legacy validator. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import ts from 'typescript';
import {projectOperatingIntelligence, ORIGINAL_POE_ACCOUNT, ORIGINAL_POE_INCEPTION} from '../../../src/operating-intelligence.js';

const receiverCommit = 'bb1e91eb7c9f00d00aa459c6984cdbddfc0a27a1';
const old = execFileSync('git', ['show', receiverCommit + ':src/operating-intelligence.ts'], {encoding:'utf8'});
const js = ts.transpileModule(old, {compilerOptions:{module:ts.ModuleKind.ESNext, target:ts.ScriptTarget.ES2022}}).outputText;
const receiver = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const at = Date.parse('2026-10-30T01:40:00.000Z');
const source = () => ({
 accountId:ORIGINAL_POE_ACCOUNT, inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),
 generatedAt:at, startedAt:at-600000, runId:'OFFLINE-integrated-source-compatibility',
 strategyVersion:'adaptive-momentum-v2-paper-v1', configurationSha256:'b'.repeat(64), persistent:true,
 positions:{}, pending:{}, reporting:{protectionHistory:{scope:'known-lower-bound',historyUnavailable:false}},
 observationReportingMeaning:['Existing source meaning'],
 timing:{lastCompletedProtectionAt:at-100,targetMs:2000,experimentalCompletedEvaluationLimitMs:4000,
 maximumCompletedGapMs:89426,maximumQuoteAgeAtUseMs:70,protectionBreaches:73,unavailableChecks:240,
 currentRunMaximumCompletedGapMs:8877,currentRunMaximumQuoteAgeAtUseMs:65},
 usage:{rpc:{startedAt:at-500000,cooldownUntil:at+2000,protectionRecovery:{calls:200,logicalAttempts:205,
 rapidProbes:1,successesAfterRetry:1,refusals:5,rolling10SecondStarts:5,rolling60SecondStarts:30,
 providerRestrictionUntil:0,failureStages:{'physical-timeout':3,'protection-retry-paced':5},
 lastFailure:{at:at-1500,stage:'protection-retry-paced',physicalInFlight:false}}},
 market:{entryQuoteFailures:{count:2,last:{at:at-1000,mint:'So11111111111111111111111111111111111111112',
 phase:'rent',reasonCode:'PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH',elapsedMs:260.25,callerAborted:false,
 deadlineAborted:false,unknownErrorSha256:'PRIVATE_SENTINEL_NOT_FOR_EXPORT'}}}},
 adaptiveHoldingDiagnostics:{},
} as any);

const raw = source();
for (const [mint, state] of [['So11111111111111111111111111111111111111112','measured'], ['11111111111111111111111111111111','fallback']] as const) {
 raw.positions[mint] = {enteredAt:at-10000,strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'400000000',highWaterAt:at-1000}};
 raw.adaptiveHoldingDiagnostics[mint] = {state,reason:state==='measured'?'lagged-width-with-nondecreasing-boundary':'awaiting-new-high-water',
 quoteAt:at-100,evaluatedAt:at-90,measuredVolatilityBps:1000,effectiveTrailingDistanceBps:state==='measured'?2000:1500,
 priorQuoteCount:15,modeledTrailingBoundaryLamports:'320000000',meaning:'MODELED_TRIGGER_NOT_GUARANTEED_FILL'};
}
const original = structuredClone(raw), projected = projectOperatingIntelligence(raw);
assert.deepEqual(raw, original, 'projection cannot mutate source financial state');
assert.equal(projected.protection.breaches,73);assert.equal(projected.protection.unavailableChecks,240);
assert.equal(projected.protection.maximumCompletedGapMs,89426);
assert.equal(projected.protection.state,'monitored','fresh held pricing may coexist with optional-work backoff');
assert.deepEqual(receiver.validateOperatingIntelligence(projected,new Date(at).toISOString()),projected);
const notes = projected.quality.limitations.join('\n');
for(const needle of ['gap 8877 ms','protection-retry-paced:5','rent/PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH','measured trail 2000 bps','fallback trail 1500 bps','historical failures remain retained'])assert.ok(notes.includes(needle),needle);
assert.ok(projected.quality.limitations.length<=10);assert.ok(projected.quality.limitations.every(note=>note.length<=512));
assert.doesNotMatch(notes,/PRIVATE_SENTINEL/);
raw.usage.rpc.protectionRecovery.providerRestrictionUntil=at+1000;
assert.equal(projectOperatingIntelligence(raw).protection.state,'degraded','real provider restrictions remain visible');
raw.usage.rpc.protectionRecovery.providerRestrictionUntil='malformed';
assert.equal(projectOperatingIntelligence(raw).protection.state,'degraded','unknown new restriction state stays conservative');
const html=execFileSync('git',['show',receiverCommit+':src/dashboard.ts'],{encoding:'utf8'});
assert.ok(html.includes("q.limitations.forEach(note=>add(p,'p',note,'panel-sub'));"));
const result={receiverCommit,actualLegacyValidatorAccepted:true,originalDashboardRendersNotesAsText:true,
 newSchema:false,projectorMutatedInput:false,retainedFailureCounts:{breaches:73,unavailableChecks:240,maximumCompletedGapMs:89426},
 notes:projected.quality.limitations,providerRequests:0,financialActions:0,serviceControls:0};
writeFileSync(new URL('./legacy-receiver.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
