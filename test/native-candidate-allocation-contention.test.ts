/** OFFLINE real coordinator/SQLite leases. No provider, wallet or financial
 * writer; passive supports never stand in for a subscription ACK or audit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {MarketRegistry,MarketRegistryContention} from '../src/market-registry.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {canonicalObservationPool} from '../src/native-observation-identity.js';
import {MIGRATION_AGE_POLICY} from '../src/migration-age-policy.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION} from '../src/liquidity-resilient-momentum-v3-1.js';
import {pilotLowerPriorityAdmission} from '../src/pilot.js';
import {FlowWindow} from '../src/strategy.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import type {ResearchClockNativeObservationSupport} from '../src/research-clock-pricing.js';

const AT=1793566800000,phases=['drainNativeActivity','drainMigrationDelivery','drainCommittedActivity'] as const;
function fixture(identityCount=6){
 const directory=mkdtempSync(join(tmpdir(),'poe-allocation-lease-')),path=join(directory,'market-registry.sqlite');let at=AT,financial=false,retiring=0,lastProtection:number|null=null;
 const registry=new MarketRegistry(path,{concurrentIntake:true,migrationAge:true,now:()=>at}),locker=new Database(path),states=new Map<string,{mint:string;pool:string}>(),adopted:ResearchClockNativeObservationSupport[]=[],preparations:string[]=[],requests:string[]=[],records:Array<{kind:string;data:any}>=[];
 const support=(mint:string)=>({mint,pool:canonicalObservationPool(mint),at,sourceSlot:100,evidence:'OFFLINE_CANONICAL_SUPPORT',summary:{marketClockUnixSeconds:Math.floor(at/1000),tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'}} as ResearchClockNativeObservationSupport);
 const flow={async prepareObservation(scope:{mint:string}){preparations.push(scope.mint);return {status:'ready',support:support(scope.mint)};},adoptPreparedObservation(mint:string,value:ResearchClockNativeObservationSupport){assert.ok(states.has(mint));adopted.push(structuredClone(value));},addCandidate(scope:{mint:string;pool:string}){states.set(scope.mint,{...scope});},removeCandidate(mint:string){states.delete(mint);},snapshot(mint:string){return states.has(mint)?{scope:states.get(mint),openedAt:null,subscription:null,connectionId:null,connected:false,sourceSupportFresh:true,suspended:false,hasQualityLoss:false,features:null,warm:false}:null;},notificationLedger(){return [];},requestSupportRefresh(){},requestHeartbeat(){},async service(){return {kind:'idle'};},usage(){return {candidates:states.size,retiring,connected:false,nextServiceAt:Infinity,physicalTransportsSettled:true,fatal:null};},async stop(){states.clear();}};
 const runner=new NativeCandidateRunner({registry,runId:'OFFLINE-migration-allocation-lease',flow:flow as any,rpc:{async call(method:string){requests.push(method);return null;},usage:()=>({inFlight:0,waitingOrOperating:false,dispatchWindow:{physicalBusy:false,readyAt:at}}),cooldownUntil:()=>0} as any,maximumDeep:4,now:()=>at,pumpswapOnly:true,enforceMigrationAge:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,financialEvaluationPending:()=>financial,sourceWorkAdmission:bound=>lastProtection===null||pilotLowerPriorityAdmission({now:at,endAt:AT+3600000,held:1,lastUsable:lastProtection,nextPendingAt:null,operationBoundMs:bound}).admitted,record:(kind,data)=>records.push({kind,data})});
 const mints=Array.from({length:identityCount},(_,n)=>new PublicKey(Buffer.alloc(32,n+40)).toBase58());
 for(const [n,mint]of mints.entries()){
  const signature=bs58.encode(Buffer.alloc(64,n+40));registry.putMigrationAgeProof({version:MIGRATION_AGE_POLICY.version,mint,pool:canonicalObservationPool(mint),signature,slot:100,migrationAt:AT-3600000,availableAt:AT,confirmedTransactionSha256:'a'.repeat(64),finalizedTransactionSha256:'b'.repeat(64)});
  runner.onMarketIdentity({mint,signature,receivedAt:AT,source:'pumpportal-migration',kind:'migration',evidence:'unverified-provider-discovery-hint'});
  runner.onMigration({signature,feedMint:mint,receivedAt:AT});
  runner.onMarketActivity({mint,pool:canonicalObservationPool(mint),signature:bs58.encode(Buffer.alloc(64,n+100)),receivedAt:AT,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',side:'buy',quoteLamports:String((n+1)*1000000),evidence:'unverified-provider-activity-hint'});
 }
 const prepared=async()=>{for(const mint of mints)await (runner as any).prepareObservation(runner.watch.lookupIdentity(mint,at),at+2000);assert.equal(runner.status().candidatePreparation.freshPreparedCount,Math.min(4,identityCount));assert.equal(preparations.length,identityCount);};
 const refusedLease=()=>{locker.exec('BEGIN IMMEDIATE');try{registry.transaction(()=>assert.fail('refused writer callback must not run'));}finally{locker.exec('ROLLBACK');}};
 const close=async()=>{if(locker.inTransaction)locker.exec('ROLLBACK');await runner.stop();locker.close();registry.close();rmSync(directory,{recursive:true,force:true});};
 return {runner,registry,locker,flow,states,adopted,preparations,requests,records,mints,prepared,refusedLease,close,advance:(ms:number)=>{at+=ms;},financial:(value:boolean)=>{financial=value;},retiring:(value:number)=>{retiring=value;},protection:(value:number|null)=>{lastProtection=value;},get now(){return at;}};
}

/** Allocation deliberately yields at the real125ms work budget, independently
 * of this fixture's synthetic market clock. Four vacant slots therefore get
 * at most four actual source turns; no sleep, expiry extension or retry-until-
 * pass is used. All original preparation/proof bytes remain authoritative. */
function originalEvidence(f:ReturnType<typeof fixture>){
 const status=f.runner.status();return {at:f.now,proofs:f.mints.map(m=>JSON.stringify(f.registry.migrationAgeProof(m))),supports:new Map([...f.adopted.map(row=>[row.mint,structuredClone(row)]as const),...[...(f.runner as any).preparedObservations as Map<string,ResearchClockNativeObservationSupport>].map(([mint,row])=>[mint,structuredClone(row)]as const)]),preparations:[...f.preparations],requests:[...f.requests],auditedWindows:status.counters.auditedWindows,slots:new Map(status.slotProductivity.slots.map(row=>[row.mint,{openedAt:row.openedAt,subscriptionSentAt:row.subscriptionSentAt}]))};
}
async function fillPreparedSlots(f:ReturnType<typeof fixture>,original=originalEvidence(f),turnsAlreadyUsed=0,strictPreparation=true){
 let turns=turnsAlreadyUsed;for(;turns<4&&f.states.size<4;turns++){
  await f.runner.step();assert.equal(f.now,original.at,'source turns do not advance or renew the market evidence clock');assert.deepEqual(f.mints.map(m=>JSON.stringify(f.registry.migrationAgeProof(m))),original.proofs);if(strictPreparation)assert.deepEqual(f.preparations,original.preparations,'same prepared receipts; no extra provider preparation');assert.deepEqual(f.requests,original.requests,'no extra provider RPC');for(const row of f.adopted){if(strictPreparation)assert.deepEqual(row,original.supports.get(row.mint));else{assert.equal(row.at,original.at);assert.equal(row.summary.marketClockUnixSeconds,original.at/1000);}}
  const status=f.runner.status();assert.equal(status.counters.auditedWindows,original.auditedWindows);for(const row of status.slotProductivity.slots)assert.deepEqual({openedAt:row.openedAt,subscriptionSentAt:row.subscriptionSentAt},original.slots.get(row.mint)??{openedAt:null,subscriptionSentAt:null},'allocation does not invent ACK or audit coverage');
 }
 assert.equal(f.states.size,4,'four slots fill within at most four bounded real source turns');return turns;
}

for(const phase of phases)test('fresh prepared allocation receives its own writer attempt after pure optional refusal: '+phase,async()=>{
 const f=fixture();try{
  await f.prepared();const original=originalEvidence(f),proofBytes=f.mints.map(m=>JSON.stringify(f.registry.migrationAgeProof(m))),old=(f.runner as any)[phase];let attempts=0;
  (f.runner as any)[phase]=()=>{attempts++;f.refusedLease();};
  await f.runner.step();assert.equal(attempts,1);assert.ok(f.states.size>0,'a pure optional refusal still permits its own fresh allocation attempt');await fillPreparedSlots(f,original,1);assert.equal(f.adopted.length,4);assert.equal(f.preparations.length,6,'reusable evidence is allocated without another provider preparation');assert.deepEqual(f.requests,[]);
  assert.deepEqual(f.mints.map(m=>JSON.stringify(f.registry.migrationAgeProof(m))),proofBytes);for(const row of f.adopted){assert.equal(row.at,AT);assert.equal(row.summary.marketClockUnixSeconds,AT/1000);}
  const event=f.records.find(row=>row.kind==='native-candidate-registry-contention')!;assert.equal(event.data.callbackStarted,false);assert.equal(event.data.providerRequestStarted,false);
  const status=f.runner.status();assert.equal(status.counters.auditedWindows,0);assert.equal(status.slotProductivity.counts.allocations,4);for(const row of status.slotProductivity.slots){assert.equal(row.openedAt,null);assert.equal(row.subscriptionSentAt,null);}
  (f.runner as any)[phase]=old;
 }finally{await f.close();}
});

test('optional refused work preserves the same economic ranking and newly prepared candidate competition',async()=>{
 const allocationOrders:string[][]=[];for(const refuse of [false,true]){const f=fixture();try{await f.prepared();if(refuse)(f.runner as any).drainCommittedActivity=()=>f.refusedLease();await fillPreparedSlots(f);allocationOrders.push(f.adopted.map(row=>row.mint));const selection=f.records.filter(row=>row.kind==='pilot-watch-opportunity-priority'&&row.data.competition?.purpose==='ALLOCATION_SELECTION');assert.equal(selection.length,4);assert.ok(selection.every(row=>row.data.competition.actualAllocationClaimed===false));}finally{await f.close();}}assert.deepEqual(allocationOrders[1],allocationOrders[0]);
});

test('a deterministic real wall-time allocation yield preserves the same four ranked candidates and original evidence',async()=>{
 const orders:string[][]=[];for(const slow of [false,true]){const f=fixture();try{
  await f.prepared();const original=originalEvidence(f);if(slow){const adopt=f.flow.adoptPreparedObservation.bind(f.flow);f.flow.adoptPreparedObservation=(mint,value)=>{adopt(mint,value);const began=performance.now();while(performance.now()-began<NATIVE_DEADLINE_POLICY.postValidationMs+1){/* Fixture-only local work after an actual committed slot. */}};}
  await f.runner.step();if(slow)assert.equal(f.states.size,1,'the unchanged125ms source work budget yields after one actual committed allocation');const turns=await fillPreparedSlots(f,original,1);if(slow)assert.equal(turns,4);assert.equal(NATIVE_DEADLINE_POLICY.postValidationMs,125);orders.push(f.adopted.map(row=>row.mint));assert.equal(new Set(orders.at(-1)).size,4);
 }finally{await f.close();}}assert.deepEqual(orders[1],orders[0],'budgeted source turns preserve economic ranking rather than forcing rotation');
});

test('required native service still precedes a productive allocation-budget yield',async()=>{
 const f=fixture();try{
  await f.prepared();let required=false;const before=f.preparations.length,adopt=f.flow.adoptPreparedObservation.bind(f.flow);f.flow.adoptPreparedObservation=(mint,value)=>{adopt(mint,value);required=true;const began=performance.now();while(performance.now()-began<126){/* Deterministic fixture-only local work. */}};
  const usage=f.flow.usage.bind(f.flow);f.flow.usage=()=>({...usage(),nextServiceAt:required?f.now:Infinity,nextServiceDomain:required?'control':null});let serviced=0;f.flow.service=async()=>{serviced++;required=false;return {kind:'heartbeat'};};
  assert.equal(await f.runner.step(),'heartbeat');assert.equal(f.states.size,1);assert.equal(serviced,1);assert.ok((f.runner as any).allocationBudgetYieldedMints.length);assert.equal(f.preparations.length,before);assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

test('an existing ready audit still precedes the new optional-preparation budget yield',async()=>{
 const f=fixture(4);try{
  await f.prepared();const cache=(f.runner as any).preparedObservations as Map<string,ResearchClockNativeObservationSupport>,mint=cache.keys().next().value!;for(const other of [...cache.keys()])if(other!==mint)cache.delete(other);(f.runner as any).allocate(f.now);assert.equal(f.states.size,1);
  const openedAt=f.now,window=new FlowWindow(mint,openedAt),snapshot=f.flow.snapshot.bind(f.flow);f.runner.onFlowOpen({mint,at:openedAt});f.advance(64000);Object.assign(f.flow,{snapshot:(key:string,at=f.now)=>{const row=snapshot(key);return key!==mint||!row?row:{...row,openedAt,connectionId:1,subscription:1,connected:true,warm:true,features:window.features(at),supportContext:{slot:200,availableAt:at,bankClockAt:at},openingSupportContext:{slot:100,availableAt:openedAt,bankClockAt:openedAt},supportContexts:[{slot:100,availableAt:openedAt,bankClockAt:openedAt},{slot:200,availableAt:at,bankClockAt:at}]};}});
  const evaluated:string[]=[];(f.runner as any).evaluate=async(candidate:{identity:{baseMint:string}})=>evaluated.push(candidate.identity.baseMint);await f.runner.step();evaluated.splice(0);
  for(const other of f.mints)if(other!==mint)await (f.runner as any).prepareObservation(f.runner.watch.lookupIdentity(other,f.now),f.now+2000);assert.equal(f.runner.status().candidatePreparation.freshPreparedCount,3);const before=f.preparations.length,adopt=f.flow.adoptPreparedObservation.bind(f.flow);f.flow.adoptPreparedObservation=(key,value)=>{adopt(key,value);const began=performance.now();while(performance.now()-began<126){/* Deterministic fixture-only local work. */}};
  await f.runner.step();assert.ok((f.runner as any).allocationBudgetYieldedMints.length);assert.deepEqual(evaluated,[mint]);assert.equal(f.preparations.length,before);assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

for(const kind of ['unverified','callback','postcommit','mixed'] as const)test('unknown or nonisolated contention retains candidate coherence barrier: '+kind,async()=>{
 const f=fixture();try{await f.prepared();(f.runner as any).drainCommittedActivity=()=>{
  if(kind==='unverified')throw new MarketRegistryContention('SQLITE_BUSY');
  if(kind==='callback')f.registry.transaction(()=>{throw new MarketRegistryContention('SQLITE_BUSY');});
  if(kind==='postcommit')f.registry.transaction(()=>{f.registry.setMetadata('OFFLINE-postcommit',1);f.registry.afterCommit(()=>{throw new MarketRegistryContention('SQLITE_BUSY');});});
  f.registry.setMetadata('OFFLINE-committed-before-later-refusal',1);f.refusedLease();
 };await f.runner.step();assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.deepEqual((f.runner as any).allocationBudgetYieldedMints,[]);assert.equal(f.runner.status().slotProductivity.counts.allocations,0);assert.equal(f.records.find(row=>row.kind==='native-candidate-registry-contention')?.data.callbackStarted,null);
 }finally{await f.close();}
});

for(const pending of ['drainFinancialOutcomes','drainPreparedObservation','drainTokenCreation'] as const)test('critical original result commit remains ahead of new ownership: '+pending,async()=>{
 const f=fixture();try{await f.prepared();const original=originalEvidence(f),old=(f.runner as any)[pending];(f.runner as any)[pending]=()=>false;await f.runner.step();assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.deepEqual((f.runner as any).allocationBudgetYieldedMints,[]);(f.runner as any)[pending]=old;await fillPreparedSlots(f,original,0,false);}finally{await f.close();}
});

test('a genuinely refused allocation remains deferred with no false slot or ACK and recovers under the same evidence',async()=>{
 const f=fixture();try{await f.prepared();const original=originalEvidence(f),old=(f.runner as any).allocate.bind(f.runner);(f.runner as any).allocate=(at:number)=>{f.locker.exec('BEGIN IMMEDIATE');try{old(at);}finally{f.locker.exec('ROLLBACK');}};await f.runner.step();assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.deepEqual((f.runner as any).allocationBudgetYieldedMints,[]);assert.equal(f.runner.status().slotProductivity.counts.allocations,0);assert.ok(f.records.some(row=>row.kind==='native-candidate-registry-contention'&&row.data.phase==='allocation'&&row.data.callbackStarted===false));(f.runner as any).allocate=old;await fillPreparedSlots(f,original,0,false);for(const row of f.adopted)assert.equal(row.at,AT);}finally{await f.close();}
});

test('a real current certificate keeps financial priority ahead of optional refused work and prepared peers',async()=>{
 const f=fixture();try{
  await f.prepared();const cache=(f.runner as any).preparedObservations as Map<string,ResearchClockNativeObservationSupport>,mint=cache.keys().next().value!;
  for(const other of [...cache.keys()])if(other!==mint)cache.delete(other);(f.runner as any).allocate(f.now);assert.equal(f.states.size,1);
  const openedAt=f.now,window=new FlowWindow(mint,openedAt),snapshot=f.flow.snapshot.bind(f.flow);f.runner.onFlowOpen({mint,at:openedAt});f.advance(64000);
  Object.assign(f.flow,{snapshot:(key:string,at=f.now)=>{const row=snapshot(key);return key!==mint||!row?row:{...row,openedAt,connectionId:1,subscription:1,connected:true,warm:true,features:window.features(at),supportContext:{slot:200,availableAt:at,bankClockAt:at},openingSupportContext:{slot:100,availableAt:openedAt,bankClockAt:openedAt},supportContexts:[]};}});
  const features=window.features(f.now),certificate:NativeAuditCertificate={schemaVersion:1,mint,pool:canonicalObservationPool(mint),dataContract:f.runner.dataContract,openedAt,connectionId:1,subscriptionId:1,windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditAvailableAt:f.now,admittedAt:f.now,deadlineAt:features.windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:nativePaperFeaturesSha256(features)};
  (f.runner as any).certificates.set(mint,certificate);const candidate=(f.runner as any).candidates.get(mint);candidate.lastAssessmentEnd=features.windowEndAt;candidate.nextAuditAt=features.windowEndAt+10000;candidate.lastReadyWindowEnd=features.windowEndAt;candidate.lastReadyObservedAt=f.now;
  for(const other of f.mints)if(other!==mint)await (f.runner as any).prepareObservation(f.runner.watch.lookupIdentity(other,f.now),f.now+2000);assert.equal(f.runner.status().candidatePreparation.freshPreparedCount,4);
  assert.deepEqual(f.runner.currentAuditCertificate(mint),certificate);f.financial(true);assert.equal(f.runner.hasPendingFinancialEvaluation(),true);const preparedBefore=f.preparations.length;
  (f.runner as any).drainCommittedActivity=()=>f.refusedLease();await f.runner.step();assert.equal(f.states.size,1);assert.equal(f.adopted.length,1);assert.equal(f.preparations.length,preparedBefore);assert.deepEqual(f.runner.currentAuditCertificate(mint),certificate);assert.deepEqual(f.requests,[]);
  f.financial(false);await fillPreparedSlots(f);assert.equal(f.preparations.length,preparedBefore);
 }finally{await f.close();}
});

for(const gate of ['holding-reserve','native-capacity','expired-support','expired-migration'] as const)test('optional refusal cannot bypass the existing '+gate+' prerequisite',async()=>{
 const f=fixture();try{await f.prepared();(f.runner as any).drainCommittedActivity=()=>f.refusedLease();if(gate==='holding-reserve')f.protection(AT-1999);if(gate==='native-capacity')f.retiring(4);if(gate==='expired-support')f.advance(30000);if(gate==='expired-migration')f.advance(86400000);await f.runner.step();assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.deepEqual((f.runner as any).allocationBudgetYieldedMints,[]);assert.equal(f.runner.status().slotProductivity.counts.allocations,0);assert.deepEqual(f.requests,[]);}finally{await f.close();}
});

test('noncontention failures never permit an allocation retry or acquire ownership',async()=>{
 const f=fixture();try{await f.prepared();(f.runner as any).drainCommittedActivity=()=>{throw Object.assign(Error('OFFLINE_CORRUPTION'),{code:'SQLITE_CORRUPT'});};assert.equal(await f.runner.step(),'unavailable');assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);}finally{await f.close();}
});

test('the transaction-counter witness reads settled local counters without a SQL statement',async()=>{
 const f=fixture();try{let queries=0;const statement=(f.registry as any).statement;(f.registry as any).statement=()=>{queries++;assert.fail('health witness must not query SQLite');};try{(f.runner as any).registryHousekeeping('native-activity',()=>{});assert.equal(queries,0);}finally{(f.registry as any).statement=statement;}}finally{await f.close();}
});
