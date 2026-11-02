import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMarketCoverageReporting,validateMarketCoverageReporting,MARKET_COVERAGE_REPORTING_VERSION} from '../src/market-coverage-reporting.js';
import {projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from '../src/operating-intelligence.js';
import {MarketRegistry} from '../src/market-registry.js';
const T=Date.parse('2026-10-30T22:43:12.000Z'),iso=(n:number)=>new Date(n).toISOString();
function source(){return {accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:T,startedAt:T-12000,runId:'coverage-source',configurationSha256:'a'.repeat(64),strategyVersion:'liquidity-resilient-momentum-v3.1',persistent:true,positions:{},pending:{},watch:{deepActive:4,maximumDeep:4},funnel:{qualified:2,paperFilled:1,exited:0},marketCoverage:{version:MARKET_COVERAGE_REPORTING_VERSION,generatedAt:T,persistence:{state:'sqlite-wal',createdAt:T-86400000,updatedAt:T-1000},lifetime:{uniqueTokensDiscovered:1200,lightweightScreened:1190,lightweightWithActivity:900,lightweightUnavailable:290,deepAdmitted:36,verifiedAudited:30},currentHour:{startedAt:Math.floor(T/3600000)*3600000,uniqueTokensDiscovered:600},active:{trackedIdentities:1100,awaitingLightweight:10,awaitingVerification:20,awaitingDeep:60,deepObserving:4},resource:{durableVerificationBacklog:20,oldestVerificationAt:T-180000,maximumVerificationWaitMs:180000,storageFailures:0,maximumWriteMs:3.3,meanWriteMs:.23},feeds:[{source:'pumpportal-new-token',connected:true,lastObservedAt:T-10,scope:'CREATION_HINTS',coverageGaps:1},{source:'pumpportal-migration',connected:false,lastObservedAt:T-20000,scope:'MIGRATION_HINTS',coverageGaps:2}],marketDenominator:null,wholeMarketCoveragePercent:null,limitations:['PROVIDER_HINTS_UNVERIFIED','PREMIGRATION_EXECUTION_NOT_SUPPORTED','SOURCE_OUTAGES_NOT_RECONSTRUCTED']}};}
test('durable discovery scope survives projection independently of current-run candidate counters',()=>{
 const raw=source(),before=structuredClone(raw),i=projectOperatingIntelligence(raw),m=i.marketCoverage!;
 validateOperatingIntelligence(i,iso(T));assert.deepEqual(raw,before);
 assert.equal(m.lifetime.uniqueTokensDiscovered,1200);assert.equal(m.active.trackedIdentities,1100);assert.equal(m.currentHour.uniqueTokensDiscovered,600);assert.equal(m.persistence.createdAt,iso(T-86400000));
 assert.equal(m.resource.meanWriteMs,.23);assert.equal(m.resource.maximumVerificationWaitMs,180000);assert.equal(Object.hasOwn(m,'candidates'),false);assert.equal(i.candidates.migrationsReceived,null);
 assert.deepEqual(m.financial,{scope:'current-source-instance',qualified:2,entries:1,exits:0});assert.equal(m.marketDenominator,null);assert.equal(m.wholeMarketCoveragePercent,null);assert.ok(m.limitations.includes('MARKET_DENOMINATOR_UNKNOWN'));
});
test('financial stages come from actual source funnel rather than registry claims',()=>{
 const raw=source() as any;raw.marketCoverage.financial={qualified:9000,entries:9000,exits:9000};
 assert.deepEqual(projectMarketCoverageReporting(raw,T)!.financial,{scope:'current-source-instance',qualified:2,entries:1,exits:0});
 delete raw.funnel.paperFilled;assert.equal(projectMarketCoverageReporting(raw,T)!.financial.entries,null);
});
test('unavailable preliminary activity is not presented as completed economic evaluation',()=>{
 const m=projectMarketCoverageReporting(source(),T)!;assert.equal(m.lifetime.lightweightScreened,1190);assert.equal(m.lifetime.lightweightWithActivity,900);assert.equal(m.lifetime.lightweightUnavailable,290);
 const raw=source() as any;delete raw.marketCoverage.lifetime.lightweightWithActivity;raw.marketCoverage.active.awaitingLightweight=-1;raw.marketCoverage.resource.storageFailures=0;
 const unavailable=projectMarketCoverageReporting(raw,T)!;assert.equal(unavailable.lifetime.lightweightWithActivity,null);assert.equal(unavailable.active.awaitingLightweight,null);assert.equal(unavailable.resource.storageFailures,0);
});
test('old source remains compatible and malformed optional diagnostics do not block financial reporting',()=>{
 const old=source() as any;delete old.marketCoverage;const i=projectOperatingIntelligence(old);assert.equal(Object.hasOwn(i,'marketCoverage'),false);validateOperatingIntelligence(i,iso(T));
 for(const change of [(m:any)=>m.generatedAt=T+1,(m:any)=>m.lifetime.verifiedAudited=1201]){const bad=source();change(bad.marketCoverage);const projected=projectOperatingIntelligence(bad);assert.equal(projected.marketCoverage,undefined);assert.equal(projected.run.strategyVersion,'liquidity-resilient-momentum-v3.1');validateOperatingIntelligence(projected,iso(T));}
});
test('a stale or invalid hour is unavailable rather than relabelled as current-hour discovery',()=>{
 const raw=source();raw.marketCoverage.currentHour.startedAt-=3600000;const m=projectMarketCoverageReporting(raw,T)!;assert.deepEqual(m.currentHour,{startedAt:null,uniqueTokensDiscovered:null});
 const invalid=structuredClone(m);invalid.currentHour={startedAt:iso(Math.floor(T/3600000)*3600000-3600000),uniqueTokensDiscovered:100};assert.throws(()=>validateMarketCoverageReporting(invalid,T),/INVALID/);
});
test('static feed classifications exclude arbitrary provider data, secrets and unknown source names',()=>{
 const raw=source() as any;raw.marketCoverage.feeds.push({source:'https://private.example?key=DO_NOT_EXPORT',connected:true,scope:'DO_NOT_EXPORT',coverageGaps:0});raw.marketCoverage.feeds[0].scope='DO_NOT_EXPORT';raw.marketCoverage.feeds[0].error='DO_NOT_EXPORT';raw.marketCoverage.limitations.push('DO_NOT_EXPORT');raw.marketCoverage.apiKey='DO_NOT_EXPORT';
 const m=projectMarketCoverageReporting(raw,T)!;assert.equal(m.feeds.length,2);assert.equal(m.feeds[0]!.scope,'UNKNOWN');assert.ok(m.limitations.includes('OTHER_UNEXPORTED_LIMITATION'));assert.doesNotMatch(JSON.stringify(m),/DO_NOT_EXPORT|private\.example|apiKey/);
});
test('wire validation rejects secret-shaped extras, invented coverage rates and duplicate feed kinds',()=>{
 const m=projectMarketCoverageReporting(source(),T)!;
 for(const change of [(r:any)=>r.apiKey='secret',(r:any)=>r.wholeMarketCoveragePercent=100,(r:any)=>r.marketDenominator=1200,(r:any)=>r.feeds.push(r.feeds[0]),(r:any)=>r.lifetime.uniqueTokensDiscovered=-1,(r:any)=>r.persistence.updatedAt=iso(T+1)]){const bad=structuredClone(m);change(bad);assert.throws(()=>validateMarketCoverageReporting(bad,T),/INVALID/);}
 assert.ok(Buffer.byteLength(JSON.stringify(m))<6144);
});

test('actual SQLite producer projects imported identities and new shared activity without inventing history or trades',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T});
 try{
  registry.observeIdentity({mint:'imported-identity',at:T-7200000,source:'legacy-watch-import',kind:'legacy-import'});
  const first=projectMarketCoverageReporting({marketCoverage:registry.coverage(T)},T)!;
  assert.ok(first);assert.equal(first.lifetime.uniqueTokensDiscovered,1);assert.equal(first.persistence.createdAt,iso(T));assert.equal(first.persistence.updatedAt,iso(T));assert.equal(first.currentHour.uniqueTokensDiscovered,0);assert.equal(first.lifetime.lightweightUnavailable,1);assert.equal(first.financial.entries,null);
  registry.observeActivity({mint:'new-identity',at:T,source:'pumpapi-broad',signature:'signed-provider-hint',side:'buy',quoteLamports:'1000000000'});
  registry.recordFeed({source:'pumpapi-broad',at:T,connected:true,scope:'SHARED_ACTIVITY_HINTS'});
  const raw=source();raw.marketCoverage=registry.coverage(T) as any;
  const i=projectOperatingIntelligence(raw);validateOperatingIntelligence(i,iso(T));const m=i.marketCoverage!;
  assert.equal(m.lifetime.uniqueTokensDiscovered,2);assert.equal(m.lifetime.lightweightScreened,2);assert.equal(m.lifetime.lightweightWithActivity,1);assert.equal(m.lifetime.lightweightUnavailable,1);assert.equal(m.currentHour.uniqueTokensDiscovered,1);assert.equal(m.feeds[0]!.source,'pumpapi-broad');assert.equal(m.marketDenominator,null);assert.deepEqual(m.financial,{scope:'current-source-instance',qualified:2,entries:1,exits:0});
 }finally{registry.close();}
});
test('actual registry reports read-only transactions without fabricating write or OS-fsync counts',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T});
 try{
  registry.observeIdentity({mint:'retained-identity',at:T,source:'fixture'});const before=registry.health().transactions;
  for(let i=0;i<20;i++)registry.transaction(()=>registry.getMetadata('createdAt'));
  const after=registry.health().transactions;assert.equal(after.attempted-before.attempted,20);assert.equal(after.readOnlyCommits-before.readOnlyCommits,20);assert.equal(after.writeCommits,before.writeCommits);assert.equal(after.fsyncEligibleCommits,before.fsyncEligibleCommits);
  const raw=source();raw.marketCoverage=registry.coverage(T) as any;const i=projectOperatingIntelligence(raw),tx=i.marketCoverage!.resource.registryTransactions!;validateOperatingIntelligence(i,iso(T));assert.equal(tx.scope,'CURRENT_SOURCE_PROCESS');assert.equal(tx.runId,raw.runId);assert.equal(tx.writeCommits,after.writeCommits);assert.equal(tx.readOnlyCommits,after.readOnlyCommits);
  const mismatch=structuredClone(i);mismatch.marketCoverage!.resource.registryTransactions!.runId='other-process';assert.throws(()=>validateOperatingIntelligence(mismatch,iso(T)),/PROCESS_BINDING/);
  const extra=structuredClone(i);(extra.marketCoverage!.resource.registryTransactions as any).apiKey='DO_NOT_EXPORT';assert.throws(()=>validateOperatingIntelligence(extra,iso(T)),/INVALID/);
 }finally{registry.close();}
 assert.equal(projectMarketCoverageReporting(source(),T)!.resource.registryTransactions,null,'old source metrics remain unavailable');
});

function projectedTransactions(coverage:ReturnType<MarketRegistry['coverage']>){
 const raw={...source(),marketCoverage:coverage},report=projectOperatingIntelligence(raw);
 validateOperatingIntelligence(report,iso(T));const transactions=report.marketCoverage!.resource.registryTransactions;
 assert.ok(transactions,'settled source counters must survive the unchanged strict projector');return transactions;
}
test('nested coverage reports the actual pretransaction boundary while raw health retains the active attempt',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T});
 try{
  registry.observeIdentity({mint:'retained-identity',at:T,source:'fixture'});const before=registry.health().transactions;
  registry.readTransaction(()=>{
   assert.equal(registry.health().transactions.attempted,before.attempted+1,'live health still includes the unresolved outer attempt');
   const first=registry.coverage(T);assert.deepEqual(first.resource.registryTransactions,before);projectedTransactions(first);
   first.resource.registryTransactions.attempted=-1;
   const nested=registry.readTransaction(()=>registry.coverage(T));assert.deepEqual(nested.resource.registryTransactions,before,'returned reports cannot mutate the retained baseline');projectedTransactions(nested);
  });
  const settled=registry.health().transactions;assert.equal(settled.attempted,before.attempted+1);assert.equal(settled.readOnlyCommits,before.readOnlyCommits+1);assert.equal(settled.writeCommits,before.writeCommits);
  const next=registry.coverage(T);assert.deepEqual(next.resource.registryTransactions,settled);projectedTransactions(next);
 }finally{registry.close();}
});
test('a failed outer read is published only after settlement and a nested read never invents another attempt',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T});
 try{
  const before=registry.health().transactions;
  assert.throws(()=>registry.readTransaction(()=>registry.readTransaction(()=>{
   const during=registry.coverage(T);assert.deepEqual(during.resource.registryTransactions,before);projectedTransactions(during);throw Error('fixture read failure');
  })),/fixture read failure/);
  const settled=registry.health().transactions;assert.equal(settled.attempted,before.attempted+1);assert.equal(settled.failed,before.failed+1);assert.equal(settled.readOnlyCommits,before.readOnlyCommits);assert.equal(settled.writeCommits,before.writeCommits);
  const next=registry.coverage(T);assert.deepEqual(next.resource.registryTransactions,settled);assert.equal(projectedTransactions(next).failed,settled.failed);
 }finally{registry.close();}
});
test('coverage inside a rolled-back write cannot claim a write commit and the next report retains the actual failure',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T});
 try{
  const before=registry.health().transactions;
  assert.throws(()=>registry.transaction(()=>{
   registry.observeIdentity({mint:'rolled-back-identity',at:T,source:'fixture'});
   const during=registry.coverage(T);assert.deepEqual(during.resource.registryTransactions,before);projectedTransactions(during);throw Error('fixture write failure');
  }),/fixture write failure/);
  const settled=registry.health().transactions;assert.equal(settled.attempted,before.attempted+1);assert.equal(settled.failed,before.failed+1);assert.equal(settled.writeCommits,before.writeCommits);assert.equal(settled.fsyncEligibleCommits,before.fsyncEligibleCommits);
  const next=registry.coverage(T);assert.equal(next.lifetime.uniqueTokensDiscovered,0);assert.deepEqual(next.resource.registryTransactions,settled);projectedTransactions(next);
 }finally{registry.close();}
});
test('postcommit coverage sees the completed write even when a later notification fails',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T});
 try{
  const before=registry.health().transactions;
  assert.throws(()=>registry.transaction(()=>{
   registry.observeIdentity({mint:'committed-identity',at:T,source:'fixture'});
   registry.afterCommit(()=>{
    const report=projectedTransactions(registry.coverage(T));assert.equal(report.attempted,before.attempted+1);assert.equal(report.writeCommits,before.writeCommits+1);assert.equal(report.failed,before.failed);throw Error('fixture notification failure');
   });
  }),/fixture notification failure/);
  const settled=registry.health().transactions;assert.equal(settled.writeCommits,before.writeCommits+1);assert.equal(settled.readOnlyCommits,before.readOnlyCommits+1);assert.equal(settled.failed,before.failed);
  const next=registry.coverage(T);assert.equal(next.lifetime.uniqueTokensDiscovered,1);assert.deepEqual(next.resource.registryTransactions,settled);projectedTransactions(next);
 }finally{registry.close();}
});
test('reentrant rollback diagnostics preserve the outer unsettled baseline until every outcome is known',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>T});
 try{
  const before=registry.health().transactions;let rollbackCalls=0;
  assert.throws(()=>registry.transaction(()=>{
   registry.observeIdentity({mint:'rolled-back-identity',at:T,source:'fixture'});
   registry.onRollback(()=>{
    rollbackCalls++;
    for(let i=0;i<2;i++){
     const during=registry.coverage(T);assert.equal(during.lifetime.uniqueTokensDiscovered,0,'SQLite rollback has finished before the mirror callback');assert.deepEqual(during.resource.registryTransactions,before);projectedTransactions(during);
    }
   });
   throw Error('fixture outer rollback');
  }),/fixture outer rollback/);
  const settled=registry.health().transactions;assert.equal(rollbackCalls,1);assert.equal(settled.attempted,before.attempted+3);assert.equal(settled.readOnlyCommits,before.readOnlyCommits+2);assert.equal(settled.failed,before.failed+1);assert.equal(settled.writeCommits,before.writeCommits);
  const next=registry.coverage(T);assert.deepEqual(next.resource.registryTransactions,settled);projectedTransactions(next);
 }finally{registry.close();}
});
