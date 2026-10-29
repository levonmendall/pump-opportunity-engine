/** Disposable native transport mechanics; no provider/financial actions. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,scope,settle} from './native-flow-fixture.js';

async function recoverOnce(f:ReturnType<typeof setup>){
 const socket=await f.open();socket.drop();await settle();assert.equal(f.flow.usage().retryAt-f.now,2000);await f.advance(2000);await f.drive(8);assert.equal(f.flow.snapshot(scope.mint)!.connected,true);return f.sockets.at(-1)!;
}
async function managedHealthyMinute(f:ReturnType<typeof setup>){
 for(let n=0;n<12;n++){await f.advance(5000);f.flow.requestSupportRefresh();await f.drive(2);f.flow.requestHeartbeat();await f.drive(2);}
}

test('a stable managed-round-trip minute resets retry escalation after an isolated later disconnect',async()=>{
 const f=setup({persistent:true});try{const socket=await recoverOnce(f);await managedHealthyMinute(f);socket.drop();await settle();assert.equal(f.flow.usage().retryAt-f.now,2000,'a later isolated failure must not inherit lifetime escalation');assert.equal(f.flow.usage().transportRecovery.lifetimeFailures,2);assert.equal(f.flow.usage().transportRecovery.consecutiveFailures,1);assert.equal(f.flow.usage().transportRecovery.healthyProofResets,1);assert.ok(f.records.some(r=>r.kind==='native-flow-transport-backoff-recovered'&&r.data.cooldownsUnchanged===true&&r.data.qualificationEvidenceUnchanged===true));}finally{await f.flow.stop();}
});

test('successful upgrade and quick re-subscription do not reset a flapping transport',async()=>{
 const f=setup({persistent:true});try{let socket=await recoverOnce(f);for(const wait of [5000,10000,20000]){socket.drop();await settle();assert.equal(f.flow.usage().retryAt-f.now,wait);await f.advance(wait);await f.drive(8);assert.equal(f.flow.snapshot(scope.mint)!.connected,true);socket=f.sockets.at(-1)!;}}finally{await f.flow.stop();}
});

test('an unserviced minute plus one late proof cannot impersonate continuous managed health',async()=>{
 const f=setup({persistent:true});try{const socket=await recoverOnce(f);await f.advance(60000);f.flow.requestHeartbeat();await f.drive(2);socket.drop();await settle();assert.equal(f.flow.usage().retryAt-f.now,5000);}finally{await f.flow.stop();}
});

test('healthy recovery does not override an independent provider control cooldown or fresh-window requirement',async()=>{
 const f=setup({persistent:true});try{const socket=await recoverOnce(f);await managedHealthyMinute(f);const until=f.now+10000,opens=f.sockets.length;f.setControlCooldown(until);socket.drop();await settle();await f.advance(2000);await f.drive(3);assert.equal(f.sockets.length,opens);assert.equal(f.flow.snapshot(scope.mint)!.warm,false);await f.advance(8000);await f.drive(8);assert.equal(f.sockets.length,opens+1);assert.equal(f.flow.snapshot(scope.mint)!.connected,true);assert.equal(f.flow.snapshot(scope.mint)!.warm,false);assert.equal(f.flow.snapshot(scope.mint)!.auditVerified,false);}finally{await f.flow.stop();}
});
