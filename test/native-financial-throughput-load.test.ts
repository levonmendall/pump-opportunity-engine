/** OFFLINE scheduler/protocol integration. Four distinct synthetic deep scopes,
 * immutable certificates and support responses; actual launcher preparation,
 * request-admission, selection, runner priority and PilotRpc physical gates.
 * This is not a market-history, SDK, economic-strategy or live-fill proof. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {PublicKey} from '@solana/web3.js';
import {NativeCandidateRunner,NATIVE_DEADLINE_POLICY,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {NativePaperWorkState} from '../src/native-paper-work.js';
import {PilotRpc,type PilotRpcOptions} from '../src/pilot-rpc.js';
import {pilotLowerPriorityAdmission,PILOT_TIMING} from '../src/pilot.js';
import {runNativePaper,nativePaperRemainingEntryWork,nativePaperFinancialSelection,nativePaperManagementReserve,nativePaperRequestOperationBound,nativePaperSourceWorkAdmission} from '../src/run-native-paper.js';

const STRATEGY='liquidity-resilient-momentum-v3.1',turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function physicalFixture(t:TestContext,extra:Partial<PilotRpcOptions>={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-financial-throughput-')),prior=join(directory,'prior.json');let at=200_000,onSleep:(()=>void)|null=null;
 writeFileSync(prior,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:1000,starts:[1000],pending:[]}),{mode:0o600});
 const frozenPrior=readFileSync(prior),records:Array<{kind:string;data:any}>=[],starts:Array<{at:number;method:string}>=[];
 const client=new PilotRpc({persistent:true,directory:join(directory,'run'),runId:'offline-throughput',baselinePaths:[prior],priorPhysicalSettled:true,maxStartsPer10s:20,
  now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;onSleep?.();},record:(kind,data)=>records.push({kind,data}),
  fetcher:(async(_url,init)=>{const body=JSON.parse(String(init?.body));starts.push({at,method:body.method});at+=100;return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{available:true}}));})as typeof fetch,...extra});
 t.after(()=>{client.close();assert.deepEqual(readFileSync(prior),frozenPrior,'original provider-accounting baseline is never rewritten');rmSync(directory,{recursive:true,force:true});});
 return {client,records,starts,get at(){return at;},set at(value:number){assert.ok(value>=at);at=value;},set onSleep(callback:(()=>void)|null){onSleep=callback;}};
}

function burstFixture(t:TestContext){
 const f=physicalFixture(t),keys=Array.from({length:4},(_,i)=>({mint:new PublicKey(Buffer.alloc(32,i+1)).toBase58(),pool:new PublicKey(Buffer.alloc(32,i+11)).toBase58()}));
 const state:any={accountId:'offline-original-account',mode:'PAPER',cash:'1000000000',positions:{},pending:{},journal:[{id:'original-event'}]},originalLedger=sha(state);
 const workOwner=new NativePaperWorkState(),certificates:NativeAuditCertificate[]=[],current=new Map<string,NativeAuditCertificate>(),support=new Map<string,{reads:number;receiptAt:number|null}>(),proofs=new Map<string,Readonly<{proofId:string;deadlineAt:number;featuresSha256:string}>>();
 let financialPermission:string|null=null,source=true,lastCompleted:number|null=null,pendingAt:number|null=null,nativeAt:number|null=null,sourceCalls=0;
 const handoff=new NativeFinancialHandoff('offline-throughput',f.at,4,(kind,data)=>f.records.push({kind,data}));
 const owner:any={candidates:new Map(),financialOwnerHints:new Map(),observationMember:()=>source,open:()=>source,now:()=>f.at,
  currentAuditCertificate:(mint:string,at:number)=>{const c=current.get(mint);return c&&at<=c.deadlineAt?c:null;},
  deadlineView:()=>({requiredNativeAt:nativeAt,discretionaryUntil:null,readyCount:3})};
 for(const method of ['financialPreparationTargets','financialAdmission','discretionaryAdmission']as const)owner[method]=(...args:any[])=>(NativeCandidateRunner.prototype[method]as Function).apply(owner,args);
 const lowerView=(bound:number)=>pilotLowerPriorityAdmission({now:f.at,endAt:2_000_000,held:Object.keys(state.positions).length,lastUsable:lastCompleted,nextPendingAt:pendingAt,operationBoundMs:bound});
 const holder:any={},context:any={__name:(v:unknown)=>v,holder,AbortController,Date:{now:()=>f.at},runId:'offline-throughput',requestSequence:0,stopped:false,endAt:2_000_000,
  currentEngine:owner,engine:owner,serviceGeneration:0,currentLedger:{state:()=>state},currentBridge:{ownership:()=>null},service:true,args:{strategy:STRATEGY},LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION:STRATEGY,
  financialCapacityReason:()=>financialPermission,sourceAdmission:()=>source,sourceInformationAdmission:()=>source,lowerView,optionalAdmission:()=>true,candidateDiagnostic:(callback:()=>unknown)=>callback(),
  nativePaperRemainingEntryWork,nativePaperManagementReserve,nativePaperRequestOperationBound,nativePaperSourceWorkAdmission,NATIVE_DEADLINE_POLICY,currentRpc:f.client,workOwner,sourceEntryPreparation:null,requiredEntryNativeMaintenance:null,
  entryToken:null,entryCertificate:null,record:(kind:string,data:unknown)=>f.records.push({kind,data}),held:0,handoffCertificates:certificates,candidate:undefined,financialSelectionSnapshot:null,financialHandoff:handoff};
 const market={entryPreparationStatus(mint:string,at=f.at){const s=support.get(mint)!;return {state:s.reads===0?'layout-required':s.reads<3?'rent-required':'ready',remainingReads:3-s.reads,quoteReads:1,ready:s.reads===3&&at<=s.receiptAt!+10000,expiresAt:s.receiptAt===null?null:s.receiptAt+10000};},
  invalidateEntryPreparation(mint:string){support.set(mint,{reads:0,receiptAt:null});},
  async prepareEntryCostTurn(mint:string,signal:AbortSignal,bound:number){const s=support.get(mint)!,method=s.reads===0?'getMultipleAccounts':'getMinimumBalanceForRentExemption';sourceCalls++;await f.client.call(method,[],signal,holder.requestOptions({timeoutMs:1200,operationBoundMs:bound},false,method));s.reads++;s.receiptAt=f.at;return {status:s.reads===3?'ready':'progress',work:'synthetic-stable-support'};}};
 context.market=market;
 const text=runNativePaper.toString();
 function extract(begin:string,end:string,suffix:string){const p=text.indexOf(begin),q=text.indexOf(end,p);assert.ok(p>=0&&q>p,'actual launcher closure exists: '+begin);runInNewContext(text.slice(p,q)+suffix,context,{timeout:1000});}
 extract('const requestOptions=','let requiredEntryNativeMaintenance',';holder.requestOptions=requestOptions;');
 extract('const prepareEntrySupport=','const makeFeeds=',';holder.prepareEntrySupport=prepareEntrySupport;');
 const begin=text.indexOf('const prospectiveEntryPreparation='),end=text.indexOf('const reconnectUsage=',begin);assert.ok(begin>=0&&end>begin);
 const fallback=runInNewContext('(async()=>{for(let once=0;once<1;once++){'+text.slice(begin,end)+'}})',context,{timeout:1000});
 const originalCertificates=new Map<string,string>(),originalProofs=new Map<string,string>();
 function wave(windowEndAt:number,remainingMs=6175){
  f.at=windowEndAt+9999-remainingMs;owner.candidates.clear();owner.financialOwnerHints.clear();current.clear();support.clear();proofs.clear();certificates.splice(0);
  for(const [i,key]of keys.entries()){
   const c=Object.freeze({schemaVersion:1,mint:key.mint,pool:key.pool,dataContract:'confirmed-program-activity-v3-shadow',openedAt:windowEndAt-70000,connectionId:1,subscriptionId:i+1,windowStartAt:windowEndAt-60000,windowEndAt,auditAvailableAt:f.at,admittedAt:f.at,deadlineAt:windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:sha({wave:windowEndAt,mint:key.mint})})as NativeAuditCertificate;
   certificates.push(c);current.set(key.mint,c);owner.candidates.set(key.mint,{identity:{baseMint:key.mint,pool:key.pool},openedAt:c.openedAt,nextAuditAt:0});support.set(key.mint,{reads:0,receiptAt:null});
   const proof=Object.freeze({proofId:sha(c),deadlineAt:c.deadlineAt,featuresSha256:c.featuresSha256});proofs.set(key.mint,proof);originalCertificates.set(key.mint,sha(c));originalProofs.set(key.mint,sha(proof));
  }
  handoff.observe(f.at,certificates);
 }
 function selection(){
  const at=f.at,u=f.client.usage(),gate=u.rpcDispatchWindow;context.held=Object.keys(state.positions).length;
  const selected=nativePaperFinancialSelection({at,candidates:certificates.map(c=>{const plan=nativePaperRemainingEntryWork({at,owned:context.held>0,preparation:market.entryPreparationStatus(c.mint,at)});return {certificate:c,plan,proofState:'complete' as const,admission:owner.financialAdmission(c,plan.prepared?plan.decisionWorkMs:1700,at),preservation:lowerView(plan.prepared?plan.quoteOperationMs:1700),capacityAllowed:nativePaperManagementReserve(u,true,context.held>0,plan.maximumAccountedStarts).entryAllowed};}),permissionReason:financialPermission,provider:{available:f.client.available(),busy:u.inFlight!==0||u.waitingOrOperating,readyAt:gate?.readyAt??at}});
  context.financialSelectionSnapshot=selected;context.candidate=selected.selectedMint??undefined;return selected;
 }
 async function step(prospectiveEnabled=true){
  handoff.observe(f.at,certificates);const selected=selection(),before=f.starts.length;
  if(selected.selection==='ready-decision'){
   const c=current.get(selected.selectedMint!)!,proof=proofs.get(c.mint)!,admission=owner.financialAdmission(c,1450,f.at);assert.equal(admission.admitted,true);assert.equal(sha(c),originalCertificates.get(c.mint));assert.equal(sha(proof),originalProofs.get(c.mint));
   handoff.dispatch(c,f.at);
   await f.client.call('getMultipleAccounts',[],undefined,{timeoutMs:1000,operationBoundMs:1200,latestStartAt:c.deadlineAt-1575,requestId:'offline-throughput:request:'+(++context.requestSequence),admissionOpen:()=>owner.financialAdmission(c,1450,f.at).admitted&&lowerView(1200).admitted&&financialPermission===null});
   f.at+=250;assert.ok(f.at<=c.deadlineAt,'bounded decision callback completes before original evidence expiration');
   // No invented strategy decision receipt: this verifies dispatch/completion
   // ownership and real quote I/O, not an execution-economics qualification.
   handoff.complete(c,f.at,1,0);certificates.splice(certificates.indexOf(c),1);owner.financialOwnerHints.set(c.mint,'offline-completed');
  }else if(selected.selection==='preparation'){
   const target=owner.financialPreparationTargets(f.at).find((row:any)=>row.mint===selected.selectedMint);await holder.prepareEntrySupport(target);
  }else if(prospectiveEnabled)await fallback();
  if(f.starts.length===before){const ready=f.client.usage().rpcDispatchWindow?.readyAt??f.at;f.at=Math.max(f.at+25,Number.isFinite(ready)?ready:f.at+25);}
  assert.equal(sha(state),originalLedger,'one financial account and its original history stay untouched by preparation/dispatch tests');
  for(const c of current.values())assert.equal(sha(c),originalCertificates.get(c.mint));
  for(const [mint,proof]of proofs)assert.equal(sha(proof),originalProofs.get(mint));
  return selected;
 }
 return {f,keys,state,context,owner,market,certificates,handoff,wave,selection,step,get sourceCalls(){return sourceCalls;},set permission(v:string|null){financialPermission=v;},set source(v:boolean){source=v;},set lastCompleted(v:number|null){lastCompleted=v;},set pendingAt(v:number|null){pendingAt=v;},set nativeAt(v:number|null){nativeAt=v;}};
}

test('three four-certificate bursts complete bounded financial dispatch without rewriting proof or expiry',async t=>{
 const x=burstFixture(t),latencies:number[]=[];
 for(const end of [210000,240000,270000]){
  x.wave(end);const admitted=x.f.at,first=x.selection();assert.equal(first.selection,'none');assert.equal(first.candidates.length,4);assert.ok(first.candidates.every(row=>row.impossible&&row.requiredMs===6675));
  for(let n=0;n<100&&x.certificates.length;n++){const before=x.certificates.length;await x.step();if(x.certificates.length<before)latencies.push(x.f.at-admitted);}
  if(x.certificates.length)t.diagnostic(JSON.stringify({at:x.f.at,starts:x.f.starts.slice(-20),latencies,selection:x.selection(),tail:x.f.records.filter(row=>row.kind.includes('deferred')||row.kind.includes('refused')).slice(-3)}));
  assert.equal(x.certificates.length,0,'all four supported original windows complete');
 }
 const usage=x.handoff.usage(x.f.at),physical=x.f.client.usage();
 assert.equal(usage.seen,12);assert.equal(usage.dispatched,12);assert.equal(usage.financialEvaluations,12);assert.equal(usage.economicDecisions,0,'no synthetic callback is counted as a real V3.1 economic decision');assert.equal(usage.expiredBeforeDispatch,0);assert.equal(usage.invalidatedBeforeDispatch,0);
 assert.equal(x.f.starts.length,48);assert.equal(physical.newUnits,48);assert.equal(physical.inFlight,0);assert.equal(physical.automaticRequestRetries,0);
 assert.ok(x.f.starts.every((row,i)=>i===0||row.at-x.f.starts[i-1]!.at>=250));
 for(const row of x.f.starts){assert.ok(x.f.starts.filter(v=>v.at>row.at-10000&&v.at<=row.at).length<=20);assert.ok(x.f.starts.filter(v=>v.at>row.at-60000&&v.at<=row.at).length<=60);}
 assert.ok(Math.max(...latencies)<6175);t.diagnostic(JSON.stringify({scope:'OFFLINE_BOUNDED_DISPATCH',certificates:12,completed:12,preventableExpirations:0,physicalStarts:48,completionLatenciesMs:latencies,dispatchWait:usage.dispatchWait}));
});

test('the retained-certificate no-preparation path reproduces deadlock while bounded prospective work progresses',async t=>{
 const x=burstFixture(t);x.wave(210000);const at=x.f.at;
 for(let n=0;n<8;n++)assert.equal((await x.step(false)).selection,'none');
 assert.equal(x.f.starts.length,0,'the old nonempty-certificate guard suppressed all preparation');assert.equal(x.certificates.length,4);
 x.f.at=at+250;await x.step();assert.equal(x.f.starts.length,1,'actual current fallback makes one physical preparation turn');assert.equal(x.certificates.length,4,'warming support never consumes or renews a certificate');
});

test('two holdings and pending execution retain priority over cold support',async t=>{
 const x=burstFixture(t);x.wave(210000);x.state.positions={HELD_A:{units:'1'},HELD_B:{units:'2'}};
 // The separate immutable ledger assertion in step is deliberately bypassed:
 // this case supplies an existing two-holding account from its own start.
 x.lastCompleted=x.f.at-2000;const before=x.f.starts.length;x.context.financialSelectionSnapshot=x.selection();x.context.candidate=undefined;
 const text=runNativePaper.toString(),a=text.indexOf('const prospectiveEntryPreparation='),b=text.indexOf('const reconnectUsage=',a),run=runInNewContext('(async()=>{for(let n=0;n<1;n++){'+text.slice(a,b)+'}})',x.context,{timeout:1000});
 await run();assert.equal(x.f.starts.length,before,'two-second protection target cannot lend its remaining completed-protection envelope to a cold read');
 x.lastCompleted=x.f.at;x.pendingAt=x.f.at+100;x.state.pending={EXISTING_ORDER:{}};await run();assert.equal(x.f.starts.length,before,'existing pending execution prevents support I/O');
 assert.equal(PILOT_TIMING.targetMs,2000);assert.equal(PILOT_TIMING.experimentalCompletedEvaluationLimitMs,4000);assert.equal(Object.keys(x.state.positions).length,2);assert.equal(x.context.workOwner.current,'idle');
});

test('actual request admission rechecks pending ownership after provider pacing without claiming a transport',async t=>{
 const x=burstFixture(t);x.wave(210000);await x.step();assert.equal(x.f.starts.length,1);
 const target=x.owner.financialPreparationTargets(x.f.at)[0];
 x.f.onSleep=()=>{x.state.pending={PAPER_EXECUTION_IN_PROGRESS:{}};x.pendingAt=x.f.at;};
 await x.context.holder.prepareEntrySupport(target);
 assert.equal(x.f.starts.length,1,'a newly due financial obligation prevents the second physical invocation');assert.equal(x.f.client.usage().newUnits,1);
 const refused=x.f.records.find(row=>row.kind==='component-local-admission-refused');assert.ok(refused);assert.equal(refused.data.stage,'after-pacing');assert.equal(refused.data.transportStarted,false);assert.equal(refused.data.physicalSettlementClaimed,false);
 assert.equal(x.context.workOwner.current,'idle');x.f.onSleep=null;x.state.pending={};x.pendingAt=null;
 await x.context.holder.prepareEntrySupport(target);assert.equal(x.f.starts.length,2,'same original certificate resumes after actual pending ownership clears');
});

test('expired original certificates cannot admit financial or certified support work',async t=>{
 const x=burstFixture(t);x.wave(210000);const certificate=x.certificates[0]!,original=sha(certificate),target=x.owner.financialPreparationTargets(x.f.at)[0];
 x.f.at=certificate.deadlineAt+1;
 assert.equal(x.owner.financialAdmission(certificate,1200,x.f.at).admitted,false);assert.equal(x.owner.financialAdmission({...certificate,deadlineAt:certificate.deadlineAt+10000},1200,x.f.at).admitted,false);
 assert.equal(await x.context.holder.prepareEntrySupport(target),false);assert.equal(x.f.starts.length,0);assert.equal(x.selection().selection,'none');assert.equal(sha(certificate),original);
 x.handoff.observe(x.f.at,[]);assert.equal(x.handoff.usage(x.f.at).expiredBeforeDispatch,4,'a real expired certificate remains an expiry, never a fabricated decision');
});

test('a cold certificate can service its genuinely required native heartbeat through the same physical gate',async t=>{
 const x=burstFixture(t);x.wave(210000);const c=x.certificates[0]!,original=sha(c);let hardDeadline=x.f.at+1700,requested=false,serviceCalls=0;
 const flow={usage:()=>({sharedOperationActive:false,nativePhysicalOperations:0,nativeServiceDeadlines:[{action:'heartbeat',deadlineAt:hardDeadline}]}),
  requestHeartbeat:()=>{requested=true;},servicePlan:(policy:{allowSetup:boolean;allowRetirement:boolean})=>{assert.equal(policy.allowSetup,false);assert.equal(policy.allowRetirement,false);return {at:requested?x.f.at:hardDeadline,domain:'control',action:'heartbeat',required:true,deadlineAt:hardDeadline,operationBoundMs:1200};},
  service:async(signal:AbortSignal|undefined,admission:any,policy:{allowSetup:boolean;allowRetirement:boolean})=>{assert.deepEqual(policy,{allowSetup:false,allowRetirement:false});assert.equal(admission.admissionOpen(),true);serviceCalls++;await x.f.client.operateData({transport:'ws',method:'ping'},async op=>{x.f.at+=100;op.completeResponse();},signal,admission);hardDeadline=x.f.at+15000;requested=false;return {kind:'ping'};}};
 x.owner.options={rpc:x.f.client,flow,financialEvaluationPending:()=>true};x.owner.working=false;x.owner.sourceWorkAllowed=()=>true;x.owner.hasPendingFinancialEvaluation=()=>true;
 x.owner.admission=(deadline:number)=>({latestStartAt:deadline-1200});x.owner.serviceFlow=(NativeCandidateRunner.prototype as any).serviceFlow;
 x.owner.deadlineView=()=>({requiredNativeAt:hardDeadline,requiredNativeAction:'heartbeat',readyCount:3});
 assert.equal(x.owner.financialAdmission(c,1700,x.f.at).reason,'required-native-service-deadline');assert.equal(x.market.entryPreparationStatus(c.mint).ready,false);
 const result=await NativeCandidateRunner.prototype.serviceFinancialRunway.call(x.owner,c,1700);
 assert.equal(result.attempted,true);assert.equal(result.admitted,true);assert.equal(result.action,'heartbeat');assert.equal(serviceCalls,1);assert.equal(x.f.client.usage().newUnits,1);assert.equal(x.f.client.usage().inFlight,0);assert.equal(sha(c),original);assert.equal(x.market.entryPreparationStatus(c.mint).ready,false,'native recovery does not invent prepared financial support');
});

test('logical provider timeout keeps its physical slot and charged unit until actual late settlement',async t=>{
 let release!:(response:Response)=>void;const f=physicalFixture(t,{fetcher:(async()=>await new Promise<Response>(resolve=>{release=resolve;}))as typeof fetch});
 await assert.rejects(f.client.call('getMultipleAccounts',[],undefined,{timeoutMs:5,requestId:'offline-throughput:request:1'}),/PHYSICAL_TIMEOUT/);
 const timed=f.client.usage(),start=f.records.find(row=>row.kind==='component-physical-start')!.data;assert.equal(timed.inFlight,1);assert.equal(timed.newUnits,1);assert.equal(start.callerRequestId,'offline-throughput:request:1');
 f.at+=10000;await assert.rejects(f.client.call('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.client.usage().newUnits,1);assert.equal(f.records.filter(row=>row.kind==='component-physical-settled').length,0);
 release(new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{available:true}})));await turn();await turn();
 const settled=f.records.find(row=>row.kind==='component-physical-settled')!.data;assert.equal(settled.id,start.id);assert.equal(settled.callerRequestId,start.callerRequestId);assert.equal(settled.physicalSettlementObserved,true);assert.equal(f.client.usage().inFlight,0);assert.equal(f.client.usage().newUnits,1,'physical settlement releases capacity without refunding the charge');
});

function priorityFixture(){
 let at=100000,required=false,newCertificate=false,serviceCalls=0,peerAuditScans=0;const c:any={identity:{baseMint:'SYNTHETIC_SCOPE'},auditSession:null},certificates=new Map();
 const noop=()=>true,owner:any=Object.create(NativeCandidateRunner.prototype);
 Object.assign(owner,{working:false,candidates:new Map([[c.identity.baseMint,c]]),certificates,financialOwnerHints:new Map(),verificationSession:null,watch:{lookupIdentity:()=>({state:'OBSERVE'})},productivity:{warmed:()=>{}},now:()=>at,open:()=>true,
  drainFinancialOutcomes:noop,drainGapRetirements:noop,reconcileObservationMembership:noop,reconcileFlowOpen:noop,drainTokenCreation:noop,drainPreparedObservation:noop,registryHousekeeping:()=>{},drainCancelledAuditDiagnostics:async()=>{},pruneProofCache:noop,sourceWorkAllowed:noop,
  hasPendingFinancialEvaluation:()=>certificates.size>0,readyAudits:()=>{peerAuditScans++;return [];},discretionaryAdmission:()=>({admitted:true}),traceAuditDispatch:noop,auditDispatchContext:()=>({}),admission:()=>({}),record:noop,
  finishAudit:async()=>{if(newCertificate){certificates.set(c.identity.baseMint,Object.freeze({deadlineAt:at+1786,featuresSha256:'a'.repeat(64)}));newCertificate=false;}},
  options:{maximumDeep:4,financialEvaluationPending:()=>certificates.size>0,rpc:{usage:()=>({inFlight:0,waitingOrOperating:false,rpcDispatchWindow:{readyAt:at,physicalBusy:false},controlDispatchWindow:{readyAt:at,physicalBusy:false}})},flow:{snapshot:()=>null,usage:()=>({fatal:null,nextServiceAt:required?at:at+10000,nextServiceDomain:'control',sharedOperationActive:false,nativePhysicalOperations:0}),servicePlan:()=>({at:required?at:at+10000,domain:'control',action:'heartbeat',required:true,deadlineAt:required?at+1000:at+15000}),service:async(_signal:unknown,admission:{admissionOpen:()=>boolean},policy:{allowSetup:boolean})=>{assert.equal(policy.allowSetup,false);assert.equal(admission.admissionOpen(),true);serviceCalls++;at+=25;required=false;return {kind:'heartbeat'};}}}});
 return {owner,c,certificates,get peerAuditScans(){return peerAuditScans;},get serviceCalls(){return serviceCalls;},set required(v:boolean){required=v;},set newCertificate(v:boolean){newCertificate=v;}};
}

test('actual source step yields a new short-runway certificate before peer audit scanning',async()=>{
 const f=priorityFixture();f.c.auditSession={completed:true};f.newCertificate=true;
 assert.equal(await f.owner.step(),'financial-decision-ready');assert.equal(f.peerAuditScans,0);assert.equal(f.serviceCalls,0);assert.equal(f.owner.working,false);
});

test('actual source step services required native maintenance before its existing-certificate audit barrier',async()=>{
 const f=priorityFixture();f.certificates.set(f.c.identity.baseMint,{deadlineAt:110000});f.required=true;
 assert.equal(await f.owner.step(),'heartbeat');assert.equal(f.serviceCalls,1);assert.equal(await f.owner.step(),'financial-decision-ready');assert.equal(f.serviceCalls,1,'peer-audit yielding cannot deadlock actual required heartbeat service');
});
