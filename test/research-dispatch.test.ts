import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseResearchWork,type DispatchView,type ResearchJob} from '../src/research-dispatch.js';
const job=(id='a',kind:ResearchJob['kind']='enrichment',received=0):ResearchJob=>({id,kind,enqueuedAt:received,eligibleAt:received+1000,deadlineAt:received+5000,operationBoundMs:1200});
const view=(changes:Partial<DispatchView>={}):DispatchView=>({now:3010,readyAt:3010,physicalBusy:false,nextProtectionAt:4000,otherStartSinceProtection:false,jobs:[job('a','enrichment',2000)],...changes});
test('a nonzero10ms admission window serves enrichment; exact-boundary equality is unnecessary',()=>{
  const d=chooseResearchWork(view());assert.equal(d.kind,'job');if(d.kind==='job')assert.equal(d.latestStartAt,3100);
  assert.equal(chooseResearchWork(view({readyAt:3020})).kind,'wait');
});
test('due protection wins; two candidates cannot own consecutive physical slots',()=>{
  assert.equal(chooseResearchWork(view({now:4000,readyAt:4000})).kind,'protection');
  assert.equal(chooseResearchWork(view({otherStartSinceProtection:true})).kind,'wait');
});
test('known reservation cost must fit before the existing physical-start deadline rather than knowingly expiring after precharge',()=>{
  const d=chooseResearchWork(view({now:3090,readyAt:3090}));assert.notEqual(d.kind,'job');
  assert.equal(chooseResearchWork(view({now:3075,readyAt:3075})).kind,'job');
});
test('known late-phase hint can pull one future refresh forward; it cannot cause repeated early pricing',()=>{
  const d=chooseResearchWork(view({now:5059,readyAt:5059,nextProtectionAt:6000,jobs:[job('a','enrichment',4225)]}));
  assert.equal(d.kind,'protection');if(d.kind==='protection'){assert.equal(d.advance,true);assert.equal(d.scheduledAt,6000);}
  assert.equal(chooseResearchWork(view({now:5059,readyAt:5059,nextProtectionAt:6000,jobs:[job('a','enrichment',4225)],advanceOutstanding:true})).kind,'wait');
});
test('pending financial work keeps priority and every expired candidate is an explicit refusal',()=>{
  const a=job('action','pending',1000);a.eligibleAt=1000;a.deadlineAt=4500;
  const d=chooseResearchWork(view({now:4000,readyAt:4000,jobs:[a,job('flow','enrichment',2500)]}));assert.equal(d.kind,'refuse');
  a.deadlineAt=5500;assert.equal(chooseResearchWork(view({now:4000,readyAt:4000,jobs:[a]})).kind,'job');
  const late=chooseResearchWork(view({jobs:[job('stale','enrichment',0)],now:3900,readyAt:3900}));assert.equal(late.kind,'refuse');
});
test('caller cancellation does not release an occupied slot; malformed/unbounded work is refused',()=>{
  assert.equal(chooseResearchWork(view({physicalBusy:true})).kind,'wait');
  assert.throws(()=>chooseResearchWork(view({jobs:[job(),job()]})),/INVALID_JOB/);
  assert.throws(()=>chooseResearchWork(view({jobs:Array.from({length:17},(_,n)=>job(String(n)))})),/INVALID_VIEW/);
});
