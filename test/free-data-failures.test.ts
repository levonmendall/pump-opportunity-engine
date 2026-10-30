import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {ReadOnlyRpc} from '../src/network.js';
import {RpcMarket} from '../src/rpc-market.js';
import {PaperTrader} from '../src/trader.js';
import {DisposableLedger,type Position} from '../src/ledger.js';
import {readCapturedTrace,hypotheticalPosition} from '../scripts/free-data-quote-replay.js';

// Real retained account bytes, with explicit fault injection and no network.
// Disposable memory ledgers below never access an authoritative account.
type Fault='none'|'429'|'quota'|'missing-vault'|'partial'|'malformed'|'oversize'|'delayed';
function fixture(t:TestContext){
  const trace=readCapturedTrace(),sample=trace.samples.find(s=>s.lane==='poll'&&s.outputLamports!==null)!;
  let now=sample.availableAt,fault:Fault='none',fetches=0;
  const recorded:{kind:string;data:unknown}[]=[],methods:string[]=[];
  const rpc=new ReadOnlyRpc('https://offline-fixture.invalid',(async(_url,init)=>{
    fetches++;const b=JSON.parse(String(init?.body)) as {id:number;method:string;params:unknown[]};methods.push(b.method);
    if(fault==='429')return new Response('provider-secret-must-not-escape',{status:429});
    if(fault==='quota')return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,error:{code:-32005,message:'provider-secret-must-not-escape: exhausted quota'}}));
    if(fault==='malformed')return new Response('{provider-secret-must-not-escape');
    if(fault==='oversize')return new Response('not consumed',{headers:{'content-length':'2000001'}});
    let result:unknown;
    if(b.method==='getMultipleAccounts'){
      const addresses=b.params[0] as string[];
      if(addresses.length===1){now=sample.requestedAt;result={context:{slot:sample.slot},value:[sample.accounts[0]]};}
      else{
        now=sample.receivedAt;const value:(unknown)[]=structuredClone(sample.accounts);
        if(fault==='missing-vault')value[5]=null;if(fault==='partial')value.pop();
        result={context:{slot:sample.slot},value};
      }
    }else if(b.method==='getBlockTime'){now=sample.availableAt+(fault==='delayed'?2001:0);result=sample.blockTime;}
    else throw new Error('unexpected offline RPC method');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result}));
  }) as typeof fetch,{profile:'runtime',maxCallsPerMinute:60,monotonicNow:()=>0});
  const market=new RpcMarket({rpc,now:()=>now,timeoutMs:100,recorder:{record:(kind,data)=>recorded.push({kind,data:structuredClone(data)})},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE modeled costs; no actual provider charge'},usd:()=>null});
  market.registerPool({mint:trace.mint,migrationSlot:trace.migrationSlot,migrationVerified:true,evidence:'retained confirmed migration proof'});
  const original=Date.now;Date.now=()=>now;t.after(()=>{Date.now=original;});
  const position=hypotheticalPosition(trace,sample.availableAt-10_000,'1007000');
  return {trace,sample,rpc,market,position,recorded,methods,now:()=>now,set:(at:number)=>{now=at;},fault:(next:Fault)=>{fault=next;},fetches:()=>fetches};
}
const signal=()=>new AbortController().signal;

test('provider429 and exhausted quota make full-size protection unavailable without zeros or provider-body leakage',async t=>{
  const f=fixture(t),positions={[f.position.mint]:f.position},before=structuredClone(positions);
  for(const fault of ['429','quota'] as const){
    f.fault(fault);const context=await f.market.context(positions,signal());
    assert.equal(context.price,null);assert.deepEqual(context.marks,{});assert.deepEqual(positions,before);
    assert.equal(await f.market.quote({mint:f.position.mint,side:'sell',inputUnits:f.position.units},signal()),null);
  }
  assert.equal(f.fetches(),4);assert.equal(f.rpc.inFlight,0);assert.equal(JSON.stringify(f.recorded).includes('provider-secret'),false);
});

test('missing, partial, malformed and oversized RPC responses preserve hypothetical holdings as unknown',async t=>{
  const f=fixture(t),before=structuredClone(f.position);
  for(const fault of ['missing-vault','partial','malformed','oversize'] as const){
    f.fault(fault);const context=await f.market.context({[f.position.mint]:f.position},signal());
    assert.equal(context.marks[f.position.mint],undefined);assert.equal(context.price,null);assert.deepEqual(f.position,before);
  }
  assert.equal(f.recorded.some(r=>r.kind==='rpc-market-quote'),false);assert.equal(f.rpc.inFlight,0);assert.equal(JSON.stringify(f.recorded).includes('provider-secret'),false);
});

test('delayed source validation cannot turn stale pool bytes into a fresh mark',async t=>{
  const f=fixture(t);f.fault('delayed');const c=await f.market.context({[f.position.mint]:f.position},signal());
  assert.equal(c.marks[f.position.mint],undefined);assert.equal(f.now()-f.sample.receivedAt>2000,true);assert.equal(f.position.units,f.trace.inputUnits);
  assert.equal(f.recorded.some(r=>r.kind==='rpc-market-quote'),false);
});

test('rolling RPC quota refuses repeated work without a retry queue or additional provider calls',async t=>{
  const f=fixture(t);let requests=0;
  const rpc=new ReadOnlyRpc('https://offline-fixture.invalid',async()=>{requests++;return new Response('provider quota',{status:429});},{profile:'runtime',maxCallsPerMinute:2,monotonicNow:()=>0,durationSamples:2});
  const market=new RpcMarket({rpc,now:f.now,recorder:{record(){}},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE costs'}});
  market.registerPool({mint:f.position.mint,migrationSlot:f.trace.migrationSlot,migrationVerified:true,evidence:'retained migration'});
  for(let i=0;i<50;i++)assert.deepEqual((await market.context({[f.position.mint]:f.position},signal())).marks,{});
  assert.equal(requests,2);assert.equal(rpc.calls,2);assert.equal(rpc.inFlight,0);assert.equal(rpc.usage().durationSamples,2);assert.equal(f.position.units,f.trace.inputUnits);
});

test('PaperTrader recognizes an RPC exit without flow/USD, fails its due unavailable attempt once, and preserves holdings on restart',async t=>{
  const f=fixture(t),initial=f.sample.availableAt-1000,ledger=new DisposableLedger(':memory:','fixture-free-data-protection');
  t.after(()=>ledger.close());const price={microUsdPerSol:'100000000',at:initial,source:'DISPOSABLE initial conversion'};
  ledger.initialize(price,initial);ledger.reconcile('fixture-initial',initial,price,{});
  ledger.order({id:'fixture-seed',side:'buy',mint:f.position.mint,decidedAt:initial,executeAt:initial+500,expiresAt:initial+5000,gas:'7000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'DISPOSABLE hypothetical holding setup'},price,{});
  assert.equal(ledger.attempt('fixture-seed-fill','fixture-seed',initial+500,{at:initial+500,spendLamports:'1000000',receiveUnits:f.trace.inputUnits,evidence:'SYNTHETIC seed quantity; not captured entry'}, {...price,at:initial+500}).status,'filled');
  const options={ledger,now:f.now,context:f.market.context,quote:f.market.quote,recorder:{record(){}},costs:{gasLamports:'7000',depositLamports:'0',slippageBps:500,evidence:'DISPOSABLE modeled costs'}};
  const trader=new PaperTrader(options);trader.start();await trader.tick();
  const pending=Object.values(ledger.state().pending);assert.equal(pending.length,1);assert.equal(pending[0]!.side,'sell');assert.equal(ledger.state().positions[f.position.mint]!.units,f.trace.inputUnits);assert.equal(trader.funnel.paperFilled,0);
  const held=structuredClone(ledger.state().positions),orders=structuredClone(ledger.state().pending),cash=ledger.state().lamports;
  f.fault('429');await trader.tick();assert.deepEqual(ledger.state().positions,held);assert.deepEqual(ledger.state().pending,orders);assert.equal(ledger.state().lamports,cash);
  f.set(pending[0]!.executeAt);const due=await trader.tick();assert.equal(due.execution[0]!.status,'failed');assert.deepEqual(ledger.state().positions,held);assert.deepEqual(ledger.state().pending,{});assert.equal(ledger.state().lamports,String(BigInt(cash)-7000n));assert.equal(ledger.state().executionCosts,'14000');assert.equal(trader.funnel.exited,0);
  const afterFailure=ledger.state().lamports,restarted=new PaperTrader(options);restarted.start();await restarted.tick();assert.deepEqual(ledger.state().positions,held);assert.deepEqual(ledger.state().pending,{});assert.equal(ledger.state().lamports,afterFailure);assert.equal(ledger.state().executionCosts,'14000');assert.equal(ledger.state().controls.entriesEnabled,false);assert.equal(restarted.funnel.exited,0);
});

test('restarting PaperTrader warms a new receive-time window instead of inheriting unavailable outage flow',async t=>{
  const f=fixture(t),ledger=new DisposableLedger(':memory:','fixture-free-data-rewarm');t.after(()=>ledger.close());
  ledger.initialize({at:f.now(),microUsdPerSol:'100000000',source:'DISPOSABLE conversion'},f.now());
  const options={ledger,now:f.now,context:async()=>({price:null,marks:{}}),quote:async()=>{throw new Error('unverified flow must never quote');},recorder:{record(){}},costs:{gasLamports:'7000',depositLamports:'0',slippageBps:500,evidence:'DISPOSABLE costs'}};
  const create=()=>{const engine=new PaperTrader(options);engine.start();engine.admit({mint:f.trace.mint,migrationAt:f.now()-300_000,migrationVerified:true,supportedPool:true,evidence:'retained migration; synthetic normalized window'});engine.activateFlow(f.trace.mint,'DISPOSABLE activation boundary');return engine;};
  const start=Math.ceil(f.now()/10_000)*10_000;f.set(start);const first=create();
  for(let i=0;i<6;i++){f.set(start+i*10_000+100);first.ingest({mint:f.trace.mint,identity:{signature:'fixture-rewarm-'+i,instructionIndex:0,eventIndex:0},wallet:'fixture-wallet-'+i,side:'buy',quoteLamports:'300000000',tokenUnits:String(300_000-i*20_000),receivedAt:f.now(),commitment:'confirmed'});}
  f.set(Math.ceil((start+60_000)/10_000)*10_000);await first.tick();assert.equal(first.decisions().at(-1)!.features!.tradeCount,6);
  f.set(f.now()+6*60*60_000);const restarted=create();await restarted.tick();
  assert.equal(restarted.decisions().at(-1)!.features!.tradeCount,0);assert.equal(restarted.decisions().at(-1)!.features!.sufficientlyObserved,false);assert.equal(restarted.funnel.reserved,0);assert.equal(ledger.state().controls.entriesEnabled,false);
});
