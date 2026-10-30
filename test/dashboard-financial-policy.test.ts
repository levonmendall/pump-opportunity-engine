import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
const source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const from=source.indexOf('function financialPolicyCards(s){'),through=source.indexOf('function renderCards(s){',from);
assert.ok(from>=0&&through>from);
const code=source.slice(from,through);
const money=(v:number|null)=>v===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
function cards(policy?:unknown){const context=createContext({money,Number,Math});new Script(code).runInContext(context);return (context as any).financialPolicyCards({intelligence:policy?{financialPolicy:policy}:undefined}) as Array<[string,string,string,null]>;}
function risk(){return {version:'poe-paper-financial-policy-v1',risk:{version:'paper-equity-risk-5-10-v1',state:'ready',reasonCode:null,asOf:'2026-10-30T03:50:00.000Z',entry:{targetBps:500,targetConsumedCostMicroUsd:'47500000',targetConsumedCostSol:'0.475000000',unreservedCashSol:'8.000000000',cashLimitedConsumedCostSol:'0.475000000',refundableDepositsIncluded:false,executabilityClaimed:false},daily:{day:'2026-10-30',limitBps:1000,highWaterMicroUsd:'1000000000',highWaterAt:'2026-10-30T03:49:50.000Z',currentEquityMicroUsd:'950000000',drawdownMicroUsd:'50000000',drawdownBps:500,remainingBeforePauseMicroUsd:'50000000',lossPaused:false,historyCoverage:'verified-retained-same-day',basis:'complete-observed-executable-equity-current-usd'}},execution:null};}
test('Portfolio cards expose the verified five-percent target and daily high-water allowance independently of diagnostic-note capacity',()=>{
 const p=risk(),before=JSON.stringify(p),rows=cards(p),all=rows.flat().join('\n');
 assert.match(all,/5% TARGET/);assert.match(all,/\$47\.50/);assert.match(all,/cash ceiling 0\.475000000 SOL before token rent\/liquidity/);assert.match(all,/Entry safeguards still apply/);
 assert.match(all,/5\.00% \/ 10\.00%/);assert.match(all,/HWM \$1,000\.00 at 03:49:50 UTC · remaining 5\.00% \/ \$50\.00/);assert.match(all,/USD equity includes SOL\/USD/);assert.match(all,/verified-retained-same-day/);
 assert.equal(JSON.stringify(p),before);assert.doesNotMatch(code,/limitations|fetch|entriesEnabled|innerHTML/);
});
test('a latched daily guard stays visible even when the current drawdown has recovered',()=>{
 const p=risk();p.risk.daily.lossPaused=true;const all=cards(p).flat().join('\n');assert.match(all,/loss guard paused/);assert.match(all,/remaining allowance latched; new entries paused/);assert.doesNotMatch(all,/remaining 5\.00%|remaining 10\.00%|entries enabled|unpaused|permission granted/i);
});
test('legacy and unknown policy versions show unavailable policy without manufacturing percentage limits or history',()=>{
 for(const policy of [undefined,{version:'unknown',risk:risk().risk}]){const all=cards(policy).flat().join('\n');assert.match(all,/Policy unavailable from this source/);assert.match(all,/no historical peak inferred/);assert.doesNotMatch(all,/5% TARGET|10% GUARD|\$0\.00/);}
});
test('known historical high-water remains legible while unavailable current risk data never becomes a zero allowance',()=>{
 const p=risk();p.risk.state='unavailable';(p.risk.entry as any).targetConsumedCostMicroUsd=null;(p.risk.entry as any).cashLimitedConsumedCostSol=null;for(const key of ['drawdownBps','remainingBeforePauseMicroUsd'])(p.risk.daily as any)[key]=null;
 const all=cards(p).flat().join('\n');assert.match(all,/HWM \$1,000\.00 at 03:49:50 UTC · remaining Unavailable \/ Unavailable/);assert.match(all,/cash ceiling unavailable SOL/);assert.doesNotMatch(all,/remaining 0\.00%|\$0\.00/);
});
test('new cards retain the approved epoch equity graph, candidate progression, collapsed trades and DexScreener links',()=>{
 assert.match(source,/\.\.\.financialPolicyCards\(s\)/);assert.match(source,/\['PORTFOLIO EQUITY',money\(b.equityUsd\)/);
 assert.match(source,/plot\(latestEquityHistory\?\.points\?\?\[\],latest\?\.financialEpoch\?\.activatedAt\?\?latestEquityHistory\?\.financialEpoch\?\.activatedAt\?\?null\)/);
 assert.match(source,/Earlier history is retained in exports and is not backfilled into this graph/);
 assert.match(source,/paper-trades-disclosure/);assert.match(source,/function renderFunnel\(/);assert.match(source,/https:\/\/dexscreener.com\/solana\//);
});
test('PAPER model card distinguishes adapter preparation from financial fills and observed RPC from scenario delay/fees',()=>{
 const p=risk() as any;p.execution={version:'paper-chain-conditioned-v1',state:'active',scope:'current-market-instance',plans:2,supportedLandingStates:1,preflightUnsubmitted:1,unknownLanding:1,legacyProtectionFallbacks:0,last:{at:'2026-10-30T03:49:59.900Z',stage:'landing-state-supported',reasonCode:'LANDING_STATE_SUPPORTED',observedRpcMs:325,modeledDelayMs:1375,feeSol:'0.000007000',sourceSlot:400000001},meaning:'PAPER_PREPARATION_NOT_OBSERVED_CHAIN_OUTCOME'};
 const all=cards(p).flat().join('\n');assert.match(all,/Active PAPER model/);assert.match(all,/2 plans; 1 supported landing states, 1 preflight unsubmitted, 1 unknown/);assert.match(all,/Current adapter preparations, not financial fills/);assert.match(all,/observed RPC 325 ms; modeled delay 1375 ms; scenario fee 0\.000007000 SOL/);assert.match(all,/No chain landing or fee observed/);assert.doesNotMatch(all,/1 confirmed|actual chain fee|1 filled/i);
 p.execution.last=null;const initialized=cards(p).flat().join('\n');assert.doesNotMatch(initialized,/observed RPC 0 ms|scenario fee 0 SOL/);
});
test('source-reported USD outage cause appears in the existing entry-policy card without inventing oracle publication time',()=>{
 const p=risk() as any;p.valuation={version:'paper-sol-usd-observation-v1',scope:'current-source-instance',failuresByReason:{USD_PRICE_TIMEOUT:2},lastObservation:{source:'coinbase-public-sol-usd',startedAt:'2026-10-30T03:49:58.600Z',completedAt:'2026-10-30T03:49:59.000Z',durationMs:398.6,outcome:'unavailable',reasonCode:'USD_PRICE_TIMEOUT',httpStatus:null,receivedAt:null,publicationTimeKnown:false}};
 const all=cards(p).flat().join('\n');assert.match(all,/SOL\/USD last unavailable \(USD_PRICE_TIMEOUT\)/);assert.match(all,/publication time unknown/);assert.doesNotMatch(all,/oracle published|historical outage was/);
});
test('unavailable policy never presents retained numeric targets as a current entry allowance',()=>{
 const p=risk();p.risk.state='unavailable';p.risk.reasonCode='EQUITY_RISK_RECONCILIATION_STALE' as any;
 const rows=cards(p);assert.equal(rows[0]![1],'Unavailable');assert.match(rows[0]![2],/Risk facts unavailable \(EQUITY_RISK_RECONCILIATION_STALE\)/);assert.match(rows[0]![2],/cash ceiling unavailable SOL/);assert.match(rows[1]![1],/Unavailable/);assert.match(rows[1]![2],/remaining Unavailable \/ Unavailable/);assert.doesNotMatch(rows[1]![2],/remaining 0\.00%/);
});

test('a rebound never advertises reusable loss allowance while the daily latch remains active',()=>{
 const p=risk();p.risk.daily.lossPaused=true;p.risk.daily.drawdownBps=0;p.risk.daily.remainingBeforePauseMicroUsd='100000000';
 const all=cards(p).flat().join('\n');assert.match(all,/0\.00% \/ 10\.00%/);assert.match(all,/remaining allowance latched; new entries paused/);assert.doesNotMatch(all,/remaining 10\.00%|remaining .*\$100\.00/);
});
test('legacy held-exit fallback remains visible without claiming new-model landing fidelity',()=>{
 const p=risk() as any;p.execution={version:'paper-chain-conditioned-v1',state:'active',scope:'current-market-instance',plans:2,supportedLandingStates:1,preflightUnsubmitted:1,unknownLanding:1,legacyProtectionFallbacks:1,last:{at:'2026-10-30T03:49:59.900Z',stage:'legacy-protection-fallback',reasonCode:'LEGACY_HELD_ACCOUNT_MODEL',observedRpcMs:null,modeledDelayMs:1000,feeSol:'0.000007000',sourceSlot:null},meaning:'PAPER_PREPARATION_NOT_OBSERVED_CHAIN_OUTCOME'};
 const all=cards(p).flat().join('\n');assert.match(all,/Legacy exit fallback/);assert.match(all,/LEGACY_HELD_ACCOUNT_MODEL/);assert.match(all,/1 legacy exit fallbacks/);assert.match(all,/Legacy exit model; v1 landing fidelity unavailable/);assert.match(all,/No chain landing or fee observed/);assert.doesNotMatch(all,/Active PAPER model|confirmed landed/);
});
