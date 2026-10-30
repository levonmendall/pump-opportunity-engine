import {test} from 'node:test';import assert from 'node:assert/strict';
import {projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from '../src/operating-intelligence.js';
const at=Date.parse('2026-10-29T21:00:00.000Z');
function source(){return {accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:at,startedAt:at-600000,runId:'adaptive-reporting-fixture',configurationSha256:'a'.repeat(64),strategyVersion:'adaptive-momentum-v2-paper-v1',persistent:true,positions:{},pending:{},observationReportingMeaning:['Active v2 evaluations are preliminary; complete execution and ledger checks remain mandatory.']};}
test('original reporting carries two verified historical peaks without another schema or private strategy data',()=>{
 const raw={...source(),positions:{FirstMint:{enteredAt:at-10000,strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'250000000',highWaterAt:at-1000,signalId:'DO_NOT_EXPORT'}},SecondMint:{enteredAt:at-10000,strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'400000000',highWaterAt:at-2000}}}};
 const result=projectOperatingIntelligence(raw);validateOperatingIntelligence(result,new Date(at).toISOString());
 assert.ok(result.quality.limitations.some(x=>x.includes('FirstMint')&&x.includes('0.250000000 SOL')));
 assert.ok(result.quality.limitations.some(x=>x.includes('SecondMint')&&x.includes('0.400000000 SOL')));
 assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPORT'));assert.equal(result.run.strategyVersion,raw.strategyVersion);
});
test('unavailable or future peaks remain unavailable and legacy holding semantics stay explicit',()=>{
 const raw={...source(),positions:{FirstMint:{enteredAt:at-10000,strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'250000000',highWaterAt:at+1000}},LegacyMint:{units:'10'}}};
 const result=projectOperatingIntelligence(raw);validateOperatingIntelligence(result,new Date(at).toISOString());
 assert.ok(result.quality.limitations.some(x=>x.includes('FirstMint')&&x.includes('peak unavailable')));
 assert.ok(result.quality.limitations.some(x=>x.includes('LegacyMint')&&x.includes('original exit rules')));
 assert.ok(!result.quality.limitations.some(x=>x.includes('0.250000000')));
});
test('strategy reporting remains bounded and does not relabel baseline source',()=>{
 const raw={...source(),observationReportingMeaning:Array.from({length:10},(_,n)=>`limitation ${n}`),positions:{FirstMint:{enteredAt:at-10000,strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'1',highWaterAt:at}}}};
 const adaptive=projectOperatingIntelligence(raw);assert.equal(adaptive.quality.limitations.length,10);assert.ok(adaptive.quality.limitations.at(-1)!.includes('FirstMint'));
 const baseline=projectOperatingIntelligence({...raw,strategyVersion:'persistent-buying-pilot-v1'});assert.ok(!baseline.quality.limitations.some(x=>x.includes('Adaptive Momentum')));
});

test('historical peak requires a verified holding lifetime rather than any past timestamp',()=>{
 for(const strategyTime of [1,Date.parse(ORIGINAL_POE_INCEPTION)-1,at-20000,at+1]){
  const raw={...source(),positions:{FirstMint:{enteredAt:at-10000,strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'250000000',highWaterAt:strategyTime}}}};
  const result=projectOperatingIntelligence(raw);validateOperatingIntelligence(result,new Date(at).toISOString());
  assert.ok(result.quality.limitations.some(x=>x.includes('peak unavailable')));
  assert.ok(!result.quality.limitations.some(x=>x.includes('0.250000000')));
 }
 const unknown={...source(),positions:{FirstMint:{strategy:{version:'adaptive-momentum-v2-paper-v1',highWaterNetLamports:'250000000',highWaterAt:at}}}};
 assert.ok(projectOperatingIntelligence(unknown).quality.limitations.some(x=>x.includes('peak unavailable')));
});


test('V3.1 reports preserved V3-family held floors and current strategy identity',()=>{
 const raw={...source(),strategyVersion:'liquidity-resilient-momentum-v3.1',positions:{OldV3:{enteredAt:at-10000,strategy:{version:'liquidity-resilient-momentum-v3',profitProtectionFloorLamports:'123'}}}};
 const result=projectOperatingIntelligence(raw);validateOperatingIntelligence(result,new Date(at).toISOString());
 assert.equal(result.run.strategyVersion,'liquidity-resilient-momentum-v3.1');
 assert.ok(result.quality.limitations.some(s=>s.includes('1 retain')&&s.includes('1 have persisted executable-profit floors')));
});
