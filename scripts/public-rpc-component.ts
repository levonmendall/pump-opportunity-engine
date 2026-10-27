/** ONE owner-approved public-RPC component session. Defaults to no network. */
import {appendFileSync,readFileSync,writeFileSync,statSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {PublicKey} from '@solana/web3.js';
import {ComponentBudget,type ComponentBaseline} from '../src/component-budget.js';
import {ComponentTransport,type ComponentNotice} from '../src/component-transport.js';
import {selectComponentPool} from '../src/component-selection.js';
import {ResearchClockPositionPricer,type ResearchClockQuote} from '../src/research-clock-pricing.js';
import {deriveComponentHypothetical,validateComponentParity,type ComponentSnapshot} from '../src/component-parity.js';
import {SelectionRejections} from '../src/selection-rejections.js';
import {runComponentLauncher} from './component-launcher.js';
const OLD='evidence/free-data-20261027/active-approved-rpc-budget.json';
const SHA=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
function need(v:unknown,reason:string):asserts v{if(!v)throw Error(reason);}
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,110}$/.test(e.message)?e.message:'COMPONENT_UNEXPECTED_FAILURE';
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,Math.max(0,ms)));
function percentile(xs:number[],p:number){const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.ceil(p*s.length)-1)]!:null;}
function metrics(xs:number[]){return {count:xs.length,min:xs.length?Math.min(...xs):null,p50:percentile(xs,.5),p95:percentile(xs,.95),max:xs.length?Math.max(...xs):null};}
function directoryBytes(path:string):number{return readdirSync(path,{withFileTypes:true}).reduce((n,f)=>n+(f.isDirectory()?directoryBytes(join(path,f.name)):statSync(join(path,f.name)).size),0);}
async function child(){
  process.umask(0o077);
  const startedAt=Number(process.env.POE_COMPONENT_STARTED_AT),out=process.env.POE_COMPONENT_OUT_DIR;
  need(process.getuid?.()!==0&&Number.isSafeInteger(startedAt)&&!!out&&resolve(out)===resolve('evidence/public-component-20261027'),'COMPONENT_CHILD_BINDING');
  const deadline=startedAt+90000,oldRaw=readFileSync(OLD),old=JSON.parse(oldRaw.toString()),oldHash=SHA(oldRaw);
  need(old.calls===20&&old.bytes===272634&&old.blockedReason==='RPC_HTTP_429'&&old.pending.length===0,'COMPONENT_OLD_BASELINE_CHANGED');
  const baseline:ComponentBaseline={calls:old.calls,bytes:old.bytes,starts:old.starts,refusal:'RPC_HTTP_429',refusalAt:old.lastObservedAt,sha256:oldHash};
  const budget=new ComponentBudget({statePath:join(out,'rpc-budget.json'),grantId:'public-component-20261027',baseline,startedAt,notBefore:old.lastObservedAt+300000});
  const controller=new AbortController();let failure:string|null=null,stage='setup',recorded=0,latest:ComponentSnapshot|null=null;
  const httpTimings:any[]=[];
  let maxRss=process.memoryUsage().rss,maxLag=0,dirty=0,pricedDirty=0,noticeSlot=0;const cpu0=process.cpuUsage();
  const records=join(out,'observations.ndjson');
  const record=(kind:string,data:unknown)=>{
    const line=JSON.stringify({kind,recordedAt:Date.now(),data})+'\n';
    if(recorded+Buffer.byteLength(line)>6*1024*1024)throw Error('COMPONENT_EVIDENCE_CAP');
    appendFileSync(records,line,{mode:0o600});recorded+=Buffer.byteLength(line);
    if(kind==='research-clock-pool-state')latest=data as ComponentSnapshot;
    if(kind==='http-response-timing')httpTimings.push(data);
  };
  const notices=(n:ComponentNotice)=>{noticeSlot=Math.max(noticeSlot,n.slot);if(n.changed)dirty++;};
  const transport=new ComponentTransport(budget,record,notices),pricer=new ResearchClockPositionPricer(transport,{record});
  const stop=(reason:string)=>{failure??=reason;try{budget.halt(reason.startsWith('COMPONENT_')?reason:'COMPONENT_VALIDATION_FAILURE');}catch{}controller.abort();transport.terminate(reason);};
  let lastHeartbeat=performance.now();
  const watch=setInterval(()=>{
    try{const now=performance.now(),lag=Math.max(0,now-lastHeartbeat-100);lastHeartbeat=now;maxLag=Math.max(maxLag,lag);const rss=process.memoryUsage().rss,cpu=process.cpuUsage(cpu0);maxRss=Math.max(maxRss,rss);
      transport.sampleSocket();
      process.send?.({kind:'progress',stage,rss,cpuMs:(cpu.user+cpu.system)/1000,eventLoopLagMs:lag});
      if(Date.now()>=deadline-5000&&stage!=='shutdown'&&stage!=='complete')stop('COMPONENT_SHUTDOWN_RESERVE');
      if(rss>256*1024*1024||lag>500||(cpu.user+cpu.system)>20000000)stop('COMPONENT_RESOURCE_STOP');
      if(directoryBytes(out)>7.5*1024*1024)stop('COMPONENT_EVIDENCE_CAP');
    }catch{stop('COMPONENT_RESOURCE_CHECK_FAILURE');}
  },100);
  const totalTimer=setTimeout(()=>stop('COMPONENT_TIME_CAP'),Math.max(1,deadline-Date.now()-100));
  process.on('message',(m:any)=>{if(m?.kind==='stop')stop('COMPONENT_PARENT_STOP');});
  process.on('SIGTERM',()=>stop('COMPONENT_PARENT_STOP'));
  process.on('disconnect',()=>{if(stage!=='shutdown')stop('COMPONENT_PARENT_DISCONNECTED');});
  const evaluations:any[]=[],parities:any[]=[],blockTimes:any[]=[],planned:any={requested:false,closedAt:null,upgradedAt:null,allAcknowledgedAt:null,firstCoherentQuoteAt:null};
  let selected:any=null,hypothetical:any=null,commonStartedAt:number|null=null,commonEndedAt:number|null=null,extras=0,periodic=0,rejections:SelectionRejections|undefined;
  const snapshot=()=>{need(latest,'COMPONENT_MISSING_CAPTURED_STATE');return latest;};
  const quote=async(kind:'preflight'|'periodic'|'trigger',units:bigint,expectedAt:number|null)=>{
    const dispatchedAt=Date.now(),version=dirty;
    const q=await pricer.quote({mint:new PublicKey(selected.mint),fullBaseUnits:units,minSlot:Math.max(selected.minSlot,noticeSlot)},controller.signal);
    const availableAt=Date.now(),s=snapshot(),parity=validateComponentParity(s,selected.mint,units,q);
    need(q.slot===s.context.slot&&availableAt-Date.parse(q.receivedAt)<=2000,'COMPONENT_QUOTE_AGE_AT_USE');
    parities.push({at:availableAt,...parity});
    const net=BigInt(q.sell.outputLamports)-7000n,cost=hypothetical?BigInt(hypothetical.entryCostLamports):null;
    const condition=cost===null?null:net*100n<=cost*85n?'STOP_LOSS':net*100n>=cost*130n?'TAKE_PROFIT':null;
    const actualStart=httpTimings.at(-1)?.requestedAt;need(Number.isSafeInteger(actualStart),'COMPONENT_MISSING_ACTUAL_HTTP_START');
    const row={kind,dispatchedAt,requestedAt:actualStart,expectedAt,availableAt,startLatenessMs:expectedAt===null?null:actualStart-expectedAt,slot:q.slot,receivedAt:q.receivedAt,sourceUnixSeconds:q.marketClockUnixSeconds,quoteAgeAtUseMs:availableAt-Date.parse(q.receivedAt),sourceAgeAtUseMs:availableAt-q.marketClockUnixSeconds*1000,sell:q.sell,netAfterSimulatedExitGasLamports:net.toString(),hypotheticalExitCondition:condition,reserves:{base:q.rawBaseReserve,quote:q.rawQuoteReserve,virtual:q.virtualQuoteReserves,fees:q.feeBuckets},snapshotHash:SHA(JSON.stringify(s.value)),dirtyVersion:version};
    evaluations.push(row);record('component-evaluation',row);pricedDirty=version;
    if(planned.allAcknowledgedAt&&!planned.firstCoherentQuoteAt)planned.firstCoherentQuoteAt=availableAt;
    return q;
  };
  try{
    record('scope',{startedAt,deadline,provider:'api.mainnet.solana.com',oldBaseline:baseline,productionTouched:false,hypotheticalOnly:true,referenceCadenceMs:2000,wallClock:new Date(startedAt).toISOString()});
    rejections=new SelectionRejections({path:'evidence/free-data-20261027/selection-rejections.json',policyVersion:'pump-swap-sdk2.2.0-supported-sol-v1'});
    const selection=await selectComponentPool({rpc:transport,rejectionStore:rejections,signal:controller.signal,record});record('component-selection-result',selection);
    need(selection.ok,selection.ok?'COMPONENT_SELECTION_FAILURE':selection.reason);selected=selection.candidate;
    // Activity validates an actual current supported swap, not entry eligibility.
    await quote('preflight',BigInt(selected.baseUnits),null);
    hypothetical=deriveComponentHypothetical(snapshot(),selected.mint);record('hypothetical-holding',hypothetical);
    const base=snapshot(),addresses=base.addresses.filter(a=>a!=='SysvarC1ock11111111111111111111111111111111');
    need(addresses.length===7,'COMPONENT_SUBSCRIPTION_SCOPE');
    transport.seedAccountHashes(addresses,addresses.map(a=>base.value[base.addresses.indexOf(a)]));
    await transport.connect(controller.signal);
    for(const address of addresses)await transport.manage('accountSubscribe',address,controller.signal);
    need(Date.now()-startedAt<=15000,'COMPONENT_SETUP_PHASE_CAP');
    commonStartedAt=Date.now();stage='observation';record('common-window-start',{at:commonStartedAt,addresses,referenceCadenceMs:2000});
    let nextPeriodic=0,nextAux=0,reconnectIndex=-1,blockIndex=0;const referenceSnapshots:ComponentSnapshot[]=[base];
    const commonEnd=commonStartedAt+60000;
    while(Date.now()<commonEnd){
      controller.signal.throwIfAborted();if(transport.error())throw transport.error();
      const nextAt=commonStartedAt+nextPeriodic*2000;
      if(nextPeriodic<30&&Date.now()>=nextAt){
        await quote('periodic',BigInt(hypothetical.fullBaseUnits),nextAt);periodic++;nextPeriodic++;
        if(nextPeriodic===20)referenceSnapshots.push(snapshot());
        continue;
      }
      if(!planned.requested&&Date.now()>=commonStartedAt+30000){
        planned.requested=true;planned.requestedAt=Date.now();
        await transport.terminateAndWait('predeclared-single-reconnect',600);planned.closedAt=Date.now();reconnectIndex=0;continue;
      }
      const auxAt=commonStartedAt+1000+nextAux*2000;
      if(nextAux<30&&Date.now()>=auxAt){
        nextAux++;
        const until=Math.min(commonEnd,nextAt)-Date.now()-10;
        const earliestStart=Math.max(Date.now(),(budget.usage().starts.at(-1)??0)+1000);
        if(until<150||earliestStart>=Math.min(commonEnd,nextAt)-200){record('auxiliary-slot-skipped',{at:Date.now(),earliestStart,nextPeriodicAt:nextAt,reason:'insufficient-paced-operation-room'});continue;}
        const auxSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(until)]);
        if(reconnectIndex===0){await transport.connect(auxSignal);planned.upgradedAt=Date.now();reconnectIndex=1;}
        else if(reconnectIndex>0&&reconnectIndex<=7){await transport.manage('accountSubscribe',addresses[reconnectIndex-1]!,auxSignal);reconnectIndex++;if(reconnectIndex===8)planned.allAcknowledgedAt=Date.now();}
        else if(blockIndex<2&&Date.now()>=commonStartedAt+(blockIndex===0?11000:51000)){
          const reference=referenceSnapshots[Math.min(blockIndex,referenceSnapshots.length-1)]!,requestedAt=Date.now();
          const blockTime=await transport.call<number|null>('getBlockTime',[reference.context.slot],auxSignal),availableAt=Date.now();
          need(Number.isSafeInteger(blockTime)&&blockTime!==null,'COMPONENT_BLOCK_TIME_UNAVAILABLE');
          const clock=Buffer.from(reference.value[reference.addresses.indexOf('SysvarC1ock11111111111111111111111111111111')]!.data[0],'base64').readBigInt64LE(32);
          const row={slot:reference.context.slot,requestedAt,availableAt,originalAccountReceivedAt:reference.receivedAt,independentlyRetrievedBlockTime:blockTime,bankClockUnixSeconds:clock.toString(),differenceSeconds:Number(clock)-blockTime,backdated:false};blockTimes.push(row);record('actual-slot-block-time-reference',row);blockIndex++;
        }else if(extras<5&&dirty>pricedDirty){await quote('trigger',BigInt(hypothetical.fullBaseUnits),null);extras++;}
        continue;
      }
      await sleep(Math.min(25,Math.max(1,Math.min(nextAt,auxAt,commonEnd)-Date.now())));
    }
    commonEndedAt=Date.now();need(periodic===30,'COMPONENT_INCOMPLETE_REFERENCE_WINDOW');need(planned.allAcknowledgedAt&&blockTimes.length===2,'COMPONENT_INCOMPLETE_RECOVERY_OR_REFERENCES');
    stage='cleanup';const cleanupAt=Date.now();
    for(const id of [...transport.subscriptions.keys()]){
      need(Date.now()-cleanupAt<10000&&Date.now()<deadline-5000,'COMPONENT_CLEANUP_PHASE_CAP');
      await transport.manage('accountUnsubscribe',id,controller.signal);
    }
    await transport.terminateAndWait('normal-cleanup',600);stage='complete';
  }catch(e){if(commonStartedAt!==null&&commonEndedAt===null)commonEndedAt=Date.now();failure??=safe(e);record('component-stop',{reason:failure,stage,at:Date.now()});stop(failure);}
  finally{
    stage='shutdown';controller.abort();
    try{await transport.terminateAndWait('final-shutdown',Math.max(1,Math.min(600,deadline-Date.now()-200)));}catch{failure??='COMPONENT_WS_CLOSE_UNCERTAIN';}
    clearInterval(watch);clearTimeout(totalTimer);rejections?.close();
    // Never issue network cleanup after any fault. A pending transport remains uncertain.
    const settleUntil=Math.min(deadline-200,Date.now()+1500);while(budget.inFlight&&Date.now()<settleUntil)await sleep(10);
    const usage=budget.usage(),quotes=evaluations.filter(e=>e.kind!=='preflight'),gaps=quotes.slice(1).map((e,i)=>e.availableAt-quotes[i]!.availableAt),changes=quotes.slice(1).filter((e,i)=>e.sell.outputLamports!==quotes[i]!.sell.outputLamports),cpu=process.cpuUsage(cpu0);
    const summary={schemaVersion:1,classification:failure?'STOPPED_COMPONENT_TEST':'COMPLETED_COMPONENT_TEST',outcome:failure?'STOPPED_'+failure:'ONE_POOL_COMPONENT_COMPLETED',startedAt:new Date(startedAt).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-startedAt,stopReason:failure,setupMs:commonStartedAt===null?null:commonStartedAt-startedAt,commonObservationMs:commonStartedAt===null?0:(commonEndedAt??Date.now())-commonStartedAt,selectedPool:selected,hypothetical,usage,httpResponseTimesMs:metrics(httpTimings.map(t=>t.availableAt-t.requestedAt)),pricing:{completedPeriodic:periodic,completedTriggered:extras,sameBytesSdkParityChecks:parities.length,clockEvidence:parities[0]??null,quoteAgeAtUseMs:metrics(quotes.map(e=>e.quoteAgeAtUseMs)),sourceAgeAtUseMs:metrics(quotes.map(e=>e.sourceAgeAtUseMs)),completedEvaluationGapsMs:metrics(gaps),referenceLatenessMs:metrics(quotes.filter(e=>e.expectedAt!==null).map(e=>e.startLatenessMs)),realLiquidationOutputChanges:changes.length,notionalExitConditions:quotes.filter(e=>e.hypotheticalExitCondition).map(e=>({at:e.availableAt,condition:e.hypotheticalExitCondition,netLamports:e.netAfterSimulatedExitGasLamports})),evaluations:quotes},webSocket:{connections:transport.connection,notifications:transport.notifications,changedNotifications:transport.changes,socketBytes:transport.socketBytes,applicationBytes:transport.applicationBytes,reconnect:planned},independentBlockTimestampReferences:blockTimes,resources:{location:'Cloud-only; EC2 compatibility untested',maxRssBytes:maxRss,maxEventLoopLagMs:maxLag,cpuMs:(cpu.user+cpu.system)/1000},newEvidenceBytesBeforeSummary:directoryBytes(out),oldBaselineUnchanged:SHA(readFileSync(OLD))===oldHash,limitations:['No PumpApi capture or complete trade-flow measurement.','Clock bank time is distinct from independently retrieved block timestamps.','Same-byte decoder/SDK parity is not independent on-chain or live execution proof.','No real holdings, financial fill, account write, production deployment, natural-trading performance or acceptance clock.','HTTP bytes count response bodies; WebSocket bytes count Node socket receipt, not exact TLS/proxy wire transfer. Unknown transfer costs remain separate.','No live three-pool batching or combined candidate/protection workload acceptance.'],paperEntries:false,liveTrading:false,productionTouched:false};
    need(summary.oldBaselineUnchanged,'COMPONENT_OLD_BASELINE_CHANGED');
    writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600,flag:'wx'});process.send?.({kind:'final',summary});
    if(!budget.inFlight)budget.close();process.exitCode=failure?2:0;process.disconnect?.();
  }
}
if(process.argv[2]==='run-approved')process.exitCode=(await runComponentLauncher(resolve(import.meta.filename))).exitCode;
else if(process.argv[2]==='--component-child')await child();
else process.stdout.write('No network performed. Explicit run-approved consumes the single approved grant.\n');
