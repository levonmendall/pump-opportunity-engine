import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {nativeCandidateWatchControlRequest} from '../src/run-native-candidates.js';
import {PilotRpc,PilotRpcUnavailable,pilotUninvokedHistoryRefusal,type PilotRpcOptions,CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE} from '../src/pilot-rpc.js';
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
test('HTTP429 never retries; exact Retry-After gates a settled new chapter and retains both uncertainty reservations',async()=>{
  let calls=0;const f=fixture({fetcher:(async(_u,init)=>{calls++;const b=JSON.parse(String(init?.body));return calls===1?new Response('denied',{status:429,headers:{'retry-after':'10'}}):new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:'fresh'}));}) as typeof fetch});
  try{
    await assert.rejects(f.client.call('getSlot'),/HTTP_429/);await turn();const refused=readFileSync(join(f.directory,'run/chapter-001.json')),until=f.client.cooldownUntil();assert.equal(until,210000);assert.equal(calls,1);assert.equal(f.client.available(),false);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);
    await assert.rejects(f.client.call('getSlot'),/COOLDOWN/);assert.equal(calls,1);f.advance(9999);assert.equal(f.client.available(),false);f.advance(1);assert.equal(await f.client.call('getSlot'),'fresh');assert.equal(calls,2);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),refused);
  }finally{f.close();}
});

test('settled HTTP refusal preserves its Retry-After while permitting separately admitted control on the same gate',async()=>{
 let calls=0,controls=0;const f=fixture({fetcher:(async()=>{calls++;return new Response('denied',{status:429,headers:{'retry-after':'10'}});}) as typeof fetch});try{
  await assert.rejects(f.client.call('getSlot'),/HTTP_429/);await turn();const until=f.client.cooldownUntil(),failed=readFileSync(join(f.directory,'run/chapter-001.json')),uncertain=f.client.usage().uncertainResponseBytes;assert.equal(f.client.usage().rpcDispatchWindow!.readyAt,until);assert.ok(f.client.usage().controlDispatchWindow!.readyAt<until);assert.equal(f.client.usage().dispatchWindow!.readyAt,until);
  await f.client.operateData({transport:'ws',method:'ping'},async op=>{controls++;f.client.accountControlBytes(30);op.completeResponse();});assert.equal(controls,1);assert.equal(f.client.cooldownUntil(),until);assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,uncertain);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),failed);await assert.rejects(f.client.call('getSlot'),/COOLDOWN/);assert.equal(calls,1);assert.equal(f.client.usage().newUnits,2);
 }finally{f.close();}
});

test('actual control Retry-After blocks only controls and cannot be cleared by successful HTTP work',async()=>{
 const f=fixture();try{
  await assert.rejects(f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async()=>{f.client.noteThrottle('10');throw Error('COMPONENT_HTTP_429');}),/HTTP_429/);await turn();const until=f.client.usage().controlCooldownUntil;assert.equal(until,215000);assert.equal(f.client.usage().controlDispatchWindow!.readyAt,until);assert.ok(f.client.usage().rpcDispatchWindow!.readyAt<until);let controls=0;await assert.rejects(f.client.operateData({transport:'ws',method:'ping'},async op=>{controls++;op.completeResponse();}),/COOLDOWN/);assert.equal(controls,0);assert.equal(f.client.usage().newUnits,1);assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().controlCooldownUntil,until);await assert.rejects(f.client.operateData({transport:'ws',method:'ping'},async op=>{controls++;op.completeResponse();}),/COOLDOWN/);assert.equal(controls,0);f.advance(until-f.now());await f.client.operateData({transport:'ws',method:'ping'},async op=>{controls++;op.completeResponse();});assert.equal(controls,1);assert.equal(f.client.usage().newUnits,3);
 }finally{f.close();}
});

test('mixed HTTP and control work share the same sixty-start minute and short-window pacing',async()=>{
 const f=fixture({maxStartsPer10s:20});try{
  for(let i=0;i<60;i++){if(i%2)await f.client.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse());else assert.equal(await f.client.call('getSlot'),123);}
  const starts=f.records.filter(r=>r.kind==='component-physical-start').map(r=>r.data);assert.equal(starts.length,60);assert.equal(starts.filter(r=>r.kind.transport==='http').length,30);assert.equal(starts.filter(r=>r.kind.transport==='ws').length,30);assert.ok(starts.every((r,i)=>i===0||r.at-starts[i-1]!.at>=250));assert.ok(starts.every(r=>starts.filter(s=>s.at>r.at-10000&&s.at<=r.at).length<=20));assert.equal(f.client.usage().chapterUsage!.rolling60SecondStarts,60);const units=f.client.usage().newUnits,at=f.now();await assert.rejects(f.client.call('getSlot',[],undefined,{latestStartAt:at+1000}),/DISPATCH_EXPIRED/);await assert.rejects(f.client.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse(),undefined,{latestStartAt:at+1000}),/DISPATCH_EXPIRED/);assert.equal(f.client.usage().newUnits,units);assert.equal(f.client.usage().newUnits,60);assert.equal(f.client.usage().inFlight,0);
 }finally{f.close();}
});

test('an unsettled timed-out control operation blocks both domains until actual settlement',async()=>{
 const f=fixture();let release!:()=>void;try{
  await assert.rejects(f.client.operateData({transport:'ws',method:'logsSubscribe'},async()=>new Promise<void>(resolve=>{release=resolve;}),undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.equal(f.client.usage().inFlight,1);f.advance(3000);await assert.rejects(f.client.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);await assert.rejects(f.client.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse()),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.client.usage().newUnits,1);release();await turn();await turn();assert.equal(f.client.usage().inFlight,0);await f.client.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse());assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,2*MIB+65536);assert.equal(f.invocations.length,0);
 }finally{f.close();}
});
test('a canceled physical request remains occupied after cooldown and cannot create a replacement slot',async()=>{
  let resolveFetch!:(value:Response)=>void,calls=0;const f=fixture({fetcher:(async(_u,init)=>{calls++;const b=JSON.parse(String(init?.body));if(calls===1)return new Promise<Response>(r=>{resolveFetch=r;});return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:7}));}) as typeof fetch});
  try{
    await assert.rejects(f.client.call('getSlot',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.equal(f.client.usage().inFlight,1);f.advance(3000);assert.equal(f.client.available(),false);await assert.rejects(f.client.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);await assert.rejects(f.client.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse()),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.client.usage().newUnits,1);assert.equal(calls,1);assert.throws(()=>f.client.close(),/PHYSICAL_SLOT_OCCUPIED/);
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

test('persistent RPC finishes a timely response across the accounting boundary then rolls over before the next start',async()=>{
  let calls=0,release!:()=>void,settled=false;const actualStarts:number[]=[];const f=fixture({persistent:true,chapterMs:1000,fetcher:(async(_url,init)=>{calls++;actualStarts.push(f.now());const body=JSON.parse(String(init?.body));if(calls===2)await new Promise<void>(resolve=>{release=resolve;});return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:calls}));}) as typeof fetch});
  try{
    assert.equal(await f.client.call('getSlot'),1);f.advance(990);const result=f.client.call('getSlot',[],undefined,{timeoutMs:1000,latestStartAt:f.now()+5}).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});await turn();f.advance(20);await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(settled,false,'accounting rollover must not invent an early timeout or a response');assert.equal(calls,2);assert.equal(f.client.usage().chapter,1);assert.equal(f.client.usage().inFlight,1);assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().chapterUsage!.haltedReason,null);await assert.rejects(f.client.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(calls,2);
    release();assert.deepEqual(await result,{value:2});const prior=readFileSync(join(f.directory,'run/chapter-001.json'));const book=JSON.parse(prior.toString());assert.equal(book.actualInvocations[1].at,200990);assert.equal(book.lastObservedAt,201010);assert.equal(book.haltedReason,null);assert.deepEqual(book.pending,[]);assert.equal(book.httpBytes>0,true);assert.equal(f.client.usage().uncertainResponseBytes,2*MIB);assert.equal(f.client.cooldownUntil(),0);
    assert.equal(await f.client.call('getSlot'),3);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().newUnits,3);assert.equal(f.client.usage().uncertainResponseBytes,2*MIB);assert.equal(f.client.usage().fatal,null);const sealed=readFileSync(join(f.directory,'run/chapter-001.json'));assert.deepEqual(JSON.parse(sealed.toString()),{...book,byteAccounting:{...book.byteAccounting,reservedBytes:0}},'verified live close releases only unused future passive capacity; exact observations, starts and physical uncertainty remain unchanged');assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),sealed);assert.deepEqual(actualStarts,[200000,200990,201240]);assert.equal(f.records.some(r=>r.kind==='component-physical-timeout'),false);
  }finally{release?.();await turn();await turn();f.close();}
});

test('persistent RPC keeps a genuine caller timeout after chapter expiry and cannot replace its unsettled transport',async()=>{
  let calls=0,release!:()=>void;const f=fixture({persistent:true,chapterMs:1000,fetcher:(async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));if(calls===2)await new Promise<void>(resolve=>{release=resolve;});return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:calls}));}) as typeof fetch});
  try{
    assert.equal(await f.client.call('getSlot'),1);f.advance(990);const request=f.client.call('getSlot',[],undefined,{timeoutMs:60});const rejected=assert.rejects(request,/PHYSICAL_TIMEOUT/);await turn();f.advance(20);await rejected;
    const timeout=f.records.find(r=>r.kind==='component-physical-timeout')!.data;assert.equal(timeout.requestedTimeoutMs,60);assert.equal(timeout.scheduledDelayMs,60);assert.equal(f.client.usage().chapterUsage!.haltedReason,'COMPONENT_PHYSICAL_TIMEOUT');assert.equal(f.client.usage().inFlight,1);assert.equal(f.client.usage().chapter,1);assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);assert.ok(f.client.cooldownUntil()>f.now());
    f.advance(3000);await assert.rejects(f.client.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(calls,2);assert.equal(f.client.usage().chapter,1);assert.throws(()=>f.client.close(),/PHYSICAL_SLOT_OCCUPIED/);
    release();await turn();await turn();assert.equal(f.client.usage().inFlight,0);const prior=readFileSync(join(f.directory,'run/chapter-001.json'));assert.equal(await f.client.call('getSlot'),3);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().newUnits,3);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);const sealed=readFileSync(join(f.directory,'run/chapter-001.json')),beforeClose=JSON.parse(prior.toString());assert.deepEqual(JSON.parse(sealed.toString()),{...beforeClose,byteAccounting:{...beforeClose.byteAccounting,reservedBytes:0}},'settled close does not refund a failed physical response, change observed bytes, or invent starts');assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),sealed);
  }finally{release?.();await turn();await turn();f.close();}
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
  for(let i=1;i<=RESEARCH_MAXIMUM_PATHS-32;i++){const path=join(directory,'prior-'+i+'.json'),at=1000+i;writeFileSync(path,JSON.stringify({schemaVersion:1,grantId:'prior-'+i,baseline,startedAt:at,lastObservedAt:at,starts:[],httpBytes:1,wsBytes:0,pending:[]}),{mode:0o600});paths.push(path);baseline={...baseline,bytes:baseline.bytes+1,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};}
  const before=paths.map(path=>createHash('sha256').update(readFileSync(path)).digest('hex'));let physical=0;
  const options={runId:'long-chain-test',priorPhysicalSettled:true as const,now:()=>200000,monotonic:()=>200000,fetcher:(async()=>{physical++;throw Error('UNEXPECTED_NETWORK');}) as typeof fetch};
  client=new PilotRpc({...options,directory:join(directory,'run-104'),baselinePaths:paths.slice(0,104)});
  const expected=readResearchBaseline({paths:paths.slice(0,104),now:200000,physicalSettled:true,maximumPaths:RESEARCH_MAXIMUM_PATHS});
  assert.equal(client.usage().cumulativeUnits,expected.baseline.calls);assert.equal(client.usage().newUnits,0);assert.equal(client.usage().accountedCumulativeResponseBytes,expected.baseline.bytes);assert.equal(client.usage().uncertainResponseBytes,2000);client.close();client=undefined;
  client=new PilotRpc({...options,directory:join(directory,'run-boundary'),baselinePaths:paths.slice(0,RESEARCH_MAXIMUM_PATHS-32)});assert.equal(client.usage().newUnits,0);client.close();client=undefined;
  assert.throws(()=>new PilotRpc({...options,directory:join(directory,'too-many'),baselinePaths:paths}),/BASELINE_CHAPTER_CAP/);
  assert.throws(()=>new PilotRpc({...options,directory:join(directory,'duplicate'),baselinePaths:[...paths.slice(0,103),paths[0]!]}),/DUPLICATE_PATH/);
  assert.equal(physical,0);assert.deepEqual(paths.map(path=>createHash('sha256').update(readFileSync(path)).digest('hex')),before);
 }finally{client?.close();rmSync(directory,{recursive:true,force:true});}
});


test('native research response envelope is explicit and leaves default finite limits unchanged',async()=>{
 const f=fixture({profile:'candidate-native-research-v1',maxResponseBytes:256*MIB,maxStartsPer10s:20});try{
  assert.equal(CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.maximumDurationMs,1800000);assert.equal(CANDIDATE_NATIVE_RESEARCH_RPC_PROFILE.maximumUnits,1500);
  assert.equal(f.client.usage().profile,'candidate-native-research-v1');assert.equal(f.client.usage().maximumNewResponseBytes,256*MIB);assert.equal(f.client.usage().maximumNewUnits,1500);
  assert.deepEqual(f.client.usage().requestLimits,{maxStartsPer10s:20,maxGetTransactionStartsPer10s:null,maxStartsPerMinute:60,minSpacingMs:250,physicalInFlight:1});
  const authorization=JSON.parse(readFileSync(join(f.directory,'run/authorization.json'),'utf8'));assert.equal(authorization.profile,'candidate-native-research-v1');assert.equal(authorization.maxResponseBytes,256*MIB);
  await f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>op.completeResponse());
  for(let i=0;i<17;i++)f.client.accountControlBytes(2*MIB);
  assert.equal(f.client.usage().chapterUsage!.wsBytes,34*MIB);assert.equal(f.client.usage().fatal,null);assert.equal(await f.client.call('getSlot'),123);
 }finally{f.close();}
 const defaults=fixture();try{assert.equal(defaults.client.usage().profile,'legacy');assert.equal(defaults.client.usage().maximumNewResponseBytes,32*MIB);assert.equal(defaults.client.usage().maximumNewUnits,1500);}
 finally{defaults.close();}
});

test('native profile does not silently authorize longer runs, more starts, larger payload budgets or unknown profiles',()=>{
 const f=fixture();try{
  let index=0;const construct=(options:Partial<PilotRpcOptions>)=>new PilotRpc({directory:join(f.directory,'invalid-profile-'+index++),runId:'finite-profile',baselinePaths:[f.old],priorPhysicalSettled:true,now:f.now,monotonic:f.now,...options});
  assert.throws(()=>construct({maxResponseBytes:32*MIB+1}),/INVALID_OPTIONS/);
  for(const extra of [{maxResponseBytes:256*MIB+1},{durationMs:1800001},{maxUnits:1501},{maxChapters:33},{chapterUnits:201},{maxStartsPer10s:21}])assert.throws(()=>construct({profile:'candidate-native-research-v1',...extra}),/INVALID_OPTIONS/);
  assert.throws(()=>construct({profile:'unbounded' as PilotRpcOptions['profile']}),/INVALID_OPTIONS/);assert.equal(f.client.usage().newUnits,0);
 }finally{f.close();}
});


test('local admission and deadline refusals before a reservation preserve the healthy shared gate without provider cooldown',async()=>{
 for(const options of [{latestStartAt:199999},{admissionOpen:()=>false}]){const f=fixture();try{
  await assert.rejects(f.client.call('getSlot',[],undefined,options),/DISPATCH_EXPIRED|ADMISSION_CLOSED/);const u=f.client.usage();assert.equal(f.invocations.length,0);assert.equal(u.newUnits,0);assert.equal(u.fatal,null);assert.equal(u.cooldownUntil,0);assert.equal(u.controlCooldownUntil,0);assert.equal(u.chapterUsage!.haltedReason,null);assert.equal(f.client.available(),true);
  assert.ok(f.records.some(r=>r.kind==='pilot-job-admission-refused'&&r.data.automaticRetry===false&&r.data.providerCooldownUnchanged===true));assert.equal(f.records.some(r=>r.kind==='pilot-rpc-unavailable'),false);assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().chapter,1);assert.equal(f.client.usage().newUnits,1);
 }finally{f.close();}}
});

for(const reason of ['COMPONENT_DISPATCH_EXPIRED','COMPONENT_ADMISSION_CLOSED'])test(`durably reserved ${reason} before physical invocation stays charged and rolls over only after settlement`,async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-local-reserved-refusal-')),old=join(directory,'old.json'),chapter=join(directory,'run/chapter-001.json');let at=200000,armed=false,expired=false,fetches=0;const records:Array<{kind:string;data:any}>=[];let client:PilotRpc|undefined;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:2,bytes:123,lastObservedAt:1000,starts:[900,1000],pending:[{id:2,unobservedBytes:2*MIB}]}),{mode:0o600});const original=readFileSync(old);
 const clock=()=>{if(armed&&existsSync(chapter)){const book=JSON.parse(readFileSync(chapter,'utf8'));if(book.starts.length===1&&book.pending.length===1&&book.actualInvocations.length===0){armed=false;expired=true;at+=101;}}return at;};
 try{
  client=new PilotRpc({directory:join(directory,'run'),runId:'local-refusal-only',baselinePaths:[old],priorPhysicalSettled:true,maxUnits:3,now:clock,monotonic:()=>at,sleep:async ms=>{at+=ms;},record:(kind,data)=>records.push({kind,data}),fetcher:(async(_url,init)=>{fetches++;const request=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:123}));}) as typeof fetch});
  armed=true;let refused:unknown;try{await client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{queryTimeoutScope:'independent-history',...(reason==='COMPONENT_DISPATCH_EXPIRED'?{latestStartAt:200100}:{admissionOpen:()=>!expired})});assert.fail('reserved late refusal required');}catch(error){refused=error;assert.match(String(error),new RegExp(reason));}await turn();const proof=pilotUninvokedHistoryRefusal(refused);assert.ok(proof);assert.equal(proof.pool,HISTORY_POOL);assert.equal(proof.physicalSettled,true);assert.equal(proof.at,at);
  const u=client.usage(),failed=readFileSync(chapter),book=JSON.parse(failed.toString());assert.equal(fetches,0);assert.equal(u.newUnits,1);assert.equal(book.actualInvocations.length,0);assert.equal(book.haltedReason,reason);assert.equal(book.pending.length,1);assert.equal(book.pending[0].reservedBytes,2*MIB);assert.equal(u.currentChapterUncertainResponseBytes,2*MIB);assert.equal(u.uncertainResponseBytes,4*MIB);assert.equal(u.inFlight,0);assert.equal(u.waitingOrOperating,false);assert.equal(u.fatal,null);assert.equal(u.cooldownUntil,0);assert.equal(u.controlCooldownUntil,0);assert.equal(u.chapter,1);assert.equal(client.available(),true);assert.equal(records.some(r=>r.kind==='pilot-rpc-unavailable'),false);assert.ok(records.some(r=>r.kind==='pilot-job-admission-refused'&&r.data.code===reason&&r.data.reservationsRetained===2*MIB));
  assert.equal(await client.call('getSlot'),123);assert.equal(fetches,1);const after=client.usage();assert.equal(after.chapter,2);assert.equal(after.newUnits,2);assert.equal(after.cumulativeUnits,4);assert.equal(after.uncertainResponseBytes,4*MIB);assert.equal(after.fatal,null);assert.equal(after.cooldownUntil,0);assert.deepEqual(readFileSync(chapter),failed,'settled rejected chapter is immutable after safe rollover');assert.deepEqual(readFileSync(old),original,'historical refusal and uncertainty remain untouched');
 }finally{client?.close();rmSync(directory,{recursive:true,force:true});}
});

test('a local refusal cannot roll a chapter or release a physical operation that has not actually settled',async()=>{
 const f=fixture();let settle!:()=>void;
 try{
  const first=f.client.operateData({transport:'ws',method:'logsSubscribe'},async op=>new Promise<void>(resolve=>{settle=()=>{op.completeResponse();resolve();};}));await turn();assert.equal(f.client.usage().inFlight,1);
  // Explicit offline fault injection into the existing budget. The adapter's
  // caller-facing refusal must not invent transport settlement or a free slot.
  (f.client as unknown as {budget:{halt:(code:string)=>void}}).budget.halt('COMPONENT_DISPATCH_EXPIRED');await assert.rejects(first,/DISPATCH_EXPIRED/);
  assert.equal(f.client.usage().fatal,null);assert.equal(f.client.cooldownUntil(),0);assert.equal(f.client.usage().inFlight,1);assert.equal(f.client.available(),false);await assert.rejects(f.client.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);assert.throws(()=>f.client.close(),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.client.usage().chapter,1);assert.equal(f.client.usage().newUnits,1);assert.equal(f.invocations.length,0);
  settle();await turn();await turn();assert.equal(f.client.usage().inFlight,0);assert.equal(f.client.available(),true);assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().uncertainResponseBytes,2*MIB);assert.equal(f.invocations.length,1);
 }finally{f.close();}
});

test('repeated rolling-minute pacing refusals reuse the unhalted chapter beyond32 attempts and consume no additional units',async()=>{
 const f=fixture({maxStartsPer10s:20});try{
  for(let i=0;i<60;i++)assert.equal(await f.client.call('getSlot'),123);
  const before=f.client.usage(),chapter=before.activeChapterPath!,book=readFileSync(chapter),at=f.now();assert.equal(before.chapter,1);assert.equal(before.newUnits,60);assert.equal(f.invocations.length,60);assert.equal(before.chapterUsage!.rolling60SecondStarts,60);
  for(let i=0;i<40;i++)await assert.rejects(f.client.call('getSlot',[],undefined,{latestStartAt:at+1000}),/DISPATCH_EXPIRED/);
  const refused=f.client.usage();assert.equal(f.now(),at,'an expired pacing opportunity never performs a hidden wait or retry');assert.equal(refused.chapter,1);assert.equal(refused.newUnits,60);assert.equal(f.invocations.length,60);assert.equal(refused.fatal,null);assert.equal(refused.cooldownUntil,0);assert.equal(refused.controlCooldownUntil,0);assert.equal(refused.chapterUsage!.haltedReason,null);assert.equal(refused.uncertainResponseBytes,before.uncertainResponseBytes);assert.equal(refused.newAccountedResponseBytes,before.newAccountedResponseBytes);assert.deepEqual(readFileSync(chapter),book);assert.deepEqual(readFileSync(f.old),f.before);assert.equal(f.records.filter(r=>r.kind==='pilot-job-admission-refused').length,40);assert.equal(f.records.some(r=>r.kind==='pilot-rpc-unavailable'),false);
  f.advance(f.invocations[0]!.at+60000-f.now());assert.equal(await f.client.call('getSlot'),123);assert.equal(f.client.usage().chapter,1,'the healthy chapter retains all32 chapter slots despite40 refused jobs');assert.equal(f.client.usage().newUnits,61);assert.equal(f.invocations.length,61);assert.equal(f.client.usage().automaticRequestRetries,0);assert.deepEqual(readFileSync(f.old),f.before);
 }finally{f.close();}
});

test('WATCH pacing cannot hold the shared gate across the next native deadline or start after native becomes due',async()=>{
 const f=fixture({maxStartsPer10s:20},true);try{
  const next=f.now()+4000,request=nativeCandidateWatchControlRequest(()=>({busy:false,admissionOpen:true,flow:{nextServiceAt:next},at:f.now()}),f.now()+90000);assert.ok(request);const before=f.client.usage();let starts=0;
  await assert.rejects(f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>{starts++;op.completeResponse();},undefined,request),/DISPATCH_EXPIRED/);
  assert.equal(starts,0);assert.equal(f.now(),200000,'ten-second pacing cannot occupy the gate past native work');assert.equal(f.client.usage().newUnits,before.newUnits);assert.equal(f.client.usage().waitingOrOperating,false);assert.equal(f.client.usage().fatal,null);
  f.advance(10000);let nativeNext=f.now()+4000;const later=nativeCandidateWatchControlRequest(()=>({busy:false,admissionOpen:true,flow:{nextServiceAt:nativeNext},at:f.now()}),f.now()+90000);assert.ok(later);nativeNext=f.now();const guarded=later;
  await assert.rejects(f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>{starts++;op.completeResponse();},undefined,guarded),/ADMISSION_CLOSED/);assert.equal(starts,0);assert.equal(f.client.usage().newUnits,0);assert.equal(f.client.usage().waitingOrOperating,false);
 }finally{f.close();}
});

test('served-node context-floor lag is paced unavailable data through real HTTP decoding, never a permanent fatal or audit success',async()=>{
 let requests=0;const f=fixture({fetcher:(async(_url,init)=>{const request=JSON.parse(String(init?.body));requests++;assert.equal(request.method,'getSignaturesForAddress');assert.equal(request.params[1].minContextSlot,462345886);return new Response(JSON.stringify(requests===1?{jsonrpc:'2.0',id:request.id,error:{code:-32016,message:'provider text must not be retained'}}:{jsonrpc:'2.0',id:request.id,result:[]}));}) as typeof fetch});try{
  const params=['11111111111111111111111111111111',{commitment:'confirmed',limit:1000,minContextSlot:462345886}];
  await assert.rejects(f.client.call('getSignaturesForAddress',params),e=>e instanceof PilotRpcUnavailable&&e.code==='COMPONENT_RPC_ERROR_-32016'&&e.retryAt===f.now()+2000);
  const failed=f.client.usage();assert.equal(failed.fatal,null);assert.equal(failed.newUnits,1);assert.equal(failed.inFlight,0);assert.equal(failed.currentChapterUncertainResponseBytes,0,'fully drained RPC error has measured body size');assert.equal(failed.uncertainResponseBytes,2*MIB,'historical uncertainty is never refunded');assert.ok(failed.newAccountedResponseBytes>0);assert.equal(f.client.available(),false);assert.equal(requests,1,'the unavailable request is not retried internally');assert.ok(f.records.some(r=>r.kind==='pilot-rpc-unavailable'&&r.data.code==='COMPONENT_RPC_ERROR_-32016'));assert.ok(!JSON.stringify(f.records).includes('provider text'));
  await assert.rejects(f.client.call('getSignaturesForAddress',params),/COOLDOWN/);assert.equal(requests,1);assert.equal(f.client.usage().newUnits,1);f.advance(2000);assert.deepEqual(await f.client.call('getSignaturesForAddress',params),[]);assert.equal(requests,2);assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().fatal,null);
 }finally{f.close();}
});

test('context-floor recovery does not reclassify unrelated invalid-request RPC errors as transient',async()=>{
 const f=fixture({fetcher:(async(_url,init)=>{const request=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32602,message:'invalid params'}}));}) as typeof fetch});try{await assert.rejects(f.client.call('getSignaturesForAddress',[]),/RPC_ERROR_-32602/);assert.equal(f.client.usage().fatal,'COMPONENT_RPC_ERROR_-32602');assert.equal(f.client.usage().newUnits,1);assert.equal(f.client.usage().currentChapterUncertainResponseBytes,0);}finally{f.close();}
});

// Offline fixed-route checks: no external request or independent budget.
const HISTORY_POOL='46ZfGg4F6r93ZNGBrQywzA9dQfgbyJu2ye7vb58UhXnR';
test('opt-in history route is method-fixed and shares primary/control accounting and pacing',async()=>{
 const seen:Array<{url:string;method:string;id:number}>=[];const f=fixture({historyRoute:'publicnode-history-only-v1',maxStartsPer10s:20,fetcher:(async(url,init)=>{const b=JSON.parse(String(init?.body));seen.push({url:String(url),method:b.method,id:b.id});return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:[]}));}) as typeof fetch});try{
  for(const method of ['getSignaturesForAddress','getMultipleAccounts','getTransaction','getBlockTime'])await f.client.call(method,method==='getSignaturesForAddress'?[HISTORY_POOL]:[]);
  await f.client.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse());
  assert.deepEqual(seen.map(v=>v.url),['https://solana-rpc.publicnode.com',...Array(3).fill('https://api.mainnet.solana.com')]);assert.equal(f.client.usage().newUnits,5);assert.equal(f.client.usage().historyRoute?.version,'publicnode-history-only-v1');const starts=f.records.filter(r=>r.kind==='component-physical-start').map(r=>r.data);assert.equal(starts.length,5);assert.ok(starts.every((r,i)=>!i||r.at-starts[i-1]!.at>=250));assert.equal(f.client.usage().requestLimits.maxStartsPerMinute,60);assert.equal(f.client.usage().requestLimits.physicalInFlight,1);assert.equal(f.client.usage().automaticRequestRetries,0);
  const authorization=JSON.parse(readFileSync(join(f.directory,'run/authorization.json'),'utf8'));assert.equal(authorization.historyRoute.endpoint,'https://solana-rpc.publicnode.com');assert.equal(authorization.endpoint,'https://api.mainnet.solana.com');
 }finally{f.close();}
});
test('history429 preserves Retry-After/uncertainty while primary pricing and healthy controls continue on the same gate',async()=>{
 let history=0,primary=0;const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async(url,init)=>{const b=JSON.parse(String(init?.body));if(String(url)==='https://solana-rpc.publicnode.com'){history++;return new Response('throttled',{status:429,headers:{'retry-after':'10'}});}primary++;return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));}) as typeof fetch});try{
  await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL]),/HTTP_429/);await turn();const until=f.client.historyCooldownUntil(),failed=readFileSync(join(f.directory,'run/chapter-001.json'));assert.equal(until,210000);assert.equal(f.client.cooldownUntil(),0);assert.equal(f.client.controlCooldownUntil(),0);assert.equal(f.client.usage().historyDispatchWindow!.readyAt,until);assert.ok(f.client.usage().rpcDispatchWindow!.readyAt<until);assert.equal(f.client.historyQueryReadyAt(HISTORY_POOL),until);await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL]),/COOLDOWN/);assert.equal(history,1);
  assert.equal(await f.client.call('getMultipleAccounts'),123);await f.client.operateData({transport:'ws',method:'pong'},async op=>op.completeResponse());assert.equal(primary,1);assert.equal(f.client.usage().newUnits,3);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);assert.equal(f.client.historyCooldownUntil(),until);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),failed);assert.equal(JSON.parse(readFileSync(join(f.directory,'run/status.json'),'utf8')).historyCooldownUntil,until);assert.equal(JSON.parse(readFileSync(join(f.directory,'run/chapter-001-summary.json'),'utf8')).historyCooldownUntil,until);
 }finally{f.close();}
});
test('primary HTTP throttle does not silently reroute it to history or erase a history service opportunity',async()=>{
 const seen:string[]=[];const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async(url,init)=>{seen.push(String(url));const b=JSON.parse(String(init?.body));return String(url)==='https://api.mainnet.solana.com'?new Response('throttled',{status:429,headers:{'retry-after':'10'}}):new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:[]}));}) as typeof fetch});try{
  await assert.rejects(f.client.call('getMultipleAccounts'),/HTTP_429/);await turn();assert.equal(f.client.historyCooldownUntil(),0);assert.equal(await f.client.call('getSignaturesForAddress',[HISTORY_POOL]) instanceof Array,true);assert.equal(f.client.historyQueryReadyAt(HISTORY_POOL),f.now());await assert.rejects(f.client.call('getMultipleAccounts'),/COOLDOWN/);assert.deepEqual(seen,['https://api.mainnet.solana.com','https://solana-rpc.publicnode.com']);assert.equal(f.client.usage().newUnits,2);
 }finally{f.close();}
});
test('history503 and explicit provider Retry-After remain history-local and survive chapter rollover',async()=>{
 const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async(url,init)=>{const b=JSON.parse(String(init?.body));return String(url)==='https://solana-rpc.publicnode.com'?new Response('busy',{status:503,headers:{'retry-after':'20'}}):new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));}) as typeof fetch});try{
  await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL]),/HTTP_STATUS_503/);await turn();const until=f.client.historyCooldownUntil();assert.equal(until,220000);assert.equal(f.client.cooldownUntil(),0);assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(f.client.historyCooldownUntil(),until);assert.equal(f.client.usage().chapter,2);assert.ok(f.client.usage().newAccountedResponseBytes>0);
 }finally{f.close();}
});
test('history physically unsettled timeout blocks every domain until actual settlement; no fallback or extra slot',async()=>{
 let release!:(v:Response)=>void,calls=0;const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async(url,init)=>{calls++;const b=JSON.parse(String(init?.body));if(String(url)==='https://solana-rpc.publicnode.com')return new Promise<Response>(r=>{release=r;});return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));}) as typeof fetch});try{
  await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);f.advance(3000);assert.equal(f.client.usage().inFlight,1);await assert.rejects(f.client.call('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);await assert.rejects(f.client.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse()),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(calls,1);assert.equal(f.client.usage().newUnits,1);release(new Response('{}'));await turn();await turn();assert.equal(f.client.usage().inFlight,0);assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.cooldownUntil(),0);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);
 }finally{f.close();}
});
test('inherited history cooldown is enforced without transferring it to primary and invalid route values are refused',async()=>{
 const f=fixture({historyRoute:'publicnode-history-only-v1',priorHistoryCooldownUntil:215000});try{await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL]),/COOLDOWN/);assert.equal(f.client.usage().newUnits,0);assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(f.client.historyCooldownUntil(),215000);assert.throws(()=>new PilotRpc({directory:join(f.directory,'invalid-route'),runId:'invalid-route',baselinePaths:[f.old],priorPhysicalSettled:true,historyRoute:'https://evil.example' as never}),/INVALID_HISTORY_ROUTE/);}finally{f.close();}
});
test('history batches use the same fixed history method endpoint, never primary and never one budget per item',async()=>{
 let target='';const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async(url,init)=>{target=String(url);const bs=JSON.parse(String(init?.body));return new Response(JSON.stringify(bs.map((b:any)=>({jsonrpc:'2.0',id:b.id,result:[]}))));}) as typeof fetch});try{const other='GAZmLL5v2omUcBmfVQyPwZWyrENt4uaonmCodfRUkjLp';const result=await f.client.callSignatureHistoryBatch([{key:'a',params:[HISTORY_POOL,{commitment:'confirmed',limit:100,minContextSlot:1}]},{key:'b',params:[other,{commitment:'confirmed',limit:100,minContextSlot:1}]}]);assert.equal(target,'https://solana-rpc.publicnode.com');assert.equal(result.logicalQueries,2);assert.equal(f.client.usage().newUnits,1);assert.equal(f.client.usage().signatureHistoryBatch.physicalHttpStarts,1);}finally{f.close();}
});

test('late history429 headers retain their provider cooldown without changing primary or bypassing actual settlement',async()=>{
 let release!:(v:Response)=>void;let calls=0;const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async(url,init)=>{calls++;const b=JSON.parse(String(init?.body));if(String(url)==='https://solana-rpc.publicnode.com')return new Promise<Response>(r=>{release=r;});return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));}) as typeof fetch});try{
  await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.equal(f.client.usage().inFlight,1);release(new Response('late',{status:429,headers:{'retry-after':'10'}}));await turn();await turn();assert.equal(f.client.usage().inFlight,0);assert.equal(f.client.historyCooldownUntil(),210000);assert.equal(f.client.cooldownUntil(),0);assert.equal(f.client.usage().newUnits,1);const persisted=JSON.parse(readFileSync(join(f.directory,'run/status.json'),'utf8'));assert.equal(persisted.historyCooldownUntil,210000);assert.equal(persisted.cooldownUntil,0);assert.equal(await f.client.call('getMultipleAccounts'),123);await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL]),/COOLDOWN/);assert.equal(calls,2);
 }finally{f.close();}
});
test('a linked HTTP429 book requires an explicit history cooldown receipt when enabling the separate history route',()=>{
 const f=fixture();try{const prior=JSON.parse(readFileSync(f.old,'utf8'));prior.haltedReason='COMPONENT_HTTP_429';writeFileSync(f.old,JSON.stringify(prior));const before=readFileSync(f.old);assert.throws(()=>new PilotRpc({directory:join(f.directory,'missing-history'),runId:'missing-history',baselinePaths:[f.old],priorPhysicalSettled:true,priorCooldownUntil:215000,historyRoute:'publicnode-history-only-v1'}),/PRIOR_HISTORY_THROTTLE_RECEIPT_REQUIRED/);assert.equal(existsSync(join(f.directory,'missing-history')),false);writeFileSync(f.old,f.before);}finally{f.close();}
});

test('history readiness freezes only the planning floor across advancing clocks, never provider admission',async()=>{
 const f=fixture({historyRoute:'publicnode-history-only-v1'},false,true);try{
  const planningAt=f.now();f.advance(5);assert.equal(f.client.historyQueryReadyAt(HISTORY_POOL,planningAt),planningAt,'reading a healthy query cannot push it one millisecond into its own future');assert.ok(f.client.historyQueryReadyAt(HISTORY_POOL)>planningAt,'legacy no-argument planning still describes the current clock');assert.equal(f.client.usage().newUnits,0);
  for(const invalid of [-1,0.5,NaN,Infinity])assert.throws(()=>f.client.historyQueryReadyAt(HISTORY_POOL,invalid),/METHOD_CLOCK/);
 }finally{f.close();}
 const blocked=fixture({historyRoute:'publicnode-history-only-v1',priorHistoryCooldownUntil:215000},false,true);try{
  const planningAt=blocked.now();blocked.advance(5);assert.equal(blocked.client.historyQueryReadyAt(HISTORY_POOL,planningAt),215000);await assert.rejects(blocked.client.call('getSignaturesForAddress',[HISTORY_POOL]),/COOLDOWN/);assert.equal(blocked.client.usage().newUnits,0);assert.equal(await blocked.client.call('getMultipleAccounts'),123,'history planning cannot introduce a primary-provider cooldown');
 }finally{blocked.close();}
});


test('persistent RPC rotates bounded accounting epochs beyond research lifetime/chapter limits and preserves restart anchors',async()=>{
 const f=fixture({persistent:true,maxUnits:1,maxChapters:1,chapterUnits:1,durationMs:1000});try{
  for(let i=0;i<70;i++){f.advance(65000);assert.equal(await f.client.call('getSlot'),123);}
  const u=f.client.usage();assert.equal(u.newUnits,70);assert.equal(u.cumulativeUnits,90);assert.equal(u.lifetimeCapsEnabled,false);assert.equal(u.deadlineAt,null);assert.equal(u.remainingMs,null);assert.ok(u.compactedAccountingEpochs>=2);assert.ok(u.recoveryBaselinePaths.length<32);assert.ok(u.recoveryBaselineCheckpointSha256);assert.ok(u.activeChapterPath);assert.ok(!u.recoveryBaselinePaths.includes(u.activeChapterPath));
  const checkpoint=JSON.parse(readFileSync(u.recoveryBaselinePaths[0]!,'utf8'));assert.equal(checkpoint.schemaVersion,2);assert.equal(checkpoint.physicalSettlement.physicalTransportsSettled,false);assert.equal(checkpoint.physicalSettlement.passiveStreamsMayRemainOpen,true);assert.equal(u.uncertainResponseBytes,2*MIB);assert.ok(existsSync(join(f.directory,'run/chapter-001.json')),'original raw books stay retained');
  f.client.close();const closed=f.client.usage();const linked=readResearchBaseline({paths:closed.recoveryBaselinePaths,checkpointSha256:closed.recoveryBaselineCheckpointSha256!,now:f.now(),physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS});assert.equal(linked.baseline.calls,90);assert.equal(linked.uncertainResponseBytes,2*MIB);assert.equal(closed.activeChapterPath,null);
 }finally{f.close();}
});
test('persistent control receipt rolls a full accounting byte epoch without stopping a healthy passive stream or changing provider cooldown',async()=>{
 const f=fixture({persistent:true,maxResponseBytes:4*MIB,chapterUnits:1});try{
  await f.client.call('getSlot');const first=f.client.usage().activeChapterPath!;
  for(let i=0;i<90;i++)f.client.accountControlBytes(65536);
  const u=f.client.usage();assert.ok(u.chapter>1);assert.equal(u.fatal,null);assert.equal(u.newUnits,1);assert.equal(u.cooldownUntil,0);assert.ok(u.newAccountedResponseBytes>=90*65536);assert.ok(existsSync(first));
 }finally{f.close();}
});


test('persistent passive receipts may cross an accounting epoch during an HTTP request without aborting or hiding its real ownership',async()=>{
 let resolveResponse!:(r:Response)=>void;let requestId:number|undefined;const f=fixture({persistent:true,maxResponseBytes:4*MIB,fetcher:(async(_url,init)=>{requestId=JSON.parse(String(init?.body)).id;return await new Promise<Response>(r=>{resolveResponse=r;});})as typeof fetch});try{
  const running=f.client.call('getSlot');await turn();const occupied=f.client.usage();assert.equal(occupied.inFlight,1);
  for(let i=0;i<90;i++)f.client.accountControlBytes(65536);const u=f.client.usage();assert.equal(u.inFlight,1);assert.equal(u.chapter,1);assert.equal(u.fatal,null);assert.equal(u.chapterUsage?.haltedReason,null);assert.ok(u.newAccountedResponseBytes>=90*65536);await assert.rejects(f.client.call('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.client.usage().newUnits,1,'an epoch rollover cannot create a parallel physical gate');
  resolveResponse(new Response(JSON.stringify({jsonrpc:'2.0',id:requestId,result:123})));assert.equal(await running,123);assert.equal(f.client.usage().inFlight,0);assert.equal(f.client.usage().fatal,null);assert.equal(f.client.usage().chapterUsage?.continuousAccounting,true);
 }finally{f.close();}
});


test('persistent startup compacts a fully populated512-source chain before another chapter can exceed the hot path bound',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-persistent-maxpaths-')),paths:string[]=[],hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');let now=100000000,mono=0;
 const legacy={schemaVersion:1,calls:2,bytes:100,lastObservedAt:1000,starts:[900,1000],pending:[{id:2,unobservedBytes:2*MIB}],blockedReason:'RPC_HTTP_429'};let raw=JSON.stringify(legacy)+'\n',path=join(directory,'old.json');writeFileSync(path,raw,{mode:0o600});paths.push(path);let baseline:any={calls:2,bytes:100+2*MIB,starts:[900,1000],refusal:'RPC_HTTP_429',refusalAt:1000,sha256:hash(raw)};
 for(let i=0;i<511;i++){const at=2000+i*60000;raw=JSON.stringify({schemaVersion:1,grantId:'prior-'+i,baseline,startedAt:at,lastObservedAt:at,starts:[at],actualInvocations:[{id:baseline.calls+1,at}],httpBytes:0,wsBytes:0,pending:[],haltedReason:null})+'\n';path=join(directory,'prior-'+i+'.json');writeFileSync(path,raw,{mode:0o600});paths.push(path);baseline={...baseline,calls:baseline.calls+1,starts:[...baseline.starts,at],sha256:hash(raw)};}
 const before=paths.map(p=>hash(readFileSync(p,'utf8'))),options={persistent:true as const,runId:'maxpaths-service',baselinePaths:paths,priorPhysicalSettled:true as const,priorCooldownUntil:0,chapterUnits:1,maxChapters:1,maxGetTransactionStartsPer10s:8,maxResponseBytes:4*MIB,now:()=>now,monotonic:()=>mono,sleep:async(ms:number)=>{now+=ms;mono+=ms;},fetcher:(async(_url:any,init:any)=>new Response(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(init.body).id,result:123})))as typeof fetch};let client:PilotRpc|undefined,restarted:PilotRpc|undefined;
 try{client=new PilotRpc({...options,directory:join(directory,'run')});assert.equal(client.usage().compactedAccountingEpochs,1);assert.equal(client.usage().recoveryBaselinePaths.length,1);assert.equal(await client.call('getSlot'),123);assert.ok(client.methodReadyAt('getTransaction',8)>now,'newly sealed unknown reservations must occupy the method window too');assert.equal(await client.call('getSlot'),123);client.close();const closed=client.usage();assert.equal(closed.cumulativeUnits,515);assert.equal(closed.uncertainResponseBytes,2*MIB);assert.deepEqual(paths.map(p=>hash(readFileSync(p,'utf8'))),before);
  restarted=new PilotRpc({...options,runId:'maxpaths-resumed',directory:join(directory,'resumed'),baselinePaths:closed.recoveryBaselinePaths,baselineCheckpointSha256:closed.recoveryBaselineCheckpointSha256!});assert.equal(await restarted.call('getSlot'),123);assert.equal(restarted.usage().cumulativeUnits,516);assert.equal(restarted.usage().uncertainResponseBytes,2*MIB);
 }finally{restarted?.close();client?.close();rmSync(directory,{recursive:true,force:true});}
});


test('uninvoked history refusal is owned per-call evidence, never a matching error string or provider error',async()=>{
 assert.equal(pilotUninvokedHistoryRefusal(new Error('PILOT_RPC_COMPONENT_ADMISSION_CLOSED')),null);
 assert.equal(pilotUninvokedHistoryRefusal(new PilotRpcUnavailable('COMPONENT_ADMISSION_CLOSED')),null);
 const f=fixture();try{
  let refusal:unknown;try{await f.client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{queryTimeoutScope:'independent-history',admissionOpen:()=>false});assert.fail('refusal required');}catch(e){refusal=e;}
  const proof=pilotUninvokedHistoryRefusal(refusal);assert.ok(proof);assert.equal(proof.pool,HISTORY_POOL);assert.equal(proof.code,'COMPONENT_ADMISSION_CLOSED');assert.equal(proof.physicalSettled,true);assert.ok(Object.isFrozen(proof));assert.equal(f.client.usage().chapterUsage!.actualInvokedUnits,0);assert.equal(f.client.usage().newUnits,0);assert.equal(f.invocations.length,0);
 }finally{f.close();}
 let fetches=0;const invoked=fixture({fetcher:(async()=>{fetches++;throw Error('COMPONENT_ADMISSION_CLOSED');}) as typeof fetch});try{
  let error:unknown;try{await invoked.client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{queryTimeoutScope:'independent-history'});assert.fail('provider failure required');}catch(e){error=e;}
  assert.equal(fetches,1);assert.equal(invoked.client.usage().chapterUsage!.actualInvokedUnits,1);assert.equal(pilotUninvokedHistoryRefusal(error),null,'a transport invocation cannot become a retriable pre-dispatch refusal');assert.ok(invoked.client.usage().uncertainResponseBytes>=4*MIB);
 }finally{invoked.close();}
});

test('a physically unsettled history timeout has no no-invocation proof and retains its original slot',async()=>{
 let settle!:(r:Response)=>void;const f=fixture({fetcher:(async()=>await new Promise<Response>(r=>{settle=r;})) as typeof fetch});try{
  let timeout:unknown;try{await f.client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{queryTimeoutScope:'independent-history',timeoutMs:5});assert.fail('timeout required');}catch(e){timeout=e;}
  assert.equal(pilotUninvokedHistoryRefusal(timeout),null);assert.equal(f.client.usage().inFlight,1);assert.equal(f.client.usage().chapterUsage!.actualInvokedUnits,1);let blocked:unknown;try{await f.client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{queryTimeoutScope:'independent-history'});}catch(e){blocked=e;}
  assert.equal(pilotUninvokedHistoryRefusal(blocked)?.physicalSettled,false);assert.equal(f.client.usage().newUnits,1);assert.throws(()=>f.client.close(),/PHYSICAL_SLOT_OCCUPIED/);
 }finally{settle(new Response('late'));await turn();await turn();f.close();}
});

test('provider diagnostics attribute actual HTTP starts and429 response method without narrowing its restriction',async()=>{
 let calls=0;const f=fixture({fetcher:(async(_url,init)=>{calls++;const b=JSON.parse(String(init?.body));return calls===1?new Response('denied',{status:429,headers:{'retry-after':'10'}}):new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));}) as typeof fetch});try{
  await assert.rejects(f.client.call('getTransaction'),/HTTP_429/);await turn();const p=f.client.usage().providerResponses;
  assert.equal(p.scope,'CURRENT_PILOT_RPC_INSTANCE');assert.equal(p.runId,'isolated-test');assert.equal(p.httpStarts,1);assert.equal(p.httpResponses,1);assert.equal(p.rateLimitedResponses,1);assert.equal(p.unavailableResponses,0);assert.deepEqual(p.byMethod,[{method:'getTransaction',httpStarts:1,httpResponses:1,rateLimitedResponses:1,unavailableResponses:0}]);assert.equal(p.lastRestriction!.method,'getTransaction');assert.equal(p.lastRestriction!.domain,'rpc');assert.equal(p.lastRestriction!.status,429);assert.equal(p.lastRestriction!.retryAfterMs,10000);assert.equal(p.lastRestriction!.cooldownUntil,210000);assert.ok(Number.isSafeInteger(p.lastRestriction!.physicalRequestId));assert.equal(p.methodSpecificProviderScopeKnown,false);assert.equal(p.extraProviderRequests,0);
  await assert.rejects(f.client.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(calls,1);assert.equal(f.client.usage().providerResponses.httpStarts,1);assert.equal(f.client.protectionProviderRestrictionUntil(),210000);
  assert.ok(f.records.some(r=>r.kind==='pilot-rpc-unavailable'&&r.data.method==='getTransaction'&&r.data.retryAfterMs===10000));f.advance(10000);assert.equal(await f.client.call('getMultipleAccounts'),123);const after=f.client.usage().providerResponses;assert.equal(after.httpStarts,2);assert.equal(after.httpResponses,2);assert.equal(after.rateLimitedResponses,1);assert.equal(after.lastRestriction!.method,'getTransaction');assert.equal(after.byMethod.length,2);p.byMethod[0]!.httpStarts=999;assert.equal(f.client.usage().providerResponses.byMethod[0]!.httpStarts,1);
 }finally{f.close();}
});

test('provider diagnostics retain history-domain503 attribution and effective delay without exposing raw headers',async()=>{
 const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async()=>new Response('busy',{status:503,headers:{'retry-after':'20'}}))as typeof fetch});try{
  await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL]),/HTTP_STATUS_503/);await turn();const p=f.client.usage().providerResponses;assert.equal(p.httpStarts,1);assert.equal(p.httpResponses,1);assert.equal(p.unavailableResponses,1);assert.equal(p.rateLimitedResponses,0);assert.equal(p.lastRestriction!.method,'getSignaturesForAddress');assert.equal(p.lastRestriction!.domain,'history');assert.equal(p.lastRestriction!.status,503);assert.equal(p.lastRestriction!.retryAfterMs,20000);assert.equal(p.lastRestriction!.cooldownUntil,220000);assert.equal(f.client.cooldownUntil(),0);assert.equal(p.methodSpecificProviderScopeKnown,false);assert.ok(!JSON.stringify(p).includes('retry-after'));
 }finally{f.close();}
});

test('late provider headers remain method-attributed after timeout and persist the same actual restriction',async()=>{
 let release!:(v:Response)=>void;const f=fixture({historyRoute:'publicnode-history-only-v1',fetcher:(async()=>new Promise<Response>(r=>{release=r;}))as typeof fetch});try{
  await assert.rejects(f.client.call('getSignaturesForAddress',[HISTORY_POOL],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.equal(f.client.usage().inFlight,1);assert.equal(f.client.usage().providerResponses.httpResponses,0);release(new Response('late',{status:429,headers:{'retry-after':'10'}}));await turn();await turn();const p=f.client.usage().providerResponses;assert.equal(p.httpStarts,1);assert.equal(p.httpResponses,1);assert.equal(p.lastRestriction!.method,'getSignaturesForAddress');assert.equal(p.lastRestriction!.observedAfterLogicalCompletion,true);assert.equal(p.lastRestriction!.cooldownUntil,210000);assert.equal(f.client.cooldownUntil(),0);assert.equal(f.client.historyCooldownUntil(),210000);const saved=JSON.parse(readFileSync(join(f.directory,'run/status.json'),'utf8'));assert.deepEqual(saved.providerResponses,p);
 }finally{f.close();}
});

test('valid explicit HTTP Retry-After numeric and date floors have no unmeasured padding or method bypass',async()=>{
 for(const header of ['10',new Date(210000).toUTCString()]){
  let calls=0;const f=fixture({fetcher:(async(_url,init)=>{calls++;const b=JSON.parse(String(init?.body));return calls===1?new Response('limited',{status:429,headers:{'retry-after':header}}):new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));})as typeof fetch});try{
   await assert.rejects(f.client.call('getTransaction'),/HTTP_429/);await turn();assert.equal(f.client.cooldownUntil(),210000);assert.equal(f.client.protectionProviderRestrictionUntil(),210000);assert.equal(f.client.usage().providerResponses.lastRestriction!.cooldownUntil,210000);f.advance(9999);await assert.rejects(f.client.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(calls,1,'a different method cannot bypass the global provider floor');f.advance(1);assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(calls,2);assert.equal(f.client.usage().newUnits,2);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);
  }finally{f.close();}
 }
});

test('unknown or invalid HTTP Retry-After retains the conservative65-second fallback',async()=>{
 for(const header of [null,'not-a-delay','',new Date(190000).toUTCString()]){
  const f=fixture({fetcher:(async()=>new Response('limited',{status:429,headers:header===null?{}:{'retry-after':header}}))as typeof fetch});try{
   await assert.rejects(f.client.call('getTransaction'),/HTTP_429/);await turn();assert.equal(f.client.cooldownUntil(),265000);assert.equal(f.client.protectionProviderRestrictionUntil(),265000);assert.equal(f.client.usage().providerResponses.lastRestriction!.retryAfterMs,null);assert.equal(f.client.usage().providerResponses.lastRestriction!.cooldownUntil,265000);await assert.rejects(f.client.call('getMultipleAccounts'),/COOLDOWN/);assert.equal(f.client.usage().newUnits,1);
  }finally{f.close();}
 }
});

test('explicit HTTP delay expiry never releases an unsettled physical response or its uncertainty',async()=>{
 let calls=0,releaseCancel:(()=>void)|undefined;const f=fixture({fetcher:(async(_url,init)=>{calls++;const b=JSON.parse(String(init?.body));return calls===1?new Response(new ReadableStream({cancel(){return new Promise<void>(resolve=>{releaseCancel=resolve;});}}),{status:429,headers:{'retry-after':'10'}}):new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:123}));})as typeof fetch});try{
  await assert.rejects(f.client.call('getTransaction',[],undefined,{timeoutMs:5}),/PHYSICAL_TIMEOUT/);assert.ok(releaseCancel);assert.equal(f.client.cooldownUntil(),210000);assert.equal(f.client.usage().inFlight,1);f.advance(10000);await assert.rejects(f.client.call('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(calls,1);assert.equal(f.client.usage().inFlight,1);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);releaseCancel();await turn();await turn();assert.equal(f.client.usage().inFlight,0);assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(calls,2);assert.equal(f.client.usage().uncertainResponseBytes,4*MIB);
 }finally{releaseCancel?.();await turn();await turn();f.close();}
});
