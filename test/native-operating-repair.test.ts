import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePaperRemainingEntryWork,nativePaperManagementReserve,nativePaperEntryWorkflowStarts,nativePaperHandoffCategory} from '../src/run-native-paper.js';
import {NativeOperatingCycles} from '../src/native-operating-cycles.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';

test('observed held-account short-window refusal uses remaining physical work instead of obsolete nine reads',()=>{
 const usage={chapter:1,newUnits:0,maximumNewUnits:1000,newAccountedResponseBytes:0,maximumNewResponseBytes:1000000,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:51,rolling10SecondStarts:8},protectionRecovery:{rolling60SecondStarts:29,rolling10SecondStarts:6}};
 const old=nativePaperManagementReserve(usage,true,true,9);assert.equal(old.entryAllowed,false);assert.equal(old.rolling10SecondStartHeadroom,12);assert.equal(old.protected10SecondStartReserve,4);assert.equal(old.rollingStartHeadroom,39);
 assert.equal(nativePaperEntryWorkflowStarts(true,'liquidity-resilient-momentum-v3.1',true),6);
 const work=nativePaperRemainingEntryWork({at:100000,owned:true,preparation:{remainingReads:0,quoteReads:1,expiresAt:110000,ready:true}});
 assert.equal(work.maximumAccountedStarts,3);assert.equal(work.decisionWorkMs,2650);assert.equal(work.prepared,true);
 const current=nativePaperManagementReserve(usage,true,true,work.maximumAccountedStarts);assert.equal(current.entryAllowed,true);assert.equal(current.protected10SecondStartReserve,old.protected10SecondStartReserve);assert.equal(current.protectedMinuteStartReserve,old.protectedMinuteStartReserve);
 assert.equal(nativePaperManagementReserve({...usage,chapterUsage:{...usage.chapterUsage,rolling10SecondStarts:14}},true,true,3).entryAllowed,false,'real remaining-capacity shortage still closes admission');
});

test('preparation plan counts cold quote dependencies and rejects expiry during the actual decision sequence',()=>{
 const cold=nativePaperRemainingEntryWork({at:100000,owned:true,preparation:{remainingReads:3,quoteReads:2,expiresAt:null,ready:false}});
 assert.equal(cold.maximumAccountedStarts,6,'preparation installs the links used by the ensuing actual-size quote');assert.equal(cold.prepared,false);assert.equal(cold.preparationWorkMs,5100);assert.equal(cold.remainingSequenceMs,7750,'the first preparation turn must leave time for every remaining preparation read and final decision');
 const evicted=nativePaperRemainingEntryWork({at:100000,owned:true,preparation:{remainingReads:0,quoteReads:2,expiresAt:110000,ready:true}});assert.equal(evicted.maximumAccountedStarts,4);assert.equal(evicted.decisionWorkMs,3850);
 assert.equal(nativePaperRemainingEntryWork({at:100000,owned:true,preparation:{remainingReads:0,quoteReads:1,expiresAt:102649,ready:true}}).prepared,false);
 assert.equal(nativePaperRemainingEntryWork({at:100000,owned:true,preparation:{remainingReads:0,quoteReads:1,expiresAt:102650,ready:true}}).prepared,true,'exact remaining-work boundary is inclusive; no timestamp is renewed');
});

test('handoff keeps local refusal separate from usable economic decisions and attributes expiry',()=>{
 const events:any[]=[],h=new NativeFinancialHandoff('offline',1000,4,(kind,data)=>events.push({kind,data}));
 const cert={mint:'offline',windowEndAt:1000,openedAt:0,admittedAt:1000,deadlineAt:9999,featuresSha256:'a'.repeat(64)};
 h.observe(1000,[cert]);h.defer(cert,'provider-capacity',1200,{blockingPrerequisite:'ENTRY_SHORT_WINDOW_CAPACITY',operation:'FINANCIAL_DECISION',requiredMs:2650,availableMs:8799});
 h.dispatch(cert,1300);h.complete(cert,1500,1,0);assert.equal(h.usage(1500).financialEvaluations,1);assert.equal(h.usage(1500).economicDecisions,0);
 const next={...cert,windowEndAt:10000,admittedAt:10000,deadlineAt:19999};h.observe(10000,[next]);h.dispatch(next,11000);h.complete(next,12000,1,1);assert.equal(h.usage(12000).economicDecisions,1);
 const expired={...next,windowEndAt:20000,admittedAt:20000,deadlineAt:29999};h.observe(20000,[expired]);h.defer(expired,'source-unavailable',21000,{blockingPrerequisite:'SOURCE_CLOSED',operation:'FINANCIAL_DECISION',requiredMs:2650,availableMs:8999});h.observe(30000,[]);
 assert.equal(h.usage(30000).expiredBeforeDispatch,1);assert.equal(events.at(-1).data.blockingPrerequisite,'SOURCE_CLOSED');assert.equal(events.at(-1).data.blockerObservedAt,21000);
});

test('completed-cycle evidence covers exact boundaries, repeated quote rejection and genuine long gaps',()=>{
 const c=new NativeOperatingCycles(10000,'offline');assert.equal(c.completed('held','100',10100,10070),true);
 assert.equal(c.completed('held','100',12100,12070),true);assert.equal(c.completed('held','100',16100,16070),true);assert.equal(c.completed('held','100',20101,20071),true);
 assert.equal(c.completed('held','100',20110,20071),false,'a reused quote does not count as a new completed cycle');
 c.completed('held','101',20200,20190);const u=c.usage(20300);assert.equal(u.observations,5);assert.equal(u.intervals,3);assert.equal(u.breaches,1);assert.equal(u.maxMs,4001);assert.deepEqual(u.intervalBuckets,{le2000:1,le4000:1,over4000:1});assert.equal(u.recent.at(-1)?.gapMs,null,'changed inventory starts a new comparable series');
 c.reconcileAtDecision(21000,19000);c.reconcileAtDecision(21001,19000);c.reconcileAtDecision(21002,21003);assert.deepEqual(c.usage(22000).decisionReconciliation,{decisions:3,invalid:1,stale:1,maxAgeMs:2001,lastUsedAt:21001,lastReconciledAt:19000});
});


test('binding prerequisite classification keeps portfolio permissions separate from provider capacity',()=>{
 assert.equal(nativePaperHandoffCategory('POSITION_CAPACITY'),'financial-permission');assert.equal(nativePaperHandoffCategory('PENDING_ORDERS'),'pending-orders');assert.equal(nativePaperHandoffCategory('ENTRY_SHORT_WINDOW_CAPACITY'),'provider-capacity');assert.equal(nativePaperHandoffCategory('PROVIDER_PHYSICAL_CAPACITY'),'provider-capacity');assert.equal(nativePaperHandoffCategory('FINANCIAL_PUBLICATION_UNAVAILABLE'),'reporting-health');assert.equal(nativePaperHandoffCategory('PROOF_PENDING'),'proof-retention');assert.equal(nativePaperHandoffCategory('HOLDING_PROTECTION_RUNWAY'),'holding-protection');
});
