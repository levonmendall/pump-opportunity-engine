/** Lean-read parity only: no market access, financial account or forward performance. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {ActivePipeline} from '../src/active-pipeline.js';
const captured=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8')),scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:captured.transaction.slot,supportedPoolEvidence:'retained canonical fixture; not current market support'},base=Math.ceil(Date.parse(captured.fetchedAt)/10000)*10000;
const payload=(signature=captured.signature)=>({pool:'pump-amm',poolId:scope.pool,mint:scope.mint,signature,action:'sell'});
function setup(){let now=base;const records:any[]=[],core=new ActivePipeline({scope,now:()=>now,record:(kind,data)=>records.push({kind,data})});core.open(base);return {core,records,set(at:number){now=at;}};}
function parity(core:ActivePipeline,at:number){const lean=core.readiness(at),full=core.snapshot(at,{recordFeatures:false});assert.deepEqual(lean,{latestFeature:full.latestFeature,pending:full.pending,fullyEnriched:full.pending===0,hasQualityLoss:full.qualityGaps.length>0});return {lean,full};}

test('lean readiness matches quiet and actual-trade warming, queued and physical enrichment, and completed information',()=>{
 const f=setup();parity(f.core,base);f.core.observe(payload(),base+100);assert.equal(parity(f.core,base+200).lean.pending,1);
 const hint=f.core.nextHint(base+1100)!;assert.equal(parity(f.core,base+1101).lean.pending,1);f.set(base+1500);f.core.completeHint(hint,captured.transaction,base+1500);assert.equal(parity(f.core,base+1501).lean.fullyEnriched,true);
 assert.equal(parity(f.core,base+59000).lean.latestFeature!.curve.sufficientlyObserved,false);assert.equal(parity(f.core,base+60000).lean.latestFeature!.curve.tradeCount,1);
 const warm=parity(f.core,base+61000);assert.equal(warm.lean.latestFeature!.curve.sufficientlyObserved,true);assert.equal(warm.full.enrichedFeatureWarmSeconds,1);assert.equal(warm.full.noPendingFeatureWarmSeconds,1);
 f.core.observe(payload(bs58.encode(Buffer.alloc(64,45))),base+61100);const pending=parity(f.core,base+62000);assert.equal(pending.lean.pending,1);assert.equal(pending.full.noPendingFeatureWarmSeconds,1.1);
});

test('lean readiness preserves capacity gaps, missing information, expiry and explicit rewarming',()=>{
 const f=setup();f.core.observe({...payload(),signature:'invalid'},base+10);const gap=parity(f.core,base+20);assert.equal(gap.lean.hasQualityLoss,true);assert.equal(gap.lean.latestFeature!.curve.qualityReason,'feed-gap');
 f.core.observe(payload(),base+100);assert.equal(f.core.nextHint(base+5200),null);const late=parity(f.core,base+5201);assert.equal(late.lean.hasQualityLoss,true);assert.equal(late.full.failedTransactions,1);
 assert.equal(parity(f.core,base+65000).lean.latestFeature!.curve.sufficientlyObserved,false);assert.equal(parity(f.core,base+70000).lean.latestFeature!.curve.sufficientlyObserved,true);
 f.core.endObservation(base+71000);f.core.close(base+72000);const closed=parity(f.core,base+73000);assert.equal(closed.lean.latestFeature!.at,base+71000);assert.equal(closed.full.observationMs,71000);
});

test('lean readiness retains corrections and every required trade/gap record while making no feature-record callback',()=>{
 const f=setup();f.core.observe(payload(),base+100);const hint=f.core.nextHint(base+1100)!;f.set(base+1500);f.core.completeHint(hint,captured.transaction,base+1500);
 const before=f.records.filter(r=>r.kind==='research-feature-view').length;for(let at=base+1500;at<=base+65000;at+=50){f.set(at);f.core.readiness(at);}
 assert.equal(f.records.filter(r=>r.kind==='research-feature-view').length,before);assert.equal(f.records.filter(r=>r.kind==='research-normalized-trade').length,1);
 const changed=structuredClone(captured.transaction),ix=changed.meta.innerInstructions[0].instructions[1],data=Buffer.from(bs58.decode(ix.data));data.writeBigUInt64LE(data.readBigUInt64LE(1)+1n,1);ix.data=bs58.encode(data);f.set(base+65100);f.core.audit(hint,changed,base+65100);
 const corrected=parity(f.core,base+65200);assert.equal(corrected.lean.hasQualityLoss,true);assert.equal(corrected.full.corrections,1);assert.ok(f.records.some(r=>r.kind==='research-quality-gap'&&r.data.reason==='confirmed-executed-evidence-correction'));
 assert.equal(Object.hasOwn(corrected.lean,'executedEvidence'),false);assert.equal(Object.hasOwn(corrected.lean,'featureRows'),false);assert.equal(Object.hasOwn(corrected.lean,'prices'),false);
});
