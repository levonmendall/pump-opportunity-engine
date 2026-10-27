/** One isolated, field-only PumpApi measurement. Broad traffic is counted then
 * discarded; only exact-scope hints and confirmed enrichment are retained.
 * Caller durably reserves the grant before calling. No publishing or trading. */
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {ActivePipeline,type ActiveScope} from './active-pipeline.js';
import {PUMPAPI_STREAM} from './pumpapi-probe.js';
import type {ComponentBudget} from './component-budget.js';
import type {ComponentTransport} from './component-transport.js';
import {chooseResearchWork,chooseProtectedResearchWork,PROPOSED_RESEARCH_TIMING,RESEARCH_DISPATCH,type DispatchDecision} from './research-dispatch.js';

const MIB=1024*1024;
export const OVERNIGHT_FIELD_LIMITS=Object.freeze({connectionMs:30000,shutdownMs:5000,enrichmentAttempts:24,payloadBytes:65536,socketStopBytes:63*MIB,applicationStopBytes:62*MIB,hardSocketBytes:64*MIB,retainedBytes:5*MIB,cpuMs:20000,rssBytes:256*MIB,eventLoopLagMs:500});
/** One separately approved diagnostic session. The caller's durable grant,
 * total-run evidence limit and shared RPC budget remain authoritative. */
export const SCHEDULER_FORWARD_FIELD_LIMITS=Object.freeze({...OVERNIGHT_FIELD_LIMITS,observationMs:75000,enrichmentAttempts:10,socketStopBytes:138*MIB,applicationStopBytes:136*MIB,hardSocketBytes:140*MIB});
type RecordFn=(kind:string,data:unknown)=>void;
type FieldQualityFailure={at:number;reason:string;responsibility:'flow'|'protection'};
export type ObservationRequestContext={latestStartAt:number;logicalCutoffAt:number;remainingObservationMs:number;admissionOpen:()=>boolean};
export type OvernightFieldInput={scope:ActiveScope;budget:ComponentBudget;rpc:ComponentTransport;record:RecordFn;signal:AbortSignal;profile?:'scheduler-forward-approved';observationMs?:30000|70000|75000;/** Exclusive data/admission boundary; shutdown is measured separately. */observationCutoff?:{durationMs:number};protection?:{everyMs:2000;quote:(signal:AbortSignal,knownConfirmedSlot:number,observation?:ObservationRequestContext)=>Promise<unknown>};/** Proposed completion guard is research-only, not approval of4s protection. */schedulerPolicy?:'bounded-deadline-v1'|'protected-deadline-proposed';/** Rejected as a default:10ms phase jitter can starve all candidate work. Explicit offline research counterfactual only. */experimentalStrictStartReservation?:true};
export type OvernightFieldDependencies={makeSocket?:(endpoint:string,options:WebSocket.ClientOptions)=>WebSocket;now?:()=>number;monotonic?:()=>number;sleep?:(ms:number)=>Promise<void>};
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,110}$/.test(e.message)?e.message:'COMPONENT_FIELD_FAILURE';

export async function captureOvernightFields(input:OvernightFieldInput,dependencies:OvernightFieldDependencies={}){
  if(input.signal.aborted)throw Error('COMPONENT_FIELD_ABORTED');
  if(input.rpc.budget!==input.budget)throw Error('COMPONENT_FIELD_SHARED_BUDGET_REQUIRED');
  const forwardProfile=input.profile==='scheduler-forward-approved',limits=forwardProfile?SCHEDULER_FORWARD_FIELD_LIMITS:OVERNIGHT_FIELD_LIMITS;
  const proposed=input.schedulerPolicy==='protected-deadline-proposed';
  if(input.profile!==undefined&&!forwardProfile||forwardProfile&&(!input.schedulerPolicy||!input.protection||input.observationMs!==undefined&&input.observationMs!==75000))throw Error('COMPONENT_FIELD_PROFILE_BOUNDS');
  const observationMs=forwardProfile?SCHEDULER_FORWARD_FIELD_LIMITS.observationMs:input.observationMs??30000;
  const strictCutoff=input.observationCutoff!==undefined,cutoffDurationMs=input.observationCutoff?.durationMs??observationMs;
  if(strictCutoff&&(!Number.isSafeInteger(cutoffDurationMs)||cutoffDurationMs<1||cutoffDurationMs>120000||cutoffDurationMs>observationMs))throw Error('COMPONENT_FIELD_CUTOFF_BOUNDS');
  if(![30000,70000,75000].includes(observationMs)||input.protection&&input.protection.everyMs!==2000||input.schedulerPolicy&&input.experimentalStrictStartReservation)throw Error('COMPONENT_FIELD_MONITORING_BOUNDS');
  const now=dependencies.now??Date.now,mono=dependencies.monotonic??(()=>performance.now()),sleep=dependencies.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
  const cpu0=process.cpuUsage(),connectionStartedAt=now(),connectionStartedMono=mono(),controller=new AbortController(),signal=AbortSignal.any([input.signal,controller.signal]);
  let retainedBytes=0,recordingFailed=false,onQuality:((reason:string,responsibility:'flow'|'protection')=>void)=()=>{},informationAdmission:((at:number)=>boolean)=()=>true;
  const record:RecordFn=(kind,data)=>{if(recordingFailed)return;const size=Buffer.byteLength(JSON.stringify({kind,recordedAt:now(),data})+'\n');if(retainedBytes+size>limits.retainedBytes){recordingFailed=true;throw Error('COMPONENT_FIELD_EVIDENCE_CAP');}retainedBytes+=size;try{input.record(kind,data);}catch{recordingFailed=true;throw Error('COMPONENT_FIELD_STORAGE_FAILURE');}if(kind==='research-quality-gap'||kind==='field-protection-gap'){const reason=data&&typeof data==='object'&&'reason'in data&&typeof data.reason==='string'?data.reason:'COMPONENT_FIELD_QUALITY_UNAVAILABLE';onQuality(reason,kind==='research-quality-gap'?'flow':'protection');}};
  const pipeline=new ActivePipeline({scope:input.scope,now,record,...(strictCutoff?{admitInformation:(at:number)=>informationAdmission(at)}:{})}),mintBytes=Buffer.from(input.scope.mint),poolBytes=Buffer.from(input.scope.pool);
  const transactions:Record<string,unknown>={},hints:Record<string,{signature:string;receivedAt:number;requestedAt:number;availableAt:number}>={};
  let ws:WebSocket|undefined,openedAt:number|null=null,endedAt:number|null=null,stopReason:string|null=null,closed=false,seenSocketBytes=0,socketBytes=0,upgradeObservedBytes=0,applicationBytes=0,frames=0,parsedFrames=0,irrelevantFrames=0,enrichments=0,busy=false,workPromise:Promise<void>|null=null,maxLag=0,maxRss=0,maxCpu=0,lastTick=mono(),lastFeature=0;
  let knownConfirmedSlot=input.scope.minSlot,nextProtectionAt:number|null=null,lastEvaluationAt:number|null=null,lastUsableEvaluationAt:number|null=null,maxEvaluationGapMs=0,maxUsableEvaluationGapMs=0,priceAttempts=0,protectionUnavailable=0,missedProtectionSchedules=0,enrichmentClosed=false,selectedMessagesAfterEnrichmentClosed=0;
  let lowPriorityReservationDeferralChecks=0;
  let otherStartSinceProtection=false,advanceOutstanding=false,earlyEvaluations=0,schedulerWaits=0,schedulerRefusals=0;
  let openedMono:number|null=null,lastTrafficSampleMono=connectionStartedMono,trafficSamples=0;
  let logicalCutoffAt:number|null=null,logicalCutoffMono:number|null=null,stopRequestedMono:number|null=null,transportStopRequestedAt:number|null=null,transportStopRequestedMono:number|null=null,transportSettledAt:number|null=null,transportSettledMono:number|null=null;
  let drainFrames=0,drainApplicationBytes=0,postCutoffFrames=0,postCutoffApplicationBytes=0,socketBytesAtStop:number|null=null,applicationBytesAtStop:number|null=null;
  let firstQualityFailure:FieldQualityFailure|null=null;
  let candidateSuspended=false;const candidateSuspensions:Array<{at:number;reason:string}>=[];
  const observationElapsed=()=>mono()-(input.schedulerPolicy&&openedMono!==null?openedMono:connectionStartedMono);
  const protectionOutcomes:Array<{scheduledAt:number;requestedAt:number;availableAt:number;deadlineAt:number;startDelayMs:number;requests:number;quoteAgeAtUseMs:number|null;usable:boolean;late:boolean;reason:string|null}>=[],protectionGaps:Array<{at:number;reason:string;blocksCombinedAcceptance:true}>=[],evaluationGapsMs:number[]=[];
  let resolveClosed!:()=>void;const closedPromise=new Promise<void>(r=>{resolveClosed=r;});
  const stop=(reason:string,gap=false)=>{
    if(stopReason)return;stopReason=reason;endedAt=now();stopRequestedMono=mono();socketBytesAtStop=socketBytes;applicationBytesAtStop=applicationBytes;
    try{if(openedAt!==null){if(gap)pipeline.gap(reason,endedAt);pipeline.endObservation(endedAt,reason,strictCutoff&&logicalCutoffAt!==null?Math.min(endedAt,logicalCutoffAt):endedAt);}}finally{transportStopRequestedAt=now();transportStopRequestedMono=mono();ws?.terminate();if(strictCutoff)record('field-observation-stop-requested',{logicalCutoffAt,logicalCutoffMonotonicAt:logicalCutoffMono,admissionClosedAt:endedAt,stopRequestedMonotonicAt:stopRequestedMono,transportStopRequestedAt,transportStopRequestedMonotonicAt:transportStopRequestedMono,reason});}
  };
  const admissionOpen=()=>!stopReason&&(!strictCutoff||logicalCutoffAt===null||logicalCutoffMono===null||now()<logicalCutoffAt&&mono()<logicalCutoffMono);
  informationAdmission=(at)=>{if(!strictCutoff)return true;if(!admissionOpen()||logicalCutoffAt!==null&&at>=logicalCutoffAt){if(!stopReason)stop('COMPONENT_FIELD_DURATION_LIMIT');return false;}return true;};
  const requestContext=():ObservationRequestContext|undefined=>strictCutoff&&logicalCutoffAt!==null&&logicalCutoffMono!==null?{latestStartAt:logicalCutoffAt-1,logicalCutoffAt,remainingObservationMs:Math.max(0,Math.min(logicalCutoffAt-now(),logicalCutoffMono-mono())),admissionOpen}:undefined;
  onQuality=(reason,responsibility)=>{
    // A2s reference miss is diagnostic: no maximum completed-evaluation gap
    // has been accepted. Invalid/missing pricing and flow evidence are fatal
    // for this single forward diagnostic; the legacy comparison is unchanged.
    if(!forwardProfile||stopReason||responsibility==='protection'&&['COMPONENT_PROTECTION_MISSED_SCHEDULE','COMPONENT_PROTECTION_LATE_EVALUATION'].includes(reason))return;
    if(proposed&&responsibility==='flow'){candidateSuspended=true;if(candidateSuspensions.length<16)candidateSuspensions.push({at:now(),reason});firstQualityFailure??={at:now(),reason,responsibility};return;}
    firstQualityFailure={at:now(),reason,responsibility};stop('COMPONENT_FIELD_FIRST_QUALITY_FAILURE');
  };
  const abort=()=>{controller.abort();try{stop('COMPONENT_FIELD_ABORTED',true);}catch{ws?.terminate();}};input.signal.addEventListener('abort',abort,{once:true});
  const sampleSocket=()=>{
    const n=(ws as unknown as {_socket?:{bytesRead?:number}})?._socket?.bytesRead;
    if(!Number.isSafeInteger(n)||Number(n)<seenSocketBytes)throw Error('COMPONENT_FIELD_SOCKET_COUNTER');
    seenSocketBytes=Number(n);socketBytes=seenSocketBytes;
    if(socketBytes>=limits.hardSocketBytes){stop('COMPONENT_FIELD_HARD_BYTE_CAP',true);return;}
    if(socketBytes>=limits.socketStopBytes)stop('COMPONENT_FIELD_SOCKET_STOP',true);
  };
  const resources=()=>{
    const current=mono(),lag=Math.max(0,current-lastTick-100);lastTick=current;maxLag=Math.max(maxLag,lag);maxRss=Math.max(maxRss,process.memoryUsage().rss);const cpu=process.cpuUsage(cpu0);maxCpu=Math.max(maxCpu,(cpu.user+cpu.system)/1000);
    if(maxLag>500||maxRss>256*MIB||maxCpu>20000){stop('COMPONENT_FIELD_RESOURCE_STOP',true);controller.abort();}
  };
  const issue=(reason:string,responsibility:'flow'|'protection'='flow')=>{
    if(responsibility==='protection'){const gap={at:now(),reason,blocksCombinedAcceptance:true as const};if(protectionGaps.length<100)protectionGaps.push(gap);record('field-protection-gap',gap);return;}
    if(input.protection)pipeline.gap(reason,now());else stop(reason,true);
  };
  const work=async()=>{
    if(busy||stopReason||openedAt===null)return;if(!informationAdmission(now()))return;busy=true;
    let job:'pricing'|'enrichment'='enrichment';
    try{
      let decision:DispatchDecision|null=null;
      if(input.schedulerPolicy&&input.protection){
        // This is a view of the SAME accounting gate, not another limiter or
        // queue. Inspect a hint without activating it while pacing is blocked.
        for(let refusals=0;refusals<=16;refusals++){
          const at=now(),peek=pipeline.peekHint();
          const gate=input.budget.dispatchWindow();
          const left=peek?peek.deadlineAt-at:0;
          const bound=left>RESEARCH_DISPATCH.postProcessingReserveMs+RESEARCH_DISPATCH.quantumMs?Math.min(RESEARCH_DISPATCH.operationBoundMs,left-RESEARCH_DISPATCH.quantumMs):RESEARCH_DISPATCH.operationBoundMs;
          const view={now:at,readyAt:gate.readyAt,physicalBusy:gate.physicalBusy,nextProtectionAt,otherStartSinceProtection,advanceOutstanding:advanceOutstanding||earlyEvaluations>=5,jobs:peek?[{id:peek.hint.signature,kind:'enrichment' as const,enqueuedAt:peek.hint.receivedAt,eligibleAt:peek.eligibleAt,deadlineAt:peek.deadlineAt,operationBoundMs:bound}]:[]};
          if(proposed){
            const guarded=chooseProtectedResearchWork({...view,lastUsableEvaluationAt,observingSince:openedAt,candidateWindowActive:!candidateSuspended,recoveryActive:false,capacityAvailable:true,startSpacingMs:input.budget.usage().limits.minSpacingMs});
            decision=guarded.decision;
            if(guarded.candidateDisposition==='suspend'&&!candidateSuspended){candidateSuspended=true;const suspension={at,reason:guarded.reason??'COMBINED_WORKLOAD_INFEASIBLE'};candidateSuspensions.push(suspension);record('candidate-observation-suspended',{...suspension,guarded,windowUnusable:true});pipeline.gap('COMPONENT_CANDIDATE_SUSPENDED_FOR_PROTECTION',at);}
          }else decision=chooseResearchWork(view);
          if(decision.kind!=='refuse')break;
          schedulerRefusals++;record('shared-scheduler-refusal',{at,decision,windowUnusable:true});pipeline.refuseHint(decision.job.id,'COMPONENT_ENRICHMENT_DEADLINE_INFEASIBLE',at);
          if(stopReason)return;
          // Reconsider due protection immediately, not16*100ms later.
        }
        if(decision?.kind==='wait'){schedulerWaits++;return;}
        if(!decision||decision.kind==='refuse')return;
        record('shared-scheduler-dispatch',{at:now(),decision,otherStartSinceProtection,advanceOutstanding,nextProtectionAt});
        if(!informationAdmission(now()))return;
      }
      // Absolute2s scheduling has priority over starting another hint. An
      // existing physical request is never preempted or duplicated.
      if(input.protection&&nextProtectionAt!==null&&(decision?.kind==='protection'||!input.schedulerPolicy&&now()>=nextProtectionAt)){
        job='pricing';const requestedAt=now();let skipped=0;
        const advance=decision?.kind==='protection'&&decision.advance;
        if(input.schedulerPolicy&&priceAttempts>=43){stop('COMPONENT_PROTECTION_ATTEMPT_CAP',true);return;}
        while(!advance&&nextProtectionAt+2000<=requestedAt){nextProtectionAt+=2000;skipped++;}
        if(skipped){missedProtectionSchedules+=skipped;issue('COMPONENT_PROTECTION_MISSED_SCHEDULE','protection');}
        const scheduledAt=nextProtectionAt,deadlineAt=proposed&&decision?.kind==='protection'?decision.deadlineAt:scheduledAt+2000;nextProtectionAt+=2000;priceAttempts++;const before=input.budget.calls;
        let q:unknown=null,error:string|null=null;
        try{q=await input.protection.quote(signal,knownConfirmedSlot,requestContext());}catch(e){error=safe(e);}
        if(input.schedulerPolicy){
          otherStartSinceProtection=false;
          if(advance){earlyEvaluations++;advanceOutstanding=true;const starts=input.budget.usage().starts,actualStart=starts.at(-1)??requestedAt;nextProtectionAt=Math.min(nextProtectionAt,actualStart+2000);record('shared-scheduler-early-refresh',{at:now(),coalescedTargetAt:scheduledAt,actualStart,nextProtectionAt,earlyEvaluations,phaseChange:true,exitTimingEquivalent:false});}
        }
        const pricingReturnedAt=now();
        const raw=q&&typeof q==='object'?q as {receivedAt?:unknown;slot?:unknown}:null,sourceAt=typeof raw?.receivedAt==='string'?Date.parse(raw.receivedAt):NaN;
        const regressedSlot=raw!==null&&(!Number.isSafeInteger(raw.slot)||Number(raw.slot)<knownConfirmedSlot);
        if(regressedSlot)error??='COMPONENT_PROTECTION_SLOT_REGRESSION';
        const priced=pipeline.price((raw&&!regressedSlot?q:null) as Parameters<ActivePipeline['price']>[0],pricingReturnedAt),availableAt=now(),late=availableAt>deadlineAt,usable=priced!==null;
        if(proposed&&late&&!candidateSuspended){candidateSuspended=true;const suspension={at:availableAt,reason:'PROPOSED_PROTECTION_COMPLETION_DEADLINE_MISSED'};candidateSuspensions.push(suspension);record('candidate-observation-suspended',{...suspension,deadlineAt,windowUnusable:true});pipeline.gap('COMPONENT_CANDIDATE_SUSPENDED_FOR_PROTECTION',availableAt);}
        const evaluationGapMs=availableAt-(lastEvaluationAt??openedAt);evaluationGapsMs.push(evaluationGapMs);maxEvaluationGapMs=Math.max(maxEvaluationGapMs,evaluationGapMs);lastEvaluationAt=availableAt;
        if(usable){maxUsableEvaluationGapMs=Math.max(maxUsableEvaluationGapMs,availableAt-(lastUsableEvaluationAt??openedAt));lastUsableEvaluationAt=availableAt;if(Number.isSafeInteger(raw?.slot))knownConfirmedSlot=Math.max(knownConfirmedSlot,Number(raw!.slot));}
        else protectionUnavailable++;
        if(late)missedProtectionSchedules++;
        const reason=error??(!usable?'COMPONENT_PROTECTION_QUOTE_UNAVAILABLE':late?'COMPONENT_PROTECTION_LATE_EVALUATION':null);
        const outcome={scheduledAt,requestedAt,availableAt,pricingReturnedAt,decisionAt:priced?.availableAt??null,deadlineAt,startDelayMs:requestedAt-scheduledAt,requests:input.budget.calls-before,quoteAgeAtUseMs:Number.isFinite(sourceAt)?availableAt-sourceAt:null,usable,late,reason};
        protectionOutcomes.push(outcome);record('field-protection-evaluation',outcome);
        if(reason)issue(reason,'protection');
        if(input.rpc.error()||input.budget.usage().haltedReason){stop(input.budget.usage().haltedReason??'COMPONENT_FIELD_RPC_FAILURE',true);controller.abort();}
        return;
      }
      if(enrichmentClosed)return;
      if(input.experimentalStrictStartReservation===true&&input.protection&&nextProtectionAt!==null){
        const usage=input.budget.usage(),physicalStarts=[...usage.baseline.starts,...usage.starts],lastPhysicalStart=physicalStarts.length?Math.max(...physicalStarts):null;
        const earliestPhysicalStart=Math.max(now(),lastPhysicalStart===null?0:lastPhysicalStart+1000);
        // Do not let low-priority work enter the shared pacer's waiting state
        // when its physical start would consume the following holdings slot.
        // nextHint is deliberately left untouched until this reservation fits.
        // The budget remains authoritative for monotonic pacing and ceilings.
        if(earliestPhysicalStart+1000>nextProtectionAt){lowPriorityReservationDeferralChecks++;return;}
      }
      const hint=pipeline.nextHint(now());if(pipeline.hasQualityLoss&&!input.protection){stop('COMPONENT_FIELD_SELECTED_WINDOW_UNUSABLE',true);return;}if(!hint)return;
      if(input.schedulerPolicy&&(decision?.kind!=='job'||decision.job.id!==hint.signature))throw Error('COMPONENT_ENRICHMENT_DISPATCH_IDENTITY');
      if(enrichments>=limits.enrichmentAttempts){pipeline.failHint('COMPONENT_FIELD_ENRICHMENT_CAP',now());enrichmentClosed=true;issue('COMPONENT_FIELD_ENRICHMENT_CAP');return;}
      enrichments++;const requestedAt=now(),before=input.budget.calls;
      if(input.schedulerPolicy){otherStartSinceProtection=true;advanceOutstanding=false;}
      if(!informationAdmission(now())){pipeline.retainHintAfterCutoff(now());return;}
      const context=requestContext(),options={...(decision?.kind==='job'?{latestStartAt:decision.latestStartAt,timeoutMs:Math.min(1000,Math.max(1,decision.job.operationBoundMs-RESEARCH_DISPATCH.postProcessingReserveMs))}:{}),...(context?{latestStartAt:Math.min(context.latestStartAt,decision?.kind==='job'?decision.latestStartAt:context.latestStartAt),admissionOpen:context.admissionOpen}:{})};
      const transaction=await input.rpc.call<unknown>('getTransaction',[hint.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],signal,options),availableAt=now();
      record('confirmed-enrichment',{hint,requestedAt,availableAt,requests:input.budget.calls-before,transaction});
      if(!transaction){pipeline.failHint('COMPONENT_FIELD_CONFIRMED_NULL_NO_RETRY',availableAt);issue('COMPONENT_FIELD_CONFIRMED_NULL_NO_RETRY');return;}
      if(!Number.isSafeInteger((transaction as {slot?:number}).slot)||Number((transaction as {slot?:number}).slot)<input.scope.minSlot){pipeline.failHint('COMPONENT_FIELD_STALE_TRANSACTION_SLOT',availableAt);issue('COMPONENT_FIELD_STALE_TRANSACTION_SLOT');return;}
      transactions[hint.signature]=transaction;hints[hint.signature]={signature:hint.signature,receivedAt:hint.receivedAt,requestedAt,availableAt};
      const mapped=pipeline.completeHint(hint,transaction,availableAt);if(mapped.length)knownConfirmedSlot=Math.max(knownConfirmedSlot,Number((transaction as {slot:number}).slot));
      const validatedAt=now();record('enrichment-validation-completed',{signature:hint.signature,receivedAt:hint.receivedAt,rpcAvailableAt:availableAt,validatedAt,validationMs:validatedAt-availableAt,deadlineAt:hint.receivedAt+5000});if(validatedAt>hint.receivedAt+5000)issue('COMPONENT_ENRICHMENT_VALIDATION_TOO_LATE');
      if(pipeline.hasQualityLoss&&!input.protection)stop('COMPONENT_FIELD_MAPPING_UNUSABLE',true);
    }catch(e){try{if(job==='enrichment'){if(strictCutoff&&!admissionOpen()){informationAdmission(now());pipeline.retainHintAfterCutoff(now());}else pipeline.failHint(safe(e),now());}const fatal=recordingFailed||input.rpc.error()||input.budget.usage().haltedReason;if(fatal)stop(safe(e),true);else issue(safe(e),job==='pricing'?'protection':'flow');}catch{ws?.terminate();stopReason??=safe(e);}}
    finally{busy=false;}
  };
  try{
    await input.budget.operate({transport:'ws-upgrade',method:'upgrade'},async op=>new Promise<void>((resolve,reject)=>{
      const options:WebSocket.ClientOptions={agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:65536,perMessageDeflate:false,followRedirects:false,handshakeTimeout:3000};
      ws=dependencies.makeSocket?.(PUMPAPI_STREAM,options)??new WebSocket(PUMPAPI_STREAM,options);
      let upgradeSettled=false;const settle=(error?:Error)=>{if(upgradeSettled)return;upgradeSettled=true;op.signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve();};
      const cancel=()=>{ws?.terminate();settle(Error('COMPONENT_FIELD_UPGRADE_ABORTED'));};op.signal.addEventListener('abort',cancel,{once:true});
      ws.on('open',()=>{try{
        sampleSocket();if(stopReason)throw Error(stopReason);upgradeObservedBytes=socketBytes;
        // bytesRead at open can include coalesced initial data. Charging the
        // entire observed prefix is conservative, not an exact header count.
        for(let left=upgradeObservedBytes;left>0;){const n=Math.min(left,65536);input.budget.chargeWs(n);left-=n;}
        const rawSocket=(ws as unknown as {_socket?:{prependListener?:(event:string,listener:()=>void)=>void}})._socket;
        if(!rawSocket?.prependListener)throw Error('COMPONENT_FIELD_PREPARSE_COUNTER_REQUIRED');
        rawSocket.prependListener('data',()=>{try{sampleSocket();}catch{try{stop('COMPONENT_FIELD_SOCKET_COUNTER',true);}catch{ws?.terminate();}}});
        openedAt=now();openedMono=mono();if(strictCutoff){logicalCutoffAt=openedAt+cutoffDurationMs;logicalCutoffMono=openedMono+cutoffDurationMs;}nextProtectionAt=openedAt;pipeline.open(openedAt);op.completeResponse();record('field-stream-open',{endpoint:PUMPAPI_STREAM,at:openedAt,upgradeObservedBytes,dataOnly:true,subscriptionMessagesSent:0,profile:input.profile??'legacy',observationMs,observationFromOpen:Boolean(input.schedulerPolicy),logicalCutoffAt,logicalCutoffMonotonicAt:logicalCutoffMono,protectionEveryMs:input.protection?.everyMs??null});settle();
      }catch(e){settle(Error(safe(e)));try{stop(safe(e),true);}catch{ws?.terminate();}}});
      ws.on('message',raw=>{try{
        const receivedAt=now(),b=Array.isArray(raw)?Buffer.concat(raw):typeof raw==='string'?Buffer.from(raw):Buffer.from(raw as ArrayBuffer);frames++;applicationBytes+=b.byteLength;sampleSocket();
        if(strictCutoff&&!admissionOpen()){drainFrames++;drainApplicationBytes+=b.byteLength;if(logicalCutoffAt!==null&&logicalCutoffMono!==null&&(receivedAt>=logicalCutoffAt||mono()>=logicalCutoffMono)){postCutoffFrames++;postCutoffApplicationBytes+=b.byteLength;}if(!stopReason)stop('COMPONENT_FIELD_DURATION_LIMIT');return;}
        if(b.byteLength>65536){stop('COMPONENT_FIELD_OVERSIZE_PAYLOAD',true);return;}
        if(applicationBytes>=limits.applicationStopBytes){stop('COMPONENT_FIELD_APPLICATION_STOP',true);return;}
        if(observationElapsed()>=observationMs){stop('COMPONENT_FIELD_DURATION_LIMIT');return;}
        if(stopReason)return;
        if(!b.includes(mintBytes)&&!b.includes(poolBytes)){irrelevantFrames++;return;}
        parsedFrames++;const payload=JSON.parse(b.toString('utf8'));
        if(!payload||typeof payload!=='object'||Array.isArray(payload)){stop('COMPONENT_FIELD_SELECTED_SHAPE',true);return;}
        const selected=payload.poolId===input.scope.pool||payload.mint===input.scope.mint&&(payload.poolId===undefined||payload.poolId===null);
        if(!selected){irrelevantFrames++;return;}
        record('selected-pumpapi-payload',{receivedAt,payloadUtf8:b.toString('utf8'),sha256:createHash('sha256').update(b).digest('hex')});
        if(proposed&&candidateSuspended){selectedMessagesAfterEnrichmentClosed++;record('selected-event-not-admitted',{receivedAt,reason:'candidate-window-suspended',windowUnusable:true});return;}
        if(enrichmentClosed){selectedMessagesAfterEnrichmentClosed++;return;}
        if(pipeline.observe(payload,receivedAt)==='invalid')issue('COMPONENT_FIELD_SELECTED_INVALID');
      }catch(e){try{stop(safe(e),true);}catch{ws?.terminate();}}});
      ws.on('unexpected-response',(_request,response)=>{const status=response.statusCode;try{const n=response.socket?.bytesRead;if(Number.isSafeInteger(n)&&Number(n)>=0){socketBytes=seenSocketBytes=upgradeObservedBytes=Number(n);for(let left=upgradeObservedBytes;left>0;){const delta=Math.min(left,65536);input.budget.chargeWs(delta);left-=delta;}}}catch{}response.destroy();const reason=status===429?'COMPONENT_HTTP_429':'COMPONENT_FIELD_UPGRADE_REFUSED';settle(Error(reason));try{stop(reason,true);}catch{ws?.terminate();}});
      ws.on('error',()=>{settle(Error('COMPONENT_FIELD_TRANSPORT'));try{stop('COMPONENT_FIELD_TRANSPORT',true);}catch{ws?.terminate();}});
      ws.on('close',()=>{if(closed)return;closed=true;transportSettledAt=now();transportSettledMono=mono();try{sampleSocket();if(!stopReason)stop('COMPONENT_FIELD_UNEXPECTED_CLOSE',true);}catch{stopReason??='COMPONENT_FIELD_SOCKET_COUNTER';}resolveClosed();settle(Error(stopReason??'COMPONENT_FIELD_CLOSED'));});
    }),signal,{timeoutMs:4000});
    lastTick=mono();while(!closed&&!signal.aborted){
      resources();sampleSocket();
      if(input.rpc.error()||input.budget.usage().haltedReason){stop(input.budget.usage().haltedReason??'COMPONENT_FIELD_RPC_FAILURE',true);controller.abort();}
      if(input.schedulerPolicy&&mono()-lastTrafficSampleMono>=1000&&trafficSamples<90){record('field-traffic-sample',{at:now(),socketBytes,applicationBytes,frames,selectedMessages:pipeline.snapshot(now()).selectedMessages});lastTrafficSampleMono=mono();trafficSamples++;}
      if(observationElapsed()>=observationMs||strictCutoff&&!admissionOpen())stop('COMPONENT_FIELD_DURATION_LIMIT');
      if(openedAt!==null&&!stopReason&&now()-lastFeature>=1000){pipeline.tick(now());lastFeature=now();}
      if(!busy&&!stopReason)workPromise=work();
      if(stopReason)break;
      let wait=100;if(input.schedulerPolicy){const at=now(),gate=input.budget.dispatchWindow(),peek=pipeline.peekHint();for(const target of [gate.readyAt,nextProtectionAt,peek?.eligibleAt])if(target!==null&&target!==undefined&&target>at)wait=Math.min(wait,target-at);}
      if(strictCutoff){const context=requestContext();if(context)wait=Math.min(wait,context.remainingObservationMs);}
      await sleep(wait);
    }
  }catch(e){try{stop(safe(e),true);}catch{ws?.terminate();stopReason??=safe(e);}}
  finally{
    if(!stopReason)try{stop(signal.aborted?'COMPONENT_FIELD_ABORTED':'COMPONENT_FIELD_SOURCE_ENDED',true);}catch{ws?.terminate();}
    const shutdownEnd=Math.min(mono()+5000,strictCutoff&&logicalCutoffMono!==null?logicalCutoffMono+5000:(input.schedulerPolicy?openedMono??connectionStartedMono:connectionStartedMono)+observationMs+5000);
    while(busy&&mono()<shutdownEnd&&!input.signal.aborted){if(mono()>shutdownEnd-1000)controller.abort();await sleep(25);}
    if(busy)controller.abort();
    if(!busy&&workPromise)await workPromise;
    if(ws&&!closed)await Promise.race([closedPromise,sleep(Math.max(0,Math.min(600,shutdownEnd-mono())))]);
    if(!closed){try{pipeline.gap('COMPONENT_FIELD_SOCKET_CLOSE_UNCERTAIN',now());}catch{}}
    try{pipeline.close(now(),stopReason??'COMPONENT_FIELD_END');}catch{stopReason??='COMPONENT_FIELD_EVIDENCE_CAP';}
    input.signal.removeEventListener('abort',abort);
  }
  const state=pipeline.snapshot(now());
  const sortedGaps=[...evaluationGapsMs].sort((a,b)=>a-b);
  return {...state,observationCutoff:{enabled:strictCutoff,durationMs:strictCutoff?cutoffDurationMs:null,logicalCutoffAt:logicalCutoffAt as number|null,logicalCutoffMonotonicAt:logicalCutoffMono as number|null,exclusive:true,lastAcceptedInformationAt:state.lastAcceptedInformationAt,lastAcceptedTradeAt:state.lastAcceptedTradeAt,lastAcceptedPriceAt:state.lastAcceptedPriceAt,admittedObservationEndAt:state.observationEndedAt,admissionClosedAt:endedAt,admissionClosedMonotonicAt:stopRequestedMono as number|null,transportStopRequestedAt:transportStopRequestedAt as number|null,transportStopRequestedMonotonicAt:transportStopRequestedMono as number|null,transportSettledAt:transportSettledAt as number|null,transportSettledMonotonicAt:transportSettledMono as number|null,socketBytesAtStop:socketBytesAtStop as number|null,applicationBytesAtStop:applicationBytesAtStop as number|null,socketBytesAfterStop:socketBytesAtStop===null?null:Math.max(0,socketBytes-socketBytesAtStop),applicationBytesAfterStop:applicationBytesAtStop===null?null:Math.max(0,applicationBytes-applicationBytesAtStop),drainFrames,drainApplicationBytes,postCutoffFrames,postCutoffApplicationBytes,transportTimingGuarantee:'Logical data admission is bounded; actual OS/socket closure may occur later and is measured separately.'},profile:input.profile??'legacy',profileLimits:{observationMs,hardSocketBytes:limits.hardSocketBytes,socketStopBytes:limits.socketStopBytes,applicationStopBytes:limits.applicationStopBytes,enrichmentAttempts:limits.enrichmentAttempts,fieldRetainedBytes:limits.retainedBytes,stopOnFirstQualityFailure:forwardProfile},firstQualityFailure:firstQualityFailure as FieldQualityFailure|null,mode:input.protection?input.schedulerPolicy?'COMBINED_FIELD_AND_2S_TARGET_PROTECTION_RESEARCH':'COMBINED_FIELD_AND_FIXED_2S_PROTECTION_RESEARCH':'FIELD_ONLY_RESEARCH',connectionStartedAt,openedAt,endedAt,observationMs,openMs:openedAt===null||endedAt===null?0:endedAt-openedAt,elapsedMs:mono()-connectionStartedMono,stopReason,frames,applicationBytes,socketBytes,broadSocketBytes:Math.max(0,socketBytes-upgradeObservedBytes),upgradeObservedBytes,parsedFrames,irrelevantFrames,enrichments,enrichmentClosed,selectedMessagesAfterEnrichmentClosed,knownConfirmedSlot,retainedBytes,recordingFailed,sharedScheduler:{policy:input.schedulerPolicy??'legacy',schedulerWaits,schedulerRefusals,earlyEvaluations,earlyEvaluationCap:5,totalProtectionCap:43,phaseChangesAreEquivalent:false,acceptedMaximumCompletedEvaluationGapMs:null,proposedTimingStandard:proposed?PROPOSED_RESEARCH_TIMING:null,candidateSuspended,candidateSuspensions,timingContract:{targetPollingMs:2000,quoteAgeAtUseMs:2000,sourceStateAgeMs:30000,enrichmentDelayMs:1000,enrichmentCompletionDeadlineMs:5000,postProcessingReserveMs:200,dispatchQuantumMs:100},completedGapsOverTarget:evaluationGapsMs.filter(n=>n>2000).length,maximumTargetStartMissMs:protectionOutcomes.length?Math.max(0,...protectionOutcomes.map(x=>x.startDelayMs)):null},candidateRpcAdmission:{experimentalStrictStartReservation:input.experimentalStrictStartReservation===true,followingProtectionStartReserveMs:input.experimentalStrictStartReservation===true?1000:null,usesActualAndBaselineStarts:input.experimentalStrictStartReservation===true,hypothesisStatus:'REJECTED_AS_DEFAULT:10ms phase jitter can starve candidates; no live capacity improvement established.',lowPriorityReservationDeferralChecks,deferralCounterMeaning:'Loop admission checks, not dropped trades or distinct rejected candidates.'},resources:{peakRssBytes:maxRss,peakCpuMs:maxCpu,peakEventLoopLagMs:maxLag},physicalSlotUncertain:busy||input.budget.inFlight!==0||Boolean(ws&&!closed),enrichmentTransactions:transactions,enrichmentHints:hints,qualificationEnabled:false,complete60SecondFeatureWindows:0,combinedAcceptance:false,priceAttempts,protection:{everyMs:input.protection?.everyMs??null,attempts:priceAttempts,unavailable:protectionUnavailable,unavailableQuoteFraction:priceAttempts?protectionUnavailable/priceAttempts:null,pricingCacheUnavailableFraction:state.prices.freshCacheFraction===null?null:1-state.prices.freshCacheFraction,missedSchedules:missedProtectionSchedules,maxCompletedEvaluationGapMs:maxEvaluationGapMs,p95CompletedEvaluationGapMs:sortedGaps.length?sortedGaps[Math.ceil(sortedGaps.length*.95)-1]:null,maxUsableEvaluationGapMs,maximumScheduleDelayMs:protectionOutcomes.length?Math.max(...protectionOutcomes.map(r=>r.startDelayMs)):null,gaps:protectionGaps,serviceQuality:input.protection?protectionGaps.length?'UNAVAILABLE_OR_MISSED_DEADLINE':'NO_PROTECTION_GAP_OBSERVED':'NOT_TESTED',outcomes:protectionOutcomes},streamTrafficAccounting:'Full socket bytesRead includes upgrade prefix; upgrade prefix also conservatively charged to RPC-related WS. Broad application/socket traffic is not charged as RPC notifications.',apiDataFeesUsd:'0 documented public/data-only endpoints; infrastructure transfer allocation unverified'};
}
