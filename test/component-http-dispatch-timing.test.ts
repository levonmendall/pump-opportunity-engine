import {test} from 'node:test';
import assert from 'node:assert/strict';
import {channel} from 'node:diagnostics_channel';
import {AsyncResource} from 'node:async_hooks';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport,observeComponentHttpDispatch} from '../src/component-transport.js';
const origin='https://api.mainnet.solana.com',request=()=>({origin,path:'/',method:'POST'}),publish=(name:string,value:unknown)=>channel('undici:'+name).publish(value);
const names=['undici:request:create','undici:client:sendHeaders','undici:request:headers','undici:request:error'];
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
function setup(){let at=200000;const dir=mkdtempSync(join(tmpdir(),'poe-http-dispatch-'));const budget=new ComponentBudget({statePath:join(dir,'book.json'),grantId:'test-http-dispatch',startedAt:at,baseline:{calls:20,bytes:272634,starts:Array.from({length:20},(_,i)=>1000+i),refusal:'RPC_HTTP_429',refusalAt:2000,sha256:'a'.repeat(64)},now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;}});return {budget,now:()=>at,advance(ms:number){at+=ms;},cleanup(){budget.close();rmSync(dir,{recursive:true,force:true});}};}

test('injected fetch without real dispatcher events remains explicitly unavailable',async()=>{
 const f=setup(),rows:any[]=[];try{const c=new ComponentTransport(f.budget,(kind,data)=>rows.push({kind,data}),()=>{},f.now,(async()=>new Response('{"jsonrpc":"2.0","id":21,"result":1}'))as typeof fetch);assert.equal(await c.call('getSlot'),1);const r=rows.find(x=>x.kind==='http-lifecycle-timing').data;assert.equal(r.undiciObservation,'unavailable-no-matched-events');assert.equal(r.undiciRequestCreatedAt,null);assert.equal(r.undiciSendHeadersHookAt,null);assert.equal(r.undiciSocketId,null);assert.equal(r.undiciSocketPreviouslyObserved,null);assert.match(r.connectionReuse,/not-instrumented/);assert.equal(f.budget.newUnits,1);}finally{f.cleanup();}
});

test('dispatch timing matches its invocation context/request and never touches payload, headers or socket addresses',async()=>{
 const f=setup(),rows:any[]=[],unrelated=new AsyncResource('unrelated-http-work'),socket={get remoteAddress(){throw Error('ADDRESS_MUST_NOT_BE_READ');}},before=names.map(n=>channel(n).hasSubscribers);
 try{const c=new ComponentTransport(f.budget,(kind,data)=>rows.push({kind,data}),()=>{},f.now,(async()=>{
  publish('request:create',{request:{...request(),origin:'https://api.coinbase.com'}});unrelated.runInAsyncScope(()=>publish('request:create',{request:request()}));
  const own={...request(),get body(){throw Error('BODY_MUST_NOT_BE_READ');}};f.advance(5);publish('request:create',{request:own});publish('client:sendHeaders',{request:request(),socket});f.advance(10);publish('client:sendHeaders',{request:own,socket,get headers(){throw Error('HEADERS_MUST_NOT_BE_READ');}});f.advance(30);publish('request:headers',{request:own,response:{statusCode:200,get headers(){throw Error('RESPONSE_HEADERS_MUST_NOT_BE_READ');}}});return new Response('{"jsonrpc":"2.0","id":21,"result":2}');
 })as typeof fetch);assert.equal(await c.call('getSlot'),2);const r=rows.find(x=>x.kind==='http-lifecycle-timing').data;assert.equal(r.undiciObservation,'observed');assert.equal(r.undiciRequestCreatedAt,200005);assert.equal(r.undiciSendHeadersHookAt,200015);assert.equal(r.undiciResponseHeadersAt,200045);assert.equal(r.undiciResponseStatus,200);assert.equal(r.undiciSocketPreviouslyObserved,false);assert.ok(r.undiciSocketId>0);assert.equal(r.undiciMatchedRequestCount,1);assert.equal(r.undiciSendHeadersHookCount,1);for(const k of ['undiciRequestCreatedDelayMs','undiciHeadersDispatchDelayMs','undiciResponseHeadersDelayMs'])assert.ok(r[k]>=0);assert.match(r.connectionReuse,/prior-use-unavailable/);assert.match(r.undiciMeaning,/Not provider origin time/);assert.deepEqual(names.map(n=>channel(n).hasSubscribers),before);assert.equal(JSON.stringify(rows).includes('MUST_NOT'),false);
 }finally{unrelated.emitDestroy();f.cleanup();}
});

test('same socket object across transports proves prior observed request use, not first-observation newness',async()=>{
 const socket={},captured:any[]=[];for(let i=0;i<2;i++){const f=setup();f.advance(i*10000);try{const c=new ComponentTransport(f.budget,(kind,data)=>{if(kind==='http-lifecycle-timing')captured.push(data);},()=>{},f.now,(async()=>{const own=request();publish('request:create',{request:own});publish('client:sendHeaders',{request:own,socket});publish('request:headers',{request:own,response:{statusCode:200}});return new Response('{"jsonrpc":"2.0","id":21,"result":1}');})as typeof fetch);await c.call('getSlot');}finally{f.cleanup();}}
 assert.equal(captured[0].undiciSocketPreviouslyObserved,false);assert.equal(captured[1].undiciSocketPreviouslyObserved,true);assert.equal(captured[0].undiciSocketId,captured[1].undiciSocketId);assert.equal(captured[1].undiciSocketPreviousRequestAt,200000);assert.match(captured[1].connectionReuse,/same-socket-observed/);
});

test('ambiguous nested matching request cannot claim timings or connection reuse',()=>{
 const o=observeComponentHttpDispatch(()=>200000);o.run(()=>{const a=request(),b=request();publish('request:create',{request:a});publish('client:sendHeaders',{request:a,socket:{}});publish('request:create',{request:b});publish('request:headers',{request:b,response:{statusCode:200}});});const r=o.finish();assert.equal(r.undiciObservation,'ambiguous-multiple-request-or-send');assert.equal(r.undiciMatchedRequestCount,2);assert.equal(r.undiciRequestCreatedAt,null);assert.equal(r.undiciSendHeadersHookAt,null);assert.equal(r.undiciSocketId,null);assert.equal(r.undiciSocketPreviouslyObserved,null);
});

test('multiple header sends on one request are bounded ambiguity, not inferred automatic retry success',()=>{
 const o=observeComponentHttpDispatch(()=>200000);o.run(()=>{const own=request();publish('request:create',{request:own});for(let i=0;i<5;i++)publish('client:sendHeaders',{request:own,socket:{}});});const r=o.finish();assert.equal(r.undiciObservation,'ambiguous-multiple-request-or-send');assert.equal(r.undiciMatchedRequestCount,1);assert.equal(r.undiciSendHeadersHookCount,2);assert.equal(r.undiciSocketId,null);
});

test('malformed diagnostic properties cannot throw into network or financial work',()=>{
 const before=names.map(n=>channel(n).hasSubscribers),o=observeComponentHttpDispatch(()=>200000);assert.doesNotThrow(()=>o.run(()=>publish('request:create',{get request(){throw Error('PRIVATE_PAYLOAD');}})));const r=o.finish();assert.equal(r.undiciObservation,'unavailable-listener-observation');assert.equal(r.undiciRequestCreatedAt,null);assert.equal(JSON.stringify(r).includes('PRIVATE_PAYLOAD'),false);assert.deepEqual(names.map(n=>channel(n).hasSubscribers),before);
});

test('error metadata is request matched, allowlisted, and does not claim physical settlement',()=>{
 let at=200000;const o=observeComponentHttpDispatch(()=>at);o.run(()=>{const own=request();publish('request:create',{request:own});publish('request:error',{request:request(),error:{code:'ECONNRESET'}});at++;publish('request:error',{request:own,error:{code:'PRIVATE_UNKNOWN_CODE',message:'PRIVATE_MESSAGE',stack:'PRIVATE_STACK'}});});const r=o.finish();assert.equal(r.undiciRequestErrorAt,200001);assert.equal(r.undiciRequestErrorCode,'UNAVAILABLE');assert.equal(r.undiciSendHeadersHookAt,null);assert.equal(r.undiciResponseHeadersAt,null);assert.match(r.undiciMeaning,/Not.*physical settlement/);assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);
});

test('abort error is captured before physical-work cleanup without changing accounting',{timeout:3000},async()=>{
 const f=setup(),rows:any[]=[],before=names.map(n=>channel(n).hasSubscribers);try{const c=new ComponentTransport(f.budget,(kind,data)=>rows.push({kind,data}),()=>{},f.now,((_url,options)=>new Promise<Response>((_resolve,reject)=>{const own=request();publish('request:create',{request:own});publish('client:sendHeaders',{request:own,socket:{}});options!.signal!.addEventListener('abort',()=>{publish('request:error',{request:own,error:{code:'ABORT_ERR',message:'PRIVATE_ERROR'}});reject(Error('PRIVATE_ERROR'));},{once:true});}))as typeof fetch);await assert.rejects(c.call('getSlot',[],undefined,{timeoutMs:10}),/PHYSICAL_TIMEOUT/);for(let i=0;i<20&&f.budget.inFlight;i++)await turn();const r=rows.find(x=>x.kind==='http-lifecycle-timing').data;assert.equal(r.undiciObservation,'observed');assert.equal(r.undiciRequestErrorCode,'ABORT_ERR');assert.equal(r.undiciResponseHeadersAt,null);assert.equal(r.aborted,true);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);assert.equal(f.budget.inFlight,0);assert.equal(JSON.stringify(rows).includes('PRIVATE_ERROR'),false);assert.deepEqual(names.map(n=>channel(n).hasSubscribers),before);}finally{f.cleanup();}
});

test('logical timeout cannot remove observers before actual fetch work settles; late events stay source timed',{timeout:3000},async()=>{
 const f=setup(),rows:any[]=[],before=names.map(n=>channel(n).hasSubscribers);let own:object,release!:(v:Response)=>void;try{const c=new ComponentTransport(f.budget,(kind,data)=>rows.push({kind,data}),()=>{},f.now,(()=>new Promise<Response>(resolve=>{own=request();publish('request:create',{request:own});release=resolve;}))as typeof fetch);await assert.rejects(c.call('getSlot',[],undefined,{timeoutMs:10}),/PHYSICAL_TIMEOUT/);assert.equal(f.budget.inFlight,1);assert.equal(rows.some(x=>x.kind==='http-lifecycle-timing'),false);f.advance(20);publish('client:sendHeaders',{request:own!,socket:{}});release(new Response('{"jsonrpc":"2.0","id":21,"result":1}'));for(let i=0;i<20&&f.budget.inFlight;i++)await turn();const r=rows.find(x=>x.kind==='http-lifecycle-timing').data;assert.equal(r.undiciSendHeadersHookAt,200020);assert.equal(r.aborted,true);assert.equal(r.bodyCompleteAt,null);assert.equal(f.budget.usage().uncertainResponseBytes,2*1024*1024);assert.deepEqual(names.map(n=>channel(n).hasSubscribers),before);const closed=JSON.stringify(r);publish('request:error',{request:own!,error:{code:'ECONNRESET'}});assert.equal(JSON.stringify(r),closed);}finally{f.cleanup();}
});

test('Node actual loopback fetch emits request/send/headers events and observed socket reuse without provider access',{timeout:5000},async()=>{
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const endpoint='http://127.0.0.1:'+address.port+'/',rows:ReturnType<ReturnType<typeof observeComponentHttpDispatch>['finish']>[]=[];
 try{for(let i=0;i<3;i++){const o=observeComponentHttpDispatch(Date.now,endpoint);try{const response=await o.run(()=>fetch(endpoint,{method:'POST',body:'{}'}));assert.deepEqual(await response.json(),{ok:true});}finally{rows.push(o.finish());}await turn();}assert.ok(rows.every(r=>r.undiciObservation==='observed'&&r.undiciSendHeadersHookAt!==null&&r.undiciResponseHeadersAt!==null&&r.undiciResponseStatus===200));assert.ok(rows.some(r=>r.undiciSocketPreviouslyObserved===true));}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
