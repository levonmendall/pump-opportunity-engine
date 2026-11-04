/** DISPOSABLE OFFLINE publication fixture. Only the temporary files created
 * here are financial writers. No production account, provider or publisher is
 * opened. Original identity values exercise the unchanged reporting binding;
 * none of the synthetic balances, marks or trades is runtime evidence. */
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,chmodSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {prepareV3ReportingAccount,reportingFixturePrice,retainFixtureFills} from './fixtures/reporting-v3-account.js';
import {Worker} from 'node:worker_threads';
import {NativeMarketIntake,NATIVE_MARKET_INTAKE_POLICY} from '../src/native-market-intake.js';
import ts from 'typescript';
import Database from 'better-sqlite3';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import * as runtime from '../src/run-native-paper.js';
import {PaperLedger,type Mark} from '../src/ledger.js';
import {PaperTrader} from '../src/trader.js';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner,type NativeRunnerOptions} from '../src/native-candidate-runner.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {NativePaperReportTimings,NATIVE_PAPER_REPORT_PHASES} from '../src/native-paper-reporting-timing.js';
import {NativeOperatingCycles} from '../src/native-operating-cycles.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {NativeProtectionDispatch} from '../src/native-protection-dispatch.js';
import {projectPilotFilledTrades} from '../src/pilot-reporting.js';
import {writePoePublicStatus} from '../src/public-status.js';
import {writePoeStorageRetentionReport} from '../src/storage-retention-reporting.js';
import {MIGRATION_AGE_POLICY} from '../src/migration-age-policy.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';

const AT=Date.parse('2026-11-03T15:00:00Z'),DAY=86400000,MINT='11111111111111111111111111111111';
// The isolated release check matches the observed November 3 retained load:
// 198,878 market identities, 80,701 watch identities and 11,564 pending origins.
// Ordinary parallel tests retain a smaller correctness fixture; never describe
// those timings as production-scale publication evidence.
const representative=process.env.POE_FULL_PUBLICATION_BENCHMARK==='1',retainedIdentities=representative?200000:10000,watchIdentities=representative?81000:10000,verificationBacklog=representative?12000:0;
const sourceUrl=new URL('../src/run-native-paper.ts',import.meta.url),sourceText=readFileSync(sourceUrl,'utf8');
const parsed=ts.createSourceFile('run-native-paper.ts',sourceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);

/** Run the real closed-over report/checkpoint code in this realm, with explicit
 * offline owners. Import bindings and local atomic implementation come from
 * the actual source, so adding a report phase cannot silently bypass this test. */
async function reportingBindings(){
 const bindings:Record<string,unknown>={...runtime};
 for(const statement of parsed.statements){
  if(!ts.isImportDeclaration(statement)||!statement.importClause||statement.importClause.isTypeOnly)continue;
  const clause=statement.importClause,named=clause.namedBindings;if(!named||!ts.isNamedImports(named))continue;
  const requested=named.elements.filter(e=>!e.isTypeOnly);if(!requested.length)continue;
  const specifier=(statement.moduleSpecifier as ts.StringLiteral).text;
  const module=await import(specifier.startsWith('.')?new URL(specifier.replace(/\.js$/,'.ts'),sourceUrl).href:specifier);
  for(const item of requested)bindings[item.name.text]=module[item.propertyName?.text??item.name.text];
 }
 const local=parsed.statements.filter(statement=>ts.isFunctionDeclaration(statement)&&['need','atomic'].includes(statement.name?.text??'')||ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text==='hash')).map(s=>s.getText(parsed)).join('\n');
 const helpers=ts.transpileModule(local,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const fn=runtime.runNativePaper.toString();
 const extract=(start:string,end:string)=>{const begin=fn.search(new RegExp('const\\s+'+start+'\\s*=')),tail=fn.slice(begin),finish=tail.search(new RegExp(';\\s*const\\s+'+end+'\\s*='));assert.ok(begin>=0&&finish>0,'actual '+start+' closure present');return tail.slice(0,finish+1);};
 return {bindings,code:helpers+'\n'+extract('checkpoint','startBackup')+'\n'+extract('report','maybeReport')+'\nreturn {report,checkpoint,financialReady:()=>financialProjectionReady};'};
}

async function fixture(t:TestContext){
 let at=AT;const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-full-publication-')),root=join(dir,'private'),publicRoot=join(dir,'public'),runDir=join(root,'run');mkdirSync(root,{mode:0o700});mkdirSync(runDir,{mode:0o700});mkdirSync(publicRoot,{mode:0o755});chmodSync(publicRoot,0o755);
 const registry=new MarketRegistry(join(root,'market-registry.sqlite'),{now:()=>at,migrationAge:true,concurrentIntake:true}),ledger=new PaperLedger(join(root,'fixture-financial.sqlite'),POE_OPERATING_ACCOUNT.accountId);
 let intake:NativeMarketIntake|undefined;const fixtureClock=new SharedArrayBuffer(8),clock=new BigInt64Array(fixtureClock);Atomics.store(clock,0,BigInt(at));
 t.after(async()=>{await intake?.close();ledger.close();registry.close();rmSync(dir,{recursive:true,force:true});});t.mock.method(Date,'now',()=>at);
 const price=reportingFixturePrice,currentPrice=price(AT-1000);
 const financialFixture=await prepareV3ReportingAccount(ledger,join(root,'OFFLINE-epoch-backups'),AT,MINT);
 const marks:Record<string,Mark>={[MINT]:{at:AT-1000,pricedBaseUnits:'1000',netLamports:'470000000',evidence:'OFFLINE synthetic actual-size liquidation'}};
 for(let n=0;n<60;n++)ledger.reconcile('fixture-retained-reconciliation-'+n,AT-1000+n,price(AT-1000),marks);
 const refreshFinance=()=>{Object.assign(currentPrice,price(at-1000));for(const mark of Object.values(marks))mark.at=at-1000;ledger.reconcile('fixture-publication-context:'+at,at,currentPrice,marks);};
 refreshFinance();
 const financialPrefix=()=>{const db=new Database(join(root,'fixture-financial.sqlite'),{readonly:true,fileMustExist:true});try{return createHash('sha256').update(JSON.stringify({state:db.prepare('SELECT * FROM financial_state ORDER BY singleton').all(),actions:db.prepare('SELECT * FROM actions ORDER BY id').all(),journal:db.prepare('SELECT * FROM journal ORDER BY revision').all()})).digest('hex');}finally{db.close();}};


 const fail=()=>{throw Error('OFFLINE_PUBLICATION_TRANSPORT_FORBIDDEN');},nativeUsage=()=>({dataContract:'confirmed-program-activity-v3-shadow',connected:true,stopped:false,fatal:null,physicalTransportsSettled:true,candidates:0,retiring:0,nextServiceAt:at+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat',lastNotificationAt:AT-500,lastFreshSupportAt:AT-500,lastBankClockAt:AT-1000,queueAgeMs:{maximum:0},receivedBoundNotifications:0,sharedOperationActive:false,nativePhysicalOperations:0});
 const flow={usage:nativeUsage,snapshot:()=>null,addCandidate:fail,removeCandidate:fail,notificationLedger:fail,requestSupportRefresh:fail,requestHeartbeat:fail,service:fail,stop:fail} as unknown as NativeRunnerOptions['flow'];
 const rpcUsage=()=>({chapter:1,newUnits:100,maximumNewUnits:10000,newAccountedResponseBytes:100000,maximumNewResponseBytes:10000000,inFlight:0,waitingOrOperating:false,closed:false,fatal:null,cooldownUntil:0,requestLimits:{maxStartsPerMinute:90,maxStartsPer10s:20},chapterUsage:{rolling60SecondStarts:4,rolling10SecondStarts:1},dispatchWindow:{readyAt:at,physicalBusy:false,waitMs:0},rpcDispatchWindow:{readyAt:at,physicalBusy:false,waitMs:0},controlDispatchWindow:{readyAt:at,physicalBusy:false,waitMs:0},protectionRecovery:{providerRestrictionUntil:0,rolling60SecondStarts:0,rolling10SecondStarts:0}});
 const rpc={usage:rpcUsage,cooldownUntil:()=>0,available:()=>true,call:fail} as unknown as NativeRunnerOptions['rpc'];
 const runId='offline-full-publication',startedAt=AT-600000;
 // Build the existing owner before bulk retained-load staging, then start its
 // real worker. This forwarding object changes no result or reporting policy.
 const intakeOwner={registryReporting:(...args:Parameters<NativeMarketIntake['registryReporting']>)=>intake!.registryReporting(...args),observeIdentity:(...args:Parameters<NativeMarketIntake['observeIdentity']>)=>intake!.observeIdentity(...args),observeActivity:(...args:Parameters<NativeMarketIntake['observeActivity']>)=>intake!.observeActivity(...args),observeFeed:(...args:Parameters<NativeMarketIntake['observeFeed']>)=>intake!.observeFeed(...args),observeMigration:(...args:Parameters<NativeMarketIntake['observeMigration']>)=>intake!.observeMigration(...args),observeQualification:(...args:Parameters<NativeMarketIntake['observeQualification']>)=>intake!.observeQualification(...args)};
 const runner=new NativeCandidateRunner({registry,flow,rpc,marketIntake:intakeOwner,runId,maximumDeep:4,enforceMigrationAge:true,pumpswapOnly:true,activeStrategy:'liquidity-resilient-momentum-v3.1',observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:()=>{}});
 const base=runner.watch.discover({signature:'OFFLINE-base',receivedAt:AT-3*DAY})!,db=(registry as unknown as {db:Database.Database}).db;
 registry.transaction(()=>{for(let n=0;n<watchIdentities;n++){
  const current=n<150,when=current?AT-300000:AT-3*DAY,bytes=Buffer.alloc(32);bytes.writeUInt32LE(n+1);
  const mint=current?new PublicKey(bytes).toBase58():'OFFLINE-mint-'+n,pool=current?canonicalPumpPoolPda(new PublicKey(mint)).toBase58():'OFFLINE-pool-'+n;
  registry.put({...base,signature:'OFFLINE-retained-'+String(n).padStart(5,'0'),mint,pool,state:'DEFERRED',migrationAt:when,verifiedAt:when+1,waitingSince:AT-10000,history:Array.from({length:16},(_,i)=>({at:AT-2*DAY+i,state:'DEFERRED',reason:'OFFLINE retained history '+'.'.repeat(200)})),...(!current?{reobservation:{kind:'technical-unavailable',decisionAt:AT-1000,windowEndAt:null,evidence:'OFFLINE unavailable pool',minimumEconomicChangeLamports:null,baseline:null,ready:null}}:{})});
  if(current){const signatureBytes=Buffer.alloc(64);signatureBytes.writeUInt32LE(n+1);registry.putMigrationAgeProof({version:MIGRATION_AGE_POLICY.version,mint,pool,signature:bs58.encode(signatureBytes),slot:100,migrationAt:when,availableAt:when+1,confirmedTransactionSha256:'a'.repeat(64),finalizedTransactionSha256:'b'.repeat(64)});}
  else db.prepare('INSERT INTO pumpswap_migration_ages_v1 VALUES(?,?,?,?)').run(mint,when,when+1,'{}');
 }});
 registry.transaction(()=>{
  for(let n=watchIdentities;n<retainedIdentities;n++)registry.observeIdentity({mint:'OFFLINE-mint-'+n,at:AT-3*DAY,source:'pumpapi-broad',kind:'activity'});
  for(let n=0;n<verificationBacklog;n++)registry.enqueueVerification({signature:'OFFLINE-pending-origin-'+n,feedMint:'OFFLINE-mint-'+(watchIdentities+n),receivedAt:AT-3*DAY},0,{source:'pumpportal-migration',kind:'migration'});
 });
 // The bootstrap fixes only this disposable test's observation clock. It
 // passes the unchanged production options to the real intake worker function;
 // production has no test-clock option or alternative reporting implementation.
 const workerCode=`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();const {startMarketRegistryIntakeWorker}=await import(${JSON.stringify(new URL('../src/market-registry-intake-worker.ts',import.meta.url).href)});const {workerData}=await import('node:worker_threads');const {fixtureClock,...options}=workerData;const clock=new BigInt64Array(fixtureClock);Date.now=()=>Number(Atomics.load(clock,0));startMarketRegistryIntakeWorker(options);`;
 intake=new NativeMarketIntake({now:()=>at,createWorker:()=>new Worker(new URL('data:text/javascript,'+encodeURIComponent(workerCode)),{workerData:{path:registry.path,writerTurn:registry.writerTurnBuffer(),enforceMigrationAge:true,maximumComputeMs:NATIVE_MARKET_INTAKE_POLICY.workerComputeMs,pendingBytesBudget:NATIVE_MARKET_INTAKE_POLICY.pendingBytesBudget,writerYieldMs:NATIVE_MARKET_INTAKE_POLICY.writerYieldMs,fixtureClock},resourceLimits:{maxOldGenerationSizeMb:NATIVE_MARKET_INTAKE_POLICY.workerOldGenerationMiB,maxYoungGenerationSizeMb:32}}),onCommitted:()=>{},onPressure:()=>{}});
 const refreshRegistry=async(expected=retainedIdentities)=>{const until=performance.now()+15000;for(;;){const status=runner.status();if(status.registryReporting?.state==='FRESH'&&typeof status.registryReporting.observedAt==='number'&&status.registryReporting.observedAt>=at-1000&&status.marketCoverage.pipeline.population.retained===expected)return status;assert.ok(performance.now()<until,'actual worker summary unavailable: '+JSON.stringify({report:status.registryReporting,intake:intake!.usage()}));await new Promise<void>(resolve=>setTimeout(resolve,2));}};
 // Every subsequent publication must consume the worker result. Calling a
 // synchronous population/quantile fallback is a regression, even if fast.
 for(const key of ['coverageSnapshot','verificationStats','migrationAgeSummary','tokenAgeSummary','cohortCounts'] as const)t.mock.method(registry,key,fail);
 t.mock.method(runner.watch,'snapshot',fail);t.mock.method(runner.watch,'serviceableBacklog',fail);
 const trader=new PaperTrader({ledger,now:()=>at,context:async()=>({price:currentPrice,marks}),quote:async()=>null,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'OFFLINE publication fixture'},recorder:{record:()=>{}}});
 const bridge={trader,valuation:()=>({price:currentPrice,marks,sourceValidUntil:currentPrice.at+30000}),poolsForRecovery:()=>({}),internalShutdownDiagnostics:()=>null,operatingReadinessDiagnostics:()=>null,schedulingFollowupDiagnostics:()=>null,internalShutdownRefusals:()=>({})};
 const feedUsage=()=>({discoveryConnected:true,watchActivityConnected:true,physicalTransportsSettled:true,discovery:0,candidates:0});
 const reportTimings=new NativePaperReportTimings(),cycles=new NativeOperatingCycles(startedAt,runId);cycles.completed(MINT,'1000',AT-1000,AT-1000);
 const cashMaintenance=new runtime.NativePaperCashMaintenance({now:()=>at,busy:()=>true,lastReconciledAt:()=>ledger.state().daily.reconciledAt,refresh:fail});
 const financialRetention={status:()=>({})},manifest={accountId:ledger.accountId,inceptionAt:POE_OPERATING_ACCOUNT.inceptionAt,pools:{}};
 const {bindings,code}=await reportingBindings();
 const context:Record<string,unknown>={...bindings,__name:(f:unknown)=>f,Buffer,MIB:1024*1024,financialProjectionReady:false,engineStatus:()=>runner.status(),maintainCash:(bound:number)=>cashMaintenance.run(bound),currentLedger:ledger,currentBridge:bridge,reportTimings,currentRpc:rpc,feedUsage,lag:{percentile:()=>0},price:currentPrice,financialCapacityReason:()=>null,args:{strategy:'liquidity-resilient-momentum-v3.1',stage:'two',deepSlots:4,service:true},manualPaused:false,safeStopRequested:false,serviceEvidenceHealthy:true,serviceRecorder:{usage:()=>({candidateAdmissionAllowed:true})},marketIntake:intake,sharedMarketRegistry:registry,managementOnly:false,sourceClosed:false,currentNative:flow,source:{commit:'a'.repeat(40),sha256:'b'.repeat(64)},configuration:runtime.resolveNativePaperStrategy('two','liquidity-resilient-momentum-v3.1'),candidateDiagnostic:(fn:()=>unknown)=>fn(),currentEngine:runner,runId,startedAt,service:true,financialRetention,storageRetentionFailure:null,registryRetentionStatus:null,proofPreparation:{usage:()=>({})},serviceResources:{view:()=>({observedAt:at,rollingCpuFraction:0,residentBytes:process.memoryUsage().rss,availableDiskBytes:1000000000,availableMemoryBytes:1000000000,candidateAdmissionAllowed:true})},serviceSupervision:()=>({}),serviceGeneration:1,serviceRecoveryAt:0,serviceRecoveryReason:null,serviceRecoveryFailures:0,serviceClosingSettled:true,inputRaw:Buffer.from('OFFLINE publication fixture'),financialHandoff:new NativeFinancialHandoff(runId,startedAt,4,()=>{}),cashMaintenance,entryCapacityReason:()=>null,plannedEntryWork:null,mainRegistryContentionDeferrals:0,slotObservationFailures:0,registryIsolation:null,candidateStatisticsCached:false,lastSafeEngineStatus:null,sourceInformationAdmission:()=>true,sourceAdmission:()=>true,admissionPausePath:join(root,'absent.pause'),workOwner:{current:'idle'},retainedProtection:{scope:'OFFLINE',historyUnavailable:false},reportingMaximumMs:0,reportingLastMs:0,reportingLastCompletedAt:null,reportingCompletedPublication:null,reportingOverruns:0,reportingDeferrals:0,lastReportingDeferral:null,operatingCycles:cycles,firstCompletedProtectionAt:AT-1000,lastCompletedProtectionAt:AT-1000,maxCompletedGap:0,maxQuoteAge:0,currentRunMaximumCompletedGapMs:0,currentRunMaximumQuoteAgeAtUseMs:0,protectionBreaches:0,unavailableChecks:0,completed:new Map([[MINT,{units:'1000',at:AT-1000,quoteAt:AT-1000}]]),market:{usage:()=>({})},providerStats:{},entryStartsRemaining:()=>6,nativeUsage,maximumRss:process.memoryUsage().rss,eventBytes:0,localPhases:{},protectionDispatch:new NativeProtectionDispatch({sourceWork:()=>false,owned:()=>true,runway:()=>true,physicalIdle:()=>true,financialIdle:()=>true,protect:async()=>{fail();},record:()=>{}}),cpu:process.cpuUsage(),usdRequests:0,usdFailures:0,usdLastObservation:null,usdFailureReasons:{},stopReason:'OFFLINE',sourceCloseReason:null,root,runDir,currentFeeds:{usage:feedUsage},lastMigrationReceivedAt:AT-1000,lastReport:0,syncRecoveryAnchors:()=>{},manifest,manifestPath:join(root,'account.json'),serviceStatistics:(status:ReturnType<NativeCandidateRunner['status']>)=>({sourceGeneration:1,at,counters:status.counters}),
  writePoePublicStatus:(input:Parameters<typeof writePoePublicStatus>[0])=>{assert.equal((ledger as unknown as {reportingReadScope?:unknown}).reportingReadScope,undefined,'read view must end before filesystem publication');return writePoePublicStatus({...input,path:join(publicRoot,'status.json')});},
  writePoeStorageRetentionReport:(input:Parameters<typeof writePoeStorageRetentionReport>[0])=>writePoeStorageRetentionReport({...input,publicStatusPath:join(publicRoot,'status.json')})};
 const owner=Function(...Object.keys(context),code)(...Object.values(context)) as {report:(running:boolean)=>any;financialReady:()=>boolean};
 const startupBegan=performance.now(),startup=owner.report(true),startupPublicationMs=performance.now()-startupBegan;
 assert.equal(startup.marketRegistryDiagnostics.reporting.state,'UNAVAILABLE');assert.equal(startup.watch.known,null);assert.equal(startup.marketCoverage.pipeline.population.retained,null);assert.equal(owner.financialReady(),true,'missing optional diagnostics cannot invalidate current financial publication');assert.equal(startup.snapshot.positions.length,1);assert.ok(startup.snapshot.trades.length>=20);assert.equal(ledger.getReportingTrades().trades.length,50);
 await refreshRegistry();
 return {owner,registry,ledger,runner,root,runDir,publicRoot,reportTimings,financialFixture,financialPrefix,refreshFinance,at:()=>at,advance:(ms:number)=>{at+=ms;Atomics.store(clock,0,BigInt(at));},closeHeld:()=>{const when=at;ledger.order({id:'fixture-final-exit',mint:MINT,side:'sell',decidedAt:when,executeAt:when+500,expiresAt:when+2500,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE reporting fixture flat transition'},price(when),marks);at+=500;Atomics.store(clock,0,BigInt(at));assert.equal(ledger.attempt('fixture-final-exit-fill','fixture-final-exit',at,{at,spendLamports:'0',receiveUnits:'470000000',pricedBaseUnits:'1000',evidence:'OFFLINE full-size flat report transition'},price(at)).status,'filled');delete marks[MINT];retainFixtureFills(ledger,at);refreshFinance();},refreshRegistry,startupPublicationMs,row:(n:number)=>registry.get('OFFLINE-retained-'+String(n).padStart(5,'0'))!};
}

test('actual full publication with retained market load includes financial projection, files and checkpoint',async t=>{
 const f=await fixture(t),samples:number[]=[],reports:any[]=[],reportCases:string[]=[];
 const publish=(label:string,held:number)=>{
  const before=f.ledger.state(),prefix=f.financialPrefix();
  const began=performance.now(),status=f.owner.report(true);samples.push(performance.now()-began);reports.push(status);reportCases.push(label);
  assert.equal(f.owner.financialReady(),true,JSON.stringify(status.portfolioProjectionFailure));assert.ok(status.snapshot);assert.equal(status.snapshot.positions.length,held);assert.ok(status.snapshot.trades.length>=20,'bounded public view preserves many authenticated retained fills');assert.equal(f.ledger.getReportingTrades().trades.length,50);
  assert.equal(status.marketRegistryDiagnostics.reporting.state,'FRESH');assert.ok(status.marketRegistryDiagnostics.reporting.observedAt<=f.at()&&status.marketRegistryDiagnostics.reporting.observedAt>=f.at()-1000,'the worker retains its actual independently sampled clock');assert.equal(status.watch.known,watchIdentities+1);assert.equal(status.watchRows.length,64);assert.equal(status.marketCoverage.pipeline.population.retained,retainedIdentities);assert.equal(status.marketCoverage.active.awaitingVerification,verificationBacklog);assert.equal(status.reporting.localPublicStatusAvailable,true);
  assert.equal(status.snapshot.times.reconciledAt,new Date(before.daily.reconciledAt).toISOString());assert.equal(status.snapshot.times.marketAt,new Date(f.at()-1000).toISOString());
  assert.deepEqual(f.ledger.state(),before,'report metadata never changes authoritative financial state');assert.equal(f.financialPrefix(),prefix,'all original action/journal bytes remain unchanged');assert.equal(f.ledger.getOperatingReportingHistory().points.at(-1)!.at,f.at(),'advancing publication appends an actual new observation');
  return status;
 };
 for(let n=0;n<3;n++){f.advance(15000);f.refreshFinance();await f.refreshRegistry();publish('advancing-held-'+n,1);}
 const heldBefore=f.ledger.state(),heldAt=f.at(),heldPrefix=f.financialPrefix();f.advance(2001);const stale=f.owner.report(true);
 assert.equal(stale.generatedAt,heldAt+2001);assert.equal(stale.snapshot.times.reconciledAt,new Date(heldBefore.daily.reconciledAt).toISOString());assert.equal(stale.snapshot.balances.equityUsd,null,'publication cannot refresh old actual-size marks');assert.equal(stale.snapshot.status.reconciled,false);assert.ok(stale.snapshot.trades.length>=20);assert.deepEqual(f.ledger.state(),heldBefore);assert.equal(f.financialPrefix(),heldPrefix);
 f.refreshFinance();f.closeHeld();await f.refreshRegistry();publish('flat-after-genuine-fixture-exit',0);
 const priorPoint=f.ledger.getOperatingReportingHistory().points.at(-1)!;f.advance(25001);f.refreshFinance();await f.refreshRegistry();const latest=publish('flat-original-observation-gap',0);
 assert.ok(f.ledger.getOperatingReportingHistory().points.some(p=>p.at===priorPoint.at+1&&p.tradingMicroUsd===null&&p.economicMicroUsd===null),'the real gap marker survives history retention');
 assert.equal(latest.marketCoverage.pipeline.population.eligibleNow,150);assert.equal(latest.marketCoverage.pipeline.population.serviceableNow,150);
 for(const name of ['snapshot.json','status.json','account.json'])assert.ok(statSync(join(f.root,name)).size>0);assert.ok(statSync(join(f.runDir,'watch-checkpoint.json')).size>0);assert.ok(statSync(join(f.publicRoot,'status.json')).size>0);assert.deepEqual(f.reportTimings.usage().map(p=>p.stage),[...NATIVE_PAPER_REPORT_PHASES]);
 t.diagnostic(JSON.stringify({fixture:'actual production worker and report/checkpoint closures; controlled ADVANCING observation clock; on-disk WAL; real disposable legacy and V3 epoch receipts; 38 original closed round trips; full50-fill cache; 720 historical observations; each timed report writes a new history point; held, flat and original gap cases; actual atomic/fsync publication; synthetic provider context; financial-prefix invariance',representative,retainedIdentities,watchIdentities,verificationBacklog,financialFixture:f.financialFixture,financialDatabaseBytes:statSync(join(f.root,'fixture-financial.sqlite')).size,retainedLedgerScaleClaimed:false,detachedWorker:latest.marketRegistryDiagnostics.reporting,startupPublicationMs:f.startupPublicationMs,reportCases,fullPublicationMs:samples,phases:f.reportTimings.usage(),publicSnapshotBytes:statSync(join(f.root,'snapshot.json')).size,privateStatusBytes:statSync(join(f.root,'status.json')).size}));
 // An isolated run measures the unchanged250ms target; this fixture represents
 // registry and financial-cache/epoch work, not the operating215MB database or
 // its host contention. Production still needs actual completed-cycle evidence.
 if(process.env.POE_FULL_PUBLICATION_BENCHMARK==='1')assert.ok([f.startupPublicationMs,...samples].every(ms=>ms<runtime.NATIVE_PAPER_REPORT_BUDGET_MS),'offline complete publication meets the unchanged250ms target');
 const prior=latest.marketCoverage.pipeline.population.retained,registryAt=f.at();f.registry.put({...f.row(151),signature:'OFFLINE-after-publication',mint:'OFFLINE-new-retained',pool:'OFFLINE-new-pool'});
 const unchanged=f.owner.report(true);assert.equal(unchanged.marketCoverage.generatedAt,registryAt);assert.equal(unchanged.marketCoverage.pipeline.population.retained,prior);f.advance(1000);await f.refreshRegistry(prior+1);const updated=f.owner.report(true);assert.equal(updated.marketCoverage.pipeline.population.retained,prior+1);assert.equal(updated.marketCoverage.generatedAt,f.at());assert.equal(updated.snapshot.times.reconciledAt,latest.snapshot.times.reconciledAt);
});
