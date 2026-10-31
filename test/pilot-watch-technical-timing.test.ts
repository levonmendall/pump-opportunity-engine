import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch,TECHNICAL_REEVALUATION_POLICY} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

test('legacy waiting timers migrate without changing the original failure, claimed window or episode expiry',()=>{
 let at=1000000;const records:Array<{kind:string;data:any}>=[],options={maximumDeep:4,now:()=>at,record:(kind:string,data:unknown)=>records.push({kind,data})};
 const watch=new PilotWatch(options);watch.discover({signature:'legacy',receivedAt:at});watch.verify('legacy',{mint:'legacy-mint',pool:'legacy-pool',migrationAt:at-300000,verifiedAt:at});
 watch.requestTechnicalReevaluation('legacy-mint',{reason:'entry-preparation-unavailable',failedWindowEndAt:at});at+=10000;assert.equal(watch.claimTechnicalReevaluation('legacy-mint',at),true);watch.requestTechnicalReevaluation('legacy-mint',{reason:'entry-quote-unavailable',failedWindowEndAt:at});
 const saved=watch.export(),original={...saved.rows[0]!.technicalReevaluation!};saved.rows[0]!.technicalReevaluation!.notBefore=at+15000;at+=10000;
 const restored=new PilotWatch({...options,restored:saved}),retry=restored.technicalReevaluation('legacy-mint')!;
 assert.deepEqual(retry,{...original,notBefore:at});assert.equal(restored.claimTechnicalReevaluation('legacy-mint',original.lastClaimedWindowEndAt!),false);assert.equal(restored.claimTechnicalReevaluation('legacy-mint',at),true);
 const migrated=records.find(r=>r.kind==='pilot-watch-technical-backoff-released')!.data;assert.equal(migrated.previousNotBefore,original.notBefore+15000);assert.equal(migrated.notBefore,at);assert.equal(migrated.requestedAt,original.requestedAt);assert.equal(migrated.expiresAt,original.expiresAt);assert.equal(migrated.attempts,1);assert.equal(migrated.financialPermission,false);
 assert.equal(TECHNICAL_REEVALUATION_POLICY.version,'next-fresh-window-technical-reevaluation-v2');
});

test('durable restart releases a legacy waiting timer while preserving blocked pool awareness and owned obligations',()=>{
 let at=1000000;const registry=new MarketRegistry(':memory:',{now:()=>at}),records:Array<{kind:string;data:any}>=[];
 const options={registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:(kind:string,data:unknown)=>records.push({kind,data})};
 try{
  const watch=new PilotWatch(options);for(const id of ['technical','unchanged','owned']){watch.discover({signature:id,receivedAt:at});watch.verify(id,{mint:id+'-mint',pool:id+'-pool',migrationAt:at-300000,verifiedAt:at});}
  watch.requestTechnicalReevaluation('technical-mint',{reason:'entry-quote-unavailable',failedWindowEndAt:at});const legacy=registry.lookup('technical-mint')!;legacy.technicalReevaluation!.notBefore=at+30000;registry.upsert(legacy);
  watch.noteEvaluation('unchanged-mint',{kind:'technical-unavailable',windowEndAt:null,evidence:'unchanged invalid account support'});watch.transition('owned-mint','ENTRY_PENDING','authoritative unresolved order');
  const original={...legacy.technicalReevaluation!};at+=10000;const resumed=new PilotWatch({...options,restored:watch.export()});
  assert.deepEqual(resumed.technicalReevaluation('technical-mint'),{...original,notBefore:at});assert.equal(registry.lookup('technical-mint')!.technicalReevaluation!.notBefore,at,'new scheduling metadata is durable');assert.equal(resumed.next(at,new Set())!.mint,'technical-mint');assert.equal(resumed.claimTechnicalReevaluation('technical-mint',original.failedWindowEndAt),false);assert.equal(resumed.claimTechnicalReevaluation('technical-mint',at),true);
  assert.equal(resumed.lookupIdentity('unchanged-mint')!.reobservation!.ready,null);assert.equal(resumed.lookupIdentity('owned-mint')!.state,'ENTRY_PENDING');assert.equal(resumed.next(at,new Set(['technical-mint'])),null,'timer migration grants neither unchanged-pool eligibility nor ownership clearance');
  assert.equal(resumed.snapshot().summary.known,3);assert.equal(resumed.snapshot().summary.evicted,0);assert.ok(records.some(r=>r.kind==='pilot-watch-technical-backoff-released'&&r.data.previousNotBefore===original.notBefore));
 }finally{registry.close();}
});
