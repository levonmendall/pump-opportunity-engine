import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEconomicReserves,describeEconomicReserveChange,repeatEconomicReserveDecrease} from '../src/economic-reserves.js';

test('fee sweeps leave curve depth and real payout funds invariant, including negative virtual reserves',()=>{
 const available=20_000_000_000n;
 for(const boost of [0n,3_000_000_000n])for(const fees of [1n,30_000_000n,1_000_000_000n]){
  const before={baseReserveUnits:'1000000000',rawQuoteReserveLamports:(available+fees).toString(),virtualQuoteReserveLamports:(boost-fees).toString(),feeBucketsLamports:fees.toString()},after={...before,rawQuoteReserveLamports:available.toString(),virtualQuoteReserveLamports:boost.toString(),feeBucketsLamports:'0'};
  assert.deepEqual(normalizeEconomicReserves(before),normalizeEconomicReserves(after));
  const change=describeEconomicReserveChange(before,after)!;
  assert.equal(change.classification,'ACCOUNTING_OFFSET_COMPATIBLE');assert.equal(change.cause,'UNVERIFIED_SNAPSHOT_DIFFERENCE');assert.equal(change.economicDecreaseObserved,false);assert.equal(change.economicNondecreaseObserved,true);
  assert.equal(change.effectiveQuoteDecreaseLamports,'0');assert.equal(change.availableQuoteDecreaseLamports,'0');
 }
});

test('unreported historical fee buckets stay unknown rather than becoming zero fees or measured funds loss',()=>{
 const before={baseReserveUnits:'1000',rawQuoteReserveLamports:'110',virtualQuoteReserveLamports:'-10'},after={baseReserveUnits:'1000',rawQuoteReserveLamports:'100',virtualQuoteReserveLamports:'0',feeBucketsLamports:'0'};
 const change=describeEconomicReserveChange(before,after)!;
 assert.equal(normalizeEconomicReserves(before)!.availableQuoteReserveLamports,null);assert.equal(change.classification,'EFFECTIVE_DEPTH_UNCHANGED_REAL_FUNDS_UNKNOWN');assert.equal(change.availableQuoteChangeLamports,null);assert.equal(change.availableQuoteDecreaseLamports,null);assert.equal(change.economicDecreaseObserved,false);assert.equal(change.economicNondecreaseObserved,false);
});

test('ordinary sell-like and two-sided reserve changes retain their measured effects without asserting withdrawal',()=>{
 const before={baseReserveUnits:'1000',rawQuoteReserveLamports:'100',virtualQuoteReserveLamports:'0',feeBucketsLamports:'0'};
 const sold=describeEconomicReserveChange(before,{...before,baseReserveUnits:'1100',rawQuoteReserveLamports:'90'})!;
 assert.equal(sold.classification,'SELL_LIKE_CHANGE_CAUSE_UNVERIFIED');assert.equal(sold.effectiveQuoteDecreaseLamports,'10');assert.equal(sold.availableQuoteDecreaseLamports,'10');assert.equal(sold.economicDecreaseObserved,true);
 const reduced=describeEconomicReserveChange(before,{...before,baseReserveUnits:'900',rawQuoteReserveLamports:'90'})!;
 assert.equal(reduced.classification,'BOTH_RESERVES_DECREASED_CAUSE_UNVERIFIED');assert.equal(reduced.cause,'UNVERIFIED_SNAPSHOT_DIFFERENCE');
});

test('curve depth and real available funds are stressed independently and missing funds history adds no invented drain',()=>{
 const pool={base:1000n,raw:100n,virtual:20n,buckets:10n};
 const unknownFunds=describeEconomicReserveChange({baseReserveUnits:'900',rawQuoteReserveLamports:'140',virtualQuoteReserveLamports:'0'},{baseReserveUnits:'1000',rawQuoteReserveLamports:'100',virtualQuoteReserveLamports:'20',feeBucketsLamports:'10'})!;
 const curveStress=repeatEconomicReserveDecrease(pool,unknownFunds);
 assert.equal(curveStress.raw+curveStress.virtual,100n);assert.equal(curveStress.raw-curveStress.buckets,90n);
 const realFunds=describeEconomicReserveChange({baseReserveUnits:'1000',rawQuoteReserveLamports:'120',virtualQuoteReserveLamports:'0',feeBucketsLamports:'0'},{baseReserveUnits:'1000',rawQuoteReserveLamports:'100',virtualQuoteReserveLamports:'20',feeBucketsLamports:'10'})!;
 const fundsStress=repeatEconomicReserveDecrease(pool,realFunds);
 assert.equal(realFunds.effectiveQuoteDecreaseLamports,'0');assert.equal(realFunds.availableQuoteDecreaseLamports,'30');assert.equal(fundsStress.raw+fundsStress.virtual,120n);assert.equal(fundsStress.raw-fundsStress.buckets,60n);
});

test('malformed reserves cannot become evidence while measured depletion remains representable',()=>{
 const base={baseReserveUnits:'1000',rawQuoteReserveLamports:'100',virtualQuoteReserveLamports:'0',feeBucketsLamports:'0'};
 for(const invalid of [{...base,virtualQuoteReserveLamports:'-101'},{...base,feeBucketsLamports:'101'},{...base,baseReserveUnits:'0'},{...base,rawQuoteReserveLamports:'1e2'},{...base,feeBucketsLamports:'unknown'}])assert.equal(normalizeEconomicReserves(invalid),null);
 assert.deepEqual(normalizeEconomicReserves({...base,rawQuoteReserveLamports:'0'}),{baseReserveUnits:'1000',effectiveQuoteReserveLamports:'0',availableQuoteReserveLamports:'0'});
});
