import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SelectionPacedRpc} from '../src/research-pacing.js';
import {ResearchPhaseRpc} from '../src/research-phase.js';
import {ResearchRpc} from '../src/research-rpc.js';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'poe-selection-pacing-'));let now=10_000,calls=0,bytes=0,active=0,blocked:string|null=null,nextStartAfterMs=0;
  const starts:number[]=[],waits:number[]=[];
  const rpc={get calls(){return calls;},get bytes(){return bytes;},get inFlight(){return active;},usage(){return {blockedReason:blocked,nextStartAfterMs};},async call<T>(){assert.equal(active,0);active++;calls++;starts.push(now);now+=250;bytes+=100;active--;return null as T;}};
  const options={statePath:join(dir,'pace.json'),now:()=>now,monotonic:()=>now,sleep:async(ms:number)=>{waits.push(ms);now+=ms;nextStartAfterMs=0;}};
  return {dir,rpc,options,starts,waits,get now(){return now;},set now(n:number){now=n;},set blocked(v:string|null){blocked=v;},set delay(v:number){nextStartAfterMs=v;},clean(){rmSync(dir,{recursive:true,force:true});}};
}

test('selection enforces actual spacing across phase wrappers without duplicating shared request accounting',async()=>{
  const f=fixture(),paced=new SelectionPacedRpc(f.rpc,f.options);
  try{
    const select=new ResearchPhaseRpc(paced,'SELECTION',8,4*1024*1024),quote=new ResearchPhaseRpc(paced,'SUPPORT',8,4*1024*1024);
    await select.call('getTransaction');await quote.call('getMultipleAccounts');await select.call('getBlockTime');
    assert.deepEqual(f.starts,[10_000,11_250,12_500]);assert.deepEqual(f.waits,[1000,1000]);assert.equal(f.rpc.calls,3);assert.equal(f.rpc.bytes,300);
    assert.equal(select.usage().calls,3);assert.equal(paced.calls,3);assert.equal(paced.usage().pacing.waitedMs,2000);
    const saved=JSON.parse(readFileSync(f.options.statePath,'utf8'));assert.equal(saved.lastStartedAt,12_500);assert.equal(saved.lastSettledAt,12_750);
  }finally{paced.close();f.clean();}
});

test('spacing survives a process-style restart and honors stricter source delay before transport',async()=>{
  const f=fixture();let paced=new SelectionPacedRpc(f.rpc,f.options);
  try{
    await paced.call('getTransaction');paced.close();f.now=10_500;
    paced=new SelectionPacedRpc(f.rpc,f.options);f.delay=2400;await paced.call('getBlockTime');
    assert.deepEqual(f.waits,[2400]);assert.deepEqual(f.starts,[10_000,12_900]);assert.equal(f.rpc.calls,2);
  }finally{paced.close();f.clean();}
});

test('cancelled pacing wait does not start, charge or reserve another provider request',async()=>{
  const f=fixture();let waiting=false;
  const options={...f.options,sleep:async(_ms:number,signal?:AbortSignal)=>{waiting=true;await new Promise<void>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(Error('RESEARCH_PACING_ABORTED')),{once:true}));}};
  const paced=new SelectionPacedRpc(f.rpc,options),abort=new AbortController();
  try{
    await paced.call('getTransaction');const before=readFileSync(options.statePath,'utf8'),pending=paced.call('getTransaction',[],abort.signal);assert.equal(waiting,true);abort.abort();await assert.rejects(pending,/RESEARCH_PACING_ABORTED/);
    assert.equal(f.rpc.calls,1);assert.equal(f.rpc.bytes,100);assert.equal(readFileSync(options.statePath,'utf8'),before);assert.equal(paced.usage().pacing.waitingOrDispatching,false);
  }finally{paced.close();f.clean();}
});

test('one dispatcher and one owning pacing state prevent parallel waits and independent burst gates',async()=>{
  const f=fixture();let finish:()=>void=()=>{};
  const rpc={...f.rpc,call:async<T>()=>new Promise<T>(resolve=>{finish=()=>resolve(null as T);})};
  const paced=new SelectionPacedRpc(rpc,f.options);
  try{
    const pending=paced.call('getTransaction');await assert.rejects(paced.call('getBlockTime'),/RESEARCH_PACING_DISPATCH_BUSY/);
    assert.throws(()=>new SelectionPacedRpc(rpc,f.options),/RESEARCH_PACING_STATE_OWNED/);finish();await pending;
  }finally{paced.close();f.clean();}
});

test('real shared counterbook retains HTTP429 across pacer and RPC restart, without retry or clearing',async()=>{
  const f=fixture(),budgetPath=join(f.dir,'budget.json');let transports=0;
  const transport=(async()=>{transports++;return new Response('{"error":"limited"}',{status:429});}) as typeof fetch;
  let rpc=new ResearchRpc({budgetPath,now:()=>f.now,transport}),paced=new SelectionPacedRpc(rpc,f.options);
  try{
    await assert.rejects(paced.call('getBlockTime',[1]),/RESEARCH_RPC_HTTP_429/);assert.equal(transports,1);assert.equal(rpc.calls,1);assert.equal(rpc.usage().blockedReason,'RPC_HTTP_429');
    const before=readFileSync(budgetPath,'utf8');paced.close();rpc.close();f.now+=2000;
    rpc=new ResearchRpc({budgetPath,now:()=>f.now,transport});paced=new SelectionPacedRpc(rpc,f.options);
    await assert.rejects(paced.call('getBlockTime',[1]),/RESEARCH_PACING_PROVIDER_HALTED/);
    assert.equal(transports,1);assert.equal(readFileSync(budgetPath,'utf8'),before);assert.equal(paced.usage().pacing.haltedReason,'RPC_HTTP_429');
  }finally{paced.close();rpc.close();f.clean();}
});

test('physical slot remains occupied after cancellation when transport ignores abort; no new request is started',async()=>{
  const f=fixture(),budgetPath=join(f.dir,'budget.json');let release!:(res:Response)=>void,transports=0;
  const transport=(async(_url,init)=>{transports++;if(transports===1)return new Promise<Response>(resolve=>{release=resolve;});const id=JSON.parse(String(init?.body)).id;return new Response(JSON.stringify({jsonrpc:'2.0',id,result:2}));}) as typeof fetch;
  const rpc=new ResearchRpc({budgetPath,now:()=>f.now,transport}),paced=new SelectionPacedRpc(rpc,f.options),abort=new AbortController();
  try{
    const pending=paced.call('getBlockTime',[1],abort.signal);assert.equal(rpc.inFlight,1);abort.abort();await assert.rejects(pending,/RESEARCH_RPC_ABORTED/);
    assert.equal(rpc.inFlight,1);assert.equal(rpc.calls,1);await assert.rejects(paced.call('getTransaction'),/RESEARCH_PACING_PHYSICAL_SLOT_OCCUPIED/);assert.equal(rpc.calls,1);
    assert.throws(()=>paced.close(),/RESEARCH_PACING_PHYSICAL_SLOT_OCCUPIED/);
    f.now+=5000;release(new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:1})));for(let i=0;i<10&&rpc.inFlight;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(rpc.inFlight,0);assert.equal(rpc.calls,1);assert.equal(rpc.usage().uncertainResponseBytes,2*1024*1024);
    const atSettlementObservation=f.now;await paced.call('getBlockTime',[2]);assert.deepEqual(f.waits,[1000]);assert.ok(f.now>=atSettlementObservation+1000);assert.equal(rpc.calls,2);assert.equal(transports,2);assert.equal(rpc.usage().uncertainResponseBytes,2*1024*1024);
  }finally{paced.close();rpc.close();f.clean();}
});

test('clock regression and attempts to disable spacing fail closed without provider work',async()=>{
  const f=fixture();assert.throws(()=>new SelectionPacedRpc(f.rpc,{...f.options,minimumStartSpacingMs:0}),/INVALID_SPACING/);
  const paced=new SelectionPacedRpc(f.rpc,f.options);
  try{await paced.call('getBlockTime');f.now=1;await assert.rejects(paced.call('getBlockTime'),/CLOCK_REGRESSION/);assert.equal(f.rpc.calls,1);}
  finally{paced.close();f.clean();}
});

test('the historical fourteen-request burst is spread over at least thirteen seconds by actual pacing',async()=>{
  const f=fixture(),paced=new SelectionPacedRpc(f.rpc,f.options);
  try{for(let i=0;i<14;i++)await paced.call('getTransaction');assert.equal(f.rpc.calls,14);assert.ok(f.starts.at(-1)!-f.starts[0]!>=13_000);assert.ok(f.starts.every((s,i)=>i===0||s-f.starts[i-1]!>=1000));}
  finally{paced.close();f.clean();}
});

test('a forward wall-time step cannot bypass the monotonic selection cooldown',async()=>{
  const f=fixture();let mono=10_000;
  const paced=new SelectionPacedRpc(f.rpc,{...f.options,monotonic:()=>mono,sleep:async(ms:number)=>{f.waits.push(ms);mono+=ms;f.now+=ms;}});
  try{await paced.call('getTransaction');f.now+=60_000;await paced.call('getTransaction');assert.deepEqual(f.waits,[1000]);assert.equal(f.rpc.calls,2);}
  finally{paced.close();f.clean();}
});
