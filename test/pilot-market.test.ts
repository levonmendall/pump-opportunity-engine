/** Retained real account bytes with synthetic timing and disposable accounting.
 * No network, production account, natural fill or economic edge is tested. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {PilotMarket} from '../src/pilot-market.js';
import type {PoolWireAccount} from '../src/pool.js';

const signal=()=>new AbortController().signal;
function fixture(t:TestContext){
  const runs=['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z'];
  const captures=runs.map(run=>{
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    return {proof,state:structuredClone(rows.find(row=>row.kind==='pool-state').data)};
  });
  let at=Date.parse(captures[1]!.proof.quote.validatedAt),slot=Math.max(...captures.map(c=>c.state.context.slot)),rentOffset=0;
  const oldNow=Date.now;Date.now=()=>at;
  const records:Array<{kind:string;data:any}>=[],calls:Array<{method:string;params:any[];at:number}>=[];let recordHook:((kind:string)=>void)|undefined;
  const accounts=new Map<string,PoolWireAccount>();
  for(const {state}of captures)for(let i=0;i<state.addresses.length;i++)accounts.set(state.addresses[i],state.value[i]);
  const root=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-pilot-market-')),path=join(root,'fixture.sqlite'),ledger=new DisposableLedger(path,'fixture-pilot-market-mechanics');
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE fixed USD snapshot'});
  ledger.initialize(price(),at);
  t.after(()=>{ledger.close();Date.now=oldNow;rmSync(root,{recursive:true,force:true});});
  let wait:Promise<void>|undefined;
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:structuredClone(params),at});
    if(wait){const pending=wait;wait=undefined;await pending;}
    if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0])+rentOffset)as T;
    if(method==='getBlockTime')return Math.floor(at/1000)as T;
    assert.equal(method,'getMultipleAccounts');
    const addresses=params[0] as string[],raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
    const clock:PoolWireAccount={data:[raw.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};
    return {context:{slot},value:addresses.map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(address)??null))}as T;
  },usage:()=>({calls:calls.length})};
  const market=new PilotMarket({rpc,inventory:()=>ledger.state(),price,now:()=>at,recorder:{record(kind,data){records.push({kind,data:structuredClone(data)});recordHook?.(kind);}},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE7k simulated network/priority cost'},timeoutMs:1000});
  for(const c of captures)market.registerPool({mint:c.proof.quote.mint,migrationVerified:true,migrationSlot:c.proof.origin.slot,evidence:'retained actual migration; synthetic current timing'});
  const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1000,context:s=>market.context(ledger.state().positions,s),quote:market.executionQuote});
  coordinator.recover();ledger.reconcile('initial-reconcile',at,price(),{});ledger.resume('fixture-ready',at,price(),{},{version:'isolated-pilot-market-fixture',evidence:'synthetic readiness for market/ledger mechanics only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  return {captures,ledger,market,coordinator,price,calls,records,now:()=>at,advance:(ms:number)=>{at+=ms;},rentChanged:()=>{rentOffset++;},bumpSlot:()=>{slot++;},pause:(p:Promise<void>)=>{wait=p;},onRecord:(hook:(kind:string)=>void)=>{recordHook=hook;}};
}

test('fresh supported account lengths and current rent define deposits; every entry repeats rent checks',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;
  const plan=await f.market.prepareEntryCosts(mint,signal());
  assert.deepEqual(plan.accountLengths,{base:170,quote:165});
  assert.equal(plan.depositLamports,'2000335');assert.equal(plan.accountPlan.baseExists,false);assert.equal(plan.accountPlan.quoteExists,false);
  assert.deepEqual(f.calls.map(c=>c.method),['getMultipleAccounts','getMultipleAccounts','getBlockTime','getMinimumBalanceForRentExemption','getMinimumBalanceForRentExemption']);
  const q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  assert.equal(q.requiredDepositLamports,plan.depositLamports);assert.match(q.depositEvidence!,/^pilot-entry-validated-costs:/);
  assert.equal(f.calls.length,10);assert.equal(q.outputUnits,f.captures[1]!.proof.quote.buy.outputBaseUnits);
  // A sizing plan can remain old, but every used quote still reads current rent.
  f.advance(10001);const newer=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(newer);assert.equal(newer.at,f.now());assert.equal(f.calls.length,15);
  f.rentChanged();assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);
  assert.equal(f.ledger.state().lockedDeposits[mint],undefined);assert.equal(Object.keys(f.ledger.state().positions).length,0);
});

test('real decoder quotes complete a disposable delayed buy and full-size exit with rent retained once',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,initial=f.ledger.state();
  const plan=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  const order={id:'buy:fixture',side:'buy' as const,mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:q.outputUnits,decisionEvidence:q.evidence};
  f.coordinator.reserve(order,{price:f.price(),marks:{}});
  // No pre-delay fill and no use of the original estimate as future execution.
  assert.equal(await f.market.executionQuote({order:f.ledger.state().pending[order.id]!,attemptedAt:f.now(),fullPositionBaseUnits:null},signal()),null);
  const before=f.calls.length;f.advance(1000);const filled=await f.coordinator.runDue();assert.equal(filled.results[0]!.status,'filled');assert.equal(f.calls.length-before,5);
  const position=f.ledger.state().positions[mint]!;assert.equal(position.units,q.outputUnits);assert.equal(position.deposit,plan.depositLamports);assert.equal(f.ledger.state().lockedDeposits[mint],plan.depositLamports);
  const context=await f.market.context(f.ledger.state().positions,signal()),sell=await f.market.quote({mint,side:'sell',inputUnits:position.units},signal());assert.ok(sell);
  assert.equal(context.marks[mint]!.netLamports,(BigInt(sell.outputUnits)-7000n).toString());assert.equal(sell.refundedDepositLamports,undefined);
  f.coordinator.reserve({id:'sell:fixture',side:'sell',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:sell.outputUnits,decisionEvidence:sell.evidence},context);
  const beforeExit=f.calls.length;f.advance(1000);const exited=await f.coordinator.runDue();assert.equal(exited.results[0]!.status,'filled');assert.equal(f.calls.length-beforeExit,1);
  const end=f.ledger.state();assert.deepEqual(end.positions,{});assert.deepEqual(end.pending,{});assert.equal(end.executionCosts,'14000');assert.equal(end.lockedDeposits[mint],plan.depositLamports);
  const pnl=BigInt(sell.outputUnits)-10000000n-14000n;
  assert.equal(end.realizedLamports,pnl.toString());assert.equal(BigInt(end.lamports)+BigInt(end.lockedDeposits[mint]!)-BigInt(initial.lamports),pnl);assert.equal(end.inceptionAt,initial.inceptionAt);
  const beforeExisting=f.calls.length,existing=await f.market.prepareEntryCosts(mint,signal());assert.equal(existing.depositLamports,'0');assert.equal(existing.accountPlan.baseExists,true);assert.equal(existing.accountPlan.quoteExists,true);assert.equal(f.calls.length-beforeExisting,3);
});

test('changed rent, unknown account plan, cancellation and invalidation refuse entry without changing account',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,before=f.ledger.state();
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,0);
  await f.market.prepareEntryCosts(mint,signal());f.market.invalidate('isolated gap; existing account unchanged');const count=f.calls.length;
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,count);
  const controller=new AbortController();controller.abort();assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},controller.signal),null);
  assert.deepEqual(f.ledger.state(),before);
  // Concurrent context cannot create a second physical read behind preparation.
  let release!:()=>void;f.pause(new Promise<void>(resolve=>{release=resolve;}));const pending=f.market.prepareEntryCosts(mint,signal());await Promise.resolve();const during=f.calls.length;
  assert.deepEqual(await f.market.context({},signal()),{price:null,marks:{}});assert.equal(f.calls.length,during);f.market.invalidate('gap during preparation');release();await assert.rejects(pending,/PREPARATION_CHANGED_OR_STALE/);assert.deepEqual(f.ledger.state(),before);
});

test('post-delay buy source carries its actual slot and refuses changed rent or delayed evidence',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal()),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  f.coordinator.reserve({id:'due-buy',side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},{price:f.price(),marks:{}});
  f.advance(1000);const order=f.ledger.state().pending['due-buy']!,before=f.ledger.state();
  const request=()=>({order,attemptedAt:f.now(),fullPositionBaseUnits:null,minSlot:q.slot});
  const ready=await f.market.executionQuote(request(),signal());assert.ok(ready);assert.equal(ready.slot,q.slot);assert.equal(ready.requiredDepositLamports,order.deposit);assert.match(ready.depositEvidence!,/^pilot-execution-validated-costs:/);
  f.onRecord(kind=>{if(kind==='research-held-market-delegated-entry')f.advance(2001);});
  assert.equal(await f.market.executionQuote(request(),signal()),null);assert.deepEqual(f.ledger.state(),before);
  f.onRecord(()=>{});f.rentChanged();assert.equal(await f.market.executionQuote(request(),signal()),null);assert.deepEqual(f.ledger.state(),before);
});

test('a newer known flow slot arriving during entry pricing prevents an older result from being used',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;
  const plan=await f.market.prepareEntryCosts(mint,signal());let release!:()=>void;
  f.pause(new Promise<void>(resolve=>{release=resolve;}));
  const pending=f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());await Promise.resolve();await Promise.resolve();
  f.market.minimumSlot(mint,plan.sourceSlot+1);release();assert.equal(await pending,null);
  assert.equal(Object.keys(f.ledger.state().positions).length,0);
});
