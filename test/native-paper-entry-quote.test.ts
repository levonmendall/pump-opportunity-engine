/** OFFLINE: real retained account bytes, SDK pricing, PilotRpc accounting and
 * launcher admission closures; synthetic certificate and native service timing.
 * No network, production financial account, natural fill or economic edge. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {PILOT_ENTRY_PREPARATION_POLICY,PilotMarket,type PilotInventory,type PilotMarketOptions} from '../src/pilot-market.js';
import type {PoolWireAccount} from '../src/pool.js';
import {PilotRpc,PilotRpcUnavailable} from '../src/pilot-rpc.js';
import {nativePaperRpcConfiguration} from '../src/run-native-paper.js';
import {runInNewContext} from 'node:vm';
import {NativeProtectionDispatch} from '../src/native-protection-dispatch.js';
import {runNativePaper,nativePaperSourceWorkAdmission,nativePaperRequestOperationBound,nativePaperProtectionReadDeadline,nativePaperManagementReserve,nativePaperEntryWorkflowStarts,NATIVE_PAPER_ENTRY_NATIVE_MAINTENANCE_POLICY} from '../src/run-native-paper.js';
import {NativeCandidateRunner,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {NativePaperWorkState} from '../src/native-paper-work.js';
import {NativePaperEntryAdmission,type NativePaperEntryAdmissionToken} from '../src/native-paper-entry-admission.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {pilotLowerPriorityAdmission} from '../src/pilot.js';

const signal=()=>new AbortController().signal;
type QuoteRead=NonNullable<PilotMarketOptions['withEntryQuoteRead']>;
function fixture(t:TestContext,timeoutMs=1000,cooperative=false,paced=false,executionRealism=false,reusePreparedEntryRent=false){
  const runs=['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z'];
  const captures=runs.map(run=>{
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    return {proof,state:structuredClone(rows.find(row=>row.kind==='pool-state').data)};
  });
  let at=Date.parse(captures[1]!.proof.quote.validatedAt),slot=Math.max(...captures.map(c=>c.state.context.slot)),rentOffset=0;
  let clockHook:(()=>void)|undefined;const clock=()=>{clockHook?.();return at;};
  const oldNow=Date.now;Date.now=clock;
  const records:Array<{kind:string;data:any}>=[],calls:Array<{method:string;params:any[];at:number}>=[];let recordHook:((kind:string)=>void)|undefined,preparationHook:((input:{method:string;signal:AbortSignal})=>Promise<void>)|undefined;
  const accounts=new Map<string,PoolWireAccount>();
  for(const {state}of captures)for(let i=0;i<state.addresses.length;i++)accounts.set(state.addresses[i],state.value[i]);
  const root=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-pilot-market-')),path=join(root,'fixture.sqlite'),ledger=new DisposableLedger(path,'fixture-pilot-market-mechanics');
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE fixed USD snapshot'});
  ledger.initialize(price(),at);
  t.after(()=>{physical?.close();ledger.close();Date.now=oldNow;rmSync(root,{recursive:true,force:true});});
  let wait:Promise<void>|undefined,rpcHook:((method:string)=>void)|undefined,activity:((ms:number)=>void)|undefined,inventoryOverride:PilotInventory|null=null;
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:structuredClone(params),at});
    rpcHook?.(method);
    if(wait){const pending=wait;wait=undefined;await pending;}
    if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0])+rentOffset)as T;
    if(method==='getBlockTime')return Math.floor(at/1000)as T;if(method==='getSlot')return slot as T;
    assert.equal(method,'getMultipleAccounts');
    const addresses=params[0] as string[],raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
    const clock:PoolWireAccount={data:[raw.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};
    return {context:{slot},value:addresses.map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(address)??null))}as T;
  },usage:()=>({calls:calls.length})};
  let quoteHook:QuoteRead|undefined,physical:PilotRpc|undefined;
  if(paced){const old=join(root,'prior.json');writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:at-120000,starts:[at-121000],pending:[]}));physical=new PilotRpc({directory:join(root,'paced-rpc'),runId:'offline-entry-quote-pacing',baselinePaths:[old],priorPhysicalSettled:true,...nativePaperRpcConfiguration(true),now:clock,monotonic:()=>at,sleep:async ms=>{at+=ms;activity?.(ms);},fetcher:(async(_url,init)=>{const q=JSON.parse(String(init?.body)),result=await rpc.call(q.method,q.params);return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));}),record:(kind,data)=>{records.push({kind,data:structuredClone(data)});recordHook?.(kind);}});}
  let adapter:any=physical??rpc;const routed={call:<T>(method:string,params?:unknown[],signal?:AbortSignal)=>adapter.call(method,params,signal) as Promise<T>,usage:()=>adapter.usage?.()};
  const market=new PilotMarket({rpc:routed,withEntryQuoteRead:(input,read)=>quoteHook?quoteHook(input,read):read(),inventory:()=>inventoryOverride??ledger.state(),price,now:()=>at,...(executionRealism?{executionRealism:true as const}:{}),...(reusePreparedEntryRent?{reusePreparedEntryRent:true as const}:{}),recorder:{record(kind,data){records.push({kind,data:structuredClone(data)});recordHook?.(kind);}},...(cooperative?{beforeEntryPreparationRead:async(input:{method:string;signal:AbortSignal})=>{await preparationHook?.(input);}}:{}),gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE7k simulated network/priority cost'},timeoutMs});
  for(const c of captures)market.registerPool({mint:c.proof.quote.mint,migrationVerified:true,migrationSlot:c.proof.origin.slot,evidence:'retained actual migration; synthetic current timing'});
  const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1000,context:s=>market.context(ledger.state().positions,s),quote:market.executionQuote});
  coordinator.recover();ledger.reconcile('initial-reconcile',at,price(),{});ledger.resume('fixture-ready',at,price(),{},{version:'isolated-pilot-market-fixture',evidence:'synthetic readiness for market/ledger mechanics only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  return {captures,ledger,market,coordinator,price,calls,records,get physical(){return physical;},withQuoteRead:(value:QuoteRead)=>{quoteHook=value;},route:(value:any)=>{adapter=value;},now:clock,onClock:(hook:()=>void)=>{clockHook=hook;},advance:(ms:number)=>{at+=ms;},rentChanged:()=>{rentOffset++;},bumpSlot:()=>{slot++;},slot:()=>slot,setSlot:(value:number)=>{slot=value;},pause:(p:Promise<void>)=>{wait=p;},account:(address:string)=>accounts.get(address),replaceAccount:(address:string,wire:PoolWireAccount)=>{accounts.set(address,structuredClone(wire));},overrideInventory:(value:PilotInventory|null)=>{inventoryOverride=value;},onRpc:(hook:(method:string)=>void)=>{rpcHook=hook;},onPacingWait:(hook:(ms:number)=>void)=>{activity=hook;},onRecord:(hook:(kind:string)=>void)=>{recordHook=hook;},beforePreparationRead:(hook:(input:{method:string;signal:AbortSignal})=>Promise<void>)=>{preparationHook=hook;}};
}



async function quoteFixture(t:TestContext,cooperative=true){
 const f=fixture(t,3000,true,true,true,true),mint=f.captures[1]!.proof.quote.mint;
 f.advance(Math.ceil(f.now()/10000)*10000+1000-f.now());
 const began=f.now(),rpc=f.physical!,owner=new NativePaperWorkState(),entryAdmission=new NativePaperEntryAdmission(),holder:any={};
 let hardDeadline=began+3450,dueAt=began+2000,active=false,unsettled=false,serviceCalls=0,serviceFails=false,serviceThrows=false,afterService:(()=>void)|undefined,certificatePresent=true;
 const flow:any={usage:()=>({dataContract:'confirmed-program-activity-v3-shadow',nativeServiceDeadlines:[{action:'support-refresh',deadlineAt:hardDeadline}],sharedOperationActive:active||unsettled,nativePhysicalOperations:unsettled?1:0}),
  requestSupportRefresh:()=>{dueAt=f.now();},requestHeartbeat:()=>assert.fail('support deadline must select support'),
  servicePlan:()=>({at:dueAt,action:'support-refresh',domain:'rpc',required:true,deadlineAt:hardDeadline,operationBoundMs:1700}),
  service:async(s:AbortSignal,options:any,policy:any)=>{serviceCalls++;assert.equal(policy.allowSetup,false);assert.equal(policy.allowRetirement,false);assert.equal(owner.current,'source');assert.equal(holder.maintenanceActive(),true);assert.equal(rpc.usage().inFlight,0);assert.equal(rpc.usage().waitingOrOperating,false);assert.equal(options.admissionOpen(),true);if(serviceThrows)throw Error('OFFLINE_NATIVE_SERVICE_FAILURE');if(serviceFails)return {kind:'deferred'};
   active=true;try{const sourcePricer=new ResearchClockPositionPricer(holder.scheduled,{record(){}}),batch=await sourcePricer.validateObservationMany([{mint:new PublicKey(mint)}],s,{latestStartAt:options.latestStartAt,admissionOpen:options.admissionOpen});assert.ok(batch.validations[mint],'real account/Clock decoder must validate fresh native support');hardDeadline=Math.min(batch.validations[mint]!.at+30000,batch.validations[mint]!.summary.marketClockUnixSeconds*1000+30000);dueAt=f.now()+1000;afterService?.();return {kind:'support'};}finally{active=false;}
  }};
 const engine=new NativeCandidateRunner({rpc,flow,record(){},now:f.now});
 const windowEndAt=Math.floor(f.now()/10000)*10000,certificate:NativeAuditCertificate={schemaVersion:1,mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),dataContract:'confirmed-program-activity-v3-shadow',openedAt:windowEndAt-60000,connectionId:1,subscriptionId:1,windowStartAt:windowEndAt-60000,windowEndAt,auditAvailableAt:f.now(),admittedAt:f.now(),deadlineAt:windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)};
 t.mock.method(engine,'currentAuditCertificate',(selected:string,at=f.now())=>certificatePresent&&selected===certificate.mint&&at<=f.now()&&at<=certificate.deadlineAt&&Math.floor(at/10000)*10000===certificate.windowEndAt?structuredClone(certificate):null);
 assert.equal(engine.financialAdmission(certificate,1500).admitted,true);
 const limit=nativePaperEntryWorkflowStarts(true,'liquidity-resilient-momentum-v3.1',false);assert.equal(limit,4);
 const entryToken=entryAdmission.begin({mint,at:f.now(),windowEndAt,deadlineAt:certificate.deadlineAt,maximumAccountedStarts:limit,fullyAdmitted:true});assert.ok(entryToken);owner.set('candidate');
 const lowerView=(bound=1200)=>pilotLowerPriorityAdmission({now:f.now(),endAt:Number.MAX_SAFE_INTEGER,held:0,lastUsable:null,nextPendingAt:null,operationBoundMs:bound});
 const sourceInformationAdmission=()=>true,sourceAdmission=()=>!(owner.current==='candidate'&&!entryAdmission.valid(entryToken,f.now()))&&nativePaperSourceWorkAdmission({informationOpen:true,owned:false,entryWork:owner.current==='candidate',entryStartsRemaining:entryAdmission.remaining(entryToken,f.now()),usage:rpc.usage(),persistent:true});
 const optionalAdmission=(bound=1200)=>sourceAdmission()&&lowerView(bound).admitted&&engine.discretionaryAdmission(bound).admitted;
 const safety={recoveryComplete:true,idle:false,evidenceAvailable:true,financialAvailable:true,uncertainActions:0,newHardPauseObserved:false},bridge={trader:{entryReadinessSafety:()=>safety},protection:()=>assert.fail('active quote must not reenter protection')};
 const context:any={__name:(x:unknown)=>x,NativeProtectionDispatch,record:(kind:string,data:unknown)=>f.records.push({kind,data:structuredClone(data)}),runId:'OFFLINE-QUOTE',requestSequence:0,entryCertificate:certificate,sourceEntryPreparation:null,candidateDiagnostic:(run:()=>unknown)=>run(),holder,currentLedger:f.ledger,workOwner:owner,currentRpc:rpc,service:true,Date:{now:f.now},endAt:Number.MAX_SAFE_INTEGER,stopped:false,lastCompleted:null,entryAdmission,entryToken,manifest:{controlCooldownUntil:0},PilotRpcUnavailable,nativePaperRequestOperationBound,nativePaperProtectionReadDeadline,nativePaperSourceWorkAdmission,nativePaperManagementReserve,NATIVE_PAPER_ENTRY_NATIVE_MAINTENANCE_POLICY,lowerView,sourceAdmission,sourceInformationAdmission,optionalAdmission,engine,currentNative:flow,bridge,serviceGeneration:0,manualPaused:false,safeStopRequested:false,financialCapacityReason:()=>null};
 const text=runNativePaper.toString(),begin=text.search(/const\s+requestOptions\s*=/),rest=text.slice(begin),end=rest.search(/;\s*const\s+market\s*=/);assert.ok(begin>=0&&end>0);
 runInNewContext(rest.slice(0,end)+';holder.scheduled=scheduled;holder.withEntryQuoteRead=withEntryQuoteRead;holder.maintenanceActive=()=>requiredEntryNativeMaintenance!==null;',context,{timeout:1000});f.route(holder.scheduled);if(cooperative)f.withQuoteRead(holder.withEntryQuoteRead);
 let preparationCallbacks=0;f.beforePreparationRead(async()=>{preparationCallbacks++;});
 const plan=await f.market.prepareEntryCosts(mint,signal(),{maximumMs:PILOT_ENTRY_PREPARATION_POLICY.maximumAggregateMs});
 assert.equal(f.now()-began,500);assert.equal(f.calls.length,3);assert.equal(preparationCallbacks,3);assert.equal(entryAdmission.view(entryToken,f.now())?.spent,3);assert.equal(engine.financialAdmission(certificate,1200).admitted,true);
 // Actual synthetic transport response latency remains inside both original
 // native and quote bounds; this is not a zero-duration upkeep success.
 f.onRpc(()=>{if(f.calls.length>3)f.advance(120);});
 const before=structuredClone(f.ledger.state()),caller=new AbortController();
 const quote=()=>f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:plan.depositLamports},caller.signal);
 return {f,mint,plan,before,began,rpc,engine,certificate,entryAdmission,entryToken,owner,holder,context,safety,caller,quote,get serviceCalls(){return serviceCalls;},set deadline(at:number){hardDeadline=at;},set unsettled(value:boolean){unsettled=value;},set serviceFails(value:boolean){serviceFails=value;},set serviceThrows(value:boolean){serviceThrows=value;},afterService:(hook:()=>void)=>{afterService=hook;},removeCertificate:()=>{certificatePresent=false;}};
}

test('paced final quote is refused by a newly limiting native obligation without cooperation',async t=>{
 const h=await quoteFixture(t,false);assert.equal(await h.quote(),null);assert.equal(h.f.calls.length,3);assert.equal(h.serviceCalls,0);assert.deepEqual(h.f.ledger.state(),h.before);
 const refusal=h.f.records.find(row=>row.kind==='component-local-admission-refused');assert.equal(refusal?.data.stage,'after-pacing');assert.equal(refusal?.data.transportStarted,false);assert.equal(refusal?.data.chargedReservationRetained,false);assert.equal(h.certificate.deadlineAt-h.f.now(),8249);
 assert.equal(h.f.market.usage().entryQuoteFailures.last?.reasonCode,'PILOT_RPC_COMPONENT_ADMISSION_CLOSED');
});

test('one real native support read restores a paced exact-size quote with original four entry credits',async t=>{
 const h=await quoteFixture(t),original=structuredClone(h.certificate),quoted=await h.quote();assert.ok(quoted);assert.equal(quoted.inputUnits,'10000000');assert.equal(quoted.at,h.f.now());assert.equal(h.serviceCalls,1);assert.equal(h.f.calls.length,5);assert.equal(h.rpc.usage().newUnits,5);assert.equal(h.rpc.usage().providerResponses.httpStarts,5);
 const scope=h.entryAdmission.view(h.entryToken,h.f.now());assert.equal(scope?.limit,4);assert.equal(scope?.spent,4);assert.equal(scope?.remaining,0);assert.deepEqual(h.certificate,original);assert.equal(h.context.entryToken,h.entryToken);assert.equal(h.holder.maintenanceActive(),false);assert.equal(h.owner.current,'candidate');assert.deepEqual(h.f.ledger.state(),h.before);
 const maintenance=h.f.records.filter(row=>row.kind==='native-paper-entry-native-maintenance');assert.equal(maintenance.length,1);assert.equal(maintenance[0]!.data.accountedProviderStarts,1);assert.equal(maintenance[0]!.data.remainingEntryStarts,1);assert.equal(maintenance[0]!.data.originalCertificateExtended,false);assert.equal(maintenance[0]!.data.entryPermissionGranted,false);
 const rentProof=h.f.records.find(row=>row.kind==='rpc-market-quote')!.data.costs;assert.equal(rentProof.preparationAt,h.plan.at);assert.equal(rentProof.rentSource,'validated-entry-preparation');assert.deepEqual(rentProof.rentObservationsByBytes,h.plan.rentObservationsByBytes);
});

for(const reason of ['budget','native-unsettled','rpc-unsettled','owner-pause','financial-unavailable','missing-certificate']as const)test(`final quote maintenance stays closed for ${reason}`,async t=>{
 const h=await quoteFixture(t),usage=h.rpc.usage.bind(h.rpc);
 if(reason==='budget')t.mock.method(h.rpc,'usage',()=>{const u=usage();return {...u,requestLimits:{...u.requestLimits,maxStartsPer10s:(u.chapterUsage?.rolling10SecondStarts??0)+1}};});
 else if(reason==='native-unsettled')h.unsettled=true;
 else if(reason==='rpc-unsettled')h.f.onPacingWait(()=>{t.mock.method(h.rpc,'usage',()=>({...usage(),waitingOrOperating:true}));});
 else if(reason==='owner-pause')h.context.manualPaused=true;
 else if(reason==='financial-unavailable')h.safety.financialAvailable=false;
 else h.removeCertificate();
 assert.equal(await h.quote(),null);assert.equal(h.serviceCalls,0);assert.equal(h.f.calls.length,3);assert.equal(h.holder.maintenanceActive(),false);assert.deepEqual(h.f.ledger.state(),h.before);
});

for(const reason of ['failed','threw','certificate-changed','certificate-expired','source-generation','physical-unsettled','owner-pause','caller-abort','quote-pacing-runway']as const)test(`maintenance ${reason} never creates a replacement quote authority`,async t=>{
 const h=await quoteFixture(t);
 if(reason==='failed')h.serviceFails=true;else if(reason==='threw')h.serviceThrows=true;
 else h.afterService(()=>{if(reason==='certificate-changed')h.certificate.featuresSha256='b'.repeat(64);else if(reason==='certificate-expired')h.f.advance(9000);else if(reason==='source-generation')h.context.serviceGeneration++;else if(reason==='physical-unsettled')h.unsettled=true;else if(reason==='owner-pause')h.context.manualPaused=true;else if(reason==='caller-abort')h.caller.abort();else h.deadline=h.f.now()+1500+125+1200+100;});
 assert.equal(await h.quote(),null);assert.equal(h.serviceCalls,1);assert.equal(h.f.calls.length,reason==='failed'||reason==='threw'?3:4);assert.equal(h.holder.maintenanceActive(),false);assert.equal(h.owner.current,'candidate');assert.deepEqual(h.f.ledger.state(),h.before);
});

test('durably reserved but uninvoked final read retains the fourth entry credit and cannot retry',async t=>{
 const h=await quoteFixture(t);h.deadline=h.began+3600;const path=h.rpc.usage().activeChapterPath!;let expired=false;
 h.f.onClock(()=>{if(expired)return;const book=JSON.parse(readFileSync(path,'utf8'));if(book.starts.length===4&&book.actualInvocations.length===3&&book.pending.length===1){expired=true;h.f.advance(100);}});
 assert.equal(await h.quote(),null);assert.equal(expired,true);assert.equal(h.f.calls.length,3);assert.equal(h.rpc.usage().newUnits,4);assert.equal(h.entryAdmission.view(h.entryToken,h.f.now())?.spent,4);assert.equal(h.serviceCalls,0);
 const refusal=h.f.records.find(row=>row.kind==='component-local-admission-refused');assert.equal(refusal?.data.stage,'before-physical-invocation');assert.equal(refusal?.data.chargedReservationRetained,true);assert.equal(refusal?.data.transportStarted,false);assert.ok(h.rpc.usage().uncertainResponseBytes>0);assert.deepEqual(h.f.ledger.state(),h.before);
});

test('a transport fault with a matching admission error string cannot trigger native upkeep or a retry',async t=>{
 const h=await quoteFixture(t);h.deadline=h.began+30000;h.f.onRpc(()=>{h.deadline=h.f.now()+2000;throw Error('COMPONENT_ADMISSION_CLOSED');});
 assert.equal(await h.quote(),null);assert.equal(h.f.calls.length,4);assert.equal(h.rpc.usage().providerResponses.httpStarts,4);assert.equal(h.serviceCalls,0);assert.equal(h.entryAdmission.view(h.entryToken,h.f.now())?.spent,4);assert.deepEqual(h.f.ledger.state(),h.before);
});

test('a still-blocking native deadline receives at most one maintenance turn for the original token',async t=>{
 const h=await quoteFixture(t);h.afterService(()=>{h.deadline=h.began+3450;});assert.equal(await h.quote(),null);assert.equal(h.serviceCalls,1);assert.equal(h.f.calls.length,4);assert.equal(h.entryAdmission.view(h.entryToken,h.f.now())?.spent,3);
 assert.equal(await h.quote(),null);assert.equal(h.serviceCalls,1);assert.equal(h.f.calls.length,4);assert.equal(h.holder.maintenanceActive(),false);assert.deepEqual(h.f.ledger.state(),h.before);
});


test('entry support advances one physical read per turn, retaining original rent timestamps for a fresh exact-size quote',async t=>{
 const f=fixture(t,3000,false,true,true,true),mint=f.captures[1]!.proof.quote.mint;
 let turns=0;while(!f.market.entryPreparationStatus(mint).ready){const before=f.calls.length,result=await f.market.prepareEntryCostTurn(mint,signal());assert.equal(f.calls.length-before,1);assert.ok(['ready','deferred'].includes(result.status));assert.ok(++turns<=3);}
 assert.equal(turns,3);const original=f.market.entryPreparationStatus(mint);assert.equal(original.quoteReads,1);assert.ok(original.expiresAt);
 const plan=await f.market.prepareEntryCosts(mint,signal()),preparedCalls=f.calls.length;assert.equal(preparedCalls,3,'materializing the plan does not reacquire valid stages');f.advance(250);
 const q=await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:plan.depositLamports},signal());assert.ok(q);assert.equal(f.calls.length-preparedCalls,1);assert.equal(q.at,f.now());
 const evidence=f.records.findLast(row=>row.kind==='rpc-market-quote');assert.equal(evidence?.data.costs.preparationAt,plan.at);assert.deepEqual(evidence?.data.costs.rentObservationsByBytes,plan.rentObservationsByBytes);assert.equal(f.market.entryPreparationStatus(mint).expiresAt,original.expiresAt);
 f.advance(original.expiresAt!-f.now()+1);assert.equal(f.market.entryPreparationStatus(mint).ready,false);assert.equal(f.market.entryPreparationStatus(mint).state,'layout-required');
});

test('retiring or resetting a different candidate cannot revoke valid prepared costs',async t=>{
 const f=fixture(t,3000,false,false,true,true),a=f.captures[0]!.proof.quote.mint,b=f.captures[1]!.proof.quote.mint;
 await f.market.prepareEntryCosts(a,signal());const plan=await f.market.prepareEntryCosts(b,signal()),before=f.market.entryPreparationStatus(b);
 f.market.invalidateEntryPreparation(a);assert.deepEqual(f.market.entryPreparationStatus(b),before);
 assert.equal(f.market.unregisterPool(a),true);assert.deepEqual(f.market.entryPreparationStatus(b),before);
 const calls=f.calls.length;assert.equal((await f.market.prepareEntryCosts(b,signal())).depositLamports,plan.depositLamports);assert.equal(f.calls.length,calls);
 f.market.invalidateEntryPreparation(b);assert.equal(f.market.entryPreparationStatus(b).ready,false,'the matching generation still revokes reuse');
});

test('different mints share only fresh network rent facts, retaining their original receive clocks',async t=>{
 const f=fixture(t,3000,false,false,true,true),a=f.captures[0]!.proof.quote.mint,b=f.captures[1]!.proof.quote.mint,ledger=f.ledger.state();
 const first=await f.market.prepareEntryCosts(a,signal()),before=f.calls.length;
 f.advance(500);const second=await f.market.prepareEntryCosts(b,signal()),newCalls=f.calls.slice(before);
 const shared=Object.keys(second.rentLamportsByBytes).filter(bytes=>first.rentLamportsByBytes[bytes]!==undefined);assert.ok(shared.length>0);
 assert.equal(second.rentReuseScope,'same-rpc-generation-confirmed-byte-length-original-10s');
 for(const bytes of shared){assert.equal(newCalls.some(c=>c.method==='getMinimumBalanceForRentExemption'&&c.params[0]===Number(bytes)),false);assert.deepEqual(second.rentObservationsByBytes![bytes],first.rentObservationsByBytes![bytes]);}
 assert.ok(newCalls.some(c=>c.method==='getMultipleAccounts'),'the peer still validates its own coherent layout');
 assert.notEqual(first.layout!.pool,second.layout!.pool);assert.notEqual(first.evidence,second.evidence);assert.deepEqual(f.ledger.state(),ledger);
 const rentCalls=()=>f.calls.filter(c=>c.method==='getMinimumBalanceForRentExemption').length;
 const prior=rentCalls();f.market.invalidateEntryPreparation(a);await f.market.prepareEntryCosts(a,signal());assert.equal(rentCalls(),prior,'resetting a candidate does not revoke the still-fresh independent network fact');
 f.advance(PILOT_ENTRY_PREPARATION_POLICY.stableReuseMaxAgeMs+1);await f.market.prepareEntryCosts(a,signal());assert.ok(rentCalls()>prior,'the original ten-second lifetime still forces a new rent read');
 const afterExpiry=rentCalls();f.market.invalidate('OFFLINE source/RPC generation changed');await f.market.prepareEntryCosts(b,signal());assert.ok(rentCalls()>afterExpiry,'a new source generation cannot inherit rent');
});

test('a different validated account byte length cannot inherit another length rent value',async t=>{
 const f=fixture(t,3000,false,false,true,true),a=f.captures[0]!.proof.quote.mint,b=f.captures[1]!.proof.quote.mint;
 await f.market.prepareEntryCosts(a,signal());
 // Exercise the cost-cache boundary with a deliberately synthetic validated
 // length. SDK/on-chain support for this injected layout is not claimed.
 const pricer=(f.market as unknown as {pricer:ResearchClockPositionPricer}).pricer,validate=pricer.validateMany.bind(pricer);
 t.mock.method(pricer,'validateMany',async(...args:Parameters<ResearchClockPositionPricer['validateMany']>)=>{const value=await validate(...args),row=value.validations[b];if(row)row.summary.baseAssociatedAccount.accountLengthBytes=181;return value;});
 const before=f.calls.length,plan=await f.market.prepareEntryCosts(b,signal());
 assert.equal(plan.accountLengths.base,181);assert.ok(f.calls.slice(before).some(c=>c.method==='getMinimumBalanceForRentExemption'&&c.params[0]===181));
 assert.equal(plan.rentLamportsByBytes['181'],'1000181');assert.equal(plan.rentObservationsByBytes!['181']!.receivedAt,f.now());
});

test('shared rent cache is bounded by existing observation support capacity and failed reads are never cached',async t=>{
 const f=fixture(t,3000,false,false,true,true),mint=f.captures[0]!.proof.quote.mint,pricer=(f.market as unknown as {pricer:ResearchClockPositionPricer}).pricer,validate=pricer.validateMany.bind(pricer);let bytes=181;
 // Synthetic supported-layout responses isolate the cache's size boundary;
 // this does not assert SDK support for arbitrary account extensions.
 t.mock.method(pricer,'validateMany',async(...args:Parameters<ResearchClockPositionPricer['validateMany']>)=>{const value=await validate(...args),row=value.validations[mint];if(row)row.summary.baseAssociatedAccount.accountLengthBytes=bytes;return value;});
 const cache=(f.market as unknown as {preparationRents:Map<string,unknown>}).preparationRents;
 for(bytes=181;bytes<194;bytes++){f.market.invalidateEntryPreparation(mint);await f.market.prepareEntryCosts(mint,signal());assert.ok(cache.size<=12);}
 assert.equal(cache.size,12);bytes=181;f.market.invalidateEntryPreparation(mint);const before=f.calls.length;await f.market.prepareEntryCosts(mint,signal());assert.ok(f.calls.slice(before).some(row=>row.method==='getMinimumBalanceForRentExemption'&&row.params[0]===181),'an evicted size is physically read again');
 bytes=205;f.market.invalidateEntryPreparation(mint);f.onRpc(method=>{if(method==='getMinimumBalanceForRentExemption')throw Error('OFFLINE_RENT_REFUSAL');});await assert.rejects(f.market.prepareEntryCosts(mint,signal()),/OFFLINE_RENT_REFUSAL/);f.onRpc(()=>{});
 const failedAt=f.calls.length;await f.market.prepareEntryCosts(mint,signal());assert.ok(f.calls.slice(failedAt).some(row=>row.method==='getMinimumBalanceForRentExemption'&&row.params[0]===205),'a refused read grants no network fact to reuse');assert.ok(cache.size<=12);
});


test('shared rent support retains the second quote read after genuine source-cache invalidation',async t=>{
 const f=fixture(t,3000,false,false,true,true),a=f.captures[1]!.proof.quote.mint,b=f.captures[0]!.proof.quote.mint,beforeState=f.ledger.state();
 const first=await f.market.prepareEntryCostTurn(a,signal());assert.equal(first.status,'deferred');assert.equal(f.market.entryPreparationStatus(a).state,'rent-required');
 await f.market.prepareEntryCostTurn(b,signal());const retained=f.market.entryPreparationStatus(a);assert.equal(retained.state,'rent-required');assert.equal(retained.quoteReads,1,'preparing a peer preserves valid address links');
 const peerPlan=await f.market.prepareEntryCosts(b,signal()),shared=f.market.entryPreparationStatus(a);assert.equal(shared.ready,true,'the peer supplies the same fresh network rent facts');assert.equal(shared.expiresAt,retained.expiresAt,'the original layout clock is not extended');
 // A genuine failed source read still invalidates cached address links. Keep
 // the rent-only continuation regression without requiring obsolete eviction.
 f.onRpc(method=>{if(method==='getMultipleAccounts')throw Error('DISPOSABLE_TRANSPORT_FAILURE');});
 assert.equal(await f.market.quote({mint:b,side:'buy',inputUnits:'10000000',requiredDepositLamports:peerPlan.depositLamports},signal()),null);f.onRpc(()=>{});
 const remaining=f.market.entryPreparationStatus(a);assert.equal(remaining.state,'ready');assert.equal(remaining.quoteReads,2);assert.equal(remaining.expiresAt,retained.expiresAt);
 const {nativePaperRemainingEntryWork}=await import('../src/run-native-paper.js'),work=nativePaperRemainingEntryWork({at:f.now(),owned:true,preparation:remaining});assert.equal(work.quoteReads,2);assert.equal(work.maximumAccountedStarts,remaining.remainingReads+4);
 while(!f.market.entryPreparationStatus(a).ready)await f.market.prepareEntryCostTurn(a,signal());assert.equal(f.market.entryPreparationStatus(a).quoteReads,2,'rent reads do not recreate pool links');
 const plan=await f.market.prepareEntryCosts(a,signal()),before=f.calls.length,q=await f.market.quote({mint:a,side:'buy',inputUnits:'10000000',requiredDepositLamports:plan.depositLamports},signal());assert.ok(q,JSON.stringify({failure:f.market.usage().entryQuoteFailures,records:f.records.slice(-5)}));assert.equal(f.calls.length-before,2);assert.equal(q.at,f.now());assert.deepEqual(f.ledger.state(),beforeState);
});
