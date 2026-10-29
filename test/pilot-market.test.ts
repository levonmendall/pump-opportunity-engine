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
function fixture(t:TestContext,timeoutMs=1000,cooperative=false){
  const runs=['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z'];
  const captures=runs.map(run=>{
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    return {proof,state:structuredClone(rows.find(row=>row.kind==='pool-state').data)};
  });
  let at=Date.parse(captures[1]!.proof.quote.validatedAt),slot=Math.max(...captures.map(c=>c.state.context.slot)),rentOffset=0;
  const oldNow=Date.now;Date.now=()=>at;
  const records:Array<{kind:string;data:any}>=[],calls:Array<{method:string;params:any[];at:number}>=[];let recordHook:((kind:string)=>void)|undefined,preparationHook:((input:{method:string;signal:AbortSignal})=>Promise<void>)|undefined;
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
  const market=new PilotMarket({rpc,inventory:()=>ledger.state(),price,now:()=>at,recorder:{record(kind,data){records.push({kind,data:structuredClone(data)});recordHook?.(kind);}},...(cooperative?{beforeEntryPreparationRead:async(input:{method:string;signal:AbortSignal})=>{await preparationHook?.(input);}}:{}),gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE7k simulated network/priority cost'},timeoutMs});
  for(const c of captures)market.registerPool({mint:c.proof.quote.mint,migrationVerified:true,migrationSlot:c.proof.origin.slot,evidence:'retained actual migration; synthetic current timing'});
  const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1000,context:s=>market.context(ledger.state().positions,s),quote:market.executionQuote});
  coordinator.recover();ledger.reconcile('initial-reconcile',at,price(),{});ledger.resume('fixture-ready',at,price(),{},{version:'isolated-pilot-market-fixture',evidence:'synthetic readiness for market/ledger mechanics only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  return {captures,ledger,market,coordinator,price,calls,records,now:()=>at,advance:(ms:number)=>{at+=ms;},rentChanged:()=>{rentOffset++;},bumpSlot:()=>{slot++;},slot:()=>slot,setSlot:(value:number)=>{slot=value;},pause:(p:Promise<void>)=>{wait=p;},account:(address:string)=>accounts.get(address),onRecord:(hook:(kind:string)=>void)=>{recordHook=hook;},beforePreparationRead:(hook:(input:{method:string;signal:AbortSignal})=>Promise<void>)=>{preparationHook=hook;}};
}

test('fresh supported account lengths and current rent define deposits; every entry repeats rent checks',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;
  const plan=await f.market.prepareEntryCosts(mint,signal());
  assert.deepEqual(plan.accountLengths,{base:170,quote:165});
  assert.equal(plan.depositLamports,'2000335');assert.equal(plan.accountPlan.baseExists,false);assert.equal(plan.accountPlan.quoteExists,false);
  assert.deepEqual(f.calls.map(c=>c.method),['getMultipleAccounts','getMultipleAccounts','getMinimumBalanceForRentExemption','getMinimumBalanceForRentExemption']);
  const q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);
  assert.equal(q.requiredDepositLamports,plan.depositLamports);assert.match(q.depositEvidence!,/^pilot-entry-validated-costs:/);
  assert.equal(f.calls.length,7);assert.equal(q.outputUnits,f.captures[1]!.proof.quote.buy.outputBaseUnits);
  // A sizing plan can remain old, but every used quote still reads current rent.
  f.advance(10001);const newer=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(newer);assert.equal(newer.at,f.now());assert.equal(f.calls.length,10);
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
  const before=f.calls.length;f.advance(1000);const filled=await f.coordinator.runDue();assert.equal(filled.results[0]!.status,'filled');assert.equal(f.calls.length-before,3);
  const position=f.ledger.state().positions[mint]!;assert.equal(position.units,q.outputUnits);assert.equal(position.deposit,plan.depositLamports);assert.equal(f.ledger.state().lockedDeposits[mint],plan.depositLamports);
  const context=await f.market.context(f.ledger.state().positions,signal()),sell=await f.market.quote({mint,side:'sell',inputUnits:position.units},signal());assert.ok(sell);
  assert.equal(context.marks[mint]!.netLamports,(BigInt(sell.outputUnits)-7000n).toString());assert.equal(sell.refundedDepositLamports,undefined);
  f.coordinator.reserve({id:'sell:fixture',side:'sell',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:sell.outputUnits,decisionEvidence:sell.evidence},context);
  const beforeExit=f.calls.length;f.advance(1000);const exited=await f.coordinator.runDue();assert.equal(exited.results[0]!.status,'filled');assert.equal(f.calls.length-beforeExit,1);
  const end=f.ledger.state();assert.deepEqual(end.positions,{});assert.deepEqual(end.pending,{});assert.equal(end.executionCosts,'14000');assert.equal(end.lockedDeposits[mint],plan.depositLamports);
  const pnl=BigInt(sell.outputUnits)-10000000n-14000n;
  assert.equal(end.realizedLamports,pnl.toString());assert.equal(BigInt(end.lamports)+BigInt(end.lockedDeposits[mint]!)-BigInt(initial.lamports),pnl);assert.equal(end.inceptionAt,initial.inceptionAt);
  const beforeExisting=f.calls.length,existing=await f.market.prepareEntryCosts(mint,signal());assert.equal(existing.depositLamports,'0');assert.equal(existing.accountPlan.baseExists,true);assert.equal(existing.accountPlan.quoteExists,true);assert.equal(f.calls.length-beforeExisting,1);
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


test('candidate-only support uses unchanged current state validation without rent or an entry plan',async t=>{
  const f=fixture(t),capture=f.captures[1]!,mint=capture.proof.quote.mint,before=f.ledger.state();
  const result=await f.market.validateObservationPool(mint,signal());
  assert.equal(result.mint,mint);assert.equal(result.sourceSlot,capture.state.context.slot);assert.equal(result.at,f.now());assert.match(result.evidence,/^pilot-observation-support:/);
  assert.deepEqual(f.calls.map(c=>c.method),['getMultipleAccounts','getMultipleAccounts','getBlockTime']);
  assert.equal(f.records.filter(r=>r.kind==='pilot-entry-cost-preparation').length,0);
  assert.equal(f.records.filter(r=>r.kind==='pilot-observation-support-validation').length,1);
  const calls=f.calls.length;
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null,'observation proof cannot substitute for a financial deposit plan');
  assert.equal(f.calls.length,calls);assert.deepEqual(f.ledger.state(),before);
});

test('candidate-only support retains mint, pool, vault and fee-owner checks',async t=>{
  const f=fixture(t),capture=f.captures[1]!,mint=capture.proof.quote.mint;
  // The selected address indices are the retained decoder's pool/config/fee/
  // mint/quote-mint/base-vault/quote-vault dependency order.
  for(const index of [0,2,3,5]){
    const address=capture.state.addresses[index]!,wire=f.account(address)!;assert.ok(wire);
    const owner=wire.owner;wire.owner='11111111111111111111111111111111';
    await assert.rejects(f.market.validateObservationPool(mint,signal()));wire.owner=owner;
  }
  assert.equal(f.calls.some(c=>c.method==='getMinimumBalanceForRentExemption'),false);
  assert.equal(f.records.some(r=>r.kind==='pilot-observation-support-validation'),false);
});

test('candidate-only support refuses stale records, invalidation, newer slot floors and cancellation',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;
  f.onRecord(kind=>{if(kind==='size-specific-quote')f.advance(2001);});
  await assert.rejects(f.market.validateObservationPool(mint,signal()),/PREPARATION_CHANGED_OR_STALE/);
  f.onRecord(kind=>{if(kind==='size-specific-quote')f.market.invalidate('candidate support changed during validation');});
  await assert.rejects(f.market.validateObservationPool(mint,signal()),/PREPARATION_CHANGED_OR_STALE/);
  f.onRecord(kind=>{if(kind==='size-specific-quote')f.market.minimumSlot(mint,f.captures[1]!.state.context.slot+1);});
  await assert.rejects(f.market.validateObservationPool(mint,signal()),/PREPARATION_CHANGED_OR_STALE/);
  f.onRecord(()=>{});const controller=new AbortController();controller.abort();const calls=f.calls.length;
  await assert.rejects(f.market.validateObservationPool(mint,controller.signal),/PREPARATION_UNAVAILABLE/);assert.equal(f.calls.length,calls);
  assert.equal(f.calls.some(c=>c.method==='getMinimumBalanceForRentExemption'),false);
});


test('coherent entry preparation and quote leave held dependency links warm and read every rent again',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal());
  const before=f.calls.length;await f.market.context({},signal());
  const quote=await f.market.quote({mint,side:'buy',inputUnits:'50000000',requiredDepositLamports:plan.depositLamports},signal());assert.ok(quote);
  assert.equal(f.calls.length-before,3);assert.equal(quote.inputUnits,'50000000');assert.equal(quote.requiredDepositLamports,plan.depositLamports);
  assert.equal(f.calls.filter(c=>c.method==='getMinimumBalanceForRentExemption').length,4);
  assert.equal(f.calls.some(c=>c.method==='getBlockTime'),false);
  const source=f.records.findLast(r=>r.kind==='rpc-market-quote')!.data.source;
  assert.equal(source.timeEvidence,'confirmed-bank-clock');assert.equal(source.clockSlot,quote.slot);assert.equal('marketBlockTime' in source,false);
});

test('a slow final recorder cannot refresh an earlier Clock buy into a valid decision or change accounting',async t=>{
  const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state();
  f.onRecord(kind=>{if(kind==='rpc-market-quote')f.advance(2001);});
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.deepEqual(f.ledger.state(),before);
});

test('a timed-out uncooperative buy read retains market ownership until physical work settles',async t=>{
  const f=fixture(t,20),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());
  let release!:()=>void;f.pause(new Promise<void>(r=>{release=r;}));
  const pending=f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.equal(await pending,null);
  const calls=f.calls.length;assert.deepEqual(await f.market.context({},signal()),{price:null,marks:{}});
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,calls);
  assert.throws(()=>f.market.unregisterPool(mint),/READ_IN_FLIGHT/);release();await new Promise<void>(r=>setImmediate(r));
  assert.ok(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()));
});

test('entry preparation can yield between real SDK reads to fresh whole-inventory pricing without reentrant entry work',async t=>{
  const f=fixture(t,1000,true),block=signal();
  for(const [i,c]of f.captures.entries()){
    const mint=c.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,block),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},block);assert.ok(q);
    const prior=await f.market.context(f.ledger.state().positions,block);
    f.coordinator.reserve({id:'yield-buy:'+i,side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},prior);
    f.advance(1000);assert.equal((await f.coordinator.runDue()).results[0]!.status,'filled');
  }
  const inventory=f.ledger.state().positions;assert.equal(Object.keys(inventory).length,2);
  await f.market.context(inventory,block);const before=structuredClone(f.ledger.state()),seen:string[]=[];
  f.beforePreparationRead(async({method,signal})=>{
    seen.push(method);f.advance(1000);const calls=f.calls.length,current=await f.market.context(inventory,signal);
    assert.equal(f.calls.length-calls,1,'both actual-size holdings use one warm coherent batch');
    for(const [mint,p]of Object.entries(inventory)){assert.equal(current.marks[mint]!.pricedBaseUnits,p.units);assert.equal(current.marks[mint]!.at,f.now());}
    assert.equal(await f.market.quote({mint:f.captures[0]!.proof.quote.mint,side:'buy',inputUnits:'1'},signal),null,'yield does not grant a concurrent entry read');
  });
  await f.market.prepareEntryCosts(f.captures[0]!.proof.quote.mint,block);
  assert.ok(seen.length>=1);assert.deepEqual(f.ledger.state(),before,'pricing/yield never creates an order or changes financial state');
  const yields=seen.length;assert.ok(await f.market.quote({mint:f.captures[0]!.proof.quote.mint,side:'buy',inputUnits:'10000000'},block));
  assert.equal(seen.length,yields,'decision/execution entry quotes cannot reenter a trader protection tick through the preparation hook');
});

test('whole preparation timeout retains uncooperative physical ownership and cannot publish a late plan',async t=>{
  const f=fixture(t,25),mint=f.captures[1]!.proof.quote.mint;let release!:()=>void;
  f.pause(new Promise<void>(resolve=>{release=resolve;}));
  await assert.rejects(f.market.prepareEntryCosts(mint,signal(),{maximumMs:20}),/PREPARATION_ABORTED/);
  assert.equal(f.market.retirementReady(),false);
  const calls=f.calls.length;assert.throws(()=>f.market.unregisterPool(mint),/READ_IN_FLIGHT/);
  await assert.rejects(f.market.prepareEntryCosts(mint,signal()),/PREPARATION_UNAVAILABLE/);
  assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length,calls);
  release();await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(f.market.retirementReady(),true);
  assert.equal(f.market.usage().preparedEntryCostPlans,0,'late settled work cannot become a usable plan');
  const plan=await f.market.prepareEntryCosts(mint,signal(),{maximumMs:1000});assert.ok(plan);assert.equal(f.market.usage().preparedEntryCostPlans,1);
  assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});
});

test('cancellation at a preparation yield prevents the next physical request and cannot create a plan',async t=>{
 const f=fixture(t,1000,true),controller=new AbortController(),mint=f.captures[1]!.proof.quote.mint,before=f.ledger.state();
 f.beforePreparationRead(async()=>{controller.abort();});
 await assert.rejects(f.market.prepareEntryCosts(mint,controller.signal),/PREPARATION_ABORTED|aborted/);
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,0);assert.equal(f.market.retirementReady(),true);assert.equal(f.market.usage().preparedEntryCostPlans,0);assert.deepEqual(f.ledger.state(),before);
});

test('an unrelated candidate bank cannot raise a holding slot floor; the holding own known floor remains mandatory',async t=>{
  const f=fixture(t),mint=f.captures[0]!.proof.quote.mint,other=f.captures[1]!.proof.quote.mint,block=signal();
  const plan=await f.market.prepareEntryCosts(mint,block),q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},block);assert.ok(q);
  f.coordinator.reserve({id:'bank-separated-buy',side:'buy',mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:'1',decisionEvidence:q.evidence},{price:f.price(),marks:{}});
  f.advance(1000);assert.equal((await f.coordinator.runDue()).results[0]!.status,'filled');
  const inventory=f.ledger.state().positions,heldSlot=f.slot();assert.ok((await f.market.context(inventory,block)).marks[mint]);
  f.setSlot(heldSlot+100);await f.market.prepareEntryCosts(other,block);assert.equal(f.market.usage().entryPricing.highestVerifiedSlot,heldSlot+100);
  // Synthetic independently responding banks: holding data is no older than
  // any fact previously accepted for THIS holding and keeps a fresh Clock.
  f.setSlot(heldSlot);const context=await f.market.context(inventory,block);assert.equal(context.marks[mint]!.pricedBaseUnits,inventory[mint]!.units);
  assert.equal(f.market.usage().held.highestVerifiedSlot,heldSlot);
  f.market.minimumSlot(mint,heldSlot+1);assert.deepEqual((await f.market.context(inventory,block)).marks,{});
  assert.equal(f.market.usage().holdingDiagnostics.lastContext!.reasonCode,'HELD_PRICING_SLOT_UNAVAILABLE');
});
