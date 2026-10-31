/** Joint scheduler policy mechanics using the existing isolated native fixture.
 * No provider requests or financial account are opened. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {NATIVE_SERVICE_POLICY} from '../src/pilot-native-flow.js';
import {setup,scope,settle} from './native-flow-fixture.js';
const critical={allowSetup:false,allowRetirement:false} as const;
const second=()=>{const mint=new PublicKey(Buffer.alloc(32,18));return {mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58(),minSlot:0};};

test('coherent service policy defers new setup without forgetting identity or creating an ACK/window',async()=>{
 const f=setup();f.flow.addCandidate(scope);assert.equal(f.flow.servicePlan(critical).action,null);assert.deepEqual(f.flow.servicePlans(critical),[]);assert.equal((await f.flow.service(undefined,{},critical)).kind,'idle');assert.equal(f.operations.length,0);assert.equal(f.supportCalls.length,0);assert.equal(f.flow.snapshot(scope.mint)!.openedAt,null);assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,false);
 await f.open();assert.equal(f.flow.snapshot(scope.mint)!.connected,true);assert.equal(f.flow.snapshot(scope.mint)!.warm,false);await f.flow.stop();
});

test('current support refresh excludes unverified replacement setup when audits own the runway',async()=>{
 const f=setup({maximumCandidates:2}),socket=await f.open(),pending=second();f.flow.addCandidate(pending);f.flow.requestSupportRefresh();const plan=f.flow.servicePlan(critical);assert.equal(plan.action,'support-refresh');assert.equal(plan.required,true);assert.ok(plan.deadlineAt>f.now);const before=f.supportCalls.length;assert.equal((await f.flow.service(undefined,{},critical)).kind,'support');assert.equal(f.supportCalls.length,before+1);assert.equal(f.supportCalls.at(-1)!.length,1);assert.equal(f.flow.snapshot(pending.mint)!.sourceSupportFresh,false);assert.equal(f.flow.snapshot(pending.mint)!.openedAt,null);assert.equal(f.flow.snapshot(scope.mint)!.connected,true);f.notice(socket);assert.ok(f.trades.length>0);assert.equal(f.gaps.length,0);
 await f.open(pending);assert.equal(f.flow.snapshot(pending.mint)!.connected,true);await f.flow.stop();
});

test('shared service plan and actual dispatch select the nearest mandatory deadline, not fixed support order',async()=>{
 const f=setup();await f.open();f.flow.requestSupportRefresh();f.flow.requestHeartbeat();const plan=f.flow.servicePlan(critical);assert.equal(plan.action,'heartbeat');assert.equal(plan.deadlineAt,f.now);const supportBefore=f.supportCalls.length;assert.equal((await f.flow.service(undefined,{},critical)).kind,'ping');assert.equal(f.operations.at(-1)!.method,'ping');assert.equal(f.supportCalls.length,supportBefore);const selected=f.records.filter(r=>r.kind==='native-flow-service-selected').at(-1)!;assert.equal(selected.data.action,plan.action);assert.equal(selected.data.domain,plan.domain);assert.equal(selected.data.required,true);assert.equal(f.flow.servicePlan(critical).action,'support-refresh');assert.equal((await f.flow.service(undefined,{},critical)).kind,'support');await f.flow.stop();
});

test('complete service calendar retains future source and round-trip deadlines behind immediately eligible work',async()=>{
 const f=setup();await f.open();f.flow.requestSupportRefresh();const plans=f.flow.servicePlans(critical),support=plans.find(p=>p.action==='support-refresh')!,heartbeat=plans.find(p=>p.action==='heartbeat')!;assert.equal(support.at,f.now);assert.equal(support.required,true);assert.ok(heartbeat.at>f.now);assert.ok(heartbeat.deadlineAt<support.deadlineAt);const usage=f.flow.usage();assert.equal(usage.nextRequiredServiceAction,'heartbeat');assert.equal(usage.nextRequiredServiceDeadlineAt,heartbeat.deadlineAt);assert.ok(usage.nativeServiceDeadlines.some(p=>p.action==='support-refresh'));assert.ok(usage.nativeServiceDeadlines.some(p=>p.action==='heartbeat'));await f.flow.stop();
});

test('bounded retirement deferral retains physical ownership and peer evidence, then services the same planned unsubscribe',async()=>{
 const f=setup({maximumCandidates:2}),socket=await f.open(),retired=second();await f.open(retired);const oldSubscription=f.flow.snapshot(retired.mint)!.subscription!;f.flow.removeCandidate(retired.mint,'OFFLINE_VALID_PREDICTIVE_REJECTION');const now=f.now,plan=f.flow.servicePlans(critical).find(p=>p.action==='unsubscribe')!;assert.equal(plan.at,now+NATIVE_SERVICE_POLICY.retirementDeferredStartMs);assert.equal(plan.deadlineAt,now+NATIVE_SERVICE_POLICY.retirementDeadlineMs);const controls=f.operations.length;assert.equal((await f.flow.service(undefined,{},critical)).kind,'idle');assert.equal(f.operations.length,controls);assert.equal(f.flow.usage().retiring,1);assert.ok(f.flow.notificationLedger(retired.mint));f.notice(socket);assert.ok(f.trades.length>0);assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,false);
 await f.advance(NATIVE_SERVICE_POLICY.retirementDeferredStartMs);assert.equal(f.flow.servicePlan(critical).action,'unsubscribe');assert.equal((await f.flow.service(undefined,{},critical)).kind,'unsubscribe');assert.equal(f.operations.at(-1)!.method,'logsUnsubscribe');assert.equal(socket.sent.at(-1)!.params[0],oldSubscription);assert.equal(f.flow.usage().retiring,0);assert.equal(f.flow.snapshot(scope.mint)!.connected,true);assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,false);await f.flow.stop();
});

test('already ACKed capture can recover while new setup is disabled, retaining a fresh-window requirement',async()=>{
 const f=setup(),socket=await f.open(),oldOpen=f.flow.snapshot(scope.mint)!.openedAt!;socket.drop();await settle();await f.advance(2000);for(let i=0;i<8&&!f.flow.snapshot(scope.mint)!.connected;i++)await f.flow.service(undefined,{},critical);const view=f.flow.snapshot(scope.mint)!;assert.equal(view.connected,true);assert.ok(view.openedAt!>oldOpen);assert.equal(view.warm,false);assert.equal(view.hasQualityLoss,false);assert.equal(f.sockets.length,2);await f.flow.stop();
});

test('hard peer-PONG deadline precedes an already-late periodic heartbeat target',async()=>{
 const f=setup(),socket=await f.open();f.flow.requestHeartbeat();socket.emit('ping',Buffer.from('OFFLINE_URGENT_PEER_PING'));await f.advance(2500);assert.equal(f.flow.servicePlan(critical).action,'peer-pong');assert.equal((await f.flow.service(undefined,{},critical)).kind,'pong');assert.equal(socket.controls.at(-1),'pong');assert.equal(f.gaps.length,0);assert.equal(f.flow.servicePlan(critical).action,'heartbeat');assert.equal((await f.flow.service(undefined,{},critical)).kind,'ping');assert.equal(f.flow.snapshot(scope.mint)!.connected,true);await f.flow.stop();
});

test('canonical origin vault hints reach fresh support as defensive address copies without becoming source evidence',async()=>{
 const f=setup(),dependencyHints={baseVault:'14f29EBGBB1mFMMBnnbwi6Ff9tpcytYtrMX52mQkqG55',quoteVault:'3p2311H7FLZxSdKPAfYisroj5YXvNtbQZDKsqWgPo1B6'};f.flow.addCandidate({...scope,dependencyHints});dependencyHints.baseVault=scope.mint;const snapshot=f.flow.snapshot(scope.mint)!;snapshot.scope.dependencyHints!.quoteVault=scope.mint;
 await f.flow.service();assert.deepEqual(f.supportCalls[0]![0].dependencyHints,{baseVault:'14f29EBGBB1mFMMBnnbwi6Ff9tpcytYtrMX52mQkqG55',quoteVault:'3p2311H7FLZxSdKPAfYisroj5YXvNtbQZDKsqWgPo1B6'});assert.equal(f.flow.snapshot(scope.mint)!.warm,false);assert.equal(f.flow.snapshot(scope.mint)!.auditVerified,false);await f.flow.stop();
});
