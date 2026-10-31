import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner, type NativeRunnerOptions} from '../src/native-candidate-runner.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const START=Date.parse('2026-10-31T00:00:00.000Z');
const WAITS=['queueToAllocation','allocationToAck','ackToWarm','auditReadyToPhysicalStart','retirementToReplacement'] as const;

function fixture(t:TestContext){
 let at=START;
 const registry=new MarketRegistry(':memory:',{now:()=>at});
 t.after(()=>registry.close());
 const unavailable=()=>{throw Error('OFFLINE_STATUS_MUST_NOT_START_SOURCE_WORK');};
 // Only local usage inspection is available. Any accidental transport or
 // scheduling action fails the test before it can leave this offline fixture.
 const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:at+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:unavailable,removeCandidate:unavailable,notificationLedger:unavailable,requestSupportRefresh:unavailable,requestHeartbeat:unavailable,service:unavailable,stop:unavailable} as unknown as NativeRunnerOptions['flow'];
 const rpc={usage:()=>({waitingOrOperating:false,inFlight:0,closed:false,fatal:null,dispatchWindow:{readyAt:at,physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,call:unavailable} as unknown as NativeRunnerOptions['rpc'];
 const runner=new NativeCandidateRunner({registry,flow,rpc,runId:'offline-status-snapshot',maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:'liquidity-resilient-momentum-v3.1',now:()=>at,record:()=>{}});
 const scope=runner.slotProductivity(at).sourceInstanceId+':slot-productivity:metrics';
 for(const [index,metric] of WAITS.entries())for(const value of [10,20,90])registry.recordMetric(scope,metric,'offline:'+value,value+index,at);
 for(const mint of ['offline-ready','offline-no-origin']){
  runner.watch.discover({signature:'origin-'+mint,feedMint:mint,receivedAt:at});
  runner.watch.verify('origin-'+mint,{mint,pool:'pool-'+mint,migrationAt:at-300000,verifiedAt:at});
 }
 registry.putOrigin('offline-ready',{fixture:true});
 return {runner,registry,scope,advance:()=>{at+=1000;return at;}};
}

function countMetricReads(t:TestContext,registry:MarketRegistry,scope:string){
 // Count actual SQLite executions, including the two nearest-rank queries,
 // while leaving the real database, aggregation and percentile logic intact.
 type ReadStatement={get(...params:unknown[]):unknown};
 const internals=registry as unknown as {statement(sql:string):ReadStatement};
 const original=internals.statement.bind(registry),reads=new Map<string,number>();
 t.mock.method(internals,'statement',(sql:string)=>{
  const statement=original(sql);
  if(!sql.includes('FROM operating_metrics'))return statement;
  return {get(...params:unknown[]){
   if(params[0]===scope){const metric=String(params[1]);reads.set(metric,(reads.get(metric)??0)+1);}
   return statement.get(...params);
  }};
 });
 return reads;
}

test('one status publication reads each populated slot metric once and matches standalone reports',t=>{
 const {runner,registry,scope}=fixture(t);
 const expectedProductivity=runner.slotProductivity(START),expectedPipeline=runner.pipelineThroughput(START);
 const reads=countMetricReads(t,registry,scope),writesBefore=registry.health().transactions.writeCommits;
 const status=runner.status();
 assert.deepEqual(Object.fromEntries(reads),Object.fromEntries(WAITS.map(metric=>[metric,3])),'five populated summaries require fifteen SQLite reads, never thirty');
 assert.deepEqual(status.slotProductivity,expectedProductivity);
 assert.deepEqual(status.marketCoverage.pipeline,expectedPipeline);
 assert.equal(status.marketCoverage.pipeline.population.serviceableNow,2,'optional archived origin bytes do not reduce current observation serviceability');
 assert.equal(status.slotProductivity.configuredSlots,4);
 assert.equal(status.marketCoverage.pipeline.capacityWitness.configuredSlots,4);
 assert.deepEqual(status.slotProductivity.waits.queueToAllocation,{count:3,sum:120,mean:40,max:90,p50:20,p95:90});
 assert.equal(status.slotProductivity.generatedAt,status.generatedAt);
 assert.equal(status.marketCoverage.pipeline.generatedAt,status.generatedAt);
 assert.equal(registry.health().transactions.writeCommits,writesBefore,'publication does not introduce registry writes');
 assert.equal(status.liveTradingEnabled,false);
 assert.equal(status.financialExecutionAuthorized,false);
});

test('later publications and standalone APIs observe new metrics and financial callbacks without a stale cache',t=>{
 const {runner,registry,scope,advance}=fixture(t),reads=countMetricReads(t,registry,scope);
 const first=runner.status(),later=advance();
 registry.recordMetric(scope,'queueToAllocation','offline:later',200,later);
 runner.onFinancialOutcome({mint:'offline-ready',kind:'primary-evaluated',at:later,key:'offline-decision'});
 const second=runner.status();
 assert.deepEqual(Object.fromEntries(reads),Object.fromEntries(WAITS.map(metric=>[metric,6])),'each publication obtains exactly one fresh summary set');
 assert.equal(first.slotProductivity.waits.queueToAllocation.count,3);
 assert.deepEqual(second.slotProductivity.waits.queueToAllocation,{count:4,sum:320,mean:80,max:200,p50:20,p95:200});
 assert.equal(first.marketCoverage.pipeline.flow.financialEvaluations,0);
 assert.equal(second.marketCoverage.pipeline.flow.financialEvaluations,1);
 assert.equal(second.slotProductivity.counts.unattributedFinancialEvents,1,'a callback without a deep assignment retains its existing unattributed meaning');
 assert.equal(second.slotProductivity.generatedAt,later);
 assert.equal(second.marketCoverage.pipeline.generatedAt,later);
 assert.equal(second.generatedAt,later);
 assert.deepEqual(second.slotProductivity,runner.slotProductivity());
 assert.deepEqual(second.marketCoverage.pipeline,runner.pipelineThroughput());
 assert.deepEqual(second.marketCoverage.pipeline,runner.marketCoverage().pipeline);
});
