import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResearchPhaseRpc} from '../src/research-phase.js';
test('phase preserves global counters and reserves maximum in-flight response before transport',async()=>{
  let calls=6,bytes=81729;
  const rpc={get calls(){return calls;},get bytes(){return bytes;},inFlight:0,async call<T>(){calls++;bytes+=1024*1024;return null as T;}};
  const p=new ResearchPhaseRpc(rpc,'SELECTION',48,3*1024*1024);
  await p.call('getTransaction');await p.call('getTransaction');
  await assert.rejects(p.call('getTransaction'),/RESEARCH_PHASE_RESPONSE_RESERVE/);
  assert.equal(calls,8);assert.equal(p.usage().calls,2);assert.equal(bytes,81729+2*1024*1024);
});
test('phase enforces per-method allocation without request retries',async()=>{
  let calls=0;const rpc={get calls(){return calls;},bytes:0,inFlight:0,async call<T>(){calls++;return null as T;}};
  const p=new ResearchPhaseRpc(rpc,'CAPTURE',3,8*1024*1024,{getTransaction:1});
  await p.call('getTransaction');await assert.rejects(p.call('getTransaction'),/RESEARCH_PHASE_METHOD_CAP/);
  await p.call('getBlockTime');await p.call('getMultipleAccounts');await assert.rejects(p.call('getBlockTime'),/RESEARCH_PHASE_REQUEST_CAP/);
  assert.equal(calls,3);
});
