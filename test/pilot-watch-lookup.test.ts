/** Offline identity lookup parity. No market requests, ledger or financial writer. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PilotWatch,type WatchRow} from '../src/pilot-watch.js';
const retained=JSON.parse(readFileSync('evidence/migration-age-20261028/selection-head-block/before.json','utf8'));
const metadata=(r:WatchRow)=>({mint:r.mint,pool:r.pool,signature:r.signature,migrationAt:r.migrationAt,verifiedAt:r.verifiedAt,state:r.state,olderResearch:r.olderResearch!==undefined});
function restored(at=retained.at){return new PilotWatch({maximumIdentities:174,maximumDeep:6,now:()=>at,record(){},restored:structuredClone(retained.watch)});}

test('recorded registry single lookups and flat identities match full snapshot without exposing mutable internals',()=>{
 const watch=restored(),snapshot=watch.snapshot(retained.at),before=watch.export();
 for(const r of snapshot.rows){assert.deepEqual(watch.lookupIdentity(r.signature,retained.at),r);if(r.mint)assert.deepEqual(watch.lookupIdentity(r.mint,retained.at),r);}
 assert.equal(watch.lookupIdentity('not-a-retained-identity',retained.at),undefined);
 assert.deepEqual(watch.listIdentities(retained.at),snapshot.rows.map(metadata));
 const rich=watch.lookupIdentity(snapshot.rows[0]!.signature,retained.at)!;rich.history.push({at:retained.at,state:'HELD',reason:'external mutation'});rich.reason='external mutation';if(rich.capacityCoverage)rich.capacityCoverage.reason='external mutation';
 const flat=watch.listIdentities(retained.at);flat[0]!.signature='external mutation';assert.equal(Object.hasOwn(flat[0]!,'history'),false);assert.equal(Object.hasOwn(flat[0]!,'capacityCoverage'),false);assert.equal(typeof flat[0]!.olderResearch,'boolean');
 assert.deepEqual(watch.export(),before);
});

function seeded(){
 let now=1000000;const events:Array<{kind:string;data:unknown}>=[],watch=new PilotWatch({maximumIdentities:174,maximumDeep:6,now:()=>now,record:(kind,data)=>events.push({kind,data})});
 for(const name of ['ordinary','held','pending','unsupported','resource']){watch.discover({signature:'origin-'+name,feedMint:name,receivedAt:now});watch.verify('origin-'+name,{mint:name,pool:'pool-'+name,migrationAt:now-300000,verifiedAt:now});}
 watch.discover({signature:'unverified',receivedAt:now});watch.transition('held','HELD','owned exposure',now);watch.transition('pending','ENTRY_PENDING','unresolved action',now);watch.transition('unsupported','PERMANENTLY_UNSUPPORTED','structural evidence',now);
 return {watch,events,set(at:number){now=at;},get now(){return now;}};
}

test('cheap reads apply exactly the same age expiry while retaining held and unresolved identities',()=>{
 const original=seeded(),checkpoint=original.watch.export(),later=original.now+7500000,make=()=>new PilotWatch({maximumIdentities:174,maximumDeep:6,now:()=>later,record(){},restored:structuredClone(checkpoint)}),reference=make(),single=make(),flat=make();
 const expected=reference.snapshot(later);assert.equal(single.lookupIdentity('ordinary',later)!.state,'EXPIRED');assert.equal(single.lookupIdentity('held',later)!.state,'HELD');assert.equal(single.lookupIdentity('pending',later)!.state,'ENTRY_PENDING');assert.equal(single.lookupIdentity('unsupported',later)!.state,'PERMANENTLY_UNSUPPORTED');
 assert.deepEqual(flat.listIdentities(later),expected.rows.map(metadata));assert.deepEqual(single.export(),reference.export());assert.deepEqual(flat.export(),reference.export());
});

test('cheap reads expire stale capacity readiness with the same transitions and checkpoints as full snapshot',()=>{
 const f=seeded();f.watch.deferCapacity('resource','required enrichment cannot fit method rate limit and usefulness deadline',{requests:1,windowMs:10000,observedAt:f.now,complete:true,source:'confirmed-pool-signatures'},f.now);f.set(f.now+5000);
 const intent=f.watch.reassessCapacity({at:f.now,capacityObservedAt:f.now,windowMs:5000,freeEnrichmentStarts:8,freeSharedStarts:8,globalCooldownUntil:0,protectionPending:false});assert.equal(intent!.kind,'deep-readmission-ready');
 const checkpoint=f.watch.export(),later=f.now+30001,make=()=>new PilotWatch({maximumIdentities:174,maximumDeep:6,now:()=>later,record(){},restored:structuredClone(checkpoint)}),reference=make(),single=make(),flat=make();
 const expected=reference.snapshot(later);assert.equal(single.lookupIdentity('resource',later)!.capacityCoverage!.status,'AWAITING_CAPACITY');
 assert.deepEqual(flat.listIdentities(later),expected.rows.map(metadata));assert.deepEqual(single.export(),reference.export());assert.deepEqual(flat.export(),reference.export());
});

test('cheap reads preserve existing invalid-time failure behavior instead of making old state fresh',()=>{
 const watch=restored();for(const at of [-1,NaN,1.5]){assert.throws(()=>watch.lookupIdentity('unknown',at),/PILOT_WATCH_TIME/);assert.throws(()=>watch.listIdentities(at),/PILOT_WATCH_TIME/);}
});
