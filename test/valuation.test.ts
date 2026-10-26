import {test} from 'node:test';import assert from 'node:assert/strict';
import {fetchPublicUsdPrice} from '../src/valuation.js';
test('USD valuation uses only public spot endpoint and preserves integer conversion',async()=>{
  const p=await fetchPublicUsdPrice((async(url,init)=>{
    assert.equal(url,'https://api.coinbase.com/v2/prices/SOL-USD/spot');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal(init?.headers,undefined);
    return new Response(JSON.stringify({data:{base:'SOL',currency:'USD',amount:'123.4567898'}}));
  }) as typeof fetch);
  assert.equal(p.microUsdPerSol,'123456789');assert.ok(Date.now()-p.at<1000);
});
test('wrong currency and oversized USD observations cannot become fresh valuations',async()=>{
  await assert.rejects(fetchPublicUsdPrice((async()=>new Response(JSON.stringify({data:{base:'SOL',currency:'EUR',amount:'123'}}))) as typeof fetch),/INVALID/);
  let cancelled=false;
  await assert.rejects(fetchPublicUsdPrice((async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(2049));},cancel(){cancelled=true;}}))) as typeof fetch),/TOO_LARGE/);
  assert.equal(cancelled,true);
});
