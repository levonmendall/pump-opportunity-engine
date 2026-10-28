/** Offline selection from retained real state; no new market or financial data. */
import {test} from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{PilotWatch}from'../src/pilot-watch.js';import{nextPreparedWatchCandidate,pilotKnownOriginRecoverySeed}from'../src/pilot.js';
const recorded=JSON.parse(readFileSync('evidence/migration-age-20261028/selection-head-block/before.json','utf8'));
function fixture(){const now=recorded.at;return {now,watch:new PilotWatch({maximumIdentities:174,maximumDeep:6,now:()=>now,record(){},restored:recorded.watch}),excluded:new Set<string>(recorded.actualCandidates.map((c:any)=>c.mint))};}
test('recorded older identity without a cached proof cannot monopolize the deep preparation head',()=>{
 const f=fixture(),before=f.watch.next(f.now,f.excluded);assert.ok(before);assert.equal(recorded.publicProofs[before.mint!],undefined,'reproduces the demonstrated non-runnable selection');
 const after=nextPreparedWatchCandidate(f.watch,recorded.publicProofs,f.now,f.excluded);assert.ok(after);assert.ok(recorded.publicProofs[after.mint!]);assert.ok(!f.excluded.has(after.mint!));
 assert.ok(f.watch.snapshot(f.now).rows.some(r=>r.mint===before.mint),'missing proof does not erase awareness or fabricate a strategy rejection');
});
test('no runnable cached identity is an explicit null, never permission to admit unverified state',()=>{
 const f=fixture();assert.equal(nextPreparedWatchCandidate(f.watch,{},f.now,f.excluded),null);assert.equal(f.watch.snapshot(f.now).rows.length,recorded.watch.rows.length);
});


test('delayed watch hints cannot revive terminal/protected identities or extend six-hour research eligibility',()=>{
 const f=fixture(),row=f.watch.next(f.now,f.excluded)!;assert.ok(row.olderResearch);const seed=pilotKnownOriginRecoverySeed(row,{},[],f.now);assert.ok(seed);assert.equal(seed.signature,row.signature);assert.equal(seed.receivedAt,row.firstSeenAt);assert.ok(seed.eligibleAfter!>=f.now&&seed.eligibleAfter!>=row.deferUntil);
 for(const state of ['HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED','EXPIRED','QUALIFIED','DEEP_OBSERVATION'] as const)assert.equal(pilotKnownOriginRecoverySeed({...row,state},{},[],f.now),null,state);
 assert.equal(pilotKnownOriginRecoverySeed(row,{},[seed],f.now),null,'exact signature deduplicated');assert.equal(pilotKnownOriginRecoverySeed(row,{[row.mint!]:{} as any},[],f.now),null,'cached proof needs no reread');
 assert.equal(pilotKnownOriginRecoverySeed({...row,olderResearch:undefined},{},[],f.now),null,'older research selection remains explicit');assert.equal(pilotKnownOriginRecoverySeed(row,{},[],row.migrationAt!+21600000),null,'age horizon cannot be extended by a late hint');
});
