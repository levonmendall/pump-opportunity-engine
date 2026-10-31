import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeFinancialHandoff,HANDOFF_REASONS} from '../src/native-financial-handoff.js';
import {FINANCIAL_HANDOFF_REASONS,projectFinancialHandoffReporting,validateFinancialHandoffReporting} from '../src/financial-handoff-reporting.js';
const T=Date.parse('2026-10-31T00:50:00.000Z'),RUN='native-paper-handoff-fixture',mint='11111111111111111111111111111111';
const certificate={mint,windowEndAt:T-1000,deadlineAt:T+9000,admittedAt:T,openedAt:T-61000,featuresSha256:'a'.repeat(64)};
test('actual usable certificate producer exports dispatch and expiry separately from qualification with explicit upper-bin percentiles',()=>{
 assert.deepEqual([...FINANCIAL_HANDOFF_REASONS],[...HANDOFF_REASONS]);const producer=new NativeFinancialHandoff(RUN,T-1000,4);producer.observe(T,[certificate]);producer.defer(certificate,'proof-retention',T+100);producer.dispatch(certificate,T+249);const p=projectFinancialHandoffReporting(producer.usage(T+250),T+250)!;
 assert.ok(p);validateFinancialHandoffReporting(p,T+250);assert.equal(p.seen,1);assert.equal(p.dispatched,1);assert.equal(p.financialEvaluations,0);assert.equal(p.dispatchWait.mean,249);assert.equal(p.dispatchWait.p50UpperMs,300);assert.equal(p.blockedMsByReason['proof-retention'],149);assert.equal(Object.hasOwn(p,'qualified'),false);assert.equal(Object.hasOwn(p.active[0]!,'featuresSha256'),false);assert.equal(Object.hasOwn(p.active[0]!,'openedAt'),false);
 const waiting=new NativeFinancialHandoff(RUN,T-1000,4);waiting.observe(T,[certificate]);waiting.observe(T+9001,[]);const expired=projectFinancialHandoffReporting(waiting.usage(T+9001),T+9001)!;assert.equal(expired.expiredBeforeDispatch,1);assert.equal(expired.invalidatedBeforeDispatch,0);assert.equal(expired.dispatchWait.mean,null);
});
test('unsupported optional handoff is absent; private extras and malformed times never enter public wire',()=>{
 assert.equal(projectFinancialHandoffReporting(undefined,T),undefined);const producer=new NativeFinancialHandoff(RUN,T-1000,4);producer.observe(T,[certificate]);const raw=producer.usage(T) as any;raw.apiKey='DO_NOT_EXPORT';raw.active[0].privateError='DO_NOT_EXPORT';const p=projectFinancialHandoffReporting(raw,T)!;assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT|featuresSha256|privateError/);
 for(const change of [(r:any)=>r.apiKey='private',(r:any)=>r.dispatched=2,(r:any)=>r.active[0].reason='private',(r:any)=>r.active[0].firstSeenAt=new Date(T+1).toISOString(),(r:any)=>r.dispatchWait.histogramResolutionMs=1]){const bad=structuredClone(p);change(bad);assert.throws(()=>validateFinancialHandoffReporting(bad,T),/INVALID/);}
});
