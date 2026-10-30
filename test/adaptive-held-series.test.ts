import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveHeldSeries,ADAPTIVE_HELD_SERIES_POLICY,type AdaptiveHeldObservation} from '../src/adaptive-held-series.js';
import {evaluateAdaptiveExit} from '../src/adaptive-momentum-v2.js';

const UNIT=1000000n;
function fixture(){
 const series=new AdaptiveHeldSeries();let at=10000,peak=0n;
 const input=(value:number,extra:Partial<AdaptiveHeldObservation>={}):AdaptiveHeldObservation=>{const net=BigInt(value)*UNIT;peak=net>peak?net:peak;return {now:at,mint:'OFFLINE-held-A',roundTripId:'OFFLINE-roundtrip-A',enteredAt:0,heldBaseUnits:'1000',highWaterNetLamports:String(peak),mark:{at,netLamports:String(net),pricedBaseUnits:'1000',evidence:'OFFLINE exact-size quote '+at},sourceCurrent:true,...extra};};
 const observe=(value:number,extra:Partial<AdaptiveHeldObservation>={})=>{const i=input(value,extra),r=series.observe(i);at+=1000;return {input:i,signal:r};};
 return {series,input,observe,get at(){return at;},set at(value:number){at=value;}};
}
function adaptiveDecision(i:AdaptiveHeldObservation,volatilityBps:number|null){return evaluateAdaptiveExit({now:i.now,enteredAt:i.enteredAt,entryCostLamports:String(50n*UNIT),heldBaseUnits:i.heldBaseUnits,mark:i.mark,highWaterNetLamports:i.highWaterNetLamports,...(volatilityBps===null?{}:{volatilityBps})});}

test('prior executable dispersion can widen at a new high-water without lowering the modeled boundary',()=>{
 const f=fixture();f.observe(100);const old=f.observe(120);f.observe(100);const next=f.observe(150);
 assert.equal(next.signal.priorQuoteCount,3);assert.equal(next.signal.priorReturnCount,2);assert.equal(next.signal.priorThroughAt,12000);assert.equal(next.signal.minimumIntervalMs,1000);assert.equal(next.signal.maximumIntervalMs,1000);
 assert.equal(next.signal.measuredVolatilityBps,2593);assert.equal(next.signal.effectiveVolatilityBps,1600);assert.equal(next.signal.trailingDistanceBps,3200);
 assert.equal(next.signal.modeledTrailingBoundaryLamports,old.signal.modeledTrailingBoundaryLamports);assert.equal(adaptiveDecision(next.input,next.signal.effectiveVolatilityBps).action,'hold');
});

test('a crash cannot widen its own trail, on that decision or a later lower quote',()=>{
 const f=fixture();for(const value of[100,120,100,150])f.observe(value);
 const first=f.observe(110),later=f.observe(100);assert.equal(first.signal.effectiveVolatilityBps,1600);assert.equal(later.signal.effectiveVolatilityBps,1600);
 assert.equal(first.signal.modeledTrailingBoundaryLamports,'102000000');assert.equal(later.signal.modeledTrailingBoundaryLamports,'102000000');
 assert.equal(adaptiveDecision(first.input,first.signal.effectiveVolatilityBps).action,'hold');assert.equal(adaptiveDecision(later.input,later.signal.effectiveVolatilityBps).action,'request-exit');
 assert.match(adaptiveDecision(later.input,later.signal.effectiveVolatilityBps).reason,/trailing/);
});

test('constant proportional appreciation measures drift rather than manufactured volatility',()=>{
 const f=fixture();for(const value of[10000,11000,12100])f.observe(value);const next=f.observe(13310);
 assert.equal(next.signal.measuredVolatilityBps,0);assert.equal(next.signal.effectiveVolatilityBps,0);assert.equal(next.signal.trailingDistanceBps,1500);
});

test('duplicate quote is never an extra observation or input to its own lagged statistic',()=>{
 const f=fixture();for(const value of[100,120,100])f.observe(value);const next=f.observe(150),before=f.series.usage();
 const reused=f.series.observe({...next.input,now:next.input.now+100});assert.equal(reused.acceptedNewQuote,false);assert.equal(reused.priorQuoteCount,3);assert.equal(reused.measuredVolatilityBps,next.signal.measuredVolatilityBps);assert.deepEqual(f.series.usage(),before);
 const conflict=f.series.observe({...next.input,now:next.input.now+101,mark:{...next.input.mark!,evidence:'OFFLINE conflicting same-time state'}});assert.equal(conflict.reason,'same-time-quote-conflict');assert.equal(conflict.effectiveVolatilityBps,null);assert.equal(f.series.usage().quotes,0);
});

test('unavailable or invalid evidence restores the legacy fallback without disturbing another holding',()=>{
 for(const bad of['source','missing','stale','future','size','text','net']as const){
  const f=fixture();for(const value of[100,120,100,150])f.observe(value);
  const other=f.input(150,{mint:'OFFLINE-held-B',roundTripId:'OFFLINE-roundtrip-B'});f.series.observe(other);
  const i=f.input(110);if(bad==='source')i.sourceCurrent=false;else if(bad==='missing')i.mark=null;else if(bad==='stale')i.mark!.at=i.now-2001;else if(bad==='future')i.mark!.at=i.now+1;else if(bad==='size')i.mark!.pricedBaseUnits='999';else if(bad==='text')i.mark!.evidence='';else i.mark!.netLamports='NaN';
  const r=f.series.observe(i);assert.equal(r.state,'fallback',bad);assert.equal(r.effectiveVolatilityBps,null,bad);assert.equal(f.series.usage().series,1,bad);assert.equal(f.series.usage().quotes,1,bad);
  const recovery=f.observe(110);assert.equal(recovery.signal.priorQuoteCount,0,bad);assert.equal(recovery.signal.trailingDistanceBps,1500,bad);assert.equal(adaptiveDecision(recovery.input,recovery.signal.effectiveVolatilityBps).action,'request-exit',bad);
 }
});

test('quote gaps, completed-evaluation gaps and restart tighten to the persisted high-water fallback',()=>{
 for(const completedGap of[false,true]){
  const f=fixture();for(const value of[100,120,100,150])f.observe(value);
  f.at=17001;const i=f.input(110);if(completedGap)i.mark!.at=15001;
  const r=f.series.observe(i);assert.equal(r.reason,'completed-protection-gap');assert.equal(r.priorQuoteCount,0);assert.equal(r.trailingDistanceBps,1500);assert.equal(adaptiveDecision(i,r.effectiveVolatilityBps).action,'request-exit');
 }
 const f=fixture();for(const value of[100,120,100,150])f.observe(value);const held=f.input(110),r=new AdaptiveHeldSeries().observe(held);assert.equal(r.effectiveVolatilityBps,null);assert.equal(r.modeledTrailingBoundaryLamports,'127500000');assert.equal(adaptiveDecision(held,r.effectiveVolatilityBps).action,'request-exit');
});

test('round trips and changed quantities cannot borrow earlier volatility',()=>{
 const f=fixture();for(const value of[100,120,100,150])f.observe(value);
 const changed=f.observe(110,{heldBaseUnits:'2000',mark:{at:f.at,netLamports:'110000000',pricedBaseUnits:'2000',evidence:'OFFLINE new actual-size quote'}});assert.equal(changed.signal.reason,'round-trip-or-size-changed');assert.equal(changed.signal.priorQuoteCount,0);
 f.series.retain([{mint:'OFFLINE-held-A',roundTripId:'OFFLINE-new-roundtrip'}]);assert.deepEqual(f.series.usage(),{series:0,quotes:0,maximumQuotesPerSeries:256});
 const next=f.observe(130,{roundTripId:'OFFLINE-new-roundtrip',enteredAt:f.at-100});assert.equal(next.signal.priorQuoteCount,0);assert.equal(next.signal.effectiveVolatilityBps,null);
});

test('the absolute cost stop remains active even with a historically wider profit trail',()=>{
 const f=fixture();for(const value of[100,120,100,150])f.observe(value);const crash=f.observe(40);
 const decision=adaptiveDecision(crash.input,crash.signal.effectiveVolatilityBps);assert.equal(decision.action,'request-exit');assert.match(decision.reason,/protective-cost-stop/);
});

test('regressing observations and contradictory ledger peaks never supply adaptive permission',()=>{
 const f=fixture();const initial=f.input(100,{now:12000});f.series.observe(initial);
 const regressed={...initial,now:11999,mark:{...initial.mark!,at:11000,evidence:'OFFLINE later quote under a regressing observation clock'}};
 assert.equal(f.series.observe(regressed).reason,'observation-time-regressed');assert.equal(f.series.usage().quotes,0);
 const notCheckpointed=f.input(150,{highWaterNetLamports:'100000000'});assert.equal(f.series.observe(notCheckpointed).reason,'authoritative-high-water-not-checkpointed');assert.equal(f.series.usage().quotes,0);
});

test('descriptive storage is bounded and old samples retire without stopping financial work',()=>{
 const f=fixture();for(let n=0;n<1000;n++){f.at=10000+n*250;f.observe(100);}
 assert.equal(f.series.usage().series,1);assert.ok(f.series.usage().quotes<=ADAPTIVE_HELD_SERIES_POLICY.maximumQuotes);assert.ok(f.series.usage().quotes<=241);
 const i=f.input(100),r=f.series.observe(i);assert.ok(r.priorFromAt!>=i.mark!.at-60000);f.series.retain([]);assert.equal(f.series.usage().quotes,0);
});
