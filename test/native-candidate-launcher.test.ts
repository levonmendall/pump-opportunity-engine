import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateNativeCandidateInput,NATIVE_CANDIDATE_LIMITS,runNativeCandidates,settleNativeCandidateSources} from '../src/run-native-candidates.js';
const input=()=>({schemaVersion:1,baselinePaths:['/public/counters/prior.json'],priorPhysicalSettled:true,priorCooldownUntil:0,origins:[],source:{commit:'906c2aa',sha256:'1'.repeat(64)},reportingBinding:{accountId:'poe-pilot-8468add6-f916-48cf-a585-6cd008a81360',inceptionAt:1793123773252,sourceStatusSha256:'2'.repeat(64)}});
test('candidate launcher public binding validation creates no account and refuses financial or credential input',()=>{
 const good=input();assert.doesNotThrow(()=>validateNativeCandidateInput(good));assert.equal(Object.hasOwn(good,'balance'),false);
 for(const key of ['privateKey','wallet','secret','capital','balance','positions','pending','entriesEnabled'])assert.throws(()=>validateNativeCandidateInput({...good,[key]:{}}),/NONPUBLIC_INPUT_DENIED/);
 assert.throws(()=>validateNativeCandidateInput({...good,priorPhysicalSettled:false}),/INPUT/);
 assert.throws(()=>validateNativeCandidateInput({...good,reportingBinding:{...good.reportingBinding,sourceStatusSha256:'unverified'}}),/ACCOUNT_BINDING/);
 assert.throws(()=>validateNativeCandidateInput({...good,source:{...good.source,commit:'main'}}),/INPUT/);
});
test('candidate launcher remains finite and contains no financial implementation imports or transaction execution call',()=>{
 const source=readFileSync(new URL('../src/run-native-candidates.ts',import.meta.url),'utf8'),core=readFileSync(new URL('../src/native-candidate-runner.ts',import.meta.url),'utf8');
 for(const text of [source,core])assert.doesNotMatch(text,/from ['"].*(?:ledger|trader|execution|wallet|account)\.js['"]|sendTransaction|simulateTransaction|sendRawTransaction/);
 assert.equal(NATIVE_CANDIDATE_LIMITS.maximumDeep,6);assert.equal(NATIVE_CANDIDATE_LIMITS.durationMs,900000);assert.equal(NATIVE_CANDIDATE_LIMITS.maximumDurationMs,1800000);assert.equal(NATIVE_CANDIDATE_LIMITS.relatedResponseBytes,256*1024*1024);assert.equal(NATIVE_CANDIDATE_LIMITS.broadWatchBytes,1024*1024*1024);
 assert.match(source,/financialExecutionAuthorized:false,entriesEnabled:false/);assert.match(source,/portfolio:null/);assert.match(source,/startWatchActivity/);assert.doesNotMatch(source,/addCandidate\(/);
});
test('root execution refusal precedes reading private inputs or opening the network',async()=>{
 if(process.getuid?.()!==0)return;
 await assert.rejects(runNativeCandidates({inputPath:'/must-not-be-read',directory:'/must-not-be-created'}),/NONROOT_REQUIRED/);
});
test('one failed source stop cannot skip the other stop or report physical settlement',async()=>{
 const calls:string[]=[];const feeds={async stop(){calls.push('feeds');throw Error('PILOT_FEED_TRANSPORT_UNSETTLED');},usage:()=>({physicalTransportsSettled:false})},runner={async stop(){calls.push('native');}},native={usage:()=>({physicalTransportsSettled:true})},rpc={usage:()=>({inFlight:0,waitingOrOperating:false}),close(){calls.push('rpc-close');}};
 const result=await settleNativeCandidateSources(feeds as any,runner as any,native as any,rpc as any,'fixture');assert.deepEqual(calls,['feeds','native']);assert.equal(result.settled,false);assert.ok(result.failures.includes('PILOT_FEED_TRANSPORT_UNSETTLED'));assert.ok(result.failures.includes('NATIVE_RESEARCH_PHYSICAL_SETTLEMENT_UNKNOWN'));
 calls.length=0;const completed=await settleNativeCandidateSources({async stop(){calls.push('feeds');},usage:()=>({physicalTransportsSettled:true})} as any,runner as any,native as any,rpc as any,'fixture');assert.equal(completed.settled,true);assert.deepEqual(calls,['feeds','native','rpc-close']);
 const occupied=await settleNativeCandidateSources(undefined,undefined,undefined,{usage:()=>({inFlight:1,waitingOrOperating:true}),close(){throw Error('must not close');}} as any,'fixture');assert.equal(occupied.settled,false);
});
