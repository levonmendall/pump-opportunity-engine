import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComponentBudget,COMPONENT_LIMITS,LEGACY_COMPONENT_BUDGET_LIMITS,type ComponentOperation,type ComponentKind} from '../src/component-budget.js';
const MIB=1024*1024;
const HTTP:ComponentKind={transport:'http',method:'getMultipleAccounts'},UPGRADE:ComponentKind={transport:'ws-upgrade',method:'upgrade'},SUB:ComponentKind={transport:'ws',method:'accountSubscribe'};
function fixture(t:TestContext,recent=false){
  const dir=mkdtempSync(join(tmpdir(),'poe-component-budget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let now=100000;
  const options={statePath:join(dir,'budget.json'),grantId:'component-fixture',baseline:{calls:20,bytes:272634,starts:Array.from({length:20},(_,i)=>recent?99000:i),refusal:'RPC_HTTP_429' as const,refusalAt:99000,sha256:'a'.repeat(64)},startedAt:100000,now:()=>now,monotonic:()=>now,sleep:async(ms:number)=>{now+=ms;}};
  return {options,get now(){return now;},set now(n:number){now=n;},read:()=>JSON.parse(readFileSync(options.statePath,'utf8'))};
}
const done=async(c:ComponentOperation)=>{c.completeResponse();return 'ok';};

test('explicit passive receipt after chapter expiry preserves bytes but cannot admit a late operation',async t=>{
  const f=fixture(t),b=new ComponentBudget({...f.options,totalMs:1000});try{f.now+=1001;b.chargePassiveWs(75);assert.equal(b.usage().wsBytes,75);assert.equal(b.newUnits,0);assert.equal(b.usage().haltedReason,null);await assert.rejects(b.operate(HTTP,done),/TIME_CAP/);assert.equal(b.newUnits,0);b.chargePassiveWs(7);assert.equal(b.usage().wsBytes,82);assert.equal(b.usage().haltedReason,'COMPONENT_TIME_CAP');assert.equal(f.read().wsBytes,82);}finally{b.close();}
});

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

test('continuous accounting lets admitted physical work cross its chapter without shortening the caller timeout',async t=>{
  const f=fixture(t),b=new ComponentBudget({...f.options,totalMs:20,continuousAccounting:true,limits:{maxCumulativeUnits:null,maxCumulativeBytes:null}});let release!:(value:string)=>void,settled=false;
  try{
    const result=b.operate(HTTP,async c=>{const value=await new Promise<string>(resolve=>{release=resolve;});c.chargeHttp(17);c.completeResponse();return value;},undefined,{timeoutMs:1000,latestStartAt:f.now+10}).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
    await new Promise(resolve=>setImmediate(resolve));f.now+=21;await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(settled,false,'a metadata chapter boundary must not cancel a still-timely physical request');assert.equal(b.inFlight,1);assert.equal(b.calls,21);assert.equal(b.usage().actualInvocations[0]!.at,100000);assert.equal(b.usage().pending.length,1);assert.equal(b.usage().haltedReason,null);
    await assert.rejects(b.operate(SUB,done),/DISPATCH_BUSY/);release('complete after chapter');assert.deepEqual(await result,{value:'complete after chapter'});
    assert.equal(b.inFlight,0);assert.equal(b.usage().httpBytes,17);assert.equal(b.usage().uncertainResponseBytes,0);assert.equal(f.read().lastObservedAt,100021);assert.equal(f.read().haltedReason,null);
    await assert.rejects(b.operate(SUB,done),/TIME_CAP/);assert.equal(b.calls,21,'a settled chapter must roll over before another physical start');
  }finally{release?.('cleanup');for(let i=0;i<8&&b.inFlight;i++)await new Promise(resolve=>setImmediate(resolve));b.close();}
});

test('continuous accounting preserves the actual timeout and occupied physical slot after its chapter expires',async t=>{
  const f=fixture(t),records:Array<{kind:string;data:any}>=[],b=new ComponentBudget({...f.options,totalMs:20,continuousAccounting:true,limits:{maxCumulativeUnits:null,maxCumulativeBytes:null},record:(kind,data)=>records.push({kind,data})});let release!:()=>void;
  try{
    const request=b.operate(HTTP,async()=>{f.now+=21;return new Promise<void>(resolve=>{release=resolve;});},undefined,{timeoutMs:60});const rejected=assert.rejects(request,/COMPONENT_PHYSICAL_TIMEOUT/);await rejected;
    const timeout=records.find(r=>r.kind==='component-physical-timeout')!.data;assert.equal(timeout.requestedTimeoutMs,60);assert.equal(timeout.scheduledDelayMs,60);assert.equal(b.usage().haltedReason,'COMPONENT_PHYSICAL_TIMEOUT');assert.equal(b.inFlight,1);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.throws(()=>b.close(),/PHYSICAL_SLOT/);await assert.rejects(b.operate(SUB,done),/HALTED/);assert.equal(b.calls,21);
    release();for(let i=0;i<8&&b.inFlight;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(b.inFlight,0);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.equal(b.calls,21);
  }finally{release?.();for(let i=0;i<8&&b.inFlight;i++)await new Promise(resolve=>setImmediate(resolve));b.close();}
});

test('bounded research still ends admitted work at its original chapter deadline',async t=>{
  const f=fixture(t),records:Array<{kind:string;data:any}>=[],b=new ComponentBudget({...f.options,totalMs:20,record:(kind,data)=>records.push({kind,data})});let release!:()=>void;
  try{
    const request=b.operate(HTTP,async()=>{f.now+=21;return new Promise<void>(resolve=>{release=resolve;});},undefined,{timeoutMs:1000});await assert.rejects(request,/COMPONENT_TIME_CAP/);
    assert.equal(records.find(r=>r.kind==='component-physical-timeout')!.data.scheduledDelayMs,20);assert.equal(b.inFlight,1);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.equal(b.calls,21);release();for(let i=0;i<8&&b.inFlight;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(b.inFlight,0);assert.equal(b.usage().haltedReason,'COMPONENT_TIME_CAP');
  }finally{release?.();for(let i=0;i<8&&b.inFlight;i++)await new Promise(resolve=>setImmediate(resolve));b.close();}
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

test('minimum duration bounds both free discovery subscriptions and denies metered or trading operations',async t=>{
  for(const discovery of ['subscribeMigration','subscribeNewToken']){
    const f=fixture(t),b=new ComponentBudget({...f.options,totalMs:1});
    try{
      for(const method of ['subscribeTokenTrade','unsubscribeTokenTrade','subscribeAccountTrade','trade','signTransaction','sendTransaction'])await assert.rejects(b.operate({transport:'ws',method},done),/DENIED/);
      assert.equal(b.calls,20,'denied operations never start');
      assert.equal(await b.operate({transport:'ws',method:discovery},done),'ok');assert.equal(b.calls,21);assert.equal(b.newUnits,1,'free discovery still consumes the shared physical-start allowance');
      f.now++;await assert.rejects(b.operate({transport:'ws',method:discovery},done),/TIME_CAP/);assert.equal(b.calls,21,'the minimum deadline cannot admit a late discovery start');
    }finally{b.close();}
  }
});

test('signing/simulation/trading, concurrent ownership and malformed baseline are denied offline',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);
  try{
    for(const method of ['sendTransaction','simulateTransaction','signTransaction','trade'])await assert.rejects(b.operate({transport:'http',method},done),/DENIED/);
    assert.equal(b.calls,20);assert.throws(()=>new ComponentBudget(f.options),/OWNED/);assert.throws(()=>new ComponentBudget({...f.options,baseline:{...f.options.baseline,starts:[]}}),/INVALID_BASELINE/);
  }finally{b.close();}
  assert.equal(COMPONENT_LIMITS.totalMs,90000);
});

test('the dispatcher observes the authoritative pacing gate without taking its slot or charging requests',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);try{
    assert.equal(b.dispatchWindow().readyAt,100000);await b.operate(HTTP,done);
    const before=readFileSync(f.options.statePath,'utf8');assert.equal(b.dispatchWindow().readyAt,101000);assert.equal(b.dispatchWindow().physicalBusy,false);assert.equal(b.calls,21);assert.equal(readFileSync(f.options.statePath,'utf8'),before);
  }finally{b.close();}
});

test('latest physical-start deadline is checked before pacing and again after durable reservation latency',async t=>{
  const f=fixture(t);let writes=0,physical=0;const records:unknown[]=[];
  const b=new ComponentBudget({...f.options,beforePersist(){if(++writes===2)f.now+=101;},record:(kind,data)=>records.push({kind,data})});
  try{
    await assert.rejects(b.operate(HTTP,async c=>{physical++;c.completeResponse();},undefined,{latestStartAt:100100}),/DISPATCH_EXPIRED/);
    assert.equal(physical,0);assert.equal(b.calls,21);assert.equal(b.usage().actualInvocations.length,0);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.equal(b.usage().haltedReason,'COMPONENT_DISPATCH_EXPIRED');assert.ok(records.length>=2);
  }finally{b.close();}
  const g=fixture(t),other=new ComponentBudget(g.options);try{
    await other.operate(HTTP,done);const calls=other.calls;await assert.rejects(other.operate(HTTP,done,undefined,{latestStartAt:100500}),/DISPATCH_EXPIRED/);assert.equal(other.calls,calls);assert.equal(other.inFlight,0);
  }finally{other.close();}
});

test('slow start diagnostics cannot move the actual stamp ahead of transport or shrink later start spacing',async t=>{
  const f=fixture(t),actual:number[]=[];let n=0;
  const b=new ComponentBudget({...f.options,record(kind){if(kind==='component-physical-start'&&++n===1)f.now+=800;}});
  try{for(let i=0;i<3;i++)await b.operate(HTTP,async c=>{actual.push(f.now);c.completeResponse();});assert.deepEqual(actual,[100000,101000,102000]);assert.deepEqual(b.usage().starts,actual);}finally{b.close();}
});

test('failed diagnostic after invocation retains the physical slot until actual settlement',async t=>{
  const f=fixture(t);let release!:()=>void;
  const b=new ComponentBudget({...f.options,record(kind){if(kind==='component-physical-start')throw Error('offline injected recorder failure');}});
  try{
    const op=b.operate(HTTP,async()=>new Promise<void>(r=>{release=r;}),undefined,{timeoutMs:5});await assert.rejects(op,/ABORTED/);assert.equal(b.inFlight,1);assert.throws(()=>b.close(),/PHYSICAL_SLOT/);release();for(let i=0;i<8&&b.inFlight;i++)await new Promise(r=>setImmediate(r));assert.equal(b.inFlight,0);assert.equal(b.usage().uncertainResponseBytes,2*MIB);
  }finally{b.close();}
});

test('legacy defaults retain lifetime caps and do not add a limits field to historical books',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);assert.deepEqual(b.usage().limits,LEGACY_COMPONENT_BUDGET_LIMITS);assert.equal(f.read().limits,undefined);b.close();
  const before=readFileSync(f.options.statePath,'utf8');assert.throws(()=>new ComponentBudget({...f.options,limits:{minSpacingMs:250}}),/LIMITS_CONFLICT/);assert.equal(readFileSync(f.options.statePath,'utf8'),before);
  assert.throws(()=>new ComponentBudget({...f.options,baseline:{...f.options.baseline,calls:241,starts:Array.from({length:241},(_,i)=>i)}}),/INVALID_BASELINE/);
  assert.throws(()=>new ComponentBudget({...f.options,baseline:{...f.options.baseline,bytes:64*MIB+1}}),/INVALID_BASELINE/);
  const g=fixture(t),full=new ComponentBudget({...g.options,baseline:{...g.options.baseline,calls:240,starts:Array.from({length:240},(_,i)=>i)}});
  try{await assert.rejects(full.operate(HTTP,done),/UNIT_CAP/);assert.equal(full.calls,240);}finally{full.close();}
});

const standingLimits={maxNewUnits:100,maxCumulativeUnits:null,maxCumulativeBytes:null,minSpacingMs:250,maxStartsPerMinute:60,maxStartsPer10s:10} as const;
test('explicit standing limits carry cumulative calls and accounted bytes beyond historical caps with250ms physical spacing',async t=>{
  const f=fixture(t),baseline={...f.options.baseline,calls:245,bytes:70*MIB,starts:Array.from({length:245},(_,i)=>i)},options={...f.options,baseline,limits:standingLimits},b=new ComponentBudget(options);
  try{
    for(const kind of [HTTP,UPGRADE,SUB])await b.operate(kind,async c=>{if(kind===HTTP)c.chargeHttp(17);c.completeResponse();});
    assert.deepEqual(b.usage().starts,[100000,100250,100500]);assert.equal(b.calls,248);assert.equal(b.bytes,70*MIB+17);assert.deepEqual(b.usage().baseline,baseline);
    assert.equal(b.usage().remainingCumulativeUnits,null);assert.equal(b.usage().remainingCumulativeResponseBytes,null);assert.equal(b.usage().remainingGrantUnits,97);
    assert.deepEqual(f.read().limits,b.usage().limits);b.close();
    const resumed=new ComponentBudget(options);assert.equal(resumed.calls,248);assert.equal(resumed.bytes,70*MIB+17);resumed.close();
    assert.throws(()=>new ComponentBudget({...options,limits:{...standingLimits,minSpacingMs:500}}),/LIMITS_CONFLICT/);
  }finally{if(!b.usage().closed)b.close();}
});

test('standing rolling10/10s and60/minute caps constrain bursts independently of250ms spacing',async t=>{
  const f=fixture(t),b=new ComponentBudget({...f.options,limits:standingLimits});
  try{
    for(let i=0;i<61;i++)await b.operate(HTTP,done);
    const starts=b.usage().starts;assert.deepEqual(starts.slice(0,3),[100000,100250,100500]);assert.equal(starts[10],110000);assert.equal(starts[60],160000);
    for(const at of starts){assert.ok(starts.filter(s=>s>at-10000&&s<=at).length<=10);assert.ok(starts.filter(s=>s>at-60000&&s<=at).length<=60);}
    assert.ok(starts.slice(1).every((s,i)=>s-starts[i]!>=250));assert.equal(b.inFlight,0);
  }finally{b.close();}
});

test('standing mode still enforces per-run request and byte ceilings and keeps failed response uncertainty',async t=>{
  const f=fixture(t),b=new ComponentBudget({...f.options,limits:{...standingLimits,maxNewUnits:1,maxHttpBytes:4*MIB,maxWsBytes:0,maxCombinedBytes:4*MIB}});
  try{await b.operate(HTTP,done);await assert.rejects(b.operate(HTTP,done),/UNIT_CAP/);assert.equal(b.calls,21);}finally{b.close();}
  const g=fixture(t),other=new ComponentBudget({...g.options,limits:{...standingLimits,maxHttpBytes:4*MIB,maxWsBytes:0,maxCombinedBytes:4*MIB}});
  try{await assert.rejects(other.operate(HTTP,async c=>{c.chargeHttp(42);throw Error('COMPONENT_HTTP_TRANSPORT');}),/TRANSPORT/);assert.equal(other.usage().httpBytes,42);assert.equal(other.usage().uncertainResponseBytes,2*MIB);assert.equal(other.usage().pending.length,1);}finally{other.close();}
});

test('monotonic admission closes without a reservation before or after pacing',async t=>{
  const f=fixture(t),b=new ComponentBudget(f.options);let physical=0;
  try{
    await assert.rejects(b.operate(HTTP,async c=>{physical++;c.completeResponse();},undefined,{admissionOpen:()=>false}),/ADMISSION_CLOSED/);assert.equal(b.calls,20);assert.equal(b.usage().haltedReason,null);
    await b.operate(HTTP,done);
    await assert.rejects(b.operate(HTTP,async c=>{physical++;c.completeResponse();},undefined,{admissionOpen:()=>f.now<100500}),/ADMISSION_CLOSED/);
    assert.equal(f.now,101000);assert.equal(b.calls,21);assert.equal(physical,0);assert.equal(b.usage().pending.length,0);assert.equal(b.usage().haltedReason,null);
  }finally{b.close();}
});

test('admission closure during durable reservation never invokes transport and conservatively retains the charged unit and bytes',async t=>{
  const f=fixture(t);let writes=0,physical=0;const b=new ComponentBudget({...f.options,beforePersist(){if(++writes===2)f.now+=100;}});
  try{
    await assert.rejects(b.operate(HTTP,async c=>{physical++;c.completeResponse();},undefined,{admissionOpen:()=>f.now<100050}),/ADMISSION_CLOSED/);
    assert.equal(physical,0);assert.equal(b.calls,21);assert.equal(b.usage().actualInvokedUnits,0);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.equal(b.usage().haltedReason,'COMPONENT_ADMISSION_CLOSED');assert.equal(b.inFlight,0);
  }finally{b.close();}
});

test('malformed or unbounded run-limit settings are refused before creating a counterbook',t=>{
  const f=fixture(t);for(const limits of [{maxNewUnits:0},{maxNewUnits:1001},{minSpacingMs:0},{maxStartsPerMinute:601},{maxStartsPer10s:61},{maxCombinedBytes:0},{maxHttpBytes:257*MIB},{maxCumulativeUnits:undefined},{unknown:1}])assert.throws(()=>new ComponentBudget({...f.options,limits}),/INVALID_LIMITS/);
});


test('read-only targeted logs management shares physical units and rejects financial methods',async t=>{
 const f=fixture(t),b=new ComponentBudget(f.options);try{
  await b.operate({transport:'ws',method:'logsSubscribe'},done);await b.operate({transport:'ws',method:'logsUnsubscribe'},done);assert.equal(b.newUnits,2);assert.equal(b.usage().byOperation['ws:logsSubscribe'],1);assert.equal(b.usage().byOperation['ws:logsUnsubscribe'],1);
  for(const method of ['sendTransaction','signTransaction','simulateTransaction','trade','subscribeTokenTrade'])await assert.rejects(b.operate({transport:'ws',method},done),/OPERATION_DENIED/);assert.equal(b.newUnits,2);
 }finally{b.close();}
});

test('physical timeout diagnostics expose scheduled versus actual callback timing without releasing unknown occupancy',async t=>{
 const f=fixture(t),rows:Array<{kind:string;data:any}>=[],b=new ComponentBudget({...f.options,record:(kind,data)=>rows.push({kind,data})});let release!:()=>void;
 try{const pending=b.operate(HTTP,async()=>new Promise<void>(r=>{release=r;}),undefined,{timeoutMs:5});await assert.rejects(pending,/PHYSICAL_TIMEOUT/);const timer=rows.find(r=>r.kind==='component-physical-timeout');assert.equal(timer?.data.requestedTimeoutMs,5);assert.equal(timer?.data.scheduledDelayMs,5);assert.ok(timer?.data.callbackLatenessMs>=0);assert.equal(b.inFlight,1);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.ok(b.usage().persistence.attempts>0);assert.ok(b.usage().persistence.totalMs>=0);release();for(let i=0;i<8&&b.inFlight;i++)await new Promise(r=>setImmediate(r));assert.equal(b.inFlight,0);}finally{b.close();}
});
