import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,statSync,readFileSync,existsSync,chmodSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PaperLedger,type UsdPrice} from '../src/ledger.js';
import {PaperObservationRuntime,runtimeCommand} from '../src/runtime.js';
import {createServer,createConnection} from 'node:net';
import {once} from 'node:events';

const MINT='7q9JLdtpktvSqvep8QLPbqRqeJKC4L3izhKLtoojpump';
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'poe-runtime-fixture-'));
  let now=Date.now();const path=join(directory,'isolated-paper.sqlite');
  const ledger=new PaperLedger(path,'poe-fixture-observer');
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at:now,source:'disposable-runtime-fixture'});
  ledger.initialize(price(),now);
  const socketDirectory=join(directory,'socket');mkdirSync(socketDirectory,{mode:0o700});
  return {directory,path,ledger,price,now:()=>now,advance:(ms:number)=>now+=ms,socketPath:join(socketDirectory,'control.sock')};
}
test('runtime never initializes an absent account and accepts only PAPER identity',()=>{
  const directory=mkdtempSync(join(tmpdir(),'poe-uninitialized-fixture-'));
  const ledger=new PaperLedger(join(directory,'uninitialized.sqlite'),'poe-fixture-empty');
  try{
    assert.throws(()=>new PaperObservationRuntime({ledger,directory,socketPath:join(directory,'sock'),release:'fixture'}),/not initialized/);
    assert.throws(()=>ledger.state(),/not initialized/);
  }finally{ledger.close();rmSync(directory,{recursive:true});}
});
test('one financial owner serves private controls, refuses resume, and preserves inception across restart',async()=>{
  const f=fixture();let runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false,priceProvider:async()=>f.price()});
  try{
    const inception=f.ledger.state().inceptionAt;
    await runtime.start();assert.equal(statSync(f.socketPath).mode&0o777,0o600);
    const status=await runtimeCommand(f.socketPath,'status');
    assert.equal(status.accountId,'poe-fixture-observer');assert.equal(status.liveTrading,false);
    assert.equal((await runtimeCommand(f.socketPath,'resume')).enabled,false);
    assert.equal((await runtimeCommand(f.socketPath,'pause')).paused,true);
    const snapshot=runtime.snapshot(f.now());
    assert.equal(snapshot.status.entries,'disabled');assert.equal(snapshot.balances.equityUsd,1000);
    const sequence=BigInt(snapshot.sequence);
    await runtime.close();
    f.advance(100);
    const recovered=new PaperLedger(f.path,'poe-fixture-observer');
    assert.equal(recovered.state().inceptionAt,inception);assert.equal(recovered.state().lamports,'10000000000');
    runtime=new PaperObservationRuntime({...f,ledger:recovered,release:'fixture-release',connectFeed:false});
    await runtime.start();const next=runtime.snapshot(f.now());
    assert.ok(BigInt(next.sequence)>sequence);assert.equal(next.balances.equityUsd,null);
    assert.equal(next.balances.tradingPnlUsd,null);assert.ok(next.pnl.some(p=>p.tradingUsd===null));
  }finally{await runtime.close();rmSync(f.directory,{recursive:true});}
});
test('failed startup preserves another active server socket and client reset cannot crash owner',async()=>{
  const f=fixture();const other=createServer(socket=>socket.on('error',()=>socket.destroy()));
  other.listen(f.socketPath);await once(other,'listening');
  const blocked=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false});
  try{
    await assert.rejects(blocked.start(),/already active/);
    assert.equal(existsSync(f.socketPath),true);
  }finally{
    await blocked.close();await new Promise<void>(resolve=>other.close(()=>resolve()));
    rmSync(f.directory,{recursive:true});
  }
  const next=fixture();const owner=new PaperObservationRuntime({...next,release:'fixture-release',connectFeed:false});
  try{
    await owner.start();const socket=createConnection(next.socketPath);await once(socket,'connect');socket.destroy();
    assert.equal((await runtimeCommand(next.socketPath,'status')).running,true);
  }finally{await owner.close();rmSync(next.directory,{recursive:true});}
});
test('bounded free migrations never imply features, supported coverage, fills or capital changes',async()=>{
  const f=fixture();const runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false});
  try{
    await runtime.start();const cash=f.ledger.state().lamports;
    const migration={txType:'migrate',mint:MINT,signature:'fixture-signature'};
    runtime.observe(JSON.stringify(migration));runtime.observe(JSON.stringify(migration));
    runtime.observe('null');runtime.observe('{malformed');
    const snapshot=runtime.snapshot(f.now());
    assert.equal(snapshot.funnel.discovered,1);assert.equal(snapshot.funnel.supported,0);
    assert.equal(snapshot.funnel.paperFilled,0);assert.equal(snapshot.balances.cashSol,'10.000000000');
    assert.equal(f.ledger.state().lamports,cash);assert.equal(snapshot.status.entries,'disabled');
    assert.equal(snapshot.balances.equityUsd,null);assert.equal(snapshot.times.marketAt,null);
    assert.match(readFileSync(join(f.directory,'selected-evidence.ndjson'),'utf8'),/unavailable-no-trade-flow/);
    assert.throws(()=>runtime.observe('x'.repeat(65537)),/payload limit/);
  }finally{await runtime.close();rmSync(f.directory,{recursive:true});}
});
test('reporting failure does not stop observation or produce financial actions',async()=>{
  const f=fixture();let stopped=false;
  const runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false,publisher:{start(){},offer(){throw new Error('disposable reporting outage');},async stop(){stopped=true;}}});
  try{
    await runtime.start();assert.equal(runtime.command('status').reportingUnavailable,true);
    runtime.observe(JSON.stringify({txType:'migrate',mint:MINT,signature:'fixture-outage'}));
    const snapshot=runtime.snapshot(f.now());assert.equal(snapshot.funnel.discovered,1);
    assert.equal(f.ledger.state().lamports,'10000000000');assert.equal(runtime.command('status').running,true);
  }finally{await runtime.close();assert.equal(stopped,true);rmSync(f.directory,{recursive:true});}
});
test('restart inserts a genuine unavailable-context gap even when valuation is immediately fresh',async()=>{
  const f=fixture();let runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false,priceProvider:async()=>f.price()});
  try{
    await runtime.start();const first=runtime.snapshot(f.now());assert.equal(first.pnl.at(-1)!.tradingUsd,0);
    await runtime.close();f.advance(5000);
    const recovered=new PaperLedger(f.path,'poe-fixture-observer');
    runtime=new PaperObservationRuntime({...f,ledger:recovered,release:'fixture-release',connectFeed:false,priceProvider:async()=>f.price()});
    await runtime.start();const restarted=runtime.snapshot(f.now());
    assert.equal(restarted.balances.equityUsd,1000);assert.equal(restarted.pnl.at(-1)!.tradingUsd,null);
    f.advance(1000);const resumed=runtime.snapshot(f.now());
    assert.deepEqual(resumed.pnl.map(p=>p.tradingUsd),[0,null,0]);
  }finally{await runtime.close();rmSync(f.directory,{recursive:true});}
});
test('safe stop preserves an open position and unknown actual-size mark instead of a free exit',async()=>{
  const f=fixture();f.ledger.reconcile('fixture-reconcile',f.now(),f.price(),{});
  f.ledger.resume('fixture-ready',f.now(),f.price(),{},{version:'fixture',evidence:'disposable accounting setup only',marketAt:f.now(),recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  f.ledger.order({id:'fixture-buy',side:'buy',mint:MINT,decidedAt:f.now(),executeAt:f.now()+500,expiresAt:f.now()+1500,gas:'5000',deposit:'2000000',maxSpend:'100000000',minReceive:'1',decisionEvidence:'disposable fixture'},f.price(),{});
  f.advance(500);f.ledger.attempt('fixture-fill','fixture-buy',f.now(),{at:f.now(),spendLamports:'100000000',receiveUnits:'100',evidence:'disposable fill'},f.price());
  const runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false});
  try{
    await runtime.start();const stop=runtime.command('safe-stop');
    assert.equal(stop.safeToExit,false);assert.equal(stop.openPositions,1);
    const snapshot=runtime.snapshot(f.now());assert.equal(snapshot.positions.length,1);
    assert.equal(snapshot.positions[0]!.netLiquidationUsd,null);assert.equal(snapshot.balances.equitySol,null);
    assert.equal(snapshot.balances.markedExposureUsd,null);assert.equal(runtime.command('status').running,true);
  }finally{await runtime.close();rmSync(f.directory,{recursive:true});}
});
test('position rows reject future, unevidenced and wrong-sized marks consistently with ledger totals',async()=>{
  const f=fixture();f.ledger.reconcile('fixture-reconcile',f.now(),f.price(),{});
  f.ledger.resume('fixture-ready',f.now(),f.price(),{},{version:'fixture',evidence:'disposable accounting setup only',marketAt:f.now(),recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  f.ledger.order({id:'fixture-buy',side:'buy',mint:MINT,decidedAt:f.now(),executeAt:f.now()+500,expiresAt:f.now()+1500,gas:'5000',deposit:'2000000',maxSpend:'100000000',minReceive:'1',decisionEvidence:'disposable fixture'},f.price(),{});
  f.advance(500);f.ledger.attempt('fixture-fill','fixture-buy',f.now(),{at:f.now(),spendLamports:'100000000',receiveUnits:'100',evidence:'disposable fill'},f.price());
  let kind='future';
  const runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false,priceProvider:async()=>f.price(),markProvider:async()=>({[MINT]:{netLamports:'100',pricedBaseUnits:kind==='wrong-size'?'1':'100',at:kind==='future'?f.now()+1:f.now(),evidence:kind==='empty-evidence'?'':'fixture mark'}})});
  try{
    await runtime.start();
    for(kind of ['future','empty-evidence','wrong-size']){
      await runtime.tick();const s=runtime.snapshot(f.now());
      assert.equal(s.positions[0]!.netLiquidationUsd,null);assert.equal(s.balances.equitySol,null);assert.equal(s.times.marketAt,null);
    }
  }finally{await runtime.close();rmSync(f.directory,{recursive:true});}
});
test('public health projection is allowlisted, atomic and preserves fact ages through fresh heartbeats',async()=>{
  const f=fixture(),publicDir=mkdtempSync(join(tmpdir(),'poe-public-health-fixture-'));chmodSync(publicDir,0o755);
  const path=join(publicDir,'status.json');let available=true;
  const runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false,publicStatusPath:path,priceProvider:async()=>{if(!available)throw new Error('fixture-secret-must-not-be-logged');return f.price();}});
  try{
    await runtime.start();runtime.observe(JSON.stringify({txType:'migrate',mint:MINT,signature:'fixture-health'}));await runtime.tick();
    const first=JSON.parse(readFileSync(path,'utf8'));
    assert.equal(statSync(path).mode&0o777,0o644);assert.ok(statSync(path).size<=4096);
    assert.deepEqual(Object.keys(first).sort(),['schemaVersion','project','mode','liveTrading','accountId','inceptionAt','release','strategy','generatedAt','lastUsefulProgressAt','usdPriceAt','lastReconciledAt','feedConnected','lastMigrationReceivedAt','shortlistCount','entriesDisabled','flowVerified','blocker','reportingConfigured'].sort());
    assert.equal(first.accountId,f.ledger.state().accountId);assert.equal(first.inceptionAt,new Date(f.ledger.state().inceptionAt).toISOString());
    assert.equal(first.release,'fixture-release');assert.equal(first.strategy,'UNIMPLEMENTED_FLOW_BLOCKED');assert.equal(first.mode,'PAPER');assert.equal(first.liveTrading,false);
    assert.equal(first.entriesDisabled,true);assert.equal(first.flowVerified,false);assert.equal(first.shortlistCount,1);
    available=false;f.advance(15_000);await runtime.tick();
    const later=JSON.parse(readFileSync(path,'utf8'));
    assert.notEqual(later.generatedAt,first.generatedAt);
    for(const key of ['usdPriceAt','lastReconciledAt','lastUsefulProgressAt','lastMigrationReceivedAt'])assert.equal(later[key],first[key]);
    const text=readFileSync(path,'utf8');
    for(const forbidden of ['cash','balance','positions','trades','Lamports','fixture-secret','https:'])assert.ok(!text.includes(forbidden));
    assert.equal(runtime.command('status').publicStatusUnavailable,false);
  }finally{await runtime.close();rmSync(f.directory,{recursive:true});rmSync(publicDir,{recursive:true});}
});
test('public-file failures and unsafe paths do not halt financial, feed or publisher progress',async()=>{
  const f=fixture(),publicDir=mkdtempSync(join(tmpdir(),'poe-public-failure-fixture-'));chmodSync(publicDir,0o755);
  const path=join(publicDir,'status.json');let offers=0;
  const runtime=new PaperObservationRuntime({...f,release:'fixture-release',connectFeed:false,publicStatusPath:path,priceProvider:async()=>f.price(),publisher:{start(){},offer(){offers++;},async stop(){}}});
  try{
    await runtime.start();const first=readFileSync(path,'utf8');
    chmodSync(publicDir,0o777);f.advance(31_000);
    runtime.observe(JSON.stringify({txType:'migrate',mint:MINT,signature:'fixture-health-write-failure'}));await runtime.tick();
    assert.equal(readFileSync(path,'utf8'),first);assert.equal(runtime.command('status').publicStatusUnavailable,true);
    assert.equal(runtime.command('status').running,true);assert.equal(runtime.snapshot(f.now()).funnel.discovered,1);assert.ok(offers>=2);
    assert.equal(f.ledger.state().lamports,'10000000000');
    chmodSync(publicDir,0o755);await runtime.tick();assert.equal(runtime.command('status').publicStatusUnavailable,false);
  }finally{await runtime.close();rmSync(f.directory,{recursive:true});rmSync(publicDir,{recursive:true});}
  const next=fixture(),wrongPath=join(next.directory,'status.json');
  writeFileSync(wrongPath,'fixture-private-file',{mode:0o600});
  const wrong=new PaperObservationRuntime({...next,release:'fixture-release',connectFeed:false,publicStatusPath:wrongPath});
  try{await wrong.start();assert.equal(wrong.command('status').publicStatusUnavailable,true);assert.equal(wrong.command('status').running,true);assert.equal(readFileSync(wrongPath,'utf8'),'fixture-private-file');}
  finally{await wrong.close();rmSync(next.directory,{recursive:true});}
});
