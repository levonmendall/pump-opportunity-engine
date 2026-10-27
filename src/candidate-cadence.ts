/** Offline candidate-calculation scheduling. Every observation still reaches
 * the unchanged FlowWindow; a calculation tick never stands in for collection.
 * No network, price lookup, financial writer, or entry-enable operation exists.
 */
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {FlowWindow,PROVISIONAL_RULE,evaluatePrimary,type EventIdentity,type FlowFeatures,type NormalizedTrade,type RuleContext} from './strategy.js';

export type CandidateCadenceMs=1000|10000;
export class CandidateCadence {
  private readonly window:FlowWindow;
  private nextAt:number;
  private informationAt:number;
  private latest:FlowFeatures|null=null;
  private invalidated=false;
  private dirty=false;
  private calculations=0;
  private contextCalculations=0;
  private lateTicks=0;
  private skippedTicks=0;
  private maxLatenessMs=0;
  private observations=0;
  private readonly outcomes={accepted:0,duplicate:0,confirmed:0,invalidated:0,gaps:0,reversals:0};
  constructor(readonly mint:string,readonly observingFrom:number,readonly cadenceMs:CandidateCadenceMs){
    if(cadenceMs!==1000&&cadenceMs!==10000)throw Error('CANDIDATE_RESEARCH_CADENCE');
    this.window=new FlowWindow(mint,observingFrom);this.informationAt=observingFrom;
    this.nextAt=(Math.floor(observingFrom/cadenceMs)+1)*cadenceMs;
  }
  private clock(at:number){if(!Number.isSafeInteger(at)||at<this.informationAt)throw Error('CANDIDATE_INFORMATION_TIME_REGRESSION');this.informationAt=at;}
  ingest(trade:NormalizedTrade){
    this.clock(trade.receivedAt);this.observations++;this.dirty=true;
    const result=this.window.ingest(trade);this.outcomes[result]++;
    if(result==='invalidated')this.invalidated=true;
    return result;
  }
  gap(at:number){this.clock(at);this.window.invalidate(at,'feed-gap');this.outcomes.gaps++;this.invalidated=true;this.dirty=true;}
  reverse(identity:EventIdentity,at:number){this.clock(at);this.window.reverse(identity,at);this.outcomes.reversals++;this.invalidated=true;this.dirty=true;}
  private compute(at:number){
    this.latest=this.window.features(at);this.calculations++;this.invalidated=false;this.dirty=false;
    return structuredClone(this.latest);
  }
  /** Late calls calculate once at actual availability time, never manufacture
   * historical calculations or relabel an old feature snapshot with a new asOf.
   */
  calculate(at:number):FlowFeatures|null{
    this.clock(at);if(at<this.nextAt)return null;
    const late=at-this.nextAt;if(late){this.lateTicks++;this.maxLatenessMs=Math.max(this.maxLatenessMs,late);this.skippedTicks+=Math.floor(late/this.cadenceMs);}
    const result=this.compute(at);
    this.nextAt=(Math.floor(at/this.cadenceMs)+1)*this.cadenceMs;
    return result;
  }
  /** Independently changing age/risk/quote context can justify an on-demand
   * calculation. This never relabels an old snapshot, fetches a quote or clears
   * quality warming, and does not postpone the next completed-bin calculation.
   */
  calculateForContext(at:number,reason:'risk-state'|'quote-availability'|'migration-age'){
    this.clock(at);if(!['risk-state','quote-availability','migration-age'].includes(reason))throw Error('CANDIDATE_CONTEXT_REASON');
    if(this.latest?.asOf===at&&!this.dirty&&!this.invalidated)return structuredClone(this.latest);
    this.contextCalculations++;return this.compute(at);
  }
  status(){return {cadenceMs:this.cadenceMs,nextCalculationAt:this.nextAt,observations:this.observations,calculations:this.calculations,contextCalculations:this.contextCalculations,outcomes:{...this.outcomes},lastCalculatedAt:this.latest?.asOf??null,invalidatedSinceCalculation:this.invalidated,unscoredObservations:this.dirty,qualityBlocked:this.invalidated||this.latest?.sufficientlyObserved!==true,lateTicks:this.lateTicks,skippedTicks:this.skippedTicks,maxLatenessMs:this.maxLatenessMs,retention:this.window.usage(),rpcRequests:0,entriesEnabled:false};}
  snapshot(){return this.latest?structuredClone(this.latest):null;}
}

type Action={at:number;candidate:number;kind:'trade';trade:NormalizedTrade}|{at:number;candidate:number;kind:'gap'}|{at:number;candidate:number;kind:'reverse';identity:EventIdentity};
const START=36_000_000;
function fixtureTrade(candidate:number,index:number):NormalizedTrade{
  const buy=index%7!==6;
  return {identity:{signature:`SYNTHETIC-c${candidate}-tx${index}`,instructionIndex:index%3,eventIndex:index%2},mint:`SYNTHETIC-candidate-${candidate}`,wallet:`SYNTHETIC-buyer-${index%17}`,side:buy?'buy':'sell',quoteLamports:buy?'200000000':'50000000',tokenUnits:buy?'200000':'50000',receivedAt:START+index*1000+500,commitment:index%6===0?'processed':'confirmed',slot:10000+index};
}
export function syntheticCandidateActions(candidates=12,durationMs=600_000):Action[]{
  if(!Number.isSafeInteger(candidates)||candidates<1||candidates>12||!Number.isSafeInteger(durationMs)||durationMs<70_000||durationMs>600_000)throw Error('CANDIDATE_FIXTURE_BOUNDS');
  const actions:Action[]=[];
  for(let c=0;c<candidates;c++){
    for(let i=0;START+i*1000+500<START+durationMs;i++){
      const trade=fixtureTrade(c,i);actions.push({at:trade.receivedAt,candidate:c,kind:'trade',trade});
      if(i%11===0)actions.push({at:trade.receivedAt+20,candidate:c,kind:'trade',trade:{...trade,receivedAt:trade.receivedAt+20}});
      if(trade.commitment==='processed'){
        const at=i===0?START+61_200:trade.receivedAt+200;
        if(at<START+durationMs)actions.push({at,candidate:c,kind:'trade',trade:{...trade,receivedAt:at,commitment:'confirmed'}});
      }
    }
    if(durationMs>90_550){const original=fixtureTrade(c,80),at=START+90_550;actions.push({at,candidate:c,kind:'trade',trade:{...original,receivedAt:at,quoteLamports:'200000001'}});}
    if(durationMs>180_001)actions.push({at:START+180_001,candidate:c,kind:'gap'});
    if(durationMs>300_123)actions.push({at:START+300_123,candidate:c,kind:'reverse',identity:fixtureTrade(c,290).identity});
  }
  return actions.sort((a,b)=>a.at-b.at||a.candidate-b.candidate);
}
function syntheticContext(mint:string,at:number,allowed=true):RuleContext{
  return {mint,now:at,migrationAt:START-300_000,migrationVerified:true,supportedPool:true,flowFieldsVerified:true,flowVerificationEvidence:'SYNTHETIC verified contract solely for deterministic feature comparison',riskEntriesAllowed:allowed,alreadyTradedMint:false,quote:{mint,at,evidence:'SYNTHETIC same-time actual-size placeholder; no RPC or fill',allInInitialCostMicroUsd:'50000000',sizeToEffectiveLiquidityBps:200,expectedBaseUnits:'100000'}};
}
function runSynthetic(actions:Action[],candidates:number,durationMs:number,cadenceMs:CandidateCadenceMs){
  const began=performance.now(),cpu=process.cpuUsage(),windows=Array.from({length:candidates},(_,i)=>new CandidateCadence(`SYNTHETIC-candidate-${i}`,START,cadenceMs));
  const common=new Map<string,FlowFeatures>(),firstQualified:Array<number|null>=Array.from({length:candidates},()=>null),transitions:Array<{candidate:number;at:number;qualified:boolean;reason:string}>=[];
  const last:Array<boolean|null>=Array.from({length:candidates},()=>null);let next=0;
  for(let at=START+1000;at<=START+durationMs;at+=1000){
    while(next<actions.length&&actions[next]!.at<=at){const action=actions[next++]!,window=windows[action.candidate]!;if(action.kind==='trade')window.ingest(action.trade);else if(action.kind==='gap')window.gap(action.at);else window.reverse(action.identity,action.at);}
    for(let i=0;i<candidates;i++){
      const features=windows[i]!.calculate(at);if(!features)continue;
      if(at%10_000===0)common.set(`${i}:${at}`,features);
      const decision=evaluatePrimary(features,syntheticContext(features.mint,at));
      if(decision.qualified&&firstQualified[i]===null)firstQualified[i]=at;
      if(last[i]!==decision.qualified){transitions.push({candidate:i,at,qualified:decision.qualified,reason:decision.reason});last[i]=decision.qualified;}
    }
  }
  const elapsed=process.cpuUsage(cpu);
  return {common,firstQualified,transitions,status:windows.map(w=>w.status()),wallMs:performance.now()-began,cpuMs:(elapsed.user+elapsed.system)/1000};
}
export function candidateExternalContextExamples(){
  const run=(cadenceMs:CandidateCadenceMs,continuous:boolean)=>{
    const window=new CandidateCadence('SYNTHETIC-candidate-0',START,cadenceMs);let first:number|null=null;
    const events=continuous?Array.from({length:90},(_,i)=>fixtureTrade(0,i)):Array.from({length:6},(_,i)=>({...fixtureTrade(0,i),identity:{signature:`SYNTHETIC-quiet-${i}`,instructionIndex:0,eventIndex:0},wallet:`SYNTHETIC-quiet-buyer-${i}`,side:'buy' as const,quoteLamports:'300000000',tokenUnits:'300000',commitment:'confirmed' as const,receivedAt:START+i*10000+100}));
    let index=0;
    for(let at=START+1000;at<=START+90000;at+=1000){
      while(index<events.length&&events[index]!.receivedAt<=at)window.ingest(events[index++]!);
      const f=window.calculate(at);if(f&&evaluatePrimary(f,syntheticContext(f.mint,at,at>=START+75001)).qualified)first??=at;
    }
    return first;
  };
  const frequentContinuing=run(1000,true),boundaryContinuing=run(10000,true);
  const contextual=new CandidateCadence('SYNTHETIC-candidate-0',START,10000);
  for(let i=0;i<6;i++)contextual.ingest({...fixtureTrade(0,i),identity:{signature:`SYNTHETIC-context-${i}`,instructionIndex:0,eventIndex:0},wallet:`SYNTHETIC-context-buyer-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:'300000',commitment:'confirmed',receivedAt:START+i*10000+100});
  contextual.calculate(START+70000);const onContext=contextual.calculateForContext(START+75001,'risk-state');
  const contextQualified=evaluatePrimary(onContext,syntheticContext(onContext.mint,onContext.asOf)).qualified;
  return {classification:'SYNTHETIC_EXTERNAL_CONTEXT_COUNTEREXAMPLES_NOT_MARKET_PERFORMANCE',riskResumeAvailableAt:START+75001,continuingFlow:{oneSecondFirstQualifiedAt:frequentContinuing,tenSecondFirstQualifiedAt:boundaryContinuing,additionalDelayMs:frequentContinuing!==null&&boundaryContinuing!==null?boundaryContinuing-frequentContinuing:null},expiringBuyerBins:{oneSecondFirstQualifiedAt:run(1000,false),tenSecondFirstQualifiedAt:run(10000,false),boundaryPlusExplicitContextQualifiedAt:contextQualified?onContext.asOf:null,contextRecalculationCount:contextual.status().contextCalculations,explanation:'Five initial buyer bins qualify after risk resume at76s; one expires at80s. Boundary-only calculation can miss that short-lived qualification when external context changes between boundaries. An explicit context calculation at actual availability75.001s retains the next80s boundary and catches this fixture.'},implication:'Boundary feature equality does not authorize postponing risk/data invalidations or prove all opportunity timings equivalent. Event-driven reevaluation on independently changing context uses fresh features and quote context; it adds explicitly counted calculation work, not RPC savings.'};
}
/** Repeatable trace generation and exact common-boundary comparison. CPU is
 * measured on this Cloud process; simulated elapsed time is never wall time.
 */
export function evaluateCandidateCadence(candidates=12,durationMs=600_000){
  const actions=syntheticCandidateActions(candidates,durationMs),frequent=runSynthetic(actions,candidates,durationMs,1000),boundary=runSynthetic(actions,candidates,durationMs,10000);
  const mismatches:Array<{key:string}>=[];
  for(const [key,features] of frequent.common)if(JSON.stringify(features)!==JSON.stringify(boundary.common.get(key)))mismatches.push({key});
  const calls=(r:typeof frequent)=>r.status.reduce((n,w)=>n+w.calculations,0);
  const counts=(r:typeof frequent)=>r.status.reduce((all,w)=>{for(const [key,value] of Object.entries(w.outcomes))all[key]=(all[key]??0)+value;return all;},{} as Record<string,number>);
  return {schemaVersion:1,classification:'SYNTHETIC_OFFLINE_CANDIDATE_CADENCE_REPLAY',strategy:PROVISIONAL_RULE.version,simulatedDurationMs:durationMs,candidates,source:{kind:'generated synthetic normalized actions; no matched real PumpApi payload',actions:actions.length,sha256:createHash('sha256').update(JSON.stringify(actions)).digest('hex')},frequent:{cadenceMs:1000,featureCalculations:calls(frequent),wallMs:frequent.wallMs,cpuMs:frequent.cpuMs,ingestion:counts(frequent),firstQualifiedAt:frequent.firstQualified,transitions:frequent.transitions},boundary:{cadenceMs:10000,featureCalculations:calls(boundary),wallMs:boundary.wallMs,cpuMs:boundary.cpuMs,ingestion:counts(boundary),firstQualifiedAt:boundary.firstQualified,transitions:boundary.transitions},commonBoundariesCompared:frequent.common.size,commonBoundaryMismatches:mismatches,firstQualificationEqual:JSON.stringify(frequent.firstQualified)===JSON.stringify(boundary.firstQualified),featureCalculationReductionFraction:1-calls(boundary)/calls(frequent),externalContextExamples:candidateExternalContextExamples(),rpcRequestSavings:0,providerNetworkRequests:0,entriesEnabled:false,naturalPaperTrades:0,limitations:['Common-boundary equality does not prove equivalent decisions between boundaries when risk, quote availability, age or data quality changes.','Confirmations can update provisional counts inside a closed bin; retained snapshot asOf is never refreshed.','Corrections, reversals and gaps invalidate immediately, independent of calculation frequency.','Synthetic passing features/contexts are not natural eligibility, fills, economic outcomes or a verified provider contract.','Reduced feature calls save calculation work, not the mandatory collection or transaction-enrichment requests.','CPU/wall measurements are this offline process only, not EC2 compatibility or provider latency.']};
}
