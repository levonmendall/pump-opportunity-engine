/** Disposable scoped financial cancellation/idempotency; no runtime/network. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger} from '../src/ledger.js';
const AT=Date.parse('2026-10-27T12:00:00Z');
test('mint-scoped entry cancellation is durable, idempotent and cannot remove unrelated entries or exits',t=>{
  const directory=mkdtempSync(join(tmpdir(),'poe-fixture-scoped-cancel-')),ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-scoped-cancel');t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
  const price=(at:number)=>({microUsdPerSol:'100000000',at,source:'ISOLATED fixed USD'}),buy=(id:string,mint:string,at:number)=>({id,side:'buy' as const,mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'ISOLATED fixture'});
  ledger.initialize(price(AT),AT);ledger.reconcile('ready',AT,price(AT),{});ledger.order(buy('held','held',AT),price(AT),{});ledger.attempt('fill-held','held',AT+1000,{at:AT+1000,spendLamports:'10000000',receiveUnits:'1000',evidence:'ISOLATED fixture'},price(AT+1000));
  const at=AT+1000,marks={held:{at,pricedBaseUnits:'1000',netLamports:'10000000',evidence:'ISOLATED actual-size net mark'}};ledger.reconcile('fresh',at,price(at),marks);
  ledger.order(buy('target-buy','target',at),price(at),marks);ledger.order(buy('other-buy','other',at),price(at),marks);ledger.order({id:'owned-exit',side:'sell',mint:'held',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'ISOLATED exit'},price(at),marks);
  const before=ledger.state(),result=ledger.cancelEntryOrders('scoped',at,'ISOLATED target gap','target'),after=ledger.state();assert.deepEqual(result,{canceledEntries:['target-buy'],preservedExitOrders:['owned-exit']});assert.equal(after.pending['target-buy'],undefined);assert.deepEqual(after.pending['other-buy'],before.pending['other-buy']);assert.deepEqual(after.pending['owned-exit'],before.pending['owned-exit']);assert.deepEqual(after.positions,before.positions);assert.equal(after.lamports,before.lamports);assert.equal(after.executionCosts,before.executionCosts);assert.deepEqual(ledger.cancelEntryOrders('scoped',at,'ISOLATED target gap','target'),result);assert.deepEqual(ledger.state(),after);
  assert.throws(()=>ledger.cancelEntryOrders('scoped',at,'ISOLATED target gap','other'),/idempotency conflict/);assert.deepEqual(ledger.state(),after);assert.throws(()=>ledger.cancelEntryOrders('bad',at,'ISOLATED reason',''),/cancellation mint/);
  const legacy=ledger.cancelEntryOrders('legacy',at,'ISOLATED whole feed gap');assert.deepEqual(legacy,{canceledEntries:['other-buy'],preservedExitOrders:['owned-exit']});assert.deepEqual(ledger.cancelEntryOrders('legacy',at,'ISOLATED whole feed gap'),legacy);assert.ok(ledger.state().pending['owned-exit']);assert.equal(ledger.state().inceptionAt,AT);
});
