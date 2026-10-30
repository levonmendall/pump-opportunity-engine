/** Offline absolute-schedule arithmetic; no provider requests or grant writes. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {notificationComponentSchedule,notificationQuoteAtUse} from '../scripts/overnight-notifications.js';
import type {ComponentSnapshot} from '../src/component-parity.js';
import type {ComponentNotice} from '../src/component-transport.js';

test('notification reconnect management interleaves a fixed2s reference without colliding starts',()=>{
  const start=100000,plan=notificationComponentSchedule(start);
  assert.equal(plan.periodic.length,15);assert.deepEqual(plan.periodic.map(t=>t-start),Array.from({length:15},(_,i)=>i*2000));
  assert.equal(plan.closeAt,plan.periodic[4]); // Close follows that completed quote.
  assert.equal(plan.upgradeAt-start,9000);assert.deepEqual(plan.resubscribe.map(t=>t-start),[11000,13000,15000,17000,19000,21000,23000]);
  const physicalStarts=[...plan.periodic,plan.upgradeAt,...plan.resubscribe].sort((a,b)=>a-b);
  assert.equal(new Set(physicalStarts).size,23);assert.ok(physicalStarts.slice(1).every((t,i)=>t-physicalStarts[i]!>=1000));assert.equal(plan.endAt-start,30000);
  // Declared counts, not measured throughput:3preflightHTTP+8initialWS+
  // 15periodic+8reconnectWS+7cleanup+2optionaltrigger+1optionalblocktime.
  assert.equal(3+8+15+8+7+2+1,44);assert.ok(44+2<=70);
});

test('invalid schedule origins fail offline before any executable path',()=>{
  for(const at of [-1,Number.NaN,0.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>notificationComponentSchedule(at),/COMPONENT_SCHEDULE_TIME/);
});

function evidence(){
  const account={owner:'11111111111111111111111111111111',lamports:12,executable:false,data:['AQ==','base64'] as [string,string],rentEpoch:0},at=1000100;
  const snapshot:ComponentSnapshot={addresses:['selected-account'],value:[account],context:{slot:100},requestedAt:new Date(at-100).toISOString(),receivedAt:new Date(at).toISOString()};
  const notice=(lamports:number,slot=100):ComponentNotice=>{const changed={...account,lamports};return {at:at+10,connection:1,address:'selected-account',slot,account:changed,changed:true,hash:createHash('sha256').update(JSON.stringify({owner:changed.owner,lamports:changed.lamports,executable:changed.executable,data:changed.data})).digest('hex')};};
  return {snapshot,notice,receivedAt:at,marketClockUnixSeconds:1000,usedAt:at+20,highestNoticeSlot:100};
}

test('same-slot incompatible latest confirmed account bytes cannot become an actionable quote',()=>{
  const f=evidence(),bad=notificationQuoteAtUse({...f,notices:[f.notice(13)]});
  assert.equal(bad.actionableAtUse,false);assert.equal(bad.nonActionableReason,'SAME_SLOT_CONFIRMED_ACCOUNT_BYTES_INCOMPATIBLE');assert.deepEqual(bad.sameSlotIncompatibleAccounts,['selected-account']);
  assert.equal(notificationQuoteAtUse({...f,notices:[f.notice(12)]}).actionableAtUse,true);
  const later={...f.notice(12),at:f.usedAt};assert.equal(notificationQuoteAtUse({...f,notices:[f.notice(13),later]}).actionableAtUse,true);
  const delayedOlder={...f.notice(12,99),at:f.usedAt};assert.equal(notificationQuoteAtUse({...f,notices:[f.notice(13),delayedOlder]}).actionableAtUse,false);
});

test('an older-slot intermediate account version is neither current incompatibility nor proof of missed coverage',()=>{
  const f=evidence(),older=notificationQuoteAtUse({...f,notices:[f.notice(13,99)]});assert.equal(older.actionableAtUse,true);assert.deepEqual(older.sameSlotIncompatibleAccounts,[]);
  const newer=notificationQuoteAtUse({...f,notices:[f.notice(12,101)]});assert.equal(newer.actionableAtUse,false);assert.equal(newer.nonActionableReason,'NEWER_CONFIRMED_NOTICE_BECAME_AVAILABLE');
});

test('freshness is enforced at the time after parity, retaining no stale actionable condition',()=>{
  const f=evidence();assert.equal(notificationQuoteAtUse({...f,notices:[],usedAt:f.receivedAt+2000}).actionableAtUse,true);
  assert.throws(()=>notificationQuoteAtUse({...f,notices:[],usedAt:f.receivedAt+2001}),/COMPONENT_QUOTE_AGE_AT_USE/);
  assert.throws(()=>notificationQuoteAtUse({...f,notices:[],marketClockUnixSeconds:969}),/COMPONENT_QUOTE_AGE_AT_USE/);
});
