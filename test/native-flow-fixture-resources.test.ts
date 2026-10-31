/** OFFLINE watchdog checks. A deterministic process measurement keeps these
 * resource scenarios independent of allocator/GC timing in the test runner. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup,scope} from './native-flow-fixture.js';

const MIB=1024*1024;

test('native mechanics fixture has finite RSS headroom for unrelated retained test data',async t=>{
 let rss=512*MIB;const actual=process.memoryUsage();t.mock.method(process,'memoryUsage',()=>({...actual,rss}));
 const f=setup();t.after(()=>f.flow.stop());const socket=await f.open();
 await f.advance(100);assert.equal(f.flow.usage().fatal,null);assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,false);assert.equal(socket.readyState,1);
 const declared=f.records.find(r=>r.kind==='native-flow-contract')!.data.limits.maximumRssBytes;assert.equal(declared,1024*MIB);
 rss=declared+1;await f.advance(100);assert.equal(f.flow.usage().fatal,'NATIVE_FLOW_RESOURCE_LIMIT');assert.equal(socket.readyState,3);
});

test('explicit native fixture RSS cutoff remains enforced below the mechanics allowance',async t=>{
 const actual=process.memoryUsage();t.mock.method(process,'memoryUsage',()=>({...actual,rss:512*MIB}));
 const f=setup({maximumRssBytes:384*MIB});t.after(()=>f.flow.stop());const socket=await f.open();
 await f.advance(100);assert.equal(f.flow.usage().fatal,'NATIVE_FLOW_RESOURCE_LIMIT');assert.equal(f.flow.snapshot(scope.mint)!.hasQualityLoss,true);assert.equal(f.gaps[0]!.reason,'NATIVE_FLOW_RESOURCE_LIMIT');assert.equal(socket.readyState,3);
});
