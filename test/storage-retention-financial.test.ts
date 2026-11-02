import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,type Order} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {FinancialRetentionIndex} from '../src/storage-retention.js';

const AT=Date.parse('2026-10-26T12:00:00Z');
const price={microUsdPerSol:'100000000',at:AT,source:'DISPOSABLE retention fixture'};
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'poe-retention-financial-'));
 const ledger=new DisposableLedger(join(dir,'ledger.sqlite'),'fixture-retention');ledger.initialize(price,AT);
 const ready=()=>{ledger.reconcile('reconcile:'+ledger.state().revision,AT,price,{});ledger.resume('resume:'+ledger.state().revision,AT,price,{}, {version:'fixture',evidence:'DISPOSABLE retention only',marketAt:AT,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});};
 return {ledger,ready,close:()=>{ledger.close();rmSync(dir,{recursive:true,force:true});}};
}
function order(id:string,mint:string):Omit<Order,'reserved'|'allocation'>{return {id,mint,side:'buy',decidedAt:AT,executeAt:AT+500,expiresAt:AT+2000,gas:'10000',deposit:'0',maxSpend:'100000000',minReceive:'100',decisionEvidence:'DISPOSABLE entry proof'};}

test('retention indexes all durable orders, including failed fees outside the reporting window, without financial writes',()=>{
 const f=fixture();try{
  f.ready();f.ledger.order(order('old-order','fee-token'),price,{});
  f.ledger.attempt('execution-attempt:old-order','old-order',AT+500,null,{...price,at:AT+500},{});
  for(let i=0;i<1100;i++)f.ledger.reconcile('later:'+i,AT+500,{...price,at:AT+500},{});
  const before=JSON.stringify(f.ledger.state()),index=new FinancialRetentionIndex();
  assert.equal(index.ready(),false);index.bootstrap(f.ledger);
  assert.equal(index.ready(),true);assert.equal(index.protectedMints(f.ledger.state()).has('fee-token'),true);
  assert.equal(index.status().financialOrdersIndexed,1);assert.equal(JSON.stringify(f.ledger.state()),before);
  const restart=new FinancialRetentionIndex();restart.bootstrap(f.ledger);assert.equal(restart.protectedMints(f.ledger.state()).has('fee-token'),true);
 }finally{f.close();}
});

test('retention remains disabled through partial history and protects newly reserved IDs that sort behind the cursor',()=>{
 const f=fixture();try{
  const index=new FinancialRetentionIndex();let calls=0;
  const source={retentionOrderReferences:()=>++calls===1?{after:'order:z',complete:false,mints:['historical'],orders:128}:{after:'order:zz',complete:true,mints:['later-historical'],orders:1}};
  index.bootstrap(source);assert.equal(index.ready(),false);index.protect('new-before-cursor');index.bootstrap(source);
  assert.equal(index.ready(),true);const protectedMints=index.protectedMints(f.ledger.state(),['active-proof']);for(const mint of ['active-proof','historical','later-historical','new-before-cursor'])assert.equal(protectedMints.has(mint),true);assert.equal(protectedMints.has('unused'),false);
 }finally{f.close();}
});

test('unavailable financial reference history disables expiry without changing the financial state',()=>{
 const f=fixture();try{const before=JSON.stringify(f.ledger.state()),index=new FinancialRetentionIndex();index.bootstrap({retentionOrderReferences:()=>{throw Error('incomplete history');}});assert.equal(index.ready(),false);assert.equal(index.status().reason,'FINANCIAL_REFERENCE_HISTORY_UNAVAILABLE');assert.equal(JSON.stringify(f.ledger.state()),before);index.bootstrap(f.ledger);assert.equal(index.ready(),true);assert.equal(index.status().reason,null);}finally{f.close();}
});

test('entry proof promotion precedes the durable reservation and failed promotion cannot create an order',()=>{
 const f=fixture();try{
  let allow=false,seen=0;
  const execution=new PaperExecutionCoordinator({ledger:f.ledger,now:()=>AT,context:async()=>({price,marks:{}}),quote:async()=>null,beforeEntryReservation:o=>{seen++;assert.equal(f.ledger.actionResult('order:'+o.id),undefined);if(!allow)throw Error('proof unavailable');}});
  execution.recover();f.ready();const before=JSON.stringify(f.ledger.state());
  assert.throws(()=>execution.reserve(order('new','new-token'),{price,marks:{}}),/proof unavailable/);assert.equal(JSON.stringify(f.ledger.state()),before);assert.equal(f.ledger.actionResult('order:new'),undefined);
  allow=true;assert.ok('reserved' in execution.reserve(order('new','new-token'),{price,marks:{}}));assert.equal(seen,2);assert.ok(f.ledger.state().pending.new);
 }finally{f.close();}
});

test('reference traversal is bounded and validates cursor inputs',()=>{const f=fixture();try{assert.throws(()=>f.ledger.retentionOrderReferences('inception'),/BOUND/);assert.throws(()=>f.ledger.retentionOrderReferences('order:',129),/BOUND/);assert.deepEqual(f.ledger.retentionOrderReferences(),{after:'order:',complete:true,mints:[],orders:0});}finally{f.close();}});
