import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FlowWindow,type FlowFeatures,type NormalizedTrade} from '../src/strategy.js';
import {ADAPTIVE_MOMENTUM_V2_POLICY as P,ADAPTIVE_MOMENTUM_V2_SHA256,ADAPTIVE_MOMENTUM_V2_VERSION,assessAdaptiveBuying,evaluateAdaptivePrimary,evaluateAdaptiveExit,adaptiveMigrationEligible,adaptiveReentryEligible,describeAdaptiveOpportunity,projectAdaptiveExposure,type AdaptiveRuleContext,type AdaptiveExitInput} from '../src/adaptive-momentum-v2.js';
import {createHash} from 'node:crypto';

function features(end=120000,quote='200000000'):FlowFeatures{
 const w=new FlowWindow('M',end-60000);for(let n=0;n<6;n++)w.ingest({mint:'M',wallet:'wallet-'+n,side:'buy',quoteLamports:quote,tokenUnits:'10000',receivedAt:end-60000+n*10000+100,commitment:'confirmed',slot:n+1,identity:{signature:'fixture-'+n,instructionIndex:0,eventIndex:0}} satisfies NormalizedTrade);return w.features(end);
}
function context(f:FlowFeatures):AdaptiveRuleContext{return {mint:f.mint,now:f.asOf,migrationAt:0,migrationVerified:true,supportedPool:true,flowFieldsVerified:true,flowVerificationEvidence:'OFFLINE native audit supplied by integration',riskEntriesAllowed:true,maximumConsumedCostMicroUsd:'50000000',alreadyTradedMint:false,quote:{mint:f.mint,at:f.asOf,evidence:'OFFLINE exact-size quote',allInInitialCostMicroUsd:'50000000',sizeToEffectiveLiquidityBps:50,expectedBaseUnits:'1000',effectiveQuoteLiquidityLamports:'100000000000'}};}
const exit=(net:string,extra:Partial<AdaptiveExitInput>={}):AdaptiveExitInput=>({now:2000000,enteredAt:0,entryCostLamports:'100000000',heldBaseUnits:'1000',mark:{at:2000000,netLamports:net,pricedBaseUnits:'1000',evidence:'OFFLINE actual-size net of exit costs'},...extra});

test('explicit experimental version has no fixed positive take-profit, profitable holding cap or live execution',()=>{
 assert.equal(P.version,ADAPTIVE_MOMENTUM_V2_VERSION);assert.equal(createHash('sha256').update(JSON.stringify(P)).digest('hex'),ADAPTIVE_MOMENTUM_V2_SHA256);assert.equal(P.exit.takeProfitBps,null);assert.equal(P.exit.maximumProfitableHoldingMs,null);assert.equal(P.liveTradingEnabled,false);assert.equal(P.exit.stopLossBps,1500);assert.equal(P.sizing.entryConsumedCostBps,500);assert.equal(P.sizing.maximumInitialCostMicroUsd,null);
});
test('preliminary real demand never invents liquidity, final score or financial qualification',()=>{
 const r=assessAdaptiveBuying(features(),120000);assert.equal(r.status,'not-rejected');assert.equal(r.scoreBps,null);assert.equal(r.qualified,false);assert.equal(r.components?.demand,null);assert.equal(r.components?.independentBuyerCount,null);assert.equal(r.components?.acceleration,null);assert.ok(r.limitations.some(x=>x.includes('independence')));
});
test('same net flow is scored relative to actual liquidity, without mistaking the score for expectancy',()=>{
 const f=features(),small=assessAdaptiveBuying(f,f.asOf,'100000000000'),large=assessAdaptiveBuying(f,f.asOf,'500000000000');assert.equal(small.status,'not-rejected');assert.equal(large.status,'failed');assert.ok(small.scoreBps!>large.scoreBps!);assert.equal(small.components?.demandToLiquidityBps,120);assert.equal(small.qualified,false);assert.ok(small.limitations.includes('net expected continuation return'));
});
test('near-neutral churn and numerically tiny normalized demand cannot qualify on the other score terms',()=>{
 const w=new FlowWindow('M',60000);for(let n=0;n<11;n++)w.ingest({mint:'M',wallet:'wallet-'+n,side:'buy',quoteLamports:'1',tokenUnits:n===10?'5000':'10000',receivedAt:60100+n*5000,commitment:'confirmed',identity:{signature:'tiny-'+n,instructionIndex:0,eventIndex:0}});const f=w.features(120000),r=assessAdaptiveBuying(f,120000,'1000000000');assert.equal(r.status,'failed');assert.equal(r.reason,'adaptive-liquidity-normalized-demand-floor-not-met');
 const churn=new FlowWindow('M',60000);for(let n=0;n<6;n++){for(const side of['buy','sell'] as const)churn.ingest({mint:'M',wallet:side+'-'+n,side,quoteLamports:side==='buy'?'1000000000':'999000000',tokenUnits:side==='buy'?'100000':'99900',receivedAt:60100+n*10000+(side==='sell'?1:0),commitment:'confirmed',identity:{signature:side+'-'+n,instructionIndex:0,eventIndex:0}});}assert.equal(assessAdaptiveBuying(churn.features(120000),120000,'1000000000').reason,'adaptive-near-neutral-executed-flow');
});
test('age routes strategy cohorts but never invents earlier consolidation or a renewed momentum pattern',()=>{
 assert.equal(describeAdaptiveOpportunity(0,false,120000).targetStrategy,null);assert.equal(describeAdaptiveOpportunity(0,true,120000).targetStrategy,'early-momentum-continuation');const mature=describeAdaptiveOpportunity(0,true,8*3600000);assert.equal(mature.targetStrategy,'momentum-reacceleration');assert.match(mature.patternEvidence,/unknown/);assert.match(describeAdaptiveOpportunity(0,true,8*3600000,{throughAt:100,availableAt:8*3600000+1,confirmed:true,evidence:'future'}).patternEvidence,/unknown/);
});
test('fully checked early and older candidates are considered without arbitrary 5–120 minute cutoffs',()=>{
 for(const end of[120000,8*3600000]){const f=features(end),c=context(f);assert.equal(evaluateAdaptivePrimary(f,c).qualified,true);assert.equal(adaptiveMigrationEligible(0,true,end),true);}
 assert.equal(adaptiveMigrationEligible(120001,true,120000),false);assert.equal(adaptiveMigrationEligible(0,false,120000),false);
});
test('receipt/discovery times cannot substitute for verified migration or a post-migration observation window',()=>{
 const f=features(),c=context(f);assert.equal(evaluateAdaptivePrimary(f,{...c,migrationVerified:false}).kind,'missing-data');assert.equal(evaluateAdaptivePrimary(f,{...c,migrationAt:f.windowStartAt+1}).reason,'observation-window-precedes-verified-migration');
});
test('incomplete, provisional, malformed, quiet and non-buying windows are never rescued by adaptive scoring',()=>{
 const f=features();assert.equal(assessAdaptiveBuying({...f,sufficientlyObserved:false,qualityReason:'feed-gap'},f.asOf).status,'unavailable');assert.equal(assessAdaptiveBuying({...f,provisionalTradeCount:1},f.asOf).status,'unavailable');assert.equal(assessAdaptiveBuying({...f,netBuyLamports:'1'},f.asOf).status,'unavailable');const quiet=new FlowWindow('M',60000).features(120000);assert.equal(assessAdaptiveBuying(quiet,120000).status,'failed');
});
test('final qualification still requires exact-size quote, valid liquidity, current age, risk permission and original sizing fallback',()=>{
 const f=features(),c=context(f),q=c.quote!;for(const bad of[{quote:null},{quote:{...q,effectiveQuoteLiquidityLamports:undefined}},{quote:{...q,at:f.asOf-2001}},{quote:{...q,mint:'OTHER'}},{quote:{...q,sizeToEffectiveLiquidityBps:501}},{quote:{...q,allInInitialCostMicroUsd:'50000001'}},{riskEntriesAllowed:false}])assert.equal(evaluateAdaptivePrimary(f,{...c,...bad}).qualified,false);
 assert.equal(evaluateAdaptivePrimary(f,c).qualified,true);assert.equal(evaluateAdaptivePrimary(f,c).ruleVersion,ADAPTIVE_MOMENTUM_V2_VERSION);
});
test('complete-evidence strategy floors remain strategy rejection rather than a technical missing-data failure',()=>{
 const f=features(),c=context(f),q={...c.quote!,effectiveQuoteLiquidityLamports:'10000000000000'};assert.equal(evaluateAdaptivePrimary(f,{...c,quote:q}).kind,'strategy-rejection');
 const sparse=features(120000,'1');assert.equal(evaluateAdaptivePrimary(sparse,context(sparse)).kind,'strategy-rejection');const missing={...c.quote!,effectiveQuoteLiquidityLamports:undefined};assert.equal(evaluateAdaptivePrimary(f,{...c,quote:missing}).kind,'missing-data');
});
test('re-entry needs complete new window after closure and reconciled conflict-free previous round trip',()=>{
 const f=features(240000),c={...context(f),alreadyTradedMint:true},r={closedAt:100000,reconciledAt:100010,previousWindowEndAt:90000,unresolved:false};assert.equal(adaptiveReentryEligible(f,f.asOf,r),true);assert.equal(evaluateAdaptivePrimary(f,{...c,reentry:r}).qualified,true);
 for(const bad of[undefined,{...r,closedAt:f.windowStartAt},{...r,closedAt:200000},{...r,reconciledAt:99999},{...r,reconciledAt:240001},{...r,previousWindowEndAt:f.windowEndAt},{...r,unresolved:true}])assert.equal(evaluateAdaptivePrimary(f,{...c,reentry:bad}).qualified,false);
});
test('200%,500% winners and holdings beyond15 minutes are not sold merely for their gain or duration',()=>{
 for(const net of['130000000','300000000','600000000']){const r=evaluateAdaptiveExit(exit(net));assert.equal(r.action,'hold');assert.equal(r.highWaterNetLamports,net);}
});
test('baseline15% protective cost stop remains enforceable on fresh exact-size net value',()=>{
 assert.equal(evaluateAdaptiveExit(exit('85000000')).action,'request-exit');assert.match(evaluateAdaptiveExit(exit('85000000')).reason,/protective-cost-stop/);assert.equal(evaluateAdaptiveExit(exit('85000001')).action,'hold');
});
test('profit high-water is collectible net value and a material reversal protects the retained profit',()=>{
 const high=evaluateAdaptiveExit(exit('300000000'));assert.equal(high.action,'hold');const keep=evaluateAdaptiveExit(exit('270000000',{highWaterNetLamports:high.highWaterNetLamports!})),reversal=evaluateAdaptiveExit(exit('250000000',{highWaterNetLamports:high.highWaterNetLamports!}));assert.equal(keep.action,'hold');assert.equal(reversal.action,'request-exit');assert.equal(reversal.highWaterNetLamports,'300000000');assert.equal(reversal.profitRetentionBps,7500);assert.match(reversal.reason,/high-water-trailing/);
});
test('known volatility widens trailing distance without removing the cost stop',()=>{
 const low=evaluateAdaptiveExit(exit('250000000',{highWaterNetLamports:'300000000',volatilityBps:100})),high=evaluateAdaptiveExit(exit('250000000',{highWaterNetLamports:'300000000',volatilityBps:1000}));assert.equal(low.action,'request-exit');assert.equal(high.action,'hold');assert.equal(high.trailingDistanceBps,2000);assert.equal(evaluateAdaptiveExit(exit('80000000',{highWaterNetLamports:'300000000',volatilityBps:1000})).action,'request-exit');assert.throws(()=>evaluateAdaptiveExit(exit('100000000',{volatilityBps:-1})),/VOLATILITY/);
});
test('old/future/wrong-size/missing quotes do not update high-water or fabricate profitable exits',()=>{
 const base=exit('400000000',{highWaterNetLamports:'300000000'});for(const mark of[null,{...base.mark!,at:base.now-2001},{...base.mark!,at:base.now+1},{...base.mark!,pricedBaseUnits:'999'},{...base.mark!,evidence:''}]){const r=evaluateAdaptiveExit({...base,mark});assert.equal(r.action,'quote-required');assert.equal(r.highWaterNetLamports,'300000000');assert.equal(r.profitRetentionBps,null);}
});
test('deterioration requires fresh available evidence; a boolean or future report alone cannot force an exit',()=>{
 assert.equal(evaluateAdaptiveExit(exit('120000000',{momentumDeteriorated:true})).action,'hold');for(const e of[{at:2000001,availableAt:2000001,evidence:'future'},{at:1997999,availableAt:1998000,evidence:'old'}])assert.equal(evaluateAdaptiveExit(exit('120000000',{liquidityDeteriorated:true,continuationEvidence:e})).action,'hold');const e={at:1999990,availableAt:1999995,evidence:'OFFLINE complete current audited negative flow'};assert.equal(evaluateAdaptiveExit(exit('120000000',{momentumDeteriorated:true,continuationEvidence:e})).action,'request-exit');
});
test('deployed cost, current exposure, original capital risk and profit giveback remain different quantities',()=>{
 const r=projectAdaptiveExposure([{mint:'A',entryCostLamports:'50',currentNetLamports:'250',stressedNetLamports:'200'},{mint:'B',entryCostLamports:'50',currentNetLamports:'45',stressedNetLamports:'30'}]);assert.equal(r.deployedCapitalLamports,'100');assert.equal(r.currentExecutableExposureLamports,'295');assert.equal(r.stressedLossFromCommittedCapitalLamports,'20');assert.equal(r.stressedLossFromCurrentValueLamports,'65');assert.equal(r.forcedSale,false);
});
test('missing stress is unknown rather than zero risk; no hidden diversification or stop-fill guarantee',()=>{
 const r=projectAdaptiveExposure([{mint:'A',entryCostLamports:'50',currentNetLamports:'250',stressedNetLamports:null}]);assert.equal(r.riskUnknown,true);assert.equal(r.stressedLossFromCurrentValueLamports,null);assert.equal(r.stressedLossFromCommittedCapitalLamports,null);assert.throws(()=>projectAdaptiveExposure([{mint:'A',entryCostLamports:'50',currentNetLamports:'10',stressedNetLamports:'11'}]),/NOT_ADVERSE/);assert.throws(()=>projectAdaptiveExposure([{mint:'A',entryCostLamports:'1',currentNetLamports:'1',stressedNetLamports:'0'},{mint:'A',entryCostLamports:'1',currentNetLamports:'1',stressedNetLamports:'0'}]),/IDENTITIES/);
});
