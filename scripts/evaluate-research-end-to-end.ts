/** Isolated replay + disposable integration. No networking, credentials,
 * production account, market subscription, publishing or entry-enable path. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {FlowWindow,PROVISIONAL_RULE,evaluatePrimary,evaluateExit} from '../src/strategy.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {ResearchHeldMarket} from '../src/research-held-market.js';
import {deriveComponentHypothetical,validateComponentParity,type ComponentSnapshot} from '../src/component-parity.js';
import type {PoolWireAccount} from '../src/pool.js';

const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const naturalRoot='evidence/scheduler-forward-20261027/';
const proofPath='evidence/integration-proof-2026-10-26T19-42-16.130Z.json';
const statePath='evidence/integration-2026-10-26T19-42-16.130Z.ndjson';
const sourcePaths=[naturalRoot+'capture.json',naturalRoot+'observations.ndjson',naturalRoot+'audit.json',proofPath,statePath];

/** No fixture signal is substituted for the actual natural sample. The positive
 * lifecycle below is a separate manually submitted mechanics fixture. */
export async function evaluateResearchEndToEnd(){
  const sources=sourcePaths.map(path=>({path,sha256:sha(readFileSync(path))}));
  const capture=JSON.parse(readFileSync(sourcePaths[0]!,'utf8')),audit=JSON.parse(readFileSync(sourcePaths[2]!,'utf8'));
  const naturalRecords=readFileSync(sourcePaths[1]!,'utf8').trim().split('\n').map(s=>JSON.parse(s));
  const naturalTrades=naturalRecords.filter(r=>r.kind==='research-normalized-trade').map(r=>r.data);
  const target=audit.applicationTargetReadiness.rawReadyFeatureRows[0];assert.ok(target);
  const views={curve:new FlowWindow(capture.scope.mint,capture.openedAt),user:new FlowWindow(capture.scope.mint,capture.openedAt)};
  for(const row of naturalTrades){
    const e=row.executedEvidence,remapped=mapConfirmedPumpSwapEvidence(capture.enrichmentTransactions[e.identity.signature],{...capture.scope,signature:e.identity.signature,providerReceivedAt:e.providerReceivedAt,availableAt:e.availableAt});
    assert.equal(remapped.length,1);assert.equal(remapped[0]!.fingerprint,e.fingerprint);assert.ok(row.at>=row.rpcAvailableAt&&row.rpcAvailableAt>e.providerReceivedAt);
    for(const name of ['curve','user'] as const){assert.equal(row[name].trade.receivedAt,row.at);views[name].ingest(row[name].trade);}
  }
  const naturalViews=(['curve','user'] as const).map(name=>{
    const features=views[name].features(target.at);assert.deepEqual(features,target[name]);
    const decision=evaluatePrimary(features,{mint:capture.scope.mint,now:target.at,migrationAt:null,migrationVerified:false,supportedPool:true,flowFieldsVerified:true,flowVerificationEvidence:'Five actual matched events; bounded chain interval only, not general receive-window completeness',riskEntriesAllowed:false,alreadyTradedMint:false,quote:null});
    assert.equal(decision.qualified,false);assert.equal(decision.reason,'verified-migration-time-unavailable');
    return {amountConvention:name,features,fullEntryDecision:decision,predictivePrerequisiteFacts:{netBuyingBelowMinimum:BigInt(features.netBuyLamports)<BigInt(PROVISIONAL_RULE.minimumNetBuyLamports),positiveBucketsBelowMinimum:features.positiveNetBuckets<PROVISIONAL_RULE.minimumPositiveBuckets,buyersBelowMinimum:features.distinctBuyerWallets<PROVISIONAL_RULE.minimumBuyers,concentrationAboveMaximum:features.largestBuyerBps>PROVISIONAL_RULE.maximumLargestBuyerBps,priceReturnNegative:features.priceReturnBps!==null&&features.priceReturnBps<0}};
  });
  const natural={classification:'ACTUAL_RECORDED_FLOW_REPLAY_AT_ORIGINAL_VALIDATED_AVAILABILITY',mint:capture.scope.mint,pool:capture.scope.pool,events:naturalTrades.length,buys:capture.normalizedBuys,sells:capture.normalizedSells,applicationTarget:audit.applicationAvailabilityTarget,chainAuditDenominator:{matched:audit.matchedOriginalEvents,verified:audit.verifiedSwapEvents,receiveWindowCompleteness:audit.receiveWindowCompleteness},views:naturalViews,migrationAt:null,migrationVerified:false,entryEligibility:'UNVERIFIED; no invented migration age',primaryStrategyEntry:false,naturalOrdersSubmitted:0,naturalTradesCreated:0,meaning:'Both observed amount views fail several predictive prerequisites. The complete entry rule stops earlier at missing migration evidence; this is not a fully eligible natural strategy-performance sample.'};

  const proof=JSON.parse(readFileSync(proofPath,'utf8')),originalState=JSON.parse(readFileSync(statePath,'utf8').trim().split('\n').find(s=>JSON.parse(s).kind==='pool-state')!).data;
  const accounts=new Map<string,PoolWireAccount|null>(originalState.addresses.map((a:string,i:number)=>[a,originalState.value[i]]));
  const sourceAccountBytesHash=sha(JSON.stringify(originalState.value));
  let at=Date.parse(proof.quote.validatedAt),slot=originalState.context.slot,latest:ComponentSnapshot|null=null,ledger:DisposableLedger|null=null;
  const realNow=Date.now,dir=mkdtempSync(join(tmpdir(),'poe-fixture-end-to-end-')),database=join(dir,'disposable.sqlite'),accountId='fixture-research-end-to-end';
  const records:Array<{kind:string;data:any}>=[],calls:Array<{method:string;addresses:number;at:number;slot:number}>=[],entryParities:Array<{slot:number;inputLamports:string;outputBaseUnits:string;sellOutputLamports:string;sameByteParity:boolean}>=[];
  const advance=(ms:number)=>{at+=ms;slot++;};
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'FIXTURE fixed $100/SOL; no live USD feed'});
  const recorder={record(kind:string,data:unknown){records.push({kind,data});assert.ok(records.length<=200);if(kind==='research-clock-pool-state')latest=data as ComponentSnapshot;}};
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    assert.equal(method,'getMultipleAccounts');const addresses=params[0] as string[];calls.push({method,addresses:addresses.length,at,slot});assert.ok(calls.length<=20);
    const clock=Buffer.alloc(40);clock.writeBigUInt64LE(BigInt(slot));clock.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
    const clockAccount:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[clock.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};
    return {context:{slot},value:addresses.map(a=>a===SYSVAR_CLOCK_PUBKEY.toBase58()?clockAccount:structuredClone(accounts.get(a)??null))} as T;
  }};
  try{
    // Synthetic Clock/timing and static retained account bytes intentionally
    // isolate integration mechanics. These are not replayed market returns.
    Date.now=()=>at;ledger=new DisposableLedger(database,accountId);ledger.initialize(price(),at);
    const initial=ledger.state(),initialLamports=BigInt(initial.lamports),inception=initial.inceptionAt;
    const financialBeforeNaturalCheck=structuredClone(ledger.state());assert.ok(natural.views.every(v=>!v.fullEntryDecision.qualified));assert.deepEqual(ledger.state(),financialBeforeNaturalCheck);
    const makeMarket=()=>{
      const pricer=new ResearchClockPositionPricer(rpc,recorder);
      const market=new ResearchHeldMarket({pricer,inventory:()=>ledger!.state(),now:()=>at,usd:price,gasLamports:'7000',gasEvidence:'FIXTURE explicit gas; existing token account/deposit0',recorder,entryQuote:async(request,signal)=>{
        assert.equal(request.mint,proof.quote.mint);assert.equal(request.inputUnits,'10000000');
        const batch=await pricer.quoteMany([{mint:new PublicKey(request.mint),fullBaseUnits:BigInt(proof.quote.buy.outputBaseUnits),minSlot:request.minSlot}],signal);assert.ok(latest);const snap:ComponentSnapshot=latest;
        const sized=batch.quotes[request.mint]!;assert.ok(sized);const parity=validateComponentParity(snap,request.mint,BigInt(sized.sell.inputBaseUnits),sized),entry=deriveComponentHypothetical(snap,request.mint);
        entryParities.push({slot:sized.slot,inputLamports:entry.inputLamports,outputBaseUnits:entry.fullBaseUnits,sellOutputLamports:parity.sell.outputLamports,sameByteParity:parity.matches});
        return {...request,slot:sized.slot,at:Date.parse(sized.receivedAt),outputUnits:entry.fullBaseUnits,evidence:'FIXTURE same validated account bytes + pinned SDK buyQuoteInput; no natural signal',effectiveQuoteLiquidityLamports:sized.effectiveQuoteReserve};
      }});
      market.registerPool({mint:proof.quote.mint,migrationSlot:proof.origin.slot,migrationVerified:true,evidence:'Retained actual verified SOL migration; fixture timing only'});return market;
    };
    const coordinator=(market:ResearchHeldMarket)=>new PaperExecutionCoordinator({ledger:ledger!,now:()=>at,timeoutMs:1000,context:s=>market.context(ledger!.state().positions,s),quote:market.executionQuote});
    let market=makeMarket(),execution=coordinator(market);execution.recover();ledger.reconcile('fixture-ready',at,price(),{});ledger.resume('fixture-resume',at,price(),{},{version:'fixture-research-e2e',evidence:'FIXTURE ONLY manual positive lifecycle; not a verified natural strategy signal',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
    const decisionQuote=await market.quote({mint:proof.quote.mint,side:'buy',inputUnits:'10000000'},new AbortController().signal);assert.ok(decisionQuote);
    execution.reserve({id:'fixture-entry',mint:proof.quote.mint,side:'buy',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:(BigInt(decisionQuote.outputUnits)*9500n/10000n).toString(),decisionEvidence:decisionQuote.evidence},{price:price(),marks:{}});
    const beforeDelay=await execution.runDue();assert.equal(beforeDelay.results.length,0);advance(1000);
    const entry=await execution.runDue();assert.equal(entry.results[0]?.status,'filled');const position=ledger.state().positions[proof.quote.mint]!;assert.ok(position);assert.equal(position.units,entryParities.at(-1)!.outputBaseUnits);
    const entryState=structuredClone(ledger.state()),context=await market.context(entryState.positions,new AbortController().signal),mark=context.marks[position.mint]!;assert.ok(mark);
    const sell=await market.quote({mint:position.mint,side:'sell',inputUnits:position.units},new AbortController().signal);assert.ok(sell);assert.equal(BigInt(mark.netLamports),BigInt(sell.outputUnits)-7000n);
    execution.reserve({id:'fixture-unresolved-exit',side:'sell',mint:position.mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'FIXTURE pending exit intentionally interrupted before attempt'},context);
    const safeStop=ledger.safeStop('fixture-safe-stop-open',at);assert.equal(safeStop.safeToExit,false);assert.equal(safeStop.state,'management-required');const beforeRestart=structuredClone(ledger.state());ledger.close();ledger=new DisposableLedger(database,accountId);assert.deepEqual(ledger.state(),beforeRestart);
    market=makeMarket();execution=coordinator(market);const recovery=execution.recover();assert.deepEqual(recovery.uncertainExitOrders,['fixture-unresolved-exit']);const beforeUncertainCalls=calls.length;advance(1000);
    const uncertain=await execution.runDue();assert.equal(uncertain.results[0]?.status,'uncertain');assert.equal(calls.length,beforeUncertainCalls);assert.equal(ledger.state().positions[position.mint]!.units,position.units);assert.ok(ledger.state().pending['fixture-unresolved-exit']);assert.equal(ledger.state().controls.entriesEnabled,false);
    market.invalidate('FIXTURE disconnected market context');const unknown=ledger.projection(at,price(),{});assert.equal(unknown.equityLamports,null);assert.equal(unknown.openPositions,1);assert.equal(unknown.entriesEnabled,false);assert.equal(ledger.state().positions[position.mint]!.units,position.units);
    advance(4000);const expired=await execution.runDue();assert.equal(expired.results[0]?.status,'expired');assert.equal(calls.length,beforeUncertainCalls);assert.equal(ledger.state().executionCosts,'7000');assert.equal(ledger.state().positions[position.mint]!.units,position.units);
    const resumedContext=await market.context(ledger.state().positions,new AbortController().signal);assert.ok(resumedContext.marks[position.mint]);ledger.reconcile('fixture-recovered-reconcile',at,price(),resumedContext.marks);
    const recoveryCurrentCalls=calls.length-beforeUncertainCalls;assert.equal(recoveryCurrentCalls,2);
    advance(PROVISIONAL_RULE.maximumHoldingMs);const dueContext=await market.context(ledger.state().positions,new AbortController().signal),exitDecision=evaluateExit({now:at,enteredAt:position.enteredAt,entryCostLamports:(BigInt(position.entryLamports)+BigInt(position.entryGas)).toString(),heldBaseUnits:position.units,mark:dueContext.marks[position.mint]??null});assert.equal(exitDecision.action,'request-exit');assert.match(exitDecision.reason,/maximum-holding-time/);
    execution.reserve({id:'fixture-fresh-exit',side:'sell',mint:position.mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'FIXTURE synthetic15-minute time advance; fresh full-size SDK sell required'},dueContext);
    const callsBeforeExit=calls.length;advance(1000);const exit=await execution.runDue();assert.equal(exit.results[0]?.status,'filled');assert.equal(calls.length-callsBeforeExit,1);
    const final=ledger.state(),exitReuse=records.findLast(r=>r.kind==='research-held-market-execution-reuse')!.data,expected=BigInt(sell.outputUnits)-10000000n-14000n;assert.deepEqual(final.positions,{});assert.deepEqual(final.pending,{});assert.equal(final.realizedLamports,expected.toString());assert.equal(BigInt(final.lamports)-initialLamports,expected);assert.equal(final.executionCosts,'14000');assert.equal(final.accountId,accountId);assert.equal(final.inceptionAt,inception);assert.equal(ledger.exportJournal(100).filter((r:any)=>r.kind==='inception').length,1);assert.equal(ledger.integrity(),'ok');assert.equal(ledger.hasTradedMint(position.mint),true);
    const finalBeforeDuplicate=structuredClone(final);assert.deepEqual((await execution.runDue()).results,[]);assert.deepEqual(ledger.state(),finalBeforeDuplicate);ledger.reconcile('fixture-final-reconcile',at,price(),{});
    const projection=ledger.projection(at,price(),{});assert.equal(projection.unknownMarks,false);assert.equal(projection.equityLamports,ledger.state().lamports);assert.equal(projection.entriesEnabled,false);
    assert.equal(sha(JSON.stringify(originalState.value)),sourceAccountBytesHash);for(const source of sources)assert.equal(sha(readFileSync(source.path)),source.sha256);
    return {schemaVersion:1,classification:'ISOLATED_RESEARCH_INTEGRATION; NOT_FORWARD_TRADING_OR_ACCEPTANCE',sources,natural,fixture:{classification:'DISPOSABLE_MANUALLY_SUBMITTED_POSITIVE_LIFECYCLE; SYNTHETIC_TIME_AND_CLOCK',accountId,mode:final.mode,inceptionAt:inception,initialMicroUsd:initial.initialMicroUsd,inceptionCount:1,sourcePool:{mint:proof.quote.mint,pool:proof.quote.pool,verifiedMigration:proof.origin},stateProvenance:'Seven retained non-Clock account bytes reused unchanged; context slots and Clock/timing advanced synthetically. No assertion these static reserves were current at fixture times.',entryParities,entry:entry.results,positionAfterEntry:entryState.positions[position.mint],safeStop,recovery,uncertain:uncertain.results,uncertainActionPreserved:true,restartStateExactlyPreserved:true,unknownMarkProjection:{equityLamports:unknown.equityLamports,openPositions:unknown.openPositions,entriesEnabled:unknown.entriesEnabled},expired:expired.results,expiryChargedNoAdditionalGas:true,recoveryCurrentAdapterCalls:recoveryCurrentCalls,exitDecision,exit:exit.results,exitContextAdapterCalls:1,postDelayExitQuoteReuse:exitReuse,executionCostsLamports:final.executionCosts,fixtureOnlyRealizedLamports:final.realizedLamports,fixtureOnlyCashDeltaLamports:(BigInt(final.lamports)-initialLamports).toString(),economicPnl:null,operatingCosts:'Not allocated; this fixture tests accounting mechanics only',riskSizing:'0.01SOL buy budget +7000 simulated entry gas, same ledger limits; existing account/no new deposit assumption',finalProjection:projection,idempotentNoDuplicateAttempt:true,allFinancialStateValid:true,sqlite:ledger.sqlite,adapterCalls:calls,networkRequests:0},capability:'Validated evidence, original availability and no-entry refusal connect to separately labeled same-byte SDK pricing, delayed disposable execution, uncertainty-preserving restart, exposure retention, fresh recovery and a full fixture lifecycle. This does not turn the observer into an autonomous strategy trader.',remainingGaps:['Natural sample migration origin/age and broad receive-window completeness remain unverified.','No natural qualifying entry or natural financial lifecycle is produced.','Primary curve-versus-user feature convention and production strategy remain unfrozen.','Static-state/synthetic-Clock lifecycle cannot establish fill realism, changing-price protection or economic edge.','No production data-path integration, supervisor, notification recovery, throughput or elapsed unattended acceptance is established here.'],sourceEvidenceUnchanged:true,productionChanged:false,authoritativeAccountChanged:false,naturalPaperTrades:0,paperEntriesEnabled:false,liveTradingEnabled:false,acceptanceClockStarted:false,networkRequests:0};
  }finally{ledger?.close();Date.now=realNow;rmSync(dir,{recursive:true,force:true});}
}

if(resolve(process.argv[1]??'')===import.meta.filename){
  assert.equal(process.argv[2],'--write');const output=resolve(process.argv[3]??'evidence/standing-research-20261027/isolated-integration.json'),result=await evaluateResearchEndToEnd(),bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');assert.ok(bytes.length<128*1024);writeFileSync(output,bytes,{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({output,bytes:bytes.length,sha256:sha(bytes),naturalTrades:0,fixtureLifecycle:true,networkRequests:0})+'\n');
}
