import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DisposableLedger} from '../src/ledger.js';
import {COST_CATEGORIES,type OperatingExpense,type OperatingCoverageEvent,type OperatingValuationEvent} from '../src/costs.js';

const AT=Date.parse('2026-10-26T12:00:00.000Z'),ACCOUNT='fixture-ledger-costs';
const price=(at:number)=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE USD observation'});
const usd=(id='invoice',at=AT+1000,microUsd='1000000'):OperatingExpense=>({kind:'expense',id,accountId:ACCOUNT,recordedAt:at,evidence:'DISPOSABLE provider invoice',category:'data',classification:'actual',occurredAt:at,amount:{currency:'USD',microUsd}});
const sol=(id='fee',at=AT+100,lamports='5000'):OperatingExpense=>({...usd(id,at),category:'transfer-networkfee',amount:{currency:'SOL',lamports}});
function fixture(t:TestContext){
  const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-ledger-costs-')),path=join(directory,'fixture.sqlite');
  const ledger=new DisposableLedger(path,ACCOUNT),opened=[ledger];ledger.initialize(price(AT),AT);chmodSync(path,0o600);
  t.after(()=>{for(const l of opened){try{l.close();}catch{}}rmSync(directory,{recursive:true,force:true});});
  return {directory,path,ledger,opened};
}
function cover(ledger:DisposableLedger,through:number){
  for(const category of COST_CATEGORIES){
    const event:OperatingCoverageEvent={kind:'coverage',id:'coverage:'+category+':'+through,accountId:ACCOUNT,recordedAt:through,evidence:'DISPOSABLE sourced coverage assessment',category,coverage:{status:'complete',from:AT,through,evidence:'DISPOSABLE entire account interval verified',classification:'actual'}};
    ledger.recordOperatingCost(event);
  }
}

test('missing cost metadata is a read-only unknown default, not a seeded zero-expense account',t=>{
  const f=fixture(t),before=f.ledger.state();const inspection=new Database(f.path,{readonly:true,fileMustExist:true});
  try{
    const keys=()=>inspection.prepare('SELECT key FROM metadata ORDER BY key').all();
    const originalKeys=keys(),costs=f.ledger.getOperatingCosts(),p=f.ledger.projection(AT,price(AT));
    assert.equal(costs.accountId,ACCOUNT);assert.equal(costs.inceptionAt,AT);
    assert.ok(Object.values(costs.coverage).every(x=>x===null));
    assert.equal(p.operatingCostsMicroUsd,null);assert.equal(p.economicPnlMicroUsd,null);assert.equal(p.operatingCostClassification,'unavailable');
    assert.deepEqual(keys(),originalKeys);assert.deepEqual(f.ledger.state(),before);
  }finally{inspection.close();}
});

test('sourced actual-zero coverage is distinct from unknown and does not reseed virtual capital',t=>{
  const f=fixture(t);cover(f.ledger,AT+1000);const p=f.ledger.projection(AT+1000,price(AT+1000));
  assert.equal(p.operatingCostsMicroUsd,'0');assert.equal(p.economicPnlMicroUsd,'0');assert.equal(p.operatingCostClassification,'actual');
  assert.equal(f.ledger.state().lamports,'10000000000');assert.equal(f.ledger.state().inceptionAt,AT);
  assert.equal(f.ledger.projection(AT+1001,price(AT+1001)).economicPnlMicroUsd,null); // Heartbeat cannot extend coverage.
});

test('operating expenses affect economic P&L once without debiting virtual cash or subtracting execution gas twice',t=>{
  const f=fixture(t);f.ledger.reconcile('fixture-ready',AT,price(AT),{});
  f.ledger.order({id:'failed-paper-buy',mint:'fixture-token',side:'buy',decidedAt:AT,executeAt:AT+500,expiresAt:AT+2000,gas:'10000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'DISPOSABLE order'},price(AT),{});
  f.ledger.attempt('failed-paper-attempt','failed-paper-buy',AT+500,null,price(AT+500));
  const before=f.ledger.state(),event=usd('provider-charge',AT+600,'2500');
  f.ledger.recordOperatingCost(event);cover(f.ledger,AT+600);
  const p=f.ledger.projection(AT+600,price(AT+600));
  assert.equal(p.totalPnlMicroUsd,'-1000');assert.equal(p.operatingCostsMicroUsd,'2500');assert.equal(p.economicPnlMicroUsd,'-3500');
  assert.equal(f.ledger.state().lamports,before.lamports);assert.equal(f.ledger.state().executionCosts,before.executionCosts);
  assert.equal(f.ledger.state().realizedLamports,before.realizedLamports);assert.deepEqual(f.ledger.state().lockedDeposits,before.lockedDeposits);
});

test('durable action identity handles old repeats before mutable chronology checks and rejects conflicting retries',t=>{
  const f=fixture(t),event=usd();const receipt=f.ledger.recordOperatingCost(event);
  cover(f.ledger,AT+2000);const before=f.ledger.state(),costs=f.ledger.getOperatingCosts();
  assert.deepEqual(f.ledger.recordOperatingCost(event,AT+5000),receipt);
  assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.ledger.getOperatingCosts(),costs);
  assert.throws(()=>f.ledger.recordOperatingCost({...event,amount:{currency:'USD',microUsd:'2'}},AT+5000),/idempotency conflict/);
  assert.throws(()=>f.ledger.recordOperatingCost(usd('new-backdated',AT+2500),AT+3000),/must equal its evidence time/);
  assert.deepEqual(f.ledger.state(),before);
});

test('restart and consistent SQLite backup preserve cost totals, identity, inception and coverage',async t=>{
  const f=fixture(t);f.ledger.recordOperatingCost(usd());cover(f.ledger,AT+2000);
  const costs=f.ledger.getOperatingCosts(),state=f.ledger.state(),backup=join(f.directory,'consistent.sqlite');
  await f.ledger.backup(backup);chmodSync(backup,0o600);f.ledger.close();
  for(const path of [f.path,backup]){
    const restored=new DisposableLedger(path,ACCOUNT);f.opened.push(restored);
    assert.deepEqual(restored.getOperatingCosts(),costs);assert.deepEqual(restored.state(),state);
    assert.equal(restored.projection(AT+2000,price(AT+2000)).economicPnlMicroUsd,'-1000000');
    assert.equal(restored.state().inceptionAt,AT);
  }
});

test('journal-authenticated late SOL valuation rejects a forged evicted original and later duplicate resolution',t=>{
  const f=fixture(t),original=sol();f.ledger.recordOperatingCost(original);
  for(let i=0;i<60;i++)f.ledger.recordOperatingCost(usd('expense-'+i,AT+200+i,'1'));
  f.ledger.recordOperatingCost(sol('other-unvalued-fee',AT+1000));
  assert.equal(f.ledger.getOperatingCosts().recent.some(row=>row.expenseId===original.id),false);
  const event:OperatingValuationEvent={kind:'valuation',id:'valuation-a',accountId:ACCOUNT,recordedAt:AT+2000,evidence:'DISPOSABLE captured incurrence valuation',expense:original,valuation:price(original.occurredAt)};
  const before=f.ledger.state(),book=f.ledger.getOperatingCosts();
  assert.throws(()=>f.ledger.recordOperatingCost({...event,expense:{...original,amount:{currency:'SOL',lamports:'4000'}}}),/does not match authoritative journal/);
  assert.throws(()=>f.ledger.recordOperatingCost({...event,expense:{...original,id:'not-recorded'}}),/does not match authoritative journal/);
  assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.ledger.getOperatingCosts(),book);
  const receipt=f.ledger.recordOperatingCost(event),resolved=f.ledger.getOperatingCosts();
  assert.equal(resolved.totals['transfer-networkfee'].actual.knownMicroUsd,'500');
  assert.equal(resolved.totals['transfer-networkfee'].actual.unvaluedCount,1);
  assert.equal(resolved.totals['transfer-networkfee'].actual.unvaluedSolLamports,'5000');
  const after=f.ledger.state();
  assert.throws(()=>f.ledger.recordOperatingCost({...event,id:'valuation-b',recordedAt:AT+3000}),/idempotency conflict/);
  assert.deepEqual(f.ledger.recordOperatingCost(event,AT+4000),receipt);
  assert.deepEqual(f.ledger.state(),after);assert.deepEqual(f.ledger.getOperatingCosts(),resolved);
});

test('known SOL fees are valued once at incurrence while unvalued costs keep economic results unknown',t=>{
  const f=fixture(t),event={...sol('known-fee',AT+1000),valuation:price(AT+1000)};
  const receipt=f.ledger.recordOperatingCost(event);cover(f.ledger,AT+2000);
  const p=f.ledger.projection(AT+2000,price(AT+2000));
  assert.equal(p.operatingCostsMicroUsd,'500');assert.equal(p.economicPnlMicroUsd,'-500');
  assert.equal(f.ledger.state().lamports,'10000000000');
  assert.deepEqual(f.ledger.recordOperatingCost(event,AT+3000),receipt);
  f.ledger.recordOperatingCost(sol('unknown-fee',AT+3000));
  assert.equal(f.ledger.projection(AT+3000,price(AT+3000)).economicPnlMicroUsd,null);
});

test('principal funding, unsupported costs and wrong-account events cannot alter financial or cost history',t=>{
  const f=fixture(t),before=f.ledger.state();
  assert.throws(()=>f.ledger.recordOperatingCost({...usd(),category:'wallet-funding'} as never),/unsupported operating cost category/);
  assert.throws(()=>f.ledger.recordOperatingCost({...usd(),kind:'funding'} as never),/unsupported operating event/);
  assert.throws(()=>f.ledger.recordOperatingCost({...usd(),accountId:'fixture-other'}),/wrong account/);
  assert.deepEqual(f.ledger.state(),before);assert.ok(Object.values(f.ledger.getOperatingCosts().coverage).every(x=>x===null));
  assert.equal(f.ledger.exportJournal().length,1);
});

test('corrupt cost metadata is refused unchanged during reads and startup instead of resetting amounts',t=>{
  const f=fixture(t);f.ledger.recordOperatingCost(usd());
  const db=new Database(f.path);
  let corrupted:string;
  try{
    const row=db.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get() as {value:string};
    const costs=JSON.parse(row.value);costs.accountId='fixture-other';corrupted=JSON.stringify(costs);
    db.prepare("UPDATE metadata SET value=? WHERE key='operating_costs'").run(corrupted);
  }finally{db.close();}
  assert.throws(()=>f.ledger.getOperatingCosts(),/account\/inception/);
  assert.throws(()=>f.ledger.projection(AT+1000,price(AT+1000)),/account\/inception/);
  f.ledger.close();assert.throws(()=>new DisposableLedger(f.path,ACCOUNT),/account\/inception/);
  const check=new Database(f.path,{readonly:true,fileMustExist:true});
  try{assert.equal((check.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get() as {value:string}).value,corrupted);}finally{check.close();}
});

test('a missing cost projection with durable cost history is recovery failure, not a new unknown-default book',t=>{
  const f=fixture(t);f.ledger.recordOperatingCost(usd());const db=new Database(f.path);
  try{db.prepare("DELETE FROM metadata WHERE key='operating_costs'").run();}finally{db.close();}
  assert.throws(()=>f.ledger.getOperatingCosts(),/metadata missing from recorded history/);
  f.ledger.close();assert.throws(()=>new DisposableLedger(f.path,ACCOUNT),/metadata missing from recorded history/);
  const check=new Database(f.path,{readonly:true,fileMustExist:true});
  try{assert.equal(check.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get(),undefined);}finally{check.close();}
});

test('surviving valuation actions or journal rows also block silently replacing missing cost metadata',t=>{
  const f=fixture(t),original=sol();f.ledger.recordOperatingCost(original);
  f.ledger.recordOperatingCost({kind:'valuation',id:'valuation-only-survivor',accountId:ACCOUNT,recordedAt:AT+1000,evidence:'DISPOSABLE journal-backed valuation',expense:original,valuation:price(original.occurredAt)});
  const db=new Database(f.path);
  try{
    // Deliberate disposable corruption: retain only later valuation evidence.
    db.prepare("DELETE FROM metadata WHERE key='operating_costs'").run();
    db.prepare("DELETE FROM actions WHERE id>='cost:' AND id<'cost;'").run();
    assert.throws(()=>f.ledger.getOperatingCosts(),/metadata missing from recorded history/);
    db.prepare("DELETE FROM journal WHERE action_id>='cost:' AND action_id<'cost;'").run();
    assert.throws(()=>f.ledger.getOperatingCosts(),/metadata missing from recorded history/);
    db.prepare("DELETE FROM actions WHERE id>='cost-valuation:' AND id<'cost-valuation;'").run();
    assert.throws(()=>f.ledger.getOperatingCosts(),/metadata missing from recorded history/);
  }finally{db.close();}
  f.ledger.close();assert.throws(()=>new DisposableLedger(f.path,ACCOUNT),/metadata missing from recorded history/);
});
