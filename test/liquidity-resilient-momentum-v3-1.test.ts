import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FlowWindow,eventIdentity,type NormalizedTrade} from '../src/strategy.js';
import {assessLiquidityResilientBuying,v3CpmmBuy,v3CpmmSell,evaluateLiquidityResilientExit,type V3AuditedFlow,type V3MarketEvidence,type V3ExitInput} from '../src/liquidity-resilient-momentum-v3.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V3_1_POLICY as P,LIQUIDITY_RESILIENT_MOMENTUM_V3_1_SHA256,assessLiquidityResilientBuyingV31,evaluateV31SizeFrontier,evaluateLiquidityResilientExitV31,evaluateLiquidityResilientPrimaryV31,V31AssessmentSeries,deriveV31Consolidation,v31VaultBoundedOpposingSale,type V31RuleContext} from '../src/liquidity-resilient-momentum-v3-1.js';

function fixture(options:{end?:number;raw?:bigint;base?:bigint;input?:bigint;amounts?:bigint[];wallets?:string[];sides?:Array<'buy'|'sell'>;priceDown?:boolean;virtual?:bigint;gas?:bigint}={}){
 const end=options.end??120000,window=new FlowWindow('M',end-60000),trades:NormalizedTrade[]=[];
 for(let n=0;n<6;n++){
  const quote=options.amounts?.[n]??500000000n,t:NormalizedTrade={mint:'M',wallet:options.wallets?.[n]??'wallet-'+n,side:options.sides?.[n]??'buy',quoteLamports:quote.toString(),tokenUnits:(quote*10000n/BigInt(options.priceDown?510000-n*1000:500000+n*1000)).toString(),receivedAt:end-60000+n*10000+100,commitment:'confirmed',slot:n+1,identity:{signature:'fixture-'+n,instructionIndex:0,eventIndex:0}};
  trades.push(t);window.ingest(t);
 }
 const features=window.features(end),flow:V3AuditedFlow={mint:'M',pool:'P',windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditedAt:end,auditEvidence:'OFFLINE independent full-window audit',complete:true,trades};
 const pool={base:options.base??1000000000n,raw:options.raw??20000000000n,virtual:options.virtual??0n,buckets:0n,fees:{lpFeeBps:20,protocolFeeBps:5,creatorFeeBps:5}},input=options.input??500000000n,buy=v3CpmmBuy(pool,input),gas=options.gas??7000n;
 const market:V3MarketEvidence={mint:'M',pool:'P',at:end,evidence:'OFFLINE exact-size coherent SDK quote',baseReserveUnits:pool.base.toString(),rawQuoteReserveLamports:pool.raw.toString(),virtualQuoteReserveLamports:pool.virtual.toString(),feeBucketsLamports:'0',fees:pool.fees,buyInputLamports:input.toString(),expectedBaseUnits:buy.output.toString(),buyCurveInputLamports:buy.curve.toString(),entryGasLamports:gas.toString(),exitGasLamports:gas.toString(),slippageBps:100,maximumConsumedLamports:(input+gas).toString()};
 return {features,flow,market};
}
const assess=(f:ReturnType<typeof fixture>)=>assessLiquidityResilientBuyingV31(f.features,f.features.asOf,{flow:f.flow,market:f.market});
function context(f:ReturnType<typeof fixture>):V31RuleContext{return {mint:'M',now:f.features.asOf,migrationAt:0,migrationVerified:true,supportedPool:true,flowFieldsVerified:true,flowVerificationEvidence:f.flow.auditEvidence,riskEntriesAllowed:true,alreadyTradedMint:false,maximumConsumedCostMicroUsd:'50000000',quote:{mint:'M',at:f.market.at,evidence:f.market.evidence,expectedBaseUnits:f.market.expectedBaseUnits,allInInitialCostMicroUsd:'50000000',sizeToEffectiveLiquidityBps:250,effectiveQuoteLiquidityLamports:f.market.rawQuoteReserveLamports},v3:{flow:f.flow,market:f.market}};}

test('V3.1 keeps four descriptive assessments and explicitly removes fixed stress/surplus/momentum vetoes',()=>{
 assert.equal(P.version,'liquidity-resilient-momentum-v3.1');assert.equal(P.liveTradingEnabled,false);assert.equal(P.economics.maximumStressLossBps,null);assert.equal(P.economics.minimumNetSurplusBps,null);assert.equal(P.continuation.minimumRecentPositiveBuckets,null);assert.equal(P.continuation.nonnegativePriceVeto,false);assert.equal(P.sizing.minimumDollarAllocation,null);assert.equal(P.sizing.entryConsumedCostBps,500);assert.equal(P.exit.takeProfitBps,null);
 assert.equal(LIQUIDITY_RESILIENT_MOMENTUM_V3_1_SHA256,createHash('sha256').update(JSON.stringify(P)).digest('hex'));
 const f=fixture(),r=assess(f);assert.equal(Object.keys(r.assessments).length,4);assert.equal(r.status,'not-rejected');assert.equal(r.qualified,false);assert.match(r.assessmentModel,/not four independent vetoes/);assert.ok(BigInt(r.components!.economicBalance!.jointConditionalBalanceLamports)>0n);assert.equal(evaluateLiquidityResilientPrimaryV31(f.features,context(f)).qualified,true);
});

test('one late positive bucket and a modest adverse historical price can remain economical under the joint assessment',()=>{
 const f=fixture({priceDown:true,amounts:[800000000n,800000000n,800000000n,10000000n,10000000n,1500000000n],sides:['buy','buy','buy','sell','sell','buy']}),old=assessLiquidityResilientBuying(f.features,120000,{flow:f.flow,market:f.market}),r=assess(f);
 assert.equal(f.features.priceReturnBps!<0,true);assert.equal(r.components!.recentPositiveBuckets,1);assert.equal(old.assessments.continuation.status,'failed');assert.equal(r.status,'not-rejected');assert.ok(BigInt(r.components!.economicBalance!.adversePriceReplayLamports)>0n);
});

test('fewer raw wallets do not create a universal rejection, and dust wallets cannot erase concentration risk',()=>{
 const broad=fixture(),single=fixture({wallets:Array(6).fill('one-actor')}),dust=fixture({wallets:['whale','dust1','dust2','dust3','dust4','dust5'],amounts:[2999000000n,200000n,200000n,200000n,200000n,200000n]});
 const a=assess(broad),b=assess(single),c=assess(dust);assert.equal(a.components!.effectiveBuyerCount,6);assert.equal(b.components!.effectiveBuyerCount,1);assert.equal(b.components!.externalSellerInventory,'UNKNOWN');assert.equal(b.status,'not-rejected','concentrated participation is an economic risk input, not an absolute wallet-count veto');
 assert.ok(c.components!.effectiveBuyerCount<1.01);assert.equal(c.components!.dustBuyerCount,5);assert.ok(c.components!.dustBuyVolumeBps!<5);assert.ok(c.components!.economicBalance!.concentrationPenaltyBps>9900);assert.match(P.economics.concentration,/not a beneficial-ownership probability/);
});

test('a real point-in-time large account can make the same continuation economics unattractive without a 20percent rule',()=>{
 const f=fixture(),ordinary=assess(f),flow={...f.flow,observedWalletInventory:[{wallet:'observed-holder',tokenAccount:'one-observed-account',baseUnits:'900000000',at:119999,evidence:'OFFLINE observed account balance; intervening transfers unknown',balanceTiming:'after-trade' as const}]},r=assessLiquidityResilientBuyingV31(f.features,120000,{flow,market:f.market});
 assert.equal(ordinary.status,'not-rejected');assert.equal(r.status,'failed');assert.ok(BigInt(r.components!.economicBalance!.observedAdverseLossLamports)>BigInt(ordinary.components!.economicBalance!.observedAdverseLossLamports));assert.equal(r.components!.externalSellerInventory,'UNKNOWN');assert.ok(r.components!.scenarios.some(s=>s.name==='point-in-time-observed-account-inventory'));
 const future={...flow,observedWalletInventory:[{...flow.observedWalletInventory[0]!,at:120001}]};assert.notEqual(assessLiquidityResilientBuyingV31(f.features,120000,{flow:future,market:f.market}).components!.observedInventoryLargestBaseUnits,'900000000');
});

test('weak unknown-inventory stress is reported without independently vetoing a stronger supported scenario',()=>{
 const f=fixture({raw:1000000000n,amounts:Array(6).fill(1000000000n)}),r=assess(f);assert.equal(r.status,'not-rejected');const weak=r.components!.scenarios.find(s=>s.name==='unknown-seller-as-large-as-proposed-position')!;assert.ok(weak.lossFromConsumedCostBps!>2000);assert.equal(weak.requiredForAdmission,false);assert.equal(r.components!.economicBalance!.maximumStressLossBps,null);
});

test('current nonexecutable real-vault liquidity remains a hard refusal, and malformed or stale quotes remain unavailable',()=>{
 const f=fixture();for(const market of [{...f.market,at:117999},{...f.market,expectedBaseUnits:'1'},{...f.market,maximumConsumedLamports:'1'},{...f.market,exitGasLamports:'invalid'}])assert.equal(assessLiquidityResilientBuyingV31(f.features,120000,{flow:f.flow,market}).status,'unavailable');
 const vault=fixture({raw:1n,virtual:1000000000000n,input:500000000n});vault.market.exitGasLamports='1000000000';assert.equal(assess(vault).reason,'v3.1-current-full-position-liquidation-not-executable');
 assert.equal(assessLiquidityResilientBuyingV31(f.features,120000).status,'unavailable');assert.equal(assessLiquidityResilientBuyingV31(f.features,120000,{flow:{...f.flow,complete:false}as unknown as V3AuditedFlow,market:f.market}).status,'unavailable');
});

test('equity ceiling permits a smaller exact amount for economic reasons without pretending cash is limited',()=>{
 const f=fixture(),input=250000000n,pool={base:BigInt(f.market.baseReserveUnits),raw:BigInt(f.market.rawQuoteReserveLamports),virtual:0n,buckets:0n,fees:f.market.fees},buy=v3CpmmBuy(pool,input),market={...f.market,buyInputLamports:input.toString(),expectedBaseUnits:buy.output.toString(),buyCurveInputLamports:buy.curve.toString()},r=assessLiquidityResilientBuyingV31(f.features,120000,{flow:f.flow,market});
 assert.equal(r.status,'not-rejected');assert.equal(r.components!.cashLimited,false);assert.equal(r.components!.sizingReason,'liquidity-economics');assert.equal(r.components!.maximumConsumedLamports,f.market.maximumConsumedLamports);
});

test('integer frontier returns the highest measured positive joint balance and never exceeds the original quote or equity ceiling',()=>{
 const f=fixture({raw:1000000000n,amounts:Array(6).fill(100000000n)});f.flow.observedWalletInventory=[{wallet:'observed-holder',baseUnits:'900000000',at:119999,evidence:'OFFLINE point-in-time account balance; current transfers unknown'}];const r=evaluateV31SizeFrontier(f.features,120000,{flow:f.flow,market:f.market});assert.ok(r.selected,r.reason);assert.equal(r.isGlobalOptimumCertified,false);assert.equal(r.search.coverage,'BEST_TESTED_NOT_GLOBAL_OPTIMUM');assert.ok(r.candidates.length<=r.search.maximumTests);
 const balances=r.candidates.filter(c=>c.status==='not-rejected').map(c=>BigInt(c.jointConditionalBalanceLamports!));assert.equal(BigInt(r.assessment.components!.economicBalance!.jointConditionalBalanceLamports),balances.reduce((a,b)=>a>b?a:b));assert.ok(BigInt(r.selected!.buyInputLamports)<BigInt(f.market.buyInputLamports),'current economics justify a smaller exact position');assert.ok(BigInt(r.selected!.proposedConsumedLamports)<=BigInt(f.market.maximumConsumedLamports));
 const cash={...f.market,maximumConsumedLamports:'900000000',cashLimited:true as const},limited=evaluateV31SizeFrontier(f.features,120000,{flow:f.flow,market:cash});assert.ok(limited.candidates.every(c=>BigInt(c.buyInputLamports)<=BigInt(f.market.buyInputLamports)));
});

test('no positive tested size is an explicitly bounded economic result rather than a claim about untested possibilities',()=>{
 const f=fixture({amounts:Array(6).fill(100n),gas:100000000n}),r=evaluateV31SizeFrontier(f.features,120000,{flow:f.flow,market:f.market});assert.equal(r.selected,null);assert.match(r.reason,/no-positive-tested-size/);assert.equal(r.isGlobalOptimumCertified,false);assert.ok(r.candidates.length>0);assert.equal(r.search.integerInputBits,BigInt(f.market.buyInputLamports).toString(2).length);
});

test('holding exits retain the existing V3 protection policy during entry optimization',()=>{
 const input:V3ExitInput={now:2000000,enteredAt:0,entryCostLamports:'100000000',heldBaseUnits:'1000',mark:{at:2000000,netLamports:'85000000',pricedBaseUnits:'1000',evidence:'OFFLINE actual full-position quote'}};
 assert.deepEqual(evaluateLiquidityResilientExitV31(input),evaluateLiquidityResilientExit(input));
});

test('series keeps decision-time boundaries and no minimum observation-window count is added',()=>{
 const f=fixture(),series=new V31AssessmentSeries(1),before=JSON.stringify(f),a=series.observe({features:f.features,now:120000,flow:f.flow,market:f.market});assert.equal(a.status,'not-rejected');series.observe({features:f.features,now:120000,flow:f.flow,market:f.market});assert.equal(series.usage().entryWaitingWindows,0);assert.equal(series.usage().mints,1);assert.equal(JSON.stringify(f),before);assert.ok(deriveV31Consolidation(f.features,f.flow,120000));
 const source=readFileSync('src/liquidity-resilient-momentum-v3-1.ts','utf8');assert.doesNotMatch(source,/\bfetch\s*\(|\.call\s*\(|setInterval\s*\(|setTimeout\s*\(/);
});

test('reacceleration describes actual earlier compression and breakout rather than token age or two-of-three voting',()=>{
 const prior={mint:'M',pool:'P',windowStartAt:0,windowEndAt:60000,auditedAt:60000,auditEvidence:'OFFLINE earlier complete quiet audit',netFlowShareBps:0,priceRangeBps:0,highPrice:{quoteLamports:'500000000',tokenUnits:'10000000'}},f=fixture(),flow={...f.flow,priorConsolidation:prior},r=assessLiquidityResilientBuyingV31(f.features,120000,{flow,market:f.market});assert.equal(r.components!.pattern,'audited-reacceleration');
 for(const bad of [{...prior,auditedAt:120001},{...prior,priceRangeBps:1000000},{...prior,windowEndAt:120000}])assert.equal(assessLiquidityResilientBuyingV31(f.features,120000,{flow:{...flow,priorConsolidation:bad},market:f.market}).components!.pattern,'audited-continuation');
 const old=fixture({end:8*3600000});assert.equal(assess(old).components!.pattern,'audited-continuation','age alone never declares reacceleration');
});


test('opposing sell search respects monotone vault debit and independent fee-ceiling dust holes',()=>{
 const pool={base:30n,raw:3n,virtual:33n,buckets:0n,fees:{lpFeeBps:20,protocolFeeBps:5,creatorFeeBps:5}},sale=v31VaultBoundedOpposingSale(pool,10n);assert.equal(sale.units,4n);assert.equal(sale.output,1n);
 for(const fees of [pool.fees,{lpFeeBps:1000,protocolFeeBps:2000,creatorFeeBps:3000},{lpFeeBps:0,protocolFeeBps:5000,creatorFeeBps:4999}])for(const base of [3n,30n])for(const raw of [1n,3n,20n])for(const requested of [0n,1n,4n,10n,40n]){
  const p={...pool,base,raw,fees};let expected=0n;for(let u=1n;u<=requested;u++){try{v3CpmmSell(p,u);expected=u;}catch{/* Independent exhaustive tiny-integer SDK-arithmetic comparison. */}}
  const found=v31VaultBoundedOpposingSale(p,requested);assert.equal(found.units,expected,JSON.stringify({base:String(base),raw:String(raw),requested:String(requested),fees}));if(found.units>0n)assert.deepEqual(found.pool,v3CpmmSell(p,found.units).pool);
 }
});
