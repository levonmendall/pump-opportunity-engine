/** Candidate-only coordinator mechanics. Native/RPC contexts are explicitly
 * synthetic. One import test re-decodes retained actual creation bytes; injected
 * resolver fixtures below do not claim independent on-chain verification. */
import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync,mkdtempSync,writeFileSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';
import bs58 from'bs58';import{PublicKey}from'@solana/web3.js';
import Database from'better-sqlite3';
import{MarketRegistry,MarketRegistryContention}from'../src/market-registry.js';
import{NativeCandidateRunner,NATIVE_AUDIT_DISPATCH_DIAGNOSTICS,type NativeOrigin,type NativeEconomicRejection,type NativeMarketIntake}from'../src/native-candidate-runner.js';
import{CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}from'../src/program-log-mapping.js';
import{FlowWindow}from'../src/strategy.js';import{canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID}from'../src/sdk.js';
import type{NativeNotification}from'../src/pilot-native-flow.js';
import{decodeMigrationIdentity,type MigrationIdentity}from'../src/migration-identity.js';
import{auditNativeFlowWindow}from'../src/native-flow-audit.js';
import{PilotRpc,type PilotRpcCallOptions}from'../src/pilot-rpc.js';
import{pilotLowerPriorityAdmission}from'../src/pilot.js';
import{nativePaperRequestOperationBound,nativePaperObservationReporting}from'../src/run-native-paper.js';
import{projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION}from'../src/operating-intelligence.js';
import{nativeHeldAuditScheduling}from'../src/native-held-audit-scheduling.js';
import{LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,assessLiquidityResilientBuyingV31}from'../src/liquidity-resilient-momentum-v3-1.js';
const original=readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x)).find(x=>x.kind==='migration-transaction')!.data;
const originalSignature=original.transaction.signatures[0] as string;
const sig=(n:number)=>{const b=Buffer.alloc(64);b.writeUInt32LE(n);return bs58.encode(b);};
const baseAt=Math.ceil((original.blockTime*1000+600000)/10000)*10000+2000;
const decoded=decodeMigrationIdentity(original,{signature:originalSignature,commitment:'finalized',availableAt:baseAt});assert.ok(decoded.ok);const originalIdentity=decoded.identity;
type FakeScope={mint:string;pool:string;minSlot?:number};
type State={scope:FakeScope;openedAt:number|null;window:FlowWindow|null;gap:boolean;upper:{slot:number;availableAt:number;bankClockAt:number}|null;lastSyntheticAt:number;notes:NativeNotification[]};

test('pre-ACK absent-pool refusal suppresses unchanged and unrelated-pool retries but a new canonical-pool hint restores selection',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(161);(f.runner as any).allocate(f.now);assert.ok(f.states.has(mint));
 f.runner.onGap({mint,at:f.now,reason:'NATIVE_OBSERVATION_POOL_MISSING'});const row=f.runner.watch.lookupIdentity(mint,f.now)!;assert.equal(row.reobservation!.windowEndAt,null);assert.equal(row.completeWindows,0);assert.equal(row.deferUntil,f.now);
 f.advance(30000);await f.steps(5);assert.equal(f.added.filter(x=>x===mint).length,1);assert.equal(f.states.has(mint),false);
 f.runner.onMarketActivity({mint,signature:sig(162),receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000000000',evidence:'unverified-provider-activity-hint'});await f.steps(3);assert.equal(f.states.has(mint),false,'bonding-curve/unknown pool buying cannot establish canonical-pool progress');
 f.advance(1);f.runner.onMarketActivity({mint,pool:row.pool!,signature:sig(163),receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000',evidence:'unverified-provider-activity-hint'});await f.steps(3);assert.ok(f.states.has(mint));assert.equal(f.added.filter(x=>x===mint).length,2);assert.equal(f.resolveCalls,0);assert.equal(f.runner.status().counters.auditedWindows,0,'hint schedules only; a fresh independently audited window is still required');await f.runner.stop();
});

test('new migration hints promptly reopen a canonical pool refused before ACK without an arbitrary retry delay',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(164);(f.runner as any).allocate(f.now);f.runner.onGap({mint,at:f.now,reason:'BAD_POOL_OWNER'});f.advance(1);
 f.runner.onMigration({signature:sig(165),feedMint:mint,receivedAt:f.now});await f.steps(3);assert.ok(f.states.has(mint));assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.migrationAt,null);assert.equal(f.runner.status().counters.auditedWindows,0);await f.runner.stop();
});

test('provider failure before ACK keeps ordinary retry behavior instead of becoming a missing-pool evidence gate',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(166);(f.runner as any).allocate(f.now);f.runner.onGap({mint,at:f.now,reason:'PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'});
 assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.reobservation,undefined);f.advance(30000);await f.steps(3);assert.ok(f.states.has(mint));await f.runner.stop();
});

test('a real registry writer refusal cannot lose optional native activity; applying later retains original event time',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-native-activity-retry-')),path=join(dir,'market.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true}),lock=new Database(path);const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true,registry});
 try{
  const mint=f.seed(167);await f.steps(3);f.advance(1);const activityAt=f.now;lock.exec('BEGIN IMMEDIATE');const failed=registry.health().transactions.failed;
  assert.doesNotThrow(()=>f.runner.onNativeActivity({mint,at:activityAt,evidence:'native-program-events'}));assert.equal(registry.health().transactions.failed,failed,'enqueue in WS callback does not touch SQLite');
  assert.equal(await f.runner.step(),'wait');assert.notEqual(f.runner.watch.lookupIdentity(mint,f.now)!.lastActivityAt,activityAt);lock.exec('ROLLBACK');f.advance(100);await f.runner.step();assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.lastActivityAt,activityAt);assert.ok(f.states.has(mint));
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');await f.runner.stop();lock.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('an actual ACK whose one-shot registry callback was refused is reconciled with its original generation time',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-native-ack-retry-')),path=join(dir,'market.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true}),lock=new Database(path);const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true,registry});
 try{
  const mint=f.seed(168);(f.runner as any).allocate(f.now);lock.exec('BEGIN IMMEDIATE');await assert.rejects(f.flow.service(),e=>e instanceof MarketRegistryContention);const originalAck=f.states.get(mint)!.openedAt;assert.equal(f.runner.status().candidates[0]!.openedAt,null);
  lock.exec('ROLLBACK');f.advance(100);await f.runner.step();assert.equal(f.runner.status().candidates[0]!.openedAt,originalAck);assert.equal(f.records.filter(x=>x.kind==='native-candidate-observation-open').at(-1)!.data.at,originalAck);assert.equal(f.runner.status().counters.auditedWindows,0,'recovering an ACK does not manufacture a completed window');
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');await f.runner.stop();lock.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('ACK reconciliation refuses gapped, disconnected and stale scope evidence',async()=>{
 for(const fault of ['gapped','disconnected','stale','pool-mismatch']){
  const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(169);(f.runner as any).allocate(f.now);const s=f.states.get(mint)!;s.openedAt=f.now;s.window=new FlowWindow(mint,f.now);if(fault==='gapped')s.gap=true;if(fault==='stale')s.openedAt=f.now-1;if(fault==='pool-mismatch')s.scope.pool=canonicalPumpPoolPda(new PublicKey(Buffer.alloc(32,1))).toBase58();
  if(fault==='disconnected'){const snapshot=f.flow.snapshot;f.flow.snapshot=(...args)=>{const view=snapshot(...args);return view?{...view,connected:false}:view;};}
  await f.runner.step();assert.equal(f.runner.status().candidates[0]!.openedAt,null,fault);await f.runner.stop();
 }
});

test('ACK reconciliation cannot rewind an already recorded observation generation',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(170);(f.runner as any).allocate(f.now);const allocatedAt=f.now;f.advance(100);await f.flow.service();const recordedAck=f.runner.status().candidates[0]!.openedAt;assert.equal(recordedAck,f.now);f.states.get(mint)!.openedAt=allocatedAt;
 await f.runner.step();assert.equal(f.runner.status().candidates[0]!.openedAt,recordedAck);await f.runner.stop();
});

function fixture(config:{scopedNotifications?:boolean;respectServicePolicy?:true;productionResolver?:true;durableMarketPolicy?:true;marketIntake?:NativeMarketIntake;registry?:MarketRegistry;fairEconomicCompletions?:true;shadow?:boolean;maximumDeep?:number;refuseVerification?:number;refuseReason?:string;missingAudit?:boolean;lateAudit?:boolean;responseDelayMs?:number;forcePredictiveFeatures?:boolean;auditRpcError?:string;firstAuditTimeout?:boolean;quietBatch?:boolean;batchErrorIndex?:number;batchMalformedIndex?:number;retireBatchIndex?:number;batchPhysicalFailure?:string;sourceWorkAdmission?:(bound:number)=>boolean}={}){
 let at=baseAt,allow=true,headroom=20000,stopped=false,supportRequested=false,heartbeatRequested=false,resolveCalls=0,auditCalls=0,physicalBusy=false,lastPhysicalStart=-Infinity,inFlight=0,maximumInFlight=0,syntheticId=100000;
 let batchCoolingMint:string|null=null;const batchCalls:Array<{at:number;pools:string[];logicalQueries:number}>=[];
 const states=new Map<string,State>(),retiring=new Set<string>(),records:Array<{kind:string;data:any}>=[],flowActions:string[]=[],rpcCalls:Array<{method:string;params:unknown[];at:number}>=[],added:string[]=[],removed:string[]=[],identities=new Map<string,MigrationIdentity>();
 let runner:NativeCandidateRunner;const ownership=new Map<string,'HELD'|'ENTRY_PENDING'>();
 // SYNTHETIC continuous stable buying: actual FlowWindow math and real audit helper,
 // not a natural market/profitability or provider-capacity observation.
 const advanceTo=(next:number)=>{assert.ok(next>=at);if(config.forcePredictiveFeatures)for(const s of states.values())if(s.window&&s.openedAt!==null){for(let eventAt=Math.floor(s.lastSyntheticAt/1000)*1000+1000;eventAt<=next;eventAt+=1000){const signature=sig(++syntheticId),slot=(s.scope.minSlot??original.slot)+100+Math.floor((eventAt-s.openedAt)/1000)*10;s.window.ingest({identity:{kind:'program-log',signature,program:PUMP_AMM_PROGRAM_ID.toBase58(),logIndex:0,frameOrdinal:0},mint:s.scope.mint,wallet:new PublicKey(Buffer.alloc(32,Math.floor(eventAt/1000)%8+1)).toBase58(),side:'buy',quoteLamports:'250000000',tokenUnits:'1000000',receivedAt:eventAt,commitment:'confirmed',slot});s.notes.push({...(config.scopedNotifications?{subscriptionMint:s.scope.mint,subscriptionPool:s.scope.pool,subscriptionId:1,connectionId:1}:{}),signature,slot,receivedAt:eventAt,availableAt:eventAt,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null});runner.onTrade();}s.lastSyntheticAt=next;}at=next;};
 const refresh=()=>{for(const s of states.values())if(s.openedAt!==null)s.upper={slot:(s.scope.minSlot??original.slot)+100+Math.floor((at-s.openedAt)/1000)*10+2,availableAt:at,bankClockAt:Math.floor(at/1000)*1000};};
 const flow={addCandidate(scope:FakeScope){assert.ok(!states.has(scope.mint));states.set(scope.mint,{scope:{...scope},openedAt:null,window:null,gap:false,upper:null,lastSyntheticAt:at,notes:[]});added.push(scope.mint);},removeCandidate(mint:string){if(states.delete(mint)){retiring.add(mint);removed.push(mint);}},snapshot(mint:string,when=at){const s=states.get(mint);if(!s)return null;const features=s.window?.features(when)??null,opening=s.openedAt===null?null:{slot:(s.scope.minSlot??original.slot)+100,availableAt:s.openedAt,bankClockAt:Math.floor(s.openedAt/1000)*1000};return {strictV2Unavailable:config.shadow===true,baselineFeatureSemantics:config.shadow?'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW':'V2_WITHOUT_PROTOCOL_FRAMES',protocolPoolEffects:{count:config.shadow?1:0},scope:s.scope,...(config.fairEconomicCompletions?{connectionId:1}:{}),openedAt:s.openedAt,subscription:s.openedAt===null?null:1,connected:s.openedAt!==null,sourceSupportFresh:s.openedAt!==null&&!s.gap,warm:!!features?.sufficientlyObserved&&!s.gap,hasQualityLoss:s.gap,suspended:false,features,auditVerified:false,supportContext:s.upper,supportContexts:[...(opening?[opening]:[]),...(s.upper?[s.upper]:[])],openingSupportContext:opening};},notificationLedger(mint:string){return structuredClone(states.get(mint)?.notes??[]);},requestSupportRefresh(){supportRequested=true;},requestHeartbeat(){heartbeatRequested=true;},async service(_signal?:AbortSignal,admission?:PilotRpcCallOptions,policy?:{allowSetup?:boolean;allowRetirement?:boolean}){if(admission?.admissionOpen&&!admission.admissionOpen())return {kind:'deferred'};if(retiring.size){retiring.delete(retiring.values().next().value!);flowActions.push('unsubscribe');return {kind:'unsubscribe'};}if(supportRequested){supportRequested=false;refresh();headroom=10000;flowActions.push('support');return {kind:'support'};}const pending=[...states.values()].find(s=>s.openedAt===null);if(pending&&config.respectServicePolicy&&policy?.allowSetup===false)return {kind:'idle'};if(pending){pending.openedAt=at;pending.window=new FlowWindow(pending.scope.mint,at);pending.lastSyntheticAt=at;pending.upper={slot:(pending.scope.minSlot??original.slot)+100,availableAt:at,bankClockAt:Math.floor(at/1000)*1000};runner.onFlowOpen({mint:pending.scope.mint,at});flowActions.push('subscribe');return {kind:'subscribe'};}if(heartbeatRequested){heartbeatRequested=false;headroom=10000;flowActions.push('ping');return {kind:'ping'};}return {kind:'idle'};},usage(){return {...(config.respectServicePolicy?{nativeServiceDeadlines:[...states.values()].some(row=>row.openedAt!==null)?[{deadlineAt:at+headroom+1500,action:'heartbeat'}]:[]}:{}),dataContract:config.shadow?CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW:undefined,candidates:states.size,retiring:retiring.size,nextServiceAt:retiring.size||supportRequested||heartbeatRequested||[...states.values()].some(s=>s.openedAt===null)?at:at+headroom,nextServiceDomain:'control' as 'rpc'|'control'|null,nextServiceAction:'heartbeat' as string|null,physicalTransportsSettled:stopped,financialWriterOpened:false};},async stop(){stopped=true;states.clear();retiring.clear();flowActions.push('stop');}};
 const historyPayload=(params:unknown[])=>{const state=[...states.values()].find(s=>s.scope.pool===params[0]);assert.ok(state);const floor=(state.scope.minSlot??original.slot)+100;
   let rows=[...state.notes].reverse().map(n=>({signature:n.signature,slot:n.slot,err:null,blockTime:Math.floor(n.availableAt/1000),confirmationStatus:'confirmed'}));
   if(config.missingAudit)rows.push({signature:sig(9999),slot:floor+50,err:null,blockTime:Math.floor(at/1000)-10,confirmationStatus:'confirmed'});
   rows.push({signature:originalSignature,slot:original.slot,err:null,blockTime:original.blockTime,confirmationStatus:'finalized'});rows.sort((a,b)=>b.slot-a.slot);
   const before=(params[1] as any)?.before;if(before){const index=rows.findIndex(r=>r.signature===before);if(index>=0)rows=rows.slice(index+1);}return rows.slice(0,(params[1] as any).limit);};
 const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal,admission?:PilotRpcCallOptions):Promise<T>{
  signal?.throwIfAborted();advanceTo(Math.max(at,lastPhysicalStart+250));assert.ok(admission?.admissionOpen?.());assert.ok(admission?.latestStartAt===undefined||at<=admission.latestStartAt);assert.equal(inFlight,0);assert.equal(method,'getSignaturesForAddress','candidate-only runner makes no financial quote or execution request');
  inFlight++;maximumInFlight=Math.max(maximumInFlight,inFlight);lastPhysicalStart=at;rpcCalls.push({method,params:structuredClone(params),at});
  try{if(config.firstAuditTimeout&&rpcCalls.length===1){assert.equal(admission?.queryTimeoutScope,'independent-history');advanceTo(at+1500);throw Error('PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT');}advanceTo(at+(config.responseDelayMs??25));if(config.auditRpcError)throw Error(config.auditRpcError);return historyPayload(params) as T;
  }finally{inFlight--;}
 },callSignatureHistoryBatch:config.quietBatch?async<T>(requests:readonly {key:string;params:readonly unknown[]}[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>{signal?.throwIfAborted();advanceTo(Math.max(at,lastPhysicalStart+250));assert.ok(admission?.admissionOpen?.());assert.ok(admission?.latestStartAt===undefined||at<=admission.latestStartAt);assert.equal(inFlight,0);inFlight++;maximumInFlight=Math.max(maximumInFlight,inFlight);lastPhysicalStart=at;const requestedAt=at;batchCalls.push({at,pools:requests.map(r=>String(r.params[0])),logicalQueries:requests.length});try{const items=requests.map((r,i)=>config.batchErrorIndex===i?{key:r.key,id:'synthetic-batch:'+i,status:'rpc-error' as const,errorCode:-32602,requestedAt,responseReceivedAt:0,validatedAt:0}:{key:r.key,id:'synthetic-batch:'+i,status:'result' as const,result:(config.batchMalformedIndex===i?[{invalid:'SYNTHETIC_BAD_HISTORY_ROW'}]:historyPayload([...r.params])) as T,requestedAt,responseReceivedAt:0,validatedAt:0});advanceTo(at+(config.responseDelayMs??25));if(config.batchPhysicalFailure)throw Error(config.batchPhysicalFailure);if(config.retireBatchIndex!==undefined)runner.onGap({mint:requests[config.retireBatchIndex]!.key,at,reason:'SYNTHETIC_CONFIRMED_CORRECTION'});return {physicalRequestId:1000+batchCalls.length,requestedAt,responseReceivedAt:at,validatedAt:at,responseBytes:Math.min(500000,JSON.stringify(items).length),physicalHttpStarts:1 as const,logicalQueries:requests.length,overloaded:false,items:items.map(i=>({...i,responseReceivedAt:at,validatedAt:at}))};}finally{inFlight--;}}:undefined,historyQueryReadyAt:(pool:string)=>pool===batchCoolingMint?at+5000:at,usage(){const readyAt=Math.max(at,lastPhysicalStart+250);return {waitingOrOperating:physicalBusy||inFlight>0,inFlight:physicalBusy?1:inFlight,dispatchWindow:{readyAt,physicalBusy:physicalBusy||inFlight>0,waitMs:readyAt-at},cumulativeUnits:rpcCalls.length};},cooldownUntil(){return 0;}};
 const resolver=async(seed:any)=>{resolveCalls++;if(resolveCalls<=(config.refuseVerification??0))return {ok:false,reason:config.refuseReason??'PILOT_MIGRATION_LOOKUP_UNAVAILABLE'};const n=Number(seed.signature===originalSignature?1:[...seed.signature].reduce((sum,c)=>sum+c.charCodeAt(0),0)),mint=seed.feedMint??new PublicKey(Buffer.alloc(32,n%200+20)).toBase58(),identity={...structuredClone(originalIdentity),signature:seed.signature,baseMint:mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),chainBlockTime:Math.floor((at-600000)/1000),availableAt:at,commitment:'finalized'} as MigrationIdentity;identities.set(mint,identity);return {ok:true,identity,evidence:'SYNTHETIC_RESOLVER_ONLY',proof:{source:'direct-confirmed-creation',seed,originConfirmed:{signature:seed.signature,commitment:'confirmed',availableAt:at,transaction:original},originFinalized:{signature:seed.signature,commitment:'finalized',availableAt:at,transaction:original}}};};
 const audit:typeof auditNativeFlowWindow=async options=>{auditCalls++;const result=await auditNativeFlowWindow(options);if(config.lateAudit){advanceTo(at+8000);return {...result,availableAt:at};}return result;};
 runner=new NativeCandidateRunner({...(config.durableMarketPolicy?{observationAgePolicy:'persistent-observable-market-v1' as const}:{}),marketIntake:config.marketIntake,registry:config.registry,flow:flow as any,rpc:rpc as any,record(kind,data){records.push({kind,data:structuredClone(data)});},now:()=>at,maximumDeep:config.maximumDeep??1,admissionOpen:()=>allow,sourceWorkAdmission:config.sourceWorkAdmission,...(config.fairEconomicCompletions?{activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,activeAssessment:(_mint:string,features:ReturnType<FlowWindow['features']>)=>({...assessLiquidityResilientBuyingV31(features,at),features,status:'not-rejected' as const,reason:'OFFLINE preliminary pass for coordinator-only primary completion coverage'}),financialOwnership:(mint:string)=>ownership.get(mint)??null}:{}),resolve:config.productionResolver?undefined:resolver as any,audit});
 const importActual=()=>{const origin:NativeOrigin={originConfirmed:{signature:originalSignature,availableAt:at,transaction:structuredClone(original)},originFinalized:{signature:originalSignature,availableAt:at,transaction:structuredClone(original)}};runner.importOrigin(origin);return originalIdentity.baseMint;};
 const seed=(n:number)=>{const mint=new PublicKey(Buffer.alloc(32,n+20)).toBase58();runner.onMigration({signature:sig(n),feedMint:mint,receivedAt:at});return mint;};
 const steps=async(n:number)=>{for(let i=0;i<n;i++)await runner.step();};
 const warm=async()=>{advanceTo(at+70000);await runner.step();await runner.step();};
 return {runner,flow,rpc,records,ownership,rpcCalls,batchCalls,flowActions,added,removed,states,retiring,importActual,seed,steps,warm,refresh,get now(){return at;},get resolveCalls(){return resolveCalls;},get auditCalls(){return auditCalls;},get maximumInFlight(){return maximumInFlight;},advance(ms:number){advanceTo(at+ms);},setAllow(v:boolean){allow=v;},setHeadroom(ms:number){headroom=ms;},setPhysicalBusy(v:boolean){physicalBusy=v;},setBatchCoolingMint(pool:string|null){batchCoolingMint=pool;}};
}

test('retained strict actual origin imports without RPC; candidate warming begins only at actual source ACK',async()=>{
 const f=fixture(),mint=f.importActual();assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().counters.verifiedOrigins,1);await f.runner.step();assert.equal(f.runner.status().candidates[0]!.openedAt,f.now);assert.equal(f.flow.snapshot(mint)?.warm,false);f.advance(60000);await f.runner.step();assert.equal(f.auditCalls,0,'six complete closed buckets are not available at a simple60-second wall interval');assert.equal(f.flow.snapshot(mint)?.warm,false);assert.equal(f.runner.status().financialWriterOpened,false);assert.equal(f.runner.status().financialExecutionAuthorized,false);await f.runner.stop();
});

test('persistent V3.1 fills four current scopes from migration hints without historical proof or invented age',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true,maximumDeep:4}),mints=[1,2,3,4,5].map(n=>f.seed(n));
 await f.steps(10);assert.equal(f.runner.currentPoolObservation,true);assert.equal(f.states.size,4);assert.equal(f.resolveCalls,0);assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().verificationQueue,0);assert.equal(f.runner.status().watch.summary.eligibleKnown,5);
 for(const candidate of f.runner.status().candidates){assert.equal(candidate.migrationAt,null);assert.equal(candidate.migrationVerified,false);assert.equal(candidate.identityBasis,'canonical-pool-hint');assert.equal(f.states.get(candidate.mint)!.scope.minSlot,undefined);}
 assert.equal(f.runner.watch.serviceableBacklog(f.now).population.serviceableNow,1);assert.equal(f.runner.watch.lookupIdentity(mints[4]!,f.now)!.migrationAt,null);await f.runner.stop();
});

test('persistent V3.1 can select unsigned shared activity for current account validation without an archive lookup',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=new PublicKey(Buffer.alloc(32,189)).toBase58();
 f.runner.onMarketActivity({mint,receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteMint:'So11111111111111111111111111111111111111112',quoteLamports:'5000000000',evidence:'unverified-provider-activity-hint'});await f.steps(5);
 assert.ok(f.states.has(mint));assert.equal(f.resolveCalls,0);assert.equal(f.rpcCalls.length,0);const row=f.runner.watch.lookupIdentity(mint,f.now)!;assert.equal(row.signature,'current-pool:'+mint);assert.equal(row.verifiedAt,null);assert.equal(row.migrationAt,null);assert.equal(row.observationIdentity!.basis,'canonical-pool-hint');await f.runner.stop();
});

test('optional malformed startup archives cannot block current observation or hide registry failures',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.importActual(),before=f.runner.watch.lookupIdentity(mint,f.now)!;
 assert.doesNotThrow(()=>f.runner.importOrigin(null as any));const malformed={originConfirmed:{signature:originalSignature,availableAt:f.now,transaction:null},originFinalized:{signature:originalSignature,availableAt:f.now,transaction:null}};
 assert.doesNotThrow(()=>f.runner.importOrigin(malformed));assert.deepEqual(f.runner.watch.lookupIdentity(mint,f.now),before);assert.ok(f.records.some(r=>r.kind==='native-optional-origin-import-refused'&&r.data.mint===mint&&r.data.archivalRefetchQueued===false));
 const lookup=f.runner.watch.lookupIdentity;f.runner.watch.lookupIdentity=()=>{throw Error('SYNTHETIC_REGISTRY_READ_FAILURE');};assert.throws(()=>f.runner.importOrigin(malformed),/SYNTHETIC_REGISTRY_READ_FAILURE/);f.runner.watch.lookupIdentity=lookup;
 await f.steps(2);assert.ok(f.states.has(mint));assert.equal(f.resolveCalls,0);await f.runner.stop();
});

test('unknown-age pending-entry resolution retains its actual continuous capture and requires a new audit',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(1);await f.steps(2);const openedAt=f.states.get(mint)!.openedAt;
 f.ownership.set(mint,'ENTRY_PENDING');f.runner.syncFinancialOwnership(new Set([mint]));assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.state,'ENTRY_PENDING');
 f.ownership.delete(mint);f.runner.syncFinancialOwnership(new Set([mint]));assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.state,'DEEP_OBSERVATION');assert.equal(f.states.get(mint)!.openedAt,openedAt);assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.migrationAt,null);assert.equal(f.runner.currentAuditCertificate(mint,f.now),null);assert.ok(f.records.some(r=>r.kind==='native-candidate-owned-entry-resolved'&&r.data.continuousCaptureRetained===true));await f.runner.stop();
});

test('current-mode restart removes obsolete enrichment capacity estimates while preserving negative-decision evidence gates',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt});try{
  const first=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,maximumDeep:2}),ready=first.seed(1),dormant=first.seed(2);
  for(const mint of [ready,dormant])first.runner.watch.deferCapacity(mint,'OFFLINE legacy one-request-per-trade estimate',null,first.now);
  first.runner.watch.noteEvaluation(dormant,{kind:'economic-rejection',windowEndAt:first.now,evidence:'OFFLINE completed negative economics'},first.now);await first.runner.stop();
  const second=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,maximumDeep:2});assert.equal(second.runner.watch.lookupIdentity(ready,second.now)!.capacityCoverage,undefined);assert.equal(second.runner.watch.lookupIdentity(dormant,second.now)!.reobservation!.ready,null);await second.steps(3);
  assert.ok(second.states.has(ready));assert.equal(second.states.has(dormant),false);assert.equal(second.runner.watch.lookupIdentity(ready,second.now)!.migrationAt,null);assert.equal(second.resolveCalls,0);assert.ok(second.records.some(r=>r.kind==='pilot-watch-native-capacity-transition'&&r.data.physicalProviderGatesUnchanged===true));await second.runner.stop();
 }finally{registry.close();}
});

test('current identity hydration releases only the exact legacy archival verification timer',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt});try{
  const prior=fixture({registry,durableMarketPolicy:true,maximumDeep:2,refuseVerification:2,refuseReason:'PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN'}),mint=prior.seed(1),backoff=prior.seed(2);await prior.steps(4);
  const waiting=prior.runner.watch.lookupIdentity(sig(1),prior.now)!;assert.equal(waiting.mint,null);assert.equal(waiting.deferUntil,prior.now+300000);assert.equal(registry.verificationStats(prior.now).pending,2);
  prior.runner.watch.transition(sig(2),'DEFERRED','OFFLINE unrelated current-source backoff',prior.now,{deferUntil:prior.now+10000});await prior.runner.stop();
  const current=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,maximumDeep:2});await current.steps(4);
  assert.ok(current.states.has(mint),'a five-minute archival lookup timer is not a current observation prerequisite');assert.equal(current.states.has(backoff),false);assert.equal(current.runner.watch.lookupIdentity(backoff,current.now)!.deferUntil,current.now+10000);assert.equal(current.runner.watch.lookupIdentity(mint,current.now)!.migrationAt,null);assert.equal(current.resolveCalls,0);assert.equal(current.rpcCalls.length,0);assert.ok(current.records.some(r=>r.kind==='pilot-watch-archive-deferral-released'&&r.data.mint===mint));await current.runner.stop();
 }finally{registry.close();}
});

test('a structurally refused historical seed cannot permanently exclude an unverified current mint',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt});try{
  const prior=fixture({registry,durableMarketPolicy:true,refuseVerification:1,refuseReason:'PILOT_MIGRATION_OUTSIDE_PUMP_PROGRAM_FAMILY'}),mint=prior.seed(1);await prior.steps(3);assert.equal(prior.runner.watch.lookupIdentity(sig(1),prior.now)!.state,'PERMANENTLY_UNSUPPORTED');assert.equal(prior.runner.watch.lookupIdentity(sig(1),prior.now)!.mint,null);await prior.runner.stop();
  const current=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true});await current.steps(3);assert.ok(current.states.has(mint));const row=current.runner.watch.lookupIdentity(mint,current.now)!;assert.equal(row.signature,'current-pool:'+mint);assert.equal(row.migrationAt,null);assert.equal(current.runner.watch.lookupIdentity(sig(1),current.now)!.mint,null,'the exact historical refusal remains unbound');assert.equal(current.resolveCalls,0);assert.match(current.runner.status().watch.summary.coverage.denominator,/identified observation scopes.*support remains separately required/);
  current.runner.watch.transition(mint,'PERMANENTLY_UNSUPPORTED','OFFLINE current pool structural refusal',current.now);await current.runner.stop();
  const again=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true});again.runner.onMigration({signature:sig(1),feedMint:mint,receivedAt:again.now});await again.steps(3);assert.equal(again.states.has(mint),false,'a mint-bound structural refusal remains effective');assert.equal(again.runner.watch.lookupIdentity(mint,again.now)!.state,'PERMANENTLY_UNSUPPORTED');assert.equal(again.resolveCalls,0);await again.runner.stop();
 }finally{registry.close();}
});

test('current V3.1 uses strict actual-generation notification fences without a redundant bank ceiling read',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true,forcePredictiveFeatures:true,scopedNotifications:true}),mint=f.seed(1);await f.steps(2);
 f.advance(50000);f.refresh();f.advance(20000);const end=Math.floor(f.now/10000)*10000,priorSupport=f.states.get(mint)!.upper!;assert.ok(priorSupport.bankClockAt<end&&f.now-priorSupport.availableAt<30000);
 await f.steps(2);assert.equal(f.flowActions.filter(action=>action==='support').length,0);assert.equal(f.records.some(row=>row.kind==='native-shared-audit-ceiling-requested'),false);assert.equal(f.auditCalls,1);assert.equal(f.runner.status().counters.auditedWindows,1);
 const opened=f.records.find(row=>row.kind==='native-candidate-audit-session-open')!;assert.equal(opened.data.fenceKind,'current-generation-notifications');const audit=f.records.find(row=>row.kind==='native-candidate-window-audit')!.data.result;assert.equal(audit.anchorKind,'notification');assert.equal(audit.contextFences,null);assert.ok(audit.requiredSignatures.length>0);assert.equal(audit.executedFlowCompletenessVerified,true);assert.equal(f.rpcCalls[0]!.method,'getSignaturesForAddress');assert.equal((f.rpcCalls[0]!.params[1] as any).before,audit.anchor.signature);await f.runner.stop();
});

for(const boundary of ['wrong-generation','ambiguous-slot','quiet','legacy'] as const)test(`bank Clock refresh remains the audit fallback for ${boundary} notification boundaries`,async()=>{
 const f=fixture({...(boundary!=='legacy'?{durableMarketPolicy:true as const}:{}),fairEconomicCompletions:true,forcePredictiveFeatures:boundary!=='quiet',scopedNotifications:true}),mint=f.seed(1);await f.steps(8);f.advance(50000);f.refresh();f.advance(20000);const state=f.states.get(mint)!,end=Math.floor(f.now/10000)*10000;
 if(boundary==='wrong-generation')for(const note of state.notes)if(note.receivedAt>=end)note.connectionId=2;
 if(boundary==='ambiguous-slot'){const maximum=Math.max(...state.notes.map(note=>note.slot));state.notes.find(note=>note.availableAt>=end-60000&&note.availableAt<end)!.slot=maximum;}
 assert.equal(await f.runner.step(),'audit-ceiling-support');assert.equal(f.flowActions.filter(action=>action==='support').length,1);assert.equal(f.auditCalls,0);assert.equal(f.rpcCalls.length,0);assert.ok(f.records.some(row=>row.kind==='native-shared-audit-ceiling-requested'));await f.runner.stop();
});

test('fresh complete quiet window receives independent audit and same-bucket predictive rejection without financial authorization',async()=>{
 const f=fixture();f.importActual();await f.runner.step();await f.warm();const s=f.runner.status(),assessment=f.records.find(r=>r.kind==='native-predictive-assessment');assert.equal(s.counters.auditedWindows,1,JSON.stringify({counters:s.counters,lastOutcome:s.lastOutcome,recordKinds:f.records.slice(-6).map(r=>r.kind),auditCalls:f.auditCalls}));assert.equal(s.counters.predictiveFailed,1);assert.equal(s.counters.uniqueEvaluated,1);assert.ok(assessment);assert.equal(assessment.data.assessment.reason,'persistent-broad-buying-rule-not-met');assert.equal(assessment.data.financialQualification,false);assert.equal(assessment.data.transferCrossCheck,'UNAVAILABLE');assert.ok(assessment.data.auditAvailableAt>=assessment.data.windowEndAt);assert.equal(Math.floor(assessment.data.at/10000)*10000,assessment.data.windowEndAt);assert.equal(f.rpcCalls.length,1);assert.equal(s.candidates.length,0,'completed weak observation returns to fair watch');assert.equal(s.watch.rows[0]!.state,'DEFERRED');await f.runner.stop();
});

test('late independently verified audit stays recorded but cannot be backdated into an earlier predictive decision bucket',async()=>{
 const f=fixture({lateAudit:true});f.importActual();await f.runner.step();await f.warm();const s=f.runner.status();assert.equal(f.auditCalls,1);assert.equal(s.counters.auditedWindows,0);assert.equal(s.counters.predictiveFailed,0);assert.equal(s.counters.predictiveUnavailable,1);assert.equal(f.records.some(r=>r.kind==='native-predictive-assessment'),false);assert.ok(f.records.some(r=>r.kind==='native-candidate-window-audit'&&r.data.result.status==='verified'));assert.ok(f.records.some(r=>r.kind==='native-predictive-unavailable'));await f.runner.stop();
});

test('missing independent pool history invalidates candidate data instead of becoming a strategy failure',async()=>{
 const f=fixture({missingAudit:true});f.importActual();await f.runner.step();await f.warm();const s=f.runner.status();assert.equal(s.counters.auditUnusable,1);assert.equal(s.counters.qualityGaps,1);assert.equal(s.counters.predictiveFailed,0);assert.equal(s.counters.auditedWindows,0);assert.equal(s.candidates.length,0);assert.ok(f.records.some(r=>r.kind==='native-candidate-quality-gap'&&/HISTORY_SIGNATURE_NOT_OBSERVED/.test(r.data.reason)));await f.runner.stop();
});

test('retired audit failure causes reach the original observation projection without inserting financial decisions or qualification',async()=>{
 const f=fixture({missingAudit:true});const mint=f.importActual();await f.runner.step();await f.warm();const s=f.runner.status(),diagnostic=s.watch.summary.auditDiagnostics;
 assert.equal(s.candidates.length,0);assert.equal(s.counters.auditUnusable,1);assert.equal(s.counters.qualityGaps,1);assert.equal(diagnostic.byReason.NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED,2);assert.equal(diagnostic.byKind['audit-unusable'],1);assert.equal(diagnostic.byKind['quality-gap'],1);assert.equal(diagnostic.recent.at(-1)!.mint,mint);assert.equal(diagnostic.recent[0]!.deadlineAt,diagnostic.recent.at(-1)!.deadlineAt,'gap copies the actual audit deadline, not a reconstructed bucket boundary');assert.deepEqual(s.decisions,[],'failed audit is not an admitted predictive or financial decision');
 const observed=nativePaperObservationReporting({engine:s,feeds:undefined,financialDecisions:[],eventLoopDelayP95Ms:null});assert.deepEqual(observed.watch!.summary.auditDiagnostics,diagnostic);assert.deepEqual(observed.decisions,[]);
 const raw={accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:s.generatedAt,startedAt:diagnostic.startedAt!,runId:'OFFLINE-original-audit-diagnostics',configurationSha256:'a'.repeat(64),strategyVersion:'persistent-buying-pilot-v1',persistent:true,positions:{},pending:{},watch:observed.watch!.summary,decisions:observed.decisions,refusals:{'native-quality-gaps':s.counters.qualityGaps,'independent-audit-unusable':s.counters.auditUnusable}},publicView=projectOperatingIntelligence(raw);
 assert.match(publicView.quality.limitations.join('\n'),/NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED:2/);assert.match(publicView.quality.limitations.join('\n'),/Latest quality-gap/);assert.deepEqual(publicView.decisions,[]);assert.equal(publicView.quality.auditUnusable,1);assert.equal(publicView.quality.qualityGaps,1);validateOperatingIntelligence(publicView,new Date(s.generatedAt).toISOString());await f.runner.stop();
});

test('a global gap without a candidate or target keeps diagnostics unavailable rather than throwing or inventing a deadline',async()=>{
 const f=fixture();assert.doesNotThrow(()=>f.runner.onGap({at:f.now,reason:'NATIVE_FLOW_DISCONNECTED_1006'}));const s=f.runner.status(),fact=s.watch.summary.auditDiagnostics.recent.at(-1)!;assert.equal(s.counters.qualityGaps,1);assert.equal(fact.kind,'quality-gap');assert.equal(fact.mint,null);assert.equal(fact.windowEndAt,null);assert.equal(fact.deadlineAt,null);assert.equal(fact.lastDispatchReason,null);assert.equal(fact.reasonCode,'NATIVE_FLOW_DISCONNECTED');assert.equal(fact.transportCloseCode,1006);assert.equal(f.rpcCalls.length,0);await f.runner.stop();
});

test('a target expiring without an HTTP start retains its local wait action without becoming a provider timeout',async()=>{
 const f=fixture();const mint=f.importActual();await f.runner.step();f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000;f.setPhysicalBusy(true);await f.steps(10);f.advance(target+10001-f.now);f.refresh();await f.runner.step();
 const s=f.runner.status(),facts=s.watch.summary.auditDiagnostics,last=facts.recent.find(row=>row.kind==='decision-expired'&&row.windowEndAt===target)!;assert.ok(last);assert.equal(last.reasonCode,'DECISION_DEADLINE_EXPIRED');assert.equal(last.deadlineAt,target+10000);assert.equal(last.lastDispatchReason,'rpc-gate-wait');assert.equal(last.lastDispatchAction,'await-physical-settlement');assert.equal(f.rpcCalls.length,0);assert.equal(s.counters.decisionDeadlineMisses,1);assert.equal(s.counters.auditUnavailable,0);assert.equal(facts.byReason.PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT,undefined);await f.runner.stop();
});

test('SYNTHETIC six-slot saturation preserves seventh watch identity and releases actual unsubscribe ownership before replacement',async()=>{
 const f=fixture({maximumDeep:6}),mints=Array.from({length:7},(_,i)=>f.seed(i+1));await f.steps(20);let s=f.runner.status();assert.equal(s.maximumSimultaneousCandidates,6);assert.equal(s.candidates.length,6);assert.equal(s.watch.rows.length,7);const first=s.candidates[0]!.mint;assert.ok(mints.includes(first));f.runner.onGap({mint:first,at:f.now,reason:'SYNTHETIC_SELECTED_DATA_GAP'});assert.equal(f.retiring.size,1);const added=f.added.length;await f.runner.step();assert.equal(f.added.length,added,'retiring native subscription still occupies its bounded slot');assert.equal(f.flowActions.at(-1),'unsubscribe');await f.runner.step();s=f.runner.status();assert.equal(s.candidates.length,6);assert.equal(f.added.length,added+1);assert.equal(s.maximumSimultaneousCandidates,6);assert.equal(s.financialExecutionAuthorized,false);await f.runner.stop();
});

test('a ready audit keeps its physical page turns while retirement resumes at the next safe turn without a fixed delay',async()=>{
 const f=fixture({maximumDeep:2,forcePredictiveFeatures:true,fairEconomicCompletions:true,respectServicePolicy:true});f.seed(1);f.seed(2);await f.steps(16);const mints=[...f.states.keys()];f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000,retiredAt=f.now;addBusyHistory(f,mints[0]!,1220);f.runner.onGap({mint:mints[1]!,at:f.now,reason:'OFFLINE_RETIRED_PEER'});
 const usage=f.flow.usage.bind(f.flow);f.flow.usage=()=>({...usage(),nativeServiceDeadlines:[{action:'unsubscribe',deadlineAt:retiredAt+10000}]});(f.flow as any).servicePlan=()=>f.retiring.size?{at:f.now,domain:'control',action:'unsubscribe',required:true,deadlineAt:retiredAt+10000}:{at:f.now+10000,domain:'control',action:'heartbeat',required:true,deadlineAt:f.now+10000};
 try{
  const unsubscribes=f.flowActions.filter(x=>x==='unsubscribe').length;await f.runner.step();assert.equal(f.rpcCalls.length,1);assert.ok(f.runner.status().candidates[0]!.auditSession,'the useful logical audit remains in progress after its first physical page');assert.equal(f.flowActions.filter(x=>x==='unsubscribe').length,unsubscribes);
  for(let n=0;n<8&&f.runner.status().counters.auditedWindows===0;n++){f.advance(250);await f.runner.step();}assert.equal(f.runner.status().counters.auditedWindows,1);assert.ok(f.runner.currentAuditCertificate(mints[0]!,f.now));for(let n=0;n<3&&f.retiring.size;n++){f.advance(250);await f.runner.step();}assert.equal(f.retiring.size,0);assert.equal(f.flowActions.filter(x=>x==='unsubscribe').length,unsubscribes+1);assert.ok(f.now-retiredAt<1000,'actual completed audit pages free retirement service long before the former8s timer');assert.ok(f.now<target+9999);assert.equal(f.maximumInFlight,1);assert.equal(f.runner.status().counters.decisionDeadlineMisses,0);
 }finally{await f.runner.stop();}
});

for(const jitterMs of [50,100])test(`SYNTHETIC six ready rejection audits finish before replacement support/setup with ${jitterMs} ms jitter`,async()=>{
 const f=fixture({maximumDeep:6,responseDelayMs:700}),mints=Array.from({length:7},(_,i)=>f.seed(i+1));await f.steps(30);assert.equal(f.added.length,6);assert.equal(f.resolveCalls,7,'the waiting identity already has its immutable origin proof');
 // The actual forward trace refilled a rejected scope immediately, putting
 // unsubscribe/two support reads/subscribe ahead of remaining ready audits.
 // Preserve required retirement; model both setup reads only if a new scope
 // is admitted. They are not substitutes for history/audit validation.
 const service=f.flow.service.bind(f.flow);let setupReads=0;
 f.flow.service=async(signal,admission)=>{const pending=[...f.states.values()].find(s=>s.openedAt===null);if(!f.retiring.size&&pending&&f.added.length>6&&setupReads<2){setupReads++;f.flowActions.push('replacement-support');f.advance(100);return {kind:'support'};}return service(signal,admission);};
 f.advance(70000);const target=Math.floor(f.now/10000)*10000;
 for(let i=0;i<100&&f.runner.status().counters.predictiveAssessments<6;i++){
  await f.runner.step();f.advance(jitterMs);
  if(f.runner.status().counters.predictiveAssessments<6){assert.equal(f.added.length,6,'a vacancy must not create discretionary setup while the existing batch still needs auditing');assert.equal(setupReads,0);}
 }
 const rows=f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt===target);assert.equal(rows.length,6);assert.deepEqual(new Set(rows.map(r=>r.data.mint)),new Set(mints.slice(0,6)));assert.ok(rows.every(r=>r.data.at<target+10000));assert.equal(f.runner.status().counters.decisionDeadlineMisses,0);assert.equal(f.runner.status().counters.auditUnavailable,0);assert.equal(f.maximumInFlight,1);assert.ok(f.records.some(r=>r.kind==='native-deep-admission-deferred'));
 for(let i=0;i<15&&f.states.get(mints[6]!)?.openedAt==null;i++){await f.runner.step();f.advance(jitterMs);}
 assert.equal(setupReads,2,'waiting candidate setup resumes after the current batch settles');assert.equal(f.added.length,7);assert.notEqual(f.states.get(mints[6]!)?.openedAt,null);assert.equal(f.runner.status().financialWriterOpened,false);await f.runner.stop();
});

test('verification refusal retains its exact seed and respects the watch retry time instead of disappearing',async()=>{
 const f=fixture({refuseVerification:1}),mint=f.seed(1);await f.runner.step();assert.equal(f.resolveCalls,1);let s=f.runner.status();assert.equal(s.verificationQueue,1);assert.equal(s.counters.verificationRefusals,1);const until=s.watch.rows[0]!.deferUntil;assert.ok(until>f.now);await f.steps(3);assert.equal(f.resolveCalls,1);f.advance(until-f.now);await f.runner.step();assert.equal(f.resolveCalls,2);await f.runner.step();s=f.runner.status();assert.equal(s.verificationQueue,0);assert.equal(s.candidates[0]!.mint,mint);await f.runner.stop();
});

test('a complete audit helper cannot start near native liveness deadline; bounded heartbeat preparation creates a new service interval',async()=>{
 const f=fixture();f.importActual();await f.runner.step();f.advance(70000);f.refresh();f.setHeadroom(1000);const outcome=await f.runner.step();assert.match(String(outcome),/^audit-preparation-/);assert.equal(f.auditCalls,0);assert.equal(f.rpcCalls.length,0);assert.equal(f.flowActions.at(-1),'ping');await f.runner.step();assert.equal(f.auditCalls,1);assert.equal(f.runner.status().counters.auditedWindows,1);await f.runner.stop();
});

for(const blocker of ['support-refresh','heartbeat']as const)test(`absolute ${blocker} runway deadline is advanced by its own domain without moving the other deadline`,async()=>{
 const f=fixture();f.importActual();await f.runner.step();f.advance(70000);f.refresh();
 let supportDueAt=f.now+(blocker==='support-refresh'?1000:9000),heartbeatDueAt=f.now+(blocker==='heartbeat'?1000:9000),supportRequested=false,heartbeatRequested=false,supportRequests=0,heartbeatRequests=0;
 const originalSupport=supportDueAt,originalHeartbeat=heartbeatDueAt,usage=f.flow.usage.bind(f.flow);
 f.flow.requestSupportRefresh=()=>{supportRequested=true;supportRequests++;};f.flow.requestHeartbeat=()=>{heartbeatRequested=true;heartbeatRequests++;};
 f.flow.usage=()=>({...usage(),nextServiceAt:Math.min(supportRequested?f.now:supportDueAt,heartbeatRequested?f.now:heartbeatDueAt),nextServiceDomain:(supportRequested?f.now:supportDueAt)<=(heartbeatRequested?f.now:heartbeatDueAt)?'rpc' as const:'control' as const,nextServiceAction:(supportRequested?f.now:supportDueAt)<=(heartbeatRequested?f.now:heartbeatDueAt)?'support-refresh' as const:'heartbeat' as const})as any;
 f.flow.service=async()=>{if(supportRequested||f.now>=supportDueAt){supportRequested=false;supportDueAt=f.now+25000;f.refresh();return {kind:'support'};}if(heartbeatRequested||f.now>=heartbeatDueAt){heartbeatRequested=false;heartbeatDueAt=f.now+10000;return {kind:'ping'};}return {kind:'idle'};};
 assert.equal(await f.runner.step(),blocker==='support-refresh'?'audit-preparation-support':'audit-preparation-ping');assert.equal(f.auditCalls,0);
 assert.equal(supportRequests,blocker==='support-refresh'?1:0);assert.equal(heartbeatRequests,blocker==='heartbeat'?1:0);
 assert.equal(blocker==='support-refresh'?heartbeatDueAt:supportDueAt,blocker==='support-refresh'?originalHeartbeat:originalSupport,'unrelated absolute service deadline remains fixed');
 await f.runner.step();assert.equal(f.auditCalls,1);assert.equal(f.runner.status().counters.auditedWindows,1);assert.equal(supportRequests+heartbeatRequests,1,'audit dispatch does not repeat preparation');
 const preparation=f.records.find(row=>row.kind==='native-audit-dispatch-state'&&row.data.reason==='prepare-native-runway');assert.equal(preparation?.data.nextAction,blocker==='support-refresh'?'request-early-support-refresh':'request-early-heartbeat');assert.equal(preparation?.data.context.nextNativeServiceAction,blocker);await f.runner.stop();
});

for(const action of ['peer-pong','unsubscribe']as const)test(`future ${action} runway blocker waits for its own service without inventing a heartbeat`,async()=>{
 const f=fixture();f.importActual();await f.runner.step();f.advance(70000);f.refresh();let dueAt=f.now+1000,supportRequests=0,heartbeatRequests=0,services=0;
 const usage=f.flow.usage.bind(f.flow);f.flow.requestSupportRefresh=()=>{supportRequests++;};f.flow.requestHeartbeat=()=>{heartbeatRequests++;};f.flow.usage=()=>({...usage(),nextServiceAt:dueAt,nextServiceDomain:'control' as const,nextServiceAction:action})as any;
 f.flow.service=async()=>{services++;assert.ok(f.now>=dueAt);dueAt=f.now+20000;return {kind:action==='peer-pong'?'pong':'unsubscribe'};};
 assert.equal(await f.runner.step(),'audit-preparation-wait');assert.equal(services,0);assert.equal(supportRequests+heartbeatRequests,0);assert.equal(f.auditCalls,0);
 f.advance(1000);await f.runner.step();assert.equal(services,1);assert.equal(supportRequests+heartbeatRequests,0);await f.runner.step();assert.equal(f.auditCalls,1);assert.equal(f.runner.status().counters.auditedWindows,1);await f.runner.stop();
});

test('early heartbeat runway preparation respects the control gate without moving support or requesting a blocked heartbeat',async()=>{
 const f=fixture();f.importActual();await f.runner.step();f.advance(70000);f.refresh();let heartbeatRequests=0,services=0;
 const usage=f.flow.usage.bind(f.flow),rpcUsage=f.rpc.usage.bind(f.rpc),controlReadyAt=f.now+2000;
 f.flow.requestHeartbeat=()=>{heartbeatRequests++;};f.flow.usage=()=>({...usage(),nextServiceAt:controlReadyAt,nextServiceDomain:'control' as const,nextServiceAction:'heartbeat' as const});f.flow.service=async()=>{services++;return {kind:'idle'};};
 f.rpc.usage=()=>({...rpcUsage(),rpcDispatchWindow:{readyAt:f.now,physicalBusy:false},controlDispatchWindow:{readyAt:controlReadyAt,physicalBusy:false}})as any;
 assert.equal(await f.runner.step(),'gate-wait');assert.equal(heartbeatRequests,0);assert.equal(services,0);assert.equal(f.auditCalls,0);assert.ok(f.records.some(row=>row.kind==='native-audit-dispatch-state'&&row.data.nextAction==='await-control-runway-gate'));await f.runner.stop();
});

test('closed owner admission and unsettled shared physical gate start no verification, audit or source work',async()=>{
 const f=fixture();f.seed(1);f.setAllow(false);assert.equal(await f.runner.step(),'closed');assert.equal(f.resolveCalls,0);assert.equal(f.rpcCalls.length,0);assert.equal(f.flowActions.length,0);f.setAllow(true);f.setPhysicalBusy(true);await f.runner.step();assert.equal(f.resolveCalls,0);assert.equal(f.rpcCalls.length,0);f.setPhysicalBusy(false);await f.runner.step();assert.equal(f.resolveCalls,1);await f.runner.stop();assert.equal(f.runner.status().running,false);assert.equal(f.runner.status().liveTradingEnabled,false);
});
test('due native setup retains its service opportunity after deferred, busy or backoff outcomes without origin-preparation fallthrough',async()=>{
 for(const kind of ['deferred','busy','backoff','closed']){const f=fixture();f.importActual();await f.runner.step();f.seed(1);const usage=f.flow.usage.bind(f.flow);f.flow.usage=()=>({...usage(),nextServiceAt:f.now});f.flow.service=async()=>({kind});const before=f.records.filter(r=>r.kind==='native-origin-verification-service-preparation').length;assert.equal(await f.runner.step(),kind);assert.equal(f.resolveCalls,0);assert.equal(f.records.filter(r=>r.kind==='native-origin-verification-service-preparation').length,before);assert.equal(f.rpcCalls.length,0);await f.runner.stop();}
});

test('due native control uses the shared control window during an HTTP-only cooldown',async()=>{
 const f=fixture();f.importActual();await f.runner.step();const usage=f.rpc.usage.bind(f.rpc),flowUsage=f.flow.usage.bind(f.flow);let controls=0;
 f.rpc.usage=()=>{const u=usage(),blocked={...u.dispatchWindow,readyAt:f.now+5000,waitMs:5000};return {...u,dispatchWindow:blocked,rpcDispatchWindow:blocked,controlDispatchWindow:u.dispatchWindow};};
 f.flow.usage=()=>({...flowUsage(),nextServiceAt:f.now,nextServiceDomain:'control' as const});f.flow.service=async()=>{controls++;return {kind:'ping'};};
 assert.equal(await f.runner.step(),'ping');assert.equal(controls,1);assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().counters.qualityGaps,0);f.setPhysicalBusy(true);assert.equal(await f.runner.step(),'wait','a domain cooldown never bypasses unsettled physical ownership');assert.equal(controls,1);await f.runner.stop();
});

test('due native support and ready audits use the RPC window during a control-only cooldown',async()=>{
 const f=fixture({forcePredictiveFeatures:true});f.importActual();await f.runner.step();const usage=f.rpc.usage.bind(f.rpc),flowUsage=f.flow.usage.bind(f.flow);let supportDue=true,supportCalls=0;
 f.rpc.usage=()=>{const u=usage(),blocked={...u.dispatchWindow,readyAt:f.now+5000,waitMs:5000};return {...u,dispatchWindow:blocked,rpcDispatchWindow:u.dispatchWindow,controlDispatchWindow:blocked};};
 f.flow.usage=()=>({...flowUsage(),nextServiceAt:supportDue?f.now:f.now+20000,nextServiceDomain:supportDue?'rpc' as const:'control' as const});const service=f.flow.service.bind(f.flow);f.flow.service=async(signal,admission)=>{if(supportDue){supportDue=false;supportCalls++;f.refresh();return {kind:'support'};}return service(signal,admission);};
 assert.equal(await f.runner.step(),'support');assert.equal(supportCalls,1);f.advance(70000);f.refresh();await f.runner.step();assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.predictiveNotRejected,1);assert.equal(f.runner.status().counters.qualityGaps,0);await f.runner.stop();
});

test('an RPC cooldown defers audit preparation without manufacturing completeness or a source gap',async()=>{
 const f=fixture();f.importActual();await f.runner.step();f.advance(70000);const usage=f.rpc.usage.bind(f.rpc);f.rpc.usage=()=>{const u=usage();return {...u,rpcDispatchWindow:{...u.dispatchWindow,readyAt:f.now+5000,waitMs:5000}};};
 assert.equal(await f.runner.step(),'wait');assert.equal(f.rpcCalls.length,0);assert.equal(f.auditCalls,0);assert.equal(f.records.some(r=>r.kind==='native-shared-audit-ceiling-requested'),false);assert.equal(f.runner.status().counters.qualityGaps,0);assert.equal(f.runner.status().counters.predictiveAssessments,0);await f.runner.stop();
});

test('known structural outside-family seed is excluded once without converting its provisional token into an unsupported market',async()=>{
 const f=fixture({refuseVerification:100,refuseReason:'MIGRATION_IDENTITY_OUTSIDE_PUMP_PROGRAM_FAMILY'});f.seed(1);await f.runner.step();let row=f.runner.status().watch.rows[0]!;assert.equal(row.state,'PERMANENTLY_UNSUPPORTED');assert.equal(row.mint,null);assert.match(row.reason,/OUTSIDE_PUMP_PROGRAM_FAMILY/);f.advance(61000);await f.steps(3);assert.equal(f.resolveCalls,1);assert.equal(f.runner.status().verificationQueue,0);f.seed(1);await f.runner.step();assert.equal(f.resolveCalls,1);await f.runner.stop();
});

test('SYNTHETIC migration churn retains queued identities without capacity eviction and reaches newer identities',async()=>{
 const f=fixture();for(let i=1;i<=300;i++)f.seed(i);await f.steps(400);const s=f.runner.status(),latest=f.runner.watch.lookupIdentity(sig(300),f.now);assert.ok(latest);assert.notEqual(latest.verifiedAt,null,'latest retained identity must not remain unqueued behind an arbitrary capacity');assert.ok(s.verificationQueue<=s.watch.summary.unverified,'unreachable/terminal verification seeds do not consume queue capacity');assert.equal(f.rpcCalls.length,0,'synthetic resolver churn is not provider capacity evidence');await f.runner.stop();
});

for(const jitterMs of [50,100])test(`SYNTHETIC six strong scopes retain every rolling predictive decision with ${jitterMs} ms step jitter and 200 ms audit responses`,async()=>{
 const f=fixture({maximumDeep:6,responseDelayMs:200,forcePredictiveFeatures:true});const mints=Array.from({length:6},(_,i)=>f.seed(i+1));await f.steps(20);assert.equal(f.runner.status().candidates.length,6);f.advance(70000);
 const firstEnd=Math.floor(f.now/10000)*10000,lastEnd=firstEnd+20000;
 for(let i=0;i<1000&&f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt<=lastEnd).length<18;i++){await f.runner.step();f.advance(jitterMs);}
 const assessments=f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt<=lastEnd);
 assert.equal(assessments.length,18,JSON.stringify({status:f.runner.status().counters,audits:f.records.filter(r=>r.kind==='native-candidate-window-audit').map(r=>({mint:r.data.mint,status:r.data.result.status,reason:r.data.result.reason,missing:r.data.result.missingNotifications,required:r.data.result.requiredSignatures.length})),at:f.now}));
 assert.deepEqual([...new Set(assessments.map(r=>r.data.windowEndAt))],[firstEnd,firstEnd+10000,lastEnd]);
 for(const end of [firstEnd,firstEnd+10000,lastEnd]){const rows=assessments.filter(r=>r.data.windowEndAt===end);assert.equal(rows.length,6);assert.deepEqual(new Set(rows.map(r=>r.data.mint)),new Set(mints));for(const row of rows){assert.equal(row.data.assessment.status,'not-rejected');assert.equal(row.data.financialQualification,false);assert.ok(row.data.at>=end&&row.data.at<end+10000);assert.equal(row.data.auditAvailableAt,row.data.at);}}
 assert.equal(f.runner.status().counters.decisionDeadlineMisses,0);assert.equal(f.runner.status().counters.predictiveUnavailable,0);assert.equal(f.records.some(r=>r.kind==='native-predictive-window-expired'),false);assert.equal(f.rpcCalls.length,18);for(const call of f.rpcCalls){assert.equal(call.method,'getSignaturesForAddress');assert.equal((call.params[1] as any).limit,100,'the frozen adaptive profile starts with a complete bounded100-row page for this low-count fixture');}for(let i=1;i<f.rpcCalls.length;i++)assert.ok(f.rpcCalls[i]!.at-f.rpcCalls[i-1]!.at>=250);assert.equal(f.maximumInFlight,1);assert.equal(f.runner.status().candidates.length,6);await f.runner.stop();
});

test('SYNTHETIC slow settled audit response exceeds its per-page operation envelope without a false predictive decision or hidden retry',async()=>{
 const f=fixture({forcePredictiveFeatures:true,responseDelayMs:2200});f.importActual();await f.runner.step();f.advance(70000);await f.runner.step();await f.runner.step();
 const audit=f.records.find(r=>r.kind==='native-candidate-window-audit');assert.ok(audit);assert.equal(audit.data.result.status,'unavailable');assert.equal(audit.data.result.reason,'NATIVE_AUDIT_PAGE_OPERATION_BOUND');assert.equal(audit.data.result.availableAt-audit.data.result.startedAt,2200);assert.equal(f.rpcCalls.length,1);assert.equal(f.maximumInFlight,1);assert.equal(f.runner.status().counters.predictiveAssessments,0);assert.equal(f.runner.status().counters.auditUnavailable,1);assert.equal(f.records.some(r=>r.kind==='native-predictive-assessment'),false);assert.equal(f.runner.status().financialExecutionAuthorized,false);await f.runner.stop();
});


test('served-node context below the audit floor cannot become an independent predictive pass',async()=>{
 const f=fixture({forcePredictiveFeatures:true,auditRpcError:'COMPONENT_RPC_ERROR_-32016'});f.importActual();await f.runner.step();f.advance(70000);await f.runner.step();await f.runner.step();
 const audit=f.records.find(r=>r.kind==='native-candidate-window-audit'),s=f.runner.status();assert.ok(audit);assert.equal(audit.data.result.reason,'COMPONENT_RPC_ERROR_-32016');assert.equal(audit.data.result.status,'unavailable');assert.equal(audit.data.result.complete,false);assert.equal(f.rpcCalls.length,1,'the unavailable audit does not retry within this service turn');assert.ok(Number.isSafeInteger((f.rpcCalls[0]!.params[1] as any).minContextSlot));assert.equal((f.rpcCalls[0]!.params[1] as any).minContextSlot,audit.data.result.strictInteriorSlots.upper);assert.equal(s.counters.auditUnavailable,1);assert.equal(s.counters.auditedWindows,0);assert.equal(s.counters.predictiveAssessments,0);assert.equal(s.counters.predictiveNotRejected,0);assert.equal(f.records.some(r=>r.kind==='native-predictive-assessment'),false);assert.equal(s.financialExecutionAuthorized,false);assert.equal(s.financialWriterOpened,false);await f.runner.stop();
});

test('SYNTHETIC protocol-aware audited predictive pass remains shadow-only with strict baseline unavailable and no financial qualification',async()=>{
 const f=fixture({shadow:true,forcePredictiveFeatures:true});f.importActual();await f.runner.step();await f.warm();const status=f.runner.status();assert.equal(status.dataContract,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW);assert.ok(status.decisions.every(row=>row.stage.startsWith('shadow-predictive-')));assert.ok(status.counters.predictiveAssessments>0);assert.ok(status.counters.strictV2BaselineUnavailableViews>0);assert.ok(status.counters.protocolAwareShadowViews>0);const decision=f.records.find(r=>r.kind==='native-predictive-assessment')!.data;assert.equal(decision.strictV2BaselineUnavailable,true);assert.equal(decision.baselineFeatureSemantics,'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW');assert.equal(decision.protocolPoolEffects.count,1);assert.match(decision.assessmentScope,/shadow/);assert.equal(decision.financialQualification,false);assert.equal(status.financialExecutionAuthorized,false);assert.equal(status.financialWriterOpened,false);assert.equal(status.liveTradingEnabled,false);assert.equal(f.runner.checkpoint().dataContract,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW);await f.runner.stop();
});

/** SYNTHETIC high-address-activity stress: extra notices are nontrades, not
 * invented buying. Complete ordinary features and independent rows stay exact. */
function addBusyHistory(f:ReturnType<typeof fixture>,mint:string,count=3000){
 const state=f.states.get(mint)!;const end=Math.floor(f.now/10000)*10000,start=end-60000;
 for(let i=0;i<count;i++){const availableAt=start+1+Math.floor(i*59998/count),slot=(state.scope.minSlot??original.slot)+100+Math.floor((availableAt-state.openedAt!)/1000)*10;state.notes.push({signature:sig(200000+i),slot,receivedAt:availableAt,availableAt,success:true,rawHash:'b'.repeat(64),parsedEvents:0,eventsAccepted:0,duplicate:false,correction:false,classification:'nontrade',reason:null,chainBlockTime:null});}
 state.notes.sort((a,b)=>a.availableAt-b.availableAt);f.refresh();
}
test('SYNTHETIC busy audit yields one page per step and services a due native control between pages without backdating',async()=>{
 const f=fixture({forcePredictiveFeatures:true,responseDelayMs:667});const mint=f.importActual();await f.runner.step();f.advance(70000);addBusyHistory(f,mint);const target=Math.floor(f.now/10000)*10000;
 await f.runner.step();assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.predictiveAssessments,0);assert.equal(f.runner.status().candidates[0]!.auditSession!.pendingPage,2);
 f.setHeadroom(0);await f.runner.step();assert.equal(f.rpcCalls.length,1,'counted control takes its own physical service opportunity');assert.notEqual(f.runner.status().lastOutcome,'audit:'+mint);
 f.setHeadroom(10000);for(let i=0;i<4&&f.runner.status().counters.predictiveAssessments===0;i++){const before=f.rpcCalls.length;await f.runner.step();assert.ok(f.rpcCalls.length-before<=1);}
 const audit=f.records.find(r=>r.kind==='native-candidate-window-audit')!.data.result;assert.equal(audit.status,'verified');assert.equal(audit.pages.length,4);assert.ok(audit.availableAt-audit.startedAt>2000,'whole audit honestly spans multiple per-page bounds');assert.equal(f.runner.status().counters.predictiveAssessments,1);assert.ok(f.records.find(r=>r.kind==='native-predictive-assessment')!.data.at<target+10000);assert.equal(f.maximumInFlight,1);await f.runner.stop();
});
test('SYNTHETIC gap after page one cancels its generation and cannot qualify using later retained history',async()=>{
 const f=fixture({forcePredictiveFeatures:true,responseDelayMs:680}),mint=f.importActual();await f.runner.step();f.advance(70000);addBusyHistory(f,mint);await f.runner.step();assert.equal(f.rpcCalls.length,1);f.runner.onGap({mint,at:f.now,reason:'SYNTHETIC_CONFIRMED_CORRECTION'});await f.steps(3);assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.predictiveAssessments,0);assert.equal(f.records.some(r=>r.kind==='native-predictive-assessment'),false);assert.equal(f.runner.status().counters.qualityGaps,1);const cancelled=f.records.find(r=>r.kind==='native-candidate-audit-cancelled-diagnostic')!.data;assert.equal(cancelled.diagnosticResult.pages.length,1);assert.equal(cancelled.admitted,false);assert.equal(cancelled.physicalSettlementClaimed,false);assert.equal(cancelled.cancelledAt,cancelled.recordedAt);assert.ok(cancelled.deadlineAt>cancelled.targetEndAt);await f.runner.stop();
});

test('SYNTHETIC graceful stop preserves a between-page audit diagnostic without dispatching more history',async()=>{
 const f=fixture({forcePredictiveFeatures:true,responseDelayMs:680}),mint=f.importActual();await f.runner.step();f.advance(70000);addBusyHistory(f,mint);await f.runner.step();assert.equal(f.rpcCalls.length,1);await f.runner.stop();const cancelled=f.records.find(r=>r.kind==='native-candidate-audit-cancelled-diagnostic')!.data;assert.equal(cancelled.diagnosticResult.pages.length,1);assert.equal(cancelled.admitted,false);assert.equal(cancelled.physicalSettlementClaimed,false);assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.predictiveAssessments,0);assert.equal(f.runner.status().running,false);
});

/** SYNTHETIC replay of the actual Ag9 timing shape: ACK138ms before an aligned
 * start, with no independent lower fence until after that start. */
test('independent lower-fence warming is not a scheduler deadline miss; the next complete target can still be assessed',async()=>{
 const f=fixture();const mint=f.importActual();f.advance(Math.floor(f.now/10000)*10000+9862-f.now);await f.runner.step();const ack=f.now,firstEnd=Math.ceil(ack/10000)*10000+60000;
 const snapshot=f.flow.snapshot.bind(f.flow);let lower:State['upper']=null;
 f.flow.snapshot=(key,when=f.now)=>{const v=snapshot(key,when);if(!v)return null;const initial=v.openingSupportContext?{...v.openingSupportContext,availableAt:ack-500}:null;return {...v,openingSupportContext:initial,supportContexts:[...(lower?[lower]:[]),...(v.supportContext&&v.supportContext.availableAt>ack?[v.supportContext]:[])]};};
 f.advance(500);f.refresh();lower={...f.states.get(mint)!.upper!};f.advance(firstEnd+100-f.now);await f.steps(3);assert.equal(f.rpcCalls.length,0);assert.ok(f.records.some(r=>r.kind==='native-independent-audit-warming'&&r.data.windowStartAt===firstEnd-60000));
 f.advance(firstEnd+10100-f.now);await f.steps(3);assert.equal(f.runner.status().counters.decisionDeadlineMisses,0,'a target without an independent lower fence was never dispatch-ready');assert.equal(f.runner.status().counters.auditFenceWarmingWindows,1);assert.equal(f.records.some(r=>r.kind==='native-predictive-window-expired'&&r.data.windowEndAt===firstEnd),false);assert.equal(f.runner.status().counters.predictiveAssessments,1);assert.equal(f.runner.status().financialExecutionAuthorized,false);await f.runner.stop();
});

test('independently fence-ready work still misses its deadline when the shared physical gate prevents every dispatch',async()=>{
 const f=fixture();f.importActual();await f.runner.step();f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000;f.setPhysicalBusy(true);await f.runner.step();assert.equal(f.rpcCalls.length,0);f.advance(target+10001-f.now);await f.runner.step();assert.equal(f.rpcCalls.length,0);assert.equal(f.auditCalls,0);assert.equal(f.runner.status().counters.decisionDeadlineMisses,1);assert.equal(f.runner.status().counters.auditFenceWarmingWindows,0);assert.ok(f.records.some(r=>r.kind==='native-predictive-window-expired'&&r.data.windowEndAt===target));assert.equal(f.runner.status().counters.predictiveAssessments,0);await f.runner.stop();
});

test('a partial physical history timeout remains an unavailable evaluation and a true deadline miss',async()=>{
 const f=fixture({auditRpcError:'PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'});f.importActual();await f.runner.step();f.advance(70000);const target=Math.floor(f.now/10000)*10000;await f.steps(3);assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.auditUnavailable,1);assert.equal(f.runner.status().counters.predictiveAssessments,0);f.setPhysicalBusy(true);f.advance(target+10001-f.now);await f.runner.step();assert.equal(f.runner.status().counters.decisionDeadlineMisses,1);assert.equal(f.runner.status().counters.auditFenceWarmingWindows,0);assert.ok(f.records.some(r=>r.kind==='native-candidate-window-audit'&&r.data.result.reason==='PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT'));await f.runner.stop();
});

test('a known independent lower context does not copy a busy notification ledger merely to classify dispatch readiness',async()=>{
 const f=fixture({forcePredictiveFeatures:true});const mint=f.importActual();await f.runner.step();f.advance(70000);f.refresh();const original=f.flow.notificationLedger.bind(f.flow);let reads=0;f.flow.notificationLedger=key=>{reads++;return original(key);};f.setPhysicalBusy(true);await f.runner.step();assert.equal(reads,0,'the immutable lower context already proves this classification prerequisite');assert.equal(f.rpcCalls.length,0);f.setPhysicalBusy(false);await f.runner.step();assert.equal(reads,1,'one exact ledger capture is reused by audit lower-fence validation');assert.equal(f.runner.status().counters.predictiveNotRejected,1);assert.equal(f.runner.status().counters.auditFenceWarmingWindows,0);assert.equal(f.runner.status().candidates[0]!.mint,mint);await f.runner.stop();
});

for(const failure of ['none','connection','closed-admission'] as const)test(`diagnostic audit tail uses exact ACK generation and cannot alter frozen features (${failure})`,async()=>{
 const f=fixture(),mint=f.importActual();let connectionId=1;
 const snapshot=f.flow.snapshot.bind(f.flow);f.flow.snapshot=(m,at)=>{const view=snapshot(m,at);return view?{...view,connectionId}:null;};
 const ledger=f.flow.notificationLedger.bind(f.flow);f.flow.notificationLedger=m=>ledger(m).map(n=>({...n,subscriptionMint:m,subscriptionPool:f.states.get(m)!.scope.pool,subscriptionId:1,connectionId}));
 const call=f.rpc.call.bind(f.rpc);f.rpc.call=async<T>(method:string,params:unknown[]=[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>{
  const rows=await call<any[]>(method,params,signal,admission),state=f.states.get(mint)!;f.advance(1);
  const note:NativeNotification={signature:sig(881199),slot:state.upper!.slot-1,receivedAt:f.now,availableAt:f.now,success:true,rawHash:'c'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null};state.notes.push(note);
  state.window!.ingest({identity:{kind:'program-log',signature:note.signature,program:PUMP_AMM_PROGRAM_ID.toBase58(),logIndex:0,frameOrdinal:0},mint,wallet:new PublicKey(Buffer.alloc(32,7)).toBase58(),side:'buy',quoteLamports:'250000000',tokenUnits:'1000000',receivedAt:f.now,commitment:'confirmed',slot:note.slot});f.runner.onTrade();
  rows.push({signature:note.signature,slot:note.slot,err:null,blockTime:Math.floor(f.now/1000),confirmationStatus:'confirmed'});rows.sort((a,b)=>b.slot-a.slot);
  if(failure==='connection')connectionId=2;if(failure==='closed-admission')f.setAllow(false);
  return rows as T;
 };
 await f.runner.step();await f.warm();const audit=f.records.find(r=>r.kind==='native-candidate-window-audit');assert.ok(audit);assert.equal(f.rpcCalls.length,1);
 if(failure==='none'){assert.equal(audit.data.result.status,'verified',audit.data.result.reason);assert.equal(audit.data.result.postSnapshotTail.addedSignatures.length,1);assert.equal(audit.data.result.requiredSignatures.includes(sig(881199)),false);const assessment=f.records.find(r=>r.kind==='native-predictive-assessment');assert.ok(assessment);assert.equal(assessment.data.assessment.features.tradeCount,0,'post-target newly ingested buy remains in its actual later open bucket, never backdated into predictive features');assert.equal(f.runner.status().counters.auditedWindows,1);}
 else{assert.equal(audit.data.result.status,'unavailable');assert.equal(audit.data.result.reason,'NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');assert.equal(f.records.some(r=>r.kind==='native-predictive-assessment'),false);assert.equal(f.runner.status().counters.auditedWindows,0);}
 assert.equal(f.runner.status().financialWriterOpened,false);assert.equal(f.runner.status().financialExecutionAuthorized,false);await f.runner.stop();
});


test('SYNTHETIC one pool timeout does not retry its unavailable target or starve five other ready audits',async()=>{
 const f=fixture({maximumDeep:6,responseDelayMs:700,firstAuditTimeout:true});for(let i=1;i<=6;i++)f.seed(i);await f.steps(30);f.advance(70000);const target=Math.floor(f.now/10000)*10000;
 for(let i=0;i<80&&f.runner.status().counters.predictiveAssessments<5;i++){await f.runner.step();f.advance(100);}
 const s=f.runner.status(),results=f.records.filter(r=>r.kind==='native-candidate-window-audit'&&r.data.result.target.endAt===target),assessments=f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt===target);
 assert.equal(results.length,6);assert.equal(results.filter(r=>r.data.result.status==='unavailable').length,1);assert.equal(assessments.length,5);assert.equal(s.counters.auditUnavailable,1);assert.equal(s.counters.decisionDeadlineMisses,0);assert.equal(f.rpcCalls.length,6,'unavailable same-window evidence is not retried or manufactured complete');assert.ok(assessments.every(r=>r.data.at<target+10000));assert.equal(f.maximumInFlight,1);await f.runner.stop();
});

test('audit dispatch evidence coalesces repeated physical waits without inventing a provider failure or physical start',async()=>{
 const f=fixture();const mint=f.importActual();await f.runner.step();f.advance(70000);f.refresh();const at=f.now,target=Math.floor(at/10000)*10000;f.setPhysicalBusy(true);await f.steps(100);
 const rows=f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.mint===mint);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.data.reason),['eligible','rpc-gate-wait']);assert.equal(rows[1]!.data.nextAction,'await-physical-settlement');assert.equal(rows[1]!.data.context.physicalBusy,true);assert.equal(rows[1]!.data.context.inFlight,1);assert.equal(rows[1]!.data.physicalStartClaimed,false);assert.equal(rows[1]!.data.windowEndAt,target);assert.equal(rows[1]!.data.firstReadyAt,at);assert.equal(rows[1]!.data.decisionDeadlineAt,target+9999);assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().counters.auditUnavailable,0);const trace=f.runner.status().candidates[0]!.auditDispatch!;assert.equal(trace.reasonCounts['rpc-gate-wait'],100);assert.equal(trace.transitionRecords,2);assert.equal(trace.omittedTransitions,0);await f.runner.stop();
 const summary=f.records.find(r=>r.kind==='native-audit-dispatch-summary'&&r.data.mint===mint)!.data;assert.equal(summary.reasonCounts['rpc-gate-wait'],100);assert.equal(summary.final,true);assert.equal(summary.physicalSettlementClaimed,false);
});

test('audit state transition retention is bounded and target expiry preserves the actual last wait and full reason counts',async()=>{
 const f=fixture();const mint=f.importActual();await f.runner.step();f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000,usage=f.rpc.usage.bind(f.rpc);let occupied=true;
 f.rpc.usage=()=>{const actual=usage();return {...actual,inFlight:occupied?1:0,waitingOrOperating:occupied,dispatchWindow:{...actual.dispatchWindow,physicalBusy:occupied,readyAt:f.now+(occupied?0:250)}};};
 for(let i=0;i<100;i++){occupied=i%2===0;await f.runner.step();f.advance(1);}const state=f.runner.status().candidates[0]!.auditDispatch!;assert.equal(state.reasonCounts['rpc-gate-wait'],100);assert.equal(state.transitionRecords,NATIVE_AUDIT_DISPATCH_DIAGNOSTICS.maximumTransitionRecordsPerTarget);assert.ok(state.omittedTransitions>0);assert.equal(f.rpcCalls.length,0);
 f.advance(target+10001-f.now);await f.runner.step();const expiry=f.records.find(r=>r.kind==='native-predictive-window-expired'&&r.data.mint===mint&&r.data.windowEndAt===target)!.data;assert.equal(expiry.dispatchTrace.windowEndAt,target);assert.equal(expiry.dispatchTrace.reasonCounts['rpc-gate-wait'],100);assert.equal(expiry.dispatchTrace.lastState.nextAction,'await-shared-pacing-or-http-cooldown');assert.equal(expiry.dispatchTrace.lastState.context.physicalBusy,false);assert.equal(expiry.dispatchTrace.final,true);assert.equal(f.runner.status().counters.decisionDeadlineMisses,1);const records=f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.mint===mint&&r.data.windowEndAt===target);assert.equal(records.length,NATIVE_AUDIT_DISPATCH_DIAGNOSTICS.maximumTransitionRecordsPerTarget);await f.runner.stop();
});

test('actual audit page admission and validated outcome remain separate from local readiness diagnostics',async()=>{
 const f=fixture();const mint=f.importActual();await f.runner.step();await f.warm();const states=f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.mint===mint);assert.ok(states.some(r=>r.data.reason==='ceiling-refresh'));assert.ok(states.some(r=>r.data.reason==='audit-selected'&&r.data.context.selectedMint===mint));const admitted=states.find(r=>r.data.reason==='page-admission')!.data;assert.equal(admitted.context.requestedLimit,100);assert.equal(admitted.physicalStartClaimed,false);assert.ok(states.some(r=>r.data.reason==='page-response'&&r.data.nextAction==='validate-logical-session'));const summary=f.records.find(r=>r.kind==='native-audit-dispatch-summary'&&r.data.mint===mint)!.data;assert.equal(summary.outcome,'audit-result:verified');assert.equal(summary.physicalSettlementClaimed,false);assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.predictiveAssessments,1);await f.runner.stop();
});

test('ready peer diagnostics identify the single selected mint without claiming every target was dispatched',async()=>{
 const f=fixture({maximumDeep:6});for(let i=1;i<=6;i++)f.seed(i);await f.steps(30);f.advance(70000);f.refresh();await f.runner.step();const selected=f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.reason==='audit-selected'),peers=f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.reason==='peer-selected');assert.equal(selected.length,1);assert.equal(peers.length,5);assert.equal(f.rpcCalls.length,1);assert.equal(selected[0]!.data.context.readyOrder,0);assert.ok(peers.every(r=>r.data.context.selectedMint===selected[0]!.data.mint&&r.data.mint!==selected[0]!.data.mint&&r.data.nextAction==='await-selected-peer-audit-page'));assert.deepEqual(peers.map(r=>r.data.context.readyOrder),[1,2,3,4,5]);assert.ok(peers.every(r=>r.data.context.readyCandidates===6));await f.runner.stop();
});

test('a settled but unrecoverable chapter guard is distinguished from an actual in-flight request in audit diagnostics',async()=>{
 const f=fixture();f.importActual();await f.runner.step();f.advance(70000);f.refresh();const usage=f.rpc.usage.bind(f.rpc);f.rpc.usage=()=>{const actual=usage();return {...actual,inFlight:0,waitingOrOperating:false,dispatchWindow:{...actual.dispatchWindow,physicalBusy:true,actualPhysicalBusy:false,needsChapterRecovery:true,recoveryAdmissible:false}};};assert.equal(await f.runner.step(),'wait');const row=f.records.find(r=>r.kind==='native-audit-dispatch-state'&&r.data.reason==='rpc-gate-wait')!.data;assert.equal(row.nextAction,'await-shared-gate-recovery');assert.equal(row.context.actualPhysicalBusy,false);assert.equal(row.context.inFlight,0);assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().counters.auditUnavailable,0);await f.runner.stop();
});

test('an expired between-page audit cannot relabel a newly observed target or erase its first-ready timestamp',async()=>{
 const f=fixture({forcePredictiveFeatures:true,responseDelayMs:680}),mint=f.importActual();await f.runner.step();f.advance(70000);addBusyHistory(f,mint);await f.runner.step();const old=Math.floor(f.now/10000)*10000;assert.equal(f.runner.status().candidates[0]!.auditSession!.pendingPage,2);f.advance(old+10001-f.now);const observedAt=f.now;f.refresh();f.setPhysicalBusy(true);await f.runner.step();const current=f.runner.status().candidates[0]!.auditDispatch!;assert.equal(current.windowEndAt,old+10000);assert.equal(current.firstReadyAt,observedAt);assert.equal(current.final,false);assert.equal(current.lastState.reason,'rpc-gate-wait');const oldSummary=f.records.find(r=>r.kind==='native-audit-dispatch-summary'&&r.data.windowEndAt===old)!.data;assert.equal(oldSummary.outcome,'decision-deadline-expired');assert.equal(oldSummary.final,true);assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.predictiveAssessments,0);await f.runner.stop();
});

for(const failure of ['none','rpc-item','malformed-item','retired-item'] as const)test(`SYNTHETIC six quiet first pages share one bounded request with independent logical outcomes (${failure})`,async()=>{
 const f=fixture({maximumDeep:6,quietBatch:true,...(failure==='rpc-item'?{batchErrorIndex:2}:{}),...(failure==='malformed-item'?{batchMalformedIndex:2}:{}),...(failure==='retired-item'?{retireBatchIndex:2}:{})});for(let i=1;i<=6;i++)f.seed(i);await f.steps(30);f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000;await f.runner.step();const s=f.runner.status(),results=f.records.filter(r=>r.kind==='native-candidate-window-audit'&&r.data.result.target.endAt===target);assert.equal(f.batchCalls.length,1);assert.equal(f.batchCalls[0]!.logicalQueries,6);assert.equal(f.rpcCalls.length,0,'no hidden per-pool HTTP requests');assert.equal(s.counters.predictiveAssessments,failure==='none'?6:5);assert.equal(s.counters.auditUnavailable,failure==='rpc-item'||failure==='malformed-item'?1:0);assert.equal(s.counters.qualityGaps,failure==='retired-item'?1:0);assert.equal(f.maximumInFlight,1);assert.ok(results.filter(r=>r.data.result.status==='verified').every(r=>r.data.availableAt<target+10000));assert.ok(f.records.some(r=>r.kind==='native-candidate-audit-batch-return'&&r.data.physicalHttpStarts===1&&r.data.logicalQueries===6));assert.equal(s.financialWriterOpened,false);await f.runner.stop();
});

test('a pre-dispatch quiet-batch admission refusal retains logical pages for a separately admitted next service turn',async()=>{
 const f=fixture({maximumDeep:3,quietBatch:true});for(let i=1;i<=3;i++)f.seed(i);await f.steps(20);f.advance(70000);f.refresh();const original=f.rpc.callSignatureHistoryBatch!;let refused=false;f.rpc.callSignatureHistoryBatch=async(...args)=>{if(!refused){refused=true;throw Error('PILOT_RPC_COMPONENT_ADMISSION_CLOSED');}return original(...args);};await f.runner.step();assert.equal(f.batchCalls.length,0);assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().counters.auditUnavailable,0);assert.equal(f.runner.status().counters.predictiveAssessments,0);assert.ok(f.runner.status().candidates.every(c=>c.auditSession?.pendingPage===1));const refusal=f.records.find(r=>r.kind==='native-candidate-audit-batch-unavailable')!.data;assert.equal(refusal.logicalPagesRetainedForScheduling,true);assert.equal(refusal.physicalHttpStarts,null);await f.runner.step();assert.equal(f.batchCalls.length,1);assert.equal(f.runner.status().counters.predictiveAssessments,3);await f.runner.stop();
});

test('one cooling peer is excluded from a healthy quiet batch without dropping its own pending audit target',async()=>{
 const f=fixture({maximumDeep:6,quietBatch:true});for(let i=1;i<=6;i++)f.seed(i);await f.steps(30);f.advance(70000);f.refresh();const peers=[...f.states.values()],cooling=peers[3]!;f.setBatchCoolingMint(cooling.scope.pool);await f.runner.step();assert.equal(f.batchCalls.length,1);assert.equal(f.batchCalls[0]!.logicalQueries,5);assert.equal(f.batchCalls[0]!.pools.includes(cooling.scope.pool),false);assert.equal(f.runner.status().counters.predictiveAssessments,5);const retained=f.runner.status().candidates.find(c=>c.mint===cooling.scope.mint);assert.ok(retained?.auditSession?.pendingPage===1,'unserved target remains pending; not declared complete');assert.equal(f.rpcCalls.length,0);f.setBatchCoolingMint(null);f.advance(250);await f.steps(8);assert.equal(f.rpcCalls.length,1);assert.equal(f.runner.status().counters.predictiveAssessments,6);await f.runner.stop();
});

test('closed admission and occupied shared physical work prevent every quiet-batch start',async()=>{
 const f=fixture({maximumDeep:3,quietBatch:true});for(let i=1;i<=3;i++)f.seed(i);await f.steps(20);f.advance(70000);f.refresh();f.setPhysicalBusy(true);await f.steps(10);assert.equal(f.batchCalls.length,0);assert.equal(f.rpcCalls.length,0);f.setPhysicalBusy(false);f.setAllow(false);assert.equal(await f.runner.step(),'closed');assert.equal(f.batchCalls.length,0);assert.equal(f.runner.status().counters.predictiveAssessments,0);await f.runner.stop();
});

for(const responseDelayMs of [667,1500])test(`SYNTHETIC one busy pool and five quiet peers keep fair service with six-page ceiling and original deadline (${responseDelayMs}ms responses)`,async()=>{
 const f=fixture({maximumDeep:6,quietBatch:true,forcePredictiveFeatures:true,responseDelayMs});for(let i=1;i<=6;i++)f.seed(i);await f.steps(30);const busy=[...f.states.keys()][0]!;f.advance(70000);addBusyHistory(f,busy,5144);const target=Math.floor(f.now/10000)*10000;
 for(let i=0;i<100&&f.now<target+10100;i++){await f.runner.step();const completed=f.records.filter(r=>r.kind==='native-candidate-window-audit'&&r.data.result.target.endAt===target);if(responseDelayMs===667&&completed.length===6)break;f.advance(100);}
 const audits=f.records.filter(r=>r.kind==='native-candidate-window-audit'&&r.data.result.target.endAt===target),busyAudit=audits.find(r=>r.data.mint===busy),quiet=audits.filter(r=>r.data.mint!==busy&&r.data.result.status==='verified');assert.equal(quiet.length,5);assert.equal(f.batchCalls[0]!.logicalQueries,5);assert.ok(f.rpcCalls.every(c=>(c.params[1] as any).limit===1000),'busy continuations never enter small batches');assert.equal(f.maximumInFlight,1);
 if(responseDelayMs===667){assert.ok(busyAudit);assert.equal(busyAudit.data.result.status,'verified');assert.equal(busyAudit.data.result.pages.length,6);assert.ok(busyAudit.data.result.requiredSignatures.length>5144);assert.equal(f.rpcCalls.length,6);assert.equal(f.batchCalls.length,1);assert.ok(audits.every(r=>r.data.availableAt<target+10000));assert.equal(f.runner.status().counters.predictiveAssessments,6);}
 else{assert.ok(!busyAudit||busyAudit.data.result.status!=='verified');assert.equal(f.records.some(r=>r.kind==='native-predictive-assessment'&&r.data.mint===busy&&r.data.windowEndAt===target),false);assert.ok(f.runner.status().counters.decisionDeadlineMisses>=1);assert.ok(f.rpcCalls.length<6,'insufficient deadline never manufactures a sixth completed page');}
 await f.runner.stop();
});

test('a disabled quiet-batch optimization falls back to separately paced complete audits without losing candidate evidence',async()=>{
 const f=fixture({maximumDeep:6,quietBatch:true});for(let i=1;i<=6;i++)f.seed(i);await f.steps(30);f.advance(70000);f.refresh();const usage=f.rpc.usage.bind(f.rpc);f.rpc.usage=()=>({...usage(),signatureHistoryBatch:{disabledReason:'SYNTHETIC_BATCH_DISABLED'}});for(let i=0;i<30&&f.runner.status().counters.predictiveAssessments<6;i++){await f.runner.step();f.advance(250);}assert.equal(f.batchCalls.length,0);assert.equal(f.rpcCalls.length,6);assert.equal(f.runner.status().counters.predictiveAssessments,6);assert.equal(f.runner.status().counters.auditUnavailable,0);await f.runner.stop();
});

test('COHERENT future first window reserves discretionary runway before any predictive assessment exists',async()=>{
 const f=fixture({forcePredictiveFeatures:true});const mint=f.importActual();await f.runner.step();const opened=f.states.get(mint)!.openedAt!,firstEnd=Math.ceil(opened/10000)*10000+60000;f.advance(firstEnd-f.now-1000);f.refresh();
 const view=f.runner.deadlineView();assert.equal(view.readyCount,0);assert.equal(view.targets[0]!.eligibleAt,firstEnd);assert.equal(view.targets[0]!.deadlineAt,firstEnd+9999);assert.equal(f.runner.status().counters.predictiveAssessments,0);assert.equal(f.runner.discretionaryAdmission(1500).admitted,false,'a first-window commitment exists without lastAssessmentEnd');
 const before=f.resolveCalls;f.seed(2);await f.runner.step();assert.equal(f.resolveCalls,before,'new multi-read identity work must not cross first-window eligibility');f.advance(1000);f.refresh();for(let n=0;n<8&&!f.runner.status().counters.predictiveAssessments;n++)await f.runner.step();assert.equal(f.runner.status().counters.predictiveAssessments,1);assert.equal(f.runner.status().counters.decisionDeadlineMisses,0);await f.runner.stop();
});

test('COHERENT one origin coroutine yields after every physical read and progresses between rolling audits',async()=>{
 const f=fixture({forcePredictiveFeatures:true});f.importActual();await f.runner.step();f.advance(70000);f.refresh();await f.steps(4);assert.ok(f.runner.status().counters.predictiveAssessments>=1);
 const originalResolve=(f.runner as any).resolve,call=f.rpc.call.bind(f.rpc);let reads=0;const readAt:number[]=[];
 (f.runner as any).resolve=async(seed:any,rpc:any,signal:AbortSignal)=>{for(let n=0;n<3;n++)await rpc.call('getTransaction',[seed.signature,{commitment:n===2?'finalized':'confirmed'}],signal);return originalResolve(seed);};
 f.rpc.call=async<T>(method:string,params:unknown[]=[],signal?:AbortSignal,admission?:PilotRpcCallOptions):Promise<T>=>{if(method!=='getTransaction')return call<T>(method,params,signal,admission);signal?.throwIfAborted();assert.equal(admission?.admissionOpen?.(),true);assert.ok(admission?.latestStartAt===undefined||f.now<=admission.latestStartAt);reads++;readAt.push(f.now);f.advance(300);return {} as T;};
 const added=f.seed(2),before=f.runner.status().counters.verifiedOrigins;
 for(let n=0;n<20&&f.runner.status().counters.verifiedOrigins===before;n++){const count=reads;await f.runner.step();assert.ok(reads-count<=1,'one scheduler turn cannot hide a multi-read chain');if(reads<3)assert.equal(f.runner.status().watch.rows.find(r=>r.mint===added)?.verifiedAt??null,null,'partial proof is never an eligible origin');f.advance(100);}
 assert.equal(reads,3);assert.equal(f.runner.status().counters.verifiedOrigins,before+1);assert.ok(readAt[2]!-readAt[0]!>=600);assert.equal(f.records.filter(r=>r.kind==='native-origin-read-dispatch').length,3);assert.ok(f.records.some(r=>r.kind==='native-origin-workflow-settled'&&r.data.reads===3&&r.data.result==='verified'));await f.runner.stop();
});

test('COHERENT six declared two-second page obligations are disclosed as infeasible, without dropping scopes or evidence',async()=>{
 const f=fixture({maximumDeep:6,forcePredictiveFeatures:true});for(let n=1;n<=6;n++)f.seed(n);await f.steps(25);f.advance(70000);f.refresh();f.setPhysicalBusy(true);await f.runner.step();f.setPhysicalBusy(false);const before=f.runner.deadlineView();assert.equal(before.readyCount,6);assert.equal(before.minimumReadyWorkMs,12750);assert.equal(before.conservativeReadyEnvelopeFits,false);assert.equal(f.runner.discretionaryAdmission(250).admitted,false);assert.equal(f.runner.status().candidates.length,6,'calendar pressure does not erase required observations');
 for(let n=0;n<30&&f.runner.status().counters.predictiveAssessments<6;n++){await f.runner.step();f.advance(50);}assert.equal(f.runner.status().counters.predictiveAssessments,6,'actual fast responses may fit opportunistically; no permanent three-slot ceiling');assert.equal(f.runner.status().counters.decisionDeadlineMisses,0);await f.runner.stop();
});

async function completedFinancialFixture(maximumDeep=4){
 const f=fixture({maximumDeep,fairEconomicCompletions:true,forcePredictiveFeatures:true,respectServicePolicy:true});for(let n=1;n<=maximumDeep;n++)f.seed(n);await f.steps(30);f.advance(70000);f.refresh();
 for(let n=0;n<12&&!f.runner.certifiedCandidateMints(f.now).length;n++)await f.runner.step();
 const mint=f.runner.certifiedCandidateMints(f.now)[0];assert.ok(mint);const certificate=f.runner.currentAuditCertificate(mint,f.now);assert.ok(certificate);return {f,mint,certificate};
}

test('a completed exact certificate has request-level financial runway before speculative peer audit reservations',async t=>{
 const {f,mint,certificate}=await completedFinancialFixture();try{
  f.advance(Math.max(0,certificate.windowEndAt+3500-f.now));f.setHeadroom(10000);
  assert.equal(f.runner.deadlineView().readyCount,3);assert.equal(f.runner.discretionaryAdmission(1200).admitted,false,'the prior constituent-request guard reserves three2125ms peers ahead of already completed financial evidence');
  const plan=f.runner.financialAdmission(certificate,1200,f.now);t.diagnostic(JSON.stringify({scope:'OFFLINE same current independently audited synthetic window; not a live missed-profit claim',at:f.now,windowEndAt:certificate.windowEndAt,certificateDeadlineAt:certificate.deadlineAt,remainingCertificateMs:plan.remainingCertificateMs,requestedOperationMs:1200,peerAudits:plan.peerAuditReservationsDeferred,declaredPeerWorkMs:plan.view.minimumReadyWorkMs,oldDiscretionaryLatestStartAt:f.runner.discretionaryAdmission(1200).latestStartAt,newFinancialLatestStartAt:plan.latestStartAt}));assert.equal(plan.admitted,true);assert.equal(plan.reason,'completed-certificate-financial-priority');assert.equal(plan.bindingDeadline,'original-certificate');assert.equal(plan.latestStartAt,certificate.deadlineAt-125-1200);assert.equal(plan.remainingCertificateMs,certificate.deadlineAt-f.now);assert.equal(plan.peerAuditReservationsDeferred,3);
  const oldCertificate=structuredClone(certificate);await f.runner.step();assert.equal(f.runner.deadlineView().readyCount,2,'finished peer work is removed from the next actual plan');assert.equal(f.runner.financialAdmission(oldCertificate,1200,f.now).admitted,true);assert.equal(f.runner.currentAuditCertificate(mint,f.now)?.featuresSha256,certificate.featuresSha256);assert.equal(f.runner.status().financialWriterOpened,false);
 }finally{await f.runner.stop();}
});

test('financial priority retains mandatory native-service runway and never extends the original certificate deadline',async()=>{
 const {f,certificate}=await completedFinancialFixture(1);try{
  f.setHeadroom(1000);const blocked=f.runner.financialAdmission(certificate,1200,f.now);assert.equal(blocked.admitted,false);assert.equal(blocked.reason,'required-native-service-deadline');assert.equal(blocked.bindingDeadline,'required-native-service');assert.equal(blocked.latestStartAt,f.now+1000-125-1200);assert.equal(blocked.certificateLatestStartAt,certificate.deadlineAt-125-1200);
  f.flow.requestHeartbeat();await f.flow.service();const serviced=f.runner.financialAdmission(certificate,1200,f.now);assert.equal(f.flowActions.at(-1),'ping');assert.equal(serviced.admitted,true,'actual native service completion removes the old conflicting reservation');assert.equal(serviced.certificateLatestStartAt,blocked.certificateLatestStartAt);assert.ok(serviced.nativeLatestStartAt!>blocked.nativeLatestStartAt!);
  f.setHeadroom(20000);f.advance(Math.max(0,certificate.deadlineAt-125-1200-f.now));const last=f.runner.financialAdmission(certificate,1200,f.now);assert.equal(last.admitted,true);f.advance(1);assert.equal(f.runner.financialAdmission(certificate,1200,f.now).reason,'original-certificate-deadline');
  f.advance(certificate.deadlineAt-f.now+1);assert.equal(f.runner.financialAdmission(certificate,1,f.now).reason,'current-audit-certificate-required');assert.equal(f.runner.financialAdmission({...certificate,deadlineAt:f.now+20000},1,f.now).admitted,false,'a supplied later deadline cannot renew expired authority');
 }finally{await f.runner.stop();}
});

test('financial priority rechecks current source generation, current window, exact features and admission after each yield',async()=>{
 for(const fault of ['source','generation','subscription','features','bucket','gap','forged-certificate']as const){
  const {f,mint,certificate}=await completedFinancialFixture(1);try{
   assert.equal(f.runner.financialAdmission(certificate,1200,f.now).admitted,true);
   if(fault==='source')f.setAllow(false);if(fault==='generation')f.states.get(mint)!.openedAt!++;
   if(fault==='subscription'||fault==='features'){const snapshot=f.flow.snapshot.bind(f.flow);f.flow.snapshot=(...args)=>{const v=snapshot(...args);return v?fault==='subscription'?{...v,subscription:2}:{...v,features:v.features?{...v.features,largestBuyerBps:v.features.largestBuyerBps===10000?9999:v.features.largestBuyerBps+1}:null}:null;};}
   if(fault==='bucket')f.advance(10000-f.now%10000);if(fault==='gap')f.runner.onGap({mint,at:f.now,reason:'OFFLINE_CONFIRMED_CAPTURE_GAP'});
   const supplied=fault==='forged-certificate'?{...certificate,admittedAt:certificate.admittedAt+1}:certificate;const rejected=f.runner.financialAdmission(supplied,1200,f.now);assert.equal(rejected.admitted,false,fault);assert.equal(rejected.reason,fault==='source'?'source-admission-closed':'current-audit-certificate-required',fault);
  }finally{await f.runner.stop();}
 }
});

test('exhausting a technical priority episode preserves ordinary access to a later current audited window',async()=>{
 const {f,mint,certificate}=await completedFinancialFixture(1);try{
  assert.equal(f.runner.requestTechnicalReevaluation(mint,'entry-preparation-unavailable',certificate.windowEndAt,f.now),true);
  for(let attempt=0;attempt<3;attempt++){
   f.advance(10000);f.refresh();for(let n=0;n<8&&!f.runner.currentAuditCertificate(mint,f.now);n++)await f.runner.step();const current=f.runner.currentAuditCertificate(mint,f.now);assert.ok(current);assert.equal(f.runner.claimTechnicalReevaluation(mint,f.now),true);f.runner.requestTechnicalReevaluation(mint,'entry-preparation-unavailable',current.windowEndAt,f.now,true);
  }
  assert.equal(f.runner.watch.technicalReevaluation(mint,f.now)?.state,'EXHAUSTED');f.advance(10000);f.refresh();for(let n=0;n<8&&!f.runner.currentAuditCertificate(mint,f.now);n++)await f.runner.step();assert.ok(f.runner.currentAuditCertificate(mint,f.now));assert.deepEqual(f.runner.candidateEvaluationOrder([mint],f.now),[mint]);assert.equal(f.runner.claimTechnicalReevaluation(mint,f.now),true,'ordinary current-window admission does not inherit the spent priority episode');
 }finally{await f.runner.stop();}
});

test('COHERENT paused origin continuation cancels on stop without dispatching its pending read or admitting partial proof',async()=>{
 const f=fixture();const base=(f.runner as any).resolve;let reads=0;
 (f.runner as any).resolve=async(seed:any,rpc:any,signal:AbortSignal)=>{await rpc.call('getTransaction',[seed.signature],signal);await rpc.call('getTransaction',[seed.signature],signal);return base(seed);};
 const call=f.rpc.call.bind(f.rpc);f.rpc.call=async<T>(method:string,params:unknown[]=[],signal?:AbortSignal,options?:PilotRpcCallOptions):Promise<T>=>{if(method!=='getTransaction')return call(method,params,signal,options);signal?.throwIfAborted();reads++;return {} as T;};
 f.seed(2);await f.runner.step();assert.equal(reads,1);assert.equal(f.runner.status().counters.verifiedOrigins,0);await f.runner.stop();assert.equal(reads,1);assert.equal(f.runner.status().counters.verifiedOrigins,0);assert.equal(f.runner.status().running,false);assert.ok(f.records.some(r=>r.kind==='native-origin-workflow-settled'&&r.data.result!=='verified'));
});

test('COHERENT stale support during HTTP cooldown does not indefinitely suppress local degraded reporting',async()=>{
 const f=fixture();const mint=f.importActual();await f.runner.step();f.advance(70000);const snapshot=f.flow.snapshot.bind(f.flow),usage=f.rpc.usage.bind(f.rpc);f.flow.snapshot=(m,at)=>{const s=snapshot(m,at);return s?{...s,warm:false,sourceSupportFresh:false}:s;};f.rpc.usage=()=>{const u=usage();return {...u,rpcDispatchWindow:{...u.dispatchWindow,readyAt:f.now+65000,waitMs:65000}};};
 await f.runner.step();const view=f.runner.deadlineView();assert.equal(view.readyCount,0);assert.equal(view.targets[0]!.eligibleAt,Math.floor(f.now/10000)*10000+10000);assert.equal(f.runner.discretionaryAdmission(250).admitted,true,'an unavailable historical target is not an eternal local-work lock');const before=f.rpcCalls.length;await f.runner.step();assert.equal(f.rpcCalls.length,before,'HTTP cooldown still blocks physical requests');assert.equal(f.runner.status().counters.predictiveAssessments,0);assert.equal(f.runner.status().candidates[0]!.mint,mint);await f.runner.stop();
});

test('COHERENT deadline admission reads bounded readiness scalars without repeating feature or notification-ledger work',async()=>{
 const f=fixture();f.importActual();await f.runner.step();let snapshots=0,ledgers=0;const snapshot=f.flow.snapshot.bind(f.flow),ledger=f.flow.notificationLedger.bind(f.flow);f.flow.snapshot=(...args)=>{snapshots++;return snapshot(...args);};f.flow.notificationLedger=(...args)=>{ledgers++;return ledger(...args);};
 for(let n=0;n<100;n++){f.runner.deadlineView();f.runner.discretionaryAdmission(250);}
 assert.equal(snapshots,0);assert.equal(ledgers,0,'report/request guards do not clone an8192-row ledger or regenerate its predictive features');await f.runner.stop();
});

test('COHERENT an expired heartbeat cannot hide a live PONG deadline from local or physical admission',()=>{
 const at=100000,flow={usage:()=>({nextServiceAt:at,nextServiceAction:'heartbeat',nextRequiredServiceAt:at,nextRequiredServiceDeadlineAt:at-1,nextRequiredServiceAction:'heartbeat',nativeServiceDeadlines:[{action:'heartbeat',deadlineAt:at-1},{action:'peer-pong',deadlineAt:at+100}]})};
 const runner=new NativeCandidateRunner({flow:flow as any,rpc:{}as any,now:()=>at,record:()=>{}});const view=runner.deadlineView();assert.equal(view.requiredNativeAction,'peer-pong');assert.equal(runner.discretionaryAdmission(250).admitted,false);assert.equal(runner.discretionaryAdmission(1200).admitted,false);
});

test('HISTORY ROUTE oldest cooling target does not starve a healthy peer or invent the cooled target assessment',async()=>{
 const f=fixture({maximumDeep:3});for(let i=1;i<=3;i++)f.seed(i);await f.steps(20);f.advance(70000);f.refresh();const first=[...f.states.values()][0]!;f.setBatchCoolingMint(first.scope.pool);await f.runner.step();assert.equal(f.rpcCalls.length,1);assert.notEqual(f.rpcCalls[0]!.params[0],first.scope.pool);assert.equal(f.runner.status().counters.predictiveAssessments,1);assert.equal(f.runner.status().counters.qualityGaps,0);assert.ok(f.runner.status().candidates.some(c=>c.mint===first.scope.mint));f.setBatchCoolingMint(null);for(let n=0;n<8;n++){f.advance(250);await f.runner.step();}assert.equal(f.runner.status().counters.predictiveAssessments,3);assert.equal(f.rpcCalls.length,3);await f.runner.stop();
});
test('HISTORY ROUTE primary cooldown permits separately ready audits only with a usable current bank ceiling',async()=>{
 for(const freshCeiling of [true,false]){const f=fixture();f.importActual();await f.runner.step();f.advance(70000);if(freshCeiling)f.refresh();const usage=f.rpc.usage.bind(f.rpc);f.rpc.usage=()=>{const actual=usage();return {...actual,historyRoute:{version:'publicnode-history-only-v1',endpoint:'https://solana-rpc.publicnode.com',method:'getSignaturesForAddress'},rpcDispatchWindow:{...actual.dispatchWindow,readyAt:f.now+65000},historyDispatchWindow:actual.dispatchWindow,controlDispatchWindow:actual.dispatchWindow};};await f.runner.step();assert.equal(f.rpcCalls.length,freshCeiling?1:0);assert.equal(f.runner.status().counters.predictiveAssessments,freshCeiling?1:0);assert.equal(f.runner.status().counters.qualityGaps,0);if(!freshCeiling)assert.ok(f.records.some(r=>r.kind==='native-audit-dispatch-state'&&r.data.nextAction==='await-primary-support-ceiling'));await f.runner.stop();}
});

test('HISTORY ROUTE six ready targets blocked past deadline remain unusable while bounded degraded reporting retains service',async()=>{
 const f=fixture({maximumDeep:6});for(let i=1;i<=6;i++)f.seed(i);await f.steps(25);f.advance(70000);f.refresh();const getReady=f.rpc.historyQueryReadyAt;f.rpc.historyQueryReadyAt=()=>f.now+65000;const usage=f.rpc.usage.bind(f.rpc);f.rpc.usage=()=>{const u=usage();return {...u,historyRoute:{version:'publicnode-history-only-v1',endpoint:'https://solana-rpc.publicnode.com',method:'getSignaturesForAddress'},historyDispatchWindow:{...u.dispatchWindow,readyAt:f.now+65000}};};await f.runner.step();const view=f.runner.deadlineView();assert.equal(view.readyCount,6);assert.equal(view.unavailableReadyCount,6);assert.equal(view.conservativeReadyEnvelopeFits,false);assert.equal(f.runner.discretionaryAdmission(250).admitted,true,'known-unavailable audits must not silence degraded local status/backup');assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().counters.predictiveAssessments,0);f.advance(10001);await f.runner.step();assert.equal(f.runner.status().counters.decisionDeadlineMisses,6,'unavailable targets remain explicitly lost, not completed');assert.equal(f.runner.status().counters.qualityGaps,0,'HTTP refusal is not a healthy WS capture gap');f.rpc.historyQueryReadyAt=getReady;await f.runner.stop();
});


for(const jitterMs of [1,5,50])test(`PLANNING CLOCK actual readiness helper serves three peers with ${jitterMs}ms computation jitter`,async()=>{
 const f=fixture({maximumDeep:3});for(let i=1;i<=3;i++)f.seed(i);await f.steps(20);f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000,planningCalls:Array<{at:number|undefined;observedAt:number}>=[];
 const query=Object.assign(Object.create(PilotRpc.prototype),{now:()=>{f.advance(jitterMs);return f.now;},mono:()=>f.now,options:{historyRoute:'publicnode-history-only-v1'},queryTimeouts:new Map(),historyCooldown:0,historyCooldownMono:0});
 f.rpc.historyQueryReadyAt=(pool:string,planningAt?:number)=>{const readyAt=query.historyQueryReadyAt(pool,planningAt);planningCalls.push({at:planningAt,observedAt:f.now});return readyAt;};
 for(let n=0;n<12&&f.runner.status().counters.predictiveAssessments<3;n++){await f.runner.step();f.advance(250);}
 const assessments=f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt===target);assert.equal(assessments.length,3);assert.ok(assessments.every(r=>r.data.at<target+10000));assert.ok(planningCalls.length>3);assert.ok(planningCalls.every(c=>c.at!==undefined&&c.observedAt>c.at),'deadline calendar, individual dispatch and quiet planning pass a stable decision clock');assert.equal(f.rpcCalls.length,3);assert.equal(f.maximumInFlight,1);assert.equal(f.runner.status().counters.decisionDeadlineMisses,0);assert.equal(f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.nextAction==='await-history-provider-or-query-cooldown').length,0,'elapsed computation alone is not a provider/query incident');await f.runner.stop();
});

test('PLANNING CLOCK real future query cooling still yields to healthy peers under advancing time',async()=>{
 const f=fixture({maximumDeep:3});for(let i=1;i<=3;i++)f.seed(i);await f.steps(20);f.advance(70000);f.refresh();const first=[...f.states.values()][0]!,until=f.now+5000;
 const query=Object.assign(Object.create(PilotRpc.prototype),{now:()=>{f.advance(1);return f.now;},mono:()=>f.now,options:{historyRoute:'publicnode-history-only-v1'},queryTimeouts:new Map([[first.scope.pool,{until,untilMono:until,failedAt:f.now,failures:1}]]),historyCooldown:0,historyCooldownMono:0});
 f.rpc.historyQueryReadyAt=(pool:string,planningAt?:number)=>query.historyQueryReadyAt(pool,planningAt);for(let n=0;n<6&&f.runner.status().counters.predictiveAssessments<2;n++){await f.runner.step();f.advance(250);}assert.equal(f.runner.status().counters.predictiveAssessments,2);assert.ok(f.rpcCalls.every(r=>r.params[0]!==first.scope.pool));assert.ok(f.runner.status().candidates.some(c=>c.mint===first.scope.mint));assert.equal(f.runner.status().counters.qualityGaps,0);assert.equal(f.maximumInFlight,1);await f.runner.stop();
});


/** Actual shared RPC/budget/history validation over local injected responses.
 * Ownership and protection completion clocks below are explicit synthetic
 * scheduling inputs, not real held financial positions or provider evidence. */
function attachActualHistory(f:ReturnType<typeof fixture>,wrap:(o:PilotRpcCallOptions)=>PilotRpcCallOptions=o=>o,responseDelayMs=25,beforePacing?:(ms:number)=>void){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-audit-recovery-')),old=join(directory,'old.json');writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:0,bytes:0,lastObservedAt:f.now-100000,starts:[],pending:[]}),{mode:0o600});
 let fetches=0,active=0,maximumActive=0,protectionFetches=0;const records:Array<{kind:string;data:any}>=[],optionsSeen:PilotRpcCallOptions[]=[];
 const client=new PilotRpc({directory:join(directory,'rpc'),runId:'offline-audit-recovery',baselinePaths:[old],priorPhysicalSettled:true,maxStartsPerMinute:90,maxStartsPer10s:20,historyRoute:'publicnode-history-only-v1',now:()=>f.now,monotonic:()=>f.now,sleep:async ms=>{beforePacing?.(ms);f.advance(ms);},record:(kind,data)=>records.push({kind,data:structuredClone(data)}),fetcher:(async(_url,init)=>{
  fetches++;active++;maximumActive=Math.max(maximumActive,active);try{const request=JSON.parse(String(init?.body));if(request.method==='getMultipleAccounts'){protectionFetches++;f.advance(150);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{context:{slot:original.slot},value:[]}}));}const state=[...f.states.values()].find(s=>s.scope.pool===request.params[0])!;assert.ok(state);let rows=[...state.notes].reverse().map(n=>({signature:n.signature,slot:n.slot,err:null,blockTime:Math.floor(n.availableAt/1000),confirmationStatus:'confirmed'}));rows.push({signature:originalSignature,slot:original.slot,err:null,blockTime:original.blockTime,confirmationStatus:'finalized'});rows.sort((a,b)=>b.slot-a.slot);const before=request.params[1]?.before;if(before){const i=rows.findIndex(r=>r.signature===before);if(i>=0)rows=rows.slice(i+1);}f.advance(responseDelayMs);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:rows.slice(0,request.params[1].limit)}));}finally{active--;}
 }) as typeof fetch});
 f.rpc.call=async<T>(method:string,params:unknown[]=[],signal?:AbortSignal,o:PilotRpcCallOptions={})=>{optionsSeen.push({...o});return client.call<T>(method,params,signal,wrap(o));};f.rpc.usage=(()=>client.usage()) as typeof f.rpc.usage;f.rpc.historyQueryReadyAt=(pool:string)=>client.historyQueryReadyAt(pool,f.now);
 return {client,records,optionsSeen,get fetches(){return fetches;},get protectionFetches(){return protectionFetches;},get maximumActive(){return maximumActive;},close(){client.close();rmSync(directory,{recursive:true,force:true});}};
}

test('CERTIFIED HANDOFF actual PilotRpc and ComponentBudget retain per-request financial priority through pacing without renewing evidence',async t=>{
 for(const fault of ['healthy','pending','protection','generation','bucket']as const)await t.test(fault,async()=>{
  const {f,mint,certificate}=await completedFinancialFixture();f.advance(Math.max(0,certificate.windowEndAt+3500-f.now));f.setHeadroom(10000);let pending=false,protectionCurrent=true,injectPacingFault=false;
  const actual=attachActualHistory(f,o=>o,25,()=>{if(!injectPacingFault)return;injectPacingFault=false;if(fault==='generation')f.states.get(mint)!.openedAt!++;if(fault==='bucket')f.advance(10000-f.now%10000);});
  const staticCertificateCutoff=f.runner.financialAdmission(certificate,1200,f.now).certificateLatestStartAt!,read=()=>actual.client.call('getMultipleAccounts',[[],{commitment:'confirmed'}],undefined,{timeoutMs:1000,operationBoundMs:1200,latestStartAt:staticCertificateCutoff,admissionOpen:()=>!pending&&protectionCurrent&&f.runner.financialAdmission(certificate,1200,f.now).admitted});
  try{
   assert.equal(f.runner.discretionaryAdmission(1200,f.now).admitted,false);assert.equal(f.runner.financialAdmission(certificate,1200,f.now).admitted,true);await read();assert.equal(actual.fetches,1);
   f.setHeadroom(1000);const obsoleteNativeCutoff=f.runner.financialAdmission(certificate,1200,f.now).nativeLatestStartAt!;await assert.rejects(read(),/COMPONENT_ADMISSION_CLOSED/);assert.equal(actual.fetches,1);f.flow.requestHeartbeat();await f.flow.service();assert.ok(f.runner.financialAdmission(certificate,1200,f.now).nativeLatestStartAt!>obsoleteNativeCutoff);assert.equal(f.runner.financialAdmission(certificate,1200,f.now).certificateLatestStartAt,staticCertificateCutoff);await read();assert.equal(actual.fetches,2);assert.ok(actual.records.some(r=>r.kind==='component-pacing-wait'&&r.data.waitMs>0),'the second actual component request passed its fresh admission after pacing');
   const cooldown=actual.client.cooldownUntil();if(fault==='pending')pending=true;if(fault==='protection')protectionCurrent=false;if(fault==='generation'||fault==='bucket')injectPacingFault=true;
   if(fault==='healthy'){await read();assert.equal(actual.fetches,3);}else{await assert.rejects(read(),/COMPONENT_ADMISSION_CLOSED|COMPONENT_DISPATCH_EXPIRED/);assert.equal(actual.fetches,2);const refusal=actual.records.filter(r=>r.kind==='component-local-admission-refused').at(-1)!.data;assert.equal(refusal.transportStarted,false);if(fault==='generation'||fault==='bucket'){assert.equal(refusal.stage,'after-pacing');assert.ok(refusal.pacingWaitMs>0);assert.equal(f.runner.currentAuditCertificate(mint,f.now),null);}}
   assert.equal(actual.client.cooldownUntil(),cooldown,'local refusal never manufactures a provider cooldown');assert.equal(actual.maximumActive,1);assert.equal(actual.client.usage().inFlight,0);assert.equal(f.runner.status().financialWriterOpened,false);
  }finally{await f.runner.stop();actual.close();}
 });
});

test('HELD AUDIT operation-specific preflight retains an unexpired page until the completed-protection runway is available',async()=>{
 let enforce=false,lastUsable=0;const f=fixture({sourceWorkAdmission:bound=>!enforce||pilotLowerPriorityAdmission({now:f.now,endAt:f.now+120000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound}).admitted});const mint=f.importActual();await f.runner.step();f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000;lastUsable=f.now-1000;enforce=true;
 const lower=(bound:number)=>pilotLowerPriorityAdmission({now:f.now,endAt:f.now+120000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound});
 const actual=attachActualHistory(f,o=>{const bound=nativePaperRequestOperationBound(o),view=lower(bound);return {...o,latestStartAt:Math.min(o.latestStartAt??Infinity,view.latestStartAt),admissionOpen:()=>lower(bound).admitted&&(o.admissionOpen?.()??true)};});try{
  assert.equal(lower(1200).admitted,true,'old outer guard admits this measured failure band');assert.equal(lower(2125).admitted,false);
  await f.runner.step();const pending=f.runner.status().candidates.find(c=>c.mint===mint)!.auditSession!;assert.equal(pending.pendingPage,1);assert.equal(pending.windowEndAt,target);assert.equal(pending.deadlineAt,target+9999);assert.equal(actual.fetches,0);assert.equal(f.runner.status().counters.auditUnavailable,0);
  for(let i=0;i<100;i++){await f.runner.step();f.advance(1);}assert.equal(actual.optionsSeen.length,0,'local planning never queues a physical request while financial runway is closed');assert.equal(f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.reason==='page-deferred').length,1,'retry floor prevents50ms busy refusal loops');const wait=f.records.filter(r=>r.kind==='native-audit-dispatch-state'&&r.data.nextAction==='await-local-uninvoked-page-retry').at(-1);assert.ok(wait);assert.equal(wait.data.context.providerOrQueryBlockedCount,0);assert.equal(wait.data.context.localRetryDeferredCount,1);
  f.advance(250);lastUsable=f.now;await f.runner.step();assert.equal(actual.fetches,1);assert.equal(actual.records.filter(r=>r.kind==='component-physical-start').length,1);assert.equal(f.runner.status().counters.auditedWindows,1);assert.equal(f.runner.status().counters.auditUnavailable,0);assert.equal(f.records.find(r=>r.kind==='native-predictive-assessment')!.data.windowEndAt,target);assert.equal(actual.optionsSeen[0]!.operationBoundMs,2125);assert.equal(actual.optionsSeen[0]!.timeoutMs,1500);assert.equal(actual.maximumActive,1);
 }finally{await f.runner.stop();actual.close();}
});

test('HELD AUDIT real pre-dispatch loss retains the same page but matching unowned errors stay terminal',async()=>{
 for(const real of [true,false]){const f=fixture(),mint=f.importActual();await f.runner.step();f.advance(70000);f.refresh();const target=Math.floor(f.now/10000)*10000;let admit=false;const actual=attachActualHistory(f,o=>({...o,admissionOpen:()=>admit&&(o.admissionOpen?.()??true)}));if(!real)f.rpc.call=async()=>{throw Error('PILOT_RPC_COMPONENT_ADMISSION_CLOSED');};try{
  await f.runner.step();assert.equal(actual.fetches,0);assert.equal(f.runner.status().counters.auditUnavailable,real?0:1);
  if(real){const session=f.runner.status().candidates.find(c=>c.mint===mint)!.auditSession!;assert.equal(session.pendingPage,1);assert.equal(session.windowEndAt,target);assert.equal(session.deadlineAt,target+9999);assert.equal(actual.client.usage().newUnits,0);const attempts=actual.optionsSeen.length;await f.runner.step();assert.equal(actual.optionsSeen.length,attempts);f.advance(250);admit=true;await f.runner.step();assert.equal(actual.fetches,1);assert.equal(f.runner.status().counters.auditedWindows,1);assert.equal(f.runner.status().counters.auditUnavailable,0);}
  else assert.equal(f.runner.status().candidates.find(c=>c.mint===mint)!.auditSession,null,'a generic matching error cannot manufacture a safe retry');
 }finally{await f.runner.stop();actual.close();}}
});

test('HELD AUDIT four simultaneous scopes including multipage activity progress fairly between protected completion epochs',async()=>{
 let enforce=false,lastUsable=0,nextPendingAt:number|null=null;const completions:number[]=[],bounds:number[]=[];const lower=(bound:number)=>pilotLowerPriorityAdmission({now:f.now,endAt:f.now+120000,held:1,lastUsable,nextPendingAt,operationBoundMs:bound});const f=fixture({maximumDeep:4,forcePredictiveFeatures:true,sourceWorkAdmission:bound=>{bounds.push(bound);return !enforce||lower(bound).admitted;}});const mints=Array.from({length:4},(_,i)=>f.seed(i+1));await f.steps(20);f.advance(70000);addBusyHistory(f,mints[0]!,3000);const target=Math.floor(f.now/10000)*10000;lastUsable=f.now;enforce=true;
 const actual=attachActualHistory(f,o=>{const bound=nativePaperRequestOperationBound(o),view=lower(bound);return {...o,latestStartAt:Math.min(o.latestStartAt??Infinity,view.latestStartAt),admissionOpen:()=>lower(bound).admitted&&(o.admissionOpen?.()??true)};});try{
  nextPendingAt=f.now+100;await f.runner.step();assert.equal(actual.fetches,0,'a due pending sell boundary has priority over every history page');assert.equal(f.runner.status().counters.auditUnavailable,0);nextPendingAt=null;
  for(let i=0;i<300&&f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt===target).length<4;i++){if(f.now-lastUsable>=1800){f.advance(150);lastUsable=f.now;completions.push(lastUsable);}await f.runner.step();f.advance(50);}
  const assessments=f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt===target);assert.equal(assessments.length,4,JSON.stringify({at:f.now,target,status:f.runner.status().counters}));assert.deepEqual(new Set(assessments.map(r=>r.data.mint)),new Set(mints));assert.ok(assessments.every(r=>r.data.at<=target+9999));assert.ok(actual.optionsSeen.length>=7,'busy scope retained its separately scheduled continuation pages');assert.ok(actual.optionsSeen.every(o=>o.timeoutMs===1500&&o.operationBoundMs===2125));assert.equal(actual.maximumActive,1);assert.equal(f.runner.status().counters.auditUnavailable,0);assert.equal(f.runner.status().counters.decisionDeadlineMisses,0);assert.ok(completions.length>=2);assert.ok(completions.every((at,i)=>!i||at-completions[i-1]!<=2200));assert.ok(bounds.includes(2125));
  const audits=f.records.filter(r=>r.kind==='native-candidate-window-audit'&&r.data.result.target.endAt===target);assert.ok(audits.every(r=>r.data.result.status==='verified'&&r.data.result.complete));const firstBusy=assessments.findIndex(r=>r.data.mint===mints[0]);assert.ok(firstBusy>0,'quiet peers are not starved behind every busy continuation page');
 }finally{await f.runner.stop();actual.close();}
});

test('HELD AUDIT deferred old generation and expired targets never spend a new request or qualify',async()=>{
 for(const mode of ['generation','deadline'] as const){let allow=false;const f=fixture({sourceWorkAdmission:bound=>allow||bound<2125}),mint=f.importActual();allow=true;await f.runner.step();f.advance(70000);f.refresh();allow=false;const actual=attachActualHistory(f);try{
  await f.runner.step();const pending=f.runner.status().candidates.find(c=>c.mint===mint)?.auditSession;assert.ok(pending,JSON.stringify({mode,status:f.runner.status(),recent:f.records.slice(-6)}));assert.equal(pending.pendingPage,1);assert.equal(actual.fetches,0);
  if(mode==='generation'){const state=f.states.get(mint)!;state.openedAt=f.now;state.window=new FlowWindow(mint,f.now);f.runner.onFlowOpen({mint,at:f.now});f.advance(250);}else f.advance(10000);
  allow=true;await f.runner.step();assert.equal(actual.fetches,0);assert.equal(f.runner.status().counters.auditedWindows,0);assert.equal(f.records.some(r=>r.kind==='native-predictive-assessment'),false);if(mode==='deadline')assert.equal(f.runner.status().counters.decisionDeadlineMisses,1);
 }finally{await f.runner.stop();actual.close();}}
});

test('HELD AUDIT a supplied financial operation contract cannot enter the unvalidated optional batch path',async()=>{
 const f=fixture({maximumDeep:2,quietBatch:true,sourceWorkAdmission:()=>true});f.seed(1);f.seed(2);await f.steps(10);f.advance(70000);f.refresh();for(let i=0;i<12&&f.runner.status().counters.auditedWindows<2;i++){await f.runner.step();f.advance(50);}assert.equal(f.batchCalls.length,0);assert.equal(f.rpcCalls.length,2);assert.equal(f.runner.status().counters.auditedWindows,2);assert.equal(f.maximumInFlight,1);await f.runner.stop();
});


for(const responseDelayMs of [25,250,500,750,1200])test(`CONTROLLED held four-scope original-deadline characterization at ${responseDelayMs}ms history latency`,async()=>{
 let enforce=false,lastUsable=0,nextPendingAt:number|null=null;
 const completions:number[]=[],bounds:number[]=[];
 const lower=(bound:number)=>pilotLowerPriorityAdmission({now:f.now,endAt:f.now+120000,held:1,lastUsable,nextPendingAt,operationBoundMs:bound});
 const f=fixture({maximumDeep:4,forcePredictiveFeatures:true,sourceWorkAdmission:bound=>{bounds.push(bound);return !enforce||lower(bound).admitted;}});
 const mints=Array.from({length:4},(_,i)=>f.seed(i+1));await f.steps(20);f.advance(70000);addBusyHistory(f,mints[0]!,3000);
 const target=Math.floor(f.now/10000)*10000;lastUsable=f.now;enforce=true;
 const actual=attachActualHistory(f,o=>{const bound=nativePaperRequestOperationBound(o),view=lower(bound);return {...o,latestStartAt:Math.min(o.latestStartAt??Infinity,view.latestStartAt),admissionOpen:()=>lower(bound).admitted&&(o.admissionOpen?.()??true)};},responseDelayMs);
 try{
  while(f.now<target+11000){if(f.now-lastUsable>=1800){f.advance(150);lastUsable=f.now;completions.push(lastUsable);}await f.runner.step();f.advance(50);}
  const assessments=f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt===target),expired=f.records.filter(r=>r.kind==='native-predictive-window-expired'&&r.data.windowEndAt===target);
  const output={responseDelayMs,target,endedAt:f.now,targetDecisionDeadline:target+9999,completedAssessments:assessments.length,assessedMints:assessments.map(r=>r.data.mint),expiredTargets:expired.length,expired:expired.map(r=>({mint:r.data.mint,dispatchTrace:r.data.dispatchTrace})),physicalFetches:actual.fetches,physicalTimeouts:actual.records.filter(r=>r.kind==='component-physical-timeout').length,protectionCompletions:completions.length,maximumSyntheticProtectionGapMs:Math.max(0,...completions.map((at,i)=>i?at-completions[i-1]!:0)),counters:f.runner.status().counters,sourceAndPositions:'SYNTHETIC runner/RPC fixtures, no actual financial position or live-provider attribution'};
  console.log('HELD_LATENCY_CHARACTERIZATION '+JSON.stringify(output));
  assert.ok(assessments.every(r=>r.data.at<=target+9999));assert.equal(actual.maximumActive,1);assert.equal(output.physicalTimeouts,0);assert.ok(completions.every((at,i)=>!i||at-completions[i-1]!<=4000));
 }finally{await f.runner.stop();actual.close();}
});


for(const responseDelayMs of [500,750,1200])for(const early of[false,true])test(`CONTROLLED charged shared-budget held epochs ${early?'early':'ordinary'} at ${responseDelayMs}ms history latency`,async()=>{
 let enforce=false,lastUsable=0,lastProtectionStartedAt=0;
 const completions:number[]=[],plans:Array<ReturnType<typeof nativeHeldAuditScheduling>>=[];
 const lower=(bound:number)=>pilotLowerPriorityAdmission({now:f.now,endAt:f.now+120000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound});
 const f=fixture({maximumDeep:4,forcePredictiveFeatures:true,sourceWorkAdmission:bound=>!enforce||lower(bound).admitted});
 const mints=Array.from({length:4},(_,i)=>f.seed(i+1));await f.steps(20);f.advance(70000);addBusyHistory(f,mints[0]!,3000);
 const target=Math.floor(f.now/10000)*10000;lastUsable=f.now;lastProtectionStartedAt=f.now-150;enforce=true;
 const actual=attachActualHistory(f,o=>{const bound=nativePaperRequestOperationBound(o),view=lower(bound);return {...o,latestStartAt:Math.min(o.latestStartAt??Infinity,view.latestStartAt),admissionOpen:()=>lower(bound).admitted&&(o.admissionOpen?.()??true)};},responseDelayMs);
 // This charges one injected warm held batch to the REAL shared PilotRpc gate.
 // It does not assert actual SDK quote decoding or a genuine financial position.
 const protect=async()=>{lastProtectionStartedAt=f.now;await actual.client.call('getMultipleAccounts',[['OFFLINE-WHOLE-INVENTORY'],{encoding:'base64',commitment:'confirmed'}],undefined,{timeoutMs:1200});lastUsable=f.now;completions.push(lastUsable);};
 try{
  while(f.now<target+11000){
   if(f.now-lastProtectionStartedAt>=2000)await protect();
   else if(early){const usage=actual.client.usage(),gate=usage.rpcDispatchWindow??usage.dispatchWindow;
    const plan=nativeHeldAuditScheduling({at:f.now,held:1,lastProtectionStartedAt,lastProtectionCompletedAt:lastUsable,inventoryProtectionComplete:true,nextPendingAt:null,candidateInformationOpen:true,currentAuditFinancialRunwayAvailable:lower(2125).admitted,deadlineView:f.runner.deadlineView(),physical:{available:actual.client.available(),busy:usage.waitingOrOperating||usage.inFlight>0,readyAt:gate?.readyAt??f.now,rolling10SecondHeadroom:20-(usage.chapterUsage?.rolling10SecondStarts??0),rollingMinuteHeadroom:90-(usage.chapterUsage?.rolling60SecondStarts??0)},protectionRequestStarts:1});plans.push(plan);if(plan.earlyProtection)await protect();
   }
   await f.runner.step();f.advance(50);
  }
  const assessments=f.records.filter(r=>r.kind==='native-predictive-assessment'&&r.data.windowEndAt===target),expired=f.records.filter(r=>r.kind==='native-predictive-window-expired'&&r.data.windowEndAt===target),usage=actual.client.usage();
  const starts=actual.records.filter(r=>r.kind==='component-physical-start').map(r=>r.data.at as number),shortMaximum=Math.max(0,...starts.map(at=>starts.filter(n=>n>at-10000&&n<=at).length));
  const output={responseDelayMs,early,target,completedAssessments:assessments.length,expiredTargets:expired.length,physicalFetches:actual.fetches,protectionFetches:actual.protectionFetches,historyFetches:actual.fetches-actual.protectionFetches,physicalTimeouts:actual.records.filter(r=>r.kind==='component-physical-timeout').length,earlyTurns:plans.filter(p=>p.earlyProtection).length,maximumStartsPer10SecondsObserved:shortMaximum,minuteStarts:usage.chapterUsage?.rolling60SecondStarts??null,protectionCompletions:completions.length,maximumSyntheticProtectionGapMs:Math.max(0,...completions.map((at,i)=>i?at-completions[i-1]!:0)),meaning:'CONTROLLED original-target timing; realPilotRpc20per10s/90perminute/250mspacing/onephysical; injected warmheldbatch150ms charged; sourcecontrols and genuine SDKquotes not modeled'};
  console.log('HELD_CHARGED_EARLY_CHARACTERIZATION '+JSON.stringify(output));assert.ok(assessments.every(r=>r.data.at<=target+9999));assert.equal(actual.maximumActive,1);assert.equal(output.physicalTimeouts,0);assert.ok(shortMaximum<=20);assert.ok((output.minuteStarts??0)<=90);assert.ok(output.maximumSyntheticProtectionGapMs<=4000);
 }finally{await f.runner.stop();actual.close();}
});

test('fresh ACK clears finalized history and a prior-generation completion cannot repopulate it',async()=>{
 const f=fixture({forcePredictiveFeatures:true}),mint=f.importActual(),captured:Parameters<typeof auditNativeFlowWindow>[0][]=[];
 const original=(f.runner as any).audit as typeof auditNativeFlowWindow;(f.runner as any).audit=async(options:Parameters<typeof auditNativeFlowWindow>[0])=>{captured.push(options);return original(options);};
 await f.runner.step();await f.warm();assert.ok(captured.length);const first=captured[0]!;
 f.advance(10000);f.refresh();await f.steps(5);assert.ok(captured.some(o=>o.reusableHistory?.rows.length),'a verified finalized suffix is available within one generation');
 const state=f.states.get(mint)!;state.openedAt=f.now;state.window=new FlowWindow(mint,f.now);state.notes=[];state.lastSyntheticAt=f.now;f.runner.onFlowOpen({mint,at:f.now});
 first.onVerifiedHistory?.({pool:first.pool,validatedAt:f.now,rows:[]});const before=captured.length;f.advance(70000);f.refresh();await f.steps(8);assert.ok(captured.length>before);assert.equal(captured[before]!.reusableHistory,undefined,'old completion cannot restore cache after actual ACK rebind');
 await f.runner.stop();
});


function economicRejection(f:ReturnType<typeof fixture>,mint:string):NativeEconomicRejection{
 const certificate=f.runner.currentAuditCertificate(mint,f.now);assert.ok(certificate);
 return {kind:'completed-economic-rejection',mint,pool:certificate.pool,strategyVersion:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,windowEndAt:certificate.windowEndAt,openedAt:certificate.openedAt,decisionAt:f.now,quoteAt:f.now,quoteEvidence:'OFFLINE coordinator primary exact-size quote disposition; not market data',reason:'v3.1-nonpositive-joint-conditional-economic-balance',at:f.now};
}

test('completed primary economic rejection frees exactly one of four deep scopes for a verified waiting identity',async()=>{
 const f=fixture({maximumDeep:4,fairEconomicCompletions:true,forcePredictiveFeatures:true});const mints=[1,2,3,4,5].map(n=>f.seed(n));await f.steps(40);assert.equal(f.states.size,4);assert.equal(f.runner.watch.snapshot(f.now,LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION).summary.eligibleKnown,5);
 f.advance(70000);f.refresh();await f.steps(12);const mint=[...f.states.keys()].find(key=>f.runner.currentAuditCertificate(key,f.now))!;assert.ok(mint);const request=economicRejection(f,mint),before=[...f.states.keys()];
 assert.equal(f.runner.finishEconomicRejection(request),true);assert.equal(f.states.size,3);assert.equal(f.runner.currentAuditCertificate(mint,f.now),null);for(const other of before.filter(key=>key!==mint))assert.ok(f.states.has(other),'peer observation stays uninterrupted');
 const row=f.runner.watch.lookupIdentity(mint,f.now)!;assert.equal(row.state,'DEFERRED');assert.equal(row.deferUntil,request.at);assert.equal(row.everHadWindow,true);assert.equal(f.runner.finishEconomicRejection(request),false,'the same completion cannot release a new generation');
 for(let n=0;n<12&&f.states.size<4;n++){f.advance(250);await f.runner.step();}assert.equal(f.states.size,4);assert.ok(mints.some(key=>!before.includes(key)&&f.states.has(key)),'a verified waiting token receives the vacancy');assert.equal(f.runner.status().watch.summary.maximumDeep,4);assert.equal(f.runner.status().financialWriterOpened,false);await f.runner.stop();
});

test('economic completion preserves held/pending scopes and rejects stale or technical dispositions',async()=>{
 const f=fixture({maximumDeep:1,fairEconomicCompletions:true,forcePredictiveFeatures:true});f.seed(1);f.seed(2);await f.steps(16);f.advance(70000);f.refresh();await f.steps(6);const mint=[...f.states.keys()][0]!,request=economicRejection(f,mint);
 for(const owner of ['HELD','ENTRY_PENDING']as const){f.ownership.set(mint,owner);assert.equal(f.runner.finishEconomicRejection(request),false);assert.ok(f.states.has(mint));}f.ownership.delete(mint);
 for(const changed of [{openedAt:request.openedAt-1},{windowEndAt:request.windowEndAt-10000},{quoteAt:request.decisionAt+1},{reason:'v3.1-selected-size-sdk-quote-unavailable'},{quoteEvidence:''}]){assert.equal(f.runner.finishEconomicRejection({...request,...changed}as NativeEconomicRejection),false);assert.ok(f.states.has(mint));}
 assert.equal(f.records.filter(row=>row.kind==='native-candidate-economic-rejection-completed').length,0);await f.runner.stop();
});

test('a completed economic rejection releases unchanged observation even when no verified peer exists',async()=>{
 const f=fixture({maximumDeep:1,fairEconomicCompletions:true,forcePredictiveFeatures:true});f.seed(1);await f.steps(8);f.advance(70000);f.refresh();await f.steps(5);const mint=[...f.states.keys()][0]!;
 assert.equal(f.runner.finishEconomicRejection(economicRejection(f,mint)),true);assert.equal(f.states.has(mint),false);assert.equal(f.runner.currentAuditCertificate(mint,f.now),null);f.advance(61000);await f.steps(6);assert.equal(f.states.has(mint),false,'unchanged completed-negative economics cannot readmit merely because time passed');await f.runner.stop();
});

test('a completed preliminary economic rejection waits for meaningful new content without a fixed thirty-second veto',async()=>{
 const f=fixture({maximumDeep:1,durableMarketPolicy:true,fairEconomicCompletions:true,forcePredictiveFeatures:true}),mint=f.seed(1);(f.runner as any).options.activeAssessment=(_mint:string,features:any,at:number)=>({...assessLiquidityResilientBuyingV31(features,at),features,status:'failed',reason:'OFFLINE verified preliminary economic rejection'});await f.steps(8);f.advance(70000);f.refresh();
 try{
  for(let n=0;n<8&&f.states.has(mint);n++)await f.runner.step();assert.equal(f.states.has(mint),false);const rejected=f.runner.watch.lookupIdentity(mint,f.now)!;assert.equal(rejected.reobservation?.kind,'economic-rejection');assert.equal(rejected.deferUntil,rejected.reobservation!.decisionAt);assert.equal(f.runner.watch.next(f.now,new Set(),{requireOrigin:false}),null,'unchanged economics remains retained but unselected');
  f.advance(1);assert.equal(f.runner.watch.noteRelevantEvidence(mint,{kind:'pool-reserves',at:f.now,fingerprint:'OFFLINE verified numeric reserves changed:base=5000000000,quote=2000000000'},f.now),true);assert.equal(f.runner.watch.next(f.now,new Set(),{requireOrigin:false})?.mint,mint);assert.equal(f.runner.currentAuditCertificate(mint,f.now),null,'a cheap changed-content hint never restores old trade authority or bypasses the new full observation');assert.ok(f.now-rejected.reobservation!.decisionAt<30000);
 }finally{await f.runner.stop();}
});


test('durable candidate intake retains more than256 migration seeds while discretionary admission is paused',async()=>{
 const f=fixture();f.setAllow(false);for(let i=1;i<=700;i++)f.seed(i);
 const s=f.runner.status();assert.equal(s.verificationQueue,700);assert.equal(s.counters.migrationHints,700);assert.equal(s.counters.verificationQueueRefusals,0);
 assert.ok(f.runner.watch.lookupIdentity(sig(1),f.now));assert.ok(f.runner.watch.lookupIdentity(sig(700),f.now));assert.equal(f.resolveCalls,0);
 assert.equal(await f.runner.step(),'closed');assert.equal(f.records.some(r=>r.kind==='native-verification-queue-refusal'||r.kind==='pilot-watch-evicted'),false);await f.runner.stop();
});

test('candidate verification and original proof bytes survive a real registry close and reopen without queue backfill scans',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-durable-candidates-')),path=join(dir,'market.sqlite');let registry=new MarketRegistry(path);
 try{const first=fixture({registry});first.setAllow(false);for(let i=1;i<=700;i++)first.seed(i);first.importActual();await first.runner.stop();registry.close();
  registry=new MarketRegistry(path);const second=fixture({registry});assert.equal(second.runner.status().verificationQueue,700);assert.ok(second.runner.watch.lookupIdentity(sig(1),second.now));assert.ok(second.runner.watch.lookupIdentity(sig(700),second.now));
  await second.steps(2);assert.ok(second.runner.status().candidates.some(row=>row.mint===originalIdentity.baseMint),'previously verified origin hydrates from durable bytes without another origin RPC');assert.equal(second.rpcCalls.length,0);assert.ok(second.runner.checkpoint().origins.length<=1,'checkpoint contains only hot proof bytes; all cold proofs remain in the durable registry');await second.runner.stop();
 }finally{registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('shared broad-market hints receive lightweight awareness without promoting unverified trade signatures to origin evidence',async()=>{
 const f=fixture();f.setAllow(false);const mint=new PublicKey(Buffer.alloc(32,173)).toBase58();
 f.runner.onMarketIdentity({mint,receivedAt:f.now,source:'pumpportal-new-token',kind:'creation',signature:sig(12345),evidence:'unverified-provider-discovery-hint'});
 f.runner.onMarketActivity({mint,receivedAt:f.now,source:'pumpapi-broad',kind:'activity',signature:sig(12346),side:'buy',quoteLamports:'2000000000',evidence:'unverified-provider-activity-hint'});
 const s=f.runner.status();assert.equal(s.marketCoverage.lifetime.uniqueTokensDiscovered,1);assert.equal(s.marketCoverage.lifetime.lightweightScreened,1);assert.equal(s.marketCoverage.lifetime.lightweightWithActivity,1);assert.equal(s.verificationQueue,0);assert.equal(s.counters.verifiedOrigins,0);assert.equal(s.candidates.length,0);assert.equal(f.rpcCalls.length,0);assert.equal(s.marketCoverage.wholeMarketCoveragePercent,null);await f.runner.stop();
});


test('conditional shared-activity origin lookup uses the existing spare dispatcher and measured demand without treating trades as creation proofs',async()=>{
 const f=fixture(),low=new PublicKey(Buffer.alloc(32,174)).toBase58(),high=new PublicKey(Buffer.alloc(32,175)).toBase58();f.setAllow(false);
 for(const [mint,signature,amount] of [[low,sig(45601),'200000000'],[high,sig(45602),'5000000000']] as const)f.runner.onMarketActivity({mint,signature,receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteMint:'So11111111111111111111111111111111111111112',quoteLamports:amount,evidence:'unverified-provider-activity-hint'});
 assert.equal(f.runner.status().verificationQueue,0);assert.equal(f.resolveCalls,0);assert.equal(await f.runner.step(),'closed');f.setAllow(true);await f.runner.step();
 const selected=f.records.filter(r=>r.kind==='native-shared-activity-origin-lookup-selected');assert.equal(selected.length,1);assert.equal(selected[0]!.data.mint,high);assert.equal(selected[0]!.data.hintIsCanonicalProof,false);assert.equal(selected[0]!.data.providerRequestStarted,false);assert.equal(f.resolveCalls,1,'existing synthetic resolver supplied explicit independent test identity; shared hint itself was not accepted');assert.ok(f.runner.watch.lookupIdentity(high,f.now)?.verifiedAt!==null);assert.equal(f.runner.watch.lookupIdentity(low,f.now),undefined,'unselected awareness remains durable without individual RPC/enrichment');assert.equal(f.rpcCalls.length,0);await f.runner.stop();
});

test('shared-activity origin work never occupies held-protection runway or invents SOL activity for unavailable quotes',async()=>{
 const f=fixture({sourceWorkAdmission:()=>false}),mint=new PublicKey(Buffer.alloc(32,176)).toBase58();f.runner.onMarketActivity({mint,signature:sig(45603),receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteMint:'So11111111111111111111111111111111111111112',quoteLamports:'5000000000',evidence:'unverified-provider-activity-hint'});await f.steps(5);assert.equal(f.resolveCalls,0);assert.equal(f.runner.status().verificationQueue,0);assert.equal(f.records.some(r=>r.kind==='native-shared-activity-origin-lookup-selected'),false);await f.runner.stop();
 const unknown=fixture();unknown.runner.onMarketActivity({mint,signature:sig(45604),receivedAt:unknown.now,source:'pumpapi-broad',kind:'activity',side:'buy',evidence:'unverified-provider-activity-hint'});await unknown.steps(5);assert.equal(unknown.resolveCalls,0);assert.equal(unknown.runner.status().marketCoverage.lifetime.lightweightUnavailable,1);await unknown.runner.stop();
});

test('shared activity commits hint and known-watch updates once per packet without read-lookup fsync amplification',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt}),f=fixture({registry});try{
  const known=f.importActual(),unknown=new PublicKey(Buffer.alloc(32,181)).toBase58();f.setAllow(false);
  for(const [mint,signature] of [[unknown,sig(58001)],[known,sig(58002)]] as const){
   const before=registry.health().transactions.writeCommits;
   f.runner.onMarketActivity({mint,signature,receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteMint:'So11111111111111111111111111111111111111112',quoteLamports:'100000000',evidence:'unverified-provider-activity-hint'});
   assert.equal(registry.health().transactions.writeCommits-before,1,'one outer FULL-WAL commit preserves both awareness and any watch changes');
   assert.equal(registry.marketEvidence(mint)?.buyLamports,'100000000');
  }
  assert.equal(f.runner.watch.lookupIdentity(known,f.now)?.lastActivityAt,f.now);assert.equal(f.resolveCalls,0);assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().verificationQueue,0);
  const beforeLookups=registry.health().transactions.writeCommits;for(let i=0;i<100;i++)f.runner.watch.lookupIdentity(unknown,f.now);assert.equal(registry.health().transactions.writeCommits,beforeLookups,'read-only lookups never become dirty WAL commits');await f.runner.stop();
 }finally{registry.close();}
});


test('worker intake callbacks do no main-thread writes; committed known activity applies from durable rows without double-counting hints',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt}),queued:Array<{kind:string;data:any}>=[],marketIntake:NativeMarketIntake={observeIdentity:data=>{queued.push({kind:'identity',data});},observeActivity:data=>{queued.push({kind:'activity',data});},observeFeed:data=>{queued.push({kind:'feed',data});},observeMigration:data=>{queued.push({kind:'migration',data});}},f=fixture({registry,marketIntake});try{
  const known=f.importActual(),unknown=new PublicKey(Buffer.alloc(32,182)).toBase58();f.setAllow(false);const before=registry.health().transactions.writeCommits;
  f.runner.onMarketIdentity({mint:unknown,receivedAt:f.now,source:'pumpportal-new-token',kind:'creation',evidence:'unverified-provider-discovery-hint'});
  f.runner.onMarketActivity({mint:known,signature:sig(59001),receivedAt:f.now,source:'pumpapi-broad',kind:'activity',side:'buy',quoteMint:'So11111111111111111111111111111111111111112',quoteLamports:'2000000000',evidence:'unverified-provider-activity-hint'});
  f.runner.onMarketFeed({source:'pumpapi-broad',at:f.now,connected:true,scope:'SHARED_ACTIVITY_HINTS'});assert.equal(queued.length,3);assert.equal(registry.health().transactions.writeCommits,before,'feed callbacks enqueue IPC only');assert.equal(f.runner.watch.lookupIdentity(known,f.now)?.lastActivityAt,null);
  for(const event of queued){if(event.kind==='activity')registry.observeActivity(event.data);else if(event.kind==='identity')registry.observeIdentity(event.data);else registry.observeFeed(event.data);}
  const committed=registry.health().transactions.writeCommits;f.runner.onMarketActivityCommitted(Array.from({length:2000},()=>({mint:unknown,at:f.now,evidence:'unverified-provider-activity-hint'})));assert.equal(registry.health().transactions.writeCommits,committed,'ACK message callback only marks durable progress pending');await f.runner.step();assert.equal(f.runner.watch.lookupIdentity(known,f.now)?.lastActivityAt,null,'financial/source pause leaves durable work for a later safe turn');
  f.setAllow(true);await f.runner.step();assert.equal(f.runner.watch.lookupIdentity(known,f.now)?.lastActivityAt,f.now);assert.equal(registry.marketEvidence(known)?.buyLamports,'2000000000','watch notification never replays already-committed global economics');assert.equal(f.runner.watch.lookupIdentity(unknown,f.now),undefined);assert.equal(f.resolveCalls,0);assert.equal(f.rpcCalls.length,0);await f.runner.stop();
 }finally{registry.close();}
});


test('actual confirmed/finalized origins rehydrate after real registry reopen despite feed-hint role and property ordering metadata',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-origin-rehydration-')),path=join(dir,'market.sqlite');let registry=new MarketRegistry(path,{now:()=>baseAt});try{
  const first=fixture({registry,productionResolver:true}),mint=first.importActual(),saved=registry.getOrigin<NativeOrigin&{identity:MigrationIdentity}>(mint)!;
  const hinted=decodeMigrationIdentity(original,{signature:originalSignature,commitment:'finalized',availableAt:baseAt,feedMint:mint});assert.ok(hinted.ok);assert.equal(hinted.identity.feedHintRole,'base');
  saved.identity=Object.fromEntries(Object.entries(hinted.identity).reverse()) as MigrationIdentity;registry.putOrigin(mint,saved);const unchangedBytes=JSON.stringify(registry.getOrigin(mint));await first.runner.stop();registry.close();
  registry=new MarketRegistry(path,{now:()=>baseAt});const second=fixture({registry,productionResolver:true});await second.steps(2);assert.ok(second.runner.status().candidates.some(row=>row.mint===mint));assert.equal(second.rpcCalls.length,0);assert.equal(JSON.stringify(registry.getOrigin(mint)),unchangedBytes,'original retained creation bytes and prior metadata remain unchanged');assert.equal(second.records.filter(row=>row.kind==='native-origin-metadata-rehydrated').length,1);assert.equal(second.records.some(row=>row.kind==='native-origin-proof-quarantined'),false);await second.runner.stop();
 }finally{registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('one genuinely invalid retained origin is quarantined without starving four independently valid actual creation proofs',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt}),f=fixture({registry,productionResolver:true,durableMarketPolicy:true,maximumDeep:4});try{
  const origins=JSON.parse(readFileSync('evidence/native-startup-20261028/retained-six-pool-startup.json','utf8')).origins as NativeOrigin[];f.advance(Math.max(...origins.flatMap(row=>[row.originConfirmed.availableAt,row.originFinalized.availableAt]))-f.now+1000);for(const origin of origins)f.runner.importOrigin(origin);
  const selected=f.runner.watch.next(f.now,new Set(),{requireOrigin:true})!,bad=selected.mint!,saved=registry.getOrigin<NativeOrigin&{identity:MigrationIdentity}>(bad)!;saved.originFinalized.transaction=null;registry.putOrigin(bad,saved);const second=f.runner.watch.next(f.now,new Set([bad]),{requireOrigin:true})!,wrongMetadata=registry.getOrigin<NativeOrigin&{identity:MigrationIdentity}>(second.mint!)!;wrongMetadata.identity.pool='11111111111111111111111111111111';registry.putOrigin(second.mint!,wrongMetadata);await f.steps(16);
  assert.equal(f.runner.status().candidates.length,4);assert.equal(f.runner.status().candidates.some(row=>row.mint===bad),false);assert.equal(registry.hasOrigin(bad),false);assert.equal(registry.hasOrigin(second.mint!),false,'canonical pool/role metadata mismatch remains a strict refusal');assert.ok(f.records.some(row=>row.kind==='native-origin-proof-quarantined'&&row.data.mint===second.mint&&row.data.reason==='NATIVE_DURABLE_ORIGIN_IDENTITY_MISMATCH'));assert.equal(registry.getOrigin<NativeOrigin>(bad)?.originFinalized.transaction,null,'invalid source bytes are retained rather than rewritten');assert.ok(f.records.some(row=>row.kind==='native-origin-proof-quarantined'&&row.data.mint===bad&&row.data.reason==='NATIVE_DURABLE_ORIGIN_PROOF_MISMATCH'));assert.equal(f.records.some(row=>row.kind==='native-candidate-work-unavailable'&&row.data.reason==='NATIVE_DURABLE_ORIGIN_PROOF_MISMATCH'),false);await f.runner.stop();
 }finally{registry.close();}
});


test('local slot allocation uses its125ms bookkeeping runway without claiming a3s physical setup or6s request reservation',async()=>{
 const f=fixture({maximumDeep:2,respectServicePolicy:true});const originalMint=f.importActual();await f.runner.step();const openedAt=f.states.get(originalMint)!.openedAt!,eligibleAt=Math.ceil(openedAt/10000)*10000+60000;f.advance(eligibleAt-f.now-2500);
 assert.equal(f.runner.discretionaryAdmission(6000).admitted,false);assert.equal(f.runner.discretionaryAdmission(3000).admitted,false);assert.equal(f.runner.discretionaryAdmission(125).admitted,true);
 const second=f.seed(2);await f.runner.step();await f.runner.step();assert.ok(f.added.includes(second),'a verified waiting identity receives local slot bookkeeping before the next audit boundary');assert.equal(f.states.get(second)?.openedAt,null,'physical subscription setup still waits for its separate declared operation runway');assert.equal(f.states.get(originalMint)?.openedAt,openedAt);assert.equal(f.runner.status().candidates.length,2);await f.runner.stop();
});

test('real concurrent intake writer contention is reported as local deferral without a provider or storage failure',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-runner-contention-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),locker=new Database(path);
 const f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,marketIntake:{observeIdentity(){},observeActivity(){},observeFeed(){},observeMigration(seed){registry.enqueueMigrationDelivery(seed);}}});
 try{
  const mint=f.seed(1);await f.steps(1);f.runner.onMarketActivityCommitted([{mint,at:f.now,evidence:'OFFLINE committed activity'}]);const before=registry.health().transactions.contentionBeforeCallback;
  locker.exec('BEGIN IMMEDIATE');assert.equal(await f.runner.step(),'wait');
  const event=f.records.find(r=>r.kind==='native-candidate-registry-contention');assert.ok(event);assert.equal(event.data.reason,'MARKET_REGISTRY_CONTENTION');assert.equal(event.data.sqliteCode,'SQLITE_BUSY');assert.equal(event.data.callbackStarted,false);assert.equal(event.data.providerRequestStarted,false);assert.equal(registry.health().transactions.contentionBeforeCallback,before+1);assert.equal(registry.health().storageFailures,0);assert.equal(registry.health().available,true);assert.equal(f.records.some(r=>r.kind==='native-candidate-work-unavailable'&&r.data.reason==='NATIVE_CANDIDATE_OPERATION_UNAVAILABLE'),false);assert.equal(f.rpcCalls.length,0);
  locker.exec('ROLLBACK');await f.steps(2);assert.ok(f.states.has(mint));
 }finally{if(locker.inTransaction)locker.exec('ROLLBACK');await f.runner.stop();locker.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('a one-shot suspended-scope gap survives a real writer refusal and releases its original slot after settlement',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-gap-contention-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),locker=new Database(path),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,maximumDeep:2});
 try{
  const mint=f.seed(1),healthy=f.seed(2);await f.steps(2);const opened=f.states.get(healthy)!.openedAt,originalSnapshot=f.flow.snapshot.bind(f.flow);f.flow.snapshot=((key:string,at?:number)=>{const view=originalSnapshot(key,at);return view&&key===mint?{...view,suspended:true,hasQualityLoss:true,warm:false,connected:false}:view;})as typeof f.flow.snapshot;
  locker.exec('BEGIN IMMEDIATE');assert.doesNotThrow(()=>f.runner.onGap({mint,at:f.now,reason:'BAD_POOL_OWNER'}));assert.doesNotThrow(()=>f.runner.onGap({mint,at:f.now,reason:'BAD_POOL_OWNER'}));assert.equal(f.states.size,2);assert.equal(f.removed.length,0);assert.equal(f.runner.status().counters.qualityGaps,0);assert.equal(await f.runner.step(),'wait');assert.equal(f.records.filter(r=>r.kind==='native-candidate-gap-retirement-deferred').length,1,'one retained intent per original candidate generation');
  locker.exec('ROLLBACK');await f.steps(3);assert.equal(f.states.has(mint),false);assert.equal(f.removed.filter(m=>m===mint).length,1);assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.state,'DEFERRED');assert.equal(f.runner.status().counters.qualityGaps,1);assert.equal(f.states.get(healthy)!.openedAt,opened,'unaffected capture is preserved');assert.equal(f.records.filter(r=>r.kind==='native-candidate-quality-gap'&&r.data.mint===mint).length,1);assert.equal(f.rpcCalls.length,0);assert.equal(registry.health().storageFailures,0);
 }finally{if(locker.inTransaction)locker.exec('ROLLBACK');await f.runner.stop();locker.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('gap retirement does not retry an arbitrary storage or logic exception as pre-callback contention',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt}),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(1);await f.steps(1);const transaction=registry.transaction.bind(registry),failure=Error('OFFLINE unexpected gap storage failure');let calls=0;
 try{registry.transaction=(()=>{calls++;throw failure;})as typeof transaction;assert.throws(()=>f.runner.onGap({mint,at:f.now,reason:'BAD_POOL_OWNER'}),error=>error===failure);assert.equal(calls,1);registry.transaction=transaction;await f.steps(2);assert.equal(f.removed.includes(mint),false,'non-contention failure was not silently replayed');assert.equal(f.records.some(r=>r.kind==='native-candidate-gap-retirement-deferred'),false);}finally{registry.transaction=transaction;await f.runner.stop();registry.close();}
});

test('worker migration callbacks never acquire the main writer; committed deliveries retry atomically after real contention',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-migration-delivery-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),workerRegistry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),locker=new Database(path),seeds:Array<{signature:string;feedMint?:string;receivedAt:number}>=[];
 const intake:NativeMarketIntake={observeIdentity(){},observeActivity(){},observeFeed(){},observeMigration(seed){seeds.push(structuredClone(seed));}},f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,marketIntake:intake});
 try{
  const before=registry.health().transactions.attempted;locker.exec('BEGIN IMMEDIATE');const mint=f.seed(1);assert.equal(seeds.length,1);assert.equal(registry.health().transactions.attempted,before,'migration feed callback only hands the original hint to intake');assert.equal(f.runner.status().counters.migrationHints,1);assert.equal(f.runner.watch.lookupIdentity(mint,f.now),undefined);locker.exec('ROLLBACK');
  workerRegistry.enqueueMigrationDelivery(seeds[0]!);locker.exec('BEGIN IMMEDIATE');assert.equal(await f.runner.step(),'wait');assert.deepEqual(workerRegistry.nextMigrationDelivery(),seeds[0]);assert.equal(f.runner.watch.lookupIdentity(mint,f.now),undefined,'a refused lease executes neither watch delivery nor completion');locker.exec('ROLLBACK');
  await f.steps(1);assert.equal(registry.nextMigrationDelivery(),undefined);assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.mint,mint);assert.equal(f.runner.status().counters.migrationHints,1,'delivering the durable item does not recount the hint');assert.equal(f.states.has(mint),true);assert.equal(f.rpcCalls.length,0);assert.equal(workerRegistry.enqueueMigrationDelivery(seeds[0]!),false,'a worker ACK replay cannot recreate a completed delivery');assert.equal(registry.nextMigrationDelivery(),undefined);
 }finally{if(locker.inTransaction)locker.exec('ROLLBACK');await f.runner.stop();locker.close();workerRegistry.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('pending migration delivery survives runner restart and an unexpected apply error without silent acknowledgement',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-migration-restart-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),seeds:Array<{signature:string;feedMint?:string;receivedAt:number}>=[],intake:NativeMarketIntake={observeIdentity(){},observeActivity(){},observeFeed(){},observeMigration(seed){seeds.push(structuredClone(seed));}};
 let current=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,marketIntake:intake});
 try{
  const mint=current.seed(1);registry.enqueueMigrationDelivery(seeds[0]!);await current.runner.stop();current=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,marketIntake:intake});const discover=current.runner.watch.discover.bind(current.runner.watch);current.runner.watch.discover=()=>{throw Error('OFFLINE migration delivery validation exception');};assert.equal(await current.runner.step(),'unavailable');assert.deepEqual(registry.nextMigrationDelivery(),seeds[0]);assert.equal(current.runner.watch.lookupIdentity(mint,current.now),undefined);current.runner.watch.discover=discover;
  await current.steps(1);assert.equal(registry.nextMigrationDelivery(),undefined);assert.equal(current.runner.watch.lookupIdentity(mint,current.now)!.mint,mint);assert.equal(current.runner.status().counters.migrationHints,0,'fresh run did not receive the old hint again');assert.equal(seeds.length,1);assert.equal(current.rpcCalls.length,0);
 }finally{await current.runner.stop();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('deferred source-gap retirement preserves pending financial ownership and cannot retire a replacement generation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-gap-generation-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),locker=new Database(path),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true});
 try{
  const mint=f.seed(1);await f.steps(1);locker.exec('BEGIN IMMEDIATE');f.runner.onGap({mint,at:f.now,reason:'BAD_POOL_OWNER'});locker.exec('ROLLBACK');f.ownership.set(mint,'ENTRY_PENDING');await f.steps(2);
  assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.state,'ENTRY_PENDING');assert.equal(f.ownership.get(mint),'ENTRY_PENDING','observation cleanup never cancels the independent financial obligation');assert.equal(f.states.has(mint),false,'unusable observation is not claimed as continuing protection');
  f.ownership.delete(mint);f.runner.syncFinancialOwnership(new Set([mint]));f.advance(30001);registry.observeIdentity({mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),signature:'OFFLINE-new-pool-hint',source:'shared-test',kind:'market-identity',at:f.now});await f.steps(2);assert.ok(f.states.has(mint));const original=(f.runner as any).candidates.get(mint);
  locker.exec('BEGIN IMMEDIATE');f.runner.onGap({mint,at:f.now,reason:'BAD_POOL_OWNER'});locker.exec('ROLLBACK');
  // An independent ownership/lifecycle action retires the old scope before
  // the delayed one-shot gap can take its next turn. Reuse the same mint with
  // a new candidate object to make the generation guard observable.
  (f.runner as any).retire(mint,'OFFLINE independent generation replacement',f.now,0);await f.flow.service();(f.runner as any).allocate(f.now);const replacement=(f.runner as any).candidates.get(mint);assert.ok(replacement&&replacement!==original);const removals=f.removed.length;
  await f.steps(1);assert.equal((f.runner as any).candidates.get(mint),replacement);assert.equal(f.removed.length,removals,'old queued gap cannot remove a new candidate generation');assert.equal(f.states.has(mint),true);assert.equal(f.rpcCalls.length,0);
 }finally{if(locker.inTransaction)locker.exec('ROLLBACK');await f.runner.stop();locker.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('a typed contention thrown after the gap callback starts is propagated without replaying its partial effects',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt}),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(1);await f.steps(1);const original=(f.runner as any).noteFailure,failure=new MarketRegistryContention('SQLITE_BUSY');let calls=0;
 try{
  (f.runner as any).noteFailure=()=>{calls++;throw failure;};assert.throws(()=>f.runner.onGap({mint,at:f.now,reason:'BAD_POOL_OWNER'}),error=>error===failure);assert.equal(calls,1);assert.equal(f.runner.status().counters.qualityGaps,1);(f.runner as any).noteFailure=original;await f.steps(2);assert.equal(f.runner.status().counters.qualityGaps,1,'a callback that started is never replayed as a refused lease');assert.equal(f.removed.includes(mint),false);assert.equal(f.records.some(r=>r.kind==='native-candidate-gap-retirement-deferred'),false);
 }finally{(f.runner as any).noteFailure=original;await f.runner.stop();registry.close();}
});

test('slot lifecycle: a writer collision after selection cannot create a phantom fourth native scope',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-allocation-atomic-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),locker=new Database(path),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true,maximumDeep:4});
 const next=f.runner.watch.next.bind(f.runner.watch);let locked=false;
 try{
  for(let n=1;n<=4;n++)f.seed(n);
  f.runner.watch.next=((...args:Parameters<typeof next>)=>{const row=next(...args);if(row&&!locked){locker.exec('BEGIN IMMEDIATE');locked=true;}return row;})as typeof next;
  assert.throws(()=>(f.runner as any).allocate(f.now),MarketRegistryContention);
  assert.equal(f.states.size,0);assert.equal((f.runner as any).candidates.size,0);assert.equal(f.runner.slotProductivity().counts.allocations,0);assert.equal(f.runner.watch.snapshot().summary.deepActive,0);
  locker.exec('ROLLBACK');f.runner.watch.next=next;await f.steps(10);
  assert.equal(f.states.size,4);assert.equal(f.runner.status().candidates.length,4);assert.equal(f.runner.watch.snapshot().summary.deepActive,4);assert.equal(f.runner.slotProductivity().slots.filter(s=>s.mint!==null).length,4);assert.equal(new Set(f.added).size,4);
 }finally{if(locker.inTransaction)locker.exec('ROLLBACK');f.runner.watch.next=next;await f.runner.stop();locker.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('slot lifecycle: outer rollback restores watch and productivity mirrors and starts no physical scope',async()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>baseAt}),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(1),mark=registry.markStage.bind(registry),before=f.runner.watch.snapshot().summary.promoted;
 try{
  registry.markStage=(()=>{throw Error('OFFLINE lifecycle durable-stage failure');})as typeof registry.markStage;
  assert.throws(()=>(f.runner as any).allocate(f.now),/OFFLINE lifecycle durable-stage failure/);
  assert.equal(f.states.size,0);assert.equal((f.runner as any).candidates.size,0);assert.equal(f.runner.watch.lookupIdentity(mint)!.deepSince,null);assert.equal(f.runner.watch.snapshot().summary.promoted,before);assert.equal(f.runner.slotProductivity().counts.allocations,0);
  registry.markStage=mark;await f.steps(2);assert.equal(f.states.size,1);assert.equal(f.runner.slotProductivity().counts.allocations,1);assert.equal(f.runner.watch.snapshot().summary.promoted,before+1);
 }finally{registry.markStage=mark;await f.runner.stop();registry.close();}
});

test('slot lifecycle: deferred retirement preserves ownership until its durable commit and unsubscribe settlement',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-retirement-atomic-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{concurrentIntake:true,now:()=>baseAt}),locker=new Database(path),f=fixture({registry,durableMarketPolicy:true,fairEconomicCompletions:true});
 try{
  const mint=f.seed(1);await f.steps(2);const candidate=(f.runner as any).candidates.get(mint);locker.exec('BEGIN IMMEDIATE');
  assert.equal((f.runner as any).retire(mint,'OFFLINE reviewed negative decision',f.now,0),false);
  assert.equal((f.runner as any).candidates.get(mint),candidate);assert.equal(f.states.has(mint),true);assert.equal(f.runner.slotProductivity().slots[0]!.mint,mint);assert.equal(f.runner.currentAuditCertificate(mint),null);
  f.advance(70000);assert.equal(await f.runner.step(),'wait');assert.equal(f.rpcCalls.length,0,'pending retirement cannot be audited repeatedly');
  locker.exec('ROLLBACK');await f.steps(1);assert.equal(f.states.has(mint),false);assert.equal(f.flowActions.at(-1),'unsubscribe');assert.equal(f.runner.slotProductivity().slots[0]!.mint,null);
  await f.steps(2);assert.equal(f.states.size,1);assert.notEqual((f.runner as any).candidates.get(mint),candidate);assert.equal(f.flow.snapshot(mint)!.warm,false,'replacement must warm a fresh window');
 }finally{if(locker.inTransaction)locker.exec('ROLLBACK');await f.runner.stop();locker.close();registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('slot lifecycle: stale WATCH membership is retired before another audit or certificate',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(1);await f.steps(2);const generation=(f.runner as any).candidates.get(mint);
 f.runner.watch.transition(mint,'DEFERRED','OFFLINE stale membership reproduction',f.now);f.advance(70000);f.refresh();
 await f.steps(1);assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.currentAuditCertificate(mint),null);assert.equal(f.states.has(mint),false);assert.ok(f.records.some(r=>r.kind==='native-candidate-membership-invalid'&&r.data.mint===mint));
 await f.steps(4);assert.notEqual((f.runner as any).candidates.get(mint),generation);assert.equal(f.rpcCalls.length,0);assert.equal(f.records.some(r=>r.kind==='native-candidate-work-unavailable'&&r.data.reason==='PILOT_WATCH_WINDOW_REQUIRES_DEEP'),false);await f.runner.stop();
});

test('slot lifecycle: an ownerless native scope is retired without pretending the subscription settled',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true});const mint=f.seed(1);await f.steps(2);
 (f.flow as any).candidateMints=()=>[...f.states.keys()];(f.runner as any).candidates.delete(mint);
 await f.steps(1);assert.equal(f.states.has(mint),false);assert.equal(f.runner.slotProductivity().slots[0]!.mint,null);assert.equal(f.runner.watch.lookupIdentity(mint)!.deepSince,null);assert.ok(f.records.some(r=>r.kind==='native-candidate-orphan-retired'&&r.data.physicalCapacityReleased===false));assert.equal(f.rpcCalls.length,0);await f.runner.stop();
});

test('slot lifecycle: failed native installation compensates durable admission without a phantom logical slot',async()=>{
 const f=fixture({durableMarketPolicy:true,fairEconomicCompletions:true}),mint=f.seed(1),add=f.flow.addCandidate;
 f.flow.addCandidate=()=>{throw Error('OFFLINE native installation refused');};
 assert.throws(()=>(f.runner as any).allocate(f.now),/OFFLINE native installation refused/);
 assert.equal(f.states.size,0);assert.equal(f.runner.status().candidates.length,0);assert.equal(f.runner.watch.lookupIdentity(mint)!.deepSince,null);assert.equal(f.runner.slotProductivity().slots[0]!.mint,null);
 f.flow.addCandidate=add;await f.steps(3);assert.equal(f.states.size,1);assert.equal(f.runner.watch.snapshot().summary.deepActive,1);await f.runner.stop();
});
