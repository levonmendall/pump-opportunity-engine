/** Independent OFFLINE restart regressions. Real durable watch/queue state and
 * the real runner; synthetic source/RPC adapters, no network or financial writer. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION} from '../src/liquidity-resilient-momentum-v3-1.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION} from '../src/liquidity-resilient-momentum-v3.js';
import {CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW} from '../src/program-log-mapping.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';

const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
const mint=new PublicKey(Buffer.alloc(32,91)).toBase58();
const pool=canonicalPumpPoolPda(new PublicKey(mint)).toBase58();
const start=Date.parse('2026-10-31T04:00:00Z');
type Clock={at:number;cooldown:number};
type Config={current?:boolean;activeStrategy?:typeof LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION|typeof LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION;persistentPolicy?:boolean;restoredWatch?:unknown};

function runnerFixture(registry:MarketRegistry,clock:Clock,config:Config={}){
 const allocated:string[]=[],requests:string[]=[],records:Array<{kind:string;data:any}>=[];
 const scopes=new Map<string,{mint:string;pool:string;minSlot?:number}>();let resolutions=0,sourceServices=0,stopped=false;
 const flow={
  addCandidate(scope:{mint:string;pool:string;minSlot?:number}){assert.ok(!scopes.has(scope.mint));scopes.set(scope.mint,{...scope});allocated.push(scope.mint);},
  removeCandidate(value:string){scopes.delete(value);},snapshot(){return null;},notificationLedger(){return [];},
  requestSupportRefresh(){},requestHeartbeat(){},async service(){sourceServices++;return {kind:'idle'};},
  usage(){return {dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,candidates:scopes.size,retiring:0,fatal:null,stopped,nextServiceAt:scopes.size?clock.at:Infinity,nextServiceDomain:scopes.size?'rpc':null,nextServiceAction:scopes.size?'support-refresh':null,nativeServiceDeadlines:[],physicalTransportsSettled:true};},
  async stop(){stopped=true;scopes.clear();}
 };
 const rpc={
  async call<T>(method:string){requests.push(method);return null as T;},
  cooldownUntil:()=>clock.cooldown,
  usage(){const dispatch={readyAt:Math.max(clock.at,clock.cooldown),waitMs:Math.max(0,clock.cooldown-clock.at),physicalBusy:false};return {closed:false,fatal:null,inFlight:0,waitingOrOperating:false,cooldownUntil:clock.cooldown,controlCooldownUntil:0,historyCooldownUntil:0,dispatchWindow:dispatch,rpcDispatchWindow:dispatch,controlDispatchWindow:{...dispatch,readyAt:clock.at,waitMs:0},requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:0,rolling10SecondStarts:0}};}
 };
 const runner=new NativeCandidateRunner({registry,runId:'offline-archive-independence',flow:flow as any,rpc:rpc as any,maximumDeep:4,now:()=>clock.at,admissionOpen:()=>true,sourceWorkAdmission:()=>true,
  ...(config.current?{activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version}:{}),
  ...(config.activeStrategy?{activeStrategy:config.activeStrategy}:{}),...(config.persistentPolicy?{observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version}:{}),
  ...(config.restoredWatch?{restoredWatch:config.restoredWatch}:{}),
  resolve:async(seed,client)=>{resolutions++;await client.call('getTransaction',[seed.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}]);return {ok:false as const,reason:'PILOT_MIGRATION_LOOKUP_UNAVAILABLE'};},
  record:(kind,data)=>records.push({kind,data})
 });
 return {runner,allocated,requests,records,get resolutions(){return resolutions;},get sourceServices(){return sourceServices;}};
}

test('current observation restart allocates retained identity without archive while source work still obeys primary cooldown',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-archive-restart-')),path=join(directory,'registry.sqlite'),clock={at:start,cooldown:0};let registry=new MarketRegistry(path,{now:()=>clock.at});
 let current:ReturnType<typeof runnerFixture>|undefined;
 try{
  const prior=runnerFixture(registry,clock);prior.runner.onMigration({signature:signature(1),feedMint:mint,receivedAt:clock.at});
  prior.runner.watch.verify(signature(1),{mint,pool,migrationAt:clock.at-600000,verifiedAt:clock.at});
  assert.equal(registry.hasOrigin(mint),false);assert.equal(registry.verificationStats(clock.at).ready,1);
  prior.runner.watch.transition(mint,'DEFERRED','known origin proof unavailable: PILOT_MIGRATION_LOOKUP_UNAVAILABLE',clock.at,{deferUntil:clock.at+60000});
  registry.deferVerification(signature(1),clock.at+60000,'OFFLINE pre-repair archive retry');
  const checkpoint=prior.runner.checkpoint();await prior.runner.stop();registry.close();
  clock.at+=1000;clock.cooldown=clock.at+65000;registry=new MarketRegistry(path,{now:()=>clock.at});
  current=runnerFixture(registry,clock,{current:true,restoredWatch:checkpoint.watch});
  assert.equal(current.runner.currentPoolObservation,true);assert.equal(current.runner.sourceAdmissionStatus().allocation125Allowed,true);
  await current.runner.step();
  assert.deepEqual(current.allocated,[mint],'local allocation is independent of archived creation and primary HTTP recovery');
  assert.equal(current.resolutions,0);assert.deepEqual(current.requests,[]);assert.equal(current.sourceServices,0,'local allocation cannot dispatch current support through the primary cooldown');
  assert.equal(current.runner.currentAuditCertificate(mint,clock.at),null,'allocation does not grant financial qualification');
  clock.at=clock.cooldown+1;
  for(let i=0;i<4;i++){await current.runner.step();clock.at+=1000;}
  assert.ok(current.sourceServices>0,'the test exercises open source dispatch after cooldown expiry');assert.equal(current.resolutions,0,'the retained legacy queue cannot resume archive requests after cooldown expiry');assert.deepEqual(current.requests,[]);assert.equal(registry.hasOrigin(mint),false);
  const row=current.runner.watch.lookupIdentity(mint,clock.at)!;assert.equal(row.migrationAt,start-600000);assert.equal(row.verifiedAt,start,'existing historical metadata is retained without fabricated proof bytes');
 }finally{await current?.runner.stop();registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('current observation never falls back to archival lookup across source restarts with no selectable scope',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-empty-observation-')),path=join(directory,'registry.sqlite'),clock={at:start,cooldown:0};let registry=new MarketRegistry(path,{now:()=>clock.at});
 let active:ReturnType<typeof runnerFixture>|undefined;
 try{
  const prior=runnerFixture(registry,clock);prior.runner.onMigration({signature:signature(2),receivedAt:clock.at});
  let checkpoint=prior.runner.checkpoint();await prior.runner.stop();registry.close();
  for(let generation=0;generation<2;generation++){
   clock.at+=61000;registry=new MarketRegistry(path,{now:()=>clock.at});active=runnerFixture(registry,clock,{current:true,restoredWatch:checkpoint.watch});
   active.runner.onMigration({signature:signature(3+generation),receivedAt:clock.at});
   assert.equal(active.runner.currentPoolObservation,true);assert.equal(active.runner.sourceAdmissionStatus().engineOpen,true);assert.equal(active.runner.sourceAdmissionStatus().physicalSetup3000Allowed,true);
   for(let i=0;i<5;i++){await active.runner.step();clock.at+=1000;}
   assert.deepEqual(active.allocated,[],'a signature without a token identity is retained, never invented into a canonical scope');
   assert.equal(active.resolutions,0,'an empty observation pool must not revive archival fallback');assert.deepEqual(active.requests,[]);
   assert.ok(active.runner.watch.lookupIdentity(signature(2),clock.at));assert.ok(active.runner.watch.lookupIdentity(signature(3+generation),clock.at));
   checkpoint=active.runner.checkpoint();await active.runner.stop();active=undefined;registry.close();
  }
  registry=new MarketRegistry(path,{now:()=>clock.at});
 }finally{await active?.runner.stop();registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('archive suppression is limited to persistent V3.1; historical strategy configurations retain their resolver',async t=>{
 for(const config of [
  {activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION},
  {activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION,persistentPolicy:true},
  {persistentPolicy:true}
 ] satisfies Config[])await t.test(JSON.stringify(config),async()=>{
  const clock={at:start,cooldown:0},registry=new MarketRegistry(':memory:',{now:()=>clock.at}),f=runnerFixture(registry,clock,config);
  try{f.runner.onMigration({signature:signature(10),receivedAt:clock.at});assert.equal(f.runner.currentPoolObservation,false);await f.runner.step();assert.equal(f.resolutions,1);assert.deepEqual(f.requests,['getTransaction']);}
  finally{await f.runner.stop();registry.close();}
 });
});
