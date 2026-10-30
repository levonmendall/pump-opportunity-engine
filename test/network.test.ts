import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadOnlyRpc,dataMessage} from '../src/network.js';
test('PAPER rejects submission, simulation, wallet signing and provider trading without making requests',async()=>{
  let calls=0;const fake=(async()=>{calls++;throw new Error('unexpected request');}) as typeof fetch;
  const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',fake);
  for(const method of ['sendTransaction','sendRawTransaction','signTransaction','signAllTransactions','simulateTransaction','requestAirdrop','trade','trade-local','https://pumpportal.fun/api/trade'])await assert.rejects(rpc.call(method),/DENIED/);
  assert.equal(calls,0);
  for(const method of ['trade','buy','sell','signTransaction','subscribeAccountTrade'])assert.throws(()=>dataMessage(method),/DENIED/);
  assert.throws(()=>dataMessage('subscribeTokenTrade',['mint']),/NOT_APPROVED/);
  assert.deepEqual(JSON.parse(dataMessage('subscribeMigration')),{method:'subscribeMigration'});
  assert.deepEqual(JSON.parse(dataMessage('subscribeNewToken')),{method:'subscribeNewToken'});
});
test('read client preserves explicit RPC errors and uses bounded HTTPS requests',async()=>{
  const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',(async(_url,init)=>{
    assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal(JSON.parse(String(init?.body)).method,'getSlot');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'fixture error'}}));
  }) as typeof fetch);
  await assert.rejects(rpc.call('getSlot'),/RPC_ERROR_-32000/);
  assert.throws(()=>new ReadOnlyRpc('http://example.com'),/Invalid/);
  for(const url of ['https://pumpportal.fun/api/trade','https://pumpportal.fun/api/trade-local','https://example.com/signTransaction'])assert.throws(()=>new ReadOnlyRpc(url),/Invalid/);
});
test('oversized streamed responses are cancelled before accumulating beyond cap',async()=>{
  let cancelled=false;
  const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',(async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1_100_000));},cancel(){cancelled=true;}}))) as typeof fetch);
  await assert.rejects(rpc.call('getSlot'),/TOO_LARGE/);assert.equal(cancelled,true);
});

test('key-bearing provider URLs and response contents never escape through RPC failure diagnostics',async()=>{
  const secret='DISPOSABLE-provider-credential-do-not-log',endpoint='https://solana-mainnet.g.alchemy.com/v2/'+secret;
  const providers=[
    (async()=>{throw new Error('request failed for '+endpoint);}) as typeof fetch,
    (async()=>new Response(secret+' is not JSON')) as typeof fetch,
    (async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'invalid key '+secret+' at '+endpoint}}))) as typeof fetch,
    (async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:secret,message:secret}}))) as typeof fetch,
  ];
  for(const transport of providers){const rpc=new ReadOnlyRpc(endpoint,transport);await assert.rejects(rpc.call('getSlot'),error=>{const text=String(error);assert.equal(text.includes(secret),false);assert.equal(text.includes(endpoint),false);assert.match(text,/RPC_/);return true;});assert.equal(rpc.calls,1);}
  const controller=new AbortController();controller.abort(new Error(endpoint));const rpc=new ReadOnlyRpc(endpoint,providers[0]);await assert.rejects(rpc.call('getSlot',[],controller.signal),/^Error: RPC_ABORTED$/);assert.equal(rpc.calls,0);
});

test('integration retains100-call lifetime cap; runtime has rolling60s capacity and bounded duration ring',async()=>{
  let now=0;const wire=(async(_url,init)=>{const body=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:7}));}) as typeof fetch;
  const integration=new ReadOnlyRpc('https://fixture.invalid',wire);
  for(let i=0;i<100;i++)assert.equal(await integration.call('getSlot'),7);
  await assert.rejects(integration.call('getSlot'),/INTEGRATION_RPC_CALL_CAP/);assert.equal(integration.calls,100);
  const runtime=new ReadOnlyRpc('https://fixture.invalid',wire,{profile:'runtime',monotonicNow:()=>now,durationSamples:8});
  for(let i=0;i<60;i++)await runtime.call('getSlot');
  await assert.rejects(runtime.call('getSlot'),/RUNTIME_RPC_RATE_CAP/);assert.equal(runtime.calls,60);
  now=59_999;await assert.rejects(runtime.call('getSlot'),/RUNTIME_RPC_RATE_CAP/);
  now=60_000;for(let i=0;i<60;i++)await runtime.call('getSlot');
  assert.equal(runtime.calls,120);assert.equal(runtime.durationsMs.length,8);assert.equal(runtime.usage().rollingMinuteCalls,60);
  for(const opts of [{maxCallsPerMinute:61},{maxInFlight:4},{durationSamples:129},{timeoutMs:12_001}])assert.throws(()=>new ReadOnlyRpc('https://fixture.invalid',wire,{profile:'runtime',...opts}),/Invalid bounded/);
});

test('caller cancellation is immediate and an ignoring transport retains its only physical slot',async()=>{
  let release!:(response:Response)=>void,calls=0;
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async()=>{calls++;return await new Promise<Response>(resolve=>{release=resolve;});}) as typeof fetch,{profile:'runtime',timeoutMs:30});
  const aborted=new AbortController();aborted.abort();await assert.rejects(rpc.call('getSlot',[],aborted.signal));assert.equal(calls,0);
  const controller=new AbortController(),pending=rpc.call('getSlot',[],controller.signal);controller.abort();
  await assert.rejects(pending,/RPC_ABORTED/);assert.equal(rpc.inFlight,1);
  for(let i=0;i<20;i++)await assert.rejects(rpc.call('getSlot'),/RPC_IN_FLIGHT_CAP/);
  assert.equal(calls,1);release(new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:7})));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(rpc.inFlight,0);assert.equal(rpc.durationsMs.length,1);
});

test('deadline cancels a stalled body without waiting for another chunk or leaking capacity',async()=>{
  let canceled=false;
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){canceled=true;}}))) as typeof fetch,{profile:'runtime',timeoutMs:10});
  await assert.rejects(rpc.call('getSlot'),/RPC_ABORTED/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(canceled,true);assert.equal(rpc.inFlight,0);
});

test('a runtime client makes no retries and bounds simultaneous physical requests',async()=>{
  const releases:Array<()=>void>=[];let calls=0;
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async()=>{calls++;await new Promise<void>(r=>releases.push(r));return new Response('denied',{status:429});}) as typeof fetch,{profile:'runtime',maxInFlight:3});
  const attempts=Array.from({length:3},()=>rpc.call('getSlot').catch(e=>e.message));
  await assert.rejects(rpc.call('getSlot'),/RPC_IN_FLIGHT_CAP/);assert.equal(rpc.inFlight,3);
  for(const release of releases)release();assert.deepEqual(await Promise.all(attempts),Array(3).fill('RPC_HTTP_429'));assert.equal(calls,3);assert.equal(rpc.inFlight,0);
});

test('a body whose cancellation stalls retains physical capacity until cancellation settles',async()=>{
  let release!:()=>void,calls=0,cancels=0;
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async()=>{calls++;return new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancels++;return new Promise<void>(resolve=>{release=resolve;});}}));}) as typeof fetch,{profile:'runtime',timeoutMs:5});
  await assert.rejects(rpc.call('getSlot'),/RPC_ABORTED/);assert.equal(cancels,1);assert.equal(rpc.inFlight,1);
  for(let i=0;i<10;i++)await assert.rejects(rpc.call('getSlot'),/RPC_IN_FLIGHT_CAP/);
  assert.equal(calls,1);release();await new Promise(r=>setImmediate(r));assert.equal(rpc.inFlight,0);
});

test('oversized RPC requests fail before consuming rate capacity or reaching transport',async()=>{
  let calls=0;const rpc=new ReadOnlyRpc('https://fixture.invalid',(async()=>{calls++;throw new Error('must not request');}) as typeof fetch,{profile:'runtime'});
  await assert.rejects(rpc.call('getMultipleAccounts',[['x'.repeat(64_000)]]),/RPC_REQUEST_TOO_LARGE/);
  assert.equal(calls,0);assert.equal(rpc.calls,0);assert.equal(rpc.usage().rollingMinuteCalls,0);
});
