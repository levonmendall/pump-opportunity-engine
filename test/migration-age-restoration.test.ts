/** Offline coordinator mechanics. These fixtures prove ordering and ownership;
 * they do not claim live provider coverage or economically qualified trades. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import Database from 'better-sqlite3';
import bs58 from 'bs58';
import {MarketRegistry,MarketRegistryContention} from '../src/market-registry.js';
import {NativeCandidateRunner,type NativeMarketIntake} from '../src/native-candidate-runner.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION} from '../src/liquidity-resilient-momentum-v3-1.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';
import type {ResearchClockNativeObservationSupport} from '../src/research-clock-pricing.js';
import type {NativeObservationPreparationResult} from '../src/native-observation-preparation.js';
import {projectCandidatePreparationReporting} from '../src/candidate-preparation-reporting.js';

import {MIGRATION_AGE_POLICY,decodeMigrationAgeProof,migrationAgeDecision,PumpSwapMigrationAgeAdmission,type MigrationAgeProof} from '../src/migration-age-policy.js';
import {decodeMigrationIdentity} from '../src/migration-identity.js';
const original=JSON.parse(readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').find(line=>JSON.parse(line).kind==='migration-transaction')!).data;
const AT=Date.parse('2026-11-01T21:00:00Z');
const mint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
const pool=(m:string)=>canonicalPumpPoolPda(new PublicKey(m)).toBase58();
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
function proof(n:number,at=AT,createdAt=AT-3600000):TokenCreationProof{return {version:TOKEN_AGE_POLICY.version,mint:mint(n),signature:signature(n),slot:100,createdAt,availableAt:at,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)};}
function creation(n:number){const m=mint(n),curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),new PublicKey(m).toBuffer()],new PublicKey(PUMP))[0].toBase58();return {version:0,slot:100,blockTime:(AT-3600000)/1000,transaction:{signatures:[signature(n)],message:{accountKeys:[PUMP,TOKEN,m,mint(201),curve],instructions:[{programIdIndex:0,accounts:[2,3,4],data:bs58.encode(Buffer.concat([createHash('sha256').update('global:create').digest().subarray(0,8),Buffer.alloc(50)]))}]}},meta:{err:null,innerInstructions:[{index:0,instructions:[{programIdIndex:1,accounts:[2],data:bs58.encode(Buffer.from([20,...Buffer.alloc(34)])),stackHeight:2}]}]}};}
function fixture(options:{migration?:boolean;migrationProofReadyAt?:(signature:string,at:number)=>number;proofReadyAt?:(signature:string,at:number)=>number;pumpswapOnly?:true;marketIntake?:NativeMarketIntake;history?:unknown;rpcResponse?:(method:string,params:unknown[])=>unknown;path?:string;concurrentIntake?:boolean;enforceAge?:boolean;sourceWorkAdmission?:(bound:number)=>boolean;financialOwnership?:(mint:string)=>'HELD'|'ENTRY_PENDING'|null;transaction?:unknown}={}){
 let at=AT,runner:NativeCandidateRunner,refusal:string|null=null,retryAt:number|undefined,stopped=false,heartbeat=false,heartbeats=0;
 const registry=new MarketRegistry(options.path??':memory:',{now:()=>at,concurrentIntake:options.concurrentIntake}),states=new Map<string,{mint:string;pool:string;minSlot?:number}>(),preparedCalls:string[]=[],adopted:ResearchClockNativeObservationSupport[]=[],requests:string[]=[],requestCalls:Array<{method:string;params:unknown[];options:Record<string,unknown>}>=[],events:string[]=[],records:Array<{kind:string;data:any}>=[];
 const support=(m:string)=>({mint:m,pool:pool(m),at,sourceSlot:original.slot+100,evidence:'OFFLINE_CANONICAL_POOL_BINDING',summary:{marketClockUnixSeconds:Math.floor(at/1000),tokenProgram:TOKEN}} as ResearchClockNativeObservationSupport);
 const flow={
  async prepareObservation(scope:{mint:string},_signal?:AbortSignal,admission?:{admissionOpen?:()=>boolean}):Promise<NativeObservationPreparationResult>{assert.equal(states.has(scope.mint),false,'passive binding precedes allocation');assert.equal(admission?.admissionOpen?.(),true);preparedCalls.push(scope.mint);events.push('prepare:'+scope.mint);return refusal?{status:'unavailable',reason:refusal,...(retryAt===undefined?{}:{retryAt})}:{status:'ready',support:support(scope.mint)};},
  adoptPreparedObservation(m:string,binding:ResearchClockNativeObservationSupport){assert.equal(states.has(m),true);events.push('adopt:'+m);adopted.push(structuredClone(binding));runner.onCurrentPoolValidated(binding);},
  addCandidate(scope:{mint:string;pool:string;minSlot?:number}){states.set(scope.mint,{...scope});events.push('add:'+scope.mint);},removeCandidate(m:string){states.delete(m);},
  snapshot(m:string){const scope=states.get(m);return scope?{scope,openedAt:null,subscription:null,connectionId:null,connected:false,sourceSupportFresh:true,suspended:false,hasQualityLoss:false,features:null,warm:false}:null;},notificationLedger(){return [];},requestSupportRefresh(){},requestHeartbeat(){},async service(){if(heartbeat){heartbeat=false;heartbeats++;return {kind:'heartbeat'};}return {kind:'idle'};},
  usage(){return {candidates:states.size,retiring:0,connected:false,nextServiceAt:heartbeat?at:Infinity,nextServiceDomain:heartbeat?'control':null,nextServiceAction:heartbeat?'heartbeat':null,nextRequiredServiceAt:heartbeat?at:Infinity,nativeServiceDeadlines:heartbeat?[{action:'heartbeat',deadlineAt:at+2000}]:[],physicalTransportsSettled:stopped,fatal:null};},async stop(){stopped=true;states.clear();},
 };
 const rpc={migrationOriginProofReadyAt(signature:string,planningAt=at){return options.migrationProofReadyAt?.(signature,planningAt)??planningAt;},tokenCreationProofReadyAt(signature:string,planningAt=at){return options.proofReadyAt?.(signature,planningAt)??planningAt;},async call(method:string,params:unknown[],_signal?:AbortSignal,callOptions:Record<string,unknown>={}){requests.push(method);requestCalls.push({method,params,options:callOptions});events.push(method);if(options.rpcResponse)return options.rpcResponse(method,params);return method==='getSignaturesForAddress'?options.history??null:options.transaction??null;},usage(){return {inFlight:0,waitingOrOperating:false,dispatchWindow:{physicalBusy:false,readyAt:at}};},cooldownUntil(){return 0;}};
 runner=new NativeCandidateRunner({...(options.migration===false?{}:{enforceMigrationAge:true as const}),pumpswapOnly:true,marketIntake:options.marketIntake,registry,runId:'preparation-test',flow:flow as any,rpc:rpc as any,maximumDeep:4,now:()=>at,...(options.enforceAge===false?{}:{enforceTokenAge24h:true as const}),observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,sourceWorkAdmission:options.sourceWorkAdmission,financialOwnership:options.financialOwnership,onCandidateAllocated:id=>events.push('bridge:'+id.baseMint),record:(kind,data)=>records.push({kind,data})});

 return {runner,registry,flow,rpc,states,preparedCalls,adopted,requests,requestCalls,events,records,support,get now(){return at;},get heartbeats(){return heartbeats;},requireHeartbeat:()=>{heartbeat=true;},advance:(ms:number)=>{at+=ms;},refuse:(reason:string|null,until?:number)=>{refusal=reason;retryAt=until;},steps:async(n=1)=>{for(let i=0;i<n;i++)await runner.step();},close:async()=>{await runner.stop();registry.close();}};
}

function migrationProof(n:number,migrationAt=AT-120000,availableAt=AT):MigrationAgeProof{return {version:MIGRATION_AGE_POLICY.version,mint:mint(n),pool:pool(mint(n)),signature:signature(n),slot:100,migrationAt,availableAt,confirmedTransactionSha256:'a'.repeat(64),finalizedTransactionSha256:'b'.repeat(64)};}
function origin(age=120000){const tx=structuredClone(original);tx.blockTime=(AT-age)/1000;const signature=tx.transaction.signatures[0];return {tx,origin:{originConfirmed:{signature,availableAt:AT,transaction:tx},originFinalized:{signature,availableAt:AT,transaction:structuredClone(tx)}}};}
function migrationHint(f:ReturnType<typeof fixture>,m:string,signature:string){f.runner.onMigration({signature,feedMint:m,receivedAt:f.now});}
function activity(f:ReturnType<typeof fixture>,m:string,signature:string){f.runner.onMarketActivity({mint:m,pool:pool(m),signature,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',receivedAt:f.now,side:'buy',quoteLamports:'1000000',evidence:'unverified-provider-activity-hint'});}

test('migration policy: inclusive 1 minute and 24 hours, unavailable/future/mismatched proofs refuse',()=>{
 const p=migrationProof(1,AT,AT),m=p.mint;
 for(const [age,allowed] of [[59999,false],[60000,true],[60001,true],[86400000,true],[86400001,false]] as const)assert.equal(migrationAgeDecision(m,AT+age,p).allowed,allowed,String(age));
 assert.equal(migrationAgeDecision(m,AT+60000,null).reason,'MIGRATION_AGE_UNVERIFIED');
 assert.equal(migrationAgeDecision(m,AT-1,p).reason,'MIGRATION_AGE_INVALID');
 assert.equal(migrationAgeDecision(m,AT+60000,{...p,availableAt:AT+60001}).allowed,false);
 assert.equal(migrationAgeDecision(mint(2),AT+60000,p).allowed,false);
 const cache=new PumpSwapMigrationAgeAdmission([p]);assert.equal(cache.decision(m,AT+59999),'too-young');assert.equal(cache.decision(m,AT+60000),'eligible');assert.equal(cache.decision(m,AT+86400000),'eligible');assert.equal(cache.decision(m,AT+86400001),'expired');
 assert.throws(()=>cache.observeProof({...p,migrationAt:AT+1000,availableAt:AT+1000}),/CONFLICT/);
});

test('migration decoder requires matching confirmed/finalized genuine migration bytes, not creation or refresh metadata',()=>{
 const o=origin(),p=decodeMigrationAgeProof(o.origin,AT);assert.ok(p);assert.equal(p.migrationAt,AT-120000);assert.equal(p.availableAt,AT);
 assert.equal(decodeMigrationAgeProof({...o.origin,originFinalized:{...o.origin.originFinalized,transaction:null}},AT),null);
 const conflict=structuredClone(o.origin);(conflict.originFinalized.transaction as any).blockTime--;assert.equal(decodeMigrationAgeProof(conflict,AT),null);
 assert.equal(decodeMigrationAgeProof({...o.origin,originFinalized:{...o.origin.originFinalized,availableAt:AT+1}},AT),null);
 assert.equal(decodeMigrationAgeProof({originConfirmed:{signature:signature(1),availableAt:AT,transaction:creation(1)},originFinalized:{signature:signature(1),availableAt:AT,transaction:creation(1)}},AT),null);
});

test('migration registry does not reinterpret old mint-creation records and cannot refresh the migration birthday',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT,migrationAge:true});try{
  r.putTokenCreationProof(proof(2,AT,AT-3*86400000));r.putMigrationAgeProof(migrationProof(2));assert.equal(r.marketAgeEligibility(mint(2),AT).allowed,true,'old mint / young migration is eligible');
  r.putTokenCreationProof(proof(3));r.putMigrationAgeProof(migrationProof(3,AT-86401000));assert.equal(r.marketAgeEligibility(mint(3),AT).allowed,false,'young mint metadata cannot revive old migration');
  assert.equal(r.marketAgeEligibility(mint(4),AT).allowed,false);r.putTokenCreationProof(proof(4));assert.equal(r.marketAgeEligibility(mint(4),AT).allowed,false);
  assert.throws(()=>r.putMigrationAgeProof(migrationProof(2,AT-60000)),/CONFLICT/);
  r.putMigrationAgeProof({...migrationProof(2),availableAt:AT});assert.equal(r.migrationAgeSummary(AT).eligible,1);
 }finally{r.close();}
});

test('migration proof persistence, cache updates and original availability survive restart and rollback',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-migration-persistence-')),path=join(dir,'market.sqlite');let r=new MarketRegistry(path,{now:()=>AT,migrationAge:true});try{
  const cache=new PumpSwapMigrationAgeAdmission();r.onMigrationAgeProofCommitted(p=>cache.observeProof(p));
  assert.throws(()=>r.transaction(()=>{r.putMigrationAgeProof(migrationProof(5));throw Error('ROLLBACK');}),/ROLLBACK/);assert.equal(cache.decision(mint(5),AT),'unknown');
  r.putMigrationAgeProof(migrationProof(5));assert.equal(cache.decision(mint(5),AT),'eligible');r.close();r=new MarketRegistry(path,{now:()=>AT+86400000,migrationAge:true});
  const restored=new PumpSwapMigrationAgeAdmission(r.migrationAgeProofSnapshot(AT+86400000));assert.equal(restored.scope(mint(5))!.migrationAt,AT-120000);assert.equal(restored.decision(mint(5),AT+86400000),'expired');
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});

test('new migration progresses through actual resolver, current-pool preparation and slot admission without any mint-history call',async t=>{
 const o=origin(),id=decodeMigrationIdentity(o.tx,{signature:o.tx.transaction.signatures[0],commitment:'finalized',availableAt:AT});assert.ok(id.ok);
 const f=fixture({transaction:o.tx});t.mock.method(Date,'now',()=>f.now);
 try{
  f.registry.nextTokenCreationRequest=()=>{throw Error('CREATION_REQUEST_FORBIDDEN');};f.registry.nextTokenCreationHistoryRequest=()=>{throw Error('MINT_HISTORY_FORBIDDEN');};f.registry.tokenCreationProof=()=>{throw Error('CREATION_PROOF_FORBIDDEN');};
  migrationHint(f,id.identity.baseMint,id.identity.signature);assert.equal(f.registry.count(),0,'unverified migration is not a watch candidate');
  await f.steps(12);
  assert.deepEqual(f.requests,['getTransaction','getTransaction']);assert.deepEqual(f.requestCalls.map(r=>(r.params[1] as any).commitment),['confirmed','finalized']);assert.ok(f.requestCalls.every(r=>r.options.queryTimeoutScope==='migration-origin-proof'&&r.options.timeoutMs===1200&&r.options.operationBoundMs===1500),'only the upstream migration proof reads carry their purpose and unchanged physical bound');
  assert.ok(f.registry.migrationAgeProof(id.identity.baseMint));assert.ok(f.states.has(id.identity.baseMint));
  const status=f.runner.status();assert.equal(status.candidates[0]!.migrationAt,o.tx.blockTime*1000);assert.equal(status.candidates[0]!.migrationVerified,true);assert.equal(status.migrationAgeScope!.eligible,1);assert.equal(status.tokenAgeScope,undefined);
  assert.equal(status.financialWriterOpened,false);assert.equal(status.liveTradingEnabled,false);assert.equal(status.activeStrategyVersion,LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION);
 }finally{await f.close();}
});

test('too-young and expired migrations never receive a slot; exact minimum is admitted from a fresh hint',async()=>{
 const f=fixture();try{
  f.registry.putMigrationAgeProof(migrationProof(6,AT-59000));f.registry.putMigrationAgeProof(migrationProof(7,AT-86401000));
  migrationHint(f,mint(6),signature(6));migrationHint(f,mint(7),signature(7));await f.steps(4);assert.equal(f.states.size,0);assert.equal(f.requests.length,0);
  f.advance(1000);activity(f,mint(6),signature(86));await f.steps(5);assert.ok(f.states.has(mint(6)));assert.equal(f.states.has(mint(7)),false);assert.equal(f.requests.length,0);
 }finally{await f.close();}
});

test('four slots are retained and deep membership/technical retry use only the immutable admission interval',async()=>{
 const f=fixture();try{
  for(let n=10;n<15;n++){f.registry.putMigrationAgeProof(migrationProof(n));activity(f,mint(n),signature(n));}
  await f.steps(12);assert.equal(f.states.size,4);assert.equal(f.requests.length,0);
  const m=[...f.states.keys()][0]!,candidate=(f.runner as any).candidates.get(m),scope=candidate.marketAgeAtAdmission;assert.ok(Object.isFrozen(scope));assert.equal(scope.eligibleAt,scope.migrationAt+60000);
  f.registry.migrationAgeProof=()=>{throw Error('AGE_READ_IN_DEEP');};f.registry.marketAgeEligibility=()=>{throw Error('AGE_READ_IN_DEEP');};(f.runner as any).marketAgeAdmission.decision=()=>{throw Error('AGE_READ_IN_DEEP');};
  assert.equal((f.runner as any).observationMember(candidate,f.now),true);assert.equal(f.runner.requestTechnicalReevaluation(m,'entry-quote-unavailable',f.now,f.now),true);
  f.advance(scope.expiresAt-f.now);assert.equal((f.runner as any).observationMember(candidate,f.now),true);f.advance(1);assert.equal((f.runner as any).observationMember(candidate,f.now),false);
 }finally{await f.close();}
});

test('unknown/invalid migration retries do not invent age, reset age, or block an unrelated eligible candidate',async t=>{
 const f=fixture({transaction:null});t.mock.method(Date,'now',()=>f.now);try{
  migrationHint(f,mint(20),signature(20));await f.steps(6);assert.equal(f.registry.migrationAgeProof(mint(20)),null);const before=f.requests.length;await f.steps(6);assert.equal(f.requests.length,before,'persisted cooldown prevents a hot loop');
  f.registry.putMigrationAgeProof(migrationProof(21));activity(f,mint(21),signature(21));await f.steps(5);assert.ok(f.states.has(mint(21)));assert.equal(f.states.has(mint(20)),false);
 }finally{await f.close();}
});

test('pre-migration venue hints stay outside the PumpSwap-only market',async()=>{
 const f=fixture();try{
  f.runner.onMarketIdentity({mint:mint(30),signature:signature(30),source:'pumpportal-new-token',kind:'creation',receivedAt:f.now,evidence:'unverified-provider-discovery-hint'});
  f.runner.onMarketActivity({mint:mint(30),signature:signature(31),source:'pumpapi-broad',kind:'activity',venue:'pump',side:'buy',quoteLamports:'1000',receivedAt:f.now,evidence:'unverified-provider-activity-hint'});
  await f.steps(3);assert.equal(f.registry.count(),0);assert.equal(f.registry.nextMigrationAgeRequest(f.now),undefined);assert.equal(f.states.size,0);assert.equal(f.requests.length,0);
 }finally{await f.close();}
});

test('pending financial ownership is not retired by migration expiry',async()=>{
 let owner:'ENTRY_PENDING'|null=null;const f=fixture({financialOwnership:()=>owner});try{
  f.registry.putMigrationAgeProof(migrationProof(31,AT-86400000+1000));activity(f,mint(31),signature(31));await f.steps(5);assert.ok(f.states.has(mint(31)));
  owner='ENTRY_PENDING';f.runner.watch.transition(mint(31),'ENTRY_PENDING','OFFLINE actual pending obligation',f.now);f.advance(1001);await f.steps(3);
  assert.equal(f.runner.watch.lookupIdentity(mint(31),f.now)!.state,'ENTRY_PENDING');assert.ok(f.states.has(mint(31)));assert.equal(f.registry.marketAgeEligibility(mint(31),f.now).allowed,false,'only unfilled buys lose age permission');
 }finally{await f.close();}
});

function resumableOriginFixture(){
 const o=origin(),id=decodeMigrationIdentity(o.tx,{signature:o.tx.transaction.signatures[0],commitment:'finalized',availableAt:AT});assert.ok(id.ok);
 const seedSignature=signature(191),seedTx=structuredClone(o.tx);seedTx.transaction.signatures[0]=seedSignature;seedTx.meta.innerInstructions=[];seedTx.slot+=2000;seedTx.blockTime++;
 const page=Array.from({length:1000},(_,i)=>{const bytes=Buffer.alloc(64,11);bytes.writeUInt32LE(i+1000);return {signature:bs58.encode(bytes),slot:o.tx.slot+1500-i,blockTime:o.tx.blockTime+1,err:null};});
 const originRow={signature:id.identity.signature,slot:o.tx.slot,blockTime:o.tx.blockTime,err:null};
 const respond=(method:string,params:unknown[])=>method==='getSignaturesForAddress'?(params[1] as any).before?[originRow]:page:params[0]===seedSignature?seedTx:o.tx;
 return {o,id:id.identity,seedSignature,page,respond};
}

test('runner schedules durable migration pages before preparation and deep admission, with one physical read per step',async t=>{
 const source=resumableOriginFixture(),f=fixture({rpcResponse:source.respond});t.mock.method(Date,'now',()=>f.now);
 try{
  f.registry.nextTokenCreationRequest=()=>{throw Error('MINT_CREATION_FORBIDDEN');};f.registry.nextTokenCreationHistoryRequest=()=>{throw Error('MINT_HISTORY_FORBIDDEN');};
  activity(f,source.id.baseMint,source.seedSignature);
  for(let i=0;i<40&&!f.states.has(source.id.baseMint);i++){const before=f.requestCalls.length;await f.steps();assert.ok(f.requestCalls.length-before<=1,'each runner step owns at most one physical migration read');f.advance(10);}
  assert.ok(f.states.has(source.id.baseMint));assert.equal(f.registry.migrationAgeProof(source.id.baseMint)!.migrationAt,source.o.tx.blockTime*1000);
  assert.deepEqual(f.requestCalls.map(row=>row.method),['getTransaction','getSignaturesForAddress','getSignaturesForAddress','getTransaction','getTransaction']);
  assert.equal((f.requestCalls[2]!.params[1] as any).before,source.page.at(-1)!.signature);assert.ok(f.requestCalls.filter(row=>row.method==='getSignaturesForAddress').every(row=>row.params[0]===source.id.pool));
  assert.ok(f.records.some(row=>row.kind==='native-migration-age-progress'&&row.data.historyPages===2));assert.equal(f.runner.status().maximumSimultaneousCandidates,1);assert.equal(f.registry.migrationAgeSummary(f.now).recovery.checkpoints,0);
 }finally{await f.close();}
});

test('runner retains a completed migration page across pre-callback writer contention without another read',async t=>{
 const source=resumableOriginFixture(),dir=mkdtempSync(join(tmpdir(),'poe-migration-runner-lease-')),path=join(dir,'market.sqlite');let lock:Database.Database|undefined,held=false;
 const f=fixture({path,concurrentIntake:true,rpcResponse:(method,params)=>{const value=source.respond(method,params);if(method==='getSignaturesForAddress'&&!held){lock!.exec('BEGIN IMMEDIATE');held=true;}return value;}});lock=new Database(path);t.mock.method(Date,'now',()=>f.now);
 try{
  activity(f,source.id.baseMint,source.seedSignature);for(let i=0;i<10&&!held;i++){await f.steps();f.advance(10);}assert.equal(held,true);
  const seed={signature:source.seedSignature,feedMint:source.id.baseMint,receivedAt:AT};assert.equal(f.registry.migrationAgeRecovery(seed),null);const reads=f.requestCalls.length;lock.exec('ROLLBACK');
  await f.steps();assert.equal(f.requestCalls.length,reads);assert.equal(f.registry.migrationAgeRecovery(seed)!.historyPages,1);assert.equal(f.states.size,0);
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('runner discards a late migration page when ownership changes or a direct seed supersedes it',async t=>{
 for(const change of ['ownership','seed'] as const){
  const source=resumableOriginFixture();let owner:'HELD'|null=null,changed=false,f:ReturnType<typeof fixture>;
  f=fixture({financialOwnership:()=>owner,rpcResponse:(method,params)=>{const value=source.respond(method,params);if(method==='getSignaturesForAddress'&&!changed){changed=true;if(change==='ownership')owner='HELD';else migrationHint(f,source.id.baseMint,source.id.signature);}return value;}});t.mock.method(Date,'now',()=>f.now);
  try{
   activity(f,source.id.baseMint,source.seedSignature);for(let i=0;i<10&&!changed;i++){await f.steps();f.advance(10);}assert.equal(changed,true);await f.steps();
   const seed={signature:source.seedSignature,feedMint:source.id.baseMint,receivedAt:AT};assert.equal(f.registry.migrationAgeRecovery(seed),null);assert.equal(f.registry.migrationAgeProof(source.id.baseMint),null);assert.equal(f.states.size,0);
   assert.ok(f.records.some(row=>row.kind==='native-migration-age-result-discarded'&&row.data.reason===(change==='ownership'?'MIGRATION_OWNERSHIP_CHANGED':'MIGRATION_REQUEST_SUPERSEDED')));
  }finally{await f.close();t.mock.restoreAll();}
 }
});

for(const completed of ['history-page','verified-origin'] as const)test(`completed migration ${completed} survives a writer lease beyond the workflow request deadline`,async t=>{
 const source=resumableOriginFixture(),dir=mkdtempSync(join(tmpdir(),'poe-migration-completed-deadline-')),path=join(dir,'market.sqlite');let lock:Database.Database|undefined,held=false;
 const f=fixture({path,concurrentIntake:true,rpcResponse:(method,params)=>{const value=source.respond(method,params),selected=completed==='history-page'?method==='getSignaturesForAddress':method==='getTransaction'&&(params[1] as any).commitment==='finalized';if(selected&&!held){lock!.exec('BEGIN IMMEDIATE');held=true;}return value;}});lock=new Database(path);t.mock.method(Date,'now',()=>f.now);
 try{
  activity(f,source.id.baseMint,source.seedSignature);for(let i=0;i<30&&!held;i++){await f.steps();f.advance(10);}assert.equal(held,true);
  const seed={signature:source.seedSignature,feedMint:source.id.baseMint,receivedAt:AT},session=(f.runner as any).verificationSession,originalResult=structuredClone(session.result),reads=f.requestCalls.length;
  assert.ok(originalResult);assert.equal(originalResult.ok,completed==='verified-origin');assert.equal(session.controller.signal.aborted,false);
  f.advance(session.deadlineAt-f.now+1);await f.steps();
  assert.ok((f.runner as any).verificationSession===session,'an already complete result is retained while its commit is still blocked');assert.equal(session.controller.signal.aborted,false,'the elapsed request budget does not cancel completed evidence');assert.deepEqual(session.result,originalResult);assert.equal(f.requestCalls.length,reads);
  lock.exec('ROLLBACK');await f.steps();assert.equal(f.requestCalls.length,reads,'commit retry does not request the same page or proof again');
  if(completed==='history-page'){assert.deepEqual(f.registry.migrationAgeRecovery(seed),originalResult.recovery);assert.equal(f.registry.migrationAgeProof(source.id.baseMint),null);}
  else{const expected=decodeMigrationAgeProof(originalResult.proof,f.now)!;assert.deepEqual(f.registry.migrationAgeProof(source.id.baseMint),expected);assert.equal(expected.migrationAt,source.o.tx.blockTime*1000);assert.ok(expected.availableAt<session.deadlineAt);assert.equal(f.registry.marketAgeEligibility(source.id.baseMint,expected.migrationAt+86_400_000).allowed,true);assert.equal(f.registry.marketAgeEligibility(source.id.baseMint,expected.migrationAt+86_400_001).allowed,false);}
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

for(const changed of ['source-stop','aborted','seed','ownership'] as const)test(`completed migration proof still refuses ${changed} after a delayed commit`,async t=>{
 const source=resumableOriginFixture(),dir=mkdtempSync(join(tmpdir(),'poe-migration-completed-invalid-')),path=join(dir,'market.sqlite');let lock:Database.Database|undefined,held=false,owner:'HELD'|null=null;
 const f=fixture({path,concurrentIntake:true,financialOwnership:()=>owner,rpcResponse:(method,params)=>{const value=source.respond(method,params);if(method==='getTransaction'&&(params[1] as any).commitment==='finalized'&&!held){lock!.exec('BEGIN IMMEDIATE');held=true;}return value;}});lock=new Database(path);t.mock.method(Date,'now',()=>f.now);
 try{
  activity(f,source.id.baseMint,source.seedSignature);for(let i=0;i<30&&!held;i++){await f.steps();f.advance(10);}assert.equal(held,true);
  const session=(f.runner as any).verificationSession,reads=f.requestCalls.length;assert.equal(session.result?.ok,true);f.advance(session.deadlineAt-f.now+1);lock.exec('ROLLBACK');
  if(changed==='source-stop')(f.runner as any).sourceAdmissionStopReason='OFFLINE_SOURCE_STOP';
  if(changed==='aborted')session.controller.abort();
  if(changed==='ownership')owner='HELD';
  if(changed==='seed')f.registry.observePumpSwapQualificationHint({mint:source.id.baseMint,signature:source.id.signature,receivedAt:f.now,source:'pumpportal-migration',kind:'migration'});
  (f.runner as any).finishVerification(session);assert.equal(f.requestCalls.length,reads);assert.equal(f.registry.migrationAgeProof(source.id.baseMint),null);assert.equal(f.states.size,0);
  const expected=changed==='seed'?'MIGRATION_REQUEST_SUPERSEDED':changed==='ownership'?'MIGRATION_OWNERSHIP_CHANGED':'MIGRATION_SOURCE_CHANGED';assert.ok(f.records.some(row=>row.kind==='native-migration-age-result-discarded'&&row.data.reason===expected));
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('an incomplete migration workflow still stops further requests at its original deadline',async t=>{
 const source=resumableOriginFixture(),f=fixture({rpcResponse:source.respond});t.mock.method(Date,'now',()=>f.now);
 try{
  activity(f,source.id.baseMint,source.seedSignature);for(let i=0;i<10&&!f.requestCalls.length;i++){await f.steps();f.advance(10);}
  const session=(f.runner as any).verificationSession,reads=f.requestCalls.length;assert.equal(reads,1);assert.equal(session.result,null);assert.ok(session.pending);f.advance(session.deadlineAt-f.now);
  await f.steps();assert.equal(session.controller.signal.aborted,true);assert.equal(f.requestCalls.length,reads);assert.equal(f.registry.migrationAgeProof(source.id.baseMint),null);assert.equal(f.states.size,0);
 }finally{await f.close();}
});


test('migration query backoff uses the actual resumed candidate signature and retains its cursor until the next feasible turn',async t=>{
 const o=origin(),id=decodeMigrationIdentity(o.tx,{signature:o.tx.transaction.signatures[0],commitment:'finalized',availableAt:AT});assert.ok(id.ok);
 const seedSignature=signature(183),initial=structuredClone(o.tx);initial.transaction.signatures[0]=seedSignature;initial.meta.innerInstructions=[];
 const readyAt=AT+2000,queried:string[]=[];
 const f=fixture({migrationProofReadyAt:(sig,at)=>{queried.push(sig);return sig===id.identity.signature?Math.max(at,readyAt):at;},rpcResponse:(method,params)=>method==='getSignaturesForAddress'?[{signature:id.identity.signature,slot:o.tx.slot,err:null,blockTime:o.tx.blockTime}]:params[0]===seedSignature?initial:o.tx});t.mock.method(Date,'now',()=>f.now);
 try{
  migrationHint(f,id.identity.baseMint,seedSignature);await f.steps(12);f.advance(1);await f.steps(6);
  assert.deepEqual(f.requests,['getTransaction','getSignaturesForAddress']);assert.equal(f.requestCalls[0]!.options.queryTimeoutScope,'migration-origin-proof');assert.equal(f.requestCalls[1]!.options.queryTimeoutScope,undefined,'pool pagination keeps its existing route and admission');
  const seed={signature:seedSignature,feedMint:id.identity.baseMint,receivedAt:AT},checkpoint=f.registry.migrationAgeRecovery(seed);assert.ok(checkpoint);assert.equal(checkpoint.phase,'candidate');
  const deferrals=f.records.filter(r=>r.kind==='native-origin-query-deferred');assert.equal(deferrals.length,1);assert.equal(deferrals[0]!.data.signature,seedSignature);assert.equal(deferrals[0]!.data.querySignature,id.identity.signature);assert.equal(deferrals[0]!.data.queryReadyAt,readyAt);assert.equal(deferrals[0]!.data.physicalRequestStarted,false);
  assert.ok(queried.includes(id.identity.signature));assert.equal(f.registry.migrationAgeProof(id.identity.baseMint),null);assert.equal(f.states.size,0);
  f.requireHeartbeat();await f.steps(3);assert.equal(f.heartbeats,1,'query backoff does not consume required native maintenance');assert.deepEqual(f.registry.migrationAgeRecovery(seed),checkpoint);assert.equal(f.records.filter(r=>r.kind==='native-origin-query-deferred').length,1,'unchanged waiting state is coalesced');
  f.advance(1999);await f.steps(15);assert.ok(f.registry.migrationAgeProof(id.identity.baseMint));assert.equal(f.registry.migrationAgeProof(id.identity.baseMint)!.migrationAt,o.tx.blockTime*1000);assert.equal(f.registry.migrationAgeProof(id.identity.baseMint)!.availableAt,readyAt);
  const finalCalls=f.requestCalls.slice(2);assert.equal(finalCalls.length,2);assert.ok(finalCalls.every(r=>r.params[0]===id.identity.signature&&r.options.queryTimeoutScope==='migration-origin-proof'));assert.deepEqual(finalCalls.map(r=>(r.params[1] as any).commitment),['confirmed','finalized']);assert.equal(f.registry.migrationAgeRecovery(seed),null);
 }finally{await f.close();}
});

test('migration query waiting cannot extend the original 20-second workflow or fabricate verified age',async t=>{
 const o=origin(),id=decodeMigrationIdentity(o.tx,{signature:o.tx.transaction.signatures[0],commitment:'finalized',availableAt:AT});assert.ok(id.ok);
 const f=fixture({transaction:o.tx,migrationProofReadyAt:()=>AT+60000});t.mock.method(Date,'now',()=>f.now);
 try{
  migrationHint(f,id.identity.baseMint,id.identity.signature);await f.steps(8);const row=f.records.find(r=>r.kind==='native-origin-query-deferred')!.data;assert.equal(row.workflowStartedAt,AT);assert.equal(row.workflowDeadlineAt,AT+20000);assert.equal(f.requests.length,0);
  f.advance(20000);await f.steps(3);assert.equal(f.requests.length,0);assert.equal(f.registry.migrationAgeProof(id.identity.baseMint),null);assert.equal(f.states.size,0);
  assert.ok(f.records.some(r=>r.kind==='native-migration-age-result-discarded'&&r.data.at===AT+20000));assert.equal(f.records.filter(r=>r.kind==='native-origin-query-deferred').length,1);assert.equal(row.workflowDeadlineAt,AT+20000);
 }finally{await f.close();}
});
