import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ComponentBudget,COMPONENT_RECEIPT_ACCOUNTING,type ComponentBudgetOptions} from '../src/component-budget.js';
import {readResearchBaseline,createResearchBaselineCheckpoint} from '../src/research-baseline.js';
import {PilotRpc} from '../src/pilot-rpc.js';

const MIB=1024*1024,HTTP={transport:'http' as const,method:'getMultipleAccounts'};
function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'poe-receipt-accounting-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let now=100000;
 const legacy=join(dir,'legacy.json');writeFileSync(legacy,JSON.stringify({schemaVersion:1,calls:0,bytes:0,starts:[],pending:[],blockedReason:'RPC_HTTP_429',lastObservedAt:1}),{mode:0o600});
 const baseline=readResearchBaseline({paths:[legacy],now,physicalSettled:true}).baseline;
 const options:ComponentBudgetOptions={statePath:join(dir,'chapter.json'),grantId:'receipt-accounting-fixture',baseline,startedAt:now,continuousAccounting:true,limits:{maxCumulativeUnits:null,maxCumulativeBytes:null},now:()=>now,monotonic:()=>now,sleep:async ms=>{now+=ms;}};
 return {dir,legacy,options,get now(){return now;},set now(value:number){now=value;},book:()=>JSON.parse(readFileSync(options.statePath,'utf8')),read:()=>readResearchBaseline({paths:[legacy,options.statePath],now,physicalSettled:true,allowCumulativeBeyondLegacy:true})};
}
function crash(f:ReturnType<typeof fixture>,kind:'ws'|'http'){
 const options={...f.options,now:undefined,monotonic:undefined,sleep:undefined},module=fileURLToPath(new URL('../src/component-budget.ts',import.meta.url));
 const code=`import {ComponentBudget} from ${JSON.stringify(module)};const options=${JSON.stringify(options)};options.now=()=>100000;options.monotonic=()=>100000;const gate=new ComponentBudget(options);${kind==='ws'?"gate.chargePassiveWs(85);process.exit(0);":"await gate.operate({transport:'http',method:'getMultipleAccounts'},async c=>{c.chargeHttp(85);process.exit(0);});"}`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:process.cwd(),encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
}

test('busy passive receipts consume bounded durable reservations without per-message persistence',t=>{
 const f=fixture(t);let writes=0;const gate=new ComponentBudget({...f.options,beforePersist(){writes++;f.now+=10;}});
 try{
  const before=writes,started=f.now;for(let i=0;i<1200;i++)gate.chargePassiveWs(4096);
  assert.equal(writes-before,2,'two replenishments plus the initial precharged block cover the full burst');assert.equal(f.now-started,20,'injected durability latency is per block, not per notification');
  const exact=gate.usage(),book=f.book(),reserved=book.byteAccounting.reservedBytes;
  assert.equal(exact.wsBytes,4915200);assert.equal(exact.newUnits,0);assert.equal(exact.actualInvokedUnits,0);assert.equal(exact.uncertainResponseBytes,0,'future unreceived capacity is not claimed as a measured or uncertain live response');
  assert.ok(book.wsBytes<=exact.wsBytes&&book.wsBytes+reserved>=exact.wsBytes,'durable bound covers every accepted but uncheckpointed byte');
  const linked=f.read();assert.equal(linked.observedBytes,book.wsBytes);assert.equal(linked.uncertainResponseBytes,reserved);assert.equal(linked.pendingOperations,0,'a byte reservation cannot manufacture a physical operation');
  gate.close();const settled=f.read();assert.equal(settled.observedBytes,4915200);assert.equal(settled.uncertainResponseBytes,0);assert.equal(f.book().byteAccounting.reservedBytes,0);
 }finally{if(!gate.usage().closed)gate.close();}
});

test('an abrupt passive crash is retained as uncertainty, never invented measured bytes or a new request',t=>{
 const f=fixture(t);crash(f,'ws');const crashed=f.book(),before=readFileSync(f.options.statePath);assert.equal(crashed.schemaVersion,2);assert.equal(crashed.wsBytes,0);assert.equal(crashed.byteAccounting.reservedBytes,4*MIB);
 const linked=f.read();assert.equal(linked.observedBytes,0);assert.equal(linked.uncertainResponseBytes,4*MIB);assert.equal(linked.baseline.calls,0);assert.equal(linked.pendingOperations,0);assert.ok(readFileSync(f.options.statePath).equals(before),'read-only recovery does not rewrite prior evidence');
 const resumed=new ComponentBudget(f.options);resumed.chargePassiveWs(100);assert.equal(resumed.usage().wsBytes,100);assert.equal(resumed.usage().uncertainResponseBytes,4*MIB);assert.equal(resumed.newUnits,0);resumed.close();
 const after=f.read();assert.equal(after.observedBytes,100);assert.equal(after.uncertainResponseBytes,4*MIB);const again=new ComponentBudget(f.options);assert.equal(again.usage().uncertainResponseBytes,4*MIB);again.close();assert.equal(f.read().uncertainResponseBytes,4*MIB,'graceful replay cannot repeatedly charge or forgive the old crash tail');
});

test('HTTP receipt chunks reuse their durable physical response reservation until settlement',async t=>{
 const f=fixture(t);let writes=0;const gate=new ComponentBudget({...f.options,beforePersist(){writes++;}});
 try{
  let release!:()=>void;const result=gate.operate(HTTP,async c=>{const before=writes;for(let i=0;i<100;i++)c.chargeHttp(1024);assert.equal(writes,before,'no body-chunk fsync inside an already durable 2MiB reservation');await new Promise<void>(r=>{release=r;});c.completeResponse();});
  await new Promise(r=>setImmediate(r));const live=gate.usage(),book=f.book();assert.equal(live.httpBytes,102400);assert.equal(live.newUnits,1);assert.equal(book.httpBytes+book.pending[0].reservedBytes,2*MIB,'the persisted observed prefix plus tail covers the complete permitted response');release();await result;
  assert.equal(f.book().httpBytes,102400);assert.deepEqual(f.book().pending,[]);assert.equal(gate.usage().uncertainResponseBytes,0);
 }finally{gate.close();}
});

test('an abrupt HTTP-body crash retains the original full durable uncertainty and request identity',t=>{
 const f=fixture(t);crash(f,'http');const book=f.book(),linked=f.read();assert.equal(book.httpBytes,0);assert.equal(book.starts.length,1);assert.equal(book.pending[0].reservedBytes,2*MIB);assert.equal(linked.observedBytes,0);assert.equal(linked.uncertainResponseBytes,6*MIB,'physical2MiB plus independently pre-funded passive4MiB tails remain uncertain');assert.equal(linked.pendingOperations,1);assert.equal(linked.baseline.calls,1);
});

test('coalesced exact-receipt checkpoints preserve an honest late timer and close flushes its tail',async t=>{
 const f=fixture(t),gate=new ComponentBudget(f.options);gate.chargePassiveWs(123);assert.equal(f.book().wsBytes,0);f.now+=1100;await new Promise(r=>setTimeout(r,COMPONENT_RECEIPT_ACCOUNTING.maximumScheduledFlushMs+30));assert.equal(f.book().wsBytes,123);assert.equal(gate.usage().byteAccounting!.timerFlushes,1);assert.ok(gate.usage().byteAccounting!.maximumDirtyAgeMs>=1100);gate.chargePassiveWs(11);gate.close();assert.equal(f.book().wsBytes,134);assert.equal(f.read().uncertainResponseBytes,0);
});

for(const receiptBytes of [1,2*MIB])test(`a failed passive refill retains the entire already received ${receiptBytes}-byte payload in its prior durable bound`,t=>{
 const f=fixture(t);let fail=false;const gate=new ComponentBudget({...f.options,beforePersist(){if(fail)throw Error('OFFLINE unavailable storage');}});fail=true;
 gate.chargePassiveWs(2*MIB);assert.throws(()=>gate.chargePassiveWs(receiptBytes),/STORAGE_UNAVAILABLE/);assert.equal(gate.usage().wsBytes,2*MIB+receiptBytes);assert.equal(gate.usage().storageFailed,true);assert.equal(f.book().wsBytes,0);assert.equal(f.book().byteAccounting.reservedBytes,4*MIB);assert.ok(f.book().wsBytes+f.book().byteAccounting.reservedBytes>=gate.usage().wsBytes);assert.throws(()=>gate.chargePassiveWs(1),/CLOSED/);gate.close();
});

test('an in-flight HTTP settlement may persist an honest partial passive tail after a failed refill',async t=>{
 const f=fixture(t);let fail=false;const gate=new ComponentBudget({...f.options,beforePersist(){if(fail)throw Error('OFFLINE transient storage refusal');}});
 let release!:()=>void;
 try{
  const pending=gate.operate(HTTP,async c=>{c.chargeHttp(10);await new Promise<void>(r=>{release=r;});c.completeResponse();});await new Promise(r=>setImmediate(r));
  gate.chargePassiveWs(2*MIB);fail=true;assert.throws(()=>gate.chargePassiveWs(MIB),/STORAGE_UNAVAILABLE/);assert.equal(gate.usage().storageFailed,true);fail=false;release();await pending;
  const book=f.book();assert.equal(book.wsBytes,3*MIB);assert.equal(book.httpBytes,10);assert.equal(book.byteAccounting.reservedBytes,MIB,'the failed refill retained its honest remainder, not an invented successful top-up');
  gate.close();const linked=f.read();assert.equal(linked.observedBytes,3*MIB+10);assert.equal(linked.uncertainResponseBytes,MIB);assert.equal(linked.pendingOperations,0);assert.equal(linked.baseline.calls,1);
  const resumed=new ComponentBudget(f.options);assert.equal(resumed.usage().uncertainResponseBytes,MIB);assert.equal(resumed.usage().byteAccounting!.reservedBytes,4*MIB);resumed.close();assert.equal(f.read().uncertainResponseBytes,MIB);
 }finally{fail=false;release?.();if(!gate.usage().closed)gate.close();}
});

test('settled-reader checkpoints and handoffs preserve passive crash uncertainty without increasing RPC starts',t=>{
 const f=fixture(t);crash(f,'ws');const checkpoint=createResearchBaselineCheckpoint({paths:[f.legacy,f.options.statePath],now:f.now,physicalSettled:true,settlement:{inFlight:0,waitingOrOperating:false,physicalTransportsSettled:true},allowCumulativeBeyondLegacy:true,outputPath:join(f.dir,'sealed.json')});
 const read=readResearchBaseline({paths:[join(f.dir,'sealed.json')],checkpointSha256:checkpoint.baselineCheckpointSha256,now:f.now,physicalSettled:true,allowCumulativeBeyondLegacy:true});assert.equal(read.baseline.calls,0);assert.equal(read.observedBytes,0);assert.equal(read.uncertainResponseBytes,4*MIB);assert.equal(read.pendingOperations,0);
});

test('malformed or unversioned passive accounting cannot silently disappear from a baseline reader',t=>{
 const f=fixture(t),gate=new ComponentBudget(f.options);gate.close();const valid=f.book();
 for(const value of [{...valid,byteAccounting:undefined},{...valid,byteAccounting:{...valid.byteAccounting,reservedBytes:4*MIB+1}},{...valid,schemaVersion:1}]){writeFileSync(f.options.statePath,JSON.stringify(value),{mode:0o600});assert.throws(()=>f.read(),/BYTE_ACCOUNTING/);}
});

test('passive epoch rollover accounts the already received payload before a new epoch can fail',async t=>{
 const f=fixture(t),directory=join(f.dir,'pilot'),rpc=new PilotRpc({directory,runId:'receipt-rotation-offline',baselinePaths:[f.legacy],priorPhysicalSettled:true,persistent:true,maxResponseBytes:4*MIB,now:()=>f.now,monotonic:()=>f.now,sleep:async ms=>{f.now+=ms;}});
 try{
  await rpc.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>op.completeResponse());rpc.accountControlBytes(2*MIB);rpc.accountControlBytes(1);
  const internals=rpc as unknown as {openChapter:(...args:unknown[])=>void;finishChapter:()=>void};internals.openChapter=()=>{internals.finishChapter();throw Error('COMPONENT_STORAGE_UNAVAILABLE');};
  assert.throws(()=>rpc.accountControlBytes(100),/STORAGE_UNAVAILABLE/);const old=JSON.parse(readFileSync(join(directory,'chapter-001.json'),'utf8'));
  assert.equal(old.wsBytes,2*MIB+101,'the receipt is in the closed durable old prefix despite failed next-epoch setup');assert.equal(old.byteAccounting.reservedBytes,0);assert.equal(rpc.usage().newAccountedResponseBytes,2*MIB+101);assert.equal(rpc.usage().fatal,'COMPONENT_STORAGE_UNAVAILABLE');assert.equal(rpc.usage().newUnits,1);
 }finally{rpc.close();}
});
