/** Synthetic transport scheduling with retained real event bytes. These tests
 * exercise the actual router, never claim provider delivery or financial proof. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {NativeNotificationIngress,NATIVE_NOTIFICATION_INGRESS_POLICY,type IngressGeneration,type NativeIngressQuery} from '../src/native-notification-ingress.js';
import {setup,tx,signature,scope,clone,settle} from './native-flow-fixture.js';

const generation:IngressGeneration={mint:scope.mint,pool:scope.pool,openedAt:1000,connectionId:1,subscriptionId:101};
const frame=(sig=signature,subscription=101)=>({jsonrpc:'2.0',method:'logsNotification',params:{subscription,result:{context:{slot:tx.slot},value:{signature:sig,err:null,logs:['PRIVATE_RAW_LOG_MUST_NOT_BE_RETAINED']}}}});
const query=(patch:Partial<NativeIngressQuery>={}):NativeIngressQuery=>({target:{startAt:1000,endAt:2000},availableAt:2100,generation,missingSignatures:[signature],missingSignaturesTotal:1,...patch});
function row(ring:NativeNotificationIngress,at:number,patch:Partial<Parameters<NativeNotificationIngress['observe']>[0]>={}){
 const result=ring.observe({body:frame(),receivedAt:at,routedAt:at,connectionId:1,generation,stage:'INITIAL_CALLBACK',...patch});ring.finish(result,'ACTIVE_PROCESSOR');return result;
}
function liveQuery(f:ReturnType<typeof setup>,opened:IngressGeneration,sigs=[signature]){
 return {target:{startAt:opened.openedAt,endAt:Math.max(opened.openedAt+1,f.now)},availableAt:f.now,generation:opened,missingSignatures:sigs,missingSignaturesTotal:sigs.length};
}
function liveGeneration(f:ReturnType<typeof setup>):IngressGeneration{
 const state=f.flow.snapshot(scope.mint)!;assert.notEqual(state.openedAt,null);assert.notEqual(state.subscription,null);
 return {mint:scope.mint,pool:scope.pool,openedAt:state.openedAt!,connectionId:state.connectionId!,subscriptionId:state.subscription!};
}

test('ingress witness retains original compact identities and clocks without raw bytes or an admission claim',()=>{
 const ring=new NativeNotificationIngress(900),body=frame();row(ring,1200,{body,routedAt:1204});
 const witness=ring.evidence(query(),2200);assert.equal(witness.matches.length,1);assert.equal(witness.matches[0]!.receivedAt,1200);assert.equal(witness.matches[0]!.routedAt,1204);
 assert.deepEqual(witness.matches[0]!.generationAtRouting,generation);assert.equal(witness.matches[0]!.disposition,'ACTIVE_PROCESSOR');assert.equal(witness.retainedRouterIntervalComplete,true);
 assert.equal(witness.wholeSocketReceiptTrace,false);assert.equal(witness.providerLossProved,false);assert.equal(witness.localLossProved,false);assert.equal(witness.financialQualification,false);
 assert.equal(JSON.stringify(witness).includes('PRIVATE_RAW_LOG'),false);body.params.result.value.logs[0]='MODIFIED';witness.matches[0]!.generationAtRouting!.openedAt=42;
 assert.equal(ring.evidence(query(),2200).matches[0]!.generationAtRouting!.openedAt,1000,'export mutation cannot change retained identity');assert.equal(ring.usage().rowsObserved,1);
});

test('same subscription IDs before an ACK are explicit and never become proof of a new generation',()=>{
 const ring=new NativeNotificationIngress(900),old={...generation,openedAt:950};row(ring,990,{generation:old});
 const early=ring.observe({body:frame(),receivedAt:995,routedAt:995,connectionId:1,generation:null,stage:'INITIAL_CALLBACK'});ring.finish(early,'QUEUED_BEFORE_ACK');
 row(ring,995,{routedAt:1002,generation,stage:'EARLY_ACK_REPLAY'});const w=ring.evidence(query(),2200);
 assert.deepEqual(w.matches.map(r=>r.generationAtRoutingEqualsRequested),[false,false,true]);assert.deepEqual(w.matches.map(r=>r.receivedAfterRequestedAck),[false,false,false]);
 assert.equal(w.retention.initialCallbacks,2);assert.equal(w.retention.earlyAckReplays,1);assert.equal(w.retention.rowsObserved,3,'routing attempts do not pretend to be three physical receipts');
});

test('fixed ring and failure export bounds expose evictions, signature omissions and match omissions',()=>{
 const ring=new NativeNotificationIngress(900);for(let i=0;i<2100;i++)row(ring,1000+i);
 const sigs=Array.from({length:10},(_,i)=>i===0?signature:bs58.encode(Buffer.alloc(64,i+1))),w=ring.evidence(query({target:{startAt:1000,endAt:3200},availableAt:3300,missingSignatures:sigs,missingSignaturesTotal:10}),3400);
 assert.equal(w.retention.retainedRows,NATIVE_NOTIFICATION_INGRESS_POLICY.maximumRows);assert.equal(w.retention.evictedRows,52);assert.equal(w.retainedRouterIntervalComplete,false);
 assert.equal(w.missingSignatures.length,8);assert.equal(w.missingSignaturesOmitted,2);assert.equal(w.matchingRows,2048);assert.equal(w.matches.length,16);assert.equal(w.matchingRowsOmitted,2032);
 assert.ok(Buffer.byteLength(JSON.stringify(w))<20000,'one failed-window witness stays compact');
});

test('clock regression and invalid signature remain explicit diagnostic limitations',()=>{
 const ring=new NativeNotificationIngress(900);row(ring,1200);row(ring,1190,{routedAt:1191});row(ring,1250,{body:frame('SECRET-not-a-signature')});
 const w=ring.evidence(query(),2200);assert.equal(w.retention.clockFaults,1);assert.equal(w.retainedRouterIntervalComplete,false);assert.equal(w.matches[1]!.receivedAt,1190);
 assert.equal(w.retention.noncanonicalSignatures,1);assert.equal(JSON.stringify(w).includes('SECRET'),false);assert.equal(w.matches.length,2);
});

test('actual successful router adds no record or packet archive for the diagnostic and retains original ledger clocks',async()=>{
 const f=setup(),socket=await f.open(),opened=liveGeneration(f);f.elapseWithoutTimers(2);const original=f.now;f.notice(socket);await settle();
 const count=f.records.length,recorded=f.flow.usage().recordedBytes,ledger=f.flow.notificationLedger(scope.mint),trades=clone(f.trades),w=f.flow.notificationIngressEvidence(liveQuery(f,opened));
 assert.equal(w.matches.length,1);assert.equal(w.matches[0]!.receivedAt,original);assert.equal(w.matches[0]!.disposition,'ACTIVE_PROCESSOR');assert.equal(f.flow.usage().notifications,1);
 assert.equal(f.records.length,count);assert.equal(f.flow.usage().recordedBytes,recorded);assert.deepEqual(f.flow.notificationLedger(scope.mint),ledger);assert.deepEqual(f.trades,trades);
 assert.equal(f.records.some(r=>/ingress/i.test(r.kind)),false);assert.equal(w.financialQualification,false);await f.flow.stop();
});

test('actual unknown subscription captures signature before the existing unscoped integrity gap',async()=>{
 const f=setup(),socket=await f.open(),opened=liveGeneration(f);f.elapseWithoutTimers(2);const at=f.now;socket.frame(frame(signature,999999));await settle();
 const w=f.flow.notificationIngressEvidence(liveQuery(f,opened));assert.equal(w.matches.length,1);assert.equal(w.matches[0]!.signature,signature);assert.equal(w.matches[0]!.receivedAt,at);
 assert.equal(w.matches[0]!.generationAtRouting,null);assert.equal(w.matches[0]!.subscriptionId,999999);assert.equal(w.matches[0]!.disposition,'UNRECOGNIZED_SUBSCRIPTION');
 assert.equal(f.flow.usage().lastTransportIntegrityGap!.reason,'NATIVE_FLOW_UNSCOPED_NOTIFICATION');assert.equal(f.trades.length,0);assert.equal(w.localLossProved,false);await f.flow.stop();
});

test('actual suspended-scope silent drop retains a compact signature witness without a record call',async()=>{
 const f=setup(),socket=await f.open(),opened=liveGeneration(f);f.elapseWithoutTimers(2);
 f.notice(socket,{logs:['Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]','Program log: Instruction: FutureUnsupportedSwap','Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA success']});
 assert.equal(f.flow.snapshot(scope.mint)!.suspended,true);const count=f.records.length,recorded=f.flow.usage().recordedBytes,sig=bs58.encode(Buffer.alloc(64,29));f.elapseWithoutTimers(1);const at=f.now;f.notice(socket,{signature:sig});
 const w=f.flow.notificationIngressEvidence(liveQuery(f,opened,[sig]));assert.equal(w.matches.length,1);assert.equal(w.matches[0]!.disposition,'IGNORED_SUSPENDED');assert.equal(w.matches[0]!.receivedAt,at);
 assert.equal(f.records.length,count);assert.equal(f.flow.usage().recordedBytes,recorded);assert.equal(f.flow.snapshot(scope.mint)!.suspended,true);assert.equal(f.trades.length,0);await f.flow.stop();
});

test('actual early-ACK queue and replay preserve one original receipt and never backdate it into the new generation',async()=>{
 let f:ReturnType<typeof setup>;f=setup({onSubscriptionSent(){const socket=f.sockets.at(-1)!;socket.frame(frame(signature,101));f.elapseWithoutTimers(1);}});
 await f.open();const opened=liveGeneration(f);f.elapseWithoutTimers(2);const w=f.flow.notificationIngressEvidence(liveQuery(f,opened));
 assert.equal(w.matches.length,2);assert.deepEqual(w.matches.map(r=>r.stage),['INITIAL_CALLBACK','EARLY_ACK_REPLAY']);assert.equal(w.matches[0]!.disposition,'QUEUED_BEFORE_ACK');assert.equal(w.matches[1]!.disposition,'ACTIVE_PROCESSOR');
 assert.equal(w.matches[0]!.receivedAt,w.matches[1]!.receivedAt);assert.equal(w.matches[0]!.generationAtRouting,null);assert.deepEqual(w.matches[1]!.generationAtRouting,opened);
 assert.deepEqual(w.matches.map(r=>r.receivedAfterRequestedAck),[false,false]);assert.equal(f.flow.usage().notifications,1);assert.equal(w.retention.initialCallbacks,1);assert.equal(w.retention.earlyAckReplays,1);await f.flow.stop();
});
