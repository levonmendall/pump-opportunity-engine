/** Bounded OFFLINE scheduler workload, not a provider or financial simulator.
 * Response timings and arrivals below are explicit synthetic assumptions.
 * This reuses the actual dispatch/admission policies; it does not claim to run
 * the complete runPilot loop or establish a provider entitlement.
 */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chooseProtectedResearchWork,type ResearchJob} from '../src/research-dispatch.js';
import {pilotLowerPriorityAdmission,pilotDiscretionaryAdmission} from '../src/pilot.js';

type Purpose='protection'|'enrichment'|'audit'|'pending'|'reconnect';
type PendingSpec={at:number;count:number;requestsPerAction?:number;expiryMs?:number};
export type ProgressiveWorkload={name:string;holdings:1|2|3;candidates:1|2|3;durationMs?:number;jitterMs?:number;responseMs?:number;processingMs?:number;tradePeriodMs?:number;tradeBurst?:number;pending?:PendingSpec;reconnectAt?:number;slow?:{at:number;responseMs:number;processingMs?:number}};
type Task={id:string;purpose:Exclude<Purpose,'protection'>;mint:number|null;receivedAt:number;eligibleAt:number;deadlineAt:number;remaining:number;status:'queued'|'complete'|'coverage-lost'|'retained-unresolved';completedAt?:number};
type Physical={purpose:Purpose;taskId:string|null;startedAt:number;bodyAt:number;settledAt:number;availableAt:number;cancelRequestedAt:number|null;timedOut:boolean;quoteAgeAtUseMs:number|null};
const invariant=(v:unknown,s:string)=>{if(!v)throw Error('OFFLINE_PROGRESSIVE_'+s);};
const maxRolling=(starts:readonly number[],span:number)=>Math.max(0,...starts.map(t=>starts.filter(s=>s>t-span&&s<=t).length));

export function replayProgressiveWorkload(spec:ProgressiveWorkload){
 const duration=spec.durationMs??120000,jitter=spec.jitterMs??0,response=spec.responseMs??100,processing=spec.processingMs??10,period=spec.tradePeriodMs??20000,burst=spec.tradeBurst??1;
 invariant(duration>=10000&&duration<=240000&&[1,2,3].includes(spec.holdings)&&[1,2,3].includes(spec.candidates)&&jitter>=0&&jitter<=1000&&period>=1000&&burst>=1&&burst<=16,'BOUNDED_SPEC');
 const tasks:Task[]=[],physical:Physical[]=[],discretionary:number[]=[],starts:number[]=[],transactionStarts:number[]=[],completedGaps:number[]=[],failures:Array<{at:number;reason:string;mint:number|null}>=[],suspensions:Array<{at:number;mint:number;reason:string}>=[],evaluations:Array<{at:number;holdings:number;quoteAgeAtUseMs:number}>=[],windows:Array<{mint:number;endAt:number;availableAt:number}>=[];
 const active=Array.from({length:spec.candidates},()=>true),flowStartedAt=Array.from({length:spec.candidates},()=>0),auditedThrough=Array.from({length:spec.candidates},()=>0),windowSeen=new Set<string>();
 let now=0,lastCompleted:number|null=null,lastRequested=-2000,slowUsed=false,reconnected=false,recoveryUntil=0,iterations=0;
 for(let mint=0;mint<spec.candidates;mint++){
  for(let at=1000+mint*750;at<duration-5000;at+=period)for(let n=0;n<burst;n++)tasks.push({id:`trade-${mint}-${at}-${n}`,purpose:'enrichment',mint,receivedAt:at,eligibleAt:at+1000,deadlineAt:at+5000,remaining:1,status:'queued'});
  // Six independent history calls per candidate-minute, not six per batch.
  for(let at=15000;at<duration-2000;at+=10000)tasks.push({id:`audit-${mint}-${at}`,purpose:'audit',mint,receivedAt:at,eligibleAt:at,deadlineAt:at+10000,remaining:1,status:'queued'});
 }
 if(spec.pending)for(let n=0;n<spec.pending.count;n++)tasks.push({id:`own-action-${n}`,purpose:'pending',mint:null,receivedAt:spec.pending.at,eligibleAt:spec.pending.at,deadlineAt:spec.pending.at+(spec.pending.expiryMs??5000),remaining:spec.pending.requestsPerAction??3,status:'queued'});
 if(spec.reconnectAt!==undefined)tasks.push({id:'planned-reconnect',purpose:'reconnect',mint:null,receivedAt:spec.reconnectAt,eligibleAt:spec.reconnectAt,deadlineAt:spec.reconnectAt+5000,remaining:3,status:'queued'});
 tasks.sort((a,b)=>a.receivedAt-b.receivedAt||a.id.localeCompare(b.id));
 const lose=(mint:number,reason:string,at=now)=>{if(!active[mint])return;active[mint]=false;suspensions.push({at,mint,reason});for(const t of tasks)if(t.mint===mint&&t.status==='queued'&&t.receivedAt<=at)t.status='coverage-lost';};
 const fail=(reason:string,mint:number|null=null,at=now)=>{failures.push({at,reason,mint});if(mint!==null)lose(mint,reason,at);};
 const readyAt=(purpose:Purpose,at:number)=>{
  let ready=Math.max(at,(starts.at(-1)??-250)+250);
  for(;;){let next=ready;const minute=starts.filter(t=>t>ready-60000),short=starts.filter(t=>t>ready-10000);if(minute.length>=60)next=Math.max(next,minute[minute.length-60]!+60000);if(short.length>=20)next=Math.max(next,short[short.length-20]!+10000);
   if(purpose==='enrichment'){const method=transactionStarts.filter(t=>t>ready-10000);if(method.length>=8)next=Math.max(next,method[method.length-8]!+10000);}if(next===ready)return ready;ready=next;}
 };
 const completeWindows=()=>{for(let mint=0;mint<active.length;mint++){if(!active[mint]||now<recoveryUntil)continue;const end=Math.floor(now/10000)*10000,key=mint+':'+end;if(end-flowStartedAt[mint]!<60000||auditedThrough[mint]!<end||windowSeen.has(key))continue;const relevant=tasks.filter(t=>t.mint===mint&&t.purpose==='enrichment'&&t.receivedAt>=end-60000&&t.receivedAt<end);if(relevant.some(t=>t.status!=='complete'||(t.completedAt??Infinity)>now))continue;windowSeen.add(key);windows.push({mint,endAt:end,availableAt:now});}};
 while(now<duration){
  invariant(++iterations<100000,'ITERATION_BOUND');
  if(spec.reconnectAt!==undefined&&!reconnected&&now>=spec.reconnectAt){reconnected=true;recoveryUntil=now+60000;for(let mint=0;mint<active.length;mint++)lose(mint,'planned transport gap; new complete flow window required');}
  for(const t of tasks){if(t.status!=='queued'||t.receivedAt>now)continue;if(t.mint!==null&&!active[t.mint]){t.status='coverage-lost';continue;}if(now>t.deadlineAt){t.status=t.purpose==='pending'?'retained-unresolved':'coverage-lost';fail(t.purpose==='pending'?'owned action deadline missed; financial action retained':'required information deadline missed',t.mint);}}
  completeWindows();
  const arrived=tasks.filter(t=>t.status==='queued'&&t.receivedAt<=now),pending=arrived.filter(t=>t.purpose==='pending').sort((a,b)=>a.deadlineAt-b.deadlineAt)[0],enrichment=arrived.filter(t=>t.purpose==='enrichment').sort((a,b)=>a.deadlineAt-b.deadlineAt)[0],reconnect=arrived.find(t=>t.purpose==='reconnect'),audit=arrived.filter(t=>t.purpose==='audit').sort((a,b)=>a.deadlineAt-b.deadlineAt||a.id.localeCompare(b.id))[0];
  const urgent=pending??enrichment??reconnect;
  const methodReady=enrichment?readyAt('enrichment',now):now;
  if(enrichment&&methodReady+1200>enrichment.deadlineAt){enrichment.status='coverage-lost';fail('required enrichment completion envelope unavailable at current method-ready time',enrichment.mint);continue;}
  const job:ResearchJob|undefined=urgent?{id:urgent.id,kind:urgent.purpose==='pending'?'pending':urgent.purpose==='reconnect'?'reconnect':'enrichment',enqueuedAt:urgent.receivedAt,eligibleAt:Math.max(urgent.eligibleAt,urgent.purpose==='enrichment'?methodReady:now),deadlineAt:urgent.deadlineAt,operationBoundMs:1200}:undefined;
  const dispatch=chooseProtectedResearchWork({now,readyAt:readyAt('protection',now),physicalBusy:false,nextProtectionAt:lastRequested+2000,otherStartSinceProtection:false,jobs:job?[job]:[],lastUsableEvaluationAt:lastCompleted,observingSince:0,candidateWindowActive:active.some(Boolean),recoveryActive:lastCompleted===null||!!reconnect,capacityAvailable:true,startSpacingMs:250});
  let purpose:Purpose|undefined,task:Task|undefined;
  if(dispatch.decision.kind==='protection')purpose='protection';
  else if(dispatch.decision.kind==='job'){task=urgent;purpose=task?.purpose;}
  else if(dispatch.decision.kind==='refuse'&&urgent){urgent.status=urgent.purpose==='pending'?'retained-unresolved':'coverage-lost';fail(dispatch.decision.reason,urgent.mint);continue;}
  else if(audit){const admission=pilotLowerPriorityAdmission({now,endAt:duration+5000,held:spec.holdings,lastUsable:lastCompleted,nextPendingAt:pending?.eligibleAt??null});if(admission.admitted&&pilotDiscretionaryAdmission(discretionary,now).admitted){task=audit;purpose='audit';}}
  if(purpose&&purpose!=='protection'&&purpose!=='pending'){
   const admission=pilotLowerPriorityAdmission({now,endAt:duration+5000,held:spec.holdings,lastUsable:lastCompleted,nextPendingAt:pending?.eligibleAt??null});
   const cap=pilotDiscretionaryAdmission(discretionary,now);if(!admission.admitted||!cap.admitted){now=Math.min(duration,now+25);continue;}
  }
  if(!purpose){const future=tasks.filter(t=>t.status==='queued'&&t.receivedAt>now).map(t=>t.receivedAt);now=Math.min(duration,Math.max(now+1,Math.min(now+25,...future,dispatch.decision.kind==='wait'?dispatch.decision.until:Infinity)));continue;}
  const ready=readyAt(purpose,now);if(ready>now){now=Math.min(duration,ready);continue;}
  // Jitter precedes physical admission; the concrete time is checked again.
  const start=now+jitter;if(start>=duration)break;
  if(readyAt(purpose,start)>start){now=readyAt(purpose,start);continue;}
  if(task&&start+1200>task.deadlineAt){task.status=task.purpose==='pending'?'retained-unresolved':'coverage-lost';fail('request admission cannot fit declared completion bound',task.mint,start);now=start;continue;}
  if(purpose!=='protection'&&purpose!=='pending'&&!pilotLowerPriorityAdmission({now:start,endAt:duration+5000,held:spec.holdings,lastUsable:lastCompleted,nextPendingAt:pending?.eligibleAt??null}).admitted){now=start+1;continue;}
  starts.push(start);if(purpose==='enrichment')transactionStarts.push(start);if(!['protection','pending'].includes(purpose))discretionary.push(start);
  const useSlow=!!spec.slow&&!slowUsed&&start>=spec.slow.at;if(useSlow)slowUsed=true;
  const physicalMs=useSlow?spec.slow!.responseMs:response,parse=useSlow?(spec.slow!.processingMs??processing):processing,bodyAt=start+physicalMs,settledAt=bodyAt,availableAt=bodyAt+parse,timedOut=physicalMs>1000;
  physical.push({purpose,taskId:task?.id??null,startedAt:start,bodyAt,settledAt,availableAt,cancelRequestedAt:timedOut?start+1000:null,timedOut,quoteAgeAtUseMs:purpose==='protection'?parse:null});
  if(purpose==='protection')lastRequested=start;
  now=Math.min(duration,availableAt);
  if(availableAt>duration){fail('physical operation or parsing extends beyond logical cutoff',task?.mint??null,duration);if(task)task.status=task.purpose==='pending'?'retained-unresolved':'coverage-lost';break;}
  if(timedOut){fail('timeout cancellation did not free physical slot before settlement',task?.mint??null);if(task)task.status=task.purpose==='pending'?'retained-unresolved':'coverage-lost';continue;}
  if(purpose==='protection'){
   if(parse>2000){fail('quote stale at actual use after processing overrun');continue;}
   const gap=now-(lastCompleted??0);completedGaps.push(gap);if(gap>4000)fail('research-only completed evaluation boundary exceeded');evaluations.push({at:now,holdings:spec.holdings,quoteAgeAtUseMs:parse});lastCompleted=now;
  }else if(task){if(now>task.deadlineAt){task.status=task.purpose==='pending'?'retained-unresolved':'coverage-lost';fail('validated information arrived beyond usefulness deadline',task.mint);continue;}if(--task.remaining===0){task.status='complete';task.completedAt=now;if(task.purpose==='audit'&&task.mint!==null)auditedThrough[task.mint]=Math.floor((task.receivedAt-5000)/10000)*10000;if(task.purpose==='reconnect'){for(let mint=0;mint<active.length;mint++){active[mint]=true;flowStartedAt[mint]=now;auditedThrough[mint]=now;}recoveryUntil=now+60000;}}}
 }
 // Explicit right-censored tail; lack of a later successful quote is not zero lag.
 const unavailableTail=duration-(lastCompleted??0),maximumGap=Math.max(0,...completedGaps),overdueTail=Math.max(0,unavailableTail-4000);
 for(const t of tasks)if(t.status==='queued'&&t.receivedAt<duration){t.status=t.purpose==='pending'?'retained-unresolved':'coverage-lost';if(t.mint!==null)lose(t.mint,'unresolved information at finite test stop',duration);}
 const byPurpose=Object.fromEntries((['protection','enrichment','audit','pending','reconnect']as const).map(p=>[p,physical.filter(r=>r.purpose===p).length]));
 return {classification:'OFFLINE_SYNTHETIC_SHARED_SCHEDULER_WORKLOAD' as const,spec,assumptions:{targetMs:2000,quoteAgeAtUseMs:2000,sourceAgeLimitMs:30000,sourceAccountDecodingTested:false,unapprovedResearchCompletedGapBoundaryMs:4000,completionBoundMs:1200,startSpacingMs:250,combinedStartsPerMinute:60,combinedStartsPer10s:20,getTransactionStartsPer10s:8,discretionaryStartsPerMinute:20,historyRequestsPerCandidateMinute:6,auditDeadlineMs:10000,auditFailurePolicy:'Conservative model suspends scope after missing a current-bucket audit, rather than claiming unaudited usable coverage.',coherentHoldingsPerProtectionRequest:spec.holdings,completePilotLoopExecuted:false,naturalTradeOrEconomicPerformance:false},actualSimulated:{elapsedMs:duration,requestStarts:starts.length,byPurpose,maximumRollingMinute:maxRolling(starts,60000),maximumRolling10s:maxRolling(starts,10000),maximumGetTransactionRolling10s:maxRolling(transactionStarts,10000),minimumStartSpacingMs:starts.length>1?Math.min(...starts.slice(1).map((t,i)=>t-starts[i]!)):null,maximumCompletedEvaluationGapMs:maximumGap,completedGapsAboveTwoSecondTarget:completedGaps.filter(n=>n>2000).length,completedEvaluationCount:evaluations.length,maximumQuoteAgeAtUseMs:Math.max(0,...evaluations.map(e=>e.quoteAgeAtUseMs)),rightCensoredSinceLastCompletedMs:unavailableTail,overdueTailMs:overdueTail,usableWindows:windows.length,candidatesWithUsableWindows:new Set(windows.map(w=>w.mint)).size,selectedTransactions:tasks.filter(t=>t.purpose==='enrichment').length,enrichedTransactions:tasks.filter(t=>t.purpose==='enrichment'&&t.status==='complete').length,coverageLostTransactions:tasks.filter(t=>t.purpose==='enrichment'&&t.status==='coverage-lost').length,unresolvedOwnedActions:tasks.filter(t=>t.purpose==='pending'&&t.status==='retained-unresolved').length,completeOwnedActions:tasks.filter(t=>t.purpose==='pending'&&t.status==='complete').length},protectionFailed:maximumGap>4000||overdueTail>0||physical.some(p=>p.purpose==='protection'&&(p.timedOut||(p.quoteAgeAtUseMs??0)>2000)),selectedTradeEnrichmentComplete:tasks.filter(t=>t.purpose==='enrichment').every(t=>t.status==='complete'),candidateCoverageComplete:suspensions.length===0&&tasks.filter(t=>t.purpose==='enrichment').every(t=>t.status==='complete')&&new Set(windows.map(w=>w.mint)).size===spec.candidates,failures,suspensions,windows,evaluations,physical,tasks};
}

export const PROGRESSIVE_SYNTHETIC_CASES:readonly ProgressiveWorkload[]=[
 {name:'one-holding-two-shadow-quiet-50ms-jitter',holdings:1,candidates:2,jitterMs:50,tradePeriodMs:30000},
 {name:'three-holdings-one-candidate-100ms-jitter',holdings:3,candidates:1,jitterMs:100,tradePeriodMs:20000},
 {name:'three-holdings-two-candidates-100ms-jitter',holdings:3,candidates:2,jitterMs:100,tradePeriodMs:30000},
 {name:'three-holdings-three-candidates-low-flow',holdings:3,candidates:3,jitterMs:50,tradePeriodMs:60000},
 {name:'three-holdings-three-event-bursts',holdings:3,candidates:2,jitterMs:100,tradePeriodMs:10000,tradeBurst:3},
 {name:'three-holdings-nine-trade-burst',holdings:3,candidates:3,jitterMs:50,tradePeriodMs:60000,tradeBurst:3},
 {name:'nonpreemptible-slow-response',holdings:3,candidates:2,jitterMs:50,slow:{at:20000,responseMs:4500}},
 {name:'processing-overrun-stale-at-use',holdings:3,candidates:2,jitterMs:50,slow:{at:20000,responseMs:100,processingMs:3000}},
 {name:'simultaneous-three-owned-actions',holdings:3,candidates:2,jitterMs:100,pending:{at:20000,count:3,requestsPerAction:3}},
 {name:'simultaneous-three-owned-actions-slow',holdings:3,candidates:2,jitterMs:100,responseMs:900,pending:{at:20000,count:3,requestsPerAction:3}},
 {name:'planned-reconnect-invalidates-fresh-window',holdings:3,candidates:2,jitterMs:50,reconnectAt:30000}
];
if(process.argv[1]&&resolve(process.argv[1])===import.meta.filename){
 const output=process.argv[2];invariant(!!output,'OUTPUT_PATH_REQUIRED');const reports=PROGRESSIVE_SYNTHETIC_CASES.map(replayProgressiveWorkload);writeFileSync(resolve(output!),JSON.stringify({schemaVersion:1,classification:'OFFLINE_SYNTHETIC_ONLY',historicalForwardFailuresUnchanged:true,liveRequests:0,reports},null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(reports.map(r=>({name:r.spec.name,...r.actualSimulated,protectionFailed:r.protectionFailed,candidateCoverageComplete:r.candidateCoverageComplete}))));
}
