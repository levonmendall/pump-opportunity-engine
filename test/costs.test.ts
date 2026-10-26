import {test} from 'node:test';
import assert from 'node:assert/strict';
import {COST_CATEGORIES,initializeOperatingCosts,applyOperatingCostEvent,projectOperatingCosts,validateOperatingCosts,validateOperatingCostEvent,type OperatingCostState,type OperatingExpense,type OperatingCoverageEvent,type CostClassification} from '../src/costs.js';

const AT=Date.parse('2026-10-26T12:00:00.000Z'),ACCOUNT='fixture-operating-costs';
const initial=()=>initializeOperatingCosts(ACCOUNT,AT);
const usd=(id='invoice',at=AT+1000,microUsd='1000000'):OperatingExpense=>({kind:'expense',id,accountId:ACCOUNT,category:'data',classification:'actual',occurredAt:at,recordedAt:at,amount:{currency:'USD',microUsd},evidence:'fixture actual invoice; no credential'});
const sol=(id='funding-fee',at=AT+1000,lamports='5000'):OperatingExpense=>({...usd(id,at),category:'transfer-networkfee',amount:{currency:'SOL',lamports}});
const price=(at=AT+1000,microUsdPerSol='200000000')=>({at,microUsdPerSol,source:'fixture captured incurrence USD quote'});
function cover(state:OperatingCostState,at=AT+2000,classification:CostClassification='actual'){
  for(const category of COST_CATEGORIES){
    const event:OperatingCoverageEvent={kind:'coverage',id:'coverage:'+category+':'+at,accountId:ACCOUNT,recordedAt:at,category,evidence:'fixture source assessment',coverage:{status:'complete',from:AT,through:at,classification,evidence:'fixture complete invoice/allocated-cost interval'}};
    state=applyOperatingCostEvent(state,event,at);
  }
  return state;
}
const projection=(state:OperatingCostState,at=AT+2000,tradingPnlMicroUsd:string|null='10000000')=>projectOperatingCosts(state,{asOf:at,now:at,tradingPnlMicroUsd});

test('default unknown operating costs are not an actual zero or a manufactured economic P&L',()=>{
  const state=initial(),before=structuredClone(state),p=projection(state);
  assert.equal(p.knownSubtotalMicroUsd,'0');assert.equal(p.operatingCostsMicroUsd,null);assert.equal(p.economicPnlMicroUsd,null);
  assert.equal(p.coverageComplete,false);assert.equal(p.classification,'unavailable');
  assert.ok(Object.values(p.categories).every(c=>c.coverage===null&&!c.complete));
  p.recent.push({} as never);p.categories.data.knownMicroUsd='77';
  assert.deepEqual(state,before);
});

test('complete sourced zero-expense coverage is distinct from missing data',()=>{
  const state=cover(initial()),p=projection(state);
  assert.equal(p.coverageComplete,true);assert.equal(p.operatingCostsMicroUsd,'0');
  assert.equal(p.economicPnlMicroUsd,'10000000');assert.equal(p.classification,'actual');
  assert.equal(projection(state,AT+2001).economicPnlMicroUsd,null); // Heartbeat does not extend fact time.
  assert.equal(projection(state,AT+2000,null).economicPnlMicroUsd,null);
});

test('operating expense is subtracted once from trading P&L that already contains simulated execution costs',()=>{
  const original=initial(),expense=usd('provider-invoice',AT+1000,'2500000');
  validateOperatingCostEvent(original,expense,AT+1000);
  const after=applyOperatingCostEvent(original,expense,AT+1000),state=cover(after),p=projection(state,AT+2000,'9000000');
  assert.equal(original.totals.data.actual.knownMicroUsd,'0');
  assert.equal(after.totals.data.actual.knownMicroUsd,'2500000');
  assert.equal(p.operatingCostsMicroUsd,'2500000');assert.equal(p.economicPnlMicroUsd,'6500000');
  assert.equal(p.categories.data.knownMicroUsd,'2500000');
  assert.equal(state.recent[0]!.evidence,expense.evidence);
});

test('funding amounts, balance floors, rent returns and modeled execution gas are rejected as operating categories',()=>{
  const state=initial();
  for(const category of ['wallet-funding','balance-floor','rent-refund','execution-gas','pool-fee']){
    assert.throws(()=>applyOperatingCostEvent(state,{...usd(),category} as never,AT+1000),/unsupported operating cost category/);
  }
  for(const kind of ['funding','rent-return','execution']){
    assert.throws(()=>applyOperatingCostEvent(state,{...usd(),kind} as never,AT+1000),/unsupported operating event/);
  }
  assert.deepEqual(state,initial());
});

test('native SOL expense uses the actual incurrence quote and explicit conservative integer rounding',()=>{
  const fee={...sol(),valuation:price()},state=cover(applyOperatingCostEvent(initial(),fee,AT+1000)),p=projection(state);
  assert.equal(p.knownSubtotalMicroUsd,'1000');assert.equal(p.economicPnlMicroUsd,'9999000');
  assert.equal(state.recent[0]!.currency,'SOL');assert.equal(state.recent[0]!.amount,'5000');
  const tiny={...sol('tiny',AT+1000,'1'),valuation:price(AT+1000,'100000000')};
  assert.equal(applyOperatingCostEvent(initial(),tiny,AT+1000).totals['transfer-networkfee'].actual.knownMicroUsd,'1');
});

test('missing SOL valuation stays unknown despite complete coverage; later journal-backed valuation resolves it',()=>{
  const original=sol(),unpriced=applyOperatingCostEvent(initial(),original,AT+1000),covered=cover(unpriced);
  assert.equal(projection(covered).unvaluedExpenses,1);assert.equal(projection(covered).economicPnlMicroUsd,null);
  const resolved=applyOperatingCostEvent(covered,{kind:'valuation',id:'valuation:'+original.id,accountId:ACCOUNT,recordedAt:AT+2000,evidence:'fixture original expense read from financial journal',expense:original,valuation:price()},AT+2000);
  assert.equal(resolved.totals['transfer-networkfee'].actual.unvaluedCount,0);
  assert.equal(resolved.totals['transfer-networkfee'].actual.unvaluedSolLamports,'0');
  assert.equal(projection(resolved).economicPnlMicroUsd,'9999000');
  assert.equal(projection(covered).unvaluedExpenses,1); // No mutation of original state.
});

test('later valuation refuses a different original, wrong account or absent unresolved expense',()=>{
  const original=sol(),state=applyOperatingCostEvent(initial(),original,AT+1000);
  const event={kind:'valuation' as const,id:'valuation:'+original.id,accountId:ACCOUNT,recordedAt:AT+2000,evidence:'fixture verified journal reference',expense:original,valuation:price()};
  assert.throws(()=>applyOperatingCostEvent(state,{...event,expense:{...original,amount:{currency:'SOL',lamports:'1'}}},AT+2000),/does not match cached/);
  assert.throws(()=>applyOperatingCostEvent(state,{...event,expense:{...original,accountId:'fixture-other'}},AT+2000),/wrong original expense/);
  assert.throws(()=>applyOperatingCostEvent(initial(),event,AT+2000),/not represented/);
  assert.equal(state.totals['transfer-networkfee'].actual.unvaluedCount,1);
});

test('actual, estimated and allocated costs stay separate and mixed economic estimates are labeled',()=>{
  let state=applyOperatingCostEvent(initial(),usd('actual-data',AT+1000,'100'),AT+1000);
  state=applyOperatingCostEvent(state,{...usd('estimated-rpc',AT+1000,'200'),category:'rpc',classification:'estimated'},AT+1000);
  state=applyOperatingCostEvent(state,{...usd('allocated-host',AT+1000,'300'),category:'hosting',classification:'allocated'},AT+1000);
  state=cover(state);
  const p=projection(state);
  assert.equal(state.totals.data.actual.knownMicroUsd,'100');assert.equal(state.totals.rpc.estimated.knownMicroUsd,'200');
  assert.equal(state.totals.hosting.allocated.knownMicroUsd,'300');assert.equal(p.knownSubtotalMicroUsd,'600');
  assert.equal(p.classification,'mixed');assert.equal(p.economicPnlMicroUsd,'9999400');
});

test('coverage gaps, explicit unknown revisions and future intervals do not manufacture complete history',()=>{
  const state=cover(initial());
  const partial:OperatingCoverageEvent={kind:'coverage',id:'later-window',accountId:ACCOUNT,recordedAt:AT+2000,category:'data',evidence:'fixture bounded assessment',coverage:{status:'complete',from:AT+1000,through:AT+2000,classification:'actual',evidence:'fixture excludes earlier interval'}};
  assert.equal(projection(applyOperatingCostEvent(state,partial,AT+2000)).economicPnlMicroUsd,null);
  assert.equal(projection(applyOperatingCostEvent(state,{...partial,coverage:{...partial.coverage,status:'unknown',from:AT}},AT+2000)).economicPnlMicroUsd,null);
  assert.throws(()=>applyOperatingCostEvent(state,{...partial,coverage:{...partial.coverage,through:AT+3000}},AT+2000),/future cost coverage/);
  assert.throws(()=>projectOperatingCosts(state,{asOf:AT+1999,now:AT+2000,tradingPnlMicroUsd:'0'}),/nonhistorical/);
});

test('malformed, future, backward or wrong-account expense facts are rejected without changing state',()=>{
  const state=initial(),before=structuredClone(state);
  assert.throws(()=>applyOperatingCostEvent(state,{...usd(),accountId:'fixture-other'},AT+1000),/wrong account/);
  assert.throws(()=>applyOperatingCostEvent(state,{...usd(),occurredAt:AT+1001},AT+1000),/future expense/);
  assert.throws(()=>applyOperatingCostEvent(state,{...usd(),recordedAt:AT+1001},AT+1000),/future/);
  for(const microUsd of ['0','-1','1.1','01',(1n<<127n).toString()]){
    assert.throws(()=>applyOperatingCostEvent(state,{...usd(),amount:{currency:'USD',microUsd}},AT+1000));
  }
  for(const valuation of [price(AT+1001),price(AT-10000),price(AT+1000,'0'),{...price(),source:''}]){
    assert.throws(()=>applyOperatingCostEvent(state,{...sol(),valuation},AT+1000),/valuation/);
  }
  assert.throws(()=>applyOperatingCostEvent(state,{...usd(),classification:'simulated'} as never,AT+1000),/classification/);
  assert.throws(()=>applyOperatingCostEvent(state,{...usd(),secret:'should never fit schema'} as never,AT+1000),/operating expense required/);
  const later=applyOperatingCostEvent(state,usd(),AT+1000);
  assert.throws(()=>applyOperatingCostEvent(later,usd('backward',AT+999),AT+1000),/backward/);
  assert.deepEqual(state,before);
});

test('summary retains only last50 operations while totals and unresolved SOL amounts survive cache eviction',()=>{
  let state=initial();const first=sol('expense-0',AT+1000,'1');
  for(let i=0;i<75;i++)state=applyOperatingCostEvent(state,sol('expense-'+i,AT+1000,'1'),AT+1000);
  assert.equal(state.recent.length,50);assert.equal(state.recent[0]!.id,'expense-25');
  assert.equal(state.totals['transfer-networkfee'].actual.unvaluedCount,75);
  assert.equal(state.totals['transfer-networkfee'].actual.unvaluedSolLamports,'75');
  state=applyOperatingCostEvent(state,{kind:'valuation',id:'valuation:expense-0',accountId:ACCOUNT,recordedAt:AT+2000,evidence:'fixture full original recovered from existing journal',expense:first,valuation:price(AT+1000,'100000000')},AT+2000);
  assert.equal(state.recent.length,50);assert.equal(state.totals['transfer-networkfee'].actual.unvaluedCount,74);
  assert.equal(state.totals['transfer-networkfee'].actual.knownMicroUsd,'1');
  const restored=JSON.parse(JSON.stringify(state));validateOperatingCosts(restored);assert.deepEqual(restored,state);
});

test('damaged persisted cost state is refused instead of defaulting missing totals or coverage to zero',()=>{
  const missing=initial() as never as Record<string,unknown>;delete (missing.totals as Record<string,unknown>).data;
  assert.throws(()=>validateOperatingCosts(missing as never),/bounded operating cost state/);
  const damaged=initial();damaged.totals.data.actual.unvaluedCount=1;
  assert.throws(()=>projection(damaged),/unvalued expense invariant/);
  const erased=cover(applyOperatingCostEvent(initial(),usd(),AT+1000));erased.totals.data.actual.knownMicroUsd='0';
  assert.throws(()=>projection(erased),/contradict retained source/);
  assert.throws(()=>projection(initial(),AT+2000,'NaN'),/integer trading/);
  assert.throws(()=>projectOperatingCosts(initial(),{asOf:AT+2000,now:AT+1999,tradingPnlMicroUsd:'0'}),/projection time/);
});
