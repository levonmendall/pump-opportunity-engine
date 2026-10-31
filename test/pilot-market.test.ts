/** Retained real account bytes with synthetic timing and disposable accounting.
 * No network, production account, natural fill or economic edge is tested. */
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
import {PILOT_ENTRY_PREPARATION_POLICY,PilotMarket,type PilotInventory} from '../src/pilot-market.js';
import type {PoolWireAccount} from '../src/pool.js';
import {PilotRpc,PilotRpcUnavailable} from '../src/pilot-rpc.js';
import {nativePaperRpcConfiguration} from '../src/run-native-paper.js';
import {runInNewContext} from 'node:vm';
import {NativeProtectionDispatch} from '../src/native-protection-dispatch.js';
import {runNativePaper,nativePaperSourceWorkAdmission,nativePaperRequestOperationBound,nativePaperProtectionReadDeadline,nativePaperManagementReserve} from '../src/run-native-paper.js';
import {NativeCandidateRunner,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {NativePaperWorkState} from '../src/native-paper-work.js';
import {NativePaperEntryAdmission,type NativePaperEntryAdmissionToken} from '../src/native-paper-entry-admission.js';
import {pilotLowerPriorityAdmission} from '../src/pilot.js';

const signal=()=>new AbortController().signal;
function fixture(t:TestContext,timeoutMs=1000,cooperative=false,paced=false,executionRealism=false,reusePreparedEntryRent=false){
  const runs=['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z'];
  const captures=runs.map(run=>{
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    return {proof,state:structuredClone(rows.find(row=>row.kind==='pool-state').data)};
  });
  let at=Date.parse(captures[1]!.proof.quote.validatedAt),slot=Math.max(...captures.map(c=>c.state.context.slot)),rentOffset=0;
  const oldNow=Date.now;Date.now=()=>at;
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
  let physical:PilotRpc|undefined;
  if(paced){const old=join(root,'prior.json');writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:at-120000,starts:[at-121000],pending:[]}));physical=new PilotRpc({directory:join(root,'paced-rpc'),runId:'offline-entry-quote-pacing',baselinePaths:[old],priorPhysicalSettled:true,...nativePaperRpcConfiguration(true),now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;activity?.(ms);},fetcher:(async(_url,init)=>{const q=JSON.parse(String(init?.body)),result=await rpc.call(q.method,q.params);return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));}),record:(kind,data)=>records.push({kind,data:structuredClone(data)})});}
  let adapter:any=physical??rpc;const routed={call:<T>(method:string,params?:unknown[],signal?:AbortSignal)=>adapter.call(method,params,signal) as Promise<T>,usage:()=>adapter.usage?.()};
  const market=new PilotMarket({rpc:routed,inventory:()=>inventoryOverride??ledger.state(),price,now:()=>at,...(executionRealism?{executionRealism:true as const}:{}),...(reusePreparedEntryRent?{reusePreparedEntryRent:true as const}:{}),recorder:{record(kind,data){records.push({kind,data:structuredClone(data)});recordHook?.(kind);}},...(cooperative?{beforeEntryPreparationRead:async(input:{method:string;signal:AbortSignal})=>{await preparationHook?.(input);}}:{}),gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE7k simulated network/priority cost'},timeoutMs});
  for(const c of captures)market.registerPool({mint:c.proof.quote.mint,migrationVerified:true,migrationSlot:c.proof.origin.slot,evidence:'retained actual migration; synthetic current timing'});
  const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1000,context:s=>market.context(ledger.state().positions,s),quote:market.executionQuote});
  coordinator.recover();ledger.reconcile('initial-reconcile',at,price(),{});ledger.resume('fixture-ready',at,price(),{},{version:'isolated-pilot-market-fixture',evidence:'synthetic readiness for market/ledger mechanics only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  return {captures,ledger,market,coordinator,price,calls,records,get physical(){return physical;},route:(value:any)=>{adapter=value;},now:()=>at,advance:(ms:number)=>{at+=ms;},rentChanged:()=>{rentOffset++;},bumpSlot:()=>{slot++;},slot:()=>slot,setSlot:(value:number)=>{slot=value;},pause:(p:Promise<void>)=>{wait=p;},account:(address:string)=>accounts.get(address),replaceAccount:(address:string,wire:PoolWireAccount)=>{accounts.set(address,structuredClone(wire));},overrideInventory:(value:PilotInventory|null)=>{inventoryOverride=value;},onRpc:(hook:(method:string)=>void)=>{rpcHook=hook;},onPacingWait:(hook:(ms:number)=>void)=>{activity=hook;},onRecord:(hook:(kind:string)=>void)=>{recordHook=hook;},beforePreparationRead:(hook:(input:{method:string;signal:AbortSignal})=>Promise<void>)=>{preparationHook=hook;}};
}

for(const [background,fault]of [[0,null],[6,null],[9,null],[0,'scope'],[0,'certificate'],[0,'generation'],[0,'bucket']]as const)test(`committed actual decision quote after ${background} discretionary reads ${fault?'refuses changed '+fault:'uses certified priority over peer reservations'} and preserves holding reserves`,async t=>{
 const f=fixture(t,3000,false,true),owned=f.captures[0]!.proof.quote.mint,mint=f.captures[1]!.proof.quote.mint;
 const plan=await f.market.prepareEntryCosts(owned,signal()),entry=await f.market.quote({mint:owned,side:'buy',inputUnits:'10000000'},signal());assert.ok(entry);
 f.ledger.reconcile('seed-current',f.now(),f.price(),{});f.coordinator.reserve({id:'seed-held',side:'buy',mint:owned,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:entry.evidence},{price:f.price(),marks:{}});f.advance(1000);f.ledger.reconcile('seed-attempt-current',f.now(),f.price(),{});const seed=await f.coordinator.runDue();assert.equal(seed.results[0]?.status,'filled',JSON.stringify(seed));
 await f.market.prepareEntryCosts(mint,signal());f.advance(10000);
 const rpc=f.physical!,owner=new NativePaperWorkState(),entryAdmission=new NativePaperEntryAdmission(),engine=new NativeCandidateRunner({rpc,flow:{usage:()=>({dataContract:'confirmed-program-activity-v3-shadow',nativeServiceDeadlines:[{action:'support-refresh',deadlineAt:f.now()+60000}]})}as any,record(){},now:f.now});let lastCompleted:number|null=f.now(),entryToken:NativePaperEntryAdmissionToken|null=null,activeCertificate:NativeAuditCertificate|null=null,peerReserved=false;
 const ordinaryAdmission=engine.discretionaryAdmission.bind(engine);t.mock.method(engine,'discretionaryAdmission',(bound:number,at=f.now())=>{const value=ordinaryAdmission(bound,at);return peerReserved?{...value,admitted:false,latestStartAt:at-1,reason:'committed-native-or-candidate-deadline'}:value;});
 t.mock.method(engine,'currentAuditCertificate',(selected:string,at=f.now())=>activeCertificate&&selected===activeCertificate.mint&&at<=activeCertificate.deadlineAt&&Math.floor(at/10000)*10000===activeCertificate.windowEndAt?structuredClone(activeCertificate):null);
 const lowerView=(bound=1200)=>pilotLowerPriorityAdmission({now:f.now(),endAt:Number.MAX_SAFE_INTEGER,held:1,lastUsable:lastCompleted,nextPendingAt:null,operationBoundMs:bound});
 const sourceInformationAdmission=()=>true,sourceAdmission=()=>!(owner.current==='candidate'&&entryToken&&!entryAdmission.valid(entryToken,f.now()))&&nativePaperSourceWorkAdmission({informationOpen:sourceInformationAdmission(),owned:true,entryWork:owner.current==='candidate',entryStartsRemaining:owner.current==='candidate'&&entryToken?entryAdmission.remaining(entryToken,f.now()):undefined,usage:rpc.usage(),persistent:true});
 const localAdmission=(bound=1200)=>lowerView(bound).admitted&&engine.discretionaryAdmission(bound).admitted,optionalAdmission=(bound=1200)=>sourceAdmission()&&localAdmission(bound);
 const holder:any={},context:any={__name:(f:unknown)=>f,NativeProtectionDispatch,record(kind:string,data:unknown){f.records.push({kind,data:structuredClone(data)});},runId:'OFFLINE-current-certified-request-options',requestSequence:0,entryCertificate:null,candidateDiagnostic:(run:()=>unknown,fallback:unknown)=>{try{return run();}catch{return fallback;}},holder,currentLedger:f.ledger,workOwner:owner,currentRpc:rpc,service:true,Date:{now:f.now},endAt:Number.MAX_SAFE_INTEGER,stopped:false,lastCompleted,entryAdmission,entryToken,manifest:{controlCooldownUntil:0},PilotRpcUnavailable,nativePaperRequestOperationBound,nativePaperProtectionReadDeadline,nativePaperSourceWorkAdmission,lowerView,sourceAdmission,sourceInformationAdmission,optionalAdmission,engine};
 const text=runNativePaper.toString(),begin=text.search(/const\s+requestOptions\s*=/),rest=text.slice(begin),end=rest.search(/;\s*const\s+market\s*=/);assert.ok(begin>=0&&end>0);runInNewContext(rest.slice(0,end)+';holder.scheduled=scheduled;',context,{timeout:1000});f.route(holder.scheduled);
 const protect=async()=>{owner.set('protection');const marks=await f.market.context(f.ledger.state().positions,signal());assert.ok(marks.marks[owned]);lastCompleted=f.now();context.lastCompleted=lastCompleted;};await protect();
 owner.set('source');for(let n=0;n<background;n++){if(!lowerView(1500).admitted){await protect();owner.set('source');}await holder.scheduled.call('getSlot');}
 await protect();const before=f.ledger.state(),calls=f.calls.length,reserve=nativePaperManagementReserve(rpc.usage(),true,true,3);
 const windowEndAt=Math.floor(f.now()/10000)*10000;activeCertificate={schemaVersion:1,mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),dataContract:'confirmed-program-activity-v3-shadow',openedAt:windowEndAt-60000,connectionId:1,subscriptionId:1,windowStartAt:windowEndAt-60000,windowEndAt,auditAvailableAt:f.now(),admittedAt:f.now(),deadlineAt:windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:'a'.repeat(64)};context.entryCertificate=structuredClone(activeCertificate);
 entryToken=entryAdmission.begin({mint,at:f.now(),windowEndAt,deadlineAt:activeCertificate.deadlineAt,maximumAccountedStarts:3,fullyAdmitted:reserve.entryAllowed});context.entryToken=entryToken;owner.set('candidate');peerReserved=true;assert.equal(engine.discretionaryAdmission(1200).admitted,false);assert.equal(engine.financialAdmission(activeCertificate,1200).admitted,true);let invalidated=false;f.onPacingWait(()=>{if(!fault||invalidated)return;invalidated=true;if(fault==='scope')context.entryToken=null;else if(fault==='certificate')activeCertificate={...activeCertificate!,featuresSha256:'b'.repeat(64)};else if(fault==='generation')activeCertificate={...activeCertificate!,connectionId:2};else f.advance(activeCertificate!.deadlineAt-f.now()+1);});
 const quote=entryToken?await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()):null;
 assert.ok(entryToken);if(fault){assert.equal(quote,null);assert.equal(invalidated,true);assert.equal(f.calls.length,calls,'scope/current-certificate failure after pacing prevents physical invocation');assert.ok(f.records.some(r=>r.kind==='native-paper-request-admission-refused'));assert.deepEqual(f.ledger.state(),before);entryAdmission.close(entryToken);return;}assert.ok(quote,JSON.stringify(f.market.usage().entryQuoteFailures));assert.equal(f.calls.length-calls,3);assert.equal(entryAdmission.valid(entryToken,f.now()),true);assert.equal(entryAdmission.remaining(entryToken,f.now()),0);assert.equal(sourceAdmission(),true,'completed quote readiness needs no fresh whole-entry envelope');const remaining=nativePaperManagementReserve(rpc.usage(),true,true,entryAdmission.remaining(entryToken,f.now()));assert.equal(remaining.entryAllowed,true);assert.ok(remaining.rolling10SecondStartHeadroom!>=remaining.entryStartsRemaining!+remaining.protected10SecondStartReserve!);assert.ok(remaining.rollingStartHeadroom!>=remaining.entryStartsRemaining!+remaining.protectedMinuteStartReserve!);assert.equal(f.market.usage().entryQuoteFailures.count,0);entryAdmission.close(entryToken);
 assert.deepEqual(f.ledger.state(),before);t.diagnostic(JSON.stringify({scope:'OFFLINE actual SDK, held ledger inventory, NativeCandidateRunner deadlines, launcher router and shared PilotRpc; no independently qualified opportunity represented',background,quoteAvailable:quote!==null,reserve,failure:f.market.usage().entryQuoteFailures.last,providerRequests:0}));
});

test('fresh final market state remains usable under ancillary rent pacing and active native slot floors',async t=>{
 const f=fixture(t,3000,false,true),mint=f.captures[1]!.proof.quote.mint;
 await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state();let nextActivity=f.now()+400,activityCount=0;
 f.onPacingWait(()=>{while(f.now()>=nextActivity){nextActivity+=400;f.bumpSlot();f.market.minimumSlot(mint,f.slot());activityCount++;}});
 const begin=f.calls.length,q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());
 assert.ok(q);assert.ok(activityCount>0);assert.equal(f.calls.length-begin,3);assert.equal(q.slot,f.slot());assert.equal(q.at,f.now());assert.equal(f.market.usage().entryQuoteFailures.count,0);assert.deepEqual(f.ledger.state(),before);
 t.diagnostic(JSON.stringify({scope:'OFFLINE actual SDK/PilotMarket/PilotRpc paced calls and synthetic400ms native slot floors; not live-cause proof',result:q?'fresh quote':null,activityCount,calls:f.calls.slice(begin).map(c=>({method:c.method,at:c.at})),failure:f.market.usage().entryQuoteFailures.last,providerRequests:0}));
});

test('entry quote failure facts distinguish local admission, rent failure and unknown errors without retaining provider text',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state();
 f.onRpc(()=>{throw new PilotRpcUnavailable('COMPONENT_ADMISSION_CLOSED');});assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.market.usage().entryQuoteFailures.last?.phase,'rent');assert.equal(f.market.usage().entryQuoteFailures.last?.reasonCode,'PILOT_RPC_COMPONENT_ADMISSION_CLOSED');
 f.onRpc(method=>{if(method==='getMinimumBalanceForRentExemption')throw Error('PILOT_MARKET_RENT_UNAVAILABLE');});assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.market.usage().entryQuoteFailures.last?.phase,'rent');assert.equal(f.market.usage().entryQuoteFailures.last?.reasonCode,'PILOT_MARKET_RENT_UNAVAILABLE');
 f.onRpc(()=>{throw Error('https://private-provider.invalid/key=DO_NOT_RETAIN_THIS');});assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);const failures=f.market.usage().entryQuoteFailures;assert.equal(failures.count,3);assert.equal(failures.last?.reasonCode,'ENTRY_QUOTE_UNKNOWN');assert.match(failures.last?.unknownErrorSha256??'',/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify({failures,records:f.records.filter(r=>r.kind==='pilot-entry-quote-unavailable')}),/private-provider|DO_NOT_RETAIN_THIS/);assert.deepEqual(f.ledger.state(),before);
});

for(const callerAbort of [true,false])test(`entry quote ${callerAbort?'caller cancellation':'local timeout'} has one bounded fact and keeps the physical continuation owned`,async t=>{
 const f=fixture(t,20),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());let release!:()=>void;f.pause(new Promise<void>(r=>release=r));const controller=new AbortController(),pending=f.market.quote({mint,side:'buy',inputUnits:'10000000'},controller.signal);await Promise.resolve();await Promise.resolve();if(callerAbort)controller.abort();assert.equal(await pending,null);const failure=f.market.usage().entryQuoteFailures;assert.equal(failure.count,1);assert.equal(failure.last?.reasonCode,callerAbort?'ENTRY_QUOTE_CALLER_ABORTED':'ENTRY_QUOTE_TIMEOUT');assert.equal(f.market.retirementReady(),false);release();for(let n=0;n<16;n++)await Promise.resolve();assert.equal(f.market.usage().entryQuoteFailures.count,1,'late physical completion cannot duplicate the failure');assert.equal(f.market.retirementReady(),true);assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.ledger.state().positions,{});
});

test('fresh supported account lengths and current rent define deposits; every entry repeats rent checks',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;
  const plan=await f.market.prepareEntryCosts(mint,signal());
  assert.deepEqual(plan.accountLengths,{base:170,quote:165});
  assert.equal(plan.depositLamports,'2000335');assert.equal(plan.accountPlan.baseExists,false);assert.equal(plan.accountPlan.quoteExists,false);
  assert.deepEqual(f.calls.map(c=>c.method),['getMultipleAccounts','getMinimumBalanceForRentExemption','getMinimumBalanceForRentExemption']);
  const q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  assert.equal(q.requiredDepositLamports,plan.depositLamports);assert.match(q.depositEvidence!,/^pilot-entry-validated-costs:/);
  assert.equal(f.calls.length,6);assert.equal(q.outputUnits,f.captures[1]!.proof.quote.buy.outputBaseUnits);
  // A sizing plan can remain old, but every used quote still reads current rent.
  f.advance(10001);const newer=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(newer);assert.equal(newer.at,f.now());assert.equal(f.calls.length,9);
  f.rentChanged();assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);
  assert.equal(f.ledger.state().lockedDeposits[mint],undefined);assert.equal(Object.keys(f.ledger.state().positions).length,0);
});

function syntheticLegacyBase(f:ReturnType<typeof fixture>,capture:ReturnType<typeof fixture>['captures'][number]){
  // Explicit OFFLINE layout conversion; no historical mint-program change is
  // asserted. The real decoder and unsigned builder still validate every byte.
  const mint=new PublicKey(capture.proof.quote.mint),pool=canonicalPumpPoolPda(mint),oldVault=capture.state.addresses[5]as string,legacyVault=getAssociatedTokenAddressSync(mint,pool,true,TOKEN_PROGRAM_ID).toBase58();
  const poolWire=structuredClone(f.account(capture.state.addresses[0]))!,poolRaw=Buffer.from(poolWire.data[0],'base64');assert.ok(poolRaw.subarray(139,171).equals(new PublicKey(oldVault).toBuffer()));new PublicKey(legacyVault).toBuffer().copy(poolRaw,139);poolWire.data[0]=poolRaw.toString('base64');f.replaceAccount(capture.state.addresses[0],poolWire);
  const mintWire=structuredClone(f.account(mint.toBase58()))!;mintWire.owner=TOKEN_PROGRAM_ID.toBase58();mintWire.data[0]=Buffer.from(mintWire.data[0],'base64').subarray(0,82).toString('base64');f.replaceAccount(mint.toBase58(),mintWire);
  const vaultWire=structuredClone(f.account(oldVault))!;vaultWire.owner=TOKEN_PROGRAM_ID.toBase58();vaultWire.data[0]=Buffer.from(vaultWire.data[0],'base64').subarray(0,165).toString('base64');f.replaceAccount(legacyVault,vaultWire);
}

for(const legacy of [true,false])test(`current decision rent reuse removes ${legacy?1:2} duplicate rent calls and preserves original cost times with a fresh SDK quote`,async t=>{
  const f=fixture(t,1000,false,false,true,true),capture=f.captures[1]!,mint=capture.proof.quote.mint;if(legacy)syntheticLegacyBase(f,capture);
  const plan=await f.market.prepareEntryCosts(mint,signal()),before=f.ledger.state(),rentReads=f.calls.filter(c=>c.method==='getMinimumBalanceForRentExemption').length;assert.equal(rentReads,legacy?1:2);
  const originalAt=plan.at;f.advance(1500);f.bumpSlot();const begin=f.calls.length,q=await f.market.quote({mint,side:'buy',inputUnits:'50000000',requiredDepositLamports:plan.depositLamports},signal());assert.ok(q,JSON.stringify(f.market.usage().entryQuoteFailures));
  assert.equal(f.calls.length-begin,1);assert.equal(f.calls[begin]!.method,'getMultipleAccounts');assert.equal(f.calls.filter(c=>c.method==='getMinimumBalanceForRentExemption').length,rentReads);assert.equal(q.at,f.now());assert.ok(q.at>originalAt);assert.equal(q.slot,f.slot());assert.equal(q.inputUnits,'50000000');
  const costs=f.records.findLast(r=>r.kind==='rpc-market-quote')!.data.costs;assert.equal(costs.rentSource,'validated-entry-preparation');assert.equal(costs.preparationAt,originalAt);assert.deepEqual(costs.plan,plan.accountPlan);assert.deepEqual(costs.rentObservationsByBytes,plan.rentObservationsByBytes);assert.deepEqual(costs.rents,plan.rentLamportsByBytes);
  const constructed=f.records.findLast(r=>r.kind==='paper-unsigned-pumpswap')!.data.construction;assert.equal(constructed.networkRequests,0);assert.equal(constructed.sourceSlot,q.slot);assert.equal(constructed.expectedOutputUnits,q.outputUnits);assert.deepEqual(f.ledger.state(),before);
});

for(const fault of ['plan-age','earliest-rent-age','missing-observation','locked-inventory','different-deposit'])test(`prepared rent reuse refuses ${fault} before provider work without inline refresh`,async t=>{
  const f=fixture(t,3000,false,fault==='earliest-rent-age',false,true),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal()),before=f.ledger.state();
  if(fault==='plan-age')f.advance(10001);
  if(fault==='earliest-rent-age'){assert.ok(plan.rentObservationsByBytes![170]!.receivedAt<plan.at);f.advance(10000);assert.equal(f.now()-plan.at,10000);}
  if(fault==='missing-observation'){const stored=(f.market as any).plans.get(mint);delete stored.rentObservationsByBytes;}
  if(fault==='locked-inventory')f.overrideInventory({...before,lockedDeposits:{...before.lockedDeposits,[mint]:'1'}});
  const calls=f.calls.length,q=await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:fault==='different-deposit'?'1':plan.depositLamports},signal());assert.equal(q,null);assert.equal(f.calls.length,calls);assert.deepEqual(f.ledger.state(),before);assert.equal(f.records.some(r=>r.kind==='rpc-market-quote'),false);
});

for(const fault of ['generation','plan-replaced','layout','cost-expired-during-quote'])test(`prepared rent reuse rejects ${fault} after source work without an extra request`,async t=>{
  const f=fixture(t,1000,false,false,false,true),capture=f.captures[1]!,mint=capture.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal()),before=f.ledger.state();
  if(fault==='layout')syntheticLegacyBase(f,capture);
  if(fault==='cost-expired-during-quote')f.advance(9900);
  f.onRecord(kind=>{if(kind!=='research-clock-buy-quote')return;if(fault==='generation')f.market.invalidate('OFFLINE source gap');if(fault==='plan-replaced'){const stored=(f.market as any).plans.get(mint);(f.market as any).plans.set(mint,{...stored,evidence:'OFFLINE replacement preparation'});}if(fault==='cost-expired-during-quote')f.advance(101);});
  const calls=f.calls.length,q=await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:plan.depositLamports},signal());assert.equal(q,null);assert.equal(f.calls.length-calls,1);assert.equal(f.calls.at(-1)!.method,'getMultipleAccounts');assert.deepEqual(f.ledger.state(),before);
});

test('prepared decision rent never replaces fresh post-delay rent or accepts a changed execution deposit',async t=>{
  const f=fixture(t,1000,false,false,false,true),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  f.coordinator.reserve({id:'reuse-costs-landing',side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},{price:f.price(),marks:{}});f.advance(1000);
  const order=f.ledger.state().pending['reuse-costs-landing']!,before=f.ledger.state(),calls=f.calls.length,ready=await f.market.executionQuote({order,attemptedAt:f.now(),fullPositionBaseUnits:null},signal());assert.ok(ready);assert.deepEqual(f.calls.slice(calls).map(c=>c.method),['getMinimumBalanceForRentExemption','getMinimumBalanceForRentExemption','getMultipleAccounts']);
  const costs=f.records.findLast(r=>r.kind==='rpc-market-quote')!.data.costs;assert.equal(costs.rentSource,'fresh-quote-rent');assert.ok(Object.values(costs.rentObservationsByBytes).every((r:any)=>r.receivedAt>=order.executeAt));
  f.rentChanged();const changed=f.calls.length;assert.equal(await f.market.executionQuote({order,attemptedAt:f.now(),fullPositionBaseUnits:null},signal()),null);assert.equal(f.calls.length-changed,2);assert.deepEqual(f.ledger.state(),before);
});

test('real decoder quotes complete a disposable delayed buy and full-size exit with rent retained once',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,initial=f.ledger.state();
  const plan=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  const order={id:'buy:fixture',side:'buy' as const,mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:q.outputUnits,decisionEvidence:q.evidence};
  f.coordinator.reserve(order,{price:f.price(),marks:{}});
  // No pre-delay fill and no use of the original estimate as future execution.
  assert.equal(await f.market.executionQuote({order:f.ledger.state().pending[order.id]!,attemptedAt:f.now(),fullPositionBaseUnits:null},signal()),null);
  const before=f.calls.length;f.advance(1000);const filled=await f.coordinator.runDue();assert.equal(filled.results[0]!.status,'filled');assert.equal(f.calls.length-before,3);
  const position=f.ledger.state().positions[mint]!;assert.equal(position.units,q.outputUnits);assert.equal(position.deposit,plan.depositLamports);assert.equal(f.ledger.state().lockedDeposits[mint],plan.depositLamports);
  const context=await f.market.context(f.ledger.state().positions,signal()),sell=await f.market.quote({mint,side:'sell',inputUnits:position.units},signal());assert.ok(sell);
  assert.equal(context.marks[mint]!.netLamports,(BigInt(sell.outputUnits)-7000n).toString());assert.equal(sell.refundedDepositLamports,undefined);
  f.coordinator.reserve({id:'sell:fixture',side:'sell',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:sell.outputUnits,decisionEvidence:sell.evidence},context);
  const beforeExit=f.calls.length;f.advance(1000);const exited=await f.coordinator.runDue();assert.equal(exited.results[0]!.status,'filled');assert.equal(f.calls.length-beforeExit,1);
  const end=f.ledger.state();assert.deepEqual(end.positions,{});assert.deepEqual(end.pending,{});assert.equal(end.executionCosts,'14000');assert.equal(end.lockedDeposits[mint],plan.depositLamports);
  const pnl=BigInt(sell.outputUnits)-10000000n-14000n;
  assert.equal(end.realizedLamports,pnl.toString());assert.equal(BigInt(end.lamports)+BigInt(end.lockedDeposits[mint]!)-BigInt(initial.lamports),pnl);assert.equal(end.inceptionAt,initial.inceptionAt);
  const beforeExisting=f.calls.length,existing=await f.market.prepareEntryCosts(mint,signal());assert.equal(existing.depositLamports,'0');assert.equal(existing.accountPlan.baseExists,true);assert.equal(existing.accountPlan.quoteExists,true);assert.equal(f.calls.length-beforeExisting,0,'unchanged generation/layout facts need no new provider read');
});

test('changed rent, unknown account plan, cancellation and invalidation refuse entry without changing account',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,before=f.ledger.state();
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,0);
  await f.market.prepareEntryCosts(mint,signal());f.market.invalidate('isolated gap; existing account unchanged');const count=f.calls.length;
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,count);
  const controller=new AbortController();controller.abort();assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},controller.signal),null);
  assert.deepEqual(f.ledger.state(),before);
  // Concurrent context cannot create a second physical read behind preparation.
  let release!:()=>void;f.pause(new Promise<void>(resolve=>{release=resolve;}));const pending=f.market.prepareEntryCosts(mint,signal());await Promise.resolve();const during=f.calls.length;
  assert.deepEqual(await f.market.context({},signal()),{price:null,marks:{}});assert.equal(f.calls.length,during);f.market.invalidate('gap during preparation');release();await assert.rejects(pending,/PREPARATION_CHANGED_OR_STALE/);assert.deepEqual(f.ledger.state(),before);
});

test('post-delay buy source carries its actual slot and refuses changed rent or delayed evidence',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  f.coordinator.reserve({id:'due-buy',side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},{price:f.price(),marks:{}});
  f.advance(1000);const order=f.ledger.state().pending['due-buy']!,before=f.ledger.state();
  const request=()=>({order,attemptedAt:f.now(),fullPositionBaseUnits:null,minSlot:q.slot});
  const ready=await f.market.executionQuote(request(),signal());assert.ok(ready);assert.equal(ready.slot,q.slot);assert.equal(ready.requiredDepositLamports,order.deposit);assert.match(ready.depositEvidence!,/^pilot-execution-validated-costs:/);
  f.onRecord(kind=>{if(kind==='research-held-market-delegated-entry')f.advance(2001);});
  assert.equal(await f.market.executionQuote(request(),signal()),null);assert.deepEqual(f.ledger.state(),before);
  f.onRecord(()=>{});f.rentChanged();assert.equal(await f.market.executionQuote(request(),signal()),null);assert.deepEqual(f.ledger.state(),before);
});

test('a newer known flow slot arriving during entry pricing prevents an older result from being used',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;
  const plan=await f.market.prepareEntryCosts(mint,signal());let release!:()=>void;
  f.pause(new Promise<void>(resolve=>{release=resolve;}));
  const pending=f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());await Promise.resolve();await Promise.resolve();
  f.market.minimumSlot(mint,plan.sourceSlot+1);release();assert.equal(await pending,null);
  assert.equal(Object.keys(f.ledger.state().positions).length,0);
});


test('candidate-only support uses unchanged current state validation without rent or an entry plan',async t=>{
  const f=fixture(t),capture=f.captures[1]!,mint=capture.proof.quote.mint,before=f.ledger.state();
  const result=await f.market.validateObservationPool(mint,signal());
  assert.equal(result.mint,mint);assert.equal(result.sourceSlot,capture.state.context.slot);assert.equal(result.at,f.now());assert.match(result.evidence,/^pilot-observation-support:/);
  assert.deepEqual(f.calls.map(c=>c.method),['getMultipleAccounts','getMultipleAccounts','getBlockTime']);
  assert.equal(f.records.filter(r=>r.kind==='pilot-entry-cost-preparation').length,0);
  assert.equal(f.records.filter(r=>r.kind==='pilot-observation-support-validation').length,1);
  const calls=f.calls.length;
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null,'observation proof cannot substitute for a financial deposit plan');
  assert.equal(f.calls.length,calls);assert.deepEqual(f.ledger.state(),before);
});

test('candidate-only support retains mint, pool, vault and fee-owner checks',async t=>{
  const f=fixture(t),capture=f.captures[1]!,mint=capture.proof.quote.mint;
  // The selected address indices are the retained decoder's pool/config/fee/
  // mint/quote-mint/base-vault/quote-vault dependency order.
  for(const index of [0,2,3,5]){
    const address=capture.state.addresses[index]!,wire=f.account(address)!;assert.ok(wire);
    const owner=wire.owner;wire.owner='11111111111111111111111111111111';
    await assert.rejects(f.market.validateObservationPool(mint,signal()));wire.owner=owner;
  }
  assert.equal(f.calls.some(c=>c.method==='getMinimumBalanceForRentExemption'),false);
  assert.equal(f.records.some(r=>r.kind==='pilot-observation-support-validation'),false);
});

test('candidate-only support refuses stale records, invalidation, newer slot floors and cancellation',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;
  f.onRecord(kind=>{if(kind==='size-specific-quote')f.advance(2001);});
  await assert.rejects(f.market.validateObservationPool(mint,signal()),/PREPARATION_CHANGED_OR_STALE/);
  f.onRecord(kind=>{if(kind==='size-specific-quote')f.market.invalidate('candidate support changed during validation');});
  await assert.rejects(f.market.validateObservationPool(mint,signal()),/PREPARATION_CHANGED_OR_STALE/);
  f.onRecord(kind=>{if(kind==='size-specific-quote')f.market.minimumSlot(mint,f.captures[1]!.state.context.slot+1);});
  await assert.rejects(f.market.validateObservationPool(mint,signal()),/PREPARATION_CHANGED_OR_STALE/);
  f.onRecord(()=>{});const controller=new AbortController();controller.abort();const calls=f.calls.length;
  await assert.rejects(f.market.validateObservationPool(mint,controller.signal),/PREPARATION_UNAVAILABLE/);assert.equal(f.calls.length,calls);
  assert.equal(f.calls.some(c=>c.method==='getMinimumBalanceForRentExemption'),false);
});


test('coherent entry preparation and quote leave held dependency links warm and read every rent again',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal());
  const before=f.calls.length;await f.market.context({},signal());
  const quote=await f.market.quote({mint,side:'buy',inputUnits:'50000000',requiredDepositLamports:plan.depositLamports},signal());assert.ok(quote);
  assert.equal(f.calls.length-before,3);assert.equal(quote.inputUnits,'50000000');assert.equal(quote.requiredDepositLamports,plan.depositLamports);
  assert.equal(f.calls.filter(c=>c.method==='getMinimumBalanceForRentExemption').length,4);
  assert.equal(f.calls.some(c=>c.method==='getBlockTime'),false);
  const source=f.records.findLast(r=>r.kind==='rpc-market-quote')!.data.source;
  assert.equal(source.timeEvidence,'confirmed-bank-clock');assert.equal(source.clockSlot,quote.slot);assert.equal('marketBlockTime' in source,false);
});

test('a slow final recorder cannot refresh an earlier Clock buy into a valid decision or change accounting',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state();
  f.onRecord(kind=>{if(kind==='rpc-market-quote')f.advance(2001);});
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.deepEqual(f.ledger.state(),before);
});

test('a timed-out uncooperative buy read retains market ownership until physical work settles',async t=>{
  const f=fixture(t,20),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());
  let release!:()=>void;f.pause(new Promise<void>(r=>{release=r;}));
  const pending=f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.equal(await pending,null);
  const calls=f.calls.length;assert.deepEqual(await f.market.context({},signal()),{price:null,marks:{}});
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,calls);
  assert.throws(()=>f.market.unregisterPool(mint),/READ_IN_FLIGHT/);release();await new Promise<void>(r=>setImmediate(r));
  assert.ok(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()));
});

test('entry preparation can yield between real SDK reads to fresh whole-inventory pricing without reentrant entry work',async t=>{
  const f=fixture(t,1000,true),block=signal();
  for(const [i,c]of f.captures.entries()){
    const mint=c.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,block),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},block);assert.ok(q);
    const prior=await f.market.context(f.ledger.state().positions,block);
    f.coordinator.reserve({id:'yield-buy:'+i,side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},prior);
    f.advance(1000);assert.equal((await f.coordinator.runDue()).results[0]!.status,'filled');
  }
  const inventory=f.ledger.state().positions;assert.equal(Object.keys(inventory).length,2);f.advance(10001);
  await f.market.context(inventory,block);const before=structuredClone(f.ledger.state()),seen:string[]=[];
  f.beforePreparationRead(async({method,signal})=>{
    seen.push(method);f.advance(1000);const calls=f.calls.length,current=await f.market.context(inventory,signal);
    assert.equal(f.calls.length-calls,1,'both actual-size holdings use one warm coherent batch');
    for(const [mint,p]of Object.entries(inventory)){assert.equal(current.marks[mint]!.pricedBaseUnits,p.units);assert.equal(current.marks[mint]!.at,f.now());}
    assert.equal(await f.market.quote({mint:f.captures[0]!.proof.quote.mint,side:'buy',inputUnits:'1'},signal),null,'yield does not grant a concurrent entry read');
  });
  await f.market.prepareEntryCosts(f.captures[0]!.proof.quote.mint,block);
  assert.ok(seen.length>=1);assert.deepEqual(f.ledger.state(),before,'pricing/yield never creates an order or changes financial state');
  const yields=seen.length;assert.ok(await f.market.quote({mint:f.captures[0]!.proof.quote.mint,side:'buy',inputUnits:'10000000'},block));
  assert.equal(seen.length,yields,'decision/execution entry quotes cannot reenter a trader protection tick through the preparation hook');
});

test('whole preparation timeout retains uncooperative physical ownership and cannot publish a late plan',async t=>{
  const f=fixture(t,25),mint=f.captures[1]!.proof.quote.mint;let release!:()=>void;
  f.pause(new Promise<void>(resolve=>{release=resolve;}));
  await assert.rejects(f.market.prepareEntryCosts(mint,signal(),{maximumMs:20}),/PREPARATION_ABORTED/);
  assert.equal(f.market.retirementReady(),false);
  const calls=f.calls.length;assert.throws(()=>f.market.unregisterPool(mint),/READ_IN_FLIGHT/);
  await assert.rejects(f.market.prepareEntryCosts(mint,signal()),/PREPARATION_UNAVAILABLE/);
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,calls);
  release();await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(f.market.retirementReady(),true);
  assert.equal(f.market.usage().preparedEntryCostPlans,0,'late settled work cannot become a usable plan');
  const plan=await f.market.prepareEntryCosts(mint,signal(),{maximumMs:1000});assert.ok(plan);assert.equal(f.market.usage().preparedEntryCostPlans,1);
  assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});
});

test('cancellation at a preparation yield prevents the next physical request and cannot create a plan',async t=>{
 const f=fixture(t,1000,true),controller=new AbortController(),mint=f.captures[1]!.proof.quote.mint,before=f.ledger.state();
 f.beforePreparationRead(async()=>{controller.abort();});
 await assert.rejects(f.market.prepareEntryCosts(mint,controller.signal),/PREPARATION_ABORTED|aborted/);
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,0);assert.equal(f.market.retirementReady(),true);assert.equal(f.market.usage().preparedEntryCostPlans,0);assert.deepEqual(f.ledger.state(),before);
});

test('an unrelated candidate bank cannot raise a holding slot floor; the holding own known floor remains mandatory',async t=>{
  const f=fixture(t),mint=f.captures[0]!.proof.quote.mint,other=f.captures[1]!.proof.quote.mint,block=signal();
  const plan=await f.market.prepareEntryCosts(mint,block),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},block);assert.ok(q);
  f.coordinator.reserve({id:'bank-separated-buy',side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},{price:f.price(),marks:{}});
  f.advance(1000);assert.equal((await f.coordinator.runDue()).results[0]!.status,'filled');
  const inventory=f.ledger.state().positions,heldSlot=f.slot();assert.ok((await f.market.context(inventory,block)).marks[mint]);
  f.setSlot(heldSlot+100);await f.market.prepareEntryCosts(other,block);assert.equal(f.market.usage().entryPricing.highestVerifiedSlot,heldSlot+100);
  // Synthetic independently responding banks: holding data is no older than
  // any fact previously accepted for THIS holding and keeps a fresh Clock.
  f.setSlot(heldSlot);const context=await f.market.context(inventory,block);assert.equal(context.marks[mint]!.pricedBaseUnits,inventory[mint]!.units);
  assert.equal(f.market.usage().held.highestVerifiedSlot,heldSlot);
  f.market.minimumSlot(mint,heldSlot+1);assert.deepEqual((await f.market.context(inventory,block)).marks,{});
  assert.equal(f.market.usage().holdingDiagnostics.lastContext!.reasonCode,'HELD_PRICING_SLOT_UNAVAILABLE');
});

for(const realism of [false,true])test(`smaller actual entry reuses one fresh SDK batch and original proof times without provider reads (${realism?'unsigned construction':'quote'})`,async t=>{
 const f=fixture(t,1000,false,false,realism),mint=f.captures[1]!.proof.quote.mint;
 const deposit=await f.market.prepareEntryCosts(mint,signal()),baseline=await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:deposit.depositLamports},signal());assert.ok(baseline);
 const before=f.ledger.state(),calls=f.calls.length,sourceAt=baseline.at;
 f.advance(200);
 // PaperTrader deliberately returns a cleaned quote without the request's slot
 // floor; the actual public proof fields must still match the owned baseline.
 const {minSlot:ignored,...original}=baseline;
 const smaller=await f.market.repriceEntryQuote({mint,side:'buy',inputUnits:'5000000',requiredDepositLamports:deposit.depositLamports,minSlot:baseline.slot},original,signal());
 assert.ok(smaller,JSON.stringify(f.market.usage().entryQuoteFailures));assert.equal(f.calls.length,calls,'same-state sizing adds no rent, reserve or RPC reads');
 assert.equal(smaller.at,sourceAt);assert.equal(smaller.slot,baseline.slot);assert.notEqual(smaller.evidence,baseline.evidence);assert.equal(smaller.inputUnits,'5000000');assert.ok(BigInt(smaller.outputUnits)<BigInt(baseline.outputUnits));
 assert.equal(smaller.liquidityResilience?.buyInputLamports,smaller.inputUnits);assert.equal(smaller.liquidityResilience?.expectedBaseUnits,smaller.outputUnits);assert.equal(smaller.liquidityResilience?.at,sourceAt);assert.equal(smaller.requiredDepositLamports,deposit.depositLamports);
 const fact=f.records.find(r=>r.kind==='pilot-entry-local-reprice')!.data;assert.equal(fact.providerRequests,0);assert.equal(fact.parentQuoteEvidence,baseline.evidence);assert.equal(Date.parse(fact.source.receivedAt),sourceAt);assert.equal(fact.sourceTimestampUnchanged,true);
 if(realism){const built=f.records.filter(r=>r.kind==='paper-unsigned-pumpswap').at(-1)!.data;assert.equal(built.quoteEvidence,smaller.evidence);assert.equal(built.construction.inputUnits,smaller.inputUnits);assert.equal(built.construction.expectedOutputUnits,smaller.outputUnits);assert.equal(built.construction.receivedAt,fact.source.receivedAt);assert.equal(built.construction.networkRequests,0);}
 assert.deepEqual(f.ledger.state(),before);
 // An independent fresh call over the unchanged retained pool verifies that
 // the selected SDK result is exact, rather than proportional output scaling.
 const fresh=await f.market.quote({mint,side:'buy',inputUnits:'5000000',requiredDepositLamports:deposit.depositLamports},signal());assert.ok(fresh);assert.equal(smaller.outputUnits,fresh.outputUnits);assert.equal(smaller.liquidityResilience?.buyCurveInputLamports,fresh.liquidityResilience?.buyCurveInputLamports);
});

test('tiny executable local sizing has no arbitrary input floor and retains full SDK construction checks',async t=>{
 const f=fixture(t,1000,false,false,true),mint=f.captures[1]!.proof.quote.mint,deposit=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:deposit.depositLamports},signal());assert.ok(q);
 const before=f.ledger.state(),calls=f.calls.length,tiny=await f.market.repriceEntryQuote({mint,side:'buy',inputUnits:'10',requiredDepositLamports:deposit.depositLamports},q,signal());
 assert.ok(tiny,JSON.stringify(f.market.usage().entryQuoteFailures));assert.equal(tiny.inputUnits,'10');assert.ok(BigInt(tiny.outputUnits)>0n);assert.equal(f.calls.length,calls);assert.equal(tiny.at,q.at);assert.equal(tiny.slot,q.slot);assert.deepEqual(f.ledger.state(),before);
 const constructed=f.records.filter(r=>r.kind==='paper-unsigned-pumpswap').at(-1)!.data.construction;assert.equal(constructed.inputUnits,'10');assert.equal(constructed.expectedOutputUnits,tiny.outputUnits);assert.equal(constructed.networkRequests,0);
 assert.equal(await f.market.repriceEntryQuote({mint,side:'buy',inputUnits:'0',requiredDepositLamports:deposit.depositLamports},tiny,signal()),null);assert.equal(f.calls.length,calls);assert.deepEqual(f.ledger.state(),before);
});

for(const fault of ['stale','raised-floor','aborted','plan-changed','cross-mint','tampered-output','oversize','invalidated']as const)test(`local entry reprice refuses ${fault} without new provider work or financial changes`,async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,deposit=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:deposit.depositLamports},signal());assert.ok(q);
 let request={mint,side:'buy' as const,inputUnits:'5000000',requiredDepositLamports:deposit.depositLamports},original={...q};const controller=new AbortController();
 if(fault==='stale')f.advance(2001);
 if(fault==='raised-floor')f.market.minimumSlot(mint,q.slot!+1);
 if(fault==='aborted')controller.abort();
 if(fault==='plan-changed'){f.advance(1);await f.market.prepareEntryCosts(mint,signal());}
 if(fault==='cross-mint')request={...request,mint:f.captures[0]!.proof.quote.mint};
 if(fault==='tampered-output')original={...original,outputUnits:(BigInt(q.outputUnits)+1n).toString()};
 if(fault==='oversize')request={...request,inputUnits:'10000001'};
 if(fault==='invalidated')f.market.invalidate('OFFLINE local state replacement');
 const before=f.ledger.state(),calls=f.calls.length;
 assert.equal(await f.market.repriceEntryQuote(request,original,controller.signal),null);assert.equal(f.calls.length,calls);assert.deepEqual(f.ledger.state(),before);assert.equal(f.market.retirementReady(),true);
 assert.equal(f.market.usage().entryQuoteFailures.last?.phase,'local-reprice');
});

for(const fault of ['raised-floor','aborted','stale']as const)test(`local entry reprice rechecks ${fault} after unsigned construction callbacks`,async t=>{
 const f=fixture(t,1000,false,false,true),mint=f.captures[1]!.proof.quote.mint,deposit=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:deposit.depositLamports},signal());assert.ok(q);
 const before=f.ledger.state(),calls=f.calls.length,controller=new AbortController();
 f.onRecord(kind=>{if(kind!=='paper-unsigned-pumpswap')return;if(fault==='raised-floor')f.market.minimumSlot(mint,q.slot!+1);else if(fault==='aborted')controller.abort();else f.advance(2001);});
 assert.equal(await f.market.repriceEntryQuote({mint,side:'buy',inputUnits:'5000000',requiredDepositLamports:deposit.depositLamports},q,controller.signal),null);
 assert.equal(f.calls.length,calls);assert.deepEqual(f.ledger.state(),before);assert.equal(f.market.usage().entryQuoteFailures.last?.phase,'local-reprice');
 assert.equal(f.market.usage().entryQuoteFailures.last?.reasonCode,fault==='aborted'?'ENTRY_QUOTE_CALLER_ABORTED':'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');
});


test('slow ancillary preparation retains original stable facts and acquires executable state only afterward',async t=>{
 const f=fixture(t,3000,false,false,false,true),mint=f.captures[1]!.proof.quote.mint,started=f.now(),before=f.ledger.state();let rents=0;
 f.onRpc(method=>{if(method==='getMinimumBalanceForRentExemption'){rents++;f.advance(1200);f.bumpSlot();}});
 const plan=await f.market.prepareEntryCosts(mint,signal(),{maximumMs:5000});assert.equal(rents,2);assert.equal(f.now()-started,2400);assert.equal(plan.layout!.receivedAt,new Date(started).toISOString());assert.equal(plan.at,f.now());assert.equal(plan.rentObservationsByBytes![170]!.receivedAt,started+1200);assert.equal(plan.rentObservationsByBytes![165]!.receivedAt,started+2400);
 const count=f.calls.length,q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q,JSON.stringify(f.market.usage().entryQuoteFailures));assert.equal(f.calls.length-count,1);assert.equal(f.calls.at(-1)!.method,'getMultipleAccounts');assert.equal(q.at,f.now());assert.ok(q.slot!>plan.sourceSlot);assert.deepEqual(f.ledger.state(),before);
 const source=f.records.findLast(r=>r.kind==='rpc-market-quote')!.data.source;assert.equal(source.receivedAt,new Date(f.now()).toISOString());assert.ok(Date.parse(source.receivedAt)>Date.parse(plan.layout!.receivedAt));
});

test('stable preparation reuse retains original program/layout/rent provenance and is revoked by current layout change',async t=>{
 const f=fixture(t,3000,false,false,false,true),capture=f.captures[1]!,mint=capture.proof.quote.mint,first=await f.market.prepareEntryCosts(mint,signal());f.advance(1500);const before=f.calls.length,second=await f.market.prepareEntryCosts(mint,signal());assert.equal(f.calls.length,before);assert.deepEqual(second.layout,first.layout);assert.deepEqual(second.rentObservationsByBytes,first.rentObservationsByBytes);
 syntheticLegacyBase(f,capture);assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.market.usage().entryQuoteFailures.last!.reasonCode,'POOL_LINKS_CHANGED');const fresh=await f.market.prepareEntryCosts(mint,signal());assert.notEqual(fresh.layout!.tokenProgram,first.layout!.tokenProgram);assert.equal(fresh.accountLengths.base,165);assert.ok(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()));
});

test('a locally deferred stable preparation resumes completed facts without renewing their original validity',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;let rent=0;f.onRpc(method=>{if(method==='getMinimumBalanceForRentExemption'&&++rent===2)throw new PilotRpcUnavailable('COMPONENT_ADMISSION_CLOSED');});await assert.rejects(f.market.prepareEntryCosts(mint,signal()),/COMPONENT_ADMISSION_CLOSED/);
 const layoutAt=f.calls[0]!.at,firstRentAt=f.calls[1]!.at,count=f.calls.length;f.advance(500);f.onRpc(()=>{});const recovered=await f.market.prepareEntryCosts(mint,signal());assert.equal(f.calls.length-count,1);assert.equal(f.calls.at(-1)!.method,'getMinimumBalanceForRentExemption');assert.equal(Date.parse(recovered.layout!.receivedAt),layoutAt);assert.equal(recovered.rentObservationsByBytes![170]!.receivedAt,firstRentAt);
 f.advance(10001);const old=f.calls.length;await f.market.prepareEntryCosts(mint,signal());assert.equal(f.calls.length-old,3,'expired stable facts require fresh layout and both rents');
});


test('stable preparation policy permits only a bounded five-second cooperative aggregate, never a longer quote',async t=>{
 assert.equal(PILOT_ENTRY_PREPARATION_POLICY.maximumAggregateMs,5000);assert.equal(PILOT_ENTRY_PREPARATION_POLICY.stableReuseMaxAgeMs,10000);const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,before=f.calls.length;await assert.rejects(f.market.prepareEntryCosts(mint,signal(),{maximumMs:5001}),/PREPARATION_BOUND_REQUIRED/);assert.equal(f.calls.length,before);
});


test('a candidate capture reset revokes stable reuse and in-flight preparation without creating financial actions',async t=>{
 const f=fixture(t,3000,false,false,false,true),mint=f.captures[1]!.proof.quote.mint;for(let i=0;i<1000;i++)f.market.invalidateEntryPreparation('OFFLINE-unregistered-'+i);assert.equal((f.market as any).preparationEpochs.size,0,'broad unregistered gaps do not create retained preparation identities');await f.market.prepareEntryCosts(mint,signal());f.market.invalidateEntryPreparation(mint);const before=f.calls.length;assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,before);const replacement=await f.market.prepareEntryCosts(mint,signal());assert.equal(replacement.layout!.preparationEpoch,1);assert.equal(f.calls.length-before,3);
 f.market.invalidateEntryPreparation(mint);let release!:()=>void;f.pause(new Promise<void>(r=>release=r));const inFlight=f.market.prepareEntryCosts(mint,signal());await Promise.resolve();await Promise.resolve();f.market.invalidateEntryPreparation(mint);release();await assert.rejects(inFlight,/PREPARATION_CHANGED_OR_STALE/);assert.deepEqual(f.ledger.state().pending,{});
});


test('candidate capture reset retains a reserved financial order and permits its independently fresh post-delay execution pricing',async t=>{
 const f=fixture(t,3000,false,false,false,true),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
 f.coordinator.reserve({id:'OFFLINE retained pending after capture gap',side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},{price:f.price(),marks:{}});const order=Object.values(f.ledger.state().pending)[0]!;assert.ok(order);f.market.invalidateEntryPreparation(mint);f.advance(1000);const before=f.ledger.state(),priced=await f.market.executionQuote({order,attemptedAt:f.now(),fullPositionBaseUnits:null},signal());assert.ok(priced);assert.equal(priced.at,f.now());assert.equal(priced.requiredDepositLamports,order.deposit);assert.deepEqual(f.ledger.state(),before,'pricing never cancels, replaces or fabricates the reserved financial action');
});
