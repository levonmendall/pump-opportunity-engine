/** Offline progressive concurrency mechanics, not the live pilot's max-one
 * policy. Historical account bytes share an explicitly synthetic bank context;
 * retained trade delivery is re-timed only inside this disposable fixture. */
import {after,test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {ComponentBudget} from '../src/component-budget.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {ResearchHeldMarket} from '../src/research-held-market.js';
import {RpcMarket} from '../src/rpc-market.js';
import {chooseProtectedResearchWork,type ResearchJob} from '../src/research-dispatch.js';
import {ActivePipeline} from '../src/active-pipeline.js';
import type {ReadOnlyRpc} from '../src/network.js';
import type {PoolWireAccount} from '../src/pool.js';
import {simulateSharedScheduler,assessProposedTiming,PROPOSED_TIMING_STANDARD,type SimulatedJob} from '../scripts/evaluate-shared-scheduler.js';

const runs=['2026-10-26T19-57-35.882Z','2026-10-26T19-42-16.130Z','2026-10-26T23-32-41.255Z'];
const retained=runs.map(run=>{
  const proofPath=`evidence/integration-proof-${run}.json`,statePath=`evidence/integration-${run}.ndjson`;
  const proof=JSON.parse(readFileSync(proofPath,'utf8')),rows=readFileSync(statePath,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  return {proofPath,statePath,proof,state:rows.find(row=>row.kind==='pool-state').data};
});
const capturePath='evidence/overnight-20261027/07-field/capture.json',capture=JSON.parse(readFileSync(capturePath,'utf8'));
const payloadPath='evidence/overnight-20261027/07-field/observations.ndjson';
const payloadRow=readFileSync(payloadPath,'utf8').trim().split('\n').map(line=>JSON.parse(line)).find(row=>row.kind==='selected-pumpapi-payload');
const payload=JSON.parse(payloadRow.data.payloadUtf8),transaction=capture.enrichmentTransactions[payload.signature];
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const startedMono=performance.now(),cpuStart=process.cpuUsage();
const evidence:Record<string,unknown>={schemaVersion:1,classification:'OFFLINE_DISPOSABLE_CONCURRENCY_AND_COUNTERFACTUAL_TIMING_ONLY',networkRequests:0,productionChanged:false,livePilotSettingsChanged:false,authoritativeAccountAccessed:false,acceptanceClockStarted:false,limitations:[
  'Three different historical pools are assigned a synthetic common Clock/context only for decoder and financial-interface mechanics; this is not a live three-pool observation.',
  'The candidate transaction is retained natural executed evidence, delivered at synthetic test times. It does not create a natural qualifying window, entry or performance result.',
  'Simulation operation durations and jitter are declared synthetic inputs. A single batched holding read prices three positions in the fixture, but its live three-pool service time is unverified.',
  'The existing proposed four-second completion envelope is an assessment label, not production acceptance or a stop-price guarantee. The two-second reference target and quote-age-at-use requirement remain reported separately.',
  'Candidate suspension invalidates its complete window. Financial positions, pending actions and owner identity survive independently.',
  'No source, risk limit, live pilot max-one setting, production observer, Render account, prior grant or counter is modified.'
]};

function fixture(t:TestContext,id:string){
  const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-concurrency-')),path=join(directory,'fixture.sqlite');
  let at=capture.closedAt+60000,ledger=new DisposableLedger(path,id),slot=Math.max(...retained.map(r=>r.state.context.slot),...capture.executedEvidence.map((row:any)=>row.slot));
  const inceptionAt=at,oldNow=Date.now;Date.now=()=>at;
  const accounts=new Map<string,PoolWireAccount>();
  for(const r of retained)for(let i=0;i<r.state.addresses.length;i++)accounts.set(r.state.addresses[i],structuredClone(r.state.value[i]));
  const records:Array<{kind:string;data:any}>=[],physical:Array<{at:number;method:string;addresses:string[]|null;inFlight:number}>=[];
  const recorder={record(kind:string,data:unknown){records.push({kind,data:structuredClone(data)});}};
  const budget=new ComponentBudget({statePath:join(directory,'budget.json'),grantId:id,baseline:{calls:0,bytes:0,starts:[],refusal:'RPC_HTTP_429',refusalAt:at-60000,sha256:'f'.repeat(64)},startedAt:at,totalMs:180000,limits:{minSpacingMs:250,maxStartsPerMinute:60,maxStartsPer10s:10,maxNewUnits:100,maxCumulativeUnits:null},now:()=>at,monotonic:()=>at-inceptionAt,sleep:async ms=>{at+=ms;},record:recorder.record});
  let latestStartAt:number|undefined;
  const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal):Promise<T>{
    return budget.operate({transport:'http',method},async operation=>{
      physical.push({at,method,addresses:method==='getMultipleAccounts'?[...(params[0]as string[])]:null,inFlight:budget.inFlight});
      at+=80;let result:unknown;
      if(method==='getBlockTime')result=Math.floor(at/1000);
      else if(method==='getTransaction'){assert.equal(params[0],payload.signature);result=structuredClone(transaction);}
      else{
        assert.equal(method,'getMultipleAccounts');const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
        const clock:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};
        result={context:{slot},value:(params[0]as string[]).map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(address)??null))};
      }
      operation.chargeHttp(Buffer.byteLength(JSON.stringify(result)));operation.completeResponse();return result as T;
    },signal,{latestStartAt});
  }};
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE synthetic fixed USD'});
  const entry=new RpcMarket({rpc:rpc as ReadOnlyRpc,now:()=>at,recorder,gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE explicit gas'},usd:price,accountPlan:()=>({baseExists:true,quoteExists:true,at,evidence:'DISPOSABLE preexisting simulated accounts; no claim of actual wallet inventory'}),entryDepositLamports:'0'});
  const market=new ResearchHeldMarket({pricer:new ResearchClockPositionPricer(rpc,recorder),inventory:()=>ledger.state(),now:()=>at,usd:price,gasLamports:'7000',gasEvidence:'DISPOSABLE explicit gas',recorder,entryQuote:entry.quote});
  for(const r of retained){const pool={mint:r.proof.quote.mint,migrationSlot:r.proof.origin.slot,migrationVerified:true as const,evidence:'Retained actual migration; synthetic shared bank context'};market.registerPool(pool);entry.registerPool(pool);}
  ledger.initialize(price(),at);
  const resume=(context:{price:UsdPrice|null;marks:any})=>{
    assert.ok(context.price);ledger.reconcile('ready:'+ledger.state().revision,at,context.price,context.marks);ledger.resume('resume:'+ledger.state().revision,at,context.price,context.marks,{version:'DISPOSABLE-concurrency',evidence:'Isolated mechanics only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  };
  const setup=async(count:number)=>{
    for(let i=0;i<count;i++){
      const r=retained[i]!,context=await market.context(ledger.state().positions,new AbortController().signal);resume(context);
      ledger.order({id:'setup-'+i,side:'buy',mint:r.proof.quote.mint,decidedAt:at,executeAt:at+1000,expiresAt:at+30000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:r.proof.quote.buy.outputBaseUnits,decisionEvidence:'DISPOSABLE setup from retained size-specific calculation; not a strategy decision'},price(),context.marks);
      at+=1000;const beforeFill=await market.context(ledger.state().positions,new AbortController().signal);resume(beforeFill);
      assert.equal(ledger.attempt('setup-fill-'+i,'setup-'+i,at,{at,spendLamports:'10000000',receiveUnits:r.proof.quote.buy.outputBaseUnits,evidence:'DISPOSABLE mechanical inventory setup'},price(),beforeFill.marks).status,'filled');
    }
    const context=await market.context(ledger.state().positions,new AbortController().signal);assert.equal(Object.keys(context.marks).length,count);return context;
  };
  const coordinator=(reconcileFreshContext=false)=>new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:3000,context:async signal=>{
    const context=await market.context(ledger.state().positions,signal);
    // Explicit fixture of the launcher's fresh post-delay reconciliation
    // policy. This is a normal short ledger transaction after the read, never
    // a network request inside a financial lock or a relaxed age limit.
    if(reconcileFreshContext&&context.price)ledger.reconcile('due-context:'+ledger.state().revision,at,context.price,context.marks);
    return context;
  },quote:market.executionQuote});
  t.after(()=>{budget.close();ledger.close();Date.now=oldNow;rmSync(directory,{recursive:true,force:true});});
  return {get ledger(){return ledger;},market,entry,rpc,price,budget,physical,records,setup,resume,coordinator,inceptionAt,get at(){return at;},set at(value:number){at=value;},get slot(){return slot;},bumpSlot:()=>{slot++;},deadline:(value:number|undefined)=>{latestStartAt=value;},reopen:()=>{ledger.close();ledger=new DisposableLedger(path,id);},assertGate:()=>{const usage=budget.usage();assert.ok(physical.every(p=>p.inFlight===1));assert.ok(physical.slice(1).every((p,i)=>p.at-physical[i]!.at>=250));assert.ok(usage.rolling60SecondStarts<=60);assert.ok(usage.rolling10SecondStarts<=10);assert.equal(usage.actualInvokedUnits,physical.length);assert.equal(usage.inFlight,0);return usage;}};
}

test('three distinct held pools and retained candidate enrichment share one bounded physical gate',async t=>{
  const f=fixture(t,'fixture-three-held-candidate');await f.setup(3);f.at+=10000;
  const before=f.physical.length,context=await f.market.context(f.ledger.state().positions,new AbortController().signal),lastUsable=f.at;
  assert.equal(Object.keys(context.marks).length,3);assert.equal(f.physical.length-before,1);assert.equal(f.physical.at(-1)!.addresses!.length,16);
  for(const p of Object.values(f.ledger.state().positions))assert.equal(context.marks[p.mint]!.pricedBaseUnits,p.units);
  const flow=new ActivePipeline({scope:capture.scope,now:()=>f.at,record:(kind,data)=>f.records.push({kind,data})});flow.open(f.at);assert.equal(flow.observe(payload,f.at),'queued');
  const owner=structuredClone(f.ledger.state());f.at+=1000;const hint=flow.peekHint()!,gate=f.budget.dispatchWindow();
  const guard=chooseProtectedResearchWork({now:f.at,readyAt:gate.readyAt,physicalBusy:gate.physicalBusy,nextProtectionAt:lastUsable+2000,otherStartSinceProtection:false,advanceOutstanding:false,jobs:[{id:hint.hint.signature,kind:'enrichment',enqueuedAt:hint.hint.receivedAt,eligibleAt:hint.eligibleAt,deadlineAt:hint.deadlineAt,operationBoundMs:1200}],lastUsableEvaluationAt:lastUsable,observingSince:lastUsable,candidateWindowActive:true,recoveryActive:false,capacityAvailable:true,startSpacingMs:250});
  assert.equal(guard.decision.kind,'job');assert.equal(guard.candidateDisposition,'continue');
  if(guard.decision.kind!=='job')throw Error('expected feasible candidate slot');f.deadline(guard.decision.latestStartAt);
  const selected=flow.nextHint(f.at)!;const raw=await f.rpc.call('getTransaction',[selected.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);const normalized=flow.completeHint(selected,raw,f.at);f.deadline(undefined);
  assert.equal(normalized.length,1);assert.equal(normalized[0]!.fingerprint,capture.executedEvidence[0].fingerprint);assert.equal(flow.hasQualityLoss,false);
  const afterCandidate=f.physical.length;const final=await f.market.context(f.ledger.state().positions,new AbortController().signal);
  assert.equal(f.physical.length-afterCandidate,1);assert.equal(Object.keys(final.marks).length,3);assert.deepEqual(f.ledger.state(),owner,'candidate evidence cannot mutate financial owner');
  const usage=f.assertGate();
  evidence.threeHeldAndCandidate={classification:'RETAINED_ACCOUNT_BYTE_DECODING_WITH_SYNTHETIC_TIME_AND_RETIMED_RETAINED_CANDIDATE',distinctHeldMints:retained.map(r=>r.proof.quote.mint),coherentBatchAccounts:16,steadyHoldingRequestsPerEvaluation:1,candidateRequests:1,candidateSignature:selected.signature,normalizedEvents:normalized.length,normalizedFingerprint:normalized[0]!.fingerprint,queueAgeMs:flow.snapshot(f.at).queueAgeMs.maximum,enrichmentCompletionDelayMs:flow.snapshot(f.at).enrichmentAvailableAfterHintMs.maximum,financialStateUnchanged:true,allThreeFullSizeMarks:true,physicalOperations:usage.actualInvokedUnits,responseBytes:usage.newResponseBytes,maximumPhysicalInFlight:1,minimumPhysicalStartGapMs:Math.min(...f.physical.slice(1).map((p,i)=>p.at-f.physical[i]!.at)),syntheticHttpServiceMs:80,liveThreePoolLatencyVerified:false,completeCandidateWindowVerified:false};
});

test('fresh post-delay financial reconciliation permits a paced entry without weakening quote validity',async t=>{
  const f=fixture(t,'fixture-fresh-due-reconciliation');await f.setup(0);f.at+=10000;
  const execution=f.coordinator(true);execution.recover();f.resume(await f.market.context(f.ledger.state().positions,new AbortController().signal));
  const originalReconciliationAt=f.ledger.state().daily.reconciledAt,mint=retained[0]!.proof.quote.mint;
  const quote=await f.entry.quote({mint,side:'buy',inputUnits:'10000000'},new AbortController().signal);assert.ok(quote);
  const decidedAt=f.at;
  execution.reserve({id:'fresh-due-buy',side:'buy',mint,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:quote.outputUnits,decisionEvidence:quote.evidence},{price:f.price(),marks:{}});
  f.at+=1000;const dueAt=f.at,before=f.physical.length,result=await execution.runDue();
  assert.equal(result.results[0]!.status,'filled');assert.ok(f.at-originalReconciliationAt>2000,'the original decision-time reconciliation alone was insufficient');
  assert.ok(f.ledger.state().daily.reconciledAt>=dueAt);assert.ok(f.at-f.ledger.state().daily.reconciledAt<=2000);
  assert.ok(f.physical.slice(before).every(p=>p.at>=dueAt));assert.equal(f.physical.length-before,3);
  const delegated=f.records.find(r=>r.kind==='research-held-market-delegated-entry')!;assert.ok(delegated.data.quoteAt>=dueAt);assert.ok(f.at-delegated.data.quoteAt<=2000);
  assert.equal(f.ledger.state().positions[mint]!.units,quote.outputUnits);assert.equal(f.ledger.state().executionCosts,'7000');assert.deepEqual(f.ledger.state().pending,{});f.assertGate();
  evidence.freshReconciliationEntry={classification:'DISPOSABLE_PACED_ENTRY_WITH_LAUNCHER_CONTEXT_RECONCILIATION_POLICY',status:result.results[0]!.status,initialReconciliationAt:originalReconciliationAt,decisionAt:decidedAt,attemptedAt:dueAt,postDelayReconciliationAt:f.ledger.state().daily.reconciledAt,filledAt:f.at,executionQuoteAt:delegated.data.quoteAt,originalReconciliationAgeAtFillMs:f.at-originalReconciliationAt,freshReconciliationAgeAtFillMs:f.at-f.ledger.state().daily.reconciledAt,quoteAgeAtFillMs:f.at-delegated.data.quoteAt,postDelayPhysicalRequests:3,simulatedGasLamports:'7000',riskAndQuoteAgeLimitsChanged:false,financialLockHeldAcrossNetwork:false,limitation:'This proves the existing coordinator/market/ledger policy composition in isolated state. Pilot opt-in, exact real rent checks and same-account lifecycle have separate pilot-integration fixture coverage; no live capacity claim follows.'};
});

test('overlapping entry and exit prioritize exposure, while restart quarantines an unresolved financial action',async t=>{
  const f=fixture(t,'fixture-overlapping-financial');await f.setup(2);f.at+=10000;
  let execution=f.coordinator();execution.recover();const context=await f.market.context(f.ledger.state().positions,new AbortController().signal);f.resume(context);
  const mint=retained[2]!.proof.quote.mint,entry=await f.entry.quote({mint,side:'buy',inputUnits:'10000000'},new AbortController().signal);assert.ok(entry);
  const decisionAt=f.at,position=Object.values(f.ledger.state().positions)[0]!;
  execution.reserve({id:'entry-third',side:'buy',mint,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:entry.outputUnits,decisionEvidence:entry.evidence},{price:f.price(),marks:context.marks});
  execution.reserve({id:'exit-first',side:'sell',mint:position.mint,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'DISPOSABLE overlapping full-position exit'},{price:f.price(),marks:context.marks});
  assert.equal(Object.keys(f.ledger.state().pending).length,2);f.at+=1000;
  const pending=Object.values(f.ledger.state().pending),gate=f.budget.dispatchWindow(),jobs:ResearchJob[]=pending.map(o=>({id:o.id,kind:'pending',enqueuedAt:o.decidedAt,eligibleAt:o.executeAt,deadlineAt:o.expiresAt,operationBoundMs:1200}));
  const guard=chooseProtectedResearchWork({now:f.at,readyAt:gate.readyAt,physicalBusy:gate.physicalBusy,nextProtectionAt:decisionAt+2000,otherStartSinceProtection:false,jobs,lastUsableEvaluationAt:decisionAt,observingSince:decisionAt,candidateWindowActive:true,recoveryActive:false,capacityAvailable:true,startSpacingMs:250});
  assert.equal(guard.candidateDisposition,'suspend');assert.equal(guard.decision.kind,'job');
  const owner=structuredClone(f.ledger.state()),flow=new ActivePipeline({scope:capture.scope,now:()=>f.at});flow.open(f.at);flow.gap(guard.reason??'own-pending-priority',f.at);assert.deepEqual(f.ledger.state(),owner);
  const before=f.physical.length,batch=await execution.runDue(),actionRequestCount=f.physical.length-before;
  assert.deepEqual(batch.results.map(r=>[r.orderId,r.status]),[['exit-first','filled'],['entry-third','failed']]);
  assert.equal(batch.results[1]!.reason,'entry gate closed; canceled before attempt');
  assert.ok(batch.results[1]!.at-f.ledger.state().daily.reconciledAt>2000,'fresh quote cannot substitute for required fresh financial reconciliation');
  assert.equal(Object.keys(f.ledger.state().positions).length,1);assert.equal(f.ledger.state().positions[position.mint],undefined);assert.equal(f.ledger.state().positions[mint],undefined);assert.equal(f.ledger.state().executionCosts,'21000');assert.ok(f.physical.slice(before).every(p=>p.at>=decisionAt+1000));
  // The fixture contains a genuinely owned exit, not an erased job marker.
  const held=Object.values(f.ledger.state().positions)[0]!,fresh=await f.market.context(f.ledger.state().positions,new AbortController().signal);
  execution.reserve({id:'uncertain-after-restart',side:'sell',mint:held.mint,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'DISPOSABLE interrupted action'},fresh);
  const beforeRestart=f.ledger.state();f.reopen();assert.deepEqual(f.ledger.state(),beforeRestart);execution=f.coordinator();const recovered=execution.recover();assert.deepEqual(recovered.uncertainExitOrders,['uncertain-after-restart']);assert.equal(f.ledger.state().inceptionAt,f.inceptionAt);assert.deepEqual(f.ledger.state().positions, beforeRestart.positions);
  const retainedOrder=f.ledger.state().pending['uncertain-after-restart']!,calls=f.physical.length;f.at=retainedOrder.executeAt;const quarantined=await execution.runDue();assert.equal(quarantined.results[0]!.status,'uncertain');assert.equal(f.physical.length,calls);assert.deepEqual(f.ledger.state().positions[held.mint],held);
  f.at=retainedOrder.expiresAt;const expired=await execution.runDue();assert.equal(expired.results[0]!.status,'expired');assert.equal(f.physical.length,calls);assert.deepEqual(f.ledger.state().positions[held.mint],held);assert.equal(f.ledger.state().executionCosts,'21000');assert.equal(f.ledger.state().controls.entriesEnabled,false);
  const usage=f.assertGate();
  evidence.pendingAndRecovery={classification:'DISPOSABLE_LEDGER_AND_REAL_COORDINATOR_ADAPTER_COMPOSITION',heldBeforeOverlap:2,pendingAtOverlap:2,executionOrder:batch.results,heldAfterOverlap:1,sharedGatePhysicalRequestsDuringOverlappingActions:actionRequestCount,candidateWindowInvalidated:flow.snapshot(f.at).historicalWindowInvalidated,financialStateUnaffectedByCandidateGap:true,overlappingEntryResult:'SAFELY_REFUSED: fresh financial reconciliation exceeded its2s validity while priority exit and fresh entry pricing completed; no buy gas charged',successfulSimultaneousEntryExitCapacityProven:false,restartSameAccount:true,inceptionPreserved:true,unresolvedExitPreserved:true,quarantinedActionRequoted:false,expiredActionGasLamports:'0',exposureAfterExpiry:Object.keys(f.ledger.state().positions).length,totalModeledGasLamports:f.ledger.state().executionCosts,physicalOperations:usage.actualInvokedUnits,responseBytes:usage.newResponseBytes,limitation:'The coordinator prioritizes exits inside the due batch. A caller must route every multi-read action through the shared gate, preserve fresh financial reconciliation and reserve the whole envelope; this fixture exposes a failure instead of claiming concurrent-entry capacity.'};
});

test('bounded existing scheduler stress reports jitter, three-event bursts, overruns and recovery failures separately',()=>{
  const job=(id:string,at:number,kind:SimulatedJob['kind']='enrichment',deadlineAt=at+5000):SimulatedJob=>({id,kind,enqueuedAt:at,eligibleAt:at+(kind==='enrichment'?1000:0),deadlineAt,operationBoundMs:1200,cost:{httpMs:80,parseMs:20,actuationMs:2}});
  const scenarios=[];
  for(const jitter of [50,100]){
    scenarios.push({name:'three-held-union-plus-burst3-jitter'+jitter,jobs:Array.from({length:3},(_,i)=>job('trade-'+i,100)),priceCosts:[{httpMs:80,parseMs:20,actuationMs:2}],timerJitterMs:jitter});
    scenarios.push({name:'overlapping-financial-with-burst-reconnect-jitter'+jitter,jobs:[job('later-entry',2500,'pending',4800),job('earlier-exit',2500,'pending',3600),job('restore-control',2500,'reconnect',10000),...Array.from({length:3},(_,i)=>job('burst-'+i,2500))],priceCosts:[{httpMs:80,parseMs:20,actuationMs:2}],timerJitterMs:jitter});
  }
  scenarios.push({name:'three-held-processing-overrun',jobs:[job('selected-during-overrun',100)],priceCosts:[{httpMs:990,parseMs:220,actuationMs:2}],timerJitterMs:50});
  const stalled=job('stalled-selected',500);stalled.cost={httpMs:9000,parseMs:20,actuationMs:2,settlementMs:10000};
  scenarios.push({name:'unsettled-cancellation-retains-financial',jobs:[stalled,job('owned-exit-during-outage',2500,'pending',6000),job('restore-after-settlement',11000,'reconnect',16000)],priceCosts:[{httpMs:80,parseMs:20,actuationMs:2}],timerJitterMs:100});
  const results=scenarios.map(input=>{
    const simulation=simulateSharedScheduler({...input,policy:'proposed-protected-v2',durationMs:18000,minimumStartSpacingMs:250,maximumStartsPer10Seconds:10,timeoutBehavior:'capture-stop'}),assessment=assessProposedTiming(simulation,PROPOSED_TIMING_STANDARD);
    assert.ok((simulation.minimumStartGapMs??250)>=250);assert.ok((simulation.maximumRolling60SecondStarts??0)<=60);assert.ok((simulation.maximumRolling10SecondStarts??0)<=10);assert.ok(simulation.physicalOperationOverlapMaximum<=1);assert.equal(assessment.combined.operationalAcceptance,false);
    if(input.name.startsWith('three-held-union')){assert.equal(simulation.enrichments.completedWithinFiveSeconds,3);assert.equal(assessment.flow.allRequiredEventsCompleted,true);assert.equal(assessment.protection.verdict,'MODELED_TIMING_WITHIN_PROPOSAL');}
    if(input.name.startsWith('overlapping-financial')){assert.equal(assessment.flow.allRequiredEventsCompleted,false);assert.ok(simulation.candidateInvalidations.length);assert.ok(simulation.outcomes.filter(o=>o.kind==='pending').every(o=>o.retainedIfFinancial));}
    if(input.name==='three-held-processing-overrun'){assert.equal(assessment.protection.declaredProtectionEnvelopeRespected,false);assert.equal(assessment.protection.verdict,'MODELED_PROTECTION_TIMING_UNSERVABLE_OR_UNVERIFIED');}
    if(input.name==='unsettled-cancellation-retains-financial'){assert.equal(simulation.haltReason,'component-budget-sticky-timeout');assert.equal(simulation.unresolvedFinancialActions,1);assert.equal(assessment.flow.allRequiredEventsCompleted,false);assert.equal(assessment.protection.verdict,'MODELED_PROTECTION_TIMING_UNSERVABLE_OR_UNVERIFIED');assert.ok(simulation.physicalUnsettledAtEnd);}
    return {input,simulation,assessment};
  });
  evidence.scheduling={classification:'EXISTING_PURE_SCHEDULER_COUNTERFACTUAL_WITH_DECLARED_SYNTHETIC_SERVICE_COSTS',heldPositionsPerCoherentEvaluation:3,requestsPerSteadyCoherentEvaluation:1,localLimits:{startsPerMinute:60,startsPerTenSeconds:10,minimumStartSpacingMs:250,maximumPhysicalInFlight:1},unchangedTwoSecondTargetMs:2000,componentAssumption:'The same single read covers three holdings only if all their current dependencies fit one coherent supported union batch. Cost80ms HTTP+20ms processing is synthetic, not a measured live three-pool latency.',scenarios:results};
});

after(()=>{
  if(process.env.POE_WRITE_CONCURRENCY_EVIDENCE!=='1')return;
  assert.ok(evidence.threeHeldAndCandidate&&evidence.freshReconciliationEntry&&evidence.pendingAndRecovery&&evidence.scheduling,'all bounded components must finish before artifact creation');
  evidence.sources=[...retained.flatMap(r=>[r.proofPath,r.statePath]),capturePath,payloadPath,'src/research-dispatch.ts','src/component-budget.ts','src/research-held-market.ts','src/research-clock-pricing.ts','src/execution.ts','src/ledger.ts','scripts/evaluate-shared-scheduler.ts','test/pilot-concurrency.test.ts'].map(path=>({path,sha256:hash(path)}));
  evidence.decision='Three-holding coherent pricing plus one retained candidate enrichment is supported for the disposable tested mechanics. Fresh post-delay financial reconciliation permits the paced one-position entry. Overlapping-action capacity is not established: the negative path safely refuses an entry with stale financial reconciliation. Bursts, processing overruns and unresolved cancellation retain separate protection/flow verdicts. No live three-pool, endpoint, strategy-performance or unattended-acceptance conclusion follows.';
  evidence.testProcessResources={classification:'CLOUD_OFFLINE_TEST_PROCESS_ONLY_NOT_EC2_OR_LIVE_CAPACITY',elapsedMs:Math.round(performance.now()-startedMono),cpu:process.cpuUsage(cpuStart),processHighWaterRssBytes:process.resourceUsage().maxRSS*1024};
  evidence.reproduce='POE_WRITE_CONCURRENCY_EVIDENCE=1 node --import tsx --test test/pilot-concurrency.test.ts (exclusive artifact creation; ordinary tests do not write evidence)';
  const bytes=Buffer.from(JSON.stringify(evidence,null,2)+'\n');assert.ok(bytes.length<1024*1024);writeFileSync('evidence/pilot-concurrency-20261027.json',bytes,{flag:'wx',mode:0o600});
});
