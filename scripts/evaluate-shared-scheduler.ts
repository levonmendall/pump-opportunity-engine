/** Deterministic scheduling mechanics only. No market replay, provider or account. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {chooseResearchWork,RESEARCH_DISPATCH,type ResearchJob,type DispatchDecision} from '../src/research-dispatch.js';
import {evaluateExit} from '../src/strategy.js';

export type SchedulingPolicy='legacy-unreserved'|'strict-zero-window'|'bounded-deadline-v1';
export type OperationCost={httpMs:number;parseMs:number;sourceReceiptMs?:number;transportReleaseMs?:number;actuationMs?:number;settlementMs?:number};
export type SimulatedJob=ResearchJob&{cost:OperationCost};
export type SchedulerSimulation={name:string;policy:SchedulingPolicy;durationMs:number;jobs:SimulatedJob[];priceCosts:OperationCost[];priorStarts?:number[];timerJitterMs?:number;arrivalJitterMs?:number;wakeMode?:'adaptive-gate'|'fixed-100ms';timeoutBehavior?:'capture-stop'|'scheduler-recovery-only';dynamicDeadlineCap?:boolean;maximumAdvances?:number;maximumProtectionStarts?:number};
type Outcome={id:string;kind:'protection'|ResearchJob['kind'];enqueuedAt:number;eligibleAt:number;deadlineAt:number;logicalDispatchedAt:number|null;physicalStartedAt:number|null;responseCompletedAt:number|null;physicalSettledAt:number|null;parsedAt:number|null;callerTimedOutAt:number|null;operationBoundMs:number;httpTimeoutMs:number;latestStartAt:number|null;scheduledAt:number|null;advance:boolean;status:string;reason:string|null;retainedIfFinancial:boolean;windowUnusable:boolean};
const integer=(x:number)=>Number.isSafeInteger(x)&&x>=0;
const need=(x:unknown,s:string)=>{if(!x)throw Error('SCHEDULER_SIM_'+s);};
const max=(xs:number[])=>xs.length?Math.max(...xs):null;
const p=(xs:number[],q:number)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(xs.length*q)-1)]!:null;
function gateReady(now:number,starts:number[]){
  const minute=starts.filter(t=>t>now-60000),short=starts.filter(t=>t>now-10000);
  return Math.max(now,(starts.at(-1)??-1000)+1000,minute.length>=60?minute[minute.length-60]!+60000:now,short.length>=30?short[short.length-30]!+10000:now);
}

/** Rescheduled HTTP costs are counterfactual. No old pool bytes are assigned
 * new timestamps, and no price path, exit outcome or P&L is inferred. */
export function simulateSharedScheduler(input:SchedulerSimulation){
  need(integer(input.durationMs)&&input.durationMs<=180000&&input.jobs.length<=64&&input.priceCosts.length>0,'BOUNDS');
  const jitter=input.timerJitterMs??0,arrivalJitter=input.arrivalJitterMs??0;need(integer(jitter)&&jitter<=100&&integer(arrivalJitter)&&arrivalJitter<=100,'JITTER');
  const jobs=input.jobs.map(j=>({...j,enqueuedAt:j.enqueuedAt+arrivalJitter,eligibleAt:j.eligibleAt+arrivalJitter,deadlineAt:j.deadlineAt+arrivalJitter}));
  need(new Set(jobs.map(j=>j.id)).size===jobs.length,'DUPLICATE_JOB');
  const outcomes:Outcome[]=[],starts=[...(input.priorStarts??[])].sort((a,b)=>a-b),ownStarts:number[]=[],done=new Set<string>(),waits:Record<string,number>={},decisions:Array<{at:number;kind:string;reason?:string;jobId?:string}>=[];
  let nextProtectionAt=0,other=false,advanceOutstanding=false,advances=0,priceNumber=0,active:{outcome:Outcome;releaseAt:number;physicalSettlementAt:number;successAt:number;timeoutAt:number;usable:boolean}|null=null,haltReason:string|null=null,haltAt:number|null=null,unstartedReservation:Outcome|null=null;
  const maximumAdvances=input.maximumAdvances??5,protectionCap=input.maximumProtectionStarts??43;
  const finish=(at:number)=>{
    if(!active)return;
    const o=active.outcome;
    if(at>=active.timeoutAt&&active.timeoutAt<active.successAt&&o.callerTimedOutAt===null){o.callerTimedOutAt=active.timeoutAt;o.status='timed-out-physical-unsettled';o.reason='HTTP deadline; caller cancellation does not release the physical operation';o.windowUnusable=o.kind!=='protection';if(input.timeoutBehavior!=='scheduler-recovery-only'){haltReason='component-budget-sticky-timeout';haltAt=active.timeoutAt;}}
    if(at>=active.physicalSettlementAt)o.physicalSettledAt=active.physicalSettlementAt;
    if(at<active.releaseAt)return;
    if(o.callerTimedOutAt!==null){o.status='timed-out';o.parsedAt=null;}
    else{o.parsedAt=active.successAt;o.status=active.successAt>o.deadlineAt?'completed-after-deadline':'completed';if(o.status!=='completed'){o.reason='Required completion deadline exceeded';o.windowUnusable=o.kind!=='protection';}}
    active=null;
  };
  const refuse=(j:SimulatedJob,at:number,reason:string)=>{done.add(j.id);outcomes.push({id:j.id,kind:j.kind,enqueuedAt:j.enqueuedAt,eligibleAt:j.eligibleAt,deadlineAt:j.deadlineAt,logicalDispatchedAt:at,physicalStartedAt:null,responseCompletedAt:null,physicalSettledAt:null,parsedAt:null,callerTimedOutAt:null,operationBoundMs:j.operationBoundMs,httpTimeoutMs:0,latestStartAt:null,scheduledAt:null,advance:false,status:'refused',reason,retainedIfFinancial:j.kind==='pending',windowUnusable:j.kind!=='pending'});};
  const nextWake=(now:number)=>{
    const waits=[100];
    if(input.wakeMode!=='fixed-100ms'){
      const ready=gateReady(now,starts);if(ready>now)waits.push(ready-now);if(nextProtectionAt>now)waits.push(nextProtectionAt-now);
      const head=jobs.filter(j=>j.kind==='enrichment'&&j.enqueuedAt<=now&&!done.has(j.id)).sort((a,b)=>a.enqueuedAt-b.enqueuedAt)[0];if(head&&head.eligibleAt>now)waits.push(head.eligibleAt-now);
    }
    // No knowledge of future HTTP completion or future feed arrivals is used.
    return now+Math.max(1,Math.min(...waits))+jitter;
  };
  for(let now=jitter;now<=input.durationMs;now=nextWake(now)){
    finish(now);
    if(haltReason)break;
    const readyAt=gateReady(now,starts),queued=jobs.filter(j=>j.enqueuedAt<=now&&!done.has(j.id)).sort((a,b)=>a.enqueuedAt-b.enqueuedAt),head=queued.find(j=>j.kind==='enrichment');
    // ActivePipeline exposes only its FIFO head through nonmutating peekHint.
    // Equal-time arrivals retain their original recorded order, not ID sorting.
    const eligibleJobs=queued.filter(j=>j.kind!=='enrichment'||j===head),capped=eligibleJobs.map(j=>({...j,operationBoundMs:input.policy==='bounded-deadline-v1'&&input.dynamicDeadlineCap!==false?Math.min(j.operationBoundMs,j.deadlineAt-now-100):j.operationBoundMs}));
    if(!active){const impossible=capped.find(j=>j.eligibleAt<=now&&j.operationBoundMs<=200);if(impossible){refuse(impossible,now,'No time for100ms start reserve plus200ms processing reserve');continue;}}
    let decision:DispatchDecision;
    if(input.policy==='bounded-deadline-v1'){
      decision=chooseResearchWork({now,readyAt,physicalBusy:!!active,nextProtectionAt,otherStartSinceProtection:other,advanceOutstanding:advanceOutstanding||advances>=maximumAdvances,jobs:capped.filter(j=>j.operationBoundMs>0)});
    }else if(active)decision={kind:'wait',until:active.releaseAt,reason:'physical-operation-or-cancellation-unsettled'};
    else if(now>=nextProtectionAt)decision={kind:'protection',scheduledAt:nextProtectionAt,deadlineAt:nextProtectionAt+2000,advance:false};
    else{
      const j=capped.filter(j=>j.eligibleAt<=now).sort((a,b)=>(a.kind==='pending'?0:1)-(b.kind==='pending'?0:1)||a.deadlineAt-b.deadlineAt||a.id.localeCompare(b.id))[0];
      if(!j)decision={kind:'wait',until:nextProtectionAt,reason:'no-eligible-job'};
      else if(now>j.deadlineAt)decision={kind:'refuse',job:j,reason:'Required completion deadline passed; evidence retained'};
      else if(input.policy==='strict-zero-window'&&readyAt+1000>nextProtectionAt)decision={kind:'wait',until:nextProtectionAt,reason:'zero-width-reservation-starvation'};
      else decision={kind:'job',job:j,latestStartAt:j.deadlineAt};
    }
    if(decision.kind==='wait'){waits[decision.reason]=(waits[decision.reason]??0)+1;continue;}
    decisions.push({at:now,kind:decision.kind,...(decision.kind==='refuse'?{reason:decision.reason,jobId:decision.job.id}:decision.kind==='job'?{jobId:decision.job.id}:{})});
    if(decision.kind==='refuse'){refuse(capped.find(j=>j.id===decision.job.id)!,now,decision.reason);continue;}
    let scheduledAt:number|null=null,deadlineAt:number,cost:OperationCost,job:SimulatedJob|undefined,advance=false,latestStartAt:number|null=null,bound:number=RESEARCH_DISPATCH.operationBoundMs;
    if(decision.kind==='protection'){
      if(priceNumber>=protectionCap){haltReason='protection-attempt-cap';haltAt=now;break;}
      scheduledAt=decision.scheduledAt;while(!decision.advance&&scheduledAt+2000<=now)scheduledAt+=2000;
      deadlineAt=scheduledAt+2000;advance=decision.advance;cost=input.priceCosts[priceNumber%input.priceCosts.length]!;priceNumber++;
    }else{job=capped.find(j=>j.id===decision.job.id)!;cost=job.cost;deadlineAt=job.deadlineAt;latestStartAt=decision.latestStartAt;bound=job.operationBoundMs;}
    need([cost.httpMs,cost.parseMs,cost.sourceReceiptMs??0,cost.transportReleaseMs??0,cost.actuationMs??0,cost.settlementMs??cost.httpMs].every(integer)&&(cost.sourceReceiptMs??0)<=cost.parseMs&&(cost.transportReleaseMs??0)<=cost.parseMs,'COST');
    const startedAt=Math.max(readyAt,now+(cost.actuationMs??2)),o:Outcome={id:job?.id??'protection:'+priceNumber,kind:job?.kind??'protection',enqueuedAt:job?.enqueuedAt??scheduledAt!,eligibleAt:job?.eligibleAt??scheduledAt!,deadlineAt,logicalDispatchedAt:now,physicalStartedAt:null,responseCompletedAt:null,physicalSettledAt:null,parsedAt:null,callerTimedOutAt:null,operationBoundMs:bound,httpTimeoutMs:Math.min(1000,Math.max(1,bound-200)),latestStartAt,scheduledAt,advance,status:'waiting-or-running',reason:null,retainedIfFinancial:job?.kind==='pending',windowUnusable:false};outcomes.push(o);
    if(job)done.add(job.id);
    if(input.policy==='bounded-deadline-v1'&&latestStartAt!==null&&startedAt>latestStartAt){o.status='refused';o.reason='Post-persistence actual start exceeded latestStartAt; no physical request; required evidence remains unusable';o.windowUnusable=job?.kind!=='pending';unstartedReservation=o;haltReason='post-persistence-dispatch-expired-preserved-reservation';haltAt=startedAt;break;}
    o.physicalStartedAt=startedAt;o.responseCompletedAt=startedAt+cost.httpMs;starts.push(startedAt);ownStarts.push(startedAt);
    const successAt=o.responseCompletedAt+cost.parseMs,timeoutAt=startedAt+o.httpTimeoutMs,timesOut=cost.httpMs>o.httpTimeoutMs,physicalSettlementAt=timesOut?startedAt+Math.max(cost.settlementMs??cost.httpMs,o.httpTimeoutMs):o.responseCompletedAt+(cost.transportReleaseMs??0),releaseAt=Math.max(physicalSettlementAt,timesOut?0:successAt);
    active={outcome:o,releaseAt,physicalSettlementAt,successAt,timeoutAt:timesOut?timeoutAt:Infinity,usable:!timesOut};
    if(job){other=true;advanceOutstanding=false;}
    else{nextProtectionAt=advance?Math.min(scheduledAt!+2000,startedAt+2000):scheduledAt!+2000;other=false;if(advance){advances++;advanceOutstanding=true;}}
  }
  const effectiveEnd=haltAt??input.durationMs;finish(effectiveEnd);
  const protection=outcomes.filter(o=>o.kind==='protection'),completed=protection.filter(o=>o.status==='completed'&&o.parsedAt!==null),times=completed.map(o=>o.parsedAt!),gaps=times.slice(1).map((t,i)=>t-times[i]!),enrichments=outcomes.filter(o=>o.kind==='enrichment'),unstarted=jobs.filter(j=>!done.has(j.id)&&j.enqueuedAt<=effectiveEnd);
  const referenceTargets=Array.from({length:Math.floor(effectiveEnd/2000)+1},(_,i)=>i*2000).map(at=>({at,nextCompletedAt:times.find(t=>t>=at)??null}));
  const quoteIntervals=completed.map(o=>{const index=protection.indexOf(o),cost=input.priceCosts[index%input.priceCosts.length]!,receivedAt=o.responseCompletedAt!+(cost.sourceReceiptMs??0);return {receivedAt,usedAt:o.parsedAt!,ageAtUseMs:o.parsedAt!-receivedAt};});
  let modeledFreshMs=0;for(let at=0;at<effectiveEnd;at++){const prior=quoteIntervals.findLast(q=>q.usedAt<=at);if(prior&&at-prior.receivedAt<=2000)modeledFreshMs++;}
  const priorAndOwn=[...(input.priorStarts??[]),...ownStarts].sort((a,b)=>a-b),allGaps=priorAndOwn.slice(1).map((t,i)=>t-priorAndOwn[i]!);
  const intervals=outcomes.filter(o=>o.physicalStartedAt!==null).map(o=>({start:o.physicalStartedAt!,end:o.physicalSettledAt??(active?.outcome===o?active.physicalSettlementAt:input.durationMs)})),overlap=max(intervals.map(i=>intervals.filter(j=>j.start<=i.start&&j.end>i.start).length))??0;
  return {name:input.name,policy:input.policy,classification:'DETERMINISTIC_COUNTERFACTUAL_SCHEDULING_NOT_MARKET_PERFORMANCE',durationMs:input.durationMs,executedServiceHorizonMs:effectiveEnd,rightCensoredAfterStopMs:input.durationMs-effectiveEnd,timeoutBehavior:input.timeoutBehavior??'capture-stop',timerJitterMs:jitter,arrivalJitterMs:arrivalJitter,wakeMode:input.wakeMode??'adaptive-gate',operationBoundAssumptionMs:RESEARCH_DISPATCH.operationBoundMs,reservationStartReserveMs:RESEARCH_DISPATCH.reservationReserveMs,dynamicDeadlineCap:input.dynamicDeadlineCap!==false,physicalOperationOverlapMaximum:overlap,minimumStartGapMs:allGaps.length?Math.min(...allGaps):null,maximumRolling60SecondStarts:max(ownStarts.map(t=>priorAndOwn.filter(s=>s>t-60000&&s<=t).length)),maximumRolling10SecondStarts:max(ownStarts.map(t=>priorAndOwn.filter(s=>s>t-10000&&s<=t).length)),requests:ownStarts.length,durablyChargedUnits:ownStarts.length+(unstartedReservation?1:0),unstartedReservedOperation:unstartedReservation?{id:unstartedReservation.id,uncertainResponseReserveBytes:2*1024*1024}:null,requestsByKind:Object.fromEntries(['protection','enrichment','pending','reconnect'].map(k=>[k,outcomes.filter(o=>o.kind===k&&o.physicalStartedAt!==null).length])),earlyProtectionStarts:advances,completedProtectionEvaluations:times.length,maximumCompletedEvaluationGapMs:max(gaps),p95CompletedEvaluationGapMs:p(gaps,.95),completedGapsBeyondTwoSecondReference:gaps.filter(x=>x>2000).length,maximumProtectionStartDelayMs:max(protection.filter(o=>o.physicalStartedAt!==null).map(o=>o.physicalStartedAt!-o.scheduledAt!)),referenceTargetsWithoutFollowingEvaluation:referenceTargets.filter(r=>r.nextCompletedAt===null).length,maximumReferenceTargetToNextEvaluationMs:max(referenceTargets.filter(r=>r.nextCompletedAt!==null).map(r=>r.nextCompletedAt!-r.at)),modeledFreshTransportCacheMs:modeledFreshMs,modeledUnavailableOrStaleTransportCacheMs:effectiveEnd-modeledFreshMs,maximumModeledQuoteAgeAtUseMs:max(quoteIntervals.map(q=>q.ageAtUseMs)),enrichments:{knownInputArrivals:jobs.filter(j=>j.kind==='enrichment').length,submitted:jobs.filter(j=>j.kind==='enrichment'&&j.enqueuedAt<=effectiveEnd).length,completedWithinFiveSeconds:enrichments.filter(o=>o.status==='completed'&&o.parsedAt!<=o.deadlineAt).length,refused:enrichments.filter(o=>o.status==='refused').length,timedOut:enrichments.filter(o=>o.status.startsWith('timed-out')).length,completedLate:enrichments.filter(o=>o.status==='completed-after-deadline').length,pendingAtEnd:unstarted.filter(j=>j.kind==='enrichment').length+(active?.outcome.kind==='enrichment'?1:0),inFlightAtEnd:active?.outcome.kind==='enrichment'?1:0,deadlineCensoredPendingAtEnd:unstarted.filter(j=>j.kind==='enrichment'&&j.deadlineAt>effectiveEnd).length,maximumArrivalToParseMs:max(enrichments.filter(o=>o.parsedAt!==null).map(o=>o.parsedAt!-o.enqueuedAt))},requiredEvidenceLosses:outcomes.filter(o=>o.windowUnusable).length,postProcessingReserveOverruns:outcomes.filter(o=>o.parsedAt!==null&&o.responseCompletedAt!==null&&o.parsedAt-o.responseCompletedAt>200).length,serviceEnvelopeOverruns:outcomes.filter(o=>o.parsedAt!==null&&o.physicalStartedAt!==null&&o.parsedAt-o.physicalStartedAt>o.operationBoundMs).length,unresolvedFinancialActions:outcomes.filter(o=>o.retainedIfFinancial&&o.status!=='completed').length+unstarted.filter(j=>j.kind==='pending').length,unstartedJobsAtEnd:unstarted.map(j=>({id:j.id,kind:j.kind,enqueuedAt:j.enqueuedAt,eligibleAt:j.eligibleAt,deadlineAt:j.deadlineAt,financialActionRetained:j.kind==='pending'})),physicalUnsettledAtEnd:active?{id:active.outcome.id,settlementDueAt:active.releaseAt}:null,haltReason,waitChecks:waits,outcomes,decisions,referenceTargets,assumptions:['All services share60 starts/rolling minute,30/rolling10s,>=1s physical starts and one nonpreemptible physical operation.','HTTP durations, parsing costs and start overhead are sampled from retained measurements or explicitly synthetic scenario inputs. Rescheduling them is counterfactual.','Adaptive wake uses only existing gate readiness, protection target and already queued head eligibility, with at most100ms poll interval plus separately declared synthetic timer jitter.','Admission reserves25ms for durability before the unchanged latest physical-start deadline; an actual larger overhead still stops the capture after reservation and retains uncertainty.','Cache availability is a transport/processing model assuming each fresh response were valid; no old pool state is relabeled fresh or assigned to a new time.','No prices, threshold crossings, fills, profitability, new accepted maximum evaluation gap or production protection guarantee are inferred.','Refused/timed-out selected jobs mark required evidence unusable. Pending financial actions remain explicitly unresolved, never silently erased.',input.timeoutBehavior==='scheduler-recovery-only'?'This is a separate pure-scheduler recovery scenario. Actual ComponentBudget has a sticky timeout halt and cannot resume these capture requests after settlement. No runtime reset, second attempt or approval is implied.':'A physical timeout or post-persistence dispatch expiry stops the modeled capture and retains uncertainty; no automatic retry follows.', 'A reconnect job represents one control/upgrade operation. A full seven-account subscription restoration is not modeled by this combined PumpApi path.'],networkRequests:0,productionChanged:false};
}

export function syntheticPhaseCounterexamples(){
  const evaluate=(checks:number[],dropFrom:number,dropUntil:number)=>checks.map(at=>({at,decision:evaluateExit({now:at,enteredAt:0,entryCostLamports:'10000000',heldBaseUnits:'100',mark:{at,netLamports:at>=dropFrom&&at<dropUntil?'8500000':'10000000',pricedBaseUnits:'100',evidence:'DECLARED_SYNTHETIC_STEP_PATH_ONLY'}})}));
  return [{name:'temporary-drop5.5-to6.5-seconds',dropFrom:5500,dropUntil:6500},{name:'temporary-drop4.8-to5.8-seconds',dropFrom:4800,dropUntil:5800}].map(c=>({...c,classification:'SYNTHETIC_POLICY_PHASE_COUNTEREXAMPLE_NOT_ACTUAL_MARKET',fixed:evaluate([4000,6000,8000],c.dropFrom,c.dropUntil),early:evaluate([4000,5000,7000],c.dropFrom,c.dropUntil),meaning:'Same actual-size net-mark exit rule, different observation times. An early phase can miss a move the fixed phase sees, or vice versa; no fill, P&L or general protection equivalence is implied.'}));
}

const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function evaluateSharedScheduler(){
  const path='evidence/scheduler-correction-20261027/trace-analysis.json',bytes=readFileSync(path),trace=JSON.parse(bytes.toString('utf8')),original=trace.sourcesBefore.map((s:any)=>({path:s.path,sha256:sha(readFileSync(s.path))}));need(original.every((s:any,i:number)=>s.sha256===trace.sourcesBefore[i].sha256),'SOURCE_TRACE_HASH');
  const open=trace.observation.openedAt,duration=trace.observation.openMs,records=readFileSync('evidence/overnight-20261027/11-combined/observations.ndjson','utf8').trim().split('\n').map(s=>JSON.parse(s));
  const cost=(job:any):OperationCost=>{const normalization=job.signature?records.find((r:any)=>r.kind==='research-normalized-trade'&&r.data.executedEvidence.identity.signature===job.signature)??records.find((r:any)=>r.kind==='research-quality-gap'&&r.data.at===job.confirmedOrPricingResultAvailableAt):null;return {httpMs:job.httpBodyElapsedMs,parseMs:Math.max(0,(normalization?.recordedAt??job.confirmedOrPricingResultAvailableAt)-job.physicalResponseBodyAvailableAt),transportReleaseMs:Math.max(0,(job.sourceAccountReceiptAt??job.confirmedOrPricingResultAvailableAt)-job.physicalResponseBodyAvailableAt),sourceReceiptMs:job.sourceAccountReceiptAt===null?0:job.sourceAccountReceiptAt-job.physicalResponseBodyAvailableAt,actuationMs:Math.max(0,job.transportPhysicalRequestStartedAt-job.budgetReservedAt)};};
  const jobs:SimulatedJob[]=trace.allJobs.filter((j:any)=>j.kind==='enrichment').map((j:any)=>({id:j.signature,kind:'enrichment',enqueuedAt:j.providerReceivedAt-open,eligibleAt:j.eligibleAt-open,deadlineAt:j.providerReceivedAt-open+5000,operationBoundMs:RESEARCH_DISPATCH.operationBoundMs,cost:cost(j)}));
  const priceCosts:OperationCost[]=trace.allJobs.filter((j:any)=>j.kind==='pricing').map(cost),book=JSON.parse(readFileSync('evidence/overnight-20261027/11-combined/rpc-budget.json','utf8')),priorStarts=[...book.baseline.starts,...book.actualInvocations.map((x:any)=>x.at)].filter((at:number)=>at<open&&at>open-60000).map((at:number)=>at-open);
  const measuredReference={classification:'ACTUAL_RETAINED_OBSERVATION_UNCHANGED',durationMs:duration,completedEvaluations:trace.observation.completedPricingEvaluations,maximumCompletedGapMs:trace.observation.maximumInterCompletionGapMs,quoteAgeAtUseMs:trace.observation.quoteAgeAtUseMs,staleCacheMs:trace.observation.staleCacheMs,physicalHttpBodyDurationsMs:priceCosts.map(c=>c.httpMs),normalizationHttpDurationsMs:jobs.map(j=>j.cost.httpMs),longestGapArithmetic:trace.longestGap.exactPartitionMs,partitionSumMs:trace.longestGap.partitionSumMs,notCausalProviderLatency:true};
  const simulations:ReturnType<typeof simulateSharedScheduler>[]=[];
  for(const policy of ['legacy-unreserved','strict-zero-window','bounded-deadline-v1'] as const)for(const jitter of [0,10,50,100])simulations.push(simulateSharedScheduler({name:'trace11-'+policy+'-jitter'+jitter,policy,durationMs:duration,jobs,priceCosts,priorStarts,timerJitterMs:jitter}));
  simulations.push(simulateSharedScheduler({name:'trace11-bounded-fixed-wake-negative',policy:'bounded-deadline-v1',durationMs:duration,jobs,priceCosts,priorStarts,wakeMode:'fixed-100ms'}));
  simulations.push(simulateSharedScheduler({name:'trace11-known-arrivals-only-extended-service-horizon',policy:'bounded-deadline-v1',durationMs:75000,jobs,priceCosts,priorStarts}));
  const unitJob=(id:string,at:number,httpMs=80,kind:ResearchJob['kind']='enrichment',deadline=at+5000):SimulatedJob=>({id,kind,enqueuedAt:at,eligibleAt:kind==='enrichment'?at+1000:at,deadlineAt:deadline,operationBoundMs:1200,cost:{httpMs,parseMs:20,actuationMs:2}});
  for(const jitter of [10,50,100])for(const burst of [2,3])simulations.push(simulateSharedScheduler({name:'synthetic-burst'+burst+'-arrival-jitter'+jitter,policy:'bounded-deadline-v1',durationMs:16000,jobs:Array.from({length:burst},(_,i)=>unitJob('burst-'+i,100)),priceCosts:[{httpMs:80,parseMs:20,actuationMs:2}],arrivalJitterMs:jitter}));
  simulations.push(simulateSharedScheduler({name:'synthetic-slow-three',policy:'bounded-deadline-v1',durationMs:18000,jobs:Array.from({length:3},(_,i)=>unitJob('slow-'+i,100,950)),priceCosts:[{httpMs:900,parseMs:180,actuationMs:4}]}));
  const stalled=unitJob('ignored-cancellation',500,1600);stalled.cost.settlementMs=1800;
  simulations.push(simulateSharedScheduler({name:'synthetic-timeout-pending-reconnect',policy:'bounded-deadline-v1',timeoutBehavior:'scheduler-recovery-only',durationMs:18000,jobs:[stalled,unitJob('urgent-pending',2500,80,'pending',5000),unitJob('restore-subscription',6500,80,'reconnect',11000)],priceCosts:[{httpMs:80,parseMs:20,actuationMs:2}]}));
  simulations.push(simulateSharedScheduler({name:'synthetic-two-pending-with-reconnect-burst',policy:'bounded-deadline-v1',durationMs:18000,jobs:[unitJob('initial-candidate',500),unitJob('exit-later',2500,80,'pending',4800),unitJob('exit-earlier',2500,80,'pending',3600),unitJob('restore-once',2500,80,'reconnect',10000),unitJob('burst-a',2500),unitJob('burst-b',2500)],priceCosts:[{httpMs:80,parseMs:20,actuationMs:2}]}));
  simulations.push(simulateSharedScheduler({name:'synthetic-processing-reserve-overrun',policy:'bounded-deadline-v1',durationMs:6000,jobs:[],priceCosts:[{httpMs:990,parseMs:220,transportReleaseMs:5,actuationMs:2}]}));
  const after=original.map((s:any)=>({path:s.path,sha256:sha(readFileSync(s.path))}));need(JSON.stringify(after)===JSON.stringify(original),'ORIGINAL_EVIDENCE_CHANGED');
  return {schemaVersion:1,classification:'OFFLINE_SHARED_SCHEDULER_EVALUATION_NOT_FORWARD_ACCEPTANCE',generatedAt:new Date().toISOString(),sources:original,traceAudit:{path,sha256:sha(bytes)},helperSha256:sha(readFileSync('src/research-dispatch.ts')),scriptSha256:sha(readFileSync(import.meta.filename)),measuredReference,simulations,phaseCounterexamples:syntheticPhaseCounterexamples(),originalInputsUnchanged:true,interpretation:'The actual3.224s gap remains an observation. Counterfactual dispatch models test starvation, deadlines, phase changes, extra reads and explicit failures only. They do not establish market-state equivalence, protection against a new move, free continuous capacity or an accepted completion-gap threshold. The75s service projection has only the original known arrivals, assumes extra post-stop service and does not extend actual feed coverage.',networkRequests:0,productionChanged:false,paperEntriesEnabled:false,acceptanceClockStarted:false};
}
if(resolve(process.argv[1]??'')===import.meta.filename){
  if(process.argv[2]==='--write'){const output=resolve(process.argv[3]??'evidence/scheduler-correction-20261027/scheduler-evaluation.json'),result=evaluateSharedScheduler();mkdirSync(join(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({output,simulations:result.simulations.length,actualLongestGapMs:result.measuredReference.maximumCompletedGapMs,networkRequests:0})+'\n');}
  else process.stdout.write('Offline only. Use --write to create one bounded scheduling evaluation artifact.\n');
}
