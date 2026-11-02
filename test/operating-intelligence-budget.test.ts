import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundOperatingIntelligence,projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION,type OperatingIntelligence} from '../src/operating-intelligence.js';

const at=Date.parse('2026-11-02T19:30:00.000Z'),generatedAt=new Date(at).toISOString(),maximumBytes=32*1024;
const size=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
const status=()=>({accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:at,startedAt:at-600000,runId:'bounded-public-decision-view',strategyVersion:'liquidity-resilient-momentum-v3.1',configurationSha256:'a'.repeat(64),persistent:true,positions:{},pending:{},funnel:{usableWindows:9},watch:{maximumDeep:4,deepActive:2,predictiveAssessments:9,predictivePasses:0,predictiveFailures:9},reporting:{financialProjectionReady:true},sourceTimes:{financialReconciliationAt:at-250},refusals:{'native-quality-gaps':2},timing:{targetMs:2000,experimentalCompletedEvaluationLimitMs:4000,protectionBreaches:3,unavailableChecks:5}});
function decisions():OperatingIntelligence['decisions']{
 return Array.from({length:50},(_,index)=>({id:'decision-'+index,mint:'fixture-mint-'+index,at:new Date(at-50000+index*1000).toISOString(),stage:'predictive-failed',reason:'€"\\'.repeat(160)}));
}
function fixture():OperatingIntelligence{
 const value=projectOperatingIntelligence(status());
 value.decisions=decisions();
 value.pendingOrders=[{id:'owned-order',mint:'owned-mint',side:'buy',decidedAt:new Date(at-1000).toISOString(),executeAt:new Date(at+500).toISOString(),expiresAt:new Date(at+2000).toISOString(),reservedSol:'0.500000001',quantityMinimum:'123456789123456789',reason:'Existing owned reservation, not an executed trade'}];
 return value;
}
function frozen<T>(value:T):T{
 if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}
 return value;
}

test('under-budget public intelligence remains exactly the same object and facts',()=>{
 const value=frozen(projectOperatingIntelligence(status()));
 assert.ok(size(value)<maximumBytes);assert.equal(boundOperatingIntelligence(value),value);validateOperatingIntelligence(value,generatedAt);
});

test('combined byte pressure retains a maximal newest suffix, exact rows and all protected facts',()=>{
 const value=frozen(fixture()),before=structuredClone(value);
 assert.ok(size(value)>maximumBytes);assert.throws(()=>validateOperatingIntelligence(value,generatedAt),/OPERATING_INTELLIGENCE_BYTES/);
 const result=boundOperatingIntelligence(value);
 assert.ok(size(result)<=maximumBytes);assert.ok(result.decisions.length>0&&result.decisions.length<value.decisions.length);
 assert.deepEqual(result.decisions,value.decisions.slice(-result.decisions.length));
 const omitted=value.decisions.length-result.decisions.length;
 assert.ok(size({...result,decisions:value.decisions.slice(omitted-1)})>maximumBytes,'one older complete row cannot fit');
 const {decisions:oldRows,quality:oldQuality,...oldFacts}=value,{decisions:newRows,quality:newQuality,...newFacts}=result;
 assert.deepEqual(newFacts,oldFacts);assert.deepEqual({...newQuality,limitations:oldQuality.limitations},oldQuality);
 assert.deepEqual(newQuality.limitations.slice(0,oldQuality.limitations.length),oldQuality.limitations);
 assert.match(newQuality.limitations.at(-1)!,/Public recent decisions are abbreviated/);
 assert.deepEqual(value,before);validateOperatingIntelligence(result,generatedAt);
});

test('source projection applies the same UTF-8 budget without modifying retained source decisions',()=>{
 const source={...status(),decisions:decisions().map(row=>({...row,at:Date.parse(row.at)}))},before=structuredClone(source);
 const result=projectOperatingIntelligence(source);
 assert.ok(result.decisions.length>0&&result.decisions.length<50);assert.ok(size(result)<=maximumBytes);
 assert.deepEqual(result.decisions,decisions().slice(-result.decisions.length));
 assert.deepEqual(source,before);assert.equal(result.candidates.predictiveAssessments,9);assert.equal(result.quality.qualityGaps,2);
 validateOperatingIntelligence(result,generatedAt);
});

test('ten existing warnings survive disclosure without exceeding the old schema or removing text',()=>{
 const value=fixture();value.quality.limitations=Array.from({length:10},(_,index)=>'Existing source warning '+index);
 const before=structuredClone(value),result=boundOperatingIntelligence(frozen(value));
 assert.equal(result.quality.limitations.length,10);assert.ok(result.quality.limitations.every(note=>note.length<=512));
 for(const [index,note]of before.quality.limitations.entries())assert.ok(result.quality.limitations[index]!.startsWith(note));
 assert.equal(result.quality.limitations.filter(note=>note.includes('Public recent decisions are abbreviated')).length,1);
 assert.deepEqual(value,before);validateOperatingIntelligence(result,generatedAt);
});

test('an irreducibly large protected core stays intact and fails the existing publisher gate without throwing in projection',()=>{
 const value=fixture();value.pendingOrders=Array.from({length:60},(_,index)=>({...value.pendingOrders[0]!,id:'owned-order-'+index,reason:'r'.repeat(512)}));
 assert.ok(size({...value,decisions:[]})>maximumBytes);const before=structuredClone(value);
 const result=boundOperatingIntelligence(frozen(value));assert.equal(result,value);assert.deepEqual(value,before);
 assert.throws(()=>validateOperatingIntelligence(result,generatedAt),/OPERATING_INTELLIGENCE_BYTES/);
 const source={...status(),pending:Object.fromEntries(value.pendingOrders.map(order=>[order.id,{id:order.id,mint:order.mint,side:order.side,decidedAt:Date.parse(order.decidedAt),executeAt:Date.parse(order.executeAt),expiresAt:Date.parse(order.expiresAt),reserved:'500000001',minReceive:order.quantityMinimum,decisionEvidence:order.reason}]))};
 const projected=projectOperatingIntelligence(source);assert.equal(projected.pendingOrders.length,60);
 assert.throws(()=>validateOperatingIntelligence(projected,generatedAt),/OPERATING_INTELLIGENCE_BYTES/);
});

test('full warning fields are not removed or rewritten to conceal decision truncation',()=>{
 const value=fixture();value.quality.limitations=Array.from({length:10},(_,index)=>String(index).repeat(512));
 const before=structuredClone(value),result=boundOperatingIntelligence(frozen(value));
 assert.equal(result,value);assert.deepEqual(result,before);assert.throws(()=>validateOperatingIntelligence(result,generatedAt),/OPERATING_INTELLIGENCE_BYTES/);
});

test('each publication recomputes available space and repeated projection does not add disclosure notes',()=>{
 const large=fixture(),first=boundOperatingIntelligence(large);assert.equal(boundOperatingIntelligence(first),first);
 const next=fixture();next.decisions=next.decisions.slice(-1);const result=boundOperatingIntelligence(next);
 assert.equal(result,next);assert.equal(result.decisions.length,1);assert.ok(!result.quality.limitations.some(note=>note.includes('Public recent decisions are abbreviated')));
 assert.equal(large.decisions.length,50);assert.ok(first.decisions.length<large.decisions.length);
});
