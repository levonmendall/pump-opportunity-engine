/** OFFLINE real adapter over synthetic current support and in-memory sockets.
 * No market requests, ledger access, economic result or later information is used. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {setup,scope,tx} from './native-flow-fixture.js';
import {retainNativeSupportContexts,NATIVE_SUPPORT_CONTEXT_RETENTION,type NativeSupportContext} from '../src/native-support-contexts.js';
import {PilotRpcUnavailable} from '../src/pilot-rpc.js';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';

const context=(availableAt:number,slot=availableAt):NativeSupportContext=>({slot,availableAt,bankClockAt:Math.floor(availableAt/1000)*1000});

test('exact aligned-boundary and equal-availability proofs survive later reads without mutation or invented timestamps',()=>{
 const original=[context(9999,90),context(10000,100),context(10000,101),context(10001,102)];
 const before=structuredClone(original);let kept:NativeSupportContext[]=[];
 for(const next of original)kept=retainNativeSupportContexts(kept,next);
 assert.deepEqual(original,before);assert.deepEqual(kept.filter(c=>c.availableAt<=10000).at(-1),original[2]);
 assert.deepEqual(kept.filter(c=>c.availableAt>=10000&&c.availableAt<=10000),[original[2]]);
 assert.deepEqual(kept.at(-1),original[3]);kept[0]!.slot=1;assert.deepEqual(original,before,'returned history cannot mutate the validated inputs');
});

test('dense support refreshes preserve lower-fence existence over the unchanged180s horizon with at most38 actual contexts',()=>{
 let kept:NativeSupportContext[]=[],all:NativeSupportContext[]=[];
 for(let at=0;at<=300000;at+=125){const next=context(at,100000+at);all.push(next);kept=retainNativeSupportContexts(kept,next);assert.ok(kept.length<=NATIVE_SUPPORT_CONTEXT_RETENTION.maximumContexts);}
 assert.equal(NATIVE_SUPPORT_CONTEXT_RETENTION.maximumContexts,38);assert.ok(kept.every(c=>c.availableAt>=120000));
 const actual=all.filter(c=>c.availableAt>=120000);
 for(let start=120000;start<=300000;start+=10000)for(let ack=120000;ack<=start;ack+=1500){assert.equal(kept.some(c=>c.availableAt>=ack&&c.availableAt<=start),actual.some(c=>c.availableAt>=ack&&c.availableAt<=start));}
 assert.ok(kept.every(c=>all.some(v=>JSON.stringify(v)===JSON.stringify(c))),'only actual complete context tuples may be retained');
 assert.throws(()=>retainNativeSupportContexts(Array(39).fill(context(1)),context(2)),/NATIVE_SUPPORT_CONTEXT_BOUND/);
 assert.throws(()=>retainNativeSupportContexts([],{...context(1),slot:NaN}),/NATIVE_SUPPORT_CONTEXT_FIELDS/);
});

test('frequent coherent refreshes retain an actual post-ACK lower fence for three quiet sixty-second windows',async()=>{
 const f=setup({maximumCandidates:3,at:1793218163332});
 const peers=[scope,...[71,72].map(n=>{const mint=new PublicKey(Buffer.alloc(32,n));return {mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58(),minSlot:0};})];
 try{
  for(const peer of peers)await f.open(peer);
  for(let i=0;i<48;i++){await f.advance(1500);f.setSupportSlot(tx.slot+1+i);f.flow.requestSupportRefresh();await f.drive(3);}
  for(const peer of peers){const v=f.flow.snapshot(peer.mint)!;assert.equal(v.warm,true);assert.equal(v.sourceSupportFresh,true);assert.equal(v.features!.tradeCount,0);const lower=v.supportContexts.filter(c=>c.availableAt>=v.openedAt!&&c.availableAt<=v.features!.windowStartAt).at(-1);assert.ok(lower,'actual validated lower context must survive later refreshes; current prices remain independently fresh');assert.ok(lower.availableAt<=v.features!.windowStartAt);}
 }finally{await f.flow.stop();}
});

test('historical fences never extend current source expiry or turn an HTTP failure into fresh pricing',async()=>{
 const f=setup({at:1793218163332});
 try{await f.open();for(let i=0;i<48;i++){await f.advance(1500);f.flow.requestSupportRefresh();await f.drive(3);}const before=f.flow.snapshot(scope.mint)!;assert.ok(before.supportContexts.some(c=>c.availableAt<=before.features!.windowStartAt));const contextAt=before.supportContext!.availableAt;
  f.setSupportFailure(new PilotRpcUnavailable('COMPONENT_PHYSICAL_TIMEOUT',f.now+2000));f.flow.requestSupportRefresh();assert.equal((await f.flow.service()).kind,'deferred');assert.equal(f.flow.snapshot(scope.mint)!.supportContext!.availableAt,contextAt);
  await f.advance(30001);const stale=f.flow.snapshot(scope.mint)!;assert.ok(stale.supportContexts.length>1);assert.equal(stale.supportContext!.availableAt,contextAt);assert.equal(stale.sourceSupportFresh,false);assert.equal(stale.warm,false);assert.equal(stale.hasQualityLoss,true);
 }finally{await f.flow.stop();}
});

test('disconnect and retirement require new ACK generations and clear prior historical fences',async()=>{
 const f=setup({at:1793218163332});
 try{const old=await f.open();for(let i=0;i<48;i++){await f.advance(1500);f.flow.requestSupportRefresh();await f.drive(3);}const prior=f.flow.snapshot(scope.mint)!;assert.ok(prior.supportContexts.length>1);old.drop();await f.advance(2100);await f.drive(8);const next=f.flow.snapshot(scope.mint)!;assert.ok(next.openedAt!>prior.openedAt!);assert.notEqual(next.connectionId,prior.connectionId);assert.equal(next.supportContexts.length,1);assert.ok(next.supportContexts.every(c=>c.availableAt>=next.openedAt!));assert.equal(next.warm,false);
  f.flow.removeCandidate(scope.mint,'OFFLINE_CONTEXT_RETIREMENT');await f.drive(3);await f.advance(1000);await f.open();const reopened=f.flow.snapshot(scope.mint)!;assert.ok(reopened.openedAt!>next.openedAt!);assert.equal(reopened.supportContexts.length,1);assert.equal(reopened.warm,false);
 }finally{await f.flow.stop();}
});

test('structurally invalid current support cannot qualify using retained historical bank fences',async()=>{
 const f=setup({at:1793218163332});
 try{await f.open();for(let i=0;i<48;i++){await f.advance(1500);f.flow.requestSupportRefresh();await f.drive(3);}assert.equal(f.flow.snapshot(scope.mint)!.warm,true);f.setSupportUnavailable('SDK_POOL_LINK_CHANGED');f.flow.requestSupportRefresh();await f.drive();const invalid=f.flow.snapshot(scope.mint)!;assert.equal(invalid.hasQualityLoss,true);assert.equal(invalid.suspended,true);assert.equal(invalid.warm,false);assert.equal(invalid.completeRequiredEventFields,false);assert.ok(invalid.supportContexts.length>1);}
 finally{await f.flow.stop();}
});

test('a quiet real-adapter window receives its independent audit after many early refreshes instead of returning to fence warming',async()=>{
 const transaction=readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').map(l=>JSON.parse(l)).find(r=>r.kind==='migration-transaction').data;
 const at=Math.ceil((transaction.blockTime*1000+600000)/10000)*10000+2000;let runner:NativeCandidateRunner|undefined;
 const f=setup({at,onFlowOpen:row=>runner?.onFlowOpen(row),onGap:row=>runner?.onGap(row)}),records:Array<{kind:string;data:any}>=[];let requests=0;
 const rpc={usage:()=>({inFlight:0,waitingOrOperating:false,dispatchWindow:{readyAt:f.now,physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,async call<T>(method:string,_params:unknown[],signal?:AbortSignal){assert.equal(method,'getSignaturesForAddress');signal?.throwIfAborted();assert.equal(f.active,0);requests++;const view=f.flow.snapshot(mint)!,lower=view.supportContexts.filter(c=>c.availableAt>=view.openedAt!&&c.availableAt<=view.features!.windowStartAt).at(-1)!;assert.ok(lower);const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));return [{signature:signature(31),slot:view.supportContext!.slot+1,err:null,blockTime:null,confirmationStatus:'confirmed'},{signature:signature(32),slot:lower.slot-1,err:null,blockTime:null,confirmationStatus:'confirmed'}] as T;}};
 runner=new NativeCandidateRunner({flow:f.flow,rpc:rpc as any,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),now:()=>f.now,maximumDeep:1});
 const signature=transaction.transaction.signatures[0];runner.importOrigin({originConfirmed:{signature,availableAt:at,transaction:structuredClone(transaction)},originFinalized:{signature,availableAt:at,transaction:structuredClone(transaction)}});
 const mint=runner.status().watch.rows.find(r=>r.mint)!.mint!;
 try{
  for(let i=0;i<12&&!f.flow.snapshot(mint)?.connected;i++)await runner.step();assert.equal(f.flow.snapshot(mint)!.connected,true);
  for(let i=0;i<48;i++){await f.advance(1500);f.setSupportSlot(tx.slot+1+i);f.flow.requestSupportRefresh();await f.drive(3);}
  assert.equal(f.flow.snapshot(mint)!.warm,true);for(let i=0;i<4&&runner.status().counters.predictiveAssessments===0;i++)await runner.step();
  assert.equal(requests,1);assert.equal(runner.status().counters.auditedWindows,1);assert.equal(runner.status().counters.predictiveFailed,1);assert.equal(runner.status().counters.auditFenceWarmingWindows,0);assert.equal(runner.status().counters.decisionDeadlineMisses,0);assert.equal(records.some(r=>r.kind==='native-predictive-assessment'),true);assert.equal(runner.status().financialWriterOpened,false);
 }finally{await runner.stop();}
});

test('a ready quiet target survives the dispatch ceiling refresh instead of losing its lower fence between selection and session creation',async()=>{
 const transaction=readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').map(l=>JSON.parse(l)).find(r=>r.kind==='migration-transaction').data;
 const at=Math.ceil((transaction.blockTime*1000+600000)/10000)*10000+2000;let runner:NativeCandidateRunner|undefined;
 const f=setup({at,onFlowOpen:row=>runner?.onFlowOpen(row),onGap:row=>runner?.onGap(row)}),records:Array<{kind:string;data:any}>=[];let requests=0;
 const rpc={usage:()=>({inFlight:0,waitingOrOperating:false,dispatchWindow:{readyAt:f.now,physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,async call<T>(method:string,_params:unknown[],signal?:AbortSignal){assert.equal(method,'getSignaturesForAddress');signal?.throwIfAborted();assert.equal(f.active,0);requests++;const view=f.flow.snapshot(mint)!,lower=view.supportContexts.filter(c=>c.availableAt>=view.openedAt!&&c.availableAt<=view.features!.windowStartAt).at(-1)!;assert.ok(lower);const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));return [{signature:signature(33),slot:view.supportContext!.slot+1,err:null,blockTime:null,confirmationStatus:'confirmed'},{signature:signature(34),slot:lower.slot-1,err:null,blockTime:null,confirmationStatus:'confirmed'}] as T;}};
 runner=new NativeCandidateRunner({flow:f.flow,rpc:rpc as any,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),now:()=>f.now,maximumDeep:1});
 const signature=transaction.transaction.signatures[0];runner.importOrigin({originConfirmed:{signature,availableAt:at,transaction:structuredClone(transaction)},originFinalized:{signature,availableAt:at,transaction:structuredClone(transaction)}});
 const mint=runner.status().watch.rows.find(r=>r.mint)!.mint!;
 try{
  for(let i=0;i<12&&!f.flow.snapshot(mint)?.connected;i++)await runner.step();
  const target=Math.ceil(f.now/10000)*10000+60000,start=target-60000;
  await f.advance(start-f.now);f.setSupportSlot(tx.slot+1);f.flow.requestSupportRefresh();await f.drive(3);
  for(let i=1;i<=15;i++){await f.advance(start+i*3900-f.now);f.setSupportSlot(tx.slot+1+i);f.flow.requestSupportRefresh();await f.drive(3);}
  await f.advance(target+1-f.now);const ready=f.flow.snapshot(mint)!;assert.equal(ready.warm,true);assert.ok(ready.supportContexts.some(c=>c.availableAt>=ready.openedAt!&&c.availableAt<=start));assert.ok(ready.supportContext!.bankClockAt<target);
  assert.equal(await runner.step(),'audit-ceiling-support');assert.equal(requests,0,'required upper bank fence must be current before requesting history');
  for(let i=0;i<4&&runner.status().counters.predictiveAssessments===0;i++)await runner.step();
  assert.equal(requests,1);assert.equal(runner.status().counters.auditedWindows,1);assert.equal(runner.status().counters.auditFenceWarmingWindows,0);assert.equal(runner.status().counters.decisionDeadlineMisses,0);assert.ok(records.some(r=>r.kind==='native-audit-dispatch-state'&&r.data.reason==='audit-selected'));
 }finally{await runner.stop();}
});
