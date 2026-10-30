import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FlowWindow,eventIdentity,type NormalizedTrade,type FlowFeatures} from '../src/strategy.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V3_POLICY as P,LIQUIDITY_RESILIENT_MOMENTUM_V3_SHA256,LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION,assessLiquidityResilientBuying,evaluateLiquidityResilientPrimary,evaluateLiquidityResilientExit,v3CpmmBuy,v3CpmmSell,deriveV3Consolidation,V3AssessmentSeries,type V3AuditedFlow,type V3MarketEvidence,type V3RuleContext,type V3ExitInput} from '../src/liquidity-resilient-momentum-v3.js';

function fixture(options:{end?:number;wallets?:number;amounts?:bigint[];sell?:boolean;price?:boolean}={}){
 const end=options.end??120000,window=new FlowWindow('M',end-60000),trades:NormalizedTrade[]=[];
 for(let n=0;n<6;n++){
  const quote=options.amounts?.[n]??500000000n,trade:NormalizedTrade={mint:'M',wallet:'wallet-'+n%(options.wallets??6),side:options.sell?'sell':'buy',quoteLamports:quote.toString(),tokenUnits:(options.price===false?quote/50n:quote*10000n/BigInt(500000+n*1000)).toString(),receivedAt:end-60000+n*10000+100,commitment:'confirmed',slot:n+1,identity:{signature:'fixture-'+n,instructionIndex:0,eventIndex:0}};trades.push(trade);window.ingest(trade);
 }
 const features=window.features(end),flow:V3AuditedFlow={mint:'M',pool:'P',windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditedAt:end,auditEvidence:'OFFLINE independent full-window audit',complete:true,trades};
 const pool={base:1000000000n,raw:20000000000n,virtual:0n,buckets:0n,fees:{lpFeeBps:20,protocolFeeBps:5,creatorFeeBps:5}},buy=v3CpmmBuy(pool,500000000n);
 const market:V3MarketEvidence={mint:'M',pool:'P',at:end,evidence:'OFFLINE exact-size fresh confirmed quote',baseReserveUnits:pool.base.toString(),rawQuoteReserveLamports:pool.raw.toString(),virtualQuoteReserveLamports:'0',feeBucketsLamports:'0',fees:pool.fees,buyInputLamports:'500000000',expectedBaseUnits:buy.output.toString(),buyCurveInputLamports:buy.curve.toString(),entryGasLamports:'7000',exitGasLamports:'7000',slippageBps:100,maximumConsumedLamports:'500007000'};
 return {features,flow,market};
}
function context(f:ReturnType<typeof fixture>):V3RuleContext{return {mint:'M',now:f.features.asOf,migrationAt:0,migrationVerified:true,supportedPool:true,flowFieldsVerified:true,flowVerificationEvidence:f.flow.auditEvidence,riskEntriesAllowed:true,alreadyTradedMint:false,maximumConsumedCostMicroUsd:'50000000',quote:{mint:'M',at:f.market.at,evidence:f.market.evidence,expectedBaseUnits:f.market.expectedBaseUnits,allInInitialCostMicroUsd:'50000000',sizeToEffectiveLiquidityBps:250,effectiveQuoteLiquidityLamports:f.market.rawQuoteReserveLamports},v3:{flow:f.flow,market:f.market}};}
const exit=(net:string,extra:Partial<V3ExitInput>={}):V3ExitInput=>({now:2000000,enteredAt:0,entryCostLamports:'100000000',heldBaseUnits:'1000',mark:{at:2000000,netLamports:net,pricedBaseUnits:'1000',evidence:'OFFLINE actual full inventory'},...extra});

test('V3 is a distinct four-dimension strategy with no wallet floor, age proxy, profit cap or four-window delay',()=>{
 assert.equal(P.version,'liquidity-resilient-momentum-v3');assert.equal(LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION,P.version);assert.equal(LIQUIDITY_RESILIENT_MOMENTUM_V3_SHA256,createHash('sha256').update(JSON.stringify(P)).digest('hex'));assert.equal(P.liveTradingEnabled,false);assert.equal(P.demand.minimumWalletCount,null);assert.equal(P.continuation.ageRouting,false);assert.equal(P.exit.takeProfitBps,null);assert.equal(P.exit.maximumProfitableHoldingMs,null);assert.equal(new V3AssessmentSeries().usage().entryWaitingWindows,0);
 const f=fixture(),r=assessLiquidityResilientBuying(f.features,f.features.asOf,{flow:f.flow,market:f.market});assert.equal(Object.keys(r.assessments).length,4);assert.equal(r.status,'not-rejected');assert.ok(Object.values(r.assessments).every(a=>a.status==='passed'));assert.equal(r.qualified,false);assert.equal(evaluateLiquidityResilientPrimary(f.features,context(f)).qualified,true);
});
test('exact integer CPMM arithmetic reproduces independently recorded SDK buy and same-state sell receipts',()=>{
 for(const run of ['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z']){
  const {quote:q}=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8')),pool={base:BigInt(q.rawBaseReserve),raw:BigInt(q.rawQuoteReserve),virtual:BigInt(q.virtualQuoteReserves),buckets:BigInt(q.feeBuckets),fees:{lpFeeBps:Number(q.feeBps.lpFeeBps),protocolFeeBps:Number(q.feeBps.protocolFeeBps),creatorFeeBps:q.creatorFeeApplied===false?0:Number(q.feeBps.creatorFeeBps)}};
  const buy=v3CpmmBuy(pool,BigInt(q.buy.inputLamports));assert.equal(buy.output.toString(),q.buy.outputBaseUnits);assert.equal(buy.curve.toString(),q.buy.internalQuoteWithoutFees);assert.equal(v3CpmmSell(pool,buy.output).output.toString(),q.correspondingSell.outputLamports);
 }
});
test('real vault payout rejects virtual-liquidity fantasies and per-component fee rounding cannot create proceeds',()=>{
 const p={base:1000n,raw:2n,virtual:100000n,buckets:1n,fees:{lpFeeBps:20,protocolFeeBps:5,creatorFeeBps:5}};assert.throws(()=>v3CpmmSell(p,1000n),/REAL_VAULT/);assert.throws(()=>v3CpmmBuy({...p,virtual:0n},1n),/DUST/);
 const sell=v3CpmmSell({...p,raw:100000n,virtual:0n,buckets:0n},1n);assert.equal(sell.gross,99n);assert.equal(sell.output,96n);
});
test('raw wallet inflation cannot manufacture capital breadth; dust is measured relative to the actual proposed size',()=>{
 const f=fixture(),base=assessLiquidityResilientBuying(f.features,120000,{flow:f.flow,market:f.market});assert.equal(base.components?.effectiveBuyerCount,6);assert.equal(base.components?.top5BuyerBps,8333);assert.equal(base.components?.top10BuyerBps,10000);
 const trades=f.flow.trades.map(t=>({...t}));trades[0]!.quoteLamports='2999000000';trades[0]!.tokenUnits='59980000';for(let i=1;i<trades.length;i++){trades[i]!.quoteLamports='200000';trades[i]!.tokenUnits='4000';}
 const w=new FlowWindow('M',60000);for(const t of trades)w.ingest(t);const features=w.features(120000),r=assessLiquidityResilientBuying(features,120000,{flow:{...f.flow,trades},market:f.market});assert.equal(r.components?.rawBuyerCount,6);assert.ok(r.components!.effectiveBuyerCount<1.01);assert.equal(r.components?.dustBuyerCount,5);assert.ok(r.components!.dustBuyVolumeBps!<5);assert.ok(BigInt(r.components!.renewedDemandScenarioLamports!)<1000000n);assert.equal(r.assessments.netEconomics.status,'failed');assert.equal(r.components?.externalSellerInventory,'UNKNOWN');
});
test('same raw buyer count and total net flow can produce materially different executable net economics',()=>{
 const balanced=fixture(),concentrated=fixture({amounts:[2900000000n,20000000n,20000000n,20000000n,20000000n,20000000n]}),a=assessLiquidityResilientBuying(balanced.features,120000,{flow:balanced.flow,market:balanced.market}),b=assessLiquidityResilientBuying(concentrated.features,120000,{flow:concentrated.flow,market:concentrated.market});
 assert.equal(a.components?.rawBuyerCount,b.components?.rawBuyerCount);assert.equal(balanced.features.netBuyLamports,concentrated.features.netBuyLamports);assert.ok(BigInt(a.components!.renewedDemandScenarioLamports!)>BigInt(b.components!.renewedDemandScenarioLamports!));assert.ok(a.components!.scenarioNetSurplusBps!>b.components!.scenarioNetSurplusBps!);assert.equal(b.assessments.netEconomics.status,'failed');
});
test('provisional, incomplete, mismatched or late audited rows are missing data and cannot fall through to V2',()=>{
 const f=fixture();assert.equal(assessLiquidityResilientBuying(f.features,120000).status,'unavailable');
 for(const flow of [{...f.flow,complete:false},{...f.flow,trades:f.flow.trades.slice(1)},{...f.flow,trades:[...f.flow.trades.slice(0,5),f.flow.trades[0]!]},{...f.flow,auditedAt:120001},{...f.flow,trades:f.flow.trades.map((t,n)=>n===0?{...t,commitment:'processed' as const}:t)}])assert.equal(assessLiquidityResilientBuying(f.features,120000,{flow:flow as V3AuditedFlow,market:f.market}).status,'unavailable');
 const stale={...f.features,asOf:130000};assert.equal(assessLiquidityResilientBuying(stale,130000,{flow:f.flow,market:f.market}).status,'unavailable');assert.equal(evaluateLiquidityResilientPrimary(f.features,{...context(f),v3:undefined}).kind,'missing-data');
});
test('fresh pool, exact five-percent proposed amount and original quote identity remain necessary',()=>{
 const f=fixture(),c=context(f);for(const market of [{...f.market,at:117999},{...f.market,expectedBaseUnits:'1'},{...f.market,buyCurveInputLamports:'1'},{...f.market,maximumConsumedLamports:'500006999'},{...f.market,maximumConsumedLamports:'600000000'}])assert.equal(evaluateLiquidityResilientPrimary(f.features,{...c,v3:{flow:f.flow,market}}).qualified,false);
 const cashLimited={...f.market,maximumConsumedLamports:'600000000',cashLimited:true as const},r=assessLiquidityResilientBuying(f.features,120000,{flow:f.flow,market:cashLimited});assert.equal(r.status,'not-rejected');assert.equal(r.components?.cashLimited,true);assert.equal(r.components?.proposedConsumedLamports,'500007000');assert.equal(r.components?.maximumConsumedLamports,'600000000');
 assert.equal(evaluateLiquidityResilientPrimary(f.features,{...c,quote:{...c.quote!,evidence:'different'}}).kind,'missing-data');assert.equal(evaluateLiquidityResilientPrimary(f.features,{...c,riskEntriesAllowed:false}).kind,'risk-rejection');
});
test('preliminary flow has no economic authority and no arbitrary fixed size-to-liquidity exclusion overrides actual economics',()=>{
 const f=fixture(),r=assessLiquidityResilientBuying(f.features,120000,{flow:f.flow});assert.equal(r.status,'not-rejected');assert.equal(r.assessments.liquidityResilience.status,'unavailable');assert.equal(r.assessments.netEconomics.status,'unavailable');assert.equal(r.components?.immediateNetLamports,null);assert.equal(evaluateLiquidityResilientPrimary(f.features,{...context(f),v3:{flow:f.flow}}).qualified,false);
 const c=context(f);assert.equal(evaluateLiquidityResilientPrimary(f.features,{...c,quote:{...c.quote!,sizeToEffectiveLiquidityBps:1000}}).qualified,true);
});
test('continued positive flow and expensive exact-size economics are separate necessary dimensions',()=>{
 const f=fixture(),costly={...f.market,exitGasLamports:'200000000'},r=assessLiquidityResilientBuying(f.features,120000,{flow:f.flow,market:costly});assert.equal(r.assessments.genuineDemand.status,'passed');assert.equal(r.assessments.continuation.status,'passed');assert.equal(r.assessments.liquidityResilience.status,'failed');assert.equal(r.assessments.netEconomics.status,'failed');assert.equal(r.status,'failed');
 const sold=fixture({sell:true});assert.equal(assessLiquidityResilientBuying(sold.features,120000,{flow:sold.flow,market:sold.market}).assessments.genuineDemand.status,'failed');
});
test('point-in-time account observations and plausible net purchases never claim current wallet inventories',()=>{
 const f=fixture(),flow={...f.flow,observedWalletInventory:[{wallet:'large-existing-holder',baseUnits:'900000000',at:119999,evidence:'OFFLINE existing validated user balance'}]},r=assessLiquidityResilientBuying(f.features,120000,{flow,market:f.market});assert.equal(r.components?.externalSellerInventory,'UNKNOWN');assert.equal(r.components?.observedInventoryLargestBaseUnits,'900000000');assert.equal(r.assessments.liquidityResilience.status,'failed');assert.ok(r.components!.scenarios.some(s=>s.name.includes('unknown')||s.name.includes('unobserved')));assert.ok(r.components!.scenarios.every(s=>s.classification==='CONDITIONAL_CPMM_SCENARIO_NOT_OBSERVED_EXECUTION'));
 const future={...flow,observedWalletInventory:[{...flow.observedWalletInventory[0]!,at:120001}]};assert.notEqual(assessLiquidityResilientBuying(f.features,120000,{flow:future,market:f.market}).components?.observedInventoryLargestBaseUnits,'900000000');
});
test('a historically large account that verifiably sold to zero does not remain an invented current seller veto',()=>{
 const f=fixture(),sales:NormalizedTrade[]=[{...f.flow.trades[0]!,wallet:'large-seller',side:'sell',quoteLamports:'500000',tokenUnits:'1000',receivedAt:65000,identity:{signature:'first-sell',instructionIndex:0,eventIndex:0}},{...f.flow.trades[0]!,wallet:'large-seller',side:'sell',quoteLamports:'500000',tokenUnits:'899999000',receivedAt:75000,identity:{signature:'final-sell',instructionIndex:0,eventIndex:0}}],trades=[...f.flow.trades,...sales].sort((a,b)=>a.receivedAt-b.receivedAt),w=new FlowWindow('M',60000);for(const t of trades)w.ingest(t);
 const flow:V3AuditedFlow={...f.flow,trades,observedWalletInventory:sales.map((t,n)=>({wallet:t.wallet,tokenAccount:'known-actor-account',baseUnits:n===0?'900000000':'899999000',at:t.receivedAt,evidence:'OFFLINE original program-event prebalance',eventIdentity:eventIdentity(t.identity),balanceTiming:'before-trade'}))},r=assessLiquidityResilientBuying(w.features(120000),120000,{flow,market:f.market});
 assert.equal(r.components?.observedInventoryLargestBaseUnits,'0');assert.equal(r.components?.historicalMaximumObservedAccountBaseUnits,'900000000');assert.equal(r.components?.externalSellerInventory,'UNKNOWN');assert.equal(r.components?.outOfPoolTransfers,'UNKNOWN');assert.match(r.components!.inventoryEvidence,/NOT_CURRENT_WALLET/);assert.equal(r.assessments.liquidityResilience.status,'passed');assert.equal(r.status,'not-rejected');
 const historical=r.components!.scenarios.filter(s=>s.name.startsWith('historical-'));assert.ok(historical.some(s=>s.lossFromConsumedCostBps!>P.economics.maximumStressLossBps));assert.ok(historical.every(s=>s.requiredForAdmission===false));assert.equal(r.components!.scenarios.find(s=>s.name.startsWith('latest-point'))?.assumedExternalSellBaseUnits,'0');
 const otherAccount={...flow,observedWalletInventory:[...flow.observedWalletInventory!,{wallet:'large-seller',tokenAccount:'other-known-actor-account',baseUnits:'5000000',at:119999,evidence:'OFFLINE separate observed account',balanceTiming:'after-trade' as const}]};assert.equal(assessLiquidityResilientBuying(w.features(120000),120000,{flow:otherAccount,market:f.market}).components?.observedInventoryLargestBaseUnits,'5000000');
});
test('reacceleration needs actual earlier audited consolidation and breakout; candidate age contributes nothing',()=>{
 const prior=fixture({end:120000,price:false});const neutral=prior.flow.trades.flatMap((t,n)=>[t,{...t,wallet:'seller-'+n,side:'sell' as const,identity:{signature:'seller-'+n,instructionIndex:0,eventIndex:0},receivedAt:t.receivedAt+1}]);const w=new FlowWindow('M',60000);for(const t of neutral)w.ingest(t);const priorFlow={...prior.flow,trades:neutral},consolidation=deriveV3Consolidation(w.features(120000),priorFlow,120000);assert.ok(consolidation);assert.equal(consolidation.netFlowShareBps,0);
 const current=fixture({end:180000}),flow={...current.flow,priorConsolidation:consolidation};assert.equal(assessLiquidityResilientBuying(current.features,180000,{flow,market:current.market}).components?.pattern,'audited-reacceleration');assert.equal(assessLiquidityResilientBuying(current.features,180000,{flow:current.flow,market:current.market}).components?.pattern,'audited-continuation');
 for(const bad of [{...consolidation,auditedAt:180001},{...consolidation,windowEndAt:120001},{...consolidation,priceRangeBps:5000}])assert.equal(assessLiquidityResilientBuying(current.features,180000,{flow:{...flow,priorConsolidation:bad},market:current.market}).components?.pattern,'audited-continuation');
 const old=fixture({end:8*3600000});assert.equal(evaluateLiquidityResilientPrimary(old.features,context(old)).qualified,true);
});
test('bounded historical pattern memory adds no first-entry delay and requoting does not create fake windows',()=>{
 const series=new V3AssessmentSeries(1),f=fixture();assert.equal(series.observe({features:f.features,now:120000,flow:f.flow,market:f.market}).status,'not-rejected');assert.equal(series.observe({features:f.features,now:120000,flow:f.flow,market:f.market}).status,'not-rejected');assert.equal(series.usage().entryWaitingWindows,0);assert.equal(series.usage().mints,1);series.clear('M');assert.equal(series.usage().mints,0);
});
test('actual-size protection uses evidence and retains profitable positions without time or profit caps',()=>{
 for(const net of ['130000000','300000000','600000000'])assert.equal(evaluateLiquidityResilientExit(exit(net)).action,'hold');assert.equal(evaluateLiquidityResilientExit(exit('85000000')).action,'request-exit');assert.equal(evaluateLiquidityResilientExit(exit('250000000',{highWaterNetLamports:'300000000'})).action,'request-exit');const supportive={at:1995000,availableAt:1999999,evidence:'OFFLINE independently audited positive demand',complete:true,netBuyLamports:'100',recentNetBuyLamports:'80',priceReturnBps:100};assert.equal(evaluateLiquidityResilientExit(exit('250000000',{highWaterNetLamports:'300000000',volatilityBps:1000,flowContext:supportive})).action,'hold');
 const original=exit('400000000',{highWaterNetLamports:'300000000'});for(const mark of [null,{...original.mark!,at:1997999},{...original.mark!,pricedBaseUnits:'999'},{...original.mark!,at:2000001}]){const r=evaluateLiquidityResilientExit({...original,mark});assert.equal(r.action,'quote-required');assert.equal(r.highWaterNetLamports,'300000000');}
});
test('boolean deterioration cannot force V3 exits; current actual-size reserve stress and full audited reversal can',()=>{
 assert.equal(evaluateLiquidityResilientExit(exit('120000000',{liquidityDeteriorated:true,momentumDeteriorated:true,continuationEvidence:{at:2000000,availableAt:2000000,evidence:'bare flags'}})).action,'hold');
 const l={at:2000000,evidence:'OFFLINE actual full inventory',pricedBaseUnits:'1000',immediateNetLamports:'120000000',stressedNetLamports:'70000000',rawQuoteReserveLamports:'500000000',priorRawQuoteReserveLamports:'1000000000'};assert.match(evaluateLiquidityResilientExit(exit('120000000',{liquidityContext:l})).reason,/liquidity-stress/);assert.equal(evaluateLiquidityResilientExit(exit('120000000',{liquidityContext:{...l,pricedBaseUnits:'999'}})).action,'hold');
 const flow={at:1995000,availableAt:1999999,evidence:'OFFLINE independent current audit',complete:true,netBuyLamports:'-100',recentNetBuyLamports:'-80',priceReturnBps:-100};assert.match(evaluateLiquidityResilientExit(exit('120000000',{flowContext:flow})).reason,/audited-demand-reversal/);for(const bad of [{...flow,complete:false},{...flow,availableAt:2000001},{...flow,at:1990000},{...flow,priceReturnBps:null}])assert.equal(evaluateLiquidityResilientExit(exit('120000000',{flowContext:bad})).action,'hold');
});
test('small actual executable profits are protected above cost without imposing a profit cap or unknown-data expiry',()=>{
 const peak=evaluateLiquidityResilientExit(exit('105000000'));assert.equal(peak.action,'hold');assert.equal(peak.continuationConfidence,'unknown');assert.equal(peak.profitProtectionFloorLamports,'103750000');assert.equal(evaluateLiquidityResilientExit(exit('104000000',{highWaterNetLamports:'105000000'})).action,'hold');const reversal=evaluateLiquidityResilientExit(exit('103000000',{highWaterNetLamports:'105000000'}));assert.equal(reversal.action,'request-exit');assert.match(reversal.reason,/profit-retention/);assert.equal(reversal.profitRetentionBps,6000);
 const growing=evaluateLiquidityResilientExit(exit('106000000',{highWaterNetLamports:'105000000',priorProfitProtectionFloorLamports:peak.profitProtectionFloorLamports!}));assert.equal(growing.action,'hold');assert.ok(BigInt(growing.profitProtectionFloorLamports!)>BigInt(peak.profitProtectionFloorLamports!));
});
test('verified reserve deterioration tightens profit retention; supporting later evidence never loosens an already modeled floor',()=>{
 const mark='104000000',base={highWaterNetLamports:'105000000'},liquidity={at:2000000,evidence:'OFFLINE actual full inventory',pricedBaseUnits:'1000',immediateNetLamports:mark,stressedNetLamports:'100000000',rawQuoteReserveLamports:'900000000',priorRawQuoteReserveLamports:'1000000000'};
 const ordinary=evaluateLiquidityResilientExit(exit(mark,base)),deteriorated=evaluateLiquidityResilientExit(exit(mark,{...base,liquidityContext:liquidity}));assert.equal(ordinary.action,'hold');assert.equal(deteriorated.action,'request-exit');assert.equal(deteriorated.profitGivebackBps,1500);assert.equal(deteriorated.liquidityDeteriorationVerified,false);assert.equal(deteriorated.profitProtectionFloorLamports,'104250000');
 const supportive={at:1995000,availableAt:1999999,evidence:'OFFLINE independently audited positive demand',complete:true,netBuyLamports:'100',recentNetBuyLamports:'80',priceReturnBps:100},renewed=evaluateLiquidityResilientExit(exit('104300000',{...base,flowContext:supportive,volatilityBps:1500,priorProfitProtectionFloorLamports:deteriorated.profitProtectionFloorLamports!}));assert.equal(renewed.action,'hold');assert.equal(renewed.continuationConfidence,'audited-flow');assert.equal(renewed.profitGivebackBps,6000);assert.equal(renewed.profitProtectionFloorLamports,'104250000');
 const stale=evaluateLiquidityResilientExit(exit(mark,{...base,liquidityContext:{...liquidity,at:1997000}}));assert.equal(stale.profitGivebackBps,2500);assert.equal(stale.action,'hold');
});
test('module has no provider calls, executable permissions, fee double charge or invented future samples',()=>{
 const source=readFileSync('src/liquidity-resilient-momentum-v3.ts','utf8');assert.doesNotMatch(source,/\bfetch\s*\(|\.call\s*\(|setInterval\s*\(|setTimeout\s*\(/);assert.ok(P.limitations.some(s=>s.includes('future')));const f=fixture(),before=JSON.stringify(f),r=assessLiquidityResilientBuying(f.features,120000,{flow:f.flow,market:f.market});assert.equal(JSON.stringify(f),before);assert.ok(BigInt(r.components!.immediateNetLamports!)<BigInt(f.market.maximumConsumedLamports));
});


test('capital diversity changes executable economics even when total demand and largest buyer share are identical',()=>{
 const original=fixture();
 const assess=(wallets:string[])=>{
  const window=new FlowWindow('M',60000),trades=original.flow.trades.map((t,i)=>({...t,wallet:wallets[i]!}));for(const t of trades)window.ingest(t);
  return assessLiquidityResilientBuying(window.features(120000),120000,{flow:{...original.flow,trades},market:original.market});
 };
 const broader=assess(['a','a','b','c','d','e']),concentrated=assess(['a','a','b','b','c','c']);
 assert.equal(broader.components!.largestBuyerBps,concentrated.components!.largestBuyerBps);
 assert.equal(broader.components!.netFlowShareBps,concentrated.components!.netFlowShareBps);
 assert.ok(broader.components!.capitalDiversityBps>concentrated.components!.capitalDiversityBps);
 assert.ok(BigInt(broader.components!.renewedDemandScenarioLamports!)>BigInt(concentrated.components!.renewedDemandScenarioLamports!));
 assert.ok(broader.components!.scenarioNetSurplusBps!>concentrated.components!.scenarioNetSurplusBps!);
 assert.equal(broader.status,'not-rejected');assert.equal(concentrated.status,'not-rejected','no arbitrary wallet-count floor is introduced');
});
