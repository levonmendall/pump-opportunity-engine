import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';
import {ReadOnlyRpc} from '../src/network.js';
import {quotePositionSell,quotePositionsSell,type PositionSellRequest} from '../src/pool.js';

// The one-pool case preserves actual captured bytes. Multi-pool cases explicitly
// assemble a synthetic same-slot response from separately captured pools; they
// prove decoder equality/bounds, not cross-pool historical atomicity or P&L.
function fixture(count=1){
  const runs=['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z','2026-10-26T23-32-41.255Z'];
  const captures=runs.slice(0,count).map(run=>{
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    return {proof,state:rows.find(x=>x.kind==='pool-state').data};
  });
  const accounts=new Map<string,any>();for(const {state} of captures)for(let i=0;i<state.addresses.length;i++)if(!accounts.has(state.addresses[i]))accounts.set(state.addresses[i],structuredClone(state.value[i]));
  const context={slot:Math.max(...captures.map(c=>c.state.context.slot))},at=Math.max(...captures.map(c=>Date.parse(c.proof.quote.validatedAt))),block=Math.floor(at/1000);
  const requests:PositionSellRequest[]=captures.map(c=>({mint:new PublicKey(c.proof.quote.mint),fullBaseUnits:BigInt(c.proof.quote.buy.outputBaseUnits)*2n+1n,minSlot:c.proof.origin.slot}));
  const calls:any[]=[],records:any[]=[];let blockResult:number|null=block,contextOffset=0,missingInitial=false,missingDependency:string|undefined,changeLinks=false,delayBlock=0;const realNow=Date.now;let now=at;Date.now=()=>now;
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async(_url,init)=>{
    const b=JSON.parse(String(init?.body));calls.push(b);let result;
    if(b.method==='getMultipleAccounts'){
      const initial=b.params[0].length<=count;
      assert.ok(b.params[1].minContextSlot>=Math.max(...requests.map(r=>r.minSlot??0)));
      const values=b.params[0].map((address:string)=>structuredClone(accounts.get(address)??null));
      if(initial&&missingInitial)values[0]=null;
      if(!initial&&missingDependency){const i=b.params[0].indexOf(missingDependency);if(i>=0)values[i]=null;}
      if(!initial&&changeLinks){const i=b.params[0].indexOf(captures[0]!.proof.quote.pool),bytes=Buffer.from(values[i].data[0],'base64');bytes[139]=bytes[139]!^1;values[i].data[0]=bytes.toString('base64');}
      result={context:{slot:context.slot+(initial?0:contextOffset)},value:values};
    }else if(b.method==='getBlockTime'){assert.equal(b.params[0],context.slot);result=blockResult;now+=delayBlock;}
    else throw Error('unexpected replay method');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result}));
  }) as typeof fetch);
  return {requests,accounts,captures,calls,rpc,records,at,rec:{record:(kind:string,data:unknown)=>records.push({kind,data})},missingInitial:()=>{missingInitial=true;},missingDependency:(address:string)=>{missingDependency=address;},changeLinks:()=>{changeLinks=true;},regress:()=>{contextOffset=-1;},stale:()=>{blockResult=block-60;},missingBlock:()=>{blockResult=null;},slow:()=>{delayBlock=2100;},close:()=>{Date.now=realNow;}};
}
for(const count of [1,2,3])test(`shared decoder matches independent same-byte full-size sells for ${count} pool(s), using three calls`,async()=>{
  const f=fixture(count);try{
    const result=await quotePositionsSell(f.rpc,f.requests,f.rec);assert.equal(f.calls.length,3);assert.deepEqual(result.unavailable,{});assert.equal(Object.keys(result.quotes).length,count);
    assert.equal(new Set(f.calls[1].params[0]).size,f.calls[1].params[0].length);assert.equal(f.calls[1].params[0].length,3+count*4);
    const batchCalls=f.calls.length;
    for(const request of f.requests){const single=await quotePositionSell(f.rpc,request.mint,request.fullBaseUnits,f.rec,Math.max(...f.requests.map(r=>r.minSlot??0)));assert.deepEqual(result.quotes[request.mint.toBase58()],single);}
    assert.equal(f.calls.length-batchCalls,count*3);
    assert.ok(result.context);assert.equal(result.context.receivedAt,result.quotes[f.requests[0]!.mint.toBase58()]!.receivedAt);
  }finally{f.close();}
});
test('bad initial identity or one missing vault does not erase another supported holding',async()=>{
  for(const failure of ['initial','dependency','links'] as const){const f=fixture(2);try{
    if(failure==='initial')f.missingInitial();else if(failure==='dependency')f.missingDependency(f.captures[0]!.state.addresses[5]);else f.changeLinks();
    const result=await quotePositionsSell(f.rpc,f.requests,f.rec);assert.equal(result.quotes[f.requests[0]!.mint.toBase58()],undefined);assert.ok(result.unavailable[f.requests[0]!.mint.toBase58()]);assert.ok(result.quotes[f.requests[1]!.mint.toBase58()]);assert.equal(f.calls.length,3);
  }finally{f.close();}}
});
test('batch bounds and duplicates reject before network; shared stale/regressing contexts cannot quote',async()=>{
  const f=fixture();try{
    await assert.rejects(quotePositionsSell(f.rpc,[],f.rec),/CAPACITY/);await assert.rejects(quotePositionsSell(f.rpc,Array(4).fill(f.requests[0]),f.rec),/CAPACITY/);
    await assert.rejects(quotePositionsSell(f.rpc,[f.requests[0]!,f.requests[0]!],f.rec),/DUPLICATE/);await assert.rejects(quotePositionsSell(f.rpc,[{...f.requests[0]!,fullBaseUnits:0n}],f.rec),/SIZE/);assert.equal(f.rpc.calls,0);
  }finally{f.close();}
  for(const fail of ['regress','stale','missingBlock'] as const){const g=fixture();try{g[fail]();await assert.rejects(quotePositionsSell(g.rpc,g.requests,g.rec),/REGRESSING_POOL_BATCH_CONTEXT|NOT_CURRENT/);assert.equal(g.records.some(r=>r.kind==='position-size-sell-quote'),false);}finally{g.close();}}
});
test('batch retains original receive time after slow validation and snapshots requested quantities',async()=>{
  const f=fixture();try{
    f.slow();const request={...f.requests[0]!},expected=request.fullBaseUnits,pending=quotePositionsSell(f.rpc,[request],f.rec);request.fullBaseUnits=1n;
    const result=await pending,quote=result.quotes[request.mint.toBase58()]!;assert.equal(quote.sell.inputBaseUnits,expected.toString());assert.equal(Date.parse(quote.receivedAt),f.at);assert.equal(Date.parse(quote.validatedAt)-Date.parse(quote.receivedAt),2100);
    // Caller freshness policy must refuse this quote; validation did not retime it.
  }finally{f.close();}
});

test('evidence storage pressure propagates instead of becoming a pool exclusion',async()=>{
  const f=fixture(2);try{await assert.rejects(quotePositionsSell(f.rpc,f.requests,{record(kind){if(kind==='position-size-sell-quote')throw Error('STORAGE_PRESSURE');}}),/STORAGE_PRESSURE/);assert.equal(f.rpc.calls,3);}finally{f.close();}
});
