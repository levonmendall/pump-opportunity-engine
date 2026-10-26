import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FlowWindow,OpportunityBook,PROVISIONAL_RULE,evaluatePrimary,evaluateExit,type NormalizedTrade,type RuleContext} from '../src/strategy.js';

const T=36_000_000;
const trade=(index:number,override:Partial<NormalizedTrade>={}):NormalizedTrade=>({
  identity:{signature:`fixture-signature-${index}`,instructionIndex:0,eventIndex:0},mint:'fixture-mint',wallet:`fixture-wallet-${index}`,
  side:'buy',quoteLamports:'300000000',tokenUnits:'300000',receivedAt:T+index*10_000+100,commitment:'processed',slot:1000+index,...override,
});
function ready(){const w=new FlowWindow('fixture-mint',T);for(let i=0;i<6;i++)w.ingest(trade(i,{tokenUnits:String(300_000-i*20_000)}));return w;}
const context=(now=T+60_000):RuleContext=>({mint:'fixture-mint',now,migrationAt:T-300_000,migrationVerified:true,supportedPool:true,
  flowFieldsVerified:true,flowVerificationEvidence:'DISPOSABLE verified-normalized-contract fixture, not PumpPortal evidence',riskEntriesAllowed:true,alreadyTradedMint:false,
  quote:{mint:'fixture-mint',at:now,evidence:'DISPOSABLE actual-size fixture quote',allInInitialCostMicroUsd:'50000000',sizeToEffectiveLiquidityBps:200,expectedBaseUnits:'100000'}});

test('closed receive-time windows warm fully and aggregate integer net flow, six bins and price ratios',()=>{
  const w=ready(),warming=w.features(T+59_999);assert.equal(warming.sufficientlyObserved,false);
  const f=w.features(T+60_000);assert.equal(f.sufficientlyObserved,true);assert.equal(f.windowEndAt,T+60_000);
  assert.equal(f.buyLamports,'1800000000');assert.equal(f.sellLamports,'0');assert.equal(f.netBuyLamports,'1800000000');
  assert.equal(f.positiveNetBuckets,6);assert.equal(f.distinctBuyerWallets,6);assert.equal(f.largestBuyerBps,1667);
  assert.equal(f.provisionalTradeCount,6);assert.equal(f.priceReturnBps,5000);
  w.ingest(trade(6,{receivedAt:T+60_001,quoteLamports:'900000000',side:'sell'}));
  const pending=w.features(T+69_999);assert.equal(pending.sellLamports,'0'); // The open bucket is not partially scored.
  const next=w.features(T+70_000);assert.equal(next.buyLamports,'1500000000');assert.equal(next.sellLamports,'900000000');
  assert.equal(next.netBuyLamports,'600000000');assert.equal(next.tradeCount,6);assert.equal(next.positiveNetBuckets,5);
});

test('one signature can contain multiple events; duplicates do not add volume and confirmations arrive later',()=>{
  const w=new FlowWindow('fixture-mint',T),a=trade(0),b=trade(0,{identity:{...trade(0).identity,eventIndex:1},receivedAt:T+101});
  assert.equal(w.ingest(a),'accepted');assert.equal(w.ingest(b),'accepted');
  assert.equal(w.ingest({...a,receivedAt:T+102}),'duplicate');
  let f=w.features(T+60_000);assert.equal(f.tradeCount,2);assert.equal(f.buyLamports,'600000000');assert.equal(f.provisionalTradeCount,2);
  assert.equal(w.ingest({...a,receivedAt:T+60_001,commitment:'confirmed'}),'confirmed');
  f=w.features(T+60_001);assert.equal(f.tradeCount,2);assert.equal(f.provisionalTradeCount,1);
  assert.throws(()=>w.features(T+60_000),/before it became available/);
  assert.equal(w.ingest({...a,receivedAt:T+60_002,commitment:'finalized'}),'confirmed');
  assert.equal(w.features(T+60_002).provisionalTradeCount,1);
  assert.throws(()=>w.ingest(trade(8,{receivedAt:T+20_000})),/before it became available/);
});

test('corrections, reversals and feed gaps invalidate affected windows without rewriting old flow',()=>{
  const w=ready();w.features(T+60_000);
  assert.equal(w.ingest({...trade(0),receivedAt:T+61_000,quoteLamports:'200000000'}),'invalidated');
  let f=w.features(T+120_000);assert.equal(f.sufficientlyObserved,false);assert.equal(f.qualityReason,'correction');assert.equal(f.buyLamports,'0');
  assert.equal(w.features(T+130_000).sufficientlyObserved,true);
  w.ingest(trade(14,{receivedAt:T+140_001}));w.reverse(trade(14).identity,T+150_000);
  assert.equal(w.features(T+150_000).qualityReason,'reversal');
  assert.equal(w.ingest(trade(14,{receivedAt:T+150_001})),'duplicate');
  w.invalidate(T+160_000,'feed-gap');f=w.features(T+210_000);assert.equal(f.sufficientlyObserved,false);assert.equal(f.qualityReason,'feed-gap');
  assert.equal(w.features(T+220_000).sufficientlyObserved,false); // Includes the exact lost-event boundary.
  assert.equal(w.features(T+230_000).sufficientlyObserved,true);
});

test('capacity loss is explicit and requires fresh warming; empty old windows do not retain stale prices',()=>{
  const w=new FlowWindow('fixture-mint',T,6);for(let i=0;i<6;i++)w.ingest(trade(i,{receivedAt:T+100+i}));
  assert.equal(w.ingest(trade(7,{receivedAt:T+107})),'invalidated');
  assert.equal(w.features(T+60_000).qualityReason,'capacity-gap');assert.equal(w.features(T+70_000).tradeCount,0);
  const old=ready();old.features(T+60_000);const expired=old.features(T+130_000);
  assert.equal(expired.tradeCount,0);assert.equal(expired.firstPrice,null);assert.equal(expired.lastPrice,null);assert.equal(expired.priceReturnBps,null);
  const book=new OpportunityBook();for(let i=0;i<12;i++)assert.ok(book.admit(`fixture-${i}`,T));
  assert.equal(book.admit('fixture-overflow',T),null);assert.equal(book.size,12);book.remove('fixture-0');assert.ok(book.admit('fixture-overflow',T));
  const reversals=new FlowWindow('fixture-mint',T,6);for(let i=0;i<40;i++){reversals.reverse(trade(i).identity,T);assert.ok(reversals.usage().retainedIdentities<=12);}
});

test('largest-buyer concentration uses wallet volume and conservative integer rounding, not buyer independence',()=>{
  const w=new FlowWindow('fixture-mint',T);
  w.ingest(trade(0,{quoteLamports:'1000000000000000001',wallet:'fixture-same-wallet'}));
  w.ingest(trade(1,{quoteLamports:'1000000000000000000',wallet:'fixture-same-wallet'}));
  w.ingest(trade(2,{quoteLamports:'1000000000000000000',wallet:'fixture-other-wallet'}));
  const f=w.features(T+60_000);assert.equal(f.buyLamports,'3000000000000000001');assert.equal(f.distinctBuyerWallets,2);assert.equal(f.largestBuyerBps,6667);
  const falling=new FlowWindow('fixture-mint',T);falling.ingest(trade(0,{quoteLamports:'100000',tokenUnits:'100000'}));
  falling.ingest(trade(1,{quoteLamports:'99999',tokenUnits:'100000'}));
  assert.equal(falling.features(T+60_000).priceReturnBps,-1);
});

test('rule refuses unverified feed inputs even when disposable features pass; safety and prediction stay separate',()=>{
  const f=ready().features(T+60_000),c=context();const passed=evaluatePrimary(f,c);
  assert.equal(passed.qualified,true);assert.equal(passed.ruleVersion,PROVISIONAL_RULE.version);assert.equal(passed.kind,'qualified');
  assert.deepEqual(evaluatePrimary(f,c),passed);
  assert.equal(evaluatePrimary(f,{...c,flowFieldsVerified:false}).reason,'trade-feed-fields-not-verified');
  assert.equal(evaluatePrimary(f,{...c,migrationAt:NaN}).kind,'missing-data');
  assert.equal(evaluatePrimary(f,{...c,supportedPool:false}).kind,'market-exclusion');
  assert.equal(evaluatePrimary(f,{...c,alreadyTradedMint:true}).reason,'reentry-disabled');
  assert.equal(evaluatePrimary(f,{...c,riskEntriesAllowed:false}).kind,'risk-rejection');
  assert.equal(evaluatePrimary(f,{...c,quote:{...c.quote!,allInInitialCostMicroUsd:'50000001'}}).kind,'risk-rejection');
  assert.equal(evaluatePrimary(f,{...c,quote:{...c.quote!,at:c.now-2001}}).kind,'missing-data');
  assert.equal(evaluatePrimary(f,{...c,quote:{...c.quote!,sizeToEffectiveLiquidityBps:501}}).kind,'market-exclusion');
  assert.equal(evaluatePrimary({...f,buyLamports:'999999999',netBuyLamports:'999999999'},c).kind,'strategy-rejection');
  assert.equal(evaluatePrimary({...f,largestBuyerBps:3501},c).kind,'strategy-rejection');
  assert.equal(evaluatePrimary({...f,lastPrice:{quoteLamports:'299970000',tokenUnits:'300000'},priceReturnBps:-1},c).kind,'strategy-rejection');
  assert.equal(evaluatePrimary(f,{...c,migrationAt:c.now-7_200_001}).reason,'outside-provisional-migration-age');
  assert.equal(evaluatePrimary(f,{...c,quote:{...c.quote!,mint:'fixture-wrong-mint'}}).reason,'candidate-quote-identity-mismatch');
  assert.equal(evaluatePrimary(f,{...c,mint:'fixture-wrong-candidate'}).reason,'candidate-identity-mismatch');
  for(const key of ['distinctBuyerWallets','largestBuyerBps','positiveNetBuckets','priceReturnBps'] as const){const invalid=evaluatePrimary({...f,[key]:NaN},c);assert.equal(invalid.kind,'missing-data');assert.equal(invalid.features,null);}
  assert.equal(evaluatePrimary({...f,firstPrice:null},c).kind,'missing-data');
  assert.equal(evaluatePrimary({...f,tradeCount:0},c).kind,'missing-data');
  assert.equal(evaluatePrimary({...f,netBuyLamports:'invalid'},c).kind,'missing-data');
  assert.equal(evaluatePrimary({...f,qualityReason:'feed-gap'},c).kind,'missing-data');
  assert.equal(Object.isFrozen(PROVISIONAL_RULE),true);assert.equal(Reflect.set(PROVISIONAL_RULE,'minimumBuyers',1),false);
});

test('exits request actual-size quotes and never turn unknown marks or a stop into fictional fills',()=>{
  const base={now:T+20_000,enteredAt:T,entryCostLamports:'1000000',heldBaseUnits:'1000'};
  assert.equal(evaluateExit({...base,mark:null}).action,'quote-required');
  assert.equal(evaluateExit({...base,mark:{at:base.now,netLamports:'849999',pricedBaseUnits:'1000',evidence:'fixture'}}).action,'request-exit');
  assert.equal(evaluateExit({...base,mark:{at:base.now,netLamports:'1300000',pricedBaseUnits:'1000',evidence:'fixture'}}).reason,'net-liquidation-take-profit');
  assert.equal(evaluateExit({...base,mark:{at:base.now,netLamports:'1100000',pricedBaseUnits:'1000',evidence:'fixture'}}).action,'hold');
  assert.equal(evaluateExit({...base,mark:{at:base.now-2001,netLamports:'1000000',pricedBaseUnits:'1000',evidence:'fixture'}}).action,'quote-required');
  assert.equal(evaluateExit({...base,mark:{at:base.now,netLamports:'1000000',pricedBaseUnits:'999',evidence:'fixture'}}).action,'quote-required');
  assert.equal(evaluateExit({...base,now:T+900_000,mark:null}).reason,'maximum-holding-time; fresh executable quote still required');
});
