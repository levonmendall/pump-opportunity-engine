/** Deterministic OFFLINE monitoring experiment. No transport, ledger or runtime control.
 * Values are actual-size net liquidation inputs supplied by an explicitly labeled
 * oracle. A notification can only dirty a pool; it never becomes a quote.
 */
import {evaluateExit,PROVISIONAL_RULE} from './strategy.js';

export type MonitoringPolicy='fixed-2s'|'fixed-5s'|'fixed-10s'|'hybrid-5s'|'adaptive'|'adaptive-quiet';
export type MonitoringObservation={at:number;availableAt?:number;sourceAt?:number;marketTimeAt?:number;netLamports:string|null};
export type MonitoringPosition={id:string;enteredAt:number;entryCostLamports:string;units:string;observations:MonitoringObservation[]};
export type MonitoringNotification={at:number;positionId?:string;kind:'change'|'disconnect'|'reconnected'|'subscriptions-restored'|'heartbeat'};
export type MonitoringBackgroundJob={at:number;kind:'candidate'|'verification'|'recovery';deadlineAt?:number};
export type MonitoringReplayInput={
  policy:MonitoringPolicy;startAt:number;endAt:number;positions:MonitoringPosition[];
  sourceMode:'dense-synthetic'|'sparse-captured';notifications?:MonitoringNotification[];
  latencyMs?:number;requestLatency?:(at:number,kind:'pricing'|'exit'|'candidate'|'verification'|'recovery',requestIndex:number)=>number;
  failures?:Array<{startAt:number;endAt:number}>;
  backgroundJobs?:MonitoringBackgroundJob[];batchHoldings?:boolean;stopAfterExit?:boolean;
  /** All selected observations already include modeled exit gas exactly once. */
  exitSlippageBps?:number;exitGasLamportsIncluded?:string;failedAttemptCostLamports?:string;initialSubscriptionHealthy?:boolean;
  heartbeatTimeoutMs?:number;maxNonProtectionMs?:number;requestLimitPerMinute?:number;minimumStartGapMs?:number;backgroundStartsPerMinute?:number;
};
type Value={netLamports:string;sourceAt:number;marketTimeAt:number;availableAt:number};
type State={
  input:MonitoringPosition;lastStart:number|null;nextPeriodic:number;dirtyVersion:number;pricedVersion:number;
  lastMark:Value|null;lastFresh:number|null;firstFresh:number|null;lastAny:number|null;lastNet:string|null;
  mode:'normal'|'elevated'|'quiet';elevatedUntil:number;safeChecks:number;lastChangeAt:number;
  order:{decisionAt:number;executeAt:number;expiresAt:number;minReceive:string;reason:string;attempted:boolean}|null;
  exit:{status:'filled'|'failed'|'expired';at:number;netLamports:string|null;attemptGrossLamports?:string|null;minimumGrossReceiveLamports?:string;includedExitGasLamports?:string;reason:string;failedCostLamports:string}|null;
  freshMs:number;maxFreshGap:number;maxAnyGap:number;freshCount:number;unavailable:number;quoteAges:number[];
  evaluations:Array<{at:number;sourceAt:number|null;netLamports:string|null;grossLamports:string|null;action:string;reason:string;actionable:boolean}>;
  modeChanges:Array<{at:number;mode:string;reason:string}>;
};
type Request={at:number;finishAt:number;kind:'pricing'|'exit'|'candidate'|'verification'|'recovery';ids:string[];versions:number[];values:(Value|null)[];failed:boolean;deadlineAt?:number;orderDecisionAt?:number};
const int=(v:number)=>Number.isSafeInteger(v)&&v>=0;
const amount=(v:string)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
function need(v:unknown,reason:string):asserts v {if(!v)throw Error(reason);}
function percentile(values:number[],p:number){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil(a.length*p)-1)]!;}
function basicInterval(policy:MonitoringPolicy){return policy==='fixed-2s'?2000:policy==='fixed-10s'?10000:5000;}

/** Dense mode is an explicitly synthetic piecewise-constant known market. A
 * dense query snapshots that known state at request START and becomes usable at
 * completion. Sparse mode can only expose an ORIGINAL captured quote after its
 * actual availability time; its receipt age is never renewed to a polling time.
 */
function oracle(position:MonitoringPosition,at:number,mode:MonitoringReplayInput['sourceMode']):Value|null{
  let latest:MonitoringObservation|undefined;
  for(const o of position.observations){if(o.at>at)break;if((o.availableAt??o.at)<=at)latest=o;}
  if(!latest||latest.netLamports===null)return null;
  const sourceAt=mode==='dense-synthetic'?at:(latest.sourceAt??latest.at);
  return {netLamports:latest.netLamports,sourceAt,marketTimeAt:mode==='dense-synthetic'?at:(latest.marketTimeAt??latest.sourceAt??latest.at),availableAt:Math.max(at,latest.availableAt??latest.at)};
}

export function runMonitoringReplay(input:MonitoringReplayInput){
  need(['fixed-2s','fixed-5s','fixed-10s','hybrid-5s','adaptive','adaptive-quiet'].includes(input.policy),'MONITORING_POLICY');
  need(int(input.startAt)&&int(input.endAt)&&input.endAt>input.startAt&&input.endAt-input.startAt<=1_800_000,'MONITORING_TIME_BOUND');
  need(input.positions.length>=1&&input.positions.length<=3&&new Set(input.positions.map(p=>p.id)).size===input.positions.length,'MONITORING_POSITION_BOUND');
  const start=input.startAt,end=input.endAt,base=basicInterval(input.policy),triggered=input.policy==='hybrid-5s'||input.policy.startsWith('adaptive'),adaptive=input.policy.startsWith('adaptive');
  const minGap=input.minimumStartGapMs??1000,bgCap=input.backgroundStartsPerMinute??24;
  const timeout=input.heartbeatTimeoutMs??15000,cap=input.requestLimitPerMinute??60,maxLow=input.maxNonProtectionMs??800,slippage=input.exitSlippageBps??500,failedCost=input.failedAttemptCostLamports??'7000',includedExitGas=input.exitGasLamportsIncluded??'7000';
  need(int(minGap)&&minGap>=1000&&minGap<=5000&&int(bgCap)&&bgCap<=60,'MONITORING_PACING');
  need(int(timeout)&&timeout>=1000&&timeout<=60000&&int(cap)&&cap>=1&&cap<=60&&int(maxLow)&&maxLow>=1&&maxLow<=2000&&int(slippage)&&slippage<=1000&&amount(failedCost)&&amount(includedExitGas),'MONITORING_LIMIT');
  for(const p of input.positions){
    need(p.id.length>0&&p.id.length<=128&&int(p.enteredAt)&&p.enteredAt<=start&&amount(p.entryCostLamports)&&BigInt(p.entryCostLamports)>0n&&amount(p.units)&&BigInt(p.units)>0n&&p.observations.length<=50000,'MONITORING_POSITION');
    let prior=-1;for(const o of p.observations){need(int(o.at)&&o.at>=prior&&(o.netLamports===null||amount(o.netLamports))&&int(o.availableAt??o.at)&&int(o.sourceAt??o.at)&&int(o.marketTimeAt??o.at)&&(o.sourceAt??o.at)<=(o.availableAt??o.at),'MONITORING_OBSERVATION');prior=o.at;}
  }
  const notifications=[...(input.notifications??[])].sort((a,b)=>a.at-b.at),jobs=[...(input.backgroundJobs??[])].sort((a,b)=>a.at-b.at),failures=input.failures??[];
  need(notifications.length<=50000&&jobs.length<=20000,'MONITORING_EVENT_BOUND');
  for(const n of notifications)need(int(n.at)&&(!n.positionId||input.positions.some(p=>p.id===n.positionId)),'MONITORING_NOTIFICATION');
  for(const j of jobs)need(int(j.at)&&(j.deadlineAt===undefined||int(j.deadlineAt)&&j.deadlineAt>=j.at),'MONITORING_BACKGROUND');
  for(const f of failures)need(int(f.startAt)&&int(f.endAt)&&f.endAt>=f.startAt,'MONITORING_FAILURE');
  const states:State[]=input.positions.map(p=>({input:p,lastStart:null,nextPeriodic:start,dirtyVersion:0,pricedVersion:0,lastMark:null,lastFresh:null,firstFresh:null,lastAny:null,lastNet:null,mode:'normal',elevatedUntil:0,safeChecks:0,lastChangeAt:start,order:null,exit:null,freshMs:0,maxFreshGap:0,maxAnyGap:0,freshCount:0,unavailable:0,quoteAges:[],evaluations:[],modeChanges:[]}));
  const byId=new Map(states.map(s=>[s.input.id,s])),requests:Array<{at:number;finishAt:number;kind:string;ids:string[];failed:boolean}>=[],healthEvents:Array<{at:number;healthy:boolean;reason:string}>=[];
  const physical:{value:Request|null}={value:null};
  let now=start,previous=start,ni=0,ji=0,healthy=input.initialSubscriptionHealthy??true,socketOpen=healthy,lastHeartbeat=start;
  const restoreNeeded=new Set<string>(healthy?[]:states.map(s=>s.input.id));
  let coalesced=0,notificationsSeen=0,changesSeen=0,maxPhysical=0,rateLimitedMs=0,processingSteps=0,candidateCompleted=0,candidateMissed=0,otherCompleted=0,backgroundHighWater=0,backgroundDropped=0,subscriptionUnavailableMs=0,admissionsClosedMs=0,delayedPricingStarts=0,maximumPricingStartDelayMs=0;
  const queue:MonitoringBackgroundJob[]=[];
  const active=(s:State)=>!(input.stopAfterExit??false)||s.exit?.status!=='filled';
  const setMode=(s:State,mode:State['mode'],reason:string)=>{if(s.mode!==mode){s.mode=mode;s.modeChanges.push({at:now,mode,reason});}};
  const elevate=(s:State,reason:string)=>{if(!adaptive)return;s.elevatedUntil=Math.max(s.elevatedUntil,now+30000);s.safeChecks=0;setMode(s,'elevated',reason);};
  const interval=(s:State)=>triggered&&!healthy?2000:adaptive&&s.mode==='elevated'?2000:input.policy==='adaptive-quiet'&&s.mode==='quiet'?10000:base;
  const due=(s:State)=>{
    if(!active(s))return Infinity;
    const hold=s.input.enteredAt+PROVISIONAL_RULE.maximumHoldingMs;
    const periodic=s.lastStart===null?start:Math.min(s.nextPeriodic,s.lastStart+interval(s));
    const trigger=triggered&&s.dirtyVersion>s.pricedVersion?(s.lastStart===null?start:s.lastStart+2000):Infinity;
    return Math.min(periodic,trigger,s.lastStart===null||s.lastStart<hold?hold:Infinity);
  };
  const recordEval=(s:State,value:Value|null,at:number,failed:boolean,version?:number)=>{
    if(s.lastAny!==null)s.maxAnyGap=Math.max(s.maxAnyGap,at-s.lastAny);s.lastAny=at;
    const fresh=!failed&&value&&at>=value.availableAt&&value.sourceAt<=at&&at-value.sourceAt<=PROVISIONAL_RULE.maximumQuoteAgeMs&&value.marketTimeAt<=at&&at-value.marketTimeAt<=30000?value:null;
    const decision=evaluateExit({now:at,enteredAt:s.input.enteredAt,entryCostLamports:s.input.entryCostLamports,heldBaseUnits:s.input.units,mark:fresh?{at:fresh.sourceAt,netLamports:fresh.netLamports,pricedBaseUnits:s.input.units,evidence:'OFFLINE actual-size net oracle'}:null});
    if(fresh){
      if(version!==undefined)s.pricedVersion=Math.max(s.pricedVersion,version);
      s.freshCount++;s.quoteAges.push(at-fresh.sourceAt);if(s.lastFresh!==null)s.maxFreshGap=Math.max(s.maxFreshGap,at-s.lastFresh);s.lastFresh=at;s.firstFresh??=at;s.lastMark={...fresh,availableAt:at};
      if(s.lastNet!==null&&s.lastNet!==fresh.netLamports)s.lastChangeAt=at;s.lastNet=fresh.netLamports;
      if(adaptive){
        const net=BigInt(fresh.netLamports),cost=BigInt(s.input.entryCostLamports),near=net*10000n<=cost*9000n||net*10000n>=cost*12000n,holdNear=s.input.enteredAt+PROVISIONAL_RULE.maximumHoldingMs-at<=30000;
        if(near||holdNear)elevate(s,holdNear?'maximum-hold-approaching':'fresh-price-near-exit');
        else{
          const safe=net*10000n>cost*9200n&&net*10000n<cost*11500n;s.safeChecks=safe?s.safeChecks+1:0;
          if(s.mode==='elevated'&&now>=s.elevatedUntil&&s.safeChecks>=3&&healthy)setMode(s,'normal','dwell-and-three-fresh-safe-checks');
          if(input.policy==='adaptive-quiet'&&s.mode!=='elevated'&&healthy&&s.safeChecks>=3&&now-s.lastChangeAt>=60000)setMode(s,'quiet','experimental-observed-quiet; sudden-move-risk-remains');
        }
      }
      if(s.pricedVersion>=s.dirtyVersion)restoreNeeded.delete(s.input.id);
    }else{s.unavailable++;s.lastMark=null;}
    s.evaluations.push({at,sourceAt:fresh?.sourceAt??null,netLamports:fresh?.netLamports??null,grossLamports:fresh?(BigInt(fresh.netLamports)+BigInt(includedExitGas)).toString():null,action:decision.action,reason:decision.reason,actionable:decision.action==='request-exit'&&fresh!==null});
    if(decision.action==='request-exit'&&fresh&&!s.order&&!s.exit){s.order={decisionAt:at,executeAt:at+1000,expiresAt:at+5000,minReceive:((BigInt(fresh.netLamports)+BigInt(includedExitGas))*BigInt(10000-slippage)/10000n).toString(),reason:decision.reason,attempted:false};}
  };
  const startRequest=(kind:Request['kind'],selected:State[],deadlineAt?:number)=>{
    const latency=input.requestLatency?.(now,kind,requests.length)??input.latencyMs??200;need(int(latency)&&latency<=60000,'MONITORING_LATENCY');
    const failed=failures.some(f=>now>=f.startAt&&now<f.endAt),finishAt=now+latency;
    const versions=selected.map(s=>s.dirtyVersion),values=selected.map(s=>oracle(s.input,now,input.sourceMode));
    physical.value={at:now,finishAt,kind,ids:selected.map(s=>s.input.id),versions,values,failed,...(deadlineAt===undefined?{}:{deadlineAt})};
    requests.push({at:now,finishAt,kind,ids:[...physical.value.ids],failed});maxPhysical=1;
    if(kind==='pricing')for(const s of selected){const delay=Math.max(0,now-due(s));if(delay>0){delayedPricingStarts++;maximumPricingStartDelayMs=Math.max(maximumPricingStartDelayMs,delay);}s.lastStart=now;s.nextPeriodic=now+interval(s);}
    if(kind==='exit')for(const s of selected)if(s.order){s.order.attempted=true;physical.value.orderDecisionAt=s.order.decisionAt;}
  };
  while(now<=end){
    need(++processingSteps<=100000,'MONITORING_STEP_BOUND');
    const span=now-previous;
    if(span>0){if(!healthy)subscriptionUnavailableMs+=span;if(!healthy||restoreNeeded.size||states.some(s=>active(s)&&(!s.lastMark||previous-s.lastMark.sourceAt>2000)))admissionsClosedMs+=span;for(const s of states)if(active(s)&&s.lastMark){const m=s.lastMark;s.freshMs+=Math.max(0,Math.min(now,m.sourceAt+2000)-Math.max(previous,m.availableAt));}if(!physical.value&&requests.filter(r=>r.at>previous-60000).length>=cap)rateLimitedMs+=span;}
    previous=now;
    while(ni<notifications.length&&notifications[ni]!.at<=now){
      const n=notifications[ni++]!;if(n.at<start)continue;notificationsSeen++;
      if(n.kind==='disconnect'){
        healthy=false;socketOpen=false;for(const s of states)if(active(s))restoreNeeded.add(s.input.id);healthEvents.push({at:now,healthy:false,reason:'disconnect'});for(const s of states){elevate(s,'subscription-disconnected');s.dirtyVersion++;}
      }else if(n.kind==='reconnected'){socketOpen=true;healthy=false;for(const s of states)if(active(s))restoreNeeded.add(s.input.id);healthEvents.push({at:now,healthy:false,reason:'socket-open-subscriptions-not-restored'});}
      else if(n.kind==='subscriptions-restored'){socketOpen=true;healthy=true;for(const s of states)if(active(s))restoreNeeded.add(s.input.id);lastHeartbeat=now;healthEvents.push({at:now,healthy:true,reason:'desired-subscriptions-restored; coherent-refresh-required'});for(const s of states)s.dirtyVersion++;}
      else if(n.kind==='heartbeat'){if(socketOpen)lastHeartbeat=now;}
      else if(n.kind==='change'&&socketOpen&&healthy){lastHeartbeat=now;changesSeen++;for(const s of states.filter(s=>!n.positionId||s.input.id===n.positionId)){if(s.dirtyVersion>s.pricedVersion)coalesced++;s.dirtyVersion++;s.lastChangeAt=now;elevate(s,'relevant-state-change; not-a-price');}}
    }
    if(triggered&&healthy&&now-lastHeartbeat>=timeout){healthy=false;for(const s of states)if(active(s))restoreNeeded.add(s.input.id);healthEvents.push({at:now,healthy:false,reason:'control-heartbeat-stale'});for(const s of states){s.dirtyVersion++;elevate(s,'subscription-stale');}}
    while(ji<jobs.length&&jobs[ji]!.at<=now){const j=jobs[ji++]!;if(j.at<start)continue;if(queue.length>=128){backgroundDropped++;if(j.kind==='candidate')candidateMissed++;}else queue.push(j);backgroundHighWater=Math.max(backgroundHighWater,queue.length);}
    if(physical.value&&physical.value.finishAt<=now){
      const done=physical.value;physical.value=null;
      if(done.kind==='pricing')for(let i=0;i<done.ids.length;i++){
        const s=byId.get(done.ids[i]!)!;recordEval(s,done.values[i]??null,now,done.failed,done.versions[i]);
      }
      else if(done.kind==='exit')for(let i=0;i<done.ids.length;i++){
        const s=byId.get(done.ids[i]!)!,order=s.order!;const value=done.values[i]??null,fresh=!done.failed&&value&&now>=value.availableAt&&now-value.sourceAt<=2000&&value.sourceAt<=now&&value.sourceAt>=order.executeAt&&value.marketTimeAt<=now&&now-value.marketTimeAt<=30000;
        const expired=now>=order.expiresAt,attemptGross=value?(BigInt(value.netLamports)+BigInt(includedExitGas)).toString():null,filled=!expired&&fresh&&attemptGross!==null&&BigInt(attemptGross)>=BigInt(order.minReceive);
        s.exit={status:expired?'expired':filled?'filled':'failed',at:now,netLamports:filled?value.netLamports:null,attemptGrossLamports:attemptGross,minimumGrossReceiveLamports:order.minReceive,includedExitGasLamports:includedExitGas,failedCostLamports:expired||filled?'0':failedCost,reason:expired?'order-expired':filled?'first-modeled-attempt-filled':done.failed?'rpc-unavailable':!fresh?'fresh-size-quote-unavailable':'slippage-constraint-failed'};
      }
      else{if(done.kind==='candidate'){if(done.failed||done.deadlineAt!==undefined&&now>done.deadlineAt)candidateMissed++;else candidateCompleted++;}else if(!done.failed)otherCompleted++;}
    }
    for(const s of states){
      if(adaptive&&active(s)&&s.input.enteredAt+PROVISIONAL_RULE.maximumHoldingMs-now<=30000)elevate(s,'maximum-hold-approaching');
      if(s.order&&!s.order.attempted&&!s.exit&&now>=s.order.expiresAt)s.exit={status:'expired',at:now,netLamports:null,reason:'no-permitted-attempt-before-expiry',failedCostLamports:'0'};
    }
    for(let i=queue.length-1;i>=0;i--)if(queue[i]!.deadlineAt!==undefined&&now>queue[i]!.deadlineAt!){if(queue[i]!.kind==='candidate')candidateMissed++;queue.splice(i,1);}
    const starts=requests.filter(r=>r.at>now-60000).length;
    if(!physical.value&&now<end&&starts<cap&&(!requests.length||now-requests.at(-1)!.at>=minGap)){
      const exits=states.filter(s=>s.order&&!s.order.attempted&&!s.exit&&now>=s.order.executeAt&&now<s.order.expiresAt);
      if(exits.length)startRequest('exit',[exits.sort((a,b)=>a.order!.executeAt-b.order!.executeAt)[0]!]);
      else{
        const eligible=states.filter(s=>active(s)&&due(s)<=now).sort((a,b)=>due(a)-due(b));
        if(eligible.length)startRequest('pricing',input.batchHoldings===false?[eligible[0]!]:states.filter(active));
        else if(queue.length&&requests.filter(r=>r.at>now-60000&&r.kind!=='pricing'&&r.kind!=='exit').length<bgCap){
          const nextProtection=Math.min(...states.filter(active).map(due));
          // A long real completion still retains physical occupancy; this test
          // must expose the resulting missed protection deadline, not overlap.
          if(now+maxLow+100<=nextProtection){const j=queue.shift()!;startRequest(j.kind,[],j.deadlineAt);}
        }
      }
    }
    if(now===end)break;
    const upcoming=[end,now+100,physical.value?.finishAt??Infinity,...(requests.length?[requests.at(-1)!.at+minGap]:[]),notifications[ni]?.at??Infinity,jobs[ji]?.at??Infinity];
    for(const s of states){const d=due(s);if(d>now)upcoming.push(d);if(s.order&&!s.order.attempted&&!s.exit){if(s.order.executeAt>now)upcoming.push(s.order.executeAt);if(s.order.expiresAt>now)upcoming.push(s.order.expiresAt);}}
    const next=Math.min(...upcoming.filter(t=>t>now));need(Number.isFinite(next)&&next>now,'MONITORING_CLOCK_PROGRESS');now=next;
  }
  const duration=end-start;
  const outputs=states.map(s=>{
    const firstAction=s.evaluations.find(e=>e.actionable)??null;
    const activeEnd=(input.stopAfterExit??false)&&s.exit?.status==='filled'?s.exit.at:end,positionDuration=Math.max(1,activeEnd-start);
    const episodes:Array<{kind:'stop'|'take-profit';observableAt:number;endsAt:number;crossingTime:'exact-synthetic'|'bounded-by-sparse-observations';crossingAfter:number|null;recognitionAt:number|null;recognitionDelayMs:number|null;missed:boolean}>=[];
    let current:typeof episodes[number]|null=null,previousObservation:number|null=null;
    for(const o of s.input.observations.filter(o=>o.at<=activeEnd)){
      if(o.netLamports===null)continue;const visible=o.availableAt??o.at;if(visible>activeEnd)continue;
      const v=BigInt(o.netLamports),cost=BigInt(s.input.entryCostLamports),kind=v*10000n<=cost*8500n?'stop':v*10000n>=cost*13000n?'take-profit':null;
      if(current&&kind!==current.kind){current.endsAt=Math.max(start,visible);episodes.push(current);current=null;}
      if(kind&&!current)current={kind,observableAt:Math.max(start,visible),endsAt:activeEnd,crossingTime:input.sourceMode==='dense-synthetic'?'exact-synthetic':'bounded-by-sparse-observations',crossingAfter:input.sourceMode==='dense-synthetic'?visible:previousObservation,recognitionAt:null,recognitionDelayMs:null,missed:false};
      previousObservation=visible;
    }
    if(current)episodes.push(current);
    for(const e of episodes){const recognized=s.evaluations.find(v=>v.actionable&&v.at>=e.observableAt&&v.at<e.endsAt&&v.reason.includes(e.kind==='stop'?'stop':'take-profit'));e.recognitionAt=recognized?.at??null;e.recognitionDelayMs=recognized?recognized.at-e.observableAt:null;e.missed=!recognized;}
    const tail=s.lastFresh===null?positionDuration:activeEnd-s.lastFresh,head=s.firstFresh===null?positionDuration:s.firstFresh-start,maxBlind=Math.max(s.maxFreshGap,tail,head),freshMs=Math.min(positionDuration,s.freshMs);
    const changes:Array<{observableAt:number;nextFreshEvaluationAt:number|null;nextEvaluationDelayMs:number|null;exactChangedValueObserved:boolean}>=[];let priorNet:string|null=null;
    for(const o of s.input.observations){const visible=o.availableAt??o.at;if(visible<start||visible>activeEnd||o.netLamports===null)continue;if(priorNet!==null&&priorNet!==o.netLamports){const next=s.evaluations.find(e=>e.netLamports!==null&&e.sourceAt!==null&&e.sourceAt>=visible);changes.push({observableAt:visible,nextFreshEvaluationAt:next?.at??null,nextEvaluationDelayMs:next?next.at-visible:null,exactChangedValueObserved:next?.netLamports===o.netLamports});}priorNet=o.netLamports;}
    const changeDelays=changes.flatMap(c=>c.nextEvaluationDelayMs===null?[]:[c.nextEvaluationDelayMs]);
    const finalMark=s.lastMark&&end-s.lastMark.sourceAt<=2000?s.lastMark:null;
    const failedDebit=BigInt(s.exit?.failedCostLamports??'0');
    const holdIntent=s.input.enteredAt+PROVISIONAL_RULE.maximumHoldingMs;
    const maxHoldAction=s.evaluations.find(e=>e.actionable&&e.reason.includes('maximum-holding-time'));
    return {id:s.input.id,maximumHoldIntentAt:holdIntent<=activeEnd?Math.max(start,holdIntent):null,maximumHoldActionableDelayMs:maxHoldAction?maxHoldAction.at-Math.max(start,holdIntent):null,latestFreshEvaluationAt:s.lastFresh,latestFreshNetLamports:s.evaluations.findLast(e=>e.netLamports!==null)?.netLamports??null,markedPnlAtEndLamports:finalMark?(BigInt(finalMark.netLamports)-BigInt(s.input.entryCostLamports)-failedDebit).toString():null,endMarkFresh:finalMark!==null,failedExecutionCostLamports:failedDebit.toString(),activeEndAt:activeEnd,positionDurationMs:positionDuration,observablePriceChanges:changes,priceChangeNextEvaluationDelayMs:{samples:changeDelays.length,p50:percentile(changeDelays,.5),p95:percentile(changeDelays,.95),maximum:changeDelays.length?Math.max(...changeDelays):null},entryCostLamports:s.input.entryCostLamports,units:s.input.units,evaluations:s.evaluations,freshEvaluations:s.freshCount,unavailableEvaluations:s.unavailable,firstActionableExit:firstAction,exit:s.exit,modeledPnlLamports:s.exit?.status==='filled'?(BigInt(s.exit.netLamports!)-BigInt(s.input.entryCostLamports)).toString():null,unresolvedPosition:s.exit?.status!=='filled',maximumFreshEvaluationGapMs:s.maxFreshGap,maximumAnyEvaluationGapMs:s.maxAnyGap,maximumBlindIntervalIncludingEdgesMs:maxBlind,quoteAgeAtUseMs:{p50:percentile(s.quoteAges,.5),p95:percentile(s.quoteAges,.95),maximum:s.quoteAges.length?Math.max(...s.quoteAges):null},freshQuoteCacheMs:freshMs,unavailableOrStaleQuoteCacheMs:positionDuration-freshMs,unavailableOrStaleQuoteCacheFraction:(positionDuration-freshMs)/positionDuration,staleQuoteUsedForAction:0,thresholdEpisodes:episodes,missedThresholdEpisodes:episodes.filter(e=>e.missed).length,recognitionDelayMs:{p50:percentile(episodes.flatMap(e=>e.recognitionDelayMs===null?[]:[e.recognitionDelayMs]),.5),p95:percentile(episodes.flatMap(e=>e.recognitionDelayMs===null?[]:[e.recognitionDelayMs]),.95),maximum:episodes.some(e=>e.recognitionDelayMs!==null)?Math.max(...episodes.flatMap(e=>e.recognitionDelayMs===null?[]:[e.recognitionDelayMs])):null},modeChanges:s.modeChanges};
  });
  const counts=Object.fromEntries(['pricing','exit','candidate','verification','recovery'].map(k=>[k,requests.filter(r=>r.kind===k).length]));
  return {classification:'OFFLINE_MONITORING_REPLAY_NO_FINANCIAL_ACCOUNT',policy:input.policy,sourceMode:input.sourceMode,startAt:start,endAt:end,durationMs:duration,positions:outputs,requests,requestsByKind:counts,totalRequests:requests.length,requestsPerPositionHour:requests.length/(outputs.reduce((n,p)=>n+p.positionDurationMs,0)/3600000),minimumObservedStartGapMs:requests.length>1?Math.min(...requests.slice(1).map((r,i)=>r.at-requests[i]!.at)):null,maximumStartsPerTenSeconds:requests.length?Math.max(...requests.map(r=>requests.filter(x=>x.at>r.at-10000&&x.at<=r.at).length)):0,delayedPricingStarts,maximumPricingStartDelayMs,pendingPhysicalAtEnd:physical.value?{kind:physical.value.kind,startedAt:physical.value.at,finishAt:physical.value.finishAt}:null,maximumRollingMinuteStarts:requests.length?Math.max(...requests.map(r=>requests.filter(x=>x.at>r.at-60000&&x.at<=r.at).length)):0,rateLimitedMs,physicalRequestsInFlightMaximum:maxPhysical,background:{dropped:backgroundDropped,admissionCapPerMinute:bgCap,submitted:jobs.filter(j=>j.at>=start&&j.at<end).length,candidateCompleted,candidateMissed,otherCompleted,pending:queue.length,highWater:backgroundHighWater},notifications:{received:notificationsSeen,relevantChanges:changesSeen,coalescedChanges:coalesced,healthyAtEnd:healthy,coherentRestorePending:restoreNeeded.size>0,restorePoolsPending:[...restoreNeeded],subscriptionUnavailableMs,admissionsClosedMs,healthEvents},processingSteps,assumptions:{rpcLimitPerMinute:cap,minimumStartGapMs:minGap,triggerMinimumStartSpacingMs:2000,normalIntervalMs:base,elevatedIntervalMs:2000,maximumQuoteAgeAtUseMs:2000,maximumSourceAgeMs:30000,quoteSource:'actual-size net liquidation oracle; notification supplies no price',successfulExitGas:'already included exactly once in supplied net liquidation; no second debit',includedExitGasLamports:includedExitGas,slippageConstraint:'gross SDK output (supplied net plus included gas), matching Trader.reserveExit; liquidation/PnL remain net',failedAttemptCostLamports:failedCost,exitDelayMs:1000,exitExpiryMs:5000,exitSlippageBps:slippage,oneAttemptOnly:true,syntheticDenseSnapshotAt:'RPC start',sparseAvailability:'original captured source/availability time; no new state is invented',counterfactualMonitoringAfterExit:!(input.stopAfterExit??false)},networkRequests:0,productionChanged:false,entriesEnabled:false,liveTrading:false};
}
