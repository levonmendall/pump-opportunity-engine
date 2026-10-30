import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ResearchRpc,RESEARCH_RPC_LIMITS} from '../src/research-rpc.js';

const fixture=(t:TestContext)=>{const directory=mkdtempSync(join(tmpdir(),'poe-research-rpc-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return join(directory,'budget.json');};
const wire=(async(url,init)=>{assert.equal(url,'https://api.mainnet.solana.com');assert.equal(init?.redirect,'error');assert.deepEqual(init?.headers,{'content-type':'application/json'});const b=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:7}));}) as typeof fetch;

test('approved research budget uses only public read methods and persists before transport',async t=>{
  const path=fixture(t);let requests=0;
  const rpc=new ResearchRpc({budgetPath:path,now:()=>0,transport:(async(url,init)=>{requests++;const saved=JSON.parse(readFileSync(path,'utf8'));assert.equal(saved.calls,requests);assert.equal(saved.pending.at(-1).unobservedBytes,RESEARCH_RPC_LIMITS.singleResponseBytes);return wire(url,init);}) as typeof fetch});
  for(const method of ['sendTransaction','simulateTransaction','signTransaction','trade','requestAirdrop'])await assert.rejects(rpc.call(method),/DENIED/);
  assert.equal(requests,0);assert.equal(await rpc.call('getSlot'),7);assert.equal(rpc.calls,1);assert.ok(rpc.bytes>0);assert.equal(rpc.usage().uncertainResponseBytes,0);rpc.close();
  const resumed=new ResearchRpc({budgetPath:path,now:()=>0,transport:wire});assert.equal(resumed.calls,1);assert.equal(resumed.usage().byMethod.getSlot,1);resumed.close();
});

test('rolling30/10s and150/min ceilings survive reopening and total attempts stop at240',async t=>{
  const path=fixture(t);let now=0,rpc=new ResearchRpc({budgetPath:path,now:()=>now,transport:wire});
  for(let minute=0;minute<2;minute++){
    for(let group=0;group<5;group++){
      now=minute*60_000+group*10_000;const remaining=Math.min(30,240-rpc.calls);
      for(let i=0;i<remaining;i++)await rpc.call('getSlot');
      if(rpc.calls===240)break;
      await assert.rejects(rpc.call('getSlot'),/10S_CAP/);
      assert.equal(rpc.usage().nextStartAfterMs,rpc.calls===150?20_000:10_000);
    }
    if(rpc.calls===240)break;
    now=50_000;await assert.rejects(rpc.call('getSlot'),/60S_CAP/);assert.equal(rpc.calls,150);
    rpc.close();rpc=new ResearchRpc({budgetPath:path,now:()=>now,transport:wire});await assert.rejects(rpc.call('getSlot'),/60S_CAP/);
  }
  assert.equal(rpc.calls,240);await assert.rejects(rpc.call('getSlot'),/CALL_CAP/);assert.ok(rpc.durationsMs.length<=128);rpc.close();
});

test('429 body bytes count, no retry occurs and stricter provider block survives restart',async t=>{
  const path=fixture(t);let requests=0;const privateBody='DO-NOT-EXPOSE-body';
  const rpc=new ResearchRpc({budgetPath:path,now:()=>0,transport:(async()=>{requests++;return new Response(privateBody,{status:429});}) as typeof fetch});
  await assert.rejects(rpc.call('getSlot'),/^Error: RESEARCH_RPC_HTTP_429$/);assert.equal(requests,1);assert.equal(rpc.bytes,Buffer.byteLength(privateBody));assert.equal(rpc.usage().uncertainResponseBytes,0);
  await assert.rejects(rpc.call('getSlot'),/PROVIDER_BLOCKED/);assert.equal(requests,1);rpc.close();
  const resumed=new ResearchRpc({budgetPath:path,now:()=>0,transport:wire});assert.equal(resumed.usage().blockedReason,'RPC_HTTP_429');await assert.rejects(resumed.call('getSlot'),/PROVIDER_BLOCKED/);resumed.close();
});

test('malformed/error/failed responses count actual bytes and cannot leak provider contents',async t=>{
  const path=fixture(t),secret='DISPOSABLE-response-do-not-print',responses=[secret,JSON.stringify({jsonrpc:'2.0',id:2,error:{code:-32000,message:secret}})];let index=0;
  const rpc=new ResearchRpc({budgetPath:path,now:()=>0,transport:(async()=>new Response(responses[index++]!)) as typeof fetch});
  await assert.rejects(rpc.call('getSlot'),e=>{assert.equal(String(e).includes(secret),false);return true;});
  await assert.rejects(rpc.call('getSlot'),/^Error: RESEARCH_RPC_ERROR_-32000$/);assert.equal(rpc.bytes,responses.reduce((n,s)=>n+Buffer.byteLength(s),0));assert.equal(rpc.calls,2);assert.equal(rpc.usage().uncertainResponseBytes,0);rpc.close();
});

test('canceled ignored transport retains physical capacity and uncertain response reservation after restart',async t=>{
  const path=fixture(t);let release!:(response:Response)=>void,requests=0;
  const rpc=new ResearchRpc({budgetPath:path,now:()=>0,timeoutMs:100,transport:(async()=>{requests++;return await new Promise<Response>(resolve=>{release=resolve;});}) as typeof fetch});
  const controller=new AbortController(),pending=rpc.call('getSlot',[],controller.signal);controller.abort(new Error('DO-NOT-EXPOSE-abort-reason'));
  await assert.rejects(pending,/RESEARCH_RPC_ABORTED/);assert.equal(rpc.inFlight,1);await assert.rejects(rpc.call('getSlot'),/IN_FLIGHT_CAP/);assert.equal(requests,1);assert.throws(()=>rpc.close(),/IN_FLIGHT_CAP/);
  release(new Response('not-consumed'));await new Promise(resolve=>setImmediate(resolve));assert.equal(rpc.inFlight,0);assert.equal(rpc.bytes,0);assert.equal(rpc.usage().uncertainResponseBytes,RESEARCH_RPC_LIMITS.singleResponseBytes);rpc.close();
  const resumed=new ResearchRpc({budgetPath:path,now:()=>0,transport:wire});assert.equal(resumed.calls,1);assert.equal(resumed.usage().uncertainResponseBytes,RESEARCH_RPC_LIMITS.singleResponseBytes);assert.equal(await resumed.call('getSlot'),7);assert.equal(resumed.usage().uncertainResponseBytes,RESEARCH_RPC_LIMITS.singleResponseBytes);resumed.close();
});

test('a canceled stalled reader is not mistaken for observed response EOF',async t=>{
  const path=fixture(t);let release!:()=>void,canceled=false;
  const rpc=new ResearchRpc({budgetPath:path,now:()=>0,timeoutMs:5,transport:(async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){canceled=true;return new Promise<void>(resolve=>{release=resolve;});}}))) as typeof fetch});
  await assert.rejects(rpc.call('getSlot'),/ABORTED/);assert.equal(canceled,true);assert.equal(rpc.inFlight,1);await assert.rejects(rpc.call('getSlot'),/IN_FLIGHT_CAP/);
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(rpc.inFlight,0);assert.equal(rpc.usage().uncertainResponseBytes,RESEARCH_RPC_LIMITS.singleResponseBytes);rpc.close();
});

test('64MiB aggregate response budget keeps2MiB cancellation headroom and refuses further transport',async t=>{
  const path=fixture(t);let now=0,requests=0;
  const rpc=new ResearchRpc({budgetPath:path,now:()=>now,transport:(async()=>{requests++;return new Response('x'.repeat(RESEARCH_RPC_LIMITS.singleResponseBytes),{status:500});}) as typeof fetch});
  for(let i=0;i<31;i++){now=i*1000;await assert.rejects(rpc.call('getSlot'),/HTTP_500/);}
  assert.equal(rpc.bytes,62*1024*1024);await assert.rejects(rpc.call('getSlot'),/RESPONSE_BUDGET/);assert.equal(requests,31);assert.equal(rpc.bytes<RESEARCH_RPC_LIMITS.responseBytes,true);rpc.close();
});

test('oversized response is counted and canceled without retry',async t=>{
  const path=fixture(t);let canceled=false;
  const rpc=new ResearchRpc({budgetPath:path,now:()=>0,transport:(async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1_100_000));},cancel(){canceled=true;}}))) as typeof fetch});
  await assert.rejects(rpc.call('getSlot'),/RESPONSE_SIZE/);assert.equal(rpc.bytes,2_200_000);assert.equal(canceled,true);assert.equal(rpc.calls,1);assert.equal(rpc.inFlight,0);rpc.close();
});

test('invalid request/abort consumes no capacity; corrupt, alias and simultaneous budget owners fail closed',async t=>{
  const path=fixture(t);let requests=0;const rpc=new ResearchRpc({budgetPath:path,now:()=>0,transport:(async()=>{requests++;throw Error('must not request');}) as typeof fetch});
  const controller=new AbortController();controller.abort(new Error('private abort value'));await assert.rejects(rpc.call('getSlot',[],controller.signal),/^Error: RESEARCH_RPC_ABORTED$/);
  await assert.rejects(rpc.call('getMultipleAccounts',[['x'.repeat(64_000)]]),/REQUEST_SIZE/);assert.equal(rpc.calls,0);assert.equal(requests,0);
  assert.throws(()=>new ResearchRpc({budgetPath:path,now:()=>0,transport:wire}),/BUDGET_OWNED/);rpc.close();
  const alias=path+'.alias';symlinkSync(path,alias);assert.throws(()=>new ResearchRpc({budgetPath:alias,now:()=>0,transport:wire}),/UNSAFE_BUDGET/);
  const saved=JSON.parse(readFileSync(path,'utf8'));saved.budgetId='wrong-assignment';writeFileSync(path,JSON.stringify(saved));assert.throws(()=>new ResearchRpc({budgetPath:path,now:()=>0,transport:wire}),/INVALID_BUDGET/);
  chmodSync(path,0o644);assert.throws(()=>new ResearchRpc({budgetPath:path,now:()=>0,transport:wire}),/UNSAFE_BUDGET/);
});

test('wall clock regression and exhausted provider credit response prevent further risk',async t=>{
  const path=fixture(t);let now=1000;const rpc=new ResearchRpc({budgetPath:path,now:()=>now,transport:(async(_url,init)=>{const b=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,error:{code:-32005,message:'private quota body'}}));}) as typeof fetch});
  await assert.rejects(rpc.call('getSlot'),/ERROR_-32005/);assert.equal(rpc.usage().blockedReason,'RPC_ERROR_-32005');now=999;await assert.rejects(rpc.call('getSlot'),/CLOCK_REGRESSION/);rpc.close();
});
