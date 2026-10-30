/** One isolated notification/Clock component under the linked overnight grant.
 * The explicit parent launch is the only network entry point; no financial IO.
 */
import {readFileSync,appendFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport,type ComponentNotice} from '../src/component-transport.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {validateComponentParity,type ComponentSnapshot} from '../src/component-parity.js';
import {componentObjectiveResults,type ComponentBasicResult,type ComponentAck} from '../src/component-results.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {runComponentLauncher} from './component-launcher.js';

const MIB=1024*1024;
function need(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,110}$/.test(e.message)?e.message:'COMPONENT_NOTIFICATION_MEASUREMENT_FAILURE';
const metric=(values:number[])=>{const a=[...values].sort((x,y)=>x-y);return {samples:a.length,p50:a.length?a[Math.floor((a.length-1)*.5)]:null,p95:a.length?a[Math.floor((a.length-1)*.95)]:null,maximum:a.length?a.at(-1):null};};
function retainedBytes(path:string):number{return readdirSync(path).reduce((n,name)=>n+statSync(join(path,name)).size,0);}
/** Absolute common-window times; fixed two-second pricing has first priority. */
export function notificationComponentSchedule(commonAt:number){need(Number.isSafeInteger(commonAt)&&commonAt>=0&&Number.isSafeInteger(commonAt+30000),'COMPONENT_SCHEDULE_TIME');return {periodic:Array.from({length:15},(_,i)=>commonAt+i*2000),closeAt:commonAt+8000,upgradeAt:commonAt+9000,resubscribe:Array.from({length:7},(_,i)=>commonAt+11000+i*2000),endAt:commonAt+30000};}
const accountHash=(a:any)=>createHash('sha256').update(JSON.stringify({owner:a.owner,lamports:a.lamports,executable:a.executable,data:a.data})).digest('hex');
/** A matching slot alone cannot order two incompatible account versions. Use
 * actual post-validation time; older-slot intermediate notices supply no claim
 * of missing coverage and do not override a later coherent account snapshot. */
export function notificationQuoteAtUse(input:{snapshot:ComponentSnapshot;notices:readonly ComponentNotice[];highestNoticeSlot:number;receivedAt:number;marketClockUnixSeconds:number;usedAt:number}){
  const {snapshot,receivedAt,marketClockUnixSeconds,usedAt}=input,quoteAgeAtUseMs=usedAt-receivedAt,sourceAgeAtUseMs=usedAt-marketClockUnixSeconds*1000;
  need([receivedAt,marketClockUnixSeconds,usedAt].every(Number.isSafeInteger)&&quoteAgeAtUseMs>=0&&quoteAgeAtUseMs<=2000&&sourceAgeAtUseMs>=0&&sourceAgeAtUseMs<=30000,'COMPONENT_QUOTE_AGE_AT_USE');
  const latest=new Map<string,ComponentNotice>();for(const n of input.notices){if(!snapshot.addresses.includes(n.address))continue;const prior=latest.get(n.address);if(!prior||n.slot>prior.slot||n.slot===prior.slot&&n.at>=prior.at)latest.set(n.address,n);}
  const highest=Math.max(input.highestNoticeSlot,...[...latest.values()].map(n=>n.slot));
  const incompatible=[...latest.values()].filter(n=>n.slot===snapshot.context.slot&&accountHash(snapshot.value[snapshot.addresses.indexOf(n.address)])!==n.hash).map(n=>n.address);
  const nonActionableReason=highest>snapshot.context.slot?'NEWER_CONFIRMED_NOTICE_BECAME_AVAILABLE':incompatible.length?'SAME_SLOT_CONFIRMED_ACCOUNT_BYTES_INCOMPATIBLE':null;
  return {quoteAgeAtUseMs,sourceAgeAtUseMs,actionableAtUse:nonActionableReason===null,nonActionableReason,sameSlotIncompatibleAccounts:incompatible};
}
async function child(){
  const out=process.env.POE_COMPONENT_OUT_DIR!,startedAt=Number(process.env.POE_COMPONENT_STARTED_AT),leg=process.env.POE_OVERNIGHT_LEG!;
  need(process.getuid?.()===1000&&Number.isSafeInteger(startedAt)&&/^\d\d-notifications$/.test(leg)&&resolve(out)===resolve('evidence/overnight-20261027',leg),'COMPONENT_CHILD_BINDING');
  const baseline=JSON.parse(readFileSync(join(out,'baseline.json'),'utf8')),deadline=startedAt+baseline.maximumTotalMs;
  const budget=new ComponentBudget({statePath:join(out,'rpc-budget.json'),grantId:'overnight-'+leg,baseline:baseline.baseline,startedAt,totalMs:baseline.maximumTotalMs,notBefore:baseline.providerNotBefore});
  const abort=new AbortController(),cpu0=process.cpuUsage(),capture={latest:null as ComponentSnapshot|null};
  let stage='preflight',reason:string|null=null,recordBytes=0,lastBeat=performance.now(),maxLag=0,maxRss=0,dirty=0,pricedDirty=0,highestNoticeSlot=0;
  let commonStartedAt:number|null=null,commonEndedAt:number|null=null,basic:ComponentBasicResult|null=null,periodic=0,triggers=0,extraBlockTime=false;
  const acknowledgements:ComponentAck[]=[],httpTimings:any[]=[],snapshots:ComponentSnapshot[]=[],evaluations:any[]=[],parities:any[]=[],blockTimeReferences:any[]=[],addresses:string[]=[];
  const reconnect={requested:false,closedAt:null as number|null,upgradedAt:null as number|null,allAcknowledgedAt:null as number|null,firstCoherentQuoteAt:null as number|null};
  const record=(kind:string,data:unknown)=>{
    const line=JSON.stringify({kind,recordedAt:Date.now(),data})+'\n';need(recordBytes+Buffer.byteLength(line)<=6*MIB,'COMPONENT_EVIDENCE_CAP');
    appendFileSync(join(out,'observations.ndjson'),line,{mode:0o600});recordBytes+=Buffer.byteLength(line);
    if(kind==='research-clock-pool-state')capture.latest=data as ComponentSnapshot;
    if(kind==='ws-ack')acknowledgements.push(data as ComponentAck);
    if(kind==='http-response-timing')httpTimings.push(data);
  };
  const onNotice=(n:ComponentNotice)=>{highestNoticeSlot=Math.max(highestNoticeSlot,n.slot);if(n.changed)dirty++;};
  const transport=new ComponentTransport(budget,record,onNotice),pricer=new ResearchClockPositionPricer(transport,{record});
  const stop=(r:string)=>{reason??=r;try{budget.halt(r);}catch{}abort.abort();try{transport.terminate(r);}catch{transport.socket?.terminate();}};
  process.on('SIGTERM',()=>stop('COMPONENT_PARENT_STOP'));process.on('message',(m:any)=>{if(m?.kind==='stop')stop('COMPONENT_PARENT_STOP');});process.on('disconnect',()=>{if(stage!=='complete')stop('COMPONENT_PARENT_DISCONNECTED');});
  const watcher=setInterval(()=>{try{
    const n=performance.now(),lag=Math.max(0,n-lastBeat-100),cpu=process.cpuUsage(cpu0),rss=process.memoryUsage().rss;lastBeat=n;maxLag=Math.max(maxLag,lag);maxRss=Math.max(maxRss,rss);
    process.send?.({kind:'progress',stage,rss,cpuMs:(cpu.user+cpu.system)/1000,eventLoopLagMs:lag});
    if(rss>256*MIB||lag>500||cpu.user+cpu.system>20000000||retainedBytes(out)>7.5*MIB)stop('COMPONENT_RESOURCE_STOP');
    if(Date.now()>=deadline-5000&&stage!=='shutdown'&&stage!=='complete')stop('COMPONENT_SHUTDOWN_RESERVE');
  }catch{stop('COMPONENT_RESOURCE_CHECK_FAILURE');}},100);
  const selectedRef='evidence/overnight-20261027/06-targeted/selected.json',selectedBytes=readFileSync(selectedRef),subject=JSON.parse(selectedBytes.toString());
  const units=BigInt(subject.baseUnits),entryCost=BigInt(subject.hypothetical?.entryCostLamports??'0'),exitGas=7000n;
  const sleep=async(ms:number)=>{abort.signal.throwIfAborted();await new Promise<void>((r,j)=>{const done=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);r();},cancel=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);j(Error('COMPONENT_ABORTED'));},timer=setTimeout(done,Math.max(1,ms));abort.signal.addEventListener('abort',cancel,{once:true});if(abort.signal.aborted)cancel();});};
  const earliestStart=()=>{
    const u=budget.usage(),starts=[...u.baseline.starts,...u.starts],at=Date.now(),short=starts.filter(t=>t>at-10000),minute=starts.filter(t=>t>at-60000);
    return Math.max(at,baseline.providerNotBefore??0,(starts.at(-1)??0)+1000,short.length>=30?short[short.length-30]!+10000:0,minute.length>=60?minute[minute.length-60]!+60000:0);
  };
  const quote=async(kind:'preflight'|'periodic'|'trigger',expectedAt:number|null)=>{
    const requestedFloor=Math.max(subject.minSlot,highestNoticeSlot),version=dirty;
    const q=await pricer.quote({mint:new PublicKey(subject.mint),fullBaseUnits:units,minSlot:requestedFloor},abort.signal),initialAvailableAt=Date.now(),s=capture.latest;
    need(s&&q.mint===subject.mint&&q.pool===subject.pool&&q.slot===s.context.slot&&q.slot>=requestedFloor,'COMPONENT_NOTIFICATION_QUOTE_CONTEXT');
    const parity=validateComponentParity(s,subject.mint,units,q),availableAt=Date.now(),use=notificationQuoteAtUse({snapshot:s,notices:transport.notices,highestNoticeSlot,receivedAt:Date.parse(q.receivedAt),marketClockUnixSeconds:q.marketClockUnixSeconds,usedAt:availableAt});
    const actionable=use.actionableAtUse,net=BigInt(q.sell.outputLamports)-exitGas;need(net>0n,'COMPONENT_EXIT_COST_EXCEEDS_PROCEEDS');
    const condition=actionable?(net*100n<=entryCost*85n?'STOP_LOSS':net*100n>=entryCost*130n?'TAKE_PROFIT':null):null;
    const timing=httpTimings.at(-1);need(timing?.method==='getMultipleAccounts'&&timing.availableAt<=availableAt,'COMPONENT_HTTP_START_EVIDENCE_MISSING');
    const evaluation={kind,pool:q.pool,slot:q.slot,requestedFloor,highestKnownNoticeAtUse:highestNoticeSlot,requestedAt:timing.requestedAt,expectedAt,initialAvailableAt,availableAt,usedAt:availableAt,startLatenessMs:expectedAt===null?null:Math.max(0,timing.requestedAt-expectedAt),...use,sell:q.sell,netAfterSimulatedExitGasLamports:net.toString(),hypotheticalExitCondition:condition,dirtyVersionAtStart:version,dirtyVersionAtCompletion:dirty};
    snapshots.push(structuredClone(s));evaluations.push(evaluation);parities.push({kind,slot:q.slot,matches:parity.matches,clock:parity.clock});record('notification-component-evaluation',evaluation);
    if(actionable)pricedDirty=Math.max(pricedDirty,version); // Never marks in-flight notices priced retroactively.
    if(reconnect.upgradedAt!==null&&reconnect.firstCoherentQuoteAt===null&&availableAt>=reconnect.upgradedAt)reconnect.firstCoherentQuoteAt=availableAt;
    if(!basic)basic={pool:q.pool,slot:q.slot,availableAt,fullBaseUnits:units.toString(),quoteAgeAtUseMs:use.quoteAgeAtUseMs,sameBytesSdkParity:true,bankClockValidated:true};
    return q;
  };
  const blockTime=async(slot:number)=>{const requestedAt=Date.now(),value=await transport.call<number|null>('getBlockTime',[slot],abort.signal);need(Number.isSafeInteger(value)&&value!==null,'COMPONENT_BLOCK_TIME_UNAVAILABLE');const result={slot,requestedAt,availableAt:Date.now(),blockTime:value,provenance:'independently-retrieved-getBlockTime',backdated:false};blockTimeReferences.push(result);record('independent-block-time',result);};
  try{
    need(canonicalPumpPoolPda(new PublicKey(subject.mint)).toBase58()===subject.pool&&units>0n&&units<(1n<<64n)&&entryCost>0n&&Number.isSafeInteger(subject.minSlot),'COMPONENT_SELECTED_SUBJECT_INVALID');
    record('notification-component-scope',{selectedRef,selectedSha256:createHash('sha256').update(selectedBytes).digest('hex'),mint:subject.mint,pool:subject.pool,baseUnits:units.toString(),minSlot:subject.minSlot,hypotheticalReferenceCostLamports:entryCost.toString(),referenceCostFromPriorComponent:true,realPosition:false,referenceCadenceMs:2000,commonWindowMs:30000,maximumTriggeredRefreshes:2,noRetry:true,entryEligibility:'UNVERIFIED_RESEARCH_ONLY'});
    const preflight=await quote('preflight',null);await blockTime(preflight.slot);
    const initial=capture.latest;need(initial,'COMPONENT_CAPTURE_MISSING');addresses.push(...initial.addresses.filter(a=>a!==SYSVAR_CLOCK_PUBKEY.toBase58()));
    need(addresses.length===7&&new Set(addresses).size===7,'COMPONENT_SUBSCRIPTION_SCOPE');
    const remaining=budget.usage();need(remaining.remainingGrantUnits>=43&&(remaining.remainingCumulativeUnits===null||remaining.remainingCumulativeUnits>=43)&&(remaining.remainingCumulativeResponseBytes===null||remaining.remainingCumulativeResponseBytes>=10*MIB),'COMPONENT_FULL_NOTIFICATION_WORKLOAD_DOES_NOT_FIT');
    transport.seedAccountHashes(addresses,addresses.map(a=>initial.value[initial.addresses.indexOf(a)]));
    stage='initial-subscriptions';await transport.connect(abort.signal);for(const address of addresses)await transport.manage('accountSubscribe',address,abort.signal);
    need(Date.now()-startedAt<=15000,'COMPONENT_SETUP_PHASE_CAP');
    commonStartedAt=Date.now();stage='observation';const plan=notificationComponentSchedule(commonStartedAt);record('notification-schedule',plan);let resubscribed=0;
    while(Date.now()<plan.endAt){
      abort.signal.throwIfAborted();const fault=transport.error();if(fault)throw fault;
      if(periodic<plan.periodic.length&&Date.now()>=plan.periodic[periodic]!){await quote('periodic',plan.periodic[periodic]!);periodic++;continue;}
      if(!reconnect.requested&&periodic>=5&&Date.now()>=plan.closeAt){reconnect.requested=true;await transport.terminateAndWait('single-predeclared-reconnect',600);reconnect.closedAt=Date.now();record('notification-reconnect-closed',reconnect);continue;}
      if(reconnect.requested&&reconnect.upgradedAt===null&&Date.now()>=plan.upgradeAt){await transport.connect(abort.signal);reconnect.upgradedAt=Date.now();record('notification-reconnect-upgraded',reconnect);continue;}
      if(reconnect.upgradedAt!==null&&resubscribed<7&&Date.now()>=plan.resubscribe[resubscribed]!){await transport.manage('accountSubscribe',addresses[resubscribed]!,abort.signal);resubscribed++;if(resubscribed===7)reconnect.allAcknowledgedAt=Date.now();continue;}
      const next=Math.min(periodic<15?plan.periodic[periodic]!:plan.endAt,!reconnect.requested?plan.closeAt:reconnect.upgradedAt===null?plan.upgradeAt:resubscribed<7?plan.resubscribe[resubscribed]!:plan.endAt),earliest=earliestStart();
      // Auxiliaries use only otherwise free paced slots, never delay a due
      // periodic evaluation or a planned subscription operation intentionally.
      if(earliest<next-200&&Date.now()>=earliest){
        if(!extraBlockTime&&Date.now()>=commonStartedAt+25000){await blockTime(evaluations.at(-1)!.slot);extraBlockTime=true;continue;}
        if(triggers<2&&dirty>pricedDirty&&transport.subscriptions.size>0){await quote('trigger',null);triggers++;continue;}
      }
      await sleep(Math.min(25,Math.max(1,next-Date.now()),Math.max(1,earliest-Date.now())));
    }
    commonEndedAt=Date.now();need(periodic===15&&reconnect.closedAt!==null&&reconnect.upgradedAt!==null&&reconnect.allAcknowledgedAt!==null,'COMPONENT_REFERENCE_OR_RECONNECT_INCOMPLETE');
    stage='cleanup';const cleanupAt=Date.now();for(const id of [...transport.subscriptions.keys()]){need(Date.now()-cleanupAt<10000&&Date.now()<deadline-5000,'COMPONENT_CLEANUP_PHASE_CAP');await transport.manage('accountUnsubscribe',id,abort.signal);}
    await transport.terminateAndWait('normal-measurement-end',600);
  }catch(e){stop(safe(e));try{record('notification-measurement-stop',{reason,stage,at:Date.now()});}catch{}}
  finally{
    stage='shutdown';await transport.terminateAndWait(reason??'notification-measurement-finished',600).catch(e=>{reason??=safe(e);});abort.abort();
    const until=Math.min(deadline-100,Date.now()+1000);while(budget.inFlight&&Date.now()<until)await new Promise(r=>setTimeout(r,10));clearInterval(watcher);
    const objective=componentObjectiveResults({basic,blockTimeReferences,acknowledgements,expectedAddresses:addresses,reconnect,notifications:transport.notices,validatedSnapshots:snapshots,evaluations,stopReason:reason});
    const matched=objective.changedAccountDelivery.matched,objectives={...objective,changedAccountDelivery:{...objective.changedAccountDelivery,matched:matched.slice(0,32),matchedVersionsTotal:matched.length,matchDetailLimit:32,remainingEvidence:'All received selected notices and validated account snapshots remain in observations.ndjson.'}};
    const completed=evaluations.map(e=>e.availableAt),summary={outcome:reason?'STOPPED_NOTIFICATION_COMPONENT':'NOTIFICATION_COMPONENT_COMPLETED',reason,startedAt,finishedAt:Date.now(),elapsedMs:Date.now()-startedAt,commonStartedAt,commonObservationMs:commonStartedAt===null?0:(commonEndedAt??Date.now())-commonStartedAt,subject:{mint:subject.mint,pool:subject.pool,fullBaseUnits:units.toString(),hypotheticalEntryCostLamports:entryCost.toString(),costReferenceRef:selectedRef,realPosition:false},objectives,pricing:{periodic,triggers,validatedBatches:evaluations.length,actionableAtUse:evaluations.filter(e=>e.actionableAtUse).length,nonActionableDueNewerKnownState:evaluations.filter(e=>e.nonActionableReason==='NEWER_CONFIRMED_NOTICE_BECAME_AVAILABLE').length,nonActionableDueSameSlotBytes:evaluations.filter(e=>e.nonActionableReason==='SAME_SLOT_CONFIRMED_ACCOUNT_BYTES_INCOMPATIBLE').length,quoteAgeAtUseMs:metric(evaluations.map(e=>e.quoteAgeAtUseMs)),sourceAgeAtUseMs:metric(evaluations.map(e=>e.sourceAgeAtUseMs)),completedEvaluationGapsMs:metric(completed.slice(1).map((t,i)=>t-completed[i]!)),referenceLatenessMs:metric(evaluations.filter(e=>e.expectedAt!==null).map(e=>e.startLatenessMs)),evaluations,sameBytesSdkParityChecks:parities.length,firstClockEvidence:parities[0]??null},subscriptions:{connections:transport.connection,notifications:transport.notifications,changedNotifications:transport.changes,wsSocketBytes:transport.socketBytes,wsApplicationBytes:transport.applicationBytes,reconnect,acknowledgements},rpcLatencyMs:metric(httpTimings.map(t=>t.availableAt-t.requestedAt)),usage:budget.usage(),resources:{location:'Cloud-only; EC2 compatibility untested',maxRss,maxLag,cpu:process.cpuUsage(cpu0)},limitations:['A validated account snapshot and an actionable quote at use are reported separately. A newer confirmed notice during retrieval makes that evaluation nonactionable.','Notifications are triggers, never liquidation prices. ACK and reconnect ACK evidence do not establish complete notification delivery.','Sampled hypothetical threshold conditions have unknown crossing times and are not trades, fills or continuous protection evidence.','This one-pool component does not establish combined candidate/protection capacity, strategy outcomes, three-pool notifications or acceptance.','API fees are documented as zero for public RPC; proxy/wire transfer and existing infrastructure charges are unverified and separate.','No PumpApi capture, wallet operation, financial account write or production restart/deployment.'],productionTouched:false,naturalPaperTrades:0,paperEntries:false,liveTrading:false,acceptanceClock:false};
    const body=JSON.stringify(summary,null,2)+'\n';need(Buffer.byteLength(body)<=128*1024&&retainedBytes(out)+Buffer.byteLength(body)<7.75*MIB,'COMPONENT_SUMMARY_EVIDENCE_CAP');
    writeFileSync(join(out,'summary.json'),body,{flag:'wx',mode:0o600});process.send?.({kind:'final',summary});if(!budget.inFlight)budget.close();stage='complete';process.exitCode=reason?2:0;process.disconnect?.();
  }
}
if(process.argv[2]==='--overnight-child')await child();else if(process.argv[2]==='run'&&process.argv[3])process.exitCode=(await runComponentLauncher(resolve(import.meta.filename),{leg:process.argv[3]})).exitCode;
