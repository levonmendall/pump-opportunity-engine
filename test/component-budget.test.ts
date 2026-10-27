import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComponentBudget,COMPONENT_LIMITS,type ComponentOperation,type ComponentKind} from '../src/component-budget.js';
const MIB=1024*1024;
const HTTP:ComponentKind={transport:'http',method:'getMultipleAccounts'},UPGRADE:ComponentKind={transport:'ws-upgrade',method:'upgrade'},SUB:ComponentKind={transport:'ws',method:'accountSubscribe'};
function fixture(t:TestContext,recent=false){
  const dir=mkdtempSync(join(tmpdir(),'poe-component-budget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let now=100000;
  const options={statePath:join(dir,'budget.json'),grantId:'component-fixture',baseline:{calls:20,bytes:272634,starts:Array.from({length:20},(_,i)=>recent?99000:i),refusal:'RPC_HTTP_429' as const,refusalAt:99000,sha256:'a'.repeat(64)},startedAt:100000,now:()=>now,monotonic:()=>now,sleep:async(ms:number)=>{now+=ms;}};
  return {options,get now(){return now;},set now(n:number){now=n;},read:()=>JSON.parse(readFileSync(options.statePath,'utf8'))};
}
const done=async(c:ComponentOperation)=>{c.completeResponse();return 'ok';};

test('all HTTP/upgrade/subscription starts share durable cumulative counters, pacing and one source baseline',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);let work=0;
  try{
    const response=async(c:ComponentOperation)=>{work++;const saved=f.read();assert.equal(saved.baseline.calls,20);assert.equal(saved.starts.length,work);assert.equal(c.id,20+work);assert.equal(saved.pending.at(-1).id,c.id);if(work===1)c.chargeHttp(123);else b.chargeWs(17);c.completeResponse();return c.id;};
    assert.equal(await b.operate(HTTP,response),21);assert.equal(await b.operate(UPGRADE,response),22);assert.equal(await b.operate(SUB,response),23);
    assert.deepEqual(b.usage().starts,[100000,101000,102000]);assert.equal(b.calls,23);assert.equal(b.newUnits,3);assert.equal(b.bytes,272634+123+34);assert.equal(b.usage().baseline.refusal,'RPC_HTTP_429');assert.equal(b.usage().uncertainResponseBytes,0);
    const baseline=JSON.stringify(f.options.baseline);b.close();const resumed=new ComponentBudget(f.options);assert.equal(resumed.calls,23);assert.equal(JSON.stringify(resumed.usage().baseline),baseline);resumed.close();
  }finally{if(!b.usage().closed)b.close();}
});

test('recent prior starts participate in rolling ceilings and all70 new units include WS management',async t=>{
  const f=fixture(t,true),b=new ComponentBudget(f.options);
  try{
    for(let i=0;i<70;i++)await b.operate(i%2?SUB:HTTP,done);
    assert.equal(b.calls,90);assert.equal(b.newUnits,70);assert.ok(f.now<190000);assert.equal(b.usage().starts[40],159000);assert.ok(b.usage().rolling60SecondStarts<=60);assert.ok(b.usage().rolling10SecondStarts<=30);
    await assert.rejects(b.operate(UPGRADE,done),/UNIT_CAP/);assert.equal(b.calls,90);assert.equal(b.usage().haltedReason,'COMPONENT_UNIT_CAP');
  }finally{b.close();}
});

test('cancel while waiting consumes no new request or reservation and does not rewrite the stored book',async t=>{
  const f=fixture(t);let waiting=false;
  const b=new ComponentBudget({...f.options,sleep:async(_ms,signal)=>{waiting=true;await new Promise<void>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Error('COMPONENT_ABORTED')),{once:true}));}});
  try{
    await b.operate(HTTP,done);const before=readFileSync(f.options.statePath,'utf8'),abort=new AbortController(),next=b.operate(SUB,done,abort.signal);assert.equal(waiting,true);abort.abort();await assert.rejects(next,/ABORTED/);
    assert.equal(b.calls,21);assert.equal(b.usage().pending.length,0);assert.equal(readFileSync(f.options.statePath,'utf8'),before);
  }finally{b.close();}
});

test('actual transport invocations remain spaced when durable reservation writes have variable latency',async t=>{
  const f=fixture(t);let writes=0;const actual:number[]=[];
  const b=new ComponentBudget({...f.options,beforePersist(){if(++writes===2)f.now+=400;}});
  try{
    for(const kind of [HTTP,UPGRADE,SUB])await b.operate(kind,async c=>{actual.push(f.now);c.completeResponse();});
    assert.deepEqual(actual,[100400,101400,102400]);assert.deepEqual(b.usage().starts,actual);
    assert.deepEqual(b.usage().reservationStarts,[100000,101400,102400]);
    assert.ok(actual.slice(1).every((at,i)=>at-actual[i]!>=1000));
    const saved=f.read();assert.deepEqual(saved.actualInvocations.map((r:{at:number})=>r.at),actual);assert.equal(b.calls,23);
  }finally{b.close();}
});

test('timeout retains a stalled physical operation and uncertain bytes without a second attempt',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);let release!:(value:string)=>void;
  try{
    const next=b.operate(HTTP,async()=>new Promise<string>(resolve=>{release=resolve;}),undefined,{timeoutMs:5});
    await assert.rejects(next,/PHYSICAL_TIMEOUT/);assert.equal(b.inFlight,1);assert.equal(b.calls,21);assert.equal(b.usage().uncertainResponseBytes,2*MIB);
    await assert.rejects(b.operate(SUB,done),/HALTED/);assert.throws(()=>b.close(),/PHYSICAL_SLOT/);release('late');for(let i=0;i<5&&b.inFlight;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(b.inFlight,0);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.equal(b.calls,21);
  }finally{b.close();}
});

test('HTTP429 is charged once, stops the new grant and remains sticky without changing historical refusal',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);let transports=0;
  try{
    await assert.rejects(b.operate(HTTP,async c=>{transports++;c.chargeHttp(41);c.completeResponse();throw Error('HTTP_429 private provider text must not leak');}),/^Error: COMPONENT_HTTP_429$/);
    assert.equal(b.calls,21);assert.equal(b.usage().httpBytes,41);assert.equal(b.usage().uncertainResponseBytes,0);assert.equal(b.usage().haltedReason,'COMPONENT_HTTP_429');assert.equal(b.usage().baseline.refusal,'RPC_HTTP_429');
    await assert.rejects(b.operate(SUB,done),/HALTED/);assert.equal(transports,1);b.close();const again=new ComponentBudget(f.options);await assert.rejects(again.operate(HTTP,done),/HALTED/);assert.equal(again.calls,21);again.close();
  }finally{if(!b.usage().closed)b.close();}
});

test('passive WS bytes count without request units; HTTP category retains cancellation headroom',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);
  try{
    for(let i=0;i<11;i++)await b.operate(HTTP,async c=>{c.chargeHttp(2*MIB);c.completeResponse();});
    for(let i=0;i<3;i++)b.chargeWs(2*MIB);
    assert.equal(b.newUnits,11);assert.equal(b.usage().httpBytes,22*MIB);assert.equal(b.usage().wsBytes,6*MIB);
    await assert.rejects(b.operate(HTTP,done),/RESPONSE_RESERVE/);assert.equal(b.newUnits,11);assert.equal(b.usage().haltedReason,'COMPONENT_RESPONSE_RESERVE');
  }finally{b.close();}
});

test('oversized actual response bytes are retained and halt before any further operation',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);
  try{
    await assert.rejects(b.operate(HTTP,async c=>{c.chargeHttp(2*MIB);c.chargeHttp(1);c.completeResponse();}),/RESPONSE_BYTE_CAP/);
    assert.equal(b.usage().httpBytes,2*MIB+1);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.equal(b.calls,21);await assert.rejects(b.operate(SUB,done),/HALTED/);
  }finally{b.close();}
});

test('grant deadline and explicit cooldown are enforced during pacing before another start',async t=>{
  const f=fixture(t),b=new ComponentBudget({...f.options,notBefore:200000});
  try{await assert.rejects(b.operate(HTTP,done),/TIME_CAP/);assert.equal(f.now,190000);assert.equal(b.newUnits,0);assert.equal(b.calls,20);assert.equal(b.usage().pending.length,0);}
  finally{b.close();}
});

test('explicit ten-minute migration listener duration persists and cannot be enlarged or silently resumed with another duration',async t=>{
  const f=fixture(t),options={...f.options,totalMs:600000},b=new ComponentBudget(options);
  try{
    await b.operate({transport:'ws',method:'subscribeMigration'},done);
    assert.equal(b.usage().totalMs,600000);assert.equal(b.usage().deadlineAt,700000);assert.equal(f.read().totalMs,600000);
    f.now=650000;await b.operate(HTTP,done);assert.equal(b.calls,22);
    b.close();assert.throws(()=>new ComponentBudget(f.options),/INVALID_STATE/);
    const resumed=new ComponentBudget(options);assert.equal(resumed.usage().deadlineAt,700000);resumed.close();
  }finally{if(!b.usage().closed)b.close();}
  for(const totalMs of [0,600001,1.5,Number.NaN])assert.throws(()=>new ComponentBudget({...f.options,totalMs}),/INVALID_DURATION/);
});

test('minimum duration is bounded and free migration permission does not permit metered or trading subscriptions',async t=>{
  const f=fixture(t),b=new ComponentBudget({...f.options,totalMs:1});
  try{
    for(const method of ['subscribeTokenTrade','unsubscribeTokenTrade','subscribeAccountTrade','subscribeNewToken','trade','signTransaction','sendTransaction'])await assert.rejects(b.operate({transport:'ws',method},done),/DENIED/);
    assert.equal(b.calls,20);f.now++;await assert.rejects(b.operate({transport:'ws',method:'subscribeMigration'},done),/TIME_CAP/);assert.equal(b.calls,20);
  }finally{b.close();}
});

test('signing/simulation/trading, concurrent ownership and malformed baseline are denied offline',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);
  try{
    for(const method of ['sendTransaction','simulateTransaction','signTransaction','trade'])await assert.rejects(b.operate({transport:'http',method},done),/DENIED/);
    assert.equal(b.calls,20);assert.throws(()=>new ComponentBudget(f.options),/OWNED/);assert.throws(()=>new ComponentBudget({...f.options,baseline:{...f.options.baseline,starts:[]}}),/INVALID_BASELINE/);
  }finally{b.close();}
  assert.equal(COMPONENT_LIMITS.totalMs,90000);
});
