/** Independent OFFLINE corruption/migration probes. No real account or provider. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
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
