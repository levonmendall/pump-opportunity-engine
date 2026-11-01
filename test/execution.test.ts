import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {DisposableLedger,type ExecutionQuote,type Mark,type Order,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator,type ExecutionContext,type ExecutionOptions} from '../src/execution.js';

const AT=Date.parse('2026-10-26T12:00:00Z');
const price=(at:number):UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE execution USD fixture'});
const buy=(id:string,at=AT,mint='fixture-mint'):Omit<Order,'reserved'>=>({id,side:'buy',mint,decidedAt:at,executeAt:at+500,expiresAt:at+2000,gas:'10000',deposit:'2000000',maxSpend:'490000000',minReceive:'100',decisionEvidence:'DISPOSABLE size-specific decision'});
const sell=(id:string,at=AT+600,mint='fixture-mint'):Omit<Order,'reserved'>=>({id,side:'sell',mint,decidedAt:at,executeAt:at+500,expiresAt:at+2400,gas:'10000',deposit:'0',maxSpend:'0',minReceive:'470000000',decisionEvidence:'DISPOSABLE full-position exit'});
function fixture(t:TestContext){
  const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-execution-')),path=join(directory,'fixture.sqlite');let at=AT;
  const ledger=new DisposableLedger(path,'fixture-execution');ledger.initialize(price(at),at);
  const ledgers=[ledger];
  t.after(()=>{for(const l of ledgers){try{l.close();}catch{}}rmSync(directory,{recursive:true,force:true});});
  const context=(l=ledger):ExecutionContext=>({price:price(at),marks:Object.fromEntries(Object.values(l.state().positions).map(p=>[p.mint,{netLamports:'470000000',pricedBaseUnits:p.units,at,evidence:'DISPOSABLE actual-size liquidation'} satisfies Mark]))});
  function ready(l=ledger){l.reconcile('fixture-reconcile:'+l.state().revision,at,price(at),context(l).marks);assert.equal(l.resume('fixture-ready:'+l.state().revision,at,price(at),context(l).marks,{version:'fixture-readiness',evidence:'DISPOSABLE only; no verified live flow',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,true);}
  const quote:ExecutionOptions['quote']=async request=>request.order.side==='buy'
    ?{at,spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE first supported buy state'}
    :{at,spendLamports:'0',receiveUnits:'500000000',pricedBaseUnits:request.fullPositionBaseUnits!,refundedDepositLamports:'2000000',refundEvidence:'DISPOSABLE modeled atomic close',evidence:'DISPOSABLE actual-size sell state'};
  const create=(options:Partial<Omit<ExecutionOptions,'ledger'|'now'>>={},l=ledger)=>new PaperExecutionCoordinator({ledger:l,now:()=>at,context:async()=>context(l),quote,timeoutMs:100,...options});
  return {ledger,path,ledgers,context,ready,create,now:()=>at,set:(next:number)=>{at=next;}};
}

test('recovery closes entries; delayed first buy and full-size sell complete on the existing writer only',async t=>{
  const f=fixture(t);let quotes=0;const sizes:(string|null)[]=[];
  const coordinator=f.create({quote:async request=>{quotes++;sizes.push(request.fullPositionBaseUnits);return request.order.side==='buy'?{at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE buy'}:{at:f.now(),spendLamports:'0',receiveUnits:'500000000',pricedBaseUnits:request.fullPositionBaseUnits!,refundedDepositLamports:'2000000',refundEvidence:'DISPOSABLE atomic close',evidence:'DISPOSABLE sell'};}});
  assert.throws(()=>coordinator.reserve(buy('early'),f.context()),/recovery/);
  coordinator.recover();assert.equal(f.ledger.state().controls.entriesEnabled,false);f.ready();
  assert.ok('reserved' in coordinator.reserve(buy('buy'),f.context()));assert.equal(coordinator.nextDueAt(),AT+500);
  f.set(AT+499);assert.deepEqual((await coordinator.runDue()).results,[]);assert.equal(quotes,0);
  f.set(AT+500);assert.equal((await coordinator.runDue()).results[0]!.status,'filled');assert.equal(f.ledger.state().positions['fixture-mint']!.units,'1000');
  f.set(AT+600);coordinator.reserve(sell('sell'),f.context());f.set(AT+1100);
  assert.equal((await coordinator.runDue()).results[0]!.status,'filled');assert.deepEqual(sizes,[null,'1000']);
  assert.equal(f.ledger.state().lamports,'10019980000');assert.equal(f.ledger.state().executionCosts,'20000');
  assert.equal(f.ledger.state().inceptionAt,AT);assert.deepEqual(f.ledger.state().positions,{});assert.equal(coordinator.nextDueAt(),null);
  assert.deepEqual((await coordinator.runDue()).results,[]);assert.equal(quotes,2);
});

test('concurrent drains coalesce and no SQLite write transaction crosses an asynchronous quote',async t=>{
  const f=fixture(t);let quoteCalls=0;let release!:(value:ExecutionQuote)=>void,started!:()=>void;
  const signalStarted=new Promise<void>(resolve=>{started=resolve;});
  const coordinator=f.create({timeoutMs:1000,quote:async()=>{quoteCalls++;started();return new Promise(resolve=>{release=resolve;});}});
  coordinator.recover();f.ready();coordinator.reserve(buy('deferred'),f.context());f.set(AT+500);
  const first=coordinator.runDue();await signalStarted;assert.equal(coordinator.runDue(),first);
  assert.throws(()=>new DisposableLedger(f.path,'fixture-execution'),/locked/);
  const probe=new Database(f.path,{fileMustExist:true,timeout:100});
  try{probe.exec('BEGIN IMMEDIATE; ROLLBACK');assert.equal(probe.pragma('locking_mode',{simple:true}),'normal');}finally{probe.close();}
  release({at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE first state'});
  assert.equal((await first).results[0]!.status,'filled');assert.equal(quoteCalls,1);
});

test('future and already-expired decisions cannot reserve cash or move the financial clock',t=>{
  const f=fixture(t),coordinator=f.create();coordinator.recover();f.ready();const before=f.ledger.state();
  assert.throws(()=>coordinator.reserve(buy('future',AT+10_000),{price:price(AT+10_000),marks:{}}),/future information/);
  assert.deepEqual(f.ledger.state(),before);
  f.set(AT+2000);assert.throws(()=>coordinator.reserve(buy('expired'),f.context()),/nonexpired decision/);
  assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.ledger.state().pending,{});
});

test('timeout fails once, ignores late favorable state and prevents an uncanceled adapter backlog',async t=>{
  const f=fixture(t);let calls=0,aborted=false;let release!:(value:ExecutionQuote)=>void;
  const coordinator=f.create({timeoutMs:15,quote:async(_request,signal)=>{calls++;signal.addEventListener('abort',()=>{aborted=true;});return new Promise(resolve=>{release=resolve;});}});
  coordinator.recover();f.ready();coordinator.reserve(buy('timeout'),f.context());f.set(AT+500);
  const result=await coordinator.runDue();assert.equal(result.results[0]!.status,'failed');assert.equal(result.adapterBlocked,true);assert.equal(aborted,true);
  assert.equal(f.ledger.state().executionCosts,'10000');assert.equal(f.ledger.state().lamports,'9999990000');
  assert.throws(()=>coordinator.reserve(buy('new',f.now(),'other'),f.context()),/adapter unavailable/);
  assert.deepEqual((await coordinator.runDue()).results,[]);assert.equal(calls,1);
  release({at:f.now(),spendLamports:'1',receiveUnits:'999999',evidence:'DISPOSABLE late favorable state'});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().executionCosts,'10000');
});

test('missing USD cancels entry before quote/gas while an expired order cannot request or fill state',async t=>{
  const f=fixture(t);let requests=0;
  const coordinator=f.create({context:async()=>({price:null,marks:{}}),quote:async()=>{requests++;return null;}});
  coordinator.recover();f.ready();coordinator.reserve(buy('missing-usd'),f.context());f.set(AT+500);
  const missing=(await coordinator.runDue()).results[0]!;assert.equal(missing.status,'failed');assert.match(missing.reason,/USD valuation unavailable/);
  assert.equal(requests,0);assert.equal(f.ledger.state().executionCosts,'0');
  f.set(AT+600);coordinator.reserve(buy('expired',f.now()),f.context());f.set(AT+2600);
  assert.equal((await coordinator.runDue()).results[0]!.status,'expired');assert.equal(requests,0);assert.equal(f.ledger.state().lamports,'10000000000');
});

test('an uncanceled adapter schedules pending expiry rather than a past due hot loop, then wakes once',async t=>{
  const f=fixture(t);let calls=0,wakes=0;let release!:(value:ExecutionQuote|null)=>void;
  const coordinator=f.create({timeoutMs:10,onAdapterSettled:()=>{wakes++;throw new Error('DISPOSABLE scheduler error');},quote:async()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  coordinator.recover();f.ready();coordinator.reserve(buy('a'),f.context());coordinator.reserve(buy('b',AT,'fixture-other'),f.context());f.set(AT+500);
  const blocked=await coordinator.runDue();assert.equal(blocked.adapterBlocked,true);assert.equal(blocked.nextDueAt,AT+2000);assert.ok(blocked.nextDueAt!>f.now());
  assert.equal(calls,1);assert.ok(f.ledger.state().pending.b);assert.equal(wakes,0);
  release(null);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(wakes,1);assert.equal(coordinator.nextDueAt(),AT+500);assert.equal(f.ledger.state().executionCosts,'10000');
  f.set(AT+2000);assert.equal((await coordinator.runDue()).results[0]!.status,'expired');assert.equal(calls,1);
});

test('a quote arriving after expiry never fills and stale first state cannot be replaced by another quote',async t=>{
  const f=fixture(t);let calls=0;
  const coordinator=f.create({quote:async()=>{calls++;return {at:AT+499,spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE pre-delay state'};}});
  coordinator.recover();f.ready();coordinator.reserve(buy('stale'),f.context());f.set(AT+500);
  assert.equal((await coordinator.runDue()).results[0]!.status,'failed');assert.equal(f.ledger.state().executionCosts,'10000');
  assert.deepEqual((await coordinator.runDue()).results,[]);assert.equal(calls,1);
  const other=fixture(t);const slow=other.create({quote:async()=>{other.set(AT+2000);return {at:AT+500,spendLamports:'1',receiveUnits:'1000',evidence:'DISPOSABLE late response'};}});
  slow.recover();other.ready();slow.reserve(buy('expired-during-preparation'),other.context());other.set(AT+500);
  assert.equal((await slow.runDue()).results[0]!.status,'expired');assert.deepEqual(other.ledger.state().positions,{});assert.equal(other.ledger.state().executionCosts,'0');
});

test('SELL actions precede entries and may execute with unknown USD using actual held units',async t=>{
  const f=fixture(t);const orderIds:string[]=[];let usdAvailable=true;
  const coordinator=f.create({context:async()=>({...f.context(),price:usdAvailable?price(f.now()):null}),quote:async request=>{orderIds.push(request.order.id);return request.order.side==='buy'?{at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE buy'}:{at:f.now(),spendLamports:'0',receiveUnits:'500000000',pricedBaseUnits:request.fullPositionBaseUnits!,evidence:'DISPOSABLE actual-size exit'};}});
  coordinator.recover();f.ready();coordinator.reserve(buy('initial'),f.context());f.set(AT+500);await coordinator.runDue();
  f.set(AT+600);coordinator.reserve(buy('next',f.now(),'fixture-other'),f.context());coordinator.reserve(sell('protect'),f.context());
  f.set(AT+1100);await coordinator.runDue();assert.deepEqual(orderIds,['initial','protect','next']);
  f.set(AT+1200);coordinator.reserve(sell('usd-unavailable',f.now(),'fixture-other'),f.context());usdAvailable=false;f.set(AT+1700);
  assert.equal((await coordinator.runDue()).results[0]!.status,'filled');assert.deepEqual(f.ledger.state().positions,{});
  assert.equal(f.ledger.projection(f.now()).equityMicroUsd,null);
});

test('restart cancels obsolete entries but preserves uncertain exits until expiry without a favorable re-quote',async t=>{
  const f=fixture(t);const first=f.create();first.recover();f.ready();first.reserve(buy('initial'),f.context());f.set(AT+500);await first.runDue();
  f.set(AT+600);first.reserve(sell('recovered-sell'),f.context());first.reserve(buy('obsolete',f.now(),'fixture-other'),f.context());
  const before=f.ledger.state();f.ledger.close();const restored=new DisposableLedger(f.path,'fixture-execution');f.ledgers.push(restored);let calls=0;
  const next=f.create({quote:async()=>{calls++;return null;}},restored);const recovery=next.recover();
  assert.deepEqual(recovery.canceledEntries,['obsolete']);assert.deepEqual(recovery.uncertainExitOrders,['recovered-sell']);assert.equal(restored.state().inceptionAt,before.inceptionAt);
  f.set(AT+1100);assert.equal((await next.runDue()).results[0]!.status,'uncertain');assert.equal(calls,0);
  assert.throws(()=>next.reserve(buy('blocked',f.now(),'fixture-next'),f.context(restored)),/uncertainty/);
  f.set(AT+3000);assert.equal((await next.runDue()).results[0]!.status,'expired');assert.equal(calls,0);
  assert.equal(restored.state().positions['fixture-mint']!.units,'1000');assert.equal(restored.state().executionCosts,'10000');
  assert.deepEqual(restored.state().pending,{});assert.equal(restored.state().controls.entriesEnabled,false);
});

test('stored outcomes remain indexed after later journal windows without another quote, debit or revision',async t=>{
  const f=fixture(t);let calls=0;
  const coordinator=f.create({quote:async()=>{calls++;return null;}});coordinator.recover();f.ready();coordinator.reserve(buy('lookup'),f.context());f.set(AT+500);
  const result=(await coordinator.runDue()).results[0]!;assert.equal(result.status,'failed');
  for(let i=0;i<110;i++)f.ledger.pause('fixture-later-action:'+i,f.now(),'DISPOSABLE later journal action');
  assert.ok(!(f.ledger.exportJournal(100) as {action_id:string}[]).some(r=>r.action_id==='execution-attempt:lookup'));
  const before=f.ledger.state();const outcome=coordinator.recordedOutcome('lookup')!;assert.equal(outcome.status,'failed');assert.equal(outcome.at,result.at);
  outcome.reason='fixture caller mutation';assert.notEqual(coordinator.recordedOutcome('lookup')!.reason,outcome.reason);
  assert.deepEqual(f.ledger.state(),before);assert.equal(calls,1);assert.equal(coordinator.recordedOutcome('unknown'),null);
});

test('financial commit uncertainty preserves the order and blocks re-quote/new entries until expiry',async t=>{
  const f=fixture(t);let calls=0;const coordinator=f.create({quote:async()=>{calls++;return {at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE valid quote'};}});
  coordinator.recover();f.ready();coordinator.reserve(buy('uncertain'),f.context());f.set(AT+500);
  const attempt=f.ledger.attempt.bind(f.ledger);f.ledger.attempt=()=>{throw new Error('DISPOSABLE injected storage fault');};
  assert.equal((await coordinator.runDue()).results[0]!.status,'uncertain');assert.ok(f.ledger.state().pending['uncertain']);
  assert.equal((await coordinator.runDue()).results[0]!.status,'uncertain');assert.equal(calls,1);
  assert.throws(()=>coordinator.reserve(buy('new-risk',f.now(),'fixture-other'),f.context()),/uncertainty/);
  f.ledger.attempt=attempt;f.set(AT+2000);assert.equal((await coordinator.runDue()).results[0]!.status,'expired');
  assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().lamports,'10000000000');assert.equal(calls,1);
});

test('operator cancellation during quote preparation cannot produce a late fill or gas debit',async t=>{
  const f=fixture(t);let release!:(quote:ExecutionQuote)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  const coordinator=f.create({quote:async()=>{started();return new Promise(resolve=>{release=resolve;});}});
  coordinator.recover();f.ready();coordinator.reserve(buy('canceled'),f.context());f.set(AT+500);
  const active=coordinator.runDue();await ready;f.ledger.safeStop('fixture-stop',f.now());
  release({at:f.now(),spendLamports:'1',receiveUnits:'1000',evidence:'DISPOSABLE late quote'});
  assert.equal((await active).results[0]!.status,'canceled');assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().executionCosts,'0');
});

test('persistent expiry writes back off without a scheduling loop, another quote or discarded action',async t=>{
  const f=fixture(t);let quotes=0,writes=0;
  const coordinator=f.create({quote:async()=>{quotes++;return null;}});coordinator.recover();f.ready();coordinator.reserve(buy('storage-failure'),f.context());
  const actual=f.ledger.attempt.bind(f.ledger);f.ledger.attempt=()=>{writes++;throw new Error('DISPOSABLE persistent storage fault');};
  f.set(AT+500);await coordinator.runDue();assert.equal(writes,1);assert.equal(quotes,1);
  f.set(AT+2000);const expired=await coordinator.runDue();assert.equal(expired.results[0]!.status,'uncertain');assert.equal(expired.nextDueAt,AT+3000);assert.equal(writes,2);
  await coordinator.runDue();f.set(AT+2999);await coordinator.runDue();assert.equal(writes,2);assert.ok(f.ledger.state().pending['storage-failure']);
  f.set(AT+3000);assert.equal((await coordinator.runDue()).nextDueAt,AT+4000);assert.equal(writes,3);assert.equal(quotes,1);
  f.ledger.attempt=actual;f.set(AT+4000);assert.equal((await coordinator.runDue()).results[0]!.status,'expired');assert.equal(f.ledger.state().lamports,'10000000000');assert.deepEqual(f.ledger.state().pending,{});
});

test('an already-due entry blocked by another uncertain action cannot create a past-due scheduler loop',async t=>{
  const f=fixture(t);let quotes=0;
  const coordinator=f.create({quote:async()=>{quotes++;return null;}});coordinator.recover();f.ready();coordinator.reserve(buy('a'),f.context());coordinator.reserve(buy('b',AT,'fixture-other'),f.context());
  const actual=f.ledger.attempt.bind(f.ledger);f.ledger.attempt=()=>{throw new Error('DISPOSABLE write fault');};
  f.set(AT+500);const blocked=await coordinator.runDue();assert.equal(blocked.results.length,2);assert.ok(blocked.results.every(r=>r.status==='uncertain'));
  assert.equal(quotes,1);assert.equal(blocked.nextDueAt,AT+2000);assert.ok(blocked.nextDueAt!>f.now());
  await coordinator.runDue();assert.equal(quotes,1);assert.equal(coordinator.nextDueAt(),AT+2000);
  f.ledger.attempt=actual;f.set(AT+2000);const expired=await coordinator.runDue();assert.ok(expired.results.every(r=>r.status==='expired'));assert.equal(quotes,1);assert.deepEqual(f.ledger.state().pending,{});
});

test('a thrown return path after durable commit resolves through the stored outcome without another fill',async t=>{
  const f=fixture(t);let quotes=0;
  const coordinator=f.create({quote:async()=>{quotes++;return {at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE supported first state'};}});
  coordinator.recover();f.ready();coordinator.reserve(buy('committed'),f.context());f.set(AT+500);
  const actual=f.ledger.attempt.bind(f.ledger);f.ledger.attempt=(...args)=>{actual(...args);throw new Error('DISPOSABLE lost result after commit');};
  assert.equal((await coordinator.runDue()).results[0]!.status,'filled');assert.equal(f.ledger.state().positions['fixture-mint']!.units,'1000');
  assert.equal(f.ledger.state().executionCosts,'10000');assert.equal(quotes,1);assert.deepEqual((await coordinator.runDue()).results,[]);assert.equal(quotes,1);
});

test('an optional bounded drain services one due exit and retains immediate wake and exact ownership for the rest',async t=>{
  const f=fixture(t),quoted:string[]=[],coordinator=f.create({quote:async request=>{quoted.push(request.order.id);return request.order.side==='buy'?{at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE setup'}:{at:f.now(),spendLamports:'0',receiveUnits:'500000000',pricedBaseUnits:request.fullPositionBaseUnits!,evidence:'DISPOSABLE current full-size exit'};}});
  coordinator.recover();f.ready();for(const mint of ['a','b','c'])coordinator.reserve(buy('setup-'+mint,AT,mint),f.context());f.set(AT+500);await coordinator.runDue();assert.equal(Object.keys(f.ledger.state().positions).length,3);
  f.set(AT+600);for(const mint of ['a','b','c'])coordinator.reserve(sell('exit-'+mint,f.now(),mint),f.context());const orders=structuredClone(f.ledger.state().pending);f.set(AT+1100);const before=quoted.length;
  const first=await coordinator.runDue({maxActions:1});assert.equal(first.servicedActions,1);assert.deepEqual(first.results.map(r=>r.orderId),['exit-a']);assert.equal(quoted.length-before,1);assert.equal(first.nextDueAt,f.now());assert.deepEqual(f.ledger.state().pending['exit-b'],orders['exit-b']);assert.deepEqual(f.ledger.state().pending['exit-c'],orders['exit-c']);
  const second=await coordinator.runDue({maxActions:1});assert.equal(second.servicedActions,1);assert.deepEqual(second.results.map(r=>r.orderId),['exit-b']);assert.equal(second.nextDueAt,f.now());
  const defaultDrain=await coordinator.runDue();assert.equal(defaultDrain.servicedActions,undefined);assert.deepEqual(defaultDrain.results.map(r=>r.orderId),['exit-c']);assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().executionCosts,'60000');assert.equal(f.ledger.state().inceptionAt,AT);
});

test('bounded expiry needs no quote or gas, while a quarantined exit cannot starve a separately owned fresh due exit',async t=>{
  const expired=fixture(t),first=expired.create();first.recover();expired.ready();for(const mint of ['a','b','c'])first.reserve(buy('expire-'+mint,AT,mint),expired.context());expired.set(AT+2000);
  const one=await first.runDue({maxActions:1});assert.equal(one.servicedActions,1);assert.equal(one.results[0]!.status,'expired');assert.equal(Object.keys(expired.ledger.state().pending).length,2);assert.equal(one.nextDueAt,AT+500);assert.equal(expired.ledger.state().executionCosts,'0');const rest=await first.runDue({maxActions:2});assert.equal(rest.servicedActions,2);assert.ok(rest.results.every(r=>r.status==='expired'));assert.deepEqual(expired.ledger.state().pending,{});
  const f=fixture(t),setup=f.create();setup.recover();f.ready();for(const mint of ['a','b'])setup.reserve(buy('setup-'+mint,AT,mint),f.context());f.set(AT+500);await setup.runDue();f.set(AT+600);setup.reserve(sell('a-quarantined',f.now(),'a'),f.context());
  let quotes=0;const recovered=f.create({quote:async request=>{quotes++;assert.equal(request.order.id,'z-fresh-exit');return {at:f.now(),spendLamports:'0',receiveUnits:'500000000',pricedBaseUnits:request.fullPositionBaseUnits!,evidence:'DISPOSABLE current owned exit'};}});recovered.recover();recovered.reserve(sell('z-fresh-exit',f.now(),'b'),f.context());f.set(AT+1100);
  const batch=await recovered.runDue({maxActions:1});assert.equal(batch.servicedActions,1);assert.equal(batch.results.find(r=>r.orderId==='a-quarantined')!.status,'uncertain');assert.equal(batch.results.find(r=>r.orderId==='z-fresh-exit')!.status,'filled');assert.equal(quotes,1);assert.ok(f.ledger.state().positions.a);assert.ok(f.ledger.state().pending['a-quarantined']);assert.equal(batch.nextDueAt,AT+3000);
  const before=f.ledger.state();await assert.rejects(recovered.runDue({maxActions:4 as 1}),/bounded due-action/);assert.deepEqual(f.ledger.state(),before);
});

test('source expiry during a fresh entry quote makes held equity unavailable before gas without deleting exposure',async t=>{
  const f=fixture(t),setup=f.create();setup.recover();f.ready();setup.reserve(buy('held'),f.context());f.set(AT+500);await setup.runDue();f.set(AT+600);
  const execution=f.create({context:async()=>({...f.context(),sourceValidUntil:f.now()+1}),quote:async()=>{f.set(f.now()+2);return {at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE fresh entry quote after old bank-source expired'};}});execution.recover();f.ready();execution.reserve(buy('next',f.now(),'other-mint'),f.context());f.set(AT+1100);const held=f.ledger.state().positions['fixture-mint'],cash=f.ledger.state().lamports;
  const result=await execution.runDue();assert.equal(result.results[0]!.status,'failed');assert.match(result.results[0]!.reason,/unknown liquidation marks/);assert.deepEqual(f.ledger.state().positions['fixture-mint'],held);assert.equal(f.ledger.state().positions['other-mint'],undefined);assert.equal(f.ledger.state().executionCosts,'10000');assert.equal(f.ledger.state().lamports,cash);assert.deepEqual(f.ledger.state().pending,{});
});

test('age scope blocks reservations and cancels only unfilled buys, without charging gas',async t=>{
 const f=fixture(t);let allowed=false,quotes=0;const c=f.create({entryScope:()=>({allowed,reason:allowed?'TOKEN_AGE_WITHIN_24H':'TOKEN_AGE_EXCEEDS_24H',createdAt:0,ageMs:0,expiresAt:0}),quote:async()=>{quotes++;return null;}});
 c.recover();f.ready();assert.throws(()=>c.reserve(buy('age'),f.context()),/TOKEN_AGE_SCOPE/);allowed=true;c.reserve(buy('age'),f.context());allowed=false;f.set(AT+500);
 const result=(await c.runDue()).results[0]!;assert.equal(result.status,'canceled');assert.equal(result.reason,'PAPER_ENTRY_TOKEN_AGE_SCOPE');assert.equal(quotes,0);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'0');assert.equal(f.ledger.state().inceptionAt,AT);
});
test('crossing the age cutoff during quote preparation cannot fill a pending entry',async t=>{
 const f=fixture(t);let allowed=true;const c=f.create({entryScope:()=>({allowed,reason:allowed?'TOKEN_AGE_WITHIN_24H':'TOKEN_AGE_EXCEEDS_24H',createdAt:0,ageMs:0,expiresAt:0}),quote:async()=>{allowed=false;return {at:f.now(),spendLamports:'480000000',receiveUnits:'1000',evidence:'DISPOSABLE quote after cutoff'};}});
 c.recover();f.ready();c.reserve(buy('age-crossing'),f.context());f.set(AT+500);assert.equal((await c.runDue()).results[0]!.status,'canceled');assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().executionCosts,'0');
});
test('aged holdings retain their exit execution and no age callback can block their sale',async t=>{
 const f=fixture(t);let allowed=true;const c=f.create({entryScope:()=>{if(!allowed)throw Error('age source unavailable');return {allowed:true,reason:'TOKEN_AGE_WITHIN_24H',createdAt:0,ageMs:0,expiresAt:0};}});
 c.recover();f.ready();c.reserve(buy('before-age'),f.context());f.set(AT+500);assert.equal((await c.runDue()).results[0]!.status,'filled');allowed=false;
 f.set(AT+600);c.reserve(sell('after-age'),f.context());f.set(AT+1100);assert.equal((await c.runDue()).results[0]!.status,'filled');assert.deepEqual(f.ledger.state().positions,{});
});
