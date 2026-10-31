/** Offline scope/provenance regressions. Synthetic support proves adapter
 * ordering only; it is not real market support or a trading result. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {PublicKey} from '@solana/web3.js';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {canonicalObservationPool,nativeCurrentPoolIdentityProof,assertNativeObservationIdentity} from '../src/native-observation-identity.js';
import type {ResearchClockNativeObservationSupport} from '../src/research-clock-pricing.js';

const mint=new PublicKey(Buffer.alloc(32,137)).toBase58(),pool=canonicalObservationPool(mint);
test('unknown historical age remains null across current observation, current support and durable recovery',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-current-watch-'));let at=1_900_000_000_000,registry:MarketRegistry|undefined;
 try{
  const path=join(dir,'registry.sqlite'),make=()=>new PilotWatch({registry:registry!,maximumDeep:4,observationAgePolicy:'persistent-observable-market-v1',now:()=>at,record(){}});
  registry=new MarketRegistry(path,{now:()=>at});let watch=make();watch.observeIdentity('current-pool:'+mint,{mint,pool,availableAt:at,evidence:'OFFLINE unsigned mint hint'});
  const row=watch.next(at,new Set())!;assert.equal(row.migrationAt,null);assert.equal(row.verifiedAt,null);assert.equal(registry.hasOrigin(mint),false);
  assert.equal(watch.serviceableBacklog(at).population.serviceableNow,1);assert.equal(watch.allocationReadySince(mint,at),at);assert.equal(watch.snapshot(at,'baseline').summary.eligibleKnown,0);assert.equal(watch.snapshot(at,'liquidity-resilient-momentum-v3.1').summary.eligibleKnown,1);
  watch.transition(mint,'DEEP_OBSERVATION','OFFLINE scope allocation',at);
  const first=nativeCurrentPoolIdentityProof({mint,pool,at,sourceSlot:500,evidence:'OFFLINE accepted current accounts'} as ResearchClockNativeObservationSupport,at);watch.currentPoolValidated(first);at+=1000;
  watch.currentPoolValidated({...first,verifiedAt:at,sourceSlot:501,evidence:'OFFLINE later refresh'});assert.equal(watch.lookupIdentity(mint,at)!.observationIdentity!.currentPool!.verifiedAt,first.verifiedAt,'the first identity proof is not rewritten by a refresh');
  registry.close();registry=new MarketRegistry(path,{now:()=>at});watch=make();const recovered=watch.lookupIdentity(mint,at)!;
  assert.equal(recovered.migrationAt,null);assert.equal(recovered.verifiedAt,null);assert.equal(recovered.state,'DEFERRED');assert.equal(recovered.deepSince,null);assert.deepEqual(recovered.observationIdentity!.currentPool,first);assert.equal(watch.next(at,new Set())!.mint,mint);assert.equal(watch.serviceableBacklog(at).population.serviceableNow,1);
 }finally{registry?.close();rmSync(dir,{recursive:true,force:true});}
});

test('current pool hint cannot manufacture migration provenance or a noncanonical scope',()=>{
 const at=1_900_000_000_000,watch=new PilotWatch({maximumDeep:4,observationAgePolicy:'persistent-observable-market-v1',now:()=>at,record(){}});
 assert.throws(()=>watch.observeIdentity('bad',{mint,pool:mint,availableAt:at,evidence:'OFFLINE wrong pool'}),/NATIVE_OBSERVATION_POOL/);
 assert.throws(()=>assertNativeObservationIdentity({schemaVersion:1,baseMint:mint,pool,migrationAt:at,migrationVerified:false,identityBasis:'canonical-pool-hint',identityAvailableAt:at,identityEvidence:'OFFLINE'},at),/MIGRATION_PROVENANCE/);
 const old=new PilotWatch({maximumDeep:4,now:()=>at,record(){}});assert.throws(()=>old.observeIdentity('current-pool:'+mint,{mint,pool,availableAt:at,evidence:'OFFLINE'}),/PILOT_WATCH_OBSERVATION_IDENTITY/,'age-dependent observation policy still requires its historical metadata');
});

test('current hint selection searches fresh indexes across30000retained identities without scanning the full market',t=>{
 const at=1_900_000_000_000,registry=new MarketRegistry(':memory:',{now:()=>at}),db=(registry as any).db;
 try{
  // Metadata-only population: every old row is already represented by a known
  // watch identity. No chain validation or market economics is claimed.
  const token=db.prepare('INSERT INTO market_tokens(mint,first_seen_at,last_seen_at,screened_at,last_activity_at,activity_hints) VALUES(?,?,?,?,?,1)'),watch=db.prepare('INSERT INTO watch_rows(signature,mint,pool,migration_at,verified_at,first_seen_at,state,defer_until,waiting_since,promotions,repromotions,demotions,complete_windows,ever_had_window,older_research,body) VALUES(?,?,?,?,?,?,?,0,?,0,0,0,0,0,0,?)'),provenance=db.prepare('INSERT INTO identity_provenance(mint,source,kind,pool,signature,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?)');
  db.transaction(()=>{for(let i=0;i<30000;i++){const name='OFFLINE-retained-'+i,old=at-86400000;token.run(name,old,old,old,old);watch.run('scope-'+name,name,'pool-'+name,old,old,old,'WATCH',old,'{}');provenance.run(name,'confirmed-migration','migration','pool-'+name,'scope-'+name,old,old);}})();
  const started=performance.now();assert.equal(registry.nextObservationCandidate(at),undefined);const elapsed=performance.now()-started;
  const sql=[...(registry as any).statements.keys()].find((q:string)=>q.startsWith('WITH hints')) as string,plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(at-60000,at,at-60000,at,at).map((r:any)=>r.detail as string);
  assert.ok(plan.some((r:string)=>r.includes('market_tokens_activity')),JSON.stringify(plan));assert.ok(plan.some((r:string)=>r.includes('identity_provenance_recent_kind')),JSON.stringify(plan));assert.equal(plan.some((r:string)=>/^SCAN (t|market_tokens|identity_provenance)\b/.test(r)),false,JSON.stringify(plan));
  registry.observeActivity({mint,at,source:'OFFLINE shared activity'});assert.equal(registry.nextObservationCandidate(at)!.mint,mint,'a fresh unsigned hint is selectable even after30000older records');
  const scope=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:'persistent-observable-market-v1',now:()=>at,record(){}});scope.observeIdentity('current-pool:'+mint,{mint,pool,availableAt:at,evidence:'OFFLINE current scope'});assert.equal(registry.nextObservationCandidate(at),undefined,'already retained current scopes do not starve later discovery');
  t.diagnostic('30000retained metadata rows; empty indexed selection '+elapsed.toFixed(3)+'ms; no provider calls');
 }finally{registry.close();}
});

for(const supported of [true,false])test(`current support callback precedes any ACK and reports only accepted scopes (${supported?'supported':'unsupported'})`,async()=>{
 const at=1_900_000_000_000,accepted:ResearchClockNativeObservationSupport[]=[],gaps:string[]=[],requests:unknown[]=[],opens:unknown[]=[];
 const support={mint,pool,at,sourceSlot:500,evidence:'OFFLINE accepted SDK support',summary:{marketClockUnixSeconds:at/1000,tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}} as ResearchClockNativeObservationSupport;
 const flow=new PilotNativeFlow({maximumCandidates:4,control:{cooldownUntil:()=>0,controlCooldownUntil:()=>0} as any,support:{async validateMany(input){requests.push(input);return {validations:supported?{[mint]:support}:{},unavailable:supported?{}:{[mint]:'UNSUPPORTED_OR_MISSING_INITIAL_POOL'},context:null};}},record(){},onCurrentPoolValidated(row){accepted.push(row);assert.equal(flow.snapshot(mint)!.openedAt,null);assert.equal(opens.length,0);},onFlowOpen:row=>opens.push(row),onTrade(){},onGap:row=>gaps.push(row.reason)},{now:()=>at,monotonic:()=>0,setTimer:()=>1,clearTimer(){},makeSocket(){throw Error('OFFLINE unexpected socket');}});
 try{flow.addCandidate({mint,pool});assert.equal(requests.length,0);assert.equal(accepted.length,0);assert.equal((await flow.service()).kind,'support');assert.equal(requests.length,1);assert.equal(accepted.length,supported?1:0);assert.equal(flow.snapshot(mint)!.sourceSupportFresh,supported);assert.equal(flow.snapshot(mint)!.openedAt,null);assert.equal(opens.length,0);if(supported){assert.notEqual(accepted[0],support);assert.equal(Object.hasOwn(accepted[0]!,'migrationAt'),false);}else assert.deepEqual(gaps,['UNSUPPORTED_OR_MISSING_INITIAL_POOL']);}finally{await flow.stop();}
});
