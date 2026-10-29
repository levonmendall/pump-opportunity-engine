/** Isolated source projection only. These are fixture finances, never forward performance. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import Database from 'better-sqlite3';
import {FinancialBackupStore} from '../src/backup.js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLedger,type Mark,type UsdPrice} from '../src/ledger.js';
import {PaperTrader} from '../src/trader.js';
import {buildPilotPortfolio,boundOperatingSnapshot,pilotReportingPoints,pilotPortfolioReconciled,pilotExperimentalAccounting,projectPilotFilledTrades,pilotPortfolioProjectionFailure,type PilotPortfolioInput} from '../src/pilot-reporting.js';
import {validateSnapshot} from '../src/reporting.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {OPERATING_REPORTING_BASIS} from '../src/ledger.js';
const T=Date.parse('2026-10-27T12:00:00Z'),MINT='fixture-reporting-mint';
const price=(at:number,value='100000000'):UsdPrice=>({at,microUsdPerSol:value,source:'ISOLATED timestamped USD fixture'});
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-portfolio-')),path=join(dir,'fixture.sqlite');let ledger=new PaperLedger(path,'poe-pilot-offline-portfolio');
 ledger.initialize(price(T),T);ledger.reconcile('ready',T,price(T),{});ledger.resume('ready-open',T,price(T),{},{version:'fixture-rule',evidence:'ISOLATED fixture readiness',marketAt:T,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 const input=(at=T,marks:Record<string,Mark>={},p:UsdPrice|null=price(at)):PilotPortfolioInput=>{const journal=ledger.exportJournal(50);return {at,running:true,state:ledger.state(),projection:ledger.projection(at,p??undefined,marks),identity:{accountId:ledger.accountId,inceptionAt:new Date(T).toISOString(),release:'fixture-reviewed-commit',strategy:'fixture-frozen-v1'},sequence:ledger.nextSnapshotSequence(),price:p,marks,sourceValidUntil:at+30000,history:ledger.getReportingHistory(),journal,actionResults:new Map(journal.map(row=>{const r=row as {action_id:string};return [r.action_id,ledger.actionResult(r.action_id)];})),decisions:[],funnel:{discovered:3,supported:2,sufficientlyObserved:1,evaluated:1,qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:1},connected:true,warming:false,usefulProgressAt:at,blocker:null,metrics:{eventLoopLagMs:2,processingLagMs:1200,providerEvents:123,rpcRequests:7,rpcAvailable:true}};};
 const order=(id='fixture-entry',at=T)=>({id,side:'buy' as const,mint:MINT,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'2000000',maxSpend:'497993000',minReceive:'900',decisionEvidence:'ISOLATED actual-size entry'});
 const buy=()=>{ledger.order(order(),price(T),{});const q={at:T+1000,spendLamports:'497993000',receiveUnits:'1000',evidence:'ISOLATED delayed fill'};ledger.attempt('fixture-entry-attempt','fixture-entry',T+1000,q,price(T+1000));};
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,path,get ledger(){return ledger;},input,order,buy,corruptTradeQuantity(){ledger.close();const db=new Database(path);const row=db.prepare("SELECT value FROM metadata WHERE key='reporting_trades'").get() as {value:string};const cache=JSON.parse(row.value);cache.trades[0].quantity='999999';db.prepare("UPDATE metadata SET value=? WHERE key='reporting_trades'").run(JSON.stringify(cache));db.close();ledger=new PaperLedger(path,'poe-pilot-offline-portfolio');},reopen(){ledger.close();ledger=new PaperLedger(path,'poe-pilot-offline-portfolio');}};
}

test('experimental portfolio uses exact account/source/outer timestamp and explicit unknown USD decomposition',t=>{
 const f=fixture(t),input=f.input(),s=buildPilotPortfolio(input);
 assert.equal(s.account.id,f.ledger.accountId);assert.equal(s.account.inceptionAt,new Date(T).toISOString());assert.equal(s.times.generatedAt,new Date(input.at).toISOString());assert.deepEqual(s.source,{release:'fixture-reviewed-commit',strategy:'fixture-frozen-v1'});
 assert.equal(s.balances.equityUsd,1000);assert.equal(s.balances.tradingPnlUsd,0);assert.equal(s.balances.passiveSolEquityUsd,1000);assert.equal(s.balances.realizedUsd,null);assert.equal(s.balances.unrealizedUsd,null);assert.equal(s.balances.drawdownUsd,null);assert.equal(s.balances.economicPnlUsd,null);assert.equal(s.balances.operatingCostsUsd,null);assert.equal(s.costLabels.operating,'unavailable');assert.deepEqual(s.pnl,[{at:new Date(T).toISOString(),tradingUsd:0,economicUsd:null}]);assert.equal(s.status.reconciled,true);
 assert.equal(validateSnapshot(s,input.identity,T),s);assert.throws(()=>buildPilotPortfolio({...input,identity:{...input.identity,accountId:'poe-original-authoritative'}}),/PILOT_REPORTING_IDENTITY/);
});

test('reservations remain part of cash and do not create another asset or double debit',t=>{
 const f=fixture(t);f.ledger.order(f.order(),price(T),{});const s=buildPilotPortfolio(f.input());
 assert.equal(s.balances.cashSol,'10');assert.equal(s.balances.reservedSol,'0.5');assert.equal(s.balances.equitySol,'10');assert.equal(s.balances.equityUsd,1000);assert.equal(s.trades.length,0,'an order is not a fill');
});

test('actual-size fresh liquidation includes locked rent once and stale/source-expired marks become unknown',t=>{
 const f=fixture(t);f.buy();const at=T+2000,marks={[MINT]:{at,pricedBaseUnits:'1000',netLamports:'470000000',evidence:'ISOLATED actual-size net liquidation'}};f.ledger.reconcile('held-reconcile',at,price(at),marks);
 const input=f.input(at,marks),s=buildPilotPortfolio(input);assert.equal(s.positions[0]!.quantity,'1000');assert.equal(s.positions[0]!.netLiquidationUsd,47);assert.equal(s.balances.equitySol,'9.972');assert.equal(s.balances.markedExposureUsd,47);assert.equal(s.status.reconciled,true);assert.equal(s.balances.executionCostsUsd,null,'current USD cannot revalue cumulative historical gas');assert.match(s.positions[0]!.status,/allocated/);
 for(const changed of [{...input,sourceValidUntil:at-1},{...input,marks:{[MINT]:{...marks[MINT]!,at:at-2001}}},{...input,marks:{[MINT]:{...marks[MINT]!,pricedBaseUnits:'999'}}}]){const unknown=buildPilotPortfolio(changed);assert.equal(unknown.positions[0]!.netLiquidationUsd,null);assert.equal(unknown.balances.equityUsd,null);assert.equal(unknown.balances.equitySol,null);assert.equal(unknown.status.reconciled,false);}
});

test('only durable filled actions become trades; a real USD-unknown SOL exit remains visible with null costs',t=>{
 const f=fixture(t);f.buy();const at=T+2000,marks={[MINT]:{at,pricedBaseUnits:'1000',netLamports:'600000000',evidence:'ISOLATED supported SOL liquidation'}};
 f.ledger.order({id:'fixture-exit',side:'sell',mint:MINT,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'590000000',decisionEvidence:'ISOLATED exit'},price(at),marks);
 f.ledger.attempt('fixture-exit-attempt','fixture-exit',at+1000,{at:at+1000,spendLamports:'0',receiveUnits:'600007000',pricedBaseUnits:'1000',evidence:'ISOLATED current exit state'},price(0,'0'));
 const input=f.input(at+1000,{},null),s=buildPilotPortfolio(input);assert.equal(s.trades.length,2);const sell=s.trades.find(x=>x.side==='sell')!,buy=s.trades.find(x=>x.side==='buy')!;assert.equal(sell.quantity,'1000');assert.equal(sell.valueUsd,null);assert.equal(sell.executionCostsUsd,null);assert.equal(buy.quantity,'1000');assert.equal(buy.valueUsd,49.7993);assert.equal(buy.executionCostsUsd,0.0007);assert.equal(s.status.reconciled,false);assert.equal(s.balances.equityUsd,null);assert.equal(s.balances.equitySol,'10.102');
 const unavailable=buildPilotPortfolio({...input,journal:input.journal.filter(row=>(row as {kind:string}).kind!=='order')});assert.equal(unavailable.trades.length,0);assert.match(unavailable.history.label,/2 recent fills lack order context/);
 const notFilled=new Map(input.actionResults);notFilled.set('fixture-exit-attempt',{status:'failed',at:at+1000});assert.equal(buildPilotPortfolio({...input,actionResults:notFilled}).trades.length,1);
});

test('source projections whitelist decision and journal fields and reject unbounded history',t=>{
 const f=fixture(t),input=f.input(),s=buildPilotPortfolio({...input,decisions:[{mint:'fixture',at:T,stage:'strategy-rejection',reason:'ISOLATED no signal',secret:'DO_NOT_EXPORT'} as any]});assert.ok(!JSON.stringify(s).includes('DO_NOT_EXPORT'));assert.equal(s.decisions.length,1);assert.throws(()=>buildPilotPortfolio({...input,journal:Array(51).fill({})}),/JOURNAL_BOUND/);
});

test('reporting history starts with actual inception and a genuine unknown interval, and restart sequences remain durable',t=>{
 const f=fixture(t),at=T+60000;let history=f.ledger.getReportingHistory();const points=pilotReportingPoints(history,{at,inceptionAt:T,running:true,reconciled:true,tradingMicroUsd:'1000000',economicMicroUsd:null});assert.deepEqual(points.map(x=>[x.at,x.tradingMicroUsd]),[[T+1,null],[at,'1000000']]);
 for(const point of points)history=f.ledger.recordReportingPoint(point);const seq=f.ledger.nextSnapshotSequence();f.reopen();assert.deepEqual(f.ledger.getReportingHistory(),history);assert.ok(BigInt(f.ledger.nextSnapshotSequence())>BigInt(seq));
 const later=pilotReportingPoints(history,{at:at+20000,inceptionAt:T,running:true,reconciled:true,tradingMicroUsd:'2000000',economicMicroUsd:null});assert.deepEqual(later.map(x=>[x.at,x.tradingMicroUsd]),[[at+1,null],[at+20000,'2000000']]);
 const stopped=pilotReportingPoints(history,{at:at+5000,inceptionAt:T,running:false,reconciled:true,tradingMicroUsd:'1000000',economicMicroUsd:null});assert.equal(stopped[0]!.tradingMicroUsd,null);assert.equal(pilotReportingPoints(history,{at,inceptionAt:T,running:true,reconciled:true,tradingMicroUsd:'1000000',economicMicroUsd:null}).length,0);
});


test('durable recent fills survive more than50 reconciliation rows and same-account restart without changing balances',t=>{
 const f=fixture(t);f.buy();const first=f.input(T+1000),revision=f.ledger.state().revision,cache=f.ledger.recordReportingTrades(projectPilotFilledTrades(first).trades);assert.equal(cache.trades.length,1);assert.equal(f.ledger.state().revision,revision);
 for(let i=0;i<60;i++){const at=T+2000+i,marks={[MINT]:{at,pricedBaseUnits:'1000',netLamports:'500000000',evidence:'ISOLATED fresh reconciliation'}};f.ledger.reconcile('later-'+i,at,price(at),marks);}
 f.reopen();const at=T+2060,marks={[MINT]:{at,pricedBaseUnits:'1000',netLamports:'500000000',evidence:'ISOLATED restarted mark'}},input=f.input(at,marks);assert.equal(input.journal.some(row=>(row as {kind:string}).kind==='attempt'),false);
 const resumedCache=f.ledger.recordReportingTrades(projectPilotFilledTrades(input).trades);assert.deepEqual(resumedCache,cache);const s=buildPilotPortfolio({...input,tradeCache:resumedCache});assert.equal(s.trades.length,1);assert.equal(s.trades[0]!.quantity,'1000');assert.equal(s.trades[0]!.at,new Date(T+1000).toISOString());assert.equal(s.account.inceptionAt,new Date(T).toISOString());
 assert.throws(()=>f.ledger.recordReportingTrades([{...cache.trades[0]!,quantity:'999'}]),/durable evidence mismatch/);
});

test('a corrupted recent-fill projection is refused by source and backup recovery',async t=>{
 const f=fixture(t);f.buy();f.ledger.recordReportingTrades(projectPilotFilledTrades(f.input(T+1000)).trades);const backups=join(f.dir,'backups');mkdirSync(backups,{mode:0o700});const store=new FinancialBackupStore({directory:backups,sourcePath:f.path,identity:{accountId:f.ledger.accountId,mode:'PAPER',inceptionAt:T},maxBytes:16*1024*1024});
 const good=await store.create(f.ledger);assert.equal(store.latest().backup?.path,good.path);f.corruptTradeQuantity();assert.throws(()=>f.ledger.getReportingTrades(),/durable evidence mismatch/);await assert.rejects(store.create(f.ledger),/reporting trade durable evidence mismatch/);assert.equal(store.latest().backup?.path,good.path,'only validated previous backup remains recoverable');
});

test('history admission and portfolio use the same source bounds while fresh SOL marks survive unknownUSD',t=>{
 const f=fixture(t);f.buy();const at=T+2000,marks={[MINT]:{at,pricedBaseUnits:'1000',netLamports:'470000000',evidence:'ISOLATED current liquidation'}};f.ledger.reconcile('source-check',at,price(at),marks);const input=f.input(at,marks),future={...input,sourceValidUntil:at+30001};
 assert.equal(pilotPortfolioReconciled(future),false);assert.equal(buildPilotPortfolio(future).status.reconciled,false);assert.equal(pilotReportingPoints(input.history,{at,inceptionAt:T,running:true,reconciled:pilotPortfolioReconciled(future),tradingMicroUsd:input.projection.totalPnlMicroUsd,economicMicroUsd:null}).at(-1)!.tradingMicroUsd,null);
 const noUsd=f.input(at,marks,null),s=buildPilotPortfolio(noUsd);assert.equal(s.times.marketAt,new Date(at).toISOString());assert.equal(s.status.market,'observing');assert.equal(s.balances.equityUsd,null);assert.equal(s.balances.equitySol,'9.972');
 const accounting=pilotExperimentalAccounting(noUsd);assert.equal(accounting.at,at);assert.equal(accounting.totalPnlLamports,'-28000000');assert.equal(accounting.realizedLamports,'0');assert.equal(accounting.unrealizedLamports,'-28000000');assert.equal(accounting.executionCostsLamports,'7000');assert.equal(accounting.lockedDepositLamports,'2000000');assert.equal(pilotExperimentalAccounting(future).totalPnlLamports,null);assert.equal(pilotExperimentalAccounting(future).unrealizedLamports,null);
});


test('actual PaperTrader funnel extra diagnostic counters do not enter the strict financial snapshot',t=>{
 const f=fixture(t),input=f.input();
 const trader=new PaperTrader({ledger:f.ledger,now:()=>T,context:async()=>({price:price(T),marks:{}}),quote:async()=>null,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'ISOLATED reporting integration only'},recorder:{record:()=>{}}});
 trader.funnel.discovered=5;trader.funnel.evaluated=2;trader.funnel.reserved=1;
 const original=structuredClone(trader.funnel),snapshot=buildPilotPortfolio({...input,funnel:trader.funnel});
 assert.deepEqual(Object.keys(snapshot.funnel).sort(),['discovered','supported','sufficientlyObserved','evaluated','qualified','attempted','paperFilled','exited','reconciled'].sort());
 assert.equal(snapshot.funnel.discovered,5);assert.equal(snapshot.funnel.evaluated,2);assert.equal('reserved' in snapshot.funnel,false);
 assert.equal(trader.funnel.reserved,1,'reserved remains a real operating diagnostic');assert.deepEqual(trader.funnel,original,'projection does not mutate the trader');
 assert.equal(validateSnapshot(snapshot,input.identity,T),snapshot);
 assert.throws(()=>buildPilotPortfolio({...input,funnel:{...trader.funnel,evaluated:-1}}),/nonnegative counter required/,'essential financial counters retain strict validation');
});

test('both limited-history labels fit the receiver bound without dropping limitation meanings',t=>{
 const f=fixture(t),input=f.input(),journal=Array.from({length:50},(_,i)=>({revision:i,action_id:'fixture-attempt-'+i,at:T,kind:'attempt',detail:JSON.stringify({orderId:'unavailable-order-'+i})})),actionResults=new Map(journal.map(row=>[row.action_id,{status:'filled'}]));
 const snapshot=buildPilotPortfolio({...input,journal,actionResults,history:{...input.history,windowLimited:true},tradeCache:{schemaVersion:1,accountId:input.state.accountId,inceptionAt:T,windowLimited:true,trades:[]}});
 assert.ok(snapshot.history.label.length<=256);assert.match(snapshot.history.label,/WINDOW LIMITED/);assert.match(snapshot.history.label,/TRADE WINDOW LIMITED/);assert.match(snapshot.history.label,/passive SOL\/USD/);assert.match(snapshot.history.label,/50 recent fills lack order context/);assert.equal(validateSnapshot(snapshot,input.identity,T),snapshot);
});


test('projection failures expose their bounded stage and known reason without exporting arbitrary exceptions',()=>{
 assert.deepEqual(pilotPortfolioProjectionFailure('portfolio',Error('unexpected/missing fields')),{stage:'portfolio',code:'snapshot-schema-mismatch'});
 assert.deepEqual(pilotPortfolioProjectionFailure('history',Error('PILOT_REPORTING_TIME_REGRESSION')),{stage:'history',code:'reporting-time-regression'});
 for(const error of [Error('SECRET_PROVIDER_KEY /private/ledger.sqlite payload=DO_NOT_EXPORT'),{message:'unexpected/missing fields'},null]){
  const diagnostic=pilotPortfolioProjectionFailure('trades',error);assert.deepEqual(diagnostic,{stage:'trades',code:'projection-unavailable'});assert.ok(!JSON.stringify(diagnostic).includes('DO_NOT_EXPORT'));
 }
});


test('original operating projection keeps passive SOL gains out of trading PnL and refuses legacy financial chart reinterpretation',t=>{
 const f=fixture(t),at=T+1000,p=price(at,'200000000'),base=f.input(at,{},p),id=POE_OPERATING_ACCOUNT;
 const state={...base.state,accountId:id.accountId,inceptionAt:id.inceptionAt},projection={...base.projection,accountId:id.accountId,inceptionAt:id.inceptionAt};
 const history={schemaVersion:2 as const,basis:OPERATING_REPORTING_BASIS,cutoverAt:at,firstObservedAt:at,windowLimited:false,downsampled:false,points:[{at:id.inceptionAt,tradingMicroUsd:'0',economicMicroUsd:null},{at:id.inceptionAt+1,tradingMicroUsd:null,economicMicroUsd:null},{at,tradingMicroUsd:'0',economicMicroUsd:null}]};
 const input={...base,state,projection,authoritativeOperating:true as const,history,identity:{...base.identity,accountId:id.accountId,inceptionAt:new Date(id.inceptionAt).toISOString()}};
 const snapshot=buildPilotPortfolio(input);assert.equal(snapshot.balances.equityUsd,2000);assert.equal(snapshot.balances.tradingPnlUsd,0);assert.equal(snapshot.balances.economicPnlUsd,null);assert.equal(snapshot.balances.passiveSolEquityUsd,2000);assert.deepEqual(snapshot.pnl.map(x=>x.tradingUsd),[0,null,0]);assert.match(snapshot.history.label,/Passive|passive/);assert.ok(snapshot.history.label.length<=256);
 assert.throws(()=>buildPilotPortfolio({...input,history:{points:history.points,windowLimited:false,downsampled:false}}),/operating reporting history/);
});


test('large public view stays bounded without removing financial positions or durable-history input',t=>{
 const f=fixture(t),input=f.input(),small=buildPilotPortfolio(input),at=input.at,base={...small,times:{...small.times,generatedAt:new Date(at+720000).toISOString()}};
 const large={...base,pnl:Array.from({length:720},(_,i)=>({at:new Date(at+i*1000).toISOString(),tradingUsd:i===1?null:0,economicUsd:null})),decisions:Array.from({length:50},(_,i)=>({id:'decision-'+i,mint:'fixture',at:new Date(at).toISOString(),stage:'strategy-rejection',reason:'r'.repeat(512)})),trades:Array.from({length:50},(_,i)=>({id:'trade-'+i,mint:'fixture',side:'buy' as const,quantity:'1',at:new Date(at).toISOString(),valueUsd:1,executionCostsUsd:0,status:'filled',reason:'r'.repeat(512)}))};
 const before=JSON.stringify(large),publicView=boundOperatingSnapshot(large);assert.ok(Buffer.byteLength(before)>96*1024);assert.ok(Buffer.byteLength(JSON.stringify(publicView))<96*1024);assert.equal(JSON.stringify(large),before,'input/durable history is untouched');assert.deepEqual(publicView.positions,large.positions);assert.deepEqual(publicView.account,large.account);assert.deepEqual(publicView.times,large.times);assert.equal(publicView.trades.length,20);assert.equal(publicView.decisions.length,20);assert.equal(publicView.pnl[0]!.at,large.pnl[0]!.at);assert.equal(publicView.pnl[1]!.tradingUsd,null);assert.match(publicView.history.label,/PUBLIC WINDOW LIMITED/);
});
