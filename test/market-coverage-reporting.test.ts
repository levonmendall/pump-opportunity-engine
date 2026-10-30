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
