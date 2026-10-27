import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadOnlyRpc} from '../src/network.js';
import {RpcMarket,type RpcMarketOptions} from '../src/rpc-market.js';
import {DisposableLedger,type Position} from '../src/ledger.js';
import {PaperTrader} from '../src/trader.js';

// Retained real pool bytes replayed with explicit synthetic availability times.
// No forward price, financial account or network call is created by these tests.
function fixture(options:{advanceBlockMs?:number;gas?:string;deposit?:string|null;accounts?:boolean|null;usdAge?:number;advanceRentMs?:number;onRent?:()=>void}={}){
  const captures=['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z'].map(run=>{
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    return {proof,state:structuredClone(rows.find(x=>x.kind==='pool-state').data)};
  });
  let now=Date.parse(captures[1]!.proof.quote.validatedAt),missing=false,blockAge=0,rentUnavailable=false;
  const rows:Array<{kind:string;data:any}>=[],methods:string[]=[],rentBytes:number[]=[],requests:Array<{method:string;params:any[]}>=[];
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async(_url,init)=>{
    const b=JSON.parse(String(init?.body));methods.push(b.method);requests.push({method:b.method,params:structuredClone(b.params)});let result;
    if(b.method==='getMultipleAccounts'){
      const capture=captures.find(x=>x.proof.quote.pool===b.params[0][0]);assert.ok(capture);
      assert.ok(b.params[1].minContextSlot>=capture.proof.origin.slot);
      result={context:capture.state.context,value:b.params[0].length===1?[capture.state.value[0]]:capture.state.value};
      if(missing)result.value=[null];
    }else if(b.method==='getBlockTime'){result=Math.floor((now-blockAge)/1000);now+=options.advanceBlockMs??0;}
    else if(b.method==='getMinimumBalanceForRentExemption'){rentBytes.push(b.params[0]);options.onRent?.();result=rentUnavailable?null:1_000_000+b.params[0];now+=options.advanceRentMs??0;}
    else throw new Error('unexpected RPC method');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result}));
  }) as typeof fetch,{profile:'runtime'});
  const config:RpcMarketOptions={rpc,recorder:{record:(kind,data)=>rows.push({kind,data:structuredClone(data)})},now:()=>now,gas:{baseFeeLamports:options.gas??'5000',priorityFeeLamports:'2000',evidence:'explicit disposable network-cost assumption'},entryDepositLamports:options.deposit,accountPlan:()=>({baseExists:options.accounts??null,quoteExists:options.accounts??null,at:now,evidence:'explicit disposable PAPER account inventory'}),usd:()=>({microUsdPerSol:'200000000',at:now-(options.usdAge??0),source:'disposable timestamped USD input'})};
  const market=new RpcMarket(config);for(const {proof} of captures)market.registerPool({mint:proof.quote.mint,migrationSlot:proof.origin.slot,migrationVerified:true,evidence:'retained confirmed migration evidence'});
  const position=(index=0,scale=1n):Position=>{const q=captures[index]!.proof.quote;return {mint:q.mint,units:String(BigInt(q.buy.outputBaseUnits)*scale),entryLamports:'10000000',entryGas:'7000',costMicroUsd:'2001400',deposit:'0',enteredAt:now-100_000};};
  const at=now,realNow=Date.now;Date.now=()=>now;
  return {market,rpc,rows,methods,rentBytes,requests,captures,position,at,config,clock:()=>now,advance:(ms:number)=>{now+=ms;},missing:()=>{missing=true;},staleBlock:()=>{blockAge=60_000;},missingRent:()=>{rentUnavailable=true;},close:()=>{Date.now=realNow;}};
}
const signal=()=>new AbortController().signal;

test('exact full-held sizes receive independent verified quotes; marks subtract gas once and do not refund deposits',async()=>{
  const f=fixture();try{
    const p=f.position(1,3n),q=await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal());assert.ok(q);
    const small=await f.market.quote({mint:p.mint,side:'sell',inputUnits:f.position(1).units},signal());assert.ok(small);assert.notEqual(q.outputUnits,small.outputUnits);
    const context=await f.market.context({[p.mint]:p},signal());assert.equal(context.marks[p.mint]!.pricedBaseUnits,p.units);
    assert.equal(context.marks[p.mint]!.netLamports,String(BigInt(q.outputUnits)-7000n));
    assert.equal(q.at,f.at);assert.equal(context.marks[p.mint]!.at,f.at);assert.equal(q.refundedDepositLamports,undefined);
    assert.equal(f.rpc.calls,9);assert.equal(f.methods.includes('getTransaction'),false);
    const evidence=f.rows.find(x=>x.kind==='rpc-market-quote')!.data;assert.equal(evidence.source.commitment,'confirmed');assert.equal(evidence.source.slot,f.captures[1]!.state.context.slot);
    assert.equal(Date.parse(evidence.source.receivedAt),q.at);assert.equal(evidence.costs.gasLamports,'7000');
  }finally{f.close();}
});

test('RPC protection works without paid flow or fresh USD; missing state and costs never create a fresh zero',async()=>{
  const f=fixture({usdAge:10_001});try{
    const p=f.position(),c=await f.market.context({[p.mint]:p},signal());assert.equal(c.price,null);assert.ok(c.marks[p.mint]);
    assert.ok(await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()));
    assert.equal(await f.market.quote({mint:p.mint,side:'buy',inputUnits:'10000000'},signal()),null);
    f.missing();assert.deepEqual((await f.market.context({[p.mint]:p},signal())).marks,{});
    assert.equal(await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);
  }finally{f.close();}
});

test('current165/170-byte rent must exactly match refundable entry reservation; unknown rent blocks only buys',async()=>{
  const f=fixture({accounts:false,deposit:String(2_000_000+170+165)});try{
    const p=f.position(1),buy=await f.market.quote({mint:p.mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(buy);
    assert.deepEqual(f.rentBytes,[170,165]);const record=f.rows.find(x=>x.kind==='rpc-market-quote')!.data;
    assert.equal(record.costs.depositLamports,'2000335');assert.equal(record.costs.classification,'simulated');assert.equal(buy.outputUnits,f.captures[1]!.proof.quote.buy.outputBaseUnits);
    f.missingRent();assert.equal(await f.market.quote({mint:p.mint,side:'buy',inputUnits:'10000000'},signal()),null);
    assert.ok(await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()));
  }finally{f.close();}
  const mismatch=fixture({accounts:false,deposit:'2000330'});try{const p=mismatch.position(1);assert.equal(await mismatch.market.quote({mint:p.mint,side:'buy',inputUnits:'10000000'},signal()),null);}finally{mismatch.close();}
  const existing=fixture({accounts:true,deposit:'0'});try{const p=existing.position();assert.ok(await existing.market.quote({mint:p.mint,side:'buy',inputUnits:'10000000'},signal()));assert.equal(existing.rentBytes.length,0);}finally{existing.close();}
});

test('slow validation cannot refresh original pool receipt; old block times and below-gas exits remain unavailable',async()=>{
  const slow=fixture({advanceBlockMs:2001});try{const p=slow.position();assert.equal(await slow.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);assert.equal(slow.rows.some(r=>r.kind==='rpc-market-quote'),false);}finally{slow.close();}
  const old=fixture();try{old.staleBlock();const p=old.position();assert.equal(await old.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);}finally{old.close();}
  const costly=fixture({gas:'1000000000'});try{const p=costly.position();assert.deepEqual((await costly.market.context({[p.mint]:p},signal())).marks,{});assert.equal(await costly.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);}finally{costly.close();}
});

test('independent held pools retain their own timestamps and stale earlier marks are removed at coherent return',async()=>{
  const f=fixture({advanceBlockMs:1400});try{
    const a=f.position(),b=f.position(1),context=await f.market.context({[a.mint]:a,[b.mint]:b},signal());
    assert.equal(context.marks[a.mint],undefined);assert.equal(context.marks[b.mint]!.at,f.at+1400);assert.equal(context.marks[b.mint]!.pricedBaseUnits,b.units);
    const records=f.rows.filter(r=>r.kind==='rpc-market-quote');assert.equal(records[0]!.data.quote.at,f.at);assert.equal(records[1]!.data.quote.at,f.at+1400);
    assert.match(f.rows.find(r=>r.kind==='rpc-market-context')!.data.compatibility,/no cross-source atomicity/);
  }finally{f.close();}
});

test('adapter aborts at its deadline, rejects new work while physical RPC ignores cancellation, and never retries',async()=>{
  let release!:(r:Response)=>void,calls=0;
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async()=>{calls++;return new Promise<Response>(r=>{release=r;});}) as typeof fetch,{profile:'runtime'});
  const rows:any[]=[];const market=new RpcMarket({rpc,timeoutMs:10,recorder:{record:(k,d)=>rows.push({k,d})},gas:{baseFeeLamports:'5000',priorityFeeLamports:'0',evidence:'disposable assumption'}});
  const proof=JSON.parse(readFileSync('evidence/integration-proof-2026-10-26T19-42-16.130Z.json','utf8'));market.registerPool({mint:proof.quote.mint,migrationSlot:proof.origin.slot,migrationVerified:true,evidence:'retained fixture migration'});
  const request={mint:proof.quote.mint,side:'sell' as const,inputUnits:proof.quote.buy.outputBaseUnits};
  assert.equal(await market.quote(request,signal()),null);assert.equal(rpc.inFlight,1);
  for(let i=0;i<20;i++)assert.equal(await market.quote(request,signal()),null);
  assert.equal(calls,1);release(new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:null})));await new Promise(r=>setImmediate(r));assert.equal(rpc.inFlight,0);assert.equal(rows.length,0);
  const controller=new AbortController();controller.abort();assert.equal(await market.quote(request,controller.signal),null);assert.equal(calls,1);
});

test('minimum confirmed slot cannot regress and unregistered identities never request state',async()=>{
  const f=fixture();try{
    const p=f.position();assert.equal(await f.market.quote({mint:'11111111111111111111111111111111',side:'sell',inputUnits:'10'},signal()),null);assert.equal(f.rpc.calls,0);
    assert.ok(await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()));
    f.captures[0]!.state.context.slot--;assert.equal(await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units},signal()),null);
    assert.throws(()=>f.market.registerPool({mint:p.mint,migrationSlot:0,migrationVerified:true,evidence:'conflict'}),/conflicting/);
  }finally{f.close();}
});

test('request and held quantities are copied before asynchronous work can observe caller mutations',async()=>{
  const f=fixture();try{
    const p=f.position(),expected=p.units,request={mint:p.mint,side:'sell' as const,inputUnits:expected};
    const pending=f.market.quote(request,signal());request.inputUnits='1';const q=await pending;assert.ok(q);assert.equal(q.inputUnits,expected);
    const context=f.market.context({[p.mint]:p},signal());p.units='1';const result=await context;assert.equal(result.marks[p.mint]!.pricedBaseUnits,expected);
  }finally{f.close();}
});

test('account plans are snapshotted before rent reads, then revalidated without leaking extra adapter fields',async()=>{
  const plan={baseExists:false,quoteExists:false,at:0,evidence:'disposable explicit inventory',secret:'must-not-record'};
  const f=fixture({deposit:'2000335',onRent:()=>{plan.baseExists=true;plan.quoteExists=true;plan.evidence='later mutation';}});plan.at=f.clock();
  try{
    const market=new RpcMarket({...f.config,accountPlan:()=>plan,gas:{...f.config.gas,secret:'must-not-record'} as any,usd:()=>({microUsdPerSol:'200000000',at:f.clock(),source:'disposable',secret:'must-not-record'} as any)}),p=f.position(1);
    market.registerPool({mint:p.mint,migrationSlot:f.captures[1]!.proof.origin.slot,migrationVerified:true,evidence:'retained migration'});
    assert.ok(await market.quote({mint:p.mint,side:'buy',inputUnits:'10000000',secret:'must-not-record'} as any,signal()));
    const quote=f.rows.find(r=>r.kind==='rpc-market-quote')!.data;assert.equal(quote.costs.plan.baseExists,false);assert.equal(quote.costs.plan.evidence,'disposable explicit inventory');
    assert.equal(JSON.stringify(f.rows).includes('must-not-record'),false);await market.context({},signal());assert.equal(JSON.stringify(f.rows).includes('must-not-record'),false);
  }finally{f.close();}
  const stale=fixture({deposit:'2000335',advanceRentMs:1});try{
    const market=new RpcMarket({...stale.config,accountPlan:()=>({baseExists:false,quoteExists:false,at:stale.at-9999,evidence:'formerly current inventory'})}),p=stale.position(1);
    market.registerPool({mint:p.mint,migrationSlot:stale.captures[1]!.proof.origin.slot,migrationVerified:true,evidence:'retained migration'});
    assert.equal(await market.quote({mint:p.mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(stale.clock()-stale.at,2);
  }finally{stale.close();}
});

test('slow recording cannot refresh a mark or USD snapshot after its final freshness check',async()=>{
  const f=fixture({usdAge:9000});try{
    const market=new RpcMarket({...f.config,recorder:{record(kind,data){f.config.recorder.record(kind,data);if(kind==='rpc-market-context')f.advance(2001);}}}),p=f.position();
    market.registerPool({mint:p.mint,migrationSlot:f.captures[0]!.proof.origin.slot,migrationVerified:true,evidence:'retained migration'});
    const context=await market.context({[p.mint]:p},signal());assert.deepEqual(context.marks,{});assert.equal(context.price,null);
  }finally{f.close();}
});

test('optional candidate slot floor reaches actual RPC reads and returned verified quote context',async()=>{
  const f=fixture({accounts:true,deposit:'0'});try{
    const p=f.position(),slot=f.captures[0]!.state.context.slot,q=await f.market.quote({mint:p.mint,side:'buy',inputUnits:'10000000',minSlot:slot},signal());assert.ok(q);assert.equal(q.slot,slot);
    const reads=f.requests.filter(r=>r.method==='getMultipleAccounts');assert.equal(reads.length,2);assert.ok(reads.every(r=>r.params[1].minContextSlot===slot));assert.equal(f.rpc.calls,3);
    const before=f.rpc.calls,unavailable=await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units,minSlot:slot+1},signal());assert.equal(unavailable,null);assert.equal(f.rpc.calls,before+1);assert.equal(f.requests.at(-1)!.params[1].minContextSlot,slot+1);
  }finally{f.close();}
});

test('malformed request floors never request data and asynchronous caller mutation cannot lower the copied floor',async()=>{
  const f=fixture();try{
    const p=f.position(),slot=f.captures[0]!.state.context.slot;
    for(const minSlot of [-1,0.5,Number.NaN,Number.POSITIVE_INFINITY])assert.equal(await f.market.quote({mint:p.mint,side:'sell',inputUnits:p.units,minSlot},signal()),null);
    assert.equal(f.rpc.calls,0);
    const request={mint:p.mint,side:'sell' as const,inputUnits:p.units,minSlot:slot},pending=f.market.quote(request,signal());request.minSlot=0;
    const q=await pending;assert.ok(q);assert.equal(q.slot,slot);assert.ok(f.requests.filter(r=>r.method==='getMultipleAccounts').every(r=>r.params[1].minContextSlot===slot));
  }finally{f.close();}
});

test('research trader slot floor reaches the retained-byte RpcMarket adapter before disposable reservation',async()=>{
  const f=fixture({accounts:true,deposit:'0'}),directory=mkdtempSync(join(tmpdir(),'poe-lazy-market-DISPOSABLE-')),ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-lazy-market');
  try{
    const began=Math.ceil(f.clock()/10000)*10000;f.advance(began-f.clock());
    const p=f.position(),slot=f.captures[0]!.state.context.slot,price={microUsdPerSol:'200000000',at:began,source:'DISPOSABLE timestamped USD'};
    ledger.initialize(price,began);
    const engine=new PaperTrader({ledger,now:f.clock,context:f.market.context,quote:f.market.quote,deferPredictivelyRejectedQuotes:true,recorder:f.config.recorder,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:500,evidence:'DISPOSABLE explicit gas/account plan'},flowVerification:{verified:true,evidence:'DISPOSABLE synthetic flow; no provider or economic validation'}});engine.start();
    engine.admit({mint:p.mint,migrationAt:began-300000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE admitted identity tied to retained migration'});engine.activateFlow(p.mint,'DISPOSABLE ACK');
    for(let i=0;i<6;i++){
      f.advance(began+i*10000+100-f.clock());engine.ingest({identity:{signature:`fixture-end-to-end-${i}`,instructionIndex:0,eventIndex:0},mint:p.mint,wallet:`fixture-wallet-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*20000),receivedAt:f.clock(),commitment:'confirmed',slot:slot-5+i});
    }
    f.advance(began+60000-f.clock());const current={microUsdPerSol:'200000000',at:f.clock(),source:'DISPOSABLE timestamped USD'};ledger.reconcile('fixture-ready',f.clock(),current,{});ledger.resume('fixture-resume',f.clock(),current,{}, {version:'DISPOSABLE',evidence:'isolated software handoff only',marketAt:f.clock(),recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
    await engine.tick();assert.equal(engine.funnel.reserved,1);assert.equal(engine.funnel.paperFilled,0);assert.equal(Object.keys(ledger.state().pending).length,1);
    const q=f.rows.find(r=>r.kind==='rpc-market-quote')!.data;assert.equal(q.request.minSlot,slot);assert.equal(q.quote.slot,slot);assert.ok(f.requests.filter(r=>r.method==='getMultipleAccounts').every(r=>r.params[1].minContextSlot===slot));assert.equal(f.rpc.calls,3);assert.equal(ledger.state().inceptionAt,began);
  }finally{ledger.close();rmSync(directory,{recursive:true,force:true});f.close();}
});
