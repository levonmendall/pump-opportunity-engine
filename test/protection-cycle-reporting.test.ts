import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCompletedProtectionCycles,validateCompletedProtectionCycles} from '../src/protection-cycle-reporting.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION,projectOperatingIntelligence,validateOperatingIntelligence} from '../src/operating-intelligence.js';
const T=Date.parse('2026-11-03T15:00:00Z'),START=T-10000,RUN='native-paper-protection-cycles',MINT='11111111111111111111111111111111',iso=(n:number)=>new Date(n).toISOString();
function raw(){return {scope:'CURRENT_SOURCE_PROCESS',generatedAt:T+1001,observations:4,intervals:3,breaches:1,maxMs:4001,sumMs:10001,firstProtectionCompletedAt:T-9000,lastCompletedAt:T+1001,intervalBuckets:{le2000:1,le4000:1,over4000:1},recent:[{mint:MINT,at:T-9000,previousAt:null,quoteAt:T-9050,gapMs:null,breach:false},{mint:MINT,at:T-7000,previousAt:T-9000,quoteAt:T-7050,gapMs:2000,breach:false},{mint:MINT,at:T-3000,previousAt:T-7000,quoteAt:T-3050,gapMs:4000,breach:false},{mint:MINT,at:T+1001,previousAt:T-3000,quoteAt:T+950,gapMs:4001,breach:true}]};}
const status=(cycles:unknown)=>({accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:T,startedAt:START,runId:RUN,strategyVersion:'liquidity-resilient-momentum-v3.1',configurationSha256:'a'.repeat(64),persistent:true,positions:{},pending:{},timing:{targetMs:2000,experimentalCompletedEvaluationLimitMs:4000,lastCompletedProtectionAt:T-3000,maximumCompletedGapMs:156043,protectionBreaches:128,completedProtectionCycles:cycles}});

test('protection cycle projection preserves actual per-process receipts, exact interval boundaries and its own observation time',()=>{
 const input=status(raw()),before=structuredClone(input),report=projectOperatingIntelligence(input),cycles=report.protection.completedProtectionCycles!;
 assert.ok(cycles);validateOperatingIntelligence(report,iso(T));assert.deepEqual(input,before);
 assert.equal(cycles.generatedAt,iso(T+1001));assert.equal(cycles.runId,RUN);assert.equal(cycles.observations,4);assert.equal(cycles.intervals,3);assert.equal(cycles.breaches,1);assert.deepEqual(cycles.intervalBuckets,{le2000:1,le4000:1,over4000:1});
 assert.equal(cycles.recent[0]!.previousAt,null);assert.equal(cycles.recent[0]!.gapMs,null);assert.equal(cycles.recent[2]!.breach,false);assert.equal(cycles.recent[3]!.gapMs,4001);
 assert.equal(report.protection.maximumCompletedGapMs,156043,'old maximum is retained without attributing its cause to the new observations');assert.equal(report.protection.breaches,128);assert.equal(report.protection.lastCompletedAt,iso(T-3000),'later diagnostics do not change the original financial/protection snapshot time');
 assert.deepEqual(projectCompletedProtectionCycles(raw(),RUN,START),cycles,'repeated publication adds no samples');
});

test('zero intervals and first completion remain explicit rather than a fictional successful protection interval',()=>{
 const empty={scope:'CURRENT_SOURCE_PROCESS',generatedAt:T,observations:0,intervals:0,breaches:0,maxMs:0,sumMs:0,firstProtectionCompletedAt:null,lastCompletedAt:null,intervalBuckets:{le2000:0,le4000:0,over4000:0},recent:[]};
 const projected=projectCompletedProtectionCycles(empty,RUN,START)!;assert.ok(projected);assert.equal(projected.maxMs,null);assert.equal(projected.intervals,0);assert.equal(projected.lastCompletedAt,null);
 const first=projectCompletedProtectionCycles({...empty,observations:1,firstProtectionCompletedAt:T,lastCompletedAt:T,recent:[{mint:MINT,at:T,previousAt:null,quoteAt:T-10,gapMs:null,breach:false}]},RUN,START)!;assert.ok(first);assert.equal(first.maxMs,null);assert.equal(first.recent[0]!.gapMs,null);
});

test('invalid optional cycle observations cannot hide financial protection and private extras never reach wire',()=>{
 const withExtras=raw() as any;withExtras.apiKey='DO_NOT_EXPORT';withExtras.recent[0].privateError='DO_NOT_EXPORT';const projected=projectCompletedProtectionCycles(withExtras,RUN,START)!;assert.doesNotMatch(JSON.stringify(projected),/DO_NOT_EXPORT|apiKey|privateError/);
 for(const change of [(r:any)=>r.intervalBuckets.le2000=2,(r:any)=>r.recent[3].gapMs=4000,(r:any)=>r.recent[0].breach=true,(r:any)=>r.firstProtectionCompletedAt=START-1,(r:any)=>r.recent[3].at=T+1002,(r:any)=>r.recent[0].quoteAt=T+2000,(r:any)=>r.recent=Array.from({length:17},()=>r.recent[0])]){const bad=raw();change(bad);assert.equal(projectCompletedProtectionCycles(bad,RUN,START),undefined);const protectedReport=projectOperatingIntelligence(status(bad));assert.equal(protectedReport.protection.completedProtectionCycles,undefined);assert.equal(protectedReport.protection.breaches,128);}
 for(const change of [(r:any)=>r.runId='other-run',(r:any)=>r.recent[0].apiKey='private',(r:any)=>r.intervals=4,(r:any)=>r.breaches=0]){const bad=structuredClone(projected);change(bad);assert.throws(()=>validateCompletedProtectionCycles(bad,RUN,START),/INVALID/);}
 assert.equal(projectOperatingIntelligence(status(undefined)).protection.completedProtectionCycles,undefined);
});
