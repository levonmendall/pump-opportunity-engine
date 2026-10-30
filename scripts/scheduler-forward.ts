/** Exactly one approved diagnostic; no production/account/provider credentials. */
import {readFileSync,appendFileSync,writeFileSync,openSync,closeSync,fsyncSync,mkdirSync,readdirSync,statSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {ComponentBudget,type ComponentKind,type ComponentOperation,type ComponentBaseline} from '../src/component-budget.js';
import {ComponentTransport} from '../src/component-transport.js';
import {readResearchBaseline} from '../src/research-baseline.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {validateComponentParity,type ComponentSnapshot} from '../src/component-parity.js';
import {PUMP_AMM_SDK,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA} from '../src/sdk.js';
import {captureOvernightFields} from '../src/overnight-field.js';
import {preflightSchedulerForward,type ForwardScope} from '../src/scheduler-forward-preflight.js';
import {auditSchedulerForward} from '../src/scheduler-forward-audit.js';
import {runSchedulerForwardLauncher,schedulerForwardUsage} from './scheduler-forward-launcher.js';
const MIB=1024*1024,ROOT='evidence/scheduler-forward-20261027';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function need(v:unknown,code:string):asserts v {if(!v)throw Error(code);}
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,120}$/.test(e.message)?e.message:'SCHEDULER_DIAGNOSTIC_UNAVAILABLE';
const directoryBytes=(p:string):number=>readdirSync(p).reduce((n,s)=>{const q=join(p,s),st=statSync(q);return n+(st.isDirectory()?directoryBytes(q):st.size);},0);

/** The existing physical counter is the only authority. These per-phase checks
 * restrict it BEFORE admission; they create no independent provider budget. */
export class ForwardPhaseBudget extends ComponentBudget {
  constructor(options:ConstructorParameters<typeof ComponentBudget>[0],private readonly phaseCap:number,private readonly initial:ComponentBaseline,private readonly phaseSignal:AbortSignal){super(options);}
  override async operate<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,outer?:AbortSignal,options:{timeoutMs?:number;latestStartAt?:number}={}){
    const u=this.usage();need(this.newUnits<this.phaseCap,'SCHEDULER_PHASE_UNIT_CAP');need(this.calls-this.initial.calls<73,'SCHEDULER_PLANNED_UNIT_CAP');
    const reserve=kind.transport==='http'?2*MIB:8*MIB;
    need(u.cumulativeResponseBytes-this.initial.bytes+u.uncertainResponseBytes+reserve+2*MIB<=32*MIB,'SCHEDULER_NEW_RESPONSE_RESERVE');
    return super.operate(kind,work,AbortSignal.any([this.phaseSignal,...(outer?[outer]:[])]),options);
  }
}

async function child(){
  need(process.getuid?.()===1000&&process.send,'SCHEDULER_CHILD_NONROOT_IPC_REQUIRED');
  const out=process.env.POE_COMPONENT_OUT_DIR!,startedAt=Number(process.env.POE_COMPONENT_STARTED_AT),deadlineAt=Number(process.env.POE_COMPONENT_DEADLINE_AT);
  need(resolve(out)===resolve(ROOT)&&deadlineAt===startedAt+120000,'SCHEDULER_CHILD_BINDING');
  const authorization=JSON.parse(readFileSync(join(out,'authorization.json'),'utf8')),initialRead=JSON.parse(readFileSync(join(out,'baseline.json'),'utf8'));
  need(authorization.startedAt===startedAt&&authorization.deadlineAt===deadlineAt&&authorization.proposalSha256===hash('evidence/scheduler-correction-20261027/forward-proposal.json'),'SCHEDULER_CHILD_AUTHORIZATION_MISMATCH');
  const initial=initialRead.baseline as ComponentBaseline,oldPaths=initialRead.baselinePaths as string[],books:string[]=[],controller=new AbortController(),cpu0=process.cpuUsage();
  let budget:ForwardPhaseBudget|null=null,rpc:ComponentTransport|null=null,phase='setup',reason:string|null=null,preflight:any=null,capture:any=null,audit:any=null,latest:ComponentSnapshot|null=null,reserved=false,streamAttempted=false,maxLag=0,maxRss=0,maxCpu=0,lastTick=performance.now();
  let setupDeadlineAt:number|null=null,setupTimer:ReturnType<typeof setTimeout>|undefined;
  const selectedHints:any[]=[],normalizedAvailability:any[]=[],marks:any[]=[],phaseReceipts:any[]=[];
  const record=(kind:string,data:unknown)=>{
    if(kind==='field-stream-open'&&setupDeadlineAt!==null){if(Date.now()>setupDeadlineAt){reason??='SCHEDULER_SETUP_TIME_CAP';controller.abort();throw Error(reason);}clearTimeout(setupTimer);setupDeadlineAt=null;}
    const row={kind,recordedAt:Date.now(),phase,data},line=JSON.stringify(row)+'\n';need(directoryBytes(out)+Buffer.byteLength(line)+640*1024<=6*MIB,'SCHEDULER_EVIDENCE_CAP');appendFileSync(join(out,'observations.ndjson'),line,{mode:0o600});
    if(kind==='research-clock-pool-state')latest=data as ComponentSnapshot;
    if(kind==='research-selected-hint')selectedHints.push(data);
    if(kind==='research-normalized-trade'){const d=data as any;normalizedAvailability.push({identityKey:d.executedEvidence.identityKey,rpcAvailableAt:d.rpcAvailableAt,validationCompletedAt:d.validationCompletedAt,duringObservation:d.duringObservation});}
  };
  const store=(path:string,value:unknown)=>{const raw=JSON.stringify(value,null,2)+'\n';need(directoryBytes(out)+Buffer.byteLength(raw)+256*1024<=6*MIB,'SCHEDULER_EVIDENCE_CAP');const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,raw);fsyncSync(fd);}finally{closeSync(fd);}const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}};
  const abort=()=>controller.abort();process.on('SIGTERM',abort);process.on('message',(m:any)=>{if(m?.kind==='stop')abort();});
  const watch=setInterval(()=>{const now=performance.now();maxLag=Math.max(maxLag,Math.max(0,now-lastTick-100));lastTick=now;maxRss=Math.max(maxRss,process.memoryUsage().rss);const used=process.cpuUsage(cpu0);maxCpu=Math.max(maxCpu,(used.user+used.system)/1000);const halt=budget?.usage().haltedReason;
    process.send?.({kind:'progress',stage:phase,rss:maxRss,cpuMs:maxCpu,eventLoopLagMs:maxLag,firstProviderFailure:halt&&/(HTTP_429|OVERLOAD|RPC_-32005)/.test(halt)?halt:null});if(Date.now()>=deadlineAt||maxLag>500||maxRss>256*MIB||maxCpu>20000)abort();},100);
  const globalTimer=setTimeout(abort,Math.max(0,deadlineAt-Date.now()));
  let phaseTimer:ReturnType<typeof setTimeout>|undefined,pumpLease:number|undefined;
  const begin=(name:string,cap:number,duration:number)=>{
    need(budget===null,'SCHEDULER_PHASE_OWNER_CONFLICT');phase=name;const at=Date.now();need(at<deadlineAt,'SCHEDULER_AGGREGATE_TIME_CAP');
    const dir=join(out,name);mkdirSync(dir,{mode:0o700});const baseline=readResearchBaseline({paths:[...oldPaths,...books],now:at,physicalSettled:true});
    const phaseControl=new AbortController(),endsAt=Math.min(deadlineAt,at+duration);phaseTimer=setTimeout(()=>phaseControl.abort(),endsAt-at);
    budget=new ForwardPhaseBudget({statePath:join(dir,'rpc-budget.json'),grantId:'scheduler-forward-'+name,baseline:baseline.baseline,startedAt:at,totalMs:endsAt-at,record},cap,initial,AbortSignal.any([controller.signal,phaseControl.signal]));
    rpc=new ComponentTransport(budget,record,()=>{});books.push(join(dir,'rpc-budget.json'));record('diagnostic-phase-start',{name,at,endsAt,cap,baselineUnits:baseline.baseline.calls});
  };
  const finish=async()=>{
    if(!budget)return;clearTimeout(phaseTimer);const current=budget,until=Math.min(deadlineAt,Date.now()+1000);while(current.inFlight&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
    const usage=current.usage(),receipt={phase,at:Date.now(),usage};phaseReceipts.push(receipt);store(join(out,phase,'summary.json'),receipt);need(current.inFlight===0,'SCHEDULER_PHYSICAL_UNSETTLED');current.close();budget=null;rpc=null;
  };
  try{
    begin('01-preflight',3,5000);
    const scope=authorization.proposal.measured11.selectedScope as ForwardScope;
    preflight=await preflightSchedulerForward({scope,rpc:rpc!,record,signal:controller.signal});await finish();
    begin('02-combined',56,90000);
    const combinedStartedAt=budget!.usage().startedAt;setupDeadlineAt=combinedStartedAt+10000;setupTimer=setTimeout(()=>{reason??='SCHEDULER_SETUP_TIME_CAP';controller.abort();},Math.max(0,setupDeadlineAt-Date.now()));const pricer=new ResearchClockPositionPricer(rpc!,{record});
    const holdings=[{mint:scope.mint,units:scope.baseUnits,minSlot:preflight.scope.minSlot}];
    for(const p of ['evidence/integration-proof-2026-10-26T23-32-41.255Z.json','evidence/integration-proof-2026-10-26T19-57-35.882Z.json']){const proof=JSON.parse(readFileSync(p,'utf8'));holdings.push({mint:proof.quote.mint,units:proof.quote.buy.outputBaseUnits,minSlot:proof.quote.slot});}
    const quote=async(signal:AbortSignal,floor:number)=>{
      const before=budget!.calls,batch=await pricer.quoteMany(holdings.map(h=>({mint:new PublicKey(h.mint),fullBaseUnits:BigInt(h.units),minSlot:Math.max(h.minSlot,h.mint===scope.mint?floor:0)})),signal);
      need(latest&&batch.context,'SCHEDULER_NO_COHERENT_CONTEXT');const snap:ComponentSnapshot=latest;
      for(const h of holdings){const q=batch.quotes[h.mint];need(q,'SCHEDULER_HOLDING_QUOTE_UNAVAILABLE');const raw=snap.value[snap.addresses.indexOf(q.pool)]!;const pool=PUMP_AMM_SDK.decodePool({...raw,owner:new PublicKey(raw.owner),data:Buffer.from(raw.data[0],'base64')});const addresses=[q.pool,GLOBAL_CONFIG_PDA.toBase58(),PUMP_AMM_FEE_CONFIG_PDA.toBase58(),h.mint,NATIVE_MINT.toBase58(),pool.poolBaseTokenAccount.toBase58(),pool.poolQuoteTokenAccount.toBase58(),SYSVAR_CLOCK_PUBKEY.toBase58()];validateComponentParity({...snap,addresses,value:addresses.map(a=>snap.value[snap.addresses.indexOf(a)]??null)},h.mint,BigInt(h.units),q);}
      const usedAt=Date.now();for(const h of holdings){const q=batch.quotes[h.mint]!;need(usedAt-Date.parse(q.receivedAt)>=0&&usedAt-Date.parse(q.receivedAt)<=2000&&usedAt-q.marketClockUnixSeconds*1000>=0&&usedAt-q.marketClockUnixSeconds*1000<=30000,'SCHEDULER_QUOTE_STALE_AT_USE');}
      const row={usedAt,slot:batch.context.slot,requests:budget!.calls-before,unionAccounts:snap.addresses.length,holdings:holdings.map(h=>({mint:h.mint,units:h.units,quote:batch.quotes[h.mint],netAfterModeledGasLamports:(BigInt(batch.quotes[h.mint]!.sell.outputLamports)-7000n).toString()})),hypotheticalOnly:true};marks.push(row);record('forward-three-holding-evaluation',row);return batch.quotes[scope.mint]!;
    };
    const before=budget!.calls;await quote(controller.signal,preflight.scope.minSlot);need(budget!.calls-before===2,'SCHEDULER_PREWARM_TWO_READ_CONTRACT');need(Date.now()-combinedStartedAt<10000,'SCHEDULER_SETUP_TIME_CAP');
    // No old stream book is modified, even if this connection later fails.
    const oldStreamPath='evidence/overnight-20261027/pumpapi-budget.json',oldStream=JSON.parse(readFileSync(oldStreamPath,'utf8'));
    need(oldStream.reservedBytes===256*MIB&&oldStream.reservedMs===230000,'SCHEDULER_STREAM_BASELINE_CHANGED');
    pumpLease=openSync('/tmp/poe-pumpapi-probe.lock','a+',0o600);need(spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',pumpLease]}).status===0,'SCHEDULER_PUMPAPI_ALREADY_OWNED');
    store(join(out,'pumpapi-budget.json'),{schemaVersion:1,authority:'Explicit owner approval of pinned de102ee diagnostic',proposalSha256:authorization.proposalSha256,baseline:{path:oldStreamPath,sha256:hash(oldStreamPath),reservedBytes:oldStream.reservedBytes,reservedMs:oldStream.reservedMs},reservedAt:Date.now(),newReservedBytes:140*MIB,newReservedMs:90000,reservedBytes:396*MIB,reservedMs:320000,refunded:false,preflightAndFreshPrewarmPassed:true,maximumConnections:1});reserved=true;
    streamAttempted=true;
    capture=await captureOvernightFields({scope:{...scope,minSlot:preflight.scope.minSlot,supportedPoolEvidence:hash(join(out,'observations.ndjson'))},budget:budget!,rpc:rpc!,record,signal:controller.signal,profile:'scheduler-forward-approved',schedulerPolicy:'bounded-deadline-v1',observationMs:75000,protection:{everyMs:2000,quote}});
    capture.auditSelectedHints=selectedHints;capture.auditNormalizedAvailability=normalizedAvailability;store(join(out,'capture.json'),capture);
    const fail=capture.firstQualityFailure||capture.qualityGaps.length>0||capture.pending>0||capture.stopReason!=='COMPONENT_FIELD_DURATION_LIMIT'||budget!.usage().haltedReason||capture.physicalSlotUncertain;
    await finish();need(!fail,'SCHEDULER_CAPTURE_STOPPED_OR_QUALITY_UNUSABLE');
    need(capture.openedAt!==null,'SCHEDULER_NO_OPEN_INTERVAL');
    const target={startAt:Math.ceil(capture.openedAt/10000)*10000,endAt:Math.ceil(capture.openedAt/10000)*10000+60000};
    begin('03-audit',14,20000);audit=await auditSchedulerForward({capture,scope,rpc:rpc!,record,signal:controller.signal,target});store(join(out,'audit.json'),audit);await finish();
  }catch(e){reason??=safe(e);try{record('diagnostic-stop',{reason,phase,streamAttempted,reserved});}catch{}}
  finally{
    controller.abort();clearInterval(watch);clearTimeout(globalTimer);clearTimeout(phaseTimer);clearTimeout(setupTimer);if(pumpLease!==undefined)closeSync(pumpLease);
    if(budget){try{await finish();}catch(e){reason??=safe(e);}}
    const target=capture?.openedAt===null||!capture?null:{startAt:Math.ceil(capture.openedAt/10000)*10000,endAt:Math.ceil(capture.openedAt/10000)*10000+60000};
    const targetRows=capture&&target?capture.featureRows.filter((r:any)=>r.at>=target.endAt&&r.at<=capture.observationEndedAt&&r.curve.windowEndAt===target.endAt&&r.fullyEnriched&&r.curve.sufficientlyObserved&&r.user.sufficientlyObserved):[];
    const remainingBudget=budget as ForwardPhaseBudget|null,physicalSettled=remainingBudget===null||remainingBudget.inFlight===0;
    const current=schedulerForwardUsage(out,initial);let chainValid=false;
    if(physicalSettled){try{readResearchBaseline({paths:[...oldPaths,...books],now:Date.now(),physicalSettled:true});chainValid=true;}catch(e){reason??=safe(e);}}else reason??='SCHEDULER_PHYSICAL_UNSETTLED';
    const summary={outcome:!streamAttempted?'PREFLIGHT_REFUSED_NO_STREAM':reason?'DIAGNOSTIC_STOPPED_NOT_ACCEPTED':audit?.complete?'DIAGNOSTIC_BOUNDED_AUDIT_COMPLETED_REVIEW_REQUIRED':'DIAGNOSTIC_AUDIT_INCOMPLETE',reason,startedAt,completedAt:Date.now(),elapsedMs:Date.now()-startedAt,streamAttempted,streamReserved:reserved,preflight:preflight?{verifiedSignature:preflight.verifiedSwap.signature,history:preflight.history,entryEligibility:preflight.entryEligibility}:null,capture:capture?{openedAt:capture.openedAt,endedAt:capture.observationEndedAt,openMs:capture.openMs,stopReason:capture.stopReason,firstQualityFailure:capture.firstQualityFailure,normalizedEvents:capture.normalizedEvents,normalizedBuys:capture.normalizedBuys,normalizedSells:capture.normalizedSells,pending:capture.pending,qualityGaps:capture.qualityGaps,queueAgeMs:capture.queueAgeMs,enrichmentAvailableAfterHintMs:capture.enrichmentAvailableAfterHintMs,socketBytes:capture.socketBytes,applicationBytes:capture.applicationBytes,frames:capture.frames,protection:capture.protection,sharedScheduler:capture.sharedScheduler}:null,targetWindow:target,rawFullyEnrichedClosedTargetRows:targetRows.map((r:any)=>({at:r.at,curve:r.curve,user:r.user})).slice(0,10),independentAudit:audit,usage:{cumulativeUnits:current.cumulativeUnits,observedRelatedBytes:initialRead.observedBytes+current.observedBytes,retainedUnknownBytes:initialRead.uncertainResponseBytes+current.uncertainBytes,accountedRelatedBytes:current.cumulativeAccountedBytes,newUnits:current.newUnits,newAccountedBytes:current.accountedBytes,physicalSettled,chainValid},resources:{peakRssBytes:maxRss,peakCpuMs:maxCpu,peakLoopLagMs:maxLag},protectionAcceptance:false,productionChanged:false,paperEntries:false,liveTrading:false,acceptanceClock:false};
    store(join(out,'summary.json'),summary);process.send?.({kind:'final',summary});process.disconnect?.();process.exitCode=reason?2:0;
  }
}
if(resolve(process.argv[1]??'')===import.meta.filename){if(process.argv[2]==='--child')await child();else if(process.argv[2]==='run')process.exitCode=(await runSchedulerForwardLauncher(import.meta.filename)).exitCode;else console.log('No network. One approved diagnostic requires explicit run.');}
