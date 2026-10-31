/** OFFLINE disposable accounting + complete synthetic audited native windows.
 * No provider access, operating account, wallet, or real market claim. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {PaperLedger,OPERATIONAL_REPORTING_ENTRY_PAUSE,type UsdPrice} from '../src/ledger.js';
import {NativePaper,NATIVE_PAPER_FINANCIAL_READINESS_POLICY,NATIVE_PAPER_ENTRY_BLOCKERS,nativePaperDerivedEntryBlocker} from '../src/native-paper.js';
import {NativePaperCashMaintenance,NativePaperReportingHealth,nativePaperBackupDue,nativePaperEssentialEvidence} from '../src/run-native-paper.js';
import {FlowWindow,assessPredictiveBuying,type NormalizedTrade} from '../src/strategy.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {PILOT_VERSION,PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';
import {canonicalObservationPool} from '../src/native-observation-identity.js';
import type {ResearchClockObservationSupport} from '../src/research-clock-pricing.js';
import type {PilotMarket} from '../src/pilot-market.js';
import {ownerDailyLossReset} from '../src/native-account-control.js';

function fixture(t:TestContext,strong=false,operating=false){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-cash-readiness-')),base=Date.parse('2026-10-29T03:00:00Z'),accountId='poe-pilot-offline-cash-readiness',mint=new PublicKey(Buffer.alloc(32,31)).toBase58(),pool=canonicalObservationPool(mint);
 const ledger=new PaperLedger(join(directory,'fixture.sqlite'),accountId);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});let supportAt=base+60000,bankClockAt=base+60000;let at=base,price:UsdPrice|null={at,microUsdPerSol:'100000000',source:'OFFLINE original USD'},admission=true,certificateAvailable=true,connected=true,recordFailure=false,executionRead:(()=>Promise<null>)|null=null;
 ledger.initialize(price,at);const window=new FlowWindow(mint,base),rows:Array<{kind:string;data:any}>=[],calls={context:0,preparation:0,quote:0,execution:0};
 const market={registerPool(){},minimumSlot(){},async context(){calls.context++;return {price,marks:{}};},async prepareEntryCosts(){calls.preparation++;return {at,depositLamports:'0',evidence:'OFFLINE genuine fixture preparation'};},async quote(){calls.quote++;return null;},async executionQuote(){calls.execution++;if(executionRead)return executionRead();throw Error('OFFLINE no execution expected');}}as unknown as PilotMarket;
 const make=()=>{const openedAt=at;const bridge=new NativePaper({operatingFinancialReadiness:operating,ledger,market,binding:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},fixtureAccountBinding:{accountId,inceptionAt:base},now:()=>at,admitNewRisk:()=>admission,record:(kind,data)=>{if(recordFailure&&kind==='native-paper-financial-readiness-recovered')throw Error('OFFLINE evidence write failure');rows.push({kind,data:structuredClone(data)});},source:{usage:()=>({dataContract:'confirmed-program-activity-v3-shadow',connected,stopped:false,fatal:null,lastFreshSupportAt:supportAt,lastBankClockAt:bankClockAt})as any,snapshot:()=>({dataContract:'confirmed-program-activity-v3-shadow',openedAt,connectionId:1,subscription:11,connected,sourceSupportFresh:true,hasQualityLoss:false})as any},certificate:(_mint,when)=>{if(!certificateAvailable)return null;const f=window.features(when);return {schemaVersion:1,mint,pool,dataContract:'confirmed-program-activity-v3-shadow',openedAt,connectionId:1,subscriptionId:11,windowStartAt:f.windowStartAt,windowEndAt:f.windowEndAt,auditAvailableAt:when,admittedAt:when,deadlineAt:f.windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:nativePaperFeaturesSha256(f)};}});
  bridge.allocated({schemaVersion:1,baseMint:mint,pool,migrationAt:base-600000,migrationVerified:true,identityBasis:'retained-verified-metadata',identityAvailableAt:at,identityEvidence:'OFFLINE synthetic retained migration metadata',minimumSlot:1});bridge.currentPoolValidated({mint,pool,at,sourceSlot:1,evidence:'OFFLINE synthetic current canonical pool validation',summary:{} as ResearchClockObservationSupport['summary']});bridge.opened({mint,at:openedAt});return bridge;};
 const bridge=make();if(strong)for(let i=0;i<6;i++){at=base+i*10000+100;const trade:NormalizedTrade={identity:{signature:'OFFLINE readiness buy '+i,instructionIndex:0,eventIndex:0},mint,wallet:'OFFLINE distinct buyer '+i,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*20000),receivedAt:at,commitment:'confirmed',slot:100+i};assert.equal(window.ingest(trade),'accepted');bridge.trade({trade,validatedAt:at,evidence:{}as any,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});}
 at=base+60000;price={at,microUsdPerSol:'100000000',source:'OFFLINE original USD'};
 const refresh=(recover=true)=>bridge.maintainFlatFinancialReadiness(price,recover),projection=()=>ledger.projection(at,price??undefined),blocker=()=>nativePaperDerivedEntryBlocker({at,state:ledger.state(),projection:projection(),safety:bridge.trader.entryReadinessSafety()});
 return {ledger,bridge,make,market,base,mint,calls,rows,refresh,projection,blocker,get at(){return at;},set at(v){at=v;},get price(){return price;},set price(p){price=p;},set admission(v:boolean){admission=v;},set certificateAvailable(v:boolean){certificateAvailable=v;},set connected(v:boolean){connected=v;},set recordFailure(v:boolean){recordFailure=v;},set executionRead(v:()=>Promise<null>){executionRead=v;},set supportAt(v:number){supportAt=v;},set bankClockAt(v:number){bankClockAt=v;}};
}

test('flat five-second reconciliation creates a derived pause without changing controls; local maintenance preserves two-second guard',t=>{
 const f=fixture(t);assert.equal(f.bridge.ready(f.mint),true);assert.notEqual(assessPredictiveBuying(f.bridge.trader.candidateFeatures(f.mint,f.at)!,f.at).status,'not-rejected');assert.deepEqual(f.refresh(),{kind:'reconciled',recovered:true});const originalPrice=f.price!;
 f.at+=5050;assert.equal(f.projection().entriesEnabled,false);assert.equal(f.ledger.state().controls.entriesEnabled,true);assert.equal(f.ledger.state().daily.paused,false);assert.equal(f.blocker(),NATIVE_PAPER_ENTRY_BLOCKERS.reconciliationStale);
 assert.deepEqual(f.refresh(),{kind:'reconciled',recovered:false});assert.equal(f.projection().entriesEnabled,true);assert.equal(f.blocker(),null);assert.deepEqual(f.bridge.valuation().price,originalPrice);assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.ledger.state().positions,{});
});

test('expired USD closes entries, new original-timestamp USD and fresh complete window recover without predictive pass or RPC',async t=>{
 const f=fixture(t);f.refresh();f.at+=11000;assert.equal(f.refresh().kind,'unavailable');assert.equal(f.projection().entriesEnabled,false);assert.equal(f.blocker(),NATIVE_PAPER_ENTRY_BLOCKERS.usd);const at=f.at;f.price={at,microUsdPerSol:'100000000',source:'OFFLINE replacement USD'};assert.equal(f.refresh().recovered,true);assert.equal(f.projection().entriesEnabled,true);assert.equal(f.bridge.valuation().price!.at,at);
 await f.bridge.trader.tick({evaluateCandidates:false,reuseFreshContext:true});assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});assert.ok(f.rows.some(r=>r.kind==='trader-context-reuse'&&r.data.priceAt===at));assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'0');
});

test('fresh audit-completion timestamp cannot substitute for an old executed-flow cutoff',t=>{
 const f=fixture(t);f.at+=2001;assert.equal(f.refresh().recovered,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);f.at=f.base+70000;f.price={...f.price!,at:f.at};assert.equal(f.refresh().recovered,true);const event=f.rows.find(r=>r.kind==='native-paper-financial-readiness-recovered')!.data;assert.equal(event.windowEndAt,f.base+70000);assert.equal(event.entryQuoteClaimed,false);assert.equal(event.orderCreated,false);assert.equal(f.ledger.state().controls.readinessVersion,NATIVE_PAPER_FINANCIAL_READINESS_POLICY.version);
});

test('owner pause, safe stop, daily loss, admission failure, disconnected source and absent certificate do not auto-resume',async t=>{
 for(const gate of ['owner','stop','loss','admission','connection','certificate']as const)await t.test(gate,st=>{const f=fixture(st);if(gate==='owner')f.ledger.pause('OFFLINE owner',f.at,'operator paused new entries');if(gate==='stop')f.ledger.safeStop('OFFLINE stop',f.at);if(gate==='loss')f.price={...f.price!,microUsdPerSol:'90000000'};if(gate==='admission')f.admission=false;if(gate==='connection')f.connected=false;if(gate==='certificate')f.certificateAvailable=false;assert.equal(f.refresh().recovered,false);assert.equal(f.projection().entriesEnabled,false);assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});});
});

test('pending action and actual held inventory block cash-only maintenance without changing obligations',t=>{
 const f=fixture(t);f.refresh();f.ledger.order({id:'OFFLINE pending',mint:f.mint,side:'buy',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'OFFLINE obligation preservation'},f.price!,{});let before=f.ledger.state();assert.equal(f.refresh().kind,'busy');assert.deepEqual(f.ledger.state(),before);f.at+=1000;f.price={...f.price!,at:f.at};assert.equal(f.ledger.attempt('OFFLINE filled','OFFLINE pending',f.at,{at:f.at,spendLamports:'10000000',receiveUnits:'1000',evidence:'OFFLINE setup'},f.price).status,'filled');before=f.ledger.state();assert.equal(f.refresh().kind,'busy');assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});
});

test('unknown post-commit financial failure latches closed; later maintenance and restart cannot reinterpret success',t=>{
 const f=fixture(t),original=f.ledger.reconcile.bind(f.ledger);f.ledger.reconcile=((...args:Parameters<PaperLedger['reconcile']>)=>{original(...args);throw Error('OFFLINE post-commit uncertainty');})as PaperLedger['reconcile'];assert.equal(f.refresh().kind,'financial-unavailable');assert.equal(f.bridge.trader.entryReadinessSafety().financialAvailable,false);f.ledger.reconcile=original;const revision=f.ledger.state().revision;assert.equal(f.refresh().kind,'financial-unavailable');assert.equal(f.ledger.state().revision,revision);const restarted=f.make();assert.equal(restarted.maintainFlatFinancialReadiness(f.price).recovered,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.match(f.ledger.state().controls.reason,/financial maintenance unavailable/);
});

test('post-commit maintenance failure retains the first operation and safe fingerprint without declaring its outcome',t=>{
 const f=fixture(t),original=f.ledger.reconcile.bind(f.ledger),prior=f.ledger.state(),message='OFFLINE uncertain commit https://provider.invalid/private?api-key=DO-NOT-EXPORT',error=Object.assign(Error(message),{code:'SQLITE_IOERR'});
 f.ledger.reconcile=((...args:Parameters<PaperLedger['reconcile']>)=>{original(...args);throw error;})as PaperLedger['reconcile'];
 assert.equal(f.refresh().kind,'financial-unavailable');
 const diagnostic=f.bridge.trader.financialMaintenanceFailureDiagnostics();
 assert.deepEqual(diagnostic,{version:'financial-maintenance-failure-v1',at:f.at,phase:'flat-reconcile-context',attemptedStateRevision:prior.revision,errorSha256:createHash('sha256').update(message).digest('hex'),sqliteCode:'SQLITE_IOERR',commitOutcome:'unknown',entriesRemainClosed:true});
 assert.equal(f.ledger.state().lamports,prior.lamports);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.bridge.trader.entryReadinessSafety().financialAvailable,false);
 f.bridge.trader.financialMaintenanceFailed('runtime-failure',Error('OFFLINE secondary shutdown error'));
 assert.deepEqual(f.bridge.trader.financialMaintenanceFailureDiagnostics(),diagnostic);
 const failures=f.rows.filter(row=>row.kind==='trader-financial-maintenance-failed');assert.equal(failures.length,1);assert.equal(JSON.stringify(failures).includes('DO-NOT-EXPORT'),false);assert.equal(JSON.stringify(failures).includes('provider.invalid'),false);assert.equal(nativePaperEssentialEvidence(failures[0]!.kind,'source',false),true);
});

test('failure-record write errors retain the maintenance latch and never mask an uncertain pause commit',t=>{
 const f=fixture(t),original=f.ledger.pause.bind(f.ledger),pauseError=Error('OFFLINE pause committed before callback failure'),primary=Error('OFFLINE initial financial failure');
 (f.bridge.trader as any).options.recorder.record=()=>{throw Error('OFFLINE diagnostic storage unavailable');};
 f.ledger.pause=((...args:Parameters<PaperLedger['pause']>)=>{original(...args);throw pauseError;})as PaperLedger['pause'];
 assert.throws(()=>f.bridge.trader.financialMaintenanceFailed('flat-reconcile-context',primary),error=>error===pauseError);
 assert.equal(f.ledger.state().controls.reason,'financial maintenance unavailable; preserve records and close entries');assert.equal(f.ledger.state().controls.entriesEnabled,false);
 const safety=f.bridge.trader.entryReadinessSafety();assert.equal(safety.financialAvailable,false);assert.equal(safety.evidenceAvailable,false);assert.equal(safety.automaticRecoveryAllowed,false);
 assert.equal(f.bridge.trader.financialMaintenanceFailureDiagnostics()?.errorSha256,createHash('sha256').update(primary.message).digest('hex'));
});

test('readiness diagnostics expose the existing provenance refusal without another scan or state change',t=>{
 const f=fixture(t,false,true);assert.equal(f.refresh().recovered,true);
 f.at++;f.ledger.pause('trader:pause:'+f.ledger.state().revision+':'+f.at,f.at,'financial maintenance unavailable; preserve records and close entries');
 f.at++;f.ledger.pause('execution-recovery:'+f.ledger.accountId+':'+f.ledger.state().revision,f.at,'execution startup: fresh reconciliation/readiness required');
 const restarted=f.make(),before=f.ledger.state(),original=f.ledger.operatingFinancialRecoveryAllowed.bind(f.ledger);let scans=0;
 f.ledger.operatingFinancialRecoveryAllowed=((...args:Parameters<PaperLedger['operatingFinancialRecoveryAllowed']>)=>{scans++;return original(...args);})as PaperLedger['operatingFinancialRecoveryAllowed'];
 assert.equal(restarted.maintainOperatingFinancialReadiness(f.price).recovered,false);
 for(let i=0;i<3;i++)assert.deepEqual(restarted.operatingReadinessDiagnostics(),{at:f.at,stateRevision:before.revision,reasonCode:'OPERATING_READINESS_CONTROL_PROVENANCE_UNAVAILABLE'});
 assert.equal(scans,1);assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});
});

test('recorder failure after permission recovery closes controls and preserves the evidence latch',t=>{
 const f=fixture(t);f.recordFailure=true;assert.equal(f.refresh().recovered,false);assert.equal(f.projection().entriesEnabled,false);assert.equal(f.bridge.trader.entryReadinessSafety().evidenceAvailable,false);f.recordFailure=false;assert.equal(f.refresh().recovered,false);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'0');
});

test('nonthrowing recovery recorder that revokes current admission cannot report a successful recovery',t=>{
 const f=fixture(t),original=f.bridge.trader.recordFinancialReadiness.bind(f.bridge.trader);f.bridge.trader.recordFinancialReadiness=data=>{const retained=original(data);f.admission=false;f.bridge.trader.pauseNewEntries('operating evidence unavailable; incomplete candidates blocked; financial journal and exposure retained');return retained;};assert.equal(f.refresh().recovered,false);assert.equal(f.projection().entriesEnabled,false);assert.equal(f.bridge.trader.entryReadinessSafety().automaticRecoveryAllowed,false);assert.deepEqual(f.ledger.state().pending,{});
});

test('a terminal failed entry cannot release cash maintenance while its actual execution adapter remains unsettled',async t=>{
 const f=fixture(t);f.refresh();let release!:(value:null)=>void;f.executionRead=async()=>new Promise<null>(r=>release=r);f.ledger.order({id:'OFFLINE unsettled',mint:f.mint,side:'buy',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+1100,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'OFFLINE unsettled physical adapter'},f.price!,{});f.at+=1000;f.price={...f.price!,at:f.at};await f.bridge.protection();assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'7000');assert.equal(f.bridge.trader.entryReadinessSafety().idle,false);assert.equal(f.blocker(),NATIVE_PAPER_ENTRY_BLOCKERS.uncertainty);const before=f.ledger.state();assert.equal(f.refresh().kind,'busy');assert.deepEqual(f.ledger.state(),before);release(null);await new Promise<void>(r=>setImmediate(r));assert.equal(f.bridge.trader.entryReadinessSafety().idle,true);f.refresh();assert.equal(f.ledger.state().executionCosts,'7000');assert.deepEqual(f.ledger.state().positions,{});
});

test('slow reconciliation never backdates the resume after the actual two-second deadline',t=>{
 const f=fixture(t),original=f.ledger.reconcile.bind(f.ledger);f.ledger.reconcile=((...args:Parameters<PaperLedger['reconcile']>)=>{const result=original(...args);f.at+=2001;return result;})as PaperLedger['reconcile'];assert.equal(f.refresh().recovered,false);assert.equal(f.projection().entriesEnabled,false);assert.equal(f.blocker(),NATIVE_PAPER_ENTRY_BLOCKERS.reconciliationStale);assert.ok(!f.rows.some(r=>r.kind==='native-paper-financial-readiness-recovered'));
});

test('hard failure after a soft pause is durable across restart instead of hiding behind the old soft reason',t=>{
 const f=fixture(t);f.refresh();f.price=null;f.refresh();assert.match(f.ledger.state().controls.reason,/current equity/);f.bridge.trader.pauseNewEntries('PAPER protection unavailable; exposure retained');const reason=f.ledger.state().controls.reason,revision=f.ledger.state().revision;f.bridge.trader.pauseNewEntries(reason);assert.equal(f.ledger.state().revision,revision,'hard-pause deduplication prevents per-loop journal writes');assert.match(reason,/PAPER protection unavailable/);const restarted=f.make();f.price={at:f.at,microUsdPerSol:'100000000',source:'OFFLINE recovered USD'};assert.equal(restarted.maintainFlatFinancialReadiness(f.price).recovered,false);assert.equal(f.ledger.state().controls.reason,reason);assert.equal(restarted.trader.entryReadinessSafety().automaticRecoveryAllowed,false);
});

test('a recorded hard restriction cannot be laundered by complete candidate preparation',async t=>{
 const f=fixture(t,true);f.bridge.trader.pauseNewEntries('monitoring capacity unavailable for new risk');const reason=f.ledger.state().controls.reason;assert.equal(f.refresh().recovered,false);assert.equal(f.bridge.trader.entryReadinessSafety().automaticRecoveryAllowed,false);assert.equal((await f.bridge.candidate(f.mint,true)).kind,'entry-permission-refused');assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});assert.equal(f.bridge.trader.entryReadinessSafety().automaticRecoveryAllowed,false);assert.equal(f.ledger.state().controls.reason,reason);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'0');
});

test('cash maintenance continues during source waits, defers financial ownership, and measures true synchronous lateness',async t=>{
 const f=fixture(t);f.refresh();let busy=false,elapsed=0,cpu=0;const maintenance=new NativePaperCashMaintenance({now:()=>f.at,monotonic:()=>elapsed,cpu:()=>cpu,busy:()=>busy,lastReconciledAt:()=>f.ledger.state().daily.reconciledAt,refresh:()=>{elapsed+=3;cpu+=150;return f.refresh();}});let release!:()=>void,finished=false;const source=new Promise<void>(r=>release=r).then(()=>{finished=true;});
 for(let n=0;n<8;n++){f.at+=1000;if(f.at-f.price!.at>=5000)f.price={...f.price!,at:f.at};maintenance.run();await Promise.resolve();assert.equal(finished,false);assert.equal(f.projection().entriesEnabled,true);}assert.equal(maintenance.usage().reconciled,8);assert.equal(maintenance.usage().deadlineMisses,0);assert.equal(maintenance.usage().maximumElapsedMs,3);assert.equal(maintenance.usage().cpuMicros,1200);
 f.at+=3001;f.price={...f.price!,at:f.at};maintenance.run();assert.equal(maintenance.usage().deadlineMisses,1);assert.equal(maintenance.usage().maximumLatenessMs,2001);busy=true;f.at+=1000;const revision=f.ledger.state().revision;maintenance.run();assert.equal(f.ledger.state().revision,revision);assert.equal(maintenance.usage().busyDeferrals,1);busy=false;f.at+=2001;f.price={...f.price!,at:f.at};maintenance.run();assert.equal(maintenance.usage().deadlineMisses,1,'intentional financial ownership is not scheduler debt');release();await source;assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});
});

test('actual maintenance timer contains unexpected callback failure and keeps retry bounded',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let at=1000,failures=0,calls=0;const error=Error('OFFLINE timer failure'),seen:unknown[]=[];const maintenance=new NativePaperCashMaintenance({now:()=>at,busy:()=>false,lastReconciledAt:()=>0,refresh:()=>{calls++;throw error;}});const timer=maintenance.start(cause=>{failures++;seen.push(cause);});t.after(()=>clearInterval(timer));t.mock.timers.tick(250);assert.equal(failures,1);assert.equal(calls,1);for(let i=0;i<3;i++){at+=250;t.mock.timers.tick(250);}assert.equal(calls,1);at+=250;t.mock.timers.tick(250);assert.equal(calls,2);assert.equal(failures,2);assert.equal(maintenance.usage().financialFailures,2);assert.deepEqual(seen,[error,error]);
});

test('old startup reconciliation and known FX-unavailable intervals are not maintenance deadline misses',t=>{
 const f=fixture(t);f.refresh();f.at+=600000;f.price={...f.price!,at:f.at};const maintenance=new NativePaperCashMaintenance({now:()=>f.at,busy:()=>false,lastReconciledAt:()=>f.ledger.state().daily.reconciledAt,refresh:()=>f.refresh()});maintenance.run();assert.equal(maintenance.usage().deadlineMisses,0);assert.equal(maintenance.usage().maximumLatenessMs,0);assert.equal(maintenance.usage().healthyMaintenanceArmed,true);f.price=null;for(let i=0;i<3;i++){f.at+=5000;maintenance.run();}assert.equal(maintenance.usage().unavailable,3);assert.equal(maintenance.usage().deadlineMisses,0);assert.equal(maintenance.usage().healthyMaintenanceArmed,false);f.price={at:f.at,microUsdPerSol:'100000000',source:'OFFLINE recovered FX'};f.at+=1000;maintenance.run();assert.equal(maintenance.usage().deadlineMisses,0);assert.equal(maintenance.usage().healthyMaintenanceArmed,true);f.at+=3000;maintenance.run();assert.equal(maintenance.usage().deadlineMisses,1,'a genuinely late healthy subsequent refresh is an operational miss');
});

test('backup failure retries at the bounded next attempt rather than waiting five minutes; success restores the normal cadence',()=>{
 const lastSuccessfulAt=1000000,failedAt=1300000,nextAttemptAt=failedAt+1000;assert.equal(nativePaperBackupDue({at:failedAt,pending:false,nextAttemptAt,lastSuccessfulAt}),false);assert.equal(nativePaperBackupDue({at:nextAttemptAt,pending:false,nextAttemptAt,lastSuccessfulAt}),true);assert.equal(nativePaperBackupDue({at:nextAttemptAt,pending:true,nextAttemptAt,lastSuccessfulAt}),false);assert.equal(nativePaperBackupDue({at:nextAttemptAt+1,pending:false,nextAttemptAt:0,lastSuccessfulAt:nextAttemptAt}),false);assert.equal(nativePaperBackupDue({at:nextAttemptAt+300000,pending:false,nextAttemptAt:0,lastSuccessfulAt:nextAttemptAt}),true);
});

test('verified backup recovery unlocks temporary readiness only after success and a current audited cutoff',t=>{
 const f=fixture(t);f.refresh();f.bridge.trader.pauseNewEntries('consistent backup unavailable; exposure retained');f.admission=false;assert.equal(f.refresh().recovered,false);const failedAt=f.at,nextAttemptAt=failedAt+1000;f.at=nextAttemptAt-1;assert.equal(nativePaperBackupDue({at:f.at,pending:false,nextAttemptAt,lastSuccessfulAt:failedAt-300000}),false);f.at=nextAttemptAt;assert.equal(nativePaperBackupDue({at:f.at,pending:false,nextAttemptAt,lastSuccessfulAt:failedAt-300000}),true);f.admission=true;assert.equal(f.refresh().recovered,true);assert.equal(f.projection().entriesEnabled,true);assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});assert.deepEqual(f.ledger.state().pending,{});
});

test('actual interval runs local maintenance while an awaited source operation is unsettled',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const f=fixture(t);f.refresh();let settled=false,release!:()=>void;const source=new Promise<void>(r=>release=r).then(()=>{settled=true;});let failures=0;const maintenance=new NativePaperCashMaintenance({now:()=>f.at,busy:()=>false,lastReconciledAt:()=>f.ledger.state().daily.reconciledAt,refresh:()=>f.refresh()});const timer=maintenance.start(()=>failures++);t.after(()=>clearInterval(timer));for(let i=0;i<24;i++){f.at+=250;if(f.at-f.price!.at>=5000)f.price={...f.price!,at:f.at};t.mock.timers.tick(250);await Promise.resolve();assert.equal(settled,false);assert.equal(f.projection().entriesEnabled,true);}assert.equal(maintenance.usage().reconciled,6);assert.equal(maintenance.usage().deadlineMisses,0);assert.equal(failures,0);assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});release();await source;
});

test('current derived source/provider/monitoring restrictions remain distinct from unchanged durable permission',t=>{
 const f=fixture(t);f.refresh();const state=f.ledger.state(),projection=f.projection(),safety=f.bridge.trader.entryReadinessSafety(),input={at:f.at,state,projection,safety},b=NATIVE_PAPER_ENTRY_BLOCKERS;
 assert.equal(nativePaperDerivedEntryBlocker({...input,manualPaused:true}),b.manual);assert.equal(nativePaperDerivedEntryBlocker({...input,manualPaused:true,safeStopRequested:true}),b.stop);assert.equal(nativePaperDerivedEntryBlocker({...input,providerAvailable:false}),b.provider);assert.equal(nativePaperDerivedEntryBlocker({...input,sourceAvailable:false}),b.source);assert.equal(nativePaperDerivedEntryBlocker({...input,monitoringAvailable:false}),b.monitoring);assert.equal(nativePaperDerivedEntryBlocker({...input,candidateEvidenceReady:false}),null,'normal candidate warming is not a withdrawal of financial permission');assert.equal(nativePaperDerivedEntryBlocker({...input,evidenceAvailable:false}),b.evidence);assert.equal(nativePaperDerivedEntryBlocker({...input,safety:{...safety,idle:false}}),b.uncertainty);assert.deepEqual(f.ledger.state(),state,'reporting never writes a financial pause or changes balances');assert.equal(projection.entriesEnabled,true);
});

test('explicit owner daily-loss reset recovers through ordinary fresh audited readiness without fabricating a qualification',t=>{
 const f=fixture(t);f.refresh();assert.equal(f.projection().entriesEnabled,true);f.at+=1000;f.price={at:f.at,microUsdPerSol:'94000000',source:'OFFLINE observed USD decline'};f.refresh();assert.equal(f.blocker(),NATIVE_PAPER_ENTRY_BLOCKERS.loss);
 const before=f.ledger.state(),calls={...f.calls};const result=ownerDailyLossReset({ledger:f.ledger,requestId:'owner-daily-loss-reset-20261029',authorizedDay:'2026-10-29',source:{commit:'a'.repeat(40),sha256:'b'.repeat(64)},runId:'OFFLINE-owner-reset',price:f.price,safety:f.bridge.trader.entryReadinessSafety(),work:'source',pauseForReadiness:()=>f.bridge.trader.pauseNewEntries('execution startup: fresh reconciliation/readiness required'),now:f.at});
 assert.equal(result.ok,true);assert.equal(result.resetApplied,true);assert.equal(f.ledger.state().daily.lossPaused,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.deepEqual(f.calls,calls);
 f.certificateAvailable=false;assert.equal(f.refresh().recovered,false);assert.equal(f.projection().entriesEnabled,false);
 f.certificateAvailable=true;assert.equal(f.refresh().recovered,true);assert.equal(f.projection().entriesEnabled,true);assert.deepEqual(f.calls,calls);
 assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().realizedLamports,before.realizedLamports);assert.equal(f.ledger.state().initialMicroUsd,before.initialMicroUsd);assert.equal(f.ledger.state().inceptionAt,before.inceptionAt);
});

test('controlled arming boundary distinguishes valid audited decision windows from two-second general-permission cutoff',async t=>{
 for(const ageMs of[1500,3000])await t.test(String(ageMs)+'ms original audited cutoff',st=>{
  const f=fixture(st);f.at+=ageMs;f.price={...f.price!,at:f.at};
  const features=f.bridge.trader.candidateFeatures(f.mint,f.at)!;
  assert.equal(features.windowEndAt,f.base+60000);
  assert.equal(f.bridge.ready(f.mint,f.at),true,'original complete audited certificate remains valid inside its decision deadline');
  assert.notEqual(assessPredictiveBuying(features,f.at).status,'not-rejected','a predictive pass is not required for general permission');
  const result=f.refresh();assert.equal(result.kind,'reconciled');
  assert.equal(f.ledger.state().daily.reconciledAt,f.at,'the financial reconciliation itself is genuinely current');
  assert.equal(f.bridge.valuation().price!.at,f.at,'the USD observation itself is genuinely current');
  assert.equal(result.recovered,ageMs<=2000,'current policy separately constrains the original market window end');
  assert.equal(f.projection().entriesEnabled,ageMs<=2000);
  assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.ledger.state().positions,{});
 });
});


test('selected operating mode recovers financial permission without fabricating a candidate window or predictive pass',t=>{
 const f=fixture(t,false,true);f.certificateAvailable=false;f.at+=3000;f.price={...f.price!,at:f.at};assert.equal(f.bridge.ready(f.mint),false);assert.equal(f.refresh().recovered,true);assert.equal(f.projection().entriesEnabled,true);
 const event=f.rows.find(r=>r.kind==='native-paper-financial-readiness-recovered')!.data;assert.equal(event.financialPermissionOnly,true);assert.equal(event.candidateWindowClaimed,false);assert.equal(event.entryQuoteClaimed,false);assert.equal(event.orderCreated,false);assert.equal(Object.hasOwn(event,'windowEndAt'),false);assert.equal(event.source.bankClockAt,f.base+60000);assert.equal(event.source.receivedAt,f.base+60000);assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});assert.deepEqual(f.ledger.state().pending,{});
});

test('operating financial permission requires real connected source Clock and preserves owner and protection stops',async t=>{
 for(const gate of ['connection','clock','owner','protection']as const)await t.test(gate,st=>{
  const f=fixture(st,false,true);if(gate==='connection')f.connected=false;if(gate==='clock')f.bankClockAt=f.base+29000;if(gate==='owner')f.ledger.pause('OFFLINE actual owner',f.at,'operator paused new entries');if(gate==='protection')f.bridge.trader.pauseNewEntries('completed PAPER protection gap exceeded research boundary');
  assert.equal(f.refresh().recovered,false);assert.equal(f.projection().entriesEnabled,false);assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});
 });
});

test('known current protection controls have a precise blocker without using historical breach counts or clearing the stop',t=>{
 const f=fixture(t);f.refresh();f.bridge.trader.pauseNewEntries('completed PAPER protection gap exceeded research boundary');const before=f.ledger.state();assert.equal(f.blocker(),'POE_ENTRY_PROTECTION_RECOVERY_REQUIRED');assert.deepEqual(f.ledger.state(),before);
 const input={at:f.at,state:before,projection:f.projection(),safety:f.bridge.trader.entryReadinessSafety()};assert.equal(nativePaperDerivedEntryBlocker({...input,safeStopRequested:true}),NATIVE_PAPER_ENTRY_BLOCKERS.stop);assert.equal(nativePaperDerivedEntryBlocker({...input,providerAvailable:false}),NATIVE_PAPER_ENTRY_BLOCKERS.provider);assert.equal(nativePaperDerivedEntryBlocker({...input,sourceAvailable:false}),NATIVE_PAPER_ENTRY_BLOCKERS.source);
});


test('flat technical recovery counts new cash reconciliations and original USD times rather than invented held evaluations',t=>{
 const f=fixture(t,false,true);assert.equal(f.refresh().recovered,true);f.bridge.trader.pauseNewEntries('completed PAPER protection gap exceeded research boundary');
 for(let n=0;n<60;n++){f.at+=1000;f.price={...f.price!,at:f.at};f.bankClockAt=f.at;f.supportAt=f.at;assert.equal(f.refresh().recovered,false);}
 f.at+=1000;f.price={...f.price!,at:f.at};f.bankClockAt=f.at;f.supportAt=f.at;assert.equal(f.refresh().recovered,true);assert.equal(f.projection().entriesEnabled,true);assert.equal(f.bridge.trader.entryReadinessSafety().newHardPauseObserved,false);
 const event=f.rows.filter(r=>r.kind==='native-paper-financial-readiness-recovered'&&r.data.technicalProtectionRecovery).at(-1)!.data;assert.deepEqual(event.positionUnits,{});assert.equal(event.technicalProtectionRecovery.lastQuoteAt,f.price!.at);assert.equal(event.candidateWindowClaimed,false);assert.equal(f.rows.filter(r=>r.kind==='trader-held-evaluation').length,0);assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});
});

test('runtime resource pauses recover only with fresh financial/source admission and survive an ordinary restart',async t=>{
 for(const reason of ['resource pressure; new candidate risk closed','rolling resource or evidence pressure; exposure retained'])await t.test(reason,async st=>{
  for(const gate of ['healthy','admission','connection','clock','usd','restart']as const)await st.test(gate,tt=>{
   const f=fixture(tt,false,true);assert.equal(f.refresh().recovered,true);f.bridge.trader.pauseNewEntries(reason);const before=f.ledger.state();
   assert.equal(before.controls.entriesEnabled,false);assert.equal(f.bridge.trader.entryReadinessSafety().automaticRecoveryAllowed,true);
   if(gate==='admission')f.admission=false;if(gate==='connection')f.connected=false;if(gate==='clock')f.bankClockAt=f.base+29000;if(gate==='usd')f.price={...f.price!,at:f.at-10001};
   const bridge=gate==='restart'?f.make():f.bridge,result=bridge.maintainFlatFinancialReadiness(f.price);
   assert.equal(result.recovered,gate==='healthy'||gate==='restart');assert.equal(f.ledger.state().controls.entriesEnabled,gate==='healthy'||gate==='restart');
   assert.equal(f.ledger.state().lamports,before.lamports);assert.equal(f.ledger.state().realizedLamports,before.realizedLamports);assert.deepEqual(f.ledger.state().pending,{});
   assert.ok(f.ledger.exportJournal(100).some(row=>(row as any).kind==='pause'&&JSON.parse((row as any).detail).reason===reason));
   assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});
  });
 });
});

test('resource wording cannot clear an owner action, unknown hard failure or safe stop across restart',async t=>{
 for(const gate of ['owner','unknown','stop']as const)await t.test(gate,st=>{
  const f=fixture(st,false,true);assert.equal(f.refresh().recovered,true);const reason='resource pressure; new candidate risk closed';
  if(gate==='owner')f.ledger.pause('operator-pause:OFFLINE-copied-resource-wording',f.at,reason);
  if(gate==='unknown')f.bridge.trader.pauseNewEntries('OFFLINE unknown hard financial failure');
  if(gate==='stop')f.ledger.safeStop('operator-stop:OFFLINE-resource-stop',f.at);
  f.bridge.trader.pauseNewEntries(reason);const before=f.ledger.state();assert.equal(f.refresh().recovered,false);
  const restarted=f.make();assert.equal(restarted.maintainFlatFinancialReadiness(f.price).recovered,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
  assert.equal(f.ledger.state().controls.stopRequested,before.controls.stopRequested);assert.equal(f.ledger.state().lamports,before.lamports);assert.deepEqual(f.ledger.state().pending,before.pending);
 });
});

test('resource recovery preserves an unresolved protective exit and refuses cash-only permission',t=>{
 const f=fixture(t,false,true);assert.equal(f.refresh().recovered,true);
 f.ledger.order({id:'OFFLINE resource held setup',mint:f.mint,side:'buy',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'OFFLINE existing position setup'},f.price!,{});
 f.at+=1000;f.price={...f.price!,at:f.at};assert.equal(f.ledger.attempt('OFFLINE resource held fill','OFFLINE resource held setup',f.at,{at:f.at,spendLamports:'10000000',receiveUnits:'1000',evidence:'OFFLINE actual-size fixture fill'},f.price).status,'filled');
 const marks={[f.mint]:{at:f.at,netLamports:'10000000',pricedBaseUnits:'1000',evidence:'OFFLINE actual-size held liquidation'}};
 f.ledger.reconcile('OFFLINE resource held reconcile',f.at,f.price!,marks);
 f.ledger.order({id:'OFFLINE unresolved protective exit',mint:f.mint,side:'sell',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE unresolved exact-size exit'},f.price!,marks);
 f.bridge.trader.pauseNewEntries('resource pressure; new candidate risk closed');const before=f.ledger.state();
 assert.equal(f.refresh().kind,'busy');assert.equal(f.bridge.maintainOperatingFinancialReadiness(f.price).kind,'busy');assert.deepEqual(f.ledger.state(),before);assert.ok(f.ledger.state().pending['OFFLINE unresolved protective exit']);
});

test('inherited reporting-overrun pause resumes only after a later successful bounded projection and fresh finance',t=>{
 const f=fixture(t,false,true),health=new NativePaperReportingHealth(),refresh=()=>{f.admission=health.entryAllowed;return f.refresh();};
 assert.equal(refresh().recovered,false);health.observe(50,true);assert.equal(refresh().recovered,true);
 f.at++;f.ledger.pause('trader:pause:'+f.ledger.state().revision+':'+f.at,f.at,OPERATIONAL_REPORTING_ENTRY_PAUSE);
 f.at++;f.ledger.pause('execution-recovery:'+f.ledger.accountId+':'+f.ledger.state().revision,f.at,'execution startup: fresh reconciliation/readiness required');
 f.at++;f.ledger.pause('trader:restore-hard-pause:'+f.ledger.state().revision+':'+f.at,f.at,OPERATIONAL_REPORTING_ENTRY_PAUSE);
 const before=f.ledger.state(),restarted=f.make(),restartRefresh=()=>{f.admission=health.entryAllowed;return restarted.maintainFlatFinancialReadiness(f.price);};
 health.observe(251,true);assert.equal(restartRefresh().recovered,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
 health.observe(10,false);assert.equal(restartRefresh().recovered,false);health.observe(NaN,true);assert.equal(restartRefresh().recovered,false);
 health.observe(75,true);f.connected=false;assert.equal(restartRefresh().recovered,false);f.connected=true;assert.equal(restartRefresh().recovered,true);
 assert.equal(f.ledger.state().lamports,before.lamports);assert.equal(f.ledger.state().realizedLamports,before.realizedLamports);assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});
 assert.equal(f.ledger.exportJournal(100).filter(row=>(row as any).kind==='pause'&&JSON.parse((row as any).detail).reason===OPERATIONAL_REPORTING_ENTRY_PAUSE).length,2,'both original and restored failure records remain');
 assert.deepEqual(f.calls,{context:0,preparation:0,quote:0,execution:0});
});

test('healthy reporting cannot launder owner wording, mixed hard controls or an unproved restored reporting pause',async t=>{
 for(const gate of ['owner-before','unknown-before','owner-after','stop','unproved-restore','financial-uncertainty']as const)await t.test(gate,st=>{
  const f=fixture(st,false,true),health=new NativePaperReportingHealth();health.observe(10,true);assert.equal(f.refresh().recovered,true);
  if(gate==='owner-before')f.ledger.pause('operator-pause:OFFLINE-report-owner',f.at,OPERATIONAL_REPORTING_ENTRY_PAUSE);
  if(gate==='unknown-before')f.bridge.trader.pauseNewEntries('OFFLINE unknown hard financial failure');
  if(gate!=='unproved-restore')f.ledger.pause('trader:pause:'+f.ledger.state().revision+':'+f.at,f.at,OPERATIONAL_REPORTING_ENTRY_PAUSE);
  f.ledger.pause('execution-recovery:'+f.ledger.accountId+':'+f.ledger.state().revision,f.at,'execution startup: fresh reconciliation/readiness required');
  f.ledger.pause('trader:restore-hard-pause:'+f.ledger.state().revision+':'+f.at,f.at,OPERATIONAL_REPORTING_ENTRY_PAUSE);
  if(gate==='owner-after')f.ledger.pause('operator-pause:OFFLINE-report-later-owner',f.at,'operator paused new entries');
  if(gate==='stop')f.ledger.safeStop('operator-stop:OFFLINE-report-stop',f.at);
  if(gate==='financial-uncertainty')f.bridge.trader.financialMaintenanceFailed();
  const before=f.ledger.state(),restarted=f.make();f.admission=health.entryAllowed;
  assert.equal(restarted.maintainFlatFinancialReadiness(f.price).recovered,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.ledger.state().controls.stopRequested,before.controls.stopRequested);
  assert.equal(f.ledger.state().lamports,before.lamports);assert.deepEqual(f.ledger.state().positions,before.positions);assert.deepEqual(f.ledger.state().pending,before.pending);
 });
});
