import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FlowWindow,type NormalizedTrade} from '../src/strategy.js';
import {v3CpmmBuy,evaluateLiquidityResilientExit,type V3AuditedFlow,type V3MarketEvidence,type V3ExitInput,type V3ReserveObservation} from '../src/liquidity-resilient-momentum-v3.js';
import {assessLiquidityResilientBuyingV31,evaluateV31SizeFrontier,evaluateLiquidityResilientExitV31,LIQUIDITY_RESILIENT_MOMENTUM_V31_POLICY} from '../src/liquidity-resilient-momentum-v3-1.js';

function opportunity(options:{raw?:bigint;virtual?:bigint;buckets?:bigint}={}){
 const end=120000,window=new FlowWindow('M',60000),trades:NormalizedTrade[]=[];
 for(let n=0;n<6;n++){
  const trade:NormalizedTrade={mint:'M',wallet:'actor-'+n,side:'buy',quoteLamports:'500000000',tokenUnits:String(10000000-n*10000),receivedAt:60100+n*10000,commitment:'confirmed',slot:n+1,identity:{signature:'OFFLINE-trade-'+n,instructionIndex:0,eventIndex:0}};
  window.ingest(trade);trades.push(trade);
 }
 const features=window.features(end),flow:V3AuditedFlow={mint:'M',pool:'P',windowStartAt:60000,windowEndAt:end,auditedAt:end,auditEvidence:'OFFLINE complete independently matched fixture',complete:true,trades};
 const pool={base:1000000000n,raw:options.raw??20000000000n,virtual:options.virtual??0n,buckets:options.buckets??0n,fees:{lpFeeBps:20,protocolFeeBps:5,creatorFeeBps:5}},input=500000000n,buy=v3CpmmBuy(pool,input);
 const market:V3MarketEvidence={mint:'M',pool:'P',at:end,evidence:'OFFLINE coherent exact-size quote',baseReserveUnits:pool.base.toString(),rawQuoteReserveLamports:pool.raw.toString(),virtualQuoteReserveLamports:pool.virtual.toString(),feeBucketsLamports:pool.buckets.toString(),fees:pool.fees,buyInputLamports:input.toString(),expectedBaseUnits:buy.output.toString(),buyCurveInputLamports:buy.curve.toString(),entryGasLamports:'7000',exitGasLamports:'7000',slippageBps:100,maximumConsumedLamports:'500007000'};
 return {features,flow,market};
}
const reserve=(overrides:Partial<V3ReserveObservation>={}):V3ReserveObservation=>({at:100000,evidence:'OFFLINE observed reserve snapshot',baseReserveUnits:'1000000000',rawQuoteReserveLamports:'20000000000',virtualQuoteReserveLamports:'0',feeBucketsLamports:'0',...overrides});
const assess=(f:ReturnType<typeof opportunity>)=>assessLiquidityResilientBuyingV31(f.features,120000,{flow:f.flow,market:f.market});

test('V3.1 fee collection cannot manufacture entry stress, reduce score or change the selected exact size',()=>{
 const unchanged=opportunity(),swept=opportunity();
 unchanged.flow.reserveObservations=[reserve()];
 swept.flow.reserveObservations=[reserve({rawQuoteReserveLamports:'21000000000',virtualQuoteReserveLamports:'-1000000000',feeBucketsLamports:'1000000000'})];
 const a=assess(unchanged),b=assess(swept);
 assert.deepEqual(b.components!.economicBalance,a.components!.economicBalance);assert.deepEqual(b.components!.scenarios,a.components!.scenarios);assert.equal(b.status,a.status);
 assert.equal(b.components!.reserveEconomics.comparisons[0]!.change.classification,'ACCOUNTING_OFFSET_COMPATIBLE');
 assert.equal(b.components!.scenarios.some(s=>s.name.startsWith('repeat-observed-')),false);
 const first=evaluateV31SizeFrontier(unchanged.features,120000,unchanged),second=evaluateV31SizeFrontier(swept.features,120000,swept);
 assert.deepEqual(second.selected,first.selected);assert.deepEqual(second.candidates,first.candidates);
});

test('economically identical current fee representations produce identical entry economics',()=>{
 const before=opportunity({raw:21000000000n,virtual:-1000000000n,buckets:1000000000n}),after=opportunity();
 before.flow.reserveObservations=[reserve({rawQuoteReserveLamports:'22000000000',virtualQuoteReserveLamports:'-1000000000',feeBucketsLamports:'1000000000'})];
 after.flow.reserveObservations=[reserve({rawQuoteReserveLamports:'21000000000'})];
 const first=assess(before),second=assess(after);
 assert.deepEqual(first.components!.economicBalance,second.components!.economicBalance);assert.deepEqual(first.components!.scenarios,second.components!.scenarios);assert.equal(first.status,second.status);assert.equal(first.reason,second.reason);
});

test('history without fee buckets neither invents zero fees nor turns a fee-offset raw drop into depth loss',()=>{
 const f=opportunity(),r=reserve({rawQuoteReserveLamports:'21000000000',virtualQuoteReserveLamports:'-1000000000'});delete r.feeBucketsLamports;f.flow.reserveObservations=[r];
 const a=assess(f),comparison=a.components!.reserveEconomics;
 assert.equal(comparison.availableFundsObservations,0);assert.equal(comparison.maximumAvailableQuoteLamports,null);assert.equal(comparison.comparisons[0]!.change.availableQuoteDecreaseLamports,null);
 assert.equal(a.components!.scenarios.some(s=>s.name.startsWith('repeat-observed-')),false);
});

test('real economic reserve declines retain conditional stress and label sell-like effects without claiming withdrawal',()=>{
 const ordinary=opportunity(),selling=opportunity();selling.flow.reserveObservations=[reserve({baseReserveUnits:'800000000',rawQuoteReserveLamports:'25000000000'})];
 const normal=assess(ordinary),a=assess(selling),change=a.components!.reserveEconomics.comparisons[0]!.change;
 assert.equal(change.classification,'SELL_LIKE_CHANGE_CAUSE_UNVERIFIED');assert.equal(change.cause,'UNVERIFIED_SNAPSHOT_DIFFERENCE');assert.equal(change.effectiveQuoteDecreaseLamports,'5000000000');
 assert.ok(a.components!.scenarios.some(s=>s.name==='repeat-observed-effective-reserve-decrease'));
 assert.ok(BigInt(a.components!.economicBalance!.observedAdverseLossLamports)>BigInt(normal.components!.economicBalance!.observedAdverseLossLamports));
 const consumed=BigInt(a.components!.proposedConsumedLamports!),observedScenarioNames=new Set(['immediate-full-liquidation','point-in-time-observed-account-inventory','repeat-observed-effective-reserve-decrease','repeat-observed-available-funds-decrease']);
 const losses=a.components!.scenarios.filter(s=>observedScenarioNames.has(s.name)).map(s=>{const loss=consumed-BigInt(s.netLamports??'0');return loss>0n?loss:0n;});
 assert.equal(BigInt(a.components!.economicBalance!.observedAdverseLossLamports),losses.reduce((largest,value)=>value>largest?value:largest,0n),'overlapping seller and reserve stress losses are not added together');
});

test('available real funds can deteriorate even when the effective curve depth is unchanged',()=>{
 const f=opportunity({raw:1000000000n,virtual:19000000000n});f.flow.reserveObservations=[reserve()];
 const a=assess(f),change=a.components!.reserveEconomics.comparisons[0]!.change;
 assert.equal(change.effectiveQuoteDecreaseLamports,'0');assert.equal(change.availableQuoteDecreaseLamports,'19000000000');assert.equal(change.economicDecreaseObserved,true);
 assert.ok(a.components!.scenarios.some(s=>s.name==='repeat-observed-available-funds-decrease'&&s.executable===false));assert.equal(a.status,'failed');
});

test('historical snapshots later than the executable quote cannot become an earlier deterioration signal',()=>{
 const f=opportunity();f.market.at=119999;f.flow.reserveObservations=[reserve({at:120000,rawQuoteReserveLamports:'30000000000'})];
 const a=assess(f);assert.equal(a.components!.reserveEconomics.observations,0);assert.equal(a.components!.reserveEconomics.comparisons.length,0);
});

function holding(before:V3ReserveObservation,current:V3ReserveObservation):V3ExitInput{
 const at=120000,evidence='OFFLINE current full-position sell quote';return {now:at,enteredAt:90000,entryCostLamports:'100000000',heldBaseUnits:'1000',mark:{at,evidence,netLamports:'110000000',pricedBaseUnits:'1000'},liquidityContext:{at,evidence,pricedBaseUnits:'1000',immediateNetLamports:'110000000',stressedNetLamports:'80000000',rawQuoteReserveLamports:current.rawQuoteReserveLamports,priorRawQuoteReserveLamports:before.rawQuoteReserveLamports,economicReserves:{...current,at,evidence},priorEconomicReserves:before}};
}

test('V3.1 fee sweeps neither trigger liquidity exits nor tighten profit retention; V3 historical behavior stays intact',()=>{
 const prior=reserve({rawQuoteReserveLamports:'21000000000',virtualQuoteReserveLamports:'-1000000000',feeBucketsLamports:'1000000000'}),current=reserve(),input=holding(prior,current);
 const corrected=evaluateLiquidityResilientExitV31(input),neutral=evaluateLiquidityResilientExitV31(holding(current,current));
 assert.equal(corrected.action,'hold');assert.equal(corrected.liquidityDeteriorationVerified,false);assert.equal(corrected.reserveChange!.classification,'ACCOUNTING_OFFSET_COMPATIBLE');
 assert.equal(corrected.profitGivebackBps,neutral.profitGivebackBps);assert.equal(corrected.profitProtectionFloorLamports,neutral.profitProtectionFloorLamports);
 assert.equal(evaluateLiquidityResilientExit(input).liquidityDeteriorationVerified,true,'legacy V3 raw comparison remains unchanged');
 assert.equal(LIQUIDITY_RESILIENT_MOMENTUM_V31_POLICY.exit.stopLossBps,2500);assert.equal(LIQUIDITY_RESILIENT_MOMENTUM_V31_POLICY.exit.trailingMinimumBps,2500);
});

test('V3.1 preserves full-position stress exits for measured economic decreases and states unknown causes',()=>{
 const input=holding(reserve(),reserve({baseReserveUnits:'1100000000',rawQuoteReserveLamports:'19000000000'})),decision=evaluateLiquidityResilientExitV31(input);
 assert.equal(decision.action,'request-exit');assert.equal(decision.liquidityDeteriorationVerified,true);assert.equal(decision.reserveChange!.classification,'SELL_LIKE_CHANGE_CAUSE_UNVERIFIED');assert.match(decision.reason,/cause-unverified/);
});

test('raw-only, mismatched and future snapshots cannot assert V3.1 liquidity deterioration; cost stop still protects',()=>{
 const base=holding(reserve({rawQuoteReserveLamports:'30000000000'}),reserve());
 for(const modify of [
  (v:V3ExitInput)=>{delete v.liquidityContext!.economicReserves;},
  (v:V3ExitInput)=>{v.liquidityContext!.economicReserves!.evidence='different quote';},
  (v:V3ExitInput)=>{v.liquidityContext!.priorEconomicReserves!.at=120001;},
  (v:V3ExitInput)=>{v.liquidityContext!.economicReserves!.feeBucketsLamports='21000000000';},
 ]){const input=structuredClone(base);modify(input);const result=evaluateLiquidityResilientExitV31(input);assert.equal(result.liquidityDeteriorationVerified,false);assert.equal(result.reserveChange,null);assert.equal(result.action,'hold');}
 const stopped={...base,mark:{...base.mark!,netLamports:'75000000'}};assert.match(evaluateLiquidityResilientExitV31(stopped).reason,/protective-cost-stop/);
});
