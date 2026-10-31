/** Disposable PAPER accounting and public reporting; no provider or live fills. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContext,Script} from 'node:vm';
import Database from 'better-sqlite3';
import {DisposableLedger,PaperLedger,type OrderOutcome,type Order} from '../src/ledger.js';
import {makeTradeOutcome,readTradeOutcome,tradeDecisionContext,tradeEntryBasis,type TradeDecisionContext} from '../src/trade-outcome-reporting.js';
import {reportingFilledTrade,validateSnapshot,type ReportingFilledTrade} from '../src/reporting.js';
import {buildPilotPortfolio,projectPilotFilledTrades} from '../src/pilot-reporting.js';

const AT=Date.parse('2026-10-31T12:00:00Z'),MINT='fixture-outcome-mint',ACCOUNT='fixture-outcome-account';
const price=(at:number)=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE constant USD fixture'});
const context=(at:number,exit=false):TradeDecisionContext=>({schemaVersion:1,strategyVersion:'liquidity-resilient-momentum-v3.1',reason:exit?'v3-protective-cost-stop; fill-price-not-guaranteed':'v3.1-joint-conditional-economics-and-current-execution-checks-passed; accounting-and-fill-still-required',candidateAdmittedAt:exit?null:at-60000,windowStartAt:exit?null:at-60000,windowEndAt:exit?null:at,assessedAt:at,decisionQuoteAt:at,...(exit?{}:{entryBasis:tradeEntryBasis({netBuyLamports:'1800000000',distinctBuyerWallets:6,positiveNetBuckets:6,largestBuyerBps:1700,priceReturnBps:140},{inputUnits:'100000000',effectiveQuoteLiquidityLamports:'20000000000'},{economicBalance:{jointConditionalBalanceLamports:'7000000'}})})});
const buy=(id:string,at:number,mint=MINT,decisionContext:TradeDecisionContext|undefined=context(at)):Omit<Order,'reserved'>=>({id,mint,side:'buy',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'2000000',maxSpend:'100000000',minReceive:'1000',decisionEvidence:'DISPOSABLE entry quote',...(decisionContext?{decisionContext}:{})});
const sell=(id:string,at:number,mint=MINT,decisionContext:TradeDecisionContext|undefined=context(at,true)):Omit<Order,'reserved'>=>({id,mint,side:'sell',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'DISPOSABLE protective exit',...(decisionContext?{decisionContext}:{})});
const buyQuote=(at:number)=>({at,spendLamports:'100000000',receiveUnits:'1000',evidence:'DISPOSABLE post-delay entry state'});
const sellQuote=(at:number)=>({at,spendLamports:'0',receiveUnits:'110000000',pricedBaseUnits:'1000',refundedDepositLamports:'2000000',refundEvidence:'DISPOSABLE full account refund',evidence:'DISPOSABLE post-delay full-size exit'});
function fixture(t:TestContext,paper=false){
 const dir=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-outcomes-')),path=join(dir,'ledger.sqlite'),identity=paper?'poe-pilot-outcome-fixture':ACCOUNT,open=()=>paper?new PaperLedger(path,identity):new DisposableLedger(path,identity);let ledger=open();
 ledger.initialize(price(AT),AT);ledger.reconcile('ready',AT,price(AT),{});if(paper)ledger.resume('fixture-readiness',AT,price(AT),{},{version:'DISPOSABLE outcome fixture',evidence:'DISPOSABLE no market claim',marketAt:AT,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
 return {path,get ledger(){return ledger;},restart(){ledger.close();ledger=open();},corruptProvenance(value:unknown){ledger.close();const db=new Database(path);try{const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string},state=JSON.parse(row.body);state.positions[MINT].tradeProvenance=value;db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));}finally{db.close();}ledger=open();}};
}
function row(ledger:PaperLedger,id:string){
 const attempt=(ledger.exportJournal(1000) as Array<{action_id:string;at:number;detail:string}>).find(r=>r.action_id===id)!;
 const payload=JSON.parse(attempt.detail),order=(ledger.exportJournal(1000) as Array<{action_id:string;detail:string}>).find(r=>r.action_id==='order:'+payload.orderId)!;
 const trade=reportingFilledTrade(id,attempt.at,payload,JSON.parse(order.detail),ledger.actionResult(id));assert.ok(trade);return trade;
}
function projection(ledger:PaperLedger,at:number){
 const journal=ledger.exportJournal(50),identity={accountId:ledger.accountId,inceptionAt:new Date(AT).toISOString(),release:'fixture-outcome-release',strategy:'fixture-outcome-strategy'};
 return {at,running:true,state:ledger.state(),projection:ledger.projection(at,price(at),{}),identity,sequence:ledger.nextSnapshotSequence(),price:price(at),marks:{},sourceValidUntil:at+30000,history:ledger.getReportingHistory(),journal,actionResults:new Map(journal.map(value=>{const r=value as {action_id:string};return [r.action_id,ledger.actionResult(r.action_id)];})),decisions:[],funnel:{discovered:0,supported:0,sufficientlyObserved:0,evaluated:0,qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:1},connected:true,warming:false,usefulProgressAt:at,blocker:null,metrics:{eventLoopLagMs:0,processingLagMs:0,providerEvents:0,rpcRequests:0,rpcAvailable:true}};
}

test('failed exit gas survives restart and idempotent replay; closed net conserves cash and excludes failed entries',t=>{
 const f=fixture(t,true);
 f.ledger.order(buy('failed-entry',AT,'fixture-never-held'),price(AT),{});f.ledger.attempt('failed-entry-attempt','failed-entry',AT+1000,null,price(AT+1000));
 assert.equal(f.ledger.state().realizedLamports,'-7000');
 f.ledger.reconcile('entry-ready',AT+1100,price(AT+1100),{});const order=buy('entry',AT+1100);f.ledger.order(order,price(order.decidedAt),{});f.restart();
 assert.equal(f.ledger.state().pending.entry!.decisionContext!.reason,order.decisionContext!.reason);
 const entry=f.ledger.attempt('entry-fill','entry',AT+2100,buyQuote(AT+2100),price(AT+2100));assert.equal(entry.status,'filled');assert.equal(entry.tradeOutcome?.kind,'entry');
 assert.equal(entry.tradeOutcome!.entry.context!.entryBasis!.jointConditionalBalanceLamports,'7000000');
 f.ledger.order(sell('failed-exit',AT+2200),price(AT+2200),{});
 const failed=f.ledger.attempt('failed-exit-attempt','failed-exit',AT+3200,null,price(AT+3200));assert.equal(failed.status,'failed');
 assert.equal(f.ledger.state().positions[MINT]!.tradeProvenance!.failedExitGasLamports,'7000');f.restart();
 const before=f.ledger.state();assert.deepEqual(f.ledger.attempt('failed-exit-attempt','failed-exit',AT+3200,null,price(AT+3200)),failed);assert.deepEqual(f.ledger.state(),before);
 f.ledger.order(sell('exit',AT+3300),price(AT+3300),{});f.restart();
 const closed=f.ledger.attempt('exit-fill','exit',AT+4300,sellQuote(AT+4300),price(AT+4300)),receipt=closed.tradeOutcome!;
 assert.equal(closed.status,'filled');assert.equal(receipt.economics.filledPairNetLamports,'9986000');assert.equal(receipt.economics.failedExitGasLamports,'7000');assert.equal(receipt.economics.closedTradeNetLamports,'9979000');
 assert.equal(BigInt(receipt.economics.closedTradeNetLamports!)-7000n,BigInt(f.ledger.state().realizedLamports));
 assert.equal(BigInt(f.ledger.state().lamports)-10000000000n,BigInt(f.ledger.state().realizedLamports));assert.deepEqual(f.ledger.state().lockedDeposits,{});
 assert.equal(receipt.entry.orderId,'entry');assert.equal(receipt.exit!.context!.reason,context(AT+3300,true).reason);
 assert.equal(receipt.observation.bestObservedNetLamports,null,'no sampled high is invented for a position without protection history');
 const input=projection(f.ledger,AT+4300),trades=projectPilotFilledTrades(input).trades;assert.equal(trades.length,2);
 const cache=f.ledger.recordReportingTrades(trades),snapshot=buildPilotPortfolio({...input,tradeCache:cache});assert.equal(snapshot.trades[0]!.outcome!.economics.closedTradeNetLamports,'9979000');
 assert.equal(validateSnapshot(snapshot,input.identity,AT+4300),snapshot);
 const saved=structuredClone(cache);f.restart();assert.deepEqual(f.ledger.getReportingTrades(),saved);assert.deepEqual((f.ledger.actionResult('exit-fill') as OrderOutcome).tradeOutcome,receipt);
});

test('legacy fill bytes remain unchanged; closing an older holding explicitly leaves full net unknown',t=>{
 const f=fixture(t),oldBuy=buy('legacy-entry',AT);delete oldBuy.decisionContext;
 f.ledger.order(oldBuy,price(AT),{});const legacy=f.ledger.attempt('legacy-fill','legacy-entry',AT+1000,buyQuote(AT+1000),price(AT+1000));
 assert.deepEqual(legacy,{status:'filled',reason:'single modeled PAPER attempt; no live fill claim',at:AT+1000});
 const oldRow=row(f.ledger,'legacy-fill');assert.equal(Object.hasOwn(oldRow,'outcome'),false);f.ledger.recordReportingTrades([oldRow]);f.restart();assert.deepEqual(f.ledger.getReportingTrades().trades,[oldRow]);
 f.ledger.order(sell('legacy-exit',AT+1100),price(AT+1100),{});const closed=f.ledger.attempt('legacy-exit-fill','legacy-exit',AT+2100,sellQuote(AT+2100),price(AT+2100)).tradeOutcome!;
 assert.equal(closed.entry.filledAt,AT+1000);assert.equal(closed.entry.orderId,null);assert.equal(closed.entry.context,null);assert.equal(closed.economics.failedExitGasLamports,null);assert.equal(closed.economics.closedTradeNetLamports,null);assert.equal(closed.economics.filledPairNetLamports,'9986000');
 assert.deepEqual(f.ledger.getReportingTrades().trades,[oldRow],'new receipt does not rewrite older fill rows');
});

test('malformed optional context and held provenance never prevent a financially valid full exit',t=>{
 const f=fixture(t),bad=buy('bad-context-entry',AT);bad.decisionContext={...context(AT),secret:'not-allowlisted'} as unknown as TradeDecisionContext;
 assert.ok('reserved'in f.ledger.order(bad,price(AT),{}));assert.equal(f.ledger.state().pending['bad-context-entry']!.decisionContext,undefined);
 assert.equal(f.ledger.attempt('bad-context-fill','bad-context-entry',AT+1000,buyQuote(AT+1000),price(AT+1000)).status,'filled');
 f.corruptProvenance({schemaVersion:1,failedExitGasLamports:'invented',extra:'untrusted'});
 const exit=sell('safe-exit',AT+1100);assert.ok('reserved'in f.ledger.order(exit,price(AT+1100),{}));
 const result=f.ledger.attempt('safe-exit-fill','safe-exit',AT+2100,sellQuote(AT+2100),price(AT+2100));assert.equal(result.status,'filled');assert.deepEqual(f.ledger.state().positions,{});assert.equal(result.tradeOutcome!.economics.closedTradeNetLamports,null);assert.equal(result.tradeOutcome!.economics.filledPairNetLamports,'9986000');
});

test('an expired exit adds no phantom failed fee and retains the full held obligation',t=>{
 const f=fixture(t);f.ledger.order(buy('entry',AT),price(AT),{});f.ledger.attempt('entry-fill','entry',AT+1000,buyQuote(AT+1000),price(AT+1000));
 f.ledger.order(sell('expired-exit',AT+1100),price(AT+1100),{});assert.equal(f.ledger.attempt('expiry','expired-exit',AT+6100,null,price(AT+6100)).status,'expired');
 assert.equal(f.ledger.state().positions[MINT]!.tradeProvenance!.failedExitGasLamports,'0');assert.equal(f.ledger.state().executionCosts,'7000');
 f.ledger.order(sell('exit',AT+6200),price(AT+6200),{});const report=f.ledger.attempt('exit-fill','exit',AT+7200,sellQuote(AT+7200),price(AT+7200)).tradeOutcome!;
 assert.equal(report.economics.closedTradeNetLamports,'9986000');assert.equal(report.economics.failedExitGasLamports,'0');
});

test('receipt validation checks timing, exact cash-flow equations and observed-mark scope without causal attribution',()=>{
 const entryOrder=buy('entry',AT),entry=makeTradeOutcome(entryOrder,buyQuote(AT+1000),AT+1000)!;
 const position={units:'1000',enteredAt:AT+1000,entryLamports:'100000000',entryGas:'7000',strategy:{version:'liquidity-resilient-momentum-v3.1',roundTripId:'entry',windowStartAt:AT-60000,windowEndAt:AT,assessedAt:AT,highWaterNetLamports:'130000000',highWaterAt:AT+1500}};
 const exitOrder=sell('exit',AT+2000),report=makeTradeOutcome(exitOrder,sellQuote(AT+3000),AT+3000,position)!;
 assert.equal(report.observation.givebackFromObservedNetLamports,'20007000');assert.equal(report.attribution,'recorded-facts-only-cause-not-established');assert.equal(report.economics.closedTradeNetLamports,null);
 for(const edit of [(r:any)=>{r.economics.filledPairNetLamports='1';},(r:any)=>{r.economics.closedTradeNetLamports='9986000';},(r:any)=>{r.observation.bestObservedAt=AT+500;},(r:any)=>{r.observation.givebackFromObservedNetLamports='999';},(r:any)=>{r.exit.decidedAt=AT+4000;},(r:any)=>{r.exit.context.secret='DO_NOT_EXPORT';}]){const changed=structuredClone(report);edit(changed);assert.equal(readTradeOutcome(changed,AT+3000,'sell'),null);}
 assert.equal(readTradeOutcome(entry,AT+1000,'sell'),null);assert.equal(tradeDecisionContext({...context(AT),assessedAt:AT+1},AT),null);
 const noPeak=makeTradeOutcome(exitOrder,sellQuote(AT+3000),AT+3000,{...position,strategy:{...position.strategy,highWaterAt:AT+4000}})!;assert.equal(noPeak.observation.bestObservedNetLamports,null);
 const unrelated=reportingFilledTrade('entry-fill',AT+1000,{orderId:'entry',quote:buyQuote(AT+1000),price:price(AT+1000)},{input:entryOrder},{status:'filled',at:AT+1000,tradeOutcome:{...entry,entry:{...entry.entry,orderId:'other'}}});assert.equal(unrelated!.outcome,undefined,'a receipt for a different order cannot enter the public row');
});

test('worst-case bounded explanations trim only the presentation cache and preserve every durable receipt',t=>{
 const f=fixture(t),trades:ReportingFilledTrade[]=[];let at=AT;
 for(let i=0;i<50;i++){
  const mint='fixture-cache-'+i,c={...context(at),strategyVersion:'界'.repeat(128),reason:'界'.repeat(256)},entry=buy('entry-'+i,at,mint,c);
  f.ledger.reconcile('ready-'+i,at,price(at),{});f.ledger.order(entry,price(at),{});f.ledger.attempt('entry-fill-'+i,entry.id,at+1000,buyQuote(at+1000),price(at+1000));
  const exit=sell('exit-'+i,at+1100,mint,{...c,candidateAdmittedAt:null,windowStartAt:null,windowEndAt:null,assessedAt:at+1100,decisionQuoteAt:at+1100});f.ledger.order(exit,price(at+1100),{});f.ledger.attempt('exit-fill-'+i,exit.id,at+2100,sellQuote(at+2100),price(at+2100));trades.push(row(f.ledger,'exit-fill-'+i));at+=3000;
 }
 assert.ok(Buffer.byteLength(JSON.stringify(trades))>128*1024);const cache=f.ledger.recordReportingTrades(trades);
 assert.ok(cache.trades.length>0&&cache.trades.length<50);assert.equal(cache.windowLimited,true);assert.ok(Buffer.byteLength(JSON.stringify(cache))<=128*1024);
 assert.equal(cache.trades[0]!.actionId,'exit-fill-49');assert.ok((f.ledger.actionResult('exit-fill-0') as OrderOutcome).tradeOutcome);f.restart();assert.deepEqual(f.ledger.getReportingTrades(),cache);
 assert.throws(()=>f.ledger.recordReportingTrades([trades[0]!,trades[0]!]),/chronology/);
});

test('existing trade panel explains decisions in plain language and treats legacy and rendered text safely',()=>{
 const source=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8'),begin=source.indexOf('function renderTradeOutcome('),end=source.indexOf('\nfunction renderFunnel(',begin);assert.ok(begin>=0&&end>begin);
 class Element{children:Element[]=[];textContent='';className='';open=false;events:Record<string,()=>void>={};constructor(readonly tag='div'){}append(n:Element){this.children.push(n);}addEventListener(name:string,fn:()=>void){this.events[name]=fn;}}
 const add=(p:Element,tag:string,value?:unknown,cls='')=>{const n=new Element(tag);n.textContent=value===undefined?'':String(value);n.className=cls;p.append(n);return n;};
 const vm=createContext({add,BigInt,Date,Set,String}),render=new Script(source.slice(begin,end)+'\nrenderTradeOutcome').runInContext(vm) as (p:Element,t:unknown)=>void;
 const allText=(p:Element):string=>[p.textContent,...p.children.map(allText)].join('\n');
 const old=new Element();render(old,{id:'historical',side:'sell'});assert.match(allText(old),/Historical explanation unavailable/);assert.match(allText(old),/Missing history is unknown/);
 const order=buy('entry',AT),entry=makeTradeOutcome(order,buyQuote(AT+1000),AT+1000)!,position={units:'1000',enteredAt:AT+1000,entryLamports:'100000000',entryGas:'7000',tradeProvenance:{schemaVersion:1 as const,orderId:'entry',units:'1000',decidedAt:AT,executeAt:AT+1000,filledAt:AT+1000,quoteAt:AT+1000,context:entry.entry.context,failedExitGasLamports:'0'}};
 const closed=makeTradeOutcome(sell('exit',AT+2000),sellQuote(AT+3000),AT+3000,position)!,root=new Element();render(root,{id:'closed',outcome:closed});
 assert.match(allText(root),/25% loss threshold/);assert.match(allText(root),/positive conditional economic balance/);assert.match(allText(root),/not a profit forecast/);assert.match(allText(root),/6/);assert.match(allText(root),/0\.009986 SOL/);assert.match(allText(root),/failed entries and operating expenses are outside/);
 const unknown=structuredClone(closed);unknown.exit!.context!.reason='v3.1-actual-size-stress-and-economic-reserve-decrease; cause-unverified';unknown.entry.context!.reason='<img src=x onerror=alert(1)>';const safe=new Element();render(safe,{id:'safe',outcome:unknown});assert.match(allText(safe),/cause of that decrease is unknown/);assert.match(allText(safe),/<img src=x onerror=alert\(1\)>/);assert.equal(JSON.stringify(safe).includes('"tag":"img"'),false);
 const partial=new Element();render(partial,{id:'partial',outcome:{...closed,economics:{...closed.economics,failedExitGasLamports:null,closedTradeNetLamports:null}}});assert.match(allText(partial),/total net unknown/);assert.match(allText(partial),/failed-exit fee history is missing/);
});
