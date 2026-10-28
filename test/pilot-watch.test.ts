import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PilotWatch,capacityProbePolicy,type CapacityDemand,type CapacityProbeContext} from '../src/pilot-watch.js';

function fixture(maximumIdentities=150,maximumDeep=3){
  let now=1000000;const records:Array<{kind:string;data:any}>=[];
  const options={maximumIdentities,maximumDeep,now:()=>now,record:(kind:string,data:unknown)=>records.push({kind,data})};
  const registry=new PilotWatch(options);
  const seed=(id:string,migrationAt=now-300000)=>{registry.discover({signature:'signature-'+id,feedMint:'hint-'+id,receivedAt:now});return registry.verify('signature-'+id,{mint:'mint-'+id,pool:'pool-'+id,migrationAt,verifiedAt:now});};
  return {registry,records,options,seed,at:(n:number)=>{now=n;},now:()=>now};
}

test('broad discovery remains independent of three full deep slots and provisional roles stay unverified',()=>{
  const f=fixture();for(let i=0;i<3;i++){f.seed(String(i));f.registry.transition('mint-'+i,'DEEP_OBSERVATION','fresh support and complete-window collection starting');}
  for(let i=3;i<150;i++)f.registry.discover({signature:'signature-'+i,feedMint:'unverified-'+i,receivedAt:f.now()});
  const s=f.registry.snapshot();assert.equal(s.summary.known,150);assert.equal(s.summary.deepActive,3);assert.equal(s.summary.unverified,147);assert.equal(s.summary.discovered,150);assert.equal(s.summary.capacityExclusions,0);
  const provisional=s.rows.find(r=>r.signature==='signature-149')!;assert.equal(provisional.mint,null);assert.equal(provisional.migrationAt,null);assert.equal(provisional.feedMint,'unverified-149');assert.equal(provisional.state,'DISCOVERED');
  assert.throws(()=>f.registry.transition('signature-149','DEEP_OBSERVATION','unverified roles'),/UNVERIFIED_PROMOTION/);
  assert.equal(s.summary.coverage.wholeMarketPercent,null);
});

test('demotion retains awareness; a changed-activity hint prioritizes re-promotion but cannot clear defer or supply flow',()=>{
  const f=fixture();f.seed('a');f.seed('b');f.registry.transition('mint-a','DEEP_OBSERVATION','first isolated observation');f.registry.noteWindow('mint-a',f.now());f.registry.transition('mint-a','DEFERRED','one complete predictive rejection',f.now(),{deferUntil:f.now()+30000});
  f.at(f.now()+1000);assert.equal(f.registry.noteActivity('mint-a',f.now(),'untrusted PumpApi activity hint; no normalized trade fields'),true);
  assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-b','activity must not bypass demotion cooldown');
  f.at(f.now()+30000);assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-b','fresh work receives its guaranteed cycle turn');f.registry.transition('mint-b','DEEP_OBSERVATION','fresh candidate turn');assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-a','newly active revisit receives the next priority turn');
  const again=f.registry.transition('mint-a','DEEP_OBSERVATION','changed-activity re-promotion, fresh full observation required');
  assert.equal(again.promotions,2);assert.equal(again.repromotions,1);assert.equal(again.completeWindows,1,'old valid-window count is historical only');assert.equal(again.deepSince,f.now());
  assert.equal(f.registry.snapshot().summary.repromoted,1);assert.equal(f.registry.snapshot().summary.demoted,1);
  assert.equal(f.records.filter(r=>r.kind==='pilot-watch-promotion').at(-1)!.data.freshFullWindowRequired,true);
});

test('quiet demoted identities receive fair periodic reconsideration without an activity claim',()=>{
  const f=fixture();f.seed('quiet');f.registry.transition('mint-quiet','DEEP_OBSERVATION','first');f.registry.transition('mint-quiet','DEFERRED','weak current window',f.now(),{deferUntil:f.now()+60000});f.at(f.now()+60000);
  assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-quiet');assert.equal(f.registry.next(f.now(),new Set(['mint-quiet'])),null);
  const row=f.registry.next(f.now(),new Set())!;assert.equal(row.lastActivityAt,null);row.reason='external mutation';assert.notEqual(f.registry.snapshot().rows[0]!.reason,row.reason);
});

test('waiting candidates cannot be starved indefinitely by renewed hints on another identity',()=>{
  const f=fixture();f.seed('old');f.at(f.now()+301000);f.seed('busy');f.registry.transition('mint-busy','DEEP_OBSERVATION','first');f.registry.transition('mint-busy','WATCH','temporary weakness');f.at(f.now()+1);f.registry.noteActivity('mint-busy',f.now(),'processed hint only');
  assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-old');
});

test('initial five-minute strategy warm-up does not erase changed-activity re-promotion preference',()=>{
  const f=fixture();f.seed('new',f.now());f.seed('revisit');f.registry.transition('mint-revisit','DEEP_OBSERVATION','first valid observation');f.seed('phase');f.registry.transition('mint-phase','DEEP_OBSERVATION','unrelated actual promotion advances durable phase');f.at(1270000);f.registry.transition('mint-revisit','DEFERRED','valid weak observation',f.now(),{deferUntil:1300000});f.at(1299000);f.registry.noteActivity('mint-revisit',f.now(),'new provider hint after demotion; re-observation only');f.at(1300000);
  assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-revisit');assert.equal(f.registry.snapshot().summary.waitMs.maximum,30000,'only post-eligibility queue wait counts');
});

test('identity expiry preserves holdings and pending obligations while removing deep entry eligibility',()=>{
  const f=fixture();for(const id of ['watch','deep','held','pending'])f.seed(id);
  f.registry.transition('mint-deep','DEEP_OBSERVATION','current support');f.registry.transition('mint-held','HELD','ledger exposure');f.registry.transition('mint-pending','ENTRY_PENDING','ledger action');f.at(1000000-300000+7200000);
  const s=f.registry.snapshot();assert.equal(s.rows.find(r=>r.mint==='mint-watch')!.state,'EXPIRED');assert.equal(s.rows.find(r=>r.mint==='mint-deep')!.state,'EXPIRED');assert.equal(s.rows.find(r=>r.mint==='mint-held')!.state,'HELD');assert.equal(s.rows.find(r=>r.mint==='mint-pending')!.state,'ENTRY_PENDING');assert.equal(s.summary.eligibleKnown,0);assert.equal(s.summary.deepActive,0);assert.equal(f.registry.next(f.now(),new Set()),null);
});

test('capacity evictions are explicit horizon losses and never silently discard an active deep scope',()=>{
  const f=fixture(3,1);for(const id of ['active','old','new'])f.seed(id);f.registry.transition('mint-active','DEEP_OBSERVATION','active scope');f.at(f.now()+1);f.registry.discover({signature:'replacement',receivedAt:f.now()});
  const s=f.registry.snapshot();assert.equal(s.summary.known,3);assert.ok(s.rows.some(r=>r.mint==='mint-active'));assert.ok(s.rows.some(r=>r.signature==='replacement'));assert.equal(s.summary.capacityExclusions,1);assert.equal(s.summary.evicted,1);assert.equal(f.records.find(r=>r.kind==='pilot-watch-evicted')!.data.lostHorizon,true);
  const g=fixture(1,1);g.seed('only');g.registry.transition('mint-only','DEEP_OBSERVATION','protected');assert.equal(g.registry.discover({signature:'still-visible-in-evidence',receivedAt:g.now()}),null);assert.equal(g.registry.snapshot().summary.capacityExclusions,1);assert.ok(g.records.some(r=>r.kind==='pilot-watch-capacity-refusal'&&r.data.signature==='still-visible-in-evidence'));
});

test('expired retention is reclaimed without claiming an eligible-horizon capacity loss',()=>{
  const f=fixture(1,1);f.seed('expired');f.at(8000000);f.registry.discover({signature:'new-current',receivedAt:f.now()});const s=f.registry.snapshot();assert.equal(s.summary.capacityExclusions,0);assert.equal(s.summary.expired,1);assert.equal(s.rows[0]!.signature,'new-current');
});

test('canonical verification merges duplicate mint identity and rejects conflicting pool/time',()=>{
  const f=fixture();f.seed('a');f.registry.discover({signature:'alias',feedMint:'wrong-quote-role',receivedAt:f.now()});const same=f.registry.verify('alias',{mint:'mint-a',pool:'pool-a',migrationAt:f.now()-300000,verifiedAt:f.now()});assert.equal(same.signature,'signature-a');assert.equal(f.registry.snapshot().summary.known,1);
  f.registry.discover({signature:'bad-alias',receivedAt:f.now()});assert.throws(()=>f.registry.verify('bad-alias',{mint:'mint-a',pool:'different',migrationAt:f.now()-300000,verifiedAt:f.now()}),/IDENTITY_CONFLICT/);
  const direct=f.registry.verify('previously-cached-identity',{mint:'mint-cached',pool:'pool-cached',migrationAt:f.now()-300000,verifiedAt:f.now()});assert.equal(direct.state,'WATCH');assert.ok(f.registry.snapshot().rows.some(r=>r.mint==='mint-cached'));
  assert.throws(()=>f.registry.verify('signature-a',{mint:'mint-cached',pool:'pool-cached',migrationAt:f.now()-300000,verifiedAt:f.now()}),/IDENTITY_CONFLICT/);assert.ok(f.registry.snapshot().rows.some(r=>r.mint==='mint-a'),'a verified signature cannot be reassigned through canonical merge');
});

test('restart preserves counters/history and obligations, but resets previous deep and qualified observation',()=>{
  const f=fixture();for(const id of ['deep','qualified','held','pending'])f.seed(id);f.registry.transition('mint-deep','DEEP_OBSERVATION','first');f.registry.noteWindow('mint-deep',f.now());f.registry.transition('mint-qualified','DEEP_OBSERVATION','first');f.registry.transition('mint-qualified','QUALIFIED','qualified rule');f.registry.transition('mint-held','HELD','ledger position');f.registry.transition('mint-pending','ENTRY_PENDING','unresolved ledger action');
  const state=f.registry.export();f.at(f.now()+1000);const resumed=new PilotWatch({...f.options,restored:state});const s=resumed.snapshot();assert.equal(s.summary.promoted,2);assert.equal(s.summary.completeWindows,1);assert.equal(s.summary.demoted,2);assert.equal(s.rows.find(r=>r.mint==='mint-deep')!.state,'DEFERRED');assert.equal(s.rows.find(r=>r.mint==='mint-qualified')!.deepSince,null);assert.equal(s.rows.find(r=>r.mint==='mint-held')!.state,'HELD');assert.equal(s.rows.find(r=>r.mint==='mint-pending')!.state,'ENTRY_PENDING');assert.equal(s.rows.find(r=>r.mint==='mint-deep')!.lastActivityAt,null);
});

test('malformed restore, overfull checkpoints and impossible duplicate identities are rejected',()=>{
  const f=fixture();f.seed('one');const state=f.registry.export();const malformed=structuredClone(state);malformed.rows[0]!.verifiedAt=null;assert.throws(()=>new PilotWatch({...f.options,restored:malformed}),/CHECKPOINT_IDENTITY/);
  const duplicate=structuredClone(state);duplicate.rows.push({...duplicate.rows[0]!,signature:'duplicate'});assert.throws(()=>new PilotWatch({...f.options,restored:duplicate}),/CHECKPOINT_IDENTITY/);
  assert.throws(()=>new PilotWatch({...f.options,restored:{...state,counters:{...state.counters,discovered:-1}}}),/CHECKPOINT/);
  assert.throws(()=>new PilotWatch({...f.options,maximumIdentities:513}),/LIMITS/);
});

test('same-state transitions and duplicate window timestamps are idempotent, history stays bounded',()=>{
  const f=fixture();f.seed('a');f.registry.transition('mint-a','DEEP_OBSERVATION','first');const count=f.records.length;f.registry.transition('mint-a','DEEP_OBSERVATION','first');assert.equal(f.records.length,count);f.registry.noteWindow('mint-a',f.now());f.registry.noteWindow('mint-a',f.now());assert.equal(f.registry.snapshot().summary.completeWindows,1);
  for(let i=0;i<30;i++){f.at(f.now()+1);f.registry.transition('mint-a','DEFERRED','retry-'+i);f.registry.transition('mint-a','DEEP_OBSERVATION','revisit-'+i);}
  const s=f.registry.snapshot();assert.equal(s.rows[0]!.history.length,16);assert.equal(s.summary.promoted,31);assert.equal(s.summary.repromoted,30);assert.equal(s.summary.demoted,30);
});

test('queue wait starts after verified eligibility, not the five-minute initial warming period',()=>{
  const f=fixture();f.seed('new',f.now());assert.equal(f.registry.snapshot().summary.eligibleKnown,0);f.at(f.now()+300500);const s=f.registry.snapshot();assert.equal(s.summary.queued,1);assert.equal(s.summary.waitMs.maximum,500);f.registry.transition('mint-new','DEEP_OBSERVATION','eligible admission');assert.equal(f.registry.snapshot().summary.promotionWaitMs.maximum,500);
});

test('explicit terminal exclusions cannot enter a coverage denominator or be re-promoted while timestamps remain within age',()=>{
  const f=fixture();f.seed('expired-early');f.seed('unsupported');f.registry.transition('mint-expired-early','EXPIRED','remaining horizon cannot fit a complete required window');f.registry.transition('mint-unsupported','PERMANENTLY_UNSUPPORTED','verified unsupported structural token behavior');
  const s=f.registry.snapshot();assert.equal(s.summary.eligibleKnown,0);assert.equal(s.summary.structuralExclusions,1);assert.equal(f.registry.next(f.now(),new Set()),null);assert.throws(()=>f.registry.transition('mint-expired-early','DEEP_OBSERVATION','try again'),/ENTRY_AGE/);assert.throws(()=>f.registry.transition('mint-unsupported','DEEP_OBSERVATION','try again'),/ENTRY_AGE/);
});


test('lower observation ceiling cannot prevent recovery of three owned pending actions',()=>{
 const f=fixture();for(const id of ['a','b','c']){f.seed(id);f.registry.transition('mint-'+id,'DEEP_OBSERVATION','fresh observation');f.registry.transition('mint-'+id,'ENTRY_PENDING','owned action unresolved');}
 const recovered=new PilotWatch({...f.options,maximumDeep:1,restored:f.registry.export()});const state=recovered.snapshot();assert.equal(state.summary.states.ENTRY_PENDING,3);assert.equal(state.summary.deepActive,0);assert.ok(state.rows.every(r=>r.deepSince===null));
});

test('saturated origin retries persist signature-specific five then fifteen minute deferrals across restart',()=>{
  const f=fixture();const signature='saturated-origin';const reason='PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN';
  f.registry.discover({signature,feedMint:'provisional-mint',receivedAt:f.now()});
  const first=f.registry.deferVerification(signature,reason,f.now());assert.equal(first.state,'DEFERRED');assert.equal(first.deferUntil,f.now()+300000);assert.equal(first.mint,null);
  f.at(f.now()+300000);const restored=new PilotWatch({...f.options,restored:f.registry.export()});
  const second=restored.deferVerification(signature,reason,f.now());assert.equal(second.deferUntil,f.now()+900000);assert.equal(second.state,'DEFERRED');assert.equal(restored.snapshot().summary.structuralExclusions,0);
  assert.equal(restored.snapshot().summary.known,1);assert.equal(restored.snapshot().summary.unverified,1);
  assert.equal(f.records.filter(r=>r.kind==='pilot-watch-verification-deferred').at(-1)!.data.repeatedSaturatedOrigin,true);
});

test('a different signature for the same provisional mint does not inherit a saturated origin cooldown',()=>{
  const f=fixture();f.registry.discover({signature:'first',feedMint:'same-provisional-mint',receivedAt:f.now()});
  const first=f.registry.deferVerification('first','PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN');
  const second=f.registry.discover({signature:'second',feedMint:'same-provisional-mint',receivedAt:f.now()})!;
  assert.equal(second.deferUntil,0);assert.equal(second.state,'DISCOVERED');assert.equal(first.deferUntil,f.now()+300000);
  const verified=f.registry.verify('second',{mint:'actual-base-mint',pool:'canonical-pool',migrationAt:f.now()-300000,verifiedAt:f.now()});
  assert.equal(verified.state,'WATCH');assert.equal(f.registry.next(f.now(),new Set())!.signature,'second');
});

test('ordinary verification retry remains one minute and cannot shorten an outstanding saturated deferral',()=>{
  const f=fixture();f.registry.discover({signature:'ordinary',receivedAt:f.now()});
  const first=f.registry.deferVerification('ordinary','PILOT_MIGRATION_FINALIZED_CREATION_UNAVAILABLE');assert.equal(first.deferUntil,f.now()+60000);
  f.at(f.now()+60000);assert.equal(f.registry.deferVerification('ordinary','PILOT_MIGRATION_FINALIZED_CREATION_UNAVAILABLE').deferUntil,f.now()+60000);
  const saturated=f.registry.deferVerification('ordinary','PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN');assert.equal(saturated.deferUntil,f.now()+300000);
  f.at(f.now()+1);assert.equal(f.registry.deferVerification('ordinary','temporary upstream failure').deferUntil,saturated.deferUntil);
});

test('verification deferral cannot revive terminal identities, demote verified exposure, or invent unknown identities',()=>{
  const f=fixture();f.registry.discover({signature:'unsupported',receivedAt:f.now()});f.registry.transition('unsupported','PERMANENTLY_UNSUPPORTED','verified structural exclusion');
  f.registry.discover({signature:'expired',receivedAt:f.now()});f.registry.transition('expired','EXPIRED','retention ended');
  for(const signature of ['unsupported','expired']){const before=f.registry.snapshot().rows.find(r=>r.signature===signature)!;assert.deepEqual(f.registry.deferVerification(signature,'temporary failure'),before);}
  f.seed('held');f.registry.transition('mint-held','HELD','owned exposure');const held=f.registry.snapshot().rows.find(r=>r.signature==='signature-held')!;
  assert.deepEqual(f.registry.deferVerification('signature-held','temporary failure'),held);
  assert.throws(()=>f.registry.deferVerification('unknown','temporary failure'),/UNKNOWN_IDENTITY/);
});

test('rebroadcast discovery and unverified activity cannot clear persisted verification backoff',()=>{
  const f=fixture();const signature='saturated';f.registry.discover({signature,feedMint:'hint',receivedAt:f.now()});const deferred=f.registry.deferVerification(signature,'PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN');
  f.at(f.now()+1);const duplicate=f.registry.discover({signature,feedMint:'hint',receivedAt:f.now()})!;
  assert.equal(duplicate.deferUntil,deferred.deferUntil);assert.equal(f.registry.noteActivity(signature,f.now(),'untrusted hint only'),false);
  assert.equal(f.registry.snapshot().rows.find(r=>r.signature===signature)!.deferUntil,deferred.deferUntil);
});


const demand=(at:number,requests:number,complete=true):CapacityDemand=>({requests,windowMs:10000,observedAt:at,complete,source:'confirmed-pool-signatures'});
const capacity=(at:number,freeEnrichmentStarts=8):CapacityProbeContext=>({at,capacityObservedAt:at,windowMs:10000,freeEnrichmentStarts,freeSharedStarts:20,globalCooldownUntil:0,protectionPending:false});

test('17/18hint bursts remain capacity-unavailable but permit a bounded cheap activity reassessment',()=>{
 for(const count of [17,18]){const f=fixture();f.seed('busy');f.registry.transition('mint-busy','DEEP_OBSERVATION','fresh flow');const deferred=f.registry.deferCapacity('mint-busy','required enrichment cannot fit current method capacity',demand(f.now(),count));
  assert.equal(deferred.capacityCoverage!.status,'AWAITING_CAPACITY');assert.equal(deferred.state,'DEFERRED');assert.equal(deferred.completeWindows,0);assert.equal(f.registry.next(f.now()+600000,new Set()),null,'timer alone never readmits an incomplete busy scope');
  f.at(f.now()+5000);const probe=f.registry.reassessCapacity(capacity(f.now()))!;assert.equal(probe.kind,'activity-feasibility-probe');assert.equal(probe.estimatedEnrichmentStarts,count);assert.equal(probe.row.capacityCoverage!.status,'AWAITING_CAPACITY');assert.equal(f.registry.snapshot().summary.queued,0);assert.equal(f.registry.snapshot().summary.capacityAwaiting,1);assert.equal(f.registry.next(f.now(),new Set()),null);
  assert.equal(f.records.filter(r=>r.kind==='pilot-watch-capacity-reassessment').at(-1)!.data.requestStarted,false);
 }
});

test('new observed capacity can reconsider a busy identity after five seconds rather than a fixed ten-minute abandonment',()=>{
 const f=fixture();f.seed('capacity-growth');f.registry.transition('mint-capacity-growth','DEEP_OBSERVATION','first');f.registry.transition('mint-capacity-growth','DEFERRED','old fixed capacity backoff',f.now(),{deferUntil:f.now()+600000});
 f.registry.deferCapacity('mint-capacity-growth','measured enrichment capacity loss',demand(f.now(),17));f.at(f.now()+5000);const reconsidered=f.registry.reassessCapacity(capacity(f.now(),18))!;
 assert.equal(reconsidered.kind,'deep-readmission-ready');assert.equal(reconsidered.row.deferUntil,f.now());assert.equal(reconsidered.row.capacityCoverage!.status,'PROBE_READY');assert.equal(reconsidered.row.completeWindows,0);assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-capacity-growth');
 f.registry.transition('mint-capacity-growth','DEEP_OBSERVATION','fresh support and new flow required');assert.equal(f.registry.snapshot().rows[0]!.capacityCoverage!.status,'OBSERVING');assert.equal(f.records.filter(r=>r.kind==='pilot-watch-promotion').at(-1)!.data.freshFullWindowRequired,true);
 f.at(f.now()+60000);f.registry.noteWindow('mint-capacity-growth',f.now());assert.equal(f.registry.snapshot().rows[0]!.capacityCoverage!.status,'VALID_WINDOW');
});

test('a cheap current complete demand sample can release an old overloaded estimate without fabricating a window',()=>{
 const f=fixture();f.seed('changing');f.registry.deferCapacity('mint-changing','capacity loss',demand(f.now(),18));f.at(f.now()+5000);assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.kind,'activity-feasibility-probe');
 f.at(f.now()+100);f.registry.recordCapacityDemand('mint-changing',demand(f.now(),3));assert.equal(f.registry.next(f.now(),new Set()),null);assert.equal(f.registry.snapshot().rows[0]!.capacityCoverage!.status,'AWAITING_CAPACITY');
 f.at(f.now()+4900);assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.kind,'deep-readmission-ready');assert.equal(f.registry.snapshot().rows[0]!.everHadWindow,false);
});

test('stale or incomplete demand never authorizes deep allocation, and an activity hint cannot clear the gate',()=>{
 const f=fixture();f.seed('stale');f.registry.deferCapacity('mint-stale','capacity loss',demand(f.now()-31000,1));f.at(f.now()+5000);const before=f.registry.snapshot().rows[0]!.deferUntil;
 f.registry.noteActivity('mint-stale',f.now(),'unverified broad-feed hint only');assert.equal(f.registry.snapshot().rows[0]!.deferUntil,before);assert.equal(f.registry.next(f.now(),new Set()),null);assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.kind,'activity-feasibility-probe');
 assert.equal(capacityProbePolicy(demand(f.now(),1,false),capacity(f.now())).kind,'activity-feasibility-probe');assert.equal(capacityProbePolicy(null,capacity(f.now())).kind,'activity-feasibility-probe');
});

test('shared provider cooldown, protection, occupied capacity and stale capacity evidence block every reassessment',()=>{
 for(const change of [{globalCooldownUntil:10000000},{protectionPending:true},{freeSharedStarts:0},{capacityObservedAt:1}]){const f=fixture();f.seed('blocked');f.registry.deferCapacity('mint-blocked','capacity loss',demand(f.now(),1));f.at(f.now()+5000);assert.equal(f.registry.reassessCapacity({...capacity(f.now()),...change}),null);assert.equal(f.registry.snapshot().rows[0]!.capacityCoverage!.probeAdmissions.length,0);}
});

test('simultaneous busy scopes get bounded global probe service and fresh candidates beat a probe-ready revisit',()=>{
 const f=fixture();for(const id of ['a','b','c']){f.seed(id);f.registry.deferCapacity('mint-'+id,'capacity loss',demand(f.now(),18));}f.at(f.now()+5000);
 assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.row.mint,'mint-a');assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.row.mint,'mint-b');assert.equal(f.registry.reassessCapacity(capacity(f.now())),null,'global two admissions/ten seconds');
 f.at(f.now()+10000);assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.row.mint,'mint-c','least recently probed peer receives the next service opportunity');
 const g=fixture();g.seed('revisit');g.registry.transition('mint-revisit','DEEP_OBSERVATION','earlier');g.registry.deferCapacity('mint-revisit','capacity loss',demand(g.now(),2));g.at(g.now()+5000);g.registry.reassessCapacity(capacity(g.now()));g.seed('fresh');assert.equal(g.registry.next(g.now(),new Set())!.mint,'mint-fresh');assert.equal(g.registry.next(g.now(),new Set(['mint-fresh']))!.mint,'mint-revisit');
});

test('repetitive overload cannot hot-loop, and restart preserves pending reassessment and probe budget',()=>{
 const f=fixture();f.seed('repeat');f.registry.deferCapacity('mint-repeat','capacity loss',demand(f.now(),18));f.at(f.now()+5000);f.registry.reassessCapacity(capacity(f.now()));assert.equal(f.registry.reassessCapacity(capacity(f.now())),null);
 f.at(f.now()+5000);f.registry.reassessCapacity(capacity(f.now()));const state=f.registry.export(),resumed=new PilotWatch({...f.options,restored:state});f.at(f.now()+5000);assert.equal(resumed.reassessCapacity(capacity(f.now())),null,'per-pool two probe admissions per minute persist');assert.equal(resumed.next(f.now(),new Set()),null);
 f.at(1065000);assert.equal(resumed.reassessCapacity(capacity(f.now()))!.kind,'activity-feasibility-probe','old high demand gets a bounded new sample after budget recovery');
});

test('weak predictive rejections and provider outages are not reclassified as capacity shortages',()=>{
 const f=fixture();f.seed('weak');f.seed('provider');f.registry.transition('mint-weak','DEFERRED','valid-window-predictive-assessment-failed',f.now(),{deferUntil:f.now()+60000});f.registry.transition('mint-provider','DEFERRED','HTTP429 provider cooldown',f.now(),{deferUntil:f.now()+65000});f.at(f.now()+5000);
 assert.equal(f.registry.reassessCapacity(capacity(f.now())),null);assert.ok(f.registry.snapshot().rows.every(r=>r.capacityCoverage===undefined));assert.equal(f.registry.next(f.now(),new Set()),null);
 f.seed('prior-capacity');f.registry.deferCapacity('mint-prior-capacity','capacity loss',demand(f.now(),18));f.registry.transition('mint-prior-capacity','DEFERRED','HTTP503 provider failure',f.now(),{deferUntil:f.now()+65000});assert.equal(f.registry.snapshot().rows.find(r=>r.mint==='mint-prior-capacity')!.capacityCoverage!.status,'OTHER_UNAVAILABLE');assert.equal(f.registry.reassessCapacity(capacity(f.now()+5000)),null);
});

test('capacity metadata is optional for old checkpoints and rejects impossible new evidence without touching obligations',()=>{
 const f=fixture();f.seed('a');f.seed('held');f.registry.transition('mint-held','HELD','existing ledger exposure');assert.throws(()=>f.registry.deferCapacity('mint-held','capacity loss',demand(f.now(),18)),/PROTECTED_IDENTITY/);assert.equal(new PilotWatch({...f.options,restored:f.registry.export()}).snapshot().summary.known,2);
 f.registry.deferCapacity('mint-a','capacity loss',demand(f.now(),18));const state=f.registry.export();state.rows.find(r=>r.mint==='mint-a')!.capacityCoverage!.probeAdmissions=[f.now(),f.now()];assert.throws(()=>new PilotWatch({...f.options,restored:state}),/CHECKPOINT_CAPACITY/);
 assert.throws(()=>f.registry.recordCapacityDemand('mint-a',demand(f.now()-1,1)),/DEMAND_REGRESSION/);
});


test('an expired or terminal probe-ready identity cannot starve another capacity reassessment',()=>{
 const f=fixture();f.at(10000000);f.seed('nearly-expired',f.now()-7194000);f.registry.deferCapacity('mint-nearly-expired','capacity loss',demand(f.now(),1));f.at(f.now()+5000);assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.kind,'deep-readmission-ready');
 f.at(f.now()+1000);f.seed('still-eligible');f.registry.deferCapacity('mint-still-eligible','capacity loss',demand(f.now(),1));f.at(f.now()+5000);assert.equal(f.registry.snapshot().rows.find(r=>r.mint==='mint-nearly-expired')!.state,'EXPIRED');assert.equal(f.registry.reassessCapacity(capacity(f.now()))!.row.mint,'mint-still-eligible');
 const g=fixture();g.seed('terminal');g.registry.deferCapacity('mint-terminal','capacity loss',demand(g.now(),1));g.at(g.now()+5000);g.registry.reassessCapacity(capacity(g.now()));g.registry.transition('mint-terminal','PERMANENTLY_UNSUPPORTED','new structural evidence');g.seed('other');g.registry.deferCapacity('mint-other','capacity loss',demand(g.now(),1));g.at(g.now()+5000);assert.equal(g.registry.reassessCapacity(capacity(g.now()))!.row.mint,'mint-other');
});

test('awaiting capacity requires an explicit probe gate and future demand cannot authorize a request',()=>{
 const f=fixture();f.seed('blocked');f.registry.deferCapacity('mint-blocked','capacity loss',demand(f.now(),1));assert.throws(()=>f.registry.transition('mint-blocked','DEEP_OBSERVATION','skip resource reassessment'),/CAPACITY_PROBE_REQUIRED/);
 assert.equal(capacityProbePolicy(demand(f.now()+1,1),capacity(f.now())).kind,'awaiting-capacity');
});


test('watch eviction and restart cannot refund the global two-probe ten-second budget',()=>{
 const f=fixture(2,1);for(const id of ['a','b']){f.seed(id);f.registry.deferCapacity('mint-'+id,'capacity loss',demand(f.now(),18));}f.at(f.now()+5000);const firstAt=f.now();f.registry.reassessCapacity(capacity(f.now()));f.registry.reassessCapacity(capacity(f.now()));
 f.at(f.now()+1);f.seed('c');f.registry.deferCapacity('mint-c','capacity loss',demand(f.now(),18));assert.equal(f.registry.snapshot().rows.some(r=>r.mint==='mint-a'),false);
 f.at(f.now()+5000);assert.equal(f.registry.reassessCapacity(capacity(f.now())),null,'third probe within5001ms remains blocked after eviction');
 const checkpoint=f.registry.export();assert.deepEqual(checkpoint.capacityProbeAdmissions,[{mint:'mint-a',at:firstAt},{mint:'mint-b',at:firstAt}]);const restored=new PilotWatch({...f.options,restored:checkpoint});assert.equal(restored.reassessCapacity(capacity(f.now())),null,'restart preserves global budget independently of retained identities');
 f.at(firstAt+10000);assert.equal(restored.reassessCapacity(capacity(f.now()))!.row.mint,'mint-c');
 const malformed=structuredClone(checkpoint);malformed.capacityProbeAdmissions=[{mint:'mint-a',at:firstAt},{mint:'mint-b',at:firstAt-1}];assert.throws(()=>new PilotWatch({...f.options,restored:malformed}),/CHECKPOINT_GLOBAL_CAPACITY/);
});


test('eviction and reintroduction of the same pool cannot refund its two-admission minute budget',()=>{
 const f=fixture(2,1),origin=f.now()-300000;for(const id of ['a','b']){f.seed(id,origin);f.registry.deferCapacity('mint-'+id,'capacity loss',demand(f.now(),18));}f.at(f.now()+5000);const firstAt=f.now();f.registry.reassessCapacity(capacity(f.now()));f.registry.reassessCapacity(capacity(f.now()));
 f.at(f.now()+1);f.seed('c',origin);f.registry.deferCapacity('mint-c','capacity loss',demand(f.now(),18));f.at(f.now()+1);f.seed('a',origin);f.registry.deferCapacity('mint-a','capacity loss',demand(f.now(),18));
 f.at(firstAt+10000);const served=[f.registry.reassessCapacity(capacity(f.now()))!.row.mint,f.registry.reassessCapacity(capacity(f.now()))!.row.mint];assert.deepEqual(new Set(served),new Set(['mint-a','mint-c']));
 f.at(f.now()+1);f.seed('d',origin);f.at(f.now()+1);f.seed('e',origin);assert.equal(f.registry.snapshot().rows.some(r=>r.mint==='mint-a'),false);f.at(f.now()+1);f.seed('a',origin);f.registry.deferCapacity('mint-a','capacity loss',demand(f.now(),18));f.at(firstAt+20000);
 assert.equal(f.registry.reassessCapacity(capacity(f.now())),null,'same pool retains two recent admissions after its row was evicted');
 const restored=new PilotWatch({...f.options,restored:f.registry.export()});assert.equal(restored.reassessCapacity(capacity(f.now())),null);
 f.at(firstAt+60000);assert.equal(restored.reassessCapacity(capacity(f.now()))!.row.mint,'mint-a');
});


// Actual immutable choice timestamps/identities from pilot-20261028001353575-91ed5596.
// This isolates allocation on unchanged recorded states, not a rescheduled market
// or additional valid windows. Events SHA256a7f9467636b2ef9ecbd4ed224805a2f4c77e7ea43973d47d0630c4ad112aa3db.
// A final lastHintAt later than a choice cannot reveal its earlier hints; those
// two cases are tested under explicitly different information assumptions.
const recordedWeakBacklogChoices=[{"at":1793146994316,"promotedBefore":266,"weakMint":"EBd37wFkN8FFZYbrMae2aDW4KZ55a3Ftwhit3A61pump","weakPool":"7cDCmTb7hVTeqFi8nuJ1bfVR7gJr7UxCwBVHv6b45zMQ","weakMigrationAt":1793140773000,"weakVerifiedAt":1793140809952,"weakFirstSeenAt":1793140773827,"demotedAt":1793146505167,"lastHintAt":1793142773992,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147007542,"promotedBefore":267,"weakMint":"Qy3SbSUeVETiMeAJQQzweNVfEwJ2cguYWX6bNvhpump","weakPool":"C9PHUyd5Cqgr98KNtDagrekRRutjj8zivjqwCpHMGLSL","weakMigrationAt":1793140891000,"weakVerifiedAt":1793140927535,"weakFirstSeenAt":1793140892154,"demotedAt":1793146525092,"lastHintAt":1793146932556,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147018087,"promotedBefore":268,"weakMint":"C6xGUfFBsqzp85JoWGXto4fH3wmfWjxxHqkNyxtzpump","weakPool":"Hz3zHRcwAVxdXthXrrvfVhj6CsheNKmb4X92mcAjQcFp","weakMigrationAt":1793142327000,"weakVerifiedAt":1793142363211,"weakFirstSeenAt":1793142327864,"demotedAt":1793146535147,"lastHintAt":1793147042405,"hintHistoryUnavailable":true,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147054359,"promotedBefore":269,"weakMint":"BPQxuEe5JgosnmyEKfVysjXirshZJJaAvNJHEiznpump","weakPool":"7fC9dqv1GrNQSS3hAeeYqKMmRAu7iRW82zaG6KFKWKJR","weakMigrationAt":1793145242000,"weakVerifiedAt":1793145278276,"weakFirstSeenAt":1793145242922,"demotedAt":1793146575129,"lastHintAt":1793145480618,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147078912,"promotedBefore":271,"weakMint":"71uyNgZn5KdutEHrnnX1Eo6bBgZXKB9rDsfwzVGbpump","weakPool":"95VVCHV1WWQuGmACj7yo8zXugh4r24vusSCnKrN81Z8y","weakMigrationAt":1793140860000,"weakVerifiedAt":1793140895806,"weakFirstSeenAt":1793140860457,"demotedAt":1793146585123,"lastHintAt":1793142646534,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147117542,"promotedBefore":273,"weakMint":"DFPbbGFF8G4HXNqyMGSyvyW7o5ATRP2r7Aqw7yp4pump","weakPool":"3CkmnT3roNPejvgGQeEfM94Tsr9e9DytkL3V9FLDygMP","weakMigrationAt":1793145279000,"weakVerifiedAt":1793145319297,"weakFirstSeenAt":1793145279658,"demotedAt":1793146595131,"lastHintAt":1793145499422,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147139719,"promotedBefore":275,"weakMint":"DjB8KGFtYFdQfq6RFVQg1vTepwwAXTvRX57hcq7xpump","weakPool":"EQG1EuoQjVSJjDBrQUBoWuHcnKkjUsSCBB5JuV3AZHWc","weakMigrationAt":1793145349000,"weakVerifiedAt":1793145385231,"weakFirstSeenAt":1793145349841,"demotedAt":1793146705097,"lastHintAt":1793145558272,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147152996,"promotedBefore":276,"weakMint":"Qur3Q8N2BbU2eD299hdmPRcPquozuAidMiWPke4pump","weakPool":"C8L4vwP3ytSvNYnsvJwbBQothiU2bacKKknSvfJTpUZ1","weakMigrationAt":1793142408000,"weakVerifiedAt":1793142443915,"weakFirstSeenAt":1793142408509,"demotedAt":1793146715130,"lastHintAt":1793145293764,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147156159,"promotedBefore":277,"weakMint":"F8wvZ5HLxfsvTCz7z6um2T5kyaLkBDUFqXGrqQzupump","weakPool":"7uVHaZ76yoM2sFPxy7DsMCuFs1CxcYaDQnYiHEYK9YvR","weakMigrationAt":1793141001000,"weakVerifiedAt":1793141036772,"weakFirstSeenAt":1793141001352,"demotedAt":1793146725204,"lastHintAt":1793147255467,"hintHistoryUnavailable":true,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147177587,"promotedBefore":278,"weakMint":"yfkGEuzcaxp5mKs5PjzivBV43vxUW4BjWeC3rWxpump","weakPool":"AUhxf5d5y8U11BsAKXSsVCMbUeGceEyT4Dn7CnfANqr2","weakMigrationAt":1793142478000,"weakVerifiedAt":1793142517609,"weakFirstSeenAt":1793142478844,"demotedAt":1793146735422,"lastHintAt":1793142924651,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147187859,"promotedBefore":279,"weakMint":"8ToPTJcW57WqXPGpuDcQXwQZGbBUJqyAVrdUqvjpump","weakPool":"FuBh4MMeHxFVzrJvhxqRPyrhExTdFW6jA3EGaM6qqjDZ","weakMigrationAt":1793142544000,"weakVerifiedAt":1793142579996,"weakFirstSeenAt":1793142544655,"demotedAt":1793146735429,"lastHintAt":1793146661486,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147196103,"promotedBefore":280,"weakMint":"77jPexT8QfBzyMZn19QVoY51emMgEaKpu3EskKPbpump","weakPool":"B1zaeuauG2PKfXDC81CBqMV5mh7CR4yGMBbSeAjrfLss","weakMigrationAt":1793145411000,"weakVerifiedAt":1793145447226,"weakFirstSeenAt":1793145411879,"demotedAt":1793146745205,"lastHintAt":1793145597121,"hintHistoryUnavailable":false,"freshMint":"Ra2cNmSnk9NLGdWwdLaCcLfdzZSrFTh8gEvQUwGpump","freshPool":"89uo6YCUZjJNU1NeEmfWnUXBBGMvqf8oZMDBxebGLYio","freshMigrationAt":1793146600000,"freshVerifiedAt":1793146636513,"freshFirstSeenAt":1793146601152},{"at":1793147238122,"promotedBefore":283,"weakMint":"5SE1hA8a819e8wiEJaRqHch5tajuy9ERdCotDwyxpump","weakPool":"8gjUcVGFnyX7ui1xaT6EHjTcJQd6NQiRqvYHDRd5N86d","weakMigrationAt":1793141065000,"weakVerifiedAt":1793141101016,"weakFirstSeenAt":1793141065680,"demotedAt":1793146775142,"lastHintAt":1793145429944,"hintHistoryUnavailable":false,"freshMint":"7v2Z7oLSTWDsRwEXs5NK72rXYRwWktHUGzmgtMT1pump","freshPool":"6dQdzjxAvhA4mQnwpxxpKcDG9Sdx5Hd3Q16C3paptSX1","freshMigrationAt":1793146668000,"freshVerifiedAt":1793146703662,"freshFirstSeenAt":1793146668250},{"at":1793147248170,"promotedBefore":284,"weakMint":"3fajJhhDirSDMg9ddqVA69K96rjQKA6iqffD1y5Lpump","weakPool":"CLUXe7pKLMydHwpPUZqZzUDXdNKd1aLXrtW7JS4nBa2A","weakMigrationAt":1793141103000,"weakVerifiedAt":1793141201356,"weakFirstSeenAt":1793141103756,"demotedAt":1793146785127,"lastHintAt":1793147002535,"hintHistoryUnavailable":false,"freshMint":"7v2Z7oLSTWDsRwEXs5NK72rXYRwWktHUGzmgtMT1pump","freshPool":"6dQdzjxAvhA4mQnwpxxpKcDG9Sdx5Hd3Q16C3paptSX1","freshMigrationAt":1793146668000,"freshVerifiedAt":1793146703662,"freshFirstSeenAt":1793146668250},{"at":1793147258715,"promotedBefore":285,"weakMint":"Cpf3KpLjpcvaLetYahVDRSiU8NnJS3NLApbW3UANpump","weakPool":"J7bEQbs7RnhTJaFzvTCXRrkjmd5D1EbZr5AZKbfrgesi","weakMigrationAt":1793141139000,"weakVerifiedAt":1793141175336,"weakFirstSeenAt":1793141139980,"demotedAt":1793146795152,"lastHintAt":1793141410476,"hintHistoryUnavailable":false,"freshMint":"7v2Z7oLSTWDsRwEXs5NK72rXYRwWktHUGzmgtMT1pump","freshPool":"6dQdzjxAvhA4mQnwpxxpKcDG9Sdx5Hd3Q16C3paptSX1","freshMigrationAt":1793146668000,"freshVerifiedAt":1793146703662,"freshFirstSeenAt":1793146668250},{"at":1793147268747,"promotedBefore":286,"weakMint":"nyHJiwvXBQj9rLjAfx3kuhmHczrfw33dwXCK79spump","weakPool":"GP4ttjH3CitMZCBWfgTjPqtf8WCrxCTmMswrPWYqYYuc","weakMigrationAt":1793141199000,"weakVerifiedAt":1793141235969,"weakFirstSeenAt":1793141199967,"demotedAt":1793146805909,"lastHintAt":1793142217817,"hintHistoryUnavailable":false,"freshMint":"7v2Z7oLSTWDsRwEXs5NK72rXYRwWktHUGzmgtMT1pump","freshPool":"6dQdzjxAvhA4mQnwpxxpKcDG9Sdx5Hd3Q16C3paptSX1","freshMigrationAt":1793146668000,"freshVerifiedAt":1793146703662,"freshFirstSeenAt":1793146668250},{"at":1793147286653,"promotedBefore":288,"weakMint":"7GSsGcF5ARJ1p2zwzidHidVGjSQe4sEkyxYG9WNmpump","weakPool":"G5NdsJ5KkEDKGHTP9QSW93MF7vyRRSaaRNQSWnoAQDXz","weakMigrationAt":1793141203000,"weakVerifiedAt":1793141238768,"weakFirstSeenAt":1793141203420,"demotedAt":1793146817052,"lastHintAt":1793141413243,"hintHistoryUnavailable":false,"freshMint":"7KbSWyHjXhAVeEy2Q2TBa1B7Rn2S1JrdGaiSh8Nvpump","freshPool":"BTmHL8CAkLKovYVhE2E96PiK1iLwyxbsai3vi6GycCN","freshMigrationAt":1793146776000,"freshVerifiedAt":1793146811435,"freshFirstSeenAt":1793146776114},{"at":1793147306371,"promotedBefore":289,"weakMint":"H6oKevxFTnpNwsNJTKJVpDkZZ7McY1vNAKxZDGtgpump","weakPool":"6csVfXKAaXFdBHHNVmyrdeLB7VEQRCPSHW7Ej1S7wFjT","weakMigrationAt":1793141235000,"weakVerifiedAt":1793141271372,"weakFirstSeenAt":1793141236056,"demotedAt":1793146825109,"lastHintAt":1793147144003,"hintHistoryUnavailable":false,"freshMint":"7KbSWyHjXhAVeEy2Q2TBa1B7Rn2S1JrdGaiSh8Nvpump","freshPool":"BTmHL8CAkLKovYVhE2E96PiK1iLwyxbsai3vi6GycCN","freshMigrationAt":1793146776000,"freshVerifiedAt":1793146811435,"freshFirstSeenAt":1793146776114},{"at":1793147316169,"promotedBefore":290,"weakMint":"8Yxh8VkeE6kFMW7M41ViW35YYTvh5kP2Me7paAtrpump","weakPool":"8VitvnSfPCYzS2xFsCJMYcnUXYdpawNfEtFcMY5apN7j","weakMigrationAt":1793142718000,"weakVerifiedAt":1793142753696,"weakFirstSeenAt":1793142718281,"demotedAt":1793146847182,"lastHintAt":1793142919113,"hintHistoryUnavailable":false,"freshMint":"7KbSWyHjXhAVeEy2Q2TBa1B7Rn2S1JrdGaiSh8Nvpump","freshPool":"BTmHL8CAkLKovYVhE2E96PiK1iLwyxbsai3vi6GycCN","freshMigrationAt":1793146776000,"freshVerifiedAt":1793146811435,"freshFirstSeenAt":1793146776114}];
function replayRecordedAllocation(row:typeof recordedWeakBacklogChoices[number],unknownWasActive:boolean){
 const f=fixture();f.at(row.at);f.registry.discover({signature:'recorded-weak',feedMint:row.weakMint,receivedAt:row.weakFirstSeenAt});f.registry.verify('recorded-weak',{mint:row.weakMint,pool:row.weakPool,migrationAt:row.weakMigrationAt,verifiedAt:row.weakVerifiedAt});
 f.registry.discover({signature:'recorded-fresh',feedMint:row.freshMint,receivedAt:row.freshFirstSeenAt});f.registry.verify('recorded-fresh',{mint:row.freshMint,pool:row.freshPool,migrationAt:row.freshMigrationAt,verifiedAt:row.freshVerifiedAt});
 const checkpoint=f.registry.export(),weak=checkpoint.rows.find(r=>r.mint===row.weakMint)!;Object.assign(weak,{state:'DEFERRED',reason:'valid-window-predictive-assessment-failed',promotions:1,lastDemotedAt:row.demotedAt,waitingSince:row.demotedAt,deferUntil:row.demotedAt+60000,lastActivityAt:row.hintHistoryUnavailable?(unknownWasActive?row.at-1:null):row.lastHintAt});checkpoint.counters.promoted=row.promotedBefore;
 return new PilotWatch({...f.options,restored:checkpoint}).next(row.at,new Set())!.mint;
}

test('recorded nineteen weak/backlog choices favor fresh coverage at thirteen-to-fourteen matched states without claiming new windows',()=>{
 let provenInactive=0,changedIfUnknownInactive=0,changedIfUnknownActive=0;const freshTokens=new Set<string>();
 for(const row of recordedWeakBacklogChoices){if(!row.hintHistoryUnavailable){provenInactive++;assert.ok(row.lastHintAt===null||row.lastHintAt<=row.demotedAt||row.at-row.lastHintAt>60000);}
  const low=replayRecordedAllocation(row,false),high=replayRecordedAllocation(row,true);if(low===row.freshMint){changedIfUnknownInactive++;freshTokens.add(low);}if(high===row.freshMint)changedIfUnknownActive++;
  const fair=row.promotedBefore%4===3;if(!row.hintHistoryUnavailable)assert.equal(low,fair?row.weakMint:row.freshMint);
 }
 assert.equal(provenInactive,17);assert.equal(changedIfUnknownInactive,14);assert.equal(changedIfUnknownActive,13);assert.ok(freshTokens.size<changedIfUnknownInactive,'repeated matched choices are not additional unique candidate evaluations');
});

test('continuous fresh work leaves exactly one inactive revisit in four promotions, including after restart',()=>{
 const f=fixture(150,1);f.seed('quiet-old');f.registry.transition('mint-quiet-old','DEEP_OBSERVATION','earlier observed weak');f.registry.noteWindow('mint-quiet-old',f.now());f.registry.transition('mint-quiet-old','DEFERRED','valid-window-predictive-assessment-failed');
 let registry=f.registry;const chosen:string[]=[];let freshSelections=0,inactiveSelections=0;
 for(let i=0;i<12;i++){f.at(f.now()+70000);const id='fresh-'+i;registry.discover({signature:'signature-'+id,feedMint:'hint-'+id,receivedAt:f.now()});registry.verify('signature-'+id,{mint:'mint-'+id,pool:'pool-'+id,migrationAt:f.now()-300000,verifiedAt:f.now()});const pick=registry.next(f.now(),new Set())!;chosen.push(pick.mint!);if(pick.promotions===0)freshSelections++;else inactiveSelections++;registry.transition(pick.mint!,'DEEP_OBSERVATION','counterfactual fair allocation');registry.transition(pick.mint!,'DEFERRED','valid-window-predictive-assessment-failed',f.now(),{deferUntil:f.now()+60000});if(i===5)registry=new PilotWatch({...f.options,restored:registry.export()});}
 assert.equal(chosen.filter(mint=>mint==='mint-quiet-old'||!mint.startsWith('mint-fresh-')).length,1,'specific oldest revisit gets bounded service; other inactive revisits share later fair turns');
 assert.equal(freshSelections,9);assert.equal(inactiveSelections,3,'inactive revisits consume exactly the three fair phases when fresh identities continuously wait');
});

test('recent post-demotion activity can preempt quiet new candidates but stale activity cannot monopolize their fair turns',()=>{
 const f=fixture(150,1);f.seed('developing');f.registry.transition('mint-developing','DEEP_OBSERVATION','first');f.registry.transition('mint-developing','DEFERRED','valid-window-predictive-assessment-failed');f.at(f.now()+1);f.registry.noteActivity('mint-developing',f.now(),'unverified new activity allocation hint');f.seed('fresh');
 assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-fresh','fresh phase is preserved even against renewed hints');f.registry.transition('mint-fresh','DEEP_OBSERVATION','fresh guaranteed turn');f.registry.transition('mint-fresh','DEFERRED','valid-window-predictive-assessment-failed',f.now(),{deferUntil:f.now()+60000});
 assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-developing','new activity receives priority at the next phase');f.at(f.now()+60001);f.seed('newer-fresh');assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-newer-fresh','expired hints cannot keep an inactive revisit in the active group');
 assert.ok(f.records.some(r=>r.kind==='pilot-watch-activity'&&r.data.hintOnly===true));
});


test('all three continuously ready groups receive the declared durable four-promotion service shares',()=>{
 const f=fixture(150,1);for(const id of ['active','quiet']){f.seed(id);f.registry.transition('mint-'+id,'DEEP_OBSERVATION','earlier observation');f.registry.transition('mint-'+id,'DEFERRED','valid-window-predictive-assessment-failed');}
 const selected:string[]=[];
 for(let i=0;i<4;i++){f.at(f.now()+70000);f.registry.noteActivity('mint-active',f.now(),'new unverified scheduling hint after demotion');f.seed('fresh-'+i);const pick=f.registry.next(f.now(),new Set())!;selected.push(pick.promotions===0?'fresh':pick.mint==='mint-active'?'active':'inactive');f.registry.transition(pick.mint!,'DEEP_OBSERVATION','new complete flow collection required');f.registry.transition(pick.mint!,'DEFERRED','valid-window-predictive-assessment-failed');}
 assert.deepEqual(selected,['active','inactive','active','fresh']);
});
