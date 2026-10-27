import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runProgressivePilotFixture} from '../scripts/progressive-pilot-fixture.js';

test('one disposable account progresses through single recovery, shadow coverage and three SDK-priced concurrent exits',async()=>{
 const result=await runProgressivePilotFixture();
 assert.equal(result.networkRequests,0);assert.equal(result.productionTouched,false);assert.equal(result.pilotAccountTouched,false);
 assert.equal(result.account.inceptionCount,1);assert.equal(result.account.initialMicroUsd,'1000000000');
 assert.equal(result.maximumObserved.positions,3);assert.equal(result.maximumObserved.pending,3);assert.ok(result.maximumObserved.candidates>=2);
 assert.equal(result.simulated.entries,4);assert.equal(result.simulated.exits,4);assert.equal(result.simulated.executionCostsLamports,'56000');
 assert.equal(result.simulated.dailyLossPausePersisted,true);assert.ok(BigInt(result.maximumObserved.aggregatePositionCostMicroUsd)<=150000000n);assert.equal(result.syntheticLiquidityChanges.length,3);
 assert.ok(result.phases.some(p=>p.stage==='single-lifecycle-complete'&&p.details.restartPreservedEntireState));
 assert.ok(result.phases.some(p=>p.stage==='shadow-two-candidates-while-held'&&p.details.exposureUnchanged));
 assert.ok(result.phases.some(p=>p.stage==='rpc-outage-retains-three-positions'&&p.positions===3));
 assert.ok(result.phases.some(p=>p.stage==='three-simultaneous-exit-reservations'&&p.pending===3));
 assert.ok(result.phases.some(p=>p.stage==='three-exits-reconciled'&&p.positions===0));
 assert.ok(result.phases.some(p=>p.stage==='retained-low-liquidity-safety-refusal'&&p.pending===0));
});
