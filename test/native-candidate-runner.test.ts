/** Candidate-only coordinator mechanics. Native/RPC contexts are explicitly
 * synthetic. One import test re-decodes retained actual creation bytes; injected
 * resolver fixtures below do not claim independent on-chain verification. */
import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import bs58 from'bs58';import{PublicKey}from'@solana/web3.js';
import{NativeCandidateRunner,NATIVE_AUDIT_DISPATCH_DIAGNOSTICS,type NativeOrigin}from'../src/native-candidate-runner.js';
import{CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}from'../src/program-log-mapping.js';
import{FlowWindow}from'../src/strategy.js';import{canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID}from'../src/sdk.js';
import type{NativeNotification}from'../src/pilot-native-flow.js';
import{decodeMigrationIdentity,type MigrationIdentity}from'../src/migration-identity.js';
import{auditNativeFlowWindow}from'../src/native-flow-audit.js';
import type{PilotRpcCallOptions}from'../src/pilot-rpc.js';
const original=readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x)).find(x=>x.kind==='migration-transaction')!.data;
const originalSignature=original.transaction.signatures[0] as string;
const sig=(n:number)=>{const b=Buffer.alloc(64);b.writeUInt32LE(n);return bs58.encode(b);};
const baseAt=Math.ceil((original.blockTime*1000+600000)/10000)*10000+2000;
const decoded=decodeMigrationIdentity(original,{signature:originalSignature,commitment:'finalized',availableAt:baseAt});assert.ok(decoded.ok);const originalIdentity=decoded.identity;
type FakeScope={mint:string;pool:string;minSlot?:number};
type State={scope:FakeScope;openedAt:number|null;window:FlowWindow|null;gap:boolean;upper:{slot:number;availableAt:number;bankClockAt:number}|null;lastSyntheticAt:number;notes:NativeNotification[]};

function fixture(config:{shadow?:boolean;maximumDeep?:number;refuseVerification?:number;refuseReason?:string;missingAudit?:boolean;lateAudit?:boolean;responseDelayMs?:number;forcePredictiveFeatures?:boolean;auditRpcError?:string;firstAuditTimeout?:boolean;quietBatch?:boolean;batchErrorIndex?:number;batchMalformedIndex?:number;retireBatchIndex?:number;batchPhysicalFailure?:string}={}){
 let at=baseAt,allow=true,headroom=20000,stopped=false,supportRequested=false,heartbeatRequested=false,resolveCalls=0,auditCalls=0,physicalBusy=false,lastPhysicalStart=-Infinity,inFlight=0,maximumInFlight=0,syntheticId=100000;
 let batchCoolingMint:string|null=null;const batchCalls:Array<{at:number;pools:string[];logicalQueries:number}>=[];
 const states=new Map<string,State>(),retiring=new Set<string>(),records:Array<{kind:string;data:any}>=[],flowActions:string[]=[],rpcCalls:Array<{method:string;params:unknown[];at:number}>=[],added:string[]=[],removed:string[]=[],identities=new Map<string,MigrationIdentity>();
 let runner:NativeCandidateRunner;
 // SYNTHETIC continuous stable buying: actual FlowWindow math and real audit helper,
 // not a natural market/profitability or provider-capacity observation.
 const advanceTo=(next:number)=>{assert.ok(next>=at);if(config.forcePredictiveFeatures)for(const s of states.values())if(s.window&&s.openedAt!==null){for(let eventAt=Math.floor(s.lastSyntheticAt/1000)*1000+1000;eventAt<=next;eventAt+=1000){const signature=sig(++syntheticId),slot=(s.scope.minSlot??original.slot)+100+Math.floor((eventAt-s.openedAt)/1000)*10;s.window.ingest({identity:{kind:'program-log',signature,program:PUMP_AMM_PROGRAM_ID.toBase58(),logIndex:0,frameOrdinal:0},mint:s.scope.mint,wallet:new PublicKey(Buffer.alloc(32,Math.floor(eventAt/1000)%8+1)).toBase58(),side:'buy',quoteLamports:'250000000',tokenUnits:'1000000',receivedAt:eventAt,commitment:'confirmed',slot});s.notes.push({signature,slot,receivedAt:eventAt,availableAt:eventAt,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null});runner.onTrade();}s.lastSyntheticAt=next;}at=next;};
 const refresh=()=>{for(const s of states.values())if(s.openedAt!==null)s.upper={slot:(s.scope.minSlot??original.slot)+100+Math.floor((at-s.openedAt)/1000)*10+2,availableAt:at,bankClockAt:Math.floor(at/1000)*1000};};
 const flow={addCandidate(scope:FakeScope){assert.ok(!states.has(scope.mint));states.set(scope.mint,{scope:{...scope},openedAt:null,window:null,gap:false,upper:null,lastSyntheticAt:at,notes:[]});added.push(scope.mint);},removeCandidate(mint:string){if(states.delete(mint)){retiring.add(mint);removed.push(mint);}},snapshot(mint:string,when=at){const s=states.get(mint);if(!s)return null;const features=s.window?.features(when)??null,opening=s.openedAt===null?null:{slot:(s.scope.minSlot??original.slot)+100,availableAt:s.openedAt,bankClockAt:Math.floor(s.openedAt/1000)*1000};return {strictV2Unavailable:config.shadow===true,baselineFeatureSemantics:config.shadow?'UNAVAILABLE_PROTOCOL_EFFECT_SHADOW':'V2_WITHOUT_PROTOCOL_FRAMES',protocolPoolEffects:{count:config.shadow?1:0},scope:s.scope,openedAt:s.openedAt,subscription:s.openedAt===null?null:1,connected:s.openedAt!==null,warm:!!features?.sufficientlyObserved&&!s.gap,hasQualityLoss:s.gap,suspended:false,features,auditVerified:false,supportContext:s.upper,supportContexts:[...(opening?[opening]:[]),...(s.upper?[s.upper]:[])],openingSupportContext:opening};},notificationLedger(mint:string){return structuredClone(states.get(mint)?.notes??[]);},requestSupportRefresh(){supportRequested=true;},requestHeartbeat(){heartbeatRequested=true;},async service(_signal?:AbortSignal,admission?:PilotRpcCallOptions){if(admission?.admissionOpen&&!admission.admissionOpen())return {kind:'deferred'};if(retiring.size){retiring.delete(retiring.values().next().value!);flowActions.push('unsubscribe');return {kind:'unsubscribe'};}if(supportRequested){supportRequested=false;refresh();headroom=10000;flowActions.push('support');return {kind:'support'};}const pending=[...states.values()].find(s=>s.openedAt===null);if(pending){pending.openedAt=at;pending.window=new FlowWindow(pending.scope.mint,at);pending.lastSyntheticAt=at;pending.upper={slot:(pending.scope.minSlot??original.slot)+100,availableAt:at,bankClockAt:Math.floor(at/1000)*1000};runner.onFlowOpen({mint:pending.scope.mint,at});flowActions.push('subscribe');return {kind:'subscribe'};}if(heartbeatRequested){heartbeatRequested=false;headroom=10000;flowActions.push('ping');return {kind:'ping'};}return {kind:'idle'};},usage(){return {dataContract:config.shadow?CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW:undefined,candidates:states.size,retiring:retiring.size,nextServiceAt:retiring.size||supportRequested||heartbeatRequested||[...states.values()].some(s=>s.openedAt===null)?at:at+headroom,nextServiceDomain:'control' as 'rpc'|'control'|null,nextServiceAction:'heartbeat' as string|null,physicalTransportsSettled:stopped,financialWriterOpened:false};},async stop(){stopped=true;states.clear();retiring.clear();flowActions.push('stop');}};
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
 runner=new NativeCandidateRunner({flow:flow as any,rpc:rpc as any,record(kind,data){records.push({kind,data:structuredClone(data)});},now:()=>at,maximumDeep:config.maximumDeep??1,admissionOpen:()=>allow,resolve:resolver as any,audit});
 const importActual=()=>{const origin:NativeOrigin={originConfirmed:{signature:originalSignature,availableAt:at,transaction:structuredClone(original)},originFinalized:{signature:originalSignature,availableAt:at,transaction:structuredClone(original)}};runner.importOrigin(origin);return originalIdentity.baseMint;};
 const seed=(n:number)=>{const mint=new PublicKey(Buffer.alloc(32,n+20)).toBase58();runner.onMigration({signature:sig(n),feedMint:mint,receivedAt:at});return mint;};
 const steps=async(n:number)=>{for(let i=0;i<n;i++)await runner.step();};
 const warm=async()=>{advanceTo(at+70000);await runner.step();await runner.step();};
 return {runner,flow,rpc,records,rpcCalls,batchCalls,flowActions,added,removed,states,retiring,importActual,seed,steps,warm,refresh,get now(){return at;},get resolveCalls(){return resolveCalls;},get auditCalls(){return auditCalls;},get maximumInFlight(){return maximumInFlight;},advance(ms:number){advanceTo(at+ms);},setAllow(v:boolean){allow=v;},setHeadroom(ms:number){headroom=ms;},setPhysicalBusy(v:boolean){physicalBusy=v;},setBatchCoolingMint(pool:string|null){batchCoolingMint=pool;}};
}

test('retained strict actual origin imports without RPC; candidate warming begins only at actual source ACK',async()=>{
 const f=fixture(),mint=f.importActual();assert.equal(f.rpcCalls.length,0);assert.equal(f.runner.status().counters.verifiedOrigins,1);await f.runner.step();assert.equal(f.runner.status().candidates[0]!.openedAt,f.now);assert.equal(f.flow.snapshot(mint)?.warm,false);f.advance(60000);await f.runner.step();assert.equal(f.auditCalls,0,'six complete closed buckets are not available at a simple60-second wall interval');assert.equal(f.flow.snapshot(mint)?.warm,false);assert.equal(f.runner.status().financialWriterOpened,false);assert.equal(f.runner.status().financialExecutionAuthorized,false);await f.runner.stop();
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

test('SYNTHETIC six-slot saturation preserves seventh watch identity and releases actual unsubscribe ownership before replacement',async()=>{
 const f=fixture({maximumDeep:6}),mints=Array.from({length:7},(_,i)=>f.seed(i+1));await f.steps(20);let s=f.runner.status();assert.equal(s.maximumSimultaneousCandidates,6);assert.equal(s.candidates.length,6);assert.equal(s.watch.rows.length,7);const first=s.candidates[0]!.mint;assert.ok(mints.includes(first));f.runner.onGap({mint:first,at:f.now,reason:'SYNTHETIC_SELECTED_DATA_GAP'});assert.equal(f.retiring.size,1);const added=f.added.length;await f.runner.step();assert.equal(f.added.length,added,'retiring native subscription still occupies its bounded slot');assert.equal(f.flowActions.at(-1),'unsubscribe');await f.runner.step();s=f.runner.status();assert.equal(s.candidates.length,6);assert.equal(f.added.length,added+1);assert.equal(s.maximumSimultaneousCandidates,6);assert.equal(s.financialExecutionAuthorized,false);await f.runner.stop();
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

test('SYNTHETIC migration churn prunes evicted verification seeds and does not strand newest retained identities',async()=>{
 const f=fixture();for(let i=1;i<=300;i++)f.seed(i);await f.steps(400);const s=f.runner.status(),latest=s.watch.rows.find(r=>r.signature===sig(300));assert.ok(latest);assert.notEqual(latest.verifiedAt,null,'latest retained identity must not remain unqueued behind already evicted seeds');assert.ok(s.verificationQueue<=s.watch.rows.filter(r=>r.verifiedAt===null).length,'unreachable/terminal verification seeds do not consume queue capacity');assert.equal(f.rpcCalls.length,0,'synthetic resolver churn is not provider capacity evidence');await f.runner.stop();
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
