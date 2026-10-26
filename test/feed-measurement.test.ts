import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FeedMeasurement,MEASUREMENT_LIMITS,type MeasurementBudgetProjection} from '../src/feed-measurement.js';
const T=Date.parse('2026-10-26T12:00:00.000Z');
const MINT='So11111111111111111111111111111111111111112';
const OTHER='11111111111111111111111111111111';
const budget=(at=T,change:Partial<MeasurementBudgetProjection>={}):MeasurementBudgetProjection=>({wallet:{address:MEASUREMENT_LIMITS.billingWallet,at,balanceLamports:'60000000'},price:{at,microUsdPerSol:'200000000'},remainingDailyLamports:'10000000',remainingTotalLamports:'40000000',remainingDailyMicroUsd:'2500000',remainingTotalMicroUsd:'10000000',heldReserveLamports:'0',heldReserveMicroUsd:'0',...change});
const message=JSON.stringify({signature:'DISPOSABLE-signature',mint:MINT,txType:'buy',solAmount:0.1,tokenAmount:100,slot:123,error:'fixture-secret-value-never-output'});
function fixture(options:{startedAt:number;mint:string;verifiedPool:boolean;budget:MeasurementBudgetProjection;heldMints?:readonly string[]}){
  let mono=0;const core=new FeedMeasurement({...options,monotonicNow:()=>mono});
  return new Proxy(core,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args:unknown[])=>{const wall=args.find(v=>typeof v==='number');if(typeof wall==='number')mono=wall-options.startedAt;return Reflect.apply(value,target,args);};}});
}
const measurement=(p=budget(),heldMints:readonly string[]=[])=>fixture({startedAt:T,mint:MINT,verifiedPool:true,budget:p,heldMints});
function connected(m:FeedMeasurement,at=T){m.connected(at);m.acknowledgeSubscription(at);}

test('potential charges count before duplicate/malformed discard and inventory never returns raw values',()=>{
  const m=measurement();assert.equal(m.admission(T).allowed,true);connected(m);
  m.ingest(message,T+1000);m.ingest(message,T+1001);
  m.ingest(JSON.stringify({signature:'DISPOSABLE-signature',mint:MINT,txType:'sell',solAmount:0.2,tokenAmount:200}),T+1002);
  let s=m.ingest('{broken',T+1003);
  assert.equal(s.frames,4);assert.equal(s.potentialBillableEvents,4);assert.equal(s.duplicateSignatureAndExactPayloads,1);assert.equal(s.repeatedSignatures,2);
  assert.equal(s.selectedToken.frames,3);assert.equal(s.selectedToken.tradeLikeFrames,3);assert.equal(s.malformedFrames,1);assert.equal(s.gaps,1);
  assert.equal(s.costs.estimatedLamports,'4000');assert.equal(s.costs.estimatedMicroUsd,'800');assert.equal(s.costs.label,'estimated');
  assert.deepEqual(s.fieldInventory.find(x=>x.name==='solAmount')?.typeCounts,{number:3});
  assert.equal(s.duplicateDetectionIsEventIdentityProof,false);assert.equal(s.fieldContractVerified,false);assert.equal(s.entriesEnabled,false);assert.equal(s.featureWindowReady,false);
  const encoded=JSON.stringify(s);for(const value of ['fixture-secret-value-never-output','DISPOSABLE-signature'])assert.equal(encoded.includes(value),false);
  m.updateBudget(budget(T+1004,{wallet:{address:MEASUREMENT_LIMITS.billingWallet,at:T+1004,balanceLamports:'59996000'}}),T+1004);s=m.status(T+1004);
  assert.equal(s.costs.observedWalletBalanceDeltaLamports,'-4000');assert.equal(s.costs.actualProviderChargesLamports,null);assert.equal(s.costs.balanceDeltaIsProofOfCharges,false);
});

test('event ceiling requests upstream unsubscribe and in-flight headroom remains charged, never filtered free',()=>{
  const m=measurement();connected(m);let s=m.status(T);
  for(let i=0;i<1000;i++)s=m.ingest(message,T+1000+i);
  assert.equal(s.potentialBillableEvents,1000);assert.equal(s.duplicateSignatureAndExactPayloads,999);
  assert.equal(s.control.upstreamUnsubscribeRequired,true);assert.equal(s.control.reason,'event-ceiling');assert.equal(s.budget.headroomEventsRemaining,100);
  for(let i=0;i<100;i++)s=m.ingest(message,T+2000+i);
  assert.equal(s.potentialBillableEvents,1100);assert.equal(s.control.eventsAfterStopRequest,100);assert.equal(s.budget.headroomExhausted,true);
  assert.equal(s.control.reason,'headroom-exhausted');assert.equal(s.costs.estimatedLamports,'1100000');assert.equal(s.observationWindowComplete,false);
  assert.deepEqual(s.control.unsubscribeMeasurementTokens,[MINT]);
  const late=m.status(T+86_400_000);assert.equal(late.measurementActiveMs,s.measurementActiveMs);assert.equal(late.costs.projectedDailyLamports,s.costs.projectedDailyLamports);assert.equal(late.aggregatePotentialEventsPerSecond,s.aggregatePotentialEventsPerSecond);
});

test('wallet floor, both SOL and USD caps, stale evidence and per-event USD rounding gate admission',()=>{
  assert.equal(measurement(budget(T,{wallet:{address:MEASUREMENT_LIMITS.billingWallet,at:T,balanceLamports:'20000000'}})).admission(T).reason,'wallet-floor-or-reserve');
  assert.equal(measurement(budget(T,{remainingDailyLamports:'1099999'})).admission(T).reason,'measurement-sol-budget-insufficient');
  assert.equal(measurement(budget(T,{remainingTotalLamports:'1099999'})).admission(T).reason,'measurement-sol-budget-insufficient');
  assert.equal(measurement(budget(T,{price:{at:T,microUsdPerSol:'5000000000'}})).admission(T).reason,'measurement-usd-budget-insufficient');
  assert.equal(measurement(budget(T,{remainingTotalMicroUsd:'219999'})).admission(T).reason,'measurement-usd-budget-insufficient');
  assert.equal(measurement(budget(T,{price:{at:T,microUsdPerSol:'150320000'},remainingDailyMicroUsd:'165400'})).admission(T).reason,'measurement-usd-budget-insufficient'); // 1100*ceil(150.32), not ceil(1100*150.32).
  assert.equal(measurement(budget(T,{price:{at:T-10001,microUsdPerSol:'200000000'}})).admission(T).reason,'sol-usd-stale');
  assert.equal(measurement(budget(T,{wallet:{address:MEASUREMENT_LIMITS.billingWallet,at:T-30001,balanceLamports:'60000000'}})).admission(T).reason,'wallet-balance-stale');
  assert.throws(()=>measurement(budget(T,{remainingDailyLamports:'10000001'})),/increase approved/);
  assert.throws(()=>measurement(budget(T,{price:{at:T+1,microUsdPerSol:'200000000'}})),/available approved-wallet\/price/);
  assert.throws(()=>measurement(budget(T,{wallet:{address:OTHER,at:T,balanceLamports:'60000000'}})),/approved-wallet/);
});

test('held monitoring reserves precede admission and measurement never unsubscribes a held token',()=>{
  const reserved=measurement(budget(T,{remainingDailyLamports:'1500000',heldReserveLamports:'500000',heldReserveMicroUsd:'100000'}),[OTHER]);
  assert.equal(reserved.admission(T).reason,'measurement-sol-budget-insufficient');
  const noHeldCapacity=measurement(budget(T,{remainingDailyLamports:'1500000',heldReserveLamports:'1600000'}),[OTHER]);
  assert.equal(noHeldCapacity.admission(T).reason,'held-monitoring-budget-insufficient');
  const held=measurement(budget(),[MINT]);assert.equal(held.admission(T).reason,'selected-token-is-held');
  const s=held.status(T);assert.equal(s.control.heldPositionMonitoringRequired,true);assert.equal(s.control.measurementMayAlterHeldSubscriptions,false);assert.deepEqual(s.control.unsubscribeMeasurementTokens,[]);
  const degraded=noHeldCapacity.status(T);assert.equal(degraded.control.heldMonitoringBudgetInsufficient,true);assert.equal(degraded.control.authorizedRpcFallbackRequired,true);
});

test('gaps require a fresh uninterrupted 60 seconds and cannot be added together as continuous operation',()=>{
  const m=measurement();connected(m);m.ingest(message,T+1000);m.gap(T+30_000,true);m.connected(T+31_000);
  m.updateBudget(budget(T+31_000),T+31_000);m.acknowledgeSubscription(T+31_000);m.ingest(message,T+31_100);
  m.updateBudget(budget(T+90_000),T+90_000);let s=m.status(T+90_000);
  assert.equal(s.gaps,1);assert.equal(s.reconnects,1);assert.equal(s.observationWindowComplete,false);assert.equal(s.longestContinuousObservationMs,59_000);
  m.updateBudget(budget(T+91_000),T+91_000);s=m.status(T+91_000);assert.equal(s.observationWindowComplete,true);assert.equal(s.featureWindowReady,false);
  m.updateBudget(budget(T+120_000),T+120_000);s=m.status(T+120_000);assert.equal(s.control.reason,'duration-limit');assert.equal(s.control.upstreamUnsubscribeRequired,true);assert.equal(s.observationWindowComplete,false);assert.equal(s.completedObservationWindow,true);
  assert.equal(s.budget.durableCrossRestartSpendingEnforced,false);assert.equal(s.qualified,false);
});

test('late admission, UTC boundary and repeated subscription acknowledgement do not fake a full window',()=>{
  const m=measurement();connected(m);m.updateBudget(budget(T+20_000),T+20_000);m.acknowledgeSubscription(T+20_000);
  m.updateBudget(budget(T+60_000),T+60_000);assert.equal(m.status(T+60_000).observationWindowComplete,true);
  assert.equal(measurement(budget()).admission(T+60_001).reason,'insufficient-time-for-full-window');
  const late=Date.parse('2026-10-26T23:59:30Z');const boundary=fixture({startedAt:late,mint:MINT,verifiedPool:true,budget:budget(late)});
  assert.equal(boundary.admission(late).reason,'insufficient-time-for-full-window');
  assert.equal(boundary.status(late+30_000).control.reason,'utc-day-boundary');
  assert.throws(()=>m.status(T+59_999),/cannot arrive early/);
  const slow=measurement();slow.connected(T);slow.updateBudget(budget(T+20_000),T+20_000);slow.acknowledgeSubscription(T+20_000);slow.ingest(message,T+21_000);
  const rates=slow.status(T+22_000);assert.equal(rates.connectedMs,22_000);assert.equal(rates.measurementActiveMs,2000);assert.equal(rates.aggregatePotentialEventsPerSecond,0.5);
  const g=measurement();connected(g);g.updateBudget(budget(T+60_000),T+60_000);assert.equal(g.status(T+60_000).observationWindowComplete,true);g.gap(T+60_001,true);
  const afterGap=g.status(T+60_001);assert.equal(afterGap.observationWindowComplete,false);assert.equal(afterGap.completedObservationWindow,true);
});

test('unknown USD cost remains unknown after refresh, and a stop request cannot silently resume',()=>{
  const m=measurement();connected(m);let s=m.ingest(message,T+10_001);
  assert.equal(s.costs.estimatedMicroUsd,null);assert.equal(s.costs.knownEstimatedMicroUsd,'0');assert.equal(s.costs.unvaluedPotentialEvents,1);assert.equal(s.control.reason,'sol-usd-stale');
  m.updateBudget(budget(T+10_002),T+10_002);s=m.status(T+10_002);
  assert.equal(s.control.reason,'usd-cost-unknown');assert.equal(m.admission(T+10_002).allowed,false);assert.equal(s.control.upstreamUnsubscribeRequired,true);
});

test('batch, oversized and inventory-limited payloads remain bounded and are still potentially charged',()=>{
  const m=measurement();connected(m);let s=m.ingest('[{},{},{}]',T+1);
  assert.equal(s.potentialBillableEvents,3);assert.equal(s.unsupportedBatchFrames,1);assert.equal(s.gaps,1);
  s=m.ingest('x'.repeat(MEASUREMENT_LIMITS.maximumPayloadBytes+1),T+2);assert.equal(s.potentialBillableEvents,4);assert.equal(s.oversizedFrames,1);
  const many=Object.fromEntries(Array.from({length:100},(_,i)=>[`field${i}`,`fixture-sensitive-value-${i}`]));s=m.ingest(JSON.stringify(many),T+3);
  assert.equal(s.potentialBillableEvents,5);assert.equal(s.inventoryLimited,true);assert.equal(s.fieldInventory.length,64);
  assert.equal(JSON.stringify(s).includes('fixture-sensitive-value'),false);
});

test('observed-rate projections report a ceiling failure without pretending short bursts are full observation',()=>{
  const m=measurement();connected(m);for(let i=0;i<500;i++)m.ingest(message,T+1+i);
  const s=m.status(T+5000);assert.equal(s.aggregatePotentialEventsPerSecond,100);assert.equal(s.costs.projectedDailyLamports,'8640000000');
  assert.equal(s.costs.measuredMeanEventsForSixtySeconds,'6000');assert.equal(s.costs.measuredMeanMinimumSixtySecondLamports,'6100000');
  assert.equal(s.costs.fullWindowFitsEventCeilingAtObservedMean,false);assert.equal(s.control.pauseNewAdmissions,true);assert.equal(s.control.upstreamUnsubscribeRequired,false);assert.equal(s.observationWindowComplete,false);
});

test('monotonic durations prevent a wall-clock jump from diluting measured costs or fabricating elapsed observation',()=>{
  let mono=0;const m=new FeedMeasurement({startedAt:T,mint:MINT,verifiedPool:true,budget:budget(),monotonicNow:()=>mono});connected(m);
  mono=1000;m.ingest(message,T+1000);mono=2000;m.updateBudget(budget(T+3_600_000),T+3_600_000);
  const s=m.status(T+3_600_000);assert.equal(s.wallElapsedMs,3_600_000);assert.equal(s.durationMs,2000);assert.equal(s.measurementActiveMs,2000);assert.equal(s.aggregatePotentialEventsPerSecond,0.5);assert.equal(s.observationWindowComplete,false);assert.equal(s.control.upstreamUnsubscribeRequired,false);
  mono=1000;assert.throws(()=>m.status(T+3_600_001),/cannot arrive early/);
});
