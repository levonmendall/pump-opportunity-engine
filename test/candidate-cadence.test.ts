import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CandidateCadence,evaluateCandidateCadence} from '../src/candidate-cadence.js';
import {evaluatePrimary,type NormalizedTrade,type RuleContext} from '../src/strategy.js';
const T=36_000_000,mint='SYNTHETIC-cadence-mint';
const trade=(i:number,over:Partial<NormalizedTrade>={}):NormalizedTrade=>({identity:{signature:`SYNTHETIC-signature-${i}`,instructionIndex:0,eventIndex:0},mint,wallet:`SYNTHETIC-buyer-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:'300000',receivedAt:T+i*10_000+100,commitment:'confirmed',slot:1000+i,...over});
function ready(cadence:1000|10000){const w=new CandidateCadence(mint,T,cadence);for(let i=0;i<6;i++)w.ingest(trade(i));return w;}
const context=(now:number,allowed=true):RuleContext=>({mint,now,migrationAt:T-300_000,migrationVerified:true,supportedPool:true,flowFieldsVerified:true,flowVerificationEvidence:'SYNTHETIC contract',riskEntriesAllowed:allowed,alreadyTradedMint:false,quote:{mint,at:now,evidence:'SYNTHETIC quote',allInInitialCostMicroUsd:'50000000',sizeToEffectiveLiquidityBps:200,expectedBaseUnits:'100000'}});

test('all observations, identities, amounts, duplicates and confirmations reach unchanged closed-bin core',()=>{
  const slow=new CandidateCadence(mint,T,10000),fast=new CandidateCadence(mint,T,1000);
  const events=[trade(0,{commitment:'processed'}),trade(0,{receivedAt:T+101,commitment:'processed'}),trade(0,{identity:{...trade(0).identity,eventIndex:1},receivedAt:T+102})];
  for(const event of events){slow.ingest(event);fast.ingest(event);}
  for(let at=T+1000;at<=T+60000;at+=1000){const a=fast.calculate(at),b=slow.calculate(at);if(at%10000===0)assert.deepEqual(a,b);}
  assert.equal(slow.snapshot()!.tradeCount,2);assert.equal(slow.snapshot()!.buyLamports,'600000000');
  const confirmation=trade(0,{receivedAt:T+61200,commitment:'confirmed'});slow.ingest(confirmation);fast.ingest(confirmation);
  const current=fast.calculate(T+62000)!;assert.equal(current.provisionalTradeCount,0);assert.equal(slow.calculate(T+62000),null);
  assert.equal(slow.snapshot()!.asOf,T+60000);assert.equal(slow.status().unscoredObservations,true);
  assert.deepEqual(fast.calculate(T+70000),slow.calculate(T+70000));
  assert.equal(slow.status().outcomes.duplicate,1);assert.equal(slow.status().outcomes.confirmed,1);
});

test('gap/correction/reversal block quality immediately rather than waiting for calculation cadence',()=>{
  const w=ready(10000);assert.equal(w.calculate(T+60000)!.sufficientlyObserved,true);
  w.ingest(trade(0,{receivedAt:T+61500,quoteLamports:'300000001'}));
  assert.equal(w.status().invalidatedSinceCalculation,true);assert.equal(w.status().qualityBlocked,true);assert.equal(w.snapshot()!.asOf,T+60000);
  assert.equal(w.calculate(T+70000)!.qualityReason,'correction');
  assert.equal(w.calculate(T+120000)!.sufficientlyObserved,false);assert.equal(w.calculate(T+130000)!.sufficientlyObserved,true);
  w.gap(T+130001);assert.equal(w.status().qualityBlocked,true);assert.equal(w.calculate(T+140000)!.qualityReason,'feed-gap');
  w.reverse(trade(0).identity,T+140001);assert.equal(w.status().qualityBlocked,true);assert.equal(w.calculate(T+150000)!.qualityReason,'reversal');
});

test('late scheduling never backdates calculations or refreshes cached availability',()=>{
  const w=new CandidateCadence(mint,T,10000);w.ingest(trade(0));
  const features=w.calculate(T+35000)!;assert.equal(features.asOf,T+35000);assert.equal(features.windowEndAt,T+30000);
  assert.equal(w.status().calculations,1);assert.equal(w.status().skippedTicks,2);assert.equal(w.status().maxLatenessMs,25000);
  assert.equal(w.calculate(T+36000),null);assert.equal(w.snapshot()!.asOf,T+35000);
  assert.throws(()=>w.ingest(trade(1,{receivedAt:T+35001})),/TIME_REGRESSION/);
});

test('synthetic full workload preserves common-boundary exact features and all ingestion while reducing calculations90percent',()=>{
  const r=evaluateCandidateCadence();assert.equal(r.commonBoundariesCompared,720);assert.deepEqual(r.commonBoundaryMismatches,[]);
  assert.equal(r.frequent.featureCalculations,7200);assert.equal(r.boundary.featureCalculations,720);assert.equal(r.featureCalculationReductionFraction,.9);
  assert.deepEqual(r.frequent.ingestion,r.boundary.ingestion);assert.ok(r.boundary.ingestion.duplicate!>0);assert.ok(r.boundary.ingestion.confirmed!>0);assert.ok(r.boundary.ingestion.invalidated!>0);
  assert.equal(r.firstQualificationEqual,true);assert.equal(r.rpcRequestSavings,0);assert.equal(r.providerNetworkRequests,0);
});

test('external risk-resume between boundaries can delay qualification; it must not be reported as blanket equivalence',()=>{
  const fast=ready(1000),slow=ready(10000);let a:number|null=null,b:number|null=null;
  for(let now=T+60000;now<=T+80000;now+=1000){
    const ff=fast.calculate(now),sf=slow.calculate(now),allowed=now>=T+75001;
    if(ff&&evaluatePrimary(ff,context(now,allowed)).qualified)a??=now;
    if(sf&&evaluatePrimary(sf,context(now,allowed)).qualified)b??=now;
  }
  //At76s five initial buyer bins remain eligible; at80s another expires. A
  //risk resume just after75s creates a short-lived opportunity the10s clock
  //does not sample. This is a synthetic opportunity-timing counterexample.
  assert.equal(a,T+76000);assert.equal(b,null);
  const run=(cadence:1000|10000)=>{
    const w=new CandidateCadence(mint,T,cadence);let first:number|null=null;
    for(let now=T+1000;now<=T+90000;now+=1000){
      w.ingest(trade(now-T,{identity:{signature:`SYNTHETIC-continuous-${now}`,instructionIndex:0,eventIndex:0},wallet:`buyer-${Math.floor(now/1000)%10}`,receivedAt:now,tokenUnits:'300000'}));
      const f=w.calculate(now);if(f&&evaluatePrimary(f,context(now,now>=T+75001)).qualified)first??=now;
    }
    return first;
  };
  assert.equal(run(1000),T+76000);assert.equal(run(10000),T+80000);
});

test('context-triggered calculation uses current availability, preserves next boundary and cannot bypass quality warming',()=>{
  const w=ready(10000);w.calculate(T+60000);w.calculate(T+70000);
  const before=w.status().calculations,at=T+75001,f=w.calculateForContext(at,'risk-state');
  assert.equal(f.asOf,at);assert.equal(evaluatePrimary(f,context(at)).qualified,true);
  assert.equal(w.status().nextCalculationAt,T+80000);assert.equal(w.status().contextCalculations,1);
  assert.deepEqual(w.calculateForContext(at,'quote-availability'),f);assert.equal(w.status().calculations,before+1);
  assert.equal(w.calculate(T+80000)!.asOf,T+80000);
  w.gap(T+80001);const blocked=w.calculateForContext(T+80002,'risk-state');
  assert.equal(blocked.sufficientlyObserved,false);assert.equal(blocked.qualityReason,'feed-gap');assert.equal(w.status().qualityBlocked,true);
});
