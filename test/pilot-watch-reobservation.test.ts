import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

function fixture(){
 let at=1000000000;const registry=new MarketRegistry(':memory:',{now:()=>at}),records:Array<{kind:string;data:any}>=[],options={registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:(kind:string,data:unknown)=>records.push({kind,data})},watch=new PilotWatch(options);
 const seed=(mint:string)=>{watch.discover({signature:'origin-'+mint,feedMint:mint,receivedAt:at});watch.verify('origin-'+mint,{mint,pool:'pool-'+mint,migrationAt:at-300000,verifiedAt:at});registry.putOrigin(mint,{mint});};
 const activity=(mint:string,signature:string,side:'buy'|'sell'|'unknown',quoteLamports?:string,price?:number)=>{registry.observeActivity({mint,signature,source:'shared-test',at,...(side==='unknown'?{}:{side}),...(quoteLamports?{quoteLamports}:{}),...(price?{price}:{})});watch.noteActivity(mint,at,'shared-test:'+signature);};
 const negative=(mint:string,kind:'economic-rejection'|'technical-unavailable'='economic-rejection')=>{watch.noteEvaluation(mint,{kind,windowEndAt:at-1000,evidence:'audited decision '+at,minimumEconomicChangeLamports:'10000'},at);watch.transition(mint,'DEFERRED','completed decision; awaits relevant change',at,{deferUntil:at+30000});};
 return {registry,watch,options,records,seed,activity,negative,now:()=>at,advance:(ms=1)=>{at+=ms;}};
}

test('completed negative economics leaves durable awareness but does not repeatedly consume a deep slot without new relevant economics',()=>{
 const f=fixture();try{
  f.seed('negative');f.activity('negative','before','buy','1000000000');f.watch.transition('negative','DEEP_OBSERVATION','fresh verified observation');f.negative('negative');f.advance(30000);
  assert.equal(f.watch.next(f.now(),new Set(),{requireOrigin:true}),null);assert.throws(()=>f.watch.transition('negative','DEEP_OBSERVATION','unchanged repeated attempt'),/NEW_RELEVANT_EVIDENCE_REQUIRED/);
  f.seed('fresh');assert.equal(f.watch.next(f.now(),new Set(),{requireOrigin:true})!.mint,'fresh');assert.equal(f.watch.lookupIdentity('negative')!.state,'DEFERRED');
  assert.equal((f.watch.snapshot(f.now(),'liquidity-resilient-momentum-v3.1').summary as any).reobservation.awaitingEconomicChange,1);
  assert.equal(f.watch.snapshot(f.now(),'liquidity-resilient-momentum-v3.1').summary.deepActive,0);
 }finally{f.registry.close();}
});

test('unknown/replayed hints, timestamp changes and sub-friction dust do not reset a completed negative decision; meaningful selling can reopen absorption research',()=>{
 const f=fixture();try{
  f.seed('token');f.activity('token','original','buy','1000000000');f.negative('token');f.advance(30000);
  f.activity('token','unknown','unknown');f.activity('token','original','buy','1000000000');f.activity('token','price-hint','unknown',undefined,123);assert.equal(f.watch.next(f.now(),new Set()),null);
  f.activity('token','dust','buy','1');assert.equal(f.watch.next(f.now(),new Set()),null);
  f.activity('token','new-seller','sell','10000');assert.equal(f.watch.next(f.now(),new Set())!.mint,'token');
  const row=f.watch.lookupIdentity('token')!;assert.equal(row.reobservation!.minimumEconomicChangeLamports,'10000');assert.match(row.reobservation!.ready!.reason,/quoted round-trip/);
  assert.equal(row.completeWindows,0,'shared hints do not fabricate a fresh audited window');
 }finally{f.registry.close();}
});

test('new verified pool content reopens an opportunity even without positive buying; duplicate content cannot renew the next failed decision',()=>{
 const f=fixture();try{
  f.seed('token');f.negative('token');f.advance(30000);
  assert.equal(f.watch.noteRelevantEvidence('token',{kind:'pool-reserves',at:f.now(),fingerprint:'rawQuote=5000000000;base=4000000'},f.now()),true);
  assert.equal(f.watch.next(f.now(),new Set())!.mint,'token');f.negative('token');f.advance(30000);
  assert.equal(f.watch.noteRelevantEvidence('token',{kind:'pool-reserves',at:f.now(),fingerprint:'rawQuote=5000000000;base=4000000'},f.now()),false);
  assert.equal(f.watch.next(f.now(),new Set()),null);
  assert.equal(f.watch.noteRelevantEvidence('token',{kind:'source-recovery',at:f.now(),fingerprint:'connection-generation-2'},f.now()),false,'connection churn does not overturn negative economics');
  assert.equal(f.watch.noteRelevantEvidence('token',{kind:'liquidity',at:f.now(),fingerprint:'realQuote=7000000000;base=4000000'},f.now()),true);
 }finally{f.registry.close();}
});

test('technical unavailability remains distinct from economic rejection and requires measurable source progress across restart',()=>{
 const f=fixture();try{
  f.seed('technical');f.negative('technical','technical-unavailable');f.advance(30000);f.activity('technical','unknown','unknown');assert.equal(f.watch.next(f.now(),new Set()),null);
  const resumed=new PilotWatch({...f.options,restored:f.watch.export()});assert.equal(resumed.next(f.now(),new Set()),null);
  assert.equal(resumed.noteRelevantEvidence('technical',{kind:'source-recovery',at:f.now(),fingerprint:'provider-success:confirmed-signature-state-2'},f.now()),true);
  assert.equal(resumed.next(f.now(),new Set())!.mint,'technical');
  assert.equal((resumed.snapshot(f.now(),'liquidity-resilient-momentum-v3.1').summary as any).reobservation.awaitingEconomicChange,0);
 }finally{f.registry.close();}
});

test('a repeated completion callback cannot overwrite newly accumulated relevant change or introduce another retry allowance',()=>{
 const f=fixture();try{
  f.seed('token');const end=f.now()-1000,evidence='same complete decision';f.watch.noteEvaluation('token',{kind:'economic-rejection',windowEndAt:end,evidence,minimumEconomicChangeLamports:'10000'},f.now());f.watch.transition('token','DEFERRED','complete',f.now());f.advance();f.activity('token','new-buy','buy','20000');
  const ready=f.watch.lookupIdentity('token')!.reobservation!.ready;assert.ok(ready);
  assert.equal(f.watch.noteEvaluation('token',{kind:'economic-rejection',windowEndAt:end,evidence,minimumEconomicChangeLamports:'10000'},f.now()),false);
  assert.deepEqual(f.watch.lookupIdentity('token')!.reobservation!.ready,ready);
 }finally{f.registry.close();}
});


test('delayed predecision economic intake cannot reopen completed economics or create an invalid ready timestamp',()=>{
 const f=fixture();try{f.seed('late');const decisionAt=f.now();f.negative('late');f.advance(30000);f.registry.observeActivity({mint:'late',signature:'received-before-decision',source:'shared-test',at:decisionAt-1000,side:'buy',quoteLamports:'1000000'});f.watch.noteActivity('late',decisionAt-1000,'late durable worker commit');assert.equal(f.watch.lookupIdentity('late')!.reobservation!.ready,null);assert.equal(f.watch.next(f.now(),new Set()),null);
  const resumed=new PilotWatch({...f.options,restored:f.watch.export()});assert.equal(resumed.next(f.now(),new Set()),null,'cold checkpoint remains valid and dormant');f.activity('late','new-postdecision-dust','buy','1');assert.equal(f.watch.next(f.now(),new Set()),null,'old notional cannot subsidize a later dust hint');f.activity('late','new-postdecision-economic','buy','10000');const ready=f.watch.lookupIdentity('late')!.reobservation!.ready!;assert.ok(ready.at>=decisionAt);assert.equal(f.watch.next(f.now(),new Set())!.mint,'late');
 }finally{f.registry.close();}
});

test('persistent pure watch projections use consistent read snapshots without writer leases',()=>{
 const f=fixture();try{f.seed('read');const before={...f.registry.health().transactions};f.watch.lookupIdentity('read');f.watch.listIdentityPage();f.watch.identitiesInStates(['WATCH']);f.watch.snapshot(f.now(),'liquidity-resilient-momentum-v3.1');f.watch.export();f.watch.serviceableBacklog(f.now());const after=f.registry.health().transactions;assert.equal(after.writeCommits,before.writeCommits);assert.equal(after.writerLeaseReadOnlyCommits,before.writerLeaseReadOnlyCommits);assert.ok(after.readSnapshotCommits>=before.readSnapshotCommits+6);f.watch.transition('read','DEEP_OBSERVATION','actual allocation remains a writer');assert.equal(f.registry.health().transactions.writeCommits,after.writeCommits+1);
 }finally{f.registry.close();}
});

test('serviceable backlog ignores archival proof availability while preserving dormant decisions and source backoff',()=>{
 const f=fixture();try{for(const mint of ['ready','no-proof','backoff','dormant'])f.seed(mint);f.registry.archiveOrigin('no-proof','fixture unavailable retained origin');f.watch.transition('backoff','DEFERRED','actual source backoff',f.now(),{deferUntil:f.now()+60000});f.negative('dormant');
  const initial=f.watch.serviceableBacklog(f.now());assert.deepEqual(initial.population,{retained:4,verifiedAwaitingPrerequisites:2,eligibleNow:2,serviceableNow:2,capacityWaiting:0,activeDeep:0});assert.equal(f.watch.serviceableBacklog(f.now(),{requireOrigin:true}).population.serviceableNow,1,'legacy callers can retain their explicit archive prerequisite');assert.equal(f.watch.allocationReadySince('no-proof',f.now(),{requireOrigin:true}),null);f.advance(60000);const due=f.watch.serviceableBacklog(f.now());assert.equal(due.population.eligibleNow,3);assert.equal(due.population.serviceableNow,3);assert.equal(f.watch.allocationReadySince('backoff',f.now()),f.now());assert.equal(f.watch.allocationReadySince('no-proof',f.now()),f.now()-60000);assert.equal(due.waits.capacityQueue.p50,60000,'the two ready scopes accrue wait while source backoff still contributes zero');assert.equal(due.waits.capacityQueue.max,60000);
  f.registry.putOrigin('no-proof',{fixture:'freshly available proof'});const fresh=f.watch.serviceableBacklog(f.now());assert.equal(fresh.population.serviceableNow,3);assert.equal(f.watch.allocationReadySince('no-proof',f.now()),f.now()-60000);assert.equal(fresh.waits.capacityQueue.mean,40000,'optional archival enrichment cannot reset actual observation waiting time');
 }finally{f.registry.close();}
});


test('serviceable shared-demand priority outranks an inactive forced cohort turn without banning later reacceleration',()=>{
 const f=fixture();try{f.seed('inactive');for(let i=0;i<3;i++){f.watch.transition('inactive','DEEP_OBSERVATION','prior complete turn');f.watch.transition('inactive','DEFERRED','ordinary waiting turn');}f.seed('new-demand');f.advance();f.activity('new-demand','new-real-capital','buy','500000000');assert.equal(f.watch.next(f.now(),new Set(),{requireOrigin:true})!.mint,'new-demand','the former phase3 inactive quota cannot outrank measured new demand');assert.equal(f.watch.next(f.now(),new Set(['new-demand']),{requireOrigin:true})!.mint,'inactive','quiet history is retained and remains selectable');f.advance();f.activity('inactive','renewed-real-capital','buy','3000000000');assert.equal(f.watch.next(f.now(),new Set(),{requireOrigin:true})!.mint,'inactive','a recurring token can regain priority from genuinely new measured demand without an age exclusion');
 }finally{f.registry.close();}
});


test('mixed old/new committed batches measure only actual postdecision economic flow',()=>{
 const f=fixture();try{f.seed('mixed');const decisionAt=f.now();f.negative('mixed');f.advance(30000);f.registry.transaction(()=>{f.registry.observeActivity({mint:'mixed',signature:'new-dust-in-mixed-batch',source:'shared-test',at:decisionAt+1000,side:'buy',quoteLamports:'1'});f.registry.observeActivity({mint:'mixed',signature:'old-big-in-mixed-batch',source:'shared-test',at:decisionAt-1000,side:'buy',quoteLamports:'1000000000'});});f.watch.noteActivity('mixed',decisionAt+1000,'mixed worker batch committed');assert.equal(f.watch.lookupIdentity('mixed')!.reobservation!.ready,null,'old volume cannot make a dust postdecision hint economically material');assert.equal(f.watch.next(f.now(),new Set()),null);
  f.activity('mixed','new-real-postdecision-flow','buy','9999');assert.equal(f.watch.next(f.now(),new Set())!.mint,'mixed');const ready=f.watch.lookupIdentity('mixed')!.reobservation!.ready!;assert.equal(ready.at,f.now(),'eligibility availability is recorded when durable information is applied, separately from network receipt time');
 }finally{f.registry.close();}
});


test('cold upgrade narrowly repairs an already persisted R10 predecision readiness flag without erasing its negative decision',()=>{
 const f=fixture(),dir=mkdtempSync(join(tmpdir(),'poe-r10-ready-upgrade-')),path=join(dir,'market.sqlite');let registry:MarketRegistry|undefined;try{
  f.seed('legacy');f.negative('legacy');const valid=f.watch.lookupIdentity('legacy')!,checkpoint=f.watch.export();registry=new MarketRegistry(path,{now:f.now});const original=new PilotWatch({...f.options,registry,restored:{...checkpoint,registry:undefined,rows:[valid]}}),durableCheckpoint=original.export(),bad=structuredClone(valid);bad.reobservation!.ready={at:bad.reobservation!.decisionAt-1000,reason:'R10 delayed commit before decision',evidence:'retained original hint'};registry.put(bad);const raw=JSON.stringify(bad);registry.close();registry=new MarketRegistry(path,{now:f.now});const resumed=new PilotWatch({...f.options,registry,restored:durableCheckpoint}),row=resumed.lookupIdentity('legacy')!;assert.equal(row.reobservation!.ready,null);assert.equal(row.reobservation!.kind,'economic-rejection');assert.equal(row.reobservation!.decisionAt,bad.reobservation!.decisionAt);assert.equal(row.reason,bad.reason);assert.equal(row.promotions,bad.promotions);assert.equal(resumed.next(f.now(),new Set()),null);const receipt=registry.getMetadata<any>('pilot-watch-predecision-ready:'+bad.signature+':'+bad.reobservation!.decisionAt+':'+bad.reobservation!.ready!.at);assert.deepEqual(receipt.originalGate,bad.reobservation);assert.equal(JSON.stringify(bad),raw,'caller historical input remains unchanged');assert.equal(receipt.financialWriterOpened,false);
  const malformed=structuredClone(bad);malformed.reobservation!.ready!.reason='bad\u0000reason';const other=new MarketRegistry(':memory:',{now:f.now});try{assert.throws(()=>new PilotWatch({...f.options,registry:other,restored:{...checkpoint,registry:undefined,rows:[malformed]}}),/PILOT_WATCH_CHECKPOINT_REOBSERVATION/);}finally{other.close();}
 }finally{registry?.close();f.registry.close();rmSync(dir,{recursive:true,force:true});}
});
