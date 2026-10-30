import {test} from 'node:test';import assert from 'node:assert/strict';
import {fetchPublicUsdPrice,type PublicUsdPriceObservation} from '../src/valuation.js';
test('USD valuation uses only public spot endpoint and preserves integer conversion',async()=>{
  const p=await fetchPublicUsdPrice((async(url,init)=>{
    assert.equal(url,'https://api.coinbase.com/v2/prices/SOL-USD/spot');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.ok(init?.signal);assert.equal(init?.headers,undefined);
    return new Response(JSON.stringify({data:{base:'SOL',currency:'USD',amount:'123.4567898'}}));
  }) as typeof fetch);
  assert.equal(p.microUsdPerSol,'123456789');assert.ok(Date.now()-p.at<1000);
});
test('USD failures retain bounded source timing and HTTP reason without leaking provider bodies or exception messages',async()=>{
 const observations:PublicUsdPriceObservation[]=[];let calls=0;
 await assert.rejects(fetchPublicUsdPrice((async()=>{calls++;return new Response('PRIVATE_PROVIDER_RESPONSE',{status:429});})as typeof fetch,f=>observations.push(f)),/USD_PRICE_UNAVAILABLE/);
 assert.equal(calls,1);assert.equal(observations.length,1);const f=observations[0]!;assert.equal(f.reasonCode,'USD_PRICE_HTTP_STATUS');assert.equal(f.httpStatus,429);assert.equal(f.outcome,'unavailable');assert.equal(f.receivedAt,null);assert.equal(f.publicationTimeKnown,false);assert.ok(f.completedAt>=f.startedAt);assert.ok(f.durationMs>=0);assert.ok(!JSON.stringify(f).includes('PRIVATE'));
 await assert.rejects(fetchPublicUsdPrice((async()=>{throw new DOMException('PRIVATE_TRANSPORT_MESSAGE','TimeoutError');})as typeof fetch,f=>observations.push(f)));
 assert.equal(observations[1]!.reasonCode,'USD_PRICE_TIMEOUT');assert.equal(observations[1]!.httpStatus,null);assert.ok(!JSON.stringify(observations).includes('PRIVATE'));
 await assert.rejects(fetchPublicUsdPrice((async()=>new Response('not-json'))as typeof fetch,f=>observations.push(f)));
 assert.equal(observations[2]!.reasonCode,'USD_PRICE_INVALID');assert.equal(observations[2]!.httpStatus,200);
});
test('valid USD observation retains actual receipt time and a failed optional observer cannot block valuation',async()=>{
 const transport=(async()=>new Response(JSON.stringify({data:{base:'SOL',currency:'USD',amount:'96.25'}})))as typeof fetch;
 let observation:PublicUsdPriceObservation|undefined;const p=await fetchPublicUsdPrice(transport,f=>{observation=f;throw Error('optional diagnostic unavailable');});
 assert.equal(p.microUsdPerSol,'96250000');assert.equal(observation?.reasonCode,'USD_PRICE_RECEIVED');assert.equal(observation?.receivedAt,p.at);assert.equal(observation?.publicationTimeKnown,false);
});
test('wrong currency and oversized USD observations cannot become fresh valuations',async()=>{
  await assert.rejects(fetchPublicUsdPrice((async()=>new Response(JSON.stringify({data:{base:'SOL',currency:'EUR',amount:'123'}}))) as typeof fetch),/INVALID/);
  let cancelled=false;
  await assert.rejects(fetchPublicUsdPrice((async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(2049));},cancel(){cancelled=true;}}))) as typeof fetch),/TOO_LARGE/);
  assert.equal(cancelled,true);
});
