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

// Actual retained H12 envelope; the fixture and stock reader retain their
// original clocks. Private temporary files only; no publisher/network starts.
import {createHash} from 'node:crypto';
import {chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSnapshotFileWithProvenance} from '../src/snapshot-publisher.js';

const actualBudgetRaw=readFileSync(new URL('./fixtures/operating-intelligence-budget/current-snapshot.json',import.meta.url));
const actualBudgetSha='4bf300f0b3b004bdaa6a8fc26cfd7f017f78bcaec19070c3f940974a4df8d870';
assert.equal(actualBudgetRaw.length,105881);assert.equal(createHash('sha256').update(actualBudgetRaw).digest('hex'),actualBudgetSha);
const actualBudgetSnapshot=()=>JSON.parse(actualBudgetRaw.toString()) as any;
function actualBudgetPublisherRead(snapshot:any){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFSITE-report-budget-')),file=join(root,'snapshot.json');chmodSync(root,0o700);
 const originalNow=Date.now,originalFetch=globalThis.fetch;
 try{
  writeFileSync(file,JSON.stringify(snapshot),{mode:0o600});chmodSync(file,0o600);
  Date.now=()=>Date.parse(snapshot.times.generatedAt);globalThis.fetch=()=>{throw Error('OFFSITE_PUBLISHER_NETWORK_FORBIDDEN');};
  return readSnapshotFileWithProvenance(file,{accountId:snapshot.account.id,inceptionAt:snapshot.account.inceptionAt,release:snapshot.source.release,strategy:snapshot.source.strategy});
 }finally{Date.now=originalNow;globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});}
}
function actualBudgetProtected(value:OperatingIntelligence){
 const v=structuredClone(value) as any;
 delete v.decisions;delete v.quality.limitations;
 if(v.financialHandoff?.requestTiming)delete v.financialHandoff.requestTiming.refusals;
 if(v.protection?.completedProtectionCycles)delete v.protection.completedProtectionCycles.recent;
 return JSON.stringify(v);
}

test('actual H12 retained snapshot is rejected by the unchanged stock 32 KiB intelligence gate',()=>{
 const snapshot=actualBudgetSnapshot();assert.equal(size(snapshot.intelligence),47154);
 assert.throws(()=>actualBudgetPublisherRead(snapshot),/OPERATING_INTELLIGENCE_BYTES/);
 assert.equal(createHash('sha256').update(actualBudgetRaw).digest('hex'),actualBudgetSha);
});

test('actual completed-diagnostic pressure fits the unchanged stock publisher while every protected fact and timestamp stays exact',()=>{
 const snapshot=frozen(actualBudgetSnapshot()),before=JSON.stringify(snapshot),original=snapshot.intelligence as OperatingIntelligence;
 const bounded=boundOperatingIntelligence(original);
 assert.ok(size(bounded)<=maximumBytes,`actual bounded intelligence bytes=${size(bounded)}`);
 assert.equal(actualBudgetProtected(bounded),actualBudgetProtected(original),'only approved display arrays and quality disclosure may change');
 assert.equal(JSON.stringify(snapshot),before,'retained source input is immutable');
 const output={...snapshot,intelligence:bounded};const {intelligence:oldIntelligence,...oldFinancial}=snapshot,{intelligence:newIntelligence,...newFinancial}=output;
 assert.equal(JSON.stringify(newFinancial),JSON.stringify(oldFinancial),'all financial history, positions, P&L, policy and original outer clocks remain exact');
 const accepted=actualBudgetPublisherRead(output);assert.deepEqual(accepted.snapshot.intelligence,bounded);
 assert.deepEqual(output.times,snapshot.times);assert.equal(output.sequence,snapshot.sequence);
 validateOperatingIntelligence(bounded,snapshot.times.generatedAt);
});

test('incremental UTF-8 accounting preserves the exact installed completed-row projection',()=>{
 const original=frozen(actualBudgetSnapshot().intelligence) as OperatingIntelligence,result=boundOperatingIntelligence(original);
 // Captured from the installed07d projection over the immutable original
 // fixture, before the serialization-cost optimization. This covers all three
 // interleaved histories, escaped/UTF-8 text and multi-digit disclosures.
 const body=JSON.stringify(result);
 assert.equal(Buffer.byteLength(body),32627);
 assert.equal(createHash('sha256').update(body).digest('hex'),'730d1fba396e3abfc795f60e4a65fac55df3b2186b7dfe46c4c878316cb427e9');
 assert.equal(actualBudgetProtected(result),actualBudgetProtected(original));
 validateOperatingIntelligence(result,actualBudgetSnapshot().times.generatedAt);
});

test('completed display lists retain exact newest suffixes and disclose each omission without modifying original warnings',()=>{
 const original=frozen(actualBudgetSnapshot().intelligence) as OperatingIntelligence,bounded=boundOperatingIntelligence(original);
 const oldLists=[original.decisions,original.financialHandoff!.requestTiming!.refusals,original.protection.completedProtectionCycles!.recent];
 const newLists=[bounded.decisions,bounded.financialHandoff!.requestTiming!.refusals,bounded.protection.completedProtectionCycles!.recent];
 const omitted=oldLists.map((rows,index)=>{const kept=newLists[index]!;assert.deepEqual(kept,rows.slice(rows.length-kept.length));return rows.length-kept.length;});
 assert.ok(omitted.some(n=>n>0));
 const disclosure=bounded.quality.limitations.find(note=>/display rows omitted:/i.test(note));
 assert.ok(disclosure,'all three completed display histories need explicit omission counts');
 const counts=/display rows omitted: decisions=(\d+), request refusals=(\d+), completed protection=(\d+)\./i.exec(disclosure!);
 assert.ok(counts);assert.deepEqual(counts!.slice(1).map(Number),omitted);
 for(const [index,note]of original.quality.limitations.entries())assert.ok(bounded.quality.limitations[index]!.startsWith(note),'original warnings remain complete and in order');
 assert.equal(boundOperatingIntelligence(bounded),bounded,'an already bounded publication gains no second disclosure or fresh clock');
 assert.equal(actualBudgetProtected(bounded),actualBudgetProtected(original));
});

test('synthetic valid two-holding four-slot report retains every active handoff, pending sell and unsettled-request aggregate',()=>{
 const snapshot=actualBudgetSnapshot(),value=snapshot.intelligence as any,T=Date.parse(snapshot.times.generatedAt),iso=(at:number)=>new Date(at).toISOString();
 const mints=value.slotProductivity.slots.map((row:any)=>row.mint);
 Object.assign(value.financialPolicy.operatingCapacity,{heldPositions:2,pendingBuyOrders:0,occupiedPositions:2,available:false});
 value.protection.state='monitored';value.protection.lastCompletedAt=iso(T-200);
 value.pendingOrders=mints.slice(0,2).map((mint:string,index:number)=>({id:'SYNTHETIC-owned-sell-'+index,mint,side:'sell',decidedAt:iso(T-2000),executeAt:iso(T-1000),expiresAt:iso(T+5000),reservedSol:'0.000007000',quantityMinimum:'123456789',reason:'SYNTHETIC existing owned sell obligation. '+('Retained pending financial facts. '.repeat(8))}));
 value.financialHandoff.seen+=4;
 value.financialHandoff.active=mints.map((mint:string)=>({mint,windowEndAt:iso(Math.floor(T/10000)*10000),deadlineAt:iso(Math.floor(T/10000)*10000+9999),admittedAt:iso(T-500),firstSeenAt:iso(T-400),state:'waiting',reason:'pending-orders',observedAt:iso(T-300),blockingPrerequisite:'PENDING_ORDERS',operation:'FINANCIAL_DECISION',requiredMs:1450,availableMs:5000}));
 // Real physical occupancy is an aggregate fact, never a removable completed row.
 value.financialHandoff.requestTiming.physicalStarts+=1;
 value.decisions=value.decisions.map((row:any)=>({...row,reason:'SYNTHETIC completed display-only history '+('€"\\'.repeat(100))}));
 const before=JSON.stringify(value),bounded=boundOperatingIntelligence(frozen(value));
 assert.ok(size(bounded)<=maximumBytes,`protected valid current obligations must fit this fixture; got ${size(bounded)}`);
 assert.equal(actualBudgetProtected(bounded),actualBudgetProtected(value));assert.equal(JSON.stringify(value),before);
 assert.deepEqual(bounded.pendingOrders,value.pendingOrders);assert.deepEqual(bounded.financialHandoff!.active,value.financialHandoff.active);
 assert.deepEqual(bounded.financialHandoff!.requestTiming!.methods,value.financialHandoff.requestTiming.methods);
 assert.equal(bounded.financialHandoff!.requestTiming!.physicalStarts,bounded.financialHandoff!.requestTiming!.physicalSettlements+1);
 assert.equal(bounded.financialPolicy!.operatingCapacity!.maximumPositions,2);assert.equal(bounded.slotProductivity!.configuredSlots,4);
 validateOperatingIntelligence(bounded,snapshot.times.generatedAt);
});

test('an active or unsettled request row cannot be evicted to turn invalid original evidence into a publishable completed history',()=>{
 const snapshot=actualBudgetSnapshot(),value=snapshot.intelligence as any;
 value.financialHandoff.requestTiming.refusals[0].transportStarted=true;
 value.financialHandoff.requestTiming.refusals[0].physicalSettlementClaimed=false;
 const original=structuredClone(value.financialHandoff.requestTiming.refusals[0]),bounded=boundOperatingIntelligence(frozen(value));
 assert.ok(bounded.financialHandoff!.requestTiming!.refusals.some(row=>JSON.stringify(row)===JSON.stringify(original)),'unsettled/unknown rows remain protected even when the current wire validator refuses them');
 assert.throws(()=>validateOperatingIntelligence(bounded,snapshot.times.generatedAt),/REQUEST_TIMING|FINANCIAL_HANDOFF/);
 assert.equal(actualBudgetProtected(bounded),actualBudgetProtected(value));
});

test('multi-digit omission disclosure never leaves stale counts when ten warning slots are exactly full',()=>{
 const seed=boundOperatingIntelligence(fixture());
 const note=seed.quality.limitations.find(row=>row.includes('Display rows omitted:'))!;
 const zeroNote=note.replace(/decisions=\d+/, 'decisions=0').replace(/request refusals=\d+/, 'request refusals=0').replace(/completed protection=\d+/, 'completed protection=0');
 const value=fixture();value.quality.limitations=['w'.repeat(512-zeroNote.length-1),...Array.from({length:9},()=> 'w'.repeat(512))];
 const before=structuredClone(value),result=boundOperatingIntelligence(frozen(value));
 assert.equal(result,value,'unrepresentable updated disclosure must preserve the source and fail closed');assert.deepEqual(value,before);
 assert.throws(()=>validateOperatingIntelligence(result,generatedAt),/OPERATING_INTELLIGENCE_BYTES/);
});
