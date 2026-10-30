/** Independent OFFLINE corruption/migration probes. No real account or provider. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,validateFinancialState,type UsdPrice} from '../src/ledger.js';
import {planPaperExecution,executionAttempt,paperExecutionPlanSha256} from '../src/execution-realism.js';
const AT=Date.parse('2026-10-30T00:00:00Z');
const price=(at:number,value='100000000'):UsdPrice=>({at,microUsdPerSol:value,source:'OFFLINE independent price'});
function fixture(t:{after:(fn:()=>void)=>void}){
 const dir=mkdtempSync(join(tmpdir(),'poe-independent-risk-')),path=join(dir,'fixture.sqlite');let ledger=new DisposableLedger(path,'fixture-independent-risk');
 ledger.initialize(price(AT),AT);ledger.reconcile('initial',AT,price(AT),{});
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
 return {path,get ledger(){return ledger;},reopen(){ledger.close();ledger=new DisposableLedger(path,'fixture-independent-risk');return ledger;}};
}
function rows(path:string){const db=new Database(path,{readonly:true});try{return {actions:db.prepare('SELECT * FROM actions ORDER BY id').all(),journal:db.prepare('SELECT * FROM journal ORDER BY revision').all(),metadata:db.prepare('SELECT * FROM metadata ORDER BY key').all()};}finally{db.close();}}

test('activation, chunked history, restart and old owner-reset lookup preserve every prior financial row',t=>{
 const f=fixture(t);f.ledger.reconcile('legacy-loss',AT+1,price(AT+1,'94000000'),{});
 const reset=f.ledger.resetDailyLoss('prior-owner-reset',AT+1,price(AT+1,'94000000'),{},'explicit historical fixture owner authorization');
 for(let i=2;i<620;i++)f.ledger.reconcile('history:'+i,AT+i,price(AT+i,i===3?'120000000':'115000000'),{});
 const before=rows(f.path),identity=structuredClone(f.ledger.state());f.ledger.activateEquityRiskPolicy(AT+620);
 f.ledger.reconcile('scan:first',AT+620,price(AT+620,'115000000'),{});assert.equal(f.ledger.state().equityRisk!.daily.historyState,'scanning');
 f.reopen();for(let i=621;i<630&&f.ledger.state().equityRisk!.daily.historyState!=='complete';i++)f.ledger.reconcile('scan:'+i,AT+i,price(AT+i,'115000000'),{});
 assert.equal(f.ledger.state().equityRisk!.daily.highWaterMicroUsd,'1200000000');assert.equal(f.ledger.state().equityRisk!.daily.historyState,'complete');
 const after=rows(f.path),oldIds=new Set((before.actions as any[]).map(x=>x.id));assert.deepEqual(after.actions.filter((x:any)=>oldIds.has(x.id)),before.actions);assert.deepEqual(after.journal.slice(0,before.journal.length),before.journal);assert.deepEqual(after.metadata,before.metadata);
 assert.equal(f.ledger.state().lamports,identity.lamports);assert.equal(f.ledger.state().initialMicroUsd,identity.initialMicroUsd);assert.equal(f.ledger.state().inceptionAt,identity.inceptionAt);
 assert.deepEqual(f.ledger.dailyLossResetReceipt('prior-owner-reset','explicit historical fixture owner authorization'),reset);
});

test('missing joined action/result invalidates HWM migration rather than skipping a retained peak',t=>{
 const f=fixture(t);f.ledger.reconcile('peak',AT+1,price(AT+1,'120000000'),{});
 const db=new Database(f.path);db.prepare("DELETE FROM actions WHERE id='peak'").run();db.close();
 f.ledger.activateEquityRiskPolicy(AT+2);f.ledger.reconcile('scan',AT+2,price(AT+2),{});
 assert.equal(f.ledger.state().equityRisk!.daily.historyState,'invalid');assert.equal(f.ledger.projection(AT+2,price(AT+2)).entriesEnabled,false);
});

test('oversized and malformed same-day reconcile receipts cannot be omitted as a complete history',t=>{
 for(const malformed of ['x'.repeat(65537),'not-json']){
  const f=fixture(t);f.ledger.reconcile('peak',AT+1,price(AT+1,'120000000'),{});
  const db=new Database(f.path);db.prepare("UPDATE journal SET detail=? WHERE action_id='peak'").run(malformed);db.close();
  f.ledger.activateEquityRiskPolicy(AT+2);f.ledger.reconcile('scan',AT+2,price(AT+2),{});assert.equal(f.ledger.state().equityRisk!.daily.historyState,'invalid');
 }
});

test('a missing journal row must not erase a still-retained authoritative peak action',t=>{
 const f=fixture(t);f.ledger.reconcile('peak',AT+1,price(AT+1,'120000000'),{});
 const db=new Database(f.path);db.prepare("DELETE FROM journal WHERE action_id='peak'").run();db.close();assert.ok(f.ledger.actionResult('peak'));
 f.ledger.activateEquityRiskPolicy(AT+2);f.ledger.reconcile('scan',AT+2,price(AT+2),{});
 assert.equal(f.ledger.state().equityRisk!.daily.historyState,'invalid','missing financial history must fail closed rather than certifying a lower HWM');
});

test('fresh-equity resume and order both observe a new HWM before later10% threshold comparison',t=>{
 const f=fixture(t);f.ledger.activateEquityRiskPolicy(AT);f.ledger.reconcile('ready',AT,price(AT),{});
 const readiness={version:'independent-fixture',evidence:'OFFLINE fresh support',marketAt:AT+10,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true};
 f.ledger.resume('resume:peak',AT+10,price(AT+10,'120000000'),{},readiness);assert.equal(f.ledger.state().equityRisk!.daily.highWaterMicroUsd,'1200000000');
 f.ledger.reconcile('ten-percent',AT+20,price(AT+20,'108000000'),{});assert.equal(f.ledger.state().daily.lossPaused,true);
});

test('a retained activation receipt cannot coexist with silently missing active policy state',t=>{
 const f=fixture(t);f.ledger.activateEquityRiskPolicy(AT);f.ledger.reconcile('ready',AT,price(AT),{});
 const db=new Database(f.path),row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string};
 const state=JSON.parse(row.body);delete state.equityRisk;db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));db.close();
 assert.ok(f.ledger.actionResult('activate:paper-equity-risk-5-10-v1'));
 assert.throws(()=>f.ledger.activateEquityRiskPolicy(AT+1),/policy|activation|state/i,'idempotent historical activation result must not authorize legacy financial fallback');
});

test('unavailable entry policy preserves above$50 holding exits during USD outage while core and backup validation remain strict',t=>{
 const f=fixture(t),l=f.ledger;l.activateEquityRiskPolicy(AT);l.reconcile('grown',AT,price(AT,'200000000'),{});
 const buy={id:'large',mint:'large',side:'buy' as const,decidedAt:AT,executeAt:AT+500,expiresAt:AT+5000,gas:'7000',maxSpend:'399993000',deposit:'2000000',minReceive:'1',decisionEvidence:'OFFLINE fresh entry'};
 l.order(buy,price(AT,'200000000'),{});l.attempt('large-fill',buy.id,AT+500,{at:AT+500,spendLamports:buy.maxSpend,receiveUnits:'100',evidence:'OFFLINE entry fill'},price(AT+500,'200000000'));
 assert.equal(l.state().positions.large!.costMicroUsd,'80000000');
 const db=new Database(f.path),row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string},state=JSON.parse(row.body);state.equityRisk.daily.highWaterMicroUsd='corrupt optional value';db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));db.close();
 assert.throws(()=>validateFinancialState(state,state.accountId,state.mode));validateFinancialState(state,state.accountId,state.mode,{allowUnavailableEntryPolicy:true});
 for(const mutate of [(x:any)=>x.lamports='-1',(x:any)=>x.positions.large.units='0',(x:any)=>x.positions.large.allocation.consumedLamports='1']){const broken=structuredClone(state);mutate(broken);assert.throws(()=>validateFinancialState(broken,broken.accountId,broken.mode,{allowUnavailableEntryPolicy:true}));}
 const current=f.reopen(),rawPolicy=structuredClone(current.state().equityRisk),at=AT+600,unknown={at:0,microUsdPerSol:'0',source:'unavailable'};
 const sell={...buy,id:'protective-sell',side:'sell' as const,decidedAt:at,executeAt:at+500,expiresAt:at+5000,maxSpend:'0',deposit:'0'};
 assert.ok('reserved'in current.order(sell,unknown,{}));assert.equal(current.attempt('full-exit',sell.id,at+500,{at:at+500,spendLamports:'0',receiveUnits:'410000000',pricedBaseUnits:'100',evidence:'OFFLINE fresh SOL liquidation despite USD outage'},unknown).status,'filled');
 assert.deepEqual(current.state().positions,{});assert.deepEqual(current.state().equityRisk,rawPolicy);assert.equal(current.entryRiskBudget(at+500,price(at+500),{}).ready,false);assert.equal(current.state().executionCosts,'14000');
});

test('missing, mismatched or malformed new-model landing cannot charge a fee or consume another reservation',t=>{
 for(const mutation of ['missing-landing','wrong-intent','wrong-plan','wrong-rent','wrong-attempt','missing-attempt']){
  const f=fixture(t),l=f.ledger;l.activateEquityRiskPolicy(AT);l.reconcile('ready',AT,price(AT),{});
  const plan=planPaperExecution({plannedAt:AT,decisionQuoteAt:AT,sourceSlot:10,intentSha256:'b'.repeat(64),constructionSha256:'a'.repeat(64),temporaryQuoteRentLamports:'2039280',quoteRentProofSha256:'d'.repeat(64),constructionMs:1,observedRpcMs:10})!;
  const order={id:'modeled',mint:'modeled',side:'buy' as const,decidedAt:AT,executeAt:plan.executeAt,expiresAt:plan.expiresAt,gas:'7000',maxSpend:'399993000',deposit:'2000000',temporaryRentLamports:plan.temporaryQuoteRentLamports,minReceive:'1',decisionEvidence:'OFFLINE fixed plan',executionModel:plan};
  l.order(order,price(AT),{});const at=plan.executeAt;l.reconcile('at-landing',at,price(at),{});
  const q:any={at,spendLamports:order.maxSpend,receiveUnits:'100',evidence:'OFFLINE supported quote',executionModel:{version:plan.version,planSha256:paperExecutionPlanSha256(plan),intentSha256:plan.intentSha256,constructionSha256:'c'.repeat(64),temporaryQuoteRentLamports:plan.temporaryQuoteRentLamports,quoteRentProofSha256:'e'.repeat(64),landingAt:at,preparedAt:at,sourceSlot:11,outcome:'scenario-landed',feeLamports:'7000'}};
  let a:any=executionAttempt(plan,true);
  if(mutation==='missing-landing')delete q.executionModel;if(mutation==='wrong-intent')q.executionModel.intentSha256='0'.repeat(64);if(mutation==='wrong-plan')q.executionModel.planSha256='0'.repeat(64);if(mutation==='wrong-rent')q.executionModel.temporaryQuoteRentLamports='2039281';if(mutation==='wrong-attempt')a.feeLamports='7001';if(mutation==='missing-attempt')a=undefined;
  const cash=l.state().lamports,out=l.attempt('bad-landing',order.id,at,q,price(at),{},a);assert.equal(out.status,'failed');assert.equal(l.state().lamports,cash);assert.equal(l.state().executionCosts,'0');assert.equal(l.state().positions.modeled,undefined);assert.equal(l.state().pending.modeled,undefined);assert.deepEqual(l.attempt('bad-landing',order.id,at,q,price(at),{},a),out);
 }
});
