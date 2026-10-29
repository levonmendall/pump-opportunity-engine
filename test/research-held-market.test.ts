/** Synthetic union/context and disposable ledger only; no forward performance. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {DisposableLedger,type Order,type Position,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator,type QuoteRequest} from '../src/execution.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {ResearchHeldMarket,heldPricingFailureCode} from '../src/research-held-market.js';
import type {PoolWireAccount} from '../src/pool.js';

const GAS='7000',ENTRY='10000000',signal=()=>new AbortController().signal;
test('holding pricing exposes only bounded static interruption categories',()=>{
  for(const [message,code]of [['PHYSICAL_SLOT_OCCUPIED','HELD_PRICING_BUSY'],['PILOT_RPC_COMPONENT_PHYSICAL_TIMEOUT','HELD_PRICING_PROVIDER_TIMEOUT'],['COOLDOWN','HELD_PRICING_PROVIDER_COOLDOWN'],['COMPONENT_START_DEADLINE','HELD_PRICING_DISPATCH_UNAVAILABLE'],['RESEARCH_CLOCK_NOT_CURRENT_WITHIN_30_SECONDS','HELD_PRICING_BANK_CLOCK_UNAVAILABLE'],['POOL_REGRESSING_CONTEXT','HELD_PRICING_SLOT_UNAVAILABLE'],['RESEARCH_HELD_SOURCE_AGE','HELD_PRICING_STALE_EVIDENCE'],['RESEARCH_HELD_POSITION_CHANGED','HELD_PRICING_INVENTORY_CHANGED'],['untrusted https://provider.invalid/?api-key=not-for-public','HELD_PRICING_DATA_UNAVAILABLE']] as const)assert.equal(heldPricingFailureCode(Error(message)),code);
});
function fixture(t:TestContext){
  const retained=['2026-10-26T19-42-16.130Z','2026-10-26T19-57-35.882Z'].map(run=>{
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8')),rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    return {proof,state:structuredClone(rows.find(r=>r.kind==='pool-state').data)};
  });
  // These two pools were NOT captured simultaneously. Deliberately synthetic
  // shared bank/time/Clock is used to test adapter+financial mechanics only.
  const accounts=new Map<string,PoolWireAccount|null>();for(const r of retained)for(let i=0;i<7;i++)if(!accounts.has(r.state.addresses[i]))accounts.set(r.state.addresses[i],r.state.value[i]);
  let at=Math.max(...retained.map(r=>Date.parse(r.proof.quote.validatedAt))),slot=Math.max(...retained.map(r=>r.state.context.slot)),clockSeconds:number|null=null,calls:Array<{method:string;addresses:string[];at:number}>=[];
  const realNow=Date.now;Date.now=()=>at;
  const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-research-held-')),path=join(directory,'fixture.sqlite'),id='fixture-research-held';
  let ledger=new DisposableLedger(path,id),pauseRead:(()=>Promise<void>)|null=null;
  t.after(()=>{ledger.close();Date.now=realNow;rmSync(directory,{recursive:true,force:true});});
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE fixed USD for adapter accounting mechanics'});
  ledger.initialize(price(),at);const inception=ledger.state().inceptionAt,initial=BigInt(ledger.state().lamports);
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    assert.equal(method,'getMultipleAccounts');const addresses=params[0] as string[];calls.push({method,addresses:[...addresses],at});
    if(pauseRead){const gate=pauseRead;pauseRead=null;await gate();}
    const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot),0);raw.writeBigInt64LE(BigInt(clockSeconds??Math.floor(at/1000)),32);
    const clock:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};
    return {context:{slot},value:addresses.map(a=>a===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(a)??null))} as T;
  }};
  const records:Array<{kind:string;data:any}>=[],recorder={record(kind:string,data:unknown){records.push({kind,data});}};
  const makeMarket=(overrides:Partial<ConstructorParameters<typeof ResearchHeldMarket>[0]>={})=>{
    const market=new ResearchHeldMarket({pricer:new ResearchClockPositionPricer(rpc,recorder),inventory:()=>ledger.state(),now:()=>at,usd:price,gasLamports:GAS,gasEvidence:'DISPOSABLE7k gas assumption',recorder,entryQuote:async request=>{
      const pool=retained.find(r=>r.proof.quote.mint===request.mint);assert.ok(pool);return {...request,slot,outputUnits:pool.proof.quote.buy.outputBaseUnits,at,evidence:'DISPOSABLE existing entry adapter stand-in'};
    },...overrides});
    for(const r of retained)market.registerPool({mint:r.proof.quote.mint,migrationSlot:r.proof.origin.slot,migrationVerified:true,evidence:'retained actual migration proof, synthetic bank timing for fixture'});
    return market;
  };
  const coordinator=(market:ResearchHeldMarket)=>new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:100,context:s=>market.context(ledger.state().positions,s),quote:market.executionQuote});
  const ready=()=>{ledger.reconcile('ready-reconcile:'+ledger.state().revision,at,price(),{});ledger.resume('ready:'+ledger.state().revision,at,price(),{},{version:'DISPOSABLE-research-held',evidence:'offline integration only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});};
  const buy=async(c:PaperExecutionCoordinator,index:number)=>{
    const r=retained[index]!,mint=r.proof.quote.mint;at+=1;const marks=await contextMarks();ledger.reconcile('entry-ready:'+index,at,price(),marks);
    c.reserve({id:'entry:'+index,side:'buy',mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:GAS,deposit:'0',maxSpend:ENTRY,minReceive:r.proof.quote.buy.outputBaseUnits,decisionEvidence:'DISPOSABLE fixture entry'}, {price:price(),marks});
    at+=1000;const outcome=await c.runDue();assert.equal(outcome.results[0]!.status,'filled',JSON.stringify({index,outcome}));
  };
  // Entry setup may require existing holding marks; use the same adapter later
  // supplied to the coordinator rather than bypassing ledger risk checks.
  let setupMarket:ResearchHeldMarket|undefined;
  const contextMarks=async()=>setupMarket?(await setupMarket.context(ledger.state().positions,signal())).marks:{};
  return {retained,accounts,records,price,inception,initial,makeMarket,coordinator,ready,buy,calls,get ledger(){return ledger;},setSetupMarket:(m:ResearchHeldMarket)=>{setupMarket=m;},advance:(ms:number)=>{at+=ms;},now:()=>at,slot:()=>slot,bumpSlot:()=>slot++,setClockSeconds:(value:number|null)=>{clockSeconds=value;},pause:(gate:()=>Promise<void>)=>{pauseRead=gate;},restart:()=>{ledger.close();ledger=new DisposableLedger(path,id);},clearCalls:()=>{calls.length=0;}};
}

test('two-held union marks and post-delay exit reuse integrate with one disposable writer and exact gas accounting',async t=>{
  const f=fixture(t),market=f.makeMarket(),c=f.coordinator(market);f.setSetupMarket(market);c.recover();f.ready();await f.buy(c,0);await f.buy(c,1);
  const before=f.ledger.state();assert.equal(Object.keys(before.positions).length,2);f.clearCalls();
  let context=await market.context(before.positions,signal());assert.equal(f.calls.length,2);assert.equal(f.calls[0]!.addresses.length,1);assert.equal(f.calls[1]!.addresses.length,12);
  f.clearCalls();context=await market.context(before.positions,signal());assert.equal(f.calls.length,1);assert.equal(f.calls[0]!.addresses.length,12);assert.equal(Object.keys(context.marks).length,2);
  const expectedGross:bigint[]=[];
  for(const p of Object.values(before.positions)){
    const q=await market.quote({mint:p.mint,side:'sell',inputUnits:p.units,minSlot:f.slot()},signal());assert.ok(q);assert.equal(q.slot,f.slot());
    assert.equal(BigInt(context.marks[p.mint]!.netLamports),BigInt(q.outputUnits)-BigInt(GAS));expectedGross.push(BigInt(q.outputUnits));
    c.reserve({id:'exit:'+expectedGross.length,side:'sell',mint:p.mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:GAS,deposit:'0',maxSpend:'0',minReceive:(BigInt(q.outputUnits)*9500n/10000n).toString(),decisionEvidence:q.evidence},context);
  }
  const calls=f.calls.length;f.advance(1000);const result=await c.runDue();assert.deepEqual(result.results.map(r=>r.status),['filled','filled']);
  // Coordinator prepares each pending action independently. Its first action
  // prices both holdings coherently; after that fill the second prices one.
  // Each action reuses its own post-delay context batch, avoiding a duplicate
  // quote request. This does not claim one batch across separate attempts.
  assert.equal(f.calls.length-calls,2);assert.equal(f.calls[calls]!.addresses.length,12);assert.equal(f.calls[calls+1]!.addresses.length,8);
  const end=f.ledger.state(),profit=expectedGross.reduce((a,b)=>a+b,0n)-2n*BigInt(ENTRY)-4n*BigInt(GAS);
  assert.deepEqual(end.positions,{});assert.deepEqual(end.pending,{});assert.equal(end.executionCosts,(4n*BigInt(GAS)).toString());assert.equal(end.realizedLamports,profit.toString());assert.equal(BigInt(end.lamports)-f.initial,profit);assert.equal(end.inceptionAt,f.inception);
  assert.deepEqual((await c.runDue()).results,[]);assert.equal(f.calls.length-calls,2);
});

test('holding diagnostics retain actual Clock failures after recovery without claiming a protection completion',async t=>{
 const f=fixture(t),market=f.makeMarket(),c=f.coordinator(market);f.setSetupMarket(market);c.recover();f.ready();await f.buy(c,0);
 const inventory=f.ledger.state().positions,at=f.now(),before=structuredClone(f.ledger.state());
 f.setClockSeconds(Math.floor(at/1000)-31);assert.deepEqual((await market.context(inventory,signal())).marks,{});
 assert.equal(market.usage().lastContext!.state,'unavailable');assert.equal(market.usage().lastContext!.reasonCode,'HELD_PRICING_BANK_CLOCK_UNAVAILABLE');
 assert.equal(market.usage().contextFailureCounts.HELD_PRICING_BANK_CLOCK_UNAVAILABLE,1);
 f.setClockSeconds(null);assert.ok(Object.keys((await market.context(inventory,signal())).marks).length);assert.equal(market.usage().lastContext!.state,'available');assert.equal(market.usage().lastContext!.reasonCode,null);
 assert.equal(market.usage().contextFailureCounts.HELD_PRICING_BANK_CLOCK_UNAVAILABLE,1,'recovery cannot erase historical failed pricing');assert.deepEqual(f.ledger.state(),before);
});

test('post-delay, exact-size, slot, stale and gap constraints refuse cached fills without extra requests',async t=>{
  const f=fixture(t),market=f.makeMarket(),c=f.coordinator(market);f.setSetupMarket(market);c.recover();f.ready();await f.buy(c,0);
  const context=await market.context(f.ledger.state().positions,signal()),p=Object.values(f.ledger.state().positions)[0]!,q=await market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal());assert.ok(q);
  c.reserve({id:'exit',side:'sell',mint:p.mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:GAS,deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:q.evidence},context);
  f.advance(1000);const request=():QuoteRequest=>({order:f.ledger.state().pending.exit!,attemptedAt:f.now(),fullPositionBaseUnits:p.units}),calls=f.calls.length;
  assert.equal(await market.executionQuote(request(),signal()),null);assert.equal(f.calls.length,calls); // pre-delay read
  await market.context(f.ledger.state().positions,signal());const fresh=await market.executionQuote(request(),signal());assert.ok(fresh);
  assert.equal(await market.executionQuote({...request(),fullPositionBaseUnits:(BigInt(p.units)+1n).toString()},signal()),null);
  const altered={...request(),order:{...request().order,id:'not-our-pending-action'}};assert.equal(await market.executionQuote(altered,signal()),null);
  const alteredGas={...request(),order:{...request().order,gas:'1'}};assert.equal(await market.executionQuote(alteredGas,signal()),null);
  assert.equal(await market.quote({mint:p.mint,side:'sell',inputUnits:p.units,minSlot:f.slot()+1},signal()),null);
  f.advance(2001);assert.equal(await market.executionQuote(request(),signal()),null);assert.equal(await market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);
  market.invalidate('isolated notification gap');assert.equal(await market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);assert.equal(f.ledger.state().positions[p.mint]!.units,p.units);
  const refreshed=await market.context(f.ledger.state().positions,signal());assert.ok(refreshed.marks[p.mint]);assert.ok(await market.executionQuote(request(),signal()));
  // A gap arriving during an in-flight read cannot be erased by its late result.
  let release!:()=>void;f.pause(()=>new Promise<void>(resolve=>{release=resolve;}));const pending=market.context(f.ledger.state().positions,signal());await Promise.resolve();market.invalidate('gap while read pending');release();assert.deepEqual((await pending).marks,{});assert.equal(await market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);
});

test('same-account restart quarantines unresolved exit without re-quote, preserves inception and restores current marks',async t=>{
  const f=fixture(t),market=f.makeMarket(),c=f.coordinator(market);f.setSetupMarket(market);c.recover();f.ready();await f.buy(c,0);
  const context=await market.context(f.ledger.state().positions,signal()),p=Object.values(f.ledger.state().positions)[0]!;
  c.reserve({id:'unresolved-exit',side:'sell',mint:p.mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:GAS,deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'DISPOSABLE unresolved action'},context);
  const account=f.ledger.state().accountId;f.restart();const restored=f.makeMarket(),recovered=f.coordinator(restored),receipt=recovered.recover();assert.deepEqual(receipt.uncertainExitOrders,['unresolved-exit']);
  f.clearCalls();f.advance(1000);assert.equal((await recovered.runDue()).results[0]!.status,'uncertain');assert.equal(f.calls.length,0);
  assert.equal(f.ledger.state().positions[p.mint]!.units,p.units);assert.equal(f.ledger.state().accountId,account);assert.equal(f.ledger.state().inceptionAt,f.inception);
  f.advance(4000);assert.equal((await recovered.runDue()).results[0]!.status,'expired');assert.equal(f.calls.length,0);assert.equal(f.ledger.state().executionCosts,GAS);
  assert.equal(f.ledger.state().positions[p.mint]!.units,p.units);assert.deepEqual(f.ledger.state().pending,{});
  const current=await restored.context(f.ledger.state().positions,signal());assert.ok(current.marks[p.mint]);assert.equal(f.calls.length,2);f.ledger.reconcile('after-restart-current',f.now(),f.price(),current.marks);
  assert.equal(f.ledger.state().accountId,account);assert.equal(f.ledger.state().inceptionAt,f.inception);assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

test('a registered different-mint quote cannot be relabeled as a same-size held mark',async t=>{
  const f=fixture(t),market=f.makeMarket(),c=f.coordinator(market);f.setSetupMarket(market);c.recover();f.ready();await f.buy(c,0);
  await market.context(f.ledger.state().positions,signal());const p=Object.values(f.ledger.state().positions)[0]!,q=structuredClone(f.records.findLast(r=>r.kind==='research-clock-position-sell-quote')!.data);
  const wrong=structuredClone(q);wrong.mint=f.retained[1]!.proof.quote.mint;
  const mismatched=f.makeMarket({pricer:{invalidate(){},async quoteMany(){return {quotes:{[p.mint]:wrong},unavailable:{},context:{slot:wrong.slot,requestedAt:wrong.requestedAt,receivedAt:wrong.receivedAt,marketClockUnixSeconds:wrong.marketClockUnixSeconds}};}}});
  const calls=f.calls.length,result=await mismatched.context(f.ledger.state().positions,signal());assert.deepEqual(result.marks,{});assert.equal(await mismatched.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);assert.equal(f.calls.length,calls);
});

test('delegated entry result is refused if a gap or higher slot floor arrives while awaiting it',async t=>{
  const f=fixture(t),mint=f.retained[0]!.proof.quote.mint,before=f.ledger.state();
  for(const change of ['gap','floor'] as const){
    let release!:()=>void;
    const market=f.makeMarket({entryQuote:async request=>{await new Promise<void>(resolve=>{release=resolve;});return {...request,slot:f.slot(),at:f.now(),outputUnits:'100',evidence:'DISPOSABLE delayed entry-delegate result'};}});
    const pending=market.quote({mint,side:'buy',inputUnits:ENTRY},signal());await Promise.resolve();
    if(change==='gap')market.invalidate('isolated gap while entry delegate pending');else market.minimumSlot(mint,f.slot()+1);
    release();assert.equal(await pending,null,change);assert.deepEqual(f.ledger.state(),before);
  }
  assert.equal(f.calls.length,0);
});

test('held context carries original inclusive bank-source expiry and refuses a still-recent quote after that expiry',async t=>{
  const f=fixture(t),market=f.makeMarket(),c=f.coordinator(market);f.setSetupMarket(market);c.recover();f.ready();assert.equal((await market.context({},signal())).sourceValidUntil,undefined);await f.buy(c,0);
  f.advance((1000-f.now()%1000)%1000);f.setClockSeconds(f.now()/1000-30);const context=await market.context(f.ledger.state().positions,signal()),p=Object.values(f.ledger.state().positions)[0]!;
  assert.equal(context.sourceValidUntil,f.now());assert.ok(context.marks[p.mint]);assert.ok(await market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()));f.advance(1);
  assert.equal(f.now()-context.marks[p.mint]!.at,1,'receipt-age remains within2s but source is older than30s');assert.equal(await market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);const refused=await market.context(f.ledger.state().positions,signal());assert.deepEqual(refused.marks,{});assert.equal(refused.sourceValidUntil,undefined);assert.ok(f.ledger.state().positions[p.mint]);
});

test('source expiry covers every required full-size holding, uses the minimum and is absent for an incomplete batch',async t=>{
  const f=fixture(t),market=f.makeMarket(),c=f.coordinator(market);f.setSetupMarket(market);c.recover();f.ready();await f.buy(c,0);await f.buy(c,1);await market.context(f.ledger.state().positions,signal());
  const quotes=Object.fromEntries(f.records.filter(r=>r.kind==='research-clock-position-sell-quote').map(r=>[r.data.mint,structuredClone(r.data)])),mints=Object.keys(f.ledger.state().positions),oldest=quotes[mints[0]!]!;oldest.marketClockUnixSeconds-=3;
  // Conservative aggregation over injected individually valid quote summaries.
  // Real current union reads share one Clock; this is not a live mixed bank.
  let omit=false;const mock=f.makeMarket({pricer:{invalidate(){},async quoteMany(){return {quotes:Object.fromEntries(mints.filter((_,i)=>!omit||i===0).map(mint=>[mint,quotes[mint]])),unavailable:{},context:{slot:oldest.slot,requestedAt:oldest.requestedAt,receivedAt:oldest.receivedAt,marketClockUnixSeconds:oldest.marketClockUnixSeconds}};}}});
  const full=await mock.context(f.ledger.state().positions,signal());assert.equal(Object.keys(full.marks).length,2);assert.equal(full.sourceValidUntil,Math.min(...mints.map(mint=>quotes[mint].marketClockUnixSeconds*1000+30000)));omit=true;const incomplete=await mock.context(f.ledger.state().positions,signal());assert.equal(Object.keys(incomplete.marks).length,1);assert.equal(incomplete.sourceValidUntil,undefined);
});

test('a Clock boundary crossed after final source validation stays explicitly expired instead of losing metadata',async t=>{
  const f=fixture(t),setup=f.makeMarket(),c=f.coordinator(setup);f.setSetupMarket(setup);c.recover();f.ready();await f.buy(c,0);f.advance((1000-f.now()%1000)%1000);f.setClockSeconds(f.now()/1000-30);const expiry=f.now();let crossAfterRead=false;
  const market=f.makeMarket({now:()=>{const observed=f.now();if(crossAfterRead){crossAfterRead=false;f.advance(1);}return observed;},recorder:{record(kind){if(kind==='research-held-market-context')crossAfterRead=true;}}});
  const context=await market.context(f.ledger.state().positions,signal()),position=Object.values(f.ledger.state().positions)[0]!;assert.equal(f.now(),expiry+1);assert.ok(context.marks[position.mint]);assert.equal(context.sourceValidUntil,expiry);assert.ok(context.sourceValidUntil!<f.now(),'consumer can reject the explicit known expiry at actual use');assert.equal(await market.quote({mint:position.mint,side:'sell',inputUnits:position.units},signal()),null);
});
