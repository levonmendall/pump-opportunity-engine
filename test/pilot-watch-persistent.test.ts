import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY as POLICY,entryAgeEligible,observationAgeEligible,observationExpiryAt} from '../src/observation-age.js';

function fixture(path=':memory:'){
 let at=1000000000;const registry=new MarketRegistry(path,{now:()=>at}),records:Array<{kind:string;data:any}>=[];
 const options={registry,maximumDeep:4,observationAgePolicy:POLICY.version,now:()=>at,record:(kind:string,data:unknown)=>records.push({kind,data})},watch=new PilotWatch(options);
 const seed=(id:string,migrationAt=at-300000)=>{watch.discover({signature:'sig-'+id,feedMint:'mint-'+id,receivedAt:at});return watch.verify('sig-'+id,{mint:'mint-'+id,pool:'pool-'+id,migrationAt,verifiedAt:at});};
 return {watch,registry,options,records,seed,now:()=>at,advance:(by:number)=>{at+=by;}};
}

test('durable discovery retains thousands of identities without registry evictions, unbounded checkpoints or a full-report materialization',()=>{
 const f=fixture();try{
  for(let i=0;i<3000;i++)f.seed(String(i));
  const snapshot=f.watch.snapshot(f.now(),'liquidity-resilient-momentum-v3.1');
  assert.equal(snapshot.summary.known,3000);assert.equal(snapshot.summary.queued,3000);assert.equal(snapshot.summary.evicted,0);assert.equal(snapshot.summary.capacityExclusions,0);assert.equal(snapshot.summary.maximumIdentities,null);
  assert.ok(snapshot.rows.length<3000);assert.equal((snapshot.summary as any).projection.complete,false);
  const checkpoint=f.watch.export();assert.deepEqual(checkpoint.rows,[]);assert.ok(checkpoint.registry?.id);assert.ok(JSON.stringify(checkpoint).length<2048);
  assert.throws(()=>f.watch.listIdentities(),/PAGED_QUERY_REQUIRED/);
  let after:string|undefined,total=0;for(;;){const page=f.watch.listIdentityPage({after,limit:79});total+=page.length;if(page.length<79)break;after=page.at(-1)!.signature;}assert.equal(total,3000);
  for(const id of ['0','174','256','2999'])assert.equal(f.watch.lookupIdentity('mint-'+id)?.state,'WATCH');
 }finally{f.registry.close();}
});

test('all four deep slots can observe old relevant tokens; old age alone neither evicts awareness nor changes frozen baseline entry rules',()=>{
 const f=fixture();try{
  const migrationAt=f.now()-7*86400000;
  for(let i=0;i<35;i++){f.seed('old-'+i,migrationAt);f.watch.selectOlderResearch('mint-old-'+i,{observedAt:f.now(),evidence:'actual shared activity hint'});}
  for(let i=0;i<4;i++)f.watch.transition('mint-old-'+i,'DEEP_OBSERVATION','support verified; fresh current flow required');
  assert.throws(()=>f.watch.transition('mint-old-4','DEEP_OBSERVATION','fifth allocation'),/DEEP_CAPACITY/);
  assert.equal(f.watch.snapshot(f.now(),'liquidity-resilient-momentum-v3.1').summary.deepActive,4);
  f.advance(30*86400000);assert.equal(f.watch.lookupIdentity('mint-old-34')!.state,'WATCH');assert.equal(f.watch.noteActivity('mint-old-34',f.now(),'renewed current shared activity'),true);
  assert.equal(entryAgeEligible(migrationAt,f.now()),false);assert.equal(observationAgeEligible(migrationAt,f.now(),false,POLICY),true);assert.equal(observationExpiryAt(migrationAt,false,POLICY),Number.MAX_SAFE_INTEGER);
 }finally{f.registry.close();}
});

test('durable restart preserves the complete registry and owned obligations but invalidates old deep proofs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-watch-')),path=join(dir,'market.sqlite'),f=fixture(path);let reopened:MarketRegistry|undefined;
 try{
  for(let i=0;i<400;i++)f.seed(String(i));f.watch.transition('mint-0','DEEP_OBSERVATION','current window');f.watch.noteWindow('mint-0',f.now());f.watch.transition('mint-1','HELD','authoritative position');f.watch.transition('mint-2','ENTRY_PENDING','authoritative pending action');
  const checkpoint=f.watch.export();f.registry.close();reopened=new MarketRegistry(path,{now:f.options.now});
  const watch=new PilotWatch({...f.options,registry:reopened,restored:checkpoint});
  assert.equal(watch.lookupIdentity('mint-0')!.state,'DEFERRED');assert.equal(watch.lookupIdentity('mint-0')!.deepSince,null);assert.equal(watch.lookupIdentity('mint-0')!.completeWindows,1);
  assert.equal(watch.lookupIdentity('mint-1')!.state,'HELD');assert.equal(watch.lookupIdentity('mint-2')!.state,'ENTRY_PENDING');assert.equal(watch.lookupIdentity('mint-2')!.deepSince,null);
  assert.equal(watch.snapshot().summary.known,400);assert.deepEqual(watch.identitiesInStates(['HELD','ENTRY_PENDING']).map(r=>r.mint).sort(),['mint-1','mint-2']);
  const empty=new MarketRegistry(':memory:');try{assert.throws(()=>new PilotWatch({...f.options,registry:empty,restored:checkpoint}),/DURABLE_HISTORY_UNAVAILABLE|REGISTRY_IDENTITY/);}finally{empty.close();}
 }finally{try{f.registry.close();}catch{}reopened?.close();rmSync(dir,{recursive:true,force:true});}
});

test('indexed candidate selection requires retained origin proof and ranks measured capital-weighted activity over newer dust',()=>{
 const f=fixture();try{
  for(let i=0;i<350;i++)f.seed(String(i));f.registry.putOrigin('mint-299',{mint:'mint-299'});f.registry.putOrigin('mint-300',{mint:'mint-300'});
  f.registry.observeActivity({mint:'mint-299',source:'test',at:f.now(),signature:'capital',side:'buy',quoteLamports:'100000000000'});f.watch.noteActivity('mint-299',f.now(),'shared capital activity');
  f.advance(1);f.registry.observeActivity({mint:'mint-300',source:'test',at:f.now(),signature:'dust',side:'buy',quoteLamports:'1'});f.watch.noteActivity('mint-300',f.now(),'newer dust activity');
  assert.equal(f.watch.next(f.now(),new Set(),{requireOrigin:true})!.mint,'mint-299');assert.equal(f.watch.next(f.now(),new Set(['mint-299']),{requireOrigin:true})!.mint,'mint-300');
  f.registry.archiveOrigin('mint-299','proof unavailable');assert.equal(f.watch.next(f.now(),new Set(['mint-300']),{requireOrigin:true}),null);
 }finally{f.registry.close();}
});

test('legacy checkpoint imports once and only fresh shared activity revives historical age expiration',()=>{
 let at=1000000000;const old=new PilotWatch({maximumDeep:4,now:()=>at,record(){}});old.discover({signature:'old',receivedAt:at});old.verify('old',{mint:'old-mint',pool:'old-pool',migrationAt:at-7200000,verifiedAt:at});assert.equal(old.lookupIdentity('old-mint')!.state,'EXPIRED');
 const registry=new MarketRegistry(':memory:',{now:()=>at});try{
  const options={registry,maximumDeep:4,observationAgePolicy:POLICY.version,now:()=>at,record(){},restored:old.export()},watch=new PilotWatch(options);assert.equal(watch.lookupIdentity('old-mint')!.state,'EXPIRED');
  at++;assert.equal(watch.noteActivity('old-mint',at,'new current shared observation'),true);assert.equal(watch.lookupIdentity('old-mint')!.state,'WATCH');
  watch.transition('old-mint','DEFERRED','provider unavailable',at,{deferUntil:at+60000});at++;watch.noteActivity('old-mint',at,'new activity does not erase provider failure');assert.equal(watch.next(at,new Set()),null);
  const resumed=new PilotWatch(options);assert.equal(resumed.lookupIdentity('old-mint')!.state,'DEFERRED');assert.equal(resumed.lookupIdentity('old-mint')!.deferUntil,at-1+60000);
 }finally{registry.close();}
});
