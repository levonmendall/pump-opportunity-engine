/** Offline coordinator mechanics. These fixtures prove ordering and ownership;
 * they do not claim live provider coverage or economically qualified trades. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION} from '../src/liquidity-resilient-momentum-v3-1.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';
import type {ResearchClockNativeObservationSupport} from '../src/research-clock-pricing.js';
import type {NativeObservationPreparationResult} from '../src/native-observation-preparation.js';
import {projectCandidatePreparationReporting} from '../src/candidate-preparation-reporting.js';

const AT=Date.parse('2026-11-01T21:00:00Z');
const mint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
const pool=(m:string)=>canonicalPumpPoolPda(new PublicKey(m)).toBase58();
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
function proof(n:number,at=AT,createdAt=AT-3600000):TokenCreationProof{return {version:TOKEN_AGE_POLICY.version,mint:mint(n),signature:signature(n),slot:100,createdAt,availableAt:at,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)};}
function creation(n:number){const m=mint(n),curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),new PublicKey(m).toBuffer()],new PublicKey(PUMP))[0].toBase58();return {version:0,slot:100,blockTime:(AT-3600000)/1000,transaction:{signatures:[signature(n)],message:{accountKeys:[PUMP,TOKEN,m,mint(201),curve],instructions:[{programIdIndex:0,accounts:[2,3,4],data:bs58.encode(Buffer.concat([createHash('sha256').update('global:create').digest().subarray(0,8),Buffer.alloc(50)]))}]}},meta:{err:null,innerInstructions:[{index:0,instructions:[{programIdIndex:1,accounts:[2],data:bs58.encode(Buffer.from([20,...Buffer.alloc(34)])),stackHeight:2}]}]}};}
function fixture(options:{path?:string;enforceAge?:boolean;sourceWorkAdmission?:(bound:number)=>boolean;transaction?:unknown}={}){
 let at=AT,runner:NativeCandidateRunner,refusal:string|null=null,retryAt:number|undefined,stopped=false;
 const registry=new MarketRegistry(options.path??':memory:',{now:()=>at}),states=new Map<string,{mint:string;pool:string;minSlot?:number}>(),preparedCalls:string[]=[],adopted:ResearchClockNativeObservationSupport[]=[],requests:string[]=[],events:string[]=[],records:Array<{kind:string;data:any}>=[];
 const support=(m:string)=>({mint:m,pool:pool(m),at,sourceSlot:100,evidence:'OFFLINE_CANONICAL_POOL_BINDING',summary:{marketClockUnixSeconds:Math.floor(at/1000),tokenProgram:TOKEN}} as ResearchClockNativeObservationSupport);
 const flow={
  async prepareObservation(scope:{mint:string},_signal?:AbortSignal,admission?:{admissionOpen?:()=>boolean}):Promise<NativeObservationPreparationResult>{assert.equal(states.has(scope.mint),false,'passive binding precedes allocation');assert.equal(admission?.admissionOpen?.(),true);preparedCalls.push(scope.mint);events.push('prepare:'+scope.mint);return refusal?{status:'unavailable',reason:refusal,...(retryAt===undefined?{}:{retryAt})}:{status:'ready',support:support(scope.mint)};},
  adoptPreparedObservation(m:string,binding:ResearchClockNativeObservationSupport){assert.equal(states.has(m),true);events.push('adopt:'+m);adopted.push(structuredClone(binding));runner.onCurrentPoolValidated(binding);},
  addCandidate(scope:{mint:string;pool:string;minSlot?:number}){states.set(scope.mint,{...scope});events.push('add:'+scope.mint);},removeCandidate(m:string){states.delete(m);},
  snapshot(m:string){const scope=states.get(m);return scope?{scope,openedAt:null,subscription:null,connectionId:null,connected:false,sourceSupportFresh:true,suspended:false,hasQualityLoss:false,features:null,warm:false}:null;},notificationLedger(){return [];},requestSupportRefresh(){},requestHeartbeat(){},async service(){return {kind:'idle'};},
  usage(){return {candidates:states.size,retiring:0,connected:false,nextServiceAt:Infinity,nextServiceDomain:null,nextServiceAction:null,nextRequiredServiceAt:Infinity,nativeServiceDeadlines:[],physicalTransportsSettled:stopped,fatal:null};},async stop(){stopped=true;states.clear();},
 };
 const rpc={async call(method:string){requests.push(method);events.push(method);return options.transaction??null;},usage(){return {inFlight:0,waitingOrOperating:false,dispatchWindow:{physicalBusy:false,readyAt:at}};},cooldownUntil(){return 0;}};
 runner=new NativeCandidateRunner({registry,runId:'preparation-test',flow:flow as any,rpc:rpc as any,maximumDeep:4,now:()=>at,...(options.enforceAge===false?{}:{enforceTokenAge24h:true as const}),observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,sourceWorkAdmission:options.sourceWorkAdmission,onCandidateAllocated:id=>events.push('bridge:'+id.baseMint),record:(kind,data)=>records.push({kind,data})});
 const seed=(n:number,knownAge=true)=>{const m=mint(n);runner.onMarketIdentity({mint:m,source:'pumpportal-new-token',kind:'creation',venue:'pump',signature:signature(n),receivedAt:at,evidence:'unverified-provider-discovery-hint'});runner.onMigration({signature:signature(n+80),feedMint:m,receivedAt:at});runner.onMarketActivity({mint:m,source:'pumpapi-broad',kind:'activity',venue:'pump',signature:signature(n+100),side:'buy',quoteLamports:'1000',receivedAt:at,evidence:'unverified-provider-activity-hint'});if(knownAge)registry.putTokenCreationProof(proof(n,at));return m;};
 return {runner,registry,flow,states,preparedCalls,adopted,requests,events,records,seed,support,get now(){return at;},advance:(ms:number)=>{at+=ms;},refuse:(reason:string|null,until?:number)=>{refusal=reason;retryAt=until;},steps:async(n=1)=>{for(let i=0;i<n;i++)await runner.step();},close:async()=>{await runner.stop();registry.close();}};
}

test('absent current pools consume no deep slot, no ACK wait, and no finalized birth lookup',async()=>{
 const f=fixture();try{const m=f.seed(1,false);f.refuse('NATIVE_OBSERVATION_POOL_MISSING');await f.steps(5);
  assert.deepEqual(f.preparedCalls,[m]);assert.equal(f.states.size,0);assert.deepEqual(f.requests,[]);const status=f.runner.status();
  assert.equal(status.slotProductivity.counts.allocations,0);assert.equal(status.candidatePreparation.counters.poolAbsent,1);assert.equal(status.candidatePreparation.state,'awaiting-market-evidence');assert.equal(status.candidatePreparation.progress.serviceableSinceAt,null);assert.equal(status.counters.qualityGaps,0);
  assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.reobservation!.windowEndAt,null);assert.equal(f.registry.count(),1);
 }finally{await f.close();}
});

test('a fresh canonical pool hint reopens absent preparation; broad bonding activity does not',async()=>{
 const f=fixture();try{const m=f.seed(2);f.refuse('NATIVE_OBSERVATION_POOL_MISSING');await f.steps();f.advance(1);
  f.runner.onMarketActivity({mint:m,source:'pumpapi-broad',kind:'activity',venue:'pump',signature:signature(210),side:'buy',quoteLamports:'2000',receivedAt:f.now,evidence:'unverified-provider-activity-hint'});await f.steps(3);assert.equal(f.preparedCalls.length,1);
  f.advance(1);f.refuse(null);f.runner.onMarketActivity({mint:m,pool:pool(m),source:'pumpapi-broad',kind:'activity',venue:'pump-amm',signature:signature(211),side:'buy',quoteLamports:'3000',receivedAt:f.now,evidence:'unverified-provider-activity-hint'});await f.steps(3);
  assert.equal(f.preparedCalls.length,2);assert.equal(f.states.size,1);assert.equal(f.adopted.length,1);assert.equal(f.runner.status().slotProductivity.counts.allocations,1);assert.equal(f.runner.status().counters.auditedWindows,0);
 }finally{await f.close();}
});

test('accepted binding precedes immutable birth verification and is reused without a second setup read',async()=>{
 const f=fixture({transaction:creation(3)});try{const m=f.seed(3,false);await f.steps();assert.deepEqual(f.events,['prepare:'+m]);assert.equal(f.runner.status().candidatePreparation.state,'awaiting-token-age');await f.steps();assert.deepEqual(f.requests,['getTransaction']);await f.steps();
  assert.equal(f.preparedCalls.length,1);assert.equal(f.adopted.length,1);assert.deepEqual(f.events,['prepare:'+m,'getTransaction','add:'+m,'bridge:'+m,'adopt:'+m]);
  const status=f.runner.status();assert.equal(status.candidatePreparation.counters.allocationsFromPrepared,1);assert.equal(status.slotProductivity.slots[0]!.subscriptionSentAt,null);assert.equal(status.slotProductivity.slots[0]!.openedAt,null);assert.equal(status.candidatePreparation.startedAt,status.slotProductivity.startedAt);assert.equal(status.candidatePreparation.sourceInstanceId,status.slotProductivity.sourceInstanceId);
  f.advance(20);f.runner.onSubscriptionSent({mint:m,at:f.now});assert.equal(f.runner.status().slotProductivity.slots[0]!.subscriptionSentAt,f.now);assert.equal(f.runner.status().slotProductivity.slots[0]!.openedAt,null);
  f.advance(20);f.runner.onFlowOpen({mint:m,at:f.now});assert.equal(f.runner.status().candidatePreparation.progress.attemptsSinceProgress,0);assert.equal(f.runner.status().candidatePreparation.progress.unproductiveSinceAt,null);assert.equal(f.runner.status().candidatePreparation.progress.serviceableSinceAt,null);
 }finally{await f.close();}
});

test('unknown age permits passive preparation only; known older tokens never consume preparation requests',async()=>{
 const f=fixture();try{const m=f.seed(4,false);await f.steps(5);assert.equal(f.preparedCalls.length,1);assert.equal(f.states.size,0);assert.equal(f.requests.length,1,'pending immutable proof uses its existing retry cooldown');
  f.registry.putTokenCreationProof(proof(4,f.now,AT-TOKEN_AGE_POLICY.maximumAgeMs-1000));f.advance(40000);await f.steps(3);assert.equal(f.preparedCalls.length,1);assert.equal(f.states.size,0);assert.equal(f.registry.tokenAgeEligibility(m,f.now).allowed,false);
 }finally{await f.close();}
});

test('a stale cached binding is refreshed after birth is known; old timestamps are never rebased',async()=>{
 const f=fixture();try{const m=f.seed(5,false);await f.steps();const original=f.now;f.advance(31000);f.registry.putTokenCreationProof(proof(5,f.now));await f.steps();assert.equal(f.states.size,0);assert.equal(f.preparedCalls.length,2);await f.steps();assert.equal(f.states.size,1);assert.equal(f.adopted[0]!.at,original+31000);
 }finally{await f.close();}
});

test('actual setup runway is required even when cheap allocation bookkeeping would fit',async()=>{
 let allowSetup=false;const f=fixture({sourceWorkAdmission:bound=>bound<3000||allowSetup});try{f.seed(6);await f.steps(4);assert.equal(f.preparedCalls.length,1);assert.equal(f.states.size,0);assert.equal(f.runner.status().slotProductivity.counts.allocations,0);allowSetup=true;await f.steps();assert.equal(f.states.size,1);assert.equal(f.preparedCalls.length,1);
 }finally{await f.close();}
});

test('transient preparation failures use timed recovery without an absent-pool evidence gate',async()=>{
 const f=fixture();try{const m=f.seed(7);f.refuse('PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT',AT+5000);await f.steps(4);assert.equal(f.preparedCalls.length,1);assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.reobservation,undefined);assert.equal(f.runner.status().counters.qualityGaps,0);assert.equal(f.runner.status().candidatePreparation.counters.providerUnavailable,1);assert.equal(f.runner.status().candidatePreparation.state,'provider-unavailable');f.advance(4999);await f.steps();assert.equal(f.preparedCalls.length,1);f.advance(1);f.refuse(null);await f.steps(2);assert.equal(f.preparedCalls.length,2);assert.equal(f.states.size,1);
 }finally{await f.close();}
});

test('unsupported token movement semantics are structured venue outcomes, not provider outages',async()=>{
 const f=fixture();try{const m=f.seed(9);f.refuse('UNMODELED_BASE_EXTENSION:TransferFeeConfig');await f.steps(4);const state=f.runner.status().candidatePreparation;assert.equal(f.preparedCalls.length,1);assert.equal(f.states.size,0);assert.equal(state.counters.poolUnsupported,1);assert.equal(state.counters.providerUnavailable,0);assert.equal(state.lastOutcome!.reason,'UNMODELED_BASE_EXTENSION:TRANSFERFEECONFIG');assert.equal(f.registry.observationPreparation(m)!.state,'pool-unsupported');
 }finally{await f.close();}
});

test('uninvoked dispatch refusal is not reported as a provider failure or evidence-gated pool absence',async()=>{
 const f=fixture();try{const m=f.seed(10);f.refuse('PILOT_RPC_DISPATCH_EXPIRED');await f.steps();const state=f.runner.status().candidatePreparation;assert.equal(state.state,'awaiting-dispatch');assert.equal(state.counters.providerUnavailable,0);assert.equal(f.registry.observationPreparation(m)!.state,'awaiting-dispatch');assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.reobservation,undefined);assert.equal(state.progress.serviceableSinceAt,null);
 }finally{await f.close();}
});

for(const reason of ['PILOT_RPC_COOLDOWN','PILOT_RPC_CLOSED','NATIVE_FLOW_CLOSED','NATIVE_FLOW_PREPARATION_BUSY','NATIVE_FLOW_TRANSPORT_SETTLING','RESEARCH_CLOCK_CONCURRENT_QUOTE','PILOT_RPC_COMPONENT_ADMISSION_CLOSED','PILOT_RPC_COMPONENT_DISPATCH_EXPIRED','PILOT_RPC_PHYSICAL_SLOT_OCCUPIED','PILOT_RPC_COMPONENT_DISPATCH_BUSY','PILOT_RPC_COMPONENT_ABORTED','NATIVE_FLOW_PREPARATION_ADMISSION_CLOSED'])test('local preparation refusal defers without provider failure: '+reason,async()=>{
 const f=fixture();try{const m=f.seed(13);f.refuse(reason,AT+5000);await f.steps(4);const status=f.runner.status();
  assert.equal(f.preparedCalls.length,1);assert.equal(f.states.size,0);assert.equal(status.slotProductivity.counts.allocations,0);assert.equal(status.counters.qualityGaps,0);assert.equal(status.candidatePreparation.counters.providerUnavailable,0);assert.equal(status.candidatePreparation.counters.poolUnsupported,0);assert.equal(status.candidatePreparation.state,'awaiting-dispatch');assert.equal(status.candidatePreparation.progress.serviceableSinceAt,null);assert.equal(f.registry.observationPreparation(m)!.state,'awaiting-dispatch');assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.reobservation,undefined);
  f.advance(4999);await f.steps();assert.equal(f.preparedCalls.length,1,'local retry time is respected');f.advance(1);f.refuse(null);await f.steps(2);assert.equal(f.preparedCalls.length,2);assert.equal(f.states.size,1,'temporary local refusal does not create a permanent evidence gate');
 }finally{await f.close();}
});

for(const reason of ['NATIVE_OBSERVATION_MINT_LAYOUT','NATIVE_OBSERVATION_LEGACY_MINT_LAYOUT','NATIVE_OBSERVATION_MINT_TLV_LAYOUT'])test('unsupported mint layout waits for new evidence without provider failure: '+reason,async()=>{
 const f=fixture();try{const m=f.seed(14);f.refuse(reason);await f.steps(4);f.advance(60000);await f.steps(3);const status=f.runner.status();
  assert.equal(f.preparedCalls.length,1,'unchanged unsupported binding is not read repeatedly');assert.equal(f.states.size,0);assert.equal(status.slotProductivity.counts.allocations,0);assert.equal(status.counters.qualityGaps,0);assert.equal(status.candidatePreparation.counters.providerUnavailable,0);assert.equal(status.candidatePreparation.counters.poolUnsupported,1);assert.equal(status.candidatePreparation.state,'awaiting-market-evidence');assert.equal(status.candidatePreparation.progress.serviceableSinceAt,null);assert.equal(f.registry.observationPreparation(m)!.state,'pool-unsupported');assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.reobservation!.windowEndAt,null);
 }finally{await f.close();}
});

test('allocation from a reusable proof after another ACK starts a coherent new progress interval',async()=>{
 const f=fixture();try{const waiting=f.seed(12,false);await f.steps(2);const first=f.seed(11);await f.steps(2);assert.equal(f.states.has(first),true);assert.equal(f.states.has(waiting),false);f.advance(1);f.runner.onFlowOpen({mint:first,at:f.now});assert.equal(f.runner.status().candidatePreparation.progress.unproductiveSinceAt,null);
  f.registry.putTokenCreationProof(proof(12,f.now));await f.steps();assert.equal(f.states.has(waiting),true);assert.equal(f.preparedCalls.filter(m=>m===waiting).length,1);const status=f.runner.status();assert.equal(status.candidatePreparation.progress.unproductiveSinceAt,f.now);assert.equal(status.candidatePreparation.progress.serviceableSinceAt,f.now);assert.equal(status.candidatePreparation.progress.attemptsSinceProgress,1);assert.ok(projectCandidatePreparationReporting(status,f.now),'raw runtime progress remains a valid truthful reporting record');
 }finally{await f.close();}
});

test('venue hints and absent-pool preparation gates survive restart as unverified evidence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-preparation-')),path=join(dir,'market.sqlite');let f=fixture({path});try{const m=f.seed(8);f.refuse('NATIVE_OBSERVATION_POOL_MISSING');await f.steps();await f.close();f=fixture({path});await f.steps(3);assert.equal(f.preparedCalls.length,0);assert.equal(f.states.size,0);assert.equal(f.registry.observationPreparation(m)!.state,'pool-absent');assert.ok(f.registry.venueHints(m).some(h=>h.venue==='pump'&&h.verified===false));assert.equal(f.registry.count(),1);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
