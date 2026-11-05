/** Offline coordinator mechanics. These fixtures prove ordering and ownership;
 * they do not claim live provider coverage or economically qualified trades. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import Database from 'better-sqlite3';
import bs58 from 'bs58';
import {MarketRegistry,MarketRegistryContention} from '../src/market-registry.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeMarketIntake,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION} from '../src/liquidity-resilient-momentum-v3-1.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';
import type {ResearchClockNativeObservationSupport} from '../src/research-clock-pricing.js';
import type {NativeObservationPreparationResult} from '../src/native-observation-preparation.js';
import {projectCandidatePreparationReporting} from '../src/candidate-preparation-reporting.js';
import {pilotLowerPriorityAdmission} from '../src/pilot.js';
import {FlowWindow} from '../src/strategy.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {nativePaperManagementReserve,nativePaperSourceWorkAdmission} from '../src/run-native-paper.js';

const AT=Date.parse('2026-11-01T21:00:00Z');
const mint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
const pool=(m:string)=>canonicalPumpPoolPda(new PublicKey(m)).toBase58();
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
function proof(n:number,at=AT,createdAt=AT-3600000):TokenCreationProof{return {version:TOKEN_AGE_POLICY.version,mint:mint(n),signature:signature(n),slot:100,createdAt,availableAt:at,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)};}
function creation(n:number){const m=mint(n),curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),new PublicKey(m).toBuffer()],new PublicKey(PUMP))[0].toBase58();return {version:0,slot:100,blockTime:(AT-3600000)/1000,transaction:{signatures:[signature(n)],message:{accountKeys:[PUMP,TOKEN,m,mint(201),curve],instructions:[{programIdIndex:0,accounts:[2,3,4],data:bs58.encode(Buffer.concat([createHash('sha256').update('global:create').digest().subarray(0,8),Buffer.alloc(50)]))}]}},meta:{err:null,innerInstructions:[{index:0,instructions:[{programIdIndex:1,accounts:[2],data:bs58.encode(Buffer.from([20,...Buffer.alloc(34)])),stackHeight:2}]}]}};}
function fixture(options:{financialEvaluationPending?:(mint:string,at:number)=>boolean;proofReadyAt?:(signature:string,at:number)=>number;pumpswapOnly?:true;marketIntake?:NativeMarketIntake;history?:unknown;rpcResponse?:(method:string,params:unknown[])=>unknown;path?:string;concurrentIntake?:boolean;enforceAge?:boolean;sourceWorkAdmission?:(bound:number)=>boolean;financialOwnership?:(mint:string)=>'HELD'|'ENTRY_PENDING'|null;transaction?:unknown}={}){
 let at=AT,runner:NativeCandidateRunner,refusal:string|null=null,retryAt:number|undefined,stopped=false,heartbeat=false,heartbeats=0;
 const registry=new MarketRegistry(options.path??':memory:',{now:()=>at,concurrentIntake:options.concurrentIntake}),states=new Map<string,{mint:string;pool:string;minSlot?:number}>(),preparedCalls:string[]=[],adopted:ResearchClockNativeObservationSupport[]=[],requests:string[]=[],requestCalls:Array<{method:string;params:unknown[];options:Record<string,unknown>}>=[],events:string[]=[],records:Array<{kind:string;data:any}>=[];
 const support=(m:string)=>({mint:m,pool:pool(m),at,sourceSlot:100,evidence:'OFFLINE_CANONICAL_POOL_BINDING',summary:{marketClockUnixSeconds:Math.floor(at/1000),tokenProgram:TOKEN}} as ResearchClockNativeObservationSupport);
 const flow={
  async prepareObservation(scope:{mint:string},_signal?:AbortSignal,admission?:{admissionOpen?:()=>boolean}):Promise<NativeObservationPreparationResult>{assert.equal(states.has(scope.mint),false,'passive binding precedes allocation');assert.equal(admission?.admissionOpen?.(),true);preparedCalls.push(scope.mint);events.push('prepare:'+scope.mint);return refusal?{status:'unavailable',reason:refusal,...(retryAt===undefined?{}:{retryAt})}:{status:'ready',support:support(scope.mint)};},
  adoptPreparedObservation(m:string,binding:ResearchClockNativeObservationSupport){assert.equal(states.has(m),true);events.push('adopt:'+m);adopted.push(structuredClone(binding));runner.onCurrentPoolValidated(binding);},
  addCandidate(scope:{mint:string;pool:string;minSlot?:number}){states.set(scope.mint,{...scope});events.push('add:'+scope.mint);},removeCandidate(m:string){states.delete(m);},
  snapshot(m:string){const scope=states.get(m);return scope?{scope,openedAt:null,subscription:null,connectionId:null,connected:false,sourceSupportFresh:true,suspended:false,hasQualityLoss:false,features:null,warm:false}:null;},notificationLedger(){return [];},requestSupportRefresh(){},requestHeartbeat(){},async service(){if(heartbeat){heartbeat=false;heartbeats++;return {kind:'heartbeat'};}return {kind:'idle'};},
  usage(){return {candidates:states.size,retiring:0,connected:false,nextServiceAt:heartbeat?at:Infinity,nextServiceDomain:heartbeat?'control':null,nextServiceAction:heartbeat?'heartbeat':null,nextRequiredServiceAt:heartbeat?at:Infinity,nativeServiceDeadlines:heartbeat?[{action:'heartbeat',deadlineAt:at+2000}]:[],physicalTransportsSettled:stopped,fatal:null};},async stop(){stopped=true;states.clear();},
 };
 const rpc={tokenCreationProofReadyAt(signature:string,planningAt=at){return options.proofReadyAt?.(signature,planningAt)??planningAt;},async call(method:string,params:unknown[],_signal?:AbortSignal,callOptions:Record<string,unknown>={}){requests.push(method);requestCalls.push({method,params,options:callOptions});events.push(method);if(options.rpcResponse)return options.rpcResponse(method,params);return method==='getSignaturesForAddress'?options.history??null:options.transaction??null;},usage(){return {inFlight:0,waitingOrOperating:false,dispatchWindow:{physicalBusy:false,readyAt:at}};},cooldownUntil(){return 0;}};
 runner=new NativeCandidateRunner({pumpswapOnly:options.pumpswapOnly,marketIntake:options.marketIntake,registry,runId:'preparation-test',flow:flow as any,rpc:rpc as any,maximumDeep:4,now:()=>at,...(options.enforceAge===false?{}:{enforceTokenAge24h:true as const}),observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION,sourceWorkAdmission:options.sourceWorkAdmission,financialOwnership:options.financialOwnership,financialEvaluationPending:options.financialEvaluationPending,onCandidateAllocated:id=>events.push('bridge:'+id.baseMint),record:(kind,data)=>records.push({kind,data})});
 const seed=(n:number,knownAge=true,creationHint=true)=>{const m=mint(n);if(knownAge)registry.putTokenCreationProof(proof(n,at));if(creationHint)runner.onMarketIdentity({mint:m,source:'pumpportal-new-token',kind:'creation',venue:'pump',signature:signature(n),receivedAt:at,evidence:'unverified-provider-discovery-hint'});if(options.pumpswapOnly)runner.onMarketIdentity({mint:m,source:'pumpportal-migration',kind:'migration',signature:signature(n+80),receivedAt:at,evidence:'unverified-provider-discovery-hint'});runner.onMigration({signature:signature(n+80),feedMint:m,receivedAt:at});runner.onMarketActivity({mint:m,source:'pumpapi-broad',kind:'activity',venue:'pump',signature:signature(n+100),side:'buy',quoteLamports:'1000',receivedAt:at,evidence:'unverified-provider-activity-hint'});return m;};
 return {runner,registry,flow,rpc,states,preparedCalls,adopted,requests,requestCalls,events,records,seed,support,get now(){return at;},get heartbeats(){return heartbeats;},requireHeartbeat:()=>{heartbeat=true;},advance:(ms:number)=>{at+=ms;},refuse:(reason:string|null,until?:number)=>{refusal=reason;retryAt=until;},steps:async(n=1)=>{for(let i=0;i<n;i++)await runner.step();},close:async()=>{await runner.stop();registry.close();}};
}

function economicHint(f:ReturnType<typeof fixture>,n:number,quoteLamports='20000000000'){
 f.runner.onMarketActivity({mint:mint(n),pool:pool(mint(n)),source:'pumpapi-broad',kind:'activity',venue:'pump-amm',signature:signature(n+140),side:'buy',quoteLamports,receivedAt:f.now,evidence:'unverified-provider-activity-hint'});
}

/** Synthetic completed audit over a real closed-window feature object. This
 * fixture exercises current certificate/generation checks, not live auditing. */
function certifiedGeneration(f:ReturnType<typeof fixture>,mints:readonly string[],certified:readonly string[]=mints){
 const openedAt=f.now,windows=new Map(mints.map(m=>[m,new FlowWindow(m,openedAt)])),snapshot=f.flow.snapshot.bind(f.flow);
 for(const m of mints){assert.ok(f.states.has(m));f.runner.onFlowOpen({mint:m,at:openedAt});}
 Object.assign(f.flow,{snapshot:(m:string,at=f.now)=>{const base=snapshot(m),window=windows.get(m);if(!base||!window)return base;const features=window.features(at),opening={slot:100,availableAt:openedAt,bankClockAt:openedAt},upper={slot:200,availableAt:at,bankClockAt:at};return {...base,openedAt,subscription:1,connectionId:1,connected:true,warm:features.sufficientlyObserved,features,supportContext:upper,openingSupportContext:opening,supportContexts:[opening,upper]};}});
 f.advance(64000);
 const certificates=new Map<string,NativeAuditCertificate>();
 for(const m of certified){
  const features=windows.get(m)!.features(f.now),c=(f.runner as any).candidates.get(m);
  const certificate:NativeAuditCertificate={schemaVersion:1,mint:m,pool:pool(m),dataContract:f.runner.dataContract,openedAt,connectionId:1,subscriptionId:1,windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditAvailableAt:f.now,admittedAt:f.now,deadlineAt:features.windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:nativePaperFeaturesSha256(features)};
  (f.runner as any).certificates.set(m,certificate);c.lastAssessmentEnd=features.windowEndAt;c.nextAuditAt=features.windowEndAt+10000;c.lastReadyWindowEnd=features.windowEndAt;c.lastReadyObservedAt=f.now;
  assert.deepEqual(f.runner.currentAuditCertificate(m,f.now),certificate);certificates.set(m,certificate);
 }
 return certificates;
}

function pendingBirthLookup(f:ReturnType<typeof fixture>,n:number,kind:'proof'|'history'='proof'){
 const m=f.seed(n,false,false);f.registry.putObservationPreparation({mint:m,pool:pool(m),checkedAt:f.now,state:'pool-ready',reason:'OFFLINE_QUALIFIER_CANONICAL_POOL'});
 const request={mint:m,before:null,beforeSlot:null,until:null,untilSlot:null,oldestCandidate:null,oldestCandidateSlot:null};
 if(kind==='proof'){f.registry.deferTokenCreationHistory(request,f.now,'TOKEN_CREATION_HISTORY_PENDING');assert.equal(f.registry.applyTokenCreationHistoryPage(request,{kind:'candidate',signature:signature(n),slot:100},f.now),true);}
 return {mint:m,proof:{mint:m,signature:signature(n)},history:request};
}

test('certified financial priority lets the unchanged nine-start envelope recover before certificate expiry',async()=>{
 let f:ReturnType<typeof fixture>,financialDue=false,lastUsable=AT,starts:number[]=[];
 f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>financialDue,sourceWorkAdmission:bound=>pilotLowerPriorityAdmission({now:f?.now??AT,endAt:AT+3600000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound}).admitted,rpcResponse:()=>{starts.push(f.now);return null;}});try{
  const m=f.seed(100);await f.steps(2);const certificate=certifiedGeneration(f,[m]).get(m)!;lastUsable=f.now-400;const start=f.now;financialDue=true;
  const protectedStarts=Array.from({length:30},(_,i)=>start-58500+i*2000),ordinary=[start-9500,start-3000,start-2000];
  const usage=()=>{const all=[...protectedStarts,...ordinary,...starts];return {chapter:0,newUnits:0,maximumNewUnits:1500,newAccountedResponseBytes:0,maximumNewResponseBytes:268435456,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:all.filter(at=>at>f.now-60000).length,rolling10SecondStarts:all.filter(at=>at>f.now-10000).length},protectionRecovery:{rolling60SecondStarts:30,rolling10SecondStarts:5}};};
  const pending=pendingBirthLookup(f,101);assert.equal(certificate.deadlineAt-start,5999);assert.equal(nativePaperManagementReserve(usage(),true,true,9).entryAllowed,false);
  assert.equal(nativePaperSourceWorkAdmission({informationOpen:true,owned:true,entryWork:false,discretionarySetup:true,usage:usage(),persistent:true}),true,'the ordinary setup budget alone would admit a competing start');
  await f.steps();assert.deepEqual(f.requests,[],'a current financial certificate takes priority over optional birth proof');assert.equal(f.registry.tokenCreationRequestPending(pending.proof,f.now),false,'waiting does not record a birth attempt');
  f.advance(501);assert.equal(nativePaperManagementReserve(usage(),true,true,9).entryAllowed,true,'the old start ages out while all nine entry starts and four protected starts remain reserved');assert.ok(f.runner.currentAuditCertificate(m,f.now));
  starts=[start];assert.equal(nativePaperManagementReserve(usage(),true,true,9).entryAllowed,false,'one otherwise legal optional start would erase the recovered headroom');starts=[];
  financialDue=false;await f.steps();assert.deepEqual(f.requests,['getTransaction'],'ordinary qualification resumes after the financial owner releases priority');assert.equal(f.registry.tokenCreationProof(pending.mint),null);
 }finally{await f.close();}
});

for(const kind of ['allocation','preparation','qualification','proof','history'] as const)test('certified financial priority defers new '+kind+' work and releases it after the decision',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const current=f.seed(102);await f.steps(2);certifiedGeneration(f,[current]);
  const target=kind==='proof'||kind==='history'?pendingBirthLookup(f,103,kind).mint:f.seed(103,kind!=='qualification');
  if(kind==='allocation')await (f.runner as any).prepareObservation(f.runner.watch.lookupIdentity(target,f.now),f.now+2000);
  const prepared=f.preparedCalls.length,requests=f.requests.length;due=true;await f.steps();assert.equal(f.states.size,1);assert.equal(f.preparedCalls.length,prepared);assert.equal(f.requests.length,requests);assert.equal(f.runner.pipelineThroughput().capacityWitness.localReady,false,'capacity reporting includes the current financial scheduling priority');
  if(kind==='allocation'){const deferred=f.records.findLast(row=>row.kind==='native-deep-admission-deferred')!.data;assert.equal(deferred.reason,'certified-financial-decision-before-replacement-setup');assert.deepEqual(deferred.readyMints,[],'the diagnostic must not attribute financial priority to ready audits');}
  due=false;await f.steps(2);if(kind==='allocation'||kind==='preparation')assert.equal(f.states.has(target),true);else if(kind==='qualification')assert.ok(f.preparedCalls.includes(target));else assert.ok(f.requests.length>requests);
 }finally{await f.close();}
});

for(const reason of ['expired','generation-mismatch','retry-awaiting-newer-window','retry-claimed','owner-permission-closed'] as const)test('certified financial priority does not retain '+reason+' work',async()=>{
 let callbacks=0;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>{callbacks++;return reason!=='owner-permission-closed';}});try{
  const m=f.seed(104);await f.steps(2);const certificate=certifiedGeneration(f,[m]).get(m)!,pending=pendingBirthLookup(f,105);
  if(reason==='expired')f.advance(certificate.deadlineAt-f.now+1);
  if(reason==='generation-mismatch')(f.runner as any).certificates.set(m,{...certificate,connectionId:2});
  if(reason==='retry-awaiting-newer-window'||reason==='retry-claimed'){assert.equal(f.runner.watch.requestTechnicalReevaluation(m,{reason:'entry-quote-unavailable',failedWindowEndAt:certificate.windowEndAt-(reason==='retry-claimed'?10000:0)},f.now),true);if(reason==='retry-claimed')assert.equal(f.runner.watch.claimTechnicalReevaluation(m,certificate.windowEndAt,f.now),true);assert.ok(f.runner.currentAuditCertificate(m,f.now),'the existing retry policy is separate from certificate validity');}
  assert.equal(f.runner.hasPendingFinancialEvaluation(),false);assert.equal(callbacks,reason==='owner-permission-closed'?1:0,'invalid or retry-blocked scopes never reach the financial callback');
  await (f.runner as any).verifyTokenCreation(pending.proof,f.now+2000);assert.deepEqual(f.requests,['getTransaction']);assert.equal(f.registry.tokenCreationProof(pending.mint),null);
 }finally{await f.close();}
});

test('certified financial priority validates deep metadata without any birth lookup',async()=>{
 const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>true});try{
  const m=f.seed(106);await f.steps(2);certifiedGeneration(f,[m]);pendingBirthLookup(f,107);
  const proof=f.registry.tokenCreationProof,eligibility=f.registry.tokenAgeEligibility;let lookups=0;
  f.registry.tokenCreationProof=()=>{lookups++;throw Error('OFFLINE_DEEP_BIRTH_LOOKUP');};f.registry.tokenAgeEligibility=()=>{lookups++;throw Error('OFFLINE_DEEP_AGE_LOOKUP');};
  assert.equal(f.runner.hasPendingFinancialEvaluation(),true);await f.steps();assert.equal(lookups,0);assert.deepEqual(f.requests,[]);
  f.registry.tokenCreationProof=proof;f.registry.tokenAgeEligibility=eligibility;
 }finally{await f.close();}
});

for(const kind of ['proof','history'] as const)test('certified financial priority rechecks '+kind+' selection before recording an attempt',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(108);await f.steps(2);certifiedGeneration(f,[m]);const pending=pendingBirthLookup(f,109,kind);let selected=false;
  if(kind==='proof'){const next=f.registry.nextTokenCreationRequest.bind(f.registry);f.registry.nextTokenCreationRequest=(...args)=>{const request=next(...args);if(request){selected=true;due=true;}return request;};}
  else{const next=f.registry.nextTokenCreationHistoryRequest.bind(f.registry);f.registry.nextTokenCreationHistoryRequest=(...args)=>{const request=next(...args);if(request){selected=true;due=true;}return request;};}
  await f.steps();assert.equal(selected,true);assert.deepEqual(f.requests,[]);assert.equal(f.registry.tokenCreationRequestPending(pending.proof,f.now),false);assert.equal(f.registry.tokenCreationHistoryPending(pending.history,f.now),false);
 }finally{await f.close();}
});

for(const kind of ['proof','history'] as const)test('certified financial priority rechecks '+kind+' scope before its durable pending marker',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(110);await f.steps(2);certifiedGeneration(f,[m]);const pending=pendingBirthLookup(f,111,kind),scope=(f.runner as any).tokenCreationScope.bind(f.runner);
  (f.runner as any).tokenCreationScope=(mint:string)=>{const result=scope(mint);due=true;return result;};
  if(kind==='proof')await (f.runner as any).verifyTokenCreation(pending.proof,f.now+2000);else await (f.runner as any).discoverTokenCreation(pending.history,f.now+2000);
  assert.deepEqual(f.requests,[]);assert.equal(f.registry.tokenCreationRequestPending(pending.proof,f.now),false);assert.equal(f.registry.tokenCreationHistoryPending(pending.history,f.now),false);
 }finally{await f.close();}
});

for(const kind of ['proof','history'] as const)test('certified financial priority remains closed at actual '+kind+' transport admission',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(112);await f.steps(2);certifiedGeneration(f,[m]);const pending=pendingBirthLookup(f,113,kind);let checked=false;
  f.rpc.call=async(_method,_params,_signal,options={})=>{due=true;checked=true;assert.equal((options.admissionOpen as ()=>boolean)(),false);throw Error('PILOT_RPC_COMPONENT_ADMISSION_CLOSED');};
  if(kind==='proof')await (f.runner as any).verifyTokenCreation(pending.proof,f.now+2000);else await (f.runner as any).discoverTokenCreation(pending.history,f.now+2000);
  assert.equal(checked,true);assert.deepEqual(f.requests,[]);assert.equal(f.registry.tokenCreationProof(pending.mint),null,'late priority does not turn an uninvoked attempt into birth evidence');
 }finally{await f.close();}
});

test('certified financial priority rechecks a selected prepared allocation before changing slot ownership',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(114);await f.steps(2);certifiedGeneration(f,[m]);const target=f.seed(115);await (f.runner as any).prepareObservation(f.runner.watch.lookupIdentity(target,f.now),f.now+2000);
  const next=f.runner.watch.next.bind(f.runner.watch);let selected=false;
  f.runner.watch.next=(...args)=>{const row=next(...args);if(args[2]?.preparedMints&&row?.mint===target){selected=true;due=true;}return row;};
  await f.steps();assert.equal(selected,true);assert.equal(f.states.has(target),false);assert.equal(f.adopted.some(row=>row.mint===target),false);
 }finally{await f.close();}
});

test('certified financial priority preserves required heartbeat and support service but defers new setup',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(116);await f.steps(2);certifiedGeneration(f,[m]);due=true;const actions:string[]=[];
  for(const action of ['heartbeat','support-refresh'] as const){
   Object.assign(f.flow,{servicePlan:(policy:{allowSetup:boolean;allowRetirement:boolean})=>{assert.equal(policy.allowSetup,false);assert.equal(policy.allowRetirement,true);return {at:f.now,domain:action==='heartbeat'?'control':'rpc',action,required:true,deadlineAt:f.now+2000};},service:async(_signal:unknown,admission:{admissionOpen:()=>boolean},policy:{allowSetup:boolean})=>{assert.equal(policy.allowSetup,false);assert.equal(admission.admissionOpen(),true);actions.push(action);return {kind:action};}});
   await f.steps();
  }
  assert.deepEqual(actions,['heartbeat','support-refresh']);assert.ok(f.runner.currentAuditCertificate(m,f.now));assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

test('certified financial priority rechecks optional native setup at physical admission',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(122);await f.steps(2);certifiedGeneration(f,[m]);let admitted:boolean|null=null;
  Object.assign(f.flow,{servicePlan:()=>({at:f.now,domain:'control',action:'subscribe',required:false,deadlineAt:Infinity}),service:async(_signal:unknown,admission:{admissionOpen:()=>boolean},policy:{allowSetup:boolean})=>{assert.equal(policy.allowSetup,true);due=true;admitted=admission.admissionOpen();return {kind:'deferred'};}});
  await (f.runner as any).serviceFlow(undefined,f.now+3000,{allowSetup:true,allowRetirement:true});assert.equal(admitted,false);assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

test('required native dispatch cannot reselect optional support across a prepared handover deadline',async()=>{
 for(const allowRetirement of [true,false]){
  const start=AT;let at=start,supportCalls=0,pings=0;const selected:Array<{action:string;required:boolean;allowSetup:boolean;allowRetirement:boolean;selectedMints:string[]}>=[];
  const prepared={scope:{mint:mint(130),pool:pool(mint(130))},support:{verifiedAt:start-1},supportDueAt:start+1,supportSourceExpiresAt:start+30000,subscription:null,gap:false,openedAt:null,suspended:false};
  const unprepared={scope:{mint:mint(131),pool:pool(mint(131))},support:null,supportDueAt:start,supportSourceExpiresAt:0,subscription:null,gap:false,openedAt:null,suspended:false};
  // The real selector and service body operate on an empty connected handover.
  // Only clock, support-provider I/O and protocol I/O are synthetic here.
  const flow=Object.create(PilotNativeFlow.prototype) as any;
  Object.assign(flow,{candidates:new Map<string,typeof prepared|typeof unprepared>([[prepared.scope.mint,prepared],[unprepared.scope.mint,unprepared]]),retiring:new Map(),pendingCleanups:new Map(),peerPings:[],subscriptions:new Map(),retryAt:0,nextHeartbeatAt:start,connection:{opened:true,closed:false,socket:{readyState:1}},abort:new AbortController(),active:false,physicalOperations:0,stopped:false,fatal:null,memoryPressure:false,now:()=>at,live:()=>true,supportReadyAt:()=>0,controlReadyAt:()=>0,supportFresh:(candidate:{support:unknown})=>!!candidate.support,installSupport:()=>{},record:(kind:string,data:typeof selected[number])=>{if(kind==='native-flow-service-selected')selected.push(data);},options:{persistent:true,support:{validateMany:async(scopes:Array<{mint:PublicKey}>,_signal:AbortSignal,admission:{admissionOpen:()=>boolean})=>{assert.equal(admission.admissionOpen(),true);supportCalls++;return {validations:Object.fromEntries(scopes.map(scope=>[scope.mint.toBase58(),{}])),unavailable:{}};}}},protocol:async(method:string,_signal:AbortSignal,admission:{operationBoundMs:number;admissionOpen:()=>boolean})=>{assert.equal(method,'ping');assert.equal(admission.operationBoundMs,NATIVE_DEADLINE_POLICY.heartbeatOperationMs);assert.equal(admission.admissionOpen(),true);pings++;}});
  const runner=Object.create(NativeCandidateRunner.prototype) as any;
  Object.assign(runner,{options:{flow,financialEvaluationPending:()=>at>=start+2},now:()=>at,hasPendingFinancialEvaluation:()=>runner.options.financialEvaluationPending(),sourceWorkAllowed:()=>{at=start+2;return true;},admission:(deadlineAt:number)=>({latestStartAt:deadlineAt}),readyAudits:()=>[],traceAuditDispatch:()=>{}});
  const policy={allowSetup:true,allowRetirement},initial=flow.servicePlan(policy);assert.equal(initial.action,'heartbeat');assert.equal(initial.required,true);
  const result=await runner.serviceFlow(undefined,start+10000,policy);
  assert.equal(at,start+2);assert.equal(runner.hasPendingFinancialEvaluation(),true);assert.equal(supportCalls,0,'a required heartbeat cannot lend its exemption to optional unACKed support');assert.equal(pings,1);assert.equal(result.kind,'ping');
  assert.equal(selected.length,1);assert.equal(selected[0]!.action,'heartbeat');assert.equal(selected[0]!.required,true);assert.equal(selected[0]!.allowSetup,false);assert.equal(selected[0]!.allowRetirement,allowRetirement);assert.deepEqual(selected[0]!.selectedMints,[]);
 }
});

for(const pendingAtDispatch of [false,true])test(`mixed support batch without due required work ${pendingAtDispatch?'defers when financial priority appears':'preserves optional progress when financial priority remains absent'}`,async()=>{
 const at=AT;let pending=false,supportCalls=0;const selected:Array<{action:string;allowSetup:boolean;allowRetirement:boolean;selectedMints:string[]}>=[];
 const established={scope:{mint:mint(132),pool:pool(mint(132))},support:{verifiedAt:at-1},supportDueAt:at+20000,supportSourceExpiresAt:at+30000,subscription:17,gap:false,openedAt:at-60000,suspended:false};
 const unacknowledged={scope:{mint:mint(133),pool:pool(mint(133))},support:{verifiedAt:at-1000},supportDueAt:at,supportSourceExpiresAt:at+10000,subscription:null,gap:false,openedAt:null,suspended:false};
 // Exercise the real batch classifier: one unACKed scope makes support due,
 // while a different, still-fresh established scope marks the batch required.
 const flow=Object.create(PilotNativeFlow.prototype) as any;
 Object.assign(flow,{candidates:new Map<string,typeof established|typeof unacknowledged>([[established.scope.mint,established],[unacknowledged.scope.mint,unacknowledged]]),retiring:new Map(),pendingCleanups:new Map(),peerPings:[],subscriptions:new Map([[17,established]]),retryAt:0,nextHeartbeatAt:at+15000,connection:{opened:true,closed:false,socket:{readyState:1}},abort:new AbortController(),active:false,physicalOperations:0,stopped:false,fatal:null,memoryPressure:false,now:()=>at,live:()=>true,supportReadyAt:()=>0,controlReadyAt:()=>0,supportFresh:(candidate:{support:unknown})=>!!candidate.support,installSupport:()=>{},record:(kind:string,data:typeof selected[number])=>{if(kind==='native-flow-service-selected')selected.push(data);},options:{persistent:true,support:{validateMany:async(scopes:Array<{mint:PublicKey}>,_signal:AbortSignal,admission:{admissionOpen:()=>boolean})=>{assert.equal(admission.admissionOpen(),true);supportCalls++;return {validations:Object.fromEntries(scopes.map(scope=>[scope.mint.toBase58(),{}])),unavailable:{}};}}}});
 const runner=Object.create(NativeCandidateRunner.prototype) as any;
 Object.assign(runner,{options:{flow,financialEvaluationPending:()=>pending},now:()=>at,hasPendingFinancialEvaluation:()=>runner.options.financialEvaluationPending(),sourceWorkAllowed:()=>{pending=pendingAtDispatch;return true;},admission:(deadlineAt:number)=>({latestStartAt:deadlineAt}),readyAudits:()=>[],traceAuditDispatch:()=>{}});
 const policy={allowSetup:true,allowRetirement:false},initial=flow.servicePlan(policy),requiredOnly=flow.servicePlan({...policy,allowSetup:false});
 assert.equal(initial.action,'support-refresh');assert.equal(initial.at,at);assert.equal(initial.required,true);assert.equal(requiredOnly.at,at+15000);assert.equal(requiredOnly.action,'heartbeat');
 const result=await runner.serviceFlow(undefined,at+10000,policy);
 assert.equal(result.kind,pendingAtDispatch?'deferred':'support');assert.equal(supportCalls,pendingAtDispatch?0:1);assert.equal(selected.length,pendingAtDispatch?0:1);
 if(!pendingAtDispatch){assert.equal(selected[0]!.action,'support-refresh');assert.equal(selected[0]!.allowSetup,true);assert.equal(selected[0]!.allowRetirement,false);assert.deepEqual(selected[0]!.selectedMints,[established.scope.mint,unacknowledged.scope.mint]);}
});

test('certified financial priority rechecks pool preparation at physical admission',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(123);await f.steps(2);certifiedGeneration(f,[m]);const target=f.seed(124);let admitted:boolean|null=null;
  f.flow.prepareObservation=async(_scope,_signal,admission)=>{due=true;admitted=admission!.admissionOpen!();return {status:'unavailable',reason:'PILOT_RPC_COMPONENT_ADMISSION_CLOSED'};};
  await (f.runner as any).prepareObservation(f.runner.watch.lookupIdentity(target,f.now),f.now+2000);assert.equal(admitted,false);assert.equal(f.states.has(target),false);assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

test('certified financial priority defers a new origin resolver before any attempt or provider request',async()=>{
 const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>true});try{
  const m=f.seed(125);await f.steps(2);certifiedGeneration(f,[m]);const before=(f.runner as any).counters.verificationAttempts;
  await (f.runner as any).verify({signature:signature(126),feedMint:mint(126),receivedAt:f.now},f.now+2000);assert.equal((f.runner as any).verificationSession,null);assert.equal((f.runner as any).counters.verificationAttempts,before);assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

test('certified financial priority preserves existing ready audit work',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const first=f.seed(117),peer=f.seed(118);await f.steps(3);certifiedGeneration(f,[first,peer],[first]);due=true;const pending=pendingBirthLookup(f,119),evaluated:string[]=[];
  (f.runner as any).evaluate=async(candidate:{identity:{baseMint:string}})=>{evaluated.push(candidate.identity.baseMint);};
  const candidate=(f.runner as any).candidates.get(peer),openedAt=candidate.openedAt,nextAuditAt=candidate.nextAuditAt,session=candidate.auditSession,originalCertificate=f.runner.currentAuditCertificate(first,f.now),originalFeatures=(f.flow.snapshot(peer) as unknown as {features:{windowEndAt:number}}).features;
  await f.steps();assert.deepEqual(evaluated,[],'the existing financial certificate precedes a peer audit dispatch');assert.deepEqual(f.requests,[]);assert.equal(f.registry.tokenCreationRequestPending(pending.proof,f.now),false);assert.ok(f.runner.currentAuditCertificate(first,f.now));
  assert.equal((f.runner as any).candidates.get(peer),candidate);assert.equal(candidate.openedAt,openedAt);assert.equal(candidate.nextAuditAt,nextAuditAt);assert.equal(candidate.auditSession,session);assert.equal(candidate.lastReadyWindowEnd,originalFeatures!.windowEndAt);assert.equal(candidate.lastAssessmentEnd,0);assert.deepEqual(f.flow.snapshot(peer)!.features,originalFeatures,'waiting preserves the original ready feature window');assert.ok((f.runner as any).readyAudits(f.now).includes(candidate));assert.deepEqual(f.runner.currentAuditCertificate(first,f.now),originalCertificate);
  due=false;await f.steps();assert.deepEqual(evaluated,[peer],'the same ready audit resumes after financial ownership releases priority');assert.deepEqual(f.requests,[]);assert.equal(candidate.openedAt,openedAt);assert.equal(f.registry.tokenCreationRequestPending(pending.proof,f.now),false);
 }finally{await f.close();}
});

test('certified financial priority commits an already completed preparation without allocating or replaying it',async()=>{
 let due=false;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due});try{
  const m=f.seed(120);await f.steps(2);certifiedGeneration(f,[m]);const target=f.seed(121),prepare=f.flow.prepareObservation.bind(f.flow);let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),began=new Promise<void>(resolve=>{started=resolve;});f.flow.prepareObservation=async(...args)=>{const result=await prepare(...args);started();await held;return result;};
  const step=f.runner.step();await began;due=true;release();await step;
  assert.equal(f.registry.observationPreparation(target)?.state,'pool-ready');assert.equal((f.runner as any).pendingPreparation,null);assert.equal(f.states.has(target),false);const calls=f.preparedCalls.length;await f.steps();assert.equal(f.preparedCalls.length,calls);assert.equal(f.states.has(target),false);
 }finally{await f.close();}
});

for(const kind of ['proof','history'] as const)test('certified financial priority preserves an already invoked '+kind+' result for commit',async()=>{
 let due=false;const n=128;const f=fixture({pumpswapOnly:true,financialEvaluationPending:()=>due,transaction:creation(n),history:[{signature:signature(n),slot:100,blockTime:(AT-3600000)/1000,err:null}]});try{
  const m=f.seed(127);await f.steps(2);certifiedGeneration(f,[m]);const target=pendingBirthLookup(f,n,kind),call=f.rpc.call.bind(f.rpc);let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),began=new Promise<void>(resolve=>{started=resolve;});f.rpc.call=async(...args)=>{const value=await call(...args);started();await held;return value;};
  const step=f.runner.step();await began;due=true;release();await step;
  assert.equal((f.runner as any).pendingTokenCreation,null);assert.equal(f.states.has(target.mint),false);assert.equal(f.requests.length,1);
  if(kind==='proof')assert.equal(f.registry.tokenCreationProof(target.mint)!.createdAt,AT-3600000);else assert.deepEqual(f.registry.nextTokenCreationRequest(f.now,true,true),target.proof);
  await f.steps();assert.equal(f.requests.length,1,'financial priority prevents another optional read but never discards the completed result');
 }finally{await f.close();}
});

test('deep age boundary uses the immutable market-admission interval without another age lookup',async()=>{
 const f=fixture({pumpswapOnly:true});try{
  const m=f.seed(70);await f.steps(3);assert.equal(f.states.has(m),true);
  const candidate=(f.runner as any).candidates.get(m),scope=candidate.marketAgeAtAdmission;
  assert.deepEqual(scope,{mint:m,createdAt:AT-3600000,availableAt:AT,expiresAt:AT-3600000+TOKEN_AGE_POLICY.maximumAgeMs});
  assert.equal(Object.isFrozen(scope),true);
  const fail=()=>{throw Error('OFFLINE_AGE_LOOKUP_IN_DEEP_OBSERVATION');};
  f.registry.tokenCreationProof=fail;f.registry.tokenAgeEligibility=fail;
  (f.runner as any).marketAgeAdmission.decision=fail;(f.runner as any).marketAgeAdmission.scope=fail;
  assert.equal((f.runner as any).observationMember(candidate,f.now),true);
  assert.equal(f.runner.requestTechnicalReevaluation(m,'entry-quote-unavailable',f.now,f.now),true);
  f.advance(scope.expiresAt-f.now);assert.equal((f.runner as any).observationMember(candidate,f.now),true,'the existing inclusive24h boundary remains');
  f.advance(1);assert.equal((f.runner as any).observationMember(candidate,f.now),false,'expiry is a clock comparison, never another lookup');
  assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

for(const state of ['DEEP_OBSERVATION','QUALIFIED','HELD','ENTRY_PENDING'] as const)for(const prepared of [true,false])test('deep age boundary refuses direct creation work for retained '+state+' with preparation '+prepared,async()=>{
 const f=fixture({pumpswapOnly:true,transaction:creation(71),history:[]});try{
  const m=f.seed(71,false,false);await f.steps();
  const history=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;assert.ok(history);
  const row=f.runner.watch.observeIdentity(signature(151),{mint:m,pool:pool(m),availableAt:f.now,evidence:'OFFLINE_RETAINED_SCOPE'});
  row.state=state;row.deepSince=f.now;f.registry.put(row);
  if(!prepared){delete (f.flow as any).prepareObservation;delete (f.flow as any).adoptPreparedObservation;}
  const before=f.requests.length;
  await (f.runner as any).verifyTokenCreation({mint:m,signature:signature(71)},f.now+2000);
  await (f.runner as any).discoverTokenCreation(history,f.now+2000);
  assert.equal(f.requests.length,before,'no creation transaction or birth-history provider call after observation ownership');
  assert.equal(f.registry.tokenCreationRequestPending({mint:m,signature:signature(71)},f.now),false,'no uninvoked proof attempt is charged');
  assert.equal(f.registry.tokenCreationHistoryPending(history,f.now),false,'no uninvoked history attempt is charged');
  assert.equal(f.registry.tokenCreationProof(m),null);
 }finally{await f.close();}
});

test('deep age boundary rejects a current candidate even if its durable row no longer names a deep state',async()=>{
 const f=fixture({pumpswapOnly:true,transaction:creation(72)});try{
  const m=f.seed(72);await f.steps(3);assert.equal(f.states.has(m),true);
  const row=f.runner.watch.lookupIdentity(m,f.now)!;row.state='WATCH';row.deepSince=null;f.registry.put(row);
  f.registry.observePumpSwapQualificationHint({mint:m,source:'pumpportal-migration',kind:'migration',signature:signature(152),receivedAt:f.now});
  f.registry.putObservationPreparation({mint:m,pool:pool(m),checkedAt:f.now,state:'pool-ready',reason:'OFFLINE_RETAINED_QUALIFIER'});
  await (f.runner as any).verifyTokenCreation({mint:m,signature:signature(72)},f.now+2000);
  assert.deepEqual(f.requests,[],'the physical candidate owner excludes age acquisition before durable repair');
 }finally{await f.close();}
});

test('deep age boundary rechecks every active durable alias immediately before dispatch',async()=>{
 const f=fixture({pumpswapOnly:true,transaction:creation(73),history:[]});try{
  const m=f.seed(73,false,false);await f.steps();
  const history=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;assert.ok(history);
  const original=f.runner.watch.observeIdentity(signature(153),{mint:m,pool:pool(m),availableAt:f.now,evidence:'OFFLINE_SELECTED_QUALIFICATION'});
  f.advance(1);f.registry.put({...original,signature:signature(154),firstSeenAt:f.now,state:'QUALIFIED',deepSince:f.now});
  assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.state,'WATCH','the ordinary identity lookup returns the older unprotected alias');
  await (f.runner as any).verifyTokenCreation({mint:m,signature:signature(73)},f.now+2000);
  await (f.runner as any).discoverTokenCreation(history,f.now+2000);
  assert.deepEqual(f.requests,[],'a protected alias created after queue selection still prevents both provider reads');
  assert.equal(f.registry.tokenCreationRequestPending({mint:m,signature:signature(73)},f.now),false);
  assert.equal(f.registry.tokenCreationHistoryPending(history,f.now),false);
 }finally{await f.close();}
});
const preparationPriority=(f:ReturnType<typeof fixture>)=>f.records.filter(r=>r.kind==='pilot-watch-opportunity-priority').at(-1)!.data;

/** A real second WAL writer takes the lock only after the provider result is
 * complete. This targets result persistence, not pre-dispatch bookkeeping. */
function lockAfterPreparation(f:ReturnType<typeof fixture>){
 const writer=new Database(f.registry.path),prepare=f.flow.prepareObservation;let locked=false;
 f.flow.prepareObservation=async(...args)=>{const result=await prepare(...args);writer.exec('BEGIN IMMEDIATE');locked=true;f.flow.prepareObservation=prepare;return result;};
 const release=()=>{if(locked){writer.exec('ROLLBACK');locked=false;}};
 return {release,close:()=>{release();writer.close();f.flow.prepareObservation=prepare;}};
}

function lockAfterCreationRead(f:ReturnType<typeof fixture>){
 const writer=new Database(f.registry.path),call=f.rpc.call.bind(f.rpc);let locked=false;
 f.rpc.call=async(...args)=>{const result=await call(...args);writer.exec('BEGIN IMMEDIATE');locked=true;f.rpc.call=call;return result;};
 const release=()=>{if(locked){writer.exec('ROLLBACK');locked=false;}};
 return {release,close:()=>{release();writer.close();f.rpc.call=call;}};
}

for(const retainedState of ['DEEP_OBSERVATION','QUALIFIED'] as const)test('deep age boundary discards completed pool preparation before a proof read for a new '+retainedState+' alias',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-pool-age-boundary-')),f=fixture({pumpswapOnly:true,path:join(directory,'market.sqlite'),concurrentIntake:true}),lock=lockAfterPreparation(f);
 try{
  const m=f.seed(74,false,false);await f.steps();assert.ok((f.runner as any).pendingPreparation);lock.release();
  const original=f.runner.watch.observeIdentity(signature(154),{mint:m,pool:pool(m),availableAt:f.now,evidence:'OFFLINE_SELECTED_QUALIFICATION'});
  f.advance(1);f.registry.put({...original,signature:signature(155),firstSeenAt:f.now,state:retainedState,deepSince:f.now});
  assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.state,'WATCH');
  let proofReads=0;f.registry.tokenCreationProof=()=>{proofReads++;throw Error('OFFLINE_AGE_LOOKUP_AFTER_DEEP_OWNERSHIP');};
  assert.equal((f.runner as any).drainPreparedObservation(),true);
  assert.equal(proofReads,0);assert.equal((f.runner as any).pendingPreparation,null);assert.equal(f.adopted.length,0);assert.equal(f.states.size,0);
  assert.ok(f.records.some(r=>r.kind==='native-candidate-preparation-discarded'&&r.data.reason==='NATIVE_FLOW_PREPARATION_SCOPE_CHANGED'));
 }finally{lock.close();await f.close();rmSync(directory,{recursive:true,force:true});}
});

test('absent current pools consume no deep slot, no ACK wait, and no finalized birth lookup',async()=>{
 const f=fixture();try{const m=f.seed(1,false);f.refuse('NATIVE_OBSERVATION_POOL_MISSING');await f.steps(5);
  assert.deepEqual(f.preparedCalls,[m]);assert.equal(f.states.size,0);assert.deepEqual(f.requests,[]);const status=f.runner.status();
  assert.equal(status.slotProductivity.counts.allocations,0);assert.equal(status.candidatePreparation.counters.poolAbsent,1);assert.equal(status.candidatePreparation.state,'awaiting-market-evidence');assert.equal(status.candidatePreparation.progress.serviceableSinceAt,null);assert.equal(status.counters.qualityGaps,0);
  assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.reobservation!.windowEndAt,null);assert.equal(f.registry.count(),1);
 }finally{await f.close();}
});

test('PumpSwap-only runner performs no durable or provider work for pre-migration token hints',async()=>{
 const f=fixture({pumpswapOnly:true});try{
  f.runner.onMarketIdentity({mint:mint(1),source:'pumpportal-new-token',kind:'creation',venue:'pump',signature:signature(1),receivedAt:f.now,evidence:'unverified-provider-discovery-hint'});
  f.runner.onMarketActivity({mint:mint(1),source:'pumpapi-broad',kind:'activity',venue:'pump',signature:signature(2),side:'buy',quoteLamports:'1000000000',receivedAt:f.now,evidence:'unverified-provider-activity-hint'});
  await f.steps(4);assert.equal(f.registry.count(),0);assert.equal(f.registry.marketEvidence(mint(1)),undefined);assert.deepEqual(f.requests,[]);assert.deepEqual(f.preparedCalls,[]);assert.equal(f.states.size,0);
 }finally{await f.close();}
});

test('migration-only intake discovers and verifies creation after pool validation, before allocating a deep slot',async()=>{
 const f=fixture({pumpswapOnly:true,transaction:creation(3),history:[{signature:signature(83),slot:110,blockTime:AT/1000,err:null},{signature:signature(3),slot:100,blockTime:(AT-3600000)/1000,err:null}]});try{
  const m=f.seed(3,false,false);await f.steps();assert.deepEqual(f.events,['prepare:'+m]);assert.equal(f.states.size,0);
  await f.steps();assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.equal(f.registry.tokenCreationProof(m),null,'signature history itself cannot establish token age');assert.equal(f.states.size,0);
  await f.steps();assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);assert.equal(f.registry.tokenCreationProof(m)!.createdAt,AT-3600000);assert.equal(f.states.size,0);
  await f.steps();assert.equal(f.states.size,1);assert.equal(f.states.has(m),true);assert.equal(f.adopted.length,1);assert.equal(f.preparedCalls.length,1);assert.equal(f.runner.status().slotProductivity.slots.length,4);
 }finally{await f.close();}
});

for(const reason of ['NATIVE_OBSERVATION_POOL_MISSING','BAD_POOL_OWNER'])test('PumpSwap migration hints with invalid or absent pools never start historical age acquisition: '+reason,async()=>{
 const f=fixture({pumpswapOnly:true,history:[]});try{f.seed(4,false,false);f.refuse(reason);await f.steps(8);assert.equal(f.preparedCalls.length,1);assert.deepEqual(f.requests,[]);assert.equal(f.states.size,0);}finally{await f.close();}
});

test('legacy pre-migration watch identities remain retained but cannot consume PumpSwap preparation',async()=>{
 const f=fixture({pumpswapOnly:true});try{
  const m=mint(5);f.registry.observeActivity({mint:m,source:'pumpapi-broad',kind:'activity',venue:'pump',signature:signature(5),side:'buy',quoteLamports:'1000000000',receivedAt:f.now,evidence:'unverified-provider-activity-hint'});
  f.registry.putTokenCreationProof(proof(5));f.runner.watch.observeIdentity(signature(5),{mint:m,pool:pool(m),availableAt:f.now,evidence:'OFFLINE_LEGACY_PRE_MIGRATION_HINT'});
  await f.steps(4);assert.equal(f.registry.count(),1);assert.deepEqual(f.preparedCalls,[]);assert.equal(f.states.size,0);
  economicHint(f,5);await f.steps(2);assert.deepEqual(f.preparedCalls,[m]);assert.equal(f.states.has(m),true,'fresh PumpSwap activity reopens the retained identity without losing it');
 }finally{await f.close();}
});

test('history acquisition yields between pages so an age-ready PumpSwap candidate can prepare and occupy a slot',async()=>{
 const full=Array.from({length:1000},(_,i)=>{const bytes=Buffer.alloc(64,33);bytes.writeUInt32BE(i);return {signature:bs58.encode(bytes),slot:2000-i,blockTime:AT/1000-10,err:null};});
 const f=fixture({pumpswapOnly:true,history:full});try{
  const unknown=f.seed(6,false,false);await f.steps(2);assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.equal(f.registry.tokenCreationProof(unknown),null);
  const known=f.seed(7);await f.steps();assert.deepEqual(f.preparedCalls,[unknown,known]);assert.deepEqual(f.requests,['getSignaturesForAddress'],'a second history page cannot starve available preparation');
  await f.steps();assert.equal(f.states.has(known),true);assert.equal(f.states.has(unknown),false);
 }finally{await f.close();}
});

test('history turns rotate between prepared unknown-age mints before activity priority and resist new-arrival starvation',async()=>{
 const f=fixture({pumpswapOnly:true});try{
  const strong=f.seed(10,false,false),other=f.seed(11,false,false);economicHint(f,10,'200000000000');
  for(const m of [strong,other])f.registry.putObservationPreparation({mint:m,pool:pool(m),checkedAt:f.now,state:'pool-ready',reason:'OFFLINE_CANONICAL_POOL_VALIDATED'});
  const first=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;assert.equal(first.mint,strong,'minimal hints break ties without admitting unknown-age economic activity');
  f.registry.deferTokenCreationHistory(first,f.now,'TOKEN_CREATION_HISTORY_PENDING');
  f.registry.applyTokenCreationHistoryPage(first,{kind:'continue',before:signature(200),beforeSlot:200,oldestCandidate:signature(200),oldestCandidateSlot:200},f.now);
  const second=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;assert.equal(second.mint,other,'even equal response timestamps cannot let the high-volume mint monopolize pages');
  f.registry.deferTokenCreationHistory(second,f.now,'TOKEN_CREATION_HISTORY_PENDING');
  f.registry.applyTokenCreationHistoryPage(second,{kind:'continue',before:signature(201),beforeSlot:201,oldestCandidate:signature(201),oldestCandidateSlot:201},f.now);
  const resume=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;assert.equal(resume.mint,strong);assert.equal(resume.before,signature(200),'the previously yielded cursor resumes');
  for(let n=12;n<15;n++){f.advance(1);const fresh=f.seed(n,false,false);economicHint(f,n,'2000000000000');f.registry.putObservationPreparation({mint:fresh,pool:pool(fresh),checkedAt:f.now,state:'pool-ready',reason:'OFFLINE_CANONICAL_POOL_VALIDATED'});assert.equal(f.registry.nextTokenCreationHistoryRequest(f.now,true)!.mint,strong,'newly prepared arrivals cannot precede the older waiting turn');}
  f.registry.deferTokenCreationHistory(resume,f.now,'TOKEN_CREATION_HISTORY_PENDING');
  f.registry.applyTokenCreationHistoryPage(resume,{kind:'continue',before:signature(199),beforeSlot:199,oldestCandidate:signature(199),oldestCandidateSlot:199},f.now);
  assert.equal(f.registry.nextTokenCreationHistoryRequest(f.now,true)!.mint,other,'the other existing cursor also retains its place ahead of new arrivals');
 }finally{await f.close();}
});

test('PumpSwap creation-history cursor survives restart and its signature still requires an independent create proof',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-pumpswap-age-')),path=join(directory,'registry.sqlite');
 const full=Array.from({length:1000},(_,i)=>{const bytes=Buffer.alloc(64,39);bytes.writeUInt32BE(i);return {signature:i===999?signature(8):bs58.encode(bytes),slot:1099-i,blockTime:(AT-3600000)/1000,err:null};});
 let f=fixture({path,pumpswapOnly:true,history:full});try{
  const m=f.seed(8,false,false);await f.steps(2);const request=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;
  assert.equal(request.before,signature(8));assert.equal(request.beforeSlot,100);assert.equal(request.oldestCandidate,signature(8));assert.equal(f.registry.tokenCreationProof(m),null);
  await f.close();f=fixture({path,pumpswapOnly:true,history:[],transaction:creation(8)});
  assert.deepEqual(f.registry.nextTokenCreationHistoryRequest(f.now,true),request);
  await f.steps();assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.equal(f.registry.tokenCreationProof(m),null);
  assert.equal(f.registry.nextTokenCreationRequest(f.now,true,true)!.signature,signature(8));
  await f.steps();assert.equal(f.registry.tokenCreationProof(m)!.createdAt,AT-3600000);assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);
  assert.equal(f.registry.applyTokenCreationHistoryPage(request,{kind:'candidate',signature:signature(9),slot:101},f.now),false,'a delayed page cannot replace immutable verified birth');
 }finally{await f.close();rmSync(directory,{recursive:true,force:true});}
});

test('a successful pre-creation transfer cannot strand the later genuine Pump create transaction',async()=>{
 const transfer=signature(209),m=mint(9),history=[{signature:signature(89),slot:110,blockTime:AT/1000,err:null},{signature:signature(9),slot:100,blockTime:(AT-3600000)/1000,err:null},{signature:transfer,slot:99,blockTime:(AT-7200000)/1000,err:null}];
 const bounds:unknown[]=[];
 const f=fixture({pumpswapOnly:true,rpcResponse:(method,params)=>{
  if(method==='getSignaturesForAddress'){const boundsForCall=params[1] as {until?:string};bounds.push(boundsForCall);return boundsForCall.until===transfer?history.slice(0,2):history;}
  if(params[0]===transfer)return {version:0,slot:99,blockTime:(AT-7200000)/1000,transaction:{signatures:[transfer],message:{accountKeys:[m,TOKEN],instructions:[]}},meta:{err:null,innerInstructions:[]}};
  assert.equal(params[0],signature(9));return creation(9);
 }});try{
  f.seed(9,false,false);await f.steps();const first=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;
  await f.steps(2);assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.states.size,0);
  const next=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;assert.equal(next.until,transfer);assert.equal(next.untilSlot,99);assert.equal(next.before,null);
  assert.equal(f.registry.applyTokenCreationHistoryPage(first,{kind:'candidate',signature:transfer,slot:99},f.now),false,'a delayed prior interval cannot restore the rejected candidate');
  await f.steps(3);assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction','getSignaturesForAddress','getTransaction']);assert.equal(bounds.length,2);assert.equal((bounds[1] as any).until,transfer);
  assert.equal(f.registry.tokenCreationProof(m)!.signature,signature(9));assert.equal(f.registry.tokenCreationProof(m)!.createdAt,AT-3600000);assert.equal(f.states.has(m),true);
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

test('a stream without creation-proof routes cannot starve an age-verified preparation',async()=>{
 const f=fixture();try{const known=f.seed(11),unknown:string[]=[];
  for(let n=20;n<60;n++){
   f.advance(1000);unknown.push(f.seed(n,false,false));economicHint(f,n);await f.steps();
   assert.ok(f.states.size<=1,'unknown age never becomes observation admission');
  }
  assert.equal(f.preparedCalls[0],known,'a usable candidate precedes stronger hints without any current birth-proof route');
  assert.equal(f.states.has(known),true);assert.ok(unknown.every(m=>!f.states.has(m)));
  assert.equal(f.runner.status().candidatePreparation.counters.allocationsFromPrepared,1);
  assert.equal(f.registry.count(),41,'all market identities remain retained');assert.equal(f.requests.length,0);
  assert.ok(f.preparedCalls.some(m=>unknown.includes(m)),'unknown candidates retain fallback passive preparation');
 }finally{await f.close();}
});

test('queryable unknown age still competes on economics and must verify birth before allocation',async()=>{
 const f=fixture({transaction:creation(63)});try{const known=f.seed(62),unknown=f.seed(63,false);economicHint(f,63);
  await f.steps();assert.deepEqual(f.preparedCalls,[unknown]);assert.equal(preparationPriority(f).preparationAgeRoute,'creation-request-available');assert.equal(f.states.size,0);
  await f.steps();assert.deepEqual(f.requests,['getTransaction']);assert.equal(f.states.size,0,'the age response is not an allocation');
  await f.steps();assert.equal(f.states.has(unknown),true);assert.equal(f.preparedCalls.filter(m=>m===unknown).length,1);assert.equal(f.preparedCalls[1],known);
 }finally{await f.close();}
});

test('stronger age-verified candidates retain economic priority within productive preparation',async()=>{
 const f=fixture();try{const weak=f.seed(64),strong=f.seed(65),unreachable=f.seed(66,false,false);economicHint(f,65);economicHint(f,66,'200000000000');
  await f.steps();assert.deepEqual(f.preparedCalls,[strong]);const priority=preparationPriority(f);assert.equal(priority.preparationAgeRoute,'verified-token-age');assert.equal(priority.economicLeaderMint,strong);assert.equal(priority.waitChangedWinner,false);
  assert.equal(f.registry.count(),3);assert.equal(f.runner.watch.lookupIdentity(weak)!.state,'WATCH');assert.equal(f.runner.watch.lookupIdentity(unreachable)!.state,'WATCH');
 }finally{await f.close();}
});

test('retained unknown preparation can progress when its missing creation signature arrives',async()=>{
 const f=fixture({transaction:creation(68)});try{const known=f.seed(67),unknown=f.seed(68,false,false);economicHint(f,68);
  await f.steps(2);assert.equal(f.states.has(known),true);assert.equal(f.states.has(unknown),false);assert.equal(f.preparedCalls.filter(m=>m===unknown).length,1);assert.equal(f.registry.nextTokenCreationRequest(f.now,true),undefined);
  const preparedAt=f.registry.observationPreparation(unknown)!.checkedAt;f.advance(10);
  f.runner.onMarketIdentity({mint:unknown,source:'pumpportal-new-token',kind:'creation',signature:signature(68),receivedAt:f.now,evidence:'unverified-provider-discovery-hint'});
  await f.steps();assert.deepEqual(f.requests,['getTransaction']);assert.equal(f.states.has(unknown),false);
  await f.steps();assert.equal(f.states.has(unknown),true);assert.equal(f.preparedCalls.filter(m=>m===unknown).length,1);assert.equal(f.adopted.find(v=>v.mint===unknown)!.at,preparedAt);assert.equal(f.registry.tokenCreationProof(unknown)!.createdAt,AT-3600000);
 }finally{await f.close();}
});

for(const scenario of ['available','age-boundary','old-signature','future-signature','empty-signature','wrong-source','retry-not-due','retry-due','terminal','inactive','migration-active'] as const)test('preparation age route matches the actual creation dispatcher: '+scenario,async()=>{
 const f=fixture();try{const known=f.seed(70),unknown=f.seed(71,false,false);economicHint(f,71);
  const request={mint:unknown,signature:signature(71)};
  f.registry.observeIdentity({mint:unknown,source:scenario==='wrong-source'?'pumpapi-broad':'pumpportal-new-token',kind:'creation',signature:scenario==='empty-signature'?'':request.signature,at:f.now+(scenario==='old-signature'?-TOKEN_AGE_POLICY.maximumAgeMs-1:scenario==='age-boundary'?-TOKEN_AGE_POLICY.maximumAgeMs:scenario==='future-signature'?1:0)});
  if(scenario==='retry-not-due'||scenario==='retry-due'||scenario==='terminal')f.registry.deferTokenCreationRequest(request,f.now+(scenario==='retry-not-due'?0:-60000),'OFFLINE_REQUEST_RETRY',scenario==='terminal');
  if(scenario==='inactive'||scenario==='migration-active'){f.advance(60001);if(scenario==='migration-active')f.registry.observeIdentity({mint:unknown,source:'pumpportal-migration',kind:'migration',signature:signature(240),at:f.now});}
  const selected=f.runner.watch.next(f.now,new Set(),{preparation:true});
  assert.equal(f.runner.watch.next(f.now,new Set([known]),{preparation:true})!.mint,unknown,'unreachable identities remain fallback candidates');const route=preparationPriority(f).preparationAgeRoute;
  f.registry.putObservationPreparation({mint:unknown,pool:pool(unknown),checkedAt:f.now,state:'pool-ready',reason:'OFFLINE_POOL_READY'});
  const actual=f.registry.nextTokenCreationRequest(f.now,true),available=['available','age-boundary','retry-due','migration-active'].includes(scenario);
  assert.deepEqual(actual,available?request:undefined);assert.equal(route,available?'creation-request-available':'creation-request-unavailable');
  if(!available)assert.equal(selected!.mint,known,'deferred or unavailable proof routes cannot outrank valid age');
 }finally{await f.close();}
});

test('preparation reachability adds indexed mint lookups to one existing ranking query',async t=>{
 const f=fixture();try{f.seed(72);f.seed(73,false);economicHint(f,73);const db=(f.registry as any).db;
  const token=db.prepare('INSERT INTO market_tokens(mint,first_seen_at,last_seen_at,screened_at) VALUES(?,?,?,?)'),hint=db.prepare('INSERT INTO identity_provenance(mint,source,kind,signature,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?)');
  db.transaction(()=>{for(let i=0;i<5000;i++){const m='offline-history-'+i;token.run(m,AT-172800000,AT-172800000,AT-172800000);hint.run(m,'pumpportal-new-token','creation','old-signature-'+i,AT-172800000,AT-172800000);}})();
  let sql='',params:unknown[]=[],rankedQueries=0;const statement=(f.registry as any).statement.bind(f.registry);
  (f.registry as any).statement=(text:string)=>{const s=statement(text);if(text.startsWith('WITH eligible AS'))return new Proxy(s,{get(target,key){const member=Reflect.get(target,key,target);if(typeof member!=='function')return member;if(key==='all')return (...values:unknown[])=>{sql=text;params=values;rankedQueries++;return Reflect.apply(member,target,values);};return member.bind(target);}});return s;};
  f.runner.watch.next(f.now,new Set(),{preparation:true});assert.equal(rankedQueries,1);
  const details:string[]=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map((row:any)=>row.detail as string),plan=details.join('\n');
  for(const alias of ['preparation_age','existing_age','preparation_token','preparation_migration','preparation_birth','preparation_retry']){assert.match(plan,new RegExp('SEARCH '+alias+' USING .*\\(mint=\\?'));assert.doesNotMatch(plan,new RegExp('SCAN '+alias+'(?:\\s|$)'));}
  assert.match(plan,/SEARCH preparation_birth USING .*\(mint=\? AND source=\? AND kind=\?\)/);
  assert.match(plan,/SEARCH preparation_retry USING .*\(mint=\? AND signature=\?\)/);
  t.diagnostic(JSON.stringify({rankedQueries,reachabilityLookups:details.filter(row=>/preparation_|existing_age/.test(row)),historicalCreationRows:5000}));
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
 let allowSetup=true;const f=fixture({sourceWorkAdmission:bound=>bound<1700||allowSetup});try{f.seed(6);await f.steps();allowSetup=false;await f.steps(3);assert.equal(f.preparedCalls.length,1);assert.equal(f.states.size,0);assert.equal(f.runner.status().slotProductivity.counts.allocations,0);allowSetup=true;await f.steps();assert.equal(f.states.size,1);assert.equal(f.preparedCalls.length,1);
 }finally{await f.close();}
});

test('prepared held-slot allocation uses the existing atomic native operation envelope',async()=>{
 let f:ReturnType<typeof fixture>;const lastUsable=AT;
 const admission=(bound:number)=>pilotLowerPriorityAdmission({now:f?.now??AT,endAt:AT+3600000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound});
 f=fixture({pumpswapOnly:true,sourceWorkAdmission:bound=>admission(bound).admitted});try{
  const m=f.seed(80);assert.equal(admission(3000).admitted,false,'a combined setup envelope cannot fit beside held protection');assert.equal(admission(1700).admitted,true);
  await f.steps();assert.deepEqual(f.preparedCalls,[m]);assert.equal(f.states.size,0);
  await f.steps();assert.equal(f.states.has(m),true);assert.deepEqual(f.preparedCalls,[m],'fresh prepared support is adopted without another account request');assert.equal(f.adopted[0]!.at,AT);
  assert.equal((f.runner as any).candidates.get(m).openedAt,null,'allocation and support adoption never invent a subscription ACK');assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

test('prepared held-slot allocation closes after 826 ms and reopens only after protection completes',async()=>{
 let f:ReturnType<typeof fixture>,lastUsable=AT;
 const admission=(bound:number)=>pilotLowerPriorityAdmission({now:f?.now??AT,endAt:AT+3600000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound});
 f=fixture({pumpswapOnly:true,sourceWorkAdmission:bound=>admission(bound).admitted});try{
  const m=f.seed(81);await f.steps();assert.deepEqual(f.preparedCalls,[m]);
  f.advance(825);assert.equal(admission(1700).admitted,true);f.advance(1);assert.equal(admission(1700).admitted,false);assert.equal(admission(125).admitted,true);
  await f.steps();assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.deepEqual(f.preparedCalls,[m]);
  lastUsable=f.now;assert.equal(admission(1700).admitted,true);await f.steps();assert.equal(f.states.has(m),true);assert.equal(f.adopted[0]!.at,AT,'protection completion must not refresh the original pool evidence');assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

test('prepared held-slot allocation rechecks protection after delayed candidate selection',async()=>{
 let f:ReturnType<typeof fixture>,lastUsable=AT;
 const admission=(bound:number)=>pilotLowerPriorityAdmission({now:f?.now??AT,endAt:AT+3600000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound});
 f=fixture({pumpswapOnly:true,sourceWorkAdmission:bound=>admission(bound).admitted});try{
  const m=f.seed(82);await f.steps();const next=f.runner.watch.next.bind(f.runner.watch);let selected=false;
  f.runner.watch.next=(...args:Parameters<typeof next>)=>{const row=next(...args);if(args[2]?.preparedMints&&!selected){assert.equal(row?.mint,m);selected=true;f.advance(826);}return row;};
  await f.steps();assert.equal(selected,true,'selection begins only while the real held envelope is feasible');assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.equal(admission(1700).admitted,false);
  f.runner.watch.next=next;lastUsable=f.now;await f.steps();assert.equal(f.states.has(m),true);assert.deepEqual(f.preparedCalls,[m]);assert.equal(f.adopted[0]!.at,AT);
 }finally{await f.close();}
});

test('prepared held-slot capacity witness uses the atomic envelope without granting provider or financial readiness',async()=>{
 let f:ReturnType<typeof fixture>,lastUsable=AT;
 const admission=(bound:number)=>pilotLowerPriorityAdmission({now:f?.now??AT,endAt:AT+3600000,held:1,lastUsable,nextPendingAt:null,operationBoundMs:bound});
 f=fixture({pumpswapOnly:true,sourceWorkAdmission:bound=>admission(bound).admitted});try{
  f.seed(90);await f.steps();assert.equal(f.preparedCalls.length,1);assert.equal(f.states.size,0);
  assert.equal(f.runner.pipelineThroughput().capacityWitness.localReady,true);assert.equal(f.runner.sourceAdmissionStatus().physicalSetup3000Allowed,false,'the existing literal diagnostic still measures a 3000 ms envelope');
  f.advance(825);assert.equal(f.runner.pipelineThroughput().capacityWitness.localReady,true);f.advance(1);assert.equal(f.runner.pipelineThroughput().capacityWitness.localReady,false);
  lastUsable=f.now;f.rpc.usage=()=>({inFlight:1,waitingOrOperating:true,dispatchWindow:{physicalBusy:true,readyAt:f.now}});
  const pipeline=f.runner.pipelineThroughput();assert.equal(pipeline.capacityWitness.localReady,true);assert.equal(pipeline.capacityWitness.providerReady,false);assert.equal(pipeline.population.capacityWaiting,null);assert.equal(pipeline.capacityWitness.physicalOccupancy,0);assert.equal(pipeline.flow.entryFills,0);assert.equal(f.adopted.length,0);assert.deepEqual(f.requests,[]);
 }finally{await f.close();}
});

for(const lookup of ['proof','history'] as const)test('age-qualified vacant-slot preparation precedes continuously available optional '+lookup+' lookups',async()=>{
 const f=fixture({pumpswapOnly:true});try{
  const known=f.seed(83),unknowns:string[]=[];
  for(let n=84;n<89;n++){
   const m=f.seed(n,false,false);unknowns.push(m);f.registry.putObservationPreparation({mint:m,pool:pool(m),checkedAt:f.now,state:'pool-ready',reason:'OFFLINE_QUALIFIER_CANONICAL_POOL'});
   if(lookup==='proof'){
    const request={mint:m,before:null,beforeSlot:null,until:null,untilSlot:null,oldestCandidate:null,oldestCandidateSlot:null};f.registry.deferTokenCreationHistory(request,f.now,'TOKEN_CREATION_HISTORY_PENDING');assert.equal(f.registry.applyTokenCreationHistoryPage(request,{kind:'candidate',signature:signature(n),slot:100},f.now),true);
   }
  }
  const next=()=>lookup==='proof'?f.registry.nextTokenCreationRequest(f.now,true,true):f.registry.nextTokenCreationHistoryRequest(f.now,true);
  assert.ok(next(),'upstream qualification has pending physical work');
  await f.steps();assert.deepEqual(f.preparedCalls,[known],'an age-qualified vacancy gets the first preparation opportunity');assert.deepEqual(f.requests,[],'optional birth lookups cannot precede ready-market preparation');assert.equal(f.states.size,0);
  await f.steps();assert.equal(f.states.has(known),true);assert.equal(f.states.size,1);assert.equal(f.requests[0],lookup==='proof'?'getTransaction':'getSignaturesForAddress','upstream qualification resumes after the candidate is allocated');assert.ok(next(),'more unknown-age work remains available');
  for(const m of unknowns){assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.states.has(m),false);assert.equal(f.runner.watch.lookupIdentity(m),undefined,'unknown tokens still have no ordinary observation row');}
 }finally{await f.close();}
});

for(const prepared of [true,false])test('native setup policy retains the '+(prepared?'prepared atomic':'legacy cold')+' service envelope',async()=>{
 const f=fixture();try{
  if(!prepared){delete (f.flow as any).prepareObservation;delete (f.flow as any).adoptPreparedObservation;}
  const m=f.seed(89);await f.steps(2);assert.equal(f.states.has(m),true);
  const usage=f.flow.usage.bind(f.flow),requiredAt=f.now+4000,policies:Array<{allowSetup:boolean;allowRetirement:boolean}>=[];let starts=0;
  Object.assign(f.flow,{
   usage:()=>({...usage(),connected:true,nextServiceAt:f.now,nextServiceDomain:'control',nextServiceAction:'subscribe',nativeServiceDeadlines:[{action:'heartbeat',deadlineAt:requiredAt}]}),
   servicePlan:(policy:{allowSetup:boolean;allowRetirement:boolean})=>{policies.push({...policy});return policy.allowSetup?{at:f.now,domain:'control',action:'subscribe',required:false,deadlineAt:Infinity}:{at:requiredAt,domain:'control',action:'heartbeat',required:true,deadlineAt:requiredAt};},
   service:async(_signal:AbortSignal|undefined,admission:{operationBoundMs:number;admissionOpen:()=>boolean},policy:{allowSetup:boolean;allowRetirement:boolean})=>{assert.equal(policy.allowSetup,true);assert.equal(policy.allowRetirement,true);assert.equal(admission.operationBoundMs,1700);assert.equal(admission.admissionOpen(),true);starts++;return {kind:'subscribe'};},
  });
  assert.equal(f.runner.discretionaryAdmission(1700).admitted,true);assert.equal(f.runner.discretionaryAdmission(3000).admitted,false);
  await f.steps();assert.ok(policies.length>0);assert.ok(policies.every(policy=>policy.allowSetup===prepared&&policy.allowRetirement));assert.equal(starts,prepared?1:0);
  assert.equal((f.runner as any).candidates.get(m).openedAt,null,'service selection itself is not evidence of an ACK');
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

for(const absent of [false,true])test('completed '+(absent?'absent':'ready')+' preparation survives a real busy writer without another provider read',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-preparation-busy-')),f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true}),lock=lockAfterPreparation(f);
 try{const m=f.seed(21);if(absent)f.refuse('NATIVE_OBSERVATION_POOL_MISSING');const original=f.now;await f.steps();
  assert.equal(f.preparedCalls.length,1);assert.equal(f.registry.observationPreparation(m),undefined);assert.equal(f.states.size,0);assert.equal(f.runner.status().candidatePreparation.counters.poolReady,0);assert.equal(f.runner.status().candidatePreparation.counters.poolAbsent,0);
  await f.steps(2);assert.equal(f.preparedCalls.length,1,'a retained result suppresses duplicate physical preparation');assert.ok(f.registry.health().transactions.contentionBeforeCallback>=3);assert.equal(f.registry.health().available,true);assert.equal(f.registry.health().storageFailures,0);
  assert.equal(f.records.filter(r=>r.kind==='native-candidate-registry-contention'&&r.data.phase==='preparation-result').length,1,'the same pending handoff emits one coalesced contention observation');
  lock.release();f.advance(500);await f.steps(2);const status=f.runner.status();
  assert.equal(f.preparedCalls.length,1);assert.equal(status.candidatePreparation.counters.attempts,1);assert.equal(f.registry.observationPreparation(m)!.checkedAt,original);assert.equal(status.counters.qualityGaps,0);assert.equal(status.candidatePreparation.counters.providerUnavailable,0);
  if(absent){assert.equal(status.candidatePreparation.counters.poolAbsent,1);assert.equal(f.states.size,0);assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.reobservation!.decisionAt,original);assert.deepEqual(f.requests,[]);}
  else{assert.equal(status.candidatePreparation.counters.poolReady,1);assert.equal(status.candidatePreparation.counters.allocationsFromPrepared,1);assert.equal(f.adopted.length,1);assert.equal(f.adopted[0]!.at,original);assert.equal(f.adopted[0]!.summary.marketClockUnixSeconds,original/1000);assert.equal(status.slotProductivity.slots[0]!.subscriptionSentAt,null);assert.equal(status.slotProductivity.slots[0]!.openedAt,null);}
 }finally{lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a busy preparation handoff does not prevent required native heartbeat service',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-preparation-service-')),f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true});let lock:ReturnType<typeof lockAfterPreparation>|undefined;
 try{const active=f.seed(22);await f.steps(2);assert.equal(f.states.has(active),true);const waiting=f.seed(23);lock=lockAfterPreparation(f);await f.steps();assert.equal(f.preparedCalls.length,2);f.requireHeartbeat();
  assert.equal(await f.runner.step(),'heartbeat');assert.equal(f.heartbeats,1);assert.equal(f.preparedCalls.length,2);assert.equal(f.registry.observationPreparation(waiting),undefined);assert.equal(f.states.has(active),true);assert.equal(f.states.has(waiting),false);
  lock.release();await f.steps();assert.equal(f.states.has(waiting),true);assert.equal(f.preparedCalls.length,2);
 }finally{lock?.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('preparation retained past its original freshness window is discarded before allocation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-preparation-stale-')),f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true}),lock=lockAfterPreparation(f);
 try{const m=f.seed(24),original=f.now;await f.steps();f.advance(30000);lock.release();await f.steps();
  assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.equal(f.preparedCalls.length,2,'expired evidence requires a new ordinary preparation request');assert.ok(f.records.some(r=>r.kind==='native-candidate-preparation-discarded'&&r.data.reason==='NATIVE_FLOW_PREPARATION_STALE'&&r.data.checkedAt===original));
  await f.steps();assert.equal(f.states.has(m),true);assert.equal(f.adopted[0]!.at,original+30000);assert.equal(f.runner.status().candidatePreparation.counters.poolReady,1,'the expired pending result never became a committed ready outcome');
 }finally{lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a newer minimum source slot invalidates retained preparation before reuse',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-preparation-slot-')),f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true}),lock=lockAfterPreparation(f);
 try{const m=f.seed(25);await f.steps();lock.release();f.advance(1);f.runner.watch.currentPoolValidated({schemaVersion:1,mint:m,pool:pool(m),verifiedAt:f.now,sourceSlot:101,evidence:'NEWER_VERIFIED_CANONICAL_POOL_BINDING'});
  const prepare=f.flow.prepareObservation;f.flow.prepareObservation=async(...args)=>{const result=await prepare(...args);if(result.status==='ready')result.support.sourceSlot=101;return result;};
  await f.steps();assert.equal(f.states.size,0);assert.equal(f.preparedCalls.length,2);assert.ok(f.records.some(r=>r.kind==='native-candidate-preparation-discarded'&&r.data.reason==='NATIVE_FLOW_PREPARATION_STALE'));await f.steps();assert.equal(f.adopted.length,1);assert.equal(f.adopted[0]!.sourceSlot,101);assert.equal(f.states.get(m)!.minSlot,101);
 }finally{lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

for(const owner of ['HELD','ENTRY_PENDING'] as const)test('new '+owner+' ownership prevents a retained preparation result from changing the watch or allocating',async()=>{
 let owned=false;const dir=mkdtempSync(join(tmpdir(),'poe-preparation-owner-')),f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true,financialOwnership:()=>owned?owner:null}),lock=lockAfterPreparation(f);
 try{const m=f.seed(26);await f.steps();lock.release();owned=true;f.runner.watch.transition(m,owner,'financial owner adopted while result persistence waited',f.now);await f.steps(2);
  assert.equal(f.preparedCalls.length,1);assert.equal(f.registry.observationPreparation(m),undefined);assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.state,owner);assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.equal(f.runner.status().candidatePreparation.counters.poolReady,0);assert.ok(f.records.some(r=>r.kind==='native-candidate-preparation-discarded'&&r.data.reason==='NATIVE_FLOW_PREPARATION_SCOPE_CHANGED'));
 }finally{lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a newer canonical hint received before a delayed absence commit can reopen preparation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-preparation-evidence-')),f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true}),lock=lockAfterPreparation(f);
 try{const m=f.seed(27),original=f.now;f.refuse('NATIVE_OBSERVATION_POOL_MISSING');await f.steps();lock.release();f.advance(500);
  f.runner.onMarketActivity({mint:m,pool:pool(m),source:'pumpapi-broad',kind:'activity',venue:'pump-amm',signature:signature(211),side:'buy',quoteLamports:'3000',receivedAt:f.now,evidence:'unverified-provider-activity-hint'});f.refuse(null);await f.steps(3);
  assert.equal(f.preparedCalls.length,2);assert.equal(f.states.has(m),true);const status=f.runner.status();assert.equal(status.candidatePreparation.counters.poolAbsent,1);assert.equal(status.candidatePreparation.counters.poolReady,1);assert.ok(f.records.some(r=>r.kind==='native-candidate-preparation'&&r.data.reason==='NATIVE_OBSERVATION_POOL_MISSING'&&r.data.at===original));
 }finally{lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a retained result cannot use a closed financial work admission to commit or allocate',async()=>{
 let admission=true;const dir=mkdtempSync(join(tmpdir(),'poe-preparation-admission-')),f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true,sourceWorkAdmission:()=>admission}),lock=lockAfterPreparation(f);
 try{const m=f.seed(28);await f.steps();lock.release();admission=false;await f.steps(2);assert.equal(f.preparedCalls.length,1);assert.equal(f.registry.observationPreparation(m),undefined);assert.equal(f.states.size,0);admission=true;await f.steps();assert.equal(f.states.has(m),true);assert.equal(f.preparedCalls.length,1);
 }finally{lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a preparation callback failure is never retained as pre-callback writer contention',async()=>{
 const f=fixture();try{const m=f.seed(29),put=f.registry.putObservationPreparation.bind(f.registry),fault=new MarketRegistryContention('SQLITE_BUSY');let writes=0;f.registry.putObservationPreparation=()=>{writes++;throw fault;};await f.steps();
  assert.equal(writes,1);assert.equal(f.preparedCalls.length,1);assert.equal(f.registry.observationPreparation(m),undefined);assert.equal(f.runner.status().candidatePreparation.counters.poolReady,0);assert.equal(f.records.filter(r=>r.kind==='native-candidate-registry-contention'&&r.data.completedPreparationRetained).length,0);
  f.registry.putObservationPreparation=put;await f.steps();assert.equal(f.preparedCalls.length,2,'a callback failure requires a new ordinary request instead of replaying the discarded result');assert.equal(f.runner.status().candidatePreparation.counters.poolReady,1);
 }finally{await f.close();}
});

test('a preparation result returning after source stop cannot create a pending handoff',async()=>{
 const f=fixture();let release!:()=>void;const returned=new Promise<void>(resolve=>{release=resolve;});try{const m=f.seed(30),prepare=f.flow.prepareObservation;f.flow.prepareObservation=async(...args)=>{const result=await prepare(...args);await returned;return result;};const step=f.runner.step();await Promise.resolve();assert.equal(f.preparedCalls.length,1);await f.runner.stop('offline source generation ended');release();await step;
  assert.equal(f.registry.observationPreparation(m),undefined);assert.equal(f.runner.status().candidatePreparation.counters.poolReady,0);assert.equal(f.states.size,0);assert.equal(f.adopted.length,0);assert.equal(await f.runner.step(),'closed');
 }finally{release();await f.close();}
});

function creationCommitFixture(kind:'proof'|'history',options:NonNullable<Parameters<typeof fixture>[0]>={}){
 const n=kind==='proof'?31:32,dir=mkdtempSync(join(tmpdir(),'poe-creation-commit-'));
 const f=fixture({path:join(dir,'market.sqlite'),concurrentIntake:true,pumpswapOnly:true,transaction:creation(n),history:[{signature:signature(n),slot:100,blockTime:(AT-3600000)/1000,err:null}],...options});
 const m=f.seed(n,false,false);
 if(kind==='proof')f.registry.observeIdentity({mint:m,source:'pumpportal-new-token',kind:'creation',signature:signature(n),at:f.now});
 const lock=lockAfterCreationRead(f);
 return {f,lock,m,n,close:async()=>{lock.close();await f.close();rmSync(dir,{recursive:true,force:true});}};
}

for(const kind of ['proof','history'] as const)test('deep age boundary discards a completed '+kind+' result before reading birth proof after observation ownership changes',async()=>{
 const c=creationCommitFixture(kind),{f,lock,m}=c;
 try{
  await f.steps(2);assert.ok((f.runner as any).pendingTokenCreation);assert.equal(f.requests.length,1);
  lock.release();
  const row=f.runner.watch.observeIdentity(signature(c.n+80),{mint:m,pool:pool(m),availableAt:f.now,evidence:'OFFLINE_NEW_OBSERVATION_OWNER'});
  row.state='DEEP_OBSERVATION';row.deepSince=f.now;f.registry.put(row);
  let proofReads=0;f.registry.tokenCreationProof=()=>{proofReads++;throw Error('OFFLINE_AGE_LOOKUP_AFTER_DEEP_OWNERSHIP');};
  assert.equal((f.runner as any).drainTokenCreation(),true);
  assert.equal(proofReads,0);assert.equal((f.runner as any).pendingTokenCreation,null);assert.equal(f.requests.length,1);
  assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_OBSERVATION_OWNERSHIP_CHANGED'));
 }finally{await c.close();}
});

test('completed creation proof survives a busy writer once with original availability and required heartbeat service',async()=>{
 const c=creationCommitFixture('proof'),{f,lock,m}=c;
 try{await f.steps(2);assert.deepEqual(f.requests,['getTransaction']);assert.equal(f.registry.tokenCreationProof(m),null);
  f.requireHeartbeat();assert.equal(await f.runner.step(),'heartbeat');assert.equal(f.heartbeats,1);await f.steps(2);
  assert.deepEqual(f.requests,['getTransaction']);assert.equal(f.preparedCalls.length,1);
  assert.equal(f.records.filter(r=>r.kind==='native-candidate-registry-contention'&&r.data.completedCreationResultRetained).length,1);
  lock.release();f.advance(500);await f.steps(2);
  const stored=f.registry.tokenCreationProof(m)!;assert.equal(stored.availableAt,AT);assert.equal(stored.createdAt,AT-3600000);assert.equal(stored.signature,signature(c.n));
  const verified=f.records.filter(r=>r.kind==='native-token-creation-verified');assert.equal(verified.length,1);assert.equal(verified[0]!.data.at,AT);assert.equal(verified[0]!.data.persistedAt,AT+500);
  assert.deepEqual(f.requests,['getTransaction']);assert.equal(f.states.has(m),true);assert.equal((f.runner as any).pendingTokenCreation,null);
 }finally{await c.close();}
});

test('completed history candidate commits the original hint locally before a separate finalized creation read',async()=>{
 let network=true;const c=creationCommitFixture('history',{sourceWorkAdmission:bound=>network||bound<=125}),{f,lock,m}=c;
 try{await f.steps(2);await f.steps(2);assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.equal(f.registry.nextTokenCreationRequest(f.now,true,true),undefined);
  assert.ok(JSON.stringify((f.runner as any).pendingTokenCreation).length<2048,'only compact classification/cursor metadata is retained');
  lock.release();network=false;f.advance(700);await f.steps();
  assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.deepEqual(f.registry.nextTokenCreationRequest(f.now,true,true),{mint:m,signature:signature(c.n)});assert.equal(f.registry.tokenCreationProof(m),null);
  const history=f.records.filter(r=>r.kind==='native-token-creation-history');assert.equal(history.length,1);assert.equal(history[0]!.data.at,AT);assert.equal(history[0]!.data.persistedAt,AT+700);assert.equal(history[0]!.data.applied,true);
  network=true;await f.steps(2);assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);assert.equal(f.states.has(m),true);
 }finally{await c.close();}
});

test('a full history page retains only the original compact cursor through writer contention',async()=>{
 const rows=Array.from({length:1000},(_,i)=>{const bytes=Buffer.alloc(64,33);bytes.writeUInt32BE(i);return {signature:bs58.encode(bytes),slot:2000-i,blockTime:AT/1000-10,err:null};});
 let network=true;const c=creationCommitFixture('history',{history:rows,sourceWorkAdmission:bound=>network||bound<=125}),{f,lock,m}=c;
 try{await f.steps(2);const pending=(f.runner as any).pendingTokenCreation;assert.equal(pending.rows,1000);assert.ok(JSON.stringify(pending).length<2048);assert.equal(pending.result.before,rows.at(-1)!.signature);assert.equal(Array.isArray(pending.result),false);
  lock.release();network=false;f.advance(750);await f.steps();const next=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;
  assert.equal(next.mint,m);assert.equal(next.before,rows.at(-1)!.signature);assert.equal(next.beforeSlot,1001);assert.equal(next.oldestCandidate,rows.at(-1)!.signature);assert.equal(next.until,null);assert.equal(f.registry.tokenCreationProof(m),null);assert.deepEqual(f.requests,['getSignaturesForAddress']);
  const event=f.records.find(r=>r.kind==='native-token-creation-history')!.data;assert.equal(event.at,AT);assert.equal(event.persistedAt,AT+750);assert.equal(event.outcome,'continue');
 }finally{await c.close();}
});

for(const kind of ['proof','history'] as const)test(kind+' result cannot commit after its prepared pool generation changes',async()=>{
 let network=true;const c=creationCommitFixture(kind,{sourceWorkAdmission:bound=>network||bound<=125}),{f,lock,m}=c;
 try{await f.steps(2);lock.release();network=false;f.advance(1);f.registry.putObservationPreparation({mint:m,pool:pool(mint(90)),checkedAt:f.now,state:'pool-ready',reason:'OFFLINE_CHANGED_POOL_SCOPE'});await f.steps(2);
  assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.requests.length,1);assert.equal(f.states.size,0);assert.equal((f.runner as any).pendingTokenCreation,null);
  assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_POOL_CHANGED'));
 }finally{await c.close();}
});

test('a superseded history cursor discards the old completed page without overwriting the new cursor',async()=>{
 let network=true;const c=creationCommitFixture('history',{sourceWorkAdmission:bound=>network||bound<=125}),{f,lock,m}=c;
 try{await f.steps();const request=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;await f.steps();lock.release();network=false;f.advance(1);
  assert.equal(f.registry.applyTokenCreationHistoryPage(request,{kind:'continue',before:signature(91),beforeSlot:90,oldestCandidate:signature(91),oldestCandidateSlot:90},f.now),true);
  await f.steps(2);const next=f.registry.nextTokenCreationHistoryRequest(f.now,true)!;assert.equal(next.before,signature(91));assert.equal(next.oldestCandidate,signature(91));assert.equal(next.mint,m);assert.equal(f.registry.nextTokenCreationRequest(f.now,true,true),undefined);assert.equal(f.requests.length,1);
  assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_REQUEST_CHANGED'));
 }finally{await c.close();}
});

test('a superseded direct request discards its completed proof before persistence',async()=>{
 let network=true;const c=creationCommitFixture('proof',{sourceWorkAdmission:bound=>network||bound<=125}),{f,lock,m}=c;
 try{await f.steps(2);lock.release();network=false;f.advance(1);f.registry.deferTokenCreationRequest({mint:m,signature:signature(c.n)},f.now,'OFFLINE_SUPERSEDED_ATTEMPT',true);await f.steps(2);
  assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.requests.length,1);assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_REQUEST_CHANGED'));
 }finally{await c.close();}
});

for(const owner of ['HELD','ENTRY_PENDING'] as const)test(owner+' ownership discards a completed age result without touching the financial watch owner',async()=>{
 let owned=false;const c=creationCommitFixture('proof',{financialOwnership:()=>owned?owner:null}),{f,lock,m}=c;
 try{await f.steps(2);lock.release();owned=true;f.runner.watch.observeIdentity('financial-owner:'+m,{mint:m,pool:pool(m),availableAt:f.now,evidence:'OFFLINE_RESTORED_FINANCIAL_OWNER'});f.runner.watch.transition(m,owner,'financial ownership changed during age persistence',f.now);await f.steps(2);
  assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.state,owner);assert.equal(f.requests.length,1);assert.equal(f.states.size,0);assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_FINANCIAL_OWNERSHIP_CHANGED'));
 }finally{await c.close();}
});

test('age-result persistence waits for source financial runway and preserves the original proof age',async()=>{
 let admitted=true;const c=creationCommitFixture('proof',{sourceWorkAdmission:()=>admitted}),{f,lock,m}=c;
 try{await f.steps(2);lock.release();admitted=false;f.advance(60001);await f.steps(2);assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.requests.length,1);
  admitted=true;f.advance(86400000);await f.steps();const proof=f.registry.tokenCreationProof(m)!;assert.equal(proof.availableAt,AT);assert.equal(proof.createdAt,AT-3600000);assert.equal(f.registry.tokenAgeEligibility(m,f.now).reason,'TOKEN_AGE_EXCEEDS_24H');assert.equal(f.states.size,0);assert.equal(f.requests.length,1);
 }finally{await c.close();}
});

for(const kind of ['proof','history'] as const)test(kind+' callback errors are discarded rather than replayed as pre-callback contention',async()=>{
 const c=creationCommitFixture(kind),{f,lock,m}=c;
 try{await f.steps(2);lock.release();let writes=0;
  const method=kind==='proof'?'putTokenCreationProof':'applyTokenCreationHistoryPage',original=(f.registry[method] as Function).bind(f.registry);
  (f.registry as any)[method]=()=>{writes++;throw new MarketRegistryContention('SQLITE_BUSY');};await f.steps();(f.registry as any)[method]=original;await f.steps(2);
  assert.equal(writes,1);assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.requests.length,1);assert.equal((f.runner as any).pendingTokenCreation,null);assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_COMMIT_FAILED'));
 }finally{await c.close();}
});

test('an aborted age request cannot persist its retained result on a later source turn',async()=>{
 const c=creationCommitFixture('proof'),{f,lock,m}=c,controller=new AbortController();
 try{await f.steps();await f.runner.step(controller.signal);lock.release();controller.abort();await f.steps(2);assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.requests.length,1);assert.equal((f.runner as any).pendingTokenCreation,null);assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_SOURCE_CHANGED'));
 }finally{await c.close();}
});

test('source shutdown discards a pending age result without a later registry write',async()=>{
 const c=creationCommitFixture('proof'),{f,lock,m}=c;
 try{await f.steps(2);lock.release();await f.runner.stop('offline source generation ended');assert.equal(await f.runner.step(),'closed');assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.requests.length,1);assert.equal((f.runner as any).pendingTokenCreation,null);assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_SOURCE_CHANGED'));
 }finally{await c.close();}
});

test('an age response returning after source shutdown never creates a pending result',async()=>{
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});const f=fixture({transaction:creation(33),rpcResponse:async()=>{await wait;return creation(33);}});
 try{const m=f.seed(33,false);await f.steps();const step=f.runner.step();await Promise.resolve();await f.runner.stop('offline source generation ended');release();await step;assert.equal(f.registry.tokenCreationProof(m),null);assert.equal((f.runner as any).pendingTokenCreation,null);assert.equal(f.requests.length,1);assert.ok(f.records.some(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_SOURCE_CHANGED'));
 }finally{release();await f.close();}
});

for(const kind of ['proof','history'] as const)for(const afterCommit of [false,true])test(kind+' result is never replayed after '+(afterCommit?'an after-commit notification failure':'a callback write is rolled back'),async()=>{
 let network=true;const c=creationCommitFixture(kind,{sourceWorkAdmission:bound=>network||bound<=125}),{f,lock,m}=c;
 try{await f.steps(2);lock.release();network=false;let writes=0;
  const method=kind==='proof'?'putTokenCreationProof':'applyTokenCreationHistoryPage',original=(f.registry[method] as Function).bind(f.registry);
  (f.registry as any)[method]=(...args:unknown[])=>{writes++;const result=original(...args);if(afterCommit)f.registry.afterCommit(()=>{throw Error('OFFLINE_AFTER_COMMIT_FAILURE');});else throw Error('OFFLINE_AFTER_WRITE_ROLLBACK');return result;};
  await f.steps();(f.registry as any)[method]=original;await f.steps(2);
  assert.equal(writes,1);assert.equal(f.requests.length,1);assert.equal((f.runner as any).pendingTokenCreation,null);
  if(kind==='proof'){assert.equal(f.registry.tokenCreationProof(m)!==null,afterCommit);if(afterCommit)assert.equal(f.registry.tokenCreationProof(m)!.availableAt,AT);}
  else assert.equal(f.registry.nextTokenCreationRequest(f.now,true,true)!==undefined,afterCommit);
  const discarded=f.records.find(r=>r.kind==='native-token-creation-result-discarded'&&r.data.reason==='NATIVE_TOKEN_CREATION_COMMIT_FAILED');assert.equal(discarded?.data.callbackStarted,true);
  assert.equal(f.records.filter(r=>r.kind==='native-token-creation-verified'||r.kind==='native-token-creation-history').length,0,'a failed persistence notification is not reported as a successful commit');
 }finally{await c.close();}
});

test('a genuine young Pump create remains discoverable when the mint address also has an older unrelated reference',async()=>{
 const n=34,history=[{signature:signature(134),slot:200,blockTime:AT/1000-5,err:null},{signature:signature(n),slot:100,blockTime:(AT-3600000)/1000,err:null},{signature:signature(234),slot:50,blockTime:AT/1000-86401,err:null}];
 const f=fixture({pumpswapOnly:true,history,transaction:creation(n)});
 try{const m=f.seed(n,false,false);await f.steps();assert.deepEqual(f.requests,[],'the existing canonical PumpSwap pool must validate first');await f.steps();assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.equal(f.registry.tokenCreationProof(m),null,'signature history is not a birth proof');
  assert.deepEqual(f.registry.nextTokenCreationRequest(f.now,true,true),{mint:m,signature:signature(n)});await f.steps();const proof=f.registry.tokenCreationProof(m)!;assert.equal(proof.instruction,'create');assert.equal(proof.createdAt,AT-3600000);assert.equal(proof.signature,signature(n));assert.notEqual(proof.createdAt,AT,'migration receipt is not token birth');assert.equal(f.states.size,0);
  await f.steps();assert.equal(f.states.has(m),true);assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);assert.equal(f.runner.status().candidatePreparation.counters.allocationsFromPrepared,1);
 }finally{await f.close();}
});

test('history with only an older successful address reference still cannot authorize a young token',async()=>{
 const n=35,f=fixture({pumpswapOnly:true,history:[{signature:signature(n),slot:100,blockTime:AT/1000-86401,err:null}],transaction:creation(n)});
 try{const m=f.seed(n,false,false);await f.steps(4);assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.equal(f.registry.tokenCreationProof(m),null);assert.equal(f.states.size,0);assert.ok(f.records.some(r=>r.kind==='native-token-creation-history'&&r.data.reason==='TOKEN_CREATION_HISTORY_PRECEDES_24H'));
 }finally{await f.close();}
});

test('unknown PumpSwap economics stays outside broad observation until actual creation proof commits',async()=>{
 const n=36,m=mint(n),f=fixture({pumpswapOnly:true,history:[{signature:signature(n),slot:100,blockTime:(AT-3600000)/1000,err:null}],transaction:creation(n)});
 try{
  economicHint(f,n,'999000000000');
  assert.equal(f.registry.marketEvidence(m),undefined);assert.equal(f.registry.count(),0);assert.equal(f.runner.watch.lookupIdentity(m,f.now),undefined);
  const hint=f.registry.pumpSwapQualificationHint(m)!;assert.equal(hint.lastSeenAt,AT);assert.equal('quoteLamports'in hint,false);assert.equal('price'in hint,false);
  await f.steps();assert.deepEqual(f.preparedCalls,[m]);assert.equal(f.registry.marketEvidence(m),undefined);assert.equal(f.registry.count(),0);assert.equal(f.states.size,0);assert.equal(f.runner.status().candidatePreparation.qualificationOnly,true);assert.equal(f.runner.status().candidatePreparation.admissionStage,'pre-discovery-qualification');
  await f.steps(2);assert.equal(f.registry.tokenCreationProof(m)!.createdAt,AT-3600000);assert.equal(f.registry.marketEvidence(m),undefined);assert.equal(f.registry.count(),0);assert.equal(f.states.size,0);
  await f.steps();const evidence=f.registry.marketEvidence(m)!;
  assert.equal(f.runner.status().candidatePreparation.qualificationOnly,false);assert.equal(f.runner.status().candidatePreparation.admissionStage,'age-qualified-observation');assert.equal(f.registry.count(),1);assert.equal(evidence.activityHints,0);assert.equal(evidence.lastActivityAt,null);assert.equal(evidence.lastEconomicActivityAt,null);assert.equal(evidence.buyLamports,'0');assert.equal(f.states.has(m),true);
  const promoted=f.records.find(r=>r.kind==='native-pumpswap-qualification-promoted')!.data;assert.equal(promoted.qualificationHintAt,AT);assert.equal(promoted.tokenCreatedAt,AT-3600000);assert.equal(promoted.marketActivityReplayed,false);
  f.advance(1);economicHint(f,n,'2000');assert.equal(f.registry.marketEvidence(m)!.activityHints,1);assert.equal(f.registry.marketEvidence(m)!.buyLamports,'2000');assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);
 }finally{await f.close();}
});

test('known old PumpSwap tokens are rejected from every ordinary ingress and schedule no qualification reads',async()=>{
 const n=37,m=mint(n),f=fixture({pumpswapOnly:true});try{
  f.registry.putTokenCreationProof(proof(n,AT,AT-86401000));
  economicHint(f,n);f.runner.onMarketIdentity({mint:m,source:'pumpportal-migration',kind:'migration',signature:signature(n),receivedAt:f.now,evidence:'unverified-provider-discovery-hint'});f.runner.onMigration({feedMint:m,signature:signature(n),receivedAt:f.now});
  await f.steps(4);assert.equal(f.registry.count(),0);assert.equal(f.registry.marketEvidence(m),undefined);assert.equal(f.registry.pumpSwapQualificationHint(m),undefined);assert.deepEqual(f.preparedCalls,[]);assert.deepEqual(f.requests,[]);assert.equal(f.states.size,0);
 }finally{await f.close();}
});

test('a startup age cache rejects already proven old mints without a per-frame proof read',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-age-cache-')),path=join(dir,'market.sqlite'),n=38,m=mint(n);let f=fixture({path,pumpswapOnly:true});
 try{
  f.registry.putTokenCreationProof(proof(n,AT,AT-86401000));await f.close();f=fixture({path,pumpswapOnly:true});
  const original=f.registry.tokenCreationProof.bind(f.registry);let reads=0;f.registry.tokenCreationProof=()=>{reads++;throw Error('OFFLINE_FEED_PROOF_READ_FORBIDDEN');};
  for(let i=0;i<1000;i++)assert.equal(f.runner.admitMarketHint({mint:m,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',receivedAt:f.now}),false);
  f.registry.tokenCreationProof=original;assert.equal(reads,0);assert.equal(f.registry.pumpSwapQualificationHint(m),undefined);assert.equal(f.registry.marketEvidence(m),undefined);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});

test('a qualified broad hint that crosses24h before preparation cannot obtain a watch or deep slot',async()=>{
 const n=39,m=mint(n),f=fixture({pumpswapOnly:true});try{
  f.registry.putTokenCreationProof(proof(n,AT,AT-86400000));economicHint(f,n);assert.equal(f.registry.marketEvidence(m)!.activityHints,1);
  f.advance(1);await f.steps(4);assert.equal(f.registry.count(),0);assert.equal(f.states.size,0);assert.deepEqual(f.preparedCalls,[]);assert.deepEqual(f.requests,[]);
  economicHint(f,n);assert.equal(f.registry.marketEvidence(m)!.activityHints,1,'expired future traffic cannot update retained market activity');
 }finally{await f.close();}
});

test('deep observation expiry is a cached boundary check and preserves financial pending ownership',async()=>{
 for(const owned of [false,true]){
  const n=owned?41:40,m=mint(n);let financiallyOwned=false;const f=fixture({pumpswapOnly:true,financialOwnership:()=>financiallyOwned?'ENTRY_PENDING':null});
  try{
   f.registry.putTokenCreationProof(proof(n,AT,AT-86400000));f.runner.onMigration({feedMint:m,signature:signature(n),receivedAt:f.now});await f.steps(2);assert.equal(f.states.has(m),true);
   if(owned){financiallyOwned=true;f.runner.watch.transition(m,'ENTRY_PENDING','OFFLINE_EXISTING_FINANCIAL_OWNERSHIP',f.now);}
   f.advance(1);await f.steps();assert.equal(f.states.has(m),owned);assert.deepEqual(f.requests,[]);assert.equal(f.preparedCalls.length,1);
   if(owned)assert.equal(f.runner.watch.lookupIdentity(m,f.now)!.state,'ENTRY_PENDING');
  }finally{await f.close();}
 }
});

test('legacy unknown-age market and watch history cannot enter normal preparation without a fresh qualification hint',async()=>{
 const n=42,m=mint(n),f=fixture({pumpswapOnly:true});try{
  f.registry.observeActivity({mint:m,source:'pumpapi-broad',kind:'activity',venue:'pump-amm',signature:signature(n),side:'buy',quoteLamports:'999000000000',receivedAt:AT,evidence:'unverified-provider-activity-hint'});
  f.runner.watch.observeIdentity('legacy:'+m,{mint:m,pool:pool(m),availableAt:AT,evidence:'OFFLINE_RETAINED_OLD_WATCH_ROW'});
  await f.steps(4);assert.equal(f.registry.count(),1);assert.deepEqual(f.preparedCalls,[]);assert.deepEqual(f.requests,[]);assert.equal(f.states.size,0);
  economicHint(f,n);await f.steps();assert.deepEqual(f.preparedCalls,[m]);assert.equal(f.states.size,0,'new actual PumpSwap hint opens only minimal qualification');
 }finally{await f.close();}
});

test('a stale original qualification receipt is never rejuvenated by delayed proof persistence',async()=>{
 const c=creationCommitFixture('proof'),{f,lock,m}=c;try{
  await f.steps(2);lock.release();f.advance(60001);await f.steps(3);
  assert.equal(f.registry.tokenCreationProof(m)!.availableAt,AT);assert.equal(f.registry.pumpSwapQualificationHint(m)!.lastSeenAt,AT);assert.equal(f.registry.count(),0);assert.equal(f.states.size,0);assert.equal(f.preparedCalls.length,1);assert.equal(f.records.some(r=>r.kind==='native-pumpswap-qualification-promoted'),false);
  economicHint(f,c.n);await f.steps(2);assert.equal(f.states.has(m),true);assert.equal(f.preparedCalls.length,2,'new broad activity requires fresh pool support after the original support expired');
 }finally{await c.close();}
});

test('failed constructor initialization leaves no obsolete proof listener',async()=>{
 const f=fixture({pumpswapOnly:true});try{
  const listeners=(f.registry as any).tokenCreationProofListeners as Set<unknown>,before=listeners.size;
  assert.throws(()=>new NativeCandidateRunner({...((f.runner as any).options),record:()=>{throw Error('OFFLINE_CONSTRUCTOR_FAILURE');}}),/OFFLINE_CONSTRUCTOR_FAILURE/);
  assert.equal(listeners.size,before);
 }finally{await f.close();}
});

test('a flood of unknown PumpSwap feed hints performs zero financial ownership reads',async()=>{
 let reads=0;const owners=new Map<string,'HELD'|'ENTRY_PENDING'>([[mint(43),'HELD'],[mint(44),'ENTRY_PENDING']]),received:string[]=[],marketIntake:NativeMarketIntake={observeIdentity(){},observeActivity(){},observeFeed(){},observeMigration(){},observeQualification:hint=>{received.push(hint.mint);}};
 const f=fixture({pumpswapOnly:true,marketIntake,financialOwnership:m=>{reads++;return owners.get(m)??null;}});try{
  f.runner.syncFinancialOwnership(new Set(owners.keys()));assert.equal(reads,2);reads=0;
  for(let i=0;i<1000;i++)for(const n of [43,44,45,46]){
   const row={mint:mint(n),source:'pumpapi-broad' as const,kind:'activity' as const,venue:'pump-amm',receivedAt:f.now};
   assert.equal(f.runner.admitMarketHint(row),false);f.runner.onMarketActivity({...row,side:'buy',quoteLamports:'999999999999',evidence:'unverified-provider-activity-hint'});
  }
  assert.equal(reads,0);assert.equal(received.length,4000);assert.deepEqual(new Set(received),new Set([mint(45),mint(46)]));assert.equal(f.registry.count(),0);assert.equal(f.states.size,0);
  owners.delete(mint(43));f.runner.syncFinancialOwnership(new Set());assert.equal(reads,2,'previous hints are rechecked even when current financial inputs omit a resolved mint');reads=0;
  assert.equal(f.runner.admitMarketHint({mint:mint(43),source:'pumpapi-broad',kind:'activity',venue:'pump-amm',receivedAt:f.now}),false);assert.equal(received.at(-1),mint(43));assert.equal(reads,0);
 }finally{await f.close();}
});

for(const stage of ['pool','history','proof','promotion'] as const)test('a mirrored financial owner cannot block another mint at qualification stage: '+stage,async()=>{
 const held=mint(47),other=mint(48),lookups:Array<{method:string;params:unknown[]}>=[];let owned=false;
 const f=fixture({pumpswapOnly:true,financialOwnership:m=>owned&&m===held?'HELD':null,rpcResponse:(method,params)=>{lookups.push({method,params});return method==='getSignaturesForAddress'?[]:null;}});
 try{
  for(const n of [47,48])economicHint(f,n);
  if(stage!=='pool')for(const n of [47,48])f.registry.putObservationPreparation({mint:mint(n),pool:pool(mint(n)),checkedAt:AT,state:'pool-ready',reason:'OFFLINE_QUALIFIER_CANONICAL_POOL'});
  if(stage==='proof')for(const n of [47,48]){
   const request={mint:mint(n),before:null,beforeSlot:null,until:null,untilSlot:null,oldestCandidate:null,oldestCandidateSlot:null};f.registry.deferTokenCreationHistory(request,AT,'TOKEN_CREATION_HISTORY_PENDING');assert.equal(f.registry.applyTokenCreationHistoryPage(request,{kind:'candidate',signature:signature(n),slot:100},AT),true);
  }
  if(stage==='promotion')for(const n of [47,48])f.registry.putTokenCreationProof(proof(n));
  owned=true;f.runner.syncFinancialOwnership(new Set([held]));await f.steps();
  assert.equal(f.runner.watch.lookupIdentity(held,f.now),undefined);assert.equal(f.states.has(held),false);assert.equal(f.preparedCalls.includes(held),false);
  if(stage==='pool')assert.deepEqual(f.preparedCalls,[other]);
  else if(stage==='history')assert.deepEqual(lookups.map(r=>[r.method,r.params[0]]),[['getSignaturesForAddress',other]]);
  else if(stage==='proof')assert.deepEqual(lookups.map(r=>[r.method,r.params[0]]),[['getTransaction',signature(48)]]);
  else {assert.equal(f.registry.count(),1);assert.ok(f.runner.watch.lookupIdentity(other,f.now));assert.deepEqual(f.preparedCalls,[other]);}
 }finally{await f.close();}
});

test('a newly acquired owner missing from the hint mirror is still blocked before provider dispatch',async()=>{
 const held=mint(49),other=mint(50);let owned=false;
 const f=fixture({pumpswapOnly:true,financialOwnership:m=>owned&&m===held?'ENTRY_PENDING':null});try{
  economicHint(f,49);f.advance(1);economicHint(f,50);owned=true;
  await f.steps();assert.deepEqual(f.preparedCalls,[]);assert.deepEqual(f.requests,[]);
  await f.steps();assert.deepEqual(f.preparedCalls,[other]);assert.equal(f.states.size,0);assert.equal(f.registry.count(),0);
  owned=false;f.runner.syncFinancialOwnership(new Set());await f.steps(2);assert.ok(f.preparedCalls.some(m=>m===held),'authoritative release permits qualification on a later scheduler turn');
 }finally{await f.close();}
});

test('native activity hints use the ownership mirror while mandatory membership checks remain authoritative',async()=>{
 let reads=0;const f=fixture({pumpswapOnly:true,financialOwnership:()=>{reads++;return null;}});try{
  const m=f.seed(51);await f.steps(2);assert.equal(f.states.has(m),true);reads=0;
  for(let i=0;i<1000;i++)f.runner.onNativeActivity({mint:m,at:f.now,evidence:'OFFLINE_NATIVE_ACTIVITY'});
  assert.equal(reads,0);await f.steps();assert.ok(reads>0,'the actual source turn independently rechecks financial ownership');
 }finally{await f.close();}
});


test('creation-proof scheduling scopes only finalized birth reads and retains the physical deadline',async()=>{
 const f=fixture({pumpswapOnly:true,transaction:creation(34),history:[{signature:signature(34),slot:100,blockTime:(AT-3600000)/1000,err:null}]});try{
  const m=f.seed(34,false,false);await f.steps(3);
  assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);
  assert.equal(f.requestCalls[0]!.options.queryTimeoutScope,undefined,'signature discovery keeps its existing route and policy');
  const call=f.requestCalls[1]!;assert.deepEqual(call.params,[signature(34),{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert.equal(call.options.queryTimeoutScope,'token-creation-proof');assert.equal(call.options.timeoutMs,1200);
  assert.equal(f.registry.tokenCreationProof(m)!.createdAt,AT-3600000);assert.equal(f.states.has(m),false,'proof response is not a deep admission');
  await f.steps();assert.equal(f.states.has(m),true);
 }finally{await f.close();}
});

test('creation-proof scheduling cooldown consumes no attempt and lets ready observation and heartbeat progress',async()=>{
 let readyAt=AT+10000;
 const f=fixture({pumpswapOnly:true,proofReadyAt:()=>readyAt,transaction:creation(35),history:[{signature:signature(35),slot:100,blockTime:(AT-3600000)/1000,err:null}]});try{
  const pending=f.seed(35,false,false);await f.steps(2);assert.deepEqual(f.requests,['getSignaturesForAddress']);
  const request={mint:pending,signature:signature(35)};assert.deepEqual(f.registry.nextTokenCreationRequest(f.now,true,true),request);
  const ready=f.seed(36);f.requireHeartbeat();await f.steps(4);
  assert.equal(f.heartbeats,1);assert.equal(f.states.has(ready),true);assert.equal(f.states.has(pending),false);
  assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.deepEqual(f.registry.nextTokenCreationRequest(f.now,true,true),request,'local cooldown does not create a durable physical-attempt delay');
  readyAt=f.now;await f.steps();assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);assert.ok(f.registry.tokenCreationProof(pending));
 }finally{await f.close();}
});

test('creation-proof scheduling rechecks changed readiness before durable attempt deferral',async()=>{
 let checks=0,release=false;
 const f=fixture({pumpswapOnly:true,proofReadyAt:(_signature,at)=>release||checks++===0?at:at+10000,transaction:creation(37),history:[{signature:signature(37),slot:100,blockTime:(AT-3600000)/1000,err:null}]});try{
  const m=f.seed(37,false,false);await f.steps(2);assert.equal(checks,0);
  await f.steps();assert.ok(checks>=2);assert.deepEqual(f.requests,['getSignaturesForAddress']);assert.equal(f.registry.tokenCreationProof(m),null);
  assert.deepEqual(f.registry.nextTokenCreationRequest(f.now,true,true),{mint:m,signature:signature(37)});
  release=true;await f.steps();assert.deepEqual(f.requests,['getSignaturesForAddress','getTransaction']);assert.ok(f.registry.tokenCreationProof(m));
 }finally{await f.close();}
});
