import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeFinancialHandoff,nativeFinancialCertificateReceipt,type HandoffCertificate} from '../src/native-financial-handoff.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {FlowWindow} from '../src/strategy.js';
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

function economicFixture(){
 const mint='11111111111111111111111111111111',features=new FlowWindow(mint,0).features(60000),certificate={mint,openedAt:0,windowEndAt:features.windowEndAt,admittedAt:60010,deadlineAt:features.windowEndAt+9999,featuresSha256:nativePaperFeaturesSha256(features)};
 const event={version:'poe-opportunity-evaluation-v1',runId:'run',stage:'execution-economics',mint,at:60200,strategyVersion:'liquidity-resilient-momentum-v3.1',features:{...features,asOf:60200},technicalFailure:false,decision:{kind:'strategy-rejection',qualified:false,reason:'v3.1-nonpositive-joint-conditional-economic-balance'}};
 return {certificate,event};
}

test('actual matching economic receipts survive an absent optional counter and deduplicate per dispatched certificate',()=>{
 const {certificate:c,event}=economicFixture(),records:unknown[]=[],h=new NativeFinancialHandoff('run',0,4,(_,data)=>records.push(data));h.observe(60020,[c]);
 assert.equal(h.observeEconomicDecision('native-opportunity-evaluation',event),false,'undispatched evidence is not a completed handoff');h.dispatch(c,60100);const before=records.length;
 assert.equal(h.observeEconomicDecision('native-opportunity-evaluation',event),true);assert.equal(h.observeEconomicDecision('native-opportunity-evaluation',event),false);assert.equal(records.length,before,'direct receipt observation is in-memory only');
 const during=h.usage(60200);assert.equal(during.economicDecisions,1);assert.equal(during.financialEvaluations,0,'the attempt callback has not completed yet');assert.ok(!JSON.stringify(during.active).includes('economicDecisionObserved'));assert.ok(!JSON.stringify(during.active).includes('dispatchedAt'));
 h.complete(c,60300,1,0);h.complete(c,60400,1,1);assert.equal(h.usage(60400).economicDecisions,1);assert.equal(h.usage(60400).financialEvaluations,1);
 assert.equal(h.observeEconomicDecision('native-opportunity-evaluation',event),false,'a replay after completion cannot create another receipt');
 const second=new NativeFinancialHandoff('run',0,4);second.observe(60020,[c]);second.dispatch(c,60100);second.observeEconomicDecision('native-opportunity-evaluation',event);second.complete(c,60300,1,1);assert.equal(second.usage(60300).economicDecisions,1,'the legacy explicit counter delta does not double-count a direct receipt');
});

test('preliminary, mismatched, late and unusable events do not become economic handoff completions',()=>{
 const {certificate:c,event}=economicFixture();
 for(const mutate of [(e:any)=>e.stage='preliminary',(e:any)=>e.technicalFailure=true,(e:any)=>e.decision.kind='missing-data',(e:any)=>e.runId='other-run',(e:any)=>e.mint='22222222222222222222222222222222',(e:any)=>e.features.windowEndAt+=10000,(e:any)=>e.features.largestBuyerBps=1,(e:any)=>e.at=60100-1,(e:any)=>e.at=c.deadlineAt+1,(e:any)=>e.features={windowEndAt:c.windowEndAt},(e:any)=>delete e.decision.qualified]){
  const h=new NativeFinancialHandoff('run',0,4);h.observe(60020,[c]);h.dispatch(c,60100);const bad=structuredClone(event);mutate(bad);assert.equal(h.observeEconomicDecision('native-opportunity-evaluation',bad),false);h.complete(c,60300,1);assert.equal(h.usage(60300).economicDecisions,0);assert.equal(h.usage(60300).financialEvaluations,1);
 }
});

test('every terminal retains the same immutable original certificate even without a remaining-work sample',()=>{
 for(const outcome of ['completed','expired','invalidated']as const){
  const c=cert(),original=structuredClone(c),events:any[]=[],h=new NativeFinancialHandoff('run',0,4,(_,row)=>events.push(row));h.observe(1200,[c]);
  if(outcome==='completed'){h.dispatch(c,1300);h.complete(c,1600,1,0);}
  else h.observe(outcome==='expired'?c.deadlineAt+1:1300,[]);
  const terminal=events.at(-1),diagnostic=nativeFinancialCertificateReceipt(original);
  assert.deepEqual(terminal.certificate,original);assert.equal(terminal.certificateIdentitySha256,diagnostic.certificateIdentitySha256);assert.equal(terminal.firstSeenAt,1200);assert.equal(terminal.financialPermission,false);
  if(outcome==='completed'){assert.equal(terminal.dispatchWaitMs,200);assert.equal(terminal.decisionElapsedMs,300);assert.equal(terminal.completedBeforeOriginalDeadline,true);}
  else assert.equal(terminal.remainingWork,null);
  assert.deepEqual(c,original);assert.equal(h.usage(20000).active.length,0);
 }
 const c=cert();assert.notEqual(nativeFinancialCertificateReceipt(c).certificateIdentitySha256,nativeFinancialCertificateReceipt({...c,admittedAt:c.admittedAt+1}).certificateIdentitySha256);assert.notEqual(nativeFinancialCertificateReceipt(c).certificateIdentitySha256,nativeFinancialCertificateReceipt({...c,deadlineAt:c.deadlineAt+1}).certificateIdentitySha256);
});

test('private terminal timing joins exact request plans and retains observed blocker intervals without changing public keys',()=>{
 const c=cert(),events:any[]=[],h=new NativeFinancialHandoff('run',0,4,(_,row)=>events.push(row));h.observe(1200,[c]);
 h.observeTiming('native-paper-request-plan',{at:1201,requestId:'run:request:1',mint:c.mint,owner:'source',method:'getMultipleAccounts',certificate:c,requestedOperationMs:1700});
 h.observeTiming('native-paper-request-plan',{at:1202,requestId:'run:request:2',mint:c.mint,owner:'source',method:'getMultipleAccounts',certificate:{...c,featuresSha256:'b'.repeat(64)},requestedOperationMs:1700});
 h.defer(c,'entry-preparation',1300,{blockingPrerequisite:'ENTRY_PREPARATION_PENDING',operation:'ENTRY_PREPARATION',requiredMs:1700,availableMs:9699});
 h.defer(c,'required-service-or-protection-runway',1500,{blockingPrerequisite:'REQUIRED_NATIVE_SERVICE_DEADLINE',operation:'ENTRY_PREPARATION',requiredMs:1700,availableMs:9499});
 const active=h.usage(1500).active[0]!;assert.equal('reasonMs'in active,false);assert.equal('requestIds'in active,false);assert.equal('certificateIdentitySha256'in active,false);
 h.observe(c.deadlineAt+1,[]);const terminal=events.at(-1);
 assert.equal(terminal.unobservedBeforeFirstSeenMs,100);assert.deepEqual(terminal.requestIds,['run:request:1']);assert.deepEqual(terminal.blockedMsByReason,{'await-financial-dispatch':100,'entry-preparation':200,'required-service-or-protection-runway':9499});
 assert.equal(Object.values(terminal.blockedMsByReason).reduce((sum:any,n:any)=>sum+n,0),c.deadlineAt-1200);assert.equal(terminal.certificate.deadlineAt,c.deadlineAt);assert.equal(terminal.operation,'ENTRY_PREPARATION');assert.equal(terminal.physicalSettlementClaimed,undefined);
});
