import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readNativeProtectionHistory,NATIVE_PROTECTION_HISTORY_KIND,type NativeProtectionHistoryInput} from '../src/native-protection-history.js';

const accountId='poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt=1793052456212,run='native-paper-20261029221651345',otherRun='native-paper-20261029194223241',at=inceptionAt+400000000;
const counts={maxCompletedGapMs:12329,maxQuoteAgeMs:56,breaches:3,unavailableChecks:5};
const checkpoint=()=>({kind:NATIVE_PROTECTION_HISTORY_KIND,accountId,inceptionAt,sourceRunId:run,generatedAt:at-1000,counters:{...counts}});
const previousStatus=()=>({accountId,inceptionAt,runId:run,generatedAt:at-500,source:{commit:'b'.repeat(40),sha256:'c'.repeat(64),nonAuthorityMetadata:'ignored'},timing:{maximumCompletedGapMs:12329,maximumQuoteAgeAtUseMs:56,protectionBreaches:3,unavailableChecks:5,lastCompletedProtectionAt:at-501,firstCompletedProtectionAt:at-10000,openProtectionGaps:[],healthyProofStreak:500}});
const input=(overrides:Partial<NativeProtectionHistoryInput>={}):NativeProtectionHistoryInput=>({accountId,inceptionAt,knownRunIds:[run,otherRun],at,checkpoint:null,previousStatus:null,...overrides});

test('prior private status seeds retained failures without restoring old healthy proof',()=>{
 const status=previousStatus(),before=JSON.stringify(status),result=readNativeProtectionHistory(input({previousStatus:status}));assert.deepEqual(result,{...counts,fromCheckpoint:false,fromPreviousStatus:true,historyUnavailable:false,scope:'known-lower-bound'});assert.equal(JSON.stringify(status),before);assert.deepEqual(Object.keys(result).sort(),['maxCompletedGapMs','maxQuoteAgeMs','breaches','unavailableChecks','fromCheckpoint','fromPreviousStatus','historyUnavailable','scope'].sort());
});

test('cumulative checkpoint/status use per-counter maximum, never sum or reset on repeated resume',()=>{
 const old=checkpoint(),status=previousStatus();old.counters={maxCompletedGapMs:14000,maxQuoteAgeMs:40,breaches:2,unavailableChecks:9};
 const first=readNativeProtectionHistory(input({checkpoint:old,previousStatus:status}));assert.deepEqual(first,{maxCompletedGapMs:14000,maxQuoteAgeMs:56,breaches:3,unavailableChecks:9,fromCheckpoint:true,fromPreviousStatus:true,historyUnavailable:false,scope:'known-lower-bound'});
 const repeated=readNativeProtectionHistory(input({checkpoint:{...old,counters:{maxCompletedGapMs:first.maxCompletedGapMs,maxQuoteAgeMs:first.maxQuoteAgeMs,breaches:first.breaches,unavailableChecks:first.unavailableChecks}},previousStatus:status}));assert.deepEqual(repeated,first);
});

for(const kind of ['foreign-account','wrong-inception','unknown-run','future','pre-inception','bad-kind','extra-proof-field'] as const)test(`checkpoint ${kind} cannot restore statistics`,()=>{
 const value:any=checkpoint();if(kind==='foreign-account')value.accountId='another-account';if(kind==='wrong-inception')value.inceptionAt++;if(kind==='unknown-run')value.sourceRunId='native-paper-20990101000000000';if(kind==='future')value.generatedAt=at+1;if(kind==='pre-inception')value.generatedAt=inceptionAt-1;if(kind==='bad-kind')value.kind='unversioned';if(kind==='extra-proof-field')value.lastCompletedAt=at;
 const result=readNativeProtectionHistory(input({checkpoint:value}));assert.equal(result.fromCheckpoint,false);assert.equal(result.historyUnavailable,true);assert.equal(result.breaches,0);assert.equal(result.scope,'known-lower-bound');
});

for(const key of ['account','inception','run','future','source-commit','source-hash'] as const)test(`previous status ${key} binding cannot claim known protection history`,()=>{
 const value:any=previousStatus();if(key==='account')value.accountId='another-account';if(key==='inception')value.inceptionAt++;if(key==='run')value.runId='unknown';if(key==='future')value.generatedAt=at+1;if(key==='source-commit')value.source.commit='not-a-commit';if(key==='source-hash')value.source.sha256='f'.repeat(63);
 const result=readNativeProtectionHistory(input({previousStatus:value}));assert.equal(result.fromPreviousStatus,false);assert.equal(result.historyUnavailable,true);
});

for(const invalid of [-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,Number.MAX_SAFE_INTEGER+1,'3',null,undefined])test(`malformed counter ${String(invalid)} cannot become a lower bound`,()=>{
 for(const field of Object.keys(counts)){
  const value=checkpoint();(value.counters as any)[field]=invalid;const result=readNativeProtectionHistory(input({checkpoint:value,previousStatus:previousStatus()}));assert.equal(result.fromCheckpoint,false);assert.equal(result.fromPreviousStatus,true);assert.deepEqual({...counts},Object.fromEntries(Object.keys(counts).map(key=>[key,(result as any)[key]])));
 }
});

test('missing or corrupt optional histories remain explicit unknown lower bounds and never throw',()=>{
 for(const value of [null,undefined,{},[],{kind:NATIVE_PROTECTION_HISTORY_KIND},'corrupt',42]){const result=readNativeProtectionHistory(input({checkpoint:value,previousStatus:value}));assert.equal(result.historyUnavailable,true);assert.equal(result.breaches,0);assert.equal(result.fromCheckpoint,false);assert.equal(result.fromPreviousStatus,false);}
 const broken=new Proxy({}, {get(){throw Error('OFFLINE unreadable optional stats');}});const result=readNativeProtectionHistory(input({checkpoint:broken,previousStatus:previousStatus()}));assert.equal(result.fromPreviousStatus,true);assert.equal(result.breaches,3);
});

test('valid zero statistics are only a known lower bound, not evidence of a currently healthy position',()=>{
 const value=checkpoint();value.counters={maxCompletedGapMs:0,maxQuoteAgeMs:0,breaches:0,unavailableChecks:0};const result=readNativeProtectionHistory(input({checkpoint:value}));assert.equal(result.fromCheckpoint,true);assert.equal(result.historyUnavailable,false);assert.equal(result.scope,'known-lower-bound');assert.equal('lastCompletedAt' in result,false);assert.equal('healthyProofStreak' in result,false);
});

test('unsafe helper identity/time/run collection returns unknown without reading optional statistics',()=>{
 for(const overrides of [{accountId:''},{inceptionAt:-1},{at:inceptionAt-1},{knownRunIds:['bad\nrun']},{knownRunIds:Array(1025).fill(run)}]){const result=readNativeProtectionHistory(input({...overrides,checkpoint:checkpoint(),previousStatus:previousStatus()}));assert.equal(result.historyUnavailable,true);assert.equal(result.breaches,0);}
});
