import {test} from 'node:test';
import assert from 'node:assert/strict';
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
