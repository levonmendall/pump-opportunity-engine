import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PilotWatch} from '../src/pilot-watch.js';

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
  f.at(f.now()+30000);assert.equal(f.registry.next(f.now(),new Set())!.mint,'mint-a');
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
  const f=fixture();f.seed('new',f.now());f.seed('revisit');f.registry.transition('mint-revisit','DEEP_OBSERVATION','first valid observation');f.at(1270000);f.registry.transition('mint-revisit','DEFERRED','valid weak observation',f.now(),{deferUntil:1300000});f.at(1299000);f.registry.noteActivity('mint-revisit',f.now(),'new provider hint after demotion; re-observation only');f.at(1300000);
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
