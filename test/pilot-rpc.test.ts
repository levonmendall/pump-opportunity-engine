import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PilotRpc,PilotRpcUnavailable,type PilotRpcOptions} from '../src/pilot-rpc.js';
import {readResearchBaseline,RESEARCH_MAXIMUM_PATHS} from '../src/research-baseline.js';
const MIB=1024*1024,turn=()=>new Promise<void>(r=>setImmediate(r));
function fixture(options:Partial<PilotRpcOptions>={},recent=false,tickingClock=false){
  const directory=mkdtempSync(join(tmpdir(),'poe-pilot-rpc-')),old=join(directory,'old.json');let now=200000,mono=200000;
  writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:20,bytes:272634,lastObservedAt:recent?199999:2000,starts:Array.from({length:20},(_,i)=>(recent?199000:1000)+i),pending:[{id:20,unobservedBytes:2*MIB}]}),{mode:0o600});
  const before=readFileSync(old),records:Array<{kind:string;data:any}>=[],invocations:Array<{at:number;method:string}>=[];
  const response=(body:string,status=200,headers:Record<string,string>={})=>new Response(body,{status,headers});
  const success=(async(_url,init)=>{const b=JSON.parse(String(init?.body));invocations.push({at:now,method:b.method});now+=5;mono+=5;return response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));}) as typeof fetch;
  const client=new PilotRpc({directory:join(directory,'run'),runId:'isolated-test',baselinePaths:[old],priorPhysicalSettled:true,now:()=>{const value=now;if(tickingClock){now++;mono++;}return value;},monotonic:()=>mono,sleep:async ms=>{now+=ms;mono+=ms;},fetcher:success,record:(kind,data)=>records.push({kind,data}),...options});
  return {client,directory,old,before,records,invocations,now:()=>now,advance(ms:number){now+=ms;mono+=ms;},response,close(){client.close();assert.deepEqual(readFileSync(old),before);rmSync(directory,{recursive:true,force:true});}};
}
test('chapter rollover preserves cumulative counters, inherited uncertainty, real spacing and frozen prior books',async()=>{
  const f=fixture({chapterUnits:2,maxUnits:5});try{
    for(let i=0;i<5;i++)assert.equal(await f.client.call('getSlot'),123);
    const u=f.client.usage();assert.equal(u.newUnits,5);assert.equal(u.cumulativeUnits,25);assert.equal(u.chapter,3);assert.equal(u.uncertainResponseBytes,2*MIB);assert.ok(u.newAccountedResponseBytes>0);assert.equal(u.automaticRequestRetries,0);assert.ok(f.invocations.every((v,i)=>i===0||v.at-f.invocations[i-1]!.at>=250));
    await assert.rejects(f.client.call('getSlot'),/RUN_UNIT_CAP/);assert.equal(f.invocations.length,5);assert.equal(f.client.available(),false);
    const first=JSON.parse(readFileSync(join(f.directory,'run/chapter-001.json'),'utf8'));assert.equal(first.starts.length,2);assert.equal(first.baseline.calls,20);assert.equal(first.baseline.bytes,272634+2*MIB);
  }finally{f.close();}
});
test('optional getTransaction gate refuses without a physical reservation or hidden wait and keeps held-price methods available',async()=>{
  const f=fixture({maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,chapterUnits:3});try{
    for(let i=0;i<8;i++)await f.client.call('getTransaction');const before=f.client.usage(),at=f.now(),book=readFileSync(before.activeChapterPath!);assert.equal(before.chapter,3);assert.equal(before.methodPacing.getTransactionStartsLast10s.length,8);assert.equal(f.client.methodReadyAt('getTransaction'),210000);assert.equal(f.client.methodReadyAt('getTransaction',2),210250);assert.equal(f.client.methodReadyAt('getTransaction',8),211750);
    await assert.rejects(f.client.call('getTransaction'),e=>e instanceof PilotRpcUnavailable&&e.code==='METHOD_PACING'&&e.retryAt===210000);assert.equal(f.now(),at);assert.equal(f.invocations.length,8);assert.equal(f.client.usage().newUnits,8);assert.equal(f.client.usage().newAccountedResponseBytes,before.newAccountedResponseBytes);assert.deepEqual(readFileSync(before.activeChapterPath!),book);assert.equal(f.client.usage().methodPacing.capacityRefusals,1);assert.ok(f.records.some(r=>r.kind==='pilot-method-capacity-refusal'&&r.data.physicalRequestStarted===false));
    assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(f.invocations.at(-1)!.method,'getMultipleAccounts');assert.equal(f.client.usage().methodPacing.getTransactionStartsLast10s.length,8);f.advance(210000-f.now());assert.equal(await f.client.call('getTransaction'),123);assert.equal(f.invocations.at(-1)!.at,210000);assert.equal(f.client.usage().newUnits,10);
  }finally{f.close();}
});
test('immediate linked run conservatively inherits all recent unknown-method starts and persists its bounded method cache',async()=>{
  const f=fixture({maxStartsPer10s:20,maxGetTransactionStartsPer10s:8},true);try{
    assert.equal(f.client.usage().methodPacing.getTransactionStartsLast10s.length,20);assert.ok(f.client.usage().methodPacing.getTransactionStartsLast10s.every(r=>r.origin==='inherited-unknown'));assert.equal(f.client.methodReadyAt('getTransaction'),209012);assert.equal(f.client.methodReadyAt('getTransaction',8),209019);
    await assert.rejects(f.client.call('getTransaction'),e=>e instanceof PilotRpcUnavailable&&e.retryAt===209012);assert.equal(f.client.usage().chapter,0);assert.equal(f.client.usage().newUnits,0);assert.equal(f.invocations.length,0);const persisted=JSON.parse(readFileSync(join(f.directory,'run/status.json'),'utf8'));assert.equal(persisted.methodPacing.getTransactionStartsLast10s.length,20);assert.equal(persisted.requestLimits.maxGetTransactionStartsPer10s,8);
    f.advance(9012);assert.equal(f.client.usage().methodPacing.getTransactionStartsLast10s.length,7);await f.client.call('getTransaction');assert.equal(f.invocations[0]!.at,209012);assert.equal(f.client.usage().methodPacing.getTransactionStartsLast10s.length,3);assert.equal(f.client.usage().methodPacing.getTransactionStartsLast10s.at(-1)!.origin,'getTransaction');assert.equal(f.client.usage().cumulativeUnits,21);
  }finally{f.close();}
});
test('legacy method pacing is unrestricted beyond shared caps, with explicit bounded configuration and reserve validation',async()=>{
  const legacy=fixture({maxStartsPer10s:20});try{for(let i=0;i<9;i++)await legacy.client.call('getTransaction');assert.equal(legacy.client.usage().newUnits,9);assert.equal(legacy.client.usage().requestLimits.maxGetTransactionStartsPer10s,null);assert.equal(legacy.client.methodReadyAt('getTransaction',8),legacy.now());}
  finally{legacy.close();}
  const f=fixture({maxGetTransactionStartsPer10s:2});try{assert.equal(f.client.methodReadyAt('getTransaction',3),Infinity);assert.equal(f.client.methodReadyAt('getSlot',8),f.now());for(const n of [0,9,1.5])assert.throws(()=>f.client.methodReadyAt('getTransaction',n),/INVALID_METHOD_RESERVE/);for(const n of [1,9,2.5])assert.throws(()=>new PilotRpc({directory:join(f.directory,'bad-'+n),runId:'invalid-method',baselinePaths:[f.old],priorPhysicalSettled:true,maxGetTransactionStartsPer10s:n}),/INVALID_OPTIONS/);assert.equal(f.client.usage().newUnits,0);}
  finally{f.close();}
});
test('failed actual getTransaction attempts count, while dispatch refusal and cancellation do not invent starts or bypass HTTP429',async()=>{
  const refused=fixture({maxGetTransactionStartsPer10s:2});try{await assert.rejects(refused.client.call('getTransaction',[],undefined,{latestStartAt:refused.now()-1}),/DISPATCH_EXPIRED/);assert.equal(refused.client.usage().newUnits,0);assert.equal(refused.client.usage().methodPacing.getTransactionStartsLast10s.length,0);const signal=new AbortController();signal.abort();await assert.rejects(refused.client.call('getTransaction',[],signal.signal),/ABORTED/);assert.equal(refused.client.usage().methodPacing.getTransactionStartsLast10s.length,0);}
  finally{refused.close();}
  let calls=0;const limited=fixture({maxGetTransactionStartsPer10s:2,fetcher:(async()=>{calls++;return new Response('no',{status:429,headers:{'retry-after':'10'}});}) as typeof fetch});try{await assert.rejects(limited.client.call('getTransaction'),/HTTP_429/);await turn();assert.equal(limited.client.usage().methodPacing.getTransactionStartsLast10s.length,1);assert.equal(limited.client.usage().methodPacing.getTransactionStartsLast10s[0]!.origin,'getTransaction');const until=limited.client.cooldownUntil();await assert.rejects(limited.client.call('getTransaction'),/COOLDOWN/);assert.equal(calls,1);assert.equal(limited.client.cooldownUntil(),until);assert.equal(limited.client.usage().uncertainResponseBytes,4*MIB);assert.equal(limited.client.usage().methodPacing.capacityRefusals,0);}
  finally{limited.close();}
});
test('HTTP429 never retries; Retry-After plus5s gates a settled new chapter and retains both uncertainty reservations',async()=>{
  let calls=0;const f=fixture({fetcher:(async(_u,init)=>{calls++;const b=JSON.parse(String(init?.body));return calls===1?new Response('denied',{status:429,headers:{'retry-after':'10'}}):new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:'fresh'}));}) as typeof fetch});
  try{
    await assert.rejects(f.client.call('getSlot'),/HTTP_429/);await turn();const refused=readFileSync(join(f.directory,'run/chapter-001.json')),until=f.client.cooldownUntil();assert.equal(until,215000);assert.equal(calls,1);assert.equal(f.client.available(),false);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);
    await assert.rejects(f.client.call('getSlot'),/COOLDOWN/);assert.equal(calls,1);f.advance(14999);assert.equal(f.client.available(),false);f.advance(1);assert.equal(await f.client.call('getSlot'),'fresh');assert.equal(calls,2);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),refused);
  }finally{f.close();}
});
test('a canceled physical request remains occupied after cooldown and cannot create a replacement slot',async()=>{
  let resolveFetch!:(value:Response)=>void,calls=0;const f=fixture({fetcher:(async(_u,init)=>{calls++;const b=JSON.parse(String(init?.body));if(calls===1)return new Promise<Response>(r=>{resolveFetch=r;});return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:7}));}) as typeof fetch});
  try{
    await assert.rejects(f.client.call('getSlot',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.equal(f.client.usage().inFlight,1);f.advance(3000);assert.equal(f.client.available(),false);await assert.rejects(f.client.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(calls,1);assert.throws(()=>f.client.close(),/PHYSICAL_SLOT_OCCUPIED/);
    resolveFetch(new Response('{}'));await turn();await turn();assert.equal(f.client.usage().inFlight,0);assert.equal(await f.client.call('getSlot'),7);assert.equal(calls,2);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);
  }finally{f.close();}
});
test('malformed responses fail closed rather than starting another chapter or inventing data',async()=>{
  let calls=0;const f=fixture({fetcher:(async()=>{calls++;return new Response('not-json');}) as typeof fetch});try{
    await assert.rejects(f.client.call('getSlot'),/MALFORMED_JSON/);await turn();assert.equal(f.client.available(),false);await assert.rejects(f.client.call('getSlot'));assert.equal(calls,1);assert.equal(f.client.usage().chapter,1);assert.match(f.client.usage().fatal!,/MALFORMED_JSON/);
  }finally{f.close();}
});
test('PAPER submission/signing and paid data methods are rejected before a chapter or physical operation',async()=>{
  const f=fixture();try{
    for(const method of ['sendTransaction','simulateTransaction','signTransaction'])await assert.rejects(f.client.call(method),/METHOD_DENIED/);
    await assert.rejects(f.client.operateData({transport:'ws',method:'subscribeTokenTrade'},async()=>true),/DATA_METHOD_DENIED/);assert.equal(f.invocations.length,0);assert.equal(f.client.usage().newUnits,0);assert.equal(f.client.usage().chapter,0);
  }finally{f.close();}
});
test('free control requests share the HTTP physical gate and measured bytes remain chargeable while it is occupied',async()=>{
  let resolveFetch!:(r:Response)=>void;const f=fixture({fetcher:(async(_url,init)=>{const b=JSON.parse(String(init?.body));return new Promise<Response>(r=>{resolveFetch=()=>r(new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:1})));});}) as typeof fetch});
  try{
    await f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>{f.client.accountControlBytes(120);op.completeResponse();});
    await f.client.operateData({transport:'ws',method:'subscribeMigration'},async op=>{f.client.accountControlBytes(90);op.completeResponse();});
    const call=f.client.call('getSlot');await turn();f.client.accountControlBytes(50);await assert.rejects(f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async()=>{}),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.client.usage().newUnits,3);resolveFetch(new Response());await call;assert.equal(f.client.usage().chapterUsage!.wsBytes,260);assert.equal(f.client.usage().inFlight,0);
  }finally{f.close();}
});
test('global time/response allowances remain finite across chapters; a new constructor cannot overwrite the run',async()=>{
  const f=fixture({maxResponseBytes:4*MIB,durationMs:1000,chapterUnits:1});try{
    await f.client.call('getSlot');await assert.rejects(f.client.call('getSlot'),/RUN_RESPONSE_RESERVE/);assert.equal(f.client.usage().newUnits,1);f.advance(1000);assert.equal(f.client.available(),false);await assert.rejects(f.client.call('getSlot'),/RUN_TIME_CAP/);
    assert.throws(()=>new PilotRpc({directory:join(f.directory,'run'),runId:'other-run',baselinePaths:[f.old],priorPhysicalSettled:true}),/EEXIST/);
  }finally{f.close();}
});
test('WS throttle observation respects an HTTP-date cooldown without retrying the original control operation',async()=>{
  const f=fixture();try{
    await assert.rejects(f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async()=>{assert.equal(f.client.noteThrottle(new Date(f.now()+30000).toUTCString()),235000);throw Error('COMPONENT_HTTP_429');}),/HTTP_429/);await turn();assert.equal(f.client.cooldownUntil(),0);assert.equal(f.client.usage().controlCooldownUntil,235000);assert.equal(f.client.usage().newUnits,1);assert.equal(f.client.available(),true);assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,2*MIB+65536);
    assert.equal(createHash('sha256').update(readFileSync(f.old)).digest('hex'),createHash('sha256').update(f.before).digest('hex'));
  }finally{f.close();}
});
test('a periodic chapter expiry caused by passive control receipt preserves bytes and allows only a settled rollover',async()=>{
  const f=fixture({chapterMs:500});try{
    await f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>op.completeResponse());f.advance(501);assert.doesNotThrow(()=>f.client.accountControlBytes(75));assert.equal(f.client.usage().fatal,null);assert.equal(f.client.usage().chapterUsage!.wsBytes,75);assert.equal(f.client.usage().chapter,1);assert.equal(f.client.usage().newUnits,1);
    assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().chapter,2);const old=JSON.parse(readFileSync(join(f.directory,'run/chapter-001.json'),'utf8'));assert.equal(old.haltedReason,null);assert.equal(old.wsBytes,75);assert.equal(f.client.usage().newUnits,2);assert.ok(f.invocations[0]!.at>=old.deadlineAt);
  }finally{f.close();}
});
test('passive chapter-expiry receipt cannot cancel or replace an in-flight physical request',async()=>{
  let release!:(value:Response)=>void;const f=fixture({chapterMs:500,fetcher:(async(_url,init)=>{const body=JSON.parse(String(init?.body));return new Promise<Response>(resolve=>{release=()=>resolve(new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:42})));});}) as typeof fetch});
  try{const p=f.client.call('getSlot');await turn();f.advance(501);f.client.accountControlBytes(75);assert.equal(f.client.usage().inFlight,1);assert.equal(f.client.usage().chapter,1);assert.equal(f.client.usage().chapterUsage!.wsBytes,75);await assert.rejects(f.client.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);release(new Response());assert.equal(await p,42);assert.equal(f.client.usage().newUnits,1);assert.equal(f.client.usage().inFlight,0);}
  finally{f.close();}
});
test('passive receipt during a retained RPC cooldown neither clears it nor drops byte reservations',async()=>{
  const f=fixture({chapterMs:500,fetcher:(async()=>new Response('no',{status:429,headers:{'retry-after':'10'}})) as typeof fetch});
  try{await assert.rejects(f.client.call('getSlot'),/HTTP_429/);await turn();const until=f.client.cooldownUntil(),uncertain=f.client.usage().uncertainResponseBytes;f.advance(501);f.client.accountControlBytes(91);f.client.accountControlBytes(7);assert.equal(f.client.cooldownUntil(),until);assert.equal(f.client.usage().chapterUsage!.wsBytes,98);assert.equal(f.client.usage().uncertainResponseBytes,uncertain);assert.equal(f.client.usage().newUnits,1);await assert.rejects(f.client.call('getSlot'),/COOLDOWN/);assert.equal(f.client.usage().chapter,1);}
  finally{f.close();}
});
test('global time and response bounds still stop passive receipt after charging actual bytes once',async()=>{
  const timed=fixture({durationMs:500,chapterMs:250});try{await timed.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>op.completeResponse());timed.advance(501);assert.throws(()=>timed.client.accountControlBytes(73),/RUN_TIME_CAP/);assert.equal(timed.client.usage().chapterUsage!.wsBytes,73);assert.equal(timed.client.usage().newUnits,1);await assert.rejects(timed.client.call('getSlot'),/RUN_TIME_CAP/);}
  finally{timed.close();}
  const capped=fixture({maxResponseBytes:4*MIB});try{await capped.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>op.completeResponse());capped.client.accountControlBytes(2*MIB);assert.throws(()=>capped.client.accountControlBytes(1),/RESPONSE_RESERVE/);assert.equal(capped.client.usage().chapterUsage!.wsBytes,2*MIB+1);assert.equal(capped.client.usage().fatal,'COMPONENT_RESPONSE_RESERVE');assert.equal(capped.client.usage().newUnits,1);}
  finally{capped.close();}
});
test('explicit research burst gate permits at most20 starts while the default stays10 and actual spacing stays250ms',async()=>{
  const expanded=fixture({maxStartsPer10s:20});try{for(let i=0;i<21;i++)await expanded.client.call('getSlot');assert.equal(expanded.client.usage().requestLimits.maxStartsPer10s,20);assert.equal(expanded.invocations[19]!.at-expanded.invocations[0]!.at,4750);assert.ok(expanded.invocations[20]!.at-expanded.invocations[0]!.at>=10000);assert.ok(expanded.invocations.every((v,i)=>i===0||v.at-expanded.invocations[i-1]!.at>=250));}
  finally{expanded.close();}
  const original=fixture();try{for(let i=0;i<11;i++)await original.client.call('getSlot');assert.equal(original.client.usage().requestLimits.maxStartsPer10s,10);assert.ok(original.invocations[10]!.at-original.invocations[0]!.at>=10000);}
  finally{original.close();}
  for(const n of [0,21,1.5])assert.throws(()=>fixture({maxStartsPer10s:n}),/INVALID_OPTIONS/);
});
test('new run requires the retained throttle receipt and cannot guess a long provider Retry-After',async()=>{
  const f=fixture({fetcher:(async()=>new Response('no',{status:429,headers:{'retry-after':'3600'}})) as typeof fetch});try{
    await assert.rejects(f.client.call('getSlot'),/HTTP_429/);await turn();const until=f.client.cooldownUntil();f.client.close();const paths=f.client.usage().chapterPaths;
    assert.throws(()=>new PilotRpc({directory:join(f.directory,'refused-run'),runId:'missing-receipt',baselinePaths:paths,priorPhysicalSettled:true,now:f.now,monotonic:f.now}),/PRIOR_THROTTLE_RECEIPT_REQUIRED/);
    const next=new PilotRpc({directory:join(f.directory,'next-run'),runId:'receipt-present',baselinePaths:paths,priorPhysicalSettled:true,priorCooldownUntil:until,now:f.now,monotonic:f.now});try{assert.equal(next.cooldownUntil(),until);assert.equal(next.available(),false);assert.equal(next.usage().uncertainResponseBytes,4*MIB);assert.equal(next.usage().newUnits,0);}finally{next.close();}
  }finally{f.close();}
});
test('settled transient RPC failures use bounded2/5/10s backoff without automatic retry or dropping old reservations',async()=>{
  let calls=0;const f=fixture({fetcher:(async(_u,init)=>{calls++;if(calls<=3)throw Error('private provider detail');const b=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));}) as typeof fetch});try{
    for(const delay of [2000,5000,10000]){
      const before=f.now();await assert.rejects(f.client.call('getSlot'),/HTTP_TRANSPORT/);await turn();assert.equal(f.client.cooldownUntil(),before+delay);assert.equal(f.client.available(),false);f.advance(delay);
    }
    assert.equal(f.client.usage().newUnits,3);assert.equal(f.client.usage().chapter,3);assert.equal(f.client.usage().uncertainResponseBytes,8*MIB);assert.equal(f.client.usage().automaticRequestRetries,0);assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().newUnits,4);
  }finally{f.close();}
});
test('invalid feed protocol remains isolated from held-price RPC while global accounting failures still block it',async()=>{
  const f=fixture();try{await assert.rejects(f.client.operateData({transport:'ws',method:'subscribeMigration'},async()=>{throw Error('PILOT_DISCOVERY_ACK_INVALID');}),/COMPONENT_OPERATION_FAILED/);await turn();assert.equal(f.client.available(),true);assert.equal(f.client.usage().fatal,null);assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,2*MIB+65536);}finally{f.close();}
  const bad=fixture();try{await assert.rejects(bad.client.operateData({transport:'ws',method:'subscribeMigration'},async()=>{throw Error('COMPONENT_STORAGE_UNAVAILABLE');}),/STORAGE_UNAVAILABLE/);await turn();assert.equal(bad.client.available(),false);await assert.rejects(bad.client.call('getSlot'));assert.equal(bad.invocations.length,0);}finally{bad.close();}
});


test('single admission timestamp avoids one-millisecond method refusals without weakening the real cap',async()=>{
 const f=fixture({maxStartsPer10s:20,maxGetTransactionStartsPer10s:8},false,true);try{
  for(let i=0;i<8;i++)assert.equal(await f.client.call('getTransaction'),123);
  assert.equal(f.invocations.length,8);assert.equal(f.client.usage().methodPacing.capacityRefusals,0);
  await assert.rejects(f.client.call('getTransaction'),e=>e instanceof PilotRpcUnavailable&&e.code==='METHOD_PACING');
  assert.equal(f.invocations.length,8);const refusal=f.records.find(r=>r.kind==='pilot-method-capacity-refusal');assert.equal(refusal?.data.knownOrConservativelyInheritedStarts,8);assert.equal(refusal?.data.physicalRequestStarted,false);
 }finally{f.close();}
});


test('public read-only log subscriptions use the existing gate without authorizing financial WS methods',async()=>{
 const f=fixture();try{
  for(const method of ['logsSubscribe','logsUnsubscribe'])await f.client.operateData({transport:'ws',method},async op=>{f.client.accountControlBytes(100);op.completeResponse();});
  assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().chapterUsage!.wsBytes,200);assert.equal(f.invocations.length,0);
  for(const method of ['sendTransaction','simulateTransaction','signTransaction','subscribeTokenTrade'])await assert.rejects(f.client.operateData({transport:'ws',method},async()=>true),/DATA_METHOD_DENIED/);assert.equal(f.client.usage().newUnits,2);
 }finally{f.close();}
});


test('long settled baseline leaves bounded chapter runway without discarding paths, counters or uncertainty',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-pilot-long-chain-')),old=join(directory,'old.json');let client:PilotRpc|undefined;
 try{
  writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:2,bytes:100,lastObservedAt:1000,starts:[900,1000],pending:[{id:2,unobservedBytes:2000}]}),{mode:0o600});
  const paths=[old];let baseline=readResearchBaseline({paths,now:200000,physicalSettled:true}).baseline;
  for(let i=1;i<=224;i++){const path=join(directory,'prior-'+i+'.json'),at=1000+i;writeFileSync(path,JSON.stringify({schemaVersion:1,grantId:'prior-'+i,baseline,startedAt:at,lastObservedAt:at,starts:[],httpBytes:1,wsBytes:0,pending:[]}),{mode:0o600});paths.push(path);baseline={...baseline,bytes:baseline.bytes+1,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};}
  const before=paths.map(path=>createHash('sha256').update(readFileSync(path)).digest('hex'));let physical=0;
  const options={runId:'long-chain-test',priorPhysicalSettled:true as const,now:()=>200000,monotonic:()=>200000,fetcher:(async()=>{physical++;throw Error('UNEXPECTED_NETWORK');}) as typeof fetch};
  client=new PilotRpc({...options,directory:join(directory,'run-104'),baselinePaths:paths.slice(0,104)});
  const expected=readResearchBaseline({paths:paths.slice(0,104),now:200000,physicalSettled:true,maximumPaths:RESEARCH_MAXIMUM_PATHS});
  assert.equal(client.usage().cumulativeUnits,expected.baseline.calls);assert.equal(client.usage().newUnits,0);assert.equal(client.usage().accountedCumulativeResponseBytes,expected.baseline.bytes);assert.equal(client.usage().uncertainResponseBytes,2000);client.close();client=undefined;
  client=new PilotRpc({...options,directory:join(directory,'run-boundary'),baselinePaths:paths.slice(0,224)});assert.equal(client.usage().newUnits,0);client.close();client=undefined;
  assert.throws(()=>new PilotRpc({...options,directory:join(directory,'too-many'),baselinePaths:paths}),/BASELINE_CHAPTER_CAP/);
  assert.throws(()=>new PilotRpc({...options,directory:join(directory,'duplicate'),baselinePaths:[...paths.slice(0,103),paths[0]!]}),/DUPLICATE_PATH/);
  assert.equal(physical,0);assert.deepEqual(paths.map(path=>createHash('sha256').update(readFileSync(path)).digest('hex')),before);
 }finally{client?.close();rmSync(directory,{recursive:true,force:true});}
});
