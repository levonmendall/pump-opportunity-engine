import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {PilotRpc} from '../src/pilot-rpc.js';

type ProviderState={rpcDelay?:number;controlDelay?:number;cooldownDelay?:number;closed?:boolean;fatal?:string|null;waiting?:boolean;inFlight?:number;missingDispatch?:boolean;rpcBusy?:boolean;controlBusy?:boolean;missingRpcBusy?:boolean;missingControlBusy?:boolean};
function fixture(state:ProviderState={},elapsedBacklogMs=5){
 let at=Date.parse('2026-11-02T00:00:00.000Z'),providerReads=0,networkActions=0;
 const registry=new MarketRegistry(':memory:',{now:()=>at});
 const forbidden=()=>{networkActions++;throw Error('REPORTING_MUST_NOT_START_SOURCE_WORK');};
 const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:at+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,
  addCandidate:forbidden,removeCandidate:forbidden,notificationLedger:forbidden,requestSupportRefresh:forbidden,requestHeartbeat:forbidden,service:forbidden,stop:forbidden};
 const rpc={usage:()=>{providerReads++;return {waitingOrOperating:state.waiting??false,inFlight:state.inFlight??0,closed:state.closed??false,fatal:state.fatal??null,
  ...(state.missingDispatch?{}:{rpcDispatchWindow:{readyAt:at+(state.rpcDelay??0),...(state.missingRpcBusy?{}:{physicalBusy:state.rpcBusy??false}),waitMs:state.rpcDelay??0},
   controlDispatchWindow:{readyAt:at+(state.controlDelay??0),...(state.missingControlBusy?{}:{physicalBusy:state.controlBusy??false}),waitMs:state.controlDelay??0}})};},
  cooldownUntil:()=>state.cooldownDelay?at+state.cooldownDelay:0,call:forbidden};
 const runner=new NativeCandidateRunner({registry,flow:flow as any,rpc:rpc as any,runId:'pipeline-readiness-clock',maximumDeep:4,
  observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:'liquidity-resilient-momentum-v3.1',now:()=>at,record:()=>{}});
 for(const mint of ['offline-one','offline-two','offline-three','offline-four','offline-five']){
  runner.watch.discover({signature:'origin-'+mint,feedMint:mint,receivedAt:at});
  runner.watch.verify('origin-'+mint,{mint,pool:'pool-'+mint,migrationAt:at-300000,verifiedAt:at});
 }
 const backlog=runner.watch.serviceableBacklog.bind(runner.watch);
 runner.watch.serviceableBacklog=(...args:Parameters<typeof backlog>)=>{const result=backlog(...args);at+=elapsedBacklogMs;return result;};
 return {runner,registry,get now(){return at;},get providerReads(){return providerReads;},get networkActions(){return networkActions;}};
}

test('reporting compares provider readiness after elapsed backlog work without rewriting source time',()=>{
 for(const elapsedMs of [0,5,33]){
  const f=fixture({},elapsedMs);
  try{
   const sourceAt=f.now,writes=f.registry.health().transactions.writeCommits;
   const result=f.runner.pipelineThroughput(sourceAt);
   assert.equal(result.capacityWitness.providerReady,true);
   assert.equal(result.population.capacityWaiting,1);
   assert.equal(result.population.serviceableNow,5);
   assert.equal(result.generatedAt,sourceAt);
   assert.equal(f.now,sourceAt+elapsedMs);
   assert.equal(f.providerReads,1);
   assert.equal(f.registry.health().transactions.writeCommits,writes);
   assert.equal(f.networkActions,0);
  }finally{f.registry.close();}
 }
});

test('fresh reporting comparison does not clear real dispatch, cooldown, or provider restrictions',()=>{
 const cases:ProviderState[]=[{rpcDelay:1},{controlDelay:1},{cooldownDelay:1},{waiting:true},{inFlight:1},{closed:true},{fatal:'observed-provider-failure'},{missingDispatch:true},{rpcBusy:true},{controlBusy:true},{missingRpcBusy:true},{missingControlBusy:true}];
 for(const state of cases){
  const f=fixture(state);
  try{
   const sourceAt=f.now,writes=f.registry.health().transactions.writeCommits;
   const result=f.runner.pipelineThroughput(sourceAt);
   assert.equal(result.capacityWitness.providerReady,false,JSON.stringify(state));
   assert.equal(result.population.capacityWaiting,null,JSON.stringify(state));
   assert.equal(result.generatedAt,sourceAt);
   assert.equal(f.providerReads,1);
   assert.equal(f.registry.health().transactions.writeCommits,writes);
   assert.equal(f.networkActions,0);
  }finally{f.registry.close();}
 }
});

test('settled real RPC reservation without admissible chapter recovery is not reported as provider ready',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-pipeline-readiness-')),baseline=join(directory,'baseline.json');let at=200000,requests=0;
 writeFileSync(baseline,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:20,bytes:272634,lastObservedAt:2000,starts:Array.from({length:20},(_,i)=>1000+i),pending:[{id:20,unobservedBytes:2*1024*1024}]}),{mode:0o600});
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'pipeline-settled-restriction',baselinePaths:[baseline],priorPhysicalSettled:true,durationMs:1000,
  now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;},fetcher:async()=>{requests++;return new Response('denied',{status:429,headers:{'retry-after':'1'}});}});
 const registry=new MarketRegistry(':memory:',{now:()=>at});
 try{
  await assert.rejects(rpc.call('getSlot'),/HTTP_429/);await new Promise<void>(resolve=>setImmediate(resolve));at+=2000;
  const usage=rpc.usage();assert.equal(usage.closed,false);assert.equal(usage.fatal,null);assert.equal(usage.inFlight,0);assert.equal(usage.waitingOrOperating,false);assert.ok(rpc.cooldownUntil()<=at);assert.equal(rpc.available(),false);
  for(const gate of [usage.rpcDispatchWindow,usage.controlDispatchWindow]){assert.ok(gate);assert.ok(gate.readyAt<=at);assert.equal(gate.actualPhysicalBusy,false);assert.equal(gate.physicalBusy,true);assert.equal(gate.needsChapterRecovery,true);assert.equal(gate.recoveryAdmissible,false);}
  const forbidden=()=>{throw Error('REPORTING_MUST_NOT_START_SOURCE_WORK');};
  const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:at+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:forbidden,removeCandidate:forbidden,notificationLedger:forbidden,requestSupportRefresh:forbidden,requestHeartbeat:forbidden,service:forbidden,stop:forbidden};
  const runner=new NativeCandidateRunner({registry,flow:flow as any,rpc,maximumDeep:4,now:()=>at,record:()=>{}}),writes=registry.health().transactions.writeCommits;
  const result=runner.pipelineThroughput(at);
  assert.equal(result.capacityWitness.sourceReady,true);assert.equal(result.capacityWitness.localReady,true);assert.equal(result.capacityWitness.providerReady,false);assert.equal(result.population.capacityWaiting,null);assert.equal(result.generatedAt,at);
  assert.equal(requests,1);assert.equal(registry.health().transactions.writeCommits,writes);
 }finally{registry.close();try{rpc.close();}finally{rmSync(directory,{recursive:true,force:true});}}
});
