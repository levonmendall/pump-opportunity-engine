import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadOnlyRpc,dataMessage} from '../src/network.js';
test('PAPER rejects submission, simulation, wallet signing and provider trading without making requests',async()=>{
  let calls=0;const fake=(async()=>{calls++;throw new Error('unexpected request');}) as typeof fetch;
  const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',fake);
  for(const method of ['sendTransaction','sendRawTransaction','signTransaction','signAllTransactions','simulateTransaction','requestAirdrop','trade','trade-local','https://pumpportal.fun/api/trade'])await assert.rejects(rpc.call(method),/DENIED/);
  assert.equal(calls,0);
  for(const method of ['trade','buy','sell','signTransaction','subscribeAccountTrade','subscribeNewToken'])assert.throws(()=>dataMessage(method),/DENIED/);
  assert.throws(()=>dataMessage('subscribeTokenTrade',['mint']),/NOT_APPROVED/);
  assert.deepEqual(JSON.parse(dataMessage('subscribeMigration')),{method:'subscribeMigration'});
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
