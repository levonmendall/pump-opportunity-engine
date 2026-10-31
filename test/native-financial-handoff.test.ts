import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeFinancialHandoff,type HandoffCertificate} from '../src/native-financial-handoff.js';
const cert=(mint='A',end=1000):HandoffCertificate=>({mint,windowEndAt:end,deadlineAt:end+9999,admittedAt:end+100,openedAt:0,featuresSha256:'a'.repeat(64)});
test('handoff separates certificate expiry from source invalidation and never grants financial permission',()=>{
 const events:any[]=[];const m=new NativeFinancialHandoff('run',0,4,(_,v)=>events.push(v));m.observe(1200,[cert('A'),cert('B')]);m.defer(cert('A'),'proof-retention',1200);m.observe(1300,[cert('A')]);m.observe(11000,[]);
 const s=m.usage(11000);assert.equal(s.seen,2);assert.equal(s.invalidatedBeforeDispatch,1);assert.equal(s.expiredBeforeDispatch,1);assert.equal(s.blockedMsByReason['proof-retention'],9799);assert.equal(s.blockedMsByReason['await-financial-dispatch'],100);assert.ok(events.every(e=>e.financialPermission===false));
});
test('repeated observations do not duplicate certificates, deferrals or dispatched evaluations',()=>{
 const m=new NativeFinancialHandoff('run',0,4);const c=cert();m.observe(1200,[c]);m.observe(1300,[c]);m.defer(c,'proof-retention',1300);m.defer(c,'proof-retention',1400);m.dispatch(c,1451);m.dispatch(c,1460);m.complete(c,2000,1);m.complete(c,2010,1);
 const s=m.usage(2010);assert.equal(s.seen,1);assert.equal(s.dispatched,1);assert.equal(s.financialEvaluations,1);assert.equal(s.deferralTransitionsByReason['proof-retention'],1);assert.equal(s.dispatchWait.mean,351);assert.equal(s.dispatchWait.p95UpperMs,400);assert.equal(s.active.length,0);
});
test('new audited windows are distinct and usage does not mutate elapsed blocked time',()=>{
 const m=new NativeFinancialHandoff('run',0,4);m.observe(1200,[cert()]);assert.deepEqual(m.usage(1400),m.usage(1400));m.observe(1500,[cert()]);assert.equal(m.usage(1500).blockedMsByReason['await-financial-dispatch'],300);m.observe(11200,[cert('A',11000)]);assert.equal(m.usage(11200).seen,2);assert.equal(m.usage(11200).expiredBeforeDispatch,1);
});
test('only current bounded certificates are tracked and expired certificates cannot dispatch',()=>{
 const m=new NativeFinancialHandoff('run',0,4);assert.equal(m.observe(1200,Array.from({length:5},(_,i)=>cert(String(i)))),false);m.observe(1200,[cert()]);m.dispatch(cert(),11000);assert.equal(m.usage(11000).dispatched,0);assert.equal(m.observe(1000,[]),false);assert.equal(m.usage(11000).active.length,1);
});
