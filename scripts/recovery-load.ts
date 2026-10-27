/** Bounded DISPOSABLE fault drill. No provider, secrets, RPC, signing or network. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir,availableParallelism} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import {PaperLedger,type LedgerState,type Mark,type Order,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator,type ExecutionContext} from '../src/execution.js';
import {PaperTrader,type SizeQuote} from '../src/trader.js';
import {Recorder} from '../src/recorder.js';
import {FinancialBackupStore} from '../src/backup.js';
import {SnapshotPublisher,type Snapshot,type ReportingIdentity} from '../src/reporting.js';
import {PROVISIONAL_RULE,type NormalizedTrade} from '../src/strategy.js';
import {runAccountCommand} from '../src/account.js';

const ACCOUNT='poe-fixture-recovery-load',MINT='fixture-held-mint',PREFIX='poe-DISPOSABLE-recovery-load-';
const SOURCE='DISPOSABLE invented USD/size state; no current feed verification';
const ROUND=(n:number)=>Math.round(n*1000)/1000;
const immediate=()=>new Promise<void>(r=>setImmediate(r));
const price=(at:number):UsdPrice=>({at,microUsdPerSol:'100000000',source:SOURCE});
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixturePath(directory:string){
  const path=resolve(directory),s=lstatSync(path);
  assert.ok(path.startsWith(join(tmpdir(),PREFIX))&&realpathSync(path)===path&&s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o077)===0,'private disposable drill directory required');
  return join(path,'account.sqlite');
}
function marks(ledger:PaperLedger,at:number):Record<string,Mark>{return Object.fromEntries(Object.values(ledger.state().positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:'400000000',evidence:SOURCE}]));}
function readiness(ledger:PaperLedger,at:number){
  ledger.reconcile('fixture-ready-reconcile:'+ledger.state().revision,at,price(at),marks(ledger,at));
  assert.equal(ledger.resume('fixture-ready:'+ledger.state().revision,at,price(at),marks(ledger,at),{version:'DISPOSABLE fixture readiness',evidence:SOURCE,marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,true);
}
function order(id:string,side:'buy'|'sell',at:number):Omit<Order,'reserved'>{return {id,side,mint:MINT,decidedAt:at,executeAt:at+500,expiresAt:at+5000,gas:'10000',deposit:side==='buy'?'2000000':'0',maxSpend:side==='buy'?'490000000':'0',minReceive:side==='buy'?'100':'1',decisionEvidence:SOURCE};}
async function crashWorker(kind:string,directory:string,base:number){
  const path=fixturePath(directory),ledger=new PaperLedger(path,ACCOUNT);
  if(kind==='--interrupt-worker'){
    // Deliberately invalid UNCOMMITTED fixture write on the sole owned source
    // connection. Killing it must roll back, never become a financial action.
    const db=(ledger as unknown as {db:Database.Database}).db;
    db.pragma('cache_size=1');db.exec('BEGIN IMMEDIATE');
    const state=ledger.state() as LedgerState&{fixtureInterruptionPadding?:string};
    state.lamports='0';state.positions={};state.fixtureInterruptionPadding='DISPOSABLE'.repeat(20_000);
    db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));
    process.send?.({marker:'UNCOMMITTED_WRITE',walBytes:statSync(path+'-wal').size});
    await new Promise(()=>{});return;
  }
  let at=base;const recorder=new Recorder(join(directory,'crash.ndjson'),64_000);
  const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1500,context:async()=>({price:price(at),marks:marks(ledger,at)}),quote:async request=>{
    if(request.order.side==='buy')return {at,spendLamports:'480000000',receiveUnits:'1000',evidence:SOURCE};
    recorder.record('DISPOSABLE-exit-preparation',{at,orderId:request.order.id,heldUnits:request.fullPositionBaseUnits});recorder.close();
    process.send?.({marker:'EXIT_QUOTE_PENDING',revision:ledger.state().revision});
    return await new Promise<null>(()=>{});
  }});
  coordinator.recover();readiness(ledger,at);coordinator.reserve(order('fixture-seed-buy','buy',at),{price:price(at),marks:{}});
  at=base+500;assert.equal((await coordinator.runDue()).results[0]!.status,'filled');
  at=base+600;coordinator.reserve(order('fixture-interrupted-exit','sell',at),{price:price(at),marks:marks(ledger,at)});
  at=base+1100;await coordinator.runDue();throw new Error('DISPOSABLE crash marker was not killed');
}
async function killAtMarker(kind:string,directory:string,base:number){
  const started=performance.now();
  return await new Promise<{signal:string;marker:string;wallMs:number;walBytes?:number}>((done,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),kind,directory,String(base)],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{PATH:process.env.PATH??'/usr/bin:/bin'},stdio:['ignore','ignore','pipe','ipc']});
    let marker:string|null=null,walBytes:number|undefined,stderr='';
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('bounded disposable crash worker deadline'));},10_000);
    child.stderr!.on('data',(b:Buffer)=>{stderr=(stderr+b.toString()).slice(0,500);});
    child.on('error',error=>{clearTimeout(timeout);reject(error);});
    child.on('message',message=>{
      const value=message as {marker?:string;walBytes?:number};
      if(value.marker===(kind==='--interrupt-worker'?'UNCOMMITTED_WRITE':'EXIT_QUOTE_PENDING')){marker=value.marker;walBytes=value.walBytes;child.kill('SIGKILL');}
    });
    child.on('exit',(_code,signal)=>{clearTimeout(timeout);if(marker&&signal==='SIGKILL')done({signal,marker,wallMs:ROUND(performance.now()-started),...(walBytes===undefined?{}:{walBytes})});else reject(new Error('disposable crash worker failed before expected marker: '+stderr));});
  });
}
function snapshot(ledger:PaperLedger,at:number,identity:ReportingIdentity):Snapshot{
  const state=ledger.state(),p=ledger.projection(at,price(at),marks(ledger,at));
  const usd=(v:string|null)=>v===null?null:Number(BigInt(v))/1e6,sol=(v:string)=>`${BigInt(v)/1_000_000_000n}.${(BigInt(v)%1_000_000_000n).toString().padStart(9,'0')}`;
  return {project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,schemaVersion:1,account:{id:state.accountId,inceptionAt:identity.inceptionAt,initialUsd:1000},sequence:ledger.nextSnapshotSequence(),source:{release:identity.release,strategy:identity.strategy},times:{generatedAt:new Date(at).toISOString(),marketAt:new Date(at).toISOString(),reconciledAt:state.daily.reconciledAt?new Date(state.daily.reconciledAt).toISOString():null,usefulProgressAt:new Date(at).toISOString()},status:{runtime:'running',market:'observing',entries:'disabled',reconciled:state.daily.reconciledAt===at,blocker:'DISPOSABLE SYNTHETIC EXPERIMENT; real feed and LIVE execution unavailable'},balances:{cashSol:sol(p.cashLamports),reservedSol:sol(p.reservedLamports),equitySol:p.equityLamports===null?null:sol(p.equityLamports),equityUsd:usd(p.equityMicroUsd),realizedUsd:null,unrealizedUsd:null,tradingPnlUsd:usd(p.totalPnlMicroUsd),economicPnlUsd:usd(p.economicPnlMicroUsd),positionCostUsd:usd(p.positionCostMicroUsd)!,markedExposureUsd:usd(p.positionLiquidationLamports===null?null:(BigInt(p.positionLiquidationLamports)/10n).toString()),drawdownUsd:null,executionCostsUsd:Number(BigInt(p.executionCostsLamports))/1e7,operatingCostsUsd:usd(p.operatingCostsMicroUsd),passiveSolEquityUsd:usd(p.passiveSolEquityMicroUsd),solPriceUsd:100},costLabels:{execution:'simulated',operating:p.operatingCostClassification},positions:Object.values(state.positions).map(p=>({mint:p.mint,label:'DISPOSABLE fixture',quantity:p.units,enteredAt:new Date(p.enteredAt).toISOString(),entryCostUsd:usd(p.costMicroUsd)!,netLiquidationUsd:40,executionCostsUsd:0.001,status:'DISPOSABLE held fixture'})),trades:[],decisions:[],pnl:ledger.getReportingHistory().points.map(p=>({at:new Date(p.at).toISOString(),tradingUsd:usd(p.tradingMicroUsd),economicUsd:usd(p.economicMicroUsd)})),history:{windowStartAt:identity.inceptionAt,downsampled:false,label:'DISPOSABLE actual fixture inception point only; no forward history'},funnel:{discovered:0,supported:0,sufficientlyObserved:0,evaluated:0,qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:0},metrics:{processingLagMs:null,eventLoopLagMs:null,providerEvents:0,rpcRequests:0,projectedDailyDataSol:0,budgetRemainingSol:null,budgetStatus:'unavailable',coverage:'No feed/network; invented fixture inputs only',latency:'No provider latency measurement'}};
}

async function drill(){
  process.umask(0o077);
  const actualStartedAt=new Date().toISOString(),wallStart=performance.now(),base=Date.parse('2026-10-26T00:00:00.000Z');
  const directory=mkdtempSync(join(tmpdir(),PREFIX)),path=fixturePath(directory),recorders:Recorder[]=[];
  let ledger:PaperLedger|undefined,publisher:SnapshotPublisher|undefined;
  try{
    ledger=new PaperLedger(path,ACCOUNT);ledger.initialize(price(base),base);ledger.close();ledger=undefined;
    const quoteCrash=await killAtMarker('--quote-worker',directory,base);
    ledger=new PaperLedger(path,ACCOUNT);let at=base+1200;
    const crashState=ledger.state();assert.equal(crashState.inceptionAt,base);assert.equal(crashState.positions[MINT]!.units,'1000');assert.ok(crashState.pending['fixture-interrupted-exit']);
    assert.throws(()=>new PaperLedger(path,ACCOUNT),/locked/);
    let recoveryQuotes=0;
    const execution=new PaperExecutionCoordinator({ledger,now:()=>at,context:async()=>({price:price(at),marks:{}}),quote:async()=>{recoveryQuotes++;return null;}});
    const recovered=execution.recover();assert.deepEqual(recovered.uncertainExitOrders,['fixture-interrupted-exit']);assert.equal((await execution.runDue()).results[0]!.status,'uncertain');assert.equal(recoveryQuotes,0);
    for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))chmodSync(path+suffix,0o600);
    const store=new FinancialBackupStore({directory:join(directory,'backups'),sourcePath:path,identity:{accountId:ACCOUNT,mode:'PAPER',inceptionAt:base},maxBytes:8*1024*1024});
    const pendingBackup=await store.create(ledger),pendingBackupHash=hash(pendingBackup.path);
    at=base+21_600_000;assert.equal(ledger.projection(at,price(at),{}).equityMicroUsd,null);
    assert.equal((await execution.runDue()).results[0]!.status,'expired');assert.equal(recoveryQuotes,0);assert.equal(ledger.state().positions[MINT]!.units,'1000');assert.deepEqual(ledger.state().pending,{});
    const beforeInterruptedWrite=ledger.state();ledger.close();ledger=undefined;
    // Exercise an older open-position/pending backup in an explicitly separate
    // disposable branch, with the original writer closed throughout the drill.
    const pendingRestorePath=join(directory,'pending-restore','account.sqlite');
    await runAccountCommand(['restore','--db',pendingRestorePath,'--account',ACCOUNT,'--mode','PAPER','--input',pendingBackup.path,'--now',new Date(base+1200).toISOString()]);
    const pendingRestore=new PaperLedger(pendingRestorePath,ACCOUNT);let pendingRestoreQuotes=0;
    try{
      assert.equal(pendingRestore.state().inceptionAt,base);assert.equal(pendingRestore.state().lamports,crashState.lamports);assert.equal(pendingRestore.state().positions[MINT]!.units,'1000');assert.ok(pendingRestore.state().pending['fixture-interrupted-exit']);
      const restoredExecution=new PaperExecutionCoordinator({ledger:pendingRestore,now:()=>base+1200,context:async()=>({price:null,marks:{}}),quote:async()=>{pendingRestoreQuotes++;return null;}});
      assert.deepEqual(restoredExecution.recover().uncertainExitOrders,['fixture-interrupted-exit']);assert.equal((await restoredExecution.runDue()).results[0]!.status,'uncertain');assert.equal(pendingRestoreQuotes,0);assert.equal(pendingRestore.state().controls.entriesEnabled,false);
    }finally{pendingRestore.close();}
    const writeCrash=await killAtMarker('--interrupt-worker',directory,base);
    ledger=new PaperLedger(path,ACCOUNT);assert.deepEqual(ledger.state(),beforeInterruptedWrite);assert.equal(ledger.integrity(),'ok');
    const currentLedger=ledger,identity:ReportingIdentity={accountId:ACCOUNT,inceptionAt:new Date(base).toISOString(),release:'DISPOSABLE-recovery-load',strategy:PROVISIONAL_RULE.version};
    let fetches=0,offered=0;
    publisher=new SnapshotPublisher({url:'https://poe-fixture.invalid/snapshot',secret:'DISPOSABLE-NONSECRET-INGESTION-FIXTURE',identity,intervalMs:10,timeoutMs:20,maxBackoffMs:50,fetch:async()=>{fetches++;throw new TypeError('DISPOSABLE Render outage; no network request');}});
    publisher.start();
    publisher.offer(snapshot(currentLedger,at,identity));offered++;
    const publishDeadline=performance.now()+1000;while(publisher.metrics.failures===0&&performance.now()<publishDeadline)await new Promise(r=>setTimeout(r,1));
    assert.ok(publisher.metrics.failures>0,'reporting outage must be active before protective work');const failuresBeforeProtection=publisher.metrics.failures;
    const recordPath=join(directory,'pressure.ndjson'),recorder=new Recorder(recordPath,16_384);recorders.push(recorder);
    let quoteMode:'stale'|'fresh'='stale',sizeQuotes=0;
    const trader=new PaperTrader({ledger:currentLedger,now:()=>at,recorder,flowVerification:{verified:false,evidence:SOURCE},costs:{gasLamports:'10000',depositLamports:'2000000',slippageBps:500,evidence:SOURCE},context:async()=>({price:price(at),marks:marks(currentLedger,at)}),quote:async request=>{sizeQuotes++;assert.equal(request.side,'sell');assert.equal(request.inputUnits,'1000');return {...request,at:quoteMode==='stale'?at-2001:at,outputUnits:'400010000',evidence:SOURCE,refundedDepositLamports:'2000000',refundEvidence:'DISPOSABLE modeled account close'} satisfies SizeQuote;}});
    trader.start();trader.feedGap();await trader.tick();assert.equal(sizeQuotes,1);assert.deepEqual(currentLedger.state().pending,{});assert.equal(currentLedger.state().positions[MINT]!.units,'1000');
    readiness(currentLedger,at);assert.equal(currentLedger.state().controls.entriesEnabled,true);
    let pressureRecords=0;for(;;){try{recorder.record('DISPOSABLE-capacity-probe',{padding:'x'.repeat(200)});pressureRecords++;}catch(error){assert.match(String(error),/EVIDENCE_CAPACITY_REACHED/);break;}}
    const cappedBytes=statSync(recordPath).size;assert.ok(cappedBytes<=16_384);
    const note=join(store.directory,'fixture-pressure-owner-note');writeFileSync(note,'DISPOSABLE unrelated owner file; preserve',{mode:0o600});
    const failedCopy=store.create(currentLedger);quoteMode='fresh';at++;
    await trader.tick();assert.equal(Object.values(currentLedger.state().pending)[0]!.side,'sell');
    at+=PROVISIONAL_RULE.modeledDelayMs;await trader.tick();assert.deepEqual(currentLedger.state().positions,{});assert.deepEqual(currentLedger.state().pending,{});assert.equal(trader.funnel.exited,1);
    await assert.rejects(failedCopy,/needs review/);assert.equal(hash(pendingBackup.path),pendingBackupHash);assert.equal(readFileSync(note,'utf8'),'DISPOSABLE unrelated owner file; preserve');assert.ok(statSync(recordPath).size<=16_384);
    const finalPressureBytes=statSync(recordPath).size;assert.equal(publisher.metrics.successes,0);
    const expectedCash=10_000_000_000n-480_000_000n-10_000n-2_000_000n+400_010_000n-10_000n+2_000_000n;
    assert.equal(currentLedger.state().lamports,expectedCash.toString());assert.equal(currentLedger.state().executionCosts,'20000');assert.deepEqual(currentLedger.state().lockedDeposits,{});assert.equal(currentLedger.state().controls.entriesEnabled,false);
    let lastPressureSequence='';for(let i=0;i<200;i++){const s=snapshot(currentLedger,at,identity);publisher.offer(s);lastPressureSequence=s.sequence;offered++;}
    assert.equal(publisher.queuedSequence(),lastPressureSequence);
    const pressureSequence=publisher.queuedSequence();rmSync(note);
    currentLedger.recordOperatingCost({kind:'expense',id:'fixture-operating-cost',accountId:ACCOUNT,category:'data',classification:'estimated',occurredAt:at,recordedAt:at,amount:{currency:'USD',microUsd:'200000'},evidence:'DISPOSABLE invented expense for restore validation; not an actual charge'});
    assert.equal(currentLedger.projection(at,price(at),{}).economicPnlMicroUsd,null);

    // Full local adapter path: selected recorder -> bounded flow/rule decisions
    // -> sole-writer reconciliation -> latest-slot reporting, with backup work.
    const loadRecorder=new Recorder(join(directory,'load.ndjson'),4_000_000);recorders.push(loadRecorder);
    const load=new PaperTrader({ledger:currentLedger,now:()=>at,recorder:loadRecorder,flowVerification:{verified:false,evidence:SOURCE},costs:{gasLamports:'10000',depositLamports:'2000000',slippageBps:500,evidence:SOURCE},context:async()=>({price:price(at),marks:{}}),quote:async()=>{throw new Error('unverified flow must never quote');}});
    load.start();for(let i=0;i<12;i++){const mint='fixture-load-'+i;assert.equal(load.admit({mint,migrationAt:at-300_000,migrationVerified:true,supportedPool:true,evidence:SOURCE}),true);load.activateFlow(mint,'DISPOSABLE subscription availability');}
    assert.equal(load.admit({mint:'fixture-load-overflow',migrationAt:at-300_000,migrationVerified:true,supportedPool:true,evidence:SOURCE}),false);
    const loadStart=at,cpuStart=process.cpuUsage(),memoryBefore=process.memoryUsage(),eluStart=performance.eventLoopUtilization(),delay=monitorEventLoopDelay({resolution:1});
    let accepted=0,duplicates=0,completedTicks=0,coalesced=0,maxRss=memoryBefore.rss,maxHeap=memoryBefore.heapUsed;
    const lagSamples:number[]=[],latencies:number[]=[];let prior=performance.now();
    const timer=setInterval(()=>{const now=performance.now();lagSamples.push(now-prior);prior=now;const m=process.memoryUsage();maxRss=Math.max(maxRss,m.rss);maxHeap=Math.max(maxHeap,m.heapUsed);},1);
    delay.enable();await immediate();const timed=performance.now(),copy=store.create(currentLedger);
    try{
      for(let batch=0;batch<400;batch++){
        at=loadStart+batch*200;let first:NormalizedTrade|undefined;
        const batchStart=performance.now();
        for(let i=0;i<12;i++){
          const trade:NormalizedTrade={mint:'fixture-load-'+i,identity:{signature:'fixture-load-tx-'+batch,instructionIndex:1,eventIndex:i},wallet:'fixture-wallet-'+batch%32,side:batch%4===3?'sell':'buy',quoteLamports:'2000000',tokenUnits:'1000',receivedAt:at,commitment:'processed',slot:100_000+batch};
          assert.equal(load.ingest(trade),'accepted');accepted++;first??=trade;
        }
        if(batch%10===0){at++;assert.equal(load.ingest({...first!,receivedAt:at}),'duplicate');duplicates++;}
        if(batch%5===0){const ticking=load.tick();assert.equal(load.tick(),ticking);coalesced++;await ticking;completedTicks++;publisher.offer(snapshot(currentLedger,at,identity));offered++;}
        latencies.push(performance.now()-batchStart);await immediate();
      }
      await copy;assert.ok(fetches>0);assert.equal(load.funnel.paperFilled,0);assert.equal(load.funnel.reserved,0);assert.ok(load.funnel.evaluated>0);assert.equal(currentLedger.state().controls.entriesEnabled,false);
    }finally{clearInterval(timer);delay.disable();}
    const loadWallMs=performance.now()-timed,cpu=process.cpuUsage(cpuStart),elu=performance.eventLoopUtilization(eluStart),memoryAfter=process.memoryUsage();
    loadRecorder.close();recorder.close();assert.ok(statSync(join(directory,'load.ndjson')).size<=4_000_000);
    const rows=(readFileSync(join(directory,'load.ndjson'),'utf8').trimEnd().split('\n').map(s=>JSON.parse(s)) as {kind:string;data:{kind?:string;trade?:NormalizedTrade}}[]).filter(r=>r.kind==='trader-input'&&r.data.kind==='trade');
    assert.equal(rows.length,accepted+duplicates);const identities=new Set(rows.map(r=>{const t=r.data.trade!;return JSON.stringify([t.mint,t.identity.signature,t.identity.instructionIndex,t.identity.eventIndex]);}));assert.equal(identities.size,accepted);
    const normalizedHash=createHash('sha256');for(const row of rows)normalizedHash.update(JSON.stringify(row.data.trade)+'\n');
    await publisher.stop();const publication={offered,actualNetworkRequests:0,injectedOutageAttempts:fetches,successes:publisher.metrics.successes,failures:publisher.metrics.failures,failuresBeforeProtection,protectiveExitCompletedWithoutSuccessfulPublication:true,latestSlotSequence:publisher.queuedSequence(),pressureBurstOffers:200,pressureSequence,retainedSlots:1};publisher=undefined;
    const finalCopy=await store.create(currentLedger),beforeRestore=currentLedger.state(),history=currentLedger.getReportingHistory(),costs=currentLedger.getOperatingCosts(),journal=currentLedger.exportJournal(1000),journalCount=beforeRestore.revision+1;
    assert.equal(readdirSync(store.directory).filter(p=>/^poe-financial-[0-9]+\.sqlite$/.test(p)).length,2);currentLedger.close();ledger=undefined;
    const restoredPath=join(directory,'restored','account.sqlite');
    await runAccountCommand(['restore','--db',restoredPath,'--account',ACCOUNT,'--mode','PAPER','--input',finalCopy.path,'--now',new Date(at+1).toISOString()]);
    ledger=new PaperLedger(restoredPath,ACCOUNT);const afterRestore=ledger.state();
    assert.equal(afterRestore.inceptionAt,base);assert.equal(afterRestore.lamports,beforeRestore.lamports);assert.deepEqual(afterRestore.positions,beforeRestore.positions);assert.deepEqual(afterRestore.pending,beforeRestore.pending);assert.deepEqual(ledger.getReportingHistory(),history);assert.deepEqual(ledger.getOperatingCosts(),costs);assert.equal(afterRestore.revision,beforeRestore.revision+1);assert.equal(afterRestore.controls.entriesEnabled,false);assert.equal(journal.length,journalCount);assert.deepEqual(ledger.exportJournal(1000).slice(1),journal);assert.equal(ledger.nextSnapshotSequence(),String(BigInt(finalCopy.snapshotSequence!)+1n));
    latencies.sort((a,b)=>a-b);lagSamples.sort((a,b)=>a-b);const pct=(v:number[],p:number)=>ROUND(v[Math.min(v.length-1,Math.floor(v.length*p))]??0);
    return {schemaVersion:1,classification:'DISPOSABLE_SYNTHETIC_OFFLINE_RECOVERY_LOAD',acceptanceGateCompleted:false,acceptanceClockStarted:false,naturalTrades:0,productionPaperEntriesEnabled:false,liveTradingDisabled:true,actualStartedAt,actualCompletedAt:new Date().toISOString(),actualWallDurationMs:ROUND(performance.now()-wallStart),environment:{kind:'Codex workspace, not EC2',node:process.version,platform:process.platform,architecture:process.arch,availableParallelism:availableParallelism()},reproduce:'node --import tsx scripts/recovery-load.ts',sourceHashes:Object.fromEntries(['ledger','execution','trader','recorder','backup','backup-worker','reporting','strategy'].map(name=>[name,hash(fileURLToPath(new URL('../src/'+name+'.ts',import.meta.url)))]).concat([['script',hash(fileURLToPath(import.meta.url))]])),fixture:{accountId:ACCOUNT,mode:'PAPER',disposable:true,initialVirtualUsd:1000,initialUsdPerSol:100,syntheticOutageMs:21_600_000,syntheticTimeIsNotElapsedWallTime:true,temporaryFinancialFilesDeleted:true,note:'One temporary PAPER-schema account permits the real SnapshotPublisher identity validator; no authoritative/forward account used and no external delivery. Seed entry is a coordinator fixture; unfrozen PaperTrader entry guard remains active.'},faults:{processKill:{...quoteCrash,openPositionAndPendingExitPreserved:true,uncertainExitQuarantinedWithoutRequote:true,secondWriterRefused:true},longOutage:{modeledMs:21_600_000,expiredUncertainExitWithoutQuote:true,unknownMarkRemainedUnknown:true,heldPositionPreserved:true,replayedMissedFlow:false},interruptedWrite:{...writeCrash,exactStateRollback:true,financialIntegrity:'ok'},staleQuote:{decisionQuoteRejected:true,noFillOrNewPending:true},storagePressure:{method:'Recorder byte cap plus unrecognized backup-directory file; no host disk filled',recorderCapBytes:16_384,actualRecorderBytes:finalPressureBytes,completedPressureRecords:pressureRecords,overflowStopsEvidence:true,entriesDisabled:true,originalBackupPreserved:true,unrelatedFilePreserved:true,protectiveExitCompletedDespitePressure:true},protectiveExecution:{syntheticSeedEntries:1,syntheticExits:1,exactHeldUnits:'1000',modeledExecutionCostLamports:'20000',rentRefundedOnce:true,reconciledCashInvariantPassed:true},reportingOutage:publication,backupRestore:{consistentSourceApi:true,completedRetainedCopies:2,accountInceptionPreserved:true,cashPositionsPendingHistoryCostsPreserved:true,completeFinancialJournalAndSnapshotSequencePreserved:true,openPositionAndUncertainExitRestoredInSeparateDisposableBranch:true,restoredUncertainExitNotRequoted:true,oneWriterAtATime:true,journalRowsBeforeRestore:journalCount,restoreAddsOnlyExplicitPauseRevision:true,entriesDisabled:true}},load:{syntheticDurationMs:79_800,actualWallMs:ROUND(loadWallMs),recordedAcceptedTrades:accepted,duplicates,recordedTradeRowsVerified:rows.length,recordedUniqueIdentitiesVerified:identities.size,normalizedRecordSha256:normalizedHash.digest('hex'),completedReconciliationTicks:completedTicks,coalescedCalls:coalesced,completedRuleEvaluations:load.funnel.evaluated,unverifiedFlowQualified:load.funnel.qualified,syntheticEntries:load.funnel.paperFilled,completedInputRowsPerSecond:ROUND((accepted+duplicates)/(loadWallMs/1000)),usefulReconciliationTicksPerSecond:ROUND(completedTicks/(loadWallMs/1000)),batchCompletionMs:{p50:pct(latencies,.5),p95:pct(latencies,.95),p99:pct(latencies,.99),max:ROUND(latencies.at(-1)??0)},eventLoop:{histogramSamples:delay.count,p99DelayMs:delay.count?ROUND(delay.percentile(99)/1e6):null,maxDelayMs:delay.count?ROUND(delay.max/1e6):null,oneMsTimerSamples:lagSamples.length,maxTimerGapMs:ROUND(lagSamples.at(-1)??0)},cpu:{userMs:ROUND(cpu.user/1000),systemMs:ROUND(cpu.system/1000),eventLoopUtilization:ROUND(elu.utilization)},memory:{beforeRssBytes:memoryBefore.rss,afterRssBytes:memoryAfter.rss,sampledMaxRssBytes:Math.max(maxRss,memoryAfter.rss),beforeHeapBytes:memoryBefore.heapUsed,afterHeapBytes:memoryAfter.heapUsed,sampledMaxHeapBytes:Math.max(maxHeap,memoryAfter.heapUsed)},recordedBytes:statSync(join(directory,'load.ndjson')).size,recordByteCap:4_000_000,candidateCap:12,thirteenthCandidateRefused:true,finiteInputScheduling:'12 unique rows plus at most 1 duplicate/batch, cooperative yield each batch; no growing input queue; reporting retains one latest slot'},limitations:['No actual PumpPortal migrations/trade fields, RPC/pool pricing, provider costs, real Render endpoint or deployed EC2 capacity verified.','No acceptance interval began; six-hour outage and 79.8s load timestamps are synthetic information times, not unattended elapsed operation.','A deliberate fixture seed buy and protective exit exercise integer accounting, not the unfrozen strategy or natural opportunity profitability.','PAPER mode is used only for same-account reporting schema validation; all funds, prices, marks and expenses are invented and isolated.','Pressure is controlled byte-cap/unknown-file refusal, not ENOSPC or full filesystem exhaustion; source financial write retries and host survival under ENOSPC remain unproven.','SIGKILL proves process-crash/WAL behavior, not host power failure, filesystem corruption or disaster recovery across machines.','Load measures recorder, selected flow, refusal decisions, reconciliation, snapshot projection/publication failure, and concurrent backup work; no qualified entry/execution quote is in its timed load loop.','Short local rates share CPU with artifact worker and OS scheduling; sampled RSS includes prior phases and is not a hard peak memory bound.','Only bounded sanitized invariant summaries retained; temporary journals, observations and backups are deleted after assertions.']};
  }finally{await publisher?.stop();for(const recorder of recorders)recorder.close();ledger?.close();rmSync(directory,{recursive:true,force:true});}
}

if(process.argv[2]==='--quote-worker'||process.argv[2]==='--interrupt-worker'){
  process.umask(0o077);await crashWorker(process.argv[2],process.argv[3]!,Number(process.argv[4]));
}else{
  assert.equal(process.argv.length,2,'no credentials, production paths or external endpoints accepted');
  const evidence=await drill(),target=fileURLToPath(new URL('../evidence/recovery-load.json',import.meta.url));
  writeFileSync(target,JSON.stringify(evidence,null,2)+'\n',{mode:0o644});
  console.log(JSON.stringify({status:'DISPOSABLE_RECOVERY_LOAD_COMPLETE',evidence:target,acceptanceClockStarted:false}));
}
