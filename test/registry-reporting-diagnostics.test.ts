import test from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {readMarketRegistryReporting,type MarketRegistryReportingScope,type MarketRegistryReportingSnapshot,type MarketRegistryReportingView} from '../src/market-registry-reporting.js';
import {projectMarketCoverageReporting} from '../src/market-coverage-reporting.js';
import {projectRegistryReportingDiagnostics,validateRegistryReportingDiagnostics} from '../src/registry-reporting-diagnostics.js';
import {MARKET_INTAKE_VERSION} from '../src/market-runtime-reporting.js';

const AT=Date.parse('2026-11-03T15:00:00.000Z');
test('current owner status and public reporting reuse detached aggregates only at their original clocks without synchronous fallback',t=>{
 let at=AT,scope!:MarketRegistryReportingScope,snapshot:MarketRegistryReportingSnapshot|null=null;
 const registry=new MarketRegistry(':memory:',{now:()=>at}),forbidden=()=>{throw Error('OFFLINE_REPORTING_MUST_NOT_START_PROVIDER_OR_AGGREGATE_WORK');};
 const report=(requested:MarketRegistryReportingScope):MarketRegistryReportingView=>{scope=requested;return {snapshot,health:{mode:'DETACHED_WORKER',state:snapshot?'FRESH':'UNAVAILABLE',sourceInstanceId:requested.sourceInstanceId,sampledAt:at,workerGeneration:1,sampleWorkerGeneration:snapshot?1:null,requestedAt:AT,observedAt:snapshot?.observedAt??null,completedAt:snapshot?.observedAt??null,durationMs:snapshot?5:null,ageMs:snapshot?at-snapshot.observedAt:null,pending:!snapshot,failures:0,reasonCode:snapshot?null:'REPORTING_PENDING'}};};
 const intake={registryReporting:report,observeIdentity:forbidden,observeActivity:forbidden,observeFeed:forbidden,observeMigration:forbidden};
 const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:at+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:forbidden,removeCandidate:forbidden,notificationLedger:forbidden,requestSupportRefresh:forbidden,requestHeartbeat:forbidden,service:forbidden,stop:forbidden};
 const rpc={usage:()=>({inFlight:0,waitingOrOperating:false,closed:false,fatal:null,rpcDispatchWindow:{readyAt:at,physicalBusy:false},controlDispatchWindow:{readyAt:at,physicalBusy:false}}),cooldownUntil:()=>0,call:forbidden};
 const runner=new NativeCandidateRunner({registry,flow:flow as any,rpc:rpc as any,marketIntake:intake,runId:'detached-clock',maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:'liquidity-resilient-momentum-v3.1',now:()=>at,record:()=>{}});
 try{
  runner.watch.discover({signature:'OFFLINE-clock',feedMint:'OFFLINE-clock-mint',receivedAt:at});runner.watch.verify('OFFLINE-clock',{mint:'OFFLINE-clock-mint',pool:'OFFLINE-clock-pool',migrationAt:at-300000,verifiedAt:at});
  const pending=runner.status();assert.equal(pending.registryReporting?.state,'UNAVAILABLE');assert.equal(pending.watch.summary.known,null);assert.equal(pending.verificationQueue,null);assert.equal(pending.marketCoverage.pipeline.population.retained,null);assert.equal(pending.slotProductivity.generatedAt,at);
  at+=1000;snapshot=readMarketRegistryReporting(registry,scope,at);const immutable=structuredClone(snapshot);
  for(const key of ['coverageSnapshot','verificationStats','migrationAgeSummary','tokenAgeSummary','cohortCounts'] as const)t.mock.method(registry,key,forbidden);
  t.mock.method(runner.watch,'snapshot',forbidden);t.mock.method(runner.watch,'serviceableBacklog',forbidden);
  at+=1000;(runner as any).counters.auditedWindows=2;
  const current=runner.status();assert.equal(current.generatedAt,at);assert.equal(current.slotProductivity.generatedAt,at);assert.equal(current.candidatePreparation.generatedAt,at);assert.equal(current.watch.summary.known,1);assert.equal(current.marketCoverage.generatedAt,AT+1000);assert.equal(current.marketCoverage.pipeline.registryObservedAt,AT+1000);assert.equal(current.marketCoverage.pipeline.generatedAt,at);assert.equal(current.marketCoverage.pipeline.population.capacityWaiting,null);assert.equal(current.registryReporting?.ageMs,1000);assert.deepEqual(snapshot,immutable);
  const intakeNow={version:MARKET_INTAKE_VERSION,state:'ready',received:1,durableCommitted:1,pending:0,pendingBytes:0,pendingBytesBudget:1024,oldestPendingAt:null,maximumPendingAgeMs:0,lastCommitAt:at,workerGeneration:1,restarts:0,failures:0,retryAt:null,reasonCode:null,worker:null,inFlightTailMeaning:'UNACKNOWLEDGED_NETWORK_INTAKE_IS_NOT_YET_DURABLE',financialWriterOpened:false};
  const projected=projectMarketCoverageReporting({...current,marketCoverage:{...current.marketCoverage,resource:{...current.marketCoverage.resource,intakeWorker:intakeNow,sourceDispatch:{observedAt:at}}},runId:'detached-clock',funnel:{qualified:0,paperFilled:0,exited:0}},at)!;
  assert.ok(projected);assert.ok(projected.resource.registryTransactions,'owner transaction counters keep the actual settled boundary');assert.equal(projected.generatedAt,new Date(AT+1000).toISOString());assert.equal(projected.resource.registryReporting?.sampledAt,new Date(at).toISOString());assert.equal(projected.resource.intakeWorker?.lastCommitAt,new Date(at).toISOString(),'current durable ACK time is independent of the older registry summary');assert.equal(projected.resource.sourceDispatch?.observedAt,new Date(at).toISOString());assert.equal(projected.pipeline?.generatedAt,new Date(at).toISOString());assert.equal(projected.pipeline?.registryObservedAt,new Date(AT+1000).toISOString());assert.equal(projected.pipeline?.ratesPerMinute.discoveredDistinct,60,'registry cohort rate uses its original one-second interval');assert.equal(projected.pipeline?.ratesPerMinute.auditCompletions,60,'current owner rate uses its actual two-second interval');assert.equal(projected.pipeline?.population.capacityWaiting,null);
 }finally{registry.close();}
});

test('public detached provenance rejects refreshed or impossible clocks and redacts uncontrolled error text',()=>{
 const raw={mode:'DETACHED_WORKER',state:'STALE',sourceInstanceId:'native-runner:OFFLINE:source-a',sampledAt:AT+40000,workerGeneration:2,sampleWorkerGeneration:1,requestedAt:AT,observedAt:AT+1,completedAt:AT+5,durationMs:4,ageMs:39999,pending:true,failures:1,reasonCode:'WORKER_UNAVAILABLE'};
 const projected=projectRegistryReportingDiagnostics(raw,AT+40000)!;assert.ok(projected);assert.equal(projected.observedAt,new Date(AT+1).toISOString());assert.equal(projected.state,'STALE');assert.equal(projected.sampleWorkerGeneration,1);
 assert.equal(projectRegistryReportingDiagnostics({...raw,state:'FRESH',reasonCode:null},AT+40000),null,'an old generation cannot become fresh through a newer publication');
 assert.equal(projectRegistryReportingDiagnostics({...raw,ageMs:0},AT+40000),null,'sampling diagnostics cannot reset original age');
 assert.equal(projectRegistryReportingDiagnostics({...raw,completedAt:AT+50000},AT+40000),null);
 assert.equal(projectRegistryReportingDiagnostics({...raw,reasonCode:'secret=https://provider.invalid/key'},AT+40000)?.reasonCode,'OTHER_UNEXPORTED_REASON');
 assert.throws(()=>validateRegistryReportingDiagnostics({...projected,secret:'private'},AT+40000));
});
