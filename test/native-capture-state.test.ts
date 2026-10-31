import{test}from'node:test';
import assert from'node:assert/strict';
import{setup,scope}from'./native-flow-fixture.js';

test('ACK reconciliation reads current capture identity without calculating features or compacting the ledger',async()=>{
 const f=setup();await f.open();const expected=f.flow.snapshot(scope.mint)!;
 const candidate=(f.flow as any).candidates.get(scope.mint),features=candidate.window.features,compact=(f.flow as any).compactLedger;
 candidate.window.features=()=>{throw Error('FEATURE_CALCULATION_NOT_ALLOWED');};(f.flow as any).compactLedger=()=>{throw Error('LEDGER_COMPACTION_NOT_ALLOWED');};
 try{
  const state=f.flow.captureState(scope.mint)!;assert.equal(state.openedAt,expected.openedAt);assert.equal(state.subscription,expected.subscription);assert.equal(state.connectionId,expected.connectionId);assert.equal(state.connected,true);assert.equal(state.sourceSupportFresh,true);assert.equal(state.hasQualityLoss,false);
  state.scope.mint='changed-copy';assert.equal(f.flow.captureState(scope.mint)!.scope.mint,scope.mint);
  assert.equal(f.flow.captureState('not-selected'),null);assert.throws(()=>f.flow.captureState(scope.mint,f.now+1),/NATIVE_FLOW_FUTURE_SNAPSHOT/);
  await f.flow.stop();const stopped=f.flow.captureState(scope.mint)!;assert.equal(stopped.connected,false);assert.equal(stopped.hasQualityLoss,true);
 }finally{candidate.window.features=features;(f.flow as any).compactLedger=compact;await f.flow.stop();}
});
