import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeFinancialHandoff,HANDOFF_REASONS} from '../src/native-financial-handoff.js';
import {FINANCIAL_HANDOFF_REASONS,projectFinancialHandoffReporting,validateFinancialHandoffReporting} from '../src/financial-handoff-reporting.js';
const T=Date.parse('2026-10-31T00:50:00.000Z'),RUN='native-paper-handoff-fixture',mint='11111111111111111111111111111111';
const certificate={mint,windowEndAt:T-1000,deadlineAt:T+9000,admittedAt:T,openedAt:T-61000,featuresSha256:'a'.repeat(64)};
test('actual usable certificate producer exports dispatch and expiry separately from qualification with explicit upper-bin percentiles',()=>{
 for(const reason of HANDOFF_REASONS)assert.ok((FINANCIAL_HANDOFF_REASONS as readonly string[]).includes(reason),'every producer reason has a public classification');const producer=new NativeFinancialHandoff(RUN,T-1000,4);producer.observe(T,[certificate]);producer.defer(certificate,'proof-retention',T+100);producer.dispatch(certificate,T+249);const p=projectFinancialHandoffReporting(producer.usage(T+250),T+250)!;
 assert.ok(p);validateFinancialHandoffReporting(p,T+250);assert.equal(p.seen,1);assert.equal(p.dispatched,1);assert.equal(p.financialEvaluations,0);assert.equal(p.dispatchWait.mean,249);assert.equal(p.dispatchWait.p50UpperMs,300);assert.equal(p.blockedMsByReason['proof-retention'],149);assert.equal(Object.hasOwn(p,'qualified'),false);assert.equal(Object.hasOwn(p.active[0]!,'featuresSha256'),false);assert.equal(Object.hasOwn(p.active[0]!,'openedAt'),false);
 const waiting=new NativeFinancialHandoff(RUN,T-1000,4);waiting.observe(T,[certificate]);waiting.observe(T+9001,[]);const expired=projectFinancialHandoffReporting(waiting.usage(T+9001),T+9001)!;assert.equal(expired.expiredBeforeDispatch,1);assert.equal(expired.invalidatedBeforeDispatch,0);assert.equal(expired.dispatchWait.mean,null);
});

test('specific handoff prerequisites retain decision attempts, economic completions and original readiness time separately',()=>{
 const producer=new NativeFinancialHandoff(RUN,T-1000,4);producer.observe(T,[certificate]);const raw=producer.usage(T+50) as any;
 raw.financialEvaluations=3;raw.economicDecisions=1;raw.blockedMsByReason['provider-capacity']=40;raw.deferralTransitionsByReason['provider-capacity']=1;
 Object.assign(raw.active[0],{reason:'provider-capacity',blockingPrerequisite:'ENTRY_SHORT_WINDOW_CAPACITY',operation:'FINANCIAL_DECISION',requiredMs:1700,availableMs:1300,observedAt:T+10});
 const projected=projectFinancialHandoffReporting(raw,T+100)!;assert.ok(projected);validateFinancialHandoffReporting(projected,T+100);
 assert.equal(projected.financialEvaluations,3);assert.equal(projected.economicDecisions,1);assert.equal(projected.blockedMsByReason['provider-capacity'],40);assert.equal(projected.generatedAt,new Date(T+50).toISOString());
 assert.deepEqual(projected.active[0],{mint,windowEndAt:new Date(T-1000).toISOString(),deadlineAt:new Date(T+9000).toISOString(),admittedAt:new Date(T).toISOString(),firstSeenAt:new Date(T).toISOString(),state:'waiting',reason:'provider-capacity',observedAt:new Date(T+10).toISOString(),blockingPrerequisite:'ENTRY_SHORT_WINDOW_CAPACITY',operation:'FINANCIAL_DECISION',requiredMs:1700,availableMs:1300});
 raw.active[0].blockingPrerequisite='DO_NOT_EXPORT';raw.active[0].operation='private provider text';const redacted=projectFinancialHandoffReporting(raw,T+100)!;assert.equal(redacted.active[0]!.blockingPrerequisite,null);assert.equal(redacted.active[0]!.operation,null);assert.doesNotMatch(JSON.stringify(redacted),/DO_NOT_EXPORT|private provider text/);
 raw.active[0].observedAt=T+51;const unavailableTime=projectFinancialHandoffReporting(raw,T+100)!;assert.equal(unavailableTime.seen,1);assert.equal(unavailableTime.active[0]!.observedAt,null,'invalid optional diagnostic time cannot hide the independent certificate counters');
 for(const change of [(r:any)=>r.active[0].observedAt=new Date(T+51).toISOString(),(r:any)=>r.active[0].requiredMs=-1,(r:any)=>r.active[0].blockingPrerequisite='UNKNOWN',(r:any)=>r.economicDecisions=-1]){const bad=structuredClone(projected);change(bad);assert.throws(()=>validateFinancialHandoffReporting(bad,T+100),/INVALID/);}
});

test('older handoff payloads remain valid and do not manufacture new prerequisite or economic-decision observations',()=>{
 const producer=new NativeFinancialHandoff(RUN,T-1000,4);producer.observe(T,[certificate]);const raw=producer.usage(T) as any;delete raw.economicDecisions;
 for(const reason of ['provider-capacity','holding-protection','pending-orders','source-unavailable','reporting-health','financial-permission','entry-preparation']){delete raw.blockedMsByReason[reason];delete raw.deferralTransitionsByReason[reason];}
 const projected=projectFinancialHandoffReporting(raw,T)!;assert.equal(projected.economicDecisions,null);assert.equal(projected.blockedMsByReason['provider-capacity'],null);assert.equal(projected.active[0]!.observedAt,undefined);
 const legacy=structuredClone(projected);delete legacy.economicDecisions;for(const reason of ['provider-capacity','holding-protection','pending-orders','source-unavailable','reporting-health','financial-permission','entry-preparation'] as const){delete legacy.blockedMsByReason[reason];delete legacy.deferralTransitionsByReason[reason];}validateFinancialHandoffReporting(legacy,T);
});
test('unsupported optional handoff is absent; private extras and malformed times never enter public wire',()=>{
 assert.equal(projectFinancialHandoffReporting(undefined,T),undefined);const producer=new NativeFinancialHandoff(RUN,T-1000,4);producer.observe(T,[certificate]);const raw=producer.usage(T) as any;raw.apiKey='DO_NOT_EXPORT';raw.active[0].privateError='DO_NOT_EXPORT';const p=projectFinancialHandoffReporting(raw,T)!;assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|featuresSha256|privateError/);
 for(const change of [(r:any)=>r.apiKey='private',(r:any)=>r.dispatched=2,(r:any)=>r.active[0].reason='private',(r:any)=>r.active[0].firstSeenAt=new Date(T+1).toISOString(),(r:any)=>r.dispatchWait.histogramResolutionMs=1]){const bad=structuredClone(p);change(bad);assert.throws(()=>validateFinancialHandoffReporting(bad,T),/INVALID/);}
});
